import {
	LuaSyntaxKind,
} from '../lua/lua_ast';
import type {
	LuaAssignmentStatement,
	LuaCallStatement,
	LuaCallExpression,
	LuaDoStatement,
	LuaExpression,
	LuaForGenericStatement,
	LuaForNumericStatement,
	LuaFunctionDeclarationStatement,
	LuaGotoStatement,
	LuaIfStatement,
	LuaLabelStatement,
	LuaLocalAssignmentStatement,
	LuaLocalFunctionStatement,
	LuaRepeatStatement,
	LuaReturnStatement,
	LuaStatement,
	LuaWhileStatement,
	LuaSourceRange,
} from '../lua/lua_ast';
import { LuaEnvironment } from '../lua/luaenvironment';
import type { LuaFunctionValue, LuaValue } from '../lua/luavalue';
import { isLuaDebuggerPauseSignal } from '../lua/luavalue';
import type { LuaDebuggerController, LuaDebuggerPauseReason } from '../lua/luadebugger';
import type { LuaRuntimeError, LuaSyntaxError } from '../lua/luaerrors';
import type { ExecutionSignal, LuaCallFrame } from '../lua/luaruntime';
import { VmRam, type LuaInstruction } from './ram';

const NORMAL_SIGNAL: ExecutionSignal = null;

export type LabelMetadata = {
	readonly index: number;
	readonly statement: LuaLabelStatement;
};

export type LabelScope = {
	readonly labels: Map<string, LabelMetadata>;
	readonly parent: LabelScope;
};

export type FrameBoundary = 'path' | 'function' | 'block';

export type StatementsFrame = {
	readonly kind: 'statements';
	readonly instructions: ReadonlyArray<LuaInstruction>;
	index: number;
	environment: LuaEnvironment;
	varargs: ReadonlyArray<LuaValue>;
	scope: LabelScope;
	boundary: FrameBoundary;
	callFramePushed: boolean;
	callRange: LuaSourceRange;
};

export type WhileFrame = {
	readonly kind: 'while';
	readonly statement: LuaWhileStatement;
	environment: LuaEnvironment;
	varargs: ReadonlyArray<LuaValue>;
	scope: LabelScope;
	readonly loopEnvironment: LuaEnvironment;
};

export type RepeatFrame = {
	readonly kind: 'repeat';
	readonly statement: LuaRepeatStatement;
	readonly baseEnvironment: LuaEnvironment;
	environment: LuaEnvironment;
	varargs: ReadonlyArray<LuaValue>;
	scope: LabelScope;
	iterationEnvironment: LuaEnvironment | null;
	state: 'body' | 'condition';
};

export type NumericForFrame = {
	readonly kind: 'numeric-for';
	readonly statement: LuaForNumericStatement;
	environment: LuaEnvironment;
	varargs: ReadonlyArray<LuaValue>;
	scope: LabelScope;
	readonly loopEnvironment: LuaEnvironment;
	current: number;
	readonly limit: number;
	readonly step: number;
	readonly ascending: boolean;
	state: 'check' | 'body';
};

export type GenericForFrame = {
	readonly kind: 'generic-for';
	readonly statement: LuaForGenericStatement;
	environment: LuaEnvironment;
	varargs: ReadonlyArray<LuaValue>;
	scope: LabelScope;
	readonly loopEnvironment: LuaEnvironment;
	readonly iteratorFunction: LuaFunctionValue;
	readonly stateValue: LuaValue;
	control: LuaValue;
	pendingResults: ReadonlyArray<LuaValue> | null;
	state: 'call' | 'body';
};

export type ExecutionFrame = StatementsFrame | WhileFrame | RepeatFrame | NumericForFrame | GenericForFrame;

