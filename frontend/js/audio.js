/* Squid Squad — procedural audio. There are no sound files, and none of it is the usual sine-and-envelope chime: every
   effect is a small physical model of something that belongs on a sunken ship, synthesised when the game starts.
     wood, brass, drums, coins   banks of resonators tuned to the modes of a plank, a plate, a drum skin or a coin, struck
                                 by a short burst of noise (soft for a mallet, sharp for metal on metal)
     water                       bubbles from their physics (a sine at the bubble's resonance, rising as it shrinks), and
                                 swells: smooth deep noise whose top opens as the wave crests
     creaks and hull groans      stick-slip friction, a pulse each time the surfaces slip, ringing wood or iron
     the kraken                  a breathy, rattling roar through a throat the size of a ship (formant filters)
     conch horn, swells          additive synthesis that brightens as it swells, the way brass and the sea do
   Each effect is built once, cached as a buffer (several variants of the frequent ones) and replayed with a little random
   pitch and level, so no two coins or reel stops are quite alike.

   The mix is built so a long session stays easy to listen to: big moments pull the music and the sea under them, the
   same sound fired twice at once is tamed instead of doubled, coins have a voice limit, the top end is softened, and a
   limiter catches the rest. Wins swell up in the key of whatever chord the music is on.

   The base game's music is the deep itself: a swell of water rolling through every bar, a slow pad that opens
   and closes with it, a sub-bass under it, and a whale-like voice singing the tune, sliding from note to note. It runs
   through four sections, about a minute, varies each time round, thins out when nobody is spinning and goes quiet after a
   minute idle. The bonus is the kraken's reel: a squeezebox riff over drums and a driving sub-bass, starting with a drum
   roll and getting heavier as the kraken's rage builds and each time it wakes. Pearl Reef plays the deep a little
   brighter; the Vault and the Wheel play the reel at an even pace.

   Sound effects and music each have their own saved volume, apart from the two mute switches and from ducking, and
   each has its own reverb behind its own volume. */
