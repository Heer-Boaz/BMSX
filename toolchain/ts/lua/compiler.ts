// start repeated-sequence-acceptable -- Program codegen keeps opcode/slot emission direct; helper extraction would add dispatch in compile hot paths.
// start normalized-body-acceptable -- Resolver/emitter specializations share shapes but preserve distinct compiler ownership.
import {
	LuaAssignmentOperator,
	LuaBinaryOperator,
	LuaSyntaxKind,
	LuaTableFieldKind,
	LuaUnaryOperator,
	isRecursiveConstClosureDeclaration,
	type LuaAssignableExpression,
	type LuaAssignmentStatement,
	type LuaBinaryExpression,
	type LuaCallExpression,
	type LuaChunk,
	type LuaExpression,
	type LuaForGenericStatement,
	type LuaFunctionExpression,
	type LuaFunctionDeclarationStatement,
	type LuaIdentifierExpression,
	type LuaIfStatement,
	type LuaIndexExpression,
	type LuaLabelStatement,
	type LuaLocalAssignmentStatement,
	type LuaLocalFunctionStatement,
	type LuaMemberExpression,
	type LuaNumericLiteralExpression,
	type LuaOffsetOfExpression,
	type LuaStatement,
	type LuaBooleanLiteralExpression,
	type LuaSizeOfExpression,
	type LuaStringLiteralExpression,
	type LuaStructDeclarationStatement,
	type LuaBssDeclarationStatement,
	type LuaDataDeclarationStatement,
	type LuaRodataDeclarationStatement,
	type LuaStructFieldDeclaration,
	type LuaTypeReference,
	type LuaUnaryExpression,
	type LuaSourceRange,
	type LuaTableConstructorExpression,
	type LuaWhileStatement,
	type LuaGotoStatement,
} from './syntax/ast';
import { OpCode, encodeFixedCallArgCount } from '../../../machine/ts/spec/blua32/opcode';
import type { SourceRange } from './source_range';
import type {
	InlineCallSite,
	LocalSlotDebug,
	Program,
	ProgramConstant,
	ProgramFunctionSymbol,
	ProgramInitParticipant,
	ProgramMetadata,
	ProgramModuleExport,
	ProgramModuleProto,
	ProgramResumePoint,
	ProgramStatementPoint,
	Proto,
	UpvalueDesc,
} from './compiler/program';
import { buildInitParticipantSlotName, programModuleExportKey } from './compiler/program';
import { ROOT_INLINE_CALL_SITES } from './compiler/inline_debug';
import { OPCODE_NAMES } from './opcode_metadata';
import { optimizeInstructions, type Instruction, type InstructionSet, type OptimizationLevel } from './compiler/optimizer';
import { computeMaxRegister } from './compiler/optimizer/instructions';
import { compactUnusedUpvalues } from './compiler/optimizer/upvalues';
import {
	buildModuleCompileContext,
	type ConstExportValue,
	type ModuleCompileContext,
	type ModuleCompileInfo,
	type ProgramModule,
} from './compiler/passes/module_contract';
import { extractAssignmentPath } from './compiler/passes/expression_paths';
import { appendModuleExportPathKey } from './module_path';
import { collectStaticStorageDeclarations, type StaticStorageDeclaration } from './compiler/passes/static_storage';
import { collectStaticFunctionExports } from './compiler/passes/static_functions';
import { validateInitParticipantPlacement } from './compiler/passes/init_participants';
import { assertStaticFunctionInstructionSet, staticLaneForbiddenOpcodeReason } from './compiler/passes/static_proto_contract';
import { toLuaModulePath } from './module_path';
import {
	encodeProgramObjectSections,
	type ProgramBiosFunctionConstReloc,
	type ProgramConstValueReloc,
	type ProgramRodataConstReloc,
	type ProgramObjectDataSection,
	type ProgramDataSymbol,
	type ProgramObjectBssSection,
	type ProgramBssSymbol,
	type ProgramRodataSymbol,
	type ProgramCartObjectImage,
	type ProgramObjectImage,
	type ProgramImageConstReloc,
	type ProgramLinkValueExpression,
	type ProgramSystemObjectImage,
} from './compiler/program_object';
import { CLOSURE_ADDRESS_REGISTER_WIDE_C, EXT_A_BITS, EXT_B_BITS, EXT_BX_BITS, EXT_C_BITS, INSTRUCTION_BYTES, MAX_BX_BITS, MAX_EXT_CONST, MAX_EXT_REGISTER_BC, MAX_OPERAND_BITS, MAX_SIGNED_BX, MIN_SIGNED_BX, writeInstruction } from '../../../machine/ts/spec/blua32/instruction_format';
import { buildLuaSemanticFrontend, type LuaBoundReference, type LuaSemanticFrontend, type LuaSemanticFrontendFile } from './semantic/frontend';
import { ValueKindFlowAnalyzer, type SymbolFlowState } from './compiler/compile_value_flow';
import {
	evaluateCompileTimeNumberBinaryOperator,
	resolveCompileTimeNumberBinaryOperator,
} from './compiler/compile_time_number';
import { SYSTEM_ROM_BOOT_PRIMITIVE_NAMES, SYSTEM_ROM_BOOT_SYMBOL_NAMES, SYSTEM_ROM_BOOT_SYMBOL_NAME_SET, SYSTEM_ROM_VECTOR_HANDLER_NAME_SET } from './compiler/system_boot_symbols';
import { LuaSyntaxError } from './errors';
import { stringLiteralValue } from './syntax/literals';
import { Decl } from './semantic/model';
import {
	IMPLICIT_SELF_SYMBOL_HANDLE,
	getBoundIdentifierReference as getResolvedIdentifierReference,
	getReferenceSymbolHandle as getResolvedReferenceSymbolHandle,
} from './compiler/bound_reference';
import {
	classifyAssignmentTargetPreparation,
	classifyFunctionDeclarationTarget,
} from './compiler/target_semantics';
import { MemoryAccessKind } from '../../../machine/ts/spec/blua32/memory_access_kind';
import { getMemoryAccessKindForName } from './memory_access_syntax';
import { writeLE16, writeLE32 } from '../../../machine/ts/common/endian';
import { utf8CodepointCount } from '../../../machine/ts/common/utf8';
import { isReservedIntrinsicName } from './semantic/common';
import { IO_IRQ_FLAGS } from '../../../machine/ts/spec/bmsx/io';
import { COP0_BAD_ADDRESS, COP0_CAUSE, COP0_EPC, COP0_EXEC, COP0_LUA_FAULT_REASON, COP0_STATUS } from '../../../machine/ts/spec/blua32/cop0';
import {
	buildProgramResumePoints,
	buildProgramStatementPoints,
} from './compiler/execution_points';

export type ProgramCompileDomain = 'cart' | 'system';

type ProgramCompilerConstReloc =
	| ProgramImageConstReloc
	| {
		wordIndex: number;
		kind: 'bios_function';
		importIndex: number;
	};

type InitParticipantBinding = ProgramInitParticipant & {
	objectSlot: number;
};

type CompiledProgramBase = {
	program: Program;
	metadata: ProgramMetadata;
	entryProtoIndex: number;
	startupProtoIndex: number;
	sectionInitProtoIndex: number;
	irqProtoIndex: number;
	exceptionProtoIndex: number;
	initProtoIndex: number | null;
	moduleProtoMap: Map<string, number>;
	staticModulePaths: string[];
	constValueRelocs: ProgramConstValueReloc[];
	rodataConstRelocs: ProgramRodataConstReloc[];
	data: ProgramObjectDataSection;
	bss: ProgramObjectBssSection;
	rodataBytes: Uint8Array;
	rodataSymbols: ProgramRodataSymbol[];
};

export type CompiledSystemProgram = CompiledProgramBase & {
	domain: 'system';
	constRelocs: ProgramImageConstReloc[];
};

export type CompiledCartProgram = CompiledProgramBase & {
	domain: 'cart';
	constRelocs: ProgramImageConstReloc[];
	biosFunctionConstRelocs: ProgramBiosFunctionConstReloc[];
};

export type CompiledProgram =
	| CompiledSystemProgram
	| CompiledCartProgram;

export function encodeCompiledProgramObject(compiled: CompiledSystemProgram): ProgramSystemObjectImage;
export function encodeCompiledProgramObject(compiled: CompiledCartProgram): ProgramCartObjectImage;
export function encodeCompiledProgramObject(compiled: CompiledProgram): ProgramObjectImage {
	const vectors = {
		resetProtoIndex: compiled.startupProtoIndex,
		sectionInitProtoIndex: compiled.sectionInitProtoIndex,
		irqProtoIndex: compiled.irqProtoIndex,
		exceptionProtoIndex: compiled.exceptionProtoIndex,
		initProtoIndex: compiled.initProtoIndex,
	};
	const sections = encodeProgramObjectSections(
		compiled.program,
		compiled.staticModulePaths,
		compiled.data,
		compiled.bss,
		compiled.rodataBytes,
		compiled.rodataSymbols,
	);
	if (compiled.domain === 'system') {
		return {
			domain: 'system',
			vectors,
			sections,
			link: {
				constRelocs: compiled.constRelocs,
				constValueRelocs: compiled.constValueRelocs,
				rodataConstRelocs: compiled.rodataConstRelocs,
				symbols: {
					protoIds: compiled.metadata.protoIds,
					globalNames: compiled.metadata.globalNames,
					systemGlobalNames: compiled.metadata.systemGlobalNames,
					exportProtoIdBySlot: compiled.metadata.exportProtoIdBySlot,
					initParticipants: compiled.metadata.initParticipants,
				},
			},
		};
	}
	return {
		domain: 'cart',
		vectors,
		sections,
		link: {
			constRelocs: compiled.constRelocs,
			biosFunctionConstRelocs: compiled.biosFunctionConstRelocs,
			constValueRelocs: compiled.constValueRelocs,
			rodataConstRelocs: compiled.rodataConstRelocs,
			symbols: {
				protoIds: compiled.metadata.protoIds,
				globalNames: compiled.metadata.globalNames,
				systemGlobalNames: compiled.metadata.systemGlobalNames,
				exportProtoIdBySlot: compiled.metadata.exportProtoIdBySlot,
				initParticipants: compiled.metadata.initParticipants,
			},
		},
	};
}

export type LuaCompileError = {
	path: string;
	message: string;
	line: number;
	column: number;
};

type CompileError = {
	path: string;
	stage: 'entry' | 'module';
	message: string;
};

export const isLuaCompileError = (value: unknown): value is LuaCompileError =>
	value instanceof LuaSyntaxError;

type CompileOptionsBase = {
	optLevel?: OptimizationLevel;
	entrySource?: string;
};

type SystemCompileOptions = CompileOptionsBase & {
	programDomain: 'system';
	biosFunctions?: never;
};

type CartCompileOptions = CompileOptionsBase & {
	programDomain?: 'cart';
	biosFunctions?: ReadonlyArray<ProgramFunctionSymbol>;
};

type CompileOptions =
	| SystemCompileOptions
	| CartCompileOptions;

const EMPTY_PROGRAM_MODULES: ReadonlyArray<ProgramModule> = [];

type LoopContext = {
	breakJumps: number[];
};

type ScopeFrame = {
	locals: LocalBinding[];
	range: SourceRange;
};

type LocalBindingKind = 'local' | 'const' | 'parameter';

type RelocatableConstExportValue = Extract<ConstExportValue, {
	kind: 'bss_addr' | 'data_addr' | 'rodata_addr' | 'link_value';
}>;

type CompileTimeNumericValue =
	| { kind: 'number'; value: number }
	| {
		kind: 'link_value';
		modulePath: string;
		expression: ProgramLinkValueExpression;
	};

type LocalBinding = {
	symbolHandle: string;
	name: string;
	reg: number;
	kind: LocalBindingKind;
	constValue: ProgramConstant | null;
	hasConstValue: boolean;
	constNumberValue: number;
	hasConstNumberValue: boolean;
	constBooleanValue: boolean;
	hasConstBooleanValue: boolean;
	constRelocValue: RelocatableConstExportValue | null;
	constClosureProtoIndex: number | null;
	moduleBinding: ModuleBinding | null;
	structView: StructView | null;
};

type ModuleBindingBase = {
	modulePath: string;
	exportPathKey: string;
	exportDepth: number;
};

type SourceModuleBinding = ModuleBindingBase & {
	kind: 'source';
	moduleInfo: ModuleCompileInfo;
};

type InstalledModuleBinding = ModuleBindingBase & {
	kind: 'installed';
};

type ModuleBinding = SourceModuleBinding | InstalledModuleBinding;

type RequireModuleBinding = ModuleBinding | {
	kind: 'unshaped';
	modulePath: string;
};

type ModuleFunctionTarget =
	| (ProgramFunctionSymbol & { kind: 'export_proto' })
	| { kind: 'bios_function'; importIndex: number };

type StructScalarAccess =
	| { kind: 'memory'; memoryKind: MemoryAccessKind }
	| { kind: 'const_pool' };

type PrimitiveStructType = {
	size: number;
	alignment: number;
	access: StructScalarAccess;
};

type StructResolvedType = {
	name: string;
	baseSize: number;
	baseAlignment: number;
	baseAccess: StructScalarAccess | null;
	baseStruct: StructLayout | null;
	size: number;
	alignment: number;
	access: StructScalarAccess | null;
	struct: StructLayout | null;
	dimensions: number[];
};

type StructFieldLayout = {
	name: string;
	type: StructResolvedType;
	offset: number;
	size: number;
	access: StructScalarAccess | null;
};

type StructLayout = {
	name: string;
	size: number;
	alignment: number;
	fields: Map<string, StructFieldLayout>;
};

type StructView = {
	type: StructResolvedType;
};

type BssBinding = {
	symbolHandle: string;
	name: string;
	symbol: string;
	offset: number;
	byteCount: number;
	alignment: number;
	type: StructResolvedType;
};

type DataBinding = {
	symbolHandle: string;
	name: string;
	symbol: string;
	offset: number;
	byteCount: number;
	alignment: number;
	type: StructResolvedType;
};

type RodataBinding = {
	symbolHandle: string;
	name: string;
	symbol: string;
	offset: number;
	byteCount: number;
	alignment: number;
	type: StructResolvedType;
};

type StaticStorageInitializer = {
	bytes: Uint8Array;
	rodataConstRelocs: ProgramRodataConstReloc[];
};

type StructAddress = {
	baseReg: number;
	byteOffset: number;
	type: StructResolvedType;
	pointerIndex: boolean;
	readOnly: boolean;
};

type AssignmentTarget =
	| { kind: 'local'; reg: number }
	| { kind: 'upvalue'; upvalue: number }
	| { kind: 'global'; slot: number; system: boolean }
	| { kind: 'table'; tableReg: number; keyConst?: number; keyReg?: number }
	| { kind: 'cop0'; register: number }
	| { kind: 'memory'; accessKind: MemoryAccessKind; addrConst?: number; addrReg?: number; addrOffsetBytes?: number };

const RK_B = 1;
const RK_C = 2;
const INIT_HAS_VALUE = 1 << 0;
const INIT_HAS_NUMBER = 1 << 1;
const INIT_HAS_BOOLEAN = 1 << 2;
const INIT_HAS_VALUE_REG = 1 << 3;
const INIT_HAS_CLOSURE_PROTO = 1 << 4;
const INIT_HAS_MODULE_BINDING = 1 << 5;

const isConstBxOp = (op: OpCode): boolean =>
	op === OpCode.LOADK;

const isGlobalSlotOp = (op: OpCode): boolean =>
	op === OpCode.GETSYS
	|| op === OpCode.SETSYS
	|| op === OpCode.GETGL
	|| op === OpCode.SETGL;

const isSignedBxOp = (op: OpCode): boolean => op === OpCode.KSMI;

const isFieldConstOp = (op: OpCode): boolean =>
	op === OpCode.GETFIELD
	|| op === OpCode.SETFIELD
	|| op === OpCode.SELF;

const isDisplacedMemoryOp = (op: OpCode): boolean =>
	op === OpCode.LOAD_MEM_D
	|| op === OpCode.STORE_MEM_D
	|| op === OpCode.STORE_MEM_WORDS_D;

const MAX_DISPLACED_MEMORY_WORD_OFFSET = 0xff;
const MAX_DISPLACED_MEMORY_BYTE_OFFSET = MAX_DISPLACED_MEMORY_WORD_OFFSET << 2;

const MAX_SPECIALIZED_TABLE_OPERAND = MAX_EXT_REGISTER_BC;

const PRIMITIVE_STRUCT_TYPES: ReadonlyMap<string, PrimitiveStructType> = new Map([
	['u8', { size: 1, alignment: 1, access: { kind: 'memory', memoryKind: MemoryAccessKind.U8 } }],
	['i8', { size: 1, alignment: 1, access: { kind: 'memory', memoryKind: MemoryAccessKind.U8 } }],
	['u16', { size: 2, alignment: 2, access: { kind: 'memory', memoryKind: MemoryAccessKind.U16LE } }],
	['i16', { size: 2, alignment: 2, access: { kind: 'memory', memoryKind: MemoryAccessKind.U16LE } }],
	['u32', { size: 4, alignment: 4, access: { kind: 'memory', memoryKind: MemoryAccessKind.U32LE } }],
	['i32', { size: 4, alignment: 4, access: { kind: 'memory', memoryKind: MemoryAccessKind.U32LE } }],
	['f32', { size: 4, alignment: 4, access: { kind: 'memory', memoryKind: MemoryAccessKind.F32LE } }],
	['f64', { size: 8, alignment: 4, access: { kind: 'memory', memoryKind: MemoryAccessKind.F64LE } }],
	['addr', { size: 4, alignment: 4, access: { kind: 'memory', memoryKind: MemoryAccessKind.U32LE } }],
	['word', { size: 4, alignment: 4, access: { kind: 'memory', memoryKind: MemoryAccessKind.Word } }],
	['string', { size: 4, alignment: 4, access: { kind: 'const_pool' } }],
]);

const isSmallSignedImmediate = (value: number): boolean =>
	Number.isInteger(value) && value >= MIN_SIGNED_BX && value <= MAX_SIGNED_BX;

class ProgramBuilder {
	public readonly constPool: ProgramConstant[];
	public readonly optLevel: OptimizationLevel;
	private readonly constSlotByValue: Map<ProgramConstant, number>;
	private readonly systemGlobalNameSet: Set<string>;
	private readonly systemGlobalNames: string[] = [];
	private readonly systemGlobalSlotByName: Map<string, number> = new Map();
	private readonly globalNames: string[] = [];
	private readonly globalSlotByName: Map<string, number> = new Map();
	public readonly protos: Proto[] = [];
	public readonly protoCode: Uint8Array[] = [];
	public readonly protoRanges: ReadonlyArray<SourceRange | null>[] = [];
	public readonly protoInlineCallSites: ReadonlyArray<ReadonlyArray<InlineCallSite>>[] = [];
	public readonly protoConstRelocs: ReadonlyArray<ProgramCompilerConstReloc>[] = [];
	public readonly protoStatementPoints: ReadonlyArray<ProgramStatementPoint>[] = [];
	public readonly protoResumePoints: ReadonlyArray<ProgramResumePoint>[] = [];
	public readonly protoLocalSlots: ReadonlyArray<LocalSlotDebug>[] = [];
	public readonly protoUpvalueNames: ReadonlyArray<string>[] = [];
	public readonly protoInstructionSets: InstructionSet[] = [];
	public readonly protoIds: string[] = [];
	// These facts only guide same-program optimization; neither enters Proto nor the linked image.
	private readonly protoReturnsOneValue: boolean[] = [];
	private readonly exportProtoIdBySlot: { [slotName: string]: string } = {};
	private readonly biosFunctionImportIndexBySymbol = new Map<string, number>();
	private readonly structDeclarationMap = new Map<string, LuaStructDeclarationStatement>();
	private readonly structLayoutMap = new Map<string, StructLayout>();
	public readonly structDeclarations: ReadonlyMap<string, LuaStructDeclarationStatement> = this.structDeclarationMap;
	public readonly structLayouts: ReadonlyMap<string, StructLayout> = this.structLayoutMap;
	public readonly bssBindingsBySymbolHandle = new Map<string, BssBinding>();
	public readonly dataBindingsBySymbolHandle = new Map<string, DataBinding>();
	public readonly rodataBindingsBySymbolHandle = new Map<string, RodataBinding>();
	private readonly constValueRelocs: ProgramConstValueReloc[] = [];
	private readonly rodataConstRelocs: ProgramRodataConstReloc[] = [];
	private readonly relocatedConstIndices = new Set<number>();
	private readonly linkValueRelocSlotByKey = new Map<string, number>();
	private bssByteCount = 0;
	private dataByteCount = 0;
	private dataBytes = new Uint8Array(0);
	private rodataByteCount = 0;
	private rodataBytes = new Uint8Array(0);
	private readonly protoIndexById = new Map<string, number>();
	private readonly moduleProtoEntries: ProgramModuleProto[] = [];
	private readonly moduleProtoEntrySlotByPath = new Map<string, number>();
	private readonly moduleExportEntries: ProgramModuleExport[] = [];
	private readonly moduleExportEntrySlotByKey = new Map<string, number>();
	private readonly moduleExportPathContractByKey = new Set<string>();
	private readonly modulePathSet = new Set<string>();
	public readonly staticModulePaths: string[] = [];
	private readonly staticModulePathSet: Set<string> = new Set();
	private readonly initParticipantsByModule = new Map<string, InitParticipantBinding[]>();
	private readonly programDomain: ProgramCompileDomain;

	public constructor(
		optLevel: OptimizationLevel,
		programDomain: ProgramCompileDomain,
	) {
		this.constPool = [];
		this.optLevel = optLevel;
		this.programDomain = programDomain;
		this.constSlotByValue = new Map<ProgramConstant, number>();
		this.systemGlobalNameSet = new Set(SYSTEM_ROM_BOOT_SYMBOL_NAME_SET);
		if (programDomain === 'system') {
			for (let index = 0; index < SYSTEM_ROM_BOOT_PRIMITIVE_NAMES.length; index += 1) {
				this.resolveSystemGlobalSlot(SYSTEM_ROM_BOOT_PRIMITIVE_NAMES[index]);
			}
		}
	}

	public constIndex(value: ProgramConstant): number {
		const slot = this.constSlotByValue.get(value);
		if (slot) {
			return slot - 1;
		}
		const index = this.constPool.length;
		this.constPool.push(value);
		this.constSlotByValue.set(value, index + 1);
		return index;
	}

	public constValueRelocIndex(
		kind: Exclude<ProgramConstValueReloc['kind'], 'link_value'>,
		symbol: string,
		addend: number,
	): number {
		const index = this.constPool.length;
		this.constPool.push(0);
		this.relocatedConstIndices.add(index);
		this.constValueRelocs.push({
			constIndex: index,
			kind,
			symbol,
			addend,
		});
		return index;
	}

	public linkValueRelocIndex(
		modulePath: string,
		expression: ProgramLinkValueExpression,
	): number {
		const key = `${modulePath}\0${JSON.stringify(expression)}`;
		const slot = this.linkValueRelocSlotByKey.get(key);
		if (slot) {
			return slot - 1;
		}
		const index = this.constPool.length;
		this.constPool.push(0);
		this.relocatedConstIndices.add(index);
		this.linkValueRelocSlotByKey.set(key, index + 1);
		this.constValueRelocs.push({
			constIndex: index,
			kind: 'link_value',
			modulePath,
			expression,
		});
		return index;
	}

	public relocatedConstIndexSet(): ReadonlySet<number> {
		return this.relocatedConstIndices;
	}

	public resolveGlobalAccess(name: string): { system: boolean; slot: number } {
		if (SYSTEM_ROM_VECTOR_HANDLER_NAME_SET.has(name)) {
			return this.programDomain === 'system'
				? { system: true, slot: this.resolveSystemGlobalSlot(name) }
				: { system: false, slot: this.resolveGlobalSlot(name) };
		}
		if (this.systemGlobalNameSet.has(name)) {
			return { system: true, slot: this.resolveSystemGlobalSlot(name) };
		}
		return { system: false, slot: this.resolveGlobalSlot(name) };
	}

	public resolveModuleExportAccess(slotName: string): { system: boolean; slot: number } {
		return this.programDomain === 'system'
			? { system: true, slot: this.resolveSystemGlobalSlot(slotName) }
			: { system: false, slot: this.resolveGlobalSlot(slotName) };
	}

	public recordBss(symbolHandle: string, moduleId: string, name: string, type: StructResolvedType): BssBinding {
		const existing = this.bssBindingsBySymbolHandle.get(symbolHandle);
		if (existing) {
			return existing;
		}
		const offset = this.alignStorageOffset(this.bssByteCount, type.alignment);
		const binding: BssBinding = {
			symbolHandle,
			name,
			symbol: `${buildModuleRootId(moduleId)}/bss:${name}`,
			offset,
			byteCount: type.size,
			alignment: type.alignment,
			type,
		};
		this.bssBindingsBySymbolHandle.set(symbolHandle, binding);
		this.bssByteCount = this.alignStorageOffset(offset + type.size, 4);
		return binding;
	}

	public recordData(symbolHandle: string, moduleId: string, name: string, type: StructResolvedType, bytes: Uint8Array): DataBinding {
		const existing = this.dataBindingsBySymbolHandle.get(symbolHandle);
		if (existing) {
			return existing;
		}
		const offset = this.alignStorageOffset(this.dataByteCount, type.alignment);
		const nextByteCount = this.alignStorageOffset(offset + bytes.byteLength, 4);
		const nextBytes = new Uint8Array(nextByteCount);
		nextBytes.set(this.dataBytes, 0);
		nextBytes.set(bytes, offset);
		this.dataBytes = nextBytes;
		const binding: DataBinding = {
			symbolHandle,
			name,
			symbol: `${buildModuleRootId(moduleId)}/data:${name}`,
			offset,
			byteCount: type.size,
			alignment: type.alignment,
			type,
		};
		this.dataBindingsBySymbolHandle.set(symbolHandle, binding);
		this.dataByteCount = nextByteCount;
		return binding;
	}

	public recordRodata(symbolHandle: string, moduleId: string, name: string, type: StructResolvedType, initializer: StaticStorageInitializer): RodataBinding {
		const existing = this.rodataBindingsBySymbolHandle.get(symbolHandle);
		if (existing) {
			return existing;
		}
		const offset = this.alignStorageOffset(this.rodataByteCount, type.alignment);
		const nextByteCount = this.alignStorageOffset(offset + initializer.bytes.byteLength, 4);
		const nextBytes = new Uint8Array(nextByteCount);
		nextBytes.set(this.rodataBytes, 0);
		nextBytes.set(initializer.bytes, offset);
		this.rodataBytes = nextBytes;
		for (let index = 0; index < initializer.rodataConstRelocs.length; index += 1) {
			const reloc = initializer.rodataConstRelocs[index];
			this.rodataConstRelocs.push({ byteOffset: offset + reloc.byteOffset, constIndex: reloc.constIndex });
		}
		const binding: RodataBinding = {
			symbolHandle,
			name,
			symbol: `${buildModuleRootId(moduleId)}/rodata:${name}`,
			offset,
			byteCount: type.size,
			alignment: type.alignment,
			type,
		};
		this.rodataBindingsBySymbolHandle.set(symbolHandle, binding);
		this.rodataByteCount = nextByteCount;
		return binding;
	}

	public buildRodataSymbols(): ProgramRodataSymbol[] {
		const symbols: ProgramRodataSymbol[] = [];
		for (const binding of this.rodataBindingsBySymbolHandle.values()) {
			symbols.push({
				name: binding.symbol,
				offset: binding.offset,
				byteCount: binding.byteCount,
				alignment: binding.alignment,
			});
		}
		return symbols;
	}

	public buildDataSection(): ProgramObjectDataSection {
		const symbols: ProgramDataSymbol[] = [];
		for (const binding of this.dataBindingsBySymbolHandle.values()) {
			symbols.push({
				name: binding.symbol,
				offset: binding.offset,
				byteCount: binding.byteCount,
				alignment: binding.alignment,
			});
		}
		return {
			bytes: this.dataBytes,
			symbols,
		};
	}

	public buildBssSection(): ProgramObjectBssSection {
		const symbols: ProgramBssSymbol[] = [];
		for (const binding of this.bssBindingsBySymbolHandle.values()) {
			symbols.push({
				name: binding.symbol,
				offset: binding.offset,
				byteCount: binding.byteCount,
				alignment: binding.alignment,
			});
		}
		return {
			byteCount: this.bssByteCount,
			symbols,
		};
	}

	public bssInitBinding(): BssBinding | null {
		for (const binding of this.bssBindingsBySymbolHandle.values()) {
			return binding;
		}
		return null;
	}

	public dataInitBinding(): DataBinding | null {
		for (const binding of this.dataBindingsBySymbolHandle.values()) {
			return binding;
		}
		return null;
	}

	public getDataByteCount(): number {
		return this.dataByteCount;
	}

	public getBssByteCount(): number {
		return this.bssByteCount;
	}

	private alignStorageOffset(offset: number, alignment: number): number {
		return (offset + alignment - 1) & ~(alignment - 1);
	}

	public registerStructDeclaration(statement: LuaStructDeclarationStatement): void {
		this.structDeclarationMap.set(statement.name.name, statement);
		this.structLayoutMap.delete(statement.name.name);
	}

	public recordStructLayout(layout: StructLayout): void {
		this.structLayoutMap.set(layout.name, layout);
	}

	public resolveSystemGlobalSlot(name: string): number {
		const slot = this.systemGlobalSlotByName.get(name);
		if (slot) {
			return slot - 1;
		}
		const index = this.systemGlobalNames.length;
		this.systemGlobalNames.push(name);
		this.systemGlobalSlotByName.set(name, index + 1);
		return index;
	}

	private resolveGlobalSlot(name: string): number {
		const slot = this.globalSlotByName.get(name);
		if (slot) {
			return slot - 1;
		}
		const index = this.globalNames.length;
		this.globalNames.push(name);
		this.globalSlotByName.set(name, index + 1);
		return index;
	}

	public addProto(
		proto: Proto,
		code: Uint8Array,
		ranges: ReadonlyArray<SourceRange | null>,
		inlineCallSites: ReadonlyArray<ReadonlyArray<InlineCallSite>>,
		constRelocs: ReadonlyArray<ProgramCompilerConstReloc>,
		statementPoints: ReadonlyArray<ProgramStatementPoint>,
		resumePoints: ReadonlyArray<ProgramResumePoint>,
		localSlots: ReadonlyArray<LocalSlotDebug>,
		upvalueNames: ReadonlyArray<string>,
		protoId: string,
		instructionSet: InstructionSet,
	): number {
		if (this.protoIndexById.has(protoId)) {
			throw new Error(`[ProgramBuilder] Duplicate proto id '${protoId}'.`);
		}
		const index = this.protos.length;
		this.protoIndexById.set(protoId, index);
		this.protos.push(proto);
		this.protoCode.push(code);
		this.protoRanges.push(ranges);
		this.protoInlineCallSites.push(inlineCallSites);
		this.protoConstRelocs.push(constRelocs);
		this.protoStatementPoints.push(statementPoints);
		this.protoResumePoints.push(resumePoints);
		this.protoLocalSlots.push(localSlots);
		this.protoUpvalueNames.push(upvalueNames);
		this.protoInstructionSets.push(instructionSet);
		this.protoIds.push(protoId);
		let returnsOneValue = true;
		for (let instructionIndex = 0; instructionIndex < instructionSet.instructions.length; instructionIndex += 1) {
			const instruction = instructionSet.instructions[instructionIndex];
			if (instruction.op === OpCode.RET && instruction.b !== 1) {
				returnsOneValue = false;
				break;
			}
		}
		this.protoReturnsOneValue.push(returnsOneValue);
		return index;
	}

