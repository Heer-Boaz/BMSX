import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { hashBytes } from '../../../machine/ts/common/hash';
import { CpuRunKind, RunResult } from '../../../machine/ts/machine/cpu/cpu';
import { THREAD_HEAP_BYTES, THREAD_INITIAL_VALUES, ThreadField, ThreadStatus } from '../../../machine/ts/machine/cpu/thread_record';
import { valueBool, valueClosure, valueInteger, valueNil, valuePayload, valueString, valueTable, valueTag, valueThread } from '../../../machine/ts/machine/cpu/value';
import { Runtime } from '../../../machine/ts/machine/runtime/runtime';
import { captureRuntimeSaveState } from '../../../machine/ts/machine/runtime/save_state';
import { encodeRuntimeSaveState } from '../../../machine/ts/machine/runtime/save_state/codec';
import { CPU_CAUSE_CODE_SYSCALL } from '../../../machine/ts/spec/blua32/cop0';
import { OpCode } from '../../../machine/ts/spec/blua32/opcode';
import { CPU_INTERRUPTED_CONTEXT_ADDRESS, RAM_BASE } from '../../../machine/ts/spec/bmsx/memory_map';
import { PSX_MACHINE_SPEC } from '../../../machine/ts/spec/bmsx/model';
import { decodeBlua32InstructionAtPc } from '../../../toolchain/ts/rompack/blua32_instruction_decode';
import { writeTestBlua32Rom } from '../../helpers/blua32';
import { runGuestToHalt } from '../../helpers/cpu_execution';
import { linkManagedTestSystem } from '../../helpers/managed_system';
import { nativeConformanceRunner } from '../../helpers/native_conformance.mjs';
import { allocateThreadRecordReference } from '../../helpers/thread_allocation_reference';

const source = `
local entries<const> = require('bmsx/startup')
local function start(parent, child, box)
	local resume<const> = blua32.closure(entries.coroutine_resume)
	return resume(parent, child, box)
end
local function outer(child, box)
	local resume<const> = blua32.closure(entries.coroutine_resume)
	local ok, result, x, y = resume(child, 41, box, 5, 6, 7, 8, 9, 10, 11, 12, 17, 23)
	return ok, result, x, y
end
local function body(a, box, c, d, e, f, g, h, i, j, ...)
	local x, y = ...
	return a + box.marker + c + j + x + y, x, y
end
return start, outer, body
`;
const input = { sampleInputControllerSnapshot() {}, supervisorRequestLineHigh: () => false, applyInputControllerVibrationEffect() {} };
const native = nativeConformanceRunner('bmsx_heap_service_conformance_runner', {
	buildDirectory: join(tmpdir(), 'build-native-coroutine-first-resume'),
	configure: ['-DCMAKE_BUILD_TYPE=Release', '-DBMSX_ENABLE_NATIVE_BLOCKS=ON', '-DBMSX_NATIVE_GATE_PROFILE=ON'],
});
const deadText = 'unreachable cross-Thread frame reservation blocker '.repeat(180);

