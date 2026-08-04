import type { SourceRange } from '../source_range';
import type { OpCode } from '../../../../machine/ts/spec/blua32/opcode';

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
	registerIndex: number;
	definition: SourceRange;
	scope: SourceRange;
	inlineCallSites: ReadonlyArray<InlineCallSite>;
};

export type ProgramMetadata = ProgramRuntimeSymbols & {
	debugRanges: ReadonlyArray<SourceRange | null>;
	debugInlineCallSites: ReadonlyArray<ReadonlyArray<InlineCallSite>>;
	statementPointsByProto: ReadonlyArray<ReadonlyArray<ProgramStatementPoint>>;
	resumePointsByProto: ReadonlyArray<ReadonlyArray<ProgramResumePoint>>;
	localSlotsByProto: ReadonlyArray<ReadonlyArray<LocalSlotDebug>>;
	upvalueNamesByProto: ReadonlyArray<ReadonlyArray<string>>;
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
