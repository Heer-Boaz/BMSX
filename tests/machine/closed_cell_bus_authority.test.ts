import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FrameField } from '../../machine/ts/machine/cpu/call_state';
import { GC_COLOR_OFFSET } from '../../machine/ts/machine/cpu/gc_object';
import { ThreadField } from '../../machine/ts/machine/cpu/thread_record';
import { initialize, UPVALUE_ADDRESS_MASK, UPVALUE_HEAP_BYTES, UPVALUE_VALUE_TAG, UPVALUE_VALUE_WORD } from '../../machine/ts/machine/cpu/upvalue';
import { ValueTag } from '../../machine/ts/machine/cpu/value';
import { CPU_CAUSE_CODE_DATA_BUS_ERROR, CPU_CAUSE_CODE_MASK } from '../../machine/ts/spec/blua32/cop0';
import { BLUA32_FUNCTION_FLAGS_OFFSET, BLUA32_FUNCTION_RESIDENT } from '../../machine/ts/spec/blua32/image_format';
import { CLOSURE_ADDRESS_REGISTER_WIDE_C, INSTRUCTION_BYTES, writeInstruction } from '../../machine/ts/spec/blua32/instruction_format';
import { OpCode, encodeFixedValueCount } from '../../machine/ts/spec/blua32/opcode';
import {
	HEAP_SERVICE_DESCRIPTOR_FUNCTIONS_OFFSET, HEAP_SERVICE_FRAME_OFFSET, HEAP_SERVICE_IMAGE_ADDRESS_OFFSET, HeapServiceOperation,
} from '../../machine/ts/spec/bmsx/heap_service';
import { CART_ROM_BASE } from '../../machine/ts/spec/bmsx/memory_map';
import { compileLuaChunkToProgram } from '../../toolchain/ts/lua/compiler';
import { parseLuaChunk } from '../../toolchain/ts/lua/analysis/parse';
import { decodeBlua32InstructionAtPc } from '../../toolchain/ts/rompack/blua32_instruction_decode';
import { linkTestCartBlua32 } from '../helpers/blua32';
import { cartridgeSlots } from '../helpers/cartridge';
import { runGuestToHalt } from '../helpers/cpu_execution';
import { MANAGED_CART_LAUNCH } from '../helpers/managed_cart_launch';
import { bootManagedTestSystem, linkManagedTestSystem } from '../helpers/managed_system';

