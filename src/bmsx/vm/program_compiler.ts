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
	type LuaStatement,
	type LuaStringLiteralExpression,
	type LuaSourceRange,
	type LuaTableConstructorExpression,
	type LuaWhileStatement,
	type LuaGotoStatement,
} from '../lua/lua_ast';
import { OpCode, type Program, type Proto, type UpvalueDesc, type Value, type SourceRange } from './cpu';
import { IO_ARG0_OFFSET, IO_BUFFER_BASE, IO_COMMAND_STRIDE, IO_CMD_PRINT, IO_WRITE_PTR_ADDR } from './vm_io';

export type CompiledProgram = {
	program: Program;
	entryProtoIndex: number;
	moduleProtoMap: Map<string, number>;
};

export type ProgramModule = {
	path: string;
	chunk: LuaChunk;
};

type CompileOptions = {
	baseProgram?: Program;
};

type LoopContext = {
	breakJumps: number[];
};

class ProgramBuilder {
	public readonly constPool: Value[];
	private readonly constMap: Map<string, number>;
	public readonly protos: Proto[] = [];
	public readonly protoCode: Uint32Array[] = [];
	public readonly protoRanges: ReadonlyArray<SourceRange | null>[] = [];
	public readonly protoIds: string[] = [];
	private readonly protoIdMap: Map<string, number> = new Map();
	private readonly assignedProtoIds: Set<string> = new Set();

	public constructor(baseConstPool: ReadonlyArray<Value> | null = null) {
		this.constPool = baseConstPool ? Array.from(baseConstPool) : [];
		this.constMap = new Map<string, number>();
		for (let index = 0; index < this.constPool.length; index += 1) {
			const value = this.constPool[index];
			this.constMap.set(this.makeConstKey(value), index);
		}
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

	public addProto(proto: Proto, code: Uint32Array, ranges: ReadonlyArray<SourceRange | null>, protoId: string): number {
		if (this.assignedProtoIds.has(protoId)) {
			throw new Error(`[ProgramBuilder] Duplicate proto id '${protoId}'.`);
		}
		this.assignedProtoIds.add(protoId);
		const existing = this.protoIdMap.get(protoId);
		if (existing !== undefined) {
			this.protos[existing] = proto;
			this.protoCode[existing] = code;
			this.protoRanges[existing] = ranges;
			this.protoIds[existing] = protoId;
			return existing;
		}
		const index = this.protos.length;
		this.protos.push(proto);
		this.protoCode.push(code);
		this.protoRanges.push(ranges);
		this.protoIds.push(protoId);
		this.protoIdMap.set(protoId, index);
		return index;
	}

	public seedProto(proto: Proto, code: Uint32Array, ranges: ReadonlyArray<SourceRange | null>, protoId: string): void {
		const index = this.protos.length;
		this.protos.push(proto);
		this.protoCode.push(code);
		this.protoRanges.push(ranges);
		this.protoIds.push(protoId);
		this.protoIdMap.set(protoId, index);
	}

	public buildProgram(): Program {
		let total = 0;
		for (let i = 0; i < this.protoCode.length; i += 1) {
			total += this.protoCode[i].length;
		}
		const fullCode = new Uint32Array(total);
		const fullRanges: Array<SourceRange | null> = new Array(total);
		let offset = 0;
		for (let i = 0; i < this.protoCode.length; i += 1) {
			const chunk = this.protoCode[i];
			if (!chunk) {
				throw new Error(`[ProgramBuilder] Missing code for proto index ${i}.`);
			}
			const ranges = this.protoRanges[i];
			this.protos[i].entryPC = offset;
			fullCode.set(chunk, offset);
			for (let j = 0; j < ranges.length; j += 1) {
				fullRanges[offset + j] = ranges[j];
			}
			offset += chunk.length;
		}
		return {
			code: fullCode,
			constPool: this.constPool,
			protos: this.protos,
			debugRanges: fullRanges,
			protoIds: this.protoIds,
		};
	}

	private makeConstKey(value: Value): string {
		if (value === null) return 'nil';
		if (typeof value === 'number') return `n:${value}`;
		if (typeof value === 'string') return `s:${value}`;
		if (typeof value === 'boolean') return `b:${value ? 1 : 0}`;
		return `o:${String(value)}`;
	}
}

const buildModuleRootId = (moduleId: string): string => `module:${moduleId}`;

const buildEntryProtoId = (moduleId: string): string => `${buildModuleRootId(moduleId)}/entry`;

const buildModuleProtoId = (moduleId: string): string => `${buildModuleRootId(moduleId)}/module`;

const buildAnonymousHint = (range: LuaSourceRange): string =>
	`anon:${range.start.line}:${range.start.column}:${range.end.line}:${range.end.column}`;

const buildProtoId = (parentId: string, hint: string): string => {
	if (!hint) throw new Error('Proto hint is required and defensive programming is not allowed.');
	return `${parentId}/${hint}`;
}

class FunctionBuilder {
	private readonly program: ProgramBuilder;
	private readonly parent: FunctionBuilder | null;
	private readonly moduleId: string;
	private readonly protoId: string;
	private readonly code: number[] = [];
	private readonly ranges: Array<SourceRange | null> = [];
	private readonly localStacks = new Map<string, number[]>();
	private readonly scopeStack: string[][] = [];
	private readonly upvalueDescs: UpvalueDesc[] = [];
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
	}

