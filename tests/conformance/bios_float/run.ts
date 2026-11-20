import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { compileLuaChunkToProgram } from '../../../toolchain/ts/lua/compiler';
import { linkTestSystemBlua32 } from '../../helpers/blua32';
import { buildPublicBiosFixture, PUBLIC_BIOS_PROBE_SOURCE } from '../../helpers/bios_linkage';
import { parseLuaChunk } from '../../helpers/cpu_test_harness';
import { nativeConformanceRunner } from '../../helpers/native_conformance.mjs';
import { runSystemCaseRom } from '../../helpers/system_case_rom';

const nativeRunner = nativeConformanceRunner('bmsx_frame_evaluation_runner', { parallel: '2' });

const modules = ['base', 'number/parse', 'number/decimal', 'table', 'string/base', 'string/mapped', 'string/pack', 'string/float/encode', 'string/float/decode'].map(path => {
	const source = readFileSync(`machine/bios/${path}.lua`, 'utf8');
	return { path, source, chunk: parseLuaChunk(source, `${path}.lua`) };
});
const consoleSource = 'return { write = function() end, end_line = function() end }';
modules.push({ path: 'tty/console', source: consoleSource, chunk: parseLuaChunk(consoleSource) });
const values = [0, -0, Number.MIN_VALUE, -Number.MIN_VALUE, Number.MAX_VALUE, -Number.MAX_VALUE,
	2 ** -150, -(2 ** -150), 2 ** -149, 3 * 2 ** -150, 2 ** -126,
	(2 ** 23 - 1) * 2 ** -149, (2 ** 23 - 0.5) * 2 ** -149,
	2 ** -1022 - Number.MIN_VALUE, 2 ** -1022, 1 + 2 ** -24, 1 + 3 * 2 ** -24,
	2 - 2 ** -24, 1.5 + 2 ** -52, 2 - 2 ** -52,
	(2 - 2 ** -23) * 2 ** 127, (2 - 2 ** -24) * 2 ** 127];
const bits = new DataView(new ArrayBuffer(8));
const rows: string[] = [];
// Supply binary64 *fields* as two words; never put a host double in a
// guest literal. DataView independently narrows the field, then widens the
// resulting binary32 value for the encoder.
for (const value of values) {
	bits.setFloat64(0, value, true);
	const high = bits.getUint32(4, true), low = bits.getUint32(0, true);
	bits.setFloat32(0, value, true);
	const word = bits.getUint32(0, true);
	bits.setFloat64(0, bits.getFloat32(0, true), true);
	rows.push(`{decode(0x${high.toString(16)}, 0x${low.toString(16)}, 8), 4, 0x${word.toString(16)}, 0}`);
	rows.push(`{blua32.float_from_bits(0x${word.toString(16)}), 8, 0x${bits.getUint32(4, true).toString(16)}, 0x${bits.getUint32(0, true).toString(16)}}`);
}
for (const integer of [16777217, 2147483647, -2147483648]) {
	bits.setFloat64(0, integer, true);
	rows.push(`{0x${(integer >>> 0).toString(16)}, 8, 0x${bits.getUint32(4, true).toString(16)}, 0x${bits.getUint32(0, true).toString(16)}}`);
}
const source = `require('base')
local fields<const> = require('string/pack')
local strings<const> = require('string/base')
local byte<const> = strings.byte
local encode<const> = require('string/float/encode')
local decode<const> = require('string/float/decode')
local rows<const> = { ${rows.join(',\n')} }
for index = 1, #rows do
 local row<const> = rows[index]
 local high<const>, low<const> = encode(row[1], row[2])
 if high ~= row[3] or (row[2] == 8 and low ~= row[4]) then return false, false end
 local decoded<const> = decode(high, row[2] == 4 and 0 or low, row[2])
 local expected<const> = decode(row[3], row[4], row[2])
 if decoded ~= expected or (decoded == 0 and 1 / decoded ~= 1 / expected) then return false, false end
 for endian_index = 1, 2 do
  local format<const> = (endian_index == 1 and '<' or '>') .. (row[2] == 4 and 'f' or 'd')
  local packed<const> = fields.pack(format, row[1])
  if #packed ~= row[2] then return false, false end
  local unpacked<const>, next_position<const> = fields.unpack(format, packed)
  if unpacked ~= expected or next_position ~= row[2] + 1 then return false, false end
  if unpacked == 0 and 1 / unpacked ~= 1 / expected then return false, false end
  for octet = 1, row[2] do
   local digit_index<const> = endian_index == 1 and octet or row[2] + 1 - octet
   local word<const> = (row[2] == 4 or digit_index > 4) and row[3] or row[4]
   local expected_digit<const> = (word >> (8 * ((digit_index - 1) % 4))) & 0xff
   if byte(packed, octet) ~= expected_digit then return false, false end
  end
 end
end
return true, true`;
const numberTextSource = `rodata rounded: string = '' .. 1.234567
rodata negative_zero: string = '' .. -0.0
rodata infinity: string = '' .. (1 / 0)
rodata not_a_number: string = '' .. (0 / 0)
data numbers: f64[4] = { 1.234567, -0.0, 1 / 0, 0 / 0 }
local value = *numbers[0]
local zero = *numbers[1]
local inf = *numbers[2]
local nan = *numbers[3]
return *rounded == '1.234567' and ('' .. value) == *rounded
    and *negative_zero == '-0.0' and ('' .. zero) == *negative_zero,
    *infinity == 'inf' and ('' .. inf) == *infinity
    and *not_a_number == 'nan' and ('' .. nan) == *not_a_number`;
