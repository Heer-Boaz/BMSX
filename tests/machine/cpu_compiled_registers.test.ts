import { bindOpen } from '../helpers/native_heap/upvalue_record';
import { initializeRecord, setCaptureAddress } from '../helpers/native_heap/closure_record';
import { nativeHeapReference } from '../helpers/native_heap/reference';
import { createReferenceTable } from '../helpers/cpu_heap_reference';
import { allocateClosureRecordReference } from '../helpers/captured_closure_reference';
import assert from 'node:assert/strict';
import { closeUpvalueReference, storeUpvalueReference } from '../helpers/upvalue_store_reference';
import { test } from 'node:test';
import { CompiledBlockExit, CpuExecutionBackend } from '../../machine/ts/machine/cpu/compiled_block';
import * as Upvalue from '../../machine/ts/machine/cpu/upvalue';
import { ValueSlots } from '../../machine/ts/machine/cpu/value_slots';
import { ValueTag, valueTag, valuePayload, valueFloatBits, valueFromTag, valueInteger, valueString, valueTable } from '../../machine/ts/machine/cpu/value';
import { MAPPED_PAGE_BYTE_SIZE } from '../../machine/ts/machine/memory/mapped_page';
import { INSTRUCTION_BYTES, writeInstruction } from '../../machine/ts/spec/blua32/instruction_format';
import { MemoryAccessKind } from '../../machine/ts/spec/blua32/memory_access_kind';
import { OpCode } from '../../machine/ts/spec/blua32/opcode';
import { IO_BASE } from '../../machine/ts/spec/bmsx/memory_map';
import { linkRawTestSystemBlua32 } from '../helpers/blua32';
import { createTestHeapServiceCpu } from '../helpers/heap_service_system';
import { observeRegisterStores } from '../helpers/cpu_execution';
import { allocateThreadRecordReference, resizeThreadStackReference } from '../helpers/thread_allocation_reference';

test('both open and closed upvalue paths define output-only region bindings', () => {
	const text = new Uint8Array(MAPPED_PAGE_BYTE_SIZE);
	writeInstruction(text, 0, OpCode.MOV, 8, 2, 0);
	writeInstruction(text, 1, OpCode.GETUP, 20, 0, 0);
	writeInstruction(text, 2, OpCode.JMP, 0, 0, 0);
	writeInstruction(text, 3, OpCode.MOV, 21, 20, 0);
	writeInstruction(text, 4, OpCode.JMP, 0, 63, 59, 255);
	const image = linkRawTestSystemBlua32({ text, functions: [{ firstWord: 0, wordCount: 5, maxStack: 22 }] });
	const { cpu } = createTestHeapServiceCpu(image, CpuExecutionBackend.JavaScript);
	const frame = cpu.rootThread.frameAtDepth(0), r = frame.registers;
	const bound = frame.closure;
	const cells = new Uint32Array(1);
	const replacement = allocateClosureRecordReference(cpu, 1, false, cells, cells.length);
	const upvalue = cells[0];
	bindOpen(cpu.memory, upvalue, frame.thread.address, frame.stackBase + 8, 0);
	initializeRecord(cpu.memory, replacement, cpu.captureClosureBinding(bound), false, nativeHeapReference(cpu).gc.white(), 1);
	setCaptureAddress(cpu.memory, replacement, 0, upvalue);
	frame.closureAddress = replacement;
	cpu.runUntilDepth(0, 1024);
	const page = frame.decodedPage!, first = (image.image.functions[0].codeAddress & (MAPPED_PAGE_BYTE_SIZE - 1)) / INSTRUCTION_BYTES;
	const block = page.compiledBlocks!.entries[first]!;
	const other = cpu.bindThread(allocateThreadRecordReference(cpu, 0));
	resizeThreadStackReference(cpu, other, 22);
	const values = [valueFromTag(ValueTag.False, 37), valueInteger(-1), valueFloatBits(0x80000000), valueFloatBits(0xffc01234),
		valueString(nativeHeapReference(cpu).stringPool.intern('upvalue')), valueTable(createReferenceTable(cpu))];
	for (const source of ['own', 'other', 'closed']) for (const value of values) {
		if (source === 'closed') {
			if (Upvalue.isOpen(cpu.memory, upvalue)) closeUpvalueReference(cpu, upvalue);
		} else {
			bindOpen(cpu.memory, upvalue, source === 'own' ? frame.thread.address : other.address, source === 'own' ? frame.stackBase + 8 : 8, 0);
		}
		storeUpvalueReference(cpu, upvalue, valueTag(value), valuePayload(value));
		for (const grant of [1, 64]) {
			r.set(2, value);
			r.setInteger(8, 73); r.setInteger(20, 74); r.setInteger(21, 75);
			const state = { remainingCycles: grant, registerTop: 3, memoryAddress: 0 };
			block.region.execute(r, frame.executionImage.constWords, page, frame, block.entry, state);
			for (const register of grant === 1 ? [8, 20] : [8, 20, 21]) {
				assert.equal(r.get(register), value, `${source} upvalue tag and payload R${register}`);
			}
			if (grant === 1) assert.equal(r.getInteger(21), 75, 'an unexecuted successor leaves its destination intact');
		}
	}
});