	public compileChunk(chunk: LuaChunk): void {
		this.pushScope();
		for (let i = 0; i < chunk.body.length; i += 1) {
			this.compileStatement(chunk.body[i]);
			this.resetTemps();
		}
		this.popScope();
		this.withRange(chunk.range, () => this.emitDefaultReturn());
		this.finalizeLabels();
	}

	public compileFunctionExpression(expression: LuaFunctionExpression, implicitSelf: boolean): void {
		this.pushScope();
		if (implicitSelf) {
			this.declareLocal('self');
		}
		for (let i = 0; i < expression.parameters.length; i += 1) {
			this.declareLocal(expression.parameters[i].name);
		}
		for (let i = 0; i < expression.body.body.length; i += 1) {
			this.compileStatement(expression.body.body[i]);
			this.resetTemps();
		}
		this.popScope();
		this.withRange(expression.range, () => this.emitDefaultReturn());
		this.finalizeLabels();
	}

	public getCode(): Uint32Array {
		return new Uint32Array(this.code);
	}

	public getRanges(): ReadonlyArray<SourceRange | null> {
		return this.ranges;
	}

	public getUpvalueDescs(): UpvalueDesc[] {
		return this.upvalueDescs;
	}

	public getMaxStack(): number {
		return this.maxStack;
	}

	private pushScope(): void {
		this.scopeStack.push([]);
	}

