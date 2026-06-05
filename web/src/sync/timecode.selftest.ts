// Pure roundtrip test for the timecode codec — no DOM required.
// Run with:  npx tsx web/src/sync/timecode.selftest.ts
import { encodeCells, decodeLuma, TC_EPOCH_MS, TC_CELLS } from './timecode';

function cellsToLuma(cells: number[], noise = 0): number[] {
  // White cell -> ~235, black -> ~16 (studio-ish), plus optional noise to mimic
  // compression. Stays well inside TC_MIN_CONTRAST.
  return cells.map((c) => (c ? 235 : 16) + (Math.random() * 2 - 1) * noise);
}

let failures = 0;
const samples = [
  TC_EPOCH_MS,
  TC_EPOCH_MS + 1,
  TC_EPOCH_MS + 12_345,
  Date.UTC(2026, 5, 4, 12, 30, 15, 789),
  Date.UTC(2030, 11, 31, 23, 59, 59, 999),
];

// Realistic compression noise on big, flat, high-contrast cells is small; the
// codec tolerates up to ~±50 luma here before a bit can flip.
for (const ms of samples) {
  for (const noise of [0, 20, 40]) {
    const cells = encodeCells(ms);
    if (cells.length !== TC_CELLS) {
      console.error(`FAIL cell count ${cells.length} != ${TC_CELLS}`);
      failures++;
      continue;
    }
    const got = decodeLuma(cellsToLuma(cells, noise));
    const expected = Math.round(ms); // encode rounds to whole ms
    if (got !== expected) {
      console.error(`FAIL ms=${ms} noise=${noise}: got ${got}, expected ${expected}`);
      failures++;
    }
  }
}

// Safety: corrupted reads must be REJECTED (null), never returned as a wrong
// time. (a) flat/low-contrast input; (b) a single flipped data bit.
if (decodeLuma(new Array(TC_CELLS).fill(120)) !== null) {
  console.error('FAIL: flat/low-contrast input should decode to null');
  failures++;
}
{
  const cells = encodeCells(samples[3]);
  const luma = cellsToLuma(cells, 0);
  luma[10] = luma[10] > 120 ? 16 : 235; // flip one data cell
  if (decodeLuma(luma) !== null) {
    console.error('FAIL: single-bit corruption should fail the checksum (null)');
    failures++;
  }
}

if (failures === 0) {
  console.log(`timecode self-test OK (${samples.length} timestamps x 3 noise levels)`);
} else {
  throw new Error(`timecode self-test: ${failures} failure(s)`);
}
