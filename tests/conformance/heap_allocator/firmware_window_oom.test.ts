import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { hashBytes } from '../../../machine/ts/common/hash';
import { FRAME_CONTROL_BYTES, FRAME_WINDOW_MASK, FrameField, ProtectedField } from '../../../machine/ts/machine/cpu/call_state';
import { CpuRunKind, RunResult } from '../../../machine/ts/machine/cpu/cpu';
import { THREAD_CONTROL_COUNT_MASK, THREAD_HEAP_BYTES, ThreadField } from '../../../machine/ts/machine/cpu/thread_record';
import { valueBool, valuePayload, valueString, valueTag } from '../../../machine/ts/machine/cpu/value';
import { Runtime } from '../../../machine/ts/machine/runtime/runtime';
import { CPU_CAUSE_CODE_REGISTER_WINDOW, LUA_FAULT_REASON_OUT_OF_MEMORY } from '../../../machine/ts/spec/blua32/cop0';
import { INSTRUCTION_BYTES } from '../../../machine/ts/spec/blua32/instruction_format';
import { OpCode } from '../../../machine/ts/spec/blua32/opcode';
import { HEAP_SERVICE_REMARK_HEAD_OFFSET, HeapServiceRemarkHeadField } from '../../../machine/ts/spec/bmsx/heap_service';
import { CPU_INTERRUPTED_CONTEXT_ADDRESS, CPU_RESET_BANK_ADDRESS, RAM_BASE, SYSTEM_ROM_BASE } from '../../../machine/ts/spec/bmsx/memory_map';
import { PSX_MACHINE_SPEC } from '../../../machine/ts/spec/bmsx/model';
import { decodeBlua32InstructionAtPc } from '../../../toolchain/ts/rompack/blua32_instruction_decode';
import { writeTestBlua32Rom } from '../../helpers/blua32';
import { cartridgeSlots } from '../../helpers/cartridge';
import { linkManagedTestSystem } from '../../helpers/managed_system';
import { nativeConformanceRunner } from '../../helpers/native_conformance.mjs';

const native = nativeConformanceRunner('bmsx_heap_service_conformance_runner');
const input = { sampleInputControllerSnapshot() {}, supervisorRequestLineHigh: () => false, applyInputControllerVibrationEffect() {} };

