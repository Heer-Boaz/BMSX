import type { Blua32UpvalueRecord } from './blua32_image';
import type { ProgramWordRange } from '../lua/compiler/word_range';
import type { LexicalDeclarationKind, StaticDeclarationKind } from '../lua/compiler/declaration_kind';
import { decodeBinary, encodeBinary } from '../../../machine/ts/common/serializer/binencoder';
import { INSTRUCTION_BYTES } from '../../../machine/ts/spec/blua32/instruction_format';
import type { OpCode } from '../../../machine/ts/spec/blua32/opcode';
import type { SourceRange } from '../lua/source_range';
import type { TraceStatementSelection } from '../lua/compiler/trace_statement';

export const BLUA32_SYMBOLS_IMAGE_ID = '__blua32_symbols__';

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
	readonly liveWordRanges: readonly ProgramWordRange[];
	name: string;
	isConst: boolean;
	registerIndex: number;
	definition: SourceRange;
	scope: SourceRange;
	inlineCallSites: ReadonlyArray<Blua32InlineCallSite>;
};

export type Blua32OuterBindingDebug = {
	declarationIndex: number;
	location: Blua32UpvalueRecord | null;
	inlineCallSites: ReadonlyArray<Blua32InlineCallSite>;
	readonly liveWordRanges: readonly ProgramWordRange[];
};

export type Blua32LexicalDeclarationDebug = {
	functionId: string;
	name: string;
	kind: LexicalDeclarationKind;
	isConst: boolean;
	/** Current defining syntax, or null after that declaration was removed. */
	definition: SourceRange | null;
};

export type Blua32ResumePoint = {
	resumeId?: string;
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

export type Blua32StaticBindingDebug = {
	declarationIndex: number;
	inlineDepth: number;
	visibleWordRanges: readonly ProgramWordRange[];
};

export type Blua32StaticScopes = {
	declarations: readonly Blua32StaticDeclarationDebug[];
	globals: readonly number[];
	bindingsByFunction: readonly (readonly Blua32StaticBindingDebug[])[];
};

export type Blua32DebugMetadata = {
	staticScopes: Blua32StaticScopes;
	traceStatements: TraceStatementSelection;
	preloadModules: readonly string[];
	functionIds: string[];
	functionDisplayNames: string[];
	functionDefinitions: ReadonlyArray<SourceRange | null>;
	globalNames: string[];
	systemGlobalNames: string[];
	staticFunctionIdBySlot: { [slotName: string]: string };
	debugRanges: ReadonlyArray<SourceRange | null>;
	debugInlineCallSiteChains: ReadonlyArray<ReadonlyArray<Blua32InlineCallSite>>;
	debugInlineCallSiteChainIds: ReadonlyArray<number>;
	statementPointsByFunction: ReadonlyArray<ReadonlyArray<Blua32StatementPoint>>;
	resumePointsByFunction: ReadonlyArray<ReadonlyArray<Blua32ResumePoint>>;
	localSlotsByFunction: ReadonlyArray<ReadonlyArray<Blua32LocalSlotDebug>>;
	outerBindingsByFunction: ReadonlyArray<ReadonlyArray<Blua32OuterBindingDebug>>;
	lexicalDeclarations: ReadonlyArray<Blua32LexicalDeclarationDebug>;
	upvalueBindingsByFunction: ReadonlyArray<ReadonlyArray<number>>;
};

export type Blua32StaticDeclarationDebug = {
	name: string;
	definition: SourceRange;
	kind: StaticDeclarationKind;
	/** Present for storage sections; struct declarations have no runtime location. */
	address?: number;
};

export type Blua32SymbolsImage = {
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
	return decodeBinary(bytes) as Blua32SymbolsImage;
}

export function blua32SourceRangeAtPc(
	symbols: Blua32SymbolsImage,
	textAddress: number,
	pc: number,
): SourceRange | null {
	return symbols.metadata.debugRanges[(pc - textAddress) / INSTRUCTION_BYTES];
}

export function blua32SlotLiveAtPc(ranges: readonly ProgramWordRange[], codeAddress: number, pc: number): boolean {
	const word = (pc - codeAddress) / INSTRUCTION_BYTES;
	let low = 0, high = ranges.length;
	while (low < high) {
		const middle = (low + high) >>> 1;
		if (ranges[middle].end <= word) low = middle + 1;
		else high = middle;
	}
	return low < ranges.length && ranges[low].start <= word;
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

export function blua32FunctionDisplayNameById(
	symbols: Blua32SymbolsImage,
	functionId: string,
): string {
	return symbols.metadata.functionDisplayNames[
		symbols.metadata.functionIds.indexOf(functionId)
	];
}
