import type { Blua32FunctionRecord, Blua32ImageLayout } from './blua32_image';
import type { Closure } from './closure';
import type { ExecutionDomainId } from '../execution_address_space';
import { OpCode } from '../../spec/blua32/opcode';
import type { Table } from './table';
import type { Value } from './value';

export type TableLoadInlineCache = {
	table: Table | null;
	version: number;
	value: Value;
};

export const DECODED_PAGE_SHIFT = 8;
export const DECODED_PAGE_WORDS = 1 << DECODED_PAGE_SHIFT;
export const DECODED_PAGE_MASK = DECODED_PAGE_WORDS - 1;

export type DecodedInstructionPage = {
	widths: Uint8Array;
	ops: Uint8Array;
	a: Uint16Array;
	b: Uint16Array;
	c: Uint16Array;
	bx: Uint32Array;
	sbx: Int32Array;
	rkB: Int32Array;
	rkC: Int32Array;
	disp: Uint8Array;
	words: Uint32Array;
	tableCacheIndexes: Uint32Array;
};

export type Blua32RuntimeFunction = Blua32FunctionRecord & {
	image: Blua32ExecutionImage;
	index: number;
};

export type Blua32ExecutionImage = {
	layout: Blua32ImageLayout;
	executionDomainId: ExecutionDomainId;
	irqFunctionAddress: number;
	functions: Blua32RuntimeFunction[];
	constPool: Value[];
	globalSlots: Uint32Array;
	systemGlobalSlots: Uint32Array;
	decodedPages: DecodedInstructionPage[];
	decodedWordCount: number;
	tableLoadCaches: TableLoadInlineCache[];
	staticClosures: Closure[];
};

export function createDecodedInstructionPage(): DecodedInstructionPage {
	const page: DecodedInstructionPage = {
		widths: new Uint8Array(DECODED_PAGE_WORDS),
		ops: new Uint8Array(DECODED_PAGE_WORDS),
		a: new Uint16Array(DECODED_PAGE_WORDS),
		b: new Uint16Array(DECODED_PAGE_WORDS),
		c: new Uint16Array(DECODED_PAGE_WORDS),
		bx: new Uint32Array(DECODED_PAGE_WORDS),
		sbx: new Int32Array(DECODED_PAGE_WORDS),
		rkB: new Int32Array(DECODED_PAGE_WORDS),
		rkC: new Int32Array(DECODED_PAGE_WORDS),
		disp: new Uint8Array(DECODED_PAGE_WORDS),
		words: new Uint32Array(DECODED_PAGE_WORDS),
		tableCacheIndexes: new Uint32Array(DECODED_PAGE_WORDS),
	};
	page.widths.fill(1);
	page.ops.fill(OpCode.WIDE);
	return page;
}