	public hasModuleContract(path: string): boolean {
		return this.modulePathSet.has(path);
	}

	public hasModuleProto(path: string): boolean {
		return this.moduleProtoEntrySlotByPath.has(path);
	}

	public recordModuleProto(path: string, protoIndex: number): void {
		this.modulePathSet.add(path);
		const existingSlot = this.moduleProtoEntrySlotByPath.get(path);
		if (existingSlot) {
			const existing = existingSlot - 1;
			this.moduleProtoEntries[existing] = { path, protoIndex };
			return;
		}
		this.moduleProtoEntrySlotByPath.set(path, this.moduleProtoEntries.length + 1);
		this.moduleProtoEntries.push({ path, protoIndex });
	}

	public moduleProtoIndex(path: string): number | undefined {
		const slot = this.moduleProtoEntrySlotByPath.get(path);
		return slot === undefined ? undefined : this.moduleProtoEntries[slot - 1].protoIndex;
	}

	public recordModuleExport(path: string, exportPathKey: string, slotName: string): void {
		this.modulePathSet.add(path);
		this.recordModuleExportPathContract(path, exportPathKey);
		const key = programModuleExportKey(path, exportPathKey);
		const existingSlot = this.moduleExportEntrySlotByKey.get(key);
		if (existingSlot) {
			const existing = existingSlot - 1;
			this.moduleExportEntries[existing] = { path, exportPathKey, slotName };
			return;
		}
		this.moduleExportEntrySlotByKey.set(key, this.moduleExportEntries.length + 1);
		this.moduleExportEntries.push({ path, exportPathKey, slotName });
	}

	private recordModuleExportPathContract(path: string, exportPathKey: string): void {
		this.moduleExportPathContractByKey.add(programModuleExportKey(path, ''));
		this.moduleExportPathContractByKey.add(programModuleExportKey(path, exportPathKey));
		for (let index = exportPathKey.indexOf('.'); index >= 0; index = exportPathKey.indexOf('.', index + 1)) {
			this.moduleExportPathContractByKey.add(programModuleExportKey(path, exportPathKey.substring(0, index)));
		}
	}

	public recordModuleExportSlot(path: string, exportPathKey: string, slotName: string): void {
		this.recordModuleExport(path, exportPathKey, slotName);
		this.resolveModuleExportAccess(slotName);
	}

	public hasModuleExportPathContract(path: string, exportPathKey: string): boolean {
		return this.moduleExportPathContractByKey.has(programModuleExportKey(path, exportPathKey));
	}

	public hasStaticModulePath(path: string): boolean {
		return this.staticModulePathSet.has(path);
	}

	public recordStaticModulePath(path: string): void {
		if (this.staticModulePathSet.has(path)) {
			return;
		}
		this.staticModulePathSet.add(path);
		this.staticModulePaths.push(path);
	}

	public recordInitParticipant(moduleId: string, functionId: string): InitParticipantBinding {
		const system = this.programDomain === 'system';
		const slotName = buildInitParticipantSlotName(functionId);
		const participant = {
			functionId,
			slotName,
			system,
			objectSlot: system
				? this.resolveSystemGlobalSlot(slotName)
				: this.resolveGlobalSlot(slotName),
		};
		let moduleParticipants = this.initParticipantsByModule.get(moduleId);
		if (moduleParticipants === undefined) {
			moduleParticipants = [];
			this.initParticipantsByModule.set(moduleId, moduleParticipants);
		}
		moduleParticipants.push(participant);
		return participant;
	}

	public orderedInitParticipants(entryModuleId: string): InitParticipantBinding[] {
		for (const [moduleId] of this.initParticipantsByModule) {
			if (moduleId !== entryModuleId && !this.staticModulePathSet.has(moduleId)) {
				throw new Error(`Module '${moduleId}' declares <init> but is not statically required by the program.`);
			}
		}
		const participants: InitParticipantBinding[] = [];
		for (let index = 0; index < this.staticModulePaths.length; index += 1) {
			const moduleParticipants = this.initParticipantsByModule.get(this.staticModulePaths[index]);
			if (moduleParticipants !== undefined) {
				for (let participantIndex = 0; participantIndex < moduleParticipants.length; participantIndex += 1) {
					participants.push(moduleParticipants[participantIndex]);
				}
			}
		}
		const entryParticipants = this.initParticipantsByModule.get(entryModuleId);
		if (entryParticipants !== undefined) {
			for (let participantIndex = 0; participantIndex < entryParticipants.length; participantIndex += 1) {
				participants.push(entryParticipants[participantIndex]);
			}
		}
		return participants;
	}

	public markStaticClosureProto(protoIndex: number): void {
		this.protos[protoIndex].staticClosure = true;
	}

	public protoHasNoUpvalues(protoIndex: number): boolean {
		return this.protos[protoIndex].upvalueDescs.length === 0;
	}

	public getProtoUpvalueNames(protoIndex: number): ReadonlyArray<string> {
		return this.protoUpvalueNames[protoIndex];
	}

	public protoReturnsOne(protoIndex: number): boolean {
		return this.protoReturnsOneValue[protoIndex];
	}

	// Record that a module export slot is backed by an exported static-closure
	// function (proto id). The linker resolves references to this slot directly to
	// the proto (a link-time symbol) instead of a runtime global-slot load.
	public recordExportProto(slotName: string, protoId: string): void {
		this.exportProtoIdBySlot[slotName] = protoId;
	}

	public exportProtoIndex(path: string, exportPathKey: string): number | undefined {
		const entrySlot = this.moduleExportEntrySlotByKey.get(programModuleExportKey(path, exportPathKey));
		if (entrySlot === undefined) {
			return;
		}
		const protoId = this.exportProtoIdBySlot[this.moduleExportEntries[entrySlot - 1].slotName];
		return this.protoIndexById.get(protoId);
	}

	public recordBiosFunctionImport(path: string, exportPathKey: string, importIndex: number): void {
		this.biosFunctionImportIndexBySymbol.set(
			programModuleExportKey(path, exportPathKey),
			importIndex,
		);
		this.modulePathSet.add(path);
		this.recordModuleExportPathContract(path, exportPathKey);
	}

	public biosFunctionImportIndex(path: string, exportPathKey: string): number | undefined {
		return this.biosFunctionImportIndexBySymbol.get(programModuleExportKey(path, exportPathKey));
	}

	public buildProgram(initParticipants: ReadonlyArray<InitParticipantBinding>): { program: Program; metadata: ProgramMetadata; imageConstRelocs: ProgramImageConstReloc[]; biosFunctionConstRelocs: ProgramBiosFunctionConstReloc[]; constValueRelocs: ProgramConstValueReloc[]; rodataConstRelocs: ProgramRodataConstReloc[]; data: ProgramObjectDataSection; bss: ProgramObjectBssSection; rodataBytes: Uint8Array; rodataSymbols: ProgramRodataSymbol[]; staticModulePaths: string[] } {
		let totalBytes = 0;
		for (let i = 0; i < this.protoCode.length; i += 1) {
			totalBytes += this.protos[i].codeLen;
		}
		if (totalBytes % INSTRUCTION_BYTES !== 0) {
			throw new Error(`[ProgramBuilder] Program code size must align to ${INSTRUCTION_BYTES}-byte words.`);
		}
		const totalWords = totalBytes / INSTRUCTION_BYTES;
		const fullCode = new Uint8Array(totalBytes);
		const protos: Proto[] = new Array(this.protos.length);
		const fullRanges: Array<SourceRange | null> = new Array(totalWords).fill(null);
		const fullInlineCallSites: Array<ReadonlyArray<InlineCallSite>> = new Array(totalWords).fill(ROOT_INLINE_CALL_SITES);
		const imageConstRelocs: ProgramImageConstReloc[] = [];
		const biosFunctionConstRelocs: ProgramBiosFunctionConstReloc[] = [];
		let appendOffsetBytes = 0;
		for (let i = 0; i < this.protoCode.length; i += 1) {
			const chunk = this.protoCode[i];
			if (!chunk) {
				throw new Error(`[ProgramBuilder] Missing code for proto index ${i}.`);
			}
			const proto = this.protos[i];
			const ranges = this.protoRanges[i];
			const targetOffsetBytes = appendOffsetBytes;
			if (targetOffsetBytes % INSTRUCTION_BYTES !== 0) {
				throw new Error(`[ProgramBuilder] Proto ${i} entry PC must align to ${INSTRUCTION_BYTES}-byte words.`);
			}
			const targetOffsetWords = targetOffsetBytes / INSTRUCTION_BYTES;
			protos[i] = {
				entryPC: targetOffsetBytes,
				codeLen: proto.codeLen,
				numParams: proto.numParams,
				isVararg: proto.isVararg,
				maxStack: proto.maxStack,
				upvalueDescs: proto.upvalueDescs,
				staticClosure: proto.staticClosure,
			};
			fullCode.set(chunk, targetOffsetBytes);
			for (let j = 0; j < ranges.length; j += 1) {
				fullRanges[targetOffsetWords + j] = ranges[j];
			}
			const inlineCallSites = this.protoInlineCallSites[i];
			for (let j = 0; j < inlineCallSites.length; j += 1) {
				fullInlineCallSites[targetOffsetWords + j] = inlineCallSites[j];
			}
			const relocs = this.protoConstRelocs[i];
			for (let j = 0; j < relocs.length; j += 1) {
				const reloc = relocs[j];
				switch (reloc.kind) {
					case 'module_init':
						imageConstRelocs.push({
							wordIndex: targetOffsetWords + reloc.wordIndex,
							kind: reloc.kind,
							symbol: reloc.symbol,
						});
						continue;
					case 'export_proto':
						imageConstRelocs.push({
							wordIndex: targetOffsetWords + reloc.wordIndex,
							kind: reloc.kind,
							path: reloc.path,
							exportPathKey: reloc.exportPathKey,
						});
						continue;
					case 'bios_function':
						biosFunctionConstRelocs.push({
							wordIndex: targetOffsetWords + reloc.wordIndex,
							importIndex: reloc.importIndex,
						});
						continue;
					case 'gl':
					case 'sys':
						imageConstRelocs.push({
							wordIndex: targetOffsetWords + reloc.wordIndex,
							kind: reloc.kind,
							objectSlot: reloc.objectSlot,
						});
						continue;
					default:
						imageConstRelocs.push({
							wordIndex: targetOffsetWords + reloc.wordIndex,
							kind: reloc.kind,
							constIndex: reloc.constIndex,
						});
						continue;
				}
			}
			appendOffsetBytes += chunk.length;
		}
		const metadata: ProgramMetadata = {
			debugRanges: fullRanges,
			debugInlineCallSites: fullInlineCallSites,
			protoIds: this.protoIds,
			statementPointsByProto: this.protoStatementPoints,
			resumePointsByProto: this.protoResumePoints,
			localSlotsByProto: this.protoLocalSlots,
			upvalueNamesByProto: this.protoUpvalueNames,
			globalNames: this.globalNames,
			systemGlobalNames: this.systemGlobalNames,
			exportProtoIdBySlot: this.exportProtoIdBySlot,
			initParticipants: initParticipants.map(({ functionId, slotName, system }) => ({
				functionId,
				slotName,
				system,
			})),
		};
		const moduleProtoMap = new Map<string, number>();
		for (let index = 0; index < this.moduleProtoEntries.length; index += 1) {
			const entry = this.moduleProtoEntries[index];
			moduleProtoMap.set(entry.path, entry.protoIndex);
		}
		return {
			program: {
				code: fullCode,
				constPool: this.constPool,
				protos,
				moduleProtos: this.moduleProtoEntries,
				moduleExports: this.moduleExportEntries,
				moduleProtoMap,
			},
			metadata,
			imageConstRelocs,
			biosFunctionConstRelocs,
			constValueRelocs: this.constValueRelocs.slice(),
			rodataConstRelocs: this.rodataConstRelocs.slice(),
			data: this.buildDataSection(),
			bss: this.buildBssSection(),
			rodataBytes: this.rodataBytes,
			rodataSymbols: this.buildRodataSymbols(),
			staticModulePaths: this.staticModulePaths.slice(),
		};
	}

}

function recordModuleExportContracts(
	programBuilder: ProgramBuilder,
	moduleCompileContext: ModuleCompileContext,
): void {
	for (const [, info] of moduleCompileContext.modulesByPath) {
		for (const [exportPathKey, slotName] of info.exportSlotsByPathKey) {
			if (info.constModule) {
				if (info.staticFunctionExportByPathKey.has(exportPathKey)) {
					programBuilder.recordModuleExport(info.path, exportPathKey, slotName);
				}
				continue;
			}
			programBuilder.recordModuleExportSlot(
				info.path,
				exportPathKey,
				slotName,
			);
		}
	}
}

type SplitOperand = {
	low: number;
	ext: number;
	wide: number;
};

const needsWideUnsigned = (value: number, baseBits: number, extBits: number): boolean => {
	const baseTotal = baseBits + extBits;
	const max = (1 << baseTotal) - 1;
	return value > max;
};

const needsWideSigned = (value: number, baseBits: number, extBits: number): boolean => {
	const baseTotal = baseBits + extBits;
	const min = -(1 << (baseTotal - 1));
	const max = (1 << (baseTotal - 1)) - 1;
	return value < min || value > max;
};

const splitUnsignedOperand = (value: number, label: string, baseBits: number, extBits: number, forceWide: boolean): SplitOperand => {
	if (value < 0) {
		throw new Error(`[FunctionBuilder] Negative ${label} operand: ${value}`);
	}
	const baseTotal = baseBits + extBits;
	const totalBits = baseTotal + (forceWide ? MAX_OPERAND_BITS : 0);
	const max = (1 << totalBits) - 1;
	if (value > max) {
		throw new Error(`[FunctionBuilder] ${label} operand exceeds range: ${value}`);
	}
	const baseMask = (1 << baseBits) - 1;
	const extMask = (1 << extBits) - 1;
	return {
		low: value & baseMask,
		ext: (value >> baseBits) & extMask,
		wide: value >> baseTotal,
	};
};

const splitSignedOperand = (value: number, label: string, baseBits: number, extBits: number, forceWide: boolean): SplitOperand => {
	const baseTotal = baseBits + extBits;
	const totalBits = baseTotal + (forceWide ? MAX_OPERAND_BITS : 0);
	const min = -(1 << (totalBits - 1));
	const max = (1 << (totalBits - 1)) - 1;
	if (value < min || value > max) {
		throw new Error(`[FunctionBuilder] ${label} operand exceeds range: ${value}`);
	}
	const mask = (1 << totalBits) - 1;
	const raw = value & mask;
	const baseMask = (1 << baseBits) - 1;
	const extMask = (1 << extBits) - 1;
	return {
		low: raw & baseMask,
		ext: (raw >> baseBits) & extMask,
		wide: raw >> baseTotal,
	};
};

const buildModuleRootId = (moduleId: string): string => `module:${moduleId}`;

const buildEntryProtoId = (moduleId: string): string => `${buildModuleRootId(moduleId)}/entry`;

const buildModuleProtoId = (moduleId: string): string => `${buildModuleRootId(moduleId)}/module`;

const buildSectionInitProtoId = (moduleId: string): string => `${buildModuleRootId(moduleId)}/section_init`;
const buildStartupProtoId = (moduleId: string): string => `${buildModuleRootId(moduleId)}/startup`;
const buildInitProtoId = (moduleId: string): string => `${buildModuleRootId(moduleId)}/init`;
const buildInterruptProtoId = (moduleId: string): string => `${buildModuleRootId(moduleId)}/irq`;
const buildExceptionProtoId = (moduleId: string): string => `${buildModuleRootId(moduleId)}/exception`;

const buildAnonymousHint = (range: LuaSourceRange): string =>
	`anon:${range.start.line}:${range.start.column}:${range.end.line}:${range.end.column}`;

const buildProtoId = (parentId: string, hint: string): string => {
	if (!hint) throw new Error('Proto hint is required and defensive programming is not allowed.');
	return `${parentId}/${hint}`;
}

class FunctionBuilder {
	private readonly program: ProgramBuilder;
	private readonly parent: FunctionBuilder | null;
	private readonly semantics: LuaSemanticFrontendFile;
	private readonly frontend: LuaSemanticFrontend;
	private readonly moduleId: string;
	private readonly protoId: string;
	private readonly moduleCompileContext?: ModuleCompileContext;
	private readonly moduleCompileInfo?: ModuleCompileInfo;
	private readonly staticCallTargetScope: boolean;
	private readonly code: Instruction[] = [];
	private readonly ranges: Array<SourceRange | null> = [];
	private finalizedCode: Uint8Array | null = null;
	private finalizedRanges: Array<SourceRange | null> | null = null;
	private finalizedInlineCallSites: Array<ReadonlyArray<InlineCallSite>> | null = null;
	private finalizedConstRelocs: ProgramCompilerConstReloc[] | null = null;
	private finalizedStatementPoints: ProgramStatementPoint[] | null = null;
	private finalizedResumePoints: ProgramResumePoint[] | null = null;
	private readonly localBindings = new Map<string, LocalBinding>();
	// Nested closures, including IRQ handlers, alias their owner's open-upvalue registers.
	private readonly closureWrittenRegisters = new Set<number>();
	private readonly scopeStack: ScopeFrame[] = [];
	private readonly localDebugSlots: LocalSlotDebug[] = [];
	private readonly upvalueDescs: UpvalueDesc[] = [];
	private readonly upvalueNames: string[] = [];
	private readonly upvalueSlotBySymbolHandle = new Map<string, number>();
	private readonly loopStack: LoopContext[] = [];
	private readonly labelPositions = new Map<string, number>();
	private readonly pendingLabelJumps = new Map<string, number[]>();
	private currentRange: SourceRange | null = null;
	private currentStatementRange: SourceRange | undefined;
	private localCount = 0;
	private tempTop = 0;
	private maxStack = 0;
	private localFunctionCounters = new Map<string, number>();
	private flowAnalysis: ValueKindFlowAnalyzer | null = null;
	private currentFlowState: SymbolFlowState = new Map();
	private exportRootSymbolHandleResolved = false;
	private exportRootSymbolHandleCache: string | null = null;
	private compileTimeValue: ProgramConstant = null;
	private compileTimeNumberValue = 0;
	private compileTimeHasNumberValue = false;
	private compileTimeBooleanValue = false;
	private compileTimeHasBooleanValue = false;
	private compileTimeRelocValue: RelocatableConstExportValue | null = null;
	private readonly initializerFlags: number[] = [];
	private readonly initializerValues: ProgramConstant[] = [];
	private readonly initializerNumberValues: number[] = [];
	private readonly initializerBooleanValues: boolean[] = [];
	private readonly initializerRelocValues: Array<RelocatableConstExportValue | null> = [];
	private readonly initializerValueRegs: number[] = [];
	private readonly initializerClosureProtoIndices: number[] = [];
	private readonly initializerModuleBindings: ModuleBinding[] = [];

	constructor(
		program: ProgramBuilder,
		parent: FunctionBuilder | null,
		params: {
			moduleId: string;
			protoId: string;
			semantics: LuaSemanticFrontendFile;
			frontend: LuaSemanticFrontend;
			moduleCompileContext?: ModuleCompileContext;
			moduleCompileInfo?: ModuleCompileInfo;
			staticCallTargetScope?: boolean;
		},
	) {
		this.program = program;
		this.parent = parent;
		this.semantics = params.semantics;
		this.frontend = params.frontend;
		this.moduleId = params.moduleId;
		this.protoId = params.protoId;
		this.moduleCompileContext = params.moduleCompileContext;
		this.staticCallTargetScope = !!params.staticCallTargetScope;
		// Nested functions inherit the module's export info so that references to the
		// module's own exported namespace (e.g. `room.fn` inside another `room.*`
		// function) resolve to the export symbol/slot instead of the namespace table.
		this.moduleCompileInfo = params.moduleCompileInfo;
		if (parent) {
			this.moduleCompileContext = this.moduleCompileContext || parent.moduleCompileContext;
			this.staticCallTargetScope = this.staticCallTargetScope || parent.staticCallTargetScope;
			this.moduleCompileInfo = this.moduleCompileInfo || parent.moduleCompileInfo;
		}
	}

	public compileChunk(chunk: LuaChunk): void {
		this.registerStructDeclarations(chunk.body);
		this.flowAnalysis = new ValueKindFlowAnalyzer(chunk.body, this.semantics);
		this.pushScope(chunk.range);
		for (let i = 0; i < chunk.body.length; i += 1) {
			this.compileStatement(chunk.body[i]);
			this.resetTemps();
		}
		this.popScope();
		this.withRange(chunk.range, () => this.emitDefaultReturn());
		this.finalizeLabels();
	}

	public compileStaticStorage(declarations: readonly StaticStorageDeclaration[]): void {
		for (let index = 0; index < declarations.length; index += 1) {
			const declaration = declarations[index];
			switch (declaration.kind) {
				case 'struct':
					this.program.registerStructDeclaration(declaration.statement);
					break;
				case 'bss':
					this.recordBssDeclaration(declaration.statement, declaration.declaration);
					break;
				case 'data':
					this.recordDataDeclaration(declaration.statement, declaration.declaration);
					break;
				case 'rodata':
					this.recordRodataDeclaration(declaration.statement, declaration.declaration);
					break;
			}
		}
	}

	private resetInitializerScratch(count: number): void {
		this.initializerFlags.length = count;
		this.initializerValues.length = count;
		this.initializerNumberValues.length = count;
		this.initializerBooleanValues.length = count;
		this.initializerRelocValues.length = count;
		this.initializerValueRegs.length = count;
		this.initializerClosureProtoIndices.length = count;
		this.initializerModuleBindings.length = count;
		for (let index = 0; index < count; index += 1) {
			this.initializerFlags[index] = 0;
		}
	}

	private recordCompileTimeInitializer(index: number): void {
		let flags = this.initializerFlags[index] | INIT_HAS_VALUE;
		if (this.compileTimeHasNumberValue) {
			flags |= INIT_HAS_NUMBER;
		}
		if (this.compileTimeHasBooleanValue) {
			flags |= INIT_HAS_BOOLEAN;
		}
		this.initializerFlags[index] = flags;
		this.initializerValues[index] = this.compileTimeValue;
		this.initializerNumberValues[index] = this.compileTimeNumberValue;
		this.initializerBooleanValues[index] = this.compileTimeBooleanValue;
		this.initializerRelocValues[index] = this.compileTimeRelocValue;
	}

	public compileStaticModuleScope(chunk: LuaChunk): void {
		this.registerStructDeclarations(chunk.body);
		this.pushScope(chunk.range);
		for (let index = 0; index < chunk.body.length; index += 1) {
			const statement = chunk.body[index];
			if (statement.kind === LuaSyntaxKind.LocalFunctionStatement) {
				const localFunction = statement as LuaLocalFunctionStatement;
				const decl = this.requireBoundDeclaration(localFunction.name.range, `local function '${localFunction.name.name}'`);
				this.declareLocalFromDecl(decl, localFunction.name.range);
				continue;
			}
			if (statement.kind !== LuaSyntaxKind.LocalAssignmentStatement) {
				continue;
			}
			const local = statement as LuaLocalAssignmentStatement;
			this.resetInitializerScratch(local.names.length);
			for (let valueIndex = 0; valueIndex < local.values.length && valueIndex < local.names.length; valueIndex += 1) {
				if (local.attributes[valueIndex] !== 'const') {
					continue;
				}
				const moduleBinding = this.resolveConstLocalModuleBinding(local.values[valueIndex]);
				if (moduleBinding) {
					this.initializerFlags[valueIndex] |= INIT_HAS_MODULE_BINDING;
					this.initializerModuleBindings[valueIndex] = moduleBinding;
					if (this.moduleBindingOwnsCompileTimeLocal(moduleBinding)) {
						continue;
					}
				}
				if (this.evaluateCompileTimeExpression(local.values[valueIndex])) {
					this.recordCompileTimeInitializer(valueIndex);
				}
			}
			for (let nameIndex = 0; nameIndex < local.names.length; nameIndex += 1) {
				const localName = local.names[nameIndex];
				const decl = this.requireBoundDeclaration(localName.range, `local '${localName.name}'`);
				const flags = this.initializerFlags[nameIndex];
				const moduleBinding = flags & INIT_HAS_MODULE_BINDING
					? this.initializerModuleBindings[nameIndex]
					: null;
				if (flags & INIT_HAS_VALUE) {
					this.declareLocalFromDecl(
						decl,
						localName.range,
						undefined,
						this.initializerValues[nameIndex],
						true,
						null,
						moduleBinding,
						this.initializerNumberValues[nameIndex],
						!!(flags & INIT_HAS_NUMBER),
						this.initializerBooleanValues[nameIndex],
						!!(flags & INIT_HAS_BOOLEAN),
						this.initializerRelocValues[nameIndex],
					);
				} else {
					this.declareLocalFromDecl(decl, localName.range, undefined, null, false, null, moduleBinding);
				}
			}
		}
	}

	public compileFunctionExpression(expression: LuaFunctionExpression, implicitSelf: boolean): void {
		this.registerStructDeclarations(expression.body.body);
		this.flowAnalysis = new ValueKindFlowAnalyzer(expression.body.body, this.semantics);
		this.pushScope(expression.body.range);
		if (implicitSelf) {
			this.declareLocal(IMPLICIT_SELF_SYMBOL_HANDLE, 'self', expression.range, expression.range, 'parameter');
		}
		for (let i = 0; i < expression.parameters.length; i += 1) {
			const parameter = expression.parameters[i];
			const decl = this.requireBoundDeclaration(parameter.range, `parameter '${parameter.name}'`);
			this.declareLocalFromDecl(decl, parameter.range, expression.range);
		}
		for (let i = 0; i < expression.body.body.length; i += 1) {
			this.compileStatement(expression.body.body[i]);
			this.resetTemps();
		}
		this.popScope();
		this.withRange(expression.range, () => this.emitDefaultReturn());
		this.finalizeLabels();
	}

	public compileSectionInit(range: LuaSourceRange): void {
		this.withRange(range, () => {
			const dataByteCount = this.program.getDataByteCount();
			const dataInit = this.program.dataInitBinding();
			if (dataByteCount !== 0 && dataInit !== null) {
				const srcReg = this.allocTemp();
				const dstReg = this.allocTemp();
				const countReg = this.allocTemp();
				const zeroReg = this.allocTemp();
				const wordBytesReg = this.allocTemp();
				const oneReg = this.allocTemp();
				const valueReg = this.allocTemp();
				this.emitLoadDataLmaAddress(srcReg, dataInit, -dataInit.offset);
				this.emitLoadDataAddress(dstReg, dataInit, -dataInit.offset);
				this.emitLoadConst(countReg, dataByteCount >> 2);
				this.emitLoadConst(zeroReg, 0);
				this.emitLoadConst(wordBytesReg, 4);
				this.emitLoadConst(oneReg, 1);
				const loopStart = this.code.length;
				this.emitABC(OpCode.EQ, 1, countReg, zeroReg);
				const jumpOut = this.emitJumpPlaceholder();
				this.emitABC(OpCode.LOAD_MEM, valueReg, srcReg, MemoryAccessKind.Word);
				this.emitABC(OpCode.STORE_MEM, valueReg, dstReg, MemoryAccessKind.Word);
				this.emitABC(OpCode.ADD, srcReg, srcReg, wordBytesReg);
				this.emitABC(OpCode.ADD, dstReg, dstReg, wordBytesReg);
				this.emitABC(OpCode.SUB, countReg, countReg, oneReg);
				this.emitAsBx(OpCode.JMP, 0, loopStart - (this.code.length + 1));
				this.patchJump(jumpOut, this.code.length);
			}
			const bssByteCount = this.program.getBssByteCount();
			const bssInit = this.program.bssInitBinding();
			if (bssByteCount !== 0 && bssInit !== null) {
				const addrReg = this.allocTemp();
				const countReg = this.allocTemp();
				const zeroReg = this.allocTemp();
				const wordBytesReg = this.allocTemp();
				const oneReg = this.allocTemp();
				this.emitLoadBssAddress(addrReg, bssInit, -bssInit.offset);
				this.emitLoadConst(countReg, bssByteCount >> 2);
				this.emitLoadConst(zeroReg, 0);
				this.emitLoadConst(wordBytesReg, 4);
				this.emitLoadConst(oneReg, 1);
				const loopStart = this.code.length;
				this.emitABC(OpCode.EQ, 1, countReg, zeroReg);
				const jumpOut = this.emitJumpPlaceholder();
				this.emitABC(OpCode.STORE_MEM, zeroReg, addrReg, MemoryAccessKind.Word);
				this.emitABC(OpCode.ADD, addrReg, addrReg, wordBytesReg);
				this.emitABC(OpCode.SUB, countReg, countReg, oneReg);
				this.emitAsBx(OpCode.JMP, 0, loopStart - (this.code.length + 1));
				this.patchJump(jumpOut, this.code.length);
			}
			this.emitDefaultReturn();
		});
		this.finalizeLabels();
	}

	public compileStartup(
		range: LuaSourceRange,
		sectionInitProtoIndex: number,
		entryProtoIndex: number,
		clearBootPrimitives: boolean,
	): void {
		this.withRange(range, () => {
			const callReg = this.allocTemp();
			this.emitABx(OpCode.CLOSURE, callReg, sectionInitProtoIndex);
			this.emitABC(OpCode.CALL, callReg, encodeFixedCallArgCount(0), 0);
			for (let index = 0; index < this.program.staticModulePaths.length; index += 1) {
				const path = this.program.staticModulePaths[index];
				const functionIndex = this.program.moduleProtoIndex(path);
				if (functionIndex === undefined) {
					this.emitABx(OpCode.LOADK, callReg, 0, { kind: 'module_init', symbol: path });
				} else {
					this.emitABx(OpCode.CLOSURE, callReg, functionIndex);
				}
				this.emitABC(OpCode.CALL, callReg, encodeFixedCallArgCount(0), 0);
			}
			if (clearBootPrimitives) {
				this.emitABC(OpCode.KNIL, callReg, 0, 0);
				for (let index = 0; index < SYSTEM_ROM_BOOT_PRIMITIVE_NAMES.length; index += 1) {
					this.emitABx(
						OpCode.SETSYS,
						callReg,
						this.program.resolveSystemGlobalSlot(SYSTEM_ROM_BOOT_PRIMITIVE_NAMES[index]),
					);
				}
			}
			this.emitABx(OpCode.CLOSURE, callReg, entryProtoIndex);
			this.emitABC(OpCode.CALL, callReg, encodeFixedCallArgCount(0), 0);
			this.emitABC(OpCode.RET, callReg, 0, 0);
		});
		this.finalizeLabels();
	}

	public compileInitVector(
		range: LuaSourceRange,
		participants: ReadonlyArray<InitParticipantBinding>,
	): void {
		this.withRange(range, () => {
			const callReg = this.allocTemp();
			for (let index = 0; index < participants.length; index += 1) {
				const participant = participants[index];
				this.emitABx(
					participant.system ? OpCode.GETSYS : OpCode.GETGL,
					callReg,
					participant.objectSlot,
				);
				this.emitABC(OpCode.CALL, callReg, encodeFixedCallArgCount(0), 1);
			}
			this.emitABC(OpCode.RET, callReg, 0, 0);
		});
		this.finalizeLabels();
	}

