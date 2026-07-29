import type { SourceRange } from '../source_range';
import type { OpCode } from '../../../../machine/ts/spec/blua32/opcode';

export type ProgramConstant = null | boolean | number | string;

export type ProgramRuntimeSymbols = {
	protoIds: string[];
	globalNames: string[];
	systemGlobalNames: string[];
	exportProtoIdBySlot: { [slotName: string]: string };
};

export type ProgramResumePoint = {
	wordOffset: number;
	range: SourceRange;
	op: OpCode;
	liveRegisters: number[];
	uses: number[];
	defs: number[];
};

export type LocalSlotDebug = {
	name: string;
	registerIndex: number;
	definition: SourceRange;
	scope: SourceRange;
};

export type ProgramMetadata = ProgramRuntimeSymbols & {
	debugRanges: ReadonlyArray<SourceRange | null>;
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
