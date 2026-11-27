import type { NumberConstant } from '../number';
import type { OptimizationLevel } from './optimizer';
import type { LexicalDeclarationKind } from './declaration_kind';
import type { ProgramWordRange } from './word_range';
import type { SourceRange } from '../source_range';
import type { OpCode } from '../../../../machine/ts/spec/blua32/opcode';
import type { TraceStatementSelection } from './trace_statement';
import { BiosFunction, BIOS_FUNCTION_SLOTS } from '../../../../machine/ts/spec/bmsx/bios';
import type { ProgramStaticScopes } from './static_debug';

export type ProgramConstant = null | boolean | NumberConstant | string;

// Linked System exports entering the resident stack through ordinary CALL.
// The compiler must preserve the boundary; the System linker proves it.
export const SYSTEM_RESIDENT_EXPORTS = [
	{ path: 'kernel/gc_collect_step', exportPathKey: 'collect_step', numParams: 0 },
	{ path: 'kernel/gc_full', exportPathKey: 'collect_full', numParams: 0 },
	{ path: 'kernel/gc_full', exportPathKey: 'heap_bytes', numParams: 0 },
	{ ...BIOS_FUNCTION_SLOTS[BiosFunction.CreateTable], numParams: 2 },
] as const;

export type ProgramInitParticipant = {
	functionId: string;
	slotName: string;
	system: boolean;
};

export const buildInitParticipantSlotName = (functionId: string): string =>
	`@init:${functionId}`;

export type ProgramRuntimeSymbols = {
	protoIds: string[];
	globalNames: string[];
	systemGlobalNames: string[];
	exportProtoIdBySlot: { [slotName: string]: string };
	initParticipants: ProgramInitParticipant[];
};

export type InlineCallSite = {
	calleeFunctionId: string;
	callRange: SourceRange;
};

export type ProgramResumePoint = {
	resumeId?: string;
	wordOffset: number;
	range: SourceRange;
	op: OpCode;
	liveRegisters: number[];
	uses: number[];
	defs: number[];
	inlineCallSites: ReadonlyArray<InlineCallSite>;
};

export type ProgramStatementPoint = {
	wordOffset: number;
	range: SourceRange;
	inlineCallSites: ReadonlyArray<InlineCallSite>;
};

export type LocalSlotDebug = {
	/** Zero-based formal argument, including an implicit receiver; -1 for a local. */
	argumentIndex: number;
	name: string;
	/** Authored binding immutability, independent of value/location liveness. */
	isConst: boolean;
	registerIndex: number;
	definition: SourceRange;
	scope: SourceRange;
	inlineCallSites: ReadonlyArray<InlineCallSite>;
};

export type LocatedLocalSlotDebug = LocalSlotDebug & {
	readonly liveWordRanges: readonly ProgramWordRange[];
};

/** Defining declaration shared by source scopes and any physical capture routes. */
export type LexicalDeclarationDebug = {
	functionId: string;
	name: string;
	kind: LexicalDeclarationKind;
	isConst: boolean;
	definition: SourceRange;
};

/** A visible outer declaration may never acquire a physical capture. */
export type OuterBindingDebug = {
	declarationIndex: number;
	location: UpvalueDesc | null;
	inlineCallSites: ReadonlyArray<InlineCallSite>;
};

export type LocatedOuterBindingDebug = OuterBindingDebug & {
	readonly liveWordRanges: readonly ProgramWordRange[];
};

export type ProgramMetadata = ProgramRuntimeSymbols & {
	optLevel: OptimizationLevel;
	staticScopes: ProgramStaticScopes;
	traceStatements: TraceStatementSelection;
	preloadModules: readonly string[];
	/** The actual entry module first, then canonical inputs including modules without runtime code. */
	compiledModulePaths: readonly string[];
	functionDefinitionsByProto: ReadonlyArray<SourceRange | null>;
	protoDisplayNames: string[];
	debugRanges: ReadonlyArray<SourceRange | null>;
	debugInlineCallSites: ReadonlyArray<ReadonlyArray<InlineCallSite>>;
	statementPointsByProto: ReadonlyArray<ReadonlyArray<ProgramStatementPoint>>;
	resumePointsByProto: ReadonlyArray<ReadonlyArray<ProgramResumePoint>>;
	localSlotsByProto: ReadonlyArray<ReadonlyArray<LocatedLocalSlotDebug>>;
	outerBindingsByProto: ReadonlyArray<ReadonlyArray<LocatedOuterBindingDebug>>;
	lexicalDeclarations: ReadonlyArray<LexicalDeclarationDebug>;
	upvalueBindingsByProto: ReadonlyArray<ReadonlyArray<number>>;
};

export type Program = {
	code: Uint8Array<ArrayBuffer>;
	constPool: ProgramConstant[];
	protos: Proto[];
	moduleProtos: ProgramModuleProto[];
	moduleExports: ProgramModuleExport[];
	moduleProtoMap: Map<string, number>;
};

export type ProgramModuleProto = {
	path: string;
	protoIndex: number;
};

export type ProgramModuleExport = {
	path: string;
	exportPathKey: string;
	slotName: string;
};

export type ProgramFunctionSymbol = {
	path: string;
	exportPathKey: string;
};

export function programModuleExportKey(path: string, exportPathKey: string): string {
	return `${path}\0${exportPathKey}`;
}

export type Proto = {
	entryPC: number;
	codeLen: number;
	numParams: number;
	isVararg: boolean;
	maxStack: number;
	upvalueDescs: UpvalueDesc[];
	staticClosure: boolean;
};

export type UpvalueDesc = {
	inStack: boolean;
	index: number;
};
