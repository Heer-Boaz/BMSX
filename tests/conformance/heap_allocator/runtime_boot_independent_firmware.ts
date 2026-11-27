import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hashBytes } from '../../../machine/ts/common/hash';
import { CpuRunKind, RunResult } from '../../../machine/ts/machine/cpu/cpu';
import { ValueTag, valueInteger } from '../../../machine/ts/machine/cpu/value';
import { Runtime } from '../../../machine/ts/machine/runtime/runtime';
import { applyRuntimeSaveState, captureRuntimeSaveState } from '../../../machine/ts/machine/runtime/save_state';
import { decodeRuntimeSaveState, encodeRuntimeSaveState } from '../../../machine/ts/machine/runtime/save_state/codec';
import { CPU_FIXED_STACK_BASE, CPU_RESET_BANK_ADDRESS, RAM_BASE } from '../../../machine/ts/spec/bmsx/memory_map';
import { PSX_MACHINE_SPEC } from '../../../machine/ts/spec/bmsx/model';
import { buildBlua32Image } from '../../../toolchain/ts/rompack/blua32_image_builder';
import { writeTestBlua32Rom } from '../../helpers/blua32';
import { parseLuaChunk } from '../../helpers/cpu_test_harness';
import { nativeConformanceRunner } from '../../helpers/native_conformance.mjs';

// These addresses deliberately overlap the stock BIOS's software state, not
// the fixed CPU bank. This ROM uses its own format and never links stock code.
const collector = CPU_FIXED_STACK_BASE + 0x344;
const allocator = CPU_FIXED_STACK_BASE + 0x400;
const first = CPU_FIXED_STACK_BASE - 0x200, second = first + 16, unreachable = second + 16;
const signature = 0x61b10f4d, sweeping = 0x5a51000d, settled = 0x5a510015;
const reset = `
local initialize<const> = function()
	local pool<const>: *u32 = ${allocator}
	pool[0], pool[1] = ${signature}, 0
	local nodes<const>: *u32 = ${first}
	nodes[0], nodes[4], nodes[8] = ${second}, 0, ${first}
	nodes[1], nodes[5], nodes[9] = 0, 0, 0
	nodes[2], nodes[6], nodes[10] = 31, 59, 73
end
local collect<const> = function(root)
	local state<const>: *u32 = ${collector}
	local pool<const>: *u32 = ${allocator}
	local cursor = root
	while cursor ~= 0 do
		local object<const>: *u32 = cursor
		object[1] = 1
		cursor = object[0]
	end
	state[0] = ${sweeping}
	for address = ${first}, ${unreachable}, 16 do
		local object<const>: *u32 = address
		if object[1] == 0 then
			object[0] = pool[1]
			pool[1] = address
		end
	end
	state[0] = ${settled}
end
local take<const> = function()
	local pool<const>: *u32 = ${allocator}
	local result<const> = pool[1]
	if result == 0 then return 0 end
	local free<const>: *u32 = result
	pool[1] = free[0]
	return result
end
initialize()
collect(${first})
local reused<const>, exhausted<const> = take(), take()
local nodes<const>: *u32 = ${first}
return reused, exhausted, nodes[2], nodes[6], nodes[10]`;
const modules = [['main', 'module<entry>\nreturn 0'], ['reset', reset],
	['irq', 'halt_until_irq'], ['exception', 'halt_until_irq']].map(([path, source]) =>
	({ path, displayPath: path + '.lua', source, chunk: parseLuaChunk(source, path) }));

