import {
	LuaAssignmentOperator,
	LuaBinaryOperator,
	LuaSyntaxKind,
	LuaTableFieldKind,
	LuaUnaryOperator,
	type LuaAssignableExpression,
	type LuaAssignmentStatement,
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
	type LuaMemberExpression,
	type LuaNumericLiteralExpression,
	type LuaStatement,
	type LuaBooleanLiteralExpression,
	type LuaStringLiteralExpression,
	type LuaSourceRange,
	type LuaTableConstructorExpression,
	type LuaWhileStatement,
	type LuaGotoStatement,
} from '../lua/syntax/lua_ast';
import { createIdentifierCanonicalizer } from '../lua/syntax/identifier_canonicalizer';
import { MemoryAccessKind, OpCode, type Program, type ProgramMetadata, type Proto, type UpvalueDesc, type Value, type SourceRange, type LocalSlotDebug } from './cpu';
import { optimizeInstructions, type Instruction, type InstructionSet, type OptimizationLevel } from './program_optimizer';
import type { ProgramConstReloc } from './program_asset';
import { StringPool, StringValue, isStringValue } from './string_pool';
import type { CanonicalizationType } from '../rompack/rompack';
import { EXT_A_BITS, EXT_B_BITS, EXT_BX_BITS, EXT_C_BITS, INSTRUCTION_BYTES, MAX_BX_BITS, MAX_EXT_CONST, MAX_OPERAND_BITS, writeInstruction } from './instruction_format';
import { LuaSyntaxError } from '../lua/luaerrors';

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
};

export const isLuaCompileError = (value: unknown): value is LuaCompileError =>
	value instanceof LuaSyntaxError;

type CompileOptions = {
	baseProgram?: Program;
	baseMetadata?: ProgramMetadata;
	canonicalization?: CanonicalizationType;
	optLevel?: OptimizationLevel;
};

type LoopContext = {
	breakJumps: number[];
};

type ScopeFrame = {
	names: string[];
	range: SourceRange;
};

type AssignmentTarget =
	| { kind: 'local'; reg: number }
	| { kind: 'upvalue'; upvalue: number }
	| { kind: 'global'; keyConst: number }
	| { kind: 'table'; tableReg: number; keyConst?: number; keyReg?: number }
	| { kind: 'memory'; accessKind: MemoryAccessKind; addrConst?: number; addrReg?: number };

const RK_B = 1;
const RK_C = 2;

const isConstBxOp = (op: OpCode): boolean =>
	op === OpCode.LOADK
	|| op === OpCode.GETG
	|| op === OpCode.SETG;

