const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../frontend/js/audio.js'), 'utf8');

function harness(saved = {}, options = {}) {
  const storage = new Map(Object.entries(saved)), nodes = [], contexts = [], timers = [];
  function parameter(value = 0) {
    const p = { value, events: [] };
    for (const method of ['setValueAtTime', 'linearRampToValueAtTime', 'exponentialRampToValueAtTime', 'setTargetAtTime']) {
      p[method] = (...args) => { p.value = args[0]; p.events.push([method, ...args]); };
    }
    p.cancelScheduledValues = time => p.events.push(['cancelScheduledValues', time]);
    if (!options.legacy) p.cancelAndHoldAtTime = time => p.events.push(['cancelAndHoldAtTime', time]);
    return p;
  }
  function node(kind, fields = {}) {
    const value = { kind, connections: [], connect(dest) { this.connections.push(dest); return dest; }, start() {}, stop() {}, ...fields };
    nodes.push(value);
    return value;
  }
  class AudioContext {
    constructor() { this.currentTime = 5; this.sampleRate = 40; this.state = 'suspended'; this.destination = node('destination'); contexts.push(this); }
    createGain() { return node('gain', { gain: parameter(1) }); }
    createDynamicsCompressor() { return node('compressor', Object.fromEntries(['threshold', 'knee', 'ratio', 'attack', 'release'].map(key => [key, parameter()]))); }
    createConvolver() { return node('convolver'); }
    createBiquadFilter() { return node('filter', { frequency: parameter(), Q: parameter() }); }
    createOscillator() { return node('oscillator', { frequency: parameter(), detune: parameter() }); }
    createBufferSource() { return node('source'); }
    createBuffer(channels, length) { const data = Array.from({ length: channels }, () => new Float32Array(Math.ceil(length))); return { getChannelData: channel => data[channel] }; }
    resume() { this.state = 'running'; return Promise.resolve(); }
  }
  const window = options.noAudio ? {} : { AudioContext };
  const localStorage = {
    getItem(key) { if (options.blockedStorage) throw new Error('unavailable'); return storage.get(key) ?? null; },
    setItem(key, value) { if (options.blockedStorage) throw new Error('unavailable'); storage.set(key, String(value)); }
  };
  vm.runInNewContext(source, {
    window, localStorage, console,
    setTimeout(fn, delay) { timers.push({ fn, delay, type: 'timeout' }); return timers.length; },
    setInterval(fn, delay) { timers.push({ fn, delay, type: 'interval' }); return timers.length; },
    clearInterval() {}
  });
  return { audio: window.SFX, storage, nodes, contexts, timers, buses: () => nodes.filter(item => item.kind === 'gain').slice(0, 4) };
}

function near(actual, expected) { assert.ok(Math.abs(actual - expected) < 1e-12, `${actual} differs from ${expected}`); }

function pathGain(node, destination) {
  if (node === destination) return 1;
  return (node.gain ? node.gain.value : 1) * (node.connections || []).reduce((sum, next) => sum + pathGain(next, destination), 0);
}

test('volume defaults retain the existing audio levels without initializing playback', () => {
  const h = harness();
  assert.equal(h.contexts.length, 0);
  assert.equal(h.audio.getEffectsVolume(), 1);
  assert.equal(h.audio.getMusicVolume(), 1);
  h.audio.init();
  const [master, effects, music, ambient] = h.buses();
  near(master.gain.value, 0.9); near(effects.gain.value, 0.85); near(music.gain.value, 0.34); near(ambient.gain.value, 0.55);
  h.audio.init();
  assert.equal(h.contexts.length, 1);
});

