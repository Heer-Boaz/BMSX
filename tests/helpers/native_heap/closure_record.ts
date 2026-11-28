import {
	CLOSURE_BINDING_DOMAIN_MASK, CLOSURE_BINDING_FLAGS, CLOSURE_CAPTURE_WORDS,
	CLOSURE_COUNT_LOW_BITS, CLOSURE_COUNT_SHIFT, CLOSURE_COUNT_WORD, CLOSURE_LATCHED_PROTOTYPE,
	CLOSURE_PROTOTYPE_ADDRESS, captureCount, type FunctionPrototype,
} from '../../../machine/ts/machine/cpu/closure';
import { ValueTag } from '../../../machine/ts/machine/cpu/value';
import type { Memory } from '../../../machine/ts/machine/memory/memory';
import { CLOSURE_CANONICAL } from '../../../toolchain/ts/firmware/stock_object_layout';

export function setCaptureAddress(memory: Memory, address: number, index: number, reference: number): void {
	memory.writeRamRecordWord(address + CLOSURE_CAPTURE_WORDS + index * 4, reference);
}
export function initializeRecord(memory: Memory, address: number, prototype: Readonly<FunctionPrototype>, canonical: boolean, white: number, count: number, latched = false): void {
	const flags = (prototype.executionDomainId + 1) | (canonical ? CLOSURE_CANONICAL : 0) | (latched ? CLOSURE_LATCHED_PROTOTYPE : 0);
	memory.writeRamRecordWord(address, ValueTag.Closure | (white << 8) | (flags << 16) | ((count >>> CLOSURE_COUNT_LOW_BITS) << 24));
	memory.writeRamRecordWord(address + CLOSURE_COUNT_WORD, count << CLOSURE_COUNT_SHIFT);
	writePrototypeWords(memory, address, prototype, latched, count);
}
export function writeBinding(memory: Memory, address: number, prototype: Readonly<FunctionPrototype>): void {
	const flags = memory.readRamRecordByte(address + CLOSURE_BINDING_FLAGS);
	memory.writeRamRecordByte(address + CLOSURE_BINDING_FLAGS, (flags & ~CLOSURE_BINDING_DOMAIN_MASK) | (prototype.executionDomainId + 1));
	writePrototypeWords(memory, address, prototype, (flags & CLOSURE_LATCHED_PROTOTYPE) !== 0, captureCount(memory, address));
}
function writePrototypeWords(memory: Memory, address: number, prototype: Readonly<FunctionPrototype>, latched: boolean, count: number): void {
	memory.writeRamRecordWord(address + CLOSURE_PROTOTYPE_ADDRESS, prototype.functionAddress);
	if (latched) {
		const tail = address + CLOSURE_CAPTURE_WORDS + count * 4;
		memory.writeRamRecordWord(tail, prototype.codeAddress);
		memory.writeRamRecordWord(tail + 4, prototype.numParams);
		memory.writeRamRecordWord(tail + 8, prototype.maxStack);
		memory.writeRamRecordWord(tail + 12, prototype.flags);
		memory.writeRamRecordWord(tail + 16, prototype.upvalueTableAddress);
		memory.writeRamRecordWord(tail + 20, prototype.recordUpvalueCount);
	}
}
