import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { hashBytes } from '../../../machine/ts/common/hash';
import { FRAME_CONTROL_BYTES } from '../../../machine/ts/machine/cpu/call_state';
import { CpuRunKind, RunResult } from '../../../machine/ts/machine/cpu/cpu';
import { GcPhase } from '../../../machine/ts/machine/cpu/gc_heap';
import { valueBool, valueClosure, valueFloatBits, valueInteger, valueNil, valuePayload, valueTag, type Value } from '../../../machine/ts/machine/cpu/value';
import { Runtime } from '../../../machine/ts/machine/runtime/runtime';
import { captureRuntimeSaveState } from '../../../machine/ts/machine/runtime/save_state';
import { encodeRuntimeSaveState } from '../../../machine/ts/machine/runtime/save_state/codec';
import { SYSTEM_EXECUTION_DOMAIN_ID } from '../../../machine/ts/spec/blua32/execution_domain';
import { INSTRUCTION_BYTES, writeInstruction } from '../../../machine/ts/spec/blua32/instruction_format';
import { encodeFixedValueCount, OpCode } from '../../../machine/ts/spec/blua32/opcode';
import { PSX_MACHINE_SPEC } from '../../../machine/ts/spec/bmsx/model';
import { linkRawTestSystemBlua32, seedTestCapturedClosure } from '../../helpers/blua32';
import { cartridgeSlots } from '../../helpers/cartridge';
import { admitTestHeapServiceCpu } from '../../helpers/heap_service_system';
import { nativeConformanceRunner } from '../../helpers/native_conformance.mjs';