test('saved volume and mute preferences restore independently', () => {
  const h = harness({ ss_effectsVolume: '0.24', ss_musicVolume: '0.61', ss_muted: '1', ss_music: '0' });
  h.audio.init();
  const [master, effects, music, ambient] = h.buses();
  assert.equal(master.gain.value, 0); assert.equal(music.gain.value, 0);
  near(effects.gain.value, 0.85 * 0.24); near(ambient.gain.value, 0.55 * 0.24);
  h.audio.setMuted(false); h.audio.setMusicMuted(false);
  near(master.gain.value, 0.9); near(music.gain.value, 0.34 * 0.61);
  assert.equal(h.audio.getEffectsVolume(), 0.24); assert.equal(h.audio.getMusicVolume(), 0.61);
  const reload = harness(Object.fromEntries(h.storage));
  assert.equal(reload.audio.isMuted(), false); assert.equal(reload.audio.isMusicMuted(), false);
  assert.equal(reload.audio.getEffectsVolume(), 0.24); assert.equal(reload.audio.getMusicVolume(), 0.61);
});

for (const [method, getter, key] of [['setEffectsVolume', 'getEffectsVolume', 'ss_effectsVolume'], ['setMusicVolume', 'getMusicVolume', 'ss_musicVolume']]) {
  test(method + ' clamps finite values and preserves the previous setting for invalid values', () => {
    const h = harness();
    assert.equal(h.audio[method](-10), 0);
    assert.equal(h.audio[method](10), 1);
    assert.equal(h.audio[method]('0.37'), 0.37);
    for (const invalid of [NaN, Infinity, -Infinity, 'invalid', undefined]) assert.equal(h.audio[method](invalid), 0.37);
    assert.equal(h.audio[getter](), 0.37); assert.equal(h.storage.get(key), '0.37');
    assert.equal(h.contexts.length, 0);
    const reload = harness(Object.fromEntries(h.storage));
    assert.equal(reload.audio[getter](), 0.37);
  });
}

for (const [saved, expected] of [['', 1], ['invalid', 1], ['Infinity', 1], ['-3', 0], ['4', 1], ['0', 0]]) {
  test('stored volume ' + JSON.stringify(saved) + ' is normalized safely', () => {
    const h = harness({ ss_effectsVolume: saved, ss_musicVolume: saved });
    assert.equal(h.audio.getEffectsVolume(), expected); assert.equal(h.audio.getMusicVolume(), expected);
  });
}

test('adjusting volume never clears either mute setting', () => {
  const h = harness();
  h.audio.init();
  h.audio.setMuted(true); h.audio.setMusicMuted(true);
  h.audio.setEffectsVolume(0.45); h.audio.setMusicVolume(0.28);
  assert.equal(h.audio.isMuted(), true); assert.equal(h.audio.isMusicMuted(), true);
  const [master, effects, music] = h.buses();
  assert.equal(master.gain.value, 0); assert.equal(music.gain.value, 0);
  h.audio.setMuted(false);
  near(master.gain.value, 0.9); near(effects.gain.value, 0.85 * 0.45); assert.equal(music.gain.value, 0);
  h.audio.setMusicMuted(false);
  near(music.gain.value, 0.34 * 0.28);
});

test('music adjustments preserve ducking through mute and unmute', () => {
  const h = harness();
  h.audio.init();
  const music = h.buses()[2];
  h.audio.duck(true); h.audio.setMusicVolume(0.4);
  near(music.gain.value, 0.34 * 0.4 * 0.3);
  h.audio.setMusicMuted(true); assert.equal(music.gain.value, 0);
  h.audio.setMusicVolume(0.7); assert.equal(music.gain.value, 0);
  h.audio.setMusicMuted(false); near(music.gain.value, 0.34 * 0.7 * 0.3);
  h.audio.duck(false); near(music.gain.value, 0.34 * 0.7);
});

test('volume and duck settings applied before audio initialization take effect immediately', () => {
  const h = harness();
  h.audio.setEffectsVolume(0); h.audio.setMusicVolume(0.25); h.audio.duck(true); h.audio.init();
  const [, effects, music, ambient] = h.buses();
  assert.equal(effects.gain.value, 0); assert.equal(ambient.gain.value, 0);
  near(music.gain.value, 0.34 * 0.25 * 0.3);
});