const participantSource = `data carried: word = 7
bss runs: word
local captured = 4
local function prepare<init>()
 *carried = *carried + captured
 captured = captured + 1
 *runs = *runs + 1
 return 99
end
local initialize<const> = blua32.closure(mem32le[mem32le[0x20] + 0x5c])
local cold<const> = *carried == 7 and *runs == 0
local first_result<const> = initialize()
local first<const> = first_result == nil and *carried == 11 and *runs == 1
local second_result<const> = initialize()
return cold and first, second_result == nil and *carried == 16 and *runs == 2 and captured == 6`;
const directory = mkdtempSync(join(tmpdir(), 'bmsx-bios-float-'));
try {
	for (const optLevel of [0, 3] as const) {
		const image = linkTestSystemBlua32(compileLuaChunkToProgram(parseLuaChunk(source), modules,
			{ entrySource: source, optLevel, programDomain: 'system' }));
		const publicBios = buildPublicBiosFixture(PUBLIC_BIOS_PROBE_SOURCE, optLevel);
		const numberText = linkTestSystemBlua32(compileLuaChunkToProgram(parseLuaChunk(numberTextSource), [],
			{ entrySource: numberTextSource, optLevel, programDomain: 'system' }));
		const participants = linkTestSystemBlua32(compileLuaChunkToProgram(parseLuaChunk(participantSource), [],
			{ entrySource: participantSource, optLevel, programDomain: 'system' }));
		for (const [name, rom] of [
			['float', image.romBytes], ['public-bios', publicBios.rom],
			['number-text', numberText.romBytes], ['participants', participants.romBytes],
		] as const) {
			const path = join(directory, `${name}-O${optLevel}.rom`);
			writeFileSync(path, rom);
			assert.equal(runSystemCaseRom(rom, () => assert.fail(name + ': unexpected suspension')), 0);
			assert.equal(execFileSync(nativeRunner, [path, 'run'], { encoding: 'utf8' }).trim(), '0');
		}
	}
	rmSync(directory, { recursive: true });
	console.log(`BIOS-FLOAT-PARITY:PASS (${rows.length} field vectors, Number text, BIOS lookup and participants at O0/O3, exact guest results)`);
} catch (error) { console.error(`Evidence retained: ${directory}`); throw error; }
