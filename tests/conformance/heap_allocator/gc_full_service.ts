import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { hashBytes } from '../../../machine/ts/common/hash';
import { CpuRunKind, RunResult } from '../../../machine/ts/machine/cpu/cpu';
import { GcPhase } from '../../../machine/ts/machine/cpu/gc_heap';
import { FrameField } from '../../../machine/ts/machine/cpu/call_state';
import { HEAP_GC_CONTROL_OFFSET } from '../../../machine/ts/machine/cpu/heap_allocator';
import { asInteger, valueInteger, valueNil, valueString, valueTable } from '../../../machine/ts/machine/cpu/value';
import { RamHistory } from '../../../machine/ts/machine/runtime/history/ram_history';
import { Runtime } from '../../../machine/ts/machine/runtime/runtime';
import { applyRuntimeCheckpointState, applyRuntimeSaveState, captureRuntimeCheckpointState, captureRuntimeSaveState, RuntimeRestoreOrigin } from '../../../machine/ts/machine/runtime/save_state';
import { decodeRuntimeSaveState, encodeRuntimeSaveState } from '../../../machine/ts/machine/runtime/save_state/codec';
import { HEAP_SERVICE_FRAME_OFFSET, HEAP_SERVICE_TRACE_QUANTUM_OFFSET, HeapServiceGcStage, HeapServiceTraceField } from '../../../machine/ts/spec/bmsx/heap_service';
import { RAM_BASE } from '../../../machine/ts/spec/bmsx/memory_map';
import { PSX_MACHINE_SPEC } from '../../../machine/ts/spec/bmsx/model';
import { linkTestSystemBlua32 } from '../../helpers/blua32';
import { cartridgeSlots } from '../../helpers/cartridge';
import { compileHeapServiceSystem, residentFunctionAddress } from '../../helpers/heap_service_system';
import { nativeConformanceRunner } from '../../helpers/native_conformance.mjs';

const input = { sampleInputControllerSnapshot() {}, supervisorRequestLineHigh: () => false, applyInputControllerVibrationEffect() {} };
const source = 'fixture_collect()\nreturn 73';
const boot = { path: 'fixture_collect_boot', source: "local heap<const> = require('kernel/gc_full'); fixture_collect = function() heap.collect_full() end" };
const deadText = 'full collection must reclaim an unrooted Text value'.repeat(256);

