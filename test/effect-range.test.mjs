import { readFile, readdir } from 'node:fs/promises';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const calibrated = Object.freeze({
  'blackwall.scan': [0, 1, 0.01],
  'blackwall.sweep': [0, 1, 0.01],
  'contour.bands': [1, 36, 1],
  'contour.width': [0.01, 0.2, 0.01],
  'datamosh.decay': [0, 0.98, 0.01],
  'datamosh.drift': [0, 1, 0.02],
  'datamosh.grain': [1, 32, 1],
  'datamosh.reach': [0, 24, 0.5],
  'datamosh.speed': [0, 4, 0.1],
  'ghost.rim': [0.2, 1.5, 0.01],
  'glitch.bands': [1, 32, 1],
  'glitch.rate': [0, 15, 0.5],
  'glitch.shove': [0, 1, 0.01],
  'glitch.tint': [0, 3, 0.05],
  'halation.radius': [2, 60, 1],
  'noise.amount': [0, 0.25, 0.005],
  'noise.region': [0, 0.25, 0.005],
  'noise.speed': [0, 2, 0.05],
  'push.amount': [-0.5, 0.5, 0.01],
  'raster.pitch': [0.05, 1.5, 0.01],
  'rgbsplit.amount': [0, 3, 0.05],
  'ripple.amount': [0, 0.2, 0.005],
  'ripple.freq': [0.2, 10, 0.1],
  'ripple.speed': [0, 4, 0.05],
});

const manifests = new Map();
for (const name of Object.keys(calibrated)) {
  const id = name.slice(0, name.indexOf('.'));
  if (!manifests.has(id)) {
    const source = await readFile(new URL(`../effects-builtin/${id}/manifest.json`, import.meta.url), 'utf8');
    manifests.set(id, JSON.parse(source));
  }
}

test('built-in effect amplifiers expose only their calibrated authoring travel', () => {
  const actual = Object.fromEntries(Object.keys(calibrated).map((name) => {
    const dot = name.indexOf('.');
    const spec = manifests.get(name.slice(0, dot)).params[name.slice(dot + 1)];
    return [name, [spec.min, spec.max, spec.step]];
  }));
  assert.deepEqual(actual, calibrated);
});

test('every calibrated effect default remains on its slider grid', () => {
  for (const [name, [min, max, step]] of Object.entries(calibrated)) {
    const dot = name.indexOf('.');
    const spec = manifests.get(name.slice(0, dot)).params[name.slice(dot + 1)];
    assert.ok(spec.def >= min && spec.def <= max, `${name} default ${spec.def} is outside ${min}..${max}`);
    const steps = Math.round((spec.def - min) / step);
    assert.ok(Math.abs(min + steps * step - spec.def) < 1e-9,
      `${name} default ${spec.def} is off the ${step} grid from ${min}`);
  }
});

test('every shipped preset stays inside the calibrated effect ranges', async () => {
  const root = new URL('../presets-builtin/', import.meta.url);
  const files = (await readdir(root)).filter((name) => name.endsWith('.json'));
  assert.ok(files.length > 0, 'the preset population is empty');
  for (const file of files) {
    const preset = JSON.parse(await readFile(new URL(file, root), 'utf8'));
    for (const [name, value] of Object.entries(preset.values)) {
      if (!(name in calibrated)) continue;
      const [min, max, step] = calibrated[name];
      assert.ok(value >= min && value <= max, `${file} puts ${name}=${value} outside ${min}..${max}`);
      const steps = Math.round((value - min) / step);
      assert.ok(Math.abs(min + steps * step - value) < 1e-9,
        `${file} puts ${name}=${value} off the ${step} grid from ${min}`);
    }
  }
});
