import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { writeLE32 } from '../../../machine/ts/common/endian';
import { hashBytes } from '../../../machine/ts/common/hash';
import { FrameField } from '../../../machine/ts/machine/cpu/call_state';
import { CpuRunKind, RunResult } from '../../../machine/ts/machine/cpu/cpu';
import { ThreadField } from '../../../machine/ts/machine/cpu/thread_record';
import { valueBuiltinFunction, valueFloatBits, valueInteger, valueNil, valuePayload, valueTag } from '../../../machine/ts/machine/cpu/value';
import { Runtime } from '../../../machine/ts/machine/runtime/runtime';
import { BuiltinFunctionId } from '../../../machine/ts/spec/blua32/builtin';
import { COP0_CONTEXT, CPU_CAUSE_CODE_TRAP, LUA_FAULT_REASON_CALL_NON_FUNCTION, LUA_FAULT_REASON_EXPLICIT_ERROR } from '../../../machine/ts/spec/blua32/cop0';
import { BLUA32_CONSTANT_PAYLOAD_OFFSET, BLUA32_CONSTANT_RECORD_SIZE } from '../../../machine/ts/spec/blua32/image_format';
import { INSTRUCTION_BYTES, writeInstruction } from '../../../machine/ts/spec/blua32/instruction_format';
import { MemoryAccessKind } from '../../../machine/ts/spec/blua32/memory_access_kind';
import { OpCode } from '../../../machine/ts/spec/blua32/opcode';
import { CPU_FIXED_STACK_BASE, CPU_INTERRUPTED_CONTEXT_ADDRESS, RAM_BASE, SYSTEM_ROM_BASE } from '../../../machine/ts/spec/bmsx/memory_map';
import { PSX_MACHINE_SPEC } from '../../../machine/ts/spec/bmsx/model';
import { integerConstant } from '../../../toolchain/ts/lua/number';
import { linkRawTestSystemBlua32 } from '../../helpers/blua32';
import { cartridgeSlots } from '../../helpers/cartridge';
import { nativeConformanceRunner } from '../../helpers/native_conformance.mjs';

