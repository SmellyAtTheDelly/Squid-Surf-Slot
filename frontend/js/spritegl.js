/* Squid Squad — smooth sprite warping on the GPU.
   Sea creatures, kelp and kraken arms are drawn on a fine mesh whose vertices bend along a travelling wave,
   so tails, fronds and tentacles flex as one continuous surface (no strips, no seams, no stair-steps).
   Sprites are queued while the 2D scene is drawn, then rendered in one pass and composited back. */
(function () {
  'use strict';
  const GX = 40, GY = 24;
  const VS = `
attribute vec2 a_uv;
uniform vec2 u_res;
uniform mat3 u_m;
uniform vec2 u_size;
uniform vec4 u_wave;   // amplitude (local px), wave number, phase, falloff exponent
uniform vec2 u_mode;   // x: 0 tail wave, 1 sway from the base up, 2 hanging, 3 wings; y: tail cut-off
varying vec2 v_uv;
void main() {
  vec2 uv = a_uv;
  vec2 p = (uv - 0.5) * u_size;
  float amp = u_wave.x, k = u_wave.y, ph = u_wave.z, pw = u_wave.w;
  if (u_mode.x < 0.5) {
    float a = pow(clamp((u_mode.y - uv.x) / u_mode.y, 0.0, 1.0), pw);
    p.y += amp * a * sin(ph + uv.x * k);
  } else if (u_mode.x < 1.5) {
    float a = pow(1.0 - uv.y, pw);
    p.x += amp * a * sin(ph + uv.y * k);
  } else if (u_mode.x < 2.5) {
    float a = pow(uv.y, pw);
    p.x += amp * a * sin(ph + uv.y * k);
  } else {
    float a = pow(abs(uv.x - 0.5) * 2.0, pw);
    p.y += amp * a * sin(ph);
  }
  vec3 q = u_m * vec3(p, 1.0);
  gl_Position = vec4(q.x / u_res.x * 2.0 - 1.0, 1.0 - q.y / u_res.y * 2.0, 0.0, 1.0);
  v_uv = uv;
}`;
  const FS = `
precision mediump float;
uniform sampler2D u_tex;
uniform float u_alpha;
varying vec2 v_uv;
void main() { gl_FragColor = texture2D(u_tex, v_uv) * u_alpha; }`;

  let gl = null, cvs = null, prog = null, loc = {}, nIdx = 0, vbuf = null, ibuf = null, isGL2 = false, lost = false;
  let tex = new WeakMap();
  let queue = null;

  function shader(type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  }
  // a software renderer (no GPU) runs WebGL on the CPU, and copying each frame back costs more than plain 2D drawing
  function isSoftware(gl) {
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    return /swiftshader|software|llvmpipe|basic render/i.test(String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER)));
  }
  // program and mesh: built at start-up, and again when a lost context comes back (textures rebuild on demand)
  function setup() {
      tex = new WeakMap();
      prog = gl.createProgram();
      gl.attachShader(prog, shader(gl.VERTEX_SHADER, VS));
      gl.attachShader(prog, shader(gl.FRAGMENT_SHADER, FS));
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
      loc.a_uv = gl.getAttribLocation(prog, 'a_uv');
      for (const n of ['u_res', 'u_m', 'u_size', 'u_wave', 'u_mode', 'u_tex', 'u_alpha']) loc[n] = gl.getUniformLocation(prog, n);
      const v = [], idx = [];
      for (let y = 0; y <= GY; y++) for (let x = 0; x <= GX; x++) v.push(x / GX, y / GY);
      for (let y = 0; y < GY; y++) for (let x = 0; x < GX; x++) {
        const i = y * (GX + 1) + x;
        idx.push(i, i + 1, i + GX + 1, i + 1, i + GX + 2, i + GX + 1);
      }
      nIdx = idx.length;
      vbuf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, vbuf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(v), gl.STATIC_DRAW);
      ibuf = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibuf); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(idx), gl.STATIC_DRAW);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  }
  function init() {
    try {
      cvs = document.createElement('canvas');
      // while the context is lost the sea life is drawn in 2D; once it is back the GPU path is rebuilt
      cvs.addEventListener('webglcontextlost', e => { e.preventDefault(); lost = true; });
      cvs.addEventListener('webglcontextrestored', () => {
        try { setup(); lost = false; } catch (e) { console.warn('SpriteGL could not recover:', e && e.message); gl = null; }
      });
      const opts = { alpha: true, premultipliedAlpha: true, antialias: true, preserveDrawingBuffer: false };
      gl = cvs.getContext('webgl2', opts); isGL2 = !!gl;
      if (!gl) gl = cvs.getContext('webgl', opts) || cvs.getContext('experimental-webgl', opts);
      if (!gl) return false;
      if (isSoftware(gl)) { gl = null; return false; }
      setup();
      return true;
    } catch (e) {
      console.warn('SpriteGL unavailable, using 2D sprites:', e && e.message);
      gl = null;
      return false;
    }
  }
  function texture(img) {
    let t = tex.get(img);
    if (t) return t;
    t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
    const pow2 = n => (n & (n - 1)) === 0;
    if (isGL2 || (pow2(img.width) && pow2(img.height))) { gl.generateMipmap(gl.TEXTURE_2D); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR); }
    else gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    tex.set(img, t);
    return t;
  }

  // Start collecting sprites drawn into context g.
  function begin() { queue = []; }
  // Queue a sprite centred at (cx, cy) in g's current local space. deform: { mode, amp, k, ph, pow, cut }.
  function add(g, img, cx, cy, w, h, d) {
    const m = g.getTransform();
    queue.push({
      img, w, h, alpha: g.globalAlpha,
      m: [m.a, m.b, m.c, m.d, m.e + m.a * cx + m.c * cy, m.f + m.b * cx + m.d * cy],
      d: d || { mode: 0, amp: 0, k: 0, ph: 0, pow: 1, cut: 1 },
    });
  }
  // Render the queue and composite it over g's canvas.
  function flush(g) {
    const q = queue;
    queue = null;
    if (!q || !q.length) return;
    const W = g.canvas.width, H = g.canvas.height;
    if (cvs.width !== W || cvs.height !== H) { cvs.width = W; cvs.height = H; }
    gl.viewport(0, 0, W, H);
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(prog);
    gl.bindBuffer(gl.ARRAY_BUFFER, vbuf);
    gl.enableVertexAttribArray(loc.a_uv);
    gl.vertexAttribPointer(loc.a_uv, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibuf);
    gl.uniform2f(loc.u_res, W, H);
    gl.uniform1i(loc.u_tex, 0);
    gl.activeTexture(gl.TEXTURE0);
    for (const s of q) {
      gl.bindTexture(gl.TEXTURE_2D, texture(s.img));
      const m = s.m;
      gl.uniformMatrix3fv(loc.u_m, false, [m[0], m[1], 0, m[2], m[3], 0, m[4], m[5], 1]);
      gl.uniform2f(loc.u_size, s.w, s.h);
      gl.uniform4f(loc.u_wave, s.d.amp || 0, s.d.k || 0, s.d.ph || 0, s.d.pow || 1);
      gl.uniform2f(loc.u_mode, s.d.mode || 0, s.d.cut || 1);
      gl.uniform1f(loc.u_alpha, s.alpha == null ? 1 : s.alpha);
      gl.drawElements(gl.TRIANGLES, nIdx, gl.UNSIGNED_SHORT, 0);
    }
    g.save();
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
    g.drawImage(cvs, 0, 0);
    g.restore();
  }

  window.SpriteGL = { init, begin, add, flush, get ok() { return !!gl && !lost; }, get active() { return !!queue; } };
})();