export type LuaCpuHost = {
	readonly debuggerController: LuaDebuggerController | null;
	fallbackSourceRange(): LuaSourceRange;
	createPauseSignal(reason: LuaDebuggerPauseReason, range: LuaSourceRange, exception?: LuaRuntimeError | LuaSyntaxError): ExecutionSignal;
	executeLocalAssignment(statement: LuaLocalAssignmentStatement, environment: LuaEnvironment, varargs: ReadonlyArray<LuaValue>): void;
	executeLocalFunction(statement: LuaLocalFunctionStatement, environment: LuaEnvironment): void;
	executeFunctionDeclaration(statement: LuaFunctionDeclarationStatement, environment: LuaEnvironment): void;
	executeAssignment(statement: LuaAssignmentStatement, environment: LuaEnvironment, varargs: ReadonlyArray<LuaValue>): void;
	executeReturn(statement: LuaReturnStatement, environment: LuaEnvironment, varargs: ReadonlyArray<LuaValue>): ExecutionSignal;
	evaluateSingleExpression(expression: LuaExpression, environment: LuaEnvironment, varargs: ReadonlyArray<LuaValue>): LuaValue;
	evaluateExpressionList(expressions: ReadonlyArray<LuaExpression>, environment: LuaEnvironment, varargs: ReadonlyArray<LuaValue>): LuaValue[];
	evaluateCallExpression(expression: LuaCallExpression, environment: LuaEnvironment, varargs: ReadonlyArray<LuaValue>): LuaValue[];
	isTruthy(value: LuaValue): boolean;
	expectNumber(value: LuaValue, message: string, range: LuaSourceRange | null): number;
	expectFunction(value: LuaValue, message: string, range: LuaSourceRange | null): LuaFunctionValue;
	assignGenericLoopVariables(statement: LuaForGenericStatement, loopEnvironment: LuaEnvironment, results: ReadonlyArray<LuaValue>): void;
	runtimeError(message: string): LuaRuntimeError;
	runtimeErrorAt(range: LuaSourceRange, message: string): LuaRuntimeError;
	allocateValueList(): LuaValue[];
};

export class LuaCpu {
	public programCounter = 0;
	public readonly programCounterStack: number[] = [];
	public instructionBudgetRemaining: number | null = null;
	public readonly frameStack: ExecutionFrame[] = [];
	public readonly envStack: LuaEnvironment[] = [];
	public readonly callStack: LuaCallFrame[] = [];
	public activeStatementRange: LuaSourceRange = null;
	public activeStatementFrame: StatementsFrame = null;
	public lastStatementRange: LuaSourceRange = null;

	private readonly ram: VmRam;
	private readonly host: LuaCpuHost;

	public constructor(ram: VmRam, host: LuaCpuHost) {
		this.ram = ram;
		this.host = host;
	}

	public advanceProgramCounter(): number {
		this.programCounter += 1;
		if (this.instructionBudgetRemaining !== null) {
			this.instructionBudgetRemaining -= 1;
		}
		return this.programCounter;
	}

	public pushProgramCounter(): number {
		this.programCounterStack.push(this.programCounter);
		return this.programCounter;
	}

	public popProgramCounter(): number {
		const restored = this.programCounterStack.pop()!;
		this.programCounter = restored;
		return restored;
	}

	public pushFrame(frame: ExecutionFrame): void {
		this.frameStack.push(frame);
		this.envStack.push(frame.environment);
	}

	public popFrame(): ExecutionFrame {
		const frame = this.frameStack.pop()!;
		this.envStack.pop();
		if (frame.kind === 'statements' && frame.callFramePushed) {
			this.callStack.pop();
		}
		return frame;
	}

	public pushStatementsFrame(config: {
		readonly statements: ReadonlyArray<LuaStatement>;
		readonly environment: LuaEnvironment;
		readonly varargs: ReadonlyArray<LuaValue>;
		readonly scope: LabelScope;
		readonly boundary: FrameBoundary;
		readonly callRange: LuaSourceRange;
		readonly callName?: string;
	}): void {
		const callRange = config.callRange ?? this.host.fallbackSourceRange();
		let callFramePushed = false;
		if (config.boundary !== 'block') {
			this.callStack.push({
				functionName: config.callName && config.callName.length > 0 ? config.callName : null,
				source: callRange.path,
				line: callRange.start.line,
				column: callRange.start.column,
			});
			callFramePushed = true;
		}
		const instructions = this.ram.loadStatements(config.statements);
		const frame: StatementsFrame = {
			kind: 'statements',
			instructions,
			index: 0,
			environment: config.environment,
			varargs: config.varargs,
			scope: config.scope,
			boundary: config.boundary,
			callFramePushed,
			callRange,
		};
		this.pushFrame(frame);
	}

