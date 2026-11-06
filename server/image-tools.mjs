import sharp from 'sharp';

// Conservative local diagnostics, measured on the subject crop when one exists.
// Darkness is a routing hint, never evidence for a bird's true feather colour.
export async function assessExposure(bytes) {
  const { data, info } = await sharp(bytes).resize({ width: 128, height: 128, fit: 'inside', withoutEnlargement: true })
    .toColourspace('srgb').removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const histogram = new Uint32Array(256);
  const pixels = info.width * info.height;
  let dark = 0;
  for (let i = 0; i < data.length; i += info.channels) {
    const luminance = Math.round(.2126 * data[i] + .7152 * data[i + 1] + .0722 * data[i + 2]);
    histogram[luminance]++;
    if (luminance < 48) dark++;
  }
  let count = 0, median = 0;
  for (; median < 255; median++) { count += histogram[median]; if (count >= pixels / 2) break; }
  const darkFraction = dark / pixels;
  return { median, dark_fraction: Math.round(darkFraction * 1000) / 1000, needs_lift: median < 75 || darkFraction >= .2 };
}

// A bounded, monotonic shadow lift (at most 2.5x in sRGB channel values,
// not RAW exposure compensation). Scale RGB together per pixel and limit by
// its brightest channel; no separate white-balance edit or channel clipping.
// Highlights are lifted less.
// This reveals existing values only; no denoising, sharpening or new detail.
export async function brightenShadows(bytes) {
  const { data, info } = await sharp(bytes).toColourspace('srgb').removeAlpha().raw().toBuffer({ resolveWithObject: true });
  for (let i = 0; i < data.length; i += info.channels) {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    const luminance = (.2126 * r + .7152 * g + .0722 * b) / 255;
    const peak = Math.max(r, g, b);
    const gain = Math.min(1 + 1.5 * (1 - luminance) ** 2, peak ? 255 / peak : 1);
    data[i] = Math.round(r * gain); data[i + 1] = Math.round(g * gain); data[i + 2] = Math.round(b * gain);
  }
  const buffer = await sharp(data, { raw: { width: info.width, height: info.height, channels: info.channels } }).jpeg({ quality: 94 }).toBuffer();
  return { buffer, method: 'rgb_ratio_shadow_lift', max_gain: 2.5 };
}
