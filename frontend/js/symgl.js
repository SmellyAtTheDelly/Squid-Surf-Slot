/* Squid Squad — WebGL symbol animator.
   Each symbol is drawn on a fine mesh whose vertices are bent per symbol type, so the artwork itself moves:
   the squid rises, sways, curls its tentacles and winks; the clam breathes open and the pearl shimmers;
   coins tilt in perspective; the anchor flexes on its swing; letters wobble. Gleams and glints are masked
   to the art itself (never the glow/shadow halo). Art sits in the middle 80% of each texture. */
(function () {
  'use strict';
  const GRID = 24;

  const VS = `
attribute vec2 a_uv;
uniform vec2 u_res;
uniform mat3 u_m;
uniform vec2 u_size;
uniform float u_type, u_t, u_k, u_persp;
varying vec2 v_uv;

vec2 deform(vec2 uv) {
  vec2 a = (uv - 0.1) / 0.8;
  vec2 o = vec2(0.0);
  float t = u_t, k = u_k;
  if (u_type < 3.5) {                       // letters: jelly wobble, each letter its own rhythm
    float s = u_type * 1.7;
    o.x += 0.022 * k * sin(t * 4.6 + a.y * 6.5 + s);
    o.y += 0.014 * k * sin(t * 3.8 + a.x * 5.0 + s * 1.3);
  } else if (u_type < 5.5) {                // coins: keystone perspective while tilting
    o.y += (a.y - 0.5) * (a.x - 0.5) * u_persp;
  } else if (u_type < 6.5) {                // anchor: shank flexes behind the swing, rope sways
    o.x += 0.035 * k * sin(t * 2.6 - 0.9) * a.y * a.y;
    float rope = smoothstep(0.38, 0.45, a.x) * smoothstep(0.66, 0.58, a.x) * smoothstep(0.35, 0.45, a.y);
    o.x += rope * 0.009 * k * sin(t * 7.0 + a.y * 22.0);
  } else if (u_type < 7.5) {                // squid wild
    float head = smoothstep(0.62, 0.44, a.y) * smoothstep(0.30, 0.40, a.x) * smoothstep(0.80, 0.70, a.x);
    float rise = 0.5 + 0.5 * sin(t * 2.8);
    float up = clamp(1.0 - a.y / 0.62, 0.0, 1.0);
    o.y -= head * k * 0.05 * rise * up;
    o.x += head * k * 0.02 * sin(t * 1.4) * up;
    float band = smoothstep(0.30, 0.40, a.y) * smoothstep(0.64, 0.55, a.y);
    float tl = band * smoothstep(0.45, 0.33, a.x);
    float tr = band * smoothstep(0.57, 0.68, a.x);
    o.y += tl * k * 0.045 * sin(t * 4.2 + a.x * 16.0) * clamp((0.45 - a.x) / 0.2, 0.0, 1.0);
    o.x -= tl * k * 0.02 * sin(t * 4.2 + a.y * 9.0);
    o.y += tr * k * 0.045 * sin(t * 4.2 + 1.7 - a.x * 16.0) * clamp((a.x - 0.57) / 0.28, 0.0, 1.0);
    o.x += tr * k * 0.02 * sin(t * 4.2 + 2.1 + a.y * 9.0);
    float lid = smoothstep(0.36, 0.26, a.x) * smoothstep(0.62, 0.5, a.y);
    o.x -= lid * k * 0.018 * (0.5 + 0.5 * sin(t * 1.3)) * clamp((0.36 - a.x) / 0.26, 0.0, 1.0);
  } else {                                  // pearl clam: top shell lifts, pearl floats
    vec2 pc = vec2(0.484, 0.527);
    float pearl = 1.0 - smoothstep(0.17, 0.25, distance(a, pc));
    float top = smoothstep(0.56, 0.46, a.y);
    float open = 0.5 + 0.5 * sin(t * 1.9);
    o.y -= top * (1.0 - pearl) * k * 0.065 * open * clamp((0.56 - a.y) / 0.5, 0.0, 1.0);
    o.y -= pearl * k * 0.014 * sin(t * 2.4);
  }
  return o * 0.8;
}

void main() {
  vec2 d = u_type >= 0.0 ? deform(a_uv) : vec2(0.0);
  vec2 p = (a_uv + d - 0.5) * u_size;
  vec3 q = u_m * vec3(p, 1.0);
  vec2 c = q.xy / u_res * 2.0 - 1.0;
  gl_Position = vec4(c.x, -c.y, 0.0, 1.0);
  v_uv = a_uv;
}`;

  const FS = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform sampler2D u_tex, u_mask;
uniform float u_type, u_t, u_alpha, u_shine, u_blink, u_bright, u_spark;
varying vec2 v_uv;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
vec3 hueRot(vec3 c, float ang) {
  const vec3 kk = vec3(0.57735);
  float ca = cos(ang);
  return c * ca + cross(kk, c) * sin(ang) + kk * dot(kk, c) * (1.0 - ca);
}

void main() {
  vec4 c = texture2D(u_tex, v_uv);
  if (u_type < 0.0) { gl_FragColor = c * u_alpha; return; }
  float m = texture2D(u_mask, v_uv).a;
  vec2 a = (v_uv - 0.1) / 0.8;

  // the squid winks: an eyelid sweeps over its open eye
  if (u_type > 6.5 && u_type < 7.5 && u_blink > 0.0) {
    vec2 q = (a - vec2(0.513, 0.322)) / vec2(0.06, 0.072);
    float r2 = dot(q, q);
    if (r2 < 1.0) {
      float lid = -1.0 + 2.2 * u_blink;
      float edge = q.y - lid + 0.3 * q.x * q.x;
      if (edge < 0.0) {
        vec4 skin = texture2D(u_tex, vec2(0.42, 0.37) * 0.8 + 0.1);
        skin.rgb *= 1.0 - 0.4 * smoothstep(-0.45, 0.0, edge);
        c = mix(c, skin, smoothstep(1.0, 0.82, r2));
      }
    }
  }

  // the pearl shimmers through iridescent colours with a travelling highlight
  if (u_type > 7.5) {
    vec2 pc = vec2(0.484, 0.527);
    float d = distance(a, pc);
    float inP = 1.0 - smoothstep(0.185, 0.205, d);
    if (inP > 0.0 && c.a > 0.01) {
      vec3 col = c.rgb / c.a;
      col = mix(col, hueRot(col, u_t * 0.9 + d * 9.0), 0.6 * inP);
      vec2 sp = pc + vec2(-0.05, -0.06) + 0.08 * vec2(cos(u_t * 0.8), sin(u_t * 0.8));
      col += vec3(1.0) * inP * 0.7 * smoothstep(0.075, 0.0, distance(a, sp));
      col += vec3(0.25, 0.35, 0.4) * inP * (0.5 + 0.5 * sin(u_t * 3.0)) * 0.35;
      c.rgb = col * c.a;
    }
  }

  c.rgb *= u_bright;

  if (u_shine >= 0.0) {
    float x = a.x + a.y * 0.55;
    float pos = mix(-0.45, 2.0, u_shine);
    float band = 1.0 - smoothstep(0.0, 0.13, abs(x - pos));
    c.rgb += vec3(1.0, 0.97, 0.88) * band * 0.6 * m;
  }

  if (u_spark > 0.0) {
    vec2 g = a * 7.0;
    vec2 cell = floor(g);
    vec2 f = fract(g) - 0.5;
    float h = hash(cell + u_type * 13.0);
    if (h > 0.55) {
      vec2 off = (vec2(hash(cell + 1.3), hash(cell + 7.1)) - 0.5) * 0.5;
      vec2 p = f - off;
      float ph = fract(u_t * 0.35 + h * 9.0);
      float tw = smoothstep(0.0, 0.05, ph) * smoothstep(0.16, 0.05, ph);
      float star = max(0.0, 1.0 - (abs(p.x) * abs(p.y) * 260.0 + length(p) * 5.0));
      c.rgb += vec3(1.0, 0.96, 0.85) * star * tw * u_spark * m;
    }
  }
  gl_FragColor = c * u_alpha;
}`;

  let gl = null, cvs = null, prog = null, isGL2 = false, nIdx = 0, vbuf = null, ibuf = null;
  const loc = {};
  const tSym = [], tMask = [], tBlur = [];

  function shader(type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  }
  const pow2 = n => (n & (n - 1)) === 0;
  function texture(src) {
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
    const mip = isGL2 || (pow2(src.width) && pow2(src.height));
    if (mip) { gl.generateMipmap(gl.TEXTURE_2D); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR); }
    else gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }

  // syms: [{img, mask, blur}] canvases
  function init(syms) {
    try {
      cvs = document.createElement('canvas');
      const opts = { alpha: true, premultipliedAlpha: true, antialias: true, preserveDrawingBuffer: false };
      gl = cvs.getContext('webgl2', opts);
      isGL2 = !!gl;
      if (!gl) gl = cvs.getContext('webgl', opts) || cvs.getContext('experimental-webgl', opts);
      if (!gl) return false;
      prog = gl.createProgram();
      gl.attachShader(prog, shader(gl.VERTEX_SHADER, VS));
      gl.attachShader(prog, shader(gl.FRAGMENT_SHADER, FS));
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
      for (const n of ['a_uv']) loc[n] = gl.getAttribLocation(prog, n);
      for (const n of ['u_res', 'u_m', 'u_size', 'u_type', 'u_t', 'u_k', 'u_persp', 'u_tex', 'u_mask', 'u_alpha', 'u_shine', 'u_blink', 'u_bright', 'u_spark']) loc[n] = gl.getUniformLocation(prog, n);
      // mesh
      const v = [], idx = [];
      for (let y = 0; y <= GRID; y++) for (let x = 0; x <= GRID; x++) v.push(x / GRID, y / GRID);
      for (let y = 0; y < GRID; y++) for (let x = 0; x < GRID; x++) {
        const i = y * (GRID + 1) + x;
        idx.push(i, i + 1, i + GRID + 1, i + 1, i + GRID + 2, i + GRID + 1);
      }
      nIdx = idx.length;
      vbuf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, vbuf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(v), gl.STATIC_DRAW);
      ibuf = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibuf); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(idx), gl.STATIC_DRAW);
      syms.forEach((s, i) => { tSym[i] = texture(s.img); tMask[i] = texture(s.mask); tBlur[i] = texture(s.blur); });
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      return true;
    } catch (e) {
      console.warn('SymGL unavailable, using 2D symbols:', e && e.message);
      gl = null;
      return false;
    }
  }

  function begin(w, h) {
    w = Math.max(1, Math.round(w)); h = Math.max(1, Math.round(h));
    if (cvs.width !== w || cvs.height !== h) { cvs.width = w; cvs.height = h; }
    gl.viewport(0, 0, w, h);
    gl.disable(gl.SCISSOR_TEST);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(prog);
    gl.bindBuffer(gl.ARRAY_BUFFER, vbuf);
    gl.enableVertexAttribArray(loc.a_uv);
    gl.vertexAttribPointer(loc.a_uv, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibuf);
    gl.uniform2f(loc.u_res, w, h);
    gl.uniform1i(loc.u_tex, 0);
    gl.uniform1i(loc.u_mask, 1);
  }

  function clip(r) {
    if (!r) { gl.disable(gl.SCISSOR_TEST); return; }
    gl.enable(gl.SCISSOR_TEST);
    gl.scissor(Math.round(r.x), Math.round(cvs.height - r.y - r.h), Math.round(r.w), Math.round(r.h));
  }

  // o: { sym, blur, art (draw the art-only layer), m:[a,b,c,d,e,f] affine in canvas px, w, h, alpha, t, k, persp, shine, blink, bright, spark }
  function draw(o) {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, o.blur ? tBlur[o.sym] : o.art ? tMask[o.sym] : tSym[o.sym]);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, tMask[o.sym]);
    const m = o.m;
    gl.uniformMatrix3fv(loc.u_m, false, [m[0], m[1], 0, m[2], m[3], 0, m[4], m[5], 1]);
    gl.uniform2f(loc.u_size, o.w, o.h);
    gl.uniform1f(loc.u_type, o.blur ? -1 : o.sym);
    gl.uniform1f(loc.u_t, o.t || 0);
    gl.uniform1f(loc.u_k, o.k || 0);
    gl.uniform1f(loc.u_persp, o.persp || 0);
    gl.uniform1f(loc.u_alpha, o.alpha == null ? 1 : o.alpha);
    gl.uniform1f(loc.u_shine, o.shine == null ? -1 : o.shine);
    gl.uniform1f(loc.u_blink, o.blink || 0);
    gl.uniform1f(loc.u_bright, o.bright == null ? 1 : o.bright);
    gl.uniform1f(loc.u_spark, o.spark || 0);
    gl.drawElements(gl.TRIANGLES, nIdx, gl.UNSIGNED_SHORT, 0);
  }

  window.SymGL = { init, begin, clip, draw, get canvas() { return cvs; }, get ok() { return !!gl; } };
})();