	public stepFrame(frame: ExecutionFrame): ExecutionSignal {
		switch (frame.kind) {
			case 'statements':
				return this.stepStatementsFrame(frame as StatementsFrame);
			case 'while':
				return this.stepWhileFrame(frame as WhileFrame);
			case 'repeat':
				return this.stepRepeatFrame(frame as RepeatFrame);
			case 'numeric-for':
				return this.stepNumericForFrame(frame as NumericForFrame);
			case 'generic-for':
				return this.stepGenericForFrame(frame as GenericForFrame);
			default:
				throw this.host.runtimeError('Unsupported execution frame.');
		}
	}

	public tryConsumeBreak(): boolean {
		for (let index = this.frameStack.length - 1; index >= 0; index -= 1) {
			const frame = this.frameStack[index];
			if (frame.kind === 'while' || frame.kind === 'repeat' || frame.kind === 'numeric-for' || frame.kind === 'generic-for') {
				while (this.frameStack.length > index + 1) {
					this.popFrame();
				}
				this.popFrame();
				return true;
			}
			if (frame.kind === 'statements' && (frame as StatementsFrame).boundary !== 'block') {
				break;
			}
		}
		return false;
	}

	public tryConsumeGoto(signal: Extract<ExecutionSignal, { kind: 'goto' }>): boolean {
		for (let index = this.frameStack.length - 1; index >= 0; index -= 1) {
			const frame = this.frameStack[index];
			if (frame.kind === 'statements') {
				const statementsFrame = frame as StatementsFrame;
				const metadata = this.resolveLabel(statementsFrame.scope, signal.label);
				if (metadata !== null) {
					while (this.frameStack.length > index + 1) {
						this.popFrame();
					}
					statementsFrame.index = metadata.index;
					return true;
				}
			}
			if (frame.kind === 'statements' && (frame as StatementsFrame).boundary !== 'block') {
				break;
			}
		}
		return false;
	}

	public popUntilBoundary(): void {
		while (this.frameStack.length > 0) {
			const frame = this.popFrame();
			if (frame.kind === 'statements' && frame.boundary !== 'block') {
				return;
			}
		}
	}

	public createLabelScope(statements: ReadonlyArray<LuaStatement>, parent: LabelScope): LabelScope {
		return { labels: this.buildLabelMap(statements), parent };
	}

