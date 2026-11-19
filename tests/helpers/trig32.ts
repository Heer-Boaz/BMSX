import { f32BitsToNumber, numberToF32Bits } from '../../machine/ts/common/float32';

const words = new Set<number>();
for (const word of [0, 1, 2, 0x007fffff, 0x00800000, 0x31000000, 0x31800000,
	0x32000000, 0x3e99999a, 0x3f2ca140, 0x3f480000, 0x3f490fd8, 0x3f490fdb,
	0x3fc90fdb, 0x40490fdb, 0x43490f80, 0x4f000000, 0x7f7fffff]) {
	for (const delta of [-2, -1, 0, 1, 2]) {
		const magnitude = word + delta;
		if (magnitude < 0 || magnitude >= 0x7f800000) continue;
		words.add(magnitude); words.add((magnitude | 0x80000000) >>> 0);
	}
}
// Quadrant boundaries exercise argument reduction; the edge words above
// already cover subnormal, tiny, unit and maximal magnitudes.
for (let quadrant = -8; quadrant <= 8; ++quadrant) {
	const word = numberToF32Bits(quadrant * Math.PI / 2);
	for (const delta of [-2, -1, 0, 1, 2]) if (word + delta >= 0) words.add((word + delta) >>> 0);
}

export const TRIG32_INPUT_WORDS = Uint32Array.from(words);

// The same independent reference is carried into the physical ROM, so ARM
// execution checks every input, not just agreement between two emulators.
const expected = [Math.sin, Math.cos, Math.tan].flatMap(reference =>
	Array.from(TRIG32_INPUT_WORDS, word => numberToF32Bits(reference(f32BitsToNumber(word)))));
export const TRIG32_ROM_SOURCE = `
rodata inputs: word[${TRIG32_INPUT_WORDS.length}] = { ${Array.from(TRIG32_INPUT_WORDS, word => `0x${word.toString(16)}`).join(',')} }
rodata expected: word[${expected.length}] = { ${expected.map(word => `0x${word.toString(16)}`).join(',')} }
local math<const> = require('math')
local boot<const> = require('test/boot')
local functions<const> = { math.sin, math.cos, math.tan }
local checksums<const> = {}
local source<const>: *word = inputs
local reference<const>: *word = expected
math.pi = 7
for fn = 1, 3 do
 local checksum = 0
 for index = 0, ${TRIG32_INPUT_WORDS.length - 1} do
  local input<const> = source[index]
  local actual<const> = blua32.float_bits(functions[fn](blua32.float_from_bits(input)))
  local correct<const> = reference[(fn - 1) * ${TRIG32_INPUT_WORDS.length} + index]
  local distance<const> = actual - correct
  if distance < -3 or distance > 3 or (input & 0x7fffffff == 0 and actual ~= correct) then
   boot.error('binary32 trig reference mismatch')
  end
  checksum = ((checksum << 5) | (checksum >> 27)) ~ actual
 end
 local ok<const> = boot.pcall(function() return functions[fn](false) end)
 if ok then boot.error('binary32 trig admitted a non-Number') end
 checksums[fn] = checksum
end
return checksums[1], checksums[2], checksums[3],
 math.sin(-0.0), math.cos(-0.0), math.tan(-0.0),
 math.sin(16777217), math.cos(0x80000000), math.tan(0x7fffffff),
 math.sin(blua32.float_from_bits(0x7f800000)), math.cos(blua32.float_from_bits(0xff800000)),
 math.tan(blua32.float_from_bits(0xffa12345))
`;