	public compileInterruptEntry(range: LuaSourceRange): void {
		this.withRange(range, () => {
			const addrReg = this.allocTemp();
			const flagsReg = this.allocTemp();
			const zeroReg = this.allocTemp();
			this.emitLoadConst(addrReg, IO_IRQ_FLAGS);
			this.emitABC(OpCode.LOAD_MEM, flagsReg, addrReg, MemoryAccessKind.Word);
			this.emitLoadConst(zeroReg, 0);
			this.emitABC(OpCode.EQ, 1, flagsReg, zeroReg);
			const jumpOut = this.emitJumpPlaceholder();
			const callBase = this.allocTempBlock(2);
			const access = this.program.resolveGlobalAccess('irq');
			this.emitABx(access.system ? OpCode.GETSYS : OpCode.GETGL, callBase, access.slot);
			this.emitABC(OpCode.MOV, callBase + 1, flagsReg, 0);
			this.emitABC(OpCode.CALL, callBase, encodeFixedCallArgCount(1), 0);
			this.patchJump(jumpOut, this.code.length);
			this.emitABC(OpCode.RFE, 0, 0, 0);
		});
		this.finalizeLabels();
	}

	public compileExceptionEntry(range: LuaSourceRange): void {
		this.withRange(range, () => {
			this.reserveTempRange(0, 1);
			const callBase = this.allocTempBlock(2);
			const access = this.program.resolveGlobalAccess('exception');
			this.emitABx(access.system ? OpCode.GETSYS : OpCode.GETGL, callBase, access.slot);
			this.emitABC(OpCode.MOV, callBase + 1, 0, 0);
			this.emitABC(OpCode.CALL, callBase, encodeFixedCallArgCount(1), 0);
			this.emitABC(OpCode.RFE, 0, 0, 0);
		});
		this.finalizeLabels();
	}

	private registerStructDeclarations(statements: ReadonlyArray<LuaStatement>): void {
		for (let index = 0; index < statements.length; index += 1) {
			const statement = statements[index];
			if (statement.kind === LuaSyntaxKind.StructDeclarationStatement) {
				this.program.registerStructDeclaration(statement as LuaStructDeclarationStatement);
			}
		}
	}

	private alignStructOffset(offset: number, alignment: number): number {
		return (offset + alignment - 1) & ~(alignment - 1);
	}

	private requireStructArrayLength(expression: LuaExpression): number {
		const value = this.evaluateCompileTimeNumber(expression);
		if (value === undefined || !Number.isInteger(value) || value <= 0) {
			throw new Error('Struct array length must be a positive compile-time integer.');
		}
		return value;
	}

	private makeStructResolvedType(
		name: string,
		baseSize: number,
		baseAlignment: number,
		baseAccess: StructScalarAccess | null,
		baseStruct: StructLayout | null,
		dimensions: ReadonlyArray<number>,
	): StructResolvedType {
		let size = baseSize;
		for (let index = 0; index < dimensions.length; index += 1) {
			size *= dimensions[index];
		}
		const isElement = dimensions.length === 0;
		return {
			name,
			baseSize,
			baseAlignment,
			baseAccess,
			baseStruct,
			size,
			alignment: baseAlignment,
			access: isElement ? baseAccess : null,
			struct: isElement ? baseStruct : null,
			dimensions: Array.from(dimensions),
		};
	}

	private resolveStructTypeReference(typeRef: LuaTypeReference, resolving: Set<string> = new Set(), inferredOuterLength?: number): StructResolvedType {
		const primitive = PRIMITIVE_STRUCT_TYPES.get(typeRef.name);
		let baseSize: number;
		let baseAlignment: number;
		let baseAccess: StructScalarAccess | null;
		let baseStruct: StructLayout | null;
		if (primitive !== undefined) {
			baseSize = primitive.size;
			baseAlignment = primitive.alignment;
			baseAccess = primitive.access;
			baseStruct = null;
		} else {
			const layout = this.resolveStructLayout(typeRef.name, resolving);
			baseSize = layout.size;
			baseAlignment = layout.alignment;
			baseAccess = null;
			baseStruct = layout;
		}
		const dimensions: number[] = [];
		for (let index = 0; index < typeRef.arrayLengths.length; index += 1) {
			const lengthExpression = typeRef.arrayLengths[index];
			if (!lengthExpression) {
				if (index !== 0 || !inferredOuterLength) {
					throw new Error('An inferred array length is only valid for the outer dimension of an initialized .data or .rodata declaration.');
				}
				dimensions.push(inferredOuterLength);
				continue;
			}
			dimensions.push(this.requireStructArrayLength(lengthExpression));
		}
		return this.makeStructResolvedType(typeRef.name, baseSize, baseAlignment, baseAccess, baseStruct, dimensions);
	}

	private resolveStructLayout(name: string, resolving: Set<string> = new Set()): StructLayout {
		const existing = this.program.structLayouts.get(name);
		if (existing) {
			return existing;
		}
		const declaration = this.program.structDeclarations.get(name);
		if (!declaration) {
			throw new Error(`Unknown struct type '${name}'.`);
		}
		if (resolving.has(name)) {
			throw new Error(`Recursive struct layout '${name}' is not supported.`);
		}
		resolving.add(name);
		let offset = 0;
		let alignment = 1;
		const fields = new Map<string, StructFieldLayout>();
		for (let index = 0; index < declaration.fields.length; index += 1) {
			const field = declaration.fields[index] as LuaStructFieldDeclaration;
			if (fields.has(field.name)) {
				throw new Error(`Duplicate field '${field.name}' in struct '${name}'.`);
			}
			const type = this.resolveStructTypeReference(field.typeRef, resolving);
			offset = this.alignStructOffset(offset, type.alignment);
			fields.set(field.name, {
				name: field.name,
				type,
				offset,
				size: type.size,
				access: type.access,
			});
			offset += type.size;
			alignment = Math.max(alignment, type.alignment);
		}
		const layout: StructLayout = {
			name,
			size: this.alignStructOffset(offset, alignment),
			alignment,
			fields,
		};
		this.program.recordStructLayout(layout);
		resolving.delete(name);
		return layout;
	}

	private typeAfterStructIndex(type: StructResolvedType): StructResolvedType {
		if (type.dimensions.length === 0) {
			throw new Error(`Type '${type.name}' is not an array.`);
		}
		return this.makeStructResolvedType(
			type.name,
			type.baseSize,
			type.baseAlignment,
			type.baseAccess,
			type.baseStruct,
			type.dimensions.slice(1),
		);
	}

	private resolveOffsetOf(typeName: string, fieldPath: ReadonlyArray<string>): number {
		const layout = this.resolveStructLayout(typeName);
		let offset = 0;
		let current = this.makeStructResolvedType(typeName, layout.size, layout.alignment, null, layout, []);
		for (let index = 0; index < fieldPath.length; index += 1) {
			if (current.struct === null) {
				throw new Error(`offsetof cannot select '${fieldPath[index]}' through non-struct type '${current.name}'.`);
			}
			const field = current.struct.fields.get(fieldPath[index]);
			if (field === undefined) {
				throw new Error(`Unknown field '${fieldPath[index]}' on struct '${current.struct.name}'.`);
			}
			offset += field.offset;
			current = field.type;
		}
		return offset;
	}

	private resolveStructFieldAddress(base: StructAddress, fieldName: string): StructAddress {
		if (base.type.struct === null) {
			throw new Error(`Cannot select field '${fieldName}' from non-struct type '${base.type.name}'.`);
		}
		const field = base.type.struct.fields.get(fieldName);
		if (field === undefined) {
			throw new Error(`Unknown field '${fieldName}' on struct '${base.type.struct.name}'.`);
		}
		return {
			baseReg: base.baseReg,
			byteOffset: base.byteOffset + field.offset,
			type: field.type,
			pointerIndex: false,
			readOnly: base.readOnly,
		};
	}

	public getCode(): Uint8Array {
		this.finalizeCode();
		return this.finalizedCode!;
	}

	public getRanges(): ReadonlyArray<SourceRange | null> {
		this.finalizeCode();
		return this.finalizedRanges!;
	}

	public getInlineCallSites(): ReadonlyArray<ReadonlyArray<InlineCallSite>> {
		this.finalizeCode();
		return this.finalizedInlineCallSites!;
	}

	public getConstRelocs(): ReadonlyArray<ProgramCompilerConstReloc> {
		this.finalizeCode();
		return this.finalizedConstRelocs!;
	}

	public getStatementPoints(): ReadonlyArray<ProgramStatementPoint> {
		this.finalizeCode();
		return this.finalizedStatementPoints!;
	}

	public getResumePoints(): ReadonlyArray<ProgramResumePoint> {
		this.finalizeCode();
		return this.finalizedResumePoints!;
	}

	public getInstructionSet(): InstructionSet {
		this.finalizeCode();
		return {
			instructions: this.code,
			ranges: this.ranges,
		};
	}

	private finalizeCode(): void {
		if (this.finalizedCode) {
			return;
		}
		if (this.program.optLevel > 0) {
			const optimized = optimizeInstructions(this.code, this.ranges, this.program.optLevel, {
				currentFunctionId: this.protoId,
				constPool: this.program.constPool,
				relocatedConstIndices: this.program.relocatedConstIndexSet(),
				constIndex: (value: ProgramConstant) => this.program.constIndex(value),
				getClosureUpvalues: (protoIndex: number) => {
					const proto = this.program.protos[protoIndex];
					if (!proto) {
						throw new Error(`[ProgramCompiler] Missing proto for index ${protoIndex}.`);
					}
					return proto.upvalueDescs;
				},
				getProtoMeta: (protoIndex: number) => {
					const proto = this.program.protos[protoIndex];
					if (!proto) {
						throw new Error(`[ProgramCompiler] Missing proto for index ${protoIndex}.`);
					}
					return proto;
				},
				getProtoInstructionSet: (protoIndex: number) => {
					const instructionSet = this.program.protoInstructionSets[protoIndex];
					if (instructionSet === undefined) {
						return null;
					}
					return instructionSet;
				},
				getProtoFunctionId: (protoIndex: number) => this.program.protoIds[protoIndex],
				getProtoLocalSlots: (protoIndex: number) => this.program.protoLocalSlots[protoIndex],
				closureWrittenRegisters: this.closureWrittenRegisters,
			});
			if (optimized.instructions !== this.code) {
				this.code.length = 0;
				this.code.push(...optimized.instructions);
			}
			if (optimized.ranges !== this.ranges) {
				this.ranges.length = 0;
				this.ranges.push(...optimized.ranges);
			}
			if (optimized.inlineLocalSlots !== undefined) {
				this.localDebugSlots.push(...optimized.inlineLocalSlots);
			}
			compactUnusedUpvalues(
				this.code,
				this.upvalueDescs,
				this.upvalueNames,
				(protoIndex: number) => this.program.protos[protoIndex].upvalueDescs,
			);
			this.maxStack = Math.max(this.maxStack, computeMaxRegister(this.code) + 1);
		}
		const instructions = this.code;
		const ranges = this.ranges;
		const wideFlags: boolean[] = new Array(instructions.length);
		const sbxValues: number[] = new Array(instructions.length).fill(0);
		const sbxBaseBits = MAX_BX_BITS + EXT_BX_BITS;
		const sbxWideBits = sbxBaseBits + MAX_OPERAND_BITS;
		const sbxBaseMin = -(1 << (sbxBaseBits - 1));
		const sbxBaseMax = (1 << (sbxBaseBits - 1)) - 1;
		const sbxWideMin = -(1 << (sbxWideBits - 1));
		const sbxWideMax = (1 << (sbxWideBits - 1)) - 1;

		for (let index = 0; index < instructions.length; index += 1) {
			const instr = instructions[index];
			if (instr.format === 'ABC') {
				if (isDisplacedMemoryOp(instr.op)) {
					const aWide = needsWideUnsigned(instr.a, MAX_OPERAND_BITS, 0);
					const bWide = needsWideUnsigned(instr.b, MAX_OPERAND_BITS, 0);
					const cWide = needsWideUnsigned(instr.c, MAX_OPERAND_BITS, 0);
					wideFlags[index] = aWide || bWide || cWide;
					continue;
				}
				const bWidthValue = instr.b;
				const cWidthValue = instr.c;
				const forceWide = ((instr.rkMask & RK_B) !== 0 && instr.b < 0)
					|| ((instr.rkMask & RK_C) !== 0 && instr.c < 0);
				const forceFieldWide = isFieldConstOp(instr.op);
				const aWide = needsWideUnsigned(instr.a, MAX_OPERAND_BITS, EXT_A_BITS);
				const bWide = (instr.rkMask & RK_B) !== 0
					? needsWideSigned(bWidthValue, MAX_OPERAND_BITS, EXT_B_BITS)
					: needsWideUnsigned(bWidthValue, MAX_OPERAND_BITS, EXT_B_BITS);
				const cWide = (instr.rkMask & RK_C) !== 0
					? needsWideSigned(cWidthValue, MAX_OPERAND_BITS, EXT_C_BITS)
					: needsWideUnsigned(cWidthValue, MAX_OPERAND_BITS, EXT_C_BITS);
				wideFlags[index] = forceWide || forceFieldWide || aWide || bWide || cWide;
				continue;
			}
			if (instr.format === 'ABx') {
				const bxWidthValue = instr.b;
				const forceWide = isConstBxOp(instr.op)
					|| instr.op === OpCode.CLOSURE
					|| isGlobalSlotOp(instr.op)
					|| instr.symbolicReloc !== undefined;
				const aWide = needsWideUnsigned(instr.a, MAX_OPERAND_BITS, 0);
				const bxWide = isSignedBxOp(instr.op)
					? needsWideSigned(bxWidthValue, MAX_BX_BITS, EXT_BX_BITS)
					: needsWideUnsigned(bxWidthValue, MAX_BX_BITS, EXT_BX_BITS);
				wideFlags[index] = forceWide || aWide || bxWide;
				continue;
			}
			wideFlags[index] = needsWideUnsigned(instr.a, MAX_OPERAND_BITS, 0);
		}

		let changed = true;
		const instrStartIndex: number[] = new Array(instructions.length);
		const instrWordIndex: number[] = new Array(instructions.length);
		while (changed) {
			changed = false;
			let cursor = 0;
			for (let index = 0; index < instructions.length; index += 1) {
				const hasWide = wideFlags[index];
				instrStartIndex[index] = cursor;
				instrWordIndex[index] = cursor + (hasWide ? 1 : 0);
				cursor += hasWide ? 2 : 1;
			}
			const endIndex = cursor;
			for (let index = 0; index < instructions.length; index += 1) {
				const instr = instructions[index];
				if (instr.format !== 'AsBx') {
					continue;
				}
				if (instr.target === null) {
					throw new Error('[FunctionBuilder] Unpatched jump instruction.');
				}
				const targetIndex = instr.target;
				const encodedTarget = targetIndex === instructions.length ? endIndex : instrStartIndex[targetIndex];
				const sbx = encodedTarget - (instrWordIndex[index] + 1);
				if (sbx < sbxWideMin || sbx > sbxWideMax) {
					throw new Error(`[FunctionBuilder] Jump offset out of range: ${sbx}`);
				}
				sbxValues[index] = sbx;
				if (!wideFlags[index] && (sbx < sbxBaseMin || sbx > sbxBaseMax)) {
					wideFlags[index] = true;
					changed = true;
				}
			}
		}

		let totalInstr = 0;
		for (let index = 0; index < instructions.length; index += 1) {
			totalInstr += wideFlags[index] ? 2 : 1;
		}

		for (let index = 0; index < instructions.length; index += 1) {
			const instr = instructions[index];
			if (instr.format === 'ABx' && instr.op !== OpCode.KSMI && instr.b < 0) {
				throw new Error(`[FunctionBuilder] Negative Bx operand at ${index} (op=${instr.op}, b=${instr.b}).`);
			}
		}

		const code = new Uint8Array(totalInstr * INSTRUCTION_BYTES);
		const finalRanges: Array<SourceRange | null> = new Array(totalInstr);
		const finalInlineCallSites: Array<ReadonlyArray<InlineCallSite>> = new Array(totalInstr).fill(ROOT_INLINE_CALL_SITES);
		const constRelocs: ProgramCompilerConstReloc[] = [];
		let cursor = 0;
		for (let index = 0; index < instructions.length; index += 1) {
			const instr = instructions[index];
			const hasWide = wideFlags[index];
			const range = ranges[index];
			if (instr.format === 'ABC') {
				if (isDisplacedMemoryOp(instr.op)) {
					const aSplit = splitUnsignedOperand(instr.a, 'A', MAX_OPERAND_BITS, 0, hasWide);
					const bSplit = splitUnsignedOperand(instr.b, 'B', MAX_OPERAND_BITS, 0, hasWide);
					const cSplit = splitUnsignedOperand(instr.c, 'C', MAX_OPERAND_BITS, 0, hasWide);
					const disp = instr.disp ?? 0;
					if (disp < 0 || disp > MAX_DISPLACED_MEMORY_WORD_OFFSET) {
						throw new Error(`[FunctionBuilder] Displacement operand exceeds range: ${disp}`);
					}
					if (hasWide) {
						writeInstruction(code, cursor, OpCode.WIDE, aSplit.wide, bSplit.wide, cSplit.wide);
						finalRanges[cursor] = range;
						cursor += 1;
					}
					writeInstruction(code, cursor, instr.op, aSplit.low, bSplit.low, cSplit.low, disp);
					finalRanges[cursor] = range;
					cursor += 1;
					continue;
				}
				const aSplit = splitUnsignedOperand(instr.a, 'A', MAX_OPERAND_BITS, EXT_A_BITS, hasWide);
				const bSplit = (instr.rkMask & RK_B)
					? splitSignedOperand(instr.b, 'B', MAX_OPERAND_BITS, EXT_B_BITS, hasWide)
					: splitUnsignedOperand(instr.b, 'B', MAX_OPERAND_BITS, EXT_B_BITS, hasWide);
				const cSplit = (instr.rkMask & RK_C)
					? splitSignedOperand(instr.c, 'C', MAX_OPERAND_BITS, EXT_C_BITS, hasWide)
					: splitUnsignedOperand(instr.c, 'C', MAX_OPERAND_BITS, EXT_C_BITS, hasWide);
				const ext = (aSplit.ext << 6) | (bSplit.ext << 3) | cSplit.ext;
				if (hasWide) {
					writeInstruction(code, cursor, OpCode.WIDE, aSplit.wide, bSplit.wide, cSplit.wide);
					finalRanges[cursor] = range;
					cursor += 1;
				}
				writeInstruction(code, cursor, instr.op, aSplit.low, bSplit.low, cSplit.low, ext);
				finalRanges[cursor] = range;
				cursor += 1;
				const wordIndex = instrWordIndex[index];
				if ((instr.rkMask & RK_B) !== 0 && instr.b < 0) {
					constRelocs.push({ wordIndex, kind: 'rk_b', constIndex: -instr.b - 1 });
				}
				if ((instr.rkMask & RK_C) !== 0 && instr.c < 0) {
					constRelocs.push({ wordIndex, kind: 'rk_c', constIndex: -instr.c - 1 });
				}
				if (instr.op === OpCode.SETFIELD) {
					constRelocs.push({ wordIndex, kind: 'const_b', constIndex: instr.b });
				}
				if (instr.op === OpCode.GETFIELD || instr.op === OpCode.SELF) {
					constRelocs.push({ wordIndex, kind: 'const_c', constIndex: instr.c });
				}
				continue;
			}
			if (instr.format === 'ABx') {
				const aSplit = splitUnsignedOperand(instr.a, 'A', MAX_OPERAND_BITS, 0, hasWide);
				const bxSplit = isSignedBxOp(instr.op)
					? splitSignedOperand(instr.b, 'Bx', MAX_BX_BITS, EXT_BX_BITS, hasWide)
					: splitUnsignedOperand(instr.b, 'Bx', MAX_BX_BITS, EXT_BX_BITS, hasWide);
				if (hasWide) {
					writeInstruction(
						code,
						cursor,
						OpCode.WIDE,
						aSplit.wide,
						bxSplit.wide,
						instr.closureAddressRegister ? CLOSURE_ADDRESS_REGISTER_WIDE_C : 0,
					);
					finalRanges[cursor] = range;
					cursor += 1;
				}
				writeInstruction(code, cursor, instr.op, aSplit.low, (bxSplit.low >>> 6) & 0x3f, bxSplit.low & 0x3f, bxSplit.ext);
				finalRanges[cursor] = range;
				cursor += 1;
				if (isConstBxOp(instr.op)) {
					if (instr.symbolicReloc) {
						switch (instr.symbolicReloc.kind) {
							case 'module_init':
								constRelocs.push({
									wordIndex: instrWordIndex[index],
									kind: instr.symbolicReloc.kind,
									symbol: instr.symbolicReloc.symbol,
								});
								break;
							case 'export_proto':
								constRelocs.push({
									wordIndex: instrWordIndex[index],
									kind: instr.symbolicReloc.kind,
									path: instr.symbolicReloc.path,
									exportPathKey: instr.symbolicReloc.exportPathKey,
								});
								break;
							case 'bios_function':
								constRelocs.push({
									wordIndex: instrWordIndex[index],
									kind: instr.symbolicReloc.kind,
									importIndex: instr.symbolicReloc.importIndex,
								});
								break;
						}
					} else {
						constRelocs.push({ wordIndex: instrWordIndex[index], kind: 'bx', constIndex: instr.b });
					}
				} else if (instr.op === OpCode.GETSYS || instr.op === OpCode.SETSYS) {
					constRelocs.push({ wordIndex: instrWordIndex[index], kind: 'sys', objectSlot: instr.b });
				} else if (isGlobalSlotOp(instr.op)) {
					constRelocs.push({ wordIndex: instrWordIndex[index], kind: 'gl', objectSlot: instr.b });
				}
				continue;
			}

			const aSplit = splitUnsignedOperand(instr.a, 'A', MAX_OPERAND_BITS, 0, hasWide);
			const sbx = sbxValues[index];
			const bxSplit = splitSignedOperand(sbx, 'sBx', MAX_BX_BITS, EXT_BX_BITS, hasWide);
			if (hasWide) {
				writeInstruction(code, cursor, OpCode.WIDE, aSplit.wide, bxSplit.wide, 0);
				finalRanges[cursor] = range;
				cursor += 1;
			}
			writeInstruction(code, cursor, instr.op, aSplit.low, (bxSplit.low >>> 6) & 0x3f, bxSplit.low & 0x3f, bxSplit.ext);
			finalRanges[cursor] = range;
			cursor += 1;
		}
		for (let index = 0; index < instructions.length; index += 1) {
			const inlineCallSites = instructions[index].inlineCallSites ?? ROOT_INLINE_CALL_SITES;
			const start = instrStartIndex[index];
			finalInlineCallSites[start] = inlineCallSites;
			if (wideFlags[index]) {
				finalInlineCallSites[start + 1] = inlineCallSites;
			}
		}

		this.finalizedCode = code;
		this.finalizedRanges = finalRanges;
		this.finalizedInlineCallSites = finalInlineCallSites;
		this.finalizedConstRelocs = constRelocs;
		this.finalizedStatementPoints = buildProgramStatementPoints(
			instructions,
			instrStartIndex,
		);
		this.finalizedResumePoints = buildProgramResumePoints(
			instructions,
			instrStartIndex,
			this.localDebugSlots,
			this.maxStack,
			(protoIndex: number) => this.program.protos[protoIndex].upvalueDescs,
		);
	}

	public getUpvalueDescs(): UpvalueDesc[] {
		return this.upvalueDescs;
	}

	public getUpvalueNames(): ReadonlyArray<string> {
		return this.upvalueNames;
	}

	public getLocalDebugSlots(): ReadonlyArray<LocalSlotDebug> {
		this.finalizeCode();
		return this.localDebugSlots;
	}

	public getMaxStack(): number {
		return this.maxStack;
	}

	private pushScope(range: LuaSourceRange): void {
		this.scopeStack.push({
			locals: [],
			range,
		});
	}

	private popScope(): void {
		const scope = this.scopeStack.pop()!;
		for (let i = scope.locals.length - 1; i >= 0; i -= 1) {
			this.localBindings.delete(scope.locals[i].symbolHandle);
		}
	}

	private resetTemps(): void {
		this.tempTop = this.localCount;
	}

	private finalizeLabels(): void {
		if (this.pendingLabelJumps.size === 0) {
			return;
		}
		const labels = Array.from(this.pendingLabelJumps.keys()).sort();
		throw new Error(`Missing label(s): ${labels.join(', ')}`);
	}

	private requireBoundDeclaration(range: LuaSourceRange, context: string): Decl {
		const decl = this.semantics.getDeclaration(range);
		if (!decl) {
			throw new Error(`Missing bound declaration for ${context}.`);
		}
		return decl;
	}

	private declareLocal(
		symbolHandle: string,
		name: string,
		definitionRange: LuaSourceRange,
		scopeRange?: LuaSourceRange,
		kind: LocalBindingKind = 'local',
		constValue: ProgramConstant | null = null,
		hasConstValue = false,
		constClosureProtoIndex: number | null = null,
		moduleBinding: ModuleBinding | null = null,
		constNumberValue = 0,
		hasConstNumberValue = false,
		constBooleanValue = false,
		hasConstBooleanValue = false,
		constRelocValue: RelocatableConstExportValue | null = null,
	): number {
		if (getMemoryAccessKindForName(name) !== null) {
			throw new Error(`'${name}' is a reserved memory map name and cannot be used as a local or parameter.`);
		}
		if (isReservedIntrinsicName(name)) {
			throw new Error(`'${name}' is a reserved intrinsic name and cannot be used as a local or parameter.`);
		}
		const reg = this.localCount;
		this.localCount += 1;
		if (this.tempTop < this.localCount) {
			this.tempTop = this.localCount;
		}
		if (this.tempTop > this.maxStack) {
			this.maxStack = this.tempTop;
		}
		const binding: LocalBinding = {
			symbolHandle,
			name,
			reg,
			kind,
			constValue,
			hasConstValue,
			constNumberValue,
			hasConstNumberValue,
			constBooleanValue,
			hasConstBooleanValue,
			constRelocValue,
			constClosureProtoIndex,
			moduleBinding,
			structView: null,
		};
		this.localBindings.set(symbolHandle, binding);
		if (this.flowAnalysis?.isWrittenByNestedClosure(symbolHandle)) {
			this.closureWrittenRegisters.add(reg);
		}
		const scope = this.scopeStack[this.scopeStack.length - 1];
		scope.locals.push(binding);
		const effectiveScopeRange = scopeRange ?? scope.range;
		this.localDebugSlots.push({
			name,
			registerIndex: reg,
			definition: definitionRange,
			scope: effectiveScopeRange,
			inlineCallSites: ROOT_INLINE_CALL_SITES,
		});
		return reg;
	}

	private declareLocalFromDecl(
		decl: Decl,
		definitionRange: LuaSourceRange,
		scopeRange?: LuaSourceRange,
		constValue: ProgramConstant | null = null,
		hasConstValue = false,
		constClosureProtoIndex: number | null = null,
		moduleBinding: ModuleBinding | null = null,
		constNumberValue = 0,
		hasConstNumberValue = false,
		constBooleanValue = false,
		hasConstBooleanValue = false,
		constRelocValue: RelocatableConstExportValue | null = null,
	): number {
		let kind: LocalBindingKind;
		switch (decl.kind) {
			case 'constant':
				kind = 'const';
				break;
			case 'parameter':
				kind = 'parameter';
				break;
			case 'local':
			default:
				kind = 'local';
				break;
		}
		return this.declareLocal(
			decl.id,
			decl.name,
			definitionRange,
			scopeRange,
			kind,
			constValue,
			hasConstValue,
			constClosureProtoIndex,
			moduleBinding,
			constNumberValue,
			hasConstNumberValue,
			constBooleanValue,
			hasConstBooleanValue,
			constRelocValue,
		);
	}

	private resolveLocal(symbolHandle: string): number | null {
		const binding = this.localBindings.get(symbolHandle);
		if (binding === undefined) {
			return null;
		}
		return binding.reg;
	}

	private resolveUpvalue(symbolHandle: string, name: string): number | null {
		const slot = this.upvalueSlotBySymbolHandle.get(symbolHandle);
		if (slot) {
			return slot - 1;
		}
		if (!this.parent) {
			return null;
		}
		const parentLocal = this.parent.localBindings.get(symbolHandle);
		if (parentLocal) {
			const index = this.upvalueDescs.length;
			this.upvalueDescs.push({ inStack: true, index: parentLocal.reg });
			this.upvalueNames.push(name);
			this.upvalueSlotBySymbolHandle.set(symbolHandle, index + 1);
			return index;
		}
		const parentUpvalue = this.parent.resolveUpvalue(symbolHandle, name);
		if (parentUpvalue || parentUpvalue === 0) {
			const index = this.upvalueDescs.length;
			this.upvalueDescs.push({ inStack: false, index: parentUpvalue });
			this.upvalueNames.push(name);
			this.upvalueSlotBySymbolHandle.set(symbolHandle, index + 1);
			return index;
		}
		return null;
	}

	private resolveVisibleBinding(symbolHandle: string): LocalBinding | null {
		const localBinding = this.localBindings.get(symbolHandle);
		if (localBinding) {
			return localBinding;
		}
		if (!this.parent) {
			return null;
		}
		return this.parent.resolveVisibleBinding(symbolHandle);
	}

	private resolveCompileTimeConstBinding(symbolHandle: string): LocalBinding | null {
		const binding = this.resolveVisibleBinding(symbolHandle);
		if (!binding || binding.kind !== 'const' || !binding.hasConstValue) {
			return null;
		}
		return binding;
	}

	private resolveCompileTimeConstClosureBinding(symbolHandle: string): LocalBinding | null {
		const binding = this.resolveVisibleBinding(symbolHandle);
		if (!binding || binding.kind !== 'const' || binding.constClosureProtoIndex === null) {
			return null;
		}
		return binding;
	}

	private getReferenceName(reference: LuaBoundReference): string {
		return reference.ref.name;
	}

	private resolveReferenceVisibleBinding(reference: LuaBoundReference): LocalBinding | null {
		const symbolHandle = getResolvedReferenceSymbolHandle(reference);
		if (!symbolHandle) {
			return null;
		}
		return this.resolveVisibleBinding(symbolHandle);
	}

	private resolveReferenceLocal(reference: LuaBoundReference): number | null {
		const symbolHandle = getResolvedReferenceSymbolHandle(reference);
		if (!symbolHandle) {
			return null;
		}
		return this.resolveLocal(symbolHandle);
	}

	private resolveReferenceUpvalue(reference: LuaBoundReference): number | null {
		const symbolHandle = getResolvedReferenceSymbolHandle(reference);
		if (!symbolHandle) {
			return null;
		}
		return this.resolveUpvalue(symbolHandle, this.getReferenceName(reference));
	}

	private resolveReferenceConstBinding(reference: LuaBoundReference): LocalBinding | null {
		const symbolHandle = getResolvedReferenceSymbolHandle(reference);
		if (!symbolHandle) {
			return null;
		}
		return this.resolveCompileTimeConstBinding(symbolHandle);
	}

