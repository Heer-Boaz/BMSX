import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { FRAME_CONTROL_BYTES, FrameField } from '../../../machine/ts/machine/cpu/call_state';
import { CpuRunKind, RunResult } from '../../../machine/ts/machine/cpu/cpu';
import { THREAD_CONTROL_COUNT_MASK, ThreadField } from '../../../machine/ts/machine/cpu/thread_record';
import { ValueTag, valueFloatBits, valueInteger, valueNil, valuePayload, valueTag } from '../../../machine/ts/machine/cpu/value';
import { Runtime } from '../../../machine/ts/machine/runtime/runtime';
import { applyRuntimeSaveState, captureRuntimeSaveState } from '../../../machine/ts/machine/runtime/save_state';
import { decodeRuntimeSaveState, encodeRuntimeSaveState } from '../../../machine/ts/machine/runtime/save_state/codec';
import { hashBytes } from '../../../machine/ts/common/hash';
import { CPU_CAUSE_CODE_REGISTER_WINDOW, CPU_CAUSE_CODE_TRAP, CPU_STATUS_USER_MODE_CURRENT, LUA_FAULT_REASON_EXPLICIT_ERROR } from '../../../machine/ts/spec/blua32/cop0';
import { SYSTEM_EXECUTION_DOMAIN_ID } from '../../../machine/ts/spec/blua32/execution_domain';
import { INSTRUCTION_BYTES } from '../../../machine/ts/spec/blua32/instruction_format';
import { VALUE_MEMORY_SIZE, VALUE_MEMORY_TAG_OFFSET } from '../../../machine/ts/spec/blua32/memory_access_kind';
import { OpCode } from '../../../machine/ts/spec/blua32/opcode';
import {
	IO_SYS_SUPERVISOR_FAULT_BAD_ADDRESS, IO_SYS_SUPERVISOR_FAULT_CAUSE, IO_SYS_SUPERVISOR_FAULT_DOMAIN,
	IO_SYS_SUPERVISOR_FAULT_EPC, IO_SYS_SUPERVISOR_FAULT_LUA_REASON,
} from '../../../machine/ts/spec/bmsx/io';
import { CPU_INTERRUPTED_CONTEXT_ADDRESS, CPU_RESET_BANK_ADDRESS, RAM_BASE, SYSTEM_ROM_BASE } from '../../../machine/ts/spec/bmsx/memory_map';
import { PSX_MACHINE_SPEC } from '../../../machine/ts/spec/bmsx/model';
import { decodeBlua32InstructionAtPc } from '../../../toolchain/ts/rompack/blua32_instruction_decode';
import { writeTestBlua32Rom } from '../../helpers/blua32';
import { cartridgeSlots } from '../../helpers/cartridge';
import { linkManagedTestSystem } from '../../helpers/managed_system';
import { nativeConformanceRunner } from '../../helpers/native_conformance.mjs';

const native = nativeConformanceRunner('bmsx_heap_service_conformance_runner');
const input = { sampleInputControllerSnapshot() {}, supervisorRequestLineHigh: () => false, applyInputControllerVibrationEffect() {} };
const trapBits = 0xff812345, errorPadding = 0xa46e5300, guard = 0x36c9583a, reached = 0x52651a72;

