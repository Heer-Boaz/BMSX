import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CpuRunKind, RunResult } from '../../../machine/ts/machine/cpu/cpu';
import { COMPILED_BLOCK_THRESHOLD, CpuExecutionBackend } from '../../../machine/ts/machine/cpu/compiled_block';
import { captureAddress } from '../../../machine/ts/machine/cpu/closure';
import { GC_CHANGED_HEAD, GcPhase } from '../../../machine/ts/machine/cpu/gc_heap';
import { GC_COLOR_OFFSET, GC_RECORD_SHIFT } from '../../../machine/ts/machine/cpu/gc_object';
import { HEAP_GC_CONTROL_OFFSET, HEAP_STRING_MARK_WORK_OFFSET } from '../../../machine/ts/machine/cpu/heap_allocator';
import { isOpen, load, UPVALUE_ADDRESS_MASK, UPVALUE_NEXT, UPVALUE_VALUE_TAG, UPVALUE_VALUE_WORD } from '../../../machine/ts/machine/cpu/upvalue';
import { asClosure, ValueTag, valueInteger, valueString } from '../../../machine/ts/machine/cpu/value';
import { Runtime } from '../../../machine/ts/machine/runtime/runtime';
import { applyRuntimeSaveState, captureRuntimeSaveState } from '../../../machine/ts/machine/runtime/save_state';
import { decodeRuntimeSaveState, encodeRuntimeSaveState } from '../../../machine/ts/machine/runtime/save_state/codec';
import { INSTRUCTION_BYTES } from '../../../machine/ts/spec/blua32/instruction_format';
import { BASE_CYCLES, OpCode } from '../../../machine/ts/spec/blua32/opcode';
import { HEAP_SERVICE_RESIDENT_OFFSET, HeapServiceResidentField, HEAP_SERVICE_THREAD_OFFSET } from '../../../machine/ts/spec/bmsx/heap_service';
import { RAM_BASE } from '../../../machine/ts/spec/bmsx/memory_map';
import { PSX_MACHINE_SPEC } from '../../../machine/ts/spec/bmsx/model';
import { decodeBlua32InstructionAtPc } from '../../../toolchain/ts/rompack/blua32_instruction_decode';
import { writeTestBlua32Rom } from '../../helpers/blua32';
import { runCompletionClosure, runGuestToHalt } from '../../helpers/cpu_test_harness';
import { linkManagedTestSystem } from '../../helpers/managed_system';
import { nativeConformanceRunner } from '../../helpers/native_conformance.mjs';