	private resolveReferenceBssBinding(reference: LuaBoundReference): BssBinding | undefined {
		const decl = reference.decl;
		if (decl && decl.kind === 'bss') {
			return this.program.bssBindingsBySymbolHandle.get(decl.id);
		}
		const symbolHandle = getResolvedReferenceSymbolHandle(reference);
		if (!symbolHandle) {
			return;
		}
		return this.program.bssBindingsBySymbolHandle.get(symbolHandle);
	}

	private resolveReferenceDataBinding(reference: LuaBoundReference): DataBinding | undefined {
		const decl = reference.decl;
		if (decl && decl.kind === 'data') {
			return this.program.dataBindingsBySymbolHandle.get(decl.id);
		}
		const symbolHandle = getResolvedReferenceSymbolHandle(reference);
		if (!symbolHandle) {
			return;
		}
		return this.program.dataBindingsBySymbolHandle.get(symbolHandle);
	}

	private resolveReferenceRodataBinding(reference: LuaBoundReference): RodataBinding | undefined {
		const decl = reference.decl;
		if (decl && decl.kind === 'rodata') {
			return this.program.rodataBindingsBySymbolHandle.get(decl.id);
		}
		const symbolHandle = getResolvedReferenceSymbolHandle(reference);
		if (!symbolHandle) {
			return;
		}
		return this.program.rodataBindingsBySymbolHandle.get(symbolHandle);
	}

	private resolveReferenceConstClosureBinding(reference: LuaBoundReference): LocalBinding | null {
		const symbolHandle = getResolvedReferenceSymbolHandle(reference);
		if (!symbolHandle) {
			return null;
		}
		return this.resolveCompileTimeConstClosureBinding(symbolHandle);
	}

	public markStaticModulePath(path: string, visiting: Set<string> = new Set()): void {
		if (this.program.hasStaticModulePath(path)) {
			return;
		}
		if (visiting.has(path)) {
			throw new Error(`Compile-time require cycle includes module '${path}'.`);
		}
		const context = this.moduleCompileContext as ModuleCompileContext;
		const moduleInfo = context.modulesByPath.get(path);
		if (moduleInfo && moduleInfo.constModule) {
			return;
		}
		visiting.add(path);
		const dependencies = context.moduleDependenciesByPath.get(path);
		if (dependencies) {
			for (let index = 0; index < dependencies.length; index += 1) {
				this.markStaticModulePath(dependencies[index], visiting);
			}
		}
		visiting.delete(path);
		this.program.recordStaticModulePath(path);
	}

	private resolveKnownModulePath(name: string): string {
		const canonicalName = toLuaModulePath(name);
		const context = this.moduleCompileContext;
		if (context) {
			if (context.modulePaths.has(name)) {
				return name;
			}
			if (context.modulePaths.has(canonicalName)) {
				return canonicalName;
			}
		}
		if (this.program.hasModuleContract(name)) {
			return name;
		}
		if (this.program.hasModuleContract(canonicalName)) {
			return canonicalName;
		}
		throw new Error(`Compile-time require module '${name}' was not provided to the program compiler.`);
	}

	private resolveRequireModuleBinding(expression: LuaExpression): RequireModuleBinding | undefined {
		if (expression.kind !== LuaSyntaxKind.CallExpression) {
			return;
		}
		const call = expression as LuaCallExpression;
		if (call.callee.kind !== LuaSyntaxKind.IdentifierExpression) {
			return;
		}
		const callee = call.callee as LuaIdentifierExpression;
		if (callee.name !== 'require') {
			return;
		}
		const reference = getResolvedIdentifierReference(this.semantics, callee);
		if (reference.kind === 'lexical') {
			return;
		}
		if (call.method !== null || call.arguments.length !== 1 || call.arguments[0].kind !== LuaSyntaxKind.StringLiteralExpression) {
			throw new Error('Compile-time require expects exactly one literal module path.');
		}
		const moduleName = (call.arguments[0] as LuaStringLiteralExpression).value;
		const modulePath = this.resolveKnownModulePath(moduleName);
		const context = this.moduleCompileContext;
		if (context) {
			const moduleInfo = context.modulesByPath.get(modulePath);
			if (moduleInfo) {
				return {
					kind: 'source',
					modulePath,
					exportPathKey: '',
					exportDepth: 0,
					moduleInfo,
				};
			}
			if (context.modulePaths.has(modulePath)) {
				return {
					kind: 'unshaped',
					modulePath,
				};
			}
		}
		return {
			kind: 'installed',
			modulePath,
			exportPathKey: '',
			exportDepth: 0,
		};
	}

	private resolveStaticModuleBinding(expression: LuaExpression, allowRequireRoot: boolean): ModuleBinding | undefined {
		/*
			BLua32 uses flat machine instructions. Live Lua module tables are not
			part of that ABI. Compile-time system-ROM modules contribute initializer
			paths to the object image; unresolved exports become link relocations
			that are rewritten before the image enters ROM.

			This resolves shaped source modules and installed compiler modules.
			Plain unshaped modules are handled by require lowering.
		 */
		if (allowRequireRoot) {
			const requireBinding = this.resolveRequireModuleBinding(expression);
			if (requireBinding && (requireBinding.kind === 'source' || requireBinding.kind === 'installed')) {
				return requireBinding;
			}
		}
		if (expression.kind === LuaSyntaxKind.IdentifierExpression) {
			const reference = getResolvedIdentifierReference(this.semantics, expression as LuaIdentifierExpression);
			const moduleInfo = this.moduleCompileInfo;
			if (moduleInfo) {
				const exportRootSymbolHandle = this.getExportRootSymbolHandle();
				if (exportRootSymbolHandle
					&& this.protoId !== buildModuleProtoId(moduleInfo.path)
					&& getResolvedReferenceSymbolHandle(reference) === exportRootSymbolHandle) {
					return {
						kind: 'source',
						modulePath: moduleInfo.path,
						exportPathKey: '',
						exportDepth: 0,
						moduleInfo,
					};
				}
			}
			const visibleBinding = this.resolveReferenceVisibleBinding(reference);
			if (visibleBinding && visibleBinding.moduleBinding) {
				return visibleBinding.moduleBinding;
			}
			return;
		}
		if (expression.kind !== LuaSyntaxKind.MemberExpression && expression.kind !== LuaSyntaxKind.IndexExpression) {
			return;
		}
		const isMemberExpression = expression.kind === LuaSyntaxKind.MemberExpression;
		const baseExpression = isMemberExpression
			? (expression as LuaMemberExpression).base
			: (expression as LuaIndexExpression).base;
		const baseBinding = this.resolveStaticModuleBinding(baseExpression, allowRequireRoot);
		if (!baseBinding) {
			return;
		}
		const key = isMemberExpression
			? (expression as LuaMemberExpression).member.name
			: stringLiteralValue((expression as LuaIndexExpression).index);
		if (key == null) {
			return;
		}
		const exportPathKey = appendModuleExportPathKey(baseBinding.exportPathKey, key);
		if (this.moduleBindingExportsPath(baseBinding, exportPathKey)) {
			return this.repathModuleBinding(baseBinding, exportPathKey);
		}
	}

	private repathModuleBinding(binding: ModuleBinding, exportPathKey: string): ModuleBinding {
		switch (binding.kind) {
			case 'source':
				return {
					kind: 'source',
					modulePath: binding.modulePath,
					exportPathKey,
					exportDepth: binding.exportDepth + 1,
					moduleInfo: binding.moduleInfo,
				};
			case 'installed':
				return {
					kind: 'installed',
					modulePath: binding.modulePath,
					exportPathKey,
					exportDepth: binding.exportDepth + 1,
				};
		}
	}

	private moduleBindingExportsPath(binding: ModuleBinding, exportPathKey: string): boolean {
		switch (binding.kind) {
			case 'source':
				return binding.moduleInfo.exportSlotsByPathKey.has(exportPathKey);
			case 'installed':
				return this.program.hasModuleExportPathContract(binding.modulePath, exportPathKey);
		}
	}

	private isStaticFunctionModuleBinding(binding: ModuleBinding): boolean {
		return binding.kind === 'source' && binding.moduleInfo.staticFunctionExportByPathKey.has(binding.exportPathKey);
	}

	private resolveStaticFunctionExportCallTarget(binding: ModuleBinding): ModuleFunctionTarget | undefined {
		switch (binding.kind) {
			case 'source':
				if (binding.moduleInfo.staticFunctionExportByPathKey.has(binding.exportPathKey)) {
					return {
						kind: 'export_proto',
						path: binding.modulePath,
						exportPathKey: binding.exportPathKey,
					};
				}
				return;
			case 'installed': {
				const importIndex = this.program.biosFunctionImportIndex(
					binding.modulePath,
					binding.exportPathKey,
				);
				if (importIndex === undefined) {
					return;
				}
				return {
					kind: 'bios_function',
					importIndex,
				};
			}
		}
	}

	private moduleBindingOwnsCompileTimeLocal(binding: ModuleBinding): boolean {
		if (this.resolveStaticFunctionExportCallTarget(binding)) {
			return true;
		}
		// A shaped const export without a leaf value is a namespace. Retaining its
		// path lets subsequent member reads resolve directly to the exported leaf.
		if (binding.kind === 'source'
			&& binding.moduleInfo.constModule
			&& !binding.moduleInfo.exportConstValueByPathKey.has(binding.exportPathKey)) {
			return true;
		}
		return binding.exportDepth === 0 && (binding.kind === 'installed'
			|| binding.moduleInfo.constModule
			|| binding.moduleInfo.staticFunctionExportByPathKey.has(''));
	}

	// Resolve a const module export (e.g. `assets.data_x_addr`) to its compile-time
	// constant value. Returns a wrapper so a `nil`/`false`/`0` export is distinguished
	// from "not a const export". The value is inlined at the use site.
	private resolveModuleExportConstValue(expression: LuaExpression): { binding: ModuleBinding; value: ConstExportValue } | undefined {
		const binding = this.resolveStaticModuleBinding(expression, true);
		if (binding && binding.kind === 'source' && binding.exportDepth !== 0 && binding.moduleInfo.constModule) {
			const value = binding.moduleInfo.exportConstValueByPathKey.get(binding.exportPathKey);
			if (value) {
				return { binding, value };
			}
		}
	}

	private emitLoadConstExportValue(target: number, value: ConstExportValue): void {
		switch (value.kind) {
			case 'nil':
				this.emitLoadConst(target, null);
				return;
			case 'boolean':
			case 'number':
				this.emitLoadConst(target, value.value);
				return;
			case 'string':
				this.emitLoadConst(target, value.value);
				return;
			case 'bss_addr': {
				const binding = this.program.bssBindingsBySymbolHandle.get(value.symbolHandle);
				if (binding) {
					this.emitLoadBssAddress(target, binding, 0);
					return;
				}
				throw new Error(`Static module .bss symbol '${value.symbolHandle}' was not recorded.`);
			}
			case 'data_addr': {
				const binding = this.program.dataBindingsBySymbolHandle.get(value.symbolHandle);
				if (binding) {
					this.emitLoadDataAddress(target, binding, 0);
					return;
				}
				throw new Error(`Static module .data symbol '${value.symbolHandle}' was not recorded.`);
			}
			case 'rodata_addr': {
				const binding = this.program.rodataBindingsBySymbolHandle.get(value.symbolHandle);
				if (binding) {
					this.emitLoadRodataAddress(target, binding, 0);
					return;
				}
				throw new Error(`Static module .rodata symbol '${value.symbolHandle}' was not recorded.`);
			}
			case 'link_value': {
				const index = this.program.linkValueRelocIndex(
					value.modulePath,
					value.expression,
				);
				this.emitABx(OpCode.LOADK, target, index);
				return;
			}
		}
	}

	private resolveStaticFunctionExportBinding(expression: LuaExpression): ModuleBinding | undefined {
		const binding = this.resolveStaticModuleBinding(expression, true);
		if (binding && this.resolveStaticFunctionExportCallTarget(binding)) {
			return binding;
		}
	}

	private resolveConstLocalModuleBinding(expression: LuaExpression): ModuleBinding | undefined {
		const binding = this.resolveStaticModuleBinding(expression, true);
		if (binding && this.moduleBindingOwnsCompileTimeLocal(binding)) {
			return binding;
		}
	}

	private failStaticFunctionExportRuntimeValue(symbol: string): never {
		throw new Error(`Static function export '${symbol}' is a call target, not a Lua runtime value.`);
	}

	private failConstModuleValueCall(binding: ModuleBinding): never {
		throw new Error(`Const module '${binding.modulePath}' value export '${binding.exportPathKey}' is not a call target.`);
	}

	private resolveModuleExportCallTarget(expression: LuaExpression): ModuleFunctionTarget | undefined {
		const binding = this.resolveStaticModuleBinding(expression, true);
		return binding ? this.resolveStaticFunctionExportCallTarget(binding) : undefined;
	}

	private resolveOwnStaticFunctionExportCallTarget(expression: LuaExpression): ModuleFunctionTarget | undefined {
		if (expression.kind !== LuaSyntaxKind.IdentifierExpression || this.moduleCompileInfo === undefined) {
			return undefined;
		}
		const reference = getResolvedIdentifierReference(this.semantics, expression as LuaIdentifierExpression);
		const symbolHandle = getResolvedReferenceSymbolHandle(reference);
		if (!symbolHandle) {
			return undefined;
		}
		const exportPathKey = this.moduleCompileInfo.staticFunctionExportPathBySymbolHandle.get(symbolHandle);
		if (exportPathKey === undefined) {
			return undefined;
		}
		return {
			kind: 'export_proto',
			path: this.moduleCompileInfo.path,
			exportPathKey,
		};
	}

	private resolveCallProtoIndex(expression: LuaCallExpression): number | null {
		if (expression.method !== null) {
			return null;
		}
		if (expression.callee.kind === LuaSyntaxKind.IdentifierExpression) {
			const binding = this.resolveReferenceConstClosureBinding(
				getResolvedIdentifierReference(this.semantics, expression.callee as LuaIdentifierExpression),
			);
			if (binding !== null) {
				return binding.constClosureProtoIndex;
			}
		}
		const target = this.resolveModuleExportCallTarget(expression.callee)
			?? this.resolveOwnStaticFunctionExportCallTarget(expression.callee);
		if (target !== undefined && target.kind === 'export_proto') {
			const protoIndex = this.program.exportProtoIndex(target.path, target.exportPathKey);
			if (protoIndex !== undefined) {
				return protoIndex;
			}
		}
		return null;
	}

	private failCompileTimeModuleRootRuntimeUse(modulePath: string): never {
		throw new Error(`Module '${modulePath}' root is compile-time only; access an exported field instead of using the module table as a runtime value.`);
	}

	private emitReferenceLoad(reference: LuaBoundReference, target: number): void {
		const name = this.getReferenceName(reference);
		const binding = this.resolveReferenceVisibleBinding(reference);
		if (binding && binding.moduleBinding) {
			const compileTimeModuleRoot = binding.moduleBinding;
			if (this.moduleBindingOwnsCompileTimeLocal(compileTimeModuleRoot)) {
				const functionTarget = this.resolveStaticFunctionExportCallTarget(compileTimeModuleRoot);
				if (functionTarget) {
					this.failStaticFunctionExportRuntimeValue(
						`${compileTimeModuleRoot.modulePath}:${compileTimeModuleRoot.exportPathKey}`,
					);
				}
				this.failCompileTimeModuleRootRuntimeUse(compileTimeModuleRoot.modulePath);
			}
		}
		const constBinding = this.resolveReferenceConstBinding(reference);
		if (constBinding !== null) {
			const localReg = this.resolveReferenceLocal(reference);
			// A current-function <const> local already owns an immutable register.
			// Keep that value resident; downstream RK propagation can still inline it.
			if (localReg !== null) {
				if (localReg !== target) {
					this.emitABC(OpCode.MOV, target, localReg, 0);
				}
			} else if (constBinding.constRelocValue !== null) {
				this.emitLoadConstExportValue(target, constBinding.constRelocValue);
			} else {
				this.emitLoadConst(target, constBinding.constValue);
			}
			return;
		}
		const bssBinding = this.resolveReferenceBssBinding(reference);
		if (bssBinding) {
			this.emitLoadBssAddress(target, bssBinding, 0);
			return;
		}
		const dataBinding = this.resolveReferenceDataBinding(reference);
		if (dataBinding) {
			this.emitLoadDataAddress(target, dataBinding, 0);
			return;
		}
		const rodataBinding = this.resolveReferenceRodataBinding(reference);
		if (rodataBinding) {
			this.emitLoadRodataAddress(target, rodataBinding, 0);
			return;
		}
		if (binding && binding.moduleBinding) {
			const functionTarget = this.resolveStaticFunctionExportCallTarget(binding.moduleBinding);
			if (functionTarget) {
				this.failStaticFunctionExportRuntimeValue(
					`${binding.moduleBinding.modulePath}:${binding.moduleBinding.exportPathKey}`,
				);
			}
		}
		const localReg = this.resolveReferenceLocal(reference);
		if (localReg !== null) {
			if (localReg !== target) {
				this.emitABC(OpCode.MOV, target, localReg, 0);
			}
			return;
		}
		const upvalue = this.resolveReferenceUpvalue(reference);
		if (upvalue !== null) {
			this.emitABC(OpCode.GETUP, target, upvalue, 0);
			return;
		}
		if (reference.kind === 'map') {
			throw new Error(`'${name}' is a reserved memory map. Use direct indexing syntax like ${name}[addr].`);
		}
		if (reference.kind === 'reserved_intrinsic') {
			throw new Error(`'${name}' is a reserved intrinsic.`);
		}
		if (reference.kind === 'unresolved') {
			throw new Error(`'${name}' is not defined.`);
		}
		const access = this.program.resolveGlobalAccess(name);
		this.emitABx(access.system ? OpCode.GETSYS : OpCode.GETGL, target, access.slot);
	}

	private emitModuleFunctionTargetLoad(symbol: ModuleFunctionTarget, target: number): void {
		// Compile-time function exports use a link-time symbol path that the linker
		// rewrites to CLOSURE(proto). Dynamic calls load their live table field instead.
		this.emitABx(OpCode.LOADK, target, 0, symbol);
	}

	private emitModuleSlotRelocLoad(slotName: string, target: number): void {
		const access = this.program.resolveModuleExportAccess(slotName);
		this.emitABx(access.system ? OpCode.GETSYS : OpCode.GETGL, target, access.slot);
	}

	private emitModuleExportStore(slotName: string, valueReg: number): void {
		const access = this.program.resolveModuleExportAccess(slotName);
		this.emitABx(access.system ? OpCode.SETSYS : OpCode.SETGL, valueReg, access.slot);
	}

	private emitReferenceStore(reference: LuaBoundReference, valueReg: number): void {
		const name = this.getReferenceName(reference);
		const symbolHandle = getResolvedReferenceSymbolHandle(reference);
		const localBinding = symbolHandle ? this.localBindings.get(symbolHandle) : undefined;
		if (localBinding !== undefined) {
			if (localBinding.kind === 'const') {
				throw new Error(`'${name}' is a constant local and cannot be assigned.`);
			}
			this.emitABC(OpCode.MOV, localBinding.reg, valueReg, 0);
			return;
		}
		const visibleBinding = this.resolveReferenceVisibleBinding(reference);
		if (visibleBinding !== null && visibleBinding.kind === 'const') {
			throw new Error(`'${name}' is a constant local and cannot be assigned.`);
		}
		if (this.resolveReferenceBssBinding(reference)) {
			throw new Error(`'${name}' is .bss storage; assign through a typed pointer or field.`);
		}
		if (this.resolveReferenceDataBinding(reference)) {
			throw new Error(`'${name}' is .data storage; assign through a typed pointer or field.`);
		}
		if (this.resolveReferenceRodataBinding(reference)) {
			throw new Error(`'${name}' is .rodata storage and cannot be assigned.`);
		}
		const upvalue = this.resolveReferenceUpvalue(reference);
		if (upvalue !== null) {
			this.emitABC(OpCode.SETUP, valueReg, upvalue, 0);
			return;
		}
		if (reference.kind === 'map') {
			throw new Error(`'${name}' is a reserved memory map. Use direct indexing syntax like ${name}[addr].`);
		}
		if (reference.kind === 'reserved_intrinsic') {
			throw new Error(`'${name}' is a reserved intrinsic.`);
		}
		if (reference.kind === 'unresolved') {
			throw new Error(`'${name}' is not defined.`);
		}
		const access = this.program.resolveGlobalAccess(name);
		this.emitABx(access.system ? OpCode.SETSYS : OpCode.SETGL, valueReg, access.slot);
	}

	private allocTemp(): number {
		const reg = this.tempTop;
		this.tempTop += 1;
		if (this.tempTop > this.maxStack) {
			this.maxStack = this.tempTop;
		}
		return reg;
	}

	private allocTempBlock(count: number): number {
		const base = this.tempTop;
		this.tempTop += count;
		if (this.tempTop > this.maxStack) {
			this.maxStack = this.tempTop;
		}
		return base;
	}

	private allocLocal(): number {
		const reg = this.localCount;
		this.localCount += 1;
		if (this.tempTop < this.localCount) {
			this.tempTop = this.localCount;
		}
		if (this.tempTop > this.maxStack) {
			this.maxStack = this.tempTop;
		}
		return reg;
	}

	private reserveTempRange(base: number, count: number): void {
		const end = base + count;
		if (end > this.tempTop) {
			this.tempTop = end;
		}
		if (end > this.maxStack) {
			this.maxStack = end;
		}
	}

	private ensureMaxStack(end: number): void {
		if (end > this.maxStack) {
			this.maxStack = end;
		}
	}

	private withRange(range: LuaSourceRange, fn: () => void): void {
		const previous = this.currentRange;
		this.currentRange = range;
		fn();
		this.currentRange = previous;
	}

	private staticCallTargetForbiddenLoadKReason(op: OpCode, bx: number, symbolicReloc: Instruction['symbolicReloc']): string | null {
		if (op !== OpCode.LOADK) {
			return null;
		}
		if (symbolicReloc) {
			return null;
		}
		return typeof this.program.constPool[bx] === 'string' ? 'Lua string constant' : null;
	}

	private assertStaticCallTargetCanEmit(op: OpCode, bx: number = 0, symbolicReloc?: Instruction['symbolicReloc']): void {
		if (!this.staticCallTargetScope) {
			return;
		}
		const reason = staticLaneForbiddenOpcodeReason(op) ?? this.staticCallTargetForbiddenLoadKReason(op, bx, symbolicReloc);
		if (reason !== null) {
			throw new Error(`Static function export '${this.protoId}' cannot emit forbidden static opcode ${OPCODE_NAMES[op]} (${reason}). Static function exports use numeric and boolean constants, parameters, function-local words, static calls, branches, and memory loads/stores only.`);
		}
	}

	private emitABC(op: OpCode, a: number, b: number, c: number, rkMask: number = 0): void {
		this.assertStaticCallTargetCanEmit(op);
		this.code.push({
			op,
			a,
			b,
			c,
			format: 'ABC',
			rkMask,
			target: null,
			statementRange: this.currentStatementRange,
			resumeRange: this.currentStatementRange,
		});
		this.ranges.push(this.currentRange);
	}

	private emitABCd(op: OpCode, a: number, b: number, c: number, disp: number): void {
		this.assertStaticCallTargetCanEmit(op);
		this.code.push({
			op,
			a,
			b,
			c,
			disp,
			format: 'ABC',
			rkMask: 0,
			target: null,
			statementRange: this.currentStatementRange,
			resumeRange: this.currentStatementRange,
		});
		this.ranges.push(this.currentRange);
	}

	private emitABx(op: OpCode, a: number, bx: number, symbolicReloc?: Instruction['symbolicReloc']): void {
		this.assertStaticCallTargetCanEmit(op, bx, symbolicReloc);
		this.code.push({
			op,
			a,
			b: bx,
			c: 0,
			format: 'ABx',
			rkMask: 0,
			target: null,
			symbolicReloc,
			statementRange: this.currentStatementRange,
			resumeRange: this.currentStatementRange,
		});
		this.ranges.push(this.currentRange);
	}

	private emitClosureAddressRegister(target: number, addressRegister: number): void {
		this.assertStaticCallTargetCanEmit(OpCode.CLOSURE);
		this.code.push({
			op: OpCode.CLOSURE,
			a: target,
			b: addressRegister,
			c: 0,
			format: 'ABx',
			rkMask: 0,
			target: null,
			closureAddressRegister: true,
			statementRange: this.currentStatementRange,
			resumeRange: this.currentStatementRange,
		});
		this.ranges.push(this.currentRange);
	}

	private emitAsBx(op: OpCode, a: number, sbx: number): void {
		this.assertStaticCallTargetCanEmit(op);
		const target = this.code.length + 1 + sbx;
		this.code.push({
			op,
			a,
			b: 0,
			c: 0,
			format: 'AsBx',
			rkMask: 0,
			target,
			statementRange: this.currentStatementRange,
			resumeRange: this.currentStatementRange,
		});
		this.ranges.push(this.currentRange);
	}

	private emitTableGetConst(target: number, tableReg: number, keyConst: number): void {
		const keyValue = this.program.constPool[keyConst];
		if (typeof keyValue === 'string') {
			if (keyConst <= MAX_SPECIALIZED_TABLE_OPERAND) {
				this.emitABC(OpCode.GETFIELD, target, tableReg, keyConst);
				return;
			}
			this.emitABC(OpCode.GETT, target, tableReg, this.encodeConstOperand(keyConst), RK_C);
			return;
		}
		switch (keyValue) {
			case null:
			case false:
			case true:
				break;
			default:
				if (
					Number.isInteger(keyValue)
					&& keyValue >= 1
					&& keyValue <= MAX_SPECIALIZED_TABLE_OPERAND
				) {
					this.emitABC(OpCode.GETI, target, tableReg, keyValue);
					return;
				}
		}
		this.emitABC(OpCode.GETT, target, tableReg, this.encodeConstOperand(keyConst), RK_C);
	}

	private emitTableSetConst(tableReg: number, keyConst: number, valueReg: number): void {
		const keyValue = this.program.constPool[keyConst];
		if (typeof keyValue === 'string') {
			if (keyConst <= MAX_SPECIALIZED_TABLE_OPERAND) {
				this.emitABC(OpCode.SETFIELD, tableReg, keyConst, valueReg, RK_C);
				return;
			}
			this.emitABC(OpCode.SETT, tableReg, this.encodeConstOperand(keyConst), valueReg, RK_B | RK_C);
			return;
		}
		switch (keyValue) {
			case null:
			case false:
			case true:
				break;
			default:
				if (
					Number.isInteger(keyValue)
					&& keyValue >= 1
					&& keyValue <= MAX_SPECIALIZED_TABLE_OPERAND
				) {
					this.emitABC(OpCode.SETI, tableReg, keyValue, valueReg, RK_C);
					return;
				}
		}
		this.emitABC(OpCode.SETT, tableReg, this.encodeConstOperand(keyConst), valueReg, RK_B | RK_C);
	}

	private emitSelf(target: number, baseReg: number, keyConst: number): void {
		if (keyConst <= MAX_SPECIALIZED_TABLE_OPERAND) {
			this.emitABC(OpCode.SELF, target, baseReg, keyConst);
			return;
		}
		this.emitABC(OpCode.MOV, target + 1, baseReg, 0);
		this.emitABC(OpCode.GETT, target, baseReg, this.encodeConstOperand(keyConst), RK_C);
	}

	private emitJumpPlaceholder(op: OpCode = OpCode.JMP, a: number = 0): number {
		this.assertStaticCallTargetCanEmit(op);
		const index = this.code.length;
		this.code.push({
			op,
			a,
			b: 0,
			c: 0,
			format: 'AsBx',
			rkMask: 0,
			target: null,
		});
		this.ranges.push(this.currentRange);
		return index;
	}

	private patchJump(index: number, target: number): void {
		const instr = this.code[index];
		instr.target = target;
	}

	private emitLoadNil(target: number, count = 1): void {
		if (count === 1) {
			this.emitABC(OpCode.KNIL, target, 0, 0);
			return;
		}
		this.emitABC(OpCode.LOADNIL, target, count, 0);
	}

	private emitLoadBool(target: number, value: boolean): void {
		this.emitABC(value ? OpCode.KTRUE : OpCode.KFALSE, target, 0, 0);
	}

	private emitLoadConst(target: number, value: ProgramConstant): void {
		if (value === null) {
			this.emitABC(OpCode.KNIL, target, 0, 0);
			return;
		}
		if (typeof value === 'boolean') {
			this.emitABC(value ? OpCode.KTRUE : OpCode.KFALSE, target, 0, 0);
			return;
		}
		if (typeof value === 'string') {
			this.emitABx(OpCode.LOADK, target, this.program.constIndex(value));
			return;
		}
		if (value === 0) {
			this.emitABC(OpCode.K0, target, 0, 0);
			return;
		}
		if (value === 1) {
			this.emitABC(OpCode.K1, target, 0, 0);
			return;
		}
		if (value === -1) {
			this.emitABC(OpCode.KM1, target, 0, 0);
			return;
		}
		if (isSmallSignedImmediate(value)) {
			this.emitABx(OpCode.KSMI, target, value);
			return;
		}
		const index = this.program.constIndex(value);
		this.emitABx(OpCode.LOADK, target, index);
	}

	private emitLoadBssAddress(target: number, binding: BssBinding, byteOffset: number): void {
		const index = this.program.constValueRelocIndex('bss_addr', binding.symbol, byteOffset);
		this.emitABx(OpCode.LOADK, target, index);
	}

	private emitLoadDataAddress(target: number, binding: DataBinding, byteOffset: number): void {
		const index = this.program.constValueRelocIndex('data_addr', binding.symbol, byteOffset);
		this.emitABx(OpCode.LOADK, target, index);
	}

	private emitLoadDataLmaAddress(target: number, binding: DataBinding, byteOffset: number): void {
		const index = this.program.constValueRelocIndex('data_lma_addr', binding.symbol, byteOffset);
		this.emitABx(OpCode.LOADK, target, index);
	}

	private emitLoadRodataAddress(target: number, binding: RodataBinding, byteOffset: number): void {
		const index = this.program.constValueRelocIndex('rodata_addr', binding.symbol, byteOffset);
		this.emitABx(OpCode.LOADK, target, index);
	}

	private compileExpressionWithStaticClosureProto(expression: LuaExpression, target: number, resultCount: number, protoIdHint: string | null = null): number | null {
		let closureProtoIndex: number | null = null;
		this.withRange(expression.range, () => {
			if (expression.kind === LuaSyntaxKind.FunctionExpression) {
				const protoId = buildProtoId(this.protoId, protoIdHint ?? buildAnonymousHint(expression.range));
				closureProtoIndex = compileFunctionExpression(this.program, expression as LuaFunctionExpression, this, false, protoId, this.moduleId, this.semantics, this.frontend);
				this.emitABx(OpCode.CLOSURE, target, closureProtoIndex);
				return;
			}
			if (expression.kind === LuaSyntaxKind.IdentifierExpression) {
				const binding = this.resolveReferenceConstClosureBinding(getResolvedIdentifierReference(this.semantics, expression as LuaIdentifierExpression));
				if (binding) {
					closureProtoIndex = binding.constClosureProtoIndex;
				}
			}
			this.compileExpressionInto(expression, target, resultCount, protoIdHint);
		});
		return closureProtoIndex;
	}