test('output locals become observable only after their definition, including helper continuations', () => {
	const text = new Uint8Array(MAPPED_PAGE_BYTE_SIZE);
	writeInstruction(text, 0, OpCode.LOAD_MEM, 0, 1, MemoryAccessKind.U32LE);
	writeInstruction(text, 1, OpCode.MOV, 20, 2, 0);
	writeInstruction(text, 2, OpCode.JMP, 0, 0, 0);
	writeInstruction(text, 3, OpCode.MOV, 21, 20, 0);
	writeInstruction(text, 4, OpCode.JMP, 0, 63, 59, 255);
	const image = linkRawTestSystemBlua32({ text, functions: [{ firstWord: 0, wordCount: 5, maxStack: 22 }] }, 4);
	const address = image.image.header.bssAddress;
	const { cpu, memory } = createTestHeapServiceCpu(image, CpuExecutionBackend.JavaScript);
	const frame = cpu.rootThread.frameAtDepth(0);
	frame.registers.setInteger(1, address);
	cpu.runUntilDepth(0, 1024);
	const page = frame.decodedPage!, first = (image.image.functions[0].codeAddress & (MAPPED_PAGE_BYTE_SIZE - 1)) / INSTRUCTION_BYTES;
	const block = page.compiledBlocks!.entries[first]!;
	const old = createReferenceTable(cpu), source = createReferenceTable(cpu);
	for (const mapped of [false, true]) for (const grant of [1, 64]) {
		const r = new ValueSlots(22);
		r.setEncoded(0, ValueTag.False, 37);
		r.setInteger(1, mapped ? address : IO_BASE);
		r.setTable(2, source); r.setTable(20, old);
		r.set(21, valueFloatBits(0x80000000));
		memory.writeMappedWord(address, 71);
		const writes = new Uint32Array(22);
		observeRegisterStores(r, register => { ++writes[register]; });
		const state = { remainingCycles: grant, registerTop: 3, memoryAddress: 0 };
		const exit = block.region.exits[block.region.execute(r, frame.executionImage.constWords, page, frame, block.entry, state)];
		if (!mapped) {
			assert.equal(exit.exit, CompiledBlockExit.ReadMemory);
			assert.equal(r.getTag(0), ValueTag.False); assert.equal(r.getPayload(0), 37);
			assert.equal(r.getPayload(20), old); assert.equal(writes[20], 0);
			assert.equal(r.get(21), valueFloatBits(0x80000000)); assert.equal(state.registerTop, 3);
		} else {
			assert.equal(r.getInteger(0), 71); assert.equal(r.getPayload(20), source);
			if (grant === 1) {
				assert.equal(r.get(21), valueFloatBits(0x80000000)); assert.equal(state.registerTop, 21);
			} else {
				assert.equal(r.getPayload(21), source); assert.equal(state.registerTop, 22);
			}
		}
	}
});