for (const optLevel of [0, 3] as const) test(`an ordinary cartridge CLOSURE and CALL cannot enter the private closed-cell store at O${optLevel}`, () => {
	const system = linkManagedTestSystem(MANAGED_CART_LAUNCH, optLevel);
	const cartSource = 'local a,b,c,d=121,122,123,124; return a,b,c,d';
	const cart = compileLuaChunkToProgram(parseLuaChunk(cartSource, 'cart.lua').chunk, [], { entrySource: cartSource, optLevel });
	const linked = linkTestCartBlua32(system.biosImports, cart);
	const entry = linked.cartImage.functions.find(fn => fn.address === linked.cartVectors.entryFunctionAddress)!;
	const text = linked.cartRomBytes.subarray(entry.codeAddress - CART_ROM_BASE, entry.codeAddress - CART_ROM_BASE + entry.codeByteCount);
	assert.ok(entry.maxStack >= 5);
	assert.ok(text.byteLength >= 5 * INSTRUCTION_BYTES);
	writeInstruction(text, 0, OpCode.HALT, 0, 0, 0);
	writeInstruction(text, 1, OpCode.WIDE, 0, 0, CLOSURE_ADDRESS_REGISTER_WIDE_C);
	writeInstruction(text, 2, OpCode.CLOSURE, 0, 0, 0);
	writeInstruction(text, 3, OpCode.CALL, 0, encodeFixedValueCount(2), encodeFixedValueCount(0));
	writeInstruction(text, 4, OpCode.RET, 0, encodeFixedValueCount(0), 0);
	const { cpu, memory } = bootManagedTestSystem(system, 'main', cartridgeSlots(linked.cartRomBytes));
	runGuestToHalt(cpu, 65_536);
	assert.equal(cpu.activeCartridgeSlot(), 0);
	const descriptor = memory.readMappedU32LE(system.layout.address + HEAP_SERVICE_IMAGE_ADDRESS_OFFSET);
	const target = memory.readMappedU32LE(descriptor + HEAP_SERVICE_DESCRIPTOR_FUNCTIONS_OFFSET + 4 * HeapServiceOperation.StoreClosedUpvalue);
	assert.notEqual(target, 0);
	assert.equal(memory.readMappedU32LE(target + BLUA32_FUNCTION_FLAGS_OFFSET) & BLUA32_FUNCTION_RESIDENT, 0);
	const thread = cpu.activeThread, depth = thread.frameDepth;
	// Make the actual CALL fit; an unrelated legitimate backing request
	// must not obscure whether the called ROM address gets private access.
	thread.reserveFrame(128);
	const caller = thread.currentFrame!;
	assert.equal(caller.pc, entry.codeAddress + INSTRUCTION_BYTES);
	const management = cpu.heapAllocator.managementOffset();
	const valueCapacity = memory.readRamRecordWord(thread.address + ThreadField.StackCapacity);
	const frameCapacity = memory.readRamRecordWord(thread.address + ThreadField.FrameCapacity);
	caller.registers.setInteger(0, target);
	const cell = cpu.luaHeap.allocateRecord(UPVALUE_HEAP_BYTES, true, 0, 0);
	initialize(memory, cell, cpu.gc.white());
	cpu.gc.publishObject(cell);
	memory.writeRamRecordByte(cell + GC_COLOR_OFFSET, 3);
	memory.writeRamRecordWord(cell + UPVALUE_VALUE_WORD, 73);
	memory.writeRamRecordByte(cell + UPVALUE_VALUE_TAG, ValueTag.Integer);
	caller.registers.setInteger(1, cell & UPVALUE_ADDRESS_MASK);
	caller.registers.setString(2, cpu.stringPool.intern('must not overwrite'));
	cpu.clearHaltUntilIrq();
	const callPc = entry.codeAddress + 3 * INSTRUCTION_BYTES;
	for (let i = 0; i < 4096 && (caller.pc !== callPc || cpu.heapServiceActive()); ++i) {
		if (cpu.heapServiceActive())
			assert.notEqual(memory.readRamRecordWord(management + HEAP_SERVICE_FRAME_OFFSET + FrameField.Function), target);
		cpu.runUntilDepth(0, 1);
	}
	assert.equal(caller.pc, callPc);
	assert.equal(caller.registers.getTag(0), ValueTag.Closure, 'raw address constructs only a normal Closure');
	assert.equal(cpu.heapServiceActive(), false);
	cpu.runUntilDepth(0, 1);
	assert.equal(cpu.heapServiceActive(), false, 'ordinary CALL cannot dispatch the target as a fixed root');
	assert.equal(thread.frameDepth, depth + 1);
	assert.equal(thread.currentFrame!.functionAddress, target, 'the address really is attempted in an ordinary frame');
	for (let i = 0; i < 64 && memory.readBusFaultSequence() === 0; ++i) {
		assert.equal(cpu.heapServiceActive(), false);
		cpu.runUntilDepth(0, 1);
	}
	assert.equal(memory.readBusFaultSequence(), 1);
	assert.equal(cpu.readCauseWord() & CPU_CAUSE_CODE_MASK, CPU_CAUSE_CODE_DATA_BUS_ERROR);
	const faultPc = cpu.readEpcWord();
	const targetCode = system.layout.functions.find(fn => fn.address === target)!;
	assert.ok(faultPc >= targetCode.codeAddress && faultPc < targetCode.codeAddress + targetCode.codeByteCount);
	const faulting = decodeBlua32InstructionAtPc(system.layout.textBytes, system.layout.header.textAddress, faultPc);
	assert.ok(faulting.op === OpCode.LOAD_MEM || faulting.op === OpCode.LOAD_MEM_D);
	assert.equal(cpu.heapServiceActive(), false);
	assert.equal(memory.readRamRecordWord(thread.address + ThreadField.StackCapacity), valueCapacity);
	assert.equal(memory.readRamRecordWord(thread.address + ThreadField.FrameCapacity), frameCapacity);
	assert.equal(memory.readRamRecordWord(cell + UPVALUE_VALUE_WORD), 73);
	assert.equal(memory.readRamRecordByte(cell + UPVALUE_VALUE_TAG), ValueTag.Integer);
});