for (const opt of [0, 3] as const) for (const refuse of [false, true]) {
	test(`fresh coroutine admission ${refuse ? 'fails without publishing a frame' : 'keeps resumer operands through collection'} at O${opt}`, t => {
		const dir = mkdtempSync(join(tmpdir(), 'coroutine-first-resume-'));
		t.after(() => rmSync(dir, { recursive: true, force: true }));
		const linked = linkManagedTestSystem(source, opt);
		const entry = linked.symbols.functionAddresses[linked.symbols.metadata.functionIds.indexOf('module:kernel/coroutine_entry/module')];
		const resume = linked.symbols.functionAddresses[linked.symbols.metadata.functionIds.indexOf('module:kernel/coroutine_resume/module')];
		const romBytes = writeTestBlua32Rom(linked);
		const runtime = new Runtime({ systemRomBytes: romBytes, cartridgeSlots: [null, null], machineModel: PSX_MACHINE_SPEC }, input);
		const { cpu, memory, scheduler } = runtime.machine, { gc, heapAllocator: arena, luaHeap: heap } = cpu;
		runtime.boot();
		runGuestToHalt(cpu, 4_194_304);
		const [start, outer, body] = runtime.readCompletionValues().map(valuePayload);
		heap.setCollectionTarget(heap.capacity());
		const parent = allocateThreadRecordReference(cpu, outer), child = allocateThreadRecordReference(cpu, body), box = cpu.createTable(0, 1);
		gc.tables.setStringKey(box, cpu.stringPool.intern('marker'), valueInteger(67));
		cpu.beginCompletionCall(start, [valueThread(parent), valueThread(child), valueTable(box)]);
		const read = (field: ThreadField) => memory.readRamRecordWord(child + field);
		const atChildSVC = () => {
			const frame = cpu.activeThread.currentFrame;
			return cpu.activeThread.address === parent && frame?.functionAddress === resume
				&& decodeBlua32InstructionAtPc(linked.bytes, linked.layout.address, frame.pc).op === OpCode.SVC;
		};
		for (let step = 0; step < 8192 && !atChildSVC(); ++step)
			assert.equal(scheduler.runCpuSlice(0, 1, undefined, CpuRunKind.Scheduled), RunResult.Yielded);
		assert.ok(atChildSVC(), 'the non-root resumer reached the actual transfer instruction');
		assert.equal(read(ThreadField.Status), ThreadStatus.New);
		assert.equal(read(ThreadField.FrameDepth), 0);
		assert.equal(read(ThreadField.StackCapacity), THREAD_INITIAL_VALUES);

		gc.collect();
		heap.setCollectionTarget(heap.capacity());
		if (!refuse) cpu.stringPool.intern(deadText);
		while (arena.allocate(4088, true)) { /* occupy remaining large extents */ }
		while (arena.allocate(24, true)) { /* force a physical backing-growth refusal */ }
		const caller = cpu.activeThread.currentFrame!;
		const first = caller.varargBase;
		assert.equal(caller.stackBase - first, 12);
		assert.equal(caller.thread.stackRegisters.get(first), valueInteger(41));
		assert.equal(caller.thread.stackRegisters.get(first + 1), valueTable(box));
		const stack = read(ThreadField.StackBlock);

		// A single common seed gives both cores the same externally prepared
		// pressure. The transfer itself and all collection run as guest code.
		const rom = join(dir, 'system.rom'), trace = join(dir, 'trace'), seed = join(dir, 'seed');
		writeFileSync(rom, romBytes);
		writeFileSync(seed, encodeRuntimeSaveState(captureRuntimeSaveState(runtime)));
		const commands = ['X'], expected: string[] = [];
		function grant(cycles: number) {
			const result = scheduler.runCpuSlice(0, cycles, undefined, CpuRunKind.Scheduled);
			const paid = cycles - cpu.instructionBudgetRemaining;
			assert.ok(paid > 0);
			commands.push(`g ${cycles} 0`);
			expected.push(`${result} ${paid} 0 ${arena.occupiedBytes()} ${heap.usedBytes()}`);
			return result;
		}
		assert.equal(grant(1), RunResult.Yielded);
		assert.equal(cpu.fixedInterruptActive(), true);
		assert.equal(cpu.readCauseWord(), CPU_CAUSE_CODE_SYSCALL);
		assert.equal(memory.readRamRecordWord(CPU_INTERRUPTED_CONTEXT_ADDRESS), parent);
		assert.equal(read(ThreadField.Status), ThreadStatus.New, 'hardware entry does not publish the guest coroutine transition');
		// Stop at RFE itself: a wider grant can start the real coroutine
		// body before the fixture observes the freshly published frame.
		for (let step = 0; step < 65_536 && cpu.fixedInterruptActive(); ++step)
			assert.equal(grant(1), RunResult.Yielded);
		assert.equal(cpu.fixedInterruptActive(), false, 'the firmware either admitted or refused the first frame');
		if (refuse) {
			assert.equal(cpu.activeThread.address, parent);
			assert.equal(read(ThreadField.Status), ThreadStatus.Failed);
			assert.equal(read(ThreadField.Resumer), 0);
			assert.equal(read(ThreadField.Entry), body);
			assert.equal(read(ThreadField.FrameDepth), 0);
			assert.equal(read(ThreadField.StackBlock), stack);
		} else {
			assert.equal(cpu.activeThread.address, child);
			assert.equal(read(ThreadField.Entry), 0);
			assert.equal(read(ThreadField.FrameDepth), 1);
			assert.ok(read(ThreadField.StackCapacity) > THREAD_INITIAL_VALUES);
			const frame = cpu.activeThread.currentFrame!;
			assert.equal(frame.functionAddress, entry);
			assert.equal(frame.registers.get(0), valueClosure(body));
			assert.equal(frame.thread.stackRegisters.get(frame.varargBase), valueInteger(41));
			assert.equal(frame.thread.stackRegisters.get(frame.varargBase + 1), valueTable(box));
			assert.equal(cpu.stringPool.find(deadText), undefined);
		}
		for (const address of [parent, child]) {
			const from = address - RAM_BASE;
			commands.push(`H ${from} ${from + THREAD_HEAP_BYTES}`);
			expected.push(String(hashBytes(memory.ramData(), from, THREAD_HEAP_BYTES)));
		}
		let outcome = RunResult.Yielded;
		for (let step = 0; step < 8192 && outcome === RunResult.Yielded; ++step) outcome = grant(251);
		assert.equal(outcome, RunResult.Halted);
		assert.equal(cpu.getFrameDepth(), 0);
		const result = runtime.readCompletionValues();
		if (refuse) {
			assert.deepEqual(result, [valueBool(true), valueBool(false), valueString(read(ThreadField.ErrorWord)), valueNil(), valueNil()]);
			assert.equal(cpu.stringPool.toString(valuePayload(result[2])), 'Out of memory.');
		} else assert.deepEqual(result, [valueBool(true), valueBool(true), valueInteger(165), valueInteger(17), valueInteger(23)]);
		commands.push('c');
		expected.push([result.length, ...result.flatMap(value => [valueTag(value), valuePayload(value)])].join(' '));
		writeFileSync(trace, commands.join('\n'));
		assert.deepEqual(execFileSync(native, [rom, trace, seed], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 }).trimEnd().split('\n'), expected);
	});
}
