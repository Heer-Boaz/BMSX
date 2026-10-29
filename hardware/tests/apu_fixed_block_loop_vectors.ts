// Capacity witness for the candidate direct fixed-block loop address. Both
// decoders below are the production owner. The reference uses Book I's empty
// seek table; the candidate supplies a retained loop-block address as an
// internal seek entry. This models address selection, not an RTL scheduler.
import assert from 'node:assert/strict';
import { writeLE16, writeLE32 } from '../../machine/ts/common/endian.ts';
import {
  createApuBadpDecoderState, readApuBadpFrameAt, resetApuBadpDecoder,
  type ApuBadpDecodeTarget,
} from '../../machine/ts/machine/devices/audio/badp_decoder_hot_path.ts';

const BLOCK_FRAMES = 32, BLOCK_BYTES = 44, BLOCKS = 4;
let checkedEpochs = 0, worstReads = 0, exercisedWraps = 0;
for (let residue = 0; residue < 4; ++residue) {
  const data = new Uint8Array(residue + BLOCKS * BLOCK_BYTES);
  for (let block = 0; block < BLOCKS; ++block) {
    const base = residue + block * BLOCK_BYTES;
    writeLE16(data, base, BLOCK_FRAMES);
    writeLE16(data, base + 2, BLOCK_BYTES);
    writeLE16(data, base + 4, 83 + block * 137);
    data[base + 6] = 9 + block;
    writeLE16(data, base + 8, -173 - block * 101);
    data[base + 10] = 27 + block;
    for (let frame = 0; frame < BLOCK_FRAMES; ++frame)
      data[base + 12 + frame] = (frame * 29 + block * 47 + 17) & 255;
  }
  for (let loopStart = 0; loopStart < BLOCKS * BLOCK_FRAMES; loopStart += BLOCK_FRAMES) {
    for (let loopEnd = loopStart + BLOCK_FRAMES; loopEnd <= BLOCKS * BLOCK_FRAMES; loopEnd += BLOCK_FRAMES) {
      let runs = 0, lastWord = -1;
      const counted = new Proxy(data, {
        get(target, key) {
          const address = Number(key), word = address >>> 2;
          if (word !== lastWord) { ++runs; lastWord = word; }
          return Reflect.get(target, key, target);
        },
      });
      const table = new Uint8Array(loopStart ? 16 : 8);
      if (loopStart) {
        writeLE32(table, 8, loopStart);
        writeLE32(table, 12, (loopStart / BLOCK_FRAMES) * BLOCK_BYTES);
      }
      const reference: ApuBadpDecodeTarget = {
        sourceBytes: data, dataOffset: residue, frames: BLOCKS * BLOCK_FRAMES,
        channels: 2, badpSeekTable: { bytes: table, byteOffset: 0, entryCount: 0 },
        badp: createApuBadpDecoderState(),
      };
      const candidate: ApuBadpDecodeTarget = {
        sourceBytes: counted, dataOffset: residue, frames: BLOCKS * BLOCK_FRAMES,
        channels: 2, badpSeekTable: { bytes: table, byteOffset: 0, entryCount: table.length / 8 },
        badp: createApuBadpDecoderState(),
      };
      // Preparation is outside the output-period budget under investigation.
      resetApuBadpDecoder(reference, loopStart);
      resetApuBadpDecoder(candidate, loopStart);
      assert.deepEqual(candidate.badp, reference.badp);
      const length = loopEnd - loopStart;
      for (let epoch = 0; epoch < 2 * length; ++epoch) {
        const frame = loopStart + epoch % length;
        const neighbor = frame + 1 === loopEnd ? loopStart : frame + 1;
        runs = 0; lastWord = -1;
        const refCurrent = readApuBadpFrameAt(reference, frame);
        const refNeighbor = readApuBadpFrameAt(reference, neighbor);
        assert.equal(readApuBadpFrameAt(candidate, frame), refCurrent);
        // Unity advance makes current the previous epoch's retained neighbor.
        // The source-word bound therefore does not assume a word latch carried
        // across the separate current/neighbor requests.
        assert.equal(runs, 0);
        assert.equal(readApuBadpFrameAt(candidate, neighbor), refNeighbor);
        assert.deepEqual(candidate.badp, reference.badp);
        if (neighbor === loopStart) ++exercisedWraps;
        assert.ok(runs <= 4, `alignment ${residue} loop ${loopStart}:${loopEnd} frame ${frame} used ${runs} word runs`);
        worstReads = Math.max(worstReads, runs);
        ++checkedEpochs;
      }
    }
  }
}
console.log(`PASS fixed-block loop selection: ${checkedEpochs} epochs, ${exercisedWraps} wraps, ${worstReads} maximum source word runs/voice/epoch; actual TS decoder output and complete state parity`);