class ProgramBuilder {
	public readonly constPool: Value[];
	public readonly stringPool: StringPool;
	public readonly canonicalizeIdentifier: (value: string) => string;
	public readonly optLevel: OptimizationLevel;
	private readonly constMap: Map<string, number>;
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
		canonicalization: CanonicalizationType = 'none',
		stringPool: StringPool | null = null,
		optLevel: OptimizationLevel = 0,
	) {
		this.constPool = baseConstPool ? Array.from(baseConstPool) : [];
		this.canonicalizeIdentifier = createIdentifierCanonicalizer(canonicalization);
		this.stringPool = stringPool ?? new StringPool();
		this.optLevel = optLevel;
		this.constMap = new Map<string, number>();
		for (let index = 0; index < this.constPool.length; index += 1) {
			const value = this.constPool[index];
			this.constMap.set(this.makeConstKey(value), index);
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

const cloneSourceRange = (range: LuaSourceRange | SourceRange): SourceRange => ({
	path: range.path,
	start: {
		line: range.start.line,
		column: range.start.column,
	},
	end: {
		line: range.end.line,
		column: range.end.column,
	},
});

const cloneLocalSlotDebug = (slot: LocalSlotDebug): LocalSlotDebug => ({
	name: slot.name,
	register: slot.register,
	definition: cloneSourceRange(slot.definition),
	scope: cloneSourceRange(slot.scope),
});

class FunctionBuilder {
	private readonly program: ProgramBuilder;
	private readonly parent: FunctionBuilder | null;
	private readonly moduleId: string;
	private readonly protoId: string;
	private readonly canonicalizeIdentifier: (value: string) => string;
	private readonly code: Instruction[] = [];
	private readonly ranges: Array<SourceRange | null> = [];
	private finalizedCode: Uint8Array | null = null;
	private finalizedRanges: Array<SourceRange | null> | null = null;
	private finalizedConstRelocs: ProgramConstReloc[] | null = null;
	private readonly localStacks = new Map<string, number[]>();
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

	constructor(program: ProgramBuilder, parent: FunctionBuilder | null, params: { moduleId: string; protoId: string }) {
		this.program = program;
		this.parent = parent;
		this.moduleId = params.moduleId;
		this.protoId = params.protoId;
		this.canonicalizeIdentifier = program.canonicalizeIdentifier;
	}

	public compileChunk(chunk: LuaChunk): void {
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
		this.pushScope(expression.body.range);
		if (implicitSelf) {
			this.declareLocal('self', expression.range, expression.range);
		}
		for (let i = 0; i < expression.parameters.length; i += 1) {
			this.declareLocal(expression.parameters[i].name, expression.parameters[i].range, expression.range);
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
				getProtoInstructionSet: (protoIndex: number) => this.program.protoInstructionSets[protoIndex] ?? null,
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
					const aWide = needsWideUnsigned(instr.a, MAX_OPERAND_BITS, EXT_A_BITS);
					const bWide = (instr.rkMask & RK_B) !== 0
						? needsWideSigned(bWidthValue, MAX_OPERAND_BITS, EXT_B_BITS)
						: needsWideUnsigned(bWidthValue, MAX_OPERAND_BITS, EXT_B_BITS);
					const cWide = (instr.rkMask & RK_C) !== 0
						? needsWideSigned(cWidthValue, MAX_OPERAND_BITS, EXT_C_BITS)
						: needsWideUnsigned(cWidthValue, MAX_OPERAND_BITS, EXT_C_BITS);
					wideFlags[index] = forceWide || aWide || bWide || cWide;
					continue;
				}
				if (instr.format === 'ABx') {
					const bxWidthValue = instr.b;
					const forceWide = isConstBxOp(instr.op);
					const aWide = needsWideUnsigned(instr.a, MAX_OPERAND_BITS, 0);
					const bxWide = needsWideUnsigned(bxWidthValue, MAX_BX_BITS, EXT_BX_BITS);
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
			if (instr.format === 'ABx' && instr.b < 0) {
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
					continue;
				}
				if (instr.format === 'ABx') {
				const aSplit = splitUnsignedOperand(instr.a, 'A', MAX_OPERAND_BITS, 0, hasWide);
				const bxSplit = splitUnsignedOperand(instr.b, 'Bx', MAX_BX_BITS, EXT_BX_BITS, hasWide);
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
			names: [],
			range: cloneSourceRange(range),
		});
	}

	private popScope(): void {
		const scope = this.scopeStack.pop()!;
		for (let i = scope.names.length - 1; i >= 0; i -= 1) {
			const name = scope.names[i];
			const stack = this.localStacks.get(name);
			stack.pop();
			if (stack.length === 0) {
				this.localStacks.delete(name);
			}
		}
	}

	private resetTemps(): void {
		this.tempTop = this.localCount;
	}

	private canonicalizeName(name: string): string {
		return this.canonicalizeIdentifier(name);
	}

	private finalizeLabels(): void {
		if (this.pendingLabelJumps.size === 0) {
			return;
		}
		const labels = Array.from(this.pendingLabelJumps.keys()).sort();
		throw new Error(`Missing label(s): ${labels.join(', ')}`);
	}

	private declareLocal(name: string, definitionRange: LuaSourceRange, scopeRange?: LuaSourceRange): number {
		const canonicalName = this.canonicalizeName(name);
		if (this.getMemoryAccessKindForCanonicalName(canonicalName) !== null) {
			throw new Error(`[Compiler] '${canonicalName}' is a reserved memory map name and cannot be used as a local or parameter.`);
		}
		if (this.isReservedIntrinsicName(canonicalName)) {
			throw new Error(`[Compiler] '${canonicalName}' is a reserved intrinsic name and cannot be used as a local or parameter.`);
		}
		const reg = this.localCount;
		this.localCount += 1;
		if (this.tempTop < this.localCount) {
			this.tempTop = this.localCount;
		}
		if (this.tempTop > this.maxStack) {
			this.maxStack = this.tempTop;
		}
		let stack = this.localStacks.get(canonicalName);
		if (!stack) {
			stack = [];
			this.localStacks.set(canonicalName, stack);
		}
		stack.push(reg);
		const scope = this.scopeStack[this.scopeStack.length - 1];
		scope.names.push(canonicalName);
		const effectiveScopeRange = scopeRange ?? scope.range;
		this.localDebugSlots.push({
			name: canonicalName,
			register: reg,
			definition: cloneSourceRange(definitionRange),
			scope: cloneSourceRange(effectiveScopeRange),
		});
		return reg;
	}

	private resolveLocal(name: string): number | null {
		const canonicalName = this.canonicalizeName(name);
		const stack = this.localStacks.get(canonicalName);
		if (!stack || stack.length === 0) {
			return null;
		}
		return stack[stack.length - 1];
	}

	private resolveUpvalue(name: string): number | null {
		const canonicalName = this.canonicalizeName(name);
		const existing = this.upvalueMap.get(canonicalName);
		if (existing !== undefined) {
			return existing;
		}
		if (!this.parent) {
			return null;
		}
		const parentLocal = this.parent.resolveLocal(canonicalName);
		if (parentLocal !== null) {
			const index = this.upvalueDescs.length;
			this.upvalueDescs.push({ inStack: true, index: parentLocal });
			this.upvalueNames.push(canonicalName);
			this.upvalueMap.set(canonicalName, index);
			return index;
		}
		const parentUpvalue = this.parent.resolveUpvalue(canonicalName);
		if (parentUpvalue !== null) {
			const index = this.upvalueDescs.length;
			this.upvalueDescs.push({ inStack: false, index: parentUpvalue });
			this.upvalueNames.push(canonicalName);
			this.upvalueMap.set(canonicalName, index);
			return index;
		}
		return null;
	}

	private hasLexicalBindingCanonical(canonicalName: string): boolean {
		const stack = this.localStacks.get(canonicalName);
		if (stack && stack.length > 0) {
			return true;
		}
		if (this.upvalueMap.has(canonicalName)) {
			return true;
		}
		return this.parent !== null && this.parent.hasLexicalBindingCanonical(canonicalName);
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
		this.emitABC(OpCode.LOADNIL, target, count, 0);
	}

	private emitLoadBool(target: number, value: boolean): void {
		this.emitABC(OpCode.LOADBOOL, target, value ? 1 : 0, 0);
	}

	private emitLoadConst(target: number, value: Value): void {
		const index = this.program.constIndex(value);
		this.emitABx(OpCode.LOADK, target, index);
	}

	private compileStatement(statement: LuaStatement): void {
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
		const values = statement.values;
		const valueRegs: number[] = [];
		if (values.length > 0) {
			const lastIndex = values.length - 1;
			for (let i = 0; i < lastIndex; i += 1) {
				const reg = this.allocTemp();
				const expr = values[i];
				const name = i < names.length ? this.canonicalizeName(names[i].name) : '';
				const hint = expr.kind === LuaSyntaxKind.FunctionExpression && i < names.length
					? this.createLocalFunctionHint(name)
					: null;
				this.compileExpressionInto(expr, reg, 1, hint);
				valueRegs.push(reg);
			}
			const remaining = names.length - lastIndex;
			const lastExpr = values[lastIndex];
			const lastReg = this.allocTemp();
			const lastName = lastIndex < names.length ? this.canonicalizeName(names[lastIndex].name) : '';
			const wantsMulti = remaining > 1 && this.isMultiReturnExpression(lastExpr);
			const resultCount = wantsMulti ? remaining : 1;
			const lastHint = lastExpr.kind === LuaSyntaxKind.FunctionExpression && lastIndex < names.length
				? this.createLocalFunctionHint(lastName)
				: null;
			this.compileExpressionInto(lastExpr, lastReg, resultCount, lastHint);
			valueRegs.push(lastReg);
			if (wantsMulti) {
				this.reserveTempRange(lastReg, remaining);
				for (let i = 1; i < remaining; i += 1) {
					valueRegs.push(lastReg + i);
				}
			}
		}
		for (let i = 0; i < names.length; i += 1) {
			const name = this.canonicalizeName(names[i].name);
			const target = this.declareLocal(name, names[i].range);
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
			const expr = expressions[i];
			if (expr.kind === LuaSyntaxKind.IdentifierExpression) {
				const name = this.canonicalizeName((expr as LuaIdentifierExpression).name);
				const localReg = this.resolveLocal(name);
				if (localReg !== null) {
					targets.push({ kind: 'local', reg: localReg });
					continue;
				}
				const upvalue = this.resolveUpvalue(name);
				if (upvalue !== null) {
					targets.push({ kind: 'upvalue', upvalue });
					continue;
				}
				if (this.getMemoryAccessKindForCanonicalName(name) !== null) {
					throw new Error(`[Compiler] '${name}' is a reserved memory map. Use direct indexing syntax like ${name}[addr].`);
				}
				if (this.isReservedIntrinsicName(name)) {
					throw new Error(`[Compiler] '${name}' is a reserved intrinsic. Use ${name}(base, ...).`);
				}
				const keyConst = this.program.constIndexString(name);
				targets.push({ kind: 'global', keyConst });
				continue;
			}
			if (expr.kind === LuaSyntaxKind.MemberExpression) {
				const baseReg = this.allocTemp();
				this.compileExpressionInto(expr.base, baseReg, 1);
				const keyConst = this.program.constIndexString(this.canonicalizeName(expr.identifier));
				targets.push({ kind: 'table', tableReg: baseReg, keyConst });
				continue;
			}
			if (expr.kind === LuaSyntaxKind.IndexExpression) {
				const memoryTarget = this.tryCompileMemoryTarget(expr as LuaIndexExpression);
				if (memoryTarget !== null) {
					targets.push(memoryTarget);
					continue;
				}
				const baseReg = this.allocTemp();
				this.compileExpressionInto(expr.base, baseReg, 1);
				const keyConst = this.tryGetConstIndex(expr.index);
				if (keyConst !== null) {
					targets.push({ kind: 'table', tableReg: baseReg, keyConst });
					continue;
				}
				const keyReg = this.allocTemp();
				this.compileExpressionInto(expr.index, keyReg, 1);
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
				this.emitABx(OpCode.SETG, valueReg, target.keyConst);
				return;
			case 'table': {
				const keyOperand = target.keyConst !== undefined ? this.encodeConstOperand(target.keyConst) : target.keyReg;
				this.emitABC(OpCode.SETT, target.tableReg, keyOperand, valueReg, RK_B | RK_C);
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
		switch (target.kind) {
			case 'local':
				this.emitArithmetic(opForAssignment(operator), temp, target.reg, valueReg);
				this.emitABC(OpCode.MOV, target.reg, temp, 0);
				return;
			case 'upvalue':
				this.emitABC(OpCode.GETUP, temp, target.upvalue, 0);
				this.emitArithmetic(opForAssignment(operator), temp, temp, valueReg);
				this.emitABC(OpCode.SETUP, temp, target.upvalue, 0);
				return;
			case 'global': {
				this.emitABx(OpCode.GETG, temp, target.keyConst);
				this.emitArithmetic(opForAssignment(operator), temp, temp, valueReg);
				this.emitABx(OpCode.SETG, temp, target.keyConst);
				return;
			}
			case 'table': {
				const keyOperand = target.keyConst !== undefined ? this.encodeConstOperand(target.keyConst) : target.keyReg;
				this.emitABC(OpCode.GETT, temp, target.tableReg, keyOperand, RK_C);
				this.emitArithmetic(opForAssignment(operator), temp, temp, valueReg);
				this.emitABC(OpCode.SETT, target.tableReg, keyOperand, temp, RK_B | RK_C);
				return;
			}
			case 'memory':
				this.emitMemoryLoad(temp, target.accessKind, target.addrConst, target.addrReg);
				this.emitArithmetic(opForAssignment(operator), temp, temp, valueReg);
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
		const indexReg = this.declareLocal(statement.variable.name, statement.variable.range);
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
			loopVars.push(this.declareLocal(statement.variables[i].name, statement.variables[i].range));
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
		const label = this.canonicalizeName(statement.label);
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
		const label = this.canonicalizeName(statement.label);
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
		const name = this.canonicalizeName(statement.name.name);
		const reg = this.declareLocal(name, statement.name.range);
		const hint = this.createLocalFunctionHint(name);
		const protoId = this.createChildProtoId(hint);
		const protoIndex = compileFunctionExpression(this.program, statement.functionExpression, this, false, protoId, this.moduleId);
		this.emitABx(OpCode.CLOSURE, reg, protoIndex);
	}

	private compileFunctionDeclaration(statement: any): void {
		const fnExpr = statement.functionExpression as LuaFunctionExpression;
		const methodName = statement.name.methodName !== null ? this.canonicalizeName(statement.name.methodName) : null;
		const identifiers = (statement.name.identifiers as string[]).map(name => this.canonicalizeName(name));
		const hint = buildDeclarationHint(identifiers, methodName);
		const protoId = this.createChildProtoId(hint);
		const protoIndex = compileFunctionExpression(this.program, fnExpr, this, methodName && methodName.length > 0, protoId, this.moduleId);
		const closureReg = this.allocTemp();
		this.emitABx(OpCode.CLOSURE, closureReg, protoIndex);
		if (identifiers.length === 0) {
			throw new Error('Function declaration missing name.');
		}
		if (identifiers.length === 1 && !methodName) {
			const name = identifiers[0];
			const localReg = this.resolveLocal(name);
			if (localReg !== null) {
				this.emitABC(OpCode.MOV, localReg, closureReg, 0);
				return;
			}
			const upvalue = this.resolveUpvalue(name);
			if (upvalue !== null) {
				this.emitABC(OpCode.SETUP, closureReg, upvalue, 0);
				return;
			}
			this.emitABx(OpCode.SETG, closureReg, this.program.constIndexString(name));
			return;
		}

		const baseReg = this.allocTemp();
		const baseName = identifiers[0];
		const baseLocal = this.resolveLocal(baseName);
		if (baseLocal !== null) {
			this.emitABC(OpCode.MOV, baseReg, baseLocal, 0);
		} else {
			const baseUpvalue = this.resolveUpvalue(baseName);
			if (baseUpvalue !== null) {
				this.emitABC(OpCode.GETUP, baseReg, baseUpvalue, 0);
			} else {
				this.emitABx(OpCode.GETG, baseReg, this.program.constIndexString(baseName));
			}
		}

		const pathEnd = methodName ? identifiers.length : identifiers.length - 1;
		for (let i = 1; i < pathEnd; i += 1) {
			const key = this.program.constIndexString(identifiers[i]);
			const nextReg = this.allocTemp();
			this.emitABC(OpCode.GETT, nextReg, baseReg, this.encodeConstOperand(key), RK_C);
			this.emitABC(OpCode.MOV, baseReg, nextReg, 0);
		}
		const keyName = methodName && methodName.length > 0 ? methodName : identifiers[identifiers.length - 1];
		const keyConst = this.program.constIndexString(keyName);
		this.emitABC(OpCode.SETT, baseReg, this.encodeConstOperand(keyConst), closureReg, RK_B | RK_C);
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
					this.compileIdentifier(expression as LuaIdentifierExpression, target);
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
					const protoIndex = compileFunctionExpression(this.program, expression as LuaFunctionExpression, this, false, protoId, this.moduleId);
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

	private compileIdentifier(expression: LuaIdentifierExpression, target: number): void {
		const name = this.canonicalizeName(expression.name);
		const localReg = this.resolveLocal(name);
		if (localReg !== null) {
			if (localReg !== target) {
				this.emitABC(OpCode.MOV, target, localReg, 0);
			}
			return;
		}
		const upvalue = this.resolveUpvalue(name);
		if (upvalue !== null) {
			this.emitABC(OpCode.GETUP, target, upvalue, 0);
			return;
		}
		if (this.getMemoryAccessKindForCanonicalName(name) !== null) {
			throw new Error(`[Compiler] '${name}' is a reserved memory map. Use direct indexing syntax like ${name}[addr].`);
		}
		if (this.isReservedIntrinsicName(name)) {
			throw new Error(`[Compiler] '${name}' is a reserved intrinsic. Use ${name}(base, ...).`);
		}
		const key = this.program.constIndexString(name);
		this.emitABx(OpCode.GETG, target, key);
	}

	private compileMemberExpression(expression: any, target: number): void {
		const baseReg = this.allocTemp();
		this.compileExpressionInto(expression.base, baseReg, 1);
		const key = this.program.constIndexString(this.canonicalizeName(expression.identifier));
		this.emitABC(OpCode.GETT, target, baseReg, this.encodeConstOperand(key), RK_C);
	}

	private compileIndexExpression(expression: any, target: number): void {
		const memoryTarget = this.tryCompileMemoryTarget(expression as LuaIndexExpression);
		if (memoryTarget !== null) {
			this.emitMemoryLoad(target, memoryTarget.accessKind, memoryTarget.addrConst, memoryTarget.addrReg);
			return;
		}
		const baseReg = this.allocTemp();
		this.compileExpressionInto(expression.base, baseReg, 1);
		const keyConst = this.tryGetConstIndex(expression.index);
		if (keyConst !== null) {
			this.emitABC(OpCode.GETT, target, baseReg, this.encodeConstOperand(keyConst), RK_C);
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
				const keyConst = this.program.constIndex(arrayIndex);
				this.emitABC(OpCode.SETT, target, this.encodeConstOperand(keyConst), valueReg, RK_B | RK_C);
				arrayIndex += 1;
				this.tempTop = tempBase;
				continue;
			}
			if (field.kind === LuaTableFieldKind.IdentifierKey) {
				const valueReg = this.allocTemp();
				this.compileExpressionInto(field.value, valueReg, 1);
				const keyConst = this.program.constIndexString(this.canonicalizeName(field.name));
				this.emitABC(OpCode.SETT, target, this.encodeConstOperand(keyConst), valueReg, RK_B | RK_C);
				this.tempTop = tempBase;
				continue;
			}
			const keyConst = this.tryGetConstIndex(field.key);
			if (keyConst !== null) {
				const valueReg = this.allocTemp();
				this.compileExpressionInto(field.value, valueReg, 1);
				this.emitABC(OpCode.SETT, target, this.encodeConstOperand(keyConst), valueReg, RK_B | RK_C);
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

	private tryGetConstIndex(expression: LuaExpression): number | null {
		switch (expression.kind) {
			case LuaSyntaxKind.NumericLiteralExpression:
				return this.program.constIndex((expression as LuaNumericLiteralExpression).value);
			case LuaSyntaxKind.StringLiteralExpression:
				return this.program.constIndexString((expression as LuaStringLiteralExpression).value);
			case LuaSyntaxKind.BooleanLiteralExpression:
				return this.program.constIndex((expression as LuaBooleanLiteralExpression).value);
			case LuaSyntaxKind.NilLiteralExpression:
				return this.program.constIndex(null);
			default:
				return null;
		}
	}

	private tryGetNumericConstIndex(expression: LuaExpression): number | null {
		if (expression.kind !== LuaSyntaxKind.NumericLiteralExpression) {
			return null;
		}
		return this.program.constIndex((expression as LuaNumericLiteralExpression).value);
	}

	private getMemoryAccessKindForCanonicalName(name: string): MemoryAccessKind | null {
		switch (name) {
			case 'mem':
				return MemoryAccessKind.Word;
			case 'mem8':
				return MemoryAccessKind.U8;
			case 'mem16le':
				return MemoryAccessKind.U16LE;
			case 'mem32le':
				return MemoryAccessKind.U32LE;
			case 'memf32le':
				return MemoryAccessKind.F32LE;
			case 'memf64le':
				return MemoryAccessKind.F64LE;
			default:
				return null;
		}
	}

	private isReservedIntrinsicName(name: string): boolean {
		return name === 'write_words';
	}

	private tryGetMemoryAccessKind(expression: LuaExpression): MemoryAccessKind | null {
		if (expression.kind !== LuaSyntaxKind.IdentifierExpression) {
			return null;
		}
		const name = this.canonicalizeName((expression as LuaIdentifierExpression).name);
		if (this.hasLexicalBindingCanonical(name)) {
			return null;
		}
		return this.getMemoryAccessKindForCanonicalName(name);
	}

	private tryCompileMemoryTarget(expression: LuaIndexExpression): Extract<AssignmentTarget, { kind: 'memory' }> | null {
		const accessKind = this.tryGetMemoryAccessKind(expression.base);
		if (accessKind === null) {
			return null;
		}
		const addrConst = this.tryGetNumericConstIndex(expression.index);
		if (addrConst !== null) {
			return { kind: 'memory', accessKind, addrConst };
		}
		const addrReg = this.allocTemp();
		this.compileExpressionInto(expression.index, addrReg, 1);
		return { kind: 'memory', accessKind, addrReg };
	}

	private emitMemoryLoad(target: number, accessKind: MemoryAccessKind, addrConst: number | undefined, addrReg: number | undefined): void {
		const addrOperand = addrConst !== undefined ? this.encodeConstOperand(addrConst) : addrReg;
		this.emitABC(OpCode.LOAD_MEM, target, addrOperand, accessKind, addrConst !== undefined ? RK_B : 0);
	}

	private emitMemoryStore(accessKind: MemoryAccessKind, addrConst: number | undefined, addrReg: number | undefined, valueReg: number): void {
		const addrOperand = addrConst !== undefined ? this.encodeConstOperand(addrConst) : addrReg;
		this.emitABC(OpCode.STORE_MEM, valueReg, addrOperand, accessKind, addrConst !== undefined ? RK_B : 0);
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
		const name = this.canonicalizeName((expression.callee as LuaIdentifierExpression).name);
		if (this.hasLexicalBindingCanonical(name)) {
			return false;
		}
		if (name === 'write_words') {
			this.compileWriteWordsIntrinsic(expression, target, resultCount);
			return true;
		}
		return false;
	}

	private compileWriteWordsIntrinsic(expression: LuaCallExpression, target: number, resultCount: number): void {
		if (expression.arguments.length < 2) {
			throw new Error('[Compiler] write_words expects a base address and at least one word.');
		}
		const lastArg = expression.arguments[expression.arguments.length - 1];
		if (this.isMultiReturnExpression(lastArg)) {
			throw new Error('[Compiler] write_words does not support multi-return or vararg operands.');
		}
		const addrExpression = expression.arguments[0];
		const addrConst = this.tryGetNumericConstIndex(addrExpression);
		let addrReg: number | undefined;
		if (addrConst === null) {
			addrReg = this.allocTemp();
			this.compileExpressionInto(addrExpression, addrReg, 1);
		}
		const valueCount = expression.arguments.length - 1;
		const valueBase = this.allocTempBlock(valueCount);
		for (let index = 0; index < valueCount; index += 1) {
			this.compileExpressionInto(expression.arguments[index + 1], valueBase + index, 1);
		}
		this.emitMemoryWordStoreSequence(valueBase, valueCount, addrConst ?? undefined, addrReg);
		if (resultCount > 0) {
			this.emitLoadNil(target, resultCount);
		}
	}

	private compileRKOperand(expression: LuaExpression): number {
		const constIndex = this.tryGetConstIndex(expression);
		if (constIndex !== null) {
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

	private emitArithmetic(op: OpCode, target: number, leftReg: number, rightReg: number): void {
		this.emitABC(op, target, leftReg, rightReg, RK_B | RK_C);
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
		if (this.tryCompileIntrinsicCall(expression, target, resultCount)) {
			return;
		}
		const methodName = expression.methodName !== null ? this.canonicalizeName(expression.methodName) : null;
		const hasMethod = methodName && methodName.length > 0;
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
		if (hasMethod) {
			this.reserveTempRange(callBase, 2);
			this.compileExpressionInto(expression.callee, callBase + 1, 1);
			const methodKey = this.program.constIndexString(methodName);
			this.emitABC(OpCode.GETT, callBase, callBase + 1, this.encodeConstOperand(methodKey), RK_C);
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

function compileFunctionExpression(program: ProgramBuilder, expression: LuaFunctionExpression, parent: FunctionBuilder | null, implicitSelf: boolean, protoId: string, moduleId: string): number {
	const builder = new FunctionBuilder(program, parent, { moduleId, protoId });
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
	canonicalization: CanonicalizationType,
	optLevel: OptimizationLevel,
): ProgramBuilder {
	const builder = new ProgramBuilder(base.constPool, canonicalization, base.constPoolStringPool, optLevel);
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
			: [];
		const upvalueNames = metadata.upvalueNamesByProto?.[index] ?? [];
		builder.seedProto(cloneProto(proto), code, ranges, [], localSlots, upvalueNames, protoIds[index]);
	}
	return builder;
}

export function compileLuaChunkToProgram(chunk: LuaChunk, modules: ReadonlyArray<ProgramModule> = [], options: CompileOptions = {}): CompiledProgram {
	const canonicalization = options.canonicalization ?? 'none';
	const optLevel = options.optLevel ?? 0;
	const compileErrors: CompileError[] = [];
	let programBuilder: ProgramBuilder;
	if (options.baseProgram) {
		if (!options.baseMetadata) {
			throw new Error('[ProgramBuilder] Base program metadata is required.');
		}
		programBuilder = createProgramBuilderFromProgram(options.baseProgram, options.baseMetadata, canonicalization, optLevel);
	} else {
		programBuilder = new ProgramBuilder(null, canonicalization, null, optLevel);
	}
	const moduleId = chunk.range.path;
	const entryProtoId = buildEntryProtoId(moduleId);
	let entryProtoIndex = -1;
	const entryBuilder = new FunctionBuilder(programBuilder, null, { moduleId, protoId: entryProtoId });
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
		const builder = new FunctionBuilder(programBuilder, null, { moduleId: module.path, protoId: moduleProtoId });
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
	const canonicalization = options.canonicalization ?? 'none';
	const optLevel = options.optLevel ?? 0;
	const programBuilder = createProgramBuilderFromProgram(base, metadata, canonicalization, optLevel);
	const compileErrors: CompileError[] = [];
	const moduleId = chunk.range.path;
	const entryProtoId = buildEntryProtoId(moduleId);
	let entryProtoIndex = -1;
	const entryBuilder = new FunctionBuilder(programBuilder, null, { moduleId, protoId: entryProtoId });
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
