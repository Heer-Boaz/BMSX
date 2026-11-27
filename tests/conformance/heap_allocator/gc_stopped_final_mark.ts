import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { hashBytes } from '../../../machine/ts/common/hash';
import { CpuRunKind } from '../../../machine/ts/machine/cpu/cpu';
import { FrameField } from '../../../machine/ts/machine/cpu/call_state';
import { GcPhase } from '../../../machine/ts/machine/cpu/gc_heap';
import { GC_STEP_WORDS } from '../../../machine/ts/machine/cpu/lua_heap';
import { ValueTag, valueInteger, valueNil, valueString, valueTable, valueTag } from '../../../machine/ts/machine/cpu/value';
import { CpuSuspendedRunResult } from '../../../machine/ts/machine/runtime/cpu_executor';
import { Runtime } from '../../../machine/ts/machine/runtime/runtime';
import { applyRuntimeSaveState, captureRuntimeSaveState } from '../../../machine/ts/machine/runtime/save_state';
import { decodeRuntimeSaveState, encodeRuntimeSaveState } from '../../../machine/ts/machine/runtime/save_state/codec';
import { LogicalTickResult } from '../../../machine/ts/machine/scheduler/frame';
import { HEAP_SERVICE_FRAME_OFFSET, HeapServiceOperation } from '../../../machine/ts/spec/bmsx/heap_service';
import { RAM_BASE } from '../../../machine/ts/spec/bmsx/memory_map';
import { PSX_MACHINE_SPEC } from '../../../machine/ts/spec/bmsx/model';
import { linkTestSystemBlua32 } from '../../helpers/blua32';
import { cartridgeSlots } from '../../helpers/cartridge';
import { compileHeapServiceSystem } from '../../helpers/heap_service_system';
import { nativeConformanceRunner } from '../../helpers/native_conformance.mjs';