test('the firmware catches terminal CALL window OOM with the original pcall diagnostic', t => {
	const staticBytes = 3_600_000;
	const locals = Array.from({ length: 160 }, (_, index) => `local z${index} = 1`).join('\n');
	// The program reduces the allocatable RAM through its real image
	// sections. Each recursive CALL needs another non-inlined window.
	const linked = linkManagedTestSystem(`
bss blocked: u8[${staticBytes}]
blocked[0] = 1
local protect<const> = __bmsx_pcall
local function descend()
	${locals}
	return descend()
end
return protect(descend)
`, 0);
	const rom = writeTestBlua32Rom(linked);
	const runtime = new Runtime({ systemRomBytes: rom, cartridgeSlots: cartridgeSlots(), machineModel: PSX_MACHINE_SPEC }, input);
	runtime.boot();
	const { cpu, memory, scheduler } = runtime.machine;
	assert.equal(cpu.rootThread.address, CPU_RESET_BANK_ADDRESS);
	const entries = new Map(linked.layout.functions.map(fn => [fn.address, fn]));
	const commands: string[] = [], expected: string[] = [];
	function observe(command: string, row: string | number) {
		commands.push(command);
		expected.push(String(row));
	}
	function checkRam(first: number, size: number) {
		observe(`H ${first} ${first + size}`, hashBytes(memory.ramData(), first, size));
	}

	const budget = 3072;
	let run = RunResult.Yielded;
	let issue = 0, required = 0, resume = 0, issues = 0;
	for (let grant = 0; grant < 8192 && run !== RunResult.Halted; ++grant) {
		run = scheduler.runCpuSlice(0, budget, undefined, CpuRunKind.Scheduled);
		observe(`E ${budget}`, `${run} ${budget - cpu.instructionBudgetRemaining} ${+cpu.heapServiceActive()} ${memory.ramBusEnd()} ${cpu.activeCartridgeSlot()}`);
		if (!cpu.fixedInterruptActive() || cpu.readCauseWord() !== CPU_CAUSE_CODE_REGISTER_WINDOW) continue;
		const interrupted = memory.readRamRecordWord(CPU_INTERRUPTED_CONTEXT_ADDRESS);
		const protectedDepth = memory.readRamRecordWord(interrupted + ThreadField.ProtectedDepth) & THREAD_CONTROL_COUNT_MASK;
		if (protectedDepth === 0) continue; // Ordinary growth before pcall.
		assert.equal(protectedDepth, 1);
		assert.equal(interrupted, cpu.rootThread.address);
		assert.equal(cpu.heapServiceActive(), false);
		const controls = memory.readRamRecordWord(interrupted + ThreadField.FrameBlock);
		const depth = memory.readRamRecordWord(interrupted + ThreadField.FrameDepth) & THREAD_CONTROL_COUNT_MASK;
		const issuer = controls + (depth - 1) * FRAME_CONTROL_BYTES, pc = cpu.readEpcWord();
		if (memory.readRamRecordWord(issuer + FrameField.Pc) !== pc) continue; // Firmware already unwound.
		const { op, a: callee } = decodeBlua32InstructionAtPc(rom, SYSTEM_ROM_BASE, pc);
		assert.equal(op, OpCode.CALL);
		// The recursive callee is its issuing function. The original frame
		// and argument slot remain physical while firmware runs other calls.
		const fn = entries.get(memory.readRamRecordWord(issuer + FrameField.Function))!;
		const base = memory.readRamRecordWord(issuer + FrameField.StackBase) & FRAME_WINDOW_MASK;
		const extent = base + callee + 1 + fn.maxStack;
		if (extent <= required) continue;
		issue = pc;
		required = extent;
		++issues;
		const protection = memory.readRamRecordWord(interrupted + ThreadField.ProtectedBlock);
		const caller = memory.readRamRecordWord(protection + ProtectedField.Caller);
		resume = memory.readRamRecordWord(controls + caller * FRAME_CONTROL_BYTES + FrameField.Pc);
		observe('Z', `${CPU_CAUSE_CODE_REGISTER_WINDOW} 0 ${issue}`);
		checkRam(issuer - RAM_BASE, FRAME_CONTROL_BYTES);
		checkRam(interrupted - RAM_BASE, THREAD_HEAP_BYTES);
	}
	assert.equal(run, RunResult.Halted);
	assert.ok(issues > 1, 'real window growth happened before terminal OOM');
	assert.ok(required > memory.readRamRecordWord(cpu.rootThread.address + ThreadField.StackCapacity),
		'the failing recursive CALL was never given its requested window');
	assert.ok(memory.ramBusEnd() >= linked.layout.header.bssAddress + staticBytes);
	assert.equal(cpu.readCauseWord(), CPU_CAUSE_CODE_REGISTER_WINDOW);
	assert.notEqual(resume, issue);
	assert.equal(cpu.readEpcWord(), resume, 'firmware returns to the saved pcall continuation, not the rejected CALL');
	assert.equal(cpu.readLuaFaultReasonWord(), 0, 'firmware, not the native Lua fault handler, delivered this result');
	assert.equal(cpu.fixedInterruptActive(), false);
	assert.equal(memory.readRamRecordWord(CPU_INTERRUPTED_CONTEXT_ADDRESS), 0);
	assert.equal(memory.readRamRecordWord(cpu.rootThread.address + ThreadField.ProtectedDepth) & THREAD_CONTROL_COUNT_MASK, 0);
	assert.equal(cpu.getFrameDepth(), 0);

	const head = cpu.heapAllocator.managementOffset() + HEAP_SERVICE_REMARK_HEAD_OFFSET;
	const faults = memory.readRamRecordWord(head + HeapServiceRemarkHeadField.FaultIds);
	const diagnostic = memory.readRamRecordWord(faults + INSTRUCTION_BYTES * LUA_FAULT_REASON_OUT_OF_MEMORY);
	assert.equal(cpu.stringPool.toString(diagnostic), 'Out of memory.');
	const result = [valueBool(false), valueString(diagnostic)];
	assert.deepEqual(runtime.readCompletionValues(), result);
	observe('Z', `${CPU_CAUSE_CODE_REGISTER_WINDOW} 0 ${resume}`);
	observe('c', [result.length, ...result.flatMap(value => [valueTag(value), valuePayload(value)])].join(' '));
	checkRam(cpu.rootThread.address - RAM_BASE, THREAD_HEAP_BYTES);

	const dir = mkdtempSync(join(tmpdir(), 'bmsx-firmware-window-oom-'));
	t.after(() => rmSync(dir, { recursive: true, force: true }));
	const romPath = join(dir, 'system.rom'), trace = join(dir, 'trace');
	writeFileSync(romPath, rom);
	writeFileSync(trace, commands.join('\n'));
	const rows = execFileSync(native, [romPath, trace, trace], { encoding: 'utf8' }).trimEnd().split('\n');
	const mismatch = rows.findIndex((row, index) => row !== expected[index]);
	assert.equal(mismatch, -1, `row ${mismatch}: C++=${rows[mismatch]}, TS=${expected[mismatch]}`);
	assert.equal(rows.length, expected.length);
});