	private setCompileTimeValue(value: ProgramConstant): boolean {
		this.compileTimeValue = value;
		this.compileTimeHasNumberValue = false;
		this.compileTimeHasBooleanValue = false;
		this.compileTimeRelocValue = null;
		return true;
	}

	private setCompileTimeNumberValue(value: number): boolean {
		this.compileTimeValue = value;
		this.compileTimeNumberValue = value;
		this.compileTimeHasNumberValue = true;
		this.compileTimeHasBooleanValue = false;
		this.compileTimeRelocValue = null;
		return true;
	}

	private setCompileTimeBooleanValue(value: boolean): boolean {
		this.compileTimeValue = value;
		this.compileTimeHasNumberValue = false;
		this.compileTimeBooleanValue = value;
		this.compileTimeHasBooleanValue = true;
		this.compileTimeRelocValue = null;
		return true;
	}

	private setCompileTimeRelocValue(value: RelocatableConstExportValue): boolean {
		this.compileTimeValue = null;
		this.compileTimeHasNumberValue = false;
		this.compileTimeHasBooleanValue = false;
		this.compileTimeRelocValue = value;
		return true;
	}

	private setCompileTimeNumericValue(value: CompileTimeNumericValue): boolean {
		return value.kind === 'number'
			? this.setCompileTimeNumberValue(value.value)
			: this.setCompileTimeRelocValue(value);
	}

	private setCompileTimeBindingValue(binding: LocalBinding): boolean {
		this.compileTimeValue = binding.constValue;
		this.compileTimeNumberValue = binding.constNumberValue;
		this.compileTimeHasNumberValue = binding.hasConstNumberValue;
		this.compileTimeBooleanValue = binding.constBooleanValue;
		this.compileTimeHasBooleanValue = binding.hasConstBooleanValue;
		this.compileTimeRelocValue = binding.constRelocValue;
		return true;
	}

	private setCompileTimeConstExportValue(value: ConstExportValue): boolean {
		switch (value.kind) {
			case 'nil':
				return this.setCompileTimeValue(null);
			case 'boolean':
				return this.setCompileTimeBooleanValue(value.value);
			case 'number':
				return this.setCompileTimeNumberValue(value.value);
			case 'string':
				return this.setCompileTimeValue(value.value);
			case 'bss_addr':
			case 'data_addr':
			case 'rodata_addr':
			case 'link_value':
				return this.setCompileTimeRelocValue(value);
		}
	}

	private compileTimeValueIsFalsey(): boolean {
		return this.compileTimeRelocValue === null
			&& (this.compileTimeValue === null || this.compileTimeValue === false);
	}

	private evaluateCompileTimeExpression(expression: LuaExpression): boolean {
		switch (expression.kind) {
			case LuaSyntaxKind.NumericLiteralExpression:
				return this.setCompileTimeNumberValue((expression as LuaNumericLiteralExpression).value);
			case LuaSyntaxKind.StringLiteralExpression:
				return this.setCompileTimeValue((expression as LuaStringLiteralExpression).value);
			case LuaSyntaxKind.BooleanLiteralExpression:
				return this.setCompileTimeBooleanValue((expression as LuaBooleanLiteralExpression).value);
			case LuaSyntaxKind.NilLiteralExpression:
				return this.setCompileTimeValue(null);
			case LuaSyntaxKind.IdentifierExpression: {
				const binding = this.resolveReferenceConstBinding(getResolvedIdentifierReference(this.semantics, expression as LuaIdentifierExpression));
				return !!binding && this.setCompileTimeBindingValue(binding);
			}
			case LuaSyntaxKind.MemberExpression:
			case LuaSyntaxKind.IndexExpression: {
				const exported = this.resolveModuleExportConstValue(expression);
				return !!exported && this.setCompileTimeConstExportValue(exported.value);
			}
			case LuaSyntaxKind.UnaryExpression:
				return this.evaluateCompileTimeUnaryExpression(expression as LuaUnaryExpression);
			case LuaSyntaxKind.BinaryExpression:
				return this.evaluateCompileTimeBinaryExpression(expression as LuaBinaryExpression);
			case LuaSyntaxKind.SizeOfExpression:
				return this.setCompileTimeNumberValue(this.resolveStructTypeReference((expression as LuaSizeOfExpression).typeRef).size);
			case LuaSyntaxKind.OffsetOfExpression: {
				const offsetOf = expression as LuaOffsetOfExpression;
				return this.setCompileTimeNumberValue(this.resolveOffsetOf(offsetOf.typeName, offsetOf.fieldPath));
			}
			default:
				return false;
		}
	}

	private evaluateCompileTimeUnaryExpression(expression: LuaUnaryExpression): boolean {
		switch (expression.operator) {
			case LuaUnaryOperator.Negate: {
				const value = this.evaluateCompileTimeNumericValue(expression);
				return value !== undefined && this.setCompileTimeNumericValue(value);
			}
			case LuaUnaryOperator.Not:
				return this.evaluateCompileTimeExpression(expression.operand)
					&& this.setCompileTimeBooleanValue(this.compileTimeValueIsFalsey());
			case LuaUnaryOperator.Length: {
				const arrayLength = this.resolveStaticStorageArrayLength(expression.operand);
				if (arrayLength !== undefined) {
					return this.setCompileTimeNumberValue(arrayLength);
				}
				return this.evaluateCompileTimeExpression(expression.operand)
					&& typeof this.compileTimeValue === 'string'
					&& this.setCompileTimeNumberValue(utf8CodepointCount(this.compileTimeValue));
			}
			case LuaUnaryOperator.BitwiseNot: {
				const value = this.evaluateCompileTimeNumericValue(expression);
				return value !== undefined && this.setCompileTimeNumericValue(value);
			}
			case LuaUnaryOperator.StringId:
				return this.evaluateCompileTimeExpression(expression.operand) && typeof this.compileTimeValue === 'string';
			default:
				return false;
		}
	}

	private evaluateCompileTimeNumber(expression: LuaExpression): number | undefined {
		const value = this.evaluateCompileTimeNumericValue(expression);
		return value?.kind === 'number' ? value.value : undefined;
	}

	private evaluateCompileTimeNumericValue(expression: LuaExpression): CompileTimeNumericValue | undefined {
		switch (expression.kind) {
			case LuaSyntaxKind.NumericLiteralExpression:
				return { kind: 'number', value: (expression as LuaNumericLiteralExpression).value };
			case LuaSyntaxKind.IdentifierExpression: {
				const binding = this.resolveReferenceConstBinding(getResolvedIdentifierReference(this.semantics, expression as LuaIdentifierExpression));
				if (binding && binding.hasConstNumberValue) {
					return { kind: 'number', value: binding.constNumberValue };
				}
				if (binding?.constRelocValue?.kind === 'link_value') {
					return binding.constRelocValue;
				}
				return;
			}
			case LuaSyntaxKind.MemberExpression:
			case LuaSyntaxKind.IndexExpression: {
				const exported = this.resolveModuleExportConstValue(expression);
				if (exported?.value.kind === 'number') {
					return { kind: 'number', value: exported.value.value };
				}
				return exported?.value.kind === 'link_value' ? exported.value : undefined;
			}
			case LuaSyntaxKind.UnaryExpression: {
				const unary = expression as LuaUnaryExpression;
				switch (unary.operator) {
					case LuaUnaryOperator.Negate: {
						const operand = this.evaluateCompileTimeNumericValue(unary.operand);
						if (operand === undefined) return;
						return operand.kind === 'number'
							? { kind: 'number', value: -operand.value }
							: {
								kind: 'link_value',
								modulePath: operand.modulePath,
								expression: {
									kind: 'unary',
									operator: unary.operator,
									operand: operand.expression,
								},
							};
					}
					case LuaUnaryOperator.BitwiseNot: {
						const operand = this.evaluateCompileTimeNumericValue(unary.operand);
						if (operand === undefined) return;
						return operand.kind === 'number'
							? { kind: 'number', value: ~operand.value }
							: {
								kind: 'link_value',
								modulePath: operand.modulePath,
								expression: {
									kind: 'unary',
									operator: unary.operator,
									operand: operand.expression,
								},
							};
					}
					case LuaUnaryOperator.Length: {
						const arrayLength = this.resolveStaticStorageArrayLength(unary.operand);
						if (arrayLength !== undefined) {
							return { kind: 'number', value: arrayLength };
						}
						if (this.evaluateCompileTimeExpression(unary.operand) && typeof this.compileTimeValue === 'string') {
							return { kind: 'number', value: utf8CodepointCount(this.compileTimeValue) };
						}
						return;
					}
					default:
						return;
				}
			}
			case LuaSyntaxKind.BinaryExpression:
				return this.evaluateCompileTimeNumericBinaryExpression(expression as LuaBinaryExpression);
			case LuaSyntaxKind.SizeOfExpression:
				return { kind: 'number', value: this.resolveStructTypeReference((expression as LuaSizeOfExpression).typeRef).size };
			case LuaSyntaxKind.OffsetOfExpression: {
				const offsetOf = expression as LuaOffsetOfExpression;
				return { kind: 'number', value: this.resolveOffsetOf(offsetOf.typeName, offsetOf.fieldPath) };
			}
			default:
				return;
		}
	}

	private evaluateCompileTimeNumericBinaryExpression(expression: LuaBinaryExpression): CompileTimeNumericValue | undefined {
		const left = this.evaluateCompileTimeNumericValue(expression.left);
		const right = this.evaluateCompileTimeNumericValue(expression.right);
		if (left === undefined || right === undefined) return;
		if (left.kind === 'number' && right.kind === 'number') {
			const value = evaluateCompileTimeNumberBinaryOperator(expression.operator, left.value, right.value);
			return value === undefined ? undefined : { kind: 'number', value };
		}
		let modulePath: string;
		if (left.kind === 'link_value') {
			modulePath = left.modulePath;
		} else if (right.kind === 'link_value') {
			modulePath = right.modulePath;
		} else {
			return;
		}
		if ((left.kind === 'link_value' && left.modulePath !== modulePath)
			|| (right.kind === 'link_value' && right.modulePath !== modulePath)) {
			return;
		}
		const operator = resolveCompileTimeNumberBinaryOperator(expression.operator);
		if (operator === undefined) {
			return;
		}
		return {
			kind: 'link_value',
			modulePath,
			expression: {
				kind: 'binary',
				operator,
				left: left.kind === 'number'
					? { kind: 'number', value: left.value }
					: left.expression,
				right: right.kind === 'number'
					? { kind: 'number', value: right.value }
					: right.expression,
			},
		};
	}

	private evaluateCompileTimeNumberBinaryInto(expression: LuaBinaryExpression): boolean {
		const value = this.evaluateCompileTimeNumericBinaryExpression(expression);
		return value !== undefined && this.setCompileTimeNumericValue(value);
	}

	private evaluateCompileTimeRelationalInto(expression: LuaBinaryExpression): boolean {
		const value = this.evaluateCompileTimeRelational(expression);
		return (value || value === false) && this.setCompileTimeBooleanValue(value);
	}

	private evaluateCompileTimeNumberOrStringRelational(operator: LuaBinaryOperator, left: number | string, right: number | string): boolean | undefined {
		switch (operator) {
			case LuaBinaryOperator.LessThan:
				return left < right;
			case LuaBinaryOperator.LessEqual:
				return left <= right;
			case LuaBinaryOperator.GreaterThan:
				return left > right;
			case LuaBinaryOperator.GreaterEqual:
				return left >= right;
			default:
				return;
		}
	}

	private evaluateCompileTimeBinaryExpression(expression: LuaBinaryExpression): boolean {
		switch (expression.operator) {
			case LuaBinaryOperator.And:
				return this.evaluateCompileTimeExpression(expression.left)
					&& (this.compileTimeValueIsFalsey() || this.evaluateCompileTimeExpression(expression.right));
			case LuaBinaryOperator.Or:
				return this.evaluateCompileTimeExpression(expression.left)
					&& (!this.compileTimeValueIsFalsey() || this.evaluateCompileTimeExpression(expression.right));
			case LuaBinaryOperator.Equal: {
				const equal = this.evaluateCompileTimeEquality(expression.left, expression.right);
				return (equal || equal === false) && this.setCompileTimeBooleanValue(equal);
			}
			case LuaBinaryOperator.NotEqual: {
				const equal = this.evaluateCompileTimeEquality(expression.left, expression.right);
				return (equal || equal === false) && this.setCompileTimeBooleanValue(!equal);
			}
			case LuaBinaryOperator.LessThan:
			case LuaBinaryOperator.LessEqual:
			case LuaBinaryOperator.GreaterThan:
			case LuaBinaryOperator.GreaterEqual:
				return this.evaluateCompileTimeRelationalInto(expression);
			case LuaBinaryOperator.BitwiseOr:
			case LuaBinaryOperator.BitwiseXor:
			case LuaBinaryOperator.BitwiseAnd:
			case LuaBinaryOperator.ShiftLeft:
			case LuaBinaryOperator.ShiftRight:
			case LuaBinaryOperator.Add:
			case LuaBinaryOperator.Subtract:
			case LuaBinaryOperator.Multiply:
			case LuaBinaryOperator.Divide:
			case LuaBinaryOperator.FloorDivide:
			case LuaBinaryOperator.Modulus:
			case LuaBinaryOperator.Exponent:
				return this.evaluateCompileTimeNumberBinaryInto(expression);
			case LuaBinaryOperator.Concat:
				return this.evaluateCompileTimeConcat(expression.left, expression.right);
			default:
				return false;
		}
	}

	private evaluateCompileTimeConcat(leftExpression: LuaExpression, rightExpression: LuaExpression): boolean {
		if (!this.evaluateCompileTimeExpression(leftExpression)) return false;
		const left = this.compileTimeValue;
		const leftNumber = this.compileTimeNumberValue;
		const leftHasNumber = this.compileTimeHasNumberValue;
		let leftText: string;
		if (leftHasNumber) {
			leftText = String(leftNumber);
		} else if (typeof left === 'string') {
			leftText = left;
		} else {
			return false;
		}
		if (!this.evaluateCompileTimeExpression(rightExpression)) return false;
		let rightText: string;
		if (this.compileTimeHasNumberValue) {
			rightText = String(this.compileTimeNumberValue);
		} else if (typeof this.compileTimeValue === 'string') {
			rightText = this.compileTimeValue;
		} else {
			return false;
		}
		return this.setCompileTimeValue(leftText + rightText);
	}

	private evaluateCompileTimeEquality(leftExpression: LuaExpression, rightExpression: LuaExpression): boolean | undefined {
		if (!this.evaluateCompileTimeExpression(leftExpression)) return;
		const left = this.compileTimeValue;
		const leftNumber = this.compileTimeNumberValue;
		const leftHasNumber = this.compileTimeHasNumberValue;
		const leftBoolean = this.compileTimeBooleanValue;
		const leftHasBoolean = this.compileTimeHasBooleanValue;
		const leftReloc = this.compileTimeRelocValue;
		if (!this.evaluateCompileTimeExpression(rightExpression)) return;
		if (leftReloc !== null || this.compileTimeRelocValue !== null) {
			return;
		}
		if (leftHasNumber) {
			return this.compileTimeHasNumberValue && leftNumber === this.compileTimeNumberValue;
		}
		if (typeof left === 'string') {
			return typeof this.compileTimeValue === 'string' && left === this.compileTimeValue;
		}
		if (leftHasBoolean) {
			return this.compileTimeHasBooleanValue && leftBoolean === this.compileTimeBooleanValue;
		}
		return left === this.compileTimeValue;
	}

	private evaluateCompileTimeRelational(expression: LuaBinaryExpression): boolean | undefined {
		if (!this.evaluateCompileTimeExpression(expression.left)) return;
		const left = this.compileTimeValue;
		const leftNumber = this.compileTimeNumberValue;
		const leftHasNumber = this.compileTimeHasNumberValue;
		if (!this.evaluateCompileTimeExpression(expression.right)) return;
		if (leftHasNumber && this.compileTimeHasNumberValue) {
			return this.evaluateCompileTimeNumberOrStringRelational(expression.operator, leftNumber, this.compileTimeNumberValue);
		}
		if (typeof left === 'string' && typeof this.compileTimeValue === 'string') {
			return this.evaluateCompileTimeNumberOrStringRelational(
				expression.operator,
				left,
				this.compileTimeValue,
			);
		}
	}

	private compileStatement(statement: LuaStatement): void {
		if (this.flowAnalysis) {
			this.currentFlowState = this.flowAnalysis.getFlowStateAt(statement);
		}
		const previousStatementRange = this.currentStatementRange;
		this.currentStatementRange = statement.range;
		this.withRange(statement.range, () => {
			switch (statement.kind) {
				case LuaSyntaxKind.LocalAssignmentStatement:
					this.compileLocalAssignment(statement as LuaLocalAssignmentStatement);
					return;
				case LuaSyntaxKind.AssignmentStatement:
					this.compileAssignment(statement as LuaAssignmentStatement);
					return;
				case LuaSyntaxKind.CallStatement:
					this.compileCallStatement(statement.expression);
					return;
				case LuaSyntaxKind.ReturnStatement:
					this.compileReturn(statement.expressions);
					return;
				case LuaSyntaxKind.IfStatement:
					this.compileIf(statement as LuaIfStatement);
					return;
				case LuaSyntaxKind.WhileStatement:
					this.compileWhile(statement as LuaWhileStatement);
					return;
				case LuaSyntaxKind.RepeatStatement:
					this.compileRepeat(statement);
					return;
				case LuaSyntaxKind.ForNumericStatement:
					this.compileForNumeric(statement);
					return;
				case LuaSyntaxKind.ForGenericStatement:
					this.compileForGeneric(statement as LuaForGenericStatement);
					return;
				case LuaSyntaxKind.DoStatement:
					this.pushScope(statement.block.range);
					for (let i = 0; i < statement.block.body.length; i += 1) {
						this.compileStatement(statement.block.body[i]);
						this.resetTemps();
					}
					this.popScope();
					return;
				case LuaSyntaxKind.HaltUntilIrqStatement:
					this.emitABC(OpCode.HALT, 0, 0, 0);
					return;
				case LuaSyntaxKind.BreakStatement:
					this.compileBreak();
					return;
				case LuaSyntaxKind.LocalFunctionStatement:
					this.compileLocalFunction(statement);
					return;
				case LuaSyntaxKind.FunctionDeclarationStatement:
					this.compileFunctionDeclaration(statement);
					return;
				case LuaSyntaxKind.GotoStatement:
					this.compileGoto(statement as LuaGotoStatement);
					return;
				case LuaSyntaxKind.LabelStatement:
					this.compileLabel(statement as LuaLabelStatement);
					return;
				case LuaSyntaxKind.StructDeclarationStatement:
					return;
				case LuaSyntaxKind.BssDeclarationStatement:
					this.compileBssDeclaration(statement as LuaBssDeclarationStatement);
					return;
				case LuaSyntaxKind.DataDeclarationStatement:
					this.compileDataDeclaration(statement as LuaDataDeclarationStatement);
					return;
				case LuaSyntaxKind.RodataDeclarationStatement:
					this.compileRodataDeclaration(statement as LuaRodataDeclarationStatement);
					return;
				default:
					throw new Error(`Unsupported statement kind: ${(statement as LuaStatement).kind}`);
			}
		});
		this.currentStatementRange = previousStatementRange;
	}

	private compileBssDeclaration(statement: LuaBssDeclarationStatement): void {
		this.recordBssDeclaration(statement, this.requireBoundDeclaration(statement.name.range, `bss '${statement.name.name}'`));
	}

	private recordBssDeclaration(statement: LuaBssDeclarationStatement, declaration: Decl): void {
		const type = this.resolveStructTypeReference(statement.typeRef);
		this.program.recordBss(declaration.id, this.moduleId, statement.name.name, type);
	}

	private compileDataDeclaration(statement: LuaDataDeclarationStatement): void {
		this.recordDataDeclaration(statement, this.requireBoundDeclaration(statement.name.range, `data '${statement.name.name}'`));
	}

	private recordDataDeclaration(statement: LuaDataDeclarationStatement, declaration: Decl): void {
		const type = this.resolveInitializedStorageType(statement.typeRef, statement.initializer, '.data');
		const initializer = this.encodeStorageInitializer(type, statement.initializer, '.data');
		this.program.recordData(declaration.id, this.moduleId, statement.name.name, type, initializer.bytes);
	}

	private compileRodataDeclaration(statement: LuaRodataDeclarationStatement): void {
		this.recordRodataDeclaration(statement, this.requireBoundDeclaration(statement.name.range, `rodata '${statement.name.name}'`));
	}

	private recordRodataDeclaration(statement: LuaRodataDeclarationStatement, declaration: Decl): void {
		const type = this.resolveInitializedStorageType(statement.typeRef, statement.initializer, '.rodata');
		this.program.recordRodata(declaration.id, this.moduleId, statement.name.name, type, this.encodeStorageInitializer(type, statement.initializer, '.rodata'));
	}

	private resolveInitializedStorageType(typeRef: LuaTypeReference, initializer: LuaExpression, sectionName: '.data' | '.rodata'): StructResolvedType {
		if (typeRef.arrayLengths.length === 0 || typeRef.arrayLengths[0]) {
			return this.resolveStructTypeReference(typeRef);
		}
		if (initializer.kind !== LuaSyntaxKind.TableConstructorExpression) {
			throw new Error(`${sectionName} inferred array storage requires a table initializer.`);
		}
		const elementCount = (initializer as LuaTableConstructorExpression).fields.length;
		if (elementCount === 0) {
			throw new Error(`${sectionName} inferred array storage requires at least one element.`);
		}
		return this.resolveStructTypeReference(typeRef, new Set(), elementCount);
	}

	private encodeStorageInitializer(type: StructResolvedType, expression: LuaExpression, sectionName: '.data' | '.rodata'): StaticStorageInitializer {
		const bytes = new Uint8Array(type.size);
		const rodataConstRelocs: ProgramRodataConstReloc[] = [];
		this.writeStorageInitializer(bytes, rodataConstRelocs, 0, type, expression, sectionName);
		return { bytes, rodataConstRelocs };
	}

	private writeStorageInitializer(out: Uint8Array, rodataConstRelocs: ProgramRodataConstReloc[], byteOffset: number, type: StructResolvedType, expression: LuaExpression, sectionName: '.data' | '.rodata'): void {
		if (type.dimensions.length !== 0) {
			if (expression.kind !== LuaSyntaxKind.TableConstructorExpression) {
				throw new Error(`${sectionName} array '${type.name}' requires a table initializer.`);
			}
			const table = expression as LuaTableConstructorExpression;
			const elementType = this.typeAfterStructIndex(type);
			let elementIndex = 0;
			for (let index = 0; index < table.fields.length; index += 1) {
				const field = table.fields[index];
				if (field.kind !== LuaTableFieldKind.Array) {
					throw new Error(`${sectionName} arrays use positional initializers.`);
				}
				this.writeStorageInitializer(out, rodataConstRelocs, byteOffset + elementIndex * elementType.size, elementType, field.value, sectionName);
				elementIndex += 1;
			}
			if (elementIndex !== type.dimensions[0]) {
				throw new Error(`${sectionName} array '${type.name}' expects ${type.dimensions[0]} elements.`);
			}
			return;
		}
		if (type.struct) {
			if (expression.kind !== LuaSyntaxKind.TableConstructorExpression) {
				throw new Error(`${sectionName} struct '${type.name}' requires a named-field initializer.`);
			}
			const table = expression as LuaTableConstructorExpression;
			const initializedFields = new Set<string>();
			for (let index = 0; index < table.fields.length; index += 1) {
				const initializerField = table.fields[index];
				if (initializerField.kind !== LuaTableFieldKind.IdentifierKey) {
					throw new Error(`${sectionName} struct '${type.name}' uses named-field initializers.`);
				}
				const field = type.struct.fields.get(initializerField.name);
				if (!field) {
					throw new Error(`${sectionName} initializer has no field '${initializerField.name}' in struct '${type.name}'.`);
				}
				if (initializedFields.has(initializerField.name)) {
					throw new Error(`${sectionName} initializer repeats field '${initializerField.name}' in struct '${type.name}'.`);
				}
				initializedFields.add(initializerField.name);
				this.writeStorageInitializer(out, rodataConstRelocs, byteOffset + field.offset, field.type, initializerField.value, sectionName);
			}
			for (const field of type.struct.fields.values()) {
				if (!initializedFields.has(field.name)) {
					throw new Error(`${sectionName} initializer is missing field '${field.name}' in struct '${type.name}'.`);
				}
			}
			return;
		}
		if (!type.access) {
			throw new Error(`${sectionName} initializer reached a non-scalar '${type.name}'.`);
		}
		if (type.access.kind === 'const_pool') {
			if (sectionName !== '.rodata') {
				throw new Error(`Static string fields are only valid in .rodata storage.`);
			}
			if (!this.evaluateCompileTimeExpression(expression) || typeof this.compileTimeValue !== 'string') {
				throw new Error('.rodata string initializer must be a compile-time string.');
			}
			const constIndex = this.program.constIndex(this.compileTimeValue);
			writeLE32(out, byteOffset, constIndex);
			rodataConstRelocs.push({ byteOffset, constIndex });
			return;
		}
		const value = this.evaluateCompileTimeNumber(expression);
		if (value === undefined || !Number.isInteger(value)) {
			throw new Error(`${sectionName} primitive initializer must be a compile-time integer.`);
		}
		const word = value;
		switch (type.access.memoryKind) {
			case MemoryAccessKind.U8:
				out[byteOffset] = word & 0xff;
				return;
			case MemoryAccessKind.U16LE:
				writeLE16(out, byteOffset, word);
				return;
			case MemoryAccessKind.U32LE:
			case MemoryAccessKind.Word:
				writeLE32(out, byteOffset, word);
				return;
			default:
				throw new Error(`${sectionName} v1 does not support '${type.name}' initializers.`);
		}
	}

	private compileLocalAssignment(statement: LuaLocalAssignmentStatement): void {
		const tempsBase = this.tempTop;
		const names = statement.names;
		const attributes = statement.attributes;
		const pointerTypeRefs = statement.pointerTypeRefs;
		const values = statement.values;
		if (isRecursiveConstClosureDeclaration(statement)) {
			const decl = this.requireBoundDeclaration(names[0].range, `local '${names[0].name}'`);
			const name = decl.name;
			const target = this.declareLocalFromDecl(decl, names[0].range);
			const hint = this.createLocalFunctionHint(name);
			const closureProtoIndex = this.compileExpressionWithStaticClosureProto(values[0], target, 1, hint);
			(this.localBindings.get(decl.id) as LocalBinding).constClosureProtoIndex = closureProtoIndex;
			if (closureProtoIndex || closureProtoIndex === 0) {
				this.program.markStaticClosureProto(closureProtoIndex);
			}
			this.tempTop = Math.max(this.tempTop, tempsBase);
			return;
		}
		this.resetInitializerScratch(names.length);
		if (values.length > 0) {
			const lastIndex = values.length - 1;
			for (let i = 0; i < lastIndex; i += 1) {
				const expr = values[i];
				if (i < names.length && attributes[i] === 'const') {
					const moduleBinding = this.resolveConstLocalModuleBinding(expr);
					if (moduleBinding) {
						this.initializerFlags[i] |= INIT_HAS_MODULE_BINDING;
						this.initializerModuleBindings[i] = moduleBinding;
						if (this.moduleBindingOwnsCompileTimeLocal(moduleBinding)) {
							continue;
						}
					}
				}
				if (this.evaluateCompileTimeExpression(expr)) {
					if (i < names.length) {
						this.recordCompileTimeInitializer(i);
					}
					continue;
				}
				const reg = this.allocTemp();
				const name = i < names.length
					? this.requireBoundDeclaration(names[i].range, `local '${names[i].name}'`).name
					: '';
				const hint = expr.kind === LuaSyntaxKind.FunctionExpression && i < names.length
					? this.createLocalFunctionHint(name)
					: null;
				const closureProtoIndex = this.compileExpressionWithStaticClosureProto(expr, reg, 1, hint);
				if (i < names.length) {
					this.initializerFlags[i] |= INIT_HAS_VALUE_REG;
					this.initializerValueRegs[i] = reg;
					if (attributes[i] === 'const' && (closureProtoIndex || closureProtoIndex === 0)) {
						this.initializerFlags[i] |= INIT_HAS_CLOSURE_PROTO;
						this.initializerClosureProtoIndices[i] = closureProtoIndex;
						this.program.markStaticClosureProto(closureProtoIndex);
					}
				}
			}
			const lastExpr = values[lastIndex];
			const remaining = names.length - lastIndex;
			const wantsMulti = remaining > 1 && this.isMultiReturnExpression(lastExpr);
			const lastHasName = lastIndex < names.length;
			let compileLastInitializerExpression = true;
			if (lastHasName && attributes[lastIndex] === 'const' && !wantsMulti) {
				const moduleBinding = this.resolveConstLocalModuleBinding(lastExpr);
				if (moduleBinding) {
					this.initializerFlags[lastIndex] |= INIT_HAS_MODULE_BINDING;
					this.initializerModuleBindings[lastIndex] = moduleBinding;
					compileLastInitializerExpression = !this.moduleBindingOwnsCompileTimeLocal(moduleBinding);
				}
			}
			if (compileLastInitializerExpression) {
				if (this.evaluateCompileTimeExpression(lastExpr) && !wantsMulti) {
					if (lastHasName) {
						this.recordCompileTimeInitializer(lastIndex);
					}
				} else {
					const lastReg = this.allocTemp();
					const lastName = lastHasName
						? this.requireBoundDeclaration(names[lastIndex].range, `local '${names[lastIndex].name}'`).name
						: '';
					const resultCount = wantsMulti ? remaining : 1;
					const lastHint = lastExpr.kind === LuaSyntaxKind.FunctionExpression && lastHasName
						? this.createLocalFunctionHint(lastName)
						: null;
					const closureProtoIndex = this.compileExpressionWithStaticClosureProto(lastExpr, lastReg, resultCount, lastHint);
					if (lastHasName) {
						this.initializerFlags[lastIndex] |= INIT_HAS_VALUE_REG;
						this.initializerValueRegs[lastIndex] = lastReg;
						if (attributes[lastIndex] === 'const' && (closureProtoIndex || closureProtoIndex === 0)) {
							this.initializerFlags[lastIndex] |= INIT_HAS_CLOSURE_PROTO;
							this.initializerClosureProtoIndices[lastIndex] = closureProtoIndex;
							this.program.markStaticClosureProto(closureProtoIndex);
						}
					}
					if (wantsMulti) {
						this.reserveTempRange(lastReg, remaining);
						for (let i = 1; i < remaining && lastIndex + i < names.length; i += 1) {
							this.initializerFlags[lastIndex + i] |= INIT_HAS_VALUE_REG;
							this.initializerValueRegs[lastIndex + i] = lastReg + i;
						}
					}
				}
			}
		}
		for (let i = 0; i < names.length; i += 1) {
			const decl = this.requireBoundDeclaration(names[i].range, `local '${names[i].name}'`);
			const name = decl.name;
			const attribute = attributes[i];
			const lastIndex = values.length - 1;
			const hasInitializer = values.length > 0 && (i < lastIndex || i === lastIndex || (i > lastIndex && this.isMultiReturnExpression(values[lastIndex])));
			if (attribute === 'const' && !hasInitializer) {
				throw new Error(`Constant local '${name}' must have an initializer.`);
			}
			const flags = this.initializerFlags[i];
			const hasInitializerValue = flags & INIT_HAS_VALUE;
			let initializerClosureProtoIndex: number | null = null;
			let initializerModuleBinding: ModuleBinding | null = null;
			if (attribute === 'const') {
				if (flags & INIT_HAS_CLOSURE_PROTO) {
					initializerClosureProtoIndex = this.initializerClosureProtoIndices[i];
				}
				if (flags & INIT_HAS_MODULE_BINDING) {
					initializerModuleBinding = this.initializerModuleBindings[i];
				}
			}
			let constValue: ProgramConstant | null = null;
			let initializerNumberValue = 0;
			let initializerHasNumberValue = false;
			let initializerBooleanValue = false;
			let initializerHasBooleanValue = false;
			let initializerRelocValue: RelocatableConstExportValue | null = null;
			if (hasInitializerValue) {
				constValue = this.initializerValues[i];
				initializerNumberValue = this.initializerNumberValues[i];
				initializerHasNumberValue = !!(flags & INIT_HAS_NUMBER);
				initializerBooleanValue = this.initializerBooleanValues[i];
				initializerHasBooleanValue = !!(flags & INIT_HAS_BOOLEAN);
				initializerRelocValue = this.initializerRelocValues[i];
			}
			const target = this.declareLocal(
				decl.id,
				decl.name,
				names[i].range,
				undefined,
				attribute === 'const' ? 'const' : 'local',
				constValue,
				!!hasInitializerValue && attribute === 'const',
				initializerClosureProtoIndex,
				initializerModuleBinding,
				initializerNumberValue,
				initializerHasNumberValue,
				initializerBooleanValue,
				initializerHasBooleanValue,
				attribute === 'const' ? initializerRelocValue : null,
			);
			const pointerTypeRef = pointerTypeRefs[i];
			if (pointerTypeRef) {
				(this.localBindings.get(decl.id) as LocalBinding).structView = {
					type: this.resolveStructTypeReference(pointerTypeRef),
				};
			}
			if (hasInitializerValue) {
				if (initializerRelocValue !== null) {
					this.emitLoadConstExportValue(target, initializerRelocValue);
				} else {
					this.emitLoadConst(target, this.initializerValues[i]);
				}
				continue;
			}
			if (initializerModuleBinding && this.moduleBindingOwnsCompileTimeLocal(initializerModuleBinding)) {
				continue;
			}
			if (flags & INIT_HAS_VALUE_REG) {
				const valueReg = this.initializerValueRegs[i];
				if (valueReg !== target) {
					this.emitABC(OpCode.MOV, target, valueReg, 0);
				}
			} else {
				this.emitLoadNil(target, 1);
			}
		}
		this.tempTop = Math.max(this.tempTop, tempsBase);
	}

