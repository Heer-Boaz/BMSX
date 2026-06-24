// start repeated-sequence-acceptable -- Program codegen keeps opcode/slot emission direct; helper extraction would add dispatch in compile hot paths.
// start normalized-body-acceptable -- Resolver/emitter specializations share shapes but preserve distinct compiler ownership.
import {
	LuaAssignmentOperator,
	LuaBinaryOperator,
	LuaSyntaxKind,
	LuaTableFieldKind,
	LuaUnaryOperator,
	type LuaAssignableExpression,
	type LuaAssignmentStatement,
	type LuaBinaryExpression,
	type LuaCallExpression,
	type LuaChunk,
	type LuaExpression,
	type LuaForGenericStatement,
	type LuaFunctionExpression,
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
} from '../../lua/syntax/ast';
import { OpCode, StringValue, asStringId, valueIsString, type Program, type ProgramMetadata, type Proto, type UpvalueDesc, type Value, type SourceRange, type LocalSlotDebug } from '../cpu/cpu';
import { optimizeInstructions, type Instruction, type InstructionSet, type OptimizationLevel } from './optimizer';
import {
	buildModuleCompileContext,
	type ConstExportValue,
	type ModuleCompileContext,
	type ModuleCompileInfo,
	type ModuleExportNode,
	type ProgramModule,
} from './compiler/module_contract';
import { extractAssignmentPath, extractTableKeyFromExpression } from './compiler/expression_paths';
import { appendModuleExportPathKey, buildModuleExportPathKey, buildModuleExportSlotName, buildModuleRootFieldSlotName } from './compiler/module_names';
import { collectStaticStorageDeclarations, type StaticStorageDeclaration } from './compiler/static_storage';
import { collectStaticFunctionExports } from './compiler/static_functions';
import { assertStaticFunctionInstructionSet } from './compiler/static_proto_contract';
import {
	buildProgramRomImage,
	encodeProgramObjectSections,
	toLuaModulePath,
	type ProgramConstReloc,
	type ProgramConstValueReloc,
	type ProgramDataSection,
	type ProgramDataSymbol,
	type ProgramBssSection,
	type ProgramBssSymbol,
	type ProgramRodataSymbol,
	type ProgramImage,
} from './loader';
import { StringPool } from '../cpu/string_pool';
import { EXT_A_BITS, EXT_B_BITS, EXT_BX_BITS, EXT_C_BITS, INSTRUCTION_BYTES, MAX_BX_BITS, MAX_EXT_CONST, MAX_EXT_REGISTER_BC, MAX_OPERAND_BITS, MAX_SIGNED_BX, MIN_SIGNED_BX, writeInstruction } from '../cpu/instruction_format';
import { buildLuaSemanticFrontend, type LuaBoundReference, type LuaSemanticFrontend, type LuaSemanticFrontendFile } from '../../lua/semantic/frontend';
import { MMIO_REGISTER_SPEC_BY_ADDRESS, MMIO_REGISTER_SPEC_BY_NAME, type MmioWriteRequirement } from '../bus/registers';
import { ValueKindFlowAnalyzer, type SymbolFlowState } from './compile_value_flow';
import { SYSTEM_ROM_GLOBAL_NAMES, SYSTEM_ROM_GLOBAL_NAME_SET } from '../firmware/system_globals';
import { LuaSyntaxError } from '../../lua/errors';
import { Decl } from '../../lua/semantic/model';
import {
	IMPLICIT_SELF_SYMBOL_HANDLE,
	getBoundIdentifierReference as getResolvedIdentifierReference,
	getReferenceSymbolHandle as getResolvedReferenceSymbolHandle,
} from './bound_reference';
import {
	classifyAssignmentTargetPreparation,
	classifyFunctionDeclarationTarget,
} from './target_semantics';
import { getMemoryAccessKindForName, MemoryAccessKind } from '../memory/access_kind';
import { luaModulo } from '../../lua/numeric';
import { writeLE16, writeLE32 } from '../../common/endian';
import { isReservedIntrinsicName } from '../../lua/semantic/common';
import { IO_IRQ_FLAGS } from '../bus/io';

export type CompiledProgram = {
	program: Program;
	metadata: ProgramMetadata;
	entryProtoIndex: number;
	sectionInitProtoIndex: number;
	irqProtoIndex: number;
	moduleProtoMap: Map<string, number>;
	staticModulePaths: string[];
	constRelocs: ProgramConstReloc[];
	constValueRelocs: ProgramConstValueReloc[];
	data: ProgramDataSection;
	bss: ProgramBssSection;
	rodataBytes: Uint8Array;
	rodataSymbols: ProgramRodataSymbol[];
};

export type AppendedProgram = {
	program: Program;
	metadata: ProgramMetadata;
	entryProtoIndex: number;
	sectionInitProtoIndex: number;
	constRelocs: ProgramConstReloc[];
	constValueRelocs: ProgramConstValueReloc[];
	data: ProgramDataSection;
	bss: ProgramBssSection;
	rodataBytes: Uint8Array;
	rodataSymbols: ProgramRodataSymbol[];
};

const encodeCompilerProgramImage = (
	program: Program,
	entryProtoIndex: number,
	sectionInitProtoIndex: number,
	irqProtoIndex: number,
	moduleProtos: Array<{ path: string; protoIndex: number }>,
	staticModulePaths: string[],
	constRelocs: ProgramConstReloc[],
	constValueRelocs: ProgramConstValueReloc[],
	data: ProgramDataSection,
	bss: ProgramBssSection,
	rodataBytes: Uint8Array,
	rodataSymbols: ProgramRodataSymbol[],
): ProgramImage => ({
	vectors: {
		resetProtoIndex: entryProtoIndex,
		sectionInitProtoIndex,
		irqProtoIndex,
	},
	sections: encodeProgramObjectSections(program, moduleProtos, staticModulePaths, data, bss, rodataBytes, rodataSymbols),
	link: { constRelocs, constValueRelocs },
});

export function encodeCompiledProgramImage(compiled: CompiledProgram): ProgramImage {
	return encodeCompilerProgramImage(
		compiled.program,
		compiled.entryProtoIndex,
		compiled.sectionInitProtoIndex,
		compiled.irqProtoIndex,
		Array.from(compiled.moduleProtoMap, ([path, protoIndex]) => ({ path, protoIndex })),
		compiled.staticModulePaths,
		compiled.constRelocs,
		compiled.constValueRelocs,
		compiled.data,
		compiled.bss,
		compiled.rodataBytes,
		compiled.rodataSymbols,
	);
}

// A host-eval append compiles a one-shot chunk against an already-installed base
// program, so it introduces no module/static-module protos of its own: the executable
// image carries an empty module map and no static-module paths.
export function encodeAppendedProgramImage(compiled: AppendedProgram): ProgramImage {
	return encodeCompilerProgramImage(compiled.program, compiled.entryProtoIndex, compiled.sectionInitProtoIndex, compiled.sectionInitProtoIndex, [], [], compiled.constRelocs, compiled.constValueRelocs, compiled.data, compiled.bss, compiled.rodataBytes, compiled.rodataSymbols);
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

type CompileOptions = {
	baseProgram?: Program;
	baseMetadata?: ProgramMetadata;
	optLevel?: OptimizationLevel;
	entrySource?: string;
	externalModules?: ReadonlyArray<ProgramModule>;
	constModulePaths?: ReadonlyArray<string>;
};

const EMPTY_PROGRAM_MODULES: ReadonlyArray<ProgramModule> = [];

type LoopContext = {
	breakJumps: number[];
};

type ScopeFrame = {
	locals: LocalBinding[];
	range: SourceRange;
};

type LocalBindingKind = 'local' | 'const' | 'parameter';

type LocalBinding = {
	symbolHandle: string;
	name: string;
	reg: number;
	kind: LocalBindingKind;
	constValue: Value | null;
	hasConstValue: boolean;
	constClosureProtoIndex: number | null;
	moduleBinding: ModuleBinding | null;
	structView: StructView | null;
};

type ModuleBinding = {
	modulePath: string;
	exportPathKey: string;
	exportDepth: number;
	external: boolean;
};

type PrimitiveStructType = {
	size: number;
	alignment: number;
	accessKind: MemoryAccessKind;
};

type StructResolvedType = {
	name: string;
	baseSize: number;
	baseAlignment: number;
	baseAccessKind: MemoryAccessKind | null;
	baseStruct: StructLayout | null;
	size: number;
	alignment: number;
	accessKind: MemoryAccessKind | null;
	struct: StructLayout | null;
	dimensions: number[];
};

type StructFieldLayout = {
	name: string;
	type: StructResolvedType;
	offset: number;
	size: number;
	accessKind: MemoryAccessKind | null;
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
	| { kind: 'memory'; accessKind: MemoryAccessKind; addrConst?: number; addrReg?: number; addrOffsetBytes?: number; validateAddress?: LuaExpression };

const RK_B = 1;
const RK_C = 2;

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
	['u8', { size: 1, alignment: 1, accessKind: MemoryAccessKind.U8 }],
	['i8', { size: 1, alignment: 1, accessKind: MemoryAccessKind.U8 }],
	['u16', { size: 2, alignment: 2, accessKind: MemoryAccessKind.U16LE }],
	['i16', { size: 2, alignment: 2, accessKind: MemoryAccessKind.U16LE }],
	['u32', { size: 4, alignment: 4, accessKind: MemoryAccessKind.U32LE }],
	['i32', { size: 4, alignment: 4, accessKind: MemoryAccessKind.U32LE }],
	['f32', { size: 4, alignment: 4, accessKind: MemoryAccessKind.F32LE }],
	['f64', { size: 8, alignment: 4, accessKind: MemoryAccessKind.F64LE }],
	['addr', { size: 4, alignment: 4, accessKind: MemoryAccessKind.U32LE }],
	['word', { size: 4, alignment: 4, accessKind: MemoryAccessKind.Word }],
]);

const isSmallSignedImmediate = (value: number): boolean =>
	Number.isInteger(value) && value >= MIN_SIGNED_BX && value <= MAX_SIGNED_BX;

class ProgramBuilder {
	public readonly constPool: Value[];
	public readonly stringPool: StringPool;
	public readonly optLevel: OptimizationLevel;
	private readonly constMap: Map<string, number>;
	private readonly baseCode: Uint8Array | null;
	private readonly systemGlobalNameSet: Set<string>;
	private readonly systemGlobalNames: string[] = [];
	private readonly systemGlobalNameMap: Map<string, number> = new Map();
	private readonly globalNames: string[] = [];
	private readonly globalNameMap: Map<string, number> = new Map();
	public readonly protos: Proto[] = [];
	public readonly protoCode: Uint8Array[] = [];
	public readonly protoRanges: ReadonlyArray<SourceRange | null>[] = [];
	public readonly protoConstRelocs: ReadonlyArray<ProgramConstReloc>[] = [];
	public readonly protoLocalSlots: ReadonlyArray<LocalSlotDebug>[] = [];
	public readonly protoUpvalueNames: ReadonlyArray<string>[] = [];
	public readonly protoInstructionSets: Array<InstructionSet | null> = [];
	public readonly protoFixedEntryPC: boolean[] = [];
	public readonly protoIds: string[] = [];
	private readonly exportProtoIdBySlot: { [slotName: string]: string } = {};
	private readonly structDeclarations = new Map<string, LuaStructDeclarationStatement>();
	private readonly structLayouts = new Map<string, StructLayout>();
	private readonly bssBindingsBySymbolHandle = new Map<string, BssBinding>();
	private readonly dataBindingsBySymbolHandle = new Map<string, DataBinding>();
	private readonly rodataBindingsBySymbolHandle = new Map<string, RodataBinding>();
	private readonly constValueRelocs: ProgramConstValueReloc[] = [];
	private bssByteCount = 0;
	private dataByteCount = 0;
	private dataBytes = new Uint8Array(0);
	private rodataByteCount = 0;
	private rodataBytes = new Uint8Array(0);
	private readonly protoIdMap: Map<string, number> = new Map();
	private readonly assignedProtoIds: Set<string> = new Set();
	private readonly staticModulePaths: string[] = [];
	private readonly staticModulePathSet: Set<string> = new Set();
	private readonly baseProgramRom: Uint8Array | null;
	private readonly baseProgramRomTextByteLength: number;
	private readonly canDeclareStaticStorage: boolean;

	public constructor(
		baseConstPool: ReadonlyArray<Value> | null = null,
		stringPool: StringPool | null = null,
		optLevel: OptimizationLevel = 0,
		baseMetadata: ProgramMetadata | null = null,
		baseCode: Uint8Array | null = null,
		baseProgramRom: Uint8Array | null = null,
		baseProgramRomTextByteLength = 0,
		canDeclareStaticStorage = true,
	) {
		this.constPool = [];
		if (baseConstPool) {
			for (let index = 0; index < baseConstPool.length; index += 1) {
				this.constPool.push(baseConstPool[index]);
			}
		}
		this.stringPool = stringPool ?? new StringPool();
		this.optLevel = optLevel;
		if (baseCode !== null && baseCode.byteLength % INSTRUCTION_BYTES !== 0) {
			throw new Error(`[ProgramBuilder] Base program code size must align to ${INSTRUCTION_BYTES}-byte words.`);
		}
		this.baseCode = baseCode;
		this.baseProgramRom = baseProgramRom;
		this.baseProgramRomTextByteLength = baseProgramRomTextByteLength;
		this.canDeclareStaticStorage = canDeclareStaticStorage;
		this.constMap = new Map<string, number>();
		this.systemGlobalNameSet = new Set(SYSTEM_ROM_GLOBAL_NAME_SET);
		for (let index = 0; index < this.constPool.length; index += 1) {
			const value = this.constPool[index];
			this.constMap.set(this.makeConstKey(value), index);
		}
		this.seedGlobalSlots(baseMetadata);
	}

	private seedGlobalSlots(metadata: ProgramMetadata | null): void {
		if (!metadata) {
			return;
		}
		const systemNames = metadata.systemGlobalNames;
		for (let index = 0; index < systemNames.length; index += 1) {
			const name = systemNames[index];
			this.systemGlobalNames.push(name);
			this.systemGlobalNameMap.set(name, index);
		}
		const globalNames = metadata.globalNames;
		for (let index = 0; index < globalNames.length; index += 1) {
			const name = globalNames[index];
			this.globalNames.push(name);
			this.globalNameMap.set(name, index);
		}
	}

	public internString(value: string): StringValue {
		return StringValue.get(this.stringPool.intern(value));
	}

	public constIndexString(value: string): number {
		return this.constIndex(this.internString(value));
	}

	public constIndex(value: Value): number {
		const key = this.makeConstKey(value);
		const existing = this.constMap.get(key);
		if (existing !== undefined) {
			return existing;
		}
		const index = this.constPool.length;
		this.constPool.push(value);
		this.constMap.set(key, index);
		return index;
	}