	private popScope(): void {
		const scope = this.scopeStack.pop()!;
		for (let i = scope.length - 1; i >= 0; i -= 1) {
			const name = scope[i];
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

	private finalizeLabels(): void {
		if (this.pendingLabelJumps.size === 0) {
			return;
		}
		const labels = Array.from(this.pendingLabelJumps.keys()).sort();
		throw new Error(`Missing label(s): ${labels.join(', ')}`);
	}

	private declareLocal(name: string): number {
		const reg = this.localCount;
		this.localCount += 1;
		if (this.tempTop < this.localCount) {
			this.tempTop = this.localCount;
		}
		if (this.tempTop > this.maxStack) {
			this.maxStack = this.tempTop;
		}
		let stack = this.localStacks.get(name);
		if (!stack) {
			stack = [];
			this.localStacks.set(name, stack);
		}
		stack.push(reg);
		const scope = this.scopeStack[this.scopeStack.length - 1];
		scope.push(name);
		return reg;
	}

	private resolveLocal(name: string): number | null {
		const stack = this.localStacks.get(name);
		if (!stack || stack.length === 0) {
			return null;
		}
		return stack[stack.length - 1];
	}

	private resolveUpvalue(name: string): number | null {
		const existing = this.upvalueMap.get(name);
		if (existing !== undefined) {
			return existing;
		}
		if (!this.parent) {
			return null;
		}
		const parentLocal = this.parent.resolveLocal(name);
		if (parentLocal !== null) {
			const index = this.upvalueDescs.length;
			this.upvalueDescs.push({ inStack: true, index: parentLocal });
			this.upvalueMap.set(name, index);
			return index;
		}
		const parentUpvalue = this.parent.resolveUpvalue(name);
		if (parentUpvalue !== null) {
			const index = this.upvalueDescs.length;
			this.upvalueDescs.push({ inStack: false, index: parentUpvalue });
			this.upvalueMap.set(name, index);
			return index;
		}
		return null;
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

	private emitABC(op: OpCode, a: number, b: number, c: number): void {
		const instr = ((op & 0xff) << 24) | ((a & 0xff) << 16) | ((b & 0xff) << 8) | (c & 0xff);
		this.code.push(instr >>> 0);
		this.ranges.push(this.currentRange);
	}

	private emitABx(op: OpCode, a: number, bx: number): void {
		const instr = ((op & 0xff) << 24) | ((a & 0xff) << 16) | (bx & 0xffff);
		this.code.push(instr >>> 0);
		this.ranges.push(this.currentRange);
	}

	private emitAsBx(op: OpCode, a: number, sbx: number): void {
		const encoded = sbx & 0xffff;
		const instr = ((op & 0xff) << 24) | ((a & 0xff) << 16) | encoded;
		this.code.push(instr >>> 0);
		this.ranges.push(this.currentRange);
	}

	private emitJumpPlaceholder(): number {
		const index = this.code.length;
		this.emitAsBx(OpCode.JMP, 0, 0);
		return index;
	}

	private patchJump(index: number, target: number): void {
		const sbx = target - (index + 1);
		const instr = ((OpCode.JMP & 0xff) << 24) | (sbx & 0xffff);
		this.code[index] = instr >>> 0;
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
					this.pushScope();
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
				const hint = expr.kind === LuaSyntaxKind.FunctionExpression && i < names.length
					? this.createLocalFunctionHint(names[i].name)
					: null;
				this.compileExpressionInto(expr, reg, 1, hint);
				valueRegs.push(reg);
			}
			const remaining = names.length - lastIndex;
			const lastExpr = values[lastIndex];
			const lastReg = this.allocTemp();
			const wantsMulti = remaining > 1 && this.isMultiReturnExpression(lastExpr);
			const resultCount = wantsMulti ? remaining : 1;
			const lastHint = lastExpr.kind === LuaSyntaxKind.FunctionExpression && lastIndex < names.length
				? this.createLocalFunctionHint(names[lastIndex].name)
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
			const target = this.declareLocal(names[i].name);
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

	private compileAssignmentTargets(expressions: ReadonlyArray<LuaExpression>): Array<{ kind: 'local' | 'upvalue' | 'global' | 'table'; reg?: number; upvalue?: number; keyConst?: number; tableReg?: number; keyReg?: number }> {
		const targets: Array<{ kind: 'local' | 'upvalue' | 'global' | 'table'; reg?: number; upvalue?: number; keyConst?: number; tableReg?: number; keyReg?: number }> = [];
		for (let i = 0; i < expressions.length; i += 1) {
			const expr = expressions[i];
			if (expr.kind === LuaSyntaxKind.IdentifierExpression) {
				const name = (expr as LuaIdentifierExpression).name;
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
				const keyConst = this.program.constIndex(name);
				targets.push({ kind: 'global', keyConst });
				continue;
			}
			if (expr.kind === LuaSyntaxKind.MemberExpression) {
				const baseReg = this.allocTemp();
				this.compileExpressionInto(expr.base, baseReg, 1);
				const keyConst = this.program.constIndex(expr.identifier);
				targets.push({ kind: 'table', tableReg: baseReg, keyConst });
				continue;
			}
			if (expr.kind === LuaSyntaxKind.IndexExpression) {
				const baseReg = this.allocTemp();
				this.compileExpressionInto(expr.base, baseReg, 1);
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

	private assignTarget(target: { kind: string; reg?: number; upvalue?: number; keyConst?: number; tableReg?: number; keyReg?: number }, valueReg: number): void {
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
				this.emitABC(OpCode.SETT, target.tableReg, keyOperand, valueReg);
				return;
			}
			default:
				throw new Error(`Unsupported assignment target kind: ${target.kind}`);
		}
	}

	private applyCompoundAssignment(
		target: { kind: string; reg?: number; upvalue?: number; keyConst?: number; tableReg?: number; keyReg?: number },
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
				this.emitABC(OpCode.GETT, temp, target.tableReg, keyOperand);
				this.emitArithmetic(opForAssignment(operator), temp, temp, valueReg);
				this.emitABC(OpCode.SETT, target.tableReg, keyOperand, temp);
				return;
			}
			default:
				throw new Error(`Unsupported compound assignment target: ${target.kind}`);
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
				this.emitABC(OpCode.TEST, condReg, 0, 0);
				const jumpToNext = this.emitJumpPlaceholder();
				this.pushScope();
				for (let j = 0; j < clause.block.body.length; j += 1) {
					this.compileStatement(clause.block.body[j]);
					this.resetTemps();
				}
				this.popScope();
				endJumps.push(this.emitJumpPlaceholder());
				this.patchJump(jumpToNext, this.code.length);
				continue;
			}
			this.pushScope();
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
		this.emitABC(OpCode.TEST, condReg, 0, 0);
		const jumpOut = this.emitJumpPlaceholder();
		const ctx: LoopContext = { breakJumps: [] };
		this.loopStack.push(ctx);
		this.pushScope();
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
		this.pushScope();
		for (let i = 0; i < statement.block.body.length; i += 1) {
			this.compileStatement(statement.block.body[i]);
			this.resetTemps();
		}
		this.popScope();
		this.loopStack.pop();
		const condReg = this.allocTemp();
		this.compileExpressionInto(statement.condition, condReg, 1);
		this.emitABC(OpCode.TEST, condReg, 0, 0);
		this.emitAsBx(OpCode.JMP, 0, loopStart - (this.code.length + 1));
		for (let i = 0; i < ctx.breakJumps.length; i += 1) {
			this.patchJump(ctx.breakJumps[i], this.code.length);
		}
	}

	private compileForNumeric(statement: any): void {
		this.pushScope();
		const indexReg = this.declareLocal(statement.variable.name);
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
		this.emitABC(OpCode.LT, 0, zeroOperand, stepReg);
		const jumpToNegativeCheck = this.emitJumpPlaceholder();
		this.emitABC(OpCode.LT, 1, limitReg, indexReg);
		const jumpOutPositive = this.emitJumpPlaceholder();
		const jumpToBody = this.emitJumpPlaceholder();
		this.patchJump(jumpToNegativeCheck, this.code.length);
		this.emitABC(OpCode.LT, 1, indexReg, limitReg);
		const jumpOutNegative = this.emitJumpPlaceholder();
		this.patchJump(jumpToBody, this.code.length);
		const ctx: LoopContext = { breakJumps: [] };
		this.loopStack.push(ctx);
		for (let i = 0; i < statement.block.body.length; i += 1) {
			this.compileStatement(statement.block.body[i]);
			this.resetTemps();
		}
		this.loopStack.pop();
		this.emitABC(OpCode.ADD, indexReg, indexReg, stepReg);
		this.emitAsBx(OpCode.JMP, 0, loopStart - (this.code.length + 1));
		this.patchJump(jumpOutPositive, this.code.length);
		this.patchJump(jumpOutNegative, this.code.length);
		for (let i = 0; i < ctx.breakJumps.length; i += 1) {
			this.patchJump(ctx.breakJumps[i], this.code.length);
		}
		this.popScope();
	}

	private compileForGeneric(statement: LuaForGenericStatement): void {
		this.pushScope();
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
			loopVars.push(this.declareLocal(statement.variables[i].name));
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
		this.emitABC(OpCode.EQ, 1, callBase, nilOperand);
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
		const reg = this.declareLocal(statement.name.name);
		const hint = this.createLocalFunctionHint(statement.name.name);
		const protoId = this.createChildProtoId(hint);
		const protoIndex = compileFunctionExpression(this.program, statement.functionExpression, this, false, protoId, this.moduleId);
		this.emitABx(OpCode.CLOSURE, reg, protoIndex);
	}

	private compileFunctionDeclaration(statement: any): void {
		const fnExpr = statement.functionExpression as LuaFunctionExpression;
		const methodName: string = statement.name.methodName;
		const identifiers = statement.name.identifiers as string[];
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
			this.emitABx(OpCode.SETG, closureReg, this.program.constIndex(name));
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
				this.emitABx(OpCode.GETG, baseReg, this.program.constIndex(baseName));
			}
		}

		const pathEnd = methodName ? identifiers.length : identifiers.length - 1;
		for (let i = 1; i < pathEnd; i += 1) {
			const key = this.program.constIndex(identifiers[i]);
			const nextReg = this.allocTemp();
			this.emitABC(OpCode.GETT, nextReg, baseReg, this.encodeConstOperand(key));
			this.emitABC(OpCode.MOV, baseReg, nextReg, 0);
		}
		const keyName = methodName && methodName.length > 0 ? methodName : identifiers[identifiers.length - 1];
		const keyConst = this.program.constIndex(keyName);
		this.emitABC(OpCode.SETT, baseReg, this.encodeConstOperand(keyConst), closureReg);
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
		const localReg = this.resolveLocal(expression.name);
		if (localReg !== null) {
			if (localReg !== target) {
				this.emitABC(OpCode.MOV, target, localReg, 0);
			}
			return;
		}
		const upvalue = this.resolveUpvalue(expression.name);
		if (upvalue !== null) {
			this.emitABC(OpCode.GETUP, target, upvalue, 0);
			return;
		}
		const key = this.program.constIndex(expression.name);
		this.emitABx(OpCode.GETG, target, key);
	}