mkdirSync('tmp', { recursive: true });
const evidence = mkdtempSync(join('tmp', 'bmsx-closed-upvalue-'));
try {
	const runner = nativeConformanceRunner('bmsx_heap_service_conformance_runner', {
		buildDirectory: join('tmp', 'build-native-upvalue-store'),
		configure: ['-DCMAKE_BUILD_TYPE=Release', '-DBMSX_ENABLE_NATIVE_BLOCKS=ON', '-DBMSX_NATIVE_GATE_PROFILE=ON'],
	});
	for (const opt of [0, 3] as const) {
		const image = linkManagedTestSystem(`
local captured = 73
function set_captured(v)
    captured = v
    return 1
end
`, opt);
		const systemRomBytes = writeTestBlua32Rom(image);
		const startup = image.symbols.functionAddresses[image.symbols.metadata.functionIds.indexOf('module:main/startup')];
		for (const [kind, phase, color] of [
			[CpuRunKind.Direct, GcPhase.MarkAgain, 3],
			[CpuRunKind.Scheduled, GcPhase.MarkAgain, 3],
			[CpuRunKind.Scheduled, GcPhase.Mark, 3],
			[CpuRunKind.Scheduled, GcPhase.Mark, 0],
		] as const) {
			const runtime = new Runtime({ systemRomBytes, cartridgeSlots: [null, null], machineModel: PSX_MACHINE_SPEC, cpuExecutionBackend: CpuExecutionBackend.JavaScript }, {
				sampleInputControllerSnapshot() {}, supervisorRequestLineHigh: () => false, applyInputControllerVibrationEffect() {},
			});
			runtime.boot();
			const { cpu, memory, scheduler } = runtime.machine;
			let bootBudget = 1_000_000;
			for (let grant = 0; grant < 32 && cpu.readFrameFunctionAddress(0) !== startup && bootBudget > 0; ++grant) {
				assert.equal(cpu.runUntilDepth(0, bootBudget), RunResult.Yielded);
				bootBudget = cpu.instructionBudgetRemaining;
			}
			assert.equal(cpu.readFrameFunctionAddress(0), startup, 'the reset ROM reaches the managed fixture entry');
			runGuestToHalt(cpu, 250_000);
			const setter = asClosure(cpu.getGlobalByKey(cpu.stringPool.find('set_captured')!), cpu.gc);
			const cell = captureAddress(memory, setter, 0) & UPVALUE_ADDRESS_MASK;
			assert.equal(isOpen(memory, cell), false);
			for (let visit = 0; visit <= COMPILED_BLOCK_THRESHOLD; ++visit) runCompletionClosure(cpu, setter, [valueInteger(73)], 1024);
			const id = cpu.stringPool.intern('new native closed value');
			cpu.stringPool.beginReachabilityEpoch();
			const stage = cpu.stringPool.metadataOffset;
			const epoch = memory.readRamRecordWord(stage + 0x0c) & 1;
			const management = cpu.heapAllocator.managementOffset(), control = management + HEAP_GC_CONTROL_OFFSET;
			const latch = management + HEAP_STRING_MARK_WORK_OFFSET, work = control + 0x5c, changed = control + GC_CHANGED_HEAD;
			memory.writeRamRecordWord(control, phase);
			memory.writeRamRecordWord(changed, 0x311);
			memory.writeRamRecordWord(work, 17);
			memory.writeRamRecordWord(latch, 2);
			memory.writeRamRecordByte(cell + GC_COLOR_OFFSET, color);
			memory.writeRamRecordWord(cell + UPVALUE_NEXT, 0x819ab2ef);
			const input = valueString(id);
			cpu.beginCompletionCall(setter, [input]);
			const frame = cpu.activeThread.currentFrame!, beginning = frame.pc, topBefore = frame.top;
			let pc = beginning, issueSpent = 2; // fixed input placement
			for (;;) {
				const decoded = decodeBlua32InstructionAtPc(image.layout.textBytes, image.layout.header.textAddress, pc);
				issueSpent += BASE_CYCLES[decoded.op];
				if (decoded.op === OpCode.SETUP) break;
				pc = decoded.pc + INSTRUCTION_BYTES;
			}
			const issue = pc;
			const name = `${evidence}/o${opt}-mode${kind}-phase${phase}-color${color}`;
			const rom = name + '.rom', initial = name + '.state', trace = name + '.trace';
			writeFileSync(rom, systemRomBytes);
			writeFileSync(initial, encodeRuntimeSaveState(captureRuntimeSaveState(runtime)));
			function native(commands: string[], state = initial) {
				writeFileSync(trace, commands.join('\n') + '\n');
				return execFileSync(runner, [rom, trace, state], { encoding: 'utf8' }).trimEnd().split('\n');
			}
			const floor = memory.ramBusEnd() - RAM_BASE, end = management + HEAP_SERVICE_THREAD_OFFSET;
			const h = `H ${floor} ${end}`;
			const hash = () => {
				let state = 0x811c9dc5;
				for (const byte of memory.ramData().subarray(floor, end)) state = Math.imul(state ^ byte, 0x01000193);
				return String(state >>> 0);
			};
			const issueGrant = 64, traceMode = Number(kind === CpuRunKind.Scheduled);
			const begin = (nativeMode: number) => ['X', `! ${issueGrant} ${nativeMode} ${traceMode}`];
			const started = scheduler.runCpuSlice(0, issueGrant, 0, kind);
			assert.equal(started, RunResult.Yielded);
			assert.equal(issueGrant - cpu.instructionBudgetRemaining, issueSpent);
			assert.ok(cpu.heapServiceActive());
			assert.equal(load(memory, cell), valueInteger(73));
			assert.equal(memory.readRamRecordWord(management + HEAP_SERVICE_RESIDENT_OFFSET + HeapServiceResidentField.IssuePc), issue);
			const top = frame.top;
			assert.ok(top >= topBefore && frame.pc > issue);
			const grantCommand = `J 1 ${traceMode}`, prefix: string[] = [], prints: string[] = [];
			function one() {
				const result = scheduler.runCpuSlice(0, 1, 0, kind);
				// The J trace records precise work and heap metadata after every instruction.
				return [result, 1 - cpu.instructionBudgetRemaining, +cpu.heapServiceActive(), 0, cpu.heapAllocator.occupiedBytes(), cpu.luaHeap.usedBytes()].join(' ');
			}
			const published = color !== 3 ? cell + UPVALUE_VALUE_WORD : phase === GcPhase.MarkAgain ? latch : cell + UPVALUE_NEXT;
			const beforePublish = memory.readRamRecordWord(published);
			while (memory.readRamRecordWord(published) === beforePublish && prefix.length < 512) {
				prefix.push(grantCommand); prints.push(one());
			}
			if (color !== 3) {
				assert.equal(memory.readRamRecordWord(published), id);
				assert.equal(memory.readRamRecordByte(cell + UPVALUE_VALUE_TAG), ValueTag.Integer, 'snapshot between payload and tag');
				assert.equal(memory.readRamRecordWord(latch), 2);
				assert.equal(memory.readRamRecordWord(changed), 0x311);
			} else if (phase === GcPhase.MarkAgain) {
				assert.equal(memory.readRamRecordByte(id + 1), epoch);
				assert.equal(memory.readRamRecordWord(latch), 3);
			} else {
				assert.equal(memory.readRamRecordWord(cell + UPVALUE_NEXT), 0x311);
				assert.equal(memory.readRamRecordByte(cell + GC_COLOR_OFFSET), 3);
				assert.equal(memory.readRamRecordWord(changed), 0x311);
			}
			assert.equal(memory.readRamRecordWord(work), 17);
			if (color === 3) assert.equal(load(memory, cell), valueInteger(73));
			assert.ok(cpu.heapServiceActive());
			const before = hash();
			const tsSave = name + '.ts.state';
			writeFileSync(tsSave, encodeRuntimeSaveState(captureRuntimeSaveState(runtime)));
			const tail: string[] = [], suffix: string[] = [];
			while (cpu.heapServiceActive() && tail.length < 512) {
				tail.push(grantCommand); suffix.push(one());
			}
			assert.equal(cpu.heapServiceActive(), false);
			if (color !== 3) {
				assert.equal(memory.readRamRecordWord(latch), 2);
				assert.equal(memory.readRamRecordWord(work), 17);
				assert.equal(memory.readRamRecordWord(changed), 0x311);
				assert.equal(memory.readRamRecordByte(cell + GC_COLOR_OFFSET), color);
				assert.equal(memory.readRamRecordWord(cell + UPVALUE_NEXT), 0x819ab2ef);
			} else if (phase === GcPhase.MarkAgain) {
				assert.equal(memory.readRamRecordWord(latch), 0);
				assert.equal(memory.readRamRecordWord(work), 20);
				assert.equal(memory.readRamRecordWord(changed), 0x311);
			} else {
				assert.equal(memory.readRamRecordWord(latch), 2);
				assert.equal(memory.readRamRecordWord(work), 17);
				assert.equal(memory.readRamRecordWord(changed), cell >>> GC_RECORD_SHIFT);
				assert.equal(memory.readRamRecordByte(cell + GC_COLOR_OFFSET), 2);
			}
			assert.equal(load(memory, cell), input);
			assert.equal(frame.top, top);
			const after = hash();
			const expectedLine = (native: number) => [RunResult.Yielded, issueSpent, 1, native, native, 0, 0].join(' ');
			for (const mode of [0, 1])
				assert.deepEqual(native([...begin(mode), ...prefix, h, ...tail, h]), [expectedLine(mode), ...prints, before, ...suffix, after]);
			assert.deepEqual(native(['X', ...tail, h], tsSave), [...suffix, after]);
			const cppSave = name + '.cpp.state';
			assert.deepEqual(native([...begin(1), ...prefix, `x ${cppSave}`, h]), [expectedLine(1), ...prints, before]);
			const state = decodeRuntimeSaveState(readFileSync(cppSave), PSX_MACHINE_SPEC.ramBytes, PSX_MACHINE_SPEC.gxGpuVramBytes);
			applyRuntimeSaveState(runtime, state);
			assert.ok(cpu.heapServiceActive());
			assert.deepEqual(tail.map(() => one()), suffix);
			assert.equal(hash(), after);
			console.log(`SETUP O${opt} ${kind === CpuRunKind.Direct ? 'Direct' : 'Scheduled'}: phase ${phase} color ${color}: scalar and generated native side exits exact; ${prefix.length + tail.length} matching single grants, cross-core saves during closed store`);
		}
	}
	rmSync(evidence, { recursive: true });
} catch (error) {
	console.error(`Evidence retained: ${evidence}`);
	throw error;
}
