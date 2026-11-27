import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { hashBytes } from '../../../machine/ts/common/hash';
import { FRAME_CONTROL_BYTES, FRAME_WINDOW_MASK, FrameField } from '../../../machine/ts/machine/cpu/call_state';
import { captureAddress, CLOSURE_PROTOTYPE_ADDRESS } from '../../../machine/ts/machine/cpu/closure';
import { CpuRunKind, RunResult } from '../../../machine/ts/machine/cpu/cpu';
import { THREAD_HEAP_BYTES, ThreadField, ThreadStatus } from '../../../machine/ts/machine/cpu/thread_record';
import { isOpen, load, UPVALUE_ADDRESS_MASK, UPVALUE_HEAP_BYTES, UPVALUE_OWNER } from '../../../machine/ts/machine/cpu/upvalue';
import { asClosure, asThread, valueBool, valueInteger, valueNil, valuePayload, valueString, valueTag } from '../../../machine/ts/machine/cpu/value';
import { Runtime } from '../../../machine/ts/machine/runtime/runtime';
import { applyRuntimeSaveState, captureRuntimeSaveState } from '../../../machine/ts/machine/runtime/save_state';
import { decodeRuntimeSaveState, encodeRuntimeSaveState } from '../../../machine/ts/machine/runtime/save_state/codec';
import { CPU_CAUSE_CODE_REGISTER_WINDOW, LUA_FAULT_REASON_OUT_OF_MEMORY } from '../../../machine/ts/spec/blua32/cop0';
import { INSTRUCTION_BYTES } from '../../../machine/ts/spec/blua32/instruction_format';
import { OpCode } from '../../../machine/ts/spec/blua32/opcode';
import { GC_DIAGNOSTIC_OFFSET, GcDiagnosticField } from '../../../machine/ts/machine/cpu/gc_heap';
import { CPU_INTERRUPTED_CONTEXT_ADDRESS, CPU_RESET_BANK_ADDRESS, RAM_BASE, SYSTEM_ROM_BASE } from '../../../machine/ts/spec/bmsx/memory_map';
import { PSX_MACHINE_SPEC } from '../../../machine/ts/spec/bmsx/model';
import { decodeBlua32InstructionAtPc } from '../../../toolchain/ts/rompack/blua32_instruction_decode';
import { writeTestBlua32Rom } from '../../helpers/blua32';
import { cartridgeSlots } from '../../helpers/cartridge';
import { COROUTINE_FIRMWARE_MODULES } from '../../helpers/firmware_modules';
import { linkManagedTestSystem } from '../../helpers/managed_system';
import { nativeConformanceRunner } from '../../helpers/native_conformance.mjs';

const native = nativeConformanceRunner('bmsx_heap_service_conformance_runner');
const input = { sampleInputControllerSnapshot() {}, supervisorRequestLineHigh: () => false, applyInputControllerVibrationEffect() {} };

test('terminal register-window OOM returns to the resumer and preserves the failed coroutine for close', t => {
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
resume_ok = ok
resume_error = err
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
	let run = RunResult.Yielded, required = 0, issues = 0, depth = 0, issue = 0, resume = 0, failed = 0;
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
		const closure = asClosure(cpu.readThreadRegister(interrupted, frameCount - 1, callee), cpu.gc);
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
		resume = cpu.readThreadFrameWord(resumer, cpu.readThreadFrameDepth(resumer) - 1, FrameField.Pc);
		failed = interrupted;
		observe('Z', `${CPU_CAUSE_CODE_REGISTER_WINDOW} 0 ${issue}`);
		hash(runtime, issuer, FRAME_CONTROL_BYTES);
	}
	assert.equal(run, RunResult.Halted);
	assert.ok(issues > 1, 'real recursive growth preceded the terminal shortage');
	assert.ok(memory.ramBusEnd() >= linked.layout.header.bssAddress + staticBytes);
	assert.notEqual(resume, issue);

	const faultHead = cpu.heapAllocator.managementOffset() + GC_DIAGNOSTIC_OFFSET;
	const faults = memory.readRamRecordWord(faultHead + GcDiagnosticField.FaultIds);
	const diagnostic = memory.readRamRecordWord(faults + INSTRUCTION_BYTES * LUA_FAULT_REASON_OUT_OF_MEMORY);
	const error = valueString(diagnostic), captured = valueInteger(marker);
	assert.equal(cpu.stringPool.toString(diagnostic), 'Out of memory.');

	function inspectFailed(rt: Runtime) {
		const { cpu, memory } = rt.machine;
		const observedGlobal = (name: string) => cpu.getGlobalByKey(cpu.stringPool.find(name)!);
		assert.equal(asThread(observedGlobal('failed_thread'), cpu.gc), failed);
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
		assert.equal(cpu.readEpcWord(), resume);
		assert.equal(observedGlobal('resume_ok'), valueBool(false));
		assert.equal(observedGlobal('resume_error'), error);
		const closure = asClosure(observedGlobal('escaped_cell'), cpu.gc);
		const cell = captureAddress(memory, closure, 0);
		assert.ok(isOpen(memory, cell));
		assert.equal(memory.readRamRecordWord((cell & UPVALUE_ADDRESS_MASK) + UPVALUE_OWNER), failed);
		assert.equal(load(memory, cell), captured);
		observe('Z', `${CPU_CAUSE_CODE_REGISTER_WINDOW} 0 ${resume}`);
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
