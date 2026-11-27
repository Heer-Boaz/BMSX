import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { hashBytes } from '../../../machine/ts/common/hash';
import { CpuSuspendedRunResult } from '../../../machine/ts/machine/runtime/cpu_executor';
import { GC_LAST_EPOCH_WORK, GcPhase } from '../../../machine/ts/machine/cpu/gc_heap';
import { HEAP_GC_CONTROL_OFFSET } from '../../../machine/ts/machine/cpu/heap_allocator';
import { valueInteger } from '../../../machine/ts/machine/cpu/value';
import { Runtime } from '../../../machine/ts/machine/runtime/runtime';
import { applyRuntimeSaveState, captureRuntimeSaveState } from '../../../machine/ts/machine/runtime/save_state';
import { encodeRuntimeSaveState } from '../../../machine/ts/machine/runtime/save_state/codec';
import { HEAP_SERVICE_CLOSURE_OFFSET, HeapServiceClosureField } from '../../../machine/ts/spec/bmsx/heap_service';
import { PSX_MACHINE_SPEC } from '../../../machine/ts/spec/bmsx/model';
import { buildBlua32Image } from '../../../toolchain/ts/rompack/blua32_image_builder';
import { HEAP_SERVICE_MODULES } from '../../../toolchain/ts/rompack/blua32_heap_service';
import { writeTestBlua32Rom } from '../../helpers/blua32';
import { cartridgeSlots } from '../../helpers/cartridge';
import { parseLuaChunk } from '../../helpers/cpu_test_harness';
import { loadHeapServiceTestModules } from '../../helpers/heap_service_system';
import { nativeConformanceRunner } from '../../helpers/native_conformance.mjs';

const resetPath = 'kernel/reset';
const modules = [
	{ path: resetPath, source: readFileSync('machine/bios/' + resetPath + '.lua', 'utf8') },
	{ path: 'main', source: 'module<entry>\nreturn 37' },
].map(({ path, source }) => ({ path, displayPath: path + '.lua', source, chunk: parseLuaChunk(source, path) }));
const library = loadHeapServiceTestModules().map(module => ({ ...module, displayPath: module.path + '.lua' }));
const input = { sampleInputControllerSnapshot() {}, supervisorRequestLineHigh: () => false, applyInputControllerVibrationEffect() {} };

mkdirSync('tmp', { recursive: true });
const dir = mkdtempSync(join('tmp', 'boot-collection-'));
try {
	const native = nativeConformanceRunner('bmsx_heap_service_conformance_runner');
	for (const optLevel of [0, 3] as const) {
		const { linked } = buildBlua32Image({
			domain: 'system', luaModules: [...modules, ...library], generatedLuaModules: [], loadAddress: 0x100,
			ramByteCount: PSX_MACHINE_SPEC.ramBytes, optLevel, traceStatements: 'erase',
			resetModule: resetPath, preloadModules: HEAP_SERVICE_MODULES, biosExports: [],
		});
		const rom = writeTestBlua32Rom(linked);
		const runtime = new Runtime({ systemRomBytes: rom, cartridgeSlots: cartridgeSlots(), machineModel: PSX_MACHINE_SPEC }, input);
		runtime.boot();
		const { cpu, memory, scheduler } = runtime.machine;
		const heap = cpu.heapAllocator, control = heap.managementOffset() + HEAP_GC_CONTROL_OFFSET;
		const work = () => memory.readRamRecordWord(control + GC_LAST_EPOCH_WORK);
		const stage = heap.managementOffset() + HEAP_SERVICE_CLOSURE_OFFSET + HeapServiceClosureField.Destination;
		const commands: string[] = [], expected: string[] = [];
		const observe = (cmd: string, result?: string | number) => {
			commands.push(cmd);
			if (result !== undefined) expected.push(String(result));
		};
		const observeControl = () => observe(`H ${control} ${heap.allocatorStateOffset()}`,
			hashBytes(memory.ramData(), control, heap.allocatorStateOffset() - control));
		const grant = (cycles: number) => {
			const before = scheduler.nowCycles;
			const result = runtime.cpuExecution.runSuspendedUntilDepth(0, cycles);
			const elapsed = scheduler.nowCycles - before;
			observe(`D ${cycles}`, `${result} ${elapsed} ${+cpu.heapServiceActive()} ${memory.readRamRecordWord(stage)} ${heap.occupiedBytes()} ${cpu.luaHeap.usedBytes()}`);
			return result;
		};
		assert.equal(scheduler.nowCycles, 0);
		assert.equal(work(), 0, 'the emulator has not collected before the first ROM instruction');
		observeControl();
		for (let i = 0; i < 1024 && cpu.gc.phase() !== GcPhase.Mark; ++i) {
			assert.equal(grant(3), CpuSuspendedRunResult.Yielded);
		}
		assert.equal(cpu.gc.phase(), GcPhase.Mark, 'the authored reset code reached the collector in paid guest instructions');
		assert.ok(cpu.heapServiceActive() && scheduler.nowCycles > 0 && work() === 0);
		observeControl();

		const state = captureRuntimeSaveState(runtime);
		const romFile = join(dir, `system-O${optLevel}.rom`), trace = join(dir, `trace-O${optLevel}.txt`);
		const portable = join(dir, `mark-O${optLevel}.state`);
		writeFileSync(portable, encodeRuntimeSaveState(state));
		writeFileSync(romFile, rom);
		observe('S');
		const finish = () => {
			let result = CpuSuspendedRunResult.Yielded;
			for (let i = 0; i < 8192 && result === CpuSuspendedRunResult.Yielded; ++i) result = grant(127);
			assert.equal(result, CpuSuspendedRunResult.Completed);
			assert.deepEqual(runtime.readCompletionValues(), [valueInteger(37)]);
			assert.ok(work() > 0);
			assert.equal(cpu.gc.phase(), GcPhase.Pause);
			observe('C', 37);
			observeControl();
		};
		finish();
		applyRuntimeSaveState(runtime, state);
		observe('U');
		finish();
		applyRuntimeSaveState(runtime, state);
		observe('X');
		finish();
		writeFileSync(trace, commands.join('\n'));
		assert.deepEqual(execFileSync(native, [romFile, trace, portable], { encoding: 'utf8' }).trimEnd().split('\n'), expected);
		console.log(`BOOT-COLLECTION:PASS O${optLevel} first collection executes in the authored reset body; native and portable restart in Mark (${expected.length} observations)`);
	}
	rmSync(dir, { recursive: true });
} catch (error) {
	console.error(`Evidence retained: ${dir}`);
	throw error;
}