for (const explicit of [true, false]) test(explicit
	? 'raw explicit Trap delivers the original tagged Value without writing Thread.error'
	: 'raw numeric Trap delivers only its reason without diagnostic storage', t => {
	const context = CPU_FIXED_STACK_BASE - 0x4000, frame = context + 0x100, backing = context + 0x200;
	const capacity = 8, tags = backing + capacity * 4;
	const previousError = valueInteger(-769), thrown = valueFloatBits(0xff812345);
	const callee = explicit ? valueBuiltinFunction(BuiltinFunctionId.Error) : valueInteger(123);
	const reason = explicit ? LUA_FAULT_REASON_EXPLICIT_ERROR : LUA_FAULT_REASON_CALL_NON_FUNCTION;
	const argument = explicit ? thrown : valueNil();
	const instructions: [OpCode, number, number, number][] = [];
	const constants: number[] = [];
	function load(register: number, value: number) {
		const index = constants.push(value) - 1;
		instructions.push([OpCode.LOADK, register, index >>> 6, index & 63]);
		return index;
	}
	function store(address: number, value: number, kind = MemoryAccessKind.Word) {
		const index = load(0, value);
		load(1, address);
		instructions.push([OpCode.STORE_MEM, 0, 1, kind]);
		return index;
	}
	for (const [field, data] of [
		[ThreadField.StackTop, capacity], [ThreadField.StackBlock, backing], [ThreadField.StackCapacity, capacity],
		[ThreadField.FrameDepth, 1], [ThreadField.FrameCapacity, 2], [ThreadField.FrameBlock, frame],
		[ThreadField.ErrorWord, valuePayload(previousError)], [ThreadField.ErrorKind, valueTag(previousError)],
	] as const) store(context + field, data);
	store(frame + FrameField.StackCapacity, capacity);
	store(frame + FrameField.Top, 2);
	const functionConstant = store(frame + FrameField.Function, 0);
	const pcConstant = store(frame + FrameField.Pc, 0);
	store(backing, valuePayload(callee));
	store(tags, valueTag(callee), MemoryAccessKind.U8);
	store(backing + 4, valuePayload(thrown));
	store(tags + 1, valueTag(thrown), MemoryAccessKind.U8);
	load(0, context);
	instructions.push([OpCode.MTC0, 0, COP0_CONTEXT, 0], [OpCode.RET, 0, 1, 0]);
	const callWord = instructions.length;
	instructions.push([OpCode.CALL, 0, 2, 1], [OpCode.RET, 0, 1, 0]);
	const vectorWord = instructions.length;
	instructions.push([OpCode.MOV, 1, 0, 0], [OpCode.ARGC, 2, 0, 0], [OpCode.RFE, 0, 0, 0]);
	const text = new Uint8Array(instructions.length * INSTRUCTION_BYTES);
	for (const [index, instruction] of instructions.entries()) writeInstruction(text, index, ...instruction);
	const { romBytes: rom, image } = linkRawTestSystemBlua32({
		text, verifiedControlFlow: true, constants: constants.map(integerConstant), exceptionFunctionIndex: 2,
		functions: [
			{ firstWord: 0, wordCount: callWord, maxStack: 2 },
			{ firstWord: callWord, wordCount: 2, maxStack: capacity },
			{ firstWord: vectorWord, wordCount: 3, maxStack: 3 },
		],
	});
	const issuer = image.functions[1], vector = image.functions[2];
	const constantBase = image.header.constantTableAddress - SYSTEM_ROM_BASE + BLUA32_CONSTANT_PAYLOAD_OFFSET;
	writeLE32(rom, constantBase + functionConstant * BLUA32_CONSTANT_RECORD_SIZE, issuer.address);
	writeLE32(rom, constantBase + pcConstant * BLUA32_CONSTANT_RECORD_SIZE, issuer.codeAddress);

	const input = { sampleInputControllerSnapshot() {}, supervisorRequestLineHigh: () => false, applyInputControllerVibrationEffect() {} };
	const runtime = new Runtime({ systemRomBytes: rom, cartridgeSlots: cartridgeSlots(), machineModel: PSX_MACHINE_SPEC }, input);
	runtime.boot();
	const { cpu, memory, scheduler } = runtime.machine;
	const commands: string[] = [], expected: string[] = [];
	function observe(command: string, answer: string | number) {
		commands.push(command);
		expected.push(String(answer));
	}
	function step() {
		const result = scheduler.runCpuSlice(0, 1, undefined, CpuRunKind.Scheduled);
		assert.equal(result, RunResult.Yielded);
		assert.equal(cpu.heapServiceActive(), false);
		observe('E 1', `${result} ${1 - cpu.instructionBudgetRemaining} 0 ${memory.ramBusEnd()} -1`);
	}
	function hash(first: number, length: number) {
		observe(`H ${first} ${first + length}`, hashBytes(memory.ramData(), first, length));
	}
	function checkInterruptedError() {
		assert.equal(memory.readRamRecordWord(context + ThreadField.ErrorWord), valuePayload(previousError));
		assert.equal(memory.readRamRecordWord(context + ThreadField.ErrorKind), valueTag(previousError));
		hash(context - RAM_BASE + ThreadField.ErrorWord, 8);
	}
	for (let i = 0; i < callWord && cpu.activeThread.address !== context; ++i) step();
	assert.equal(cpu.activeThread.address, context);
	assert.equal(cpu.readFramePc(0), issuer.codeAddress);
	assert.equal(cpu.readFrameRegister(0, 1), thrown);
	checkInterruptedError();
	step(); // Ordinary CALL, without stock firmware or a diagnostic table.
	assert.equal(cpu.fixedInterruptActive(), true);
	assert.equal(cpu.readFramePc(0), vector.codeAddress);
	assert.equal(cpu.readCauseWord(), CPU_CAUSE_CODE_TRAP);
	assert.equal(cpu.readLuaFaultReasonWord(), reason);
	assert.equal(cpu.readEpcWord(), issuer.codeAddress);
	assert.equal(memory.readRamRecordWord(CPU_INTERRUPTED_CONTEXT_ADDRESS), context);
	checkInterruptedError();
	observe('P', `1 ${vector.codeAddress}`);
	observe('Z', `${CPU_CAUSE_CODE_TRAP} ${reason} ${issuer.codeAddress}`);
	hash(CPU_INTERRUPTED_CONTEXT_ADDRESS - RAM_BASE, 4);
	const active = cpu.activeThread.currentFrame!;
	assert.equal(active.registers.get(0), argument);
	step(); // Observe the delivered bits through ordinary instructions.
	step();
	assert.equal(active.registers.get(1), argument);
	assert.equal(active.registers.get(2), valueInteger(+explicit));
	const slot = active.stackBase, values = active.thread.stackOffset();
	hash(values + slot * 4, 3 * 4);
	hash(values + active.thread.stackRegisters.capacity() * 4 + slot, 3);

	const directory = mkdtempSync(join(tmpdir(), 'bmsx-raw-trap-value-'));
	t.after(() => rmSync(directory, { recursive: true, force: true }));
	const romPath = join(directory, 'system.rom'), trace = join(directory, 'trace');
	writeFileSync(romPath, rom);
	writeFileSync(trace, commands.join('\n'));
	const native = nativeConformanceRunner('bmsx_heap_service_conformance_runner');
	assert.deepEqual(execFileSync(native, [romPath, trace, join(directory, 'unused.state')], { encoding: 'utf8' }).trimEnd().split('\n'), expected);
});
