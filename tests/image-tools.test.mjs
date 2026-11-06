import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { assessExposure, brightenShadows } from '../server/image-tools.mjs';
import { Recognizer } from '../server/recognition.mjs';
import { parseModelJson } from '../server/provider.mjs';
import { Taxonomy } from '../server/taxonomy.mjs';

const photo = async background => sharp({ create: { width: 120, height: 80, channels: 3, background } }).png().toBuffer();
const catalogue = new Taxonomy([{ species_code: 'easpho', english_name: 'Eastern Phoebe', scientific_name: 'Sayornis phoebe', category: 'species' }]);
const config = { baseUrl: 'http://127.0.0.1:9999/v1', model: 'fake', reviewModel: 'fake-review' };
const observation = extra => ({ subject: 'bird', candidates: [{ english_name: 'Eastern Phoebe', scientific_name: 'Sayornis phoebe' }], confidence: .7, needs_review: true, evidence: ['dark head', 'pale throat'], missing_features: ['facial detail in shadow'], reason: 'Backlit subject', bbox: [.1,.1,.9,.9], image_adjustment: 'none', ...extra });
const unpack = part => Buffer.from(part.image_url.url.split(',')[1], 'base64');

test('exposure assessment detects dark regions without treating every normal image as underexposed', async () => {
  assert.equal((await assessExposure(await photo('#202020'))).needs_lift, true);
  assert.equal((await assessExposure(await photo('#b0b0b0'))).needs_lift, false);
  // Bright background must not hide a sizeable dark subject.
  const patch = await photo('#101010');
  const mixed = await sharp({ create: { width: 500, height: 80, channels: 3, background: '#d0d0d0' } }).composite([{ input: patch, left: 0, top: 0 }]).png().toBuffer();
  const stats = await assessExposure(mixed);
  assert.ok(stats.median > 100); assert.ok(stats.dark_fraction >= .2 && stats.dark_fraction < .3); assert.equal(stats.needs_lift, true);
});

test('shadow lift brightens existing dark pixels while preserving dimensions and RGB ratios', async () => {
  const source = await photo({ r: 24, g: 40, b: 56 });
  const before = Buffer.from(source);
  const adjusted = await brightenShadows(source);
  const { data, info } = await sharp(adjusted.buffer).raw().toBuffer({ resolveWithObject: true });
  assert.equal(info.width, 120); assert.equal(info.height, 80);
  assert.ok(data[0] > 40 && data[1] > 65 && data[2] > 90);
  assert.ok(Math.abs(data[0] / data[1] - 24 / 40) < .06);
  assert.ok(Math.abs(data[2] / data[1] - 56 / 40) < .06);
  assert.deepEqual(source, before, 'input buffer stays unchanged');
  assert.equal(adjusted.max_gain, 2.5);
});

test('shadow lift keeps black uninformative, preserves white and retains increasing tonal order', async () => {
  for (const [colour, expected] of [['#000000', 0], ['#ffffff', 255]]) {
    const { buffer } = await brightenShadows(await photo(colour));
    const raw = await sharp(buffer).raw().toBuffer();
    assert.ok(Math.abs(raw[0] - expected) <= 1);
  }
  let last = -1;
  for (const level of [8, 24, 48, 80, 128, 192, 240]) {
    const { buffer } = await brightenShadows(await photo({ r: level, g: level, b: level }));
    const raw = await sharp(buffer).raw().toBuffer();
    assert.ok(raw[0] > last); last = raw[0];
  }
});

test('dark subject automatically receives original full view, original crop and labelled exposure preview in two calls', async () => {
  let calls = 0;
  const engine = new Recognizer({ catalog: catalogue, provider: async (_config, request) => {
    calls++;
    if (calls === 2) {
      assert.equal(request.stage, 'review');
      const parts = request.messages[1].content;
      const images = parts.filter(p => p.type === 'image_url');
      assert.equal(images.length, 3);
      assert.match(parts.map(p => p.text ?? '').join('\n'), /same framing as Image 2/);
      const original = await sharp(unpack(images[1])).stats();
      const enhanced = await sharp(unpack(images[2])).stats();
      assert.ok(enhanced.channels[0].mean > original.channels[0].mean * 1.5);
    }
    return { value: observation(), usage: { total_tokens: 10 } };
  } });
  const result = await engine.recognize({ image: (await photo('#202020')).toString('base64') }, config);
  assert.equal(calls, 2); assert.equal(result.calls, 2); assert.equal(result.usage.length, 2);
  assert.deepEqual(result.tools, ['taxonomy.search', 'image.crop', 'image.exposure']);
  assert.equal(result.image_adjustment.trigger, 'automatic'); assert.equal(result.image_adjustment.source, 'crop');
  assert.equal(result.image_adjustment.status, 'applied'); assert.equal(result.retry, true);
  assert.equal(result.image_adjustment.buffer, undefined, 'diagnostics contain no encoded image');
});

test('model can request exposure even on an otherwise confident bright image, with invalid crop falling back to full view', async () => {
  let calls = 0;
  const clear = observation({ needs_review: false, confidence: .98, missing_features: [], bbox: [0,0,2,1], image_adjustment: 'brighten' });
  const engine = new Recognizer({ catalog: catalogue, provider: async (_config, request) => {
    calls++;
    if (calls === 2) {
      assert.equal(request.messages[1].content.filter(p => p.type === 'image_url').length, 2);
      assert.match(request.messages[1].content.map(p => p.text ?? '').join('\n'), /same framing as Image 1/);
    }
    return { value: calls === 1 ? clear : { ...clear, image_adjustment: 'none' }, usage: null };
  } });
  const result = await engine.recognize({ image: (await photo('#bbbbbb')).toString('base64') }, config);
  assert.equal(calls, 2); assert.equal(result.image_adjustment.source, 'full'); assert.equal(result.image_adjustment.trigger, 'model');
  assert.deepEqual(result.tools, ['taxonomy.search', 'image.exposure']); assert.equal(result.status, 'confirmed');
});

test('clear images and non-birds do not gain extra exposure requests or review rounds', async () => {
  for (const value of [observation({ needs_review: false, confidence: .98, missing_features: [] }), observation({ subject: 'non_bird', candidates: [], image_adjustment: 'brighten' })]) {
    let calls = 0;
    const engine = new Recognizer({ catalog: catalogue, provider: async () => { calls++; return { value, usage: null }; } });
    const result = await engine.recognize({ image: (await photo('#bbbbbb')).toString('base64') }, config);
    assert.equal(calls, 1); assert.equal(result.image_adjustment, null); assert.deepEqual(result.tools, []);
  }
});

test('optional exposure directive remains backward-compatible but rejects unbounded or invented tool requests', () => {
  assert.equal(parseModelJson(JSON.stringify(observation({ image_adjustment: 'brighten' }))).image_adjustment, 'brighten');
  const legacy = observation(); delete legacy.image_adjustment;
  assert.equal(parseModelJson(JSON.stringify(legacy)).image_adjustment, undefined);
  for (const image_adjustment of ['arbitrary-command', { gain: 100 }, null]) assert.throws(() => parseModelJson(JSON.stringify(observation({ image_adjustment }))), /结构/);
});
