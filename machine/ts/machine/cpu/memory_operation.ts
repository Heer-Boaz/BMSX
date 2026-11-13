import type { MemoryAccessKind } from '../../spec/blua32/memory_access_kind';

export enum PendingMemoryKind { None, Store, WordStores }

/** The decoded instruction stays latched while an endpoint is not ready. */
export type PendingMemoryOperation = {
	kind: PendingMemoryKind;
	instructionPc: number;
	nextPc: number;
	address: number;
	accessKind: MemoryAccessKind;
	registerIndex: number;
	wordCount: number;
};