	public constValueRelocIndex(kind: ProgramConstValueReloc['kind'], symbol: string, addend: number): number {
		const index = this.constPool.length;
		this.constPool.push(0);
		this.constValueRelocs.push({
			constIndex: index,
			kind,
			symbol,
			addend,
		});
		return index;
	}

	public resolveGlobalAccess(name: string): { system: boolean; slot: number } {
		if (this.systemGlobalNameSet.has(name)) {
			return { system: true, slot: this.resolveSystemGlobalSlot(name) };
		}
		return { system: false, slot: this.resolveGlobalSlot(name) };
	}

	public recordBss(symbolHandle: string, moduleId: string, name: string, type: StructResolvedType): BssBinding {
		this.assertStaticStorageAllowed('bss');
		const existing = this.bssBindingsBySymbolHandle.get(symbolHandle);
		if (existing !== undefined) {
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

	public resolveBss(symbolHandle: string): BssBinding | null {
		const binding = this.bssBindingsBySymbolHandle.get(symbolHandle);
		return binding === undefined ? null : binding;
	}

	public recordData(symbolHandle: string, moduleId: string, name: string, type: StructResolvedType, bytes: Uint8Array): DataBinding {
		this.assertStaticStorageAllowed('data');
		const existing = this.dataBindingsBySymbolHandle.get(symbolHandle);
		if (existing !== undefined) {
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

	public resolveData(symbolHandle: string): DataBinding | null {
		const binding = this.dataBindingsBySymbolHandle.get(symbolHandle);
		return binding === undefined ? null : binding;
	}

	public recordRodata(symbolHandle: string, moduleId: string, name: string, type: StructResolvedType, bytes: Uint8Array): RodataBinding {
		this.assertStaticStorageAllowed('rodata');
		const existing = this.rodataBindingsBySymbolHandle.get(symbolHandle);
		if (existing !== undefined) {
			return existing;
		}
		const offset = this.alignStorageOffset(this.rodataByteCount, type.alignment);
		const nextByteCount = this.alignStorageOffset(offset + bytes.byteLength, 4);
		const nextBytes = new Uint8Array(nextByteCount);
		nextBytes.set(this.rodataBytes, 0);
		nextBytes.set(bytes, offset);
		this.rodataBytes = nextBytes;
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

	public resolveRodata(symbolHandle: string): RodataBinding | null {
		const binding = this.rodataBindingsBySymbolHandle.get(symbolHandle);
		return binding === undefined ? null : binding;
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

	public buildDataSection(): ProgramDataSection {
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

	public buildBssSection(): ProgramBssSection {
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

	private assertStaticStorageAllowed(kind: 'bss' | 'data' | 'rodata'): void {
		if (!this.canDeclareStaticStorage) {
			throw new Error(`[Compiler] Host-eval append cannot declare .${kind} storage; static storage belongs to full object builds.`);
		}
	}

	public registerStructDeclaration(statement: LuaStructDeclarationStatement): void {
		this.structDeclarations.set(statement.name.name, statement);
		this.structLayouts.delete(statement.name.name);
	}

	public getStructDeclaration(name: string): LuaStructDeclarationStatement | undefined {
		return this.structDeclarations.get(name);
	}

	public getStructLayout(name: string): StructLayout | undefined {
		return this.structLayouts.get(name);
	}

	public recordStructLayout(layout: StructLayout): void {
		this.structLayouts.set(layout.name, layout);
	}

	private resolveSystemGlobalSlot(name: string): number {
		const existing = this.systemGlobalNameMap.get(name);
		if (existing !== undefined) {
			return existing;
		}
		const index = this.systemGlobalNames.length;
		this.systemGlobalNames.push(name);
		this.systemGlobalNameMap.set(name, index);
		return index;
	}

	private resolveGlobalSlot(name: string): number {
		const existing = this.globalNameMap.get(name);
		if (existing !== undefined) {
			return existing;
		}
		const index = this.globalNames.length;
		this.globalNames.push(name);
		this.globalNameMap.set(name, index);
		return index;
	}

	public addProto(
		proto: Proto,
		code: Uint8Array,
		ranges: ReadonlyArray<SourceRange | null>,
		constRelocs: ReadonlyArray<ProgramConstReloc>,
		localSlots: ReadonlyArray<LocalSlotDebug>,
		upvalueNames: ReadonlyArray<string>,
		protoId: string,
		instructionSet: InstructionSet | null,
	): number {
		if (this.assignedProtoIds.has(protoId)) {
			throw new Error(`[ProgramBuilder] Duplicate proto id '${protoId}'.`);
		}
		this.assignedProtoIds.add(protoId);
		const existing = this.protoIdMap.get(protoId);
		if (existing !== undefined) {
			this.protos[existing] = proto;
			this.protoCode[existing] = code;
			this.protoRanges[existing] = ranges;
			this.protoConstRelocs[existing] = constRelocs;
			this.protoLocalSlots[existing] = localSlots;
			this.protoUpvalueNames[existing] = upvalueNames;
			this.protoInstructionSets[existing] = instructionSet;
			this.protoFixedEntryPC[existing] = false;
			this.protoIds[existing] = protoId;
			return existing;
		}
		const index = this.protos.length;
		this.protos.push(proto);
		this.protoCode.push(code);
		this.protoRanges.push(ranges);
		this.protoConstRelocs.push(constRelocs);
		this.protoLocalSlots.push(localSlots);
		this.protoUpvalueNames.push(upvalueNames);
		this.protoInstructionSets.push(instructionSet);
		this.protoFixedEntryPC.push(false);
		this.protoIds.push(protoId);
		this.protoIdMap.set(protoId, index);
		return index;
	}

	public recordStaticModulePath(path: string): void {
		if (this.staticModulePathSet.has(path)) {
			return;
		}
		this.staticModulePathSet.add(path);
		this.staticModulePaths.push(path);
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

	public getProtoInstructionSet(protoIndex: number): InstructionSet {
		const instructionSet = this.protoInstructionSets[protoIndex];
		if (instructionSet === null || instructionSet === undefined) {
			throw new Error(`[ProgramBuilder] Missing instruction set for proto index ${protoIndex}.`);
		}
		return instructionSet;
	}

	// Record that a module export slot is backed by an exported static-closure
	// function (proto id). The linker resolves references to this slot directly to
	// the proto (a link-time symbol) instead of a runtime global-slot load.
	public recordExportProto(slotName: string, protoId: string): void {
		this.exportProtoIdBySlot[slotName] = protoId;
	}

	public seedProto(
		proto: Proto,
		code: Uint8Array,
		ranges: ReadonlyArray<SourceRange | null>,
		constRelocs: ReadonlyArray<ProgramConstReloc>,
		localSlots: ReadonlyArray<LocalSlotDebug>,
		upvalueNames: ReadonlyArray<string>,
		protoId: string,
	): void {
		const index = this.protos.length;
		this.protos.push(proto);
		this.protoCode.push(code);
		this.protoRanges.push(ranges);
		this.protoConstRelocs.push(constRelocs);
		this.protoLocalSlots.push(localSlots);
		this.protoUpvalueNames.push(upvalueNames);
		this.protoInstructionSets.push(null);
		this.protoFixedEntryPC.push(true);
		this.protoIds.push(protoId);
		this.protoIdMap.set(protoId, index);
	}

	public buildProgram(): { program: Program; metadata: ProgramMetadata; constRelocs: ProgramConstReloc[]; constValueRelocs: ProgramConstValueReloc[]; data: ProgramDataSection; bss: ProgramBssSection; rodataBytes: Uint8Array; rodataSymbols: ProgramRodataSymbol[]; staticModulePaths: string[] } {
		let fixedEndBytes = this.baseCode ? this.baseCode.byteLength : 0;
		let appendedBytes = 0;
		for (let i = 0; i < this.protoCode.length; i += 1) {
			const proto = this.protos[i];
			if (this.protoFixedEntryPC[i]) {
				fixedEndBytes = Math.max(fixedEndBytes, proto.entryPC + proto.codeLen);
			} else {
				appendedBytes += proto.codeLen;
			}
		}
		const totalBytes = fixedEndBytes + appendedBytes;
		if (totalBytes % INSTRUCTION_BYTES !== 0) {
			throw new Error(`[ProgramBuilder] Program code size must align to ${INSTRUCTION_BYTES}-byte words.`);
		}
		const totalWords = totalBytes / INSTRUCTION_BYTES;
		const fullCode = new Uint8Array(totalBytes);
		if (this.baseCode) {
			fullCode.set(this.baseCode, 0);
		}
		const protos: Proto[] = new Array(this.protos.length);
		const fullRanges: Array<SourceRange | null> = new Array(totalWords).fill(null);
		const fullConstRelocs: ProgramConstReloc[] = [];
		let appendOffsetBytes = fixedEndBytes;
		for (let i = 0; i < this.protoCode.length; i += 1) {
			const chunk = this.protoCode[i];
			if (!chunk) {
				throw new Error(`[ProgramBuilder] Missing code for proto index ${i}.`);
			}
			const proto = this.protos[i];
			const ranges = this.protoRanges[i];
			const targetOffsetBytes = this.protoFixedEntryPC[i] ? proto.entryPC : appendOffsetBytes;
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
			const relocs = this.protoConstRelocs[i];
			for (let j = 0; j < relocs.length; j += 1) {
				const reloc = relocs[j];
				switch (reloc.kind) {
					case 'module':
					case 'export_proto':
						fullConstRelocs.push({
							wordIndex: targetOffsetWords + reloc.wordIndex,
							kind: reloc.kind,
							symbol: reloc.symbol,
						});
						continue;
					default:
						fullConstRelocs.push({
							wordIndex: targetOffsetWords + reloc.wordIndex,
							kind: reloc.kind,
							constIndex: reloc.constIndex,
						});
						continue;
				}
			}
			if (!this.protoFixedEntryPC[i]) {
				appendOffsetBytes += chunk.length;
			}
		}
		const metadata: ProgramMetadata = {
			debugRanges: fullRanges,
			protoIds: this.protoIds,
			localSlotsByProto: this.protoLocalSlots,
			upvalueNamesByProto: this.protoUpvalueNames,
			globalNames: this.globalNames,
			systemGlobalNames: this.systemGlobalNames,
			exportProtoIdBySlot: this.exportProtoIdBySlot,
		};
		return {
			program: {
				code: fullCode,
				programRom: this.baseProgramRom === null ? buildProgramRomImage(fullCode, this.rodataBytes, this.dataBytes) : this.baseProgramRom,
				programRomTextByteLength: this.baseProgramRom === null ? fullCode.byteLength : this.baseProgramRomTextByteLength,
				constPool: this.constPool,
				protos,
				stringPool: this.stringPool,
				constPoolStringPool: this.stringPool,
			},
			metadata,
			constRelocs: fullConstRelocs,
			constValueRelocs: this.constValueRelocs.slice(),
			data: this.buildDataSection(),
			bss: this.buildBssSection(),
			rodataBytes: this.rodataBytes,
			rodataSymbols: this.buildRodataSymbols(),
			staticModulePaths: this.staticModulePaths.slice(),
		};
	}

	private makeConstKey(value: Value): string {
		if (value === null) return 'nil';
		if (typeof value === 'number') return `n:${value}`;
		if (valueIsString(value)) return `s:${value.id}`;
		if (typeof value === 'boolean') return `b:${value ? 1 : 0}`;
		return `o:${String(value)}`;
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
const buildInterruptProtoId = (moduleId: string): string => `${buildModuleRootId(moduleId)}/irq`;

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
	private readonly code: Instruction[] = [];
	private readonly ranges: Array<SourceRange | null> = [];
	private finalizedCode: Uint8Array | null = null;
	private finalizedRanges: Array<SourceRange | null> | null = null;
	private finalizedConstRelocs: ProgramConstReloc[] | null = null;
	private readonly localBindings = new Map<string, LocalBinding>();
	private readonly scopeStack: ScopeFrame[] = [];
	private readonly localDebugSlots: LocalSlotDebug[] = [];
	private readonly upvalueDescs: UpvalueDesc[] = [];
	private readonly upvalueNames: string[] = [];
	private readonly upvalueMap = new Map<string, number>();
	private readonly loopStack: LoopContext[] = [];
	private readonly labelPositions = new Map<string, number>();
	private readonly pendingLabelJumps = new Map<string, number[]>();
	private currentRange: SourceRange | null = null;
	private localCount = 0;
	private tempTop = 0;
	private maxStack = 0;
	private localFunctionCounters = new Map<string, number>();
	private flowAnalysis: ValueKindFlowAnalyzer | null = null;
	private currentFlowState: SymbolFlowState = new Map();
	// Cached symbol handle of this module's exported namespace local (the local that
	// the module returns, e.g. `room` in `return room`). undefined = not yet computed.
	private exportRootSymbolHandleCache: string | null | undefined = undefined;

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
		},
	) {
		this.program = program;
		this.parent = parent;
		this.semantics = params.semantics;
		this.frontend = params.frontend;
		this.moduleId = params.moduleId;
		this.protoId = params.protoId;
		this.moduleCompileContext = params.moduleCompileContext ?? parent?.moduleCompileContext;
		// Nested functions inherit the module's export info so that references to the
		// module's own exported namespace (e.g. `room.fn` inside another `room.*`
		// function) resolve to the export symbol/slot instead of the namespace table.
		this.moduleCompileInfo = params.moduleCompileInfo ?? parent?.moduleCompileInfo;
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

	public compileStaticFunctionModuleScope(chunk: LuaChunk): void {
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
			const initializerValues: Array<Value | undefined> = new Array(local.names.length);
			for (let valueIndex = 0; valueIndex < local.values.length && valueIndex < local.names.length; valueIndex += 1) {
				if (local.attributes[valueIndex] === 'const') {
					initializerValues[valueIndex] = this.evaluateCompileTimeExpression(local.values[valueIndex]);
				}
			}
			for (let nameIndex = 0; nameIndex < local.names.length; nameIndex += 1) {
				const decl = this.requireBoundDeclaration(local.names[nameIndex].range, `local '${local.names[nameIndex].name}'`);
				const constValue = initializerValues[nameIndex];
				if (constValue !== undefined) {
					this.declareLocalFromDecl(decl, local.names[nameIndex].range, undefined, constValue, true);
				} else {
					this.declareLocalFromDecl(decl, local.names[nameIndex].range);
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

	public compileInterruptEntry(range: LuaSourceRange): void {
		this.withRange(range, () => {
			const addrReg = this.allocTemp();
			const flagsReg = this.allocTemp();
			this.emitLoadConst(addrReg, IO_IRQ_FLAGS);
			this.emitABC(OpCode.LOAD_MEM, flagsReg, addrReg, MemoryAccessKind.Word);
			this.emitABC(OpCode.RET, flagsReg, 1, 0);
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
		const value = this.tryEvaluateCompileTimeNumber(expression);
		if (value === undefined || !Number.isInteger(value) || value <= 0) {
			throw new Error('[Compiler] Struct array length must be a positive compile-time integer.');
		}
		return value;
	}

	private makeStructResolvedType(
		name: string,
		baseSize: number,
		baseAlignment: number,
		baseAccessKind: MemoryAccessKind | null,
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
			baseAccessKind,
			baseStruct,
			size,
			alignment: baseAlignment,
			accessKind: isElement ? baseAccessKind : null,
			struct: isElement ? baseStruct : null,
			dimensions: Array.from(dimensions),
		};
	}

	private resolveStructTypeReference(typeRef: LuaTypeReference, resolving: Set<string> = new Set()): StructResolvedType {
		const primitive = PRIMITIVE_STRUCT_TYPES.get(typeRef.name);
		let baseSize: number;
		let baseAlignment: number;
		let baseAccessKind: MemoryAccessKind | null;
		let baseStruct: StructLayout | null;
		if (primitive !== undefined) {
			baseSize = primitive.size;
			baseAlignment = primitive.alignment;
			baseAccessKind = primitive.accessKind;
			baseStruct = null;
		} else {
			const layout = this.resolveStructLayout(typeRef.name, resolving);
			baseSize = layout.size;
			baseAlignment = layout.alignment;
			baseAccessKind = null;
			baseStruct = layout;
		}
		const dimensions: number[] = [];
		for (let index = 0; index < typeRef.arrayLengths.length; index += 1) {
			dimensions.push(this.requireStructArrayLength(typeRef.arrayLengths[index]));
		}
		return this.makeStructResolvedType(typeRef.name, baseSize, baseAlignment, baseAccessKind, baseStruct, dimensions);
	}

	private resolveStructLayout(name: string, resolving: Set<string> = new Set()): StructLayout {
		const existing = this.program.getStructLayout(name);
		if (existing !== undefined) {
			return existing;
		}
		const declaration = this.program.getStructDeclaration(name);
		if (declaration === undefined) {
			throw new Error(`[Compiler] Unknown struct type '${name}'.`);
		}
		if (resolving.has(name)) {
			throw new Error(`[Compiler] Recursive struct layout '${name}' is not supported.`);
		}
		resolving.add(name);
		let offset = 0;
		let alignment = 1;
		const fields = new Map<string, StructFieldLayout>();
		for (let index = 0; index < declaration.fields.length; index += 1) {
			const field = declaration.fields[index] as LuaStructFieldDeclaration;
			if (fields.has(field.name)) {
				throw new Error(`[Compiler] Duplicate field '${field.name}' in struct '${name}'.`);
			}
			const type = this.resolveStructTypeReference(field.typeRef, resolving);
			offset = this.alignStructOffset(offset, type.alignment);
			fields.set(field.name, {
				name: field.name,
				type,
				offset,
				size: type.size,
				accessKind: type.accessKind,
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
			throw new Error(`[Compiler] Type '${type.name}' is not an array.`);
		}
		return this.makeStructResolvedType(
			type.name,
			type.baseSize,
			type.baseAlignment,
			type.baseAccessKind,
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
				throw new Error(`[Compiler] offsetof cannot select '${fieldPath[index]}' through non-struct type '${current.name}'.`);
			}
			const field = current.struct.fields.get(fieldPath[index]);
			if (field === undefined) {
				throw new Error(`[Compiler] Unknown field '${fieldPath[index]}' on struct '${current.struct.name}'.`);
			}
			offset += field.offset;
			current = field.type;
		}
		return offset;
	}

	private resolveStructFieldAddress(base: StructAddress, fieldName: string): StructAddress {
		if (base.type.struct === null) {
			throw new Error(`[Compiler] Cannot select field '${fieldName}' from non-struct type '${base.type.name}'.`);
		}
		const field = base.type.struct.fields.get(fieldName);
		if (field === undefined) {
			throw new Error(`[Compiler] Unknown field '${fieldName}' on struct '${base.type.struct.name}'.`);
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

	public getConstRelocs(): ReadonlyArray<ProgramConstReloc> {
		this.finalizeCode();
		return this.finalizedConstRelocs!;
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
				constPool: this.program.constPool,
				stringPool: this.program.stringPool,
				constIndex: (value: Value) => this.program.constIndex(value),
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
			});
			if (optimized.instructions !== this.code) {
				this.code.length = 0;
				this.code.push(...optimized.instructions);
			}
			if (optimized.ranges !== this.ranges) {
				this.ranges.length = 0;
				this.ranges.push(...optimized.ranges);
			}
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
				const forceWide = isConstBxOp(instr.op);
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
		const constRelocs: ProgramConstReloc[] = [];
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
					writeInstruction(code, cursor, OpCode.WIDE, aSplit.wide, bxSplit.wide, 0);
					finalRanges[cursor] = range;
					cursor += 1;
				}
				writeInstruction(code, cursor, instr.op, aSplit.low, (bxSplit.low >>> 6) & 0x3f, bxSplit.low & 0x3f, bxSplit.ext);
				finalRanges[cursor] = range;
				cursor += 1;
				if (isConstBxOp(instr.op)) {
					if (instr.symbolicReloc !== undefined) {
						constRelocs.push({ wordIndex: instrWordIndex[index], kind: instr.symbolicReloc.kind, symbol: instr.symbolicReloc.symbol });
					} else {
						constRelocs.push({ wordIndex: instrWordIndex[index], kind: 'bx', constIndex: instr.b });
					}
				} else if (instr.op === OpCode.GETSYS || instr.op === OpCode.SETSYS) {
					constRelocs.push({ wordIndex: instrWordIndex[index], kind: 'sys', constIndex: instr.b });
				} else if (isGlobalSlotOp(instr.op)) {
					constRelocs.push({ wordIndex: instrWordIndex[index], kind: 'gl', constIndex: instr.b });
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

		this.finalizedCode = code;
		this.finalizedRanges = finalRanges;
		this.finalizedConstRelocs = constRelocs;
	}

	public getUpvalueDescs(): UpvalueDesc[] {
		return this.upvalueDescs;
	}

	public getUpvalueNames(): ReadonlyArray<string> {
		return this.upvalueNames;
	}

	public getLocalDebugSlots(): ReadonlyArray<LocalSlotDebug> {
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
			throw new Error(`[Compiler] Missing bound declaration for ${context}.`);
		}
		return decl;
	}

	private declareLocal(
		symbolHandle: string,
		name: string,
		definitionRange: LuaSourceRange,
		scopeRange?: LuaSourceRange,
		kind: LocalBindingKind = 'local',
		constValue: Value | null = null,
		hasConstValue = false,
		constClosureProtoIndex: number | null = null,
		moduleBinding: ModuleBinding | null = null,
	): number {
		if (getMemoryAccessKindForName(name) !== null) {
			throw new Error(`[Compiler] '${name}' is a reserved memory map name and cannot be used as a local or parameter.`);
		}
		if (isReservedIntrinsicName(name)) {
			throw new Error(`[Compiler] '${name}' is a reserved intrinsic name and cannot be used as a local or parameter.`);
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
			constClosureProtoIndex,
			moduleBinding,
			structView: null,
		};
		this.localBindings.set(symbolHandle, binding);
		const scope = this.scopeStack[this.scopeStack.length - 1];
		scope.locals.push(binding);
		const effectiveScopeRange = scopeRange ?? scope.range;
		this.localDebugSlots.push({
			name,
			register: reg,
			definition: definitionRange,
			scope: effectiveScopeRange,
		});
		return reg;
	}

	private declareLocalFromDecl(
		decl: Decl,
		definitionRange: LuaSourceRange,
		scopeRange?: LuaSourceRange,
		constValue: Value | null = null,
		hasConstValue = false,
		constClosureProtoIndex: number | null = null,
		moduleBinding: ModuleBinding | null = null,
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
		return this.declareLocal(decl.id, decl.name, definitionRange, scopeRange, kind, constValue, hasConstValue, constClosureProtoIndex, moduleBinding);
	}

	private resolveLocal(symbolHandle: string): number | null {
		const binding = this.localBindings.get(symbolHandle);
		if (binding === undefined) {
			return null;
		}
		return binding.reg;
	}

	private resolveUpvalue(symbolHandle: string, name: string): number | null {
		const existing = this.upvalueMap.get(symbolHandle);
		if (existing !== undefined) {
			return existing;
		}
		if (!this.parent) {
			return null;
		}
		const parentLocal = this.parent.localBindings.get(symbolHandle);
		if (parentLocal !== undefined) {
			const index = this.upvalueDescs.length;
			this.upvalueDescs.push({ inStack: true, index: parentLocal.reg });
			this.upvalueNames.push(name);
			this.upvalueMap.set(symbolHandle, index);
			return index;
		}
		const parentUpvalue = this.parent.resolveUpvalue(symbolHandle, name);
		if (parentUpvalue !== null) {
			const index = this.upvalueDescs.length;
			this.upvalueDescs.push({ inStack: false, index: parentUpvalue });
			this.upvalueNames.push(name);
			this.upvalueMap.set(symbolHandle, index);
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

	private resolveReferenceBssBinding(reference: LuaBoundReference): BssBinding | null {
		if (reference.decl?.kind === 'bss') {
			return this.program.resolveBss(reference.decl.id);
		}
		const symbolHandle = getResolvedReferenceSymbolHandle(reference);
		if (!symbolHandle) {
			return null;
		}
		return this.program.resolveBss(symbolHandle);
	}

	private resolveReferenceDataBinding(reference: LuaBoundReference): DataBinding | null {
		if (reference.decl?.kind === 'data') {
			return this.program.resolveData(reference.decl.id);
		}
		const symbolHandle = getResolvedReferenceSymbolHandle(reference);
		if (!symbolHandle) {
			return null;
		}
		return this.program.resolveData(symbolHandle);
	}

	private resolveReferenceRodataBinding(reference: LuaBoundReference): RodataBinding | null {
		if (reference.decl?.kind === 'rodata') {
			return this.program.resolveRodata(reference.decl.id);
		}
		const symbolHandle = getResolvedReferenceSymbolHandle(reference);
		if (!symbolHandle) {
			return null;
		}
		return this.program.resolveRodata(symbolHandle);
	}

	private resolveReferenceConstClosureBinding(reference: LuaBoundReference): LocalBinding | null {
		const symbolHandle = getResolvedReferenceSymbolHandle(reference);
		if (!symbolHandle) {
			return null;
		}
		return this.resolveCompileTimeConstClosureBinding(symbolHandle);
	}

	private markStaticExternalModulePath(path: string): void {
		this.program.recordStaticModulePath(path);
	}

	private tryResolveRequireModuleBinding(expression: LuaExpression): ModuleBinding | null {
		if (expression.kind !== LuaSyntaxKind.CallExpression) {
			return null;
		}
		const call = expression as LuaCallExpression;
		if (call.methodName !== null || call.arguments.length !== 1 || call.callee.kind !== LuaSyntaxKind.IdentifierExpression) {
			return null;
		}
		const callee = call.callee as LuaIdentifierExpression;
		if (callee.name !== 'require') {
			return null;
		}
		if (call.arguments[0].kind !== LuaSyntaxKind.StringLiteralExpression) {
			return null;
		}
		const moduleName = (call.arguments[0] as LuaStringLiteralExpression).value;
		const modulePath = this.moduleCompileContext?.modulesByPath.has(moduleName) ? moduleName : undefined;
		if (!modulePath) {
			return null;
		}
		return {
			modulePath,
			exportPathKey: '',
			exportDepth: 0,
			external: !!this.moduleCompileContext?.modulesByPath.get(modulePath)?.external,
		};
	}

	private tryResolveStaticModuleBinding(expression: LuaExpression, allowRequireRoot: boolean): ModuleBinding | null {
		/*
			Note: emulated-machine semantics and symbolic link-time relocations

			- This project targets a emulated-machine-style ABI based on flat machine instructions; Lua
			runtime concepts such as live module tables are not part of the ABI. The compiler treats
			certain system ROM modules as compile-time descriptors and records initializer paths in the
			program image's static module path list.
			- The compiler must not fabricate runtime tables. When a module export cannot be resolved at
			compile time, the compiler emits an explicit symbolic relocation on the instruction.
			The relocation resolver rewrites the operand/instruction before execution.
			- This function detects static module bindings and marks them `external` so later compiler and
			linker phases can preserve semantics and perform link-time resolution of symbolic relocations.
		 */
		if (allowRequireRoot) {
			const requireBinding = this.tryResolveRequireModuleBinding(expression);
			if (requireBinding !== null) {
				return requireBinding;
			}
		}
		if (expression.kind === LuaSyntaxKind.IdentifierExpression) {
			const binding = this.resolveReferenceVisibleBinding(getResolvedIdentifierReference(this.semantics, expression as LuaIdentifierExpression));
			if (!binding || binding.moduleBinding === null) {
				return null;
			}
			return binding.moduleBinding;
		}
		if (expression.kind !== LuaSyntaxKind.MemberExpression && expression.kind !== LuaSyntaxKind.IndexExpression) {
			return null;
		}
		const isMemberExpression = expression.kind === LuaSyntaxKind.MemberExpression;
		const baseExpression = isMemberExpression
			? (expression as LuaMemberExpression).base
			: (expression as LuaIndexExpression).base;
		const baseBinding = this.tryResolveStaticModuleBinding(baseExpression, allowRequireRoot);
		if (!baseBinding) {
			return null;
		}
		const key = isMemberExpression
			? (expression as LuaMemberExpression).identifier
			: extractTableKeyFromExpression((expression as LuaIndexExpression).index);
		if (!key) {
			return null;
		}
		const exportPathKey = appendModuleExportPathKey(baseBinding.exportPathKey, key);
		if (!this.moduleCompileContext?.modulesByPath.get(baseBinding.modulePath)?.exportSlotsByPathKey.get(exportPathKey)) {
			return null;
		}
		return {
			modulePath: baseBinding.modulePath,
			exportPathKey,
			exportDepth: baseBinding.exportDepth + 1,
			external: baseBinding.external,
		};
	}

	private isConstModulePath(modulePath: string): boolean {
		return !!this.moduleCompileContext?.modulesByPath.get(modulePath)?.constModule;
	}

	// Resolve a const module export (e.g. `assets.data_x_addr`) to its compile-time
	// constant value. Returns a wrapper so a `nil`/`false`/`0` export is distinguished
	// from "not a const export". The value is inlined at the use site.
	private tryResolveModuleExportConstValue(expression: LuaExpression): { binding: ModuleBinding; value: ConstExportValue } | null {
		const binding = this.tryResolveStaticModuleBinding(expression, true);
		if (!binding || binding.exportDepth === 0) {
			return null;
		}
		const info = this.moduleCompileContext?.modulesByPath.get(binding.modulePath);
		if (!info || !info.constModule || !info.exportConstValueByPathKey.has(binding.exportPathKey)) {
			return null;
		}
		return { binding, value: info.exportConstValueByPathKey.get(binding.exportPathKey)! };
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
				this.emitLoadConst(target, this.program.internString(value.value));
				return;
			case 'bss_addr': {
				const binding = this.program.resolveBss(value.symbolHandle);
				if (binding === null) {
					throw new Error(`[Compiler] Static module .bss symbol '${value.symbolHandle}' was not recorded.`);
				}
				this.emitLoadBssAddress(target, binding, 0);
				return;
			}
			case 'data_addr': {
				const binding = this.program.resolveData(value.symbolHandle);
				if (binding === null) {
					throw new Error(`[Compiler] Static module .data symbol '${value.symbolHandle}' was not recorded.`);
				}
				this.emitLoadDataAddress(target, binding, 0);
				return;
			}
			case 'rodata_addr': {
				const binding = this.program.resolveRodata(value.symbolHandle);
				if (binding === null) {
					throw new Error(`[Compiler] Static module .rodata symbol '${value.symbolHandle}' was not recorded.`);
				}
				this.emitLoadRodataAddress(target, binding, 0);
				return;
			}
		}
	}

	private tryResolveStaticFunctionExportBinding(expression: LuaExpression): ModuleBinding | null {
		const binding = this.tryResolveStaticModuleBinding(expression, true);
		if (!binding || binding.exportDepth === 0) {
			return null;
		}
		const info = this.moduleCompileContext?.modulesByPath.get(binding.modulePath);
		if (!info || !info.constModule) {
			return null;
		}
		return info.staticFunctionExportByPathKey.has(binding.exportPathKey) ? binding : null;
	}

	private failStaticFunctionExportValueUse(binding: ModuleBinding): never {
		throw new Error(`[Compiler] Const module '${binding.modulePath}' function export '${binding.exportPathKey}' is a call target, not a runtime value.`);
	}

	private failConstModuleValueCall(binding: ModuleBinding): never {
		throw new Error(`[Compiler] Const module '${binding.modulePath}' value export '${binding.exportPathKey}' is not a call target.`);
	}

	private tryResolveModuleExportSlotFromExpression(expression: LuaExpression): string | undefined {
		const binding = this.tryResolveStaticModuleBinding(expression, false);
		if (!binding || binding.exportDepth === 0) {
			return undefined;
		}
		return this.moduleCompileContext?.modulesByPath.get(binding.modulePath)?.exportSlotsByPathKey.get(binding.exportPathKey);
	}

	private tryResolveModuleExportCallTargetSlot(expression: LuaExpression): string | undefined {
		const binding = this.tryResolveStaticModuleBinding(expression, false);
		if (!binding || binding.exportDepth === 0) {
			return undefined;
		}
		const info = this.moduleCompileContext?.modulesByPath.get(binding.modulePath);
		if (info === undefined) {
			return undefined;
		}
		if (info.constModule && !info.staticFunctionExportByPathKey.has(binding.exportPathKey)) {
			return undefined;
		}
		return info.exportSlotsByPathKey.get(binding.exportPathKey);
	}

	private tryResolveModuleExportMethodSlot(baseExpression: LuaExpression, methodName: string): string | undefined {
		const binding = this.tryResolveStaticModuleBinding(baseExpression, false);
		if (!binding) {
			return undefined;
		}
		return this.moduleCompileContext?.modulesByPath.get(binding.modulePath)?.exportSlotsByPathKey.get(appendModuleExportPathKey(binding.exportPathKey, methodName));
	}

	private tryResolveOwnStaticFunctionExportCallSlot(expression: LuaExpression): string | undefined {
		if (expression.kind !== LuaSyntaxKind.IdentifierExpression || this.moduleCompileInfo === undefined) {
			return undefined;
		}
		const reference = getResolvedIdentifierReference(this.semantics, expression as LuaIdentifierExpression);
		const symbolHandle = getResolvedReferenceSymbolHandle(reference);
		if (!symbolHandle) {
			return undefined;
		}
		return this.moduleCompileInfo.staticFunctionExportSlotBySymbolHandle.get(symbolHandle);
	}

	private tryResolveExternalModuleRootFieldSlotName(baseExpression: LuaExpression, key: string): string | undefined {
		const binding = this.tryResolveStaticModuleBinding(baseExpression, false);
		if (!binding || !binding.external || binding.exportDepth !== 0) {
			return undefined;
		}
		// Const modules export only the symbols in their return table; an unknown field
		// is not a runtime global-slot reference (it surfaces as a module-root misuse).
		if (this.isConstModulePath(binding.modulePath)) {
			return undefined;
		}
		const moduleInfo = this.moduleCompileContext!.modulesByPath.get(binding.modulePath)!;
		if (moduleInfo.exportSlotsByPathKey.get(key) !== undefined) {
			return undefined;
		}
		return buildModuleRootFieldSlotName(binding.modulePath, key);
	}

	/*
		Detect a compile-time-only module root binding

		- Returns true when a local binding is associated with a moduleBinding and that module is
		marked `external` (compile-time-only) and the moduleBinding is the module root.
		- This detection prevents treating the module root as a runtime value (local or upvalue) under
		the emulated-machine semantics used by this project.
	 */
	private tryGetCompileTimeModuleRootBinding(binding: LocalBinding | null | undefined): ModuleBinding | null {
		if (!binding || binding.moduleBinding === null) {
			return null;
		}
		return binding.moduleBinding.external && binding.moduleBinding.exportDepth === 0
			? binding.moduleBinding
			: null;
	}

	/*
		Error on attempts to use a compile-time-only module root as a runtime value

		- Under the emulated-machine semantics, external modules used for ABI/BIOS are compile-time-only
		descriptors and not runtime Lua tables. Storing or returning a whole module (for example
		`local m = require('bios')`) is therefore invalid and is rejected with a compile-time error.
		- This makes the failure explicit and directs the developer to access specific exported slots
		instead of treating the module as a runtime table.
	 */
	private failCompileTimeModuleRootRuntimeUse(modulePath: string): never {
		throw new Error(`[Compiler] External module '${modulePath}' is compile-time only; access an exported field instead of using the module table as a runtime value.`);
	}

	private emitReferenceLoad(reference: LuaBoundReference, target: number): void {
		const name = this.getReferenceName(reference);
		const binding = this.resolveReferenceVisibleBinding(reference);
		/*
			Prevent leaking a compile-time-only module root as a runtime value

			- If `binding` refers to a compile-time-only module root, it must not be used as a runtime
			value (stored in a local or captured as an upvalue) under the project's emulated-machine ABI.
			- We detect that here and raise a compile-time error via `failExternalModuleRootRuntimeUse` to
			prevent generating runtime references to a non-existent module table.
		 */
		const compileTimeModuleRoot = this.tryGetCompileTimeModuleRootBinding(binding);
		if (compileTimeModuleRoot !== null) {
			this.failCompileTimeModuleRootRuntimeUse(compileTimeModuleRoot.modulePath);
		}
		const constBinding = this.resolveReferenceConstBinding(reference);
		if (constBinding !== null) {
			this.emitLoadConst(target, constBinding.constValue);
			return;
		}
		const bssBinding = this.resolveReferenceBssBinding(reference);
		if (bssBinding !== null) {
			this.emitLoadBssAddress(target, bssBinding, 0);
			return;
		}
		const dataBinding = this.resolveReferenceDataBinding(reference);
		if (dataBinding !== null) {
			this.emitLoadDataAddress(target, dataBinding, 0);
			return;
		}
		const rodataBinding = this.resolveReferenceRodataBinding(reference);
		if (rodataBinding !== null) {
			this.emitLoadRodataAddress(target, rodataBinding, 0);
			return;
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
			throw new Error(`[Compiler] '${name}' is a reserved memory map. Use direct indexing syntax like ${name}[addr].`);
		}
		if (reference.kind === 'reserved_intrinsic') {
			throw new Error(`[Compiler] '${name}' is a reserved intrinsic.`);
		}
		if (reference.kind === 'unresolved') {
			throw new Error(`[Compiler] '${name}' is not defined.`);
		}
		const access = this.program.resolveGlobalAccess(name);
		this.emitABx(access.system ? OpCode.GETSYS : OpCode.GETGL, target, access.slot);
	}

	private emitModuleExportValueLoad(slotName: string, target: number): void {
		const access = this.program.resolveGlobalAccess(slotName);
		this.emitABx(access.system ? OpCode.GETSYS : OpCode.GETGL, target, access.slot);
	}

	private emitModuleExportCallTargetLoad(slotName: string, target: number): void {
		// Call targets may be link-time function symbols. The linker rewrites this
		// symbolic relocation to CLOSURE(proto) for static function exports, or to a
		// normal global-slot load for data/upvalue-capturing exports. Non-call value
		// reads keep direct global loads so export symbols never enter value-flow.
		this.emitABx(OpCode.LOADK, target, 0, { kind: 'export_proto', symbol: slotName });
	}

	private emitModuleSlotRelocLoad(slotName: string, target: number): void {
		this.emitABx(OpCode.LOADK, target, 0, { kind: 'module', symbol: slotName });
	}

	private emitModuleExportStore(slotName: string, valueReg: number): void {
		const access = this.program.resolveGlobalAccess(slotName);
		this.emitABx(access.system ? OpCode.SETSYS : OpCode.SETGL, valueReg, access.slot);
	}

	private emitModuleExportGlobalStores(baseReg: number, moduleInfo: ModuleCompileInfo): void {
		const tempBase = this.tempTop;
		this.emitModuleExportGlobalStoreChildren(baseReg, moduleInfo.exportRoot, moduleInfo.path, []);
		this.tempTop = tempBase;
	}

	private emitModuleExportGlobalStoreChildren(baseReg: number, node: ModuleExportNode, modulePath: string, path: string[], visiting: WeakSet<ModuleExportNode> = new WeakSet()): void {
		if (visiting.has(node)) {
			return;
		}
		visiting.add(node);
		for (const [key, child] of node.children) {
			path.push(key);
			const slotName = buildModuleExportSlotName(modulePath, path);
			const childReg = this.allocTemp();
			const keyConst = this.program.constIndexString(key);
			this.emitTableGetConst(childReg, baseReg, keyConst);
			this.emitModuleExportStore(slotName, childReg);
			if (child.children.size > 0 && !visiting.has(child)) {
				this.emitModuleExportGlobalStoreChildren(childReg, child, modulePath, path, visiting);
			}
			path.pop();
		}
		visiting.delete(node);
	}

	private emitReferenceStore(reference: LuaBoundReference, valueReg: number): void {
		const name = this.getReferenceName(reference);
		const symbolHandle = getResolvedReferenceSymbolHandle(reference);
		const localBinding = symbolHandle ? this.localBindings.get(symbolHandle) : undefined;
		if (localBinding !== undefined) {
			if (localBinding.kind === 'const') {
				throw new Error(`[Compiler] '${name}' is a constant local and cannot be assigned.`);
			}
			this.emitABC(OpCode.MOV, localBinding.reg, valueReg, 0);
			return;
		}
		const visibleBinding = this.resolveReferenceVisibleBinding(reference);
		if (visibleBinding !== null && visibleBinding.kind === 'const') {
			throw new Error(`[Compiler] '${name}' is a constant local and cannot be assigned.`);
		}
		if (this.resolveReferenceBssBinding(reference) !== null) {
			throw new Error(`[Compiler] '${name}' is .bss storage; assign through a typed pointer or field.`);
		}
		if (this.resolveReferenceDataBinding(reference) !== null) {
			throw new Error(`[Compiler] '${name}' is .data storage; assign through a typed pointer or field.`);
		}
		if (this.resolveReferenceRodataBinding(reference) !== null) {
			throw new Error(`[Compiler] '${name}' is .rodata storage and cannot be assigned.`);
		}
		const upvalue = this.resolveReferenceUpvalue(reference);
		if (upvalue !== null) {
			this.emitABC(OpCode.SETUP, valueReg, upvalue, 0);
			return;
		}
		if (reference.kind === 'map') {
			throw new Error(`[Compiler] '${name}' is a reserved memory map. Use direct indexing syntax like ${name}[addr].`);
		}
		if (reference.kind === 'reserved_intrinsic') {
			throw new Error(`[Compiler] '${name}' is a reserved intrinsic.`);
		}
		if (reference.kind === 'unresolved') {
			throw new Error(`[Compiler] '${name}' is not defined.`);
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

	private emitABC(op: OpCode, a: number, b: number, c: number, rkMask: number = 0): void {
		this.code.push({
			op,
			a,
			b,
			c,
			format: 'ABC',
			rkMask,
			target: null,
		});
		this.ranges.push(this.currentRange);
	}

	private emitABCd(op: OpCode, a: number, b: number, c: number, disp: number): void {
		this.code.push({
			op,
			a,
			b,
			c,
			disp,
			format: 'ABC',
			rkMask: 0,
			target: null,
		});
		this.ranges.push(this.currentRange);
	}

	private emitABx(op: OpCode, a: number, bx: number, symbolicReloc?: Instruction['symbolicReloc']): void {
		this.code.push({
			op,
			a,
			b: bx,
			c: 0,
			format: 'ABx',
			rkMask: 0,
			target: null,
			symbolicReloc,
		});
		this.ranges.push(this.currentRange);
	}

	private emitAsBx(op: OpCode, a: number, sbx: number): void {
		const target = this.code.length + 1 + sbx;
		this.code.push({
			op,
			a,
			b: 0,
			c: 0,
			format: 'AsBx',
			rkMask: 0,
			target,
		});
		this.ranges.push(this.currentRange);
	}

	private emitTableGetConst(target: number, tableReg: number, keyConst: number): void {
		const keyValue = this.program.constPool[keyConst];
		if (typeof keyValue === 'number' && Number.isInteger(keyValue) && keyValue >= 1 && keyValue <= MAX_SPECIALIZED_TABLE_OPERAND) {
			this.emitABC(OpCode.GETI, target, tableReg, keyValue);
			return;
		}
		if (valueIsString(keyValue) && keyConst <= MAX_SPECIALIZED_TABLE_OPERAND) {
			this.emitABC(OpCode.GETFIELD, target, tableReg, keyConst);
			return;
		}
		this.emitABC(OpCode.GETT, target, tableReg, this.encodeConstOperand(keyConst), RK_C);
	}

	private emitTableSetConst(tableReg: number, keyConst: number, valueReg: number): void {
		const keyValue = this.program.constPool[keyConst];
		if (typeof keyValue === 'number' && Number.isInteger(keyValue) && keyValue >= 1 && keyValue <= MAX_SPECIALIZED_TABLE_OPERAND) {
			this.emitABC(OpCode.SETI, tableReg, keyValue, valueReg, RK_C);
			return;
		}
		if (valueIsString(keyValue) && keyConst <= MAX_SPECIALIZED_TABLE_OPERAND) {
			this.emitABC(OpCode.SETFIELD, tableReg, keyConst, valueReg, RK_C);
			return;
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

	private emitLoadConst(target: number, value: Value): void {
		const normalizedValue = typeof value === 'string' ? this.program.internString(value) : value;
		if (normalizedValue === null) {
			this.emitABC(OpCode.KNIL, target, 0, 0);
			return;
		}
		if (typeof normalizedValue === 'boolean') {
			this.emitABC(normalizedValue ? OpCode.KTRUE : OpCode.KFALSE, target, 0, 0);
			return;
		}
		if (typeof normalizedValue === 'number') {
			if (normalizedValue === 0) {
				this.emitABC(OpCode.K0, target, 0, 0);
				return;
			}
			if (normalizedValue === 1) {
				this.emitABC(OpCode.K1, target, 0, 0);
				return;
			}
			if (normalizedValue === -1) {
				this.emitABC(OpCode.KM1, target, 0, 0);
				return;
			}
			if (isSmallSignedImmediate(normalizedValue)) {
				this.emitABx(OpCode.KSMI, target, normalizedValue);
				return;
			}
		}
		const index = this.program.constIndex(normalizedValue);
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
				if (binding !== null) {
					closureProtoIndex = binding.constClosureProtoIndex;
				}
			}
			this.compileExpressionInto(expression, target, resultCount, protoIdHint);
		});
		return closureProtoIndex;
	}

	private evaluateCompileTimeExpression(expression: LuaExpression): Value | undefined {
		switch (expression.kind) {
			case LuaSyntaxKind.NumericLiteralExpression:
				return (expression as LuaNumericLiteralExpression).value;
			case LuaSyntaxKind.StringLiteralExpression:
				return this.program.internString((expression as LuaStringLiteralExpression).value);
			case LuaSyntaxKind.BooleanLiteralExpression:
				return (expression as LuaBooleanLiteralExpression).value;
			case LuaSyntaxKind.NilLiteralExpression:
				return null;
			case LuaSyntaxKind.IdentifierExpression: {
				const binding = this.resolveReferenceConstBinding(getResolvedIdentifierReference(this.semantics, expression as LuaIdentifierExpression));
				if (!binding) {
					return undefined;
				}
				return binding.constValue;
			}
			case LuaSyntaxKind.UnaryExpression:
				return this.evaluateCompileTimeUnaryExpression(expression as LuaUnaryExpression);
			case LuaSyntaxKind.BinaryExpression:
				return this.evaluateCompileTimeBinaryExpression(expression as LuaBinaryExpression);
			case LuaSyntaxKind.SizeOfExpression:
				return this.resolveStructTypeReference((expression as LuaSizeOfExpression).typeRef).size;
			case LuaSyntaxKind.OffsetOfExpression: {
				const offsetOf = expression as LuaOffsetOfExpression;
				return this.resolveOffsetOf(offsetOf.typeName, offsetOf.fieldPath);
			}
			default:
				return undefined;
		}
	}

	private evaluateCompileTimeUnaryExpression(expression: LuaUnaryExpression): Value | undefined {
		const operand = this.evaluateCompileTimeExpression(expression.operand);
		if (operand === undefined) {
			return undefined;
		}
		switch (expression.operator) {
			case LuaUnaryOperator.Negate:
				return typeof operand === 'number' ? -operand : undefined;
			case LuaUnaryOperator.Not:
				return !this.isTruthyCompileTimeValue(operand);
			case LuaUnaryOperator.Length:
				return valueIsString(operand) ? this.program.stringPool.codepointCount(asStringId(operand)) : undefined;
			case LuaUnaryOperator.BitwiseNot:
				return typeof operand === 'number' ? ~operand : undefined;
			case LuaUnaryOperator.StringId:
				return valueIsString(operand) ? operand : undefined;
			default:
				return undefined;
		}
	}

	private evaluateCompileTimeBinaryExpression(expression: LuaBinaryExpression): Value | undefined {
		switch (expression.operator) {
			case LuaBinaryOperator.And: {
				const left = this.evaluateCompileTimeExpression(expression.left);
				if (left === undefined) {
					return undefined;
				}
				if (!this.isTruthyCompileTimeValue(left)) {
					return left;
				}
				return this.evaluateCompileTimeExpression(expression.right);
			}
			case LuaBinaryOperator.Or: {
				const left = this.evaluateCompileTimeExpression(expression.left);
				if (left === undefined) {
					return undefined;
				}
				if (this.isTruthyCompileTimeValue(left)) {
					return left;
				}
				return this.evaluateCompileTimeExpression(expression.right);
			}
			case LuaBinaryOperator.Equal:
				return this.evaluateCompileTimeEquality(expression.left, expression.right);
			case LuaBinaryOperator.NotEqual: {
				const equal = this.evaluateCompileTimeEquality(expression.left, expression.right);
				return equal === undefined ? undefined : !equal;
			}
			case LuaBinaryOperator.LessThan:
				return this.evaluateCompileTimeRelational(expression.left, expression.right, (a, b) => a < b);
			case LuaBinaryOperator.LessEqual:
				return this.evaluateCompileTimeRelational(expression.left, expression.right, (a, b) => a <= b);
			case LuaBinaryOperator.GreaterThan:
				return this.evaluateCompileTimeRelational(expression.right, expression.left, (a, b) => a < b);
			case LuaBinaryOperator.GreaterEqual:
				return this.evaluateCompileTimeRelational(expression.right, expression.left, (a, b) => a <= b);
			case LuaBinaryOperator.BitwiseOr:
				return this.evaluateCompileTimeNumericBinary(expression.left, expression.right, (a, b) => a | b);
			case LuaBinaryOperator.BitwiseXor:
				return this.evaluateCompileTimeNumericBinary(expression.left, expression.right, (a, b) => a ^ b);
			case LuaBinaryOperator.BitwiseAnd:
				return this.evaluateCompileTimeNumericBinary(expression.left, expression.right, (a, b) => a & b);
			case LuaBinaryOperator.ShiftLeft:
				return this.evaluateCompileTimeNumericBinary(expression.left, expression.right, (a, b) => a << (b & 31));
			case LuaBinaryOperator.ShiftRight:
				return this.evaluateCompileTimeNumericBinary(expression.left, expression.right, (a, b) => a >> (b & 31));
			case LuaBinaryOperator.Add:
				return this.evaluateCompileTimeNumericBinary(expression.left, expression.right, (a, b) => a + b);
			case LuaBinaryOperator.Subtract:
				return this.evaluateCompileTimeNumericBinary(expression.left, expression.right, (a, b) => a - b);
			case LuaBinaryOperator.Multiply:
				return this.evaluateCompileTimeNumericBinary(expression.left, expression.right, (a, b) => a * b);
			case LuaBinaryOperator.Divide:
				return this.evaluateCompileTimeNumericBinary(expression.left, expression.right, (a, b) => a / b);
			case LuaBinaryOperator.FloorDivide:
				return this.evaluateCompileTimeNumericBinary(expression.left, expression.right, (a, b) => Math.floor(a / b));
			case LuaBinaryOperator.Modulus:
				return this.evaluateCompileTimeNumericBinary(expression.left, expression.right, luaModulo);
			case LuaBinaryOperator.Concat:
				return this.evaluateCompileTimeConcat(expression.left, expression.right);
			case LuaBinaryOperator.Exponent:
				return this.evaluateCompileTimeNumericBinary(expression.left, expression.right, (a, b) => Math.pow(a, b));
			default:
				return undefined;
		}
	}

	private evaluateCompileTimeNumericBinary(leftExpression: LuaExpression, rightExpression: LuaExpression, operator: (left: number, right: number) => number | undefined): Value | undefined {
		const left = this.evaluateCompileTimeExpression(leftExpression);
		const right = this.evaluateCompileTimeExpression(rightExpression);
		if (left === undefined || right === undefined) {
			return undefined;
		}
		if (typeof left !== 'number' || typeof right !== 'number') {
			return undefined;
		}
		return operator(left, right);
	}

	private evaluateCompileTimeConcat(leftExpression: LuaExpression, rightExpression: LuaExpression): Value | undefined {
		const left = this.evaluateCompileTimeExpression(leftExpression);
		const right = this.evaluateCompileTimeExpression(rightExpression);
		if (left === undefined || right === undefined) {
			return undefined;
		}
		if (!this.isCompileTimeConcatValue(left) || !this.isCompileTimeConcatValue(right)) {
			return undefined;
		}
		return this.program.internString(this.toCompileTimeString(left) + this.toCompileTimeString(right));
	}

	private evaluateCompileTimeEquality(leftExpression: LuaExpression, rightExpression: LuaExpression): boolean | undefined {
		const left = this.evaluateCompileTimeExpression(leftExpression);
		const right = this.evaluateCompileTimeExpression(rightExpression);
		if (left === undefined || right === undefined) {
			return undefined;
		}
		if (typeof left === 'number') {
			return typeof right === 'number' && left === right;
		}
		if (valueIsString(left)) {
			return valueIsString(right) && this.program.stringPool.toString(asStringId(left)) === this.program.stringPool.toString(asStringId(right));
		}
		if (typeof left === 'boolean' || left === null) {
			return left === right;
		}
		return undefined;
	}

	private evaluateCompileTimeRelational(leftExpression: LuaExpression, rightExpression: LuaExpression, comparator: (left: number | string, right: number | string) => boolean): boolean | undefined {
		const left = this.evaluateCompileTimeExpression(leftExpression);
		const right = this.evaluateCompileTimeExpression(rightExpression);
		if (left === undefined || right === undefined) {
			return undefined;
		}
		if (typeof left === 'number' && typeof right === 'number') {
			return comparator(left, right);
		}
		if (valueIsString(left) && valueIsString(right)) {
			return comparator(this.program.stringPool.toString(asStringId(left)), this.program.stringPool.toString(asStringId(right)));
		}
		return undefined;
	}

	private isCompileTimeConcatValue(value: Value): boolean {
		return typeof value === 'number' || valueIsString(value);
	}

	private toCompileTimeString(value: Value): string {
		return valueIsString(value) ? this.program.stringPool.toString(asStringId(value)) : String(value);
	}

	private isTruthyCompileTimeValue(value: Value): boolean {
		return value !== null && value !== false;
	}

	private compileStatement(statement: LuaStatement): void {
		if (this.flowAnalysis) {
			this.currentFlowState = this.flowAnalysis.getFlowStateAt(statement);
		}
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
		const type = this.resolveStructTypeReference(statement.typeRef);
		this.program.recordData(declaration.id, this.moduleId, statement.name.name, type, this.encodeStorageInitializer(type, statement.initializer, '.data'));
	}

	private compileRodataDeclaration(statement: LuaRodataDeclarationStatement): void {
		this.recordRodataDeclaration(statement, this.requireBoundDeclaration(statement.name.range, `rodata '${statement.name.name}'`));
	}

	private recordRodataDeclaration(statement: LuaRodataDeclarationStatement, declaration: Decl): void {
		const type = this.resolveStructTypeReference(statement.typeRef);
		this.program.recordRodata(declaration.id, this.moduleId, statement.name.name, type, this.encodeStorageInitializer(type, statement.initializer, '.rodata'));
	}

	private encodeStorageInitializer(type: StructResolvedType, expression: LuaExpression, sectionName: '.data' | '.rodata'): Uint8Array {
		const bytes = new Uint8Array(type.size);
		this.writeStorageInitializer(bytes, 0, type, expression, sectionName);
		return bytes;
	}

	private writeStorageInitializer(out: Uint8Array, byteOffset: number, type: StructResolvedType, expression: LuaExpression, sectionName: '.data' | '.rodata'): void {
		if (type.dimensions.length !== 0) {
			if (expression.kind !== LuaSyntaxKind.TableConstructorExpression) {
				throw new Error(`[Compiler] ${sectionName} array '${type.name}' requires a table initializer.`);
			}
			const table = expression as LuaTableConstructorExpression;
			const elementType = this.typeAfterStructIndex(type);
			let elementIndex = 0;
			for (let index = 0; index < table.fields.length; index += 1) {
				const field = table.fields[index];
				if (field.kind !== LuaTableFieldKind.Array) {
					throw new Error(`[Compiler] ${sectionName} arrays use positional initializers.`);
				}
				this.writeStorageInitializer(out, byteOffset + elementIndex * elementType.size, elementType, field.value, sectionName);
				elementIndex += 1;
			}
			if (elementIndex !== type.dimensions[0]) {
				throw new Error(`[Compiler] ${sectionName} array '${type.name}' expects ${type.dimensions[0]} elements.`);
			}
			return;
		}
		if (type.accessKind === null) {
			throw new Error(`[Compiler] ${sectionName} v1 supports primitive typed storage; '${type.name}' is not a primitive scalar at this initializer position.`);
		}
		const value = this.evaluateCompileTimeExpression(expression);
		if (value === undefined || value === null || value === true || value === false || valueIsString(value) || !Number.isInteger(value)) {
			throw new Error(`[Compiler] ${sectionName} primitive initializer must be a compile-time integer.`);
		}
		const word = value as number;
		switch (type.accessKind) {
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
				throw new Error(`[Compiler] ${sectionName} v1 does not support '${type.name}' initializers.`);
		}
	}

	private compileLocalAssignment(statement: LuaLocalAssignmentStatement): void {
		const tempsBase = this.tempTop;
		const names = statement.names;
		const attributes = statement.attributes;
		const pointerTypeRefs = statement.pointerTypeRefs;
		const values = statement.values;
		if (names.length === 1 && attributes[0] === 'const' && values.length === 1 && values[0].kind === LuaSyntaxKind.FunctionExpression) {
			const decl = this.requireBoundDeclaration(names[0].range, `local '${names[0].name}'`);
			const name = decl.name;
			const target = this.declareLocalFromDecl(decl, names[0].range);
			const hint = this.createLocalFunctionHint(name);
			const closureProtoIndex = this.compileExpressionWithStaticClosureProto(values[0], target, 1, hint);
			const binding = this.localBindings.get(decl.id);
			if (binding !== undefined) {
				binding.constClosureProtoIndex = closureProtoIndex;
			}
			if (closureProtoIndex !== null) {
				this.program.markStaticClosureProto(closureProtoIndex);
			}
			this.tempTop = Math.max(this.tempTop, tempsBase);
			return;
		}
		const valueRegs: Array<number | undefined> = new Array(names.length);
		const initializerValues: Array<Value | undefined> = new Array(names.length);
		const initializerClosureProtoIndices: Array<number | undefined> = new Array(names.length);
		const initializerModuleBindings: Array<ModuleBinding | undefined> = new Array(names.length);
		if (values.length > 0) {
			const lastIndex = values.length - 1;
			for (let i = 0; i < lastIndex; i += 1) {
				const expr = values[i];
				if (i < names.length && attributes[i] === 'const') {
					const moduleBinding = this.tryResolveStaticModuleBinding(expr, true);
					if (moduleBinding !== null) {
						if (moduleBinding.external && !this.isConstModulePath(moduleBinding.modulePath)) {
							this.markStaticExternalModulePath(moduleBinding.modulePath);
						}
						if (moduleBinding.exportDepth === 0) {
							initializerModuleBindings[i] = moduleBinding;
							if (moduleBinding.external) {
								initializerValues[i] = null;
								continue;
							}
						}
					}
				}
				const constantValue = this.evaluateCompileTimeExpression(expr);
				if (constantValue !== undefined) {
					if (i < names.length) {
						initializerValues[i] = constantValue;
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
					valueRegs[i] = reg;
					if (attributes[i] === 'const' && closureProtoIndex !== null) {
						initializerClosureProtoIndices[i] = closureProtoIndex;
						this.program.markStaticClosureProto(closureProtoIndex);
					}
				}
			}
			const lastExpr = values[lastIndex];
			const remaining = names.length - lastIndex;
			const wantsMulti = remaining > 1 && this.isMultiReturnExpression(lastExpr);
			const lastHasName = lastIndex < names.length;
			if (lastHasName && attributes[lastIndex] === 'const' && !wantsMulti) {
				const moduleBinding = this.tryResolveStaticModuleBinding(lastExpr, true);
				if (moduleBinding !== null) {
					if (moduleBinding.external && !this.isConstModulePath(moduleBinding.modulePath)) {
						this.markStaticExternalModulePath(moduleBinding.modulePath);
					}
					if (moduleBinding.exportDepth === 0) {
						initializerModuleBindings[lastIndex] = moduleBinding;
						if (moduleBinding.external) {
							initializerValues[lastIndex] = null;
						}
					}
				}
			}
			const constantValue = this.evaluateCompileTimeExpression(lastExpr);
			if (initializerValues[lastIndex] !== undefined && !wantsMulti) {
			} else if (constantValue !== undefined && !wantsMulti) {
				if (lastHasName) {
					initializerValues[lastIndex] = constantValue;
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
					valueRegs[lastIndex] = lastReg;
					if (attributes[lastIndex] === 'const' && closureProtoIndex !== null) {
						initializerClosureProtoIndices[lastIndex] = closureProtoIndex;
						this.program.markStaticClosureProto(closureProtoIndex);
					}
				}
				if (wantsMulti) {
					this.reserveTempRange(lastReg, remaining);
					for (let i = 1; i < remaining && lastIndex + i < names.length; i += 1) {
						valueRegs[lastIndex + i] = lastReg + i;
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
				throw new Error(`[Compiler] Constant local '${name}' must have an initializer.`);
			}
			const initializerValue = initializerValues[i];
			let initializerClosureProtoIndex: number | null = null;
			let initializerModuleBinding: ModuleBinding | null = null;
			if (attribute === 'const') {
				const closureProtoIndex = initializerClosureProtoIndices[i];
				if (closureProtoIndex !== undefined) {
					initializerClosureProtoIndex = closureProtoIndex;
				}
				const moduleBinding = initializerModuleBindings[i];
				if (moduleBinding !== undefined) {
					initializerModuleBinding = moduleBinding;
				}
			}
			let constValue: Value | null = null;
			if (initializerValue !== undefined) {
				constValue = initializerValue;
			}
			const target = this.declareLocal(
				decl.id,
				decl.name,
				names[i].range,
				undefined,
				attribute === 'const' ? 'const' : 'local',
				constValue,
				initializerValue !== undefined && attribute === 'const',
				initializerClosureProtoIndex,
				initializerModuleBinding,
			);
			const pointerTypeRef = pointerTypeRefs[i];
			if (pointerTypeRef !== null) {
				const binding = this.localBindings.get(decl.id);
				if (binding !== undefined) {
					binding.structView = {
						type: this.resolveStructTypeReference(pointerTypeRef),
					};
				}
			}
			if (initializerValue !== undefined) {
				this.emitLoadConst(target, initializerValue);
				continue;
			}
			const valueReg = valueRegs[i];
			if (valueReg !== undefined) {
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
		if (statement.operator === LuaAssignmentOperator.Assign) {
			for (let i = 0; i < targets.length; i += 1) {
				const target = targets[i];
				if (target.kind === 'memory' && target.validateAddress !== undefined && i < statement.right.length) {
					this.validateMemoryStore(target.validateAddress, statement.right[i]);
				}
			}
		}
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
			if (
				expr.kind === LuaSyntaxKind.MemberExpression ||
				expr.kind === LuaSyntaxKind.IndexExpression ||
				(expr.kind === LuaSyntaxKind.UnaryExpression && (expr as LuaUnaryExpression).operator === LuaUnaryOperator.Dereference)
			) {
				const structAddress = this.tryResolveStructAddress(expr);
				if (structAddress !== null) {
					if (structAddress.readOnly) {
						throw new Error('[Compiler] Cannot assign to .rodata storage.');
					}
					if (structAddress.type.accessKind === null) {
						throw new Error(`[Compiler] Whole-struct assignment is not supported for '${structAddress.type.name}'; assign scalar fields directly.`);
					}
					targets.push({
						kind: 'memory',
						accessKind: structAddress.type.accessKind!,
						addrReg: structAddress.baseReg,
						addrOffsetBytes: structAddress.byteOffset,
					});
					continue;
				}
				if (expr.kind === LuaSyntaxKind.UnaryExpression) {
					throw new Error('[Compiler] Pointer dereference assignment requires a typed pointer.');
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
						throw new Error(`[Compiler] '${name}' is a constant local and cannot be assigned.`);
					}
					targets.push({ kind: 'local', reg: localBinding.reg });
					continue;
				}
				const visibleBinding = this.resolveReferenceVisibleBinding(reference);
				if (visibleBinding !== null && visibleBinding.kind === 'const') {
					throw new Error(`[Compiler] '${name}' is a constant local and cannot be assigned.`);
				}
				if (this.resolveReferenceBssBinding(reference) !== null) {
					throw new Error(`[Compiler] '${name}' is .bss storage; assign through a typed pointer or field.`);
				}
				const upvalue = this.resolveReferenceUpvalue(reference);
				if (upvalue !== null) {
					targets.push({ kind: 'upvalue', upvalue });
					continue;
				}
				if (reference.kind === 'map') {
					throw new Error(`[Compiler] '${name}' is a reserved memory map. Use direct indexing syntax like ${name}[addr].`);
				}
				if (reference.kind === 'reserved_intrinsic') {
					throw new Error(`[Compiler] '${name}' is a reserved intrinsic.`);
				}
				if (reference.kind === 'unresolved') {
					throw new Error(`[Compiler] '${name}' is not defined.`);
				}
				const access = this.program.resolveGlobalAccess(name);
				targets.push({ kind: 'global', slot: access.slot, system: access.system });
				continue;
			}
			if (targetPreparation.kind === 'member') {
				const member = expr as LuaMemberExpression;
				const baseReg = this.allocTemp();
				this.compileExpressionInto(targetPreparation.base, baseReg, 1);
				const keyConst = this.program.constIndexString(member.identifier);
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
				const keyConst = this.tryGetConstIndex(targetPreparation.index);
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
				this.emitModuleExportGlobalStores(base, this.moduleCompileInfo);
				this.emitABC(OpCode.RET, base, 1, 0);
				return;
			}
			this.compileExpressionInto(expressions[0], base, wantsMulti ? 0 : 1);
			this.emitABC(OpCode.RET, base, wantsMulti ? 0 : 1, 0);
			return;
		}
		this.reserveTempRange(base, expressions.length);
		for (let i = 0; i < expressions.length; i += 1) {
			this.compileExpressionInto(expressions[i], base + i, 1);
		}
		this.emitABC(OpCode.RET, base, expressions.length, 0);
	}

	private compileIf(statement: LuaIfStatement): void {
		const endJumps: number[] = [];
		for (let i = 0; i < statement.clauses.length; i += 1) {
			const clause = statement.clauses[i];
			if (clause.condition) {
				const condReg = this.allocTemp();
				this.compileExpressionInto(clause.condition, condReg, 1);
				const jumpToNext = this.emitJumpPlaceholder(OpCode.JMPIFNOT, condReg);
				this.pushScope(clause.block.range);
				for (let j = 0; j < clause.block.body.length; j += 1) {
					this.compileStatement(clause.block.body[j]);
					this.resetTemps();
				}
				this.popScope();
				endJumps.push(this.emitJumpPlaceholder());
				this.patchJump(jumpToNext, this.code.length);
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
		const condReg = this.allocTemp();
		this.compileExpressionInto(statement.condition, condReg, 1);
		const jumpOut = this.emitJumpPlaceholder(OpCode.JMPIFNOT, condReg);
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
		this.patchJump(jumpOut, this.code.length);
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
		const condReg = this.allocTemp();
		this.compileExpressionInto(statement.condition, condReg, 1);
		this.emitAsBx(OpCode.JMPIFNOT, condReg, loopStart - (this.code.length + 1));
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
		this.emitABC(OpCode.CALL, callBase, argCount, resultCount);

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

	private compileLocalFunction(statement: any): void {
		const decl = this.requireBoundDeclaration(statement.name.range, `local function '${statement.name.name}'`);
		const name = decl.name;
		const reg = this.declareLocalFromDecl(decl, statement.name.range);
		const hint = this.createLocalFunctionHint(name);
		const protoId = buildProtoId(this.protoId, hint);
		const protoIndex = compileFunctionExpression(this.program, statement.functionExpression, this, false, protoId, this.moduleId, this.semantics, this.frontend);
		this.emitABx(OpCode.CLOSURE, reg, protoIndex);
	}

	private compileFunctionDeclaration(statement: any): void {
		const fnExpr = statement.functionExpression as LuaFunctionExpression;
		const methodName = statement.name.methodName;
		const identifiers = statement.name.identifiers as string[];
		const target = classifyFunctionDeclarationTarget(this.semantics, statement);
		const hint = buildDeclarationHint(identifiers, methodName);
		const protoId = buildProtoId(this.protoId, hint);
		const protoIndex = compileFunctionExpression(this.program, fnExpr, this, methodName && methodName.length > 0, protoId, this.moduleId, this.semantics, this.frontend);
		if (target.kind === 'path') {
			this.maybeRecordModuleExportProto(target.baseReference, [...target.intermediateKeys, target.finalKey], protoId, protoIndex);
		}
		const closureReg = this.allocTemp();
		this.emitABx(OpCode.CLOSURE, closureReg, protoIndex);
		if (identifiers.length === 0) {
			throw new Error('Function declaration missing name.');
		}
		if (target.kind === 'simple') {
			if (!target.finalReference) {
				throw new Error(`[Compiler] Missing bound function target for '${identifiers[0]}'.`);
			}
			this.emitReferenceStore(target.finalReference, closureReg);
			return;
		}

		const baseReg = this.allocTemp();
		if (!target.baseReference) {
			throw new Error(`[Compiler] Missing bound function base for '${identifiers[0]}'.`);
		}
		this.emitReferenceLoad(target.baseReference, baseReg);
		for (let i = 0; i < target.intermediateKeys.length; i += 1) {
			const key = this.program.constIndexString(target.intermediateKeys[i]);
			const nextReg = this.allocTemp();
			this.emitTableGetConst(nextReg, baseReg, key);
			this.emitABC(OpCode.MOV, baseReg, nextReg, 0);
		}
		const keyName = target.finalKey;
		const keyConst = this.program.constIndexString(keyName);
		this.emitTableSetConst(baseReg, keyConst, closureReg);
	}

	// The symbol handle of this module's exported namespace local: the local that the
	// module returns (e.g. `room` in `return room`). null when the module does not
	// return a bare local. Cached because it is consulted per export definition.
	private getExportRootSymbolHandle(): string | null {
		if (this.exportRootSymbolHandleCache !== undefined) {
			return this.exportRootSymbolHandleCache;
		}
		let handle: string | null = null;
		const ret = this.moduleCompileInfo?.returnExpression;
		if (ret && ret.kind === LuaSyntaxKind.IdentifierExpression) {
			const ref = getResolvedIdentifierReference(this.semantics, ret as LuaIdentifierExpression);
			handle = (ref ? getResolvedReferenceSymbolHandle(ref) : null) ?? null;
		}
		this.exportRootSymbolHandleCache = handle;
		return handle;
	}

	// Record a static-closure function export defined as `function <ns>.path()` (or
	// `<ns>.path = function`), where <ns> is this module's returned namespace. The
	// linker resolves such an export directly to its proto (a link-time symbol)
	// instead of a runtime global-slot load. No-op for anything that does not qualify.
	private maybeRecordModuleExportProto(baseReference: LuaBoundReference | null, exportPath: ReadonlyArray<string>, protoId: string, protoIndex: number): boolean {
		const moduleInfo = this.moduleCompileInfo;
		if (moduleInfo === undefined || !baseReference) {
			return false;
		}
		const baseHandle = getResolvedReferenceSymbolHandle(baseReference);
		if (!baseHandle || baseHandle !== this.getExportRootSymbolHandle()) {
			return false;
		}
		if (!moduleInfo.exportSlotsByPathKey.has(buildModuleExportPathKey(exportPath)) || !this.program.protoHasNoUpvalues(protoIndex)) {
			return false;
		}
		// An exported function with no upvalues is a link-time symbol: mark its proto
		// as a static (shared) closure so referencing it allocates nothing.
		this.program.markStaticClosureProto(protoIndex);
		this.program.recordExportProto(buildModuleExportSlotName(moduleInfo.path, exportPath), protoId);
		return true;
	}

	private compileExpressionInto(expression: LuaExpression, target: number, resultCount: number, protoIdHint: string | null = null): void {
		this.withRange(expression.range, () => {
			switch (expression.kind) {
				case LuaSyntaxKind.NumericLiteralExpression:
					this.emitLoadConst(target, expression.value);
					return;
				case LuaSyntaxKind.StringLiteralExpression:
					this.emitLoadConst(target, this.program.internString(expression.value));
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
		const constExport = this.tryResolveModuleExportConstValue(expression as LuaMemberExpression);
		if (constExport !== null) {
			this.emitLoadConstExportValue(target, constExport.value);
			return;
		}
		const staticFunctionExportBinding = this.tryResolveStaticFunctionExportBinding(expression as LuaMemberExpression);
		if (staticFunctionExportBinding !== null) {
			this.failStaticFunctionExportValueUse(staticFunctionExportBinding);
		}
		const slotName = this.tryResolveModuleExportSlotFromExpression(expression as LuaMemberExpression);
		if (slotName !== undefined) {
			this.emitModuleExportValueLoad(slotName, target);
			return;
		}
		const structAddress = this.tryResolveStructScalarAddress(expression as LuaMemberExpression);
		if (structAddress !== null) {
			this.emitMemoryLoad(target, structAddress.type.accessKind!, undefined, structAddress.baseReg, structAddress.byteOffset);
			return;
		}
		const rootFieldSlot = this.tryResolveExternalModuleRootFieldSlotName(expression.base, expression.identifier);
		if (rootFieldSlot !== undefined) {
			this.emitModuleSlotRelocLoad(rootFieldSlot, target);
			return;
		}
		const baseReg = this.allocTemp();
		this.compileExpressionInto(expression.base, baseReg, 1);
		const key = this.program.constIndexString(expression.identifier);
		this.emitTableGetConst(target, baseReg, key);
	}

	private compileIndexExpression(expression: any, target: number): void {
		const constExport = this.tryResolveModuleExportConstValue(expression as LuaIndexExpression);
		if (constExport !== null) {
			this.emitLoadConstExportValue(target, constExport.value);
			return;
		}
		const staticFunctionExportBinding = this.tryResolveStaticFunctionExportBinding(expression as LuaIndexExpression);
		if (staticFunctionExportBinding !== null) {
			this.failStaticFunctionExportValueUse(staticFunctionExportBinding);
		}
		const slotName = this.tryResolveModuleExportSlotFromExpression(expression as LuaIndexExpression);
		if (slotName !== undefined) {
			this.emitModuleExportValueLoad(slotName, target);
			return;
		}
		const structAddress = this.tryResolveStructScalarAddress(expression as LuaIndexExpression);
		if (structAddress !== null) {
			this.emitMemoryLoad(target, structAddress.type.accessKind!, undefined, structAddress.baseReg, structAddress.byteOffset);
			return;
		}
		const keyStatic = extractTableKeyFromExpression((expression as LuaIndexExpression).index);
		const rootFieldSlot = keyStatic !== undefined
			? this.tryResolveExternalModuleRootFieldSlotName(expression.base, keyStatic)
			: undefined;
		if (rootFieldSlot !== undefined) {
			this.emitModuleSlotRelocLoad(rootFieldSlot, target);
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
		const keyConst = this.tryGetConstIndex(expression.index);
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
				const keyConst = this.program.constIndexString(field.name);
				this.emitTableSetConst(target, keyConst, valueReg);
				this.tempTop = tempBase;
				continue;
			}
			const keyConst = this.tryGetConstIndex(field.key);
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

	private tryGetConstIndex(expression: LuaExpression): number | undefined {
		const constValue = this.evaluateCompileTimeExpression(expression);
		if (constValue === undefined) {
			return undefined;
		}
		return this.program.constIndex(constValue);
	}

	private tryGetNumericConstIndex(expression: LuaExpression): number | undefined {
		const constValue = this.evaluateCompileTimeExpression(expression);
		if (typeof constValue !== 'number') {
			return undefined;
		}
		return this.program.constIndex(constValue);
	}

	private tryEvaluateCompileTimeNumber(expression: LuaExpression): number | undefined {
		const constValue = this.evaluateCompileTimeExpression(expression);
		if (constValue === undefined || constValue === null || constValue === true || constValue === false || valueIsString(constValue)) {
			return undefined;
		}
		return constValue as number;
	}

	private tryCompileDisplacedAddress(expression: LuaExpression): { baseReg: number; byteOffset: number } | null {
		if (expression.kind !== LuaSyntaxKind.BinaryExpression) {
			return null;
		}
		const binary = expression as LuaBinaryExpression;
		if (binary.operator !== LuaBinaryOperator.Add && binary.operator !== LuaBinaryOperator.Subtract) {
			return null;
		}
		const rightOffset = this.tryEvaluateCompileTimeNumber(binary.right);
		if (rightOffset !== undefined) {
			const baseReg = this.allocTemp();
			this.compileExpressionInto(binary.left, baseReg, 1);
			return {
				baseReg,
				byteOffset: binary.operator === LuaBinaryOperator.Subtract ? -rightOffset : rightOffset,
			};
		}
		if (binary.operator === LuaBinaryOperator.Add) {
			const leftOffset = this.tryEvaluateCompileTimeNumber(binary.left);
			if (leftOffset !== undefined) {
				const baseReg = this.allocTemp();
				this.compileExpressionInto(binary.right, baseReg, 1);
				return { baseReg, byteOffset: leftOffset };
			}
		}
		return null;
	}

	private compileMemoryTarget(target: Extract<ReturnType<typeof classifyAssignmentTargetPreparation>, { kind: 'memory' }>): Extract<AssignmentTarget, { kind: 'memory' }> {
		const addrConst = this.tryGetNumericConstIndex(target.index);
		if (addrConst !== undefined) {
			return { kind: 'memory', accessKind: target.accessKind, addrConst, validateAddress: target.index };
		}
		const displaced = this.tryCompileDisplacedAddress(target.index);
		if (displaced !== null) {
			return {
				kind: 'memory',
				accessKind: target.accessKind,
				addrReg: displaced.baseReg,
				addrOffsetBytes: displaced.byteOffset,
				validateAddress: target.index,
			};
		}
		const addrReg = this.allocTemp();
		this.compileExpressionInto(target.index, addrReg, 1);
		return { kind: 'memory', accessKind: target.accessKind, addrReg, validateAddress: target.index };
	}

	private compileStructIndexAddress(base: StructAddress, indexExpression: LuaExpression): StructAddress {
		let elementType: StructResolvedType;
		if (base.type.dimensions.length > 0) {
			elementType = this.typeAfterStructIndex(base.type);
		} else {
			if (!base.pointerIndex) {
				throw new Error(`[Compiler] Type '${base.type.name}' is not an array.`);
			}
			elementType = base.type;
		}
		const stride = elementType.size;
		const staticIndex = this.tryEvaluateCompileTimeNumber(indexExpression);
		if (staticIndex !== undefined) {
			if (!Number.isInteger(staticIndex)) {
				throw new Error('[Compiler] Struct array index must be an integer when used as a compile-time offset.');
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

	private tryResolveStructAddress(expression: LuaExpression): StructAddress | null {
		switch (expression.kind) {
			case LuaSyntaxKind.IdentifierExpression: {
				const reference = getResolvedIdentifierReference(this.semantics, expression as LuaIdentifierExpression);
				const bssBinding = this.resolveReferenceBssBinding(reference);
				if (bssBinding !== null) {
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
				if (dataBinding !== null) {
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
				if (rodataBinding !== null) {
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
				const binding = this.resolveReferenceVisibleBinding(reference);
				if (binding === null || binding.structView === null) {
					return null;
				}
				const localReg = this.resolveReferenceLocal(reference);
				if (localReg !== null) {
					return {
						baseReg: localReg,
						byteOffset: 0,
						type: binding.structView.type,
						pointerIndex: true,
						readOnly: false,
					};
				}
				const baseReg = this.allocTemp();
				this.emitReferenceLoad(reference, baseReg);
				return {
					baseReg,
					byteOffset: 0,
					type: binding.structView.type,
					pointerIndex: true,
					readOnly: false,
				};
			}
			case LuaSyntaxKind.MemberExpression: {
				const member = expression as LuaMemberExpression;
				const base = this.tryResolveStructAddress(member.base);
				return base === null ? null : this.resolveStructFieldAddress(base, member.identifier);
			}
			case LuaSyntaxKind.IndexExpression: {
				const index = expression as LuaIndexExpression;
				const base = this.tryResolveStructAddress(index.base);
				return base === null ? null : this.compileStructIndexAddress(base, index.index);
			}
			case LuaSyntaxKind.UnaryExpression: {
				const unary = expression as LuaUnaryExpression;
				if (unary.operator !== LuaUnaryOperator.Dereference) {
					return null;
				}
				const base = this.tryResolveStructAddress(unary.operand);
				return base === null ? null : {
					baseReg: base.baseReg,
					byteOffset: base.byteOffset,
					type: base.type,
					pointerIndex: false,
					readOnly: base.readOnly,
				};
			}
			default:
				return null;
		}
	}

	private tryResolveStructScalarAddress(expression: LuaExpression): StructAddress | null {
		const address = this.tryResolveStructAddress(expression);
		if (address === null) {
			return null;
		}
		if (address.type.accessKind === null) {
			throw new Error(`[Compiler] Struct expression '${address.type.name}' is an address range; use '&' to pass its address or select a scalar field.`);
		}
		return address;
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

	private tryResolveConstantMemoryAddress(addressExpression: LuaExpression): number | undefined {
		const constValue = this.evaluateCompileTimeExpression(addressExpression);
		if (typeof constValue === 'number') return constValue;
		if (addressExpression.kind === LuaSyntaxKind.IdentifierExpression) {
			const reference = getResolvedIdentifierReference(this.semantics, addressExpression as LuaIdentifierExpression);
			if (reference.kind === 'lexical') {
				const symbolHandle = getResolvedReferenceSymbolHandle(reference);
				if (symbolHandle !== null) {
					const binding = this.resolveVisibleBinding(symbolHandle);
					if (binding !== null && binding.hasConstValue && typeof binding.constValue === 'number') {
						return binding.constValue;
					}
				}
			}
		}
		return undefined;
	}

	private resolveMemoryStoreRequirement(addressExpression: LuaExpression): MmioWriteRequirement {
		const address = this.tryResolveConstantMemoryAddress(addressExpression);
		if (address !== undefined) {
			const spec = MMIO_REGISTER_SPEC_BY_ADDRESS.get(address);
			if (spec) return spec.writeRequirement;
			return 'any';
		}
		if (addressExpression.kind === LuaSyntaxKind.IdentifierExpression) {
			const reference = getResolvedIdentifierReference(this.semantics, addressExpression as LuaIdentifierExpression);
			if (reference.kind === 'global') {
				const name = this.getReferenceName(reference);
				const spec = MMIO_REGISTER_SPEC_BY_NAME.get(name);
				if (spec) return spec.writeRequirement;
			}
		}
		return 'any';
	}

	private resolveMemoryStoreRegisterName(addressExpression: LuaExpression): string | undefined {
		const address = this.tryResolveConstantMemoryAddress(addressExpression);
		if (address !== undefined) {
			return MMIO_REGISTER_SPEC_BY_ADDRESS.get(address)?.name;
		}
		if (addressExpression.kind === LuaSyntaxKind.IdentifierExpression) {
			const reference = getResolvedIdentifierReference(this.semantics, addressExpression as LuaIdentifierExpression);
			if (reference.kind === 'global') {
				const name = this.getReferenceName(reference);
				if (MMIO_REGISTER_SPEC_BY_NAME.has(name)) return name;
			}
		}
		return undefined;
	}

	private validateMemoryStore(addressExpression: LuaExpression, valueExpression: LuaExpression): void {
		const requirement = this.resolveMemoryStoreRequirement(addressExpression);
		if (requirement === 'any') return;
		const valueKind = this.flowAnalysis!.evaluateExpressionValueKind(valueExpression, this.currentFlowState);
		if (valueKind === 'string_id') return;
		const registerName = this.resolveMemoryStoreRegisterName(addressExpression);
		const target = registerName ? `Register '${registerName}'` : 'This memory-mapped register';
		throw new LuaSyntaxError(
			`${target} requires an interned string-id value (&expr). The expression at this point is not proven to be an interned string id (got: ${valueKind}).`,
			valueExpression.range.path,
			valueExpression.range.start.line,
			valueExpression.range.start.column,
		);
	}

	private compileStringIdUnaryExpression(expression: LuaUnaryExpression, target: number, resultCount: number): void {
		const structAddress = this.tryResolveStructAddress(expression.operand);
		if (structAddress !== null) {
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
		const constIndex = this.tryGetConstIndex(expression);
		if (constIndex !== undefined) {
			return this.encodeConstOperand(constIndex);
		}
		const reg = this.allocTemp();
		this.compileExpressionInto(expression, reg, 1);
		return reg;
	}

	private compileUnaryExpression(expression: LuaUnaryExpression, target: number, resultCount: number): void {
		if (expression.operator === LuaUnaryOperator.StringId) {
			this.compileStringIdUnaryExpression(expression, target, resultCount);
			return;
		}
		if (expression.operator === LuaUnaryOperator.Dereference) {
			const structAddress = this.tryResolveStructScalarAddress(expression);
			if (structAddress === null) {
				throw new Error('[Compiler] Pointer dereference requires a typed pointer.');
			}
			this.emitMemoryLoad(target, structAddress.type.accessKind!, undefined, structAddress.baseReg, structAddress.byteOffset);
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
		switch (expression.operator) {
			case LuaBinaryOperator.And:
				this.compileAndExpression(expression, target);
				return;
			case LuaBinaryOperator.Or:
				this.compileOrExpression(expression, target);
				return;
			case LuaBinaryOperator.Equal:
				this.compileComparison(OpCode.EQ, expression.left, expression.right, target);
				return;
			case LuaBinaryOperator.NotEqual:
				this.compileComparison(OpCode.EQ, expression.left, expression.right, target);
				this.emitABC(OpCode.NOT, target, target, 0);
				return;
			case LuaBinaryOperator.LessThan:
				this.compileComparison(OpCode.LT, expression.left, expression.right, target);
				return;
			case LuaBinaryOperator.LessEqual:
				this.compileComparison(OpCode.LE, expression.left, expression.right, target);
				return;
			case LuaBinaryOperator.GreaterThan:
				this.compileComparison(OpCode.LT, expression.right, expression.left, target);
				return;
			case LuaBinaryOperator.GreaterEqual:
				this.compileComparison(OpCode.LE, expression.right, expression.left, target);
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

	private compileComparison(op: OpCode, left: LuaExpression, right: LuaExpression, target: number): void {
		const leftOperand = this.compileRKOperand(left);
		const rightOperand = this.compileRKOperand(right);
		this.emitLoadBool(target, true);
		this.emitABC(op, 1, leftOperand, rightOperand, RK_B | RK_C);
		const jump = this.emitJumpPlaceholder();
		this.emitLoadBool(target, false);
		this.patchJump(jump, this.code.length);
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

	private compileCallExpression(expression: LuaCallExpression, target: number, resultCount: number): void {
		const requireBinding = this.tryResolveRequireModuleBinding(expression);
		if (requireBinding !== null && this.isConstModulePath(requireBinding.modulePath)) {
			this.failCompileTimeModuleRootRuntimeUse(requireBinding.modulePath);
		}
		const methodName = expression.methodName;
		const hasMethod = methodName !== null && methodName.length > 0;
		const moduleMethodSlot = hasMethod ? this.tryResolveModuleExportMethodSlot(expression.callee, methodName) : undefined;
		const constModuleValueCallee = !hasMethod ? this.tryResolveModuleExportConstValue(expression.callee) : null;
		const moduleCallSlot = !hasMethod ? this.tryResolveModuleExportCallTargetSlot(expression.callee) : undefined;
		const ownStaticFunctionExportSlot = !hasMethod ? this.tryResolveOwnStaticFunctionExportCallSlot(expression.callee) : undefined;
		const constClosureBinding = !hasMethod && expression.callee.kind === LuaSyntaxKind.IdentifierExpression
			? this.resolveReferenceConstClosureBinding(getResolvedIdentifierReference(this.semantics, expression.callee as LuaIdentifierExpression))
			: null;
		if (constModuleValueCallee !== null) {
			this.failConstModuleValueCall(constModuleValueCallee.binding);
		}
		const callProtoIndex = constClosureBinding !== null ? constClosureBinding.constClosureProtoIndex : null;
		const argCount = expression.arguments.length;
		const lastArg = argCount > 0 ? expression.arguments[argCount - 1] : null;
		const hasVarArg = lastArg !== null && this.isMultiReturnExpression(lastArg);
		const fixedArgCount = hasVarArg ? argCount - 1 : argCount;
		const callSlotCount = fixedArgCount + (hasMethod ? 2 : 1) + (hasVarArg ? 1 : 0);
		const resultSlots = resultCount > 0 ? resultCount : 0;
		const requiredSlots = Math.max(callSlotCount, resultSlots);
		const tempBase = this.tempTop;
		const useTarget = resultCount === 0 || (target >= this.localCount && target === tempBase - 1);
		const callBase = useTarget ? target : this.allocTempBlock(requiredSlots);
		if (useTarget) {
			this.reserveTempRange(callBase, requiredSlots);
		}
		if (moduleMethodSlot !== undefined) {
			this.emitModuleExportCallTargetLoad(moduleMethodSlot, callBase);
			const selfReg = this.allocTemp();
			this.compileExpressionInto(expression.callee, selfReg, 1);
			if (selfReg !== callBase + 1) {
				this.emitABC(OpCode.MOV, callBase + 1, selfReg, 0);
			}
		} else if (hasMethod) {
			this.reserveTempRange(callBase, 2);
			this.compileExpressionInto(expression.callee, callBase, 1);
			const methodKey = this.program.constIndexString(methodName);
			this.emitSelf(callBase, callBase, methodKey);
		} else if (moduleCallSlot !== undefined) {
			this.emitModuleExportCallTargetLoad(moduleCallSlot, callBase);
		} else if (ownStaticFunctionExportSlot !== undefined) {
			this.emitModuleExportCallTargetLoad(ownStaticFunctionExportSlot, callBase);
		} else {
			this.compileExpressionInto(expression.callee, callBase, 1);
		}
		const argBase = callBase + (hasMethod ? 2 : 1);
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
		let callArgs = fixedArgCount + (hasMethod ? 1 : 0);
		if (hasVarArg) {
			this.compileExpressionInto(expression.arguments[argCount - 1], argBase + fixedArgCount, 0);
			callArgs = 0;
		}
		this.emitABC(OpCode.CALL, callBase, callArgs, resultCount);
		if (callProtoIndex !== null) {
			this.code[this.code.length - 1].callProtoIndex = callProtoIndex;
		}
		if (!useTarget) {
			for (let i = 0; i < resultCount; i += 1) {
				this.emitABC(OpCode.MOV, target + i, callBase + i, 0);
			}
		}
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
	for (let index = 0; index < modules.length; index += 1) {
		const module = modules[index];
		const path = toLuaModulePath(module.path);
		if (seenPaths.has(path)) {
			throw new Error(`[ProgramCompiler] Duplicate ${label} module path '${path}'.`);
		}
		seenPaths.add(path);
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
		canonicalModules.push(canonicalModule);
	}
	return canonicalModules ?? modules;
}

function buildCompilerSemanticFrontend(
	entryChunk: LuaChunk,
	modules: ReadonlyArray<ProgramModule>,
	externalModules: ReadonlyArray<ProgramModule>,
	options: CompileOptions,
): LuaSemanticFrontend {
	let extraGlobalNames: ReadonlyArray<string> = SYSTEM_ROM_GLOBAL_NAMES;
	if (options.baseMetadata) {
		const mergedGlobalNames: string[] = [];
		for (const name of SYSTEM_ROM_GLOBAL_NAMES) {
			mergedGlobalNames.push(name);
		}
		for (const name of options.baseMetadata.systemGlobalNames) {
			mergedGlobalNames.push(name);
		}
		for (const name of options.baseMetadata.globalNames) {
			mergedGlobalNames.push(name);
		}
		extraGlobalNames = mergedGlobalNames;
	}
	const sources = [{
		path: entryChunk.range.path,
		source: requireEntrySource(options, entryChunk.range.path),
	}];
	const sourcePathSet = new Set<string>([entryChunk.range.path]);
	for (let index = 0; index < modules.length; index += 1) {
		const module = modules[index];
		sources.push({
			path: module.path,
			source: requireModuleSource(module),
		});
		sourcePathSet.add(module.path);
	}
	for (let index = 0; index < externalModules.length; index += 1) {
		const module = externalModules[index];
		if (sourcePathSet.has(module.path)) {
			continue;
		}
		sources.push({
			path: module.path,
			source: requireModuleSource(module),
		});
	}
	return buildLuaSemanticFrontend(sources, {
		extraGlobalNames,
	});
}

function collectSemanticCompileErrors(frontend: LuaSemanticFrontend, entryPath: string): CompileError[] {
	const compileErrors: CompileError[] = [];
	for (const [path, file] of frontend.files) {
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
	}, code, ranges, constRelocs, localSlots, builder.getUpvalueNames(), protoId, instructionSet);
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
	}, code, ranges, constRelocs, [], [], protoId, instructionSet);
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
	}, code, ranges, constRelocs, [], [], protoId, instructionSet);
	program.markStaticClosureProto(protoIndex);
	return protoIndex;
}

function createProgramBuilderFromProgram(
	base: Program,
	metadata: ProgramMetadata,
	optLevel: OptimizationLevel,
	preserveProgramRom: boolean,
): ProgramBuilder {
	const builder = new ProgramBuilder(
		base.constPool,
		base.constPoolStringPool,
		optLevel,
		metadata,
		base.code,
		preserveProgramRom ? base.programRom : null,
		preserveProgramRom ? base.programRomTextByteLength : 0,
		!preserveProgramRom,
	);
	const protoIds = metadata.protoIds;
	if (!protoIds || protoIds.length !== base.protos.length) {
		throw new Error('[ProgramBuilder] Base program proto ids missing or mismatched.');
	}
	for (let index = 0; index < base.protos.length; index += 1) {
		const proto = base.protos[index];
		const start = proto.entryPC;
		const end = start + proto.codeLen;
		const code = base.code.subarray(start, end);
		const startWord = start / INSTRUCTION_BYTES;
		const endWord = end / INSTRUCTION_BYTES;
		const ranges: Array<SourceRange | null> = new Array(endWord - startWord);
		for (let rangeIndex = startWord; rangeIndex < endWord; rangeIndex += 1) {
			ranges[rangeIndex - startWord] = metadata.debugRanges[rangeIndex];
		}
		const localSlots = metadata.localSlotsByProto[index];
		const upvalueNames = metadata.upvalueNamesByProto[index];
		builder.seedProto(proto, code, ranges, [], localSlots, upvalueNames, protoIds[index]);
	}
	return builder;
}

export function compileLuaChunkToProgram(chunk: LuaChunk, modules: ReadonlyArray<ProgramModule> = EMPTY_PROGRAM_MODULES, options: CompileOptions = {}): CompiledProgram {
	const optLevel = options.optLevel ?? 0;
	const canonicalModules = canonicalizeProgramModules(modules, 'program');
	const canonicalExternalModules = canonicalizeProgramModules(options.externalModules ?? EMPTY_PROGRAM_MODULES, 'external');
	const frontend = buildCompilerSemanticFrontend(chunk, canonicalModules, canonicalExternalModules, options);
	const constModulePaths = new Set<string>(options.constModulePaths ?? []);
	const moduleCompileContext = buildModuleCompileContext(canonicalModules, canonicalExternalModules, constModulePaths, frontend);
	const semanticErrors = collectSemanticCompileErrors(frontend, chunk.range.path);
	if (semanticErrors.length > 0) {
		throw new Error(buildCompileFailureMessage(semanticErrors));
	}
	const compileErrors: CompileError[] = [];
	let programBuilder: ProgramBuilder;
	if (options.baseProgram) {
		if (!options.baseMetadata) {
			throw new Error('[ProgramBuilder] Base program metadata is required.');
		}
		programBuilder = createProgramBuilderFromProgram(options.baseProgram, options.baseMetadata, optLevel, false);
	} else {
		programBuilder = new ProgramBuilder(null, null, optLevel);
	}
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
		if (info === undefined || !info.constModule) {
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
			});
			staticScope.compileStaticFunctionModuleScope(module.chunk);
			const exports = collectStaticFunctionExports(module.chunk, semantics, info.staticFunctionExportByPathKey);
			for (let exportIndex = 0; exportIndex < exports.length; exportIndex += 1) {
				const fn = exports[exportIndex];
				const protoId = buildProtoId(moduleProtoId, `static:${fn.symbolHandle}`);
				const protoIndex = compileFunctionExpression(programBuilder, fn.expression, staticScope, false, protoId, module.path, semantics, frontend);
				if (!programBuilder.protoHasNoUpvalues(protoIndex)) {
					const upvalueNames = programBuilder.getProtoUpvalueNames(protoIndex);
					throw new Error(`[Compiler] Const module '${module.path}' function export '${fn.symbolHandle}' captures runtime local '${upvalueNames[0]}'; static function exports may use globals, compile-time constants, parameters, function-local declarations, and static storage only.`);
				}
				assertStaticFunctionInstructionSet(module.path, fn.symbolHandle, programBuilder.getProtoInstructionSet(protoIndex));
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
	let sectionInitProtoIndex = -1;
	let irqProtoIndex = -1;
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
			}, entryCode, entryRanges, entryConstRelocs, entryLocalSlots, entryBuilder.getUpvalueNames(), entryProtoId, entryInstructionSet);
	} catch (error) {
		compileErrors.push({
			path: chunk.range.path,
			stage: 'entry',
			message: extractCompileErrorMessage(error, chunk.range.path),
		});
	}
	const moduleProtoMap = new Map<string, number>();
	for (let i = 0; i < canonicalModules.length; i += 1) {
		const module = canonicalModules[i];
		// Const modules are compile-time symbol tables: their exports are inlined at
		// use sites, so they carry no runtime proto and are never required at runtime.
		if (moduleCompileContext.modulesByPath.get(module.path)?.constModule) {
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
				}, code, ranges, constRelocs, localSlots, builder.getUpvalueNames(), moduleProtoId, instructionSet);
			moduleProtoMap.set(module.path, protoIndex);
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
	const { program, metadata, constRelocs, constValueRelocs, data, bss, rodataBytes, rodataSymbols, staticModulePaths } = programBuilder.buildProgram();

	// Ensure module export slot names (built during module compile-info collection)
	// are present in the program metadata so linkers can resolve symbolic module slots.
	// Externals (system ROM modules passed as externalModules) are treated as
	// system globals so they are preferred when resolving symbolic slots.
	for (const [, info] of moduleCompileContext.modulesByPath) {
		// Const module exports are inlined as constants and never resolved through a
		// global slot, so they do not register slot names.
		if (info.constModule) {
			continue;
		}
		for (const slotName of info.exportSlotsByPathKey.values()) {
			if (info.external) {
				if (!metadata.systemGlobalNames.includes(slotName)) {
					metadata.systemGlobalNames.push(slotName);
				}
			} else {
				if (!metadata.globalNames.includes(slotName)) {
					metadata.globalNames.push(slotName);
				}
			}
		}
	}
	return {
		program,
		metadata,
		entryProtoIndex,
		sectionInitProtoIndex,
		irqProtoIndex,
		moduleProtoMap,
		staticModulePaths,
		constRelocs,
		constValueRelocs,
		data,
		bss,
		rodataBytes,
		rodataSymbols,
	};
}

export function appendLuaChunkToProgram(base: Program, programMetadata: ProgramMetadata, chunk: LuaChunk, options: CompileOptions = {}): AppendedProgram {
	const optLevel = options.optLevel;
	const externalModules = canonicalizeProgramModules(options.externalModules ?? EMPTY_PROGRAM_MODULES, 'external');
	const frontend = buildCompilerSemanticFrontend(chunk, EMPTY_PROGRAM_MODULES, externalModules, {
		baseProgram: options.baseProgram,
		baseMetadata: programMetadata,
		optLevel: options.optLevel,
		entrySource: options.entrySource,
	});
	const semanticErrors = collectSemanticCompileErrors(frontend, chunk.range.path);
	if (semanticErrors.length > 0) {
		throw new Error(buildCompileFailureMessage(semanticErrors));
	}
	const programBuilder = createProgramBuilderFromProgram(base, programMetadata, optLevel, true);
	const compileErrors: CompileError[] = [];
	const moduleId = chunk.range.path;
	const entryProtoId = buildEntryProtoId(moduleId);
	let entryProtoIndex = -1;
	let sectionInitProtoIndex = -1;
	const entryBuilder = new FunctionBuilder(programBuilder, null, {
		moduleId,
		protoId: entryProtoId,
		semantics: frontend.getFile(chunk.range.path),
		frontend,
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
			}, entryCode, entryRanges, entryConstRelocs, entryLocalSlots, entryBuilder.getUpvalueNames(), entryProtoId, entryInstructionSet);
	} catch (error) {
		compileErrors.push({
			path: chunk.range.path,
			stage: 'entry',
			message: extractCompileErrorMessage(error, chunk.range.path),
		});
	}
	if (compileErrors.length > 0) {
		throw new Error(buildCompileFailureMessage(compileErrors));
	}
	sectionInitProtoIndex = compileSectionInitProto(programBuilder, moduleId, chunk.range, frontend.getFile(chunk.range.path), frontend);
	const { program, metadata, constRelocs, constValueRelocs, data, bss, rodataBytes, rodataSymbols } = programBuilder.buildProgram();
	return { program, metadata, entryProtoIndex, sectionInitProtoIndex, constRelocs, constValueRelocs, data, bss, rodataBytes, rodataSymbols };
}
// end normalized-body-acceptable
// end repeated-sequence-acceptable