test('completion calls use admitted backing and preserve borrowed Values across admission', t => {
	const text = new Uint8Array(6 * INSTRUCTION_BYTES);
	writeInstruction(text, 0, OpCode.RET, 0, encodeFixedValueCount(4), 0);
	writeInstruction(text, 1, OpCode.VARARG, 1, 0, 0);
	writeInstruction(text, 2, OpCode.RET, 0, 0, 0);
	writeInstruction(text, 3, OpCode.KSMI, 0, 0, 37);
	writeInstruction(text, 4, OpCode.RET, 0, encodeFixedValueCount(1), 0);
	writeInstruction(text, 5, OpCode.RET, 0, encodeFixedValueCount(0), 0);
	const system = linkRawTestSystemBlua32({ text, functions: [
		{ firstWord: 0, wordCount: 1, maxStack: 16 },
		{ firstWord: 1, wordCount: 2, maxStack: 6, numParams: 1, isVararg: true },
		{ firstWord: 3, wordCount: 2 },
		{ firstWord: 5, wordCount: 1, maxStack: 128 },
	] });
	const [, variadic, named, tooWide] = system.image.functions;
	const runtime = new Runtime({ systemRomBytes: system.romBytes, cartridgeSlots: cartridgeSlots(), machineModel: PSX_MACHINE_SPEC }, {
		sampleInputControllerSnapshot() {}, supervisorRequestLineHigh: () => false, applyInputControllerVibrationEffect() {},
	});
	runtime.boot();
	const { cpu, executionAddressSpace, memory, scheduler } = runtime.machine;
	admitTestHeapServiceCpu(cpu, executionAddressSpace);
	const cells = new Uint32Array(0);
	const closure = seedTestCapturedClosure(cpu, variadic.address, cells);
	const wideClosure = seedTestCapturedClosure(cpu, tooWide.address, cells);
	const args = [valueFloatBits(0x80000000), valueNil(), valueBool(false), valueFloatBits(0xffa12345)];
	for (let i = 0; i < args.length; ++i) cpu.activeThread.currentFrame!.registers.set(i, args[i]);
	assert.equal(scheduler.runCpuSlice(0, 128, 0, CpuRunKind.Scheduled), RunResult.Halted);
	assert.deepEqual(runtime.readCompletionValues(), args);
	const { gc } = cpu, root = cpu.rootThread;
	assert.ok(root.stackRegisters.capacity() < tooWide.maxStack);
	for (let i = 0; gc.phase() !== GcPhase.Atomic && i < 64; ++i) gc.step(valueClosure(closure));
	assert.equal(gc.phase(), GcPhase.Atomic, 'a native final-mark call would change this state');
	const occupied = cpu.heapAllocator.occupiedBytes(), used = cpu.luaHeap.usedBytes();
	const seed = encodeRuntimeSaveState(captureRuntimeSaveState(runtime));
	const commands = ['X'], rows: string[] = [];
	function observe(command: string, row: string | number) {
		commands.push(command);
		rows.push(String(row));
	}
	function hash(offset: number, bytes: number) {
		observe(`H ${offset} ${offset + bytes}`, hashBytes(memory.ramData(), offset, bytes));
	}
	function results(expected: readonly Value[]) {
		const values = runtime.readCompletionValues();
		assert.deepEqual(values, expected);
		observe('c', [values.length, ...values.flatMap(value => [valueTag(value), valuePayload(value)])].join(' '));
	}
	function admission(command: string, call: () => void, admitted: boolean) {
		const budget = cpu.instructionBudgetRemaining, now = scheduler.nowCycles;
		if (admitted) call();
		else assert.throws(call, { message: 'External call exceeds the admitted register window.' });
		assert.equal(cpu.instructionBudgetRemaining, budget);
		assert.equal(scheduler.nowCycles, now);
		assert.equal(gc.phase(), GcPhase.Atomic);
		assert.equal(cpu.heapAllocator.occupiedBytes(), occupied);
		assert.equal(cpu.luaHeap.usedBytes(), used);
		observe(command, `${+admitted} 0 0 ${gc.phase()} ${occupied} ${used}`);
	}
	function complete(expected: readonly Value[]) {
		const result = scheduler.runCpuSlice(0, 128, 0, CpuRunKind.Scheduled);
		assert.equal(result, RunResult.Halted);
		assert.equal(root.frameDepth, 0);
		assert.equal(cpu.captureRuntimeState().hardHalted, false);
		observe('L 128', `${result} ${128 - cpu.instructionBudgetRemaining} ${gc.fullEpochs()} ${gc.phase()} ${cpu.luaHeap.usedBytes()}`);
		results(expected);
	}
	const before = cpu.captureRuntimeState(), ram = memory.ramData();
	const memoryBefore = hashBytes(ram, 0, ram.length);
	admission(`T n ${tooWide.address}`, () => cpu.beginCompletionCallInExecutionDomain(SYSTEM_EXECUTION_DOMAIN_ID, tooWide.address), false);
	admission(`T b ${wideClosure}`, () => cpu.beginCompletionCall(wideClosure, runtime.readCompletionValues()), false);
	assert.deepEqual(cpu.captureRuntimeState(), before);
	assert.equal(hashBytes(ram, 0, ram.length), memoryBefore);
	hash(0, ram.length);
	results(args);

	admission(`T b ${closure}`, () => cpu.beginCompletionCall(closure, runtime.readCompletionValues()), true);
	const frame = root.currentFrame!;
	assert.equal(frame.functionAddress, variadic.address);
	assert.equal(frame.argumentCount, args.length);
	assert.equal(frame.varargCount, args.length - 1);
	assert.equal(frame.returnToCompletionLatch, true);
	assert.equal(frame.registers.get(0), args[0]);
	assert.deepEqual(args.slice(1).map((_, i) => root.stackRegisters.get(frame.varargBase + i)), args.slice(1));
	hash(frame.controlOffset, FRAME_CONTROL_BYTES);
	complete(args);

	admission(`T n ${named.address}`, () => cpu.beginCompletionCallInExecutionDomain(SYSTEM_EXECUTION_DOMAIN_ID, named.address), true);
	const direct = root.currentFrame!;
	assert.equal(direct.functionAddress, named.address);
	assert.equal(direct.pc, named.codeAddress);
	assert.equal(direct.closureAddress, 0, 'named static admission does not construct a Closure');
	hash(direct.controlOffset, FRAME_CONTROL_BYTES);
	complete([valueInteger(37)]);

	const dir = mkdtempSync(join(tmpdir(), 'bmsx-completion-admission-'));
	t.after(() => rmSync(dir, { recursive: true, force: true }));
	const rom = join(dir, 'system.rom'), trace = join(dir, 'trace'), checkpoint = join(dir, 'initial.state');
	writeFileSync(rom, system.romBytes);
	writeFileSync(trace, commands.join('\n'));
	writeFileSync(checkpoint, seed);
	const native = nativeConformanceRunner('bmsx_heap_service_conformance_runner');
	assert.deepEqual(execFileSync(native, [rom, trace, checkpoint], { encoding: 'utf8' }).trimEnd().split('\n'), rows);
});