	private compileMemberExpression(expression: any, target: number): void {
		const baseReg = this.allocTemp();
		this.compileExpressionInto(expression.base, baseReg, 1);
		const key = this.program.constIndex(expression.identifier);
		this.emitABC(OpCode.GETT, target, baseReg, this.encodeConstOperand(key));
	}

	private compileIndexExpression(expression: any, target: number): void {
		const baseReg = this.allocTemp();
		this.compileExpressionInto(expression.base, baseReg, 1);
		const keyReg = this.allocTemp();
		this.compileExpressionInto(expression.index, keyReg, 1);
		this.emitABC(OpCode.GETT, target, baseReg, keyReg);
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
				this.emitABC(OpCode.SETT, target, this.encodeConstOperand(keyConst), valueReg);
				arrayIndex += 1;
				this.tempTop = tempBase;
				continue;
			}
			if (field.kind === LuaTableFieldKind.IdentifierKey) {
				const valueReg = this.allocTemp();
				this.compileExpressionInto(field.value, valueReg, 1);
				const keyConst = this.program.constIndex(field.name);
				this.emitABC(OpCode.SETT, target, this.encodeConstOperand(keyConst), valueReg);
				this.tempTop = tempBase;
				continue;
			}
			const keyReg = this.allocTemp();
			this.compileExpressionInto(field.key, keyReg, 1);
			const valueReg = this.allocTemp();
			this.compileExpressionInto(field.value, valueReg, 1);
			this.emitABC(OpCode.SETT, target, keyReg, valueReg);
			this.tempTop = tempBase;
		}
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
				this.compileArithmetic(OpCode.CONCAT, expression.left, expression.right, target);
				return;
			case LuaBinaryOperator.Exponent:
				this.compileArithmetic(OpCode.POW, expression.left, expression.right, target);
				return;
			default:
				throw new Error(`Unsupported binary operator: ${expression.operator}`);
		}
	}

	private compileArithmetic(op: OpCode, left: LuaExpression, right: LuaExpression, target: number): void {
		const leftReg = this.allocTemp();
		this.compileExpressionInto(left, leftReg, 1);
		const rightReg = this.allocTemp();
		this.compileExpressionInto(right, rightReg, 1);
		this.emitABC(op, target, leftReg, rightReg);
	}

	private emitArithmetic(op: OpCode, target: number, leftReg: number, rightReg: number): void {
		this.emitABC(op, target, leftReg, rightReg);
	}

	private compileComparison(op: OpCode, left: LuaExpression, right: LuaExpression, target: number): void {
		const leftReg = this.allocTemp();
		this.compileExpressionInto(left, leftReg, 1);
		const rightReg = this.allocTemp();
		this.compileExpressionInto(right, rightReg, 1);
		this.emitLoadBool(target, true);
		this.emitABC(op, 1, leftReg, rightReg);
		const jump = this.emitJumpPlaceholder();
		this.emitLoadBool(target, false);
		this.patchJump(jump, this.code.length);
	}

	private compileAndExpression(expression: any, target: number): void {
		this.compileExpressionInto(expression.left, target, 1);
		this.emitABC(OpCode.TEST, target, 0, 0);
		const jump = this.emitJumpPlaceholder();
		this.compileExpressionInto(expression.right, target, 1);
		this.patchJump(jump, this.code.length);
	}

	private compileOrExpression(expression: any, target: number): void {
		this.compileExpressionInto(expression.left, target, 1);
		this.emitABC(OpCode.TEST, target, 0, 0);
		const jumpToEval = this.emitJumpPlaceholder();
		const jumpEnd = this.emitJumpPlaceholder();
		this.patchJump(jumpToEval, this.code.length);
		this.compileExpressionInto(expression.right, target, 1);
		this.patchJump(jumpEnd, this.code.length);
	}

	private compileCallExpression(expression: LuaCallExpression, target: number, resultCount: number): void {
		if (this.tryCompilePrintCall(expression, target)) {
			return;
		}
		if (this.tryCompilePeekCall(expression, target)) {
			return;
		}
		if (this.tryCompilePokeCall(expression, target)) {
			return;
		}
		const hasMethod = expression.methodName && expression.methodName.length > 0;
		const argCount = expression.arguments.length;
		const lastArg = argCount > 0 ? expression.arguments[argCount - 1] : null;
		const hasVarArg = lastArg !== null && this.isMultiReturnExpression(lastArg);
		const fixedArgCount = hasVarArg ? argCount - 1 : argCount;
		const callBase = target;
		const baseValueReg = this.allocTemp();
		if (hasMethod) {
			this.compileExpressionInto(expression.callee, baseValueReg, 1);
			const methodKey = this.program.constIndex(expression.methodName);
			const methodReg = this.allocTemp();
			this.emitABC(OpCode.GETT, methodReg, baseValueReg, this.encodeConstOperand(methodKey));
			if (callBase !== methodReg) {
				this.emitABC(OpCode.MOV, callBase, methodReg, 0);
			}
			this.emitABC(OpCode.MOV, callBase + 1, baseValueReg, 0);
		} else {
			this.compileExpressionInto(expression.callee, baseValueReg, 1);
			if (callBase !== baseValueReg) {
				this.emitABC(OpCode.MOV, callBase, baseValueReg, 0);
			}
		}
		const argBase = callBase + (hasMethod ? 2 : 1);
		const callSlotCount = fixedArgCount + (hasMethod ? 2 : 1) + (hasVarArg ? 1 : 0);
		const resultSlots = resultCount > 0 ? resultCount : 0;
		const requiredSlots = Math.max(callSlotCount, resultSlots);
		this.ensureMaxStack(callBase + requiredSlots);
		for (let i = 0; i < fixedArgCount; i += 1) {
			const argReg = this.allocTemp();
			this.compileExpressionInto(expression.arguments[i], argReg, 1);
			this.emitABC(OpCode.MOV, argBase + i, argReg, 0);
		}
		let callArgs = fixedArgCount + (hasMethod ? 1 : 0);
		if (hasVarArg) {
			this.compileExpressionInto(expression.arguments[argCount - 1], argBase + fixedArgCount, 0);
			callArgs = 0;
		}
		this.emitABC(OpCode.CALL, callBase, callArgs, resultCount);
	}

	private tryCompilePrintCall(expression: LuaCallExpression, target: number): boolean {
		if (expression.methodName && expression.methodName.length > 0) {
			return false;
		}
		if (expression.callee.kind !== LuaSyntaxKind.IdentifierExpression) {
			return false;
		}
		const name = (expression.callee as LuaIdentifierExpression).name;
		if (name !== 'print') {
			return false;
		}
		const argReg = this.allocTemp();
		if (expression.arguments.length > 0) {
			this.compileExpressionInto(expression.arguments[0], argReg, 1);
		} else {
			this.emitLoadNil(argReg, 1);
		}
		this.emitIoCommand(IO_CMD_PRINT, [argReg]);
		this.emitLoadNil(target, 1);
		return true;
	}

	private tryCompilePeekCall(expression: LuaCallExpression, target: number): boolean {
		if (expression.methodName && expression.methodName.length > 0) {
			return false;
		}
		if (expression.callee.kind !== LuaSyntaxKind.IdentifierExpression) {
			return false;
		}
		const name = (expression.callee as LuaIdentifierExpression).name;
		if (name !== 'peek') {
			return false;
		}
		const addrReg = this.allocTemp();
		this.compileExpressionInto(expression.arguments[0], addrReg, 1);
		this.emitABC(OpCode.LOAD_MEM, target, addrReg, 0);
		return true;
	}

	private tryCompilePokeCall(expression: LuaCallExpression, target: number): boolean {
		if (expression.methodName && expression.methodName.length > 0) {
			return false;
		}
		if (expression.callee.kind !== LuaSyntaxKind.IdentifierExpression) {
			return false;
		}
		const name = (expression.callee as LuaIdentifierExpression).name;
		if (name !== 'poke') {
			return false;
		}
		const addrReg = this.allocTemp();
		const valueReg = this.allocTemp();
		this.compileExpressionInto(expression.arguments[0], addrReg, 1);
		this.compileExpressionInto(expression.arguments[1], valueReg, 1);
		this.emitABC(OpCode.STORE_MEM, valueReg, addrReg, 0);
		this.emitLoadNil(target, 1);
		return true;
	}

	private emitIoCommand(command: number, argRegs: ReadonlyArray<number>): void {
		const base = this.allocTempBlock(6);
		const writePtrAddrReg = base;
		const writePtrReg = base + 1;
		const bufferBaseReg = base + 2;
		const strideReg = base + 3;
		const commandBaseReg = base + 4;
		const tempReg = base + 5;

		this.emitLoadConst(writePtrAddrReg, IO_WRITE_PTR_ADDR);
		this.emitABC(OpCode.LOAD_MEM, writePtrReg, writePtrAddrReg, 0);
		this.emitLoadConst(bufferBaseReg, IO_BUFFER_BASE);
		this.emitLoadConst(strideReg, IO_COMMAND_STRIDE);
		this.emitABC(OpCode.MUL, commandBaseReg, writePtrReg, strideReg);
		this.emitABC(OpCode.ADD, commandBaseReg, bufferBaseReg, commandBaseReg);
		this.emitLoadConst(tempReg, command);
		this.emitABC(OpCode.STORE_MEM, tempReg, commandBaseReg, 0);

		for (let i = 0; i < argRegs.length; i += 1) {
			this.emitLoadConst(tempReg, IO_ARG0_OFFSET + i);
			this.emitABC(OpCode.ADD, tempReg, commandBaseReg, tempReg);
			this.emitABC(OpCode.STORE_MEM, argRegs[i], tempReg, 0);
		}

		this.emitLoadConst(tempReg, 1);
		this.emitABC(OpCode.ADD, writePtrReg, writePtrReg, tempReg);
		this.emitABC(OpCode.STORE_MEM, writePtrReg, writePtrAddrReg, 0);
	}

	private encodeConstOperand(constIndex: number): number {
		if (constIndex < 0x80) {
			return constIndex | 0x80;
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

const buildDeclarationHint = (identifiers: ReadonlyArray<string>, methodName: string): string => {
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

function compileFunctionExpression(program: ProgramBuilder, expression: LuaFunctionExpression, parent: FunctionBuilder | null, implicitSelf: boolean, protoId: string, moduleId: string): number {
	const builder = new FunctionBuilder(program, parent, { moduleId, protoId });
	builder.compileFunctionExpression(expression, implicitSelf);
	const code = builder.getCode();
	const ranges = builder.getRanges();
	const protoIndex = program.addProto({
		entryPC: 0,
		codeLen: code.length,
		numParams: expression.parameters.length + (implicitSelf ? 1 : 0),
		isVararg: expression.hasVararg,
		maxStack: builder.getMaxStack(),
		upvalueDescs: builder.getUpvalueDescs(),
	}, code, ranges, protoId);
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

function createProgramBuilderFromProgram(base: Program): ProgramBuilder {
	const builder = new ProgramBuilder(base.constPool);
	const protoIds = base.protoIds;
	if (!protoIds || protoIds.length !== base.protos.length) {
		throw new Error('[ProgramBuilder] Base program proto ids missing or mismatched.');
	}
	for (let index = 0; index < base.protos.length; index += 1) {
		const proto = base.protos[index];
		const start = proto.entryPC;
		const end = start + proto.codeLen;
		const code = base.code.slice(start, end);
		const ranges = base.debugRanges.slice(start, end);
		builder.seedProto(cloneProto(proto), code, ranges, protoIds[index]);
	}
	return builder;
}

export function compileLuaChunkToProgram(chunk: LuaChunk, modules: ReadonlyArray<ProgramModule> = [], options: CompileOptions = {}): CompiledProgram {
	const programBuilder = options.baseProgram ? createProgramBuilderFromProgram(options.baseProgram) : new ProgramBuilder();
	const moduleId = chunk.range.path;
	const entryProtoId = buildEntryProtoId(moduleId);
	const entryBuilder = new FunctionBuilder(programBuilder, null, { moduleId, protoId: entryProtoId });
	entryBuilder.compileChunk(chunk);
	const entryCode = entryBuilder.getCode();
	const entryRanges = entryBuilder.getRanges();
	const entryProtoIndex = programBuilder.addProto({
		entryPC: 0,
		codeLen: entryCode.length,
		numParams: 0,
		isVararg: false,
		maxStack: entryBuilder.getMaxStack(),
		upvalueDescs: entryBuilder.getUpvalueDescs(),
	}, entryCode, entryRanges, entryProtoId);
	const moduleProtoMap = new Map<string, number>();
	for (const module of modules) {
		const moduleProtoId = buildModuleProtoId(module.path);
		const builder = new FunctionBuilder(programBuilder, null, { moduleId: module.path, protoId: moduleProtoId });
		builder.compileChunk(module.chunk);
		const code = builder.getCode();
		const ranges = builder.getRanges();
		const protoIndex = programBuilder.addProto({
			entryPC: 0,
			codeLen: code.length,
			numParams: 0,
			isVararg: false,
			maxStack: builder.getMaxStack(),
			upvalueDescs: builder.getUpvalueDescs(),
		}, code, ranges, moduleProtoId);
		moduleProtoMap.set(module.path, protoIndex);
	}
	const program = programBuilder.buildProgram();
	return { program, entryProtoIndex, moduleProtoMap };
}

export function appendLuaChunkToProgram(base: Program, chunk: LuaChunk): { program: Program; entryProtoIndex: number } {
	const programBuilder = createProgramBuilderFromProgram(base);
	const moduleId = chunk.range.path;
	const entryProtoId = buildEntryProtoId(moduleId);
	const entryBuilder = new FunctionBuilder(programBuilder, null, { moduleId, protoId: entryProtoId });
	entryBuilder.compileChunk(chunk);
	const entryCode = entryBuilder.getCode();
	const entryRanges = entryBuilder.getRanges();
	const entryProtoIndex = programBuilder.addProto({
		entryPC: 0,
		codeLen: entryCode.length,
		numParams: 0,
		isVararg: false,
		maxStack: entryBuilder.getMaxStack(),
		upvalueDescs: entryBuilder.getUpvalueDescs(),
	}, entryCode, entryRanges, entryProtoId);
	const program = programBuilder.buildProgram();
	return { program, entryProtoIndex };
}
