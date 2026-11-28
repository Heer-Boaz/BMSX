import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { hashBytes } from '../../../machine/ts/common/hash';
import { FRAME_CONTROL_BYTES, FRAME_WINDOW_MASK, FrameField } from '../../../machine/ts/machine/cpu/call_state';
import { captureAddress, CLOSURE_PROTOTYPE_ADDRESS, recordAddress as closureRecordAddress } from '../../../machine/ts/machine/cpu/closure';
import { CpuRunKind, RunResult } from '../../../machine/ts/machine/cpu/cpu';
import { GlobalBank } from '../../../machine/ts/machine/cpu/global_bank';
import { THREAD_HEAP_BYTES, THREAD_RECORD_KIND, ThreadField, ThreadStatus } from '../../../machine/ts/machine/cpu/thread_record';
import { isOpen, load, UPVALUE_ADDRESS_MASK, UPVALUE_HEAP_BYTES, UPVALUE_OWNER } from '../../../machine/ts/machine/cpu/upvalue';
import { ValueTag, valueBool, valueInteger, valueNil, valuePayload, valueTag } from '../../../machine/ts/machine/cpu/value';
import { Runtime } from '../../../machine/ts/machine/runtime/runtime';
import { applyRuntimeSaveState, captureRuntimeSaveState } from '../../../machine/ts/machine/runtime/save_state';
import { decodeRuntimeSaveState, encodeRuntimeSaveState } from '../../../machine/ts/machine/runtime/save_state/codec';
import { CPU_CAUSE_CODE_REGISTER_WINDOW } from '../../../machine/ts/spec/blua32/cop0';
import { EXECUTION_IMAGE_BINDING_ORDINARY_OFFSET, GLOBAL_BANK_OFFSET, SYSTEM_EXECUTION_DOMAIN_ID, executionImageBindingOffset } from '../../../machine/ts/spec/blua32/execution_domain';
import { OpCode } from '../../../machine/ts/spec/blua32/opcode';
import { CPU_FIXED_STACK_BASE, CPU_INTERRUPTED_CONTEXT_ADDRESS, CPU_RESET_BANK_ADDRESS, RAM_BASE, SYSTEM_ROM_BASE } from '../../../machine/ts/spec/bmsx/memory_map';
import { PSX_MACHINE_SPEC } from '../../../machine/ts/spec/bmsx/model';
import { decodeBlua32InstructionAtPc } from '../../../toolchain/ts/rompack/blua32_instruction_decode';
import { writeTestBlua32Rom } from '../../helpers/blua32';
import { cartridgeSlots } from '../../helpers/cartridge';
import { COROUTINE_FIRMWARE_MODULES } from '../../helpers/firmware_modules';
import { linkManagedTestSystem } from '../../helpers/managed_system';
import { nativeConformanceRunner } from '../../helpers/native_conformance.mjs';

const input = { sampleInputControllerSnapshot() {}, supervisorRequestLineHigh: () => false, applyInputControllerVibrationEffect() {} };

