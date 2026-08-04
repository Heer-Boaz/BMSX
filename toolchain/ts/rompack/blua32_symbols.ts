import { decodeBinary, encodeBinary } from '../../../machine/ts/common/serializer/binencoder';
import { INSTRUCTION_BYTES } from '../../../machine/ts/spec/blua32/instruction_format';
import type { OpCode } from '../../../machine/ts/spec/blua32/opcode';
import type { SourceRange } from '../lua/source_range';

export const BLUA32_SYMBOLS_IMAGE_ID = '__blua32_symbols__';
export const BLUA32_SYMBOLS_VERSION = 3;

export type Blua32StaticLayoutToken = {
	lo: number;
	hi: number;
};

export type Blua32ModuleFunction = {
	path: string;
	address: number;
};

export type Blua32InitParticipant = {
	functionId: string;
	slotName: string;
	system: boolean;
};

export type Blua32InlineCallSite = {
	calleeFunctionId: string;
	callRange: SourceRange;
};

export type Blua32LocalSlotDebug = {
	name: string;
	registerIndex: number;
	definition: SourceRange;
	scope: SourceRange;
	inlineCallSites: ReadonlyArray<Blua32InlineCallSite>;
};

export type Blua32ResumePoint = {
	wordOffset: number;
	range: SourceRange;
	op: OpCode;
	liveRegisters: number[];
	uses: number[];
	defs: number[];
	inlineCallSites: ReadonlyArray<Blua32InlineCallSite>;
};

export type Blua32StatementPoint = {
	wordOffset: number;
	range: SourceRange;
	inlineCallSites: ReadonlyArray<Blua32InlineCallSite>;
};

export type Blua32DebugMetadata = {
	functionIds: string[];
	globalNames: string[];
	systemGlobalNames: string[];
	staticFunctionIdBySlot: { [slotName: string]: string };
	debugRanges: ReadonlyArray<SourceRange | null>;
	debugInlineCallSiteChains: ReadonlyArray<ReadonlyArray<Blua32InlineCallSite>>;
	debugInlineCallSiteChainIds: ReadonlyArray<number>;
	statementPointsByFunction: ReadonlyArray<ReadonlyArray<Blua32StatementPoint>>;
	resumePointsByFunction: ReadonlyArray<ReadonlyArray<Blua32ResumePoint>>;
	localSlotsByFunction: ReadonlyArray<ReadonlyArray<Blua32LocalSlotDebug>>;
	upvalueNamesByFunction: ReadonlyArray<ReadonlyArray<string>>;
};

export type Blua32SymbolsImage = {
	version: number;
	imageAddress: number;
	functionAddresses: number[];
	moduleFunctions: Blua32ModuleFunction[];
	initFunctionAddress: number;
	initParticipants: Blua32InitParticipant[];
	staticLayoutToken: Blua32StaticLayoutToken;
	metadata: Blua32DebugMetadata;
};

export function encodeBlua32SymbolsImage(symbols: Blua32SymbolsImage): Uint8Array {
	return encodeBinary(symbols);
}

export function decodeBlua32SymbolsImage(bytes: Uint8Array): Blua32SymbolsImage {
	const symbols = decodeBinary(bytes) as Blua32SymbolsImage;
	if (symbols.version !== BLUA32_SYMBOLS_VERSION) {
		throw new Error('BLua32 symbols version is unsupported.');
	}
	return symbols;
}

export function blua32SourceRangeAtPc(
	symbols: Blua32SymbolsImage,
	textAddress: number,
	pc: number,
): SourceRange | null {
	return symbols.metadata.debugRanges[(pc - textAddress) / INSTRUCTION_BYTES];
}

export function blua32InlineCallSitesAtPc(
	symbols: Blua32SymbolsImage,
	textAddress: number,
	pc: number,
): ReadonlyArray<Blua32InlineCallSite> {
	const wordIndex = (pc - textAddress) / INSTRUCTION_BYTES;
	return symbols.metadata.debugInlineCallSiteChains[
		symbols.metadata.debugInlineCallSiteChainIds[wordIndex]
	];
}
