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
	type LuaFunctionDeclarationStatement,
	type LuaFunctionExpression,
	type LuaIdentifierExpression,
	type LuaIfStatement,
	type LuaIndexExpression,
	type LuaLabelStatement,
	type LuaLocalAssignmentStatement,
	type LuaLocalFunctionStatement,
	type LuaMemberExpression,
	type LuaNumericLiteralExpression,
	type LuaStatement,
	type LuaBooleanLiteralExpression,
	type LuaStringLiteralExpression,
	type LuaStringRefLiteralExpression,
	type LuaReturnStatement,
	type LuaUnaryExpression,
	type LuaSourceRange,
	type LuaTableConstructorExpression,
	type LuaWhileStatement,
	type LuaGotoStatement,
} from '../../lua/syntax/ast';
import { OpCode, type Program, type ProgramMetadata, type Proto, type UpvalueDesc, type Value, type SourceRange, type LocalSlotDebug } from '../cpu/cpu';
import { optimizeInstructions, type Instruction, type InstructionSet, type OptimizationLevel } from './optimizer';
import { buildModuleAliasesFromPaths, stripLuaExtension, type ProgramConstReloc } from './asset';
import { cloneSourceRange } from './source_range';
import { StringPool, StringValue, isStringValue } from '../memory/string_pool';
import { EXT_A_BITS, EXT_B_BITS, EXT_BX_BITS, EXT_C_BITS, INSTRUCTION_BYTES, MAX_BX_BITS, MAX_EXT_CONST, MAX_EXT_REGISTER_BC, MAX_OPERAND_BITS, MAX_SIGNED_BX, MIN_SIGNED_BX, writeInstruction } from '../cpu/instruction_format';
import { buildLuaSemanticFrontend, type LuaBoundReference, type LuaSemanticFrontend, type LuaSemanticFrontendFile } from '../../ide/editor/contrib/intellisense/lua_frontend';
import { MMIO_REGISTER_SPEC_BY_ADDRESS, MMIO_REGISTER_SPEC_BY_NAME, type MmioWriteRequirement } from '../bus/registers';
import { ValueKindFlowAnalyzer, type SymbolFlowState } from './compile_value_flow';
import { ENGINE_SYSTEM_GLOBAL_NAME_SET } from '../firmware/system_globals';
import { LuaSyntaxError } from '../../lua/errors';
import { Decl } from '../../ide/editor/contrib/intellisense/semantic_model';
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

export type CompiledProgram = {
	program: Program;
	metadata: ProgramMetadata;
	entryProtoIndex: number;
	moduleProtoMap: Map<string, number>;
	constRelocs: ProgramConstReloc[];
};

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

export type ProgramModule = {
	path: string;
	chunk: LuaChunk;
	source?: string;
};

export const isLuaCompileError = (value: unknown): value is LuaCompileError =>
	value instanceof LuaSyntaxError;

type CompileOptions = {
	baseProgram?: Program;
	baseMetadata?: ProgramMetadata;
	optLevel?: OptimizationLevel;
	entrySource?: string;
};

const EMPTY_LOCAL_SLOTS: ReadonlyArray<LocalSlotDebug> = [];
const EMPTY_UPVALUE_NAMES: ReadonlyArray<string> = [];

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
};

type ModuleBinding = {
	modulePath: string;
	exportPath: string[];
};

type ModuleExportNode = {
	slotName: string | null;
	children: Map<string, ModuleExportNode>;
};

type ModuleCompileInfo = {
	path: string;
	returnExpression: LuaExpression;
	exportRoot: ModuleExportNode;
	exportSlotsByPathKey: Map<string, string>;
};

type ModuleCompileContext = {
	moduleAliasMap: Map<string, string>;
	modulesByPath: Map<string, ModuleCompileInfo>;
};

type AssignmentTarget =
	| { kind: 'local'; reg: number }
	| { kind: 'upvalue'; upvalue: number }
	| { kind: 'global'; slot: number; system: boolean }
	| { kind: 'table'; tableReg: number; keyConst?: number; keyReg?: number }
	| { kind: 'memory'; accessKind: MemoryAccessKind; addrConst?: number; addrReg?: number };

const RK_B = 1;
const RK_C = 2;

const isConstBxOp = (op: OpCode): boolean =>
	op === OpCode.LOADK
	|| op === OpCode.GETG
	|| op === OpCode.SETG;

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

const MAX_SPECIALIZED_TABLE_OPERAND = MAX_EXT_REGISTER_BC;

const isSmallSignedImmediate = (value: number): boolean =>
	Number.isInteger(value) && value >= MIN_SIGNED_BX && value <= MAX_SIGNED_BX;

class ProgramBuilder {
	public readonly constPool: Value[];
	public readonly stringPool: StringPool;
	public readonly optLevel: OptimizationLevel;
	private readonly constMap: Map<string, number>;
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
	public readonly protoIds: string[] = [];
	private readonly protoIdMap: Map<string, number> = new Map();
	private readonly assignedProtoIds: Set<string> = new Set();

	public constructor(
		baseConstPool: ReadonlyArray<Value> | null = null,
		stringPool: StringPool | null = null,
		optLevel: OptimizationLevel = 0,
		baseMetadata: ProgramMetadata | null = null,
	) {
		this.constPool = baseConstPool ? Array.from(baseConstPool) : [];
		this.stringPool = stringPool ?? new StringPool();
		this.optLevel = optLevel;
		this.constMap = new Map<string, number>();
		this.systemGlobalNameSet = new Set(ENGINE_SYSTEM_GLOBAL_NAME_SET);
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
		return this.stringPool.intern(value);
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

	public resolveGlobalAccess(name: string): { system: boolean; slot: number } {
		if (this.systemGlobalNameSet.has(name)) {
			return { system: true, slot: this.resolveSystemGlobalSlot(name) };
		}
		return { system: false, slot: this.resolveGlobalSlot(name) };
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
			this.protoLocalSlots[existing] = localSlots.map(cloneLocalSlotDebug);
			this.protoUpvalueNames[existing] = Array.from(upvalueNames);
			this.protoInstructionSets[existing] = instructionSet;
			this.protoIds[existing] = protoId;
			return existing;
		}
		const index = this.protos.length;
		this.protos.push(proto);
		this.protoCode.push(code);
		this.protoRanges.push(ranges);
		this.protoConstRelocs.push(constRelocs);
		this.protoLocalSlots.push(localSlots.map(cloneLocalSlotDebug));
		this.protoUpvalueNames.push(Array.from(upvalueNames));
		this.protoInstructionSets.push(instructionSet);
		this.protoIds.push(protoId);
		this.protoIdMap.set(protoId, index);
		return index;
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
		this.protoLocalSlots.push(localSlots.map(cloneLocalSlotDebug));
		this.protoUpvalueNames.push(Array.from(upvalueNames));
		this.protoInstructionSets.push(null);
		this.protoIds.push(protoId);
		this.protoIdMap.set(protoId, index);
	}