for (const optLevel of [0, 3] as const) test(`System firmware retains the outer trap across nested register-window growth (O${optLevel})`, t => {
	const linked = linkManagedTestSystem(`
local bridge<const> = require('kernel/exception_bridge')
local raise<const> = __bmsx_error
struct trap_report_record
	left: u32
	payload: value
	second: value
	vector_argument: value
	status: u32
	resumed: u32
	right: u32
	cause: u32
	issue: u32
	bad_address: u32
	reason: u32
end
bss trap_report: trap_report_record
function exception(argument)
	local result<const>: *trap_report_record = trap_report
	result.vector_argument = argument
	result.payload = bridge.take_trap_value()
	result.second = bridge.take_trap_value()
	local original<const>: *monitor_entry_state = bridge.monitor_entry
	result.status = original.status
	result.cause = original.cause
	result.issue = original.epc
	result.bad_address = original.bad_address
	result.reason = original.lua_fault_reason
	cop0.epc = original.epc + ${INSTRUCTION_BYTES}
	cop0.status = original.status
end

local ready<const>: *word = bridge.monitor_ready
*ready = 1
local result<const>: *trap_report_record = trap_report
result.left = ${guard}
result.right = ${guard}
local error_tag_word<const>: *u32 = cop0.current + offsetof(thread_storage_record.error_tag)
*error_tag_word = 0x${errorPadding.toString(16)}
local payload<const> = blua32.float_from_bits(0x${trapBits.toString(16)})
cop0.status = ${CPU_STATUS_USER_MODE_CURRENT}
raise(payload)
result.resumed = ${reached}
return 77
`, optLevel);
	const bss = linked.object.sections.bss.symbols.find(symbol => symbol.name.endsWith('trap_report'))!;
	const report = linked.layout.header.bssAddress + bss.offset;
	const startup = linked.symbols.functionAddresses[linked.symbols.metadata.functionIds.indexOf('module:main/startup')];
	const rom = writeTestBlua32Rom(linked);
	const boot = () => {
		const rt = new Runtime({ systemRomBytes: rom, cartridgeSlots: cartridgeSlots(), machineModel: PSX_MACHINE_SPEC }, input);
		rt.boot();
		assert.equal(rt.machine.cpu.rootThread.address, CPU_RESET_BANK_ADDRESS);
		return rt;
	};
	const runtime = boot(), { cpu, memory } = runtime.machine;
	const dir = mkdtempSync(join(tmpdir(), 'bmsx-firmware-trap-payload-'));
	t.after(() => rmSync(dir, { recursive: true, force: true }));
	const romPath = join(dir, 'system.rom'), trace = join(dir, 'trace'), tsState = join(dir, 'ts.state'), nativeState = join(dir, 'cpp.state');
	writeFileSync(romPath, rom);
	const commands: string[] = [], expected: string[] = [];
	function record(command: string, row?: string | number) {
		commands.push(command);
		if (row !== undefined) expected.push(String(row));
	}
	function replay() {
		writeFileSync(trace, commands.join('\n'));
		const rows = execFileSync(native, [romPath, trace, tsState], { encoding: 'utf8' }).trimEnd().split('\n');
		const mismatch = rows.findIndex((row, index) => row !== expected[index]);
		assert.equal(mismatch, -1, `row ${mismatch}: C++=${rows[mismatch]}, TS=${expected[mismatch]}`);
		assert.equal(rows.length, expected.length);
	}
	function sampleMemory(rt: Runtime, addr: number, bytes: number) {
		const offset = addr - RAM_BASE;
		record(`H ${offset} ${offset + bytes}`, hashBytes(rt.machine.memory.ramData(), offset, bytes));
	}
	function grant(rt: Runtime, cycles: number) {
		const { cpu, memory, scheduler } = rt.machine;
		const result = scheduler.runCpuSlice(0, cycles, undefined, CpuRunKind.Scheduled);
		record(`E ${cycles}`, `${result} ${cycles - cpu.instructionBudgetRemaining} ${memory.ramBusEnd()} ${cpu.activeCartridgeSlot()}`);
		return result;
	}

	for (let i = 0; i < 1024 && cpu.readFrameFunctionAddress(0) !== startup; ++i)
		assert.equal(grant(runtime, 2048), RunResult.Yielded);
	assert.equal(cpu.readFrameFunctionAddress(0), startup);
	const trapped = () => cpu.fixedInterruptActive() && cpu.readCauseWord() === CPU_CAUSE_CODE_TRAP;
	for (let i = 0; i < 20000 && !trapped(); ++i) assert.equal(grant(runtime, 1), RunResult.Yielded);
	assert.ok(trapped());
	const owner = cpu.rootThread.address, issue = cpu.readEpcWord(), entry = cpu.activeThread.currentFrame!;
	const instruction = decodeBlua32InstructionAtPc(rom, SYSTEM_ROM_BASE, issue);
	assert.equal(instruction.op, OpCode.CALL);
	assert.equal(instruction.pc, issue, 'the fixture resume adds one instruction');
	assert.equal(entry.argumentCount, 1);
	assert.equal(entry.registers.get(0), valueFloatBits(trapBits));
	assert.equal(cpu.isUserMode(), false);
	assert.equal(memory.readRamRecordWord(CPU_INTERRUPTED_CONTEXT_ADDRESS), owner);
	assert.equal(memory.readRamRecordWord(owner + ThreadField.ErrorWord), 0, 'CPU must not write Thread.error');
	assert.equal(memory.readRamRecordWord(owner + ThreadField.ErrorKind), errorPadding);
	record('Z', `${CPU_CAUSE_CODE_TRAP} ${LUA_FAULT_REASON_EXPLICIT_ERROR} ${issue}`);
	sampleMemory(runtime, owner + ThreadField.ErrorWord, VALUE_MEMORY_SIZE);
	sampleMemory(runtime, RAM_BASE + entry.controlOffset, FRAME_CONTROL_BYTES);
	const fixedStack = RAM_BASE + entry.thread.stackOffset();
	sampleMemory(runtime, fixedStack + 4 * entry.stackBase, 4);
	sampleMemory(runtime, fixedStack + 4 * entry.thread.stackRegisters.capacity() + entry.stackBase, 1);
	const badAddress = cpu.readBadAddressWord();
	function sampleSupervisorFault(rt: Runtime) {
		for (const [address, expected] of [
			[IO_SYS_SUPERVISOR_FAULT_CAUSE, CPU_CAUSE_CODE_TRAP],
			[IO_SYS_SUPERVISOR_FAULT_EPC, issue],
			[IO_SYS_SUPERVISOR_FAULT_BAD_ADDRESS, badAddress],
			[IO_SYS_SUPERVISOR_FAULT_LUA_REASON, LUA_FAULT_REASON_EXPLICIT_ERROR],
			[IO_SYS_SUPERVISOR_FAULT_DOMAIN, SYSTEM_EXECUTION_DOMAIN_ID >>> 0],
		]) {
			assert.equal(rt.machine.memory.readIoU32(address), expected);
			record(`M ${address}`, `${expected} 0`);
		}
	}

	for (let i = 0; i < 16384 && cpu.fixedInterruptActive(); ++i)
		assert.equal(grant(runtime, 1), RunResult.Yielded);
	assert.equal(cpu.fixedInterruptActive(), false);
	assert.equal(cpu.activeThread.address, owner);
	assert.equal(memory.readRamRecordWord(CPU_INTERRUPTED_CONTEXT_ADDRESS), 0);
	const target = cpu.activeThread.currentFrame!;
	assert.equal(target.isExceptionFrame, true);
	assert.equal(target.argumentCount, 0, 'the managed transfer is a generic vector entry');
	assert.equal(target.registers.get(0), valueNil());
	assert.equal(memory.readRamRecordWord(owner + ThreadField.ErrorWord), trapBits, 'firmware owns the payload now');
	assert.equal(memory.readRamRecordWord(owner + ThreadField.ErrorKind), (errorPadding | ValueTag.Float) >>> 0);
	sampleMemory(runtime, owner + ThreadField.ErrorWord, VALUE_MEMORY_SIZE);
	sampleMemory(runtime, RAM_BASE + target.controlOffset, FRAME_CONTROL_BYTES);

	const values = memory.readRamRecordWord(owner + ThreadField.StackCapacity);
	const frames = memory.readRamRecordWord(owner + ThreadField.FrameCapacity) & THREAD_CONTROL_COUNT_MASK;
	for (let i = 0; i < 128 && !cpu.fixedInterruptActive(); ++i)
		assert.equal(grant(runtime, 97), RunResult.Yielded);
	assert.equal(cpu.fixedInterruptActive(), true, 'ordinary managed handler CALL needs more backing');
	assert.equal(cpu.readCauseWord(), CPU_CAUSE_CODE_REGISTER_WINDOW);
	const nestedIssue = cpu.readEpcWord();
	assert.notEqual(nestedIssue, issue);
	assert.equal(decodeBlua32InstructionAtPc(rom, SYSTEM_ROM_BASE, nestedIssue).op, OpCode.CALL);
	assert.equal(memory.readRamRecordWord(CPU_INTERRUPTED_CONTEXT_ADDRESS), owner);
	const depth = memory.readRamRecordWord(owner + ThreadField.FrameDepth) & THREAD_CONTROL_COUNT_MASK;
	const caller = memory.readRamRecordWord(owner + ThreadField.FrameBlock) + (depth - 1) * FRAME_CONTROL_BYTES;
	assert.equal(memory.readRamRecordWord(caller + FrameField.Pc), nestedIssue, 'the issuing managed CALL has not entered');
	assert.equal(memory.readRamRecordWord(report + 4), 0, 'the managed handler has not consumed the trap');
	assert.equal(memory.readRamRecordWord(owner + ThreadField.ErrorWord), trapBits);
	const nested = cpu.activeThread.currentFrame!;
	assert.equal(nested.argumentCount, 4);
	const valueEnd = valuePayload(nested.registers.get(0)), frameEnd = valuePayload(nested.registers.get(1));
	assert.ok(valueEnd > values || frameEnd > frames, 'physical backing is short at the nested CALL');
	record('Z', `${CPU_CAUSE_CODE_REGISTER_WINDOW} ${cpu.readLuaFaultReasonWord()} ${nestedIssue}`);
	sampleMemory(runtime, caller, FRAME_CONTROL_BYTES);
	sampleMemory(runtime, owner + ThreadField.ErrorWord, VALUE_MEMORY_SIZE);
	sampleSupervisorFault(runtime);
	record(`x ${nativeState}`);
	writeFileSync(tsState, encodeRuntimeSaveState(captureRuntimeSaveState(runtime)));
	const commandCut = commands.length, rowCut = expected.length;

	function finish(rt: Runtime) {
		const { cpu, memory } = rt.machine;
		assert.equal(cpu.fixedInterruptActive(), true);
		assert.equal(cpu.readCauseWord(), CPU_CAUSE_CODE_REGISTER_WINDOW);
		assert.equal(cpu.readEpcWord(), nestedIssue);
		let run = RunResult.Yielded;
		for (let i = 0; i < 512 && run !== RunResult.Halted; ++i) run = grant(rt, 97);
		assert.equal(run, RunResult.Halted);
		assert.ok(memory.readRamRecordWord(owner + ThreadField.StackCapacity) >= valueEnd);
		assert.ok((memory.readRamRecordWord(owner + ThreadField.FrameCapacity) & THREAD_CONTROL_COUNT_MASK) >= frameEnd);
		assert.equal(cpu.captureRuntimeState().statusWord, CPU_STATUS_USER_MODE_CURRENT);
		assert.equal(cpu.readEpcWord(), issue + INSTRUCTION_BYTES);
		assert.equal(memory.readRamRecordWord(owner + ThreadField.ErrorWord), 0);
		assert.equal(memory.readRamRecordWord(owner + ThreadField.ErrorKind), errorPadding);
		assert.equal(memory.readRamRecordWord(report), guard);
		assert.equal(memory.readRamRecordWord(report + 4), trapBits);
		assert.equal(memory.readRamRecordByte(report + 4 + VALUE_MEMORY_TAG_OFFSET), ValueTag.Float);
		for (const offset of [12, 20]) {
			assert.equal(memory.readRamRecordWord(report + offset), 0);
			assert.equal(memory.readRamRecordByte(report + offset + VALUE_MEMORY_TAG_OFFSET), ValueTag.Nil);
		}
		assert.equal(memory.readRamRecordWord(report + 28), CPU_STATUS_USER_MODE_CURRENT << 2);
		assert.equal(memory.readRamRecordWord(report + 32), reached);
		assert.equal(memory.readRamRecordWord(report + 36), guard);
		assert.equal(memory.readRamRecordWord(report + 40), CPU_CAUSE_CODE_TRAP);
		assert.equal(memory.readRamRecordWord(report + 44), issue);
		assert.equal(memory.readRamRecordWord(report + 48), badAddress);
		assert.equal(memory.readRamRecordWord(report + 52), LUA_FAULT_REASON_EXPLICIT_ERROR);
		assert.deepEqual(rt.readCompletionValues(), [valueInteger(77)]);
		assert.equal(cpu.readCauseWord(), CPU_CAUSE_CODE_REGISTER_WINDOW, 'hardware retains the latest exception independently');
		record('Z', `${CPU_CAUSE_CODE_REGISTER_WINDOW} ${cpu.readLuaFaultReasonWord()} ${issue + INSTRUCTION_BYTES}`);
		record('c', `1 ${valueTag(valueInteger(77))} ${valuePayload(valueInteger(77))}`);
		sampleSupervisorFault(rt);
		sampleMemory(rt, owner + ThreadField.ErrorWord, VALUE_MEMORY_SIZE);
		sampleMemory(rt, report, bss.byteCount);
	}
	finish(runtime);
	replay();
	const tail = commands.slice(commandCut), rows = expected.slice(rowCut);
	commands.splice(0, commands.length, 'X', ...tail);
	expected.splice(0, expected.length, ...rows);
	replay();
	const restored = boot();
	applyRuntimeSaveState(restored, decodeRuntimeSaveState(readFileSync(nativeState), PSX_MACHINE_SPEC.ramBytes, PSX_MACHINE_SPEC.gxGpuVramBytes));
	commands.length = expected.length = 0;
	finish(restored);
	assert.deepEqual(commands, tail);
	assert.deepEqual(expected, rows);
});
