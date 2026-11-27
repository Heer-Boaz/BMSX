import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { hashBytes } from '../../../machine/ts/common/hash';
import { CpuRunKind, RunResult } from '../../../machine/ts/machine/cpu/cpu';
import { ValueTag, valueInteger } from '../../../machine/ts/machine/cpu/value';
import { Runtime } from '../../../machine/ts/machine/runtime/runtime';
import { applyRuntimeSaveState, captureRuntimeSaveState } from '../../../machine/ts/machine/runtime/save_state';
import { CPU_RESET_BANK_ADDRESS, DYNAMIC_RAM_BASE, RAM_BASE } from '../../../machine/ts/spec/bmsx/memory_map';
import { PSX_MACHINE_SPEC } from '../../../machine/ts/spec/bmsx/model';
import { buildBlua32Image } from '../../../toolchain/ts/rompack/blua32_image_builder';
import { writeTestBlua32Rom } from '../../helpers/blua32';
import { parseLuaChunk } from '../../helpers/cpu_test_harness';
import { nativeConformanceRunner } from '../../helpers/native_conformance.mjs';

// This program owns two fixed-size blocks in public RAM. Neither its freelist
// nor its calling convention belongs to the installed BMSX memory runtime.
const head = DYNAMIC_RAM_BASE - 64, first = head + 16, second = head + 32;
const reset = `
local take<const> = function()
	local list<const>: *u32 = ${head}
	local found<const> = *list
	if found == 0 then return 0 end
	local link<const>: *u32 = found
	*list = *link
	return found
end
local release<const> = function(block)
	local list<const>: *u32 = ${head}
	local link<const>: *u32 = block
	*link = *list
	*list = block
end
local list<const>: *u32 = ${head}
local left<const>: *u32 = ${first}
local right<const>: *u32 = ${second}
*left = ${second}
*right = 0
*list = ${first}
local a<const>, b<const>, none<const> = take(), take(), take()
*left = 83
*right = 71
release(a)
local reused<const> = take()
return a, b, none, reused, *right, *list`;
const modules = [['main', 'module<entry>\nreturn 0'], ['reset', reset],
	['irq', 'halt_until_irq'], ['exception', 'halt_until_irq']].map(([path, source]) =>
	({ path, displayPath: path + '.lua', source, chunk: parseLuaChunk(source, path) }));

mkdirSync('tmp', { recursive: true });
const dir = mkdtempSync(join('tmp', 'bmsx-independent-firmware-'));
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
		assert.equal(cpu.rootThread.address, CPU_RESET_BANK_ADDRESS);
		const commands: string[] = [], observations: string[] = [];
		function grant(budget: number, expected: RunResult) {
			assert.equal(scheduler.runCpuSlice(0, budget, undefined, CpuRunKind.Scheduled), expected);
			assert.equal(cpu.heapAllocator.occupiedBytes(), 0);
			assert.equal(cpu.luaHeap.usedBytes(), 0);
			assert.equal(cpu.rootThread.address, CPU_RESET_BANK_ADDRESS);
			commands.push(`L ${budget}`);
			observations.push(`${expected} ${budget - cpu.instructionBudgetRemaining} 0 0 0`);
		}
		const base = head - RAM_BASE;
		function fingerprint() {
			commands.push(`H ${base} ${base + 64}`);
			observations.push(String(hashBytes(memory.ramData(), base, 64)));
		}
		const arena = cpu.heapAllocator.allocatorStateOffset();
		function uninitializedStockArena() {
			// Zero occupancy also describes a freshly initialized dlmalloc.
			// Its state words must never have been populated by this ROM's host.
			const words = memory.ramData().subarray(arena, arena + 32);
			assert.deepEqual(words, new Uint8Array(words.length));
			commands.push(`H ${arena} ${arena + words.length}`);
			observations.push(String(hashBytes(words, 0, words.length)));
		}
		uninitializedStockArena();
		let used = false;
		for (let step = 0; step < 512; ++step) {
			grant(1, RunResult.Yielded);
			const payload = memory.readMappedWord(first);
			if (used && payload === 0) break;
			used ||= payload === 83;
		}
		assert.ok(used);
		assert.equal(memory.readMappedWord(first), 0, 'the free block link has been stored');
		assert.equal(memory.readMappedWord(head), 0, 'the release has not published the head yet');
		assert.equal(cpu.readLuaFaultReasonWord(), 0);
		fingerprint();
		uninitializedStockArena();
		const midpoint = captureRuntimeSaveState(runtime);
		commands.push('S');
		const result = [first, second, 0, first, 71, 0];
		function finish() {
			grant(4096, RunResult.Halted);
			assert.deepEqual(runtime.readCompletionValues(), result.map(valueInteger));
			assert.equal(cpu.readLuaFaultReasonWord(), 0);
			fingerprint();
			uninitializedStockArena();
			commands.push('c');
			observations.push([result.length, ...result.flatMap(word => [ValueTag.Integer, word])].join(' '));
		}
		finish();
		applyRuntimeSaveState(runtime, midpoint);
		commands.push('U');
		finish();
		const rom = join(dir, `system-O${optLevel}.rom`), path = join(dir, `trace-O${optLevel}.txt`);
		writeFileSync(rom, romBytes);
		writeFileSync(path, commands.join('\n'));
		const out = execFileSync(native, [rom, path, join(dir, 'unused.state')], { encoding: 'utf8' }).trimEnd().split('\n');
		assert.deepEqual(out, observations);
		console.log(`INDEPENDENT-SYSTEM-ROM:PASS O${optLevel} (private software allocator, ordinary CALL, same RAM and cycles at mid-release and after restore)`);
	}
	rmSync(dir, { recursive: true });
} catch (error) {
	console.error(`Evidence retained at ${dir}`);
	throw error;
}