	private stepStatementsFrame(frame: StatementsFrame): ExecutionSignal {
		while (frame.index < frame.instructions.length && frame.instructions[frame.index].statement.kind === LuaSyntaxKind.LabelStatement) {
			frame.index += 1;
		}
		if (frame.index >= frame.instructions.length) {
			this.popFrame();
			return NORMAL_SIGNAL;
		}
		const instruction = frame.instructions[frame.index];
		const statement = instruction.statement;
		this.activeStatementRange = statement.range ?? this.host.fallbackSourceRange();
		this.activeStatementFrame = frame;
		const controller = this.host.debuggerController;
		if (controller) {
			const reason = controller.shouldPause(this.activeStatementRange.path, this.activeStatementRange.start.line, this.callStack.length);
			if (reason !== null) {
				const pause = this.host.createPauseSignal(reason, this.activeStatementRange);
				this.activeStatementRange = null;
				this.activeStatementFrame = null;
				return pause;
			}
		}
		this.advanceProgramCounter();
		let clearActiveStatement = true;
		try {
			switch (statement.kind) {
				case LuaSyntaxKind.LocalAssignmentStatement:
					this.host.executeLocalAssignment(statement as LuaLocalAssignmentStatement, frame.environment, frame.varargs);
					frame.index += 1;
					return NORMAL_SIGNAL;
				case LuaSyntaxKind.LocalFunctionStatement:
					this.host.executeLocalFunction(statement as LuaLocalFunctionStatement, frame.environment);
					frame.index += 1;
					return NORMAL_SIGNAL;
				case LuaSyntaxKind.FunctionDeclarationStatement:
					this.host.executeFunctionDeclaration(statement as LuaFunctionDeclarationStatement, frame.environment);
					frame.index += 1;
					return NORMAL_SIGNAL;
				case LuaSyntaxKind.AssignmentStatement:
					this.host.executeAssignment(statement as LuaAssignmentStatement, frame.environment, frame.varargs);
					frame.index += 1;
					return NORMAL_SIGNAL;
				case LuaSyntaxKind.ReturnStatement:
					return this.host.executeReturn(statement as LuaReturnStatement, frame.environment, frame.varargs);
				case LuaSyntaxKind.BreakStatement:
					return { kind: 'break', origin: statement };
				case LuaSyntaxKind.IfStatement: {
					const ifStatement = statement as LuaIfStatement;
					for (const clause of ifStatement.clauses) {
						if (clause.condition === null || this.host.isTruthy(this.host.evaluateSingleExpression(clause.condition, frame.environment, frame.varargs))) {
							const blockEnv = LuaEnvironment.createChild(frame.environment);
							const blockScope = this.createLabelScope(clause.block.body, frame.scope);
							frame.index += 1;
							this.pushStatementsFrame({
								statements: clause.block.body,
								environment: blockEnv,
								varargs: frame.varargs,
								scope: blockScope,
								boundary: 'block',
								callRange: clause.block.range ?? ifStatement.range,
							});
							return NORMAL_SIGNAL;
						}
					}
					frame.index += 1;
					return NORMAL_SIGNAL;
				}
				case LuaSyntaxKind.WhileStatement: {
					const whileStatement = statement as LuaWhileStatement;
					const loopEnvironment = LuaEnvironment.createChild(frame.environment);
					const loopFrame: WhileFrame = {
						kind: 'while',
						statement: whileStatement,
						environment: loopEnvironment,
						varargs: frame.varargs,
						scope: frame.scope,
						loopEnvironment,
					};
					frame.index += 1;
					this.pushFrame(loopFrame);
					return NORMAL_SIGNAL;
				}
				case LuaSyntaxKind.RepeatStatement: {
					const repeatStatement = statement as LuaRepeatStatement;
					const repeatFrame: RepeatFrame = {
						kind: 'repeat',
						statement: repeatStatement,
						baseEnvironment: frame.environment,
						environment: frame.environment,
						varargs: frame.varargs,
						scope: frame.scope,
						iterationEnvironment: null,
						state: 'body',
					};
					frame.index += 1;
					this.pushFrame(repeatFrame);
					return NORMAL_SIGNAL;
				}
				case LuaSyntaxKind.ForNumericStatement: {
					const numeric = statement as LuaForNumericStatement;
					const startValue = this.host.expectNumber(this.host.evaluateSingleExpression(numeric.start, frame.environment, frame.varargs), 'Numeric for loop start must be a number.', numeric.start.range);
					const limitValue = this.host.expectNumber(this.host.evaluateSingleExpression(numeric.limit, frame.environment, frame.varargs), 'Numeric for loop limit must be a number.', numeric.limit.range);
					let stepValue = 1;
					if (numeric.step) {
						stepValue = this.host.expectNumber(this.host.evaluateSingleExpression(numeric.step, frame.environment, frame.varargs), 'Numeric for loop step must be a number.', numeric.step.range);
					}
					const loopEnvironment = LuaEnvironment.createChild(frame.environment);
					loopEnvironment.set(numeric.variable.name, startValue, numeric.variable.range);
					const loopFrame: NumericForFrame = {
						kind: 'numeric-for',
						statement: numeric,
						environment: loopEnvironment,
						varargs: frame.varargs,
						scope: frame.scope,
						loopEnvironment,
						current: startValue,
						limit: limitValue,
						step: stepValue,
						ascending: stepValue >= 0,
						state: 'check',
					};
					frame.index += 1;
					this.pushFrame(loopFrame);
					return NORMAL_SIGNAL;
				}
				case LuaSyntaxKind.ForGenericStatement: {
					const generic = statement as LuaForGenericStatement;
					const iteratorValues = this.host.evaluateExpressionList(generic.iterators, frame.environment, frame.varargs);
					if (iteratorValues.length === 0) {
						throw this.host.runtimeErrorAt(generic.range, 'Generic for loop requires an iterator function.');
					}
					const iteratorFunction = this.host.expectFunction(iteratorValues[0], 'Generic for loop requires an iterator function.', generic.range);
					const stateValue = iteratorValues.length > 1 ? iteratorValues[1] : null;
					const initialControl = iteratorValues.length > 2 ? iteratorValues[2] : null;
					const loopEnvironment = LuaEnvironment.createChild(frame.environment);
					for (const variable of generic.variables) {
						loopEnvironment.set(variable.name, null, variable.range);
					}
					const loopFrame: GenericForFrame = {
						kind: 'generic-for',
						statement: generic,
						environment: loopEnvironment,
						varargs: frame.varargs,
						scope: frame.scope,
						loopEnvironment,
						iteratorFunction,
						stateValue,
						control: initialControl,
						pendingResults: null,
						state: 'call',
					};
					frame.index += 1;
					this.pushFrame(loopFrame);
					return NORMAL_SIGNAL;
				}
				case LuaSyntaxKind.DoStatement: {
					const doStatement = statement as LuaDoStatement;
					const blockEnvironment = LuaEnvironment.createChild(frame.environment);
					const blockScope = this.createLabelScope(doStatement.block.body, frame.scope);
					frame.index += 1;
					this.pushStatementsFrame({
						statements: doStatement.block.body,
						environment: blockEnvironment,
						varargs: frame.varargs,
						scope: blockScope,
						boundary: 'block',
						callRange: doStatement.range,
					});
					return NORMAL_SIGNAL;
				}
				case LuaSyntaxKind.GotoStatement:
					return { kind: 'goto', label: (statement as LuaGotoStatement).label, origin: statement };
				case LuaSyntaxKind.CallStatement:
					this.host.evaluateCallExpression((statement as LuaCallStatement).expression, frame.environment, frame.varargs);
					frame.index += 1;
					return NORMAL_SIGNAL;
				default:
					throw this.host.runtimeError('Unsupported statement kind.');
			}
		} catch (error) {
			if (isLuaDebuggerPauseSignal(error)) {
				throw error;
			}
			clearActiveStatement = false;
			throw error;
		} finally {
			this.lastStatementRange = this.activeStatementRange ?? this.lastStatementRange;
			if (clearActiveStatement) {
				this.activeStatementRange = null;
				this.activeStatementFrame = null;
			}
		}
	}

