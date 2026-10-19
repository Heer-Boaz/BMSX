import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RunResult } from '../../../machine/ts/machine/cpu/cpu';
import { Runtime } from '../../../machine/ts/machine/runtime/runtime';
import { captureRuntimeSaveState } from '../../../machine/ts/machine/runtime/save_state';
import { decodeRuntimeSaveState } from '../../../machine/ts/machine/runtime/save_state/codec';
import { PSX_MACHINE_SPEC } from '../../../machine/ts/spec/bmsx/model';
import { compileLuaChunkToProgram } from '../../../toolchain/ts/lua/compiler';
import { linkTestSystemBlua32 } from '../../helpers/blua32';
import { parseLuaChunk } from '../../lua/cpu_test_harness';

for (const [command, args] of [
	['cmake', ['-S', 'machine/cpp', '-B', 'build-cpp-tests', '-G', 'Ninja', '-DBMSX_BUILD_TESTS=ON']],
	['cmake', ['--build', 'build-cpp-tests', '--target', 'bmsx_frame_evaluation_runner', '--parallel', '2']],
] as const) assert.equal(spawnSync(command, args, { stdio: 'inherit' }).status, 0);

const modules = ['base', 'table', 'string/base', 'string/utf8', 'string/pack', 'string/float/encode', 'string/float/decode'].map(path => {
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
for (const value of values) for (const size of [4, 8]) {
	if (size === 4) bits.setFloat32(0, value, true);
	else bits.setFloat64(0, value, true);
	rows.push(`{${Object.is(value, -0) ? '-0.0' : value}, ${size}, ${size === 4 ? bits.getUint32(0, true) : bits.getUint32(4, true)}, ${size === 4 ? 0 : bits.getUint32(0, true)}}`);
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
   local expected_digit<const> = (word // (256 ^ ((digit_index - 1) % 4))) % 256
   if byte(packed, octet) ~= expected_digit then return false, false end
  end
 end
end
return true, true`;
const directory = mkdtempSync(join(tmpdir(), 'bmsx-bios-float-'));
try {
	for (const optLevel of [0, 3] as const) {
		const image = linkTestSystemBlua32(compileLuaChunkToProgram(parseLuaChunk(source), modules,
			{ entrySource: source, optLevel, programDomain: 'system' }));
		const path = join(directory, `float-O${optLevel}.rom`);
		writeFileSync(path, image.romBytes);
		const runtime = new Runtime({ systemRomBytes: image.romBytes, cartridgeSlots: [null, null], machineModel: PSX_MACHINE_SPEC }, {
			sampleInputControllerSnapshot: () => {}, supervisorRequestLineHigh: () => false, applyInputControllerVibrationEffect: () => {},
		});
		runtime.boot();
		let result = RunResult.Yielded;
		for (let grant = 0; grant < 300 && result === RunResult.Yielded; grant++) result = runtime.machine.cpu.runUntilDepth(0, 100000);
		assert.equal(result, RunResult.Halted);
		assert.deepEqual(runtime.readCompletionValues(), [true, true]);
		assert.equal(spawnSync('build-cpp-tests/bmsx_frame_evaluation_runner', [path, 'run'], { stdio: 'inherit' }).status, 0);
		const native = decodeRuntimeSaveState(new Uint8Array(readFileSync(`${path}.state`)), PSX_MACHINE_SPEC.ramBytes, PSX_MACHINE_SPEC.gxGpuVramBytes);
		assert.deepEqual(native, captureRuntimeSaveState(runtime), `BIOS float O${optLevel}: complete TS/C++ state parity`);
	}
	rmSync(directory, { recursive: true });
	console.log(`BIOS-FLOAT-PARITY:PASS (${rows.length} field vectors at O0/O3, exact words and full state)`);
} catch (error) { console.error(`Evidence retained: ${directory}`); throw error; }
