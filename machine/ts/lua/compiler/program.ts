import type { Value } from '../../machine/cpu/value';
import type { SourceRange } from '../../rompack/tooling/blua32_symbols';
import type { OpCode } from '../../spec/blua32/opcode';
import type { StringPool } from '../../machine/cpu/string_pool';

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
	constPool: Value[];
	protos: Proto[];
	moduleProtos: ProgramModuleProto[];
	moduleExports: ProgramModuleExport[];
	moduleProtoMap: Map<string, number>;
	stringPool: StringPool;
	constPoolStringPool: StringPool;
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
