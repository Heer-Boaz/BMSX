import { numberToF32Bits } from '../../machine/ts/common/float32';

export const CLOCK_WORD_MODULES = ['cartlib/clock', 'cartlib/apu', 'cartlib/dma', 'cartlib/irq', 'cartlib/irq/source'];
export const CLOCK_WORD_CASES = [
	[0, 0, 0], [0x7ffffff0, 0x80000010, 32], [0xfffffff0, 0x10, 32],
	[0xffffffff, 0, 1], [0x80000000, 0x800003e8, 1000],
	[0x80000001, 0, 0x7fffffff], [0, 0x7fffffff, 0x7fffffff],
	[1, 0, -1], // Representable reversed samples still flow through word arithmetic.
] as const;
const milliseconds = [0, 1, 1000, 48696, 60000, 2147483647, -60000];
export const CLOCK_WORD_CHECKS = 128 * CLOCK_WORD_CASES.length + milliseconds.length;

const cases = CLOCK_WORD_CASES.map(([start, end, elapsed]) => {
	const audio = Math.fround(Math.fround(elapsed) * Math.fround(1000 / 44100));
	return `{0x${start.toString(16)},0x${end.toString(16)},${elapsed},0x${numberToF32Bits(audio).toString(16)}}`;
}).join(',\n');
const sampleCounts = milliseconds.map(ms => `{${ms},0x${numberToF32Bits(Math.fround(Math.fround(ms) * Math.fround(44.1))).toString(16)}}`).join(',\n');

/** Real cartlib consumers, not a copied subtraction formula. The same ROM
 * runs on the TS interpreter, generated JS, native x86 and physical ARM32. */
export const CLOCK_WORD_ROM_SOURCE = `
local clock<const> = require('cartlib/clock')
local apu<const> = require('cartlib/apu')
local cases<const> = {${cases}}
local checks = 0
for round = 1, 128 do
 for index = 1, #cases do
  local row<const> = cases[index]
  local elapsed<const> = clock.elapsed_milliseconds(row[1], row[2])
  if elapsed ~= row[3] then return false, 1, index, elapsed end
  local audio<const> = apu.elapsed_milliseconds(row[1], row[2])
  if blua32.float_bits(audio) ~= row[4] then return false, 2, index, blua32.float_bits(audio) end
  checks = checks + 1
 end
end
local sample_counts<const> = {${sampleCounts}}
for index = 1, #sample_counts do
 local row<const> = sample_counts[index]
 local samples<const> = apu.ms_to_samples(row[1])
 if blua32.float_bits(samples) ~= row[2] then return false, 3, index, blua32.float_bits(samples) end
 checks = checks + 1
end
return true, checks
`;