const dir = mkdtempSync(join(tmpdir(), 'bmsx-independent-firmware-'));
try {
	const native = nativeConformanceRunner('bmsx_heap_service_conformance_runner');
	for (const optLevel of [0, 3] as const) {
		const { linked } = buildBlua32Image({
			domain: 'system', luaModules: modules, generatedLuaModules: [], loadAddress: 0x100,
			ramByteCount: PSX_MACHINE_SPEC.ramBytes, optLevel, traceStatements: 'erase',
			resetModule: 'reset', irqModule: 'irq', exceptionModule: 'exception', biosExports: [],
		});
		const romBytes = writeTestBlua32Rom(linked);
		const runtime = new Runtime({ systemRomBytes: romBytes, cartridgeSlots: [null, null], machineModel: PSX_MACHINE_SPEC }, {
			sampleInputControllerSnapshot() {}, supervisorRequestLineHigh: () => false, applyInputControllerVibrationEffect() {},
		});
		runtime.boot();
		const { cpu, scheduler, memory } = runtime.machine;
		const raw = memory.ramData();
		const allocatorOffset = allocator - RAM_BASE, collectorOffset = collector - RAM_BASE;
		assert.deepEqual(raw.subarray(allocatorOffset, allocatorOffset + 32), new Uint8Array(32));
		assert.equal(memory.readRamRecordWord(collector), 0);
		const rom = join(dir, `system-O${optLevel}.rom`), trace = join(dir, `trace-O${optLevel}.txt`);
		const tsState = join(dir, `O${optLevel}.state`), nativeState = join(dir, `O${optLevel}.native`);
		const commands: string[] = [], observations: string[] = [];
		function grant(budget: number, expected: RunResult) {
			assert.equal(scheduler.runCpuSlice(0, budget, 0, CpuRunKind.Scheduled), expected);
			assert.equal(cpu.rootThread.address, CPU_RESET_BANK_ADDRESS);
			// Sample only machine state; the stock allocation diagnostics may
			// not interpret this ROM's different software representation.
			commands.push(`E ${budget}`);
			observations.push(`${expected} ${budget - cpu.instructionBudgetRemaining} ${memory.ramBusEnd()} ${cpu.activeCartridgeSlot()}`);
		}
		function fingerprint() {
			for (const [offset, count] of [[allocatorOffset, 32], [collectorOffset, 4], [first - RAM_BASE, 48]]) {
				commands.push(`H ${offset} ${offset + count}`);
				observations.push(String(hashBytes(raw, offset, count)));
			}
		}
		fingerprint();
		for (let step = 0; step < 512; ++step) {
			grant(1, RunResult.Yielded);
			if (memory.readRamRecordWord(collector) === sweeping && memory.readRamRecordWord(unreachable) === 0) break;
		}
		assert.equal(memory.readRamRecordWord(collector), sweeping);
		assert.equal(memory.readRamRecordWord(first), second);
		assert.deepEqual([first, second, unreachable].map(address => memory.readRamRecordWord(address + 4)), [1, 1, 0]);
		assert.equal(memory.readRamRecordWord(unreachable), 0, 'the free block link has been stored');
		assert.equal(memory.readRamRecordWord(allocator + 4), 0, 'the sweep has not published the free head yet');
		assert.equal(memory.readRamRecordWord(allocator), signature);
		fingerprint();
		const midpoint = captureRuntimeSaveState(runtime);
		writeFileSync(tsState, encodeRuntimeSaveState(midpoint));
		commands.push('S', `x ${nativeState}`);
		const result = [unreachable, 0, 31, 59, 73];
		function finish() {
			const start = observations.length;
			grant(4096, RunResult.Halted);
			assert.deepEqual(runtime.readCompletionValues(), result.map(valueInteger));
			assert.equal(cpu.captureRuntimeState().hardHalted, false);
			assert.equal(cpu.readLuaFaultReasonWord(), 0);
			assert.equal(memory.readRamRecordWord(collector), settled);
			assert.equal(memory.readRamRecordWord(allocator), signature);
			assert.equal(memory.readRamRecordWord(allocator + 4), 0);
			assert.deepEqual(raw.subarray(allocatorOffset + 8, allocatorOffset + 32), new Uint8Array(24));
			fingerprint();
			commands.push('c');
			observations.push([result.length, ...result.flatMap(word => [ValueTag.Integer, word])].join(' '));
			return observations.slice(start);
		}
		const ending = finish();
		applyRuntimeSaveState(runtime, midpoint);
		commands.push('U');
		assert.deepEqual(finish(), ending);
		applyRuntimeSaveState(runtime, midpoint);
		commands.push('X');
		assert.deepEqual(finish(), ending);
		writeFileSync(rom, romBytes);
		writeFileSync(trace, commands.join('\n'));
		const out = execFileSync(native, [rom, trace, tsState], { encoding: 'utf8' }).trimEnd().split('\n');
		assert.deepEqual(out, observations);
		applyRuntimeSaveState(runtime, decodeRuntimeSaveState(readFileSync(nativeState), PSX_MACHINE_SPEC.ramBytes, PSX_MACHINE_SPEC.gxGpuVramBytes));
		assert.deepEqual(finish(), ending);
		console.log(`INDEPENDENT-SYSTEM-ROM:PASS O${optLevel} (different private allocator and collector, same RAM and cycles mid-sweep and after portable restore)`);
	}
	rmSync(dir, { recursive: true });
} catch (error) {
	console.error(`Evidence retained at ${dir}`);
	throw error;
}
