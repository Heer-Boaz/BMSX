import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hashBytes } from '../../../machine/ts/common/hash';
import { CpuSuspendedRunResult } from '../../../machine/ts/machine/runtime/cpu_executor';
import { GC_LAST_EPOCH_WORK, GcPhase } from '../../../machine/ts/machine/cpu/gc_heap';
import { HEAP_GC_CONTROL_OFFSET } from '../../../machine/ts/machine/cpu/heap_allocator';
import { valueInteger } from '../../../machine/ts/machine/cpu/value';
import { Runtime } from '../../../machine/ts/machine/runtime/runtime';
import { applyRuntimeSaveState, captureRuntimeSaveState } from '../../../machine/ts/machine/runtime/save_state';
import { encodeRuntimeSaveState } from '../../../machine/ts/machine/runtime/save_state/codec';
import { CPU_CAUSE_CODE_SYSCALL } from '../../../machine/ts/spec/blua32/cop0';
import { CPU_INTERRUPTED_CONTEXT_ADDRESS, CPU_RESET_BANK_ADDRESS } from '../../../machine/ts/spec/bmsx/memory_map';
import { PSX_MACHINE_SPEC } from '../../../machine/ts/spec/bmsx/model';
import { writeTestBlua32Rom } from '../../helpers/blua32';
import { cartridgeSlots } from '../../helpers/cartridge';
import { linkManagedTestSystem } from '../../helpers/managed_system';
import { nativeConformanceRunner } from '../../helpers/native_conformance.mjs';

const input = { sampleInputControllerSnapshot() {}, supervisorRequestLineHigh: () => false, applyInputControllerVibrationEffect() {} };

const dir = mkdtempSync(join(tmpdir(), 'boot-collection-'));
try {
	const native = nativeConformanceRunner('bmsx_heap_service_conformance_runner');
	for (const optLevel of [0, 3] as const) {
		const linked = linkManagedTestSystem('return 37', optLevel);
		const rom = writeTestBlua32Rom(linked);
		const runtime = new Runtime({ systemRomBytes: rom, cartridgeSlots: cartridgeSlots(), machineModel: PSX_MACHINE_SPEC }, input);
		runtime.boot();
		const { cpu, memory, scheduler } = runtime.machine;
		const heap = cpu.heapAllocator, control = heap.managementOffset() + HEAP_GC_CONTROL_OFFSET;
		const work = () => memory.readRamRecordWord(control + GC_LAST_EPOCH_WORK);

		const commands: string[] = [], expected: string[] = [];
		const observe = (cmd: string, result?: string | number) => {
			commands.push(cmd);
			if (result !== undefined) expected.push(String(result));
		};
		const observeControl = () => observe(`H ${control} ${heap.allocatorStateOffset()}`,
			hashBytes(memory.ramData(), control, heap.allocatorStateOffset() - control));
		const grant = (cycles: number) => {
			const before = scheduler.nowCycles;
			const result = runtime.cpuExecution.runSuspendedUntilDepth(0, cycles, cpu.rootThread.address);
			const elapsed = scheduler.nowCycles - before;
			observe(`D ${cycles}`, `${result} ${elapsed} ${+cpu.fixedInterruptActive()} ${heap.occupiedBytes()} ${cpu.luaHeap.usedBytes()}`);
			return result;
		};
		assert.equal(scheduler.nowCycles, 0);
		assert.equal(work(), 0, 'the emulator has not collected before the first ROM instruction');
		assert.equal(heap.occupiedBytes(), 0);
		assert.equal(cpu.luaHeap.usedBytes(), 0);
		assert.equal(cpu.rootThread.address, CPU_RESET_BANK_ADDRESS);
		observeControl();

		// The raw reset program retires at CONTEXT; its original depth is
		// complete before the receiving System stage can issue its first SVC.
		for (let i = 0; i < 1024 && cpu.rootThread.address === CPU_RESET_BANK_ADDRESS; ++i) {
			const result = grant(4093);
			assert.equal(result, cpu.rootThread.address === CPU_RESET_BANK_ADDRESS
				? CpuSuspendedRunResult.Yielded : CpuSuspendedRunResult.Completed);
			assert.equal(work(), 0);
		}
		assert.notEqual(cpu.rootThread.address, CPU_RESET_BANK_ADDRESS);
		assert.equal(cpu.gc.phase(), GcPhase.Pause);
		assert.ok(heap.occupiedBytes() > 0);
		for (let i = 0; i < 1024 && cpu.gc.phase() !== GcPhase.Mark; ++i) {
			assert.equal(grant(3), CpuSuspendedRunResult.Yielded);
		}
		assert.equal(cpu.gc.phase(), GcPhase.Mark, 'the authored managed reset stage reached the collector in paid guest instructions');
		assert.ok(cpu.fixedInterruptActive() && scheduler.nowCycles > 0 && work() === 0);
		assert.equal(cpu.readCauseWord(), CPU_CAUSE_CODE_SYSCALL);
		assert.equal(memory.readRamRecordWord(CPU_INTERRUPTED_CONTEXT_ADDRESS), cpu.rootThread.address);
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
		console.log(`BOOT-COLLECTION:PASS O${optLevel} ordinary reset admits the managed stage before collection; native and portable restart in Mark (${expected.length} observations)`);
	}
	rmSync(dir, { recursive: true });
} catch (error) {
	console.error(`Evidence retained: ${dir}`);
	throw error;
}