	private compileAssignment(statement: LuaAssignmentStatement): void {
		const targets = this.compileAssignmentTargets(statement.left);
		const targetPaths: Array<string[] | null> = new Array(statement.left.length);
		for (let index = 0; index < statement.left.length; index += 1) {
			targetPaths[index] = extractAssignmentPath(statement.left[index] as LuaAssignableExpression);
		}
		const values = this.compileAssignmentValues(statement.right, targets.length, targetPaths);
		for (let i = 0; i < targets.length; i += 1) {
			const target = targets[i];
			const valueReg = values[i] ?? this.emitNilTemp();
			if (statement.operator !== LuaAssignmentOperator.Assign) {
				this.applyCompoundAssignment(target, statement.operator, valueReg);
				continue;
			}
			this.assignTarget(target, valueReg);
		}
	}

	private compileAssignmentTargets(expressions: ReadonlyArray<LuaExpression>): AssignmentTarget[] {
		const targets: AssignmentTarget[] = [];
		for (let i = 0; i < expressions.length; i += 1) {
			const expr = expressions[i] as LuaAssignableExpression;
			if (expr.kind === LuaSyntaxKind.MemberExpression) {
				const cop0Register = this.resolveCop0Register(expr as LuaMemberExpression);
				if (cop0Register) {
					if (cop0Register !== COP0_STATUS && cop0Register !== COP0_EPC && cop0Register !== COP0_EXEC) {
						throw new Error(`cop0.${(expr as LuaMemberExpression).member.name} is read-only.`);
					}
					targets.push({ kind: 'cop0', register: cop0Register });
					continue;
				}
			}
			if (
				expr.kind === LuaSyntaxKind.MemberExpression ||
				expr.kind === LuaSyntaxKind.IndexExpression ||
				(expr.kind === LuaSyntaxKind.UnaryExpression && (expr as LuaUnaryExpression).operator === LuaUnaryOperator.Dereference)
			) {
				const structAddress = this.resolveStructAddress(expr);
				if (structAddress) {
					if (structAddress.readOnly) {
						throw new Error('Cannot assign to .rodata storage.');
					}
					if (!structAddress.type.access) {
						throw new Error(`Whole-struct assignment is not supported for '${structAddress.type.name}'; assign scalar fields directly.`);
					}
					if (structAddress.type.access.kind === 'const_pool') {
						throw new Error('Static string references are immutable.');
					}
					targets.push({
						kind: 'memory',
						accessKind: structAddress.type.access.memoryKind,
						addrReg: structAddress.baseReg,
						addrOffsetBytes: structAddress.byteOffset,
					});
					continue;
				}
				if (expr.kind === LuaSyntaxKind.UnaryExpression) {
					throw new LuaSyntaxError(
						'Pointer dereference assignment requires a typed pointer.',
						expr.range.path,
						expr.range.start.line,
						expr.range.start.column,
					);
				}
			}
			const targetPreparation = classifyAssignmentTargetPreparation(this.semantics, expr);
			if (targetPreparation.kind === 'identifier') {
				const identifier = expr as LuaIdentifierExpression;
				const reference = getResolvedIdentifierReference(this.semantics, identifier, true);
				const symbolHandle = getResolvedReferenceSymbolHandle(reference);
				const name = this.getReferenceName(reference);
				const localBinding = symbolHandle ? this.localBindings.get(symbolHandle) : undefined;
				if (localBinding !== undefined) {
					if (localBinding.kind === 'const') {
						throw new Error(`'${name}' is a constant local and cannot be assigned.`);
					}
					targets.push({ kind: 'local', reg: localBinding.reg });
					continue;
				}
				const visibleBinding = this.resolveReferenceVisibleBinding(reference);
				if (visibleBinding !== null && visibleBinding.kind === 'const') {
					throw new Error(`'${name}' is a constant local and cannot be assigned.`);
				}
				if (this.resolveReferenceBssBinding(reference)) {
					throw new Error(`'${name}' is .bss storage; assign through a typed pointer or field.`);
				}
				const upvalue = this.resolveReferenceUpvalue(reference);
				if (upvalue !== null) {
					targets.push({ kind: 'upvalue', upvalue });
					continue;
				}
				if (reference.kind === 'map') {
					throw new Error(`'${name}' is a reserved memory map. Use direct indexing syntax like ${name}[addr].`);
				}
				if (reference.kind === 'reserved_intrinsic') {
					throw new Error(`'${name}' is a reserved intrinsic.`);
				}
				if (reference.kind === 'unresolved') {
					throw new Error(`'${name}' is not defined.`);
				}
				const access = this.program.resolveGlobalAccess(name);
				targets.push({ kind: 'global', slot: access.slot, system: access.system });
				continue;
			}
			if (targetPreparation.kind === 'member') {
				const member = expr as LuaMemberExpression;
				const baseReg = this.allocTemp();
				this.compileExpressionInto(targetPreparation.base, baseReg, 1);
				const keyConst = this.program.constIndex(member.member.name);
				targets.push({ kind: 'table', tableReg: baseReg, keyConst });
				continue;
			}
			if (targetPreparation.kind === 'memory') {
				targets.push(this.compileMemoryTarget(targetPreparation));
				continue;
			}
			if (targetPreparation.kind === 'index') {
				const baseReg = this.allocTemp();
				this.compileExpressionInto(targetPreparation.base, baseReg, 1);
				const keyConst = this.getConstIndex(targetPreparation.index);
				if (keyConst !== undefined) {
					targets.push({ kind: 'table', tableReg: baseReg, keyConst });
					continue;
				}
				const keyReg = this.allocTemp();
				this.compileExpressionInto(targetPreparation.index, keyReg, 1);
				targets.push({ kind: 'table', tableReg: baseReg, keyReg });
				continue;
			}
			throw new Error(`Unsupported assignment target: ${expr.kind}`);
		}
		return targets;
	}

	private compileAssignmentValues(expressions: ReadonlyArray<LuaExpression>, targetCount: number, targetPaths: ReadonlyArray<ReadonlyArray<string> | null>): number[] {
		const values: number[] = [];
		if (expressions.length === 0) {
			return values;
		}
		const lastIndex = expressions.length - 1;
		for (let i = 0; i < lastIndex; i += 1) {
			const expr = expressions[i];
			const path = targetPaths[i];
			const hint = expr.kind === LuaSyntaxKind.FunctionExpression && path ? buildAssignmentHint(path) : null;
			const reg = this.allocTemp();
			this.compileExpressionInto(expr, reg, 1, hint);
			values.push(reg);
		}
		const remaining = targetCount - lastIndex;
		const lastExpr = expressions[lastIndex];
		const baseReg = this.allocTemp();
		const wantsMulti = remaining > 1 && this.isMultiReturnExpression(lastExpr);
		const resultCount = wantsMulti ? remaining : 1;
		const lastPath = targetPaths[lastIndex];
		const lastHint = lastExpr.kind === LuaSyntaxKind.FunctionExpression && lastPath ? buildAssignmentHint(lastPath) : null;
		this.compileExpressionInto(lastExpr, baseReg, resultCount, lastHint);
		values.push(baseReg);
		if (wantsMulti) {
			this.reserveTempRange(baseReg, remaining);
			for (let i = 1; i < remaining; i += 1) {
				values.push(baseReg + i);
			}
		}
		return values;
	}

	private assignTarget(target: AssignmentTarget, valueReg: number): void {
		switch (target.kind) {
			case 'local':
				this.emitABC(OpCode.MOV, target.reg, valueReg, 0);
				return;
			case 'upvalue':
				this.emitABC(OpCode.SETUP, valueReg, target.upvalue, 0);
				return;
			case 'global':
				this.emitABx(target.system ? OpCode.SETSYS : OpCode.SETGL, valueReg, target.slot);
				return;
			case 'table': {
				if (target.keyConst !== undefined) {
					this.emitTableSetConst(target.tableReg, target.keyConst, valueReg);
					return;
				}
				this.emitABC(OpCode.SETT, target.tableReg, target.keyReg, valueReg, RK_B | RK_C);
				return;
			}
			case 'cop0':
				this.emitABC(OpCode.MTC0, valueReg, target.register, 0);
				return;
			case 'memory':
				this.emitMemoryStore(target.accessKind, target.addrConst, target.addrReg, target.addrOffsetBytes, valueReg);
				return;
			default:
				throw new Error('Unsupported assignment target kind.');
		}
	}

	private applyCompoundAssignment(
		target: AssignmentTarget,
		operator: LuaAssignmentOperator,
		valueReg: number,
	): void {
		const temp = this.allocTemp();
		const op = opForAssignment(operator);
		switch (target.kind) {
			case 'local':
				this.emitABC(op, temp, target.reg, valueReg, RK_B | RK_C);
				this.emitABC(OpCode.MOV, target.reg, temp, 0);
				return;
			case 'upvalue':
				this.emitABC(OpCode.GETUP, temp, target.upvalue, 0);
				this.emitABC(op, temp, temp, valueReg, RK_B | RK_C);
				this.emitABC(OpCode.SETUP, temp, target.upvalue, 0);
				return;
			case 'global': {
				this.emitABx(target.system ? OpCode.GETSYS : OpCode.GETGL, temp, target.slot);
				this.emitABC(op, temp, temp, valueReg, RK_B | RK_C);
				this.emitABx(target.system ? OpCode.SETSYS : OpCode.SETGL, temp, target.slot);
				return;
			}
			case 'table': {
				if (target.keyConst !== undefined) {
					this.emitTableGetConst(temp, target.tableReg, target.keyConst);
				} else {
					this.emitABC(OpCode.GETT, temp, target.tableReg, target.keyReg, RK_C);
				}
				this.emitABC(op, temp, temp, valueReg, RK_B | RK_C);
				if (target.keyConst !== undefined) {
					this.emitTableSetConst(target.tableReg, target.keyConst, temp);
					return;
				}
				this.emitABC(OpCode.SETT, target.tableReg, target.keyReg, temp, RK_B | RK_C);
				return;
			}
			case 'cop0':
				if (target.register === COP0_EXEC) {
					throw new Error('cop0.exec does not support compound assignment.');
				}
				this.emitABC(OpCode.MFC0, temp, target.register, 0);
				this.emitABC(op, temp, temp, valueReg, RK_B | RK_C);
				this.emitABC(OpCode.MTC0, temp, target.register, 0);
				return;
			case 'memory':
				this.emitMemoryLoad(temp, target.accessKind, target.addrConst, target.addrReg, target.addrOffsetBytes);
				this.emitABC(op, temp, temp, valueReg, RK_B | RK_C);
				this.emitMemoryStore(target.accessKind, target.addrConst, target.addrReg, target.addrOffsetBytes, temp);
				return;
			default:
				throw new Error('Unsupported compound assignment target.');
		}
	}

	private compileCallStatement(expression: LuaCallExpression): void {
		const requireBinding = this.resolveRequireModuleBinding(expression);
		if (requireBinding) {
			this.compileRequireStatement(requireBinding);
			return;
		}
		const reg = this.allocTemp();
		this.compileCallExpression(expression, reg, 1);
	}

	private compileReturn(expressions: ReadonlyArray<LuaExpression>): void {
		if (expressions.length === 0) {
			const reg = this.allocTemp();
			this.emitLoadNil(reg, 1);
			this.emitABC(OpCode.RET, reg, 1, 0);
			return;
		}
		const base = this.allocTemp();
		const wantsMulti = expressions.length === 1 && this.isMultiReturnExpression(expressions[0]);
		if (expressions.length === 1) {
			if (!wantsMulti && this.moduleCompileInfo !== undefined && expressions[0] === this.moduleCompileInfo.returnExpression) {
				this.compileExpressionInto(expressions[0], base, 1);
				const rootSlot = this.moduleCompileInfo.exportSlotsByPathKey.get('');
				if (rootSlot !== undefined) {
					this.emitModuleExportStore(rootSlot, base);
				}
				this.emitABC(OpCode.RET, base, 1, 0);
				return;
			}
			this.compileExpressionInto(expressions[0], base, wantsMulti ? 0 : 1);
			this.emitABC(OpCode.RET, base, wantsMulti ? 0 : 1, 0);
			return;
		}
		const lastIndex = expressions.length - 1;
		const lastWantsMulti = this.isMultiReturnExpression(expressions[lastIndex]);
		this.reserveTempRange(base, expressions.length);
		const fixedCount = lastWantsMulti ? lastIndex : expressions.length;
		for (let i = 0; i < fixedCount; i += 1) {
			this.compileExpressionInto(expressions[i], base + i, 1);
		}
		if (lastWantsMulti) {
			this.compileExpressionInto(expressions[lastIndex], base + lastIndex, 0);
			this.emitABC(OpCode.RET, base, 0, 0);
			return;
		}
		this.emitABC(OpCode.RET, base, expressions.length, 0);
	}

	private compileIf(statement: LuaIfStatement): void {
		const endJumps: number[] = [];
		for (let i = 0; i < statement.clauses.length; i += 1) {
			const clause = statement.clauses[i];
			if (clause.condition) {
				const jumpsToNext: number[] = [];
				this.compileConditionJumps(clause.condition, false, jumpsToNext);
				this.pushScope(clause.block.range);
				for (let j = 0; j < clause.block.body.length; j += 1) {
					this.compileStatement(clause.block.body[j]);
					this.resetTemps();
				}
				this.popScope();
				endJumps.push(this.emitJumpPlaceholder());
				for (let j = 0; j < jumpsToNext.length; j += 1) {
					this.patchJump(jumpsToNext[j], this.code.length);
				}
				continue;
			}
			this.pushScope(clause.block.range);
			for (let j = 0; j < clause.block.body.length; j += 1) {
				this.compileStatement(clause.block.body[j]);
				this.resetTemps();
			}
			this.popScope();
			break;
		}
		for (let i = 0; i < endJumps.length; i += 1) {
			this.patchJump(endJumps[i], this.code.length);
		}
	}

	private compileWhile(statement: LuaWhileStatement): void {
		const loopStart = this.code.length;
		const jumpsOut: number[] = [];
		this.compileConditionJumps(statement.condition, false, jumpsOut);
		const ctx: LoopContext = { breakJumps: [] };
		this.loopStack.push(ctx);
		this.pushScope(statement.block.range);
		for (let i = 0; i < statement.block.body.length; i += 1) {
			this.compileStatement(statement.block.body[i]);
			this.resetTemps();
		}
		this.popScope();
		this.loopStack.pop();
		this.emitAsBx(OpCode.JMP, 0, loopStart - (this.code.length + 1));
		for (let i = 0; i < jumpsOut.length; i += 1) {
			this.patchJump(jumpsOut[i], this.code.length);
		}
		for (let i = 0; i < ctx.breakJumps.length; i += 1) {
			this.patchJump(ctx.breakJumps[i], this.code.length);
		}
	}

	private compileRepeat(statement: any): void {
		const loopStart = this.code.length;
		const ctx: LoopContext = { breakJumps: [] };
		this.loopStack.push(ctx);
		this.pushScope(statement.block.range);
		for (let i = 0; i < statement.block.body.length; i += 1) {
			this.compileStatement(statement.block.body[i]);
			this.resetTemps();
		}
		this.popScope();
		this.loopStack.pop();
		const repeatJumps: number[] = [];
		this.compileConditionJumps(statement.condition, false, repeatJumps);
		for (let i = 0; i < repeatJumps.length; i += 1) {
			this.patchJump(repeatJumps[i], loopStart);
		}
		for (let i = 0; i < ctx.breakJumps.length; i += 1) {
			this.patchJump(ctx.breakJumps[i], this.code.length);
		}
	}

	private compileForNumeric(statement: any): void {
		this.pushScope(statement.block.range);
		const loopDecl = this.requireBoundDeclaration(statement.variable.range, `loop variable '${statement.variable.name}'`);
		const indexReg = this.declareLocalFromDecl(loopDecl, statement.variable.range);
		this.compileExpressionInto(statement.start, indexReg, 1);
		const limitReg = this.allocLocal();
		this.compileExpressionInto(statement.limit, limitReg, 1);
		const stepReg = this.allocLocal();
		if (statement.step) {
			this.compileExpressionInto(statement.step, stepReg, 1);
		} else {
			this.emitLoadConst(stepReg, 1);
		}
		const loopStart = this.code.length;
		const zeroConst = this.program.constIndex(0);
		const zeroOperand = this.encodeConstOperand(zeroConst);
		this.emitABC(OpCode.LT, 0, zeroOperand, stepReg, RK_B | RK_C);
		const jumpToNegativeCheck = this.emitJumpPlaceholder();
		this.emitABC(OpCode.LT, 1, limitReg, indexReg, RK_B | RK_C);
		const jumpOutPositive = this.emitJumpPlaceholder();
		const jumpToBody = this.emitJumpPlaceholder();
		this.patchJump(jumpToNegativeCheck, this.code.length);
		this.emitABC(OpCode.LT, 1, indexReg, limitReg, RK_B | RK_C);
		const jumpOutNegative = this.emitJumpPlaceholder();
		this.patchJump(jumpToBody, this.code.length);
		const ctx: LoopContext = { breakJumps: [] };
		this.loopStack.push(ctx);
		for (let i = 0; i < statement.block.body.length; i += 1) {
			this.compileStatement(statement.block.body[i]);
			this.resetTemps();
		}
		this.loopStack.pop();
		this.emitABC(OpCode.ADD, indexReg, indexReg, stepReg, RK_B | RK_C);
		this.emitAsBx(OpCode.JMP, 0, loopStart - (this.code.length + 1));
		this.patchJump(jumpOutPositive, this.code.length);
		this.patchJump(jumpOutNegative, this.code.length);
		for (let i = 0; i < ctx.breakJumps.length; i += 1) {
			this.patchJump(ctx.breakJumps[i], this.code.length);
		}
		this.popScope();
	}

	private compileForGeneric(statement: LuaForGenericStatement): void {
		this.pushScope(statement.block.range);
		const valueTargets: Array<ReadonlyArray<string> | null> = new Array(statement.iterators.length).fill(null);
		const iteratorValues = this.compileAssignmentValues(statement.iterators, 3, valueTargets);
		const iteratorReg = this.allocLocal();
		const stateReg = this.allocLocal();
		const controlReg = this.allocLocal();
		const iteratorDefaults = [iteratorReg, stateReg, controlReg];
		for (let i = 0; i < iteratorDefaults.length; i += 1) {
			const targetReg = iteratorDefaults[i];
			const valueReg = iteratorValues[i];
			if (valueReg !== undefined) {
				this.emitABC(OpCode.MOV, targetReg, valueReg, 0);
			} else {
				this.emitLoadNil(targetReg, 1);
			}
		}

		const loopVars: number[] = [];
		for (let i = 0; i < statement.variables.length; i += 1) {
			const variable = statement.variables[i];
			const decl = this.requireBoundDeclaration(variable.range, `loop variable '${variable.name}'`);
			loopVars.push(this.declareLocalFromDecl(decl, variable.range));
		}

		const resultCount = loopVars.length;
		const argCount = 2;
		const callBlockSize = Math.max(resultCount, argCount + 1);
		const callBase = this.allocTempBlock(callBlockSize);
		const loopStart = this.code.length;
		this.emitABC(OpCode.MOV, callBase, iteratorReg, 0);
		this.emitABC(OpCode.MOV, callBase + 1, stateReg, 0);
		this.emitABC(OpCode.MOV, callBase + 2, controlReg, 0);
		this.emitABC(OpCode.CALL, callBase, encodeFixedCallArgCount(argCount), resultCount);

		const nilConst = this.program.constIndex(null);
		const nilOperand = this.encodeConstOperand(nilConst);
		this.emitABC(OpCode.EQ, 1, callBase, nilOperand, RK_B | RK_C);
		const jumpOut = this.emitJumpPlaceholder();

		for (let i = 0; i < loopVars.length; i += 1) {
			this.emitABC(OpCode.MOV, loopVars[i], callBase + i, 0);
		}
		this.emitABC(OpCode.MOV, controlReg, loopVars[0], 0);

		const ctx: LoopContext = { breakJumps: [] };
		this.loopStack.push(ctx);
		for (let i = 0; i < statement.block.body.length; i += 1) {
			this.compileStatement(statement.block.body[i]);
			this.resetTemps();
		}
		this.loopStack.pop();
		this.emitAsBx(OpCode.JMP, 0, loopStart - (this.code.length + 1));
		this.patchJump(jumpOut, this.code.length);
		for (let i = 0; i < ctx.breakJumps.length; i += 1) {
			this.patchJump(ctx.breakJumps[i], this.code.length);
		}
		this.popScope();
	}

	private compileGoto(statement: LuaGotoStatement): void {
		const label = statement.label;
		const target = this.labelPositions.get(label);
		const jumpIndex = this.emitJumpPlaceholder();
		if (target !== undefined) {
			this.patchJump(jumpIndex, target);
			return;
		}
		let jumps = this.pendingLabelJumps.get(label);
		if (!jumps) {
			jumps = [];
			this.pendingLabelJumps.set(label, jumps);
		}
		jumps.push(jumpIndex);
	}

	private compileLabel(statement: LuaLabelStatement): void {
		const label = statement.label;
		if (this.labelPositions.has(label)) {
			throw new Error(`Duplicate label '${label}'.`);
		}
		const target = this.code.length;
		this.labelPositions.set(label, target);
		const jumps = this.pendingLabelJumps.get(label);
		if (!jumps) {
			return;
		}
		for (let i = 0; i < jumps.length; i += 1) {
			this.patchJump(jumps[i], target);
		}
		this.pendingLabelJumps.delete(label);
	}

	private compileBreak(): void {
		const ctx = this.loopStack[this.loopStack.length - 1];
		if (!ctx) {
			throw new Error('Break outside of loop.');
		}
		ctx.breakJumps.push(this.emitJumpPlaceholder());
	}

	private compileLocalFunction(statement: LuaLocalFunctionStatement): void {
		const decl = this.requireBoundDeclaration(statement.name.range, `local function '${statement.name.name}'`);
		const name = decl.name;
		const reg = this.declareLocalFromDecl(decl, statement.name.range);
		const hint = this.createLocalFunctionHint(name);
		const protoId = buildProtoId(this.protoId, hint);
		const protoIndex = compileFunctionExpression(this.program, statement.functionExpression, this, false, protoId, this.moduleId, this.semantics, this.frontend);
		this.emitABx(OpCode.CLOSURE, reg, protoIndex);
		if (statement.attribute === 'init') {
			const participant = this.program.recordInitParticipant(this.moduleId, protoId);
			this.emitABx(participant.system ? OpCode.SETSYS : OpCode.SETGL, reg, participant.objectSlot);
		}
	}

	private compileFunctionDeclaration(statement: LuaFunctionDeclarationStatement): void {
		const fnExpr = statement.functionExpression;
		const method = statement.name.method;
		const methodName = method === null ? null : method.name;
		const path = statement.name.path;
		const identifiers = new Array<string>(path.length);
		for (let index = 0; index < path.length; index += 1) {
			identifiers[index] = path[index].name;
		}
		const target = classifyFunctionDeclarationTarget(this.semantics, statement);
		const hint = buildDeclarationHint(identifiers, methodName);
		const protoId = buildProtoId(this.protoId, hint);
		const protoIndex = compileFunctionExpression(this.program, fnExpr, this, methodName && methodName.length > 0, protoId, this.moduleId, this.semantics, this.frontend);
		const closureReg = this.allocTemp();
		this.emitABx(OpCode.CLOSURE, closureReg, protoIndex);
		if (identifiers.length === 0) {
			throw new Error('Function declaration missing name.');
		}
		if (target.kind === 'simple') {
			if (!target.finalReference) {
				throw new Error(`Missing bound function target for '${identifiers[0]}'.`);
			}
			this.emitReferenceStore(target.finalReference, closureReg);
			return;
		}

		const baseReg = this.allocTemp();
		if (!target.baseReference) {
			throw new Error(`Missing bound function base for '${identifiers[0]}'.`);
		}
		this.emitReferenceLoad(target.baseReference, baseReg);
		for (let i = 0; i < target.intermediateKeys.length; i += 1) {
			const key = this.program.constIndex(target.intermediateKeys[i]);
			const nextReg = this.allocTemp();
			this.emitTableGetConst(nextReg, baseReg, key);
			this.emitABC(OpCode.MOV, baseReg, nextReg, 0);
		}
		const keyName = target.finalKey;
		const keyConst = this.program.constIndex(keyName);
		this.emitTableSetConst(baseReg, keyConst, closureReg);
	}

	// The symbol handle of this module's exported namespace local: the local that the
	// module returns (e.g. `room` in `return room`). null when the module does not
	// return a bare local. Cached because it is consulted per export definition.
	private getExportRootSymbolHandle(): string | null {
		if (this.exportRootSymbolHandleResolved) {
			return this.exportRootSymbolHandleCache;
			}
			let handle: string | null = null;
			const moduleInfo = this.moduleCompileInfo;
			const ret = moduleInfo && moduleInfo.returnExpression;
			if (ret && ret.kind === LuaSyntaxKind.IdentifierExpression) {
				const ref = getResolvedIdentifierReference(this.semantics, ret as LuaIdentifierExpression);
				if (ref) {
					handle = getResolvedReferenceSymbolHandle(ref);
			}
		}
		this.exportRootSymbolHandleCache = handle;
		this.exportRootSymbolHandleResolved = true;
		return handle;
	}

	private compileExpressionInto(expression: LuaExpression, target: number, resultCount: number, protoIdHint: string | null = null): void {
		this.withRange(expression.range, () => {
			switch (expression.kind) {
				case LuaSyntaxKind.NumericLiteralExpression:
					this.emitLoadConst(target, expression.value);
					return;
				case LuaSyntaxKind.StringLiteralExpression:
					this.emitLoadConst(target, expression.value);
					return;
				case LuaSyntaxKind.BooleanLiteralExpression:
					this.emitLoadBool(target, expression.value);
					return;
				case LuaSyntaxKind.NilLiteralExpression:
					this.emitLoadNil(target, 1);
					return;
				case LuaSyntaxKind.IdentifierExpression:
					this.emitReferenceLoad(getResolvedIdentifierReference(this.semantics, expression as LuaIdentifierExpression), target);
					return;
				case LuaSyntaxKind.TableConstructorExpression:
					this.compileTableConstructor(expression as LuaTableConstructorExpression, target);
					return;
				case LuaSyntaxKind.UnaryExpression:
					this.compileUnaryExpression(expression as LuaUnaryExpression, target, resultCount);
					return;
				case LuaSyntaxKind.BinaryExpression:
					this.compileBinaryExpression(expression, target);
					return;
				case LuaSyntaxKind.CallExpression:
					this.compileCallExpression(expression as LuaCallExpression, target, resultCount);
					return;
				case LuaSyntaxKind.MemberExpression:
					this.compileMemberExpression(expression, target);
					return;
				case LuaSyntaxKind.IndexExpression:
					this.compileIndexExpression(expression, target);
					return;
				case LuaSyntaxKind.SizeOfExpression:
					this.emitLoadConst(target, this.resolveStructTypeReference((expression as LuaSizeOfExpression).typeRef).size);
					return;
				case LuaSyntaxKind.OffsetOfExpression: {
					const offsetOf = expression as LuaOffsetOfExpression;
					this.emitLoadConst(target, this.resolveOffsetOf(offsetOf.typeName, offsetOf.fieldPath));
					return;
				}
				case LuaSyntaxKind.VarargExpression:
					this.emitABC(OpCode.VARARG, target, resultCount, 0);
					return;
				case LuaSyntaxKind.FunctionExpression: {
					const protoId = buildProtoId(this.protoId, protoIdHint ?? buildAnonymousHint(expression.range));
					const protoIndex = compileFunctionExpression(this.program, expression as LuaFunctionExpression, this, false, protoId, this.moduleId, this.semantics, this.frontend);
					this.emitABx(OpCode.CLOSURE, target, protoIndex);
					return;
				}
				default: {
					throw new Error(`Unsupported expression kind: ${(expression as LuaExpression).kind}`);
				}
			}
		});
	}