test('effects and music reverb stay behind their own volume controls', () => {
  const h = harness();
  h.audio.init();
  const [, effects, music] = h.buses(), destination = h.contexts[0].destination;
  const [effectsReverb, musicReverb] = h.nodes.filter(node => node.kind === 'convolver');
  assert.equal(effectsReverb.connections[0].connections[0], effects);
  assert.equal(musicReverb.connections[0].connections[0], music);
  assert.equal(effectsReverb.buffer, musicReverb.buffer);
  near(pathGain(effectsReverb, destination), 0.55 * 0.9);
  near(pathGain(musicReverb, destination), 0.55 * 0.9);
  h.audio.setEffectsVolume(0);
  assert.equal(pathGain(effectsReverb, destination), 0);
  assert.ok(pathGain(musicReverb, destination) > 0);
  h.audio.setEffectsVolume(0.4); h.audio.setMusicVolume(0);
  assert.ok(pathGain(effectsReverb, destination) > 0);
  assert.equal(pathGain(musicReverb, destination), 0);
  h.audio.setMusicVolume(0.5); h.audio.setMusicMuted(true);
  assert.equal(pathGain(musicReverb, destination), 0);
  h.audio.setMuted(true);
  assert.equal(pathGain(effectsReverb, destination), 0);
});

test('all scheduled music voices are silent at zero music volume including their reverb', () => {
  const h = harness();
  h.audio.init(); h.audio.setMusicVolume(0); h.audio.startMusic('reef');
  const offset = h.nodes.length;
  h.timers.find(timer => timer.type === 'interval').fn();
  const voices = h.nodes.slice(offset).filter(node => node.kind === 'oscillator' || node.kind === 'source');
  assert.ok(voices.length > 0);
  for (const voice of voices) assert.equal(pathGain(voice, h.contexts[0].destination), 0);
  h.audio.setMusicVolume(0.5);
  assert.ok(voices.some(voice => pathGain(voice, h.contexts[0].destination) > 0));
});

test('effects and underwater ambiance are silent at zero effects volume', () => {
  const h = harness();
  h.audio.init(); h.audio.setEffectsVolume(0);
  const offset = h.nodes.length;
  h.audio.play('scatterLand', 1);
  const voices = h.nodes.slice(offset).filter(node => node.kind === 'oscillator' || node.kind === 'source');
  assert.ok(voices.length > 0);
  for (const voice of voices) assert.equal(pathGain(voice, h.contexts[0].destination), 0);
  assert.equal(pathGain(h.nodes.find(node => node.kind === 'source'), h.contexts[0].destination), 0);
  near(h.buses()[2].gain.value, 0.34);
});

for (const legacy of [false, true]) {
  test('rapid volume changes replace pending ramps with a short smooth transition ' + (legacy ? 'with fallback' : 'using hold'), () => {
    const h = harness({}, { legacy });
    h.audio.init(); h.audio.setMusicVolume(0.2); h.audio.setMusicVolume(0.8); h.audio.setMusicVolume(0.3);
    const events = h.buses()[2].gain.events;
    const final = events.at(-1);
    assert.equal(final[0], 'linearRampToValueAtTime'); near(final[1], 0.34 * 0.3); near(final[2], 5.05);
    assert.equal(events.filter(event => event[0] === (legacy ? 'cancelScheduledValues' : 'cancelAndHoldAtTime')).length, 3);
  });
}

test('unavailable browser storage and audio do not prevent volume controls from updating', () => {
  const h = harness({}, { blockedStorage: true, noAudio: true });
  h.audio.init(); h.audio.resume(); h.audio.duck(true);
  h.audio.setMuted(true); h.audio.setMusicMuted(true);
  assert.equal(h.audio.setEffectsVolume(0.2), 0.2); assert.equal(h.audio.setMusicVolume(0.3), 0.3);
  assert.equal(h.audio.isMuted(), true); assert.equal(h.audio.isMusicMuted(), true);
});