	public buildProgram(): { program: Program; metadata: ProgramMetadata; constRelocs: ProgramConstReloc[] } {
		let totalBytes = 0;
		let totalWords = 0;
		for (let i = 0; i < this.protoCode.length; i += 1) {
			totalBytes += this.protos[i].codeLen;
			totalWords += this.protoRanges[i].length;
		}
		const fullCode = new Uint8Array(totalBytes);
		const fullRanges: Array<SourceRange | null> = new Array(totalWords);
		const fullConstRelocs: ProgramConstReloc[] = [];
		let offsetBytes = 0;
		let offsetWords = 0;
		for (let i = 0; i < this.protoCode.length; i += 1) {
			const chunk = this.protoCode[i];
			if (!chunk) {
				throw new Error(`[ProgramBuilder] Missing code for proto index ${i}.`);
			}
			const ranges = this.protoRanges[i];
			this.protos[i].entryPC = offsetBytes;
			fullCode.set(chunk, offsetBytes);
			for (let j = 0; j < ranges.length; j += 1) {
				fullRanges[offsetWords + j] = ranges[j];
			}
			const relocs = this.protoConstRelocs[i];
			for (let j = 0; j < relocs.length; j += 1) {
				const reloc = relocs[j];
				fullConstRelocs.push({
					wordIndex: offsetWords + reloc.wordIndex,
					kind: reloc.kind,
					constIndex: reloc.constIndex,
				});
			}
			offsetBytes += chunk.length;
			offsetWords += ranges.length;
		}
		const metadata: ProgramMetadata = {
			debugRanges: fullRanges,
			protoIds: this.protoIds,
			localSlotsByProto: this.protoLocalSlots,
			upvalueNamesByProto: this.protoUpvalueNames,
			globalNames: this.globalNames.slice(),
			systemGlobalNames: this.systemGlobalNames.slice(),
		};
		return {
			program: {
				code: fullCode,
				constPool: this.constPool,
				protos: this.protos,
				stringPool: this.stringPool,
				constPoolStringPool: this.stringPool,
			},
			metadata,
			constRelocs: fullConstRelocs,
		};
		}

	private makeConstKey(value: Value): string {
		if (value === null) return 'nil';
		if (typeof value === 'number') return `n:${value}`;
		if (isStringValue(value)) return `s:${value.id}`;
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

const buildAnonymousHint = (range: LuaSourceRange): string =>
	`anon:${range.start.line}:${range.start.column}:${range.end.line}:${range.end.column}`;

const buildProtoId = (parentId: string, hint: string): string => {
	if (!hint) throw new Error('Proto hint is required and defensive programming is not allowed.');
	return `${parentId}/${hint}`;
}

const cloneLocalSlotDebug = (slot: LocalSlotDebug): LocalSlotDebug => ({
	name: slot.name,
	register: slot.register,
	definition: cloneSourceRange(slot.definition),
	scope: cloneSourceRange(slot.scope),
});

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
		this.moduleCompileInfo = params.moduleCompileInfo;
	}