	private stepWhileFrame(frame: WhileFrame): ExecutionSignal {
		const condition = this.host.evaluateSingleExpression(frame.statement.condition, frame.loopEnvironment, frame.varargs);
		if (!this.host.isTruthy(condition)) {
			this.popFrame();
			return NORMAL_SIGNAL;
		}
		const blockScope = this.createLabelScope(frame.statement.block.body, frame.scope);
		this.pushStatementsFrame({
			statements: frame.statement.block.body,
			environment: frame.loopEnvironment,
			varargs: frame.varargs,
			scope: blockScope,
			boundary: 'block',
			callRange: frame.statement.range,
		});
		return NORMAL_SIGNAL;
	}

	private stepRepeatFrame(frame: RepeatFrame): ExecutionSignal {
		if (frame.state === 'body') {
			const iterationEnvironment = LuaEnvironment.createChild(frame.baseEnvironment);
			frame.iterationEnvironment = iterationEnvironment;
			frame.environment = iterationEnvironment;
			const blockScope = this.createLabelScope(frame.statement.block.body, frame.scope);
			this.pushStatementsFrame({
				statements: frame.statement.block.body,
				environment: iterationEnvironment,
				varargs: frame.varargs,
				scope: blockScope,
				boundary: 'block',
				callRange: frame.statement.range,
			});
			frame.state = 'condition';
			return NORMAL_SIGNAL;
		}
		const condition = this.host.evaluateSingleExpression(frame.statement.condition, frame.iterationEnvironment, frame.varargs);
		if (this.host.isTruthy(condition)) {
			this.popFrame();
			return NORMAL_SIGNAL;
		}
		frame.iterationEnvironment = null;
		frame.environment = frame.baseEnvironment;
		this.envStack[this.envStack.length - 1] = frame.baseEnvironment;
		frame.state = 'body';
		return NORMAL_SIGNAL;
	}

