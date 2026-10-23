const test = require('node:test');
const assert = require('node:assert/strict');
const { createHarness } = require('./helpers/game-harness');

function soundState(initial = {}) {
  const state = { muted: false, musicMuted: false, effectsVolume: 1, musicVolume: 1, ...initial };
  const sound = new Proxy({
    isMuted: () => state.muted,
    isMusicMuted: () => state.musicMuted,
    getEffectsVolume: () => state.effectsVolume,
    getMusicVolume: () => state.musicVolume,
    setMuted: value => { state.muted = value; },
    setMusicMuted: value => { state.musicMuted = value; },
    setEffectsVolume: value => { state.effectsVolume = Math.max(0, Math.min(1, value)); },
    setMusicVolume: value => { state.musicVolume = Math.max(0, Math.min(1, value)); },
  }, { get: (target, key) => target[key] || (() => {}) });
  return { sound, state };
}

function slide(h, id, value) { const input = h.get(id); input.value = String(value); input.oninput({ target: input }); }

function key(h, code, target) {
  const event = { code, target: target || { tagName: 'BODY' }, preventDefault() { this.prevented = true; } };
  h.dispatchWindow('keydown', event);
  return event;
}

test('volume settings expose saved levels and focus the effects slider without placing a wager', async () => {
  const audio = soundState({ effectsVolume: 0.23, musicVolume: 0.67 });
  const h = await createHarness({ sound: audio.sound });
  let focused = false;
  h.get('effectsVolume').focus = () => { focused = true; };
  h.get('btnVolume').click();
  assert.equal(h.get('volumePanel').hidden, false);
  assert.equal(h.get('btnVolume')['aria-expanded'], 'true');
  assert.equal(h.get('effectsVolume').value, '23');
  assert.equal(h.get('musicVolume').value, '67');
  assert.equal(h.get('effectsVolumeValue').textContent, '23%');
  assert.equal(h.get('musicVolume')['aria-valuetext'], '67 percent');
  assert.equal(focused, true);
  assert.equal(h.server.calls.some(call => call.endpoint === '/wallet/play'), false);
});

test('both sliders update their own channel and percentage immediately while preserving mute', async () => {
  const audio = soundState({ muted: true, musicMuted: true });
  const h = await createHarness({ sound: audio.sound });
  h.get('btnVolume').click();
  slide(h, 'effectsVolume', 17);
  assert.equal(audio.state.effectsVolume, 0.17); assert.equal(audio.state.musicVolume, 1);
  slide(h, 'musicVolume', 42);
  assert.equal(audio.state.musicVolume, 0.42); assert.equal(audio.state.effectsVolume, 0.17);
  assert.equal(h.get('effectsVolumeValue').textContent, '17%'); assert.equal(h.get('musicVolumeValue').textContent, '42%');
  assert.equal(audio.state.muted, true); assert.equal(audio.state.musicMuted, true);
  assert.match(h.get('volumeStatus').textContent, /All audio is muted/);
});

test('mute buttons keep selected slider levels through toggling and reopening', async () => {
  const audio = soundState();
  const h = await createHarness({ sound: audio.sound });
  h.get('btnVolume').click(); slide(h, 'effectsVolume', 35); slide(h, 'musicVolume', 60);
  h.get('btnSound').click();
  assert.equal(audio.state.muted, true); assert.equal(h.get('btnSound')['aria-label'], 'Unmute all audio');
  assert.equal(h.get('btnSound')['aria-pressed'], 'true');
  assert.equal(h.get('effectsVolume').value, '35'); assert.equal(h.get('musicVolume').value, '60');
  h.get('btnSound').click(); h.get('btnMusic').click();
  assert.equal(audio.state.muted, false); assert.equal(audio.state.musicMuted, true);
  assert.equal(h.get('btnMusic')['aria-label'], 'Unmute music');
  assert.match(h.get('volumeStatus').textContent, /Music is muted/);
  h.get('volumeClose').click(); h.get('btnVolume').click();
  assert.equal(h.get('effectsVolume').value, '35'); assert.equal(h.get('musicVolume').value, '60');
  h.get('btnMusic').click();
  assert.equal(audio.state.musicMuted, false); assert.equal(audio.state.musicVolume, 0.6);
});

test('zero volume remains a selectable value through mute and unmute', async () => {
  const audio = soundState();
  const h = await createHarness({ sound: audio.sound });
  h.get('btnVolume').click(); slide(h, 'effectsVolume', 0); slide(h, 'musicVolume', 0);
  h.get('btnSound').click(); h.get('btnSound').click(); h.get('btnMusic').click(); h.get('btnMusic').click();
  assert.equal(audio.state.effectsVolume, 0); assert.equal(audio.state.musicVolume, 0);
  assert.equal(h.get('effectsVolumeValue').textContent, '0%'); assert.equal(h.get('musicVolumeValue').textContent, '0%');
});

test('Escape closes volume settings and returns focus to the volume button', async () => {
  const h = await createHarness({ sound: soundState().sound });
  let focused = false;
  h.get('btnVolume').focus = () => { focused = true; };
  h.get('btnVolume').click();
  assert.equal(key(h, 'Escape').prevented, true);
  assert.equal(h.get('volumePanel').hidden, true); assert.equal(h.get('btnVolume')['aria-expanded'], 'false');
  assert.equal(focused, true);
});

test('Space and Enter in volume settings do not trigger spins or hold-to-turbo', async () => {
  const h = await createHarness({ sound: soundState().sound });
  h.get('btnVolume').click();
  key(h, 'Space', { tagName: 'INPUT' }); key(h, 'Enter', { tagName: 'INPUT' });
  await h.tick(500);
  assert.equal(h.api.st.busy, false);
  assert.equal(h.server.calls.some(call => call.endpoint === '/wallet/play'), false);
  assert.equal(h.get('volumePanel').hidden, false);
});

test('outside input dismisses the volume panel while slider input keeps it open', async () => {
  const h = await createHarness({ sound: soundState().sound });
  h.get('btnVolume').click();
  h.dispatchDocument('pointerdown', { target: { closest: () => h.get('volumePanel') } });
  assert.equal(h.get('volumePanel').hidden, false);
  h.dispatchDocument('pointerdown', { target: { closest: () => null } });
  assert.equal(h.get('volumePanel').hidden, true); assert.equal(h.get('btnVolume')['aria-expanded'], 'false');
});

test('opening another dialog dismisses volume settings', async () => {
  const h = await createHarness({ sound: soundState().sound });
  h.get('btnVolume').click(); h.get('btnInfo').click();
  assert.equal(h.get('volumePanel').hidden, true); assert.equal(h.get('mInfo').hidden, false);
  assert.equal(h.get('btnVolume')['aria-expanded'], 'false');
});

test('the first Spin press with volume open only closes the volume panel', async () => {
  const h = await createHarness({ sound: soundState().sound });
  h.get('btnVolume').click();
  h.get('btnSpin').listeners.click[0]();
  await h.flush();
  assert.equal(h.get('volumePanel').hidden, true);
  assert.equal(h.server.calls.some(call => call.endpoint === '/wallet/play'), false);
});