test('terminal register-window OOM returns to the resumer and preserves the failed coroutine for close', t => {
	t.mock.method(WebAssembly, 'Instance', () => assert.fail('register-window recovery must not instantiate the allocator oracle'));
	const staticBytes = 3_600_000, marker = 0x4f2172c9;
	const locals = Array.from({ length: 160 }, (_, index) => `local z${index} = 1`).join('\n');
	// The authored ROM admits less heap through its BSS extent, not a
	// replacement allocator. O0 retains the large recursive activation.
	const linked = linkManagedTestSystem(`
bss blocked: u8[${staticBytes}]
blocked[0] = 1
local coroutine<const> = require('coroutine')
local function descend(n)
	local retained = n + ${marker}
	if n == 0 then
		escaped_cell = function() return retained end
	end
	${locals}
	return descend(n + 1)
end
failed_thread = coroutine.create(function() return descend(0) end)
local ok<const>, err<const> = coroutine.resume(failed_thread)
halt_until_irq
local close_ok<const>, close_error<const> = coroutine.close(failed_thread)
return ok, err, close_ok, close_error, escaped_cell()
`, 0, COROUTINE_FIRMWARE_MODULES);
	const rom = writeTestBlua32Rom(linked);
	function boot() {
		const rt = new Runtime({ systemRomBytes: rom, cartridgeSlots: cartridgeSlots(), machineModel: PSX_MACHINE_SPEC }, input);
		rt.boot();
		assert.equal(rt.machine.cpu.rootThread.address, CPU_RESET_BANK_ADDRESS);
		return rt;
	}
	const runtime = boot(), { cpu, memory } = runtime.machine;
	const entries = new Map(linked.layout.functions.map(fn => [fn.address, fn]));
	const commands: string[] = [], expected: string[] = [];
	function observe(command: string, row: string | number) {
		commands.push(command);
		expected.push(String(row));
	}
	function hash(rt: Runtime, address: number, size: number) {
		const first = address - RAM_BASE;
		observe(`H ${first} ${first + size}`, hashBytes(rt.machine.memory.ramData(), first, size));
	}
	function grant(rt: Runtime) {
		const budget = 3072;
		const { cpu, memory, scheduler } = rt.machine;
		const run = scheduler.runCpuSlice(0, budget, undefined, CpuRunKind.Scheduled);
		observe(`E ${budget}`, `${run} ${budget - cpu.instructionBudgetRemaining} ${memory.ramBusEnd()} ${cpu.activeCartridgeSlot()}`);
		return run;
	}
	let run = RunResult.Yielded, required = 0, issues = 0, depth = 0, issue = 0, failed = 0;
	let resumePc = 0, resumeFrame = 0, resumeBase = 0;
	for (let count = 0; count < 8192 && run !== RunResult.Halted; ++count) {
		run = grant(runtime);
		if (!cpu.fixedInterruptActive() || cpu.readCauseWord() !== CPU_CAUSE_CODE_REGISTER_WINDOW) continue;
		const interrupted = memory.readRamRecordWord(CPU_INTERRUPTED_CONTEXT_ADDRESS);
		if (interrupted === cpu.rootThread.address || memory.readRamRecordWord(interrupted + ThreadField.Status) !== ThreadStatus.Running) continue;
		const resumer = memory.readRamRecordWord(interrupted + ThreadField.Resumer);
		assert.equal(resumer, cpu.rootThread.address);
		const frameCount = cpu.readThreadFrameDepth(interrupted);
		const issuer = memory.readRamRecordWord(interrupted + ThreadField.FrameBlock) + (frameCount - 1) * FRAME_CONTROL_BYTES;
		const pc = cpu.readEpcWord();
		assert.equal(memory.readRamRecordWord(issuer + FrameField.Pc), pc);
		const { op, a: callee } = decodeBlua32InstructionAtPc(rom, SYSTEM_ROM_BASE, pc);
		assert.equal(op, OpCode.CALL);
		const calleeValue = cpu.readThreadRegister(interrupted, frameCount - 1, callee);
		if (valueTag(calleeValue) !== ValueTag.Closure) continue;
		const closure = closureRecordAddress(memory, valuePayload(calleeValue));
		assert.notEqual(closure, 0);
		const prototype = memory.readRamRecordWord(closure + CLOSURE_PROTOTYPE_ADDRESS);
		if (prototype !== memory.readRamRecordWord(issuer + FrameField.Function)) continue;
		const fn = entries.get(prototype)!;
		const base = memory.readRamRecordWord(issuer + FrameField.StackBase) & FRAME_WINDOW_MASK;
		const extent = base + callee + 1 + fn.maxStack;
		if (extent <= required) continue;
		required = extent;
		issues++;
		depth = frameCount;
		issue = pc;
		// The SVC transport frame retains the ordinary CALL's result placement.
		// It is retired by the vector, which returns to the caller's PC.
		const transport = cpu.readThreadFrameDepth(resumer) - 1;
		resumeFrame = transport - 1;
		resumePc = cpu.readThreadFrameWord(resumer, resumeFrame, FrameField.Pc);
		resumeBase = cpu.readThreadFrameWord(resumer, transport, FrameField.ReturnBase) & FRAME_WINDOW_MASK;
		assert.equal(cpu.readThreadFrameWord(resumer, transport, FrameField.ReturnCount) & FRAME_WINDOW_MASK, 3);
		failed = interrupted;
		observe('Z', `${CPU_CAUSE_CODE_REGISTER_WINDOW} 0 ${issue}`);
		hash(runtime, issuer, FRAME_CONTROL_BYTES);
	}
	assert.equal(run, RunResult.Halted);
	assert.ok(issues > 1, 'real recursive growth preceded the terminal shortage');
	assert.ok(memory.ramBusEnd() >= linked.layout.header.bssAddress + staticBytes);
	assert.notEqual(resumePc, issue);

	const error = cpu.readThreadRegister(cpu.rootThread.address, resumeFrame, resumeBase + 1), captured = valueInteger(marker);
	assert.equal(valueTag(error), ValueTag.String);
	assert.equal(cpu.stringPool.toString(valuePayload(error)), 'Out of memory.');

	function inspectFailed(rt: Runtime) {
		const { cpu, memory } = rt.machine;
		const bank = new GlobalBank(memory, CPU_FIXED_STACK_BASE + GLOBAL_BANK_OFFSET);
		bank.bind();
		const ordinaryMap = memory.readRamRecordWord(executionImageBindingOffset(SYSTEM_EXECUTION_DOMAIN_ID) + EXECUTION_IMAGE_BINDING_ORDINARY_OFFSET);
		const observedGlobal = (name: string) => {
			const ordinal = linked.layout.globalNames.indexOf(name);
			assert.notEqual(ordinal, -1);
			return bank.slots.get(memory.readRamRecordWord(ordinaryMap + ordinal * 4));
		};
		const failedValue = observedGlobal('failed_thread');
		assert.equal(valueTag(failedValue), ValueTag.Thread);
		assert.equal(valuePayload(failedValue), failed);
		assert.equal(memory.readRamRecordByte(failed + ThreadField.Header), THREAD_RECORD_KIND);
		assert.equal(cpu.readThreadStatus(failed), ThreadStatus.Failed);
		assert.equal(cpu.readThreadFrameDepth(failed), depth, 'failure did not unwind the coroutine');
		assert.equal(cpu.readThreadFrameWord(failed, depth - 1, FrameField.Pc), issue);
		assert.ok(required > memory.readRamRecordWord(failed + ThreadField.StackCapacity));
		assert.equal(memory.readRamRecordWord(failed + ThreadField.Resumer), 0);
		assert.equal(cpu.readThreadError(failed), error);
		assert.equal(cpu.activeThread, cpu.rootThread);
		assert.equal(cpu.fixedInterruptActive(), false);
		assert.equal(cpu.isHaltedUntilIrq(), true);
		assert.equal(memory.readRamRecordWord(CPU_INTERRUPTED_CONTEXT_ADDRESS), 0);
		assert.equal(cpu.readCauseWord(), CPU_CAUSE_CODE_REGISTER_WINDOW);
		assert.equal(cpu.readLuaFaultReasonWord(), 0);
		assert.equal(cpu.readEpcWord(), resumePc);
		assert.equal(cpu.readThreadFrameDepth(cpu.rootThread.address), resumeFrame + 1);
		assert.equal(cpu.readThreadRegister(cpu.rootThread.address, resumeFrame, resumeBase), valueBool(false));
		assert.equal(cpu.readThreadRegister(cpu.rootThread.address, resumeFrame, resumeBase + 1), error);
		const escaped = observedGlobal('escaped_cell');
		assert.equal(valueTag(escaped), ValueTag.Closure);
		const closure = closureRecordAddress(memory, valuePayload(escaped));
		assert.notEqual(closure, 0);
		const cell = captureAddress(memory, closure, 0);
		assert.ok(isOpen(memory, cell));
		assert.equal(memory.readRamRecordWord((cell & UPVALUE_ADDRESS_MASK) + UPVALUE_OWNER), failed);
		assert.equal(load(memory, cell), captured);
		observe('Z', `${CPU_CAUSE_CODE_REGISTER_WINDOW} 0 ${resumePc}`);
		hash(rt, failed, THREAD_HEAP_BYTES);
		hash(rt, memory.readRamRecordWord(failed + ThreadField.FrameBlock), depth * FRAME_CONTROL_BYTES);
		hash(rt, RAM_BASE + (cell & UPVALUE_ADDRESS_MASK), UPVALUE_HEAP_BYTES);
		return cell;
	}

	function finish(rt: Runtime, cell: number) {
		const { cpu, memory } = rt.machine;
		cpu.clearHaltUntilIrq();
		commands.push('h');
		let result = RunResult.Yielded;
		// Close retires every saved frame and clears the full backing,
		// not just the windows used at the failing CALL.
		for (let count = 0; count < 2048 && result !== RunResult.Halted; ++count) result = grant(rt);
		assert.equal(result, RunResult.Halted, 'coroutine.close completed within the granted cycles');
		assert.equal(cpu.isHaltedUntilIrq(), false);
		assert.equal(cpu.getFrameDepth(), 0);
		assert.equal(cpu.readThreadStatus(failed), ThreadStatus.Dead);
		assert.equal(cpu.readThreadFrameDepth(failed), 0);
		assert.equal(cpu.readThreadError(failed), valueNil());
		assert.equal(isOpen(memory, cell), false);
		assert.equal(load(memory, cell), captured);
		const results = [valueBool(false), error, valueBool(false), error, captured];
		assert.deepEqual(rt.readCompletionValues(), results);
		observe('c', [results.length, ...results.flatMap(value => [valueTag(value), valuePayload(value)])].join(' '));
		hash(rt, failed, THREAD_HEAP_BYTES);
		hash(rt, RAM_BASE + (cell & UPVALUE_ADDRESS_MASK), UPVALUE_HEAP_BYTES);
	}

	const dir = mkdtempSync(join(tmpdir(), 'bmsx-firmware-coroutine-window-oom-'));
	t.after(() => rmSync(dir, { recursive: true, force: true }));
	const native = nativeConformanceRunner('bmsx_machine_conformance_runner');
	const romPath = join(dir, 'system.rom'), trace = join(dir, 'trace');
	const tsState = join(dir, 'ts.state'), nativeState = join(dir, 'native.state');
	writeFileSync(romPath, rom);
	const cell = inspectFailed(runtime);
	writeFileSync(tsState, encodeRuntimeSaveState(captureRuntimeSaveState(runtime)));
	commands.push(`x ${nativeState}`);
	const commandCut = commands.length, rowCut = expected.length;
	finish(runtime, cell);

	function replay(steps: readonly string[], expectedRows: readonly string[]) {
		writeFileSync(trace, steps.join('\n'));
		const rows = execFileSync(native, [romPath, trace, tsState], { encoding: 'utf8' }).trimEnd().split('\n');
		const mismatch = rows.findIndex((row, index) => row !== expectedRows[index]);
		assert.equal(mismatch, -1, `row ${mismatch}: C++=${rows[mismatch]}, TS=${expectedRows[mismatch]}`);
		assert.equal(rows.length, expectedRows.length);
	}
	replay(commands, expected);
	const tail = commands.slice(commandCut), rows = expected.slice(rowCut);
	replay(['X', ...tail], rows);
	const restored = boot();
	applyRuntimeSaveState(restored, decodeRuntimeSaveState(readFileSync(nativeState), PSX_MACHINE_SPEC.ramBytes, PSX_MACHINE_SPEC.gxGpuVramBytes));
	assert.equal(inspectFailed(restored), cell);
	commands.length = expected.length = 0;
	finish(restored, cell);
	assert.deepEqual(commands, tail);
	assert.deepEqual(expected, rows);
});