const source = 'function exception() end\nwhile true do halt_until_irq end';
const input = { sampleInputControllerSnapshot() {}, supervisorRequestLineHigh: () => false, applyInputControllerVibrationEffect() {} };
const directory = mkdtempSync(join('tmp', 'bmsx-stopped-final-mark-'));
try {
	const native = nativeConformanceRunner('bmsx_heap_service_conformance_runner');
	for (const opt of [0, 3] as const) {
		const system = linkTestSystemBlua32(compileHeapServiceSystem(source, opt));
		const rom = join(directory, `system-O${opt}.rom`);
		writeFileSync(rom, system.romBytes);
		for (const mode of [CpuRunKind.Scheduled, CpuRunKind.Direct] as const) {
			const id = `O${opt}-${mode === CpuRunKind.Direct ? 'direct' : 'scheduled'}`;
			const config = { systemRomBytes: system.romBytes, cartridgeSlots: cartridgeSlots(), machineModel: PSX_MACHINE_SPEC };
			const runtime = new Runtime(config, input), oracle = new Runtime(config, input);
			runtime.boot();
			oracle.boot();
			const { cpu, memory, scheduler } = runtime.machine, { gc } = cpu;
			for (let n = 0; n < 256 && !cpu.isHaltedUntilIrq(); ++n) scheduler.runCpuSlice(0, 1024, undefined, CpuRunKind.Scheduled);
			assert.ok(cpu.isHaltedUntilIrq(), 'the ordinary System frame is stopped at a real HALT');
			assert.equal(cpu.heapServiceActive(), false);
			const depth = cpu.getFrameDepth(), pc = cpu.readFramePc(depth - 1), origin = scheduler.nowCycles;
			const slots = 2 * GC_STEP_WORDS, weak = cpu.createTable(slots, 0), meta = cpu.createTable(0, 1);
			gc.tables.set(meta, valueString(gc['modeKey']), valueString(cpu.stringPool.intern('v')));
			gc.tables.setMetatableAddress(weak, meta);
			gc.tables.set(weak, valueInteger(1), valueTable(cpu.createTable()));
			gc.tables.set(weak, valueInteger(slots), valueTable(cpu.createTable()));
			cpu.setGlobalByKey(cpu.stringPool.intern('stopped remark weak array'), valueTable(weak));
			for (let n = 0; n < 64 && !gc.finalMarkPending(); ++n) gc.step();
			assert.equal(gc.phase(), GcPhase.Atomic);
			const target = cpu['systemImage'].heapServiceFunctions![HeapServiceOperation.StoppedFinalMark];
			const activation = cpu.heapAllocator.managementOffset() + HEAP_SERVICE_FRAME_OFFSET + FrameField.Function;
			const epochWork = gc.epochWork(), initial = captureRuntimeSaveState(runtime);
			const seed = join(directory, `${id}.seed`);
			writeFileSync(seed, encodeRuntimeSaveState(initial));
			applyRuntimeSaveState(oracle, initial);
			const reference = oracle.machine.cpu.gc;
			if (mode === CpuRunKind.Direct) reference.finishFinalMark();
			else do { reference.stepFinalMark(GC_STEP_WORDS); } while (reference.finalMarkPending());
			assert.equal(reference.phase(), GcPhase.Sweep);
			assert.ok(reference.epochWork() - epochWork > GC_STEP_WORDS, 'the stopped source consists of multiple native quanta');

			const trace: string[] = [], expected: string[] = [];
			function observe(command: string, result?: string | number) {
				trace.push(command);
				if (result !== undefined) expected.push(String(result));
			}
			function grant(cycles: number, scheduled = mode === CpuRunKind.Scheduled) {
				const elapsed = scheduler.nowCycles, previous = runtime.frameScheduler.lastTickSequence;
				if (scheduled) {
					const result = runtime.frameScheduler.advanceLogicalTick(cycles);
					assert.notEqual(result, LogicalTickResult.Maintenance);
					observe(`p ${cycles}`, `${+(result === LogicalTickResult.Completed)} ${scheduler.nowCycles - elapsed} ${runtime.frameScheduler.lastTickSequence - previous} ${+cpu.heapServiceActive()} ${+cpu.isHaltedUntilIrq()}`);
				} else {
					const result = runtime.cpuExecution.runSuspendedUntilDepth(depth, cycles);
					assert.equal(result, cpu.heapServiceActive() ? CpuSuspendedRunResult.Yielded : CpuSuspendedRunResult.Completed);
					observe(`q ${depth} ${cycles}`, `${result} ${scheduler.nowCycles - elapsed} ${+cpu.heapServiceActive()} ${cpu.getFrameDepth()} ${cpu.readFramePc(depth - 1)} ${+cpu.isHaltedUntilIrq()}`);
				}
				return scheduler.nowCycles - elapsed;
			}
			assert.equal(grant(0), 0);
			assert.ok(cpu.heapServiceActive());
			assert.equal(memory.readRamRecordWord(activation), target);
			assert.equal(gc.epochWork(), epochWork);
			assert.equal(gc.phase(), GcPhase.Atomic);
			assert.equal(cpu.readFramePc(depth - 1), pc);
			assert.ok(grant(1) > 0, 'ordinary instructions, not a zero-clock maintenance pulse');
			let observedIntermediateCredit = false;
			for (let i = 0; i < 4096 && gc.tables.getInteger(weak, 1) !== valueNil(); ++i) {
				assert.ok(grant(251) > 0);
				if (gc.epochWork() !== epochWork) observedIntermediateCredit = true;
			}
			assert.ok(cpu.heapServiceActive());
			assert.equal(gc.phase(), GcPhase.Atomic);
			assert.equal(gc.tables.getInteger(weak, 1), valueNil());
			assert.equal(valueTag(gc.tables.getInteger(weak, slots)), ValueTag.Table);
			assert.equal(cpu.readFramePc(depth - 1), pc);
			assert.ok(scheduler.nowCycles > origin);
			cpu.requestNonMaskableInterrupt();
			observe('N');
			assert.equal(cpu.enterPendingInterrupt(), false);
			observe('I', 0);

			const partial = captureRuntimeSaveState(runtime), prefix = trace.length, prefixResults = expected.length;
			const resume = join(directory, `${id}.partial`), nativeSave = join(directory, `${id}.cpp`);
			writeFileSync(resume, encodeRuntimeSaveState(partial));
			function complete() {
				let intermediate = observedIntermediateCredit;
				// The Direct executor can stop at the exact depth at which the
				// already admitted activation returns; the pinned mode is unchanged.
				for (let i = 0; i < 4096 && cpu.heapServiceActive(); ++i) {
					assert.ok(grant(509, false) > 0);
					if (gc.phase() === GcPhase.Atomic && gc.epochWork() !== epochWork) intermediate = true;
				}
				assert.equal(cpu.heapServiceActive(), false);
				assert.equal(gc.phase(), GcPhase.Sweep);
				assert.equal(intermediate, mode === CpuRunKind.Scheduled, 'source chooses which accumulated work is published between native chunks');
				assert.equal(gc.epochWork(), reference.epochWork());
				assert.equal(gc.tables.getInteger(weak, slots), valueNil());
				assert.equal(cpu.readFramePc(depth - 1), pc);
				assert.equal(cpu.isHaltedUntilIrq(), true);
				observe('P', `${depth} ${pc}`);
				const first = memory.ramBusEnd() - RAM_BASE, end = memory.ramData().length;
				observe(`H ${first} ${end}`, hashBytes(memory.ramData(), first, end - first));
				assert.equal(cpu.enterPendingInterrupt(), true);
				observe('I', 1);
			}
			complete();
			const tail = trace.slice(prefix), rows = expected.slice(prefixResults);
			function check(label: string, state: string, commands: string[], results: string[]) {
				const input = join(directory, `${id}-${label}.trace`);
				writeFileSync(input, commands.join('\n'));
				const output = execFileSync(native, [rom, input, state], { encoding: 'utf8' }).trimEnd().split('\n');
				const diff = output.findIndex((actual, index) => actual !== results[index]);
				assert.equal(diff, -1, `${id}/${label} native=${output[diff]} TS=${results[diff]} at row ${diff}`);
				assert.equal(output.length, results.length);
			}
			check('admission', seed, ['X', ...trace], expected);
			check('resume', resume, ['X', 'l', 's', `x ${nativeSave}`, ...tail, 'u', ...tail], [...rows, ...rows]);
			applyRuntimeSaveState(runtime, decodeRuntimeSaveState(readFileSync(nativeSave), PSX_MACHINE_SPEC.ramBytes, PSX_MACHINE_SPEC.gxGpuVramBytes));
			trace.length = prefix;
			expected.length = prefixResults;
			complete();
			assert.deepEqual(expected.slice(prefixResults), rows);
			console.log(`BIOS-STOPPED-FINAL-MARK:PASS ${id} (${gc.epochWork() - epochWork} policy words, timed grants and bidirectional checkpoint)`);
		}
	}
	rmSync(directory, { recursive: true });
} catch (error) {
	console.error(`Evidence retained: ${directory}`);
	throw error;
}
