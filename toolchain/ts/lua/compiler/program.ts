import type { LexicalDeclarationKind } from './declaration_kind';
import type { ProgramWordRange } from './word_range';
import type { SourceRange } from '../source_range';
import type { OpCode } from '../../../../machine/ts/spec/blua32/opcode';
import type { TraceStatementSelection } from './trace_statement';
import type { ProgramStaticScopes } from './static_debug';

export type ProgramConstant = null | boolean | number | string;

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
	staticScopes: ProgramStaticScopes;
	traceStatements: TraceStatementSelection;
	preloadModules: readonly string[];
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
