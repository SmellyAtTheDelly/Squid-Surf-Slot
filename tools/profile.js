(function () {
  'use strict';
  const frame = document.getElementById('preview');
  const output = document.getElementById('profile');
  let ocean = true, symbols = true, data, renderer = '', installed = false, game;
  const now = () => performance.now();
  function reset() { data = { start: now(), last: 0, frames: 0, intervals: [], callback: [], times: {}, counts: {} }; }
  function record(name, duration) { data.times[name] = (data.times[name] || 0) + duration; data.counts[name] = (data.counts[name] || 0) + 1; }
  function measure(target, key, group, allowed) {
    const original = target[key];
    target[key] = function (...args) {
      if (allowed && !allowed()) return;
      const start = now();
      try { return original.apply(this, args); }
      finally { record(group, now() - start); }
    };
  }
  function stats(values) {
    if (!values.length) return { mean: 0, p95: 0 };
    const sorted = values.slice().sort((a, b) => a - b);
    return { mean: values.reduce((sum, value) => sum + value, 0) / values.length, p95: sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] };
  }
  function install() {
    if (installed) return;
    game = frame.contentWindow;
    if (!game.__ss) return;
    if (!game.SymGL || !game.SymGL.canvas || !game.SeaLife || !game.SpriteGL) return;
    installed = true;
    reset();
    const gl = game.SymGL.canvas.getContext('webgl2') || game.SymGL.canvas.getContext('webgl');
    if (gl) {
      const extension = gl.getExtension('WEBGL_debug_renderer_info');
      renderer = extension ? gl.getParameter(extension.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
      renderer += '\nWebGL attributes: ' + JSON.stringify(gl.getContextAttributes());
    }
    for (const key of ['drawFar', 'drawRays', 'drawMid', 'drawNear', 'drawFront']) measure(game.SeaLife, key, 'ocean (inclusive)', () => ocean);
    measure(game.SpriteGL, 'flush', 'ocean GL flush (inclusive)');
    measure(game.SymGL, 'draw', 'symbol GL draw submissions');
    const proto = game.CanvasRenderingContext2D.prototype, originalDraw = proto.drawImage;
    const types = new WeakMap();
    proto.drawImage = function (...args) {
      const source = args[0];
      let type = '2D drawImage';
      if (source instanceof game.HTMLCanvasElement) {
        if (!types.has(source)) types.set(source, source === game.SymGL.canvas ? 'symbol GL copy' : source.getContext('webgl2') || source.getContext('webgl') ? 'ocean GL copy' : '2D drawImage');
        type = types.get(source);
      }
      const start = now();
      try { return originalDraw.apply(this, args); }
      finally { record(type, now() - start); }
    };
    const originalRaf = game.requestAnimationFrame.bind(game);
    game.requestAnimationFrame = callback => originalRaf(time => {
      const start = now();
      if (time !== data.last) {
        if (data.last) data.intervals.push(time - data.last);
        data.last = time;
        data.frames++;
      }
      try { callback(time); }
      finally { data.callback.push(now() - start); }
    });
  }
  document.getElementById('ocean').onclick = function () { ocean = !ocean; this.textContent = 'Ocean: ' + (ocean ? 'on' : 'off'); reset(); };
  document.getElementById('symbols').onclick = function () { symbols = !symbols; if (game && game.__ss) game.__ss.gl = symbols; this.textContent = '3D symbols: ' + (symbols ? 'on' : 'off'); reset(); };
  document.getElementById('reset').onclick = reset;
  setInterval(() => {
    install();
    if (!installed || !data.frames) return;
    const interval = stats(data.intervals), callback = stats(data.callback), canvas = game.document.getElementById('game');
    const lines = [
      'Sample: ' + ((now() - data.start) / 1000).toFixed(1) + 's, ' + data.frames + ' frames',
      'Animation callbacks: ' + (interval.mean ? 1000 / interval.mean : 0).toFixed(1) + ' frames/s | interval p95: ' + interval.p95.toFixed(1) + 'ms',
      'JS per callback mean: ' + callback.mean.toFixed(1) + 'ms | p95: ' + callback.p95.toFixed(1) + 'ms',
      'Canvas: ' + canvas.width + ' x ' + canvas.height + ' | DPR: ' + game.devicePixelRatio,
      'Visibility: ' + game.document.visibilityState + ' | focused: ' + game.document.hasFocus(),
      renderer,
    ];
    for (const name of Object.keys(data.times)) lines.push(name + ': ' + (data.times[name] / data.frames).toFixed(2) + 'ms/frame, ' + (data.counts[name] / data.frames).toFixed(1) + ' calls/frame');
    lines.push('Timings overlap where labelled inclusive. GPU work may finish asynchronously.');
    lines.push('Callback cadence does not measure frames presented on screen.');
    output.textContent = lines.join('\n');
    if (data.frames > 3600) reset();
  }, 1000);
})();