(function () {
  'use strict';
  let ctx = null, master, sfxBus, musicBus, ambBus, revIn, musicIn, musicRevIn, mDuck, aDuck, ambTrim, musicFade, idleGain;
  let muted = false, musicMuted = false, ambOn = true, offline = false;
  let effectsVolume = 1, musicVolume = 1, ducked = false;
  let tAt = null;                       // a pinned start time (offline renders, scheduled scenes); otherwise sounds start now
  const MUSIC_VOL = 0.34, AMB_VOL = 0.55;
  const AMB_TRIM = 0.73, AMB_SOLO = 1.1;     // the sea sits low under the music, and comes up a little when the music is off
  const hasDoc = typeof document !== 'undefined';
  const hidden = () => hasDoc && document.hidden;
  const msNow = () => typeof performance !== 'undefined' ? performance.now() : Date.now();

  function volume(v, fallback) { const n = Number(v); return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : fallback; }
  function storedVolume(key) { const v = localStorage.getItem(key); return v == null || v.trim() === '' ? 1 : volume(v, 1); }
  function load() {
    try {
      muted = localStorage.getItem('ss_muted') === '1';
      musicMuted = localStorage.getItem('ss_music') === '0';
      effectsVolume = storedVolume('ss_effectsVolume');
      musicVolume = storedVolume('ss_musicVolume');
    } catch (e) { /* storage unavailable */ }
  }
  load();

  // ======================================================================= DSP on plain arrays at the context's rate
  const SR = 48000;            // every sound is synthesised at this rate; the browser resamples to the device's own
  const TAU = Math.PI * 2;
  const rnd = (a, b) => a + Math.random() * (b - a);
  const mtof = m => 440 * Math.pow(2, (m - 69) / 12);
  const len = s => Math.max(1, Math.round(s * SR));
  const per60 = s => Math.exp(-6.9078 / (s * SR));     // per-sample factor that fades 60 dB in s seconds

  function white(n) { const x = new Float32Array(n); for (let i = 0; i < n; i++) x[i] = Math.random() * 2 - 1; return x; }
  function brown(n) {
    const x = new Float32Array(n);
    let v = 0;
    for (let i = 0; i < n; i++) { v = (v + 0.02 * (Math.random() * 2 - 1)) / 1.02; x[i] = v * 3.5; }
    return x;
  }
  function peak(x) { let m = 0; for (let i = 0; i < x.length; i++) { const a = Math.abs(x[i]); if (a > m) m = a; } return m; }
  function norm(x, p) { const m = peak(x); if (m > 0) { const k = (p || 1) / m; for (let i = 0; i < x.length; i++) x[i] *= k; } return x; }
  // mix src into dst, at seconds from its start
  function add(dst, src, at, g) {
    const o = Math.round((at || 0) * SR), k = g == null ? 1 : g;
    for (let i = 0, n = Math.min(src.length, dst.length - o); i < n; i++) dst[o + i] += src[i] * k;
    return dst;
  }
  // in place: a linear attack over a seconds, then an exponential fall with time constant d
  function ad(x, a, d) {
    for (let i = 0; i < x.length; i++) { const t = i / SR; x[i] *= t < a ? t / a : Math.exp(-(t - a) / d); }
    return x;
  }
  function shape(x, f) { for (let i = 0; i < x.length; i++) x[i] *= f(i / SR); return x; }
  function fade(x, ms) { const n = Math.min(x.length, len(ms / 1000)); for (let i = 0; i < n; i++) x[x.length - 1 - i] *= i / n; return x; }
  function lp1(x, fc) { const a = Math.exp(-TAU * fc / SR); let y = 0; for (let i = 0; i < x.length; i++) { y = x[i] + a * (y - x[i]); x[i] = y; } return x; }
  function hp1(x, fc) { const a = Math.exp(-TAU * fc / SR); let y = 0; for (let i = 0; i < x.length; i++) { y = x[i] + a * (y - x[i]); x[i] -= y; } return x; }
  // a biquad (RBJ cookbook) into a new array; f and q may be numbers or functions of time, re-read every 32 samples
  function bq(x, type, f, q) {
    const out = new Float32Array(x.length), ff = typeof f === 'function', fq = typeof q === 'function';
    let b0, b1, b2, a1, a2, x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    const coef = t => {
      const fr = Math.min(Math.max(ff ? f(t) : f, 10), SR * 0.45), w = TAU * fr / SR, cs = Math.cos(w);
      const al = Math.sin(w) / (2 * (fq ? q(t) : q)), a0 = 1 + al;
      if (type === 'lp') { b0 = (1 - cs) / 2 / a0; b1 = (1 - cs) / a0; b2 = b0; }
      else if (type === 'hp') { b0 = (1 + cs) / 2 / a0; b1 = -(1 + cs) / a0; b2 = b0; }
      else { b0 = al / a0; b1 = 0; b2 = -al / a0; }            // band-pass, 0 dB at the centre
      a1 = -2 * cs / a0; a2 = (1 - al) / a0;
    };
    coef(0);
    for (let i = 0; i < x.length; i++) {
      if ((ff || fq) && (i & 31) === 0) coef(i / SR);
      const xi = x[i], y = b0 * xi + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
      x2 = x1; x1 = xi; y2 = y1; y1 = y; out[i] = y;
    }
    return out;
  }

  // the contact of a hit: a burst of noise ms long, darker (fc) for a soft mallet; with no fc, a sharp metallic tick
  function strike(ms, fc) {
    const n = Math.max(3, len(ms / 1000)), x = white(n);
    for (let i = 0; i < n; i++) x[i] *= Math.pow(Math.sin(Math.PI * (i + 0.5) / n), 2);
    return fc ? lp1(x, fc) : x;
  }
  // a bank of resonators rung by x for n samples, one per mode {f, d (seconds to fade 60 dB), g, bend}; bend [ratio,
  // seconds] starts the pitch high and lets it settle, the way a drum skin slackens after the hit
  function ring(x, modes, n) {
    const out = new Float32Array(n);
    for (const m of modes) {
      if (!(m.f > 20 && m.f < SR * 0.45)) continue;
      const r = per60(m.d), c2 = r * r, g = m.g == null ? 1 : m.g, bend = m.bend, bn = bend ? len(bend[1] * 6) : 0;
      let c1 = 2 * r * Math.cos(TAU * m.f / SR), sw = Math.sin(TAU * m.f / SR), y1 = 0, y2 = 0;
      for (let i = 0; i < n; i++) {
        if (i < bn && (i & 7) === 0) {
          const w = TAU * m.f * (1 + (bend[0] - 1) * Math.exp(-i / (bend[1] * SR))) / SR;
          c1 = 2 * r * Math.cos(w); sw = Math.sin(w);
        }
        const y = c1 * y1 - c2 * y2 + sw * (i < x.length ? x[i] : 0);
        y2 = y1; y1 = y; out[i] += y * g;
      }
    }
    return out;
  }

  // mode ratios (and gains) of what things are made of
  const PLANK = [[1, 1], [2.756, 0.45], [5.404, 0.2], [8.933, 0.08]];                     // a free wooden bar
  const SKIN = [[1, 1], [1.594, 0.62], [2.136, 0.45], [2.296, 0.38], [2.653, 0.3], [2.918, 0.24], [3.156, 0.18], [3.501, 0.14]];
  const PLATE = (() => {                                                                    // a riveted brass plate
    const k = 1.37, r = [];
    for (let a = 1; a <= 4; a++) for (let b = 1; b <= 4; b++) r.push((a * a + b * b * k * k) / (1 + k * k));
    return r.sort((p, q) => p - q);
  })();
  const COIN = [[1, 1, 1], [1.73, 0.75, 0.75], [2.33, 0.6, 0.6], [2.85, 0.4, 0.45], [3.9, 0.25, 0.3], [0.43, 0.2, 0.4]];   // [ratio, gain, share of the decay]
  const HULL = [118, 171, 233, 362, 497, 688, 905, 1240];   // the resonances of a ship's iron hull, of a timber, of a hinge
  const TIMBER = [340, 760, 1450, 2600];
  const HINGE = [520, 1180, 2300, 3700];

  function wood(f, d, n, ex) {
    return ring(ex, PLANK.map(([r, g], k) => ({ f: f * r * rnd(0.985, 1.015), g, d: d / Math.pow(1 + k, 1.6) })), n);
  }
  function metal(f, d, n, ex) {
    return ring(ex, PLATE.map((r, k) => ({ f: f * r * rnd(0.99, 1.01), g: rnd(0.4, 1) / (1 + k * 0.15), d: d * Math.pow(r, -0.4) * rnd(0.8, 1.2) })), n);
  }
  function skin(f, d, n, ex, bend) {
    return ring(ex, SKIN.map(([r, g], k) => ({ f: f * r * rnd(0.99, 1.01), g, d: d / (1 + k * 0.7), bend: [bend || 1.1, 0.025] })), n);
  }
  // a low thump of water, or of a body landing: one heavily damped mode that drops in pitch
  function thump(f, d, n, bend) { return ring(strike(5, f * 5), [{ f, d, g: 1, bend: [bend || 1.5, 0.02] }], n); }
  // a short sine sweep with a smooth envelope: a cork-like pop
  function chirp(f0, f1, dur) {
    const n = len(dur), x = new Float32Array(n);
    let ph = 0;
    for (let i = 0; i < n; i++) { const k = i / n; ph += TAU * f0 * Math.pow(f1 / f0, k) / SR; x[i] = Math.sin(ph) * Math.sin(Math.PI * k); }
    return x;
  }
  // a frame drum (bodhran): the skin's modes, the pitch dropping as it slackens after the hit, the slap of the beater
  function drum(f, d, ms, bright, bend) {
    const n = len(d * 1.3 + 0.05), x = norm(skin(f, d, n, strike(ms, bright), bend));
    add(x, norm(hp1(ad(white(len(0.012)), 0.0005, 0.003), 1500)), 0, 0.22);
    return fade(x, 40);
  }

  // one bubble (van den Doel's model): a sine at its resonance that rises in pitch as it shrinks and dies within
  // milliseconds; xi above the natural 0.1 turns the plink into a cartoon bloop
  function bubble(x, at, f0, xi, a) {
    const d = 0.13 * f0 + 0.0072 * Math.pow(f0, 1.5), s = xi * d, o = Math.round(at * SR), n = Math.min(len(5 / d), x.length - o);
    let ph = 0;
    for (let i = 0; i < n; i++) {
      const t = i / SR;
      ph += TAU * f0 * (1 + s * t) / SR;
      x[o + i] += a * Math.sin(ph) * Math.exp(-d * t) * Math.min(1, i / 24);
    }
    return x;
  }
  // a cloud of bubbles over dur seconds from at: mostly small and high, a few big and low; skew > 1 crowds them early
  function bubbles(x, at, dur, count, lo, hi, xi, a, skew) {
    for (let k = 0; k < count; k++) {
      const f = lo * Math.pow(hi / lo, Math.pow(Math.random(), 0.7));
      bubble(x, at + dur * Math.pow(Math.random(), skew || 1), f, xi * rnd(0.7, 1.3), a * rnd(0.3, 1) * Math.pow(lo / f, 0.3));
    }
    return x;
  }
  // the surface breaking: a bright crack that darkens, droplets falling back, the air dragged under in one big bloop
  function splash(x, at, size) {
    add(x, bq(ad(white(len(0.3)), 0.002, 0.05 * size), 'bp', t => 3200 - 2400 * Math.min(1, t / 0.15), 0.7), at, 0.9);
    bubbles(x, at + 0.03, 0.6 * size, Math.round(40 * size), 900, 5000, 0.15, 0.22, 1.6);
    return bubble(x, at + 0.02, 140 / size, 0.4, 0.7);
  }

  // stick-slip friction: a pulse each time two surfaces slip, at a rate wandering between lo and hi a second, ringing a
  // set of resonances (timber for a creak, iron for a hull groan) that each fade over about d seconds
  function creak(dur, lo, hi, res, d) {
    const n = len(dur), ex = new Float32Array(n), ph = rnd(0, 6);
    for (let i = 0; i < n;) {
      const k = i / n;
      ex[i] = rnd(0.5, 1) * Math.sin(Math.PI * k);
      i += Math.max(1, Math.round(SR / ((lo + (hi - lo) * (0.5 + 0.5 * Math.sin(ph + k * 4.5))) * rnd(0.85, 1.15))));
    }
    return ring(ex, res.map((f, k) => ({ f: f * rnd(0.95, 1.05), d: d / (1 + k * 0.35), g: 1 / (1 + k * 0.5) })), n + len(d));
  }
  const groan = (dur, lo, hi) => creak(dur, lo, hi, HULL, 0.5);

  // a swell of water rolling through: a soft, deep rush that rises to its crest at peakAt (a share of dur) and falls
  // away, its top opening as it crests and closing as it passes. Smooth noise only, so it never crackles.
  function surf(dur, peakAt) {
    const n = len(dur), env = t => {
      const u = Math.min(1, t / dur);
      return u < peakAt ? Math.pow(Math.sin(Math.PI / 2 * u / peakAt), 2) : Math.pow(Math.cos(Math.PI / 2 * (u - peakAt) / (1 - peakAt)), 2);
    };
    const w = shape(add(brown(n), lp1(white(n), 600), 0, 0.2), env);
    return fade(hp1(bq(w, 'lp', t => 220 + 950 * env(t), 0.6), 35), 40);
  }
  // a swell of the deep: a chord of soft voices a few cents apart that opens up as it rises and closes as it ebbs, with
  // the hush of the sea in it; att seconds to the crest, then it ebbs away over the rest of dur
  function bloom(midis, dur, att) {
    const x = new Float32Array(len(dur + 0.05));
    const env = t => t < att ? Math.pow(t / att, 1.5) : Math.pow(Math.max(0, 1 - (t - att) / (dur - att)), 1.4);
    for (const m of midis) {
      for (const c of [-7, 0, 7]) {
        const f = mtof(m) * Math.pow(2, (c + rnd(-2, 2)) / 1200), wr = rnd(0.15, 0.4), wp = rnd(0, 6);
        partials(x, WARM, t => f * (1 + 0.001 * Math.sin(TAU * wr * t + wp)), env, 1.1, 1);
      }
    }
    add(x, lp1(lp1(shape(white(x.length), env), 700), 700), 0, peak(x) * 0.035);
    return lp1(lp1(x, 3200), 4500);
  }

  // additive synthesis: harmonic k has amplitude h[k-1] * env^(1 + bright*(k-1)), so the tone opens up as it swells, the
  // way a horn or a reed does; pitch(t) in Hz, env(t) 0..1
  function partials(x, h, pitch, env, bright, gain) {
    let ph = 0, f = 0, e = 0, eb = 0, K = 0;
    for (let i = 0; i < x.length; i++) {
      if ((i & 7) === 0) {                 // pitch and envelope move slowly: read them every 8 samples
        const t = i / SR;
        f = pitch(t); e = env(t); eb = Math.pow(Math.max(e, 0), bright); K = Math.min(h.length, Math.floor(SR * 0.45 / f));
      }
      ph += TAU * f / SR;
      if (ph > TAU) ph -= TAU;
      if (e <= 0) continue;
      const c = 2 * Math.cos(ph);
      let s0 = 0, s1 = Math.sin(ph), a = e, sum = 0;
      for (let k = 0; k < K; k++) { sum += s1 * h[k] * a; a *= eb; const s2 = c * s1 - s0; s0 = s1; s1 = s2; }
      x[i] += sum * gain;
    }
    return x;
  }
  const CONCH = [1, 0.72, 0.5, 0.33, 0.21, 0.14, 0.09, 0.055, 0.035, 0.02, 0.012];
  // a free reed's narrow pulse: harmonics fall away with gaps at every fifth one
  const REED = (() => { const h = []; for (let k = 1; k <= 16; k++) h.push(Math.sin(Math.PI * k * 0.2) / (k * Math.sin(Math.PI * 0.2))); return h; })();

  // a conch blown like a horn: each note scoops up into pitch, a slow vibrato settles in, breath hisses through the shell
  function conch(notes) {
    const end = notes[notes.length - 1][2], x = new Float32Array(len(end + 0.1));
    const cur = t => { let c = notes[0]; for (const nt of notes) if (t >= nt[1]) c = nt; return c; };
    const pitch = t => {
      const [f, s] = cur(t), u = t - s;
      return f * (1 - 0.08 * Math.exp(-u / 0.05)) * (1 + 0.007 * Math.sin(TAU * 5.3 * t) * Math.min(1, Math.max(0, u - 0.25) / 0.3));
    };
    const env = t => t >= end ? 0 : Math.min(1, t / 0.1) * Math.min(1, (end - t) / 0.25) * (0.82 + 0.18 * Math.exp(-t / 0.3));
    partials(x, CONCH, pitch, env, 0.9, 1);
    add(x, bq(shape(white(x.length), t => env(t) * 0.09), 'bp', 1300, 1.2), 0, 1);
    return lp1(x, 4200);
  }
  // a soft voice: harmonics falling away like a gentle sawtooth's, for the swells and the pad
  const WARM = [1, 0.5, 0.33, 0.25, 0.2, 0.16, 0.13, 0.11, 0.09, 0.08];

  // a throat: a glottal pulse train (Rosenberg's shape, differentiated as the lips radiate it) plus breath noise, through
  // parallel formant resonances that glide between vowels. o: f0(t), env(t) for the voicing, breath(t) for the noise
  // (pulsed: the breath comes in bursts with each opening of the throat, which is what makes a growl), formants(t) ->
  // [[centre, bandwidth, gain]...], jitter and shimmer for roughness, alt to weaken every other pulse
  function voice(n, o) {
    const src = new Float32Array(n);
    let ph = 0, prev = 0, jit = 0, amp = 1, odd = false;
    for (let i = 0; i < n; i++) {
      const t = i / SR;
      jit = jit * 0.999 + (Math.random() - 0.5) * o.jitter;
      const f = o.f0(t) * (1 + jit);
      ph += f / SR;
      if (ph >= 1) { ph -= 1; odd = !odd; amp = (1 + (Math.random() - 0.5) * 2 * o.shimmer) * (odd && o.alt ? o.alt : 1); }
      const shapeV = ph < 0.4 ? 0.5 * (1 - Math.cos(Math.PI * ph / 0.4)) : ph < 0.56 ? Math.cos(Math.PI * (ph - 0.4) / 0.32) : 0, flow = amp * shapeV;
      const air = (Math.random() * 2 - 1) * o.breath(t) * (o.pulsed ? 0.2 + 0.8 * shapeV * amp : 1);
      src[i] = (flow - prev) * (SR / f) * 0.15 * o.env(t) + air;
      prev = flow;
    }
    const out = new Float32Array(n), F0 = o.formants(0);
    for (let k = 0; k < F0.length; k++) {
      let held = null, ht = -1;
      const at = t => { if (t !== ht) { held = o.formants(t)[k]; ht = t; } return held; };
      add(out, bq(src, 'bp', t => at(t)[0], t => at(t)[0] / at(t)[1]), 0, F0[k][2]);
    }
    return out;
  }
  // the kraken's roar: mostly breath, forced in irregular bursts through a throat many times a sailor's (formants well
  // under half a person's), the jaw opening from 'oo' to 'aah' and closing; a second, smaller throat an octave up snarls
  // over it, and the whole thing is driven into a soft clip the way a real throat breaks up when it's pushed
  function roar(dur) {
    const n = len(dur + 0.2), x = new Float32Array(n);
    const OO = [[300, 80, 1], [700, 90, 0.7], [2200, 140, 0.3], [3000, 200, 0.12]], AA = [[750, 90, 1], [1150, 100, 0.8], [2500, 140, 0.35], [3300, 200, 0.14]];
    const open = t => Math.pow(Math.sin(Math.PI * Math.min(1, t / (dur * 0.85))), 0.7);
    const env = t => Math.min(1, t / 0.15) * Math.min(1, Math.max(0, (dur - t) / 0.6)) * (0.8 + 0.2 * Math.sin(TAU * 3.1 * t));
    for (const [size, lo, span, g] of [[0.38, 26, 16, 1], [0.6, 52, 26, 0.5]]) {
      add(x, norm(voice(n, {
        f0: t => lo + span * open(t), jitter: 0.07, shimmer: 0.7, alt: 0.45, pulsed: true, env: t => 0.35 * env(t), breath: t => 0.9 * env(t),
        formants: t => { const k = open(t); return OO.map((o, j) => [(o[0] + (AA[j][0] - o[0]) * k) * size, o[1] * size * 1.8, o[2]]); },
      })), 0, g);
    }
    norm(x);
    for (let i = 0; i < n; i++) x[i] = Math.tanh(x[i] * 2.2) / Math.tanh(2.2);
    return hp1(x, 28);
  }

  // ======================================================================= the sound bank
  // name: [variants, make]. Each is made on first use, or while the game idles after it starts, then replayed from buffers.
  const G = {
    // ---- interface
    press: [4, () => {        // a heavy brass push-button: the plunger thocks home, then its latch catches
      const n = len(0.1), x = new Float32Array(n);
      add(x, norm(wood(rnd(290, 350), 0.06, n, strike(0.6, 3000))), 0, 1);
      add(x, norm(metal(rnd(2600, 3100), 0.035, n, strike(0.15))), rnd(0.009, 0.013), 0.4);
      return fade(x, 15);
    }],
    tooth: [5, () => {        // one tooth of a ratchet: a small steel click in a wooden housing
      const n = len(0.06), x = new Float32Array(n);
      add(x, norm(metal(rnd(2100, 2600), 0.022, n, strike(0.1))), 0, 1);
      add(x, norm(wood(rnd(650, 800), 0.03, n, strike(0.4, 4000))), 0, 0.6);
      return fade(x, 10);
    }],
    knock: [3, () => lp1(wood(rnd(150, 175), 0.13, len(0.2), strike(2, 900)), 1400)],   // a fist on a locked chest
    rattle: [2, () => {       // its padlock rattling on the hasp
      const n = len(0.18), ex = new Float32Array(n);
      for (let k = 0; k < 4; k++) add(ex, strike(0.1), k * rnd(0.022, 0.03), rnd(0.4, 1) * Math.pow(0.7, k));
      return lp1(metal(rnd(1500, 1900), 0.05, n, ex), 6000);
    }],
    coin: [10, () => {        // a coin dropping onto the pile: it rings at its own modes and bounces once or twice
      const n = len(0.5), ex = new Float32Array(n);
      for (let k = 0, at = 0, a = 1, gap = rnd(0.018, 0.05), hits = 1 + Math.floor(Math.random() * 3); k < hits; k++) {
        add(ex, strike(0.12), at, a); at += gap; gap *= rnd(0.45, 0.7); a *= rnd(0.35, 0.6);
      }
      const f = rnd(3600, 5400), d = rnd(0.12, 0.3);
      return fade(ring(ex, COIN.map(([r, g, s]) => ({ f: f * r * rnd(0.99, 1.01), g, d: d * s })), n), 40);
    }],
    bead: [3, () => wood(rnd(1700, 2100), 0.02, len(0.04), strike(0.2, 8000))],         // an abacus bead
    lever: [2, () => {        // a brass lever thrown home
      const n = len(0.35), x = new Float32Array(n);
      add(x, raw('tooth'), 0, 0.5);
      add(x, norm(metal(rnd(500, 560), 0.12, n, strike(0.8, 6000))), 0.035, 1);
      add(x, norm(wood(rnd(180, 210), 0.08, n, strike(2, 1500))), 0.035, 0.5);
      return fade(x, 30);
    }],
    valve: [1, () => {        // a valve opens: air hisses out and streams up as bubbles
      const n = len(0.9), x = new Float32Array(n);
      add(x, norm(bq(shape(white(len(0.6)), t => Math.min(1, t / 0.01) * Math.exp(-t / 0.18)), 'bp', t => 2600 - 1400 * t, 1.2)), 0, 0.5);
      bubbles(x, 0.02, 0.7, 26, 500, 2600, 0.25, 0.2, 1.4);
      return fade(x, 60);
    }],
    deflate: [1, () => {      // pressure let go: a sigh of air, a few slow fat bubbles
      const n = len(0.6), x = new Float32Array(n);
      add(x, norm(bq(shape(white(len(0.35)), t => Math.min(1, t / 0.01) * Math.exp(-t / 0.1)), 'lp', t => 250 + 2000 * Math.exp(-t / 0.1), 1.2)), 0, 0.5);
      for (let k = 0; k < 4; k++) bubble(x, 0.03 + k * rnd(0.06, 0.09), rnd(160, 260), 0.35, 0.5);
      return fade(x, 50);
    }],
    hatch: [2, () => {        // the bonus-buy hatch swings open: the hinge creaks, the current rushes in
      const n = len(0.9), x = new Float32Array(n);
      add(x, norm(creak(0.32, 25, 70, HINGE, 0.06)), 0, 0.35);
      add(x, norm(lp1(bq(shape(white(len(0.8)), t => Math.pow(Math.sin(Math.PI * t / 0.8), 2)), 'bp', t => 140 + 520 * Math.sin(Math.PI * t / 0.8), 1.2), 2000)), 0.05, 0.7);
      bubbles(x, 0.15, 0.5, 10, 400, 2000, 0.15, 0.1, 1);
      return fade(x, 60);
    }],

    // ---- reels
    spin: [4, () => {         // the reels let go: a few turns of the capstan's ratchet, a swirl of water
      const n = len(0.5), x = new Float32Array(n);
      for (let k = 0, at = rnd(0, 0.01), gap = rnd(0.05, 0.06); k < 4; k++) { add(x, raw('tooth'), at, 0.3 + k * 0.03); at += gap * rnd(0.85, 1.1); gap *= 0.8; }
      add(x, norm(creak(0.24, 40, 85, TIMBER, 0.05)), 0.02, 0.12);
      add(x, norm(bq(ad(white(len(0.45)), 0.07, 0.11), 'bp', t => 280 + 2400 * t, 1.1)), 0, 0.6);
      bubbles(x, 0.05, 0.3, 5, 500, 1800, 0.15, 0.08, 1);
      return fade(x, 40);
    }],
    stop: [5, () => {         // a reel drum thumps home and its brass latch drops
      const n = len(0.32), x = new Float32Array(n);
      add(x, norm(skin(rnd(98, 112), 0.2, n, strike(2.5, 1600), 1.18)), 0, 1);
      add(x, norm(metal(rnd(2200, 2600), 0.03, n, strike(0.12))), 0.006, 0.3);
      add(x, norm(bq(ad(white(len(0.15)), 0.005, 0.04), 'bp', 700, 0.8)), 0, 0.15);
      return fade(x, 30);
    }],
    squelch: [4, () => {      // a squid slaps onto the reel: a wet squish, a heavy plop, the suction letting go
      const n = len(0.45), x = new Float32Array(n), w1 = rnd(0, 6), w2 = rnd(0, 6);
      const sq = shape(white(len(0.22)), t => Math.min(1, t / 0.008) * Math.exp(-t / 0.07) * (0.6 + 0.4 * Math.sin(TAU * 38 * t)));
      add(x, norm(bq(sq, 'bp', t => 650 + 400 * Math.sin(w1 + t * 40) + 900 * Math.exp(-t / 0.05), 5)), 0, 0.7);
      add(x, norm(bq(sq, 'bp', t => 1900 + 700 * Math.sin(w2 + t * 55), 6)), 0, 0.4);
      add(x, norm(thump(rnd(120, 140), 0.12, n)), 0, 0.8);
      add(x, norm(chirp(260, 1100, 0.018)), rnd(0.07, 0.1), 0.35);
      bubbles(x, 0.06, 0.3, 6, 300, 1400, 0.3, 0.2, 1.2);
      return fade(x, 50);
    }],

    // ---- squids and the kraken
    ink: [2, () => {          // a squid fires its ink: a pressurised burst that darkens as it spreads, one big bloop, a cloud of bubbles
      const n = len(1.1), x = new Float32Array(n);
      add(x, norm(bq(ad(white(len(0.6)), 0.004, 0.16), 'lp', t => 220 + 3800 * Math.exp(-t / 0.12), 1.6)), 0, 0.8);
      bubble(x, 0.012, 115, 0.45, 0.7);
      add(x, norm(thump(68, 0.35, n, 1.4)), 0, 0.6);
      bubbles(x, 0.05, 0.8, 30, 500, 3000, 0.12, 0.15, 1.8);
      return fade(x, 60);
    }],
    whoosh: [3, () => {       // a tentacle sweeps through the water and slaps down
      const n = len(0.62), x = new Float32Array(n), hit = 0.33;
      const w = shape(white(len(0.45)), t => t < hit ? Math.pow(t / hit, 2) : Math.exp(-(t - hit) / 0.04));
      add(x, norm(lp1(bq(w, 'bp', t => 160 + 900 * Math.pow(Math.min(1, t / hit), 2), 1.6), 2500)), 0, 0.7);
      add(x, norm(hp1(ad(white(len(0.06)), 0.001, 0.012), 900)), hit, 0.5);
      add(x, norm(ring(strike(2, 800), [{ f: 95, d: 0.12, g: 1, bend: [1.3, 0.015] }, { f: 210, d: 0.06, g: 0.4 }], len(0.25))), hit, 0.6);
      bubbles(x, hit, 0.2, 5, 400, 1800, 0.2, 0.12, 1.4);
      return fade(x, 40);
    }],
    suction: [3, () => {      // a sucker takes hold of the drum: the rubbery squeak of it stretching, a pop, a knock
      const n = len(0.35), x = new Float32Array(n);
      add(x, norm(bq(ad(white(len(0.08)), 0.02, 0.03), 'bp', t => 500 + 18000 * t, 7)), 0, 0.5);
      add(x, norm(chirp(320, 1200, 0.016)), 0.07, 0.45);
      add(x, norm(wood(rnd(400, 440), 0.06, n, strike(1, 2500))), 0.075, 0.6);
      add(x, norm(thump(92, 0.18, n, 1.4)), 0.075, 0.7);
      return fade(x, 40);
    }],
    stamp: [3, () => {        // a brass stamp comes down and strikes the multiplier into the plate
      const n = len(0.55), x = new Float32Array(n);
      add(x, raw('tooth'), 0, 0.45);
      add(x, norm(metal(rnd(330, 380), 0.32, n, strike(1.5, 5000))), 0.03, 1);
      add(x, norm(thump(75, 0.15, n, 1.3)), 0.03, 0.6);
      return fade(x, 50);
    }],
    cog: [4, () => {          // a gear clicks over and a small brass tab drops
      const n = len(0.25), x = new Float32Array(n);
      add(x, raw('tooth'), 0, 0.6);
      add(x, norm(metal(rnd(850, 950), 0.11, n, strike(0.4, 7000))), 0.018, 0.7);
      return fade(x, 30);
    }],
    heart: [2, () => {        // the kraken's heart, felt through the hull: lub-dub
      const n = len(0.7), x = new Float32Array(n);
      for (const [at, f, g] of [[0, 58, 1], [0.17, 54, 0.7]]) {
        add(x, norm(ring(strike(6, 250), [{ f, d: 0.25, g: 1, bend: [1.5, 0.02] }, { f: f * 2.07, d: 0.08, g: 0.3 }], len(0.4))), at, g);
        add(x, norm(wood(rnd(170, 190), 0.08, len(0.2), strike(3, 900))), at, g * 0.3);
      }
      return fade(x, 40);
    }],
    awaken: [1, () => {       // the kraken wakes: it roars, the hull groans under it, the water churns
      const n = len(3.4), x = new Float32Array(n);
      add(x, norm(roar(2.6)), 0.05, 1);
      add(x, norm(groan(2.4, 24, 55)), 0.3, 0.3);
      add(x, norm(thump(38, 1.4, n, 1.8)), 0, 0.8);
      add(x, norm(hp1(lp1(shape(brown(len(3)), t => Math.min(1, t / 0.2) * Math.exp(-t / 1.1)), 300), 25)), 0, 0.5);
      bubbles(x, 0.3, 2.2, 50, 200, 1600, 0.25, 0.15, 1.2);
      return fade(x, 300);
    }],
    rumble: [1, () => fade(hp1(lp1(shape(brown(len(1.6)), t => Math.min(1, t / 0.15) * Math.exp(-t / 0.6)), 220), 25), 100)],
    surge: [2, () => {        // the water heaves up: a rush that swells and rises, bubbles streaming
      const n = len(1.2), x = new Float32Array(n);
      const w = shape(add(brown(len(1.1)), white(len(1.1)), 0, 0.15), t => Math.pow(Math.min(1, t / 0.75), 2) * Math.min(1, Math.max(0, 1.1 - t) / 0.3));
      add(x, norm(hp1(bq(w, 'bp', t => 180 + 900 * Math.pow(t / 1.1, 1.5), 0.9), 40)), 0, 1);
      bubbles(x, 0.3, 0.8, 18, 300, 2000, 0.2, 0.12, 0.7);
      return fade(x, 60);
    }],
    strain: [1, () => {       // the hull straining under the pressure while the last reels spin
      const n = len(8), x = new Float32Array(n), b = brown(n);
      add(x, norm(bq(b, 'bp', t => 100 * Math.pow(2, t / 5), 14)), 0, 1);
      add(x, norm(bq(b, 'bp', t => 151 * Math.pow(2, t / 5), 16)), 0, 0.7);
      add(x, norm(groan(8, 18, 40)), 0, 0.25);
      return hp1(x, 30);
    }],

    // ---- the band, for wins
    drumLo: [3, () => drum(rnd(78, 84), 0.45, 3, 1800, 1.12)],
    drumHi: [4, () => drum(rnd(145, 155), 0.25, 2, 3200, 1.08)],
    warDrum: [3, () => drum(rnd(60, 65), 0.9, 5, 900, 1.3)],
    stomp: [3, () => {        // a boot on the deck: the planks boom, the boards knock
      const n = len(0.35), x = new Float32Array(n);
      add(x, norm(wood(rnd(62, 72), 0.3, n, strike(6, 700))), 0, 1);
      add(x, norm(wood(rnd(380, 430), 0.05, n, strike(1.5, 4000))), 0.003, 0.35);
      return fade(x, 40);
    }],
    clap: [3, () => {         // hands: a few bursts milliseconds apart, the last one ringing in the palms
      const x = new Float32Array(len(0.16));
      [0, 0.007, 0.015, 0.024].forEach((at, k) => add(x, ad(white(len(k === 3 ? 0.13 : 0.012)), 0.0005, k === 3 ? 0.035 : 0.003), at, k === 3 ? 1 : 0.8));
      return fade(bq(x, 'bp', rnd(1100, 1400), 1.1), 20);
    }],
    // the big-win swells climb F, G, A and land on D major: the minor key turns bright when the win is counted out
    wF: [1, () => bloom([53, 60, 65, 69, 72], 2.2, 0.3)],
    wG: [1, () => bloom([55, 62, 67, 71, 74], 2.2, 0.3)],
    wA: [1, () => bloom([57, 64, 69, 73, 76], 2.4, 0.3)],
    wD: [1, () => bloom([50, 57, 62, 66, 69, 74], 3.2, 0.45)],
    swell: [1, () => bloom([50, 57, 62, 65, 69], 2.4, 0.8)],
    conchCall: [1, () => conch([[146.83, 0, 0.5], [220, 0.5, 1.7]])],
    conchToot: [1, () => conch([[220, 0, 0.55]])],
    hullBoom: [1, () => {     // something huge hits the hull: the iron rings, low and dark, and the water shudders
      const n = len(2.2), x = new Float32Array(n);
      add(x, norm(lp1(metal(rnd(58, 64), 1.6, n, strike(8, 1200)), 1800)), 0, 1);
      add(x, norm(thump(42, 0.8, n, 1.5)), 0, 0.7);
      return fade(x, 200);
    }],

    // ---- the bonus games
    reefPearl: [3, () => {    // a pearl settles into the reef: a small clam clack and a soft, round bloop
      const n = len(0.5), x = new Float32Array(n);
      add(x, norm(ring(strike(0.12), [1700, 2900, 4400].map((f, k) => ({ f: f * rnd(0.95, 1.05), d: 0.035 - k * 0.006, g: rnd(0.6, 1) })), len(0.1))), 0, 0.45);
      bubble(x, 0.01, rnd(200, 240), 0.35, 0.8);
      add(x, norm(thump(70, 0.18, n, 1.4)), 0, 0.35);
      return fade(x, 40);
    }],
    swish: [3, () => fade(lp1(bq(shape(white(len(0.3)), t => Math.pow(Math.sin(Math.PI * t / 0.3), 2)), 'bp', t => 400 + 2400 * t, 1.1), 3000), 30)],   // a reef cell spins up through the water
    creakLid: [2, () => {     // a chest lid swings up on a stiff hinge and drops back against its stays
      const n = len(0.7), x = new Float32Array(n);
      add(x, norm(creak(0.35, 30, 80, HINGE, 0.05)), 0, 0.5);
      add(x, norm(wood(rnd(140, 160), 0.12, n, strike(3, 1200))), 0.33, 0.8);
      bubbles(x, 0.35, 0.3, 6, 400, 1600, 0.2, 0.1, 1);
      return fade(x, 40);
    }],

    // ---- water
    plip: [8, () => bubble(new Float32Array(len(0.15)), 0, rnd(350, 1400), rnd(0.1, 0.3), 1)],   // a lone bubble
    wave: [3, () => surf(1.9, rnd(0.45, 0.6))],   // a swell rolls through
    fizz: [3, () => {         // a few fat bubbles rolling up, each a little higher than the last
      const x = new Float32Array(len(0.8));
      for (let k = 0; k < 7; k++) bubble(x, k * rnd(0.05, 0.08), 260 * Math.pow(1.25, k) * rnd(0.93, 1.07), rnd(0.25, 0.4), rnd(0.6, 1));
      return lp1(fade(x, 40), 2500);
    }],
    dive: [1, () => {         // the dive: the surface breaks, the world goes muffled as you sink, the air streams up past you
      const n = len(2.2), x = new Float32Array(n);
      splash(x, 0, 1.2);
      add(x, norm(bq(shape(white(len(1.6)), t => Math.min(1, t / 0.05) * Math.exp(-t / 0.6)), 'lp', t => 300 + 5000 * Math.exp(-t / 0.18), 0.9)), 0.02, 0.5);
      bubbles(x, 0.15, 1.6, 70, 300, 3000, 0.15, 0.16, 1.2);
      add(x, norm(thump(50, 1.0, n, 1.6)), 0.05, 0.6);
      return fade(x, 200);
    }],
    plunge: [1, () => {       // through the ink into the bonus: a rush of water opens and closes over, the hull groans, bubbles storm
      const n = len(2.2), x = new Float32Array(n);
      const rush = shape(brown(len(1.9)), t => Math.min(1, t / 0.45) * Math.min(1, Math.max(0, 1.9 - t) / 0.5));
      add(x, norm(hp1(bq(rush, 'lp', t => 180 + 1400 * Math.sin(Math.PI * Math.min(1, t / 1.6)), 0.9), 30)), 0, 0.9);
      add(x, norm(groan(1.5, 22, 48)), 0.15, 0.35);
      add(x, norm(thump(46, 1.0, n, 1.5)), 0.1, 0.6);
      bubbles(x, 0.2, 1.4, 70, 300, 3500, 0.12, 0.12, 1.3);
      return fade(x, 150);
    }],
    creakFar: [3, () => lp1(creak(rnd(0.6, 1.1), 20, 60, TIMBER, 0.08), 1500)],   // far off, the wreck settling
    groanFar: [2, () => lp1(groan(rnd(1.8, 2.6), 14, 34), 900)],
  };
  // a pearl lands: the clam snaps shut, a log drum sounds the next step up the chord, the water thumps (harder each time)
  [62, 65, 69, 74, 77].forEach((m, i) => {
    G['pearl' + i] = [1, () => {
      const n = len(1.2), x = new Float32Array(n), f = mtof(m);
      add(x, norm(ring(strike(0.15), [820, 1650, 2900, 4300, 6100].map((fr, k) => ({ f: fr * rnd(0.97, 1.03), d: 0.045 - k * 0.005, g: rnd(0.5, 1) })), len(0.15))), 0, 0.6);
      add(x, norm(ring(strike(4, 1500), [{ f, d: 0.5, g: 1 }, { f: f * 2.31, d: 0.13, g: 0.35 }, { f: f * 3.86, d: 0.05, g: 0.15 }], n)), 0.004, 0.75);
      add(x, norm(thump(55, 0.5 + i * 0.12, n, 1.6)), 0, 0.45 + i * 0.12);
      bubbles(x, 0.03, 0.4 + i * 0.1, 6 + i * 5, 500, 2600, 0.15, 0.12, 1.5);
      return fade(x, 80);
    }];
  });
  // the win swells in each of the music's chords, made by name: 'bloom:Dm'
  function noteMaker(name) {
    const [kind, c] = name.split(':');
    if (kind === 'bloom' && CH[c]) return [1, () => bloom(CH[c].slice(1).map(m => m + 12), 1.3, 0.1)];
    throw new Error('no sound ' + name);
  }

  const bank = {};
  function variant(name) {
    let b = bank[name];
    if (!b) {
      const g = G[name] || noteMaker(name);
      b = bank[name] = [];
      for (let i = 0; i < g[0]; i++) b.push({ raw: norm(g[1](i), 0.9), buf: null });
    }
    return b[Math.floor(Math.random() * b.length)];
  }
  const raw = name => variant(name).raw;
  function buf(name) {
    const v = variant(name);
    if (!v.buf) {
      v.buf = ctx.createBuffer(1, v.raw.length, SR);
      v.buf.getChannelData(0).set(v.raw);
      if (name.indexOf(':') > 0) v.raw = null;          // the band's notes are only ever played, never mixed into other sounds
    }
    return v.buf;
  }

  // ======================================================================= the mixer
  function gainNode(v, dest) { const g = ctx.createGain(); g.gain.value = v; if (dest) g.connect(dest); return g; }
  // a reverb send: music into the music's room, everything else into the effects' room
  function send(node, amt, music) { if (amt) { const s = gainNode(amt); node.connect(s); s.connect(music ? musicRevIn : revIn); } }
  function hold(p, t) { if (p.cancelAndHoldAtTime) p.cancelAndHoldAtTime(t); else { p.cancelScheduledValues(t); p.setValueAtTime(p.value, t); } }
  const ambTarget = () => ambOn ? (musicMuted ? AMB_SOLO : AMB_TRIM) : 0;
  const musicGain = () => musicMuted ? 0 : MUSIC_VOL * musicVolume * (ducked ? 0.3 : 1);
  // a short smooth move to a new level, replacing whatever ramp was under way
  function fadeGain(node, value, duration) {
    const t = now(), p = node.gain;
    hold(p, t);
    p.linearRampToValueAtTime(value, t + duration);
  }
  // the sea for a reverb: a dense, smooth tail that swells in over 30 ms and loses its highs as it dies (no discrete
  // reflections, which would flutter on every hit). A convolver needs its impulse at the context's own rate (everything
  // else is made at 48 kHz and resampled).
  function room(sec) {
    const R = ctx.sampleRate, n = Math.round(sec * R), b = ctx.createBuffer(2, n, R);
    for (let c = 0; c < 2; c++) {
      const d = b.getChannelData(c);
      let lp = 0, lp2 = 0;
      for (let i = 0; i < n; i++) {
        const a = 0.35 + 0.62 * i / n;
        lp = (Math.random() * 2 - 1) * (1 - a) + lp * a;
        lp2 = lp * (1 - a) + lp2 * a;
        d[i] = (lp + lp2) * Math.exp(-i / (R * sec * 0.22)) * Math.pow(Math.min(1, i / (0.03 * R)), 2) * 1.6;
      }
    }
    return b;
  }
  //   sfx (+ its reverb) ──────────────────────────┐
  //   music in ─ music (+ its reverb) ─ idle ─ fade-in ─ duck ┼─ soft top end ─ master ─ glue compressor ─ limiter ─ out
  //   sea ───────────────────────────── trim ─ duck ┘
  function build(c) {
    ctx = c;
    const lim = ctx.createDynamicsCompressor();          // nothing gets past about -1 dB
    lim.threshold.value = -2; lim.knee.value = 0; lim.ratio.value = 20; lim.attack.value = 0.002; lim.release.value = 0.12;
    lim.connect(ctx.destination);
    const glue = ctx.createDynamicsCompressor();         // gentle, slow: holds the mix together without pumping
    glue.threshold.value = -18; glue.knee.value = 12; glue.ratio.value = 2.5; glue.attack.value = 0.012; glue.release.value = 0.28;
    glue.connect(lim);
    // the four buses first: master, effects, music, sea
    master = gainNode(muted ? 0 : 0.9, glue);
    sfxBus = gainNode(0.85 * effectsVolume);
    musicBus = gainNode(musicGain());
    ambBus = gainNode(AMB_VOL * effectsVolume);
    const soft = ctx.createBiquadFilter();               // takes the sizzle off the top so a long session stays easy on the ears
    soft.type = 'highshelf'; soft.frequency.value = 6000;
    if (soft.gain) soft.gain.value = -3;
    soft.connect(master);
    sfxBus.connect(soft);
    mDuck = gainNode(1, soft);
    musicFade = gainNode(1, mDuck);
    idleGain = gainNode(1, musicFade);
    musicBus.connect(idleGain);
    aDuck = gainNode(1, soft);
    ambTrim = gainNode(ambTarget(), aDuck);
    ambBus.connect(ambTrim);
    // one room, heard twice: the effects' reverb returns into the effects bus, the music's into the music bus, so each
    // stays behind its own volume
    const rev = ctx.createConvolver(), musicRev = ctx.createConvolver();
    rev.buffer = musicRev.buffer = room(2.4);
    revIn = gainNode(1);
    revIn.connect(rev); rev.connect(gainNode(0.55 / 0.85, sfxBus));
    musicRevIn = gainNode(1);
    musicRevIn.connect(musicRev); musicRev.connect(gainNode(0.55 / MUSIC_VOL, musicBus));
    // every music voice comes in here: on to the music bus, and a little of it into the music's room
    musicIn = gainNode(1, musicBus);
    musicIn.connect(gainNode(0.2, musicRevIn));
  }
  function init() {
    if (ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    build(new AC());
    startAmbient();
    warm();
    // nothing plays while the game is in a background tab, and nothing piles up to burst out when it comes back
    if (hasDoc) document.addEventListener('visibilitychange', () => {
      if (!ctx) return;
      if (document.hidden) { if (ctx.state === 'running' && ctx.suspend) ctx.suspend(); } else ctx.resume();
    });
  }
  function resume() { if (ctx && ctx.state !== 'running' && !hidden()) ctx.resume(); }
  const now = () => tAt != null ? tAt : ctx.currentTime;

  // pull the music (and, less, the sea) under an important moment for sec seconds, the way a sidechain would
  let duckUntil = 0, duckDepth = 1;
  function duckFor(sec, depth) {
    const t = now(), until = t + sec;
    const d = Math.min(depth, t < duckUntil ? duckDepth : 1);
    duckUntil = Math.max(duckUntil, until); duckDepth = d;
    for (const [p, k] of [[mDuck.gain, 1], [aDuck.gain, 0.7]]) {
      const v = 1 - (1 - d) * k;
      hold(p, t); p.setTargetAtTime(v, t, 0.04); p.setTargetAtTime(1, duckUntil, 0.45);
    }
  }

  // play a buffer. o: t (start), vol, rate, vary (random pitch spread, 3% unless given), pan, send (to the reverb), lp,
  // dest, cap [family, most at once]
  const voices = {};
  function out(b, o) {
    o = o || {};
    if (o.cap && !offline) { const [k, max] = o.cap; if ((voices[k] || 0) >= max) return null; voices[k] = (voices[k] || 0) + 1; }
    const t = o.t != null ? o.t : now(), src = ctx.createBufferSource();
    src.buffer = b;
    if (src.playbackRate) src.playbackRate.value = (o.rate || 1) * (1 + (Math.random() * 2 - 1) * (o.vary == null ? 0.03 : o.vary));
    if (o.cap && !offline) src.onended = () => { voices[o.cap[0]]--; };
    let node = src;
    if (o.lp) { const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = o.lp; node.connect(f); node = f; }
    const g = gainNode((o.vol == null ? 1 : o.vol) * rnd(0.9, 1.05));
    node.connect(g); node = g;
    if (o.pan && ctx.createStereoPanner) { const p = ctx.createStereoPanner(); p.pan.value = Math.max(-1, Math.min(1, o.pan)); node.connect(p); node = p; }
    node.connect(o.dest || sfxBus);
    send(node, o.send);
    src.start(Math.max(t, ctx.currentTime));
    return src;
  }
  const S = (name, o) => out(buf(name), o);
  // the same sound fired again within gap seconds is played softer rather than doubled (five reels landing at once in
  // turbo, three squids on one reel)
  const last = {};
  function tame(key, gap) {
    const t = now(), d = t - (last[key] == null ? -9 : last[key]);
    last[key] = t;
    return d < gap ? 0.3 + 0.7 * Math.max(0, d) / gap : 1;
  }
  // a handful of coins over dur seconds, spread across the stereo field
  function coins(t, count, dur, vol) {
    for (let k = 0; k < count; k++) S('coin', { t: t + dur * Math.pow(Math.random(), 1.4), vol: vol * rnd(0.6, 1), pan: rnd(-0.6, 0.6), lp: 8000, cap: ['coin', 10] });
  }

  // make every buffer while the game idles, a few at a time, so nothing has to be synthesised the moment it's needed
  let warming = false;
  function warm() {
    if (warming) return;
    warming = true;
    const first = ['dive', 'swell', 'press', 'tooth', 'spin', 'stop', 'squelch', 'coin', 'pearl0', 'pearl1', 'pearl2', 'wave', 'fizz', 'drumLo', 'drumHi'];
    const names = first.concat(Object.keys(CH).map(c => 'bloom:' + c), Object.keys(G).filter(k => first.indexOf(k) < 0));
    const idle = window.requestIdleCallback ? cb => requestIdleCallback(cb, { timeout: 600 }) : cb => setTimeout(cb, 30);
    let i = 0;
    const step = () => {
      const until = msNow() + 8;
      while (i < names.length && msNow() < until) variant(names[i++]);
      if (i < names.length) idle(step);
    };
    idle(step);
  }

  // ======================================================================= the effects the game calls
  const mood = { lastSpin: -99, rage: 0, wake: 0 };       // what the band listens to
  let lastCog = -9, cogStep = 0, lastStamp = -9, stampStep = 0;
  // a run of the same event steps up a semitone each time, like a gear being wound tighter
  function streak(t, prev, step, gap) { return t - prev < gap ? Math.min(step + 1, 9) : 0; }
  const fx = {
    click() { S('press', { vol: 0.12 * tame('press', 0.06) }); },
    hover() { S('tooth', { vol: 0.05, rate: 1.3 }); },
    cardHover() { S('tooth', { vol: 0.05, rate: 1.2 }); },
    bet(up) {
      const t = now(), k = tame('bet', 0.12);
      S('tooth', { t, vol: 0.12 * k }); S('tooth', { t: t + 0.045, vol: 0.12 * k, rate: up ? 1.1 : 0.88 });
      if (up) S('coin', { t: t + 0.05, vol: 0.05 * k, lp: 8000, cap: ['coin', 10] });
    },
    denied() {
      const t = now();
      S('knock', { t, vol: 0.17 }); S('knock', { t: t + 0.12, vol: 0.14, rate: 0.9 }); S('rattle', { t: t + 0.015, vol: 0.05 });
    },
    anteOn() {
      const t = now();
      S('lever', { t, vol: 0.28 }); S('valve', { t: t + 0.04, vol: 0.24 }); S('coin', { t: t + 0.06, vol: 0.08 });
    },
    anteOff() {
      const t = now();
      S('lever', { t, vol: 0.15, rate: 0.85 }); S('deflate', { t: t + 0.03, vol: 0.14 });
    },
    swoosh() { S('hatch', { vol: 0.12 }); },
    // fast play (turbo, autoplay) gets a lighter spin, so the same sound every second doesn't wear on you
    spin() {
      const t = now(), fast = t - mood.lastSpin < 1.8;
      mood.lastSpin = t;
      S('spin', { vol: fast ? 0.09 : 0.14 });
    },
    reelStop(i) { S('stop', { vol: 0.42 * tame('stop', 0.06), rate: 1 + (2 - (i || 0)) * 0.025, pan: ((i || 0) - 2) * 0.22 }); },
    scatterLand(n) {
      n = Math.max(0, Math.min(4, n || 0));
      duckFor(1 + n * 0.2, 0.6 - n * 0.06);
      S('pearl' + n, { vol: 0.46, vary: 0, send: 0.3 });
    },
    wildLand() {
      const k = tame('squelch', 0.09) * (now() - (last.ink == null ? -9 : last.ink) < 0.1 ? 0.5 : 1);
      S('squelch', { vol: 0.32 * k, pan: rnd(-0.3, 0.3) });
    },
    bubble(t, vol) { S('plip', { t, vol: vol == null ? 0.05 : vol, vary: 0.15, pan: rnd(-0.5, 0.5) }); },
    coin() { S('coin', { vol: 0.05, lp: 7000, pan: rnd(-0.5, 0.5), cap: ['coin', 6] }); },
    tick() { S('bead', { vol: 0.05, pan: rnd(-0.2, 0.2) }); },
    // a win swells up out of the water in the key of whatever chord the music is on, so it never clashes with it
    winSmall() {
      const t = now(), k = tame('winS', 0.4);
      S('bloom:' + music.chord, { t, vol: 0.15 * k, send: 0.3, vary: 0 });
      S('fizz', { t: t + 0.02, vol: 0.16 * k, pan: rnd(-0.3, 0.3) });
      coins(t + 0.05, 2, 0.25, 0.1);
    },
    winMed() {
      const t = now();
      duckFor(1, 0.7);
      S('bloom:' + music.chord, { t, vol: 0.22, send: 0.3, vary: 0 });
      S('fizz', { t, vol: 0.22 }); S('wave', { t, vol: 0.12, rate: 1.4 });
      S('drumLo', { t, vol: 0.32, lp: 900 });
      coins(t + 0.05, 5, 0.45, 0.13);
    },
    // a big win is a phrase: the sea swells through chords that climb with each tier (F, G, A) and bigWinEnd lands it on
    // D major. The coins under it come from the count-up's trickle, not from here.
    bigWin(tier) {
      tier = Math.max(0, Math.min(2, tier || 0));
      const t = now();
      duckFor(2.4, 0.35);
      S('drumLo', { t, vol: 0.5 }); S('stomp', { t, vol: 0.4 });
      if (tier) S('warDrum', { t, vol: 0.26 + tier * 0.08 });
      S(['wF', 'wG', 'wA'][tier], { t, vol: 0.4, send: 0.35, vary: 0 });
      S('surge', { t, vol: 0.16 + tier * 0.05 }); S('fizz', { t: t + 0.1, vol: 0.24 });
      coins(t + 0.08, 4 + tier * 2, 0.6, 0.1);
      if (tier === 2) { S('hullBoom', { t, vol: 0.32 }); S('conchToot', { t: t + 0.25, vol: 0.26, send: 0.45, vary: 0 }); }
    },
    bigWinEnd(tier) {
      const t = now();
      duckFor(2.8, 0.4);
      S('wD', { t, vol: 0.45, send: 0.35, vary: 0 });
      S('wave', { t, vol: 0.2 }); S('fizz', { t: t + 0.05, vol: 0.22 });
      S('drumLo', { t, vol: 0.55 }); S('stomp', { t, vol: 0.4 });
      if (tier) S('warDrum', { t, vol: 0.3 });
      coins(t + 0.05, 3 + (tier || 0) * 2, 0.5, 0.1);
    },
    totalWin() { fx.bigWinEnd(0); },
    tierUp() { S('surge', { vol: 0.14 }); },
    bonusTrigger() {
      const t = now();
      duckFor(2.8, 0.3);
      S('hullBoom', { t, vol: 0.42 });
      S('conchCall', { t: t + 0.15, vol: 0.38, send: 0.45, vary: 0 });
      S('valve', { t: t + 0.1, vol: 0.18 });
    },
    transition() { duckFor(2.2, 0.35); S('plunge', { vol: 0.6, send: 0.2 }); },
    ink() { const k = tame('inkT', 0.15); last.ink = now(); S('ink', { vol: 0.26 * k, pan: rnd(-0.3, 0.3) }); },
    fsStart() {
      const t = now();
      duckFor(2.2, 0.45);
      S('dive', { t, vol: 0.52, send: 0.2 });
      S('swell', { t: t + 0.25, vol: 0.3, send: 0.3, vary: 0 });
    },
    retrigger() {
      const t = now();
      duckFor(1.6, 0.5);
      S('conchToot', { t, vol: 0.36, send: 0.45, vary: 0 });
      S('drumLo', { t, vol: 0.45 }); S('drumHi', { t: t + 0.12, vol: 0.35 });
      coins(t + 0.05, 3, 0.35, 0.12);
    },
    sticky() { S('suction', { vol: 0.28 * tame('suction', 0.1) }); },
    mult() {
      const t = now() + 0.04;
      stampStep = streak(t, lastStamp, stampStep, 0.9); lastStamp = t;
      S('stamp', { t, vol: 0.2, rate: Math.pow(2, stampStep / 12), vary: 0.01 });
    },
    multUp() {
      const t = now();
      cogStep = streak(t, lastCog, cogStep, 0.5); lastCog = t;
      S('cog', { t, vol: 0.4, rate: Math.pow(2, cogStep / 12), vary: 0.01 });
    },
    rage() { mood.rage++; S('heart', { vol: 0.4 }); },
    awaken() { mood.wake++; mood.rage = 0; duckFor(3.4, 0.25); S('awaken', { vol: 0.75, send: 0.3, vary: 0 }); },
    roar() { fx.awaken(); },
    whoosh() { S('whoosh', { vol: 0.17 * tame('whoosh', 0.12), pan: rnd(-0.5, 0.5) }); },
    rumble() { S('rumble', { vol: 0.5 }); },
    // the squad charges: war drums (BOOM . ba-BOOM) and the water heaving up
    squadAlarm() {
      const t = now();
      duckFor(1.8, 0.45);
      S('warDrum', { t, vol: 0.38 }); S('warDrum', { t: t + 0.34, vol: 0.24 }); S('warDrum', { t: t + 0.5, vol: 0.4 });
      S('surge', { t, vol: 0.26 });
      S('rumble', { t: t + 0.4, vol: 0.2 });
    },

    // ---- the bonus games
    // Pearl Reef: each pearl a little higher than the last; golden pearls stamp the board; jackpots swell up
    pearlLand(k) { S('reefPearl', { vol: 0.32, rate: 1 + Math.min(8, k || 0) * 0.025, send: 0.25, pan: rnd(-0.3, 0.3) }); },
    jackpotPearl() { const t = now(); duckFor(1.2, 0.6); S('pearl3', { t, vol: 0.4, vary: 0, send: 0.3 }); S('fizz', { t: t + 0.05, vol: 0.2 }); },
    goldPearl() { const t = now(); S('stamp', { t, vol: 0.2, rate: 1.2 }); S('fizz', { t, vol: 0.24 }); S('bloom:' + music.chord, { t, vol: 0.14, vary: 0, send: 0.3 }); },
    cellSpin() { S('swish', { vol: 0.12 * tame('swish', 0.08) }); },
    // the respins wind back up to three, or one is spent
    respinReset() { const t = now(); [0, 0.06, 0.12].forEach((at, k) => S('cog', { t: t + at, vol: 0.28, rate: Math.pow(2, k * 2 / 12), vary: 0.01 })); },
    respinLose() { const t = now(); S('knock', { t, vol: 0.14, rate: 0.85 }); S('deflate', { t: t + 0.02, vol: 0.1 }); },
    // Captain's Vault: the chest rattles, the lid creaks open; a life rises up in bubbles or the kraken's heart thumps
    chestShake() { const t = now(); S('rattle', { t, vol: 0.12 }); [0, 0.07, 0.14].forEach(at => S('knock', { t: t + at, vol: 0.1, rate: 1.3 })); },
    chestOpen() { const t = now(); S('creakLid', { t, vol: 0.3 }); S('stomp', { t: t + 0.32, vol: 0.18, rate: 1.4 }); },
    coins(n) { coins(now(), Math.min(16, n || 10), 0.6, 0.12); },
    lifeGain() { const t = now(); S('fizz', { t, vol: 0.26 }); S('bloom:' + music.chord, { t, vol: 0.18, vary: 0, send: 0.3 }); },
    lifeLose() { const t = now(); S('heart', { t, vol: 0.4 }); S('groanFar', { t: t + 0.1, vol: 0.14 }); },
    // Wheel of the Deep: the helm is let go, its pegs tick past the pointer, it settles on its slice
    wheelStart() { const t = now(); S('lever', { t, vol: 0.3 }); S('surge', { t: t + 0.05, vol: 0.2 }); },
    wheelTick() { S('tooth', { vol: 0.09 * tame('wtick', 0.03), rate: 0.9 }); },
    wheelStop() { const t = now(); duckFor(1.6, 0.5); S('drumLo', { t, vol: 0.5 }); S('stomp', { t, vol: 0.35 }); S('swell', { t: t + 0.05, vol: 0.3, vary: 0, send: 0.3 }); },
    // the dive picker and the buy menu
    cardPick() { S('dive', { vol: 0.35, send: 0.2 }); },
    sonar(depth) { S('plip', { vol: 0.06, rate: 0.6 + (depth || 0) * 0.1, vary: 0.05 }); },
    winch() { const t = now(); for (let k = 0, at = 0, gap = 0.05; k < 5; k++) { S('tooth', { t: t + at, vol: 0.12 + k * 0.02 }); at += gap; gap *= 0.82; } },
    plunge() { S('plunge', { vol: 0.5, send: 0.2 }); },
    jackpot(tier) {
      tier = Math.max(0, Math.min(2, tier || 0));
      const t = now();
      duckFor(2.6, 0.35);
      S('hullBoom', { t, vol: 0.4 });
      S(['wF', 'wG', 'wA'][tier], { t: t + 0.02, vol: 0.42, send: 0.35, vary: 0 });
      S('fizz', { t: t + 0.1, vol: 0.26 });
      coins(t + 0.1, 8 + tier * 4, 1, 0.12);
      if (tier === 2) S('conchToot', { t: t + 0.25, vol: 0.28, send: 0.45, vary: 0 });
    },
  };

  // ---------- anticipation: the hull strains and a drum beats faster and faster while the last reels spin
  let ant = null;
  function anticipationStart() {
    if (!ctx || ant) return;
    const t = now(), g = gainNode(0.45, sfxBus), dg = gainNode(0.0001, g);
    dg.gain.setValueAtTime(0.0001, t); dg.gain.exponentialRampToValueAtTime(0.4, t + 0.5);
    const drone = ctx.createBufferSource();
    drone.buffer = buf('strain'); drone.connect(dg); drone.start(t);
    const beats = [];
    for (let k = 0, at = 0.15, gap = 0.55; at < 7.5; k++) { beats.push(S('drumLo', { t: t + at, vol: 0.28 + Math.min(0.22, k * 0.02), dest: g })); at += gap * rnd(0.95, 1.05); gap = Math.max(0.22, gap * 0.9); }
    ant = { g, drone, beats };
  }
  function anticipationStop() {
    if (!ant) return;
    const t = now(), p = ant.g.gain;
    hold(p, t); p.setTargetAtTime(0.0001, t, 0.05);
    for (const s of [ant.drone].concat(ant.beats)) { try { s.stop(t + 0.3); } catch (e) { /* already stopped */ } }
    ant = null;
  }

  // ---------- the count-up: a trickle of coins at uneven intervals that thins out if it runs long, never a machine gun
  let count = null;
  function trickleAt(t, age, rate) {
    S('coin', { t, vol: 0.05 * Math.max(0.45, 1 - age / 10) * rnd(0.6, 1), lp: 7000, pan: rnd(-0.5, 0.5), vary: 0.06, cap: ['coin', 6] });
    return (rate || 70) / 1000 * rnd(1.3, 2.7);
  }
  function countStart(rate) {
    countStop();
    const c = count = { t0: now(), timer: 0 };
    const tick = () => {
      if (count !== c || !ctx) return;
      c.timer = setTimeout(tick, 1000 * trickleAt(now(), now() - c.t0, rate));
    };
    tick();
  }
  function countStop() { if (count) { clearTimeout(count.timer); count = null; } }

  // ---------- the sea: its low roar, a bubble now and then, and far off, the wreck settling
  function bed(t) {
    const b = ctx.createBuffer(2, len(6), SR);
    for (let c = 0; c < 2; c++) b.getChannelData(c).set(brown(len(6)));
    const src = ctx.createBufferSource(); src.buffer = b; src.loop = true;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 300; f.Q.value = 0.7;
    const lfo = ctx.createOscillator(), lg = gainNode(120);
    lfo.frequency.value = 0.06; lfo.connect(lg); lg.connect(f.frequency); lfo.start(t);
    src.connect(f); f.connect(gainNode(0.18, ambBus)); src.start(t);
  }
  const distant = t => S(Math.random() < 0.6 ? 'creakFar' : 'groanFar', { t, vol: rnd(0.05, 0.08), dest: ambBus, send: 0.8, pan: rnd(-0.7, 0.7), vary: 0.08 });
  const quietNow = () => !ctx || muted || !ambOn || hidden();
  function startAmbient() {
    bed(now());
    const bubbleLoop = () => {
      if (!quietNow()) {
        const n = 1 + Math.floor(Math.random() * 3), t = now();
        for (let i = 0; i < n; i++) S('plip', { t: t + i * rnd(0.06, 0.15), vol: rnd(0.015, 0.032), dest: ambBus, vary: 0.2, pan: rnd(-0.6, 0.6) });
      }
      setTimeout(bubbleLoop, 4000 + Math.random() * 7000);
    };
    setTimeout(bubbleLoop, 3000);
    const farLoop = () => { if (!quietNow()) distant(now()); setTimeout(farLoop, 30000 + Math.random() * 30000); };
    setTimeout(farLoop, 12000);
  }

  // ======================================================================= the music: the deep, and the kraken's reel
  // chord voicings, low to high; the sub-bass takes the root an octave down (kept above A1)
  const CH = {
    Dm: [50, 57, 62, 65], C: [48, 55, 60, 64], Bb: [46, 53, 58, 62], F: [41, 48, 53, 57], Gm: [43, 50, 55, 58], A: [45, 52, 57, 61],
  };
  const bassRoot = c => { const r = CH[c][0] - 12; return r < 33 ? r + 12 : r; };
  // the harmony note a third under m, walking down D minor (with C sharp over the A chord)
  function below3(m, chord) {
    const pcs = chord === 'A' ? [2, 4, 5, 7, 9, 10, 1] : [2, 4, 5, 7, 9, 10, 0];
    let x = m;
    for (let k = 0; k < 2;) { x--; if (pcs.indexOf(((x % 12) + 12) % 12) >= 0) k++; }
    return x;
  }
  // tunes as [bar, eighth, midi, length in eighths]
  const SONG_B = [   // the deep's song: long notes for the voice to slide between
    [0, 0, 69, 3], [0, 3, 74, 3], [1, 0, 77, 4], [1, 4, 76, 2], [2, 0, 76, 3], [2, 3, 72, 3], [3, 0, 67, 6],
    [4, 0, 74, 3], [4, 3, 77, 3], [5, 0, 72, 6], [6, 0, 70, 3], [6, 3, 74, 3], [7, 0, 73, 4], [7, 4, 69, 2],
  ];
  const SONG_C = [   // it lifts into the relative major
    [0, 0, 72, 2], [0, 2, 77, 4], [1, 0, 76, 3], [1, 3, 79, 3], [2, 0, 81, 6], [3, 0, 77, 3], [3, 3, 74, 3],
    [4, 0, 72, 2], [4, 2, 81, 4], [5, 0, 79, 3], [5, 3, 76, 3], [6, 0, 74, 3], [6, 3, 70, 3], [7, 0, 76, 3], [7, 3, 73, 3],
  ];
  const SONG_D = [   // and sinks: a slow line an octave down while the rest falls away
    [0, 0, 69, 3], [0, 3, 65, 3], [1, 0, 62, 6], [2, 0, 65, 3], [2, 3, 69, 3], [3, 0, 70, 6],
    [4, 0, 67, 3], [4, 3, 70, 3], [5, 0, 74, 6], [6, 0, 73, 3], [6, 3, 69, 3], [7, 0, 64, 3], [7, 3, 61, 3],
  ];
  const RIFF = [    // the kraken's reel
    [0, 0, 74, 1], [0, 1, 74, 1], [0, 2, 77, 1], [0, 3, 81, 1], [0, 4, 77, 1], [0, 5, 74, 1],
    [1, 0, 74, 1], [1, 1, 74, 1], [1, 2, 77, 1], [1, 3, 82, 1], [1, 4, 77, 1], [1, 5, 74, 1],
    [2, 0, 79, 1], [2, 1, 77, 1], [2, 2, 74, 1], [2, 3, 70, 1], [2, 4, 74, 1], [2, 5, 79, 1],
    [3, 0, 73, 1], [3, 1, 76, 1], [3, 2, 81, 2], [3, 4, 76, 1], [3, 5, 73, 1],
    [4, 0, 81, 1], [4, 1, 77, 1], [4, 2, 74, 1], [4, 3, 69, 1], [4, 4, 74, 1], [4, 5, 77, 1],
    [5, 0, 82, 1], [5, 1, 77, 1], [5, 2, 74, 1], [5, 3, 70, 1], [5, 4, 74, 1], [5, 5, 77, 1],
    [6, 0, 79, 2], [6, 2, 82, 1], [6, 3, 81, 1], [6, 4, 79, 1], [6, 5, 77, 1], [7, 0, 76, 2], [7, 2, 73, 1], [7, 3, 69, 3],
  ];
  const RIFF_B = [  // its middle eight
    [0, 0, 77, 3], [0, 3, 74, 2], [0, 5, 70, 1], [1, 0, 72, 3], [1, 3, 69, 2], [1, 5, 72, 1],
    [2, 0, 76, 3], [2, 3, 79, 2], [2, 5, 76, 1], [3, 0, 73, 3], [3, 3, 76, 3],
    [4, 0, 74, 2], [4, 2, 79, 1], [4, 3, 82, 3], [5, 0, 81, 2], [5, 2, 77, 1], [5, 3, 74, 3],
    [6, 0, 76, 1], [6, 1, 73, 1], [6, 2, 69, 1], [6, 3, 73, 1], [6, 4, 76, 1], [6, 5, 79, 1], [7, 0, 81, 3],
  ];
  // each section is 8 bars. waves: how hard the ocean drum washes through each bar; beat 0 none, 1 a deep muffled pulse,
  // 2 that pulse on both beats; harm: the tune sung again a third under; open: the pad opens wider; oct: the tune moved
  const SONGS = {
    base: {
      style: 'deep', eighth: 0.3,
      sections: [
        { chords: ['Dm', 'Dm', 'C', 'C', 'Bb', 'F', 'Gm', 'A'], waves: 0.16, beat: 0 },
        { chords: ['Dm', 'Dm', 'C', 'C', 'Bb', 'F', 'Gm', 'A'], mel: SONG_B, waves: 0.17, beat: 1 },
        { chords: ['F', 'C', 'Dm', 'Bb', 'F', 'C', 'Gm', 'A'], mel: SONG_C, harm: true, open: true, waves: 0.2, beat: 2 },
        { chords: ['Dm', 'Bb', 'Dm', 'Bb', 'Gm', 'Gm', 'A', 'A'], mel: SONG_D, oct: -12, waves: 0.13, beat: 0 },
      ],
    },
    bonus: {
      style: 'reel', eighth: 0.205,
      sections: [
        { chords: ['Dm', 'Bb', 'Gm', 'A', 'Dm', 'Bb', 'Gm', 'A'], mel: RIFF },
        { chords: ['Bb', 'F', 'C', 'A', 'Gm', 'Dm', 'A', 'A'], mel: RIFF_B },
      ],
    },
  };
  // Pearl Reef and the dive picker: the deep, held at its fuller level (the reef a touch quicker); the Vault and the
  // Wheel: the reel at an even pace, without the kraken's build
  SONGS.reef = Object.assign({}, SONGS.base, { eighth: 0.27, level: 1 });
  SONGS.select = Object.assign({}, SONGS.base, { level: 0 });
  SONGS.vault = Object.assign({}, SONGS.bonus, { eighth: 0.225, level: 1 });
  SONGS.wheel = Object.assign({}, SONGS.bonus, { level: 2 });

  const music = { on: false, theme: 'base', pending: null, step: 0, next: 0, timer: null, chord: 'Dm', force: null, lead: null, harm: null };
  // 0 when nobody has spun for a while (the music is at its calmest), 1 while someone is playing
  const baseLevel = () => music.force != null ? music.force : now() - mood.lastSpin < 25 ? 1 : 0;
  // 0 at the start of the bonus, rising as the rage meter fills and each time the kraken wakes, up to 3
  const bonusLevel = () => music.force != null ? music.force : Math.min(3, mood.wake + (mood.rage >= 2 ? 1 : 0));
  const LILT = [0, 0.012, 0.004, 0, 0.012, 0.004];       // a jig's lilt: the second and fifth eighths sit a little late
  // louder in the middle of each four-bar phrase, softer at its ends, never twice the same
  const phrase = (bar, e) => (0.85 + 0.2 * Math.sin(Math.PI * ((bar % 4) + e / 6) / 4)) * rnd(0.9, 1.08);
  // per context: the oscillator shapes (squeezebox reed, the voice's soft hollow tone, the pad, the sub) and a loop of
  // noise for breath
  const waves = new WeakMap();
  function ctxRes() {
    let r = waves.get(ctx);
    if (!r) {
      const wave = h => {
        const re = new Float32Array(h.length + 1), im = new Float32Array(h.length + 1);
        h.forEach((v, k) => { im[k + 1] = v; });
        return ctx.createPeriodicWave(re, im);
      };
      const air = ctx.createBuffer(1, len(2), SR);
      air.getChannelData(0).set(white(len(2)));
      const ok = !!ctx.createPeriodicWave;
      r = { reed: ok && wave(REED), soft: ok && wave([1, 0.5, 0.28, 0.14, 0.08, 0.04]), warm: ok && wave(WARM), sub: ok && wave([1, 0.35, 0.12, 0.05]), air };
      waves.set(ctx, r);
    }
    return r;
  }
  // an oscillator in a custom shape, or the nearest built-in one where custom shapes aren't available
  function setShape(o, wave, type) { if (wave && o.setPeriodicWave) o.setPeriodicWave(wave); else o.type = type; }
  function panTo(node, pan, dest) {
    if (pan && ctx.createStereoPanner) { const p = ctx.createStereoPanner(); p.pan.value = pan; node.connect(p); p.connect(dest); return p; }
    node.connect(dest);
    return node;
  }
  // the squeezebox: two reeds a few cents apart and each a little out of true, drifting as the bellows push; the bellows
  // ease each note in and let it sag, air hisses through the reeds, the wooden box colours it. o: att, rel, lp, pan, air
  function box(m, t, dur, vol, o) {
    o = o || {};
    const R = ctxRes(), f = mtof(m), att = o.att || rnd(0.03, 0.06), rel = o.rel || 0.09, end = t + dur;
    const body = ctx.createBiquadFilter(), lp = ctx.createBiquadFilter(), g = gainNode(0);
    body.type = 'peaking'; body.frequency.value = 1100; body.Q.value = 1; body.gain.value = 5;
    lp.type = 'lowpass'; lp.frequency.value = o.lp || 3800; lp.Q.value = 0.5;
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + att);
    g.gain.linearRampToValueAtTime(vol * rnd(0.78, 0.92), Math.max(t + att + 0.01, end - 0.02)); g.gain.linearRampToValueAtTime(0, end + rel);
    for (const c of [-1, 1]) {
      const osc = ctx.createOscillator(), d0 = c * rnd(5, 9) + rnd(-3, 3);
      setShape(osc, R.reed, 'sawtooth'); osc.frequency.value = f;
      osc.detune.setValueAtTime(d0, t); osc.detune.linearRampToValueAtTime(d0 + rnd(-4, 4), end + rel);
      osc.connect(body); osc.start(t); osc.stop(end + rel + 0.05);
    }
    if (o.air !== false) {
      const n = ctx.createBufferSource(), nf = ctx.createBiquadFilter(), ng = gainNode(0.018);
      n.buffer = R.air; n.loop = true; nf.type = 'bandpass'; nf.frequency.value = 2200; nf.Q.value = 0.8;
      n.connect(nf); nf.connect(ng); ng.connect(body); n.start(t, Math.random()); n.stop(end + rel + 0.05);
    }
    body.connect(lp); lp.connect(g);
    panTo(g, o.pan, musicIn);
  }
  // the deep's pad: three soft voices a few cents apart per note, under a filter that opens as the bar's wave comes in
  // and closes as it goes out
  function pad(m, t, dur, vol, open) {
    const R = ctxRes(), lp = ctx.createBiquadFilter(), g = gainNode(0);
    lp.type = 'lowpass'; lp.Q.value = 0.7;
    lp.frequency.setValueAtTime(450, t); lp.frequency.linearRampToValueAtTime(open ? 1900 : 1300, t + dur * 0.45); lp.frequency.linearRampToValueAtTime(500, t + dur);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + 0.7); g.gain.setValueAtTime(vol, t + dur - 0.6); g.gain.linearRampToValueAtTime(0, t + dur + 0.4);
    for (const c of [-8, 0, 8]) {
      const o = ctx.createOscillator();
      setShape(o, R.warm, 'sawtooth'); o.frequency.value = mtof(m); o.detune.value = c + rnd(-2, 2);
      o.connect(lp); o.start(t); o.stop(t + dur + 0.5);
    }
    lp.connect(g); g.connect(musicIn);
  }
  // the sub-bass: a round, deep tone, eased in for the slow sea and punched for the kraken's reel
  function sub(m, t, dur, vol, att) {
    const R = ctxRes(), o = ctx.createOscillator(), lp = ctx.createBiquadFilter(), g = gainNode(0);
    setShape(o, R.sub, 'triangle'); o.frequency.value = mtof(m);
    lp.type = 'lowpass'; lp.frequency.value = 420; lp.Q.value = 0.5;
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + att);
    g.gain.setValueAtTime(vol, t + Math.max(att, dur - 0.08)); g.gain.linearRampToValueAtTime(0, t + dur + 0.12);
    o.connect(lp); lp.connect(g); g.connect(musicIn); o.start(t); o.stop(t + dur + 0.15);
  }
  // the deep's voice, singing the tune like whale song: a soft hollow tone that slides from the last note this voice
  // sang, swells into each note, lets a slow vibrato in on the long ones and breathes, far back in the reverb
  function whale(m, t, dur, vol, pan, who) {
    const R = ctxRes(), f = mtof(m), from = music[who] != null ? mtof(music[who]) : f, end = t + dur, stop = end + 1;
    music[who] = m;
    const o = ctx.createOscillator(), vib = ctx.createOscillator(), vg = gainNode(0), g = gainNode(0);
    const body = ctx.createBiquadFilter(), lp = ctx.createBiquadFilter();
    setShape(o, R.soft, 'triangle');
    o.frequency.setValueAtTime(from, t); o.frequency.setTargetAtTime(f, t, rnd(0.04, 0.07));
    vib.frequency.value = rnd(4.2, 5.2); vib.connect(vg); vg.connect(o.detune);
    vg.gain.setValueAtTime(0, t);
    if (dur > 0.6) vg.gain.setTargetAtTime(rnd(10, 16), t + 0.3, 0.25);
    body.type = 'peaking'; body.frequency.value = 800; body.Q.value = 0.9; body.gain.value = 4;
    lp.type = 'lowpass'; lp.frequency.value = 2400; lp.Q.value = 0.5;
    g.gain.setValueAtTime(0, t); g.gain.setTargetAtTime(vol, t, 0.07);
    g.gain.setTargetAtTime(vol * 0.75, t + Math.max(0.2, dur * 0.6), 0.25); g.gain.setTargetAtTime(0, end, 0.12);
    o.connect(body); body.connect(lp); lp.connect(g);
    const n = ctx.createBufferSource(), nf = ctx.createBiquadFilter(), ng = gainNode(0.012);
    n.buffer = R.air; n.loop = true; nf.type = 'bandpass'; nf.frequency.value = 1300; nf.Q.value = 0.8;
    n.connect(nf); nf.connect(ng); ng.connect(lp);
    send(panTo(g, pan, musicIn), 0.3, true);
    o.start(t); vib.start(t); n.start(t, Math.random()); o.stop(stop); vib.stop(stop); n.stop(stop);
  }
  const hit = (name, t, vol, pan, lp) => S(name, { t, vol, dest: musicIn, vary: 0.02, pan, lp });

  function playStep(theme, step, t) {
    const song = SONGS[theme], E = song.eighth;
    if (step < 0) {               // the bonus's pick-up bar: a roll on the bodhran that builds into the first bar
      const e = step + 6;
      hit('drumHi', t + rnd(-0.004, 0.004), 0.05 + e * 0.025, rnd(-0.1, 0.1));
      if (e === 0 || e === 3) hit('drumLo', t, 0.2 + e * 0.02);
      if (e === 5) hit('drumHi', t + E / 2, 0.2);
      return;
    }
    const e = step % 6, barN = Math.floor(step / 6), secN = Math.floor(barN / 8);
    const sec = song.sections[secN % song.sections.length], bar = barN % 8, cycle = Math.floor(secN / song.sections.length);
    const chord = sec.chords[bar], v = CH[chord];
    if (e === 0) music.chord = chord;
    const h = x => t + LILT[e] * E / 0.3 + rnd(-x, x);    // a human hand: on the lilt, never exactly on the grid
    const tunes = sec.mel ? sec.mel.filter(n => n[0] === bar && n[1] === e) : [];
    if (song.style === 'deep') {
      const lvl = song.level != null ? song.level : baseLevel(), barLen = E * 6;
      if (e === 0) {
        hit('wave', t + rnd(-0.04, 0.04), sec.waves * rnd(0.85, 1.1) * (lvl ? 1 : 0.8), rnd(-0.35, 0.35));
        for (const m of v.slice(1)) pad(m, t, barLen + 0.3, 0.017, sec.open);
        sub(bassRoot(chord), t, barLen * 0.96, 0.045, 0.3);
      }
      if (lvl && sec.beat) {
        if (e === 0) hit('drumLo', h(0.004), 0.17 * rnd(0.9, 1.1), 0, 500);       // a deep, muffled pulse
        if (e === 3 && sec.beat >= 2) hit('drumLo', h(0.006), 0.1 * rnd(0.9, 1.1), 0, 500);
      }
      // the thirds move from the lift to the song the second time round
      const harm = sec.mel && !sec.oct && (cycle % 2 ? !sec.harm : sec.harm);
      for (const n of tunes) {
        const d = n[3] * E, vel = phrase(bar, e), at = h(0.015), m = n[2] + (sec.oct || 0);
        whale(m, at, d, 0.1 * vel, 0.15, 'lead');
        if (harm) whale(below3(n[2], chord), at + rnd(0.01, 0.03), d, 0.06 * vel, -0.2, 'harm');
      }
    } else {
      const lvl = song.level != null ? song.level : bonusLevel(), br = bassRoot(chord);
      // the engine: the sub-bass driving the eighths and the bodhran's jig, accented harder from level 1
      if (lvl >= 1 || e === 0 || e === 2 || e === 3 || e === 5) sub(br, h(0.003), E * 0.8, (e === 0 ? 0.08 : e === 3 ? 0.065 : 0.035) * rnd(0.9, 1.1), 0.006);
      if (e === 0 || e === 3) hit('drumLo', h(0.004), (e === 0 ? 0.28 : 0.22) * rnd(0.9, 1.1));
      else hit('drumHi', h(0.007), (lvl >= 1 ? (e === 2 || e === 5 ? 0.08 : 0.05) : 0.035) * rnd(0.8, 1.15), 0.1);
      if (lvl >= 2 && e === 0 && bar % 2 === 0) { hit('warDrum', h(0.003), 0.24); hit('wave', t, 0.12, rnd(-0.3, 0.3)); }
      if (lvl >= 2 && e === 3) hit('clap', h(0.008), 0.11);
      if (lvl >= 3 && (e === 0 || e === 3)) hit('stomp', h(0.004), 0.2);
      if (lvl >= 2 && e === 0) for (const m of v.slice(1)) pad(m, t, E * 6 + 0.2, 0.007, true);
      // the tune on the squeezebox, short and punchy; doubled an octave under from level 1, in thirds at level 3
      for (const n of tunes) {
        const d = n[3] * E, vel = phrase(bar, e), at = h(0.006);
        box(n[2], at, d * 0.82, 0.05 * vel, { pan: 0.12, att: 0.012, rel: 0.05 });
        if (lvl >= 1) box(n[2] - 12, at + rnd(0, 0.006), d * 0.85, 0.022 * vel, { pan: 0.28, att: 0.015, rel: 0.05, lp: 2400 });
        if (lvl >= 3) box(below3(n[2], chord), at + rnd(0, 0.006), d * 0.82, 0.017 * vel, { pan: -0.2, att: 0.012, rel: 0.05 });
      }
    }
  }

  function schedule() {
    if (!ctx) return;
    while (music.next < ctx.currentTime + 0.18) {
      if (music.pending && music.step % 6 === 0) {
        const th = music.pending;
        music.theme = th; music.pending = null;
        music.step = SONGS[th].style === 'reel' ? -6 : 0;
        if (th === 'bonus') { mood.rage = 0; mood.wake = 0; }
      }
      playStep(music.theme, music.step, music.next);
      music.next += SONGS[music.theme].eighth;
      music.step++;
    }
    // a minute with nobody spinning and the band drops right back
    const idle = music.theme === 'base' && ctx.currentTime - mood.lastSpin > 60;
    if (idle !== music.idle) { music.idle = idle; idleGain.gain.setTargetAtTime(idle ? 0.55 : 1, ctx.currentTime, 1.5); }
  }
  function startMusic(theme) {
    if (!ctx || !SONGS[theme]) return;
    if (!music.on) {
      music.on = true; music.theme = theme; music.step = SONGS[theme].style === 'reel' ? -6 : 0; music.next = ctx.currentTime + 0.12;
      const p = musicFade.gain, t = ctx.currentTime;    // the band fades in rather than starting at full tilt
      hold(p, t); p.setValueAtTime(0, t); p.linearRampToValueAtTime(1, t + 2.5);
      music.timer = setInterval(schedule, 30);
    } else if (theme !== music.theme) music.pending = theme;
  }
  function stopMusic() { if (music.timer) clearInterval(music.timer); music.on = false; music.timer = null; music.pending = null; }
  function duck(on) {
    ducked = !!on;
    if (ctx) fadeGain(musicBus, musicGain(), 0.4);
  }

  function setMuted(m) {
    muted = !!m;
    try { localStorage.setItem('ss_muted', muted ? '1' : '0'); } catch (e) { /* ignore */ }
    if (ctx) fadeGain(master, muted ? 0 : 0.9, 0.05);
  }
  function setMusicMuted(m) {
    musicMuted = !!m;
    try { localStorage.setItem('ss_music', musicMuted ? '0' : '1'); } catch (e) { /* ignore */ }
    if (ctx) { fadeGain(musicBus, musicGain(), 0.1); ambTrim.gain.setTargetAtTime(ambTarget(), now(), 0.5); }
  }
  function setEffectsVolume(v) {
    effectsVolume = volume(v, effectsVolume);
    try { localStorage.setItem('ss_effectsVolume', String(effectsVolume)); } catch (e) { /* ignore */ }
    if (ctx) { fadeGain(sfxBus, 0.85 * effectsVolume, 0.05); fadeGain(ambBus, AMB_VOL * effectsVolume, 0.05); }
    return effectsVolume;
  }
  function setMusicVolume(v) {
    musicVolume = volume(v, musicVolume);
    try { localStorage.setItem('ss_musicVolume', String(musicVolume)); } catch (e) { /* ignore */ }
    if (ctx) fadeGain(musicBus, musicGain(), 0.05);
    return musicVolume;
  }
  function setAmbience(on) { ambOn = on; if (ctx) ambTrim.gain.setTargetAtTime(ambTarget(), now(), 0.1); }

  function play(name, ...args) {
    if (!ctx || muted || hidden()) return;
    const f = fx[name];
    if (f) { try { f(...args); } catch (e) { console.warn('sfx', name, e); } }
  }

  // ======================================================================= scenes and offline renders, for the sound board
  // moments from the game laid out as they happen, to judge the mix: [seconds, effect, argument]
  const SCENES = {
    spin: [[0, 'spin'], [0.55, 'reelStop', 0], [0.75, 'reelStop', 1], [0.95, 'reelStop', 2], [0.95, 'wildLand'], [1.15, 'reelStop', 3], [1.35, 'reelStop', 4], [1.6, 'winSmall'], [1.6, 'count', 0.7]],
    pearls: [[0, 'spin'], [0.55, 'reelStop', 0], [0.55, 'scatterLand', 0], [0.75, 'reelStop', 1], [0.95, 'reelStop', 2], [0.95, 'scatterLand', 1], [0.95, 'antStart'],
      [2.4, 'reelStop', 3], [3.9, 'antStop'], [3.9, 'reelStop', 4], [3.9, 'scatterLand', 2], [4.6, 'bonusTrigger'], [7.4, 'transition'], [7.5, 'ink']],
    bigwin: [[0, 'duck', true], [0, 'bigWin', 0], [0, 'count', 6.4], [2.2, 'tierUp'], [2.2, 'bigWin', 1], [4.4, 'tierUp'], [4.4, 'bigWin', 2], [6.4, 'bigWinEnd', 2], [9, 'duck', false]],
    attack: [[0, 'squadAlarm'], [1.15, 'whoosh'], [1.47, 'whoosh'], [1.79, 'whoosh'], [1.77, 'ink'], [1.77, 'wildLand'], [2.09, 'ink'], [2.09, 'wildLand'], [2.41, 'ink'], [2.41, 'wildLand']],
  };
  function cue(t, what, arg) {
    tAt = t;
    if (what === 'count') { for (let s = 0; s < arg;) s += trickleAt(t + s, s, 55); }
    else if (what === 'duck') duck(arg);
    else if (what === 'antStart') anticipationStart();
    else if (what === 'antStop') anticipationStop();
    else fx[what](arg);
  }
  function scene(name, t0) {
    try { for (const [at, what, arg] of SCENES[name]) cue(t0 + at, what, arg); } finally { tAt = null; }
  }
  // every sound: [name, args, seconds, label, group]
  const SOUNDS = [
    ['click', [], 0.4, 'Button', 'Interface'], ['bet', [true], 0.5, 'Bet up', 'Interface'], ['bet', [false], 0.5, 'Bet down', 'Interface'],
    ['denied', [], 0.6, 'Not allowed', 'Interface'], ['swoosh', [], 1.2, 'Bonus-buy hatch opens', 'Interface'],
    ['anteOn', [], 1.2, 'Triple Chance / Bonus Hunt on', 'Interface'], ['anteOff', [], 0.9, 'Triple Chance / Bonus Hunt off', 'Interface'],
    ['spin', [], 0.8, 'Spin', 'Reels'], ['reelStop', [2], 0.6, 'Reel stops', 'Reels'], ['wildLand', [], 0.8, 'Squid lands', 'Reels'],
    ['scatterLand', [0], 1.6, 'First pearl', 'Reels'], ['scatterLand', [1], 1.6, 'Second pearl', 'Reels'], ['scatterLand', [2], 1.8, 'Third pearl', 'Reels'],
    ['scatterLand', [3], 1.9, 'Fourth pearl', 'Reels'], ['scatterLand', [4], 2, 'Fifth pearl', 'Reels'], ['anticipation', [], 5, 'Waiting on the last reel', 'Reels'],
    ['winSmall', [], 1.2, 'Small win', 'Wins'], ['winMed', [], 1.6, 'Medium win', 'Wins'], ['count', [], 3, 'Win counting up', 'Wins'],
    ['bigWin', [0], 2.6, 'Big win', 'Wins'], ['bigWin', [1], 2.6, 'Mega win', 'Wins'], ['bigWin', [2], 3, 'Epic win', 'Wins'], ['bigWinEnd', [2], 3.4, 'Win counted out', 'Wins'],
    ['bonusTrigger', [], 2.6, 'Bonus triggered', 'Bonus'], ['transition', [], 2.6, 'Ink transition', 'Bonus'], ['ink', [], 1.4, 'Ink burst', 'Bonus'],
    ['fsStart', [], 2.6, 'Free spins begin', 'Bonus'], ['retrigger', [], 2, 'Extra spins', 'Bonus'], ['sticky', [], 0.8, 'Squid sticks', 'Bonus'],
    ['mult', [], 0.9, 'Multiplier stamped', 'Bonus'], ['multUp', [], 0.6, 'Multiplier goes up', 'Bonus'], ['rage', [], 1, 'Rage meter fills', 'Bonus'],
    ['awaken', [], 4, 'The kraken wakes', 'Bonus'], ['squadAlarm', [], 2.2, 'Squid Squad attack', 'Squid Squad'], ['whoosh', [], 1, 'Tentacle swipe', 'Squid Squad'],
    ['scene:spin', [], 3.4, 'A spin with a small win', 'In the game, with the music'], ['scene:pearls', [], 10, 'Three pearls into the bonus', 'In the game, with the music'],
    ['scene:bigwin', [], 10.5, 'An epic win, start to finish', 'In the game, with the music'], ['scene:attack', [], 4, 'A Squid Squad attack', 'In the game, with the music'],
    ['ambience', [], 14, 'The sea on its own', 'Music'], ['music:base', [0], 20, 'Base game music, idle', 'Music'], ['music:base', [1], 58, 'Base game music, playing (one full round)', 'Music'],
    ['music:bonus', [0], 20, 'Bonus music, at the start', 'Music'], ['music:bonus', [3], 20, 'Bonus music, kraken awake', 'Music'],
  ];
  function render(name, args, sec) {
    const Off = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    const rate = ctx ? ctx.sampleRate : 48000, off = new Off(2, Math.ceil(sec * rate), rate);
    const keep = { ctx, master, sfxBus, musicBus, ambBus, revIn, musicIn, musicRevIn, mDuck, aDuck, ambTrim, musicFade, idleGain, ant, duckUntil, duckDepth };
    const keepMusic = { chord: music.chord, force: music.force }, keepMood = Object.assign({}, mood), keepLast = Object.assign({}, last);
    for (const k in last) delete last[k];
    // the band, and a scene's cues woven in as the music reaches them (so a win hears the chord that's playing)
    const band = (th, lvl, from, cues) => {
      music.force = lvl;
      cues = (cues || []).slice().sort((a, b) => a[0] - b[0]);
      for (let s = th === 'bonus' ? -6 : 0, t = from; t < sec - 1; s++, t += SONGS[th].eighth) {
        while (cues.length && cues[0][0] < t) { const [at, what, arg] = cues.shift(); cue(at, what, arg); }
        tAt = t; playStep(th, s, t);
      }
      music.force = null;
    };
    try {
      offline = true;
      build(off);
      master.gain.value = 0.9; sfxBus.gain.value = 0.85; musicBus.gain.value = MUSIC_VOL; ambBus.gain.value = AMB_VOL; ambTrim.gain.value = AMB_TRIM; ant = null; duckUntil = 0; duckDepth = 1;
      tAt = 0.03;
      if (name.indexOf('music:') === 0) band(name.slice(6), args[0] || 0, 0.03);
      else if (name.indexOf('scene:') === 0) { bed(0); band('base', 1, 0.03, SCENES[name.slice(6)].map(([at, w, a]) => [at + 1.2, w, a])); }
      else if (name === 'count') { for (let s = 0; s < sec - 0.4;) s += trickleAt(0.03 + s, s, 55); }
      else if (name === 'anticipation') { anticipationStart(); tAt = sec - 0.6; anticipationStop(); }
      else if (name === 'ambience') {
        bed(0);
        for (let t = 0.5; t < sec - 1; t += rnd(4, 11)) for (let i = 0, n = 1 + Math.floor(Math.random() * 3); i < n; i++) S('plip', { t: t + i * 0.09, vol: rnd(0.015, 0.032), dest: ambBus, vary: 0.2, pan: rnd(-0.6, 0.6) });
        distant(2); distant(Math.max(3, sec - 5));
      } else fx[name].apply(null, args || []);
    } finally {
      tAt = null; offline = false;
      ({ ctx, master, sfxBus, musicBus, ambBus, revIn, musicIn, musicRevIn, mDuck, aDuck, ambTrim, musicFade, idleGain, ant, duckUntil, duckDepth } = keep);
      Object.assign(music, keepMusic); Object.assign(mood, keepMood);
      for (const k in last) delete last[k];
      Object.assign(last, keepLast);
    }
    // the reverb can still be ringing where the file ends: fade the last 80 ms so it doesn't end on a click
    return off.startRendering().then(b => {
      const k = Math.min(b.length, Math.round(0.08 * rate));
      for (let c = 0; c < b.numberOfChannels; c++) { const d = b.getChannelData(c); for (let i = 0; i < k; i++) d[b.length - 1 - i] *= i / k; }
      return b;
    });
  }
  // 16-bit PCM WAV of an AudioBuffer
  function wav(b) {
    const ch = b.numberOfChannels, n = b.length, dv = new DataView(new ArrayBuffer(44 + n * ch * 2));
    const str = (o, s) => { for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)); };
    str(0, 'RIFF'); dv.setUint32(4, 36 + n * ch * 2, true); str(8, 'WAVE'); str(12, 'fmt ');
    dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, ch, true); dv.setUint32(24, b.sampleRate, true);
    dv.setUint32(28, b.sampleRate * ch * 2, true); dv.setUint16(32, ch * 2, true); dv.setUint16(34, 16, true);
    str(36, 'data'); dv.setUint32(40, n * ch * 2, true);
    const data = [];
    for (let c = 0; c < ch; c++) data.push(b.getChannelData(c));
    for (let i = 0, o = 44; i < n; i++) for (let c = 0; c < ch; c++, o += 2) dv.setInt16(o, Math.max(-1, Math.min(1, data[c][i])) * 32767, true);
    return new Blob([dv.buffer], { type: 'audio/wav' });
  }

  // start making the sounds while the loading screen is up (nothing here needs the audio context, which only a tap can
  // start), so pressing Play doesn't wait on any of them
  if (!muted && hasDoc) {
    if (document.readyState === 'complete') setTimeout(warm, 800);
    else window.addEventListener('load', () => setTimeout(warm, 800));
  }

  window.SFX = {
    init, resume, play, startMusic, stopMusic, duck, setMuted, setMusicMuted, setEffectsVolume, setMusicVolume, setAmbience,
    isMuted: () => muted, isMusicMuted: () => musicMuted, getEffectsVolume: () => effectsVolume, getMusicVolume: () => musicVolume,
    anticipationStart: () => { if (ctx && !muted) anticipationStart(); }, anticipationStop,
    countStart: r => { if (ctx && !muted) countStart(r); }, countStop,
    // for the sound board: a scene played live, the band held at a level (null hands it back to the game), renders
    scene: name => { if (ctx && !muted) scene(name, ctx.currentTime + 0.05); },
    musicLevel: v => { music.force = v; },
    sounds: SOUNDS, render, wav,
  };
})();
