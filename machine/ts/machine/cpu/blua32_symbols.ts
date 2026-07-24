import { decodeBinary, encodeBinary } from '../../common/serializer/binencoder';
import { INSTRUCTION_BYTES } from './instruction_format';
import type { OpCode } from './opcode_info';

export const BLUA32_SYMBOLS_VERSION = 1;

export type Blua32StaticLayoutToken = {
	lo: number;
	hi: number;
};

export type Blua32ModuleFunction = {
	path: string;
	address: number;
};

export type SourcePosition = {
	line: number;
	column: number;
};

export type SourceRange = {
	path: string;
	start: SourcePosition;
	end: SourcePosition;
};

export type Blua32LocalSlotDebug = {
	name: string;
	registerIndex: number;
	definition: SourceRange;
	scope: SourceRange;
};

export type Blua32ResumePoint = {
	wordOffset: number;
	range: SourceRange;
	op: OpCode;
	liveRegisters: number[];
	uses: number[];
	defs: number[];
};

export type Blua32DebugMetadata = {
	functionIds: string[];
	globalNames: string[];
	systemGlobalNames: string[];
	staticFunctionIdBySlot: { [slotName: string]: string };
	debugRanges: ReadonlyArray<SourceRange | null>;
	resumePointsByFunction: ReadonlyArray<ReadonlyArray<Blua32ResumePoint>>;
	localSlotsByFunction: ReadonlyArray<ReadonlyArray<Blua32LocalSlotDebug>>;
	upvalueNamesByFunction: ReadonlyArray<ReadonlyArray<string>>;
};

export type Blua32SymbolsImage = {
	version: number;
	imageAddress: number;
	functionAddresses: number[];
	moduleFunctions: Blua32ModuleFunction[];
	staticLayoutToken: Blua32StaticLayoutToken;
	metadata: Blua32DebugMetadata;
};

export type Blua32MediaSymbols = {
	system: Blua32SymbolsImage | null;
	cartridgeSlots: [Blua32SymbolsImage | null, Blua32SymbolsImage | null];
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
