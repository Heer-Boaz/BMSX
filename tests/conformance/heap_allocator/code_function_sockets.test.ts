import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { writeLE32 } from '../../../machine/ts/common/endian';
import { FrameField } from '../../../machine/ts/machine/cpu/call_state';
import { CpuRunKind } from '../../../machine/ts/machine/cpu/cpu';
import { ThreadField, ThreadStatus } from '../../../machine/ts/machine/cpu/thread_record';
import { valueFromTag, valueInteger, valuePayload, valueTag, ValueTag } from '../../../machine/ts/machine/cpu/value';
import { Runtime } from '../../../machine/ts/machine/runtime/runtime';
import {
	BLUA32_CONSTANT_PAYLOAD_OFFSET, BLUA32_CONSTANT_RECORD_SIZE, BLUA32_CONSTANT_TAG_OFFSET,
	BLUA32_FUNCTION_CODE, BLUA32_FUNCTION_FLAGS_OFFSET, Blua32ConstantTag,
} from '../../../machine/ts/spec/blua32/image_format';
import { COP0_CONTEXT } from '../../../machine/ts/spec/blua32/cop0';
import { INSTRUCTION_BYTES, writeInstruction } from '../../../machine/ts/spec/blua32/instruction_format';
import { MemoryAccessKind } from '../../../machine/ts/spec/blua32/memory_access_kind';
import { OpCode } from '../../../machine/ts/spec/blua32/opcode';
import { IO_CART_SELECT } from '../../../machine/ts/spec/bmsx/io';
import { CART_ROM_BASE, CPU_FIXED_STACK_BASE } from '../../../machine/ts/spec/bmsx/memory_map';
import { PSX_MACHINE_SPEC } from '../../../machine/ts/spec/bmsx/model';
import { integerConstant } from '../../../toolchain/ts/lua/number';
import { linkRawTestBlua32Pair, linkRawTestSystemBlua32 } from '../../helpers/blua32';
import { cartridgeSlots } from '../../helpers/cartridge';
import { nativeConformanceRunner } from '../../helpers/native_conformance.mjs';