	private compileMemberExpression(expression: any, target: number): void {
		const cop0Register = this.resolveCop0Register(expression as LuaMemberExpression);
		if (cop0Register) {
			if (cop0Register === COP0_EXEC) {
				throw new Error('cop0.exec is write-only.');
			}
			this.emitABC(OpCode.MFC0, target, cop0Register, 0);
			return;
		}
		const constExport = this.resolveModuleExportConstValue(expression as LuaMemberExpression);
		if (constExport) {
			this.emitLoadConstExportValue(target, constExport.value);
			return;
		}
		const staticFunctionExportBinding = this.resolveStaticFunctionExportBinding(expression as LuaMemberExpression);
		if (staticFunctionExportBinding) {
			this.failStaticFunctionExportRuntimeValue(`${staticFunctionExportBinding.modulePath}:${staticFunctionExportBinding.exportPathKey}`);
		}
		const structAddress = this.resolveStructScalarAddress(expression as LuaMemberExpression);
		if (structAddress) {
			this.emitStructScalarLoad(target, structAddress);
			return;
		}
		const baseReg = this.allocTemp();
		this.compileExpressionInto(expression.base, baseReg, 1);
		const key = this.program.constIndex(expression.member.name);
		this.emitTableGetConst(target, baseReg, key);
	}

	private resolveCop0Register(expression: LuaMemberExpression): number | undefined {
		if (expression.base.kind !== LuaSyntaxKind.IdentifierExpression) {
			return undefined;
		}
		const reference = getResolvedIdentifierReference(this.semantics, expression.base as LuaIdentifierExpression);
		if (reference.kind !== 'reserved_intrinsic' || reference.ref.name !== 'cop0') {
			return undefined;
		}
		switch (expression.member.name) {
			case 'bad_address': return COP0_BAD_ADDRESS;
			case 'lua_fault_reason': return COP0_LUA_FAULT_REASON;
			case 'status': return COP0_STATUS;
			case 'cause': return COP0_CAUSE;
			case 'epc': return COP0_EPC;
			case 'exec': return COP0_EXEC;
			default: throw new Error(`Unknown cop0 register '${expression.member.name}'.`);
		}
	}

	private compileIndexExpression(expression: any, target: number): void {
		const constExport = this.resolveModuleExportConstValue(expression as LuaIndexExpression);
		if (constExport) {
			this.emitLoadConstExportValue(target, constExport.value);
			return;
		}
		const staticFunctionExportBinding = this.resolveStaticFunctionExportBinding(expression as LuaIndexExpression);
		if (staticFunctionExportBinding) {
			this.failStaticFunctionExportRuntimeValue(`${staticFunctionExportBinding.modulePath}:${staticFunctionExportBinding.exportPathKey}`);
		}
		const structAddress = this.resolveStructScalarAddress(expression as LuaIndexExpression);
		if (structAddress) {
			this.emitStructScalarLoad(target, structAddress);
			return;
		}
		const targetPreparation = classifyAssignmentTargetPreparation(this.semantics, expression as LuaIndexExpression);
		if (targetPreparation.kind === 'memory') {
			const memoryTarget = this.compileMemoryTarget(targetPreparation);
			this.emitMemoryLoad(target, memoryTarget.accessKind, memoryTarget.addrConst, memoryTarget.addrReg, memoryTarget.addrOffsetBytes);
			return;
		}
		const baseReg = this.allocTemp();
		this.compileExpressionInto(expression.base, baseReg, 1);
		const keyConst = this.getConstIndex(expression.index);
		if (keyConst !== undefined) {
			this.emitTableGetConst(target, baseReg, keyConst);
			return;
		}
		const keyReg = this.allocTemp();
		this.compileExpressionInto(expression.index, keyReg, 1);
		this.emitABC(OpCode.GETT, target, baseReg, keyReg, RK_C);
	}

	private compileTableConstructor(expression: LuaTableConstructorExpression, target: number): void {
		let arrayCount = 0;
		let hashCount = 0;
		for (let i = 0; i < expression.fields.length; i += 1) {
			const field = expression.fields[i];
			if (field.kind === LuaTableFieldKind.Array) {
				arrayCount += 1;
			} else {
				hashCount += 1;
			}
		}
		this.emitABC(OpCode.NEWT, target, arrayCount, hashCount);
		const tempBase = this.tempTop;
		let arrayIndex = 1;
		for (let i = 0; i < expression.fields.length; i += 1) {
			const field = expression.fields[i];
			if (field.kind === LuaTableFieldKind.Array) {
				const valueReg = this.allocTemp();
				this.compileExpressionInto(field.value, valueReg, 1);
				if (arrayIndex <= MAX_SPECIALIZED_TABLE_OPERAND) {
					this.emitABC(OpCode.SETI, target, arrayIndex, valueReg, RK_C);
				} else {
					const keyConst = this.program.constIndex(arrayIndex);
					this.emitTableSetConst(target, keyConst, valueReg);
				}
				arrayIndex += 1;
				this.tempTop = tempBase;
				continue;
			}
			if (field.kind === LuaTableFieldKind.IdentifierKey) {
				const valueReg = this.allocTemp();
				this.compileExpressionInto(field.value, valueReg, 1);
				const keyConst = this.program.constIndex(field.name);
				this.emitTableSetConst(target, keyConst, valueReg);
				this.tempTop = tempBase;
				continue;
			}
			const keyConst = this.getConstIndex(field.key);
			if (keyConst !== undefined) {
				const valueReg = this.allocTemp();
				this.compileExpressionInto(field.value, valueReg, 1);
				this.emitTableSetConst(target, keyConst, valueReg);
				this.tempTop = tempBase;
				continue;
			}
			const keyReg = this.allocTemp();
			this.compileExpressionInto(field.key, keyReg, 1);
			const valueReg = this.allocTemp();
			this.compileExpressionInto(field.value, valueReg, 1);
			this.emitABC(OpCode.SETT, target, keyReg, valueReg, RK_B | RK_C);
			this.tempTop = tempBase;
		}
	}

	private getConstIndex(expression: LuaExpression): number | undefined {
		if (!this.evaluateCompileTimeExpression(expression) || this.compileTimeRelocValue !== null) return;
		return this.program.constIndex(this.compileTimeValue);
	}

	private getNumericConstIndex(expression: LuaExpression): number | undefined {
		const numberValue = this.evaluateCompileTimeNumber(expression);
		if (numberValue || numberValue === 0) {
			return this.program.constIndex(numberValue);
		}
	}

	private compileDisplacedAddress(expression: LuaExpression): { baseReg: number; byteOffset: number } | null {
		if (expression.kind !== LuaSyntaxKind.BinaryExpression) {
			return null;
		}
		const binary = expression as LuaBinaryExpression;
		if (binary.operator !== LuaBinaryOperator.Add && binary.operator !== LuaBinaryOperator.Subtract) {
			return null;
		}
		const rightOffset = this.evaluateCompileTimeNumber(binary.right);
		if (rightOffset !== undefined) {
			const baseReg = this.allocTemp();
			this.compileExpressionInto(binary.left, baseReg, 1);
			return {
				baseReg,
				byteOffset: binary.operator === LuaBinaryOperator.Subtract ? -rightOffset : rightOffset,
			};
		}
		if (binary.operator === LuaBinaryOperator.Add) {
			const leftOffset = this.evaluateCompileTimeNumber(binary.left);
			if (leftOffset !== undefined) {
				const baseReg = this.allocTemp();
				this.compileExpressionInto(binary.right, baseReg, 1);
				return { baseReg, byteOffset: leftOffset };
			}
		}
		return null;
	}

	private compileMemoryTarget(target: Extract<ReturnType<typeof classifyAssignmentTargetPreparation>, { kind: 'memory' }>): Extract<AssignmentTarget, { kind: 'memory' }> {
		const addrConst = this.getNumericConstIndex(target.index);
		if (addrConst !== undefined) {
			return { kind: 'memory', accessKind: target.accessKind, addrConst };
		}
		const displaced = this.compileDisplacedAddress(target.index);
		if (displaced !== null) {
			return {
				kind: 'memory',
				accessKind: target.accessKind,
				addrReg: displaced.baseReg,
				addrOffsetBytes: displaced.byteOffset,
			};
		}
		const addrReg = this.allocTemp();
		this.compileExpressionInto(target.index, addrReg, 1);
		return { kind: 'memory', accessKind: target.accessKind, addrReg };
	}

	private compileStructIndexAddress(base: StructAddress, indexExpression: LuaExpression): StructAddress {
		let elementType: StructResolvedType;
		if (base.type.dimensions.length > 0) {
			elementType = this.typeAfterStructIndex(base.type);
		} else {
			if (!base.pointerIndex) {
				throw new Error(`Type '${base.type.name}' is not an array.`);
			}
			elementType = base.type;
		}
		const stride = elementType.size;
		const staticIndex = this.evaluateCompileTimeNumber(indexExpression);
		if (staticIndex !== undefined) {
			if (!Number.isInteger(staticIndex)) {
				throw new Error('Struct array index must be an integer when used as a compile-time offset.');
			}
			return {
				baseReg: base.baseReg,
				byteOffset: base.byteOffset + staticIndex * stride,
				type: elementType,
				pointerIndex: false,
				readOnly: base.readOnly,
			};
		}
		const indexReg = this.allocTemp();
		this.compileExpressionInto(indexExpression, indexReg, 1);
		let offsetReg = indexReg;
		if (stride !== 1) {
			offsetReg = this.allocTemp();
			this.emitABC(OpCode.MUL, offsetReg, indexReg, this.encodeConstOperand(this.program.constIndex(stride)), RK_C);
		}
		const baseReg = this.emitOffsetAddress(base.baseReg, base.byteOffset);
		const nextBaseReg = this.allocTemp();
		this.emitABC(OpCode.ADD, nextBaseReg, baseReg, offsetReg, 0);
		return {
			baseReg: nextBaseReg,
			byteOffset: 0,
			type: elementType,
			pointerIndex: false,
			readOnly: base.readOnly,
		};
	}

	private resolveStructAddress(expression: LuaExpression): StructAddress | undefined {
		switch (expression.kind) {
			case LuaSyntaxKind.IdentifierExpression: {
				const reference = getResolvedIdentifierReference(this.semantics, expression as LuaIdentifierExpression);
				const bssBinding = this.resolveReferenceBssBinding(reference);
				if (bssBinding) {
					const baseReg = this.allocTemp();
					this.emitLoadBssAddress(baseReg, bssBinding, 0);
					return {
						baseReg,
						byteOffset: 0,
						type: bssBinding.type,
						pointerIndex: true,
						readOnly: false,
					};
				}
				const dataBinding = this.resolveReferenceDataBinding(reference);
				if (dataBinding) {
					const baseReg = this.allocTemp();
					this.emitLoadDataAddress(baseReg, dataBinding, 0);
					return {
						baseReg,
						byteOffset: 0,
						type: dataBinding.type,
						pointerIndex: true,
						readOnly: false,
					};
				}
					const rodataBinding = this.resolveReferenceRodataBinding(reference);
					if (rodataBinding) {
						const baseReg = this.allocTemp();
						this.emitLoadRodataAddress(baseReg, rodataBinding, 0);
						return {
							baseReg,
							byteOffset: 0,
							type: rodataBinding.type,
							pointerIndex: true,
							readOnly: true,
						};
					}
						const visibleBinding = this.resolveReferenceVisibleBinding(reference);
						if (visibleBinding && visibleBinding.structView) {
							const localReg = this.resolveReferenceLocal(reference);
							if (localReg || localReg === 0) {
								return {
									baseReg: localReg,
									byteOffset: 0,
									type: visibleBinding.structView.type,
									pointerIndex: true,
									readOnly: false,
							};
						}
						const baseReg = this.allocTemp();
						this.emitReferenceLoad(reference, baseReg);
							return {
								baseReg,
								byteOffset: 0,
								type: visibleBinding.structView.type,
								pointerIndex: true,
								readOnly: false,
							};
					}
					return;
			}
			case LuaSyntaxKind.MemberExpression: {
				const member = expression as LuaMemberExpression;
				const base = this.resolveStructAddress(member.base);
				if (!base) {
					return;
				}
				return this.resolveStructFieldAddress(base, member.member.name);
			}
			case LuaSyntaxKind.IndexExpression: {
				const index = expression as LuaIndexExpression;
				const base = this.resolveStructAddress(index.base);
				if (!base) {
					return;
				}
				return this.compileStructIndexAddress(base, index.index);
			}
			case LuaSyntaxKind.UnaryExpression: {
				const unary = expression as LuaUnaryExpression;
				if (unary.operator !== LuaUnaryOperator.Dereference) {
					return;
				}
				const base = this.resolveStructAddress(unary.operand);
				if (!base) {
					return;
				}
				return {
					baseReg: base.baseReg,
					byteOffset: base.byteOffset,
					type: base.type,
					pointerIndex: false,
					readOnly: base.readOnly,
				};
				}
				default:
					return;
			}
		}

	private resolveStaticStorageArrayLength(expression: LuaExpression): number | undefined {
		if (expression.kind === LuaSyntaxKind.IdentifierExpression) {
			const reference = getResolvedIdentifierReference(this.semantics, expression as LuaIdentifierExpression);
			const binding = this.resolveReferenceBssBinding(reference)
				?? this.resolveReferenceDataBinding(reference)
				?? this.resolveReferenceRodataBinding(reference);
			if (!binding || binding.type.dimensions.length === 0) {
				return undefined;
			}
			return binding.type.dimensions[0];
		}
		const exported = this.resolveModuleExportConstValue(expression);
		if (!exported) {
			return undefined;
		}
		const value = exported.value;
		switch (value.kind) {
			case 'bss_addr': {
				const binding = this.program.bssBindingsBySymbolHandle.get(value.symbolHandle);
				if (!binding) {
					throw new Error(`Static module .bss symbol '${value.symbolHandle}' was not recorded.`);
				}
				return binding.type.dimensions[0];
			}
			case 'data_addr': {
				const binding = this.program.dataBindingsBySymbolHandle.get(value.symbolHandle);
				if (!binding) {
					throw new Error(`Static module .data symbol '${value.symbolHandle}' was not recorded.`);
				}
				return binding.type.dimensions[0];
			}
			case 'rodata_addr': {
				const binding = this.program.rodataBindingsBySymbolHandle.get(value.symbolHandle);
				if (!binding) {
					throw new Error(`Static module .rodata symbol '${value.symbolHandle}' was not recorded.`);
				}
				return binding.type.dimensions[0];
			}
			default:
				return undefined;
		}
	}

	private resolveStructScalarAddress(expression: LuaExpression): StructAddress | undefined {
		const address = this.resolveStructAddress(expression);
		if (!address) {
			return;
		}
		if (!address.type.access) {
			throw new Error(`Struct expression '${address.type.name}' is an address range; use '&' to pass its address or select a scalar field.`);
		}
		return address;
	}

	private emitStructScalarLoad(target: number, address: StructAddress): void {
		const access = address.type.access!;
		if (access.kind === 'memory') {
			this.emitMemoryLoad(target, access.memoryKind, undefined, address.baseReg, address.byteOffset);
			return;
		}
		const constIndexReg = this.allocTemp();
		this.emitMemoryLoad(constIndexReg, MemoryAccessKind.U32LE, undefined, address.baseReg, address.byteOffset);
		this.emitABC(OpCode.LOADKR, target, constIndexReg, 0);
	}

	private emitStructAddressValue(address: StructAddress, target: number, resultCount: number): void {
		if (resultCount === 0) {
			return;
		}
		if (address.byteOffset === 0) {
			if (address.baseReg !== target) {
				this.emitABC(OpCode.MOV, target, address.baseReg, 0);
			}
		} else {
			this.emitABC(OpCode.ADD, target, address.baseReg, this.encodeConstOperand(this.program.constIndex(address.byteOffset)), RK_C);
		}
		if (resultCount > 1) {
			this.emitLoadNil(target + 1, resultCount - 1);
		}
	}

	private canUseDisplacedMemoryOpcode(byteOffset: number): boolean {
		return byteOffset >= 0 && byteOffset <= MAX_DISPLACED_MEMORY_BYTE_OFFSET && (byteOffset & 0x3) === 0;
	}

	private emitOffsetAddress(baseReg: number, byteOffset: number): number {
		if (byteOffset === 0) {
			return baseReg;
		}
		const addrReg = this.allocTemp();
		const offsetOperand = this.encodeConstOperand(this.program.constIndex(byteOffset));
		this.emitABC(OpCode.ADD, addrReg, baseReg, offsetOperand, RK_C);
		return addrReg;
	}

	private emitMemoryLoad(target: number, accessKind: MemoryAccessKind, addrConst: number | undefined, addrReg: number | undefined, addrOffsetBytes: number | undefined): void {
		const byteOffset = addrOffsetBytes ?? 0;
		if (addrReg !== undefined && this.canUseDisplacedMemoryOpcode(byteOffset)) {
			this.emitABCd(OpCode.LOAD_MEM_D, target, addrReg, accessKind, byteOffset >> 2);
			return;
		}
		if (addrConst !== undefined) {
			this.emitABC(OpCode.LOAD_MEM, target, this.encodeConstOperand(addrConst), accessKind, RK_B);
			return;
		}
		this.emitABC(OpCode.LOAD_MEM, target, this.emitOffsetAddress(addrReg!, byteOffset), accessKind, 0);
	}

	private emitMemoryStore(accessKind: MemoryAccessKind, addrConst: number | undefined, addrReg: number | undefined, addrOffsetBytes: number | undefined, valueReg: number): void {
		const byteOffset = addrOffsetBytes ?? 0;
		if (addrReg !== undefined && this.canUseDisplacedMemoryOpcode(byteOffset)) {
			this.emitABCd(OpCode.STORE_MEM_D, valueReg, addrReg, accessKind, byteOffset >> 2);
			return;
		}
		if (addrConst !== undefined) {
			this.emitABC(OpCode.STORE_MEM, valueReg, this.encodeConstOperand(addrConst), accessKind, RK_B);
			return;
		}
		this.emitABC(OpCode.STORE_MEM, valueReg, this.emitOffsetAddress(addrReg!, byteOffset), accessKind, 0);
	}

	private compileStringIdUnaryExpression(expression: LuaUnaryExpression, target: number, resultCount: number): void {
		const structAddress = this.resolveStructAddress(expression.operand);
		if (structAddress) {
			this.emitStructAddressValue(structAddress, target, resultCount);
			return;
		}
		const valueKind = this.flowAnalysis!.evaluateExpressionValueKind(expression.operand, this.currentFlowState);
		switch (valueKind) {
			case 'string':
			case 'string_id':
			case 'unknown':
				break;
			default:
				throw new LuaSyntaxError(
					`& expects a string value (got: ${valueKind}).`,
					expression.operand.range.path,
					expression.operand.range.start.line,
					expression.operand.range.start.column,
				);
		}
		const tempBase = this.tempTop;
		const valueTarget = resultCount > 0 ? target : this.allocTemp();
		this.compileExpressionInto(expression.operand, valueTarget, 1);
		if (resultCount > 1) {
			this.emitLoadNil(target + 1, resultCount - 1);
		}
		if (resultCount === 0) {
			this.tempTop = tempBase;
		}
	}

	private compileRKOperand(expression: LuaExpression): number {
		const constIndex = this.getConstIndex(expression);
		if (constIndex !== undefined) {
			return this.encodeConstOperand(constIndex);
		}
		const reg = this.allocTemp();
		this.compileExpressionInto(expression, reg, 1);
		return reg;
	}

	private compileUnaryExpression(expression: LuaUnaryExpression, target: number, resultCount: number): void {
		const compileTimeValue = this.evaluateCompileTimeNumericValue(expression);
		if (compileTimeValue?.kind === 'link_value') {
			this.emitLoadConstExportValue(target, compileTimeValue);
			if (resultCount > 1) this.emitLoadNil(target + 1, resultCount - 1);
			return;
		}
		if (expression.operator === LuaUnaryOperator.Length) {
			const arrayLength = this.resolveStaticStorageArrayLength(expression.operand);
			if (arrayLength !== undefined) {
				this.emitLoadConst(target, arrayLength);
				if (resultCount > 1) this.emitLoadNil(target + 1, resultCount - 1);
				return;
			}
		}
		if (expression.operator === LuaUnaryOperator.StringId) {
			this.compileStringIdUnaryExpression(expression, target, resultCount);
			return;
		}
		if (expression.operator === LuaUnaryOperator.Dereference) {
			const structAddress = this.resolveStructScalarAddress(expression);
			if (!structAddress) {
				throw new LuaSyntaxError(
					'Pointer dereference requires a typed pointer.',
					expression.range.path,
					expression.range.start.line,
					expression.range.start.column,
				);
			}
			this.emitStructScalarLoad(target, structAddress);
			if (resultCount > 1) {
				this.emitLoadNil(target + 1, resultCount - 1);
			}
			return;
		}
		const operandReg = this.allocTemp();
		this.compileExpressionInto(expression.operand, operandReg, 1);
		switch (expression.operator) {
			case LuaUnaryOperator.Negate:
				this.emitABC(OpCode.UNM, target, operandReg, 0);
				return;
			case LuaUnaryOperator.Not:
				this.emitABC(OpCode.NOT, target, operandReg, 0);
				return;
			case LuaUnaryOperator.Length:
				this.emitABC(OpCode.LEN, target, operandReg, 0);
				return;
			case LuaUnaryOperator.BitwiseNot:
				this.emitABC(OpCode.BNOT, target, operandReg, 0);
				return;
			default:
				throw new Error(`Unsupported unary operator: ${expression.operator}`);
		}
	}

	private compileBinaryExpression(expression: any, target: number): void {
		const compileTimeValue = this.evaluateCompileTimeNumericValue(expression as LuaBinaryExpression);
		if (compileTimeValue?.kind === 'link_value') {
			this.emitLoadConstExportValue(target, compileTimeValue);
			return;
		}
		switch (expression.operator) {
			case LuaBinaryOperator.And:
				this.compileAndExpression(expression, target);
				return;
			case LuaBinaryOperator.Or:
				this.compileOrExpression(expression, target);
				return;
			case LuaBinaryOperator.Equal:
				this.compileComparisonValue(OpCode.EQ, expression.left, expression.right, target, true);
				return;
			case LuaBinaryOperator.NotEqual:
				this.compileComparisonValue(OpCode.EQ, expression.left, expression.right, target, false);
				return;
			case LuaBinaryOperator.LessThan:
				this.compileComparisonValue(OpCode.LT, expression.left, expression.right, target, true);
				return;
			case LuaBinaryOperator.LessEqual:
				this.compileComparisonValue(OpCode.LE, expression.left, expression.right, target, true);
				return;
			case LuaBinaryOperator.GreaterThan:
				this.compileComparisonValue(OpCode.LT, expression.right, expression.left, target, true);
				return;
			case LuaBinaryOperator.GreaterEqual:
				this.compileComparisonValue(OpCode.LE, expression.right, expression.left, target, true);
				return;
			case LuaBinaryOperator.BitwiseOr:
				this.compileArithmetic(OpCode.BOR, expression.left, expression.right, target);
				return;
			case LuaBinaryOperator.BitwiseXor:
				this.compileArithmetic(OpCode.BXOR, expression.left, expression.right, target);
				return;
			case LuaBinaryOperator.BitwiseAnd:
				this.compileArithmetic(OpCode.BAND, expression.left, expression.right, target);
				return;
			case LuaBinaryOperator.ShiftLeft:
				this.compileArithmetic(OpCode.SHL, expression.left, expression.right, target);
				return;
			case LuaBinaryOperator.ShiftRight:
				this.compileArithmetic(OpCode.SHR, expression.left, expression.right, target);
				return;
			case LuaBinaryOperator.Add:
				this.compileArithmetic(OpCode.ADD, expression.left, expression.right, target);
				return;
			case LuaBinaryOperator.Subtract:
				this.compileArithmetic(OpCode.SUB, expression.left, expression.right, target);
				return;
			case LuaBinaryOperator.Multiply:
				this.compileArithmetic(OpCode.MUL, expression.left, expression.right, target);
				return;
			case LuaBinaryOperator.Divide:
				this.compileArithmetic(OpCode.DIV, expression.left, expression.right, target);
				return;
			case LuaBinaryOperator.FloorDivide:
				this.compileArithmetic(OpCode.FLOORDIV, expression.left, expression.right, target);
				return;
			case LuaBinaryOperator.Modulus:
				this.compileArithmetic(OpCode.MOD, expression.left, expression.right, target);
				return;
			case LuaBinaryOperator.Concat:
				this.compileConcatExpression(expression, target);
				return;
			case LuaBinaryOperator.Exponent:
				this.compileArithmetic(OpCode.POW, expression.left, expression.right, target);
				return;
			default:
				throw new Error(`Unsupported binary operator: ${expression.operator}`);
		}
	}

	private compileArithmetic(op: OpCode, left: LuaExpression, right: LuaExpression, target: number): void {
		const leftOperand = this.compileRKOperand(left);
		const rightOperand = this.compileRKOperand(right);
		this.emitABC(op, target, leftOperand, rightOperand, RK_B | RK_C);
	}

	private emitComparison(op: OpCode, left: LuaExpression, right: LuaExpression, expectedResult: boolean): void {
		const leftOperand = this.compileRKOperand(left);
		const rightOperand = this.compileRKOperand(right);
		this.emitABC(op, expectedResult ? 1 : 0, leftOperand, rightOperand, RK_B | RK_C);
	}

	private compileComparisonValue(
		op: OpCode,
		left: LuaExpression,
		right: LuaExpression,
		target: number,
		trueComparisonResult: boolean,
	): void {
		this.emitLoadBool(target, true);
		this.emitComparison(op, left, right, trueComparisonResult);
		const jump = this.emitJumpPlaceholder();
		this.emitLoadBool(target, false);
		this.patchJump(jump, this.code.length);
	}

	private compileConditionJumps(expression: LuaExpression, jumpOnTruthy: boolean, jumps: number[]): void {
		const tempBase = this.tempTop;
		this.withRange(expression.range, () => {
			if (this.evaluateCompileTimeExpression(expression)) {
				if ((!this.compileTimeValueIsFalsey()) === jumpOnTruthy) {
					jumps.push(this.emitJumpPlaceholder());
				}
				return;
			}

			if (expression.kind === LuaSyntaxKind.UnaryExpression) {
				const unary = expression as LuaUnaryExpression;
				if (unary.operator === LuaUnaryOperator.Not) {
					this.compileConditionJumps(unary.operand, !jumpOnTruthy, jumps);
					return;
				}
			}

			if (expression.kind === LuaSyntaxKind.BinaryExpression) {
				const binary = expression as LuaBinaryExpression;
				switch (binary.operator) {
					case LuaBinaryOperator.And:
						if (jumpOnTruthy) {
							const falseJumps: number[] = [];
							this.compileConditionJumps(binary.left, false, falseJumps);
							this.compileConditionJumps(binary.right, true, jumps);
							for (let i = 0; i < falseJumps.length; i += 1) {
								this.patchJump(falseJumps[i], this.code.length);
							}
							return;
						}
						this.compileConditionJumps(binary.left, false, jumps);
						this.compileConditionJumps(binary.right, false, jumps);
						return;
					case LuaBinaryOperator.Or:
						if (jumpOnTruthy) {
							this.compileConditionJumps(binary.left, true, jumps);
							this.compileConditionJumps(binary.right, true, jumps);
							return;
						}
						const trueJumps: number[] = [];
						this.compileConditionJumps(binary.left, true, trueJumps);
						this.compileConditionJumps(binary.right, false, jumps);
						for (let i = 0; i < trueJumps.length; i += 1) {
							this.patchJump(trueJumps[i], this.code.length);
						}
						return;
					case LuaBinaryOperator.Equal:
						this.emitComparison(OpCode.EQ, binary.left, binary.right, jumpOnTruthy);
						break;
					case LuaBinaryOperator.NotEqual:
						this.emitComparison(OpCode.EQ, binary.left, binary.right, !jumpOnTruthy);
						break;
					case LuaBinaryOperator.LessThan:
						this.emitComparison(OpCode.LT, binary.left, binary.right, jumpOnTruthy);
						break;
					case LuaBinaryOperator.LessEqual:
						this.emitComparison(OpCode.LE, binary.left, binary.right, jumpOnTruthy);
						break;
					case LuaBinaryOperator.GreaterThan:
						this.emitComparison(OpCode.LT, binary.right, binary.left, jumpOnTruthy);
						break;
					case LuaBinaryOperator.GreaterEqual:
						this.emitComparison(OpCode.LE, binary.right, binary.left, jumpOnTruthy);
						break;
					default: {
						const conditionReg = this.allocTemp();
						this.compileExpressionInto(expression, conditionReg, 1);
						jumps.push(this.emitJumpPlaceholder(jumpOnTruthy ? OpCode.JMPIF : OpCode.JMPIFNOT, conditionReg));
						return;
					}
				}
				jumps.push(this.emitJumpPlaceholder());
				return;
			}

			const conditionReg = this.allocTemp();
			this.compileExpressionInto(expression, conditionReg, 1);
			jumps.push(this.emitJumpPlaceholder(jumpOnTruthy ? OpCode.JMPIF : OpCode.JMPIFNOT, conditionReg));
		});
		this.tempTop = tempBase;
	}

	private compileAndExpression(expression: any, target: number): void {
		this.compileExpressionInto(expression.left, target, 1);
		const jump = this.emitJumpPlaceholder(OpCode.JMPIFNOT, target);
		this.compileExpressionInto(expression.right, target, 1);
		this.patchJump(jump, this.code.length);
	}

	private compileOrExpression(expression: any, target: number): void {
		this.compileExpressionInto(expression.left, target, 1);
		const jumpEnd = this.emitJumpPlaceholder(OpCode.JMPIF, target);
		this.compileExpressionInto(expression.right, target, 1);
		this.patchJump(jumpEnd, this.code.length);
	}

	private collectConcatOperands(expression: LuaExpression, out: LuaExpression[]): void {
		if (expression.kind === LuaSyntaxKind.BinaryExpression) {
			const binary = expression as any;
			if (binary.operator === LuaBinaryOperator.Concat) {
				this.collectConcatOperands(binary.left, out);
				this.collectConcatOperands(binary.right, out);
				return;
			}
		}
		out.push(expression);
	}

	private compileConcatExpression(expression: any, target: number): void {
		const operands: LuaExpression[] = [];
		this.collectConcatOperands(expression, operands);
		if (operands.length === 2) {
			this.compileArithmetic(OpCode.CONCAT, operands[0], operands[1], target);
			return;
		}
		const tempBase = this.tempTop;
		const useTarget = target >= this.localCount && target === tempBase;
		const base = useTarget ? target : this.allocTempBlock(operands.length);
		if (useTarget) {
			this.reserveTempRange(base, operands.length);
		}
		for (let index = 0; index < operands.length; index += 1) {
			this.compileExpressionInto(operands[index], base + index, 1);
		}
		this.emitABC(OpCode.CONCATN, target, base, operands.length);
		if (!useTarget) {
			this.tempTop = tempBase;
		}
	}

	private compileRequireStatement(binding: RequireModuleBinding): void {
		switch (binding.kind) {
			case 'installed':
				return;
			case 'unshaped':
				this.markStaticModulePath(binding.modulePath);
				return;
			case 'source':
				if (binding.moduleInfo.constModule) {
					return;
				}
				this.markStaticModulePath(binding.modulePath);
				return;
		}
	}