	public compileChunk(chunk: LuaChunk): void {
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

	public compileFunctionExpression(expression: LuaFunctionExpression, implicitSelf: boolean): void {
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
						constRelocs.push({ wordIndex: instrWordIndex[index], kind: 'bx', constIndex: instr.b });
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
			range: cloneSourceRange(range),
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
		if (name === 'memwrite') {
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
		};
		this.localBindings.set(symbolHandle, binding);
		const scope = this.scopeStack[this.scopeStack.length - 1];
		scope.locals.push(binding);
		const effectiveScopeRange = scopeRange ?? scope.range;
		this.localDebugSlots.push({
			name,
			register: reg,
			definition: cloneSourceRange(definitionRange),
			scope: cloneSourceRange(effectiveScopeRange),
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
		const kind = decl.kind === 'constant'
			? 'const'
			: (decl.kind === 'parameter' ? 'parameter' : 'local');
		return this.declareLocal(decl.id, decl.name, definitionRange, scopeRange, kind, constValue, hasConstValue, constClosureProtoIndex, moduleBinding);
	}

	private resolveLocalBinding(symbolHandle: string): LocalBinding | undefined {
		return this.localBindings.get(symbolHandle);
	}

	private resolveLocal(symbolHandle: string): number | null {
		const binding = this.resolveLocalBinding(symbolHandle);
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
		const parentLocal = this.parent.resolveLocalBinding(symbolHandle);
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
		const localBinding = this.resolveLocalBinding(symbolHandle);
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

	private getIdentifierReference(expression: LuaIdentifierExpression): LuaBoundReference {
		return getResolvedIdentifierReference(this.semantics, expression);
	}

	private getIdentifierWriteReference(expression: LuaIdentifierExpression): LuaBoundReference {
		return getResolvedIdentifierReference(this.semantics, expression, true);
	}

	private getReferenceSymbolHandle(reference: LuaBoundReference): string | null {
		return getResolvedReferenceSymbolHandle(reference);
	}

	private getReferenceName(reference: LuaBoundReference): string {
		return reference.ref.name;
	}

	private resolveReferenceVisibleBinding(reference: LuaBoundReference): LocalBinding | null {
		const symbolHandle = this.getReferenceSymbolHandle(reference);
		if (!symbolHandle) {
			return null;
		}
		return this.resolveVisibleBinding(symbolHandle);
	}

	private resolveReferenceLocal(reference: LuaBoundReference): number | null {
		const symbolHandle = this.getReferenceSymbolHandle(reference);
		if (!symbolHandle) {
			return null;
		}
		return this.resolveLocal(symbolHandle);
	}

	private resolveReferenceUpvalue(reference: LuaBoundReference): number | null {
		const symbolHandle = this.getReferenceSymbolHandle(reference);
		if (!symbolHandle) {
			return null;
		}
		return this.resolveUpvalue(symbolHandle, this.getReferenceName(reference));
	}

	private resolveReferenceConstBinding(reference: LuaBoundReference): LocalBinding | null {
		const symbolHandle = this.getReferenceSymbolHandle(reference);
		if (!symbolHandle) {
			return null;
		}
		return this.resolveCompileTimeConstBinding(symbolHandle);
	}

	private resolveReferenceConstClosureBinding(reference: LuaBoundReference): LocalBinding | null {
		const symbolHandle = this.getReferenceSymbolHandle(reference);
		if (!symbolHandle) {
			return null;
		}
		return this.resolveCompileTimeConstClosureBinding(symbolHandle);
	}

	private resolveRequiredModulePath(moduleName: string): string | undefined {
		return this.moduleCompileContext?.moduleAliasMap.get(moduleName);
	}

	private resolveModuleCompileInfo(path: string): ModuleCompileInfo | undefined {
		return this.moduleCompileContext?.modulesByPath.get(path);
	}

	private resolveModuleExportSlotName(modulePath: string, exportPath: ReadonlyArray<string>): string | undefined {
		const moduleInfo = this.resolveModuleCompileInfo(modulePath);
		if (!moduleInfo) {
			return undefined;
		}
		return moduleInfo.exportSlotsByPathKey.get(buildModuleExportPathKey(exportPath));
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
		const modulePath = this.resolveRequiredModulePath((call.arguments[0] as LuaStringLiteralExpression).value);
		if (!modulePath) {
			return null;
		}
		return {
			modulePath,
			exportPath: [],
		};
	}

	private tryResolveStaticModuleBinding(expression: LuaExpression, allowRequireRoot: boolean): ModuleBinding | null {
		if (allowRequireRoot) {
			const requireBinding = this.tryResolveRequireModuleBinding(expression);
			if (requireBinding !== null) {
				return requireBinding;
			}
		}
		if (expression.kind === LuaSyntaxKind.IdentifierExpression) {
			const binding = this.resolveReferenceVisibleBinding(this.getIdentifierReference(expression as LuaIdentifierExpression));
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
			: this.tryGetModuleExportStaticKey((expression as LuaIndexExpression).index);
		if (!key) {
			return null;
		}
		const exportPath = baseBinding.exportPath.concat(key);
		if (!this.resolveModuleExportSlotName(baseBinding.modulePath, exportPath)) {
			return null;
		}
		return {
			modulePath: baseBinding.modulePath,
			exportPath,
		};
	}

	private tryGetModuleExportStaticKey(expression: LuaExpression): string | null {
		return extractTableKeyFromExpression(expression);
	}

	private tryResolveModuleExportSlotFromExpression(expression: LuaExpression): string | undefined {
		const binding = this.tryResolveStaticModuleBinding(expression, false);
		if (!binding || binding.exportPath.length === 0) {
			return undefined;
		}
		return this.resolveModuleExportSlotName(binding.modulePath, binding.exportPath);
	}

	private tryResolveModuleExportMethodSlot(baseExpression: LuaExpression, methodName: string): string | undefined {
		const binding = this.tryResolveStaticModuleBinding(baseExpression, false);
		if (!binding) {
			return undefined;
		}
		return this.resolveModuleExportSlotName(binding.modulePath, binding.exportPath.concat(methodName));
	}

	private emitReferenceLoad(reference: LuaBoundReference, target: number): void {
		const name = this.getReferenceName(reference);
		const constBinding = this.resolveReferenceConstBinding(reference);
		if (constBinding !== null) {
			this.emitLoadConst(target, constBinding.constValue);
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
			throw new Error(`[Compiler] '${name}' is a reserved intrinsic. Use ${name}(base, ...).`);
		}
		if (reference.kind === 'unresolved') {
			throw new Error(`[Compiler] '${name}' is not defined.`);
		}
		const access = this.program.resolveGlobalAccess(name);
		this.emitABx(access.system ? OpCode.GETSYS : OpCode.GETGL, target, access.slot);
	}

	private emitModuleExportLoad(slotName: string, target: number): void {
		const access = this.program.resolveGlobalAccess(slotName);
		this.emitABx(access.system ? OpCode.GETSYS : OpCode.GETGL, target, access.slot);
	}

	private emitModuleExportStore(slotName: string, valueReg: number): void {
		const access = this.program.resolveGlobalAccess(slotName);
		this.emitABx(access.system ? OpCode.SETSYS : OpCode.SETGL, valueReg, access.slot);
	}

	private emitModuleExportGlobalStores(baseReg: number, exportRoot: ModuleExportNode): void {
		const tempBase = this.tempTop;
		this.emitModuleExportGlobalStoreChildren(baseReg, exportRoot);
		this.tempTop = tempBase;
	}

	private emitModuleExportGlobalStoreChildren(baseReg: number, node: ModuleExportNode): void {
		for (const [key, child] of node.children) {
			const childReg = this.allocTemp();
			const keyConst = this.program.constIndexString(key);
			this.emitTableGetConst(childReg, baseReg, keyConst);
			if (child.slotName !== null) {
				this.emitModuleExportStore(child.slotName, childReg);
			}
			if (child.children.size > 0) {
				this.emitModuleExportGlobalStoreChildren(childReg, child);
			}
		}
	}

	private emitReferenceStore(reference: LuaBoundReference, valueReg: number): void {
		const name = this.getReferenceName(reference);
		const symbolHandle = this.getReferenceSymbolHandle(reference);
		const localBinding = symbolHandle ? this.resolveLocalBinding(symbolHandle) : undefined;
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
		const upvalue = this.resolveReferenceUpvalue(reference);
		if (upvalue !== null) {
			this.emitABC(OpCode.SETUP, valueReg, upvalue, 0);
			return;
		}
		if (reference.kind === 'map') {
			throw new Error(`[Compiler] '${name}' is a reserved memory map. Use direct indexing syntax like ${name}[addr].`);
		}
		if (reference.kind === 'reserved_intrinsic') {
			throw new Error(`[Compiler] '${name}' is a reserved intrinsic. Use ${name}(base, ...).`);
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

	private emitABx(op: OpCode, a: number, bx: number): void {
		this.code.push({
			op,
			a,
			b: bx,
			c: 0,
			format: 'ABx',
			rkMask: 0,
			target: null,
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
		if (isStringValue(keyValue) && keyConst <= MAX_SPECIALIZED_TABLE_OPERAND) {
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
		if (isStringValue(keyValue) && keyConst <= MAX_SPECIALIZED_TABLE_OPERAND) {
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

	private compileExpressionWithStaticClosureProto(expression: LuaExpression, target: number, resultCount: number, protoIdHint: string | null = null): number | null {
		let closureProtoIndex: number | null = null;
		this.withRange(expression.range, () => {
			if (expression.kind === LuaSyntaxKind.FunctionExpression) {
				const protoId = this.createChildProtoId(protoIdHint ?? buildAnonymousHint(expression.range));
				closureProtoIndex = compileFunctionExpression(this.program, expression as LuaFunctionExpression, this, false, protoId, this.moduleId, this.semantics, this.frontend);
				this.emitABx(OpCode.CLOSURE, target, closureProtoIndex);
				return;
			}
			if (expression.kind === LuaSyntaxKind.IdentifierExpression) {
				const binding = this.resolveReferenceConstClosureBinding(this.getIdentifierReference(expression as LuaIdentifierExpression));
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
			case LuaSyntaxKind.StringRefLiteralExpression:
				return this.program.internString((expression as LuaStringRefLiteralExpression).value);
			case LuaSyntaxKind.BooleanLiteralExpression:
				return (expression as LuaBooleanLiteralExpression).value;
			case LuaSyntaxKind.NilLiteralExpression:
				return null;
			case LuaSyntaxKind.IdentifierExpression: {
				const binding = this.resolveReferenceConstBinding(this.getIdentifierReference(expression as LuaIdentifierExpression));
					if (!binding) {
						return undefined;
					}
					return binding.constValue;
			}
			case LuaSyntaxKind.UnaryExpression:
				return this.evaluateCompileTimeUnaryExpression(expression as LuaUnaryExpression);
			case LuaSyntaxKind.BinaryExpression:
				return this.evaluateCompileTimeBinaryExpression(expression as LuaBinaryExpression);
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
				return isStringValue(operand) ? operand.codepointCount : undefined;
			case LuaUnaryOperator.BitwiseNot:
				return typeof operand === 'number' ? ~operand : undefined;
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
				return this.evaluateCompileTimeNumericBinary(expression.left, expression.right, (a, b) => a % b);
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
		if (isStringValue(left)) {
			return isStringValue(right) && left.text === right.text;
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
		if (isStringValue(left) && isStringValue(right)) {
			return comparator(left.text, right.text);
		}
		return undefined;
	}

	private isCompileTimeConcatValue(value: Value): boolean {
		return typeof value === 'number' || isStringValue(value);
	}

	private toCompileTimeString(value: Value): string {
		return isStringValue(value) ? value.text : String(value);
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
				default:
					throw new Error(`Unsupported statement kind: ${(statement as LuaStatement).kind}`);
			}
		});
	}

	private compileLocalAssignment(statement: LuaLocalAssignmentStatement): void {
		const tempsBase = this.tempTop;
		const names = statement.names;
		const attributes = statement.attributes;
		const values = statement.values;
		if (names.length === 1 && attributes[0] === 'const' && values.length === 1 && values[0].kind === LuaSyntaxKind.FunctionExpression) {
			const decl = this.requireBoundDeclaration(names[0].range, `local '${names[0].name}'`);
			const name = decl.name;
			const target = this.declareLocalFromDecl(decl, names[0].range);
			const hint = this.createLocalFunctionHint(name);
			const closureProtoIndex = this.compileExpressionWithStaticClosureProto(values[0], target, 1, hint);
			const binding = this.resolveLocalBinding(decl.id);
			if (binding !== undefined) {
				binding.constClosureProtoIndex = closureProtoIndex;
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
						initializerModuleBindings[i] = moduleBinding;
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
					initializerModuleBindings[lastIndex] = moduleBinding;
				}
			}
			const constantValue = this.evaluateCompileTimeExpression(lastExpr);
			if (constantValue !== undefined && !wantsMulti) {
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
			if (initializerValue !== undefined) {
				this.emitLoadConst(target, initializerValue);
				continue;
			}
			const valueReg = valueRegs[i];
			if (valueReg !== undefined) {
				this.emitABC(OpCode.MOV, target, valueReg, 0);
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
				if (targets[i].kind === 'memory' && i < statement.right.length) {
					const lhsExpr = statement.left[i] as LuaIndexExpression;
					this.validateMemoryStore(lhsExpr.index, statement.right[i]);
				}
			}
		}
		const targetPaths = statement.left.map((expr) => extractAssignmentPath(expr as LuaAssignableExpression));
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
			const targetPreparation = classifyAssignmentTargetPreparation(this.semantics, expr);
			if (targetPreparation.kind === 'identifier') {
				const identifier = expr as LuaIdentifierExpression;
				const reference = this.getIdentifierWriteReference(identifier);
				const symbolHandle = this.getReferenceSymbolHandle(reference);
				const name = this.getReferenceName(reference);
				const localBinding = symbolHandle ? this.resolveLocalBinding(symbolHandle) : undefined;
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
				const upvalue = this.resolveReferenceUpvalue(reference);
				if (upvalue !== null) {
					targets.push({ kind: 'upvalue', upvalue });
					continue;
				}
				if (reference.kind === 'map') {
					throw new Error(`[Compiler] '${name}' is a reserved memory map. Use direct indexing syntax like ${name}[addr].`);
				}
				if (reference.kind === 'reserved_intrinsic') {
					throw new Error(`[Compiler] '${name}' is a reserved intrinsic. Use ${name}(base, ...).`);
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
				this.emitMemoryStore(target.accessKind, target.addrConst, target.addrReg, valueReg);
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
				this.emitMemoryLoad(temp, target.accessKind, target.addrConst, target.addrReg);
				this.emitABC(op, temp, temp, valueReg, RK_B | RK_C);
				this.emitMemoryStore(target.accessKind, target.addrConst, target.addrReg, temp);
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
			this.compileExpressionInto(expressions[0], base, wantsMulti ? 0 : 1);
			if (!wantsMulti && this.moduleCompileInfo !== undefined && expressions[0] === this.moduleCompileInfo.returnExpression) {
				this.emitModuleExportGlobalStores(base, this.moduleCompileInfo.exportRoot);
			}
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
				const jumpToNext = this.emitJumpPlaceholder(OpCode.BR_FALSE, condReg);
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
		const jumpOut = this.emitJumpPlaceholder(OpCode.BR_FALSE, condReg);
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
		this.emitAsBx(OpCode.BR_FALSE, condReg, loopStart - (this.code.length + 1));
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
		const protoId = this.createChildProtoId(hint);
		const protoIndex = compileFunctionExpression(this.program, statement.functionExpression, this, false, protoId, this.moduleId, this.semantics, this.frontend);
		this.emitABx(OpCode.CLOSURE, reg, protoIndex);
	}

	private compileFunctionDeclaration(statement: any): void {
		const fnExpr = statement.functionExpression as LuaFunctionExpression;
		const methodName = statement.name.methodName;
		const identifiers = statement.name.identifiers as string[];
		const target = classifyFunctionDeclarationTarget(this.semantics, statement);
		const hint = buildDeclarationHint(identifiers, methodName);
		const protoId = this.createChildProtoId(hint);
		const protoIndex = compileFunctionExpression(this.program, fnExpr, this, methodName && methodName.length > 0, protoId, this.moduleId, this.semantics, this.frontend);
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

	private compileExpressionInto(expression: LuaExpression, target: number, resultCount: number, protoIdHint: string | null = null): void {
		this.withRange(expression.range, () => {
			switch (expression.kind) {
				case LuaSyntaxKind.NumericLiteralExpression:
					this.emitLoadConst(target, expression.value);
					return;
				case LuaSyntaxKind.StringLiteralExpression:
					this.emitLoadConst(target, this.program.internString(expression.value));
					return;
				case LuaSyntaxKind.StringRefLiteralExpression:
					this.emitLoadConst(target, this.program.internString(expression.value));
					return;
				case LuaSyntaxKind.BooleanLiteralExpression:
					this.emitLoadBool(target, expression.value);
					return;
				case LuaSyntaxKind.NilLiteralExpression:
					this.emitLoadNil(target, 1);
					return;
				case LuaSyntaxKind.IdentifierExpression:
					this.emitReferenceLoad(this.getIdentifierReference(expression as LuaIdentifierExpression), target);
					return;
				case LuaSyntaxKind.TableConstructorExpression:
					this.compileTableConstructor(expression as LuaTableConstructorExpression, target);
					return;
				case LuaSyntaxKind.UnaryExpression:
					this.compileUnaryExpression(expression, target);
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
				case LuaSyntaxKind.VarargExpression:
					this.emitABC(OpCode.VARARG, target, resultCount, 0);
					return;
				case LuaSyntaxKind.FunctionExpression: {
					const protoId = this.createChildProtoId(protoIdHint ?? buildAnonymousHint(expression.range));
					const protoIndex = compileFunctionExpression(this.program, expression as LuaFunctionExpression, this, false, protoId, this.moduleId, this.semantics, this.frontend);
					this.emitABx(OpCode.CLOSURE, target, protoIndex);
					return;
				}
				default: {
					const unhandled = expression as LuaExpression;
					throw new Error(`Unsupported expression kind: ${unhandled.kind}`);
				}
			}
		});
	}

	private compileMemberExpression(expression: any, target: number): void {
		const slotName = this.tryResolveModuleExportSlotFromExpression(expression as LuaMemberExpression);
		if (slotName !== undefined) {
			this.emitModuleExportLoad(slotName, target);
			return;
		}
		const baseReg = this.allocTemp();
		this.compileExpressionInto(expression.base, baseReg, 1);
		const key = this.program.constIndexString(expression.identifier);
		this.emitTableGetConst(target, baseReg, key);
	}

	private compileIndexExpression(expression: any, target: number): void {
		const slotName = this.tryResolveModuleExportSlotFromExpression(expression as LuaIndexExpression);
		if (slotName !== undefined) {
			this.emitModuleExportLoad(slotName, target);
			return;
		}
		const targetPreparation = classifyAssignmentTargetPreparation(this.semantics, expression as LuaIndexExpression);
		if (targetPreparation.kind === 'memory') {
			const memoryTarget = this.compileMemoryTarget(targetPreparation);
			this.emitMemoryLoad(target, memoryTarget.accessKind, memoryTarget.addrConst, memoryTarget.addrReg);
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

	private compileMemoryTarget(target: Extract<ReturnType<typeof classifyAssignmentTargetPreparation>, { kind: 'memory' }>): Extract<AssignmentTarget, { kind: 'memory' }> {
		const addrConst = this.tryGetNumericConstIndex(target.index);
		if (addrConst !== undefined) {
			return { kind: 'memory', accessKind: target.accessKind, addrConst };
		}
		const addrReg = this.allocTemp();
		this.compileExpressionInto(target.index, addrReg, 1);
		return { kind: 'memory', accessKind: target.accessKind, addrReg };
	}

	private emitMemoryLoad(target: number, accessKind: MemoryAccessKind, addrConst: number | undefined, addrReg: number | undefined): void {
		const addrOperand = addrConst !== undefined ? this.encodeConstOperand(addrConst) : addrReg;
		this.emitABC(OpCode.LOAD_MEM, target, addrOperand, accessKind, addrConst !== undefined ? RK_B : 0);
	}

	private emitMemoryStore(accessKind: MemoryAccessKind, addrConst: number | undefined, addrReg: number | undefined, valueReg: number): void {
		const addrOperand = addrConst !== undefined ? this.encodeConstOperand(addrConst) : addrReg;
		this.emitABC(OpCode.STORE_MEM, valueReg, addrOperand, accessKind, addrConst !== undefined ? RK_B : 0);
	}

	private tryResolveConstantMemoryAddress(addressExpression: LuaExpression): number | undefined {
		const constValue = this.evaluateCompileTimeExpression(addressExpression);
		if (typeof constValue === 'number') return constValue;
		if (addressExpression.kind === LuaSyntaxKind.IdentifierExpression) {
			const reference = this.getIdentifierReference(addressExpression as LuaIdentifierExpression);
			if (reference.kind === 'lexical') {
				const symbolHandle = this.getReferenceSymbolHandle(reference);
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
			const reference = this.getIdentifierReference(addressExpression as LuaIdentifierExpression);
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
			const reference = this.getIdentifierReference(addressExpression as LuaIdentifierExpression);
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
		if (valueKind === 'string_ref') return;
		const registerName = this.resolveMemoryStoreRegisterName(addressExpression);
		const target = registerName ? `Register '${registerName}'` : 'This memory-mapped register';
		throw new LuaSyntaxError(
			`${target} requires a string_ref value (&'...'). The expression at this point is not proven to be string_ref (got: ${valueKind}).`,
			valueExpression.range.path,
			valueExpression.range.start.line,
			valueExpression.range.start.column,
		);
	}

	private emitMemoryWordStoreSequence(valueBase: number, valueCount: number, addrConst: number | undefined, addrReg: number | undefined): void {
		if (valueCount === 1) {
			this.emitMemoryStore(MemoryAccessKind.Word, addrConst, addrReg, valueBase);
			return;
		}
		const addrOperand = addrConst !== undefined ? this.encodeConstOperand(addrConst) : addrReg;
		this.emitABC(OpCode.STORE_MEM_WORDS, valueBase, addrOperand, valueCount, addrConst !== undefined ? RK_B : 0);
	}

	private tryCompileIntrinsicCall(expression: LuaCallExpression, target: number, resultCount: number): boolean {
		if (expression.methodName !== null || expression.callee.kind !== LuaSyntaxKind.IdentifierExpression) {
			return false;
		}
		const reference = this.getIdentifierReference(expression.callee as LuaIdentifierExpression);
		if (reference.kind === 'reserved_intrinsic' && this.getReferenceName(reference) === 'memwrite') {
			this.compileMemWriteIntrinsic(expression, target, resultCount);
			return true;
		}
		return false;
	}

	private compileMemWriteIntrinsic(expression: LuaCallExpression, target: number, resultCount: number): void {
		if (expression.arguments.length < 2) {
			throw new Error('[Compiler] memwrite expects a base address and at least one word.');
		}
		const addrExpression = expression.arguments[0];
		for (let index = 1; index < expression.arguments.length; index += 1) {
			this.validateMemoryStore(addrExpression, expression.arguments[index]);
		}
		const addrConst = this.tryGetNumericConstIndex(addrExpression);
		let addrReg: number | undefined;
		if (addrConst === undefined) {
			addrReg = this.allocTemp();
			this.compileExpressionInto(addrExpression, addrReg, 1);
		}
		const valueCount = expression.arguments.length - 1;
		const valueBase = this.allocTempBlock(valueCount);
		for (let index = 0; index < valueCount; index += 1) {
			this.compileExpressionInto(expression.arguments[index + 1], valueBase + index, 1);
		}
		this.emitMemoryWordStoreSequence(valueBase, valueCount, addrConst, addrReg);
		if (resultCount > 0) {
			this.emitLoadNil(target, resultCount);
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

	private compileUnaryExpression(expression: any, target: number): void {
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
		const jump = this.emitJumpPlaceholder(OpCode.BR_FALSE, target);
		this.compileExpressionInto(expression.right, target, 1);
		this.patchJump(jump, this.code.length);
	}

	private compileOrExpression(expression: any, target: number): void {
		this.compileExpressionInto(expression.left, target, 1);
		const jumpEnd = this.emitJumpPlaceholder(OpCode.BR_TRUE, target);
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
		if (this.tryCompileIntrinsicCall(expression, target, resultCount)) {
			return;
		}
		const methodName = expression.methodName;
		const hasMethod = methodName !== null && methodName.length > 0;
		const moduleMethodSlot = hasMethod ? this.tryResolveModuleExportMethodSlot(expression.callee, methodName) : undefined;
		const constClosureBinding = !hasMethod && expression.callee.kind === LuaSyntaxKind.IdentifierExpression
			? this.resolveReferenceConstClosureBinding(this.getIdentifierReference(expression.callee as LuaIdentifierExpression))
			: null;
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
			this.emitModuleExportLoad(moduleMethodSlot, callBase);
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
		return expression.kind === LuaSyntaxKind.CallExpression || expression.kind === LuaSyntaxKind.VarargExpression;
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

	private createChildProtoId(hint: string): string {
		return buildProtoId(this.protoId, hint);
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
	const parts = identifiers.length > 0 ? identifiers.slice() : [];
	if (methodName && methodName.length > 0) {
		parts.push(methodName);
	}
	return `decl:${buildNamePath(parts)}`;
};

const buildAssignmentHint = (path: ReadonlyArray<string>): string =>
	`assign:${buildNamePath(path)}`;

const extractTableKeyFromExpression = (expression: LuaExpression): string | null => {
	switch (expression.kind) {
		case LuaSyntaxKind.StringLiteralExpression:
			return (expression as LuaStringLiteralExpression).value;
		case LuaSyntaxKind.IdentifierExpression:
			return (expression as LuaIdentifierExpression).name;
		default:
			return null;
	}
};

const extractAssignmentPath = (expression: LuaAssignableExpression): string[] | null => {
	switch (expression.kind) {
		case LuaSyntaxKind.IdentifierExpression:
			return [(expression as LuaIdentifierExpression).name];
		case LuaSyntaxKind.MemberExpression: {
			const member = expression as LuaMemberExpression;
			const basePath = extractAssignmentPath(member.base as LuaAssignableExpression);
			if (!basePath) {
				return null;
			}
			return [...basePath, member.identifier];
		}
		case LuaSyntaxKind.IndexExpression: {
			const indexExpr = expression as LuaIndexExpression;
			const basePath = extractAssignmentPath(indexExpr.base as LuaAssignableExpression);
			if (!basePath) {
				return null;
			}
			const key = extractTableKeyFromExpression(indexExpr.index);
			if (!key) {
				return null;
			}
			return [...basePath, key];
		}
		default:
			return null;
	}
};

const createModuleExportNode = (slotName: string | null = null): ModuleExportNode => ({
	slotName,
	children: new Map<string, ModuleExportNode>(),
});

const cloneModuleExportNode = (node: ModuleExportNode): ModuleExportNode => {
	const clone = createModuleExportNode(node.slotName);
	for (const [key, child] of node.children) {
		clone.children.set(key, cloneModuleExportNode(child));
	}
	return clone;
};

const buildModuleExportPathKey = (path: ReadonlyArray<string>): string =>
	path.join('.');

const stripModuleSourcePrefix = (path: string): string => {
	const normalized = stripLuaExtension(path.replace(/\\/g, '/'));
	if (normalized.startsWith('src/carts/')) {
		const parts = normalized.split('/');
		return parts.length > 3 ? parts.slice(3).join('/') : parts[parts.length - 1];
	}
	if (normalized.startsWith('src/bmsx/res/')) {
		return normalized.slice('src/bmsx/res/'.length);
	}
	return normalized;
};

const sanitizeModuleSlotSegment = (value: string): string =>
	value.replace(/[^A-Za-z0-9_]/g, '_');

const buildModuleSlotPrefix = (modulePath: string): string => {
	const compactPath = stripModuleSourcePrefix(modulePath);
	const parts = compactPath.split('/').filter(part => part.length > 0);
	const normalizedParts = parts.length > 0 ? parts : [compactPath];
	return normalizedParts.map(sanitizeModuleSlotSegment).join('__');
};

const buildModuleExportSlotName = (
	modulePath: string,
	exportPath: ReadonlyArray<string>,
): string =>
	[buildModuleSlotPrefix(modulePath), ...exportPath.map(sanitizeModuleSlotSegment)].join('__');

const resolveStaticModuleShapePath = (
	expression: LuaExpression,
	localShapes: ReadonlyMap<string, ModuleExportNode>,
): ModuleExportNode | null => {
	if (expression.kind === LuaSyntaxKind.IdentifierExpression) {
		const identifier = expression as LuaIdentifierExpression;
		const shape = localShapes.get(identifier.name);
		return shape ? cloneModuleExportNode(shape) : null;
	}
	if (expression.kind === LuaSyntaxKind.MemberExpression) {
		const member = expression as LuaMemberExpression;
		const baseShape = resolveStaticModuleShapePath(member.base, localShapes);
		if (!baseShape) {
			return null;
		}
		const child = baseShape.children.get(member.identifier);
		return child ? cloneModuleExportNode(child) : null;
	}
	if (expression.kind === LuaSyntaxKind.IndexExpression) {
		const indexExpr = expression as LuaIndexExpression;
		const baseShape = resolveStaticModuleShapePath(indexExpr.base, localShapes);
		if (!baseShape) {
			return null;
		}
		const key = extractTableKeyFromExpression(indexExpr.index);
		if (!key) {
			return null;
		}
		const child = baseShape.children.get(key);
		return child ? cloneModuleExportNode(child) : null;
	}
	return null;
};

const buildModuleShapeFromExpression = (
	expression: LuaExpression,
	localShapes: ReadonlyMap<string, ModuleExportNode>,
): ModuleExportNode | null => {
	if (expression.kind === LuaSyntaxKind.TableConstructorExpression) {
		const table = expression as LuaTableConstructorExpression;
		const node = createModuleExportNode();
		for (let index = 0; index < table.fields.length; index += 1) {
			const field = table.fields[index];
			if (field.kind === LuaTableFieldKind.Array) {
				continue;
			}
			const key = field.kind === LuaTableFieldKind.IdentifierKey
				? field.name
				: extractTableKeyFromExpression(field.key);
			if (!key) {
				continue;
			}
			node.children.set(
				key,
				buildModuleShapeFromExpression(field.value, localShapes) ?? createModuleExportNode(),
			);
		}
		return node;
	}
	return resolveStaticModuleShapePath(expression, localShapes);
};

const assignModuleShapePath = (
	root: ModuleExportNode,
	path: ReadonlyArray<string>,
	value: ModuleExportNode,
): void => {
	if (path.length === 0) {
		root.children = cloneModuleExportNode(value).children;
		return;
	}
	let cursor = root;
	for (let index = 0; index < path.length - 1; index += 1) {
		const key = path[index];
		let child = cursor.children.get(key);
		if (!child) {
			child = createModuleExportNode();
			cursor.children.set(key, child);
		}
		cursor = child;
	}
	cursor.children.set(path[path.length - 1], cloneModuleExportNode(value));
};

const buildTopLevelLocalModuleShapes = (
	chunk: LuaChunk,
): Map<string, ModuleExportNode> => {
	const localShapes = new Map<string, ModuleExportNode>();
	for (let index = 0; index < chunk.body.length; index += 1) {
		const statement = chunk.body[index];
		if (statement.kind === LuaSyntaxKind.LocalAssignmentStatement) {
			const localAssignment = statement as LuaLocalAssignmentStatement;
			const values = localAssignment.values;
			for (let nameIndex = 0; nameIndex < localAssignment.names.length; nameIndex += 1) {
				const value = values[nameIndex];
				if (!value) {
					continue;
				}
				const shape = buildModuleShapeFromExpression(value, localShapes);
				if (!shape) {
					continue;
				}
				localShapes.set(localAssignment.names[nameIndex].name, shape);
			}
			continue;
		}
		if (statement.kind === LuaSyntaxKind.AssignmentStatement) {
			const assignment = statement as LuaAssignmentStatement;
			if (assignment.operator !== LuaAssignmentOperator.Assign) {
				continue;
			}
			for (let targetIndex = 0; targetIndex < assignment.left.length; targetIndex += 1) {
				const left = assignment.left[targetIndex];
				const path = extractAssignmentPath(left);
				if (!path || path.length === 0) {
					continue;
				}
				const rootName = path[0];
				const rootShape = localShapes.get(rootName);
				if (!rootShape) {
					continue;
				}
				const right = assignment.right[targetIndex];
				if (!right) {
					continue;
				}
				const shape = buildModuleShapeFromExpression(right, localShapes) ?? createModuleExportNode();
				assignModuleShapePath(rootShape, path.slice(1), shape);
			}
			continue;
		}
		if (statement.kind === LuaSyntaxKind.FunctionDeclarationStatement) {
			const declaration = statement as LuaFunctionDeclarationStatement;
			if (declaration.name.identifiers.length === 0) {
				continue;
			}
			const rootName = declaration.name.identifiers[0];
			const rootShape = localShapes.get(rootName);
			if (!rootShape) {
				continue;
			}
			const path = declaration.name.identifiers.slice(1);
			if (declaration.name.methodName && declaration.name.methodName.length > 0) {
				path.push(declaration.name.methodName);
			}
			if (path.length === 0) {
				continue;
			}
			assignModuleShapePath(rootShape, path, createModuleExportNode());
			continue;
		}
		if (statement.kind === LuaSyntaxKind.LocalFunctionStatement) {
			const declaration = statement as LuaLocalFunctionStatement;
			const existing = localShapes.get(declaration.name.name);
			if (existing) {
				localShapes.set(declaration.name.name, existing);
			}
		}
	}
	return localShapes;
};

const buildModuleCompileInfo = (
	modulePath: string,
	chunk: LuaChunk,
): ModuleCompileInfo | null => {
	if (chunk.body.length === 0) {
		return null;
	}
	const lastStatement = chunk.body[chunk.body.length - 1];
	if (lastStatement.kind !== LuaSyntaxKind.ReturnStatement) {
		return null;
	}
	const returnStatement = lastStatement as LuaReturnStatement;
	if (returnStatement.expressions.length !== 1) {
		return null;
	}
	const localShapes = buildTopLevelLocalModuleShapes(chunk);
	const exportRoot = buildModuleShapeFromExpression(returnStatement.expressions[0], localShapes);
	if (!exportRoot || exportRoot.children.size === 0) {
		return null;
	}
	const exportSlotsByPathKey = new Map<string, string>();
	const assignSlots = (node: ModuleExportNode, path: string[]): void => {
		for (const [key, child] of node.children) {
			const childPath = path.concat(key);
			child.slotName = buildModuleExportSlotName(modulePath, childPath);
			exportSlotsByPathKey.set(buildModuleExportPathKey(childPath), child.slotName);
			assignSlots(child, childPath);
		}
	};
	assignSlots(exportRoot, []);
	return {
		path: modulePath,
		returnExpression: returnStatement.expressions[0],
		exportRoot,
		exportSlotsByPathKey,
	};
};

const buildModuleCompileContext = (
	entryChunk: LuaChunk,
	modules: ReadonlyArray<ProgramModule>,
): ModuleCompileContext => {
	const modulePaths = [entryChunk.range.path];
	for (let index = 0; index < modules.length; index += 1) {
		modulePaths.push(modules[index].path);
	}
	const moduleAliasEntries = buildModuleAliasesFromPaths(modulePaths);
	const moduleAliasMap = new Map<string, string>();
	for (let index = 0; index < moduleAliasEntries.length; index += 1) {
		const entry = moduleAliasEntries[index];
		if (!moduleAliasMap.has(entry.alias)) {
			moduleAliasMap.set(entry.alias, entry.path);
		}
	}
	const modulesByPath = new Map<string, ModuleCompileInfo>();
	for (let index = 0; index < modules.length; index += 1) {
		const module = modules[index];
		const info = buildModuleCompileInfo(module.path, module.chunk);
		if (info) {
			modulesByPath.set(module.path, info);
		}
	}
	return {
		moduleAliasMap,
		modulesByPath,
	};
};

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

function buildCompilerSemanticFrontend(
	entryChunk: LuaChunk,
	modules: ReadonlyArray<ProgramModule>,
	options: CompileOptions,
): LuaSemanticFrontend {
	const extraGlobalNames = options.baseMetadata
		? [...ENGINE_SYSTEM_GLOBAL_NAME_SET, ...options.baseMetadata.systemGlobalNames, ...options.baseMetadata.globalNames]
		: Array.from(ENGINE_SYSTEM_GLOBAL_NAME_SET);
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
	}, code, ranges, constRelocs, localSlots, builder.getUpvalueNames(), protoId, instructionSet);
	return protoIndex;
}

function cloneProto(proto: Proto): Proto {
	const upvalueDescs: UpvalueDesc[] = [];
	for (let index = 0; index < proto.upvalueDescs.length; index += 1) {
		const desc = proto.upvalueDescs[index];
		upvalueDescs.push({ inStack: desc.inStack, index: desc.index });
	}
	return {
		entryPC: 0,
		codeLen: proto.codeLen,
		numParams: proto.numParams,
		isVararg: proto.isVararg,
		maxStack: proto.maxStack,
		upvalueDescs,
	};
}

function createProgramBuilderFromProgram(
	base: Program,
	metadata: ProgramMetadata,
	optLevel: OptimizationLevel,
): ProgramBuilder {
	const builder = new ProgramBuilder(base.constPool, base.constPoolStringPool, optLevel, metadata);
	const protoIds = metadata.protoIds;
	if (!protoIds || protoIds.length !== base.protos.length) {
		throw new Error('[ProgramBuilder] Base program proto ids missing or mismatched.');
	}
	for (let index = 0; index < base.protos.length; index += 1) {
		const proto = base.protos[index];
		const start = proto.entryPC;
		const end = start + proto.codeLen;
		const code = base.code.slice(start, end);
		const startWord = Math.floor(start / INSTRUCTION_BYTES);
		const endWord = Math.floor(end / INSTRUCTION_BYTES);
		const ranges = metadata.debugRanges.slice(startWord, endWord);
		const localSlotsByProto = metadata.localSlotsByProto;
		const localSlots = localSlotsByProto && localSlotsByProto[index]
			? localSlotsByProto[index]
			: EMPTY_LOCAL_SLOTS;
		const upvalueNames = metadata.upvalueNamesByProto?.[index] ?? EMPTY_UPVALUE_NAMES;
		builder.seedProto(cloneProto(proto), code, ranges, [], localSlots, upvalueNames, protoIds[index]);
	}
	return builder;
}

export function compileLuaChunkToProgram(chunk: LuaChunk, modules: ReadonlyArray<ProgramModule> = [], options: CompileOptions = {}): CompiledProgram {
	const optLevel = options.optLevel ?? 0;
	const frontend = buildCompilerSemanticFrontend(chunk, modules, options);
	const moduleCompileContext = buildModuleCompileContext(chunk, modules);
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
		programBuilder = createProgramBuilderFromProgram(options.baseProgram, options.baseMetadata, optLevel);
	} else {
		programBuilder = new ProgramBuilder(null, null, optLevel);
	}
	const moduleId = chunk.range.path;
	const entryProtoId = buildEntryProtoId(moduleId);
	let entryProtoIndex = -1;
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
		}, entryCode, entryRanges, entryConstRelocs, entryLocalSlots, entryBuilder.getUpvalueNames(), entryProtoId, entryInstructionSet);
	} catch (error) {
		compileErrors.push({
			path: chunk.range.path,
			stage: 'entry',
			message: extractCompileErrorMessage(error, chunk.range.path),
		});
	}
	const moduleProtoMap = new Map<string, number>();
	for (let i = 0; i < modules.length; i += 1) {
		const module = modules[i];
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
	const { program, metadata, constRelocs } = programBuilder.buildProgram();
	return { program, metadata, entryProtoIndex, moduleProtoMap, constRelocs };
}

export function appendLuaChunkToProgram(base: Program, metadata: ProgramMetadata, chunk: LuaChunk, options: CompileOptions = {}): { program: Program; metadata: ProgramMetadata; entryProtoIndex: number } {
	const optLevel = options.optLevel ?? 0;
	const frontend = buildCompilerSemanticFrontend(chunk, [], { ...options, baseMetadata: metadata });
	const semanticErrors = collectSemanticCompileErrors(frontend, chunk.range.path);
	if (semanticErrors.length > 0) {
		throw new Error(buildCompileFailureMessage(semanticErrors));
	}
	const programBuilder = createProgramBuilderFromProgram(base, metadata, optLevel);
	const compileErrors: CompileError[] = [];
	const moduleId = chunk.range.path;
	const entryProtoId = buildEntryProtoId(moduleId);
	let entryProtoIndex = -1;
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
	const { program, metadata: nextMetadata } = programBuilder.buildProgram();
	return { program, metadata: nextMetadata, entryProtoIndex };
}