mkdirSync('tmp', { recursive: true });
const directory = mkdtempSync(join('tmp', 'bmsx-gc-full-'));
try {
	const native = nativeConformanceRunner('bmsx_heap_service_conformance_runner');
	for (const opt of [0, 3] as const) {
		const system = linkTestSystemBlua32(compileHeapServiceSystem(source, opt, [boot]));
		const rom = join(directory, `O${opt}.rom`);
		writeFileSync(rom, system.romBytes);
		for (const alreadyActive of [false, true]) {
			const name = `O${opt}-${alreadyActive ? 'active' : 'paused'}`;
			const configuration = { systemRomBytes: system.romBytes, cartridgeSlots: cartridgeSlots(), machineModel: PSX_MACHINE_SPEC };
			const runtime = new Runtime(configuration, input);
			runtime.boot();
			const { cpu, memory, scheduler } = runtime.machine, { gc, heapAllocator: arena } = cpu;
			const management = arena.managementOffset(), traceLimit = management + HEAP_SERVICE_TRACE_QUANTUM_OFFSET + HeapServiceTraceField.Limit;
			const control = management + HEAP_GC_CONTROL_OFFSET;
			cpu.luaHeap.setCollectionTarget(cpu.luaHeap.capacity());
			cpu.activeThread.resizeStack(512);
			const weak = cpu.createTable(4, 0), metatable = cpu.createTable(0, 1), hidden = cpu.createTable(), floating = cpu.createTable();
			gc.tables.set(metatable, valueString(gc['modeKey']), valueString(cpu.stringPool.intern('v')));
			gc.tables.setMetatableAddress(weak, metatable);
			gc.tables.set(weak, valueInteger(1), valueTable(hidden));
			cpu.setGlobalByKey(cpu.stringPool.intern('full-collection-root'), valueTable(weak));
			const dropped = cpu.stringPool.intern(deadText);
			if (alreadyActive) {
				gc.step(valueTable(floating), valueNil(), valueNil(), 0, false, 1);
				assert.notEqual(gc.phase(), GcPhase.Pause);
			}
			const seed = join(directory, `${name}.seed`), partial = join(directory, `${name}.partial`);
			const nativePartial = join(directory, `${name}.native`);
			writeFileSync(seed, encodeRuntimeSaveState(captureRuntimeSaveState(runtime)));
			const history = new RamHistory();
			history.start(memory);
			const historyBase = history.capture(memory, null);
			const commands: string[] = [], expected: string[] = [];
			function observe(command: string, output: string | number) {
				commands.push(command);
				expected.push(String(output));
			}
			function grant(cycles: number) {
				const result = scheduler.runCpuSlice(0, cycles, undefined, CpuRunKind.Scheduled);
				const used = cycles - cpu.instructionBudgetRemaining;
				const stage = gc.serviceStage();
				assert.equal(stage, HeapServiceGcStage.Idle, 'the host does not select a collector phase or start nested services');
				observe(`L ${cycles}`, `${result} ${used} ${+cpu.heapServiceActive()} ${stage} ${gc.fullEpochs()} ${gc.phase()} ${cpu.luaHeap.usedBytes()}`);
				if (cycles > 0) assert.ok(used > 0, 'an admitted quantum pays ordinary instruction cycles');
				return result;
			}
			const entry = residentFunctionAddress(system, 'kernel/gc_full', 'collect_full');
			const root = management + HEAP_SERVICE_FRAME_OFFSET + FrameField.Function;
			const explicitCollection = () => cpu.heapServiceActive() && memory.readRamRecordWord(root) === entry;
			for (let i = 0; i < 4096 && !explicitCollection(); ++i) grant(1);
			assert.equal(explicitCollection(), true, 'the ordinary CALL enters the linked fixed ROM function');
			assert.equal(gc.fullEpochs(), 0, 'the CPU did not write the epoch policy during the CALL');
			const caller = cpu.getFrameDepth() - 1, successor = cpu.readFramePc(caller), epochs = alreadyActive ? 2 : 1;
			function held() {
				assert.equal(cpu.readFramePc(caller), successor);
				observe('P', `${caller + 1} ${successor}`);
			}
			for (let i = 0; i < 256 && !gc.fullEpochs(); ++i) assert.equal(grant(1), RunResult.Yielded);
			assert.equal(gc.fullEpochs(), epochs);
			held();
			for (let i = 0; i < 1024 && memory.readRamRecordWord(traceLimit) === 0; ++i) grant(1);
			assert.ok(memory.readRamRecordWord(traceLimit) > 1, 'one-cycle host fragments must not shorten the allowance to the next hardware event');
			observe(`H ${traceLimit} ${traceLimit + 4}`, hashBytes(memory.ramData(), traceLimit, 4));
			for (let i = 0; i < 8192 && gc.tables.get(weak, valueInteger(1)) !== valueNil(); ++i) grant(113);
			assert.equal(gc.tables.get(weak, valueInteger(1)), valueNil(), 'the real weak entry is cleared in firmware');
			assert.equal(gc.fullEpochs(), epochs);
			assert.equal(cpu.heapServiceActive(), true);
			held();
			cpu.requestNonMaskableInterrupt();
			assert.equal(cpu.enterPendingInterrupt(), false, 'NMI cannot take over the collector activation');
			cpu.cancelNonMaskableInterrupt();
			const checkpoint = captureRuntimeCheckpointState(runtime);
			writeFileSync(partial, encodeRuntimeSaveState(captureRuntimeSaveState(runtime)));
			const interrupted = history.capture(memory, historyBase);
			const prefix = commands.length;
			function finish() {
				let remaining = gc.fullEpochs(), reductions = 0;
				while (cpu.heapServiceActive()) {
					assert.ok(commands.length < prefix + 8192);
					assert.equal(grant(71), RunResult.Yielded);
					if (gc.fullEpochs() < remaining) {
						assert.equal(gc.fullEpochs(), remaining - 1);
						if (remaining === 2) assert.equal(gc.tableRecordAddress(floating), floating, 'the current epoch retains its earlier mark');
						remaining = gc.fullEpochs();
						++reductions;
					}
					assert.equal(cpu.readFramePc(caller), successor);
				}
				assert.equal(reductions, epochs);
				assert.equal(gc.fullEpochs(), 0);
				assert.equal(gc.tableRecordAddress(hidden), 0);
				assert.equal(gc.tableRecordAddress(floating), 0);
				assert.equal(cpu.stringPool.find(deadText), undefined);
				assert.ok(dropped >= RAM_BASE);
				assert.equal(cpu.activeThread.stackRegisters.capacity(), 512 >> epochs, 'the guest preserves full-only compaction at each epoch');
				let result = RunResult.Yielded;
				for (let i = 0; i < 32 && result !== RunResult.Halted; ++i) result = grant(37);
				assert.equal(result, RunResult.Halted);
				assert.equal(cpu.readLuaFaultReasonWord(), 0);
				assert.equal(asInteger(runtime.readCompletionValues()[0]), 73);
				observe('C', 73);
				for (const [first, last] of [[control, traceLimit + 4], [memory.ramBusEnd() - RAM_BASE, memory.ramData().length]]) {
					observe(`H ${first} ${last}`, hashBytes(memory.ramData(), first, last - first));
				}
			}
			finish();
			const tail = commands.slice(prefix), output = expected.slice(prefix);
			function check(suffix: string, snapshot: string, trace: string[], rows: string[]) {
				const path = join(directory, `${name}-${suffix}.trace`);
				writeFileSync(path, trace.join('\n'));
				const nativeRows = execFileSync(native, [rom, path, snapshot], { encoding: 'utf8' }).trimEnd().split('\n');
				const mismatch = nativeRows.findIndex((row, index) => row !== rows[index]);
				assert.equal(mismatch, -1, `${suffix} line ${mismatch}: TS ${rows[mismatch]}, C++ ${nativeRows[mismatch]}`);
				assert.equal(nativeRows.length, rows.length);
			}
			check('cold', seed, ['X', ...commands.slice(0, prefix), 'N', 'I'], [...expected.slice(0, prefix), '0']);
			check('resume', partial, ['X', 'l', 's', `x ${nativePartial}`, ...tail, 'u', ...tail], [...output, ...output]);
			history.restore(memory, history.capture(memory, interrupted), interrupted);
			applyRuntimeCheckpointState(runtime, checkpoint, RuntimeRestoreOrigin.HistorySeek);
			commands.length = expected.length = 0;
			finish();
			assert.deepEqual(commands, tail);
			assert.deepEqual(expected, output);
			applyRuntimeSaveState(runtime, decodeRuntimeSaveState(readFileSync(nativePartial), PSX_MACHINE_SPEC.ramBytes, PSX_MACHINE_SPEC.gxGpuVramBytes));
			commands.length = expected.length = 0;
			finish();
			assert.deepEqual(commands, tail);
			assert.deepEqual(expected, output);
			console.log(`BIOS-FULL-GC:PASS ${name} (${epochs} epochs, ${tail.length} exact grant/RAM observations, portable restore and rewind)`);
		}
	}
	rmSync(directory, { recursive: true });
} catch (error) {
	console.error(`Evidence retained: ${directory}`);
	throw error;
}