	private compileRequireExpression(binding: RequireModuleBinding, target: number, resultCount: number): void {
		switch (binding.kind) {
			case 'installed':
				if (this.program.biosFunctionImportIndex(binding.modulePath, '') !== undefined) {
					this.failStaticFunctionExportRuntimeValue(`${binding.modulePath}:`);
				}
				this.failCompileTimeModuleRootRuntimeUse(binding.modulePath);
			case 'unshaped':
				this.markStaticModulePath(binding.modulePath);
				this.emitLoadBool(target, true);
				if (resultCount > 1) {
					this.emitLoadNil(target + 1, resultCount - 1);
				}
				return;
			case 'source': {
				if (this.isStaticFunctionModuleBinding(binding)) {
					this.failStaticFunctionExportRuntimeValue(`${binding.modulePath}:${binding.exportPathKey}`);
				}
				if (binding.moduleInfo.constModule) {
					this.failCompileTimeModuleRootRuntimeUse(binding.modulePath);
				}
				this.markStaticModulePath(binding.modulePath);
				const rootSlot = binding.moduleInfo.exportSlotsByPathKey.get('');
				if (rootSlot) {
					this.emitModuleSlotRelocLoad(rootSlot, target);
				} else {
					this.emitLoadBool(target, true);
				}
				if (resultCount > 1) {
					this.emitLoadNil(target + 1, resultCount - 1);
				}
				return;
			}
		}
	}

	private compileCallExpression(expression: LuaCallExpression, target: number, resultCount: number): void {
		const requireBinding = this.resolveRequireModuleBinding(expression);
		if (requireBinding) {
			this.compileRequireExpression(requireBinding, target, resultCount);
			return;
		}
		if (this.compileBlua32ClosureCall(expression, target, resultCount)) {
			return;
		}
		const methodName = expression.method?.name;
		const constModuleValueCallee = methodName ? undefined : this.resolveModuleExportConstValue(expression.callee);
		const moduleCallTarget = methodName ? undefined : this.resolveModuleExportCallTarget(expression.callee);
		const ownStaticFunctionExportTarget = methodName ? undefined : this.resolveOwnStaticFunctionExportCallTarget(expression.callee);
		if (constModuleValueCallee) {
			this.failConstModuleValueCall(constModuleValueCallee.binding);
		}
		if (this.staticCallTargetScope && moduleCallTarget === undefined && ownStaticFunctionExportTarget === undefined) {
			throw new Error(`Static function export '${this.protoId}' cannot call a dynamic value. Static function exports call other static exports through link-time symbols.`);
		}
		const callProtoIndex = this.resolveCallProtoIndex(expression);
		const argCount = expression.arguments.length;
		const lastArg = argCount > 0 ? expression.arguments[argCount - 1] : null;
		const hasVarArg = lastArg !== null && this.isMultiReturnExpression(lastArg);
		const fixedArgCount = hasVarArg ? argCount - 1 : argCount;
		const callSlotCount = fixedArgCount + (methodName ? 2 : 1) + (hasVarArg ? 1 : 0);
		const resultSlots = resultCount > 0 ? resultCount : 0;
		const requiredSlots = Math.max(callSlotCount, resultSlots);
		const tempBase = this.tempTop;
		const useTarget = resultCount === 0 || (target >= this.localCount && target === tempBase - 1);
		const callBase = useTarget ? target : this.allocTempBlock(requiredSlots);
		if (useTarget) {
			this.reserveTempRange(callBase, requiredSlots);
		}
		if (methodName) {
			this.reserveTempRange(callBase, 2);
			this.compileExpressionInto(expression.callee, callBase, 1);
			const methodKey = this.program.constIndex(methodName);
			this.emitSelf(callBase, callBase, methodKey);
		} else if (moduleCallTarget !== undefined) {
			this.emitModuleFunctionTargetLoad(moduleCallTarget, callBase);
		} else if (ownStaticFunctionExportTarget !== undefined) {
			this.emitModuleFunctionTargetLoad(ownStaticFunctionExportTarget, callBase);
		} else {
			this.compileExpressionInto(expression.callee, callBase, 1);
		}
		const argBase = callBase + (methodName ? 2 : 1);
		if (useTarget) {
			this.ensureMaxStack(callBase + requiredSlots);
		}
		for (let i = 0; i < fixedArgCount; i += 1) {
			const argReg = this.allocTemp();
			this.compileExpressionInto(expression.arguments[i], argReg, 1);
			const destReg = argBase + i;
			if (argReg !== destReg) {
				this.emitABC(OpCode.MOV, destReg, argReg, 0);
			}
		}
		let callArgs = fixedArgCount + (methodName ? 1 : 0);
		if (hasVarArg) {
			this.compileExpressionInto(expression.arguments[argCount - 1], argBase + fixedArgCount, 0);
			callArgs = 0;
		}
		this.emitABC(OpCode.CALL, callBase, hasVarArg ? 0 : encodeFixedCallArgCount(callArgs), resultCount);
		if (callProtoIndex !== null) {
			this.code[this.code.length - 1].callProtoIndex = callProtoIndex;
		}
		if (!useTarget) {
			for (let i = 0; i < resultCount; i += 1) {
				this.emitABC(OpCode.MOV, target + i, callBase + i, 0);
			}
		}
	}

	private compileBlua32ClosureCall(
		expression: LuaCallExpression,
		target: number,
		resultCount: number,
	): boolean {
		if (expression.method !== null
			|| expression.callee.kind !== LuaSyntaxKind.MemberExpression) {
			return false;
		}
		const callee = expression.callee as LuaMemberExpression;
		if (callee.base.kind !== LuaSyntaxKind.IdentifierExpression) {
			return false;
		}
		const reference = getResolvedIdentifierReference(
			this.semantics,
			callee.base as LuaIdentifierExpression,
		);
		if (reference.kind !== 'reserved_intrinsic' || reference.ref.name !== 'blua32') {
			return false;
		}
		if (callee.member.name !== 'closure') {
			throw new Error(`Unknown blua32 operation '${callee.member.name}'.`);
		}
		if (expression.arguments.length !== 1) {
			throw new Error('blua32.closure expects one function-record address.');
		}
		const addressRegister = this.allocTemp();
		this.compileExpressionInto(expression.arguments[0], addressRegister, 1);
		this.emitClosureAddressRegister(target, addressRegister);
		if (resultCount > 1) {
			this.emitLoadNil(target + 1, resultCount - 1);
		}
		return true;
	}

	private encodeConstOperand(constIndex: number): number {
		if (constIndex <= MAX_EXT_CONST) {
			return -constIndex - 1;
		}
		const reg = this.allocTemp();
		this.emitABx(OpCode.LOADK, reg, constIndex);
		return reg;
	}

	private emitNilTemp(): number {
		const reg = this.allocTemp();
		this.emitLoadNil(reg, 1);
		return reg;
	}

	private isMultiReturnExpression(expression: LuaExpression): boolean {
		if (expression.kind === LuaSyntaxKind.VarargExpression) return true;
		if (expression.kind !== LuaSyntaxKind.CallExpression) return false;
		if (this.resolveRequireModuleBinding(expression)) return false;
		if (this.program.optLevel >= 2) {
			const protoIndex = this.resolveCallProtoIndex(expression);
			if (protoIndex !== null && this.program.protoReturnsOne(protoIndex)) {
				return false;
			}
		}
		return true;
	}

	private emitDefaultReturn(): void {
		const reg = this.allocTemp();
		this.emitLoadNil(reg, 1);
		this.emitABC(OpCode.RET, reg, 1, 0);
	}

	private createLocalFunctionHint(name: string): string {
		const count = (this.localFunctionCounters.get(name) ?? 0) + 1;
		this.localFunctionCounters.set(name, count);
		if (count === 1) {
			return `local:${name}`;
		}
		return `local:${name}#${count}`;
	}

}

function opForAssignment(operator: LuaAssignmentOperator): OpCode {
	switch (operator) {
		case LuaAssignmentOperator.AddAssign:
			return OpCode.ADD;
		case LuaAssignmentOperator.SubtractAssign:
			return OpCode.SUB;
		case LuaAssignmentOperator.MultiplyAssign:
			return OpCode.MUL;
		case LuaAssignmentOperator.DivideAssign:
			return OpCode.DIV;
		case LuaAssignmentOperator.ModulusAssign:
			return OpCode.MOD;
		case LuaAssignmentOperator.ExponentAssign:
			return OpCode.POW;
		default:
			throw new Error(`Unsupported assignment operator: ${operator}`);
	}
}

const buildNamePath = (parts: ReadonlyArray<string>): string => parts.join('.');

const buildDeclarationHint = (identifiers: ReadonlyArray<string>, methodName: string | null): string => {
	if (methodName && methodName.length > 0) {
		const prefix = identifiers.length > 0 ? `${buildNamePath(identifiers)}.` : '';
		return `decl:${prefix}${methodName}`;
	}
	return `decl:${buildNamePath(identifiers)}`;
};

const buildAssignmentHint = (path: ReadonlyArray<string>): string =>
	`assign:${buildNamePath(path)}`;

const extractCompileErrorMessage = (error: unknown, path: string): string => {
	if (error instanceof LuaSyntaxError) {
		const location = error.path === path
			? `${error.line}:${error.column}`
			: `${error.path}:${error.line}:${error.column}`;
		return `${location}: ${error.message}`;
	}
	if (error instanceof Error) {
		return error.message;
	}
	throw new Error(`[ProgramCompiler] Unexpected compile failure for ${path}.`);
};

const buildCompileFailureMessage = (errors: ReadonlyArray<CompileError>): string => {
	const lines: string[] = [`Compilation failed with ${errors.length} error(s):`];
	for (let index = 0; index < errors.length; index += 1) {
		const error = errors[index];
		lines.push(`[${index + 1}/${errors.length}] ${error.stage} ${error.path}: ${error.message}`);
	}
	return lines.join('\n');
};

function requireEntrySource(options: CompileOptions, path: string): string {
	if (options.entrySource === undefined) {
		throw new Error(`[ProgramCompiler] Semantic binding requires source text for '${path}'.`);
	}
	return options.entrySource;
}

function requireModuleSource(module: ProgramModule): string {
	if (module.source === undefined) {
		throw new Error(`[ProgramCompiler] Semantic binding requires source text for module '${module.path}'.`);
	}
	return module.source;
}

function canonicalizeProgramModules(modules: ReadonlyArray<ProgramModule>, label: string): ReadonlyArray<ProgramModule> {
	if (modules.length === 0) {
		return modules;
	}
	const seenPaths = new Set<string>();
	let canonicalModules: ProgramModule[] | null = null;
	let sorted = true;
	let previousPath = '';
	for (let index = 0; index < modules.length; index += 1) {
		const module = modules[index];
		const path = toLuaModulePath(module.path);
		if (seenPaths.has(path)) {
			throw new Error(`[ProgramCompiler] Duplicate ${label} module path '${path}'.`);
		}
		seenPaths.add(path);
		if (index !== 0 && path < previousPath) {
			sorted = false;
		}
		previousPath = path;
		if (path === module.path) {
			if (canonicalModules !== null) {
				canonicalModules.push(module);
			}
			continue;
		}
		if (canonicalModules === null) {
			canonicalModules = modules.slice(0, index);
		}
		const canonicalModule: ProgramModule = {
			path,
			chunk: module.chunk,
		};
		if (module.source !== undefined) {
			canonicalModule.source = module.source;
		}
		if (module.linkValues) {
			canonicalModule.linkValues = module.linkValues;
		}
		canonicalModules.push(canonicalModule);
	}
	const canonical = canonicalModules ?? modules;
	if (sorted) {
		return canonical;
	}
	return canonical.slice().sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
}

function buildCompilerSemanticFrontend(
	entryChunk: LuaChunk,
	modules: ReadonlyArray<ProgramModule>,
	options: CompileOptions,
): LuaSemanticFrontend {
	const sources = [{
		path: entryChunk.range.path,
		source: requireEntrySource(options, entryChunk.range.path),
	}];
	for (let index = 0; index < modules.length; index += 1) {
		const module = modules[index];
		sources.push({
			path: module.path,
			source: requireModuleSource(module),
		});
	}
	return buildLuaSemanticFrontend(sources, {
		extraGlobalNames: SYSTEM_ROM_BOOT_SYMBOL_NAMES,
	});
}

function collectSemanticCompileErrors(frontend: LuaSemanticFrontend, entryPath: string): CompileError[] {
	const compileErrors: CompileError[] = [];
	const paths = frontend.filePaths;
	for (let pathIndex = 0; pathIndex < paths.length; pathIndex += 1) {
		const path = paths[pathIndex];
		const file = frontend.getFile(path);
		if (file.diagnostics.length === 0) {
			continue;
		}
		const stage: CompileError['stage'] = path === entryPath ? 'entry' : 'module';
		for (let diagnosticIndex = 0; diagnosticIndex < file.diagnostics.length; diagnosticIndex += 1) {
			const diagnostic = file.diagnostics[diagnosticIndex];
			compileErrors.push({
				path,
				stage,
				message: `${diagnostic.row + 1}:${diagnostic.startColumn + 1}: ${diagnostic.message}`,
			});
		}
	}
	return compileErrors;
}

function compileFunctionExpression(
	program: ProgramBuilder,
	expression: LuaFunctionExpression,
	parent: FunctionBuilder | null,
	implicitSelf: boolean,
	protoId: string,
	moduleId: string,
	semantics: LuaSemanticFrontendFile,
	frontend: LuaSemanticFrontend,
): number {
	const builder = new FunctionBuilder(program, parent, { moduleId, protoId, semantics, frontend });
	builder.compileFunctionExpression(expression, implicitSelf);
	const code = builder.getCode();
	const ranges = builder.getRanges();
	const constRelocs = builder.getConstRelocs();
	const instructionSet = builder.getInstructionSet();
	const localSlots = builder.getLocalDebugSlots();
	const protoIndex = program.addProto({
		entryPC: 0,
		codeLen: ranges.length * INSTRUCTION_BYTES,
		numParams: expression.parameters.length + (implicitSelf ? 1 : 0),
			isVararg: expression.hasVararg,
			maxStack: builder.getMaxStack(),
			upvalueDescs: builder.getUpvalueDescs(),
			staticClosure: false,
	}, code, ranges, builder.getInlineCallSites(), constRelocs, builder.getStatementPoints(), builder.getResumePoints(), localSlots, builder.getUpvalueNames(), protoId, instructionSet);
	return protoIndex;
}

function compileSectionInitProto(
	program: ProgramBuilder,
	moduleId: string,
	range: LuaSourceRange,
	semantics: LuaSemanticFrontendFile,
	frontend: LuaSemanticFrontend,
): number {
	const protoId = buildSectionInitProtoId(moduleId);
	const builder = new FunctionBuilder(program, null, { moduleId, protoId, semantics, frontend });
	builder.compileSectionInit(range);
	const code = builder.getCode();
	const ranges = builder.getRanges();
	const constRelocs = builder.getConstRelocs();
	const instructionSet = builder.getInstructionSet();
	const protoIndex = program.addProto({
		entryPC: 0,
		codeLen: ranges.length * INSTRUCTION_BYTES,
		numParams: 0,
		isVararg: false,
		maxStack: builder.getMaxStack(),
		upvalueDescs: [],
		staticClosure: true,
	}, code, ranges, builder.getInlineCallSites(), constRelocs, builder.getStatementPoints(), builder.getResumePoints(), builder.getLocalDebugSlots(), [], protoId, instructionSet);
	program.markStaticClosureProto(protoIndex);
	return protoIndex;
}

function compileStartupProto(
	program: ProgramBuilder,
	moduleId: string,
	range: LuaSourceRange,
	semantics: LuaSemanticFrontendFile,
	frontend: LuaSemanticFrontend,
	sectionInitProtoIndex: number,
	entryProtoIndex: number,
	clearBootPrimitives: boolean,
): number {
	const protoId = buildStartupProtoId(moduleId);
	const builder = new FunctionBuilder(program, null, { moduleId, protoId, semantics, frontend });
	builder.compileStartup(range, sectionInitProtoIndex, entryProtoIndex, clearBootPrimitives);
	const code = builder.getCode();
	const ranges = builder.getRanges();
	const constRelocs = builder.getConstRelocs();
	const instructionSet = builder.getInstructionSet();
	const protoIndex = program.addProto({
		entryPC: 0,
		codeLen: ranges.length * INSTRUCTION_BYTES,
		numParams: 0,
		isVararg: false,
		maxStack: builder.getMaxStack(),
		upvalueDescs: [],
		staticClosure: true,
	}, code, ranges, builder.getInlineCallSites(), constRelocs, builder.getStatementPoints(), builder.getResumePoints(), builder.getLocalDebugSlots(), [], protoId, instructionSet);
	program.markStaticClosureProto(protoIndex);
	return protoIndex;
}

function compileInitProto(
	program: ProgramBuilder,
	moduleId: string,
	range: LuaSourceRange,
	semantics: LuaSemanticFrontendFile,
	frontend: LuaSemanticFrontend,
	participants: ReadonlyArray<InitParticipantBinding>,
): number {
	const protoId = buildInitProtoId(moduleId);
	const builder = new FunctionBuilder(program, null, { moduleId, protoId, semantics, frontend });
	builder.compileInitVector(range, participants);
	const code = builder.getCode();
	const ranges = builder.getRanges();
	const constRelocs = builder.getConstRelocs();
	const instructionSet = builder.getInstructionSet();
	const protoIndex = program.addProto({
		entryPC: 0,
		codeLen: ranges.length * INSTRUCTION_BYTES,
		numParams: 0,
		isVararg: false,
		maxStack: builder.getMaxStack(),
		upvalueDescs: [],
		staticClosure: true,
	}, code, ranges, builder.getInlineCallSites(), constRelocs, builder.getStatementPoints(), builder.getResumePoints(), builder.getLocalDebugSlots(), [], protoId, instructionSet);
	program.markStaticClosureProto(protoIndex);
	return protoIndex;
}

function compileInterruptProto(
	program: ProgramBuilder,
	moduleId: string,
	range: LuaSourceRange,
	semantics: LuaSemanticFrontendFile,
	frontend: LuaSemanticFrontend,
): number {
	const protoId = buildInterruptProtoId(moduleId);
	const builder = new FunctionBuilder(program, null, { moduleId, protoId, semantics, frontend });
	builder.compileInterruptEntry(range);
	const code = builder.getCode();
	const ranges = builder.getRanges();
	const constRelocs = builder.getConstRelocs();
	const instructionSet = builder.getInstructionSet();
	const protoIndex = program.addProto({
		entryPC: 0,
		codeLen: ranges.length * INSTRUCTION_BYTES,
		numParams: 0,
		isVararg: false,
		maxStack: builder.getMaxStack(),
		upvalueDescs: [],
		staticClosure: true,
	}, code, ranges, builder.getInlineCallSites(), constRelocs, builder.getStatementPoints(), builder.getResumePoints(), builder.getLocalDebugSlots(), [], protoId, instructionSet);
	program.markStaticClosureProto(protoIndex);
	return protoIndex;
}

function compileExceptionProto(
	program: ProgramBuilder,
	moduleId: string,
	range: LuaSourceRange,
	semantics: LuaSemanticFrontendFile,
	frontend: LuaSemanticFrontend,
): number {
	const protoId = buildExceptionProtoId(moduleId);
	const builder = new FunctionBuilder(program, null, { moduleId, protoId, semantics, frontend });
	builder.compileExceptionEntry(range);
	const code = builder.getCode();
	const ranges = builder.getRanges();
	const constRelocs = builder.getConstRelocs();
	const instructionSet = builder.getInstructionSet();
	const protoIndex = program.addProto({
		entryPC: 0,
		codeLen: ranges.length * INSTRUCTION_BYTES,
		numParams: 1,
		isVararg: false,
		maxStack: builder.getMaxStack(),
		upvalueDescs: [],
		staticClosure: true,
	}, code, ranges, builder.getInlineCallSites(), constRelocs, builder.getStatementPoints(), builder.getResumePoints(), builder.getLocalDebugSlots(), [], protoId, instructionSet);
	program.markStaticClosureProto(protoIndex);
	return protoIndex;
}

export function compileLuaChunkToProgram(
	chunk: LuaChunk,
	modules: ReadonlyArray<ProgramModule>,
	options: SystemCompileOptions,
): CompiledSystemProgram;
export function compileLuaChunkToProgram(
	chunk: LuaChunk,
	modules?: ReadonlyArray<ProgramModule>,
	options?: CartCompileOptions,
): CompiledCartProgram;
export function compileLuaChunkToProgram(
	chunk: LuaChunk,
	modules: ReadonlyArray<ProgramModule> = EMPTY_PROGRAM_MODULES,
	options: CompileOptions = {},
): CompiledProgram {
	const optLevel = options.optLevel ?? 0;
	const programDomain: ProgramCompileDomain = options.programDomain === 'system'
		? 'system'
		: 'cart';
	const canonicalModules = canonicalizeProgramModules(modules, 'program');
	const frontend = buildCompilerSemanticFrontend(chunk, canonicalModules, options);
	const moduleCompileContext = buildModuleCompileContext(canonicalModules, frontend);
	const semanticErrors = collectSemanticCompileErrors(frontend, chunk.range.path);
	if (semanticErrors.length > 0) {
		throw new Error(buildCompileFailureMessage(semanticErrors));
	}
	const compileErrors: CompileError[] = [];
	try {
		validateInitParticipantPlacement(chunk);
	} catch (error) {
		compileErrors.push({
			path: chunk.range.path,
			stage: 'entry',
			message: extractCompileErrorMessage(error, chunk.range.path),
		});
	}
	for (let index = 0; index < canonicalModules.length; index += 1) {
		const module = canonicalModules[index];
		try {
			const moduleInfo = moduleCompileContext.modulesByPath.get(module.path);
			validateInitParticipantPlacement(
				module.chunk,
				module.chunk.constModule || (moduleInfo !== undefined && moduleInfo.constModule),
			);
		} catch (error) {
			compileErrors.push({
				path: module.path,
				stage: 'module',
				message: extractCompileErrorMessage(error, module.path),
			});
		}
	}
	if (compileErrors.length > 0) {
		throw new Error(buildCompileFailureMessage(compileErrors));
	}
	const programBuilder = new ProgramBuilder(optLevel, programDomain);
	if (programDomain === 'cart') {
		const biosFunctions = options.biosFunctions;
		if (biosFunctions) {
			for (let index = 0; index < biosFunctions.length; index += 1) {
				const symbol = biosFunctions[index];
				if (moduleCompileContext.modulePaths.has(symbol.path)) {
					throw new Error(`BIOS import module '${symbol.path}' conflicts with a source module.`);
				}
				programBuilder.recordBiosFunctionImport(symbol.path, symbol.exportPathKey, index);
			}
		}
	}
	recordModuleExportContracts(programBuilder, moduleCompileContext);
	for (let index = 0; index < canonicalModules.length; index += 1) {
		const module = canonicalModules[index];
		const info = moduleCompileContext.modulesByPath.get(module.path);
		if (info === undefined || !info.staticStorage) {
			continue;
		}
		const builder = new FunctionBuilder(programBuilder, null, {
			moduleId: module.path,
			protoId: buildModuleProtoId(module.path),
			semantics: frontend.getFile(module.path),
			frontend,
			moduleCompileContext,
			moduleCompileInfo: info,
		});
		try {
			builder.compileStaticModuleScope(module.chunk);
			builder.compileStaticStorage(collectStaticStorageDeclarations(module.chunk, frontend.getFile(module.path)));
		} catch (error) {
			compileErrors.push({
				path: module.path,
				stage: 'module',
				message: extractCompileErrorMessage(error, module.path),
			});
		}
	}
	for (let index = 0; index < canonicalModules.length; index += 1) {
		const module = canonicalModules[index];
		const info = moduleCompileContext.modulesByPath.get(module.path);
		if (info === undefined || info.staticFunctionExportByPathKey.size === 0) {
			continue;
		}
		try {
			const semantics = frontend.getFile(module.path);
			const moduleProtoId = buildModuleProtoId(module.path);
			const staticScope = new FunctionBuilder(programBuilder, null, {
				moduleId: module.path,
				protoId: moduleProtoId,
				semantics,
				frontend,
				moduleCompileContext,
				moduleCompileInfo: info,
				staticCallTargetScope: true,
			});
			staticScope.compileStaticModuleScope(module.chunk);
			const exports = collectStaticFunctionExports(module.chunk, semantics, info.staticFunctionExportByPathKey);
			for (let exportIndex = 0; exportIndex < exports.length; exportIndex += 1) {
				const fn = exports[exportIndex];
				const protoId = buildProtoId(moduleProtoId, `static:${fn.symbolHandle}`);
				const protoIndex = compileFunctionExpression(programBuilder, fn.expression, staticScope, false, protoId, module.path, semantics, frontend);
				if (!programBuilder.protoHasNoUpvalues(protoIndex)) {
					const upvalueNames = programBuilder.getProtoUpvalueNames(protoIndex);
					throw new Error(`Const module '${module.path}' function export '${fn.symbolHandle}' captures runtime local '${upvalueNames[0]}'; function exports may use compile-time constants, parameters, function-local declarations, static calls, and static storage only.`);
				}
				assertStaticFunctionInstructionSet(module.path, fn.symbolHandle, programBuilder.protoInstructionSets[protoIndex], programBuilder.constPool);
				programBuilder.markStaticClosureProto(protoIndex);
				for (let slotIndex = 0; slotIndex < fn.slotNames.length; slotIndex += 1) {
					programBuilder.recordExportProto(fn.slotNames[slotIndex], protoId);
				}
			}
		} catch (error) {
			compileErrors.push({
				path: module.path,
				stage: 'module',
				message: extractCompileErrorMessage(error, module.path),
			});
		}
	}
	if (compileErrors.length > 0) {
		throw new Error(buildCompileFailureMessage(compileErrors));
	}
	const moduleId = chunk.range.path;
	const entryProtoId = buildEntryProtoId(moduleId);
	let entryProtoIndex = -1;
	let startupProtoIndex = -1;
	let sectionInitProtoIndex = -1;
	let irqProtoIndex = -1;
	let exceptionProtoIndex = -1;
	let initProtoIndex: number | null = null;
	const entryBuilder = new FunctionBuilder(programBuilder, null, {
		moduleId,
		protoId: entryProtoId,
		semantics: frontend.getFile(chunk.range.path),
		frontend,
		moduleCompileContext,
	});
	try {
		entryBuilder.compileChunk(chunk);
		const entryCode = entryBuilder.getCode();
		const entryRanges = entryBuilder.getRanges();
		const entryConstRelocs = entryBuilder.getConstRelocs();
		const entryLocalSlots = entryBuilder.getLocalDebugSlots();
		const entryInstructionSet = entryBuilder.getInstructionSet();
		entryProtoIndex = programBuilder.addProto({
			entryPC: 0,
			codeLen: entryRanges.length * INSTRUCTION_BYTES,
			numParams: 0,
				isVararg: false,
				maxStack: entryBuilder.getMaxStack(),
				upvalueDescs: entryBuilder.getUpvalueDescs(),
				staticClosure: false,
			}, entryCode, entryRanges, entryBuilder.getInlineCallSites(), entryConstRelocs, entryBuilder.getStatementPoints(), entryBuilder.getResumePoints(), entryLocalSlots, entryBuilder.getUpvalueNames(), entryProtoId, entryInstructionSet);
	} catch (error) {
		compileErrors.push({
			path: chunk.range.path,
			stage: 'entry',
			message: extractCompileErrorMessage(error, chunk.range.path),
		});
	}
	for (let i = 0; i < canonicalModules.length; i += 1) {
		const module = canonicalModules[i];
		// Const modules are compile-time symbol tables: their exports are inlined at
		// use sites, so they carry no runtime proto and are never statically initialized.
		const moduleInfo = moduleCompileContext.modulesByPath.get(module.path);
		if (moduleInfo && moduleInfo.constModule) {
			continue;
		}
		const moduleProtoId = buildModuleProtoId(module.path);
		const builder = new FunctionBuilder(programBuilder, null, {
			moduleId: module.path,
			protoId: moduleProtoId,
			semantics: frontend.getFile(module.path),
			frontend,
			moduleCompileContext,
			moduleCompileInfo: moduleCompileContext.modulesByPath.get(module.path),
		});
		try {
			builder.compileChunk(module.chunk);
			const code = builder.getCode();
			const ranges = builder.getRanges();
			const constRelocs = builder.getConstRelocs();
			const localSlots = builder.getLocalDebugSlots();
			const instructionSet = builder.getInstructionSet();
			const protoIndex = programBuilder.addProto({
				entryPC: 0,
				codeLen: ranges.length * INSTRUCTION_BYTES,
				numParams: 0,
				isVararg: false,
				maxStack: builder.getMaxStack(),
				upvalueDescs: builder.getUpvalueDescs(),
				staticClosure: false,
			}, code, ranges, builder.getInlineCallSites(), constRelocs, builder.getStatementPoints(), builder.getResumePoints(), localSlots, builder.getUpvalueNames(), moduleProtoId, instructionSet);
			programBuilder.recordModuleProto(module.path, protoIndex);
		} catch (error) {
			compileErrors.push({
				path: module.path,
				stage: 'module',
				message: extractCompileErrorMessage(error, module.path),
			});
		}
	}
	if (compileErrors.length > 0) {
		throw new Error(buildCompileFailureMessage(compileErrors));
	}
	const entrySemantics = frontend.getFile(chunk.range.path);
	sectionInitProtoIndex = compileSectionInitProto(programBuilder, moduleId, chunk.range, entrySemantics, frontend);
	irqProtoIndex = compileInterruptProto(programBuilder, moduleId, chunk.range, entrySemantics, frontend);
	exceptionProtoIndex = compileExceptionProto(programBuilder, moduleId, chunk.range, entrySemantics, frontend);
	if (programDomain === 'system') {
		for (let index = 0; index < canonicalModules.length; index += 1) {
			entryBuilder.markStaticModulePath(canonicalModules[index].path);
		}
	}
	const initParticipants = programBuilder.orderedInitParticipants(moduleId);
	if (initParticipants.length !== 0) {
		initProtoIndex = compileInitProto(
			programBuilder,
			moduleId,
			chunk.range,
			entrySemantics,
			frontend,
			initParticipants,
		);
	}
	startupProtoIndex = compileStartupProto(
		programBuilder,
		moduleId,
		chunk.range,
		entrySemantics,
		frontend,
		sectionInitProtoIndex,
		entryProtoIndex,
		programDomain === 'system',
	);
	const {
		program,
		metadata,
		imageConstRelocs,
		biosFunctionConstRelocs,
		constValueRelocs,
		rodataConstRelocs,
		data,
		bss,
		rodataBytes,
		rodataSymbols,
		staticModulePaths,
	} = programBuilder.buildProgram(initParticipants);
	if (programDomain === 'system') {
		return {
			domain: 'system',
			program,
			metadata,
			entryProtoIndex,
			startupProtoIndex,
			sectionInitProtoIndex,
			irqProtoIndex,
			exceptionProtoIndex,
			initProtoIndex,
			moduleProtoMap: program.moduleProtoMap,
			staticModulePaths,
			constRelocs: imageConstRelocs,
			constValueRelocs,
			rodataConstRelocs,
			data,
			bss,
			rodataBytes,
			rodataSymbols,
		};
	}
	return {
		domain: 'cart',
		program,
		metadata,
		entryProtoIndex,
		startupProtoIndex,
		sectionInitProtoIndex,
		irqProtoIndex,
		exceptionProtoIndex,
		initProtoIndex,
		moduleProtoMap: program.moduleProtoMap,
		staticModulePaths,
		constRelocs: imageConstRelocs,
		biosFunctionConstRelocs,
		constValueRelocs,
		rodataConstRelocs,
		data,
		bss,
		rodataBytes,
		rodataSymbols,
	};
}
// end normalized-body-acceptable
// end repeated-sequence-acceptable
