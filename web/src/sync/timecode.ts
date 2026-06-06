// ============================================================================
// Timecode band codec — Mosaic's ground-truth per-feed capture clock.
//
// The OBS overlay (server/public/overlay/timecode.html) burns the current
// SERVER-clock time into a thin high-contrast luma band across the top of the
// frame. The viewer reads that band back off each decoded frame to learn the
// exact wall-clock instant the frame was captured — which inherently includes
// encode + network + jitter-buffer + decode latency, the quantity we must
// equalize across feeds to align them.
//
// >>> KEEP THE CONSTANTS AND BIT CONVENTION BELOW IN SYNC WITH <<<
//     server/public/overlay/timecode.html   (the WRITER)
// A roundtrip self-test lives in web/src/sync/timecode.selftest.ts.
// ============================================================================

export const TC_CAL = 2; //  cell[0] = white reference, cell[1] = black reference
export const TC_DATA = 40; // ms since TC_EPOCH_MS, MSB-first
export const TC_CHECK = 8; // (sum of the 5 data bytes) & 0xff, MSB-first
export const TC_CELLS = TC_CAL + TC_DATA + TC_CHECK; // 50 cells across the width
export const TC_BAND_FRACTION = 0.035; // band height (what the overlay draws / the reader samples)
// The viewer crops a bit MORE than the band so the H.264 ringing/smear that the
// band's hard edges leave in the macroblock row beneath it is removed too.
export const TC_CROP_FRACTION = 0.06;
export const TC_EPOCH_MS = Date.UTC(2025, 0, 1); // keeps the payload within 40 bits to ~2059
export const TC_MIN_CONTRAST = 36; // min (white-black) luma delta to trust a read

/** The 40-bit value as 5 bytes, most-significant first. */
function bytesOf(value: number): number[] {
  const out: number[] = [];
  for (let k = 4; k >= 0; k--) out.push(Math.floor(value / 2 ** (8 * k)) % 256);
  return out;
}

function checksum(value: number): number {
  return bytesOf(value).reduce((a, b) => a + b, 0) & 0xff;
}

/** ith bit (0 = LSB) of a value that may exceed 32 bits (so no `>>`). */
function bitAt(value: number, i: number): number {
  return Math.floor(value / 2 ** i) % 2;
}

/**
 * Encode a server-clock timestamp (ms) into TC_CELLS cell values (1 = white,
 * 0 = black). Used by the overlay writer and the self-test; the convention here
 * is the contract the reader below relies on.
 */
export function encodeCells(serverMs: number): number[] {
  const v = Math.max(0, Math.round(serverMs - TC_EPOCH_MS));
  const cells: number[] = [1, 0]; // white ref, black ref
  for (let i = TC_DATA - 1; i >= 0; i--) cells.push(bitAt(v, i));
  const cs = checksum(v);
  for (let i = TC_CHECK - 1; i >= 0; i--) cells.push((cs >> i) & 1);
  return cells;
}

export interface TimecodeScratch {
  canvas: HTMLCanvasElement | OffscreenCanvas;
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
}

/** A reusable N×1 scratch canvas for cheap band sampling. */
export function makeScratch(): TimecodeScratch {
  const canvas = document.createElement('canvas');
  canvas.width = TC_CELLS;
  canvas.height = 1;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  return { canvas, ctx };
}

/**
 * Read the timecode from the current frame of `src`. Returns the SERVER-clock
 * capture time in ms, or null if no valid band is present (low contrast or
 * failed checksum) — in which case the caller falls back to getStats timing.
 *
 * Cheap by construction: we ask the GPU to downscale the top band to TC_CELLS×1,
 * so each output pixel is the average of one whole cell (exactly the denoising
 * we want), then read TC_CELLS pixels.
 */
export function readTimecode(
  src: HTMLVideoElement | HTMLCanvasElement,
  scratch: TimecodeScratch,
): number | null {
  const w = 'videoWidth' in src ? src.videoWidth : src.width;
  const h = 'videoHeight' in src ? src.videoHeight : src.height;
  if (!w || !h) return null;

  const bandPx = Math.max(1, Math.round(h * TC_BAND_FRACTION));
  const ctx = scratch.ctx as CanvasRenderingContext2D;
  try {
    ctx.drawImage(src as CanvasImageSource, 0, 0, w, bandPx, 0, 0, TC_CELLS, 1);
  } catch {
    return null; // e.g. frame not yet decodable
  }
  const px = ctx.getImageData(0, 0, TC_CELLS, 1).data;
  const luma: number[] = [];
  for (let i = 0; i < TC_CELLS; i++) {
    luma.push(0.299 * px[i * 4] + 0.587 * px[i * 4 + 1] + 0.114 * px[i * 4 + 2]);
  }
  return decodeLuma(luma);
}

/**
 * Pure decode from per-cell luma values (length TC_CELLS). Split out from
 * readTimecode so it can be unit-tested without a canvas (see timecode.selftest.ts).
 * Returns server-clock ms, or null on low contrast / checksum failure.
 */
export function decodeLuma(luma: number[]): number | null {
  if (luma.length < TC_CELLS) return null;
  const white = luma[0];
  const black = luma[1];
  if (white - black < TC_MIN_CONTRAST) return null;
  const mid = (white + black) / 2;

  let v = 0;
  for (let j = 0; j < TC_DATA; j++) v = v * 2 + (luma[TC_CAL + j] > mid ? 1 : 0);
  let cs = 0;
  for (let j = 0; j < TC_CHECK; j++) cs = cs * 2 + (luma[TC_CAL + TC_DATA + j] > mid ? 1 : 0);

  if (cs !== checksum(v)) return null;
  return v + TC_EPOCH_MS;
}