test('ROM callable Values preserve physical socket through ordinary CALL', t => {
	const boot = new Uint8Array(INSTRUCTION_BYTES);
	writeInstruction(boot, 0, OpCode.RET, 0, 1, 0);
	const cartImage = (answer: number) => {
		const text = new Uint8Array(7 * INSTRUCTION_BYTES);
		writeInstruction(text, 0, OpCode.LOADK, 0, 0, 0);
		writeInstruction(text, 1, OpCode.LOADK, 1, 0, 1);
		writeInstruction(text, 2, OpCode.MOV, 2, 0, 0);
		writeInstruction(text, 3, OpCode.CALL, 2, 1, 2);
		writeInstruction(text, 4, OpCode.RET, 0, 4, 0);
		writeInstruction(text, 5, OpCode.KSMI, 0, 0, answer);
		writeInstruction(text, 6, OpCode.RET, 0, 2, 0);
		return linkRawTestBlua32Pair({ text: boot, functions: [{ firstWord: 0, wordCount: 1 }] }, {
			verifiedControlFlow: true, text, constants: [integerConstant(0), integerConstant(1)],
			functions: [{ firstWord: 0, wordCount: 5, maxStack: 3 }, { firstWord: 5, wordCount: 2 }],
		});
	};
	const left = cartImage(51), right = cartImage(57);
	const [factory, leaf] = left.cartImage.functions;
	assert.deepEqual(right.cartImage.functions.map(fn => fn.address), [factory.address, leaf.address]);
	const alternate = 0x80000000;
	// Prepare a plain physical execution context with backing for every call.
	// No heap or installer gives this fixture access to the two operand banks.
	const context = CPU_FIXED_STACK_BASE - 0x1000, frames = context + 0x100, values = context + 0x400;
	const slots = 64, window = 16;
	const code: [OpCode, number, number, number][] = [], constants: number[] = [];
	function load(register: number, value: number) {
		const index = constants.length;
		constants.push(value);
		code.push([OpCode.LOADK, register, index >>> 6, index & 63]);
	}
	function store(address: number, value: number, kind = MemoryAccessKind.Word) {
		load(0, value); load(1, address); code.push([OpCode.STORE_MEM, 0, 1, kind]);
	}
	store(context + ThreadField.Status, ThreadStatus.Running);
	store(context + ThreadField.StackTop, window);
	store(context + ThreadField.StackBlock, values);
	store(context + ThreadField.StackCapacity, slots);
	store(context + ThreadField.FrameCapacity, 12);
	store(context + ThreadField.FrameDepth, 1);
	store(context + ThreadField.FrameBlock, frames);
	const protoOperand = constants.length;
	store(frames + FrameField.Function, -1);
	const pcOperand = constants.length;
	store(frames + FrameField.Pc, -2);
	store(frames + FrameField.Top, 8);
	store(frames + FrameField.StackCapacity, window);
	store(values, factory.address);
	store(values + 4 * 15, factory.address + alternate);
	store(values + 4 * slots, ValueTag.CodeFunction, MemoryAccessKind.U8);
	store(values + 4 * slots + 15, ValueTag.CodeFunction, MemoryAccessKind.U8);
	load(0, context);
	code.push([OpCode.MTC0, 0, COP0_CONTEXT, 0], [OpCode.RET, 0, 1, 0]);
	const caller = code.length;
	code.push([OpCode.CALL, 0, 1, 4], [OpCode.MOV, 4, 15, 0], [OpCode.CALL, 4, 1, 4],
		[OpCode.MOV, 8, 0, 0], [OpCode.CALL, 8, 1, 2],
		[OpCode.MOV, 9, 4, 0], [OpCode.CALL, 9, 1, 2],
		[OpCode.MOV, 10, 5, 0], [OpCode.CALL, 10, 1, 2],
		[OpCode.MOV, 3, 4, 0], [OpCode.MOV, 4, 5, 0], [OpCode.MOV, 5, 6, 0],
		[OpCode.MOV, 6, 8, 0], [OpCode.MOV, 7, 9, 0], [OpCode.MOV, 8, 10, 0], [OpCode.RET, 0, 10, 0]);
	const systemLeaf = code.length;
	code.push([OpCode.KSMI, 0, 0, 31], [OpCode.RET, 0, 2, 0]);
	const text = new Uint8Array(code.length * INSTRUCTION_BYTES);
	for (const [i, op] of code.entries()) writeInstruction(text, i, ...op);
	const linked = linkRawTestSystemBlua32({
		text, verifiedControlFlow: true, constants: constants.map(integerConstant),
		functions: [{ firstWord: 0, wordCount: caller, maxStack: 2 },
			{ firstWord: caller, wordCount: systemLeaf - caller, maxStack: window }, { firstWord: systemLeaf, wordCount: 2 }],
	});
	const system = linked.romBytes;
	const [, issuer, sysLeaf] = linked.image.functions;
	const constant = linked.image.header.constantTableAddress;
	writeLE32(system, constant + protoOperand * BLUA32_CONSTANT_RECORD_SIZE + BLUA32_CONSTANT_PAYLOAD_OFFSET, issuer.address);
	writeLE32(system, constant + pcOperand * BLUA32_CONSTANT_RECORD_SIZE + BLUA32_CONSTANT_PAYLOAD_OFFSET, issuer.codeAddress);
	writeLE32(system, sysLeaf.address + BLUA32_FUNCTION_FLAGS_OFFSET, sysLeaf.flags | BLUA32_FUNCTION_CODE);
	for (const { cartImage, cartRomBytes } of [left, right]) {
		for (const [i, address] of [leaf.address, sysLeaf.address].entries()) {
			const offset = cartImage.header.constantTableAddress - CART_ROM_BASE + i * BLUA32_CONSTANT_RECORD_SIZE;
			writeLE32(cartRomBytes, offset + BLUA32_CONSTANT_TAG_OFFSET, Blua32ConstantTag.CodeFunction);
			writeLE32(cartRomBytes, offset + BLUA32_CONSTANT_PAYLOAD_OFFSET, address);
		}
		for (const fn of cartImage.functions)
			writeLE32(cartRomBytes, fn.address - CART_ROM_BASE + BLUA32_FUNCTION_FLAGS_OFFSET, fn.flags | BLUA32_FUNCTION_CODE);
	}

	const runtime = new Runtime({
		systemRomBytes: system, cartridgeSlots: cartridgeSlots(left.cartRomBytes, right.cartRomBytes), machineModel: PSX_MACHINE_SPEC,
	}, {
		sampleInputControllerSnapshot() {}, supervisorRequestLineHigh: () => false, applyInputControllerVibrationEffect() {},
	});
	runtime.boot();
	const { cpu, memory, scheduler } = runtime.machine;
	const commands: string[] = [];
	for (let i = 0; i < 32 && cpu.getFrameDepth() !== 0; ++i) {
		scheduler.runCpuSlice(0, 65536, 0, CpuRunKind.Scheduled);
		commands.push('E 65536');
	}
	assert.equal(cpu.readLuaFaultReasonWord(), 0);
	assert.equal(memory.readIoU32(IO_CART_SELECT), 0);
	const expected = [
		valueFromTag(ValueTag.CodeFunction, leaf.address), valueFromTag(ValueTag.CodeFunction, sysLeaf.address), valueInteger(51),
		valueFromTag(ValueTag.CodeFunction, leaf.address + alternate),
		valueFromTag(ValueTag.CodeFunction, sysLeaf.address), valueInteger(57), ...[51, 57, 31].map(valueInteger),
	];
	assert.deepEqual(runtime.readCompletionValues(), expected);
	const dir = mkdtempSync(join(tmpdir(), 'bmsx-code-function-sockets-'));
	t.after(() => rmSync(dir, { recursive: true, force: true }));
	const systemPath = join(dir, 'system.rom'), leftPath = join(dir, 'left.rom'), rightPath = join(dir, 'right.rom'), trace = join(dir, 'trace');
	writeFileSync(systemPath, system);
	writeFileSync(leftPath, left.cartRomBytes);
	writeFileSync(rightPath, right.cartRomBytes);
	writeFileSync(trace, [...commands, 'c'].join('\n'));
	const native = nativeConformanceRunner('bmsx_machine_conformance_runner');
	const rows = execFileSync(native, [systemPath, trace, join(dir, 'unused'), leftPath, rightPath], { encoding: 'utf8' }).trimEnd().split('\n');
	assert.equal(rows.at(-1), [expected.length, ...expected.flatMap(value => [valueTag(value), valuePayload(value)])].join(' '));
});
