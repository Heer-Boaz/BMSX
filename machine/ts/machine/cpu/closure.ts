import { GC_GRAY_INDEX_BITS, GC_RECORD_LINK, GC_RECORD_MASK } from './gc_object';
import { ValueTag } from './value';
import { readLE32 } from '../../common/endian';
import type { Memory, MemoryByteView } from '../memory/memory';
import { readRomEntry, readPublishedPrototype, romFunctionVersionLane, type Blua32RomFunctionDirectory } from './execution_image';
import type { ExecutionDomainId } from '../../spec/blua32/execution_domain';
import { RAM_BASE } from '../../spec/bmsx/memory_map';
import {
	BLUA32_FUNCTION_RECORD_SIZE, BLUA32_FUNCTION_UPVALUE_COUNT_OFFSET,
	BLUA32_FUNCTION_UPVALUE_TABLE_ADDRESS_OFFSET,
} from '../../spec/blua32/image_format';

export type FunctionEntry = {
	codeAddress: number;
	numParams: number;
	maxStack: number;
	flags: number;
};

export type FunctionPrototype = FunctionEntry & {
	functionAddress: number;
	upvalueTableAddress: number;
	recordUpvalueCount: number;
	executionDomainId: ExecutionDomainId;
};

export function sameFunctionPrototype(a: Readonly<FunctionPrototype>, b: Readonly<FunctionPrototype>): boolean {
	return a.functionAddress === b.functionAddress && a.executionDomainId === b.executionDomainId
		&& a.codeAddress === b.codeAddress && a.numParams === b.numParams && a.maxStack === b.maxStack
		&& a.flags === b.flags && a.upvalueTableAddress === b.upvalueTableAddress
		&& a.recordUpvalueCount === b.recordUpvalueCount;
}

export const CLOSURE_BINDING_FLAGS = 2;
export const CLOSURE_BINDING_DOMAIN_MASK = 3;
export const CLOSURE_CANONICAL = 4;
export const CLOSURE_LATCHED_PROTOTYPE = 8;
const CLOSURE_COUNT_HIGH_BYTE = 3;
const CLOSURE_COUNT_LOW_BITS = 32 - GC_GRAY_INDEX_BITS;
export const CLOSURE_PROTOTYPE_ADDRESS = 8;
export const CLOSURE_CAPTURE_WORDS = 12;
const CLOSURE_LATCHED_PROTOTYPE_BYTES = 6 * 4;

// CALL decodes an architectural reference. Allocator ownership is not
// part of the binding record used to enter a function.
export function recordAddress(memory: Memory, reference: number): number {
	const offset = reference & GC_RECORD_MASK;
	return memory.readRamRecordByte(offset) === ValueTag.Closure ? RAM_BASE + offset : 0;
}

export function closureRecordBytes(captures: number, latched = false): number {
	return CLOSURE_CAPTURE_WORDS + 4 * captures + (latched ? CLOSURE_LATCHED_PROTOTYPE_BYTES : 0);
}

export function executionDomain(flags: number): ExecutionDomainId {
	const bank = flags & CLOSURE_BINDING_DOMAIN_MASK;
	return (bank >= 2 ? 1 : bank - 1) as ExecutionDomainId;
}
export function captureCount(memory: Memory, address: number): number {
	const low = memory.readRamRecordWord(address + GC_RECORD_LINK) >>> GC_GRAY_INDEX_BITS;
	const high = memory.readRamRecordByte(address + CLOSURE_COUNT_HIGH_BYTE) & 0x7f;
	return low | (high << CLOSURE_COUNT_LOW_BITS);
}
export function captureAddress(memory: Memory, address: number, index: number): number {
	return memory.readRamRecordWord(address + CLOSURE_CAPTURE_WORDS + index * 4);
}
export function setCaptureAddress(memory: Memory, address: number, index: number, reference: number): void {
	memory.writeRamRecordWord(address + CLOSURE_CAPTURE_WORDS + index * 4, reference);
}
export function initializeRecord(memory: Memory, address: number, prototype: Readonly<FunctionPrototype>, canonical: boolean, white: number, count: number, latched = false): void {
	const flags = (prototype.executionDomainId + 1) | (canonical ? CLOSURE_CANONICAL : 0) | (latched ? CLOSURE_LATCHED_PROTOTYPE : 0);
	memory.writeRamRecordWord(address, ValueTag.Closure | (white << 8) | (flags << 16) | ((count >>> CLOSURE_COUNT_LOW_BITS) << 24));
	memory.writeRamRecordWord(address + GC_RECORD_LINK, count << GC_GRAY_INDEX_BITS);
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
export function readLatchedEntry(memory: Memory, address: number, target: FunctionEntry): number {
	const tail = address + CLOSURE_CAPTURE_WORDS + captureCount(memory, address) * 4;
	target.codeAddress = memory.readRamRecordWord(tail);
	target.numParams = memory.readRamRecordWord(tail + 4);
	target.maxStack = memory.readRamRecordWord(tail + 8);
	target.flags = memory.readRamRecordWord(tail + 12);
	return tail;
}

// Inspection and canonicalization also consume the upvalue descriptor words.
export function readBinding(memory: Memory, address: number, flags: number, directory: Blua32RomFunctionDirectory, view: MemoryByteView, target: FunctionPrototype): void {
	target.functionAddress = memory.readRamRecordWord(address + CLOSURE_PROTOTYPE_ADDRESS);
	const bank = flags & CLOSURE_BINDING_DOMAIN_MASK;
	target.executionDomainId = executionDomain(flags);
	if ((flags & CLOSURE_LATCHED_PROTOTYPE) !== 0) {
		const tail = readLatchedEntry(memory, address, target);
		target.upvalueTableAddress = memory.readRamRecordWord(tail + 16);
		target.recordUpvalueCount = memory.readRamRecordWord(tail + 20);
		return;
	}
	if (!directory.mappedCode) {
		readPublishedPrototype(directory.versions, romFunctionVersionLane(directory, target.functionAddress), target);
		return;
	}
	if (!memory.bindRomByteView(target.functionAddress, BLUA32_FUNCTION_RECORD_SIZE, bank >>> 1, view)) {
		// Undriven ROM lanes, not a second host-side binding authority.
		target.codeAddress = target.numParams = target.maxStack = target.flags = target.upvalueTableAddress = target.recordUpvalueCount = 0;
		return;
	}
	const { bytes, byteOffset } = view;
	readRomEntry(bytes, byteOffset, target);
	target.upvalueTableAddress = readLE32(bytes, byteOffset + BLUA32_FUNCTION_UPVALUE_TABLE_ADDRESS_OFFSET);
	target.recordUpvalueCount = readLE32(bytes, byteOffset + BLUA32_FUNCTION_UPVALUE_COUNT_OFFSET);
}