	private stepNumericForFrame(frame: NumericForFrame): ExecutionSignal {
		if (frame.state === 'check') {
			const withinRange = frame.ascending ? frame.current <= frame.limit : frame.current >= frame.limit;
			if (!withinRange) {
				this.popFrame();
				return NORMAL_SIGNAL;
			}
			frame.loopEnvironment.assignExisting(frame.statement.variable.name, frame.current);
			const blockScope = this.createLabelScope(frame.statement.block.body, frame.scope);
			this.pushStatementsFrame({
				statements: frame.statement.block.body,
				environment: frame.loopEnvironment,
				varargs: frame.varargs,
				scope: blockScope,
				boundary: 'block',
				callRange: frame.statement.range,
			});
			frame.state = 'body';
			return NORMAL_SIGNAL;
		}
		frame.current = frame.current + frame.step;
		frame.state = 'check';
		return NORMAL_SIGNAL;
	}

	private stepGenericForFrame(frame: GenericForFrame): ExecutionSignal {
		if (frame.state === 'call') {
			const callArgs = this.host.allocateValueList();
			callArgs.push(frame.stateValue);
			callArgs.push(frame.control);
			const results = frame.iteratorFunction.call(callArgs);
			if (results.length === 0 || results[0] === null || results[0] === false) {
				this.popFrame();
				return NORMAL_SIGNAL;
			}
			frame.control = results[0];
			frame.pendingResults = results;
			this.host.assignGenericLoopVariables(frame.statement, frame.loopEnvironment, results);
			const blockScope = this.createLabelScope(frame.statement.block.body, frame.scope);
			this.pushStatementsFrame({
				statements: frame.statement.block.body,
				environment: frame.loopEnvironment,
				varargs: frame.varargs,
				scope: blockScope,
				boundary: 'block',
				callRange: frame.statement.range,
			});
			frame.state = 'body';
			return NORMAL_SIGNAL;
		}
		frame.pendingResults = null;
		frame.state = 'call';
		return NORMAL_SIGNAL;
	}

	private resolveLabel(scope: LabelScope, label: string): LabelMetadata {
		let current: LabelScope = scope;
		while (current !== null) {
			const metadata = current.labels.get(label);
			if (metadata !== undefined) {
				return metadata;
			}
			current = current.parent;
		}
		return null;
	}

	private buildLabelMap(statements: ReadonlyArray<LuaStatement>): Map<string, LabelMetadata> {
		const labels = new Map<string, LabelMetadata>();
		for (let index = 0; index < statements.length; index += 1) {
			const statement = statements[index];
			if (statement.kind === LuaSyntaxKind.LabelStatement) {
				const labelStatement = statement as LuaLabelStatement;
				if (labels.has(labelStatement.label)) {
					throw this.host.runtimeErrorAt(labelStatement.range, `Duplicate label '${labelStatement.label}'.`);
				}
				labels.set(labelStatement.label, { index, statement: labelStatement });
			}
		}
		return labels;
	}
}
