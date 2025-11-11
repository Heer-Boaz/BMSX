import {
	LuaSyntaxKind,
	LuaBinaryOperator,
	LuaUnaryOperator,
	LuaTableFieldKind,
	LuaAssignmentOperator,
} from './ast.ts';
import type {
	LuaAssignableExpression,
	LuaAssignmentStatement,
	LuaBlock,
	LuaBooleanLiteralExpression,
	LuaBinaryExpression,
	LuaCallExpression,
	LuaCallStatement,
	LuaChunk,
	LuaDoStatement,
	LuaExpression,
	LuaForGenericStatement,
	LuaForNumericStatement,
	LuaFunctionDeclarationStatement,
	LuaFunctionExpression,
	LuaIdentifierExpression,
	LuaIfStatement,
	LuaIndexExpression,
	LuaLabelStatement,
	LuaLocalAssignmentStatement,
	LuaLocalFunctionStatement,
	LuaGotoStatement,
	LuaMemberExpression,
	LuaNilLiteralExpression,
	LuaNumericLiteralExpression,
	LuaBreakStatement,
	LuaRepeatStatement,
	LuaReturnStatement,
	LuaStatement,
	LuaStringLiteralExpression,
	LuaTableArrayField,
	LuaTableConstructorExpression,
	LuaTableExpressionField,
	LuaTableIdentifierField,
	LuaUnaryExpression,
	LuaVarargExpression,
	LuaWhileStatement,
	LuaSourceRange,
	LuaDefinitionInfo,
} from './ast.ts';
import { LuaEnvironment } from './environment.ts';
import { LuaRuntimeError, LuaSyntaxError } from './errors.ts';
import { LuaLexer } from './lexer.ts';
import { LuaParser } from './parser.ts';
import type { LuaFunctionValue, LuaValue, LuaTable, LuaNativeValue } from './value.ts';
import { createLuaNativeValue, createLuaTable, isLuaTable, isLuaNativeValue } from './value.ts';
import { LuaDebuggerController, type LuaDebuggerPauseReason } from './debugger.ts';

export type LuaCallFrame = {
	readonly functionName: string | null;
	readonly source: string;
	readonly line: number;
	readonly column: number;
};

export type ExecutionSignal =
	| { readonly kind: 'normal' }
	| { readonly kind: 'return'; readonly values: ReadonlyArray<LuaValue> }
	| { readonly kind: 'break'; readonly origin: LuaStatement }
	| { readonly kind: 'goto'; readonly label: string; readonly origin: LuaGotoStatement }
	| {
			readonly kind: 'pause';
			readonly reason: LuaDebuggerPauseReason;
			readonly location: { chunk: string; line: number; column: number };
			readonly callStack: ReadonlyArray<LuaCallFrame>;
			readonly resume: () => ExecutionSignal;
	  };

const NORMAL_SIGNAL: ExecutionSignal = { kind: 'normal' };

type DebuggerPauseContext = {
	readonly controller: LuaDebuggerController;
	readonly chunk: string;
	readonly line: number;
	readonly column: number;
	readonly depth: number;
	readonly reason: LuaDebuggerPauseReason;
};

export interface LuaHostAdapter {
	toLua(value: unknown, interpreter: LuaInterpreter): LuaValue;
	toJs(value: LuaValue, interpreter: LuaInterpreter): unknown;
	serializeNative?(native: object | Function): unknown;
	deserializeNative?(token: unknown): object | Function | null;
}

class LuaNativeFunction implements LuaFunctionValue {
	public readonly name: string;
	private readonly interpreter: LuaInterpreter;
	private readonly handler: (interpreter: LuaInterpreter, args: ReadonlyArray<LuaValue>) => ReadonlyArray<LuaValue>;

	constructor(name: string, interpreter: LuaInterpreter, handler: (interpreter: LuaInterpreter, args: ReadonlyArray<LuaValue>) => ReadonlyArray<LuaValue>) {
		this.name = name;
		this.interpreter = interpreter;
		this.handler = handler;
	}

	public call(args: ReadonlyArray<LuaValue>): LuaValue[] {
		try {
			const result = this.handler(this.interpreter, args);
			return Array.from(result);
		} catch (error) {
			if (isLuaDebuggerPauseSignal(error)) {
				throw error;
			}
			this.interpreter.captureActiveCallStackForFault();
			throw error;
		}
	}
}

class LuaScriptFunction implements LuaFunctionValue {
	public readonly name: string;
	public readonly range: LuaSourceRange;
	private readonly interpreter: LuaInterpreter;
	private readonly expression: LuaFunctionExpression;
	private readonly closure: LuaEnvironment;
	private readonly implicitSelfName: string | null;

	constructor(name: string, interpreter: LuaInterpreter, expression: LuaFunctionExpression, closure: LuaEnvironment, implicitSelfName: string | null) {
		this.name = name;
		this.interpreter = interpreter;
		this.expression = expression;
		this.closure = closure;
		this.implicitSelfName = implicitSelfName;
		this.range = expression.range;
	}

	public call(args: ReadonlyArray<LuaValue>): LuaValue[] {
		return this.interpreter.invokeScriptFunction(this.expression, this.closure, this.name, args, this.implicitSelfName);
	}

	public getSourceRange(): LuaSourceRange {
		return this.range;
	}
}

type ResolvedAssignmentTarget =
	| { readonly kind: 'identifier'; readonly name: string; readonly environment: LuaEnvironment | null }
	| { readonly kind: 'member'; readonly table: LuaTable; readonly key: string }
	| { readonly kind: 'index'; readonly table: LuaTable; readonly index: LuaValue }
	| { readonly kind: 'native-member'; readonly target: LuaNativeValue; readonly key: string }
	| { readonly kind: 'native-index'; readonly target: LuaNativeValue; readonly key: LuaValue };

type LabelMetadata = {
	readonly index: number;
	readonly statement: LuaLabelStatement;
};

type LabelScope = {
	readonly labels: Map<string, LabelMetadata>;
	readonly parent: LabelScope | null;
};

export class LuaInterpreter {
	private readonly globals: LuaEnvironment;
	private currentChunk: string;
	private randomSeedValue: number;
	private reservedIdentifiers: Set<string> = new Set<string>();
	private currentCallRange: LuaSourceRange | null = null;
	private chunkEnvironment: LuaEnvironment | null = null;
	private readonly chunkDefinitions: Map<string, ReadonlyArray<LuaDefinitionInfo>> = new Map();
	private readonly envStack: LuaEnvironment[] = [];
	private lastFaultEnvironment: LuaEnvironment | null = null;
	private readonly callStack: LuaCallFrame[] = [];
	private debuggerController: LuaDebuggerController | null = null;
    private lastFaultCallStack: LuaCallFrame[] = [];
    private lastFaultDepth: number = 0;
	private hostAdapter: LuaHostAdapter | null = null;
	private caseInsensitiveNativeAccess = true;
	private nativeValueCache: WeakMap<object | Function, LuaNativeValue> = new WeakMap();
	private readonly nativeMethodCache: WeakMap<LuaNativeValue, Map<string, LuaFunctionValue>> = new WeakMap<
		LuaNativeValue,
		Map<string, LuaFunctionValue>
	>();
	private readonly packageTable: LuaTable;
	private readonly packageLoaded: LuaTable;
	private requireHandler: ((interpreter: LuaInterpreter, moduleName: string) => LuaValue) | null = null;

	 constructor(globals: LuaEnvironment | null) {
	 	 if (globals === null) {
	 	 	 this.globals = LuaEnvironment.createRoot();
	 	 }
	 	 else {
	 	 	 this.globals = globals;
	 	 }
	 	 this.currentChunk = '<chunk>';
	 	 this.randomSeedValue = Date.now();
	 	 this.packageTable = createLuaTable();
	 	 this.packageLoaded = createLuaTable();
	 	 this.initializeBuiltins();
	 }

	public execute(source: string, chunkName: string): LuaValue[] {
		const lexer = new LuaLexer(source, chunkName);
		const tokens = lexer.scanTokens();
		const parser = new LuaParser(tokens, chunkName, source);
		const chunk = parser.parseChunk();
		this.validateReservedIdentifiers(chunk.body);
		this.chunkDefinitions.set(this.normalizeChunkName(chunk.range.chunkName), chunk.definitions);
		return this.executeChunk(chunk);
	}

	public setReservedIdentifiers(names: Iterable<string>): void {
		this.reservedIdentifiers = new Set<string>();
		for (const name of names) {
			if (typeof name === 'string' && name.length > 0) {
				this.reservedIdentifiers.add(name);
			}
		}
	}

	public setHostAdapter(adapter: LuaHostAdapter | null): void {
		this.hostAdapter = adapter;
	}

	public setCaseInsensitiveNativeAccess(enabled: boolean): void {
		this.caseInsensitiveNativeAccess = enabled;
	}

	public setRequireHandler(handler: ((interpreter: LuaInterpreter, moduleName: string) => LuaValue) | null): void {
		this.requireHandler = handler;
	}

	public attachDebugger(controller: LuaDebuggerController | null): void {
		this.debuggerController = controller;
	}

	public getPackageLoadedTable(): LuaTable {
		return this.packageLoaded;
	}

	private invokeRequireBuiltin(args: ReadonlyArray<LuaValue>): LuaValue[] {
		if (args.length === 0) {
			throw this.runtimeError('require(moduleName) expects a module name.');
		}
		const moduleArg = args[0];
		if (moduleArg === null || typeof moduleArg !== 'string') {
			throw this.runtimeError('require(moduleName) expects a string module name.');
		}
		const moduleName = moduleArg.trim();
		if (moduleName.length === 0) {
			throw this.runtimeError('require(moduleName) expects a non-empty module name.');
		}
		if (!this.requireHandler) {
			throw this.runtimeError('require is not enabled in this interpreter.');
		}
		const value = this.requireHandler(this, moduleName);
		return [value];
	}

	public getOrCreateNativeValue(value: object | Function, typeName?: string): LuaNativeValue {
		let cached = this.nativeValueCache.get(value);
		if (cached) {
			return cached;
		}
		const nativeValue = createLuaNativeValue(value, typeName);
		this.nativeValueCache.set(value, nativeValue);
		return nativeValue;
	}

	public getHostAdapter(): LuaHostAdapter | null {
		return this.hostAdapter;
	}

	public parseChunk(source: string, chunkName: string): LuaChunk {
		const lexer = new LuaLexer(source, chunkName);
		const tokens = lexer.scanTokens();
		const parser = new LuaParser(tokens, chunkName, source);
		return parser.parseChunk();
	}

	public validateChunkIdentifiers(chunk: LuaChunk): void {
		this.validateReservedIdentifiers(chunk.body);
	}

	public getGlobalEnvironment(): LuaEnvironment {
		return this.globals;
	}

	public enumerateGlobalEntries(): ReadonlyArray<[string, LuaValue]> {
		return this.globals.entries();
	}

	public setGlobal(name: string, value: LuaValue, range?: LuaSourceRange | null): void {
		this.globals.set(name, value, range);
	}

	public getRandomSeed(): number {
		return this.randomSeedValue;
	}

	public setRandomSeed(seed: number): void {
		if (Number.isFinite(seed)) {
			this.randomSeedValue = seed;
		}
	}

	protected executeChunk(chunk: LuaChunk): LuaValue[] {
		this.currentChunk = chunk.range.chunkName;
		const chunkScope = LuaEnvironment.createChild(this.globals);
		this.chunkEnvironment = chunkScope;
		return this.withEnv(chunkScope, () => {
			this.lastFaultCallStack = [];
			this.pushCallFrame('<chunk>', chunk.range.chunkName, chunk.range.start.line, chunk.range.start.column);
			try {
				const signal = this.executeStatements(chunk.body, chunkScope, [], null);
				if (signal.kind === 'return') {
					return Array.from(signal.values);
				}
				if (signal.kind === 'break') {
					const breakStatement = signal.origin as LuaBreakStatement;
					throw this.runtimeErrorAt(breakStatement.range, 'Unexpected break outside of loop.');
				}
				if (signal.kind === 'goto') {
					throw this.runtimeErrorAt(signal.origin.range, `Label '${signal.label}' not found.`);
				}
				if (signal.kind === 'pause') {
					throw signal;
				}
				return [];
			} catch (error) {
				if (!isLuaDebuggerPauseSignal(error)) {
					this.recordFaultCallStack();
				}
				throw error;
			} finally {
				this.callStack.pop();
			}
		});
	}

	public enumerateChunkEntries(): ReadonlyArray<[string, LuaValue]> {
		if (!this.chunkEnvironment) {
			return [];
		}
		return this.chunkEnvironment.entries();
	}

	public getChunkEnvironment(): LuaEnvironment | null {
		return this.chunkEnvironment;
	}

	public getChunkDefinitions(chunkName: string): ReadonlyArray<LuaDefinitionInfo> | null {
		const normalized = this.normalizeChunkName(chunkName);
		return this.chunkDefinitions.get(normalized) ?? null;
	}

	public hasChunkBinding(name: string): boolean {
		if (!this.chunkEnvironment) {
			return false;
		}
		return this.chunkEnvironment.resolve(name) !== null;
	}

	public assignChunkValue(name: string, value: LuaValue): void {
		if (!this.chunkEnvironment) {
			throw this.runtimeError('Chunk environment not initialised.');
		}
		const target = this.chunkEnvironment.resolve(name);
		if (target === null) {
			throw this.runtimeError(`Chunk variable '${name}' is not defined.`);
		}
		target.assignExisting(name, value);
	}

	private normalizeChunkName(name: string): string {
		let normalized = name.trim();
		if (normalized.startsWith('@')) {
			normalized = normalized.slice(1);
		}
		return normalized.replace(/\\/g, '/');
	}

	private withEnv<T>(environment: LuaEnvironment, callback: () => T): T {
		this.envStack.push(environment);
		try {
			return callback();
		}
		finally {
			this.envStack.pop();
		}
	}

	public getLastFaultEnvironment(): LuaEnvironment | null {
		return this.lastFaultEnvironment;
	}

	public clearLastFaultEnvironment(): void {
		this.lastFaultEnvironment = null;
	}

	public markFaultEnvironment(): void {
		this.lastFaultEnvironment = this.envStack.length > 0 ? this.envStack[this.envStack.length - 1] : null;
		this.recordFaultCallStack();
	}

    public getLastFaultCallStack(): ReadonlyArray<LuaCallFrame> {
        return this.lastFaultCallStack;
    }

    public clearLastFaultCallStack(): void {
        this.lastFaultCallStack = [];
        this.lastFaultDepth = 0;
    }

	public captureActiveCallStackForFault(): void {
		this.recordFaultCallStack();
	}

	private pushCallFrame(functionName: string | null, source: string, line: number, column: number): void {
		const safeLine = Number.isFinite(line) ? Math.max(0, Math.floor(line)) : 0;
		const safeColumn = Number.isFinite(column) ? Math.max(0, Math.floor(column)) : 0;
		this.callStack.push({
			functionName,
			source,
			line: safeLine,
			column: safeColumn,
		});
	}

	private recordFaultCallStack(): void {
        const depth = this.callStack.length;
        if (depth === 0) {
            this.lastFaultCallStack = [];
            this.lastFaultDepth = 0;
            return;
        }
        // Preserve the most-detailed stack captured in this fault path
        if (this.lastFaultCallStack.length > 0 && depth < this.lastFaultDepth) {
            return;
        }
        this.lastFaultCallStack = this.callStack.map(frame => ({
            functionName: frame.functionName,
            source: frame.source,
            line: frame.line,
            column: frame.column,
        }));
        this.lastFaultDepth = depth;
    }

	private cloneCallStack(): LuaCallFrame[] {
		return this.callStack.map(frame => ({
			functionName: frame.functionName,
			source: frame.source,
			line: frame.line,
			column: frame.column,
		}));
	}

	private withInterpreterSnapshot<T>(
		envSnapshot: ReadonlyArray<LuaEnvironment>,
		callStackSnapshot: ReadonlyArray<LuaCallFrame>,
		callRange: LuaSourceRange | null,
		currentChunk: string,
		chunkEnvironment: LuaEnvironment | null,
		callback: () => T,
	): T {
		const envBackup = this.envStack.slice();
		const callStackBackup = this.callStack.slice();
		const previousCallRange = this.currentCallRange;
		const previousChunk = this.currentChunk;
		const previousChunkEnvironment = this.chunkEnvironment;
		this.envStack.length = 0;
		for (const env of envSnapshot) {
			this.envStack.push(env);
		}
		this.callStack.length = 0;
		for (const frame of callStackSnapshot) {
			this.callStack.push({
				functionName: frame.functionName,
				source: frame.source,
				line: frame.line,
				column: frame.column,
			});
		}
		this.currentCallRange = callRange;
		this.currentChunk = currentChunk;
		this.chunkEnvironment = chunkEnvironment;
		try {
			return callback();
		}
		finally {
			this.currentCallRange = previousCallRange;
			this.currentChunk = previousChunk;
			this.chunkEnvironment = previousChunkEnvironment;
			this.envStack.length = 0;
			for (const env of envBackup) {
				this.envStack.push(env);
			}
			this.callStack.length = 0;
			for (const frame of callStackBackup) {
				this.callStack.push(frame);
			}
		}
	}

	private executeStatements(statements: ReadonlyArray<LuaStatement>, environment: LuaEnvironment, varargs: ReadonlyArray<LuaValue>, parentScope: LabelScope | null): ExecutionSignal {
		const labels = this.buildLabelMap(statements);
		const scope: LabelScope = { labels, parent: parentScope };
		return this.runStatements(statements, environment, varargs, scope, 0);
	}

	private runStatements(
		statements: ReadonlyArray<LuaStatement>,
		environment: LuaEnvironment,
		varargs: ReadonlyArray<LuaValue>,
		scope: LabelScope,
		startIndex: number,
	): ExecutionSignal {
		let index = startIndex;
		while (index < statements.length) {
			const statement = statements[index];
			if (statement.kind === LuaSyntaxKind.LabelStatement) {
				index += 1;
				continue;
			}
			const pauseContext = this.getDebuggerPauseContext(statement.range);
			if (pauseContext) {
				const continuation = () => this.runStatements(statements, environment, varargs, scope, index);
				return this.createDebuggerPauseSignal(pauseContext, continuation);
			}
			const signal = this.executeStatement(statement, environment, varargs, scope);
			if (signal.kind === 'normal') {
				index += 1;
				continue;
			}
			if (signal.kind === 'goto') {
				const metadata = scope.labels.get(signal.label);
				if (metadata !== undefined) {
					index = metadata.index;
					continue;
				}
				return signal;
			}
			return signal;
		}
		return NORMAL_SIGNAL;
	}

	private getDebuggerPauseContext(range: LuaSourceRange): DebuggerPauseContext | null {
		const controller = this.debuggerController;
		if (!controller || !controller.isActive()) {
			return null;
		}
		const chunk = this.normalizeChunkName(range.chunkName);
		const line = Number.isFinite(range.start.line) ? range.start.line : 0;
		const column = Number.isFinite(range.start.column) ? range.start.column : 0;
		const depth = this.callStack.length;
		const reason = controller.shouldPause(chunk, line, depth);
		if (!reason) {
			return null;
		}
		return { controller, chunk, line, column, depth, reason };
	}

	private createDebuggerPauseSignal(context: DebuggerPauseContext, continuation: () => ExecutionSignal): ExecutionSignal {
		const envSnapshot = this.envStack.slice();
		const callStackSnapshot = this.cloneCallStack();
		const callRange = this.currentCallRange;
		const currentChunk = this.currentChunk;
		const chunkEnvironment = this.chunkEnvironment;
		return {
			kind: 'pause',
			reason: context.reason,
			location: {
				chunk: context.chunk,
				line: context.line,
				column: context.column,
			},
			callStack: callStackSnapshot,
			resume: () => {
				context.controller.suppressNextAtBoundary(context.chunk, context.line, context.depth);
				return this.withInterpreterSnapshot(envSnapshot, callStackSnapshot, callRange, currentChunk, chunkEnvironment, continuation);
			},
		};
	}

	private executeStatement(statement: LuaStatement, environment: LuaEnvironment, varargs: ReadonlyArray<LuaValue>, scope: LabelScope): ExecutionSignal {
		switch (statement.kind) {
			case LuaSyntaxKind.LocalAssignmentStatement:
				this.executeLocalAssignment(statement as LuaLocalAssignmentStatement, environment, varargs);
				return NORMAL_SIGNAL;
			case LuaSyntaxKind.LocalFunctionStatement:
				this.executeLocalFunction(statement as LuaLocalFunctionStatement, environment);
				return NORMAL_SIGNAL;
			case LuaSyntaxKind.FunctionDeclarationStatement:
				this.executeFunctionDeclaration(statement as LuaFunctionDeclarationStatement, environment);
				return NORMAL_SIGNAL;
			case LuaSyntaxKind.AssignmentStatement:
				this.executeAssignment(statement as LuaAssignmentStatement, environment, varargs);
				return NORMAL_SIGNAL;
			case LuaSyntaxKind.ReturnStatement:
				return this.executeReturn(statement as LuaReturnStatement, environment, varargs);
			case LuaSyntaxKind.BreakStatement:
				return { kind: 'break', origin: statement };
			case LuaSyntaxKind.IfStatement:
				return this.executeIf(statement as LuaIfStatement, environment, varargs, scope);
			case LuaSyntaxKind.WhileStatement:
				return this.executeWhile(statement as LuaWhileStatement, environment, varargs, scope);
			case LuaSyntaxKind.RepeatStatement:
				return this.executeRepeat(statement as LuaRepeatStatement, environment, varargs, scope);
			case LuaSyntaxKind.ForNumericStatement:
				return this.executeForNumeric(statement as LuaForNumericStatement, environment, varargs, scope);
			case LuaSyntaxKind.ForGenericStatement:
				return this.executeForGeneric(statement as LuaForGenericStatement, environment, varargs, scope);
			case LuaSyntaxKind.DoStatement:
				return this.executeDo(statement as LuaDoStatement, environment, varargs, scope);
			case LuaSyntaxKind.CallStatement:
				this.evaluateCallExpression((statement as LuaCallStatement).expression, environment, varargs);
				return NORMAL_SIGNAL;
			case LuaSyntaxKind.GotoStatement:
				return { kind: 'goto', label: (statement as LuaGotoStatement).label, origin: statement as LuaGotoStatement };
			case LuaSyntaxKind.LabelStatement:
				return NORMAL_SIGNAL;
			default:
				throw this.runtimeError('Unsupported statement kind.');
		}
	}

	private executeLocalAssignment(statement: LuaLocalAssignmentStatement, environment: LuaEnvironment, varargs: ReadonlyArray<LuaValue>): void {
	const values = this.evaluateExpressionList(statement.values, environment, varargs);
	for (let index = 0; index < statement.names.length; index += 1) {
		const identifier = statement.names[index];
		const value = index < values.length ? values[index] : null;
		environment.set(identifier.name, value, identifier.range);
	}
}

private executeLocalFunction(statement: LuaLocalFunctionStatement, environment: LuaEnvironment): void {
	const functionValue = this.createScriptFunction(statement.functionExpression, environment, statement.name.name, null);
	environment.set(statement.name.name, functionValue, statement.name.range);
}

	private executeFunctionDeclaration(statement: LuaFunctionDeclarationStatement, environment: LuaEnvironment): void {
		const functionNameParts = statement.name.identifiers;
		if (functionNameParts.length === 0) {
			throw this.runtimeErrorAt(statement.range, 'Function declaration missing name.');
		}
		const functionDisplayName = this.composeFunctionName(statement.name);
		const implicitSelfName = statement.name.methodName !== null ? 'self' : null;
		const functionValue = this.createScriptFunction(statement.functionExpression, environment, functionDisplayName, implicitSelfName);

		if (statement.name.methodName !== null) {
			const methodTable = this.resolveTableFromPath(functionNameParts, environment, functionDisplayName, statement.range);
			methodTable.set(statement.name.methodName, functionValue);
			return;
		}

	if (functionNameParts.length === 1) {
		const resolvedEnv = environment.resolve(functionNameParts[0]);
		if (resolvedEnv !== null) {
			resolvedEnv.set(functionNameParts[0], functionValue, statement.range);
			return;
		}
		this.globals.set(functionNameParts[0], functionValue, statement.range);
		return;
	}

		const containerParts: string[] = [];
		for (let index = 0; index < functionNameParts.length - 1; index += 1) {
			containerParts.push(functionNameParts[index]);
		}
		const containerTable = this.resolveTableFromPath(containerParts, environment, functionDisplayName, statement.range);
		const finalName = functionNameParts[functionNameParts.length - 1];
		containerTable.set(finalName, functionValue);
	}

	private composeFunctionName(name: LuaFunctionDeclarationStatement['name']): string {
		let display = '';
		for (let index = 0; index < name.identifiers.length; index += 1) {
			if (index > 0) {
				display += '.';
			}
			display += name.identifiers[index];
		}
		if (name.methodName !== null) {
			display += `:${name.methodName}`;
		}
		return display;
	}

	private resolveTableFromPath(parts: ReadonlyArray<string>, environment: LuaEnvironment, displayName: string, range: LuaSourceRange): LuaTable {
		if (parts.length === 0) {
			throw this.runtimeErrorAt(range, `Invalid table path for function '${displayName}'.`);
		}
		let currentValue: LuaValue | null = this.lookupIdentifier(parts[0], environment);
		if (!(isLuaTable(currentValue))) {
			throw this.runtimeErrorAt(range, `Expected table for '${parts[0]}' when declaring function '${displayName}'.`);
		}
		let currentTable: LuaTable = currentValue;
		for (let index = 1; index < parts.length; index += 1) {
			const fieldValue = currentTable.get(parts[index]);
			if (!(isLuaTable(fieldValue))) {
				throw this.runtimeErrorAt(range, `Expected table for '${parts[index]}' when declaring function '${displayName}'.`);
			}
			currentTable = fieldValue;
		}
		return currentTable;
	}

	private executeAssignment(statement: LuaAssignmentStatement, environment: LuaEnvironment, varargs: ReadonlyArray<LuaValue>): void {
		const resolvedTargets = statement.left.map((target) => this.resolveAssignmentTarget(target, environment, varargs));
		if (statement.operator === LuaAssignmentOperator.Assign) {
			const values = this.evaluateExpressionList(statement.right, environment, varargs);
			for (let index = 0; index < resolvedTargets.length; index += 1) {
				const resolved = resolvedTargets[index];
				const value = index < values.length ? values[index] : null;
				const targetRange = statement.left[index].range;
				this.assignResolvedTarget(resolved, value, targetRange);
			}
			return;
		}
		if (statement.left.length !== 1) {
			throw this.runtimeErrorAt(statement.range, 'Augmented assignment requires exactly one target.');
		}
		if (statement.right.length !== 1) {
			throw this.runtimeErrorAt(statement.range, 'Augmented assignment requires exactly one expression.');
		}
		const resolvedTarget = resolvedTargets[0];
		const targetExpression = statement.left[0];
		const incrementValue = this.evaluateSingleExpression(statement.right[0], environment, varargs);
		const currentValue = this.getResolvedTargetValue(resolvedTarget, targetExpression.range, environment);
		const resultValue = this.applyAugmentedAssignment(statement.operator, currentValue, incrementValue, targetExpression.range);
		this.assignResolvedTarget(resolvedTarget, resultValue, targetExpression.range);
	}

	private executeReturn(statement: LuaReturnStatement, environment: LuaEnvironment, varargs: ReadonlyArray<LuaValue>): ExecutionSignal {
		if (statement.expressions.length === 0) {
			return { kind: 'return', values: [] };
		}
		const values = this.evaluateExpressionList(statement.expressions, environment, varargs);
		return { kind: 'return', values };
	}

	private executeIf(statement: LuaIfStatement, environment: LuaEnvironment, varargs: ReadonlyArray<LuaValue>, scope: LabelScope): ExecutionSignal {
		for (const clause of statement.clauses) {
			if (clause.condition === null || this.isTruthy(this.evaluateSingleExpression(clause.condition, environment, varargs))) {
				return this.executeBlock(clause.block, environment, varargs, scope);
			}
		}
		return NORMAL_SIGNAL;
	}

	private executeWhile(statement: LuaWhileStatement, environment: LuaEnvironment, varargs: ReadonlyArray<LuaValue>, scope: LabelScope): ExecutionSignal {
		const loopEnvironment = LuaEnvironment.createChild(environment);
		return this.withEnv(loopEnvironment, () => this.runWhileLoop(statement, loopEnvironment, varargs, scope));
	}

	private runWhileLoop(statement: LuaWhileStatement, loopEnvironment: LuaEnvironment, varargs: ReadonlyArray<LuaValue>, scope: LabelScope): ExecutionSignal {
		while (true) {
			if (!this.isTruthy(this.evaluateSingleExpression(statement.condition, loopEnvironment, varargs))) {
				return NORMAL_SIGNAL;
			}
			const pauseContext = this.getDebuggerPauseContext(statement.range);
			if (pauseContext) {
				const continuation = () => this.runWhileLoop(statement, loopEnvironment, varargs, scope);
				return this.createDebuggerPauseSignal(pauseContext, continuation);
			}
			const signal = this.executeBlock(statement.block, loopEnvironment, varargs, scope);
			if (signal.kind === 'return' || signal.kind === 'goto' || signal.kind === 'pause') {
				return signal;
			}
			if (signal.kind === 'break') {
				return NORMAL_SIGNAL;
			}
		}
	}

	private executeRepeat(statement: LuaRepeatStatement, environment: LuaEnvironment, varargs: ReadonlyArray<LuaValue>, scope: LabelScope): ExecutionSignal {
		return this.runRepeatLoop(statement, environment, varargs, scope);
	}

	private runRepeatLoop(statement: LuaRepeatStatement, environment: LuaEnvironment, varargs: ReadonlyArray<LuaValue>, scope: LabelScope): ExecutionSignal {
		while (true) {
			const pauseContext = this.getDebuggerPauseContext(statement.range);
			if (pauseContext) {
				const continuation = () => this.runRepeatLoop(statement, environment, varargs, scope);
				return this.createDebuggerPauseSignal(pauseContext, continuation);
			}
			const iterationEnvironment = LuaEnvironment.createChild(environment);
			const signal = this.withEnv(iterationEnvironment, () => this.executeStatements(statement.block.body, iterationEnvironment, varargs, scope));
			if (signal.kind === 'return' || signal.kind === 'goto' || signal.kind === 'pause') {
				return signal;
			}
			if (signal.kind === 'break') {
				return NORMAL_SIGNAL;
			}
			const condition = this.withEnv(iterationEnvironment, () => this.evaluateSingleExpression(statement.condition, iterationEnvironment, varargs));
			if (this.isTruthy(condition)) {
				return NORMAL_SIGNAL;
			}
		}
	}

	private executeForNumeric(statement: LuaForNumericStatement, environment: LuaEnvironment, varargs: ReadonlyArray<LuaValue>, scope: LabelScope): ExecutionSignal {
		const startValue = this.expectNumber(this.evaluateSingleExpression(statement.start, environment, varargs), 'Numeric for loop start must be a number.', statement.start.range);
		const limitValue = this.expectNumber(this.evaluateSingleExpression(statement.limit, environment, varargs), 'Numeric for loop limit must be a number.', statement.limit.range);
		let stepValue = 1;
		if (statement.step !== null) {
			stepValue = this.expectNumber(this.evaluateSingleExpression(statement.step, environment, varargs), 'Numeric for loop step must be a number.', statement.step.range);
		}
		const loopEnvironment = LuaEnvironment.createChild(environment);
		loopEnvironment.set(statement.variable.name, startValue, statement.variable.range);
		return this.withEnv(loopEnvironment, () => this.runNumericForLoop(statement, loopEnvironment, varargs, scope, startValue, limitValue, stepValue));
	}

	private runNumericForLoop(
		statement: LuaForNumericStatement,
		loopEnvironment: LuaEnvironment,
		varargs: ReadonlyArray<LuaValue>,
		scope: LabelScope,
		current: number,
		limit: number,
		step: number,
	): ExecutionSignal {
		const ascending = step >= 0;
			let cursor = current;
		while (true) {
			const snapshotCursor = cursor;
			const withinRange = (ascending && snapshotCursor <= limit) || (!ascending && snapshotCursor >= limit);
			if (!withinRange) {
				return NORMAL_SIGNAL;
			}
			const pauseContext = this.getDebuggerPauseContext(statement.range);
			if (pauseContext) {
				const continuation = () => this.runNumericForLoop(statement, loopEnvironment, varargs, scope, snapshotCursor, limit, step);
				return this.createDebuggerPauseSignal(pauseContext, continuation);
			}
			loopEnvironment.assignExisting(statement.variable.name, snapshotCursor);
			const signal = this.executeBlock(statement.block, loopEnvironment, varargs, scope);
			if (signal.kind === 'return' || signal.kind === 'goto' || signal.kind === 'pause') {
				return signal;
			}
			if (signal.kind === 'break') {
				return NORMAL_SIGNAL;
			}
			cursor = snapshotCursor + step;
		}
	}

	private executeForGeneric(statement: LuaForGenericStatement, environment: LuaEnvironment, varargs: ReadonlyArray<LuaValue>, scope: LabelScope): ExecutionSignal {
		const iteratorValues = this.evaluateExpressionList(statement.iterators, environment, varargs);
		if (iteratorValues.length === 0) {
			throw this.runtimeErrorAt(statement.range, 'Generic for loop requires an iterator function.');
		}
		const iteratorFunction = this.expectFunction(iteratorValues[0], 'Generic for loop requires an iterator function.', statement.range);
		const state = iteratorValues.length > 1 ? iteratorValues[1] : null;
		const initialControl = iteratorValues.length > 2 ? iteratorValues[2] : null;

		const loopEnvironment = LuaEnvironment.createChild(environment);
		for (const variable of statement.variables) {
			loopEnvironment.set(variable.name, null, variable.range);
		}

		return this.withEnv(loopEnvironment, () => this.runGenericForLoop(statement, loopEnvironment, varargs, scope, iteratorFunction, state, initialControl));
	}

	private runGenericForLoop(
		statement: LuaForGenericStatement,
		loopEnvironment: LuaEnvironment,
		varargs: ReadonlyArray<LuaValue>,
		scope: LabelScope,
		iteratorFunction: LuaFunctionValue,
		state: LuaValue,
		control: LuaValue,
	): ExecutionSignal {
		let controlValue: LuaValue = control;
		while (true) {
			const snapshotControl = controlValue;
			const callArgs: LuaValue[] = [state, snapshotControl];
			const results = iteratorFunction.call(callArgs);
			if (results.length === 0 || results[0] === null || results[0] === false) {
				return NORMAL_SIGNAL;
			}
			controlValue = results[0];
			const pauseContext = this.getDebuggerPauseContext(statement.range);
			if (pauseContext) {
				const resultsSnapshot = Array.from(results);
				const continuation = () => this.resumeGenericForIteration(statement, loopEnvironment, varargs, scope, iteratorFunction, state, controlValue, resultsSnapshot);
				return this.createDebuggerPauseSignal(pauseContext, continuation);
			}
			const iterationOutcome = this.executeGenericLoopIteration(statement, loopEnvironment, varargs, scope, results);
			if (iterationOutcome !== null) {
				return iterationOutcome;
			}
		}
	}

	private assignGenericLoopVariables(statement: LuaForGenericStatement, loopEnvironment: LuaEnvironment, results: ReadonlyArray<LuaValue>): void {
		for (let index = 0; index < statement.variables.length; index += 1) {
			const variable = statement.variables[index];
			const value = index < results.length ? results[index] : null;
			loopEnvironment.assignExisting(variable.name, value);
		}
	}

	private resumeGenericForIteration(
		statement: LuaForGenericStatement,
		loopEnvironment: LuaEnvironment,
		varargs: ReadonlyArray<LuaValue>,
		scope: LabelScope,
		iteratorFunction: LuaFunctionValue,
		state: LuaValue,
		controlValue: LuaValue,
		results: ReadonlyArray<LuaValue>,
	): ExecutionSignal {
		const iterationOutcome = this.executeGenericLoopIteration(statement, loopEnvironment, varargs, scope, results);
		if (iterationOutcome !== null) {
			return iterationOutcome;
		}
		return this.runGenericForLoop(statement, loopEnvironment, varargs, scope, iteratorFunction, state, controlValue);
	}

	private executeGenericLoopIteration(
		statement: LuaForGenericStatement,
		loopEnvironment: LuaEnvironment,
		varargs: ReadonlyArray<LuaValue>,
		scope: LabelScope,
		results: ReadonlyArray<LuaValue>,
	): ExecutionSignal | null {
		this.assignGenericLoopVariables(statement, loopEnvironment, results);
		const signal = this.executeBlock(statement.block, loopEnvironment, varargs, scope);
		if (signal.kind === 'return' || signal.kind === 'goto' || signal.kind === 'pause') {
			return signal;
		}
		if (signal.kind === 'break') {
			return NORMAL_SIGNAL;
		}
		return null;
	}

	private executeDo(statement: LuaDoStatement, environment: LuaEnvironment, varargs: ReadonlyArray<LuaValue>, scope: LabelScope): ExecutionSignal {
		return this.executeBlock(statement.block, environment, varargs, scope);
	}

	private executeBlock(block: LuaBlock, parentEnvironment: LuaEnvironment, varargs: ReadonlyArray<LuaValue>, parentScope: LabelScope): ExecutionSignal {
		const blockEnvironment = LuaEnvironment.createChild(parentEnvironment);
		return this.withEnv(blockEnvironment, () => this.executeStatements(block.body, blockEnvironment, varargs, parentScope));
	}

	private buildLabelMap(statements: ReadonlyArray<LuaStatement>): Map<string, LabelMetadata> {
		const labels = new Map<string, LabelMetadata>();
		for (let index = 0; index < statements.length; index += 1) {
			const statement = statements[index];
			if (statement.kind === LuaSyntaxKind.LabelStatement) {
				const labelStatement = statement as LuaLabelStatement;
				if (labels.has(labelStatement.label)) {
					throw this.runtimeErrorAt(labelStatement.range, `Duplicate label '${labelStatement.label}'.`);
				}
				labels.set(labelStatement.label, { index, statement: labelStatement });
			}
		}
		return labels;
	}

	private evaluateExpressionList(expressions: ReadonlyArray<LuaExpression>, environment: LuaEnvironment, varargs: ReadonlyArray<LuaValue>): LuaValue[] {
		if (expressions.length === 0) {
			return [];
		}
		const results: LuaValue[] = [];
		for (let index = 0; index < expressions.length; index += 1) {
			const expression = expressions[index];
			const values = this.evaluateExpression(expression, environment, varargs);
			if (index === expressions.length - 1) {
				for (const value of values) {
					results.push(value);
				}
			}
			else {
				const value = values.length > 0 ? values[0] : null;
				results.push(value);
			}
		}
		return results;
	}

	private evaluateExpression(expression: LuaExpression, environment: LuaEnvironment, varargs: ReadonlyArray<LuaValue>): LuaValue[] {
		switch (expression.kind) {
			case LuaSyntaxKind.NumericLiteralExpression:
				return [this.evaluateNumericLiteral(expression as LuaNumericLiteralExpression)];
			case LuaSyntaxKind.StringLiteralExpression:
				return [this.evaluateStringLiteral(expression as LuaStringLiteralExpression)];
			case LuaSyntaxKind.BooleanLiteralExpression:
				return [this.evaluateBooleanLiteral(expression as LuaBooleanLiteralExpression)];
			case LuaSyntaxKind.NilLiteralExpression:
				return [this.evaluateNilLiteral(expression as LuaNilLiteralExpression)];
			case LuaSyntaxKind.VarargExpression:
				return this.evaluateVararg(expression as LuaVarargExpression, varargs);
			case LuaSyntaxKind.IdentifierExpression:
				return [this.evaluateIdentifier(expression as LuaIdentifierExpression, environment)];
			case LuaSyntaxKind.FunctionExpression:
				return [this.createScriptFunction(expression as LuaFunctionExpression, environment, '<anonymous>', null)];
			case LuaSyntaxKind.TableConstructorExpression:
				return [this.evaluateTableConstructor(expression as LuaTableConstructorExpression, environment, varargs)];
			case LuaSyntaxKind.BinaryExpression:
				return [this.evaluateBinaryExpression(expression as LuaBinaryExpression, environment, varargs)];
			case LuaSyntaxKind.UnaryExpression:
				return [this.evaluateUnaryExpression(expression as LuaUnaryExpression, environment, varargs)];
			case LuaSyntaxKind.CallExpression:
				return this.evaluateCallExpression(expression as LuaCallExpression, environment, varargs);
			case LuaSyntaxKind.MemberExpression:
				return [this.evaluateMemberExpression(expression as LuaMemberExpression, environment, varargs)];
			case LuaSyntaxKind.IndexExpression:
				return [this.evaluateIndexExpression(expression as LuaIndexExpression, environment, varargs)];
			default:
				throw this.runtimeError('Unsupported expression kind.');
		}
	}

	private evaluateSingleExpression(expression: LuaExpression, environment: LuaEnvironment, varargs: ReadonlyArray<LuaValue>): LuaValue {
		const values = this.evaluateExpression(expression, environment, varargs);
		if (values.length === 0) {
			return null;
		}
		return values[0];
	}

	private evaluateNumericLiteral(expression: LuaNumericLiteralExpression): number {
		return expression.value;
	}

	private evaluateStringLiteral(expression: LuaStringLiteralExpression): string {
		return expression.value;
	}

	private evaluateBooleanLiteral(expression: LuaBooleanLiteralExpression): boolean {
		return expression.value;
	}

	private evaluateNilLiteral(_expression: LuaNilLiteralExpression): LuaValue {
		return null;
	}

	private evaluateVararg(_expression: LuaVarargExpression, varargs: ReadonlyArray<LuaValue>): LuaValue[] {
		return Array.from(varargs);
	}

	private evaluateIdentifier(expression: LuaIdentifierExpression, environment: LuaEnvironment): LuaValue {
		const value = this.lookupIdentifier(expression.name, environment);
		if (value !== null) {
			return value;
		}
		return null;
	}

	private evaluateMemberExpression(expression: LuaMemberExpression, environment: LuaEnvironment, varargs: ReadonlyArray<LuaValue>): LuaValue {
		const baseValue = this.evaluateSingleExpression(expression.base, environment, varargs);
		if (isLuaTable(baseValue)) {
			return this.getTableValueWithMetamethod(baseValue, expression.identifier, expression.range);
		}
		if (isLuaNativeValue(baseValue)) {
			return this.getNativeMemberValue(baseValue, expression.identifier, expression.range);
		}
		throw this.runtimeErrorAt(expression.range, 'Attempted to index field on a non-table value.');
	}

	private evaluateIndexExpression(expression: LuaIndexExpression, environment: LuaEnvironment, varargs: ReadonlyArray<LuaValue>): LuaValue {
		const baseValue = this.evaluateSingleExpression(expression.base, environment, varargs);
		if (isLuaTable(baseValue)) {
			const indexValues = this.evaluateExpression(expression.index, environment, varargs);
			const indexValue = indexValues.length > 0 ? indexValues[0] : null;
			return this.getTableValueWithMetamethod(baseValue, indexValue, expression.range);
		}
		if (isLuaNativeValue(baseValue)) {
			const indexValues = this.evaluateExpression(expression.index, environment, varargs);
			const indexValue = indexValues.length > 0 ? indexValues[0] : null;
			return this.getNativeIndexValue(baseValue, indexValue, expression.range);
		}
		throw this.runtimeErrorAt(expression.range, 'Attempted to index on a non-table value.');
	}

	private evaluateBinaryExpression(expression: LuaBinaryExpression, environment: LuaEnvironment, varargs: ReadonlyArray<LuaValue>): LuaValue {
		switch (expression.operator) {
			case LuaBinaryOperator.Or: {
				const left = this.evaluateSingleExpression(expression.left, environment, varargs);
				if (this.isTruthy(left)) {
					return left;
				}
				return this.evaluateSingleExpression(expression.right, environment, varargs);
			}
			case LuaBinaryOperator.And: {
				const left = this.evaluateSingleExpression(expression.left, environment, varargs);
				if (!this.isTruthy(left)) {
					return left;
				}
				return this.evaluateSingleExpression(expression.right, environment, varargs);
			}
			case LuaBinaryOperator.Equal:
				return this.evaluateEqualityExpression(expression, environment, varargs);
			case LuaBinaryOperator.NotEqual:
				return !this.evaluateEqualityExpression(expression, environment, varargs);
			case LuaBinaryOperator.LessThan:
				return this.evaluateRelationalExpression(expression, environment, varargs, '__lt', (a, b) => a < b, 'Less-than comparison requires numbers, strings, or __lt metamethod.', false);
			case LuaBinaryOperator.LessEqual:
				return this.evaluateRelationalExpression(expression, environment, varargs, '__le', (a, b) => a <= b, 'Less-equal comparison requires numbers, strings, or __le metamethod.', false);
			case LuaBinaryOperator.GreaterThan:
				return this.evaluateRelationalExpression(expression, environment, varargs, '__lt', (a, b) => a > b, 'Greater-than comparison requires numbers, strings, or __lt metamethod.', true);
			case LuaBinaryOperator.GreaterEqual:
				return this.evaluateRelationalExpression(expression, environment, varargs, '__le', (a, b) => a >= b, 'Greater-equal comparison requires numbers, strings, or __le metamethod.', true);
			case LuaBinaryOperator.BitwiseOr:
				return this.evaluateBitwiseExpression(expression, environment, varargs, '__bor', (a, b) => (a | b), 'Bitwise OR operands must be numbers or define __bor metamethod.');
			case LuaBinaryOperator.BitwiseXor:
				return this.evaluateBitwiseExpression(expression, environment, varargs, '__bxor', (a, b) => (a ^ b), 'Bitwise XOR operands must be numbers or define __bxor metamethod.');
			case LuaBinaryOperator.BitwiseAnd:
				return this.evaluateBitwiseExpression(expression, environment, varargs, '__band', (a, b) => (a & b), 'Bitwise AND operands must be numbers or define __band metamethod.');
			case LuaBinaryOperator.ShiftLeft:
				return this.evaluateBitwiseExpression(expression, environment, varargs, '__shl', (a, b) => (a << (b & 31)), 'Shift operands must be numbers or define __shl metamethod.');
			case LuaBinaryOperator.ShiftRight:
				return this.evaluateBitwiseExpression(expression, environment, varargs, '__shr', (a, b) => (a >> (b & 31)), 'Shift operands must be numbers or define __shr metamethod.');
			case LuaBinaryOperator.Concat:
				return this.evaluateConcatenationExpression(expression, environment, varargs);
			case LuaBinaryOperator.Add:
				return this.evaluateArithmeticExpression(expression, environment, varargs, '__add', (a, b) => a + b, 'Addition operands must be numbers or define __add metamethod.');
			case LuaBinaryOperator.Subtract:
				return this.evaluateArithmeticExpression(expression, environment, varargs, '__sub', (a, b) => a - b, 'Subtraction operands must be numbers or define __sub metamethod.');
			case LuaBinaryOperator.Multiply:
				return this.evaluateArithmeticExpression(expression, environment, varargs, '__mul', (a, b) => a * b, 'Multiplication operands must be numbers or define __mul metamethod.');
			case LuaBinaryOperator.Divide:
				return this.evaluateArithmeticExpression(expression, environment, varargs, '__div', (a, b) => a / b, 'Division operands must be numbers or define __div metamethod.');
			case LuaBinaryOperator.FloorDivide:
				return this.evaluateFloorDivision(expression, environment, varargs);
			case LuaBinaryOperator.Modulus:
				return this.evaluateArithmeticExpression(expression, environment, varargs, '__mod', (a, b) => a % b, 'Modulus operands must be numbers or define __mod metamethod.');
			case LuaBinaryOperator.Exponent:
				return this.evaluateArithmeticExpression(expression, environment, varargs, '__pow', (a, b) => Math.pow(a, b), 'Exponent operands must be numbers or define __pow metamethod.');
			default:
				throw this.runtimeErrorAt(expression.range, 'Unsupported binary operator.');
		}
	}

	private evaluateUnaryExpression(expression: LuaUnaryExpression, environment: LuaEnvironment, varargs: ReadonlyArray<LuaValue>): LuaValue {
		const operand = this.evaluateSingleExpression(expression.operand, environment, varargs);
		switch (expression.operator) {
			case LuaUnaryOperator.Negate:
				if (typeof operand === 'number') {
					return -operand;
				}
				{
					const metamethodResult = this.invokeUnaryMetamethod(operand, '__unm', expression.range);
					if (metamethodResult !== null) {
						return metamethodResult;
					}
				}
				throw this.runtimeErrorAt(expression.range, 'Unary minus operand must be a number or define __unm metamethod.');
			case LuaUnaryOperator.Not:
				return !this.isTruthy(operand);
			case LuaUnaryOperator.Length:
				if (typeof operand === 'string') {
					return operand.length;
				}
				if (isLuaTable(operand)) {
					const metamethodResult = this.invokeMetamethod(operand, '__len', [operand]);
					if (metamethodResult !== null) {
						const first = metamethodResult.length > 0 ? metamethodResult[0] : null;
						return this.expectNumber(first, 'Metamethod __len must return a number.', expression.range);
					}
					return operand.numericLength();
				}
				throw this.runtimeErrorAt(expression.range, 'Length operator expects a string or table.');
			case LuaUnaryOperator.BitwiseNot:
				if (typeof operand === 'number') {
					return this.bitwiseNot(operand);
				}
				{
					const metamethodResult = this.invokeUnaryMetamethod(operand, '__bnot', expression.range);
					if (metamethodResult !== null) {
						return metamethodResult;
					}
				}
				throw this.runtimeErrorAt(expression.range, 'Bitwise not operand must be a number or define __bnot metamethod.');
			default:
				throw this.runtimeErrorAt(expression.range, 'Unsupported unary operator.');
		}
	}

	private evaluateCallExpression(expression: LuaCallExpression, environment: LuaEnvironment, varargs: ReadonlyArray<LuaValue>): LuaValue[] {
		const calleeValue = this.evaluateSingleExpression(expression.callee, environment, varargs);
		if (expression.methodName !== null) {
			if (isLuaTable(calleeValue)) {
				const methodValue = this.getTableValueWithMetamethod(calleeValue, expression.methodName, expression.range);
				const functionValue = this.expectFunction(methodValue, `Method '${expression.methodName}' not found on table.`, expression.range);
				const args = this.buildCallArguments(expression, environment, varargs, calleeValue);
				return this.invokeFunction(functionValue, args, expression.range);
			}
			if (isLuaNativeValue(calleeValue)) {
				const methodValue = this.getNativeMemberValue(calleeValue, expression.methodName, expression.range);
				const functionValue = this.expectFunction(methodValue, `Method '${expression.methodName}' not found on native value.`, expression.range);
				const args = this.buildCallArguments(expression, environment, varargs, calleeValue);
				return this.invokeFunction(functionValue, args, expression.range);
			}
			throw this.runtimeErrorAt(expression.range, 'Method call requires a table or native instance.');
		}
		if (isLuaTable(calleeValue) || isLuaNativeValue(calleeValue)) {
			const callMetamethod = this.extractMetamethodFunction(calleeValue, '__call', expression.range);
			if (callMetamethod !== null) {
				const args = this.buildCallArguments(expression, environment, varargs, calleeValue);
				return this.invokeFunction(callMetamethod, args, expression.range);
			}
		}
		const message = this.buildCallErrorMessage(expression.callee, calleeValue);
		const functionValue = this.expectFunction(calleeValue, message, expression.range);
		const args = this.buildCallArguments(expression, environment, varargs, null);
		return this.invokeFunction(functionValue, args, expression.range);
	}

	private buildCallArguments(expression: LuaCallExpression, environment: LuaEnvironment, varargs: ReadonlyArray<LuaValue>, selfValue: LuaValue | null): LuaValue[] {
		const evaluatedArgs = this.evaluateExpressionList(expression.arguments, environment, varargs);
		if (selfValue === null) {
			return evaluatedArgs;
		}
		const args: LuaValue[] = [selfValue];
		for (const value of evaluatedArgs) {
			args.push(value);
		}
		return args;
	}

	private evaluateTableConstructor(expression: LuaTableConstructorExpression, environment: LuaEnvironment, varargs: ReadonlyArray<LuaValue>): LuaTable {
		const table = createLuaTable();
		let arrayIndex = 1;
		for (const field of expression.fields) {
			if (field.kind === LuaTableFieldKind.Array) {
				const arrayField = field as LuaTableArrayField;
				const values = this.evaluateExpression(arrayField.value, environment, varargs);
				if (values.length === 0) {
					table.set(arrayIndex, null);
					arrayIndex += 1;
				}
				else {
					for (const value of values) {
						table.set(arrayIndex, value);
						arrayIndex += 1;
					}
				}
			}
			else if (field.kind === LuaTableFieldKind.IdentifierKey) {
				const identifierField = field as LuaTableIdentifierField;
				const value = this.evaluateSingleExpression(identifierField.value, environment, varargs);
				table.set(identifierField.name, value);
			}
			else if (field.kind === LuaTableFieldKind.ExpressionKey) {
				const expressionField = field as LuaTableExpressionField;
				const keyValues = this.evaluateExpression(expressionField.key, environment, varargs);
				const keyValue = keyValues.length > 0 ? keyValues[0] : null;
				const value = this.evaluateSingleExpression(expressionField.value, environment, varargs);
				table.set(keyValue, value);
			}
			else {
				throw this.runtimeError('Unknown table field kind.');
			}
		}
		return table;
	}

	private resolveAssignmentTarget(target: LuaAssignableExpression, environment: LuaEnvironment, varargs: ReadonlyArray<LuaValue>): ResolvedAssignmentTarget {
		if (target.kind === LuaSyntaxKind.IdentifierExpression) {
			const identifier = target as LuaIdentifierExpression;
			const resolvedEnvironment = environment.resolve(identifier.name);
			return {
				kind: 'identifier',
				name: identifier.name,
				environment: resolvedEnvironment,
			};
		}
		if (target.kind === LuaSyntaxKind.MemberExpression) {
			const member = target as LuaMemberExpression;
			const baseValue = this.evaluateSingleExpression(member.base, environment, varargs);
			if (isLuaTable(baseValue)) {
				return {
					kind: 'member',
					table: baseValue,
					key: member.identifier,
				};
			}
			if (isLuaNativeValue(baseValue)) {
				return {
					kind: 'native-member',
					target: baseValue,
					key: member.identifier,
				};
			}
			throw this.runtimeErrorAt(member.base.range, 'Attempted to assign to a member of an unsupported value.');
		}
		if (target.kind === LuaSyntaxKind.IndexExpression) {
			const indexExpression = target as LuaIndexExpression;
			const baseValue = this.evaluateSingleExpression(indexExpression.base, environment, varargs);
			const indexValues = this.evaluateExpression(indexExpression.index, environment, varargs);
			const indexValue = indexValues.length > 0 ? indexValues[0] : null;
			if (isLuaTable(baseValue)) {
				return {
					kind: 'index',
					table: baseValue,
					index: indexValue,
				};
			}
			if (isLuaNativeValue(baseValue)) {
				return {
					kind: 'native-index',
					target: baseValue,
					key: indexValue,
				};
			}
			throw this.runtimeErrorAt(indexExpression.base.range, 'Attempted to assign to an index of an unsupported value.');
		}
		throw this.runtimeError('Unsupported assignment target.');
	}

	private assignResolvedTarget(target: ResolvedAssignmentTarget, value: LuaValue, range: LuaSourceRange): void {
	if (target.kind === 'identifier') {
		if (target.environment !== null) {
			target.environment.set(target.name, value, range);
		}
		else {
			this.globals.set(target.name, value, range);
		}
		return;
	}
		if (target.kind === 'member') {
			this.setTableValueWithMetamethod(target.table, target.key, value, range);
			return;
		}
		if (target.kind === 'index') {
			this.setTableValueWithMetamethod(target.table, target.index, value, range);
			return;
		}
		if (target.kind === 'native-member') {
			this.setNativeMember(target.target, target.key, value, range);
			return;
		}
		if (target.kind === 'native-index') {
			this.setNativeIndex(target.target, target.key, value, range);
			return;
		}
		throw this.runtimeError('Unsupported assignment target kind.');
	}

	private getResolvedTargetValue(target: ResolvedAssignmentTarget, range: LuaSourceRange, environment: LuaEnvironment): LuaValue {
		if (target.kind === 'identifier') {
			const value = this.lookupIdentifier(target.name, environment);
			return value;
		}
		if (target.kind === 'member') {
			return this.getTableValueWithMetamethod(target.table, target.key, range);
		}
		if (target.kind === 'index') {
			return this.getTableValueWithMetamethod(target.table, target.index, range);
		}
		if (target.kind === 'native-member') {
			return this.getNativeMemberValue(target.target, target.key, range);
		}
		if (target.kind === 'native-index') {
			return this.getNativeIndexValue(target.target, target.key, range);
		}
		throw this.runtimeError('Unsupported assignment target kind.');
	}

	private getTableValueWithMetamethod(table: LuaTable, key: LuaValue, range: LuaSourceRange): LuaValue {
		return this.getTableValueWithMetamethodInternal(table, key, range, new Set<LuaTable>());
	}

	private getTableValueWithMetamethodInternal(table: LuaTable, key: LuaValue, range: LuaSourceRange, visited: Set<LuaTable>): LuaValue {
		if (visited.has(table)) {
			throw this.runtimeErrorAt(range, 'Metatable __index loop detected.');
		}
		visited.add(table);
		const direct = table.get(key);
		if (direct !== null) {
			visited.delete(table);
			return direct;
		}
		const metatable = table.getMetatable();
		if (metatable === null) {
			visited.delete(table);
			return null;
		}
		const handler = metatable.get('__index');
		if (handler === null) {
			visited.delete(table);
			return null;
		}
		if (isLuaTable(handler)) {
			const result = this.getTableValueWithMetamethodInternal(handler, key, range, visited);
			visited.delete(table);
			return result;
		}
		const functionValue = this.expectFunction(handler, '__index metamethod must be a function or table.', range);
		const values = functionValue.call([table, key]);
		const first = values.length > 0 ? values[0] : null;
		visited.delete(table);
		return first;
	}

	private setTableValueWithMetamethod(table: LuaTable, key: LuaValue, value: LuaValue, range: LuaSourceRange): void {
		this.setTableValueWithMetamethodInternal(table, key, value, range, new Set<LuaTable>());
	}

	private setTableValueWithMetamethodInternal(table: LuaTable, key: LuaValue, value: LuaValue, range: LuaSourceRange, visited: Set<LuaTable>): void {
		if (table.has(key)) {
			table.set(key, value);
			return;
		}
		const metatable = table.getMetatable();
		if (metatable === null) {
			table.set(key, value);
			return;
		}
		if (visited.has(table)) {
			throw this.runtimeErrorAt(range, 'Metatable __newindex loop detected.');
		}
		visited.add(table);
		const handler = metatable.get('__newindex');
		if (handler === null) {
			table.set(key, value);
			visited.delete(table);
			return;
		}
		if (isLuaTable(handler)) {
			this.setTableValueWithMetamethodInternal(handler, key, value, range, visited);
			visited.delete(table);
			return;
		}
		const functionValue = this.expectFunction(handler, '__newindex metamethod must be a function or table.', range);
		functionValue.call([table, key, value]);
		visited.delete(table);
	}

	private applyAugmentedAssignment(operator: LuaAssignmentOperator, current: LuaValue, operand: LuaValue, range: LuaSourceRange): LuaValue {
		switch (operator) {
			case LuaAssignmentOperator.AddAssign:
				return this.applyAugmentedArithmetic(current, operand, '__add', 'Addition assignment requires numeric operands or __add metamethod.', range, (a, b) => a + b);
			case LuaAssignmentOperator.SubtractAssign:
				return this.applyAugmentedArithmetic(current, operand, '__sub', 'Subtraction assignment requires numeric operands or __sub metamethod.', range, (a, b) => a - b);
			case LuaAssignmentOperator.MultiplyAssign:
				return this.applyAugmentedArithmetic(current, operand, '__mul', 'Multiplication assignment requires numeric operands or __mul metamethod.', range, (a, b) => a * b);
			case LuaAssignmentOperator.DivideAssign:
				return this.applyAugmentedArithmetic(current, operand, '__div', 'Division assignment requires numeric operands or __div metamethod.', range, (a, b) => a / b);
			case LuaAssignmentOperator.ModulusAssign:
				return this.applyAugmentedArithmetic(current, operand, '__mod', 'Modulo assignment requires numeric operands or __mod metamethod.', range, (a, b) => a % b);
			case LuaAssignmentOperator.ExponentAssign:
				return this.applyAugmentedArithmetic(current, operand, '__pow', 'Exponent assignment requires numeric operands or __pow metamethod.', range, (a, b) => Math.pow(a, b));
			default:
				throw this.runtimeErrorAt(range, 'Unsupported augmented assignment operator.');
		}
	}

	private applyAugmentedArithmetic(
		current: LuaValue,
		operand: LuaValue,
		metamethodName: string,
		message: string,
		range: LuaSourceRange,
		operation: (left: number, right: number) => number
	): LuaValue {
		if (typeof current === 'number' && typeof operand === 'number') {
			return operation(current, operand);
		}
		const metamethodResult = this.invokeBinaryMetamethod(current, operand, metamethodName, range);
		if (metamethodResult !== null) {
			return metamethodResult;
		}
		throw this.runtimeErrorAt(range, message);
	}

	private bitwiseNot(value: number): number {
		return ~this.coerceToBitwiseInteger(value);
	}

	private coerceToBitwiseInteger(value: number): number {
		if (!Number.isFinite(value)) {
			throw this.runtimeError('Bitwise operations require finite numeric operands.');
		}
		return value | 0;
	}

	private invokeMetamethod(table: LuaTable, name: string, args: ReadonlyArray<LuaValue>): LuaValue[] | null {
		const metatable = table.getMetatable();
		if (metatable === null) {
			return null;
		}
		const handler = metatable.get(name);
		if (handler === null) {
			return null;
		}
		const functionValue = this.expectFunction(handler, `Metamethod ${name} must be a function.`, null);
		return functionValue.call(args);
	}

	private nextRandom(): number {
		this.randomSeedValue = (this.randomSeedValue * 1664525 + 1013904223) % 4294967296;
		return this.randomSeedValue / 4294967296;
	}

	private serializeValueInternal(value: LuaValue, visited: Set<LuaTable>): unknown {
		if (value === null || typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') {
			return value;
		}
		if (isLuaTable(value)) {
			if (visited.has(value)) {
				throw this.runtimeError('Cannot serialize cyclic table structures.');
			}
			visited.add(value);
			const entriesData: unknown[] = [];
			const entries = value.entriesArray();
			for (const entry of entries) {
				const serializedKey = this.serializeValueInternal(entry[0], visited);
				const serializedValue = this.serializeValueInternal(entry[1], visited);
				entriesData.push({ key: serializedKey, value: serializedValue });
			}
			const metatable = value.getMetatable();
			const serializedMetatable = metatable !== null ? this.serializeValueInternal(metatable, visited) : null;
			visited.delete(value);
			return { type: 'table', entries: entriesData, metatable: serializedMetatable };
		}
		const functionValue = this.expectFunction(value, 'Unable to serialize value.', null);
		return { type: 'function', name: functionValue.name };
	}

	private deserializeValueInternal(data: unknown): LuaValue {
		if (data === null || typeof data === 'boolean' || typeof data === 'number' || typeof data === 'string') {
			return data as LuaValue;
		}
		if (typeof data !== 'object') {
			throw this.runtimeError('Unsupported serialized value.');
		}
		const record = data as Record<string, unknown>;
		const typeField = record.type;
		if (typeField === 'table') {
			const entriesData = record.entries;
			if (!Array.isArray(entriesData)) {
				throw this.runtimeError('Invalid serialized table entries.');
			}
			const table = createLuaTable();
			for (const entry of entriesData) {
				if (typeof entry !== 'object' || entry === null) {
					throw this.runtimeError('Invalid serialized table entry.');
				}
				const entryRecord = entry as Record<string, unknown>;
				if (!('key' in entryRecord) || !('value' in entryRecord)) {
					throw this.runtimeError('Invalid serialized table entry.');
				}
				const key = this.deserializeValueInternal(entryRecord.key);
				const entryValue = this.deserializeValueInternal(entryRecord.value);
				table.set(key, entryValue);
			}
			if ('metatable' in record && record.metatable !== null) {
				const deserializedMetatable = this.deserializeValueInternal(record.metatable);
				if (!(isLuaTable(deserializedMetatable))) {
					throw this.runtimeError('Serialized metatable must resolve to a table.');
				}
				table.setMetatable(deserializedMetatable);
			}
			return table;
		}
		if (typeField === 'function') {
			const nameField = record.name;
			if (typeof nameField !== 'string') {
				throw this.runtimeError('Serialized function entry missing name.');
			}
			return this.findFunctionByQualifiedName(nameField);
		}
		throw this.runtimeError('Unsupported serialized value type.');
	}

	private findFunctionByQualifiedName(name: string): LuaFunctionValue {
		if (name.length === 0) {
			throw this.runtimeError('Cannot deserialize unnamed function.');
		}
		let methodName: string | null = null;
		let path = name;
		const colonIndex = name.indexOf(':');
		if (colonIndex >= 0) {
			methodName = name.substring(colonIndex + 1);
			path = name.substring(0, colonIndex);
		}
		const segments = path.split('.');
		if (segments.length === 0) {
			throw this.runtimeError(`Function '${name}' not found during deserialization.`);
		}
		let value: LuaValue | null = this.globals.get(segments[0]);
		if (value === null) {
			throw this.runtimeError(`Function '${name}' not found during deserialization.`);
		}
		for (let index = 1; index < segments.length; index += 1) {
			if (!(isLuaTable(value))) {
				throw this.runtimeError(`Function '${name}' not found during deserialization.`);
			}
			value = value.get(segments[index]);
		}
		if (methodName !== null) {
			if (!(isLuaTable(value))) {
				throw this.runtimeError(`Function '${name}' not found during deserialization.`);
			}
			value = value.get(methodName);
		}
		const functionValue = this.expectFunction(value, `Function '${name}' not found during deserialization.`, null);
		return functionValue;
	}

	private lookupIdentifier(name: string, environment: LuaEnvironment): LuaValue | null {
		const value = environment.get(name);
		if (value !== null) {
			return value;
		}
		return this.globals.get(name);
	}

	private evaluateArithmeticExpression(expression: LuaBinaryExpression, environment: LuaEnvironment, varargs: ReadonlyArray<LuaValue>, metamethodName: string, operator: (left: number, right: number) => number, message: string): LuaValue {
		const left = this.evaluateSingleExpression(expression.left, environment, varargs);
		const right = this.evaluateSingleExpression(expression.right, environment, varargs);
		if (typeof left === 'number' && typeof right === 'number') {
			return operator(left, right);
		}
		const metamethodResult = this.invokeBinaryMetamethod(left, right, metamethodName, expression.range);
		if (metamethodResult !== null) {
			return metamethodResult;
		}
		throw this.runtimeErrorAt(expression.range, message);
	}

	private evaluateBitwiseExpression(
		expression: LuaBinaryExpression,
		environment: LuaEnvironment,
		varargs: ReadonlyArray<LuaValue>,
		metamethodName: string,
		operator: (left: number, right: number) => number,
		message: string
	): LuaValue {
		const left = this.evaluateSingleExpression(expression.left, environment, varargs);
		const right = this.evaluateSingleExpression(expression.right, environment, varargs);
		if (typeof left === 'number' && typeof right === 'number') {
			const leftInt = this.coerceToBitwiseInteger(left);
			const rightInt = this.coerceToBitwiseInteger(right);
			return operator(leftInt, rightInt);
		}
		const metamethodResult = this.invokeBinaryMetamethod(left, right, metamethodName, expression.range);
		if (metamethodResult !== null) {
			return metamethodResult;
		}
		throw this.runtimeErrorAt(expression.range, message);
	}

	private evaluateFloorDivision(expression: LuaBinaryExpression, environment: LuaEnvironment, varargs: ReadonlyArray<LuaValue>): LuaValue {
		const left = this.evaluateSingleExpression(expression.left, environment, varargs);
		const right = this.evaluateSingleExpression(expression.right, environment, varargs);
		if (typeof left === 'number' && typeof right === 'number') {
			if (right === 0) {
				throw this.runtimeErrorAt(expression.range, 'Division by zero.');
			}
			return Math.floor(left / right);
		}
		const metamethodResult = this.invokeBinaryMetamethod(left, right, '__idiv', expression.range);
		if (metamethodResult !== null) {
			return metamethodResult;
		}
		throw this.runtimeErrorAt(expression.range, 'Floor division operands must be numbers or define __idiv metamethod.');
	}

	private evaluateConcatenationExpression(expression: LuaBinaryExpression, environment: LuaEnvironment, varargs: ReadonlyArray<LuaValue>): LuaValue {
		const left = this.evaluateSingleExpression(expression.left, environment, varargs);
		const right = this.evaluateSingleExpression(expression.right, environment, varargs);
		if ((typeof left === 'string' || typeof left === 'number') && (typeof right === 'string' || typeof right === 'number')) {
			return this.toLuaString(left) + this.toLuaString(right);
		}
		const metamethodResult = this.invokeBinaryMetamethod(left, right, '__concat', expression.range);
		if (metamethodResult !== null) {
			return metamethodResult;
		}
		throw this.runtimeErrorAt(expression.range, 'Concatenation operands must be strings/numbers or define __concat metamethod.');
	}

	private evaluateEqualityExpression(expression: LuaBinaryExpression, environment: LuaEnvironment, varargs: ReadonlyArray<LuaValue>): boolean {
		const left = this.evaluateSingleExpression(expression.left, environment, varargs);
		const right = this.evaluateSingleExpression(expression.right, environment, varargs);
		if (left === right) {
			return true;
		}
		if (isLuaNativeValue(left) && isLuaNativeValue(right)) {
			return left.native === right.native;
		}
		const handler = this.extractSharedMetamethodFunction(left, right, '__eq', expression.range);
		if (handler !== null) {
			const result = handler.call([left, right]);
			const first = result.length > 0 ? result[0] : null;
			return this.expectBoolean(first, '__eq metamethod must return a boolean.', expression.range);
		}
		return false;
	}

	private evaluateRelationalExpression(
		expression: LuaBinaryExpression,
		environment: LuaEnvironment,
		varargs: ReadonlyArray<LuaValue>,
		metamethodName: string,
		comparator: (left: number | string, right: number | string) => boolean,
		message: string,
		swapForMetamethod: boolean
	): boolean {
		const left = this.evaluateSingleExpression(expression.left, environment, varargs);
		const right = this.evaluateSingleExpression(expression.right, environment, varargs);
		if (typeof left === 'number' && typeof right === 'number') {
			return comparator(left, right);
		}
		if (typeof left === 'string' && typeof right === 'string') {
			return comparator(left, right);
		}
		const metaLeft = swapForMetamethod ? right : left;
		const metaRight = swapForMetamethod ? left : right;
		const handler = this.extractSharedMetamethodFunction(metaLeft, metaRight, metamethodName, expression.range);
		if (handler !== null) {
			const result = handler.call([metaLeft, metaRight]);
			const first = result.length > 0 ? result[0] : null;
			return this.expectBoolean(first, `${metamethodName} metamethod must return a boolean.`, expression.range);
		}
		throw this.runtimeErrorAt(expression.range, message);
	}

	private invokeUnaryMetamethod(operand: LuaValue, name: string, range: LuaSourceRange): LuaValue | null {
		const handler = this.extractMetamethodFunction(operand, name, range);
		if (handler === null) {
			return null;
		}
		const result = handler.call([operand]);
		if (result.length === 0) {
			return null;
		}
		return result[0];
	}

	private invokeBinaryMetamethod(left: LuaValue, right: LuaValue, name: string, range: LuaSourceRange): LuaValue | null {
		const leftHandler = this.extractMetamethodFunction(left, name, range);
		if (leftHandler !== null) {
			const result = leftHandler.call([left, right]);
			if (result.length === 0) {
				return null;
			}
			return result[0];
		}
		const rightHandler = this.extractMetamethodFunction(right, name, range);
		if (rightHandler !== null) {
			const result = rightHandler.call([left, right]);
			if (result.length === 0) {
				return null;
			}
			return result[0];
		}
		return null;
	}

	private extractMetamethodFunction(value: LuaValue, name: string, range: LuaSourceRange | null): LuaFunctionValue | null {
		let metatable: LuaTable | null = null;
		if (isLuaTable(value)) {
			metatable = value.getMetatable();
		} else if (isLuaNativeValue(value)) {
			metatable = value.getMetatable();
		} else {
			return null;
		}
		if (metatable === null) {
			return null;
		}
		const handler = metatable.get(name);
		if (handler === null) {
			return null;
		}
		return this.expectFunction(handler, `Metamethod ${name} must be a function.`, range);
	}

	private getMetatableForValue(value: LuaValue): LuaTable | null {
		if (isLuaTable(value)) {
			return value.getMetatable();
		}
		if (isLuaNativeValue(value)) {
			return value.getMetatable();
		}
		return null;
	}

	private extractSharedMetamethodFunction(left: LuaValue, right: LuaValue, name: string, range: LuaSourceRange): LuaFunctionValue | null {
		const leftMetatable = this.getMetatableForValue(left);
		const rightMetatable = this.getMetatableForValue(right);
		if (leftMetatable === null || rightMetatable === null || leftMetatable !== rightMetatable) {
			return null;
		}
		const handler = leftMetatable.get(name);
		if (handler === null) {
			return null;
		}
		return this.expectFunction(handler, `Metamethod ${name} must be a function.`, range);
	}

	private isTruthy(value: LuaValue): boolean {
		if (value === null) {
			return false;
		}
		if (value === false) {
			return false;
		}
		return true;
	}

	private expectNumber(value: LuaValue, message: string, range: LuaSourceRange | null): number {
		if (typeof value === 'number') {
			return value;
		}
		if (range !== null) {
			throw this.runtimeErrorAt(range, message);
		}
		throw this.runtimeError(message);
	}

	private describeNonFunctionValue(value: LuaValue): string {
		if (value === null) {
			return 'a nil value';
		}
		if (typeof value === 'boolean') {
			return 'a boolean value';
		}
		if (typeof value === 'number') {
			return 'a number value';
		}
		if (typeof value === 'string') {
			return 'a string value';
		}
		if (isLuaTable(value)) {
			return 'a table value';
		}
		if (isLuaNativeValue(value)) {
			return 'a native value';
		}
		return 'a non-callable value';
	}

	private buildCallErrorMessage(callee: LuaExpression, value: LuaValue): string {
		const description = this.describeNonFunctionValue(value);
		if (callee.kind === LuaSyntaxKind.IdentifierExpression) {
			const identifier = callee as LuaIdentifierExpression;
			return `Attempted to call ${description} (global '${identifier.name}').`;
		}
		if (callee.kind === LuaSyntaxKind.MemberExpression) {
			const member = callee as LuaMemberExpression;
			return `Attempted to call ${description} (field '${member.identifier}').`;
		}
		if (callee.kind === LuaSyntaxKind.IndexExpression) {
			return `Attempted to call ${description} (index result).`;
		}
		return `Attempted to call ${description}.`;
	}

	private expectBoolean(value: LuaValue, message: string, range: LuaSourceRange | null): boolean {
		if (typeof value === 'boolean') {
			return value;
		}
		if (range !== null) {
			throw this.runtimeErrorAt(range, message);
		}
		throw this.runtimeError(message);
	}

	public expectFunction(value: LuaValue, message: string, range: LuaSourceRange | null): LuaFunctionValue {
		if (isLuaNativeValue(value)) {
			return this.getOrCreateNativeCallable(value, range);
		}
		if (typeof value === 'object' && value !== null) {
			if ('call' in value) {
				const candidate = value as LuaFunctionValue;
				if (typeof candidate.call === 'function') {
					return candidate;
				}
			}
		}
		if (range !== null) {
			throw this.runtimeErrorAt(range, message);
		}
		throw this.runtimeError(message);
	}

	private ensureHostAdapter(range: LuaSourceRange | null): LuaHostAdapter {
		if (this.hostAdapter) {
			return this.hostAdapter;
		}
		if (range !== null) {
			throw this.runtimeErrorAt(range, 'Host adapter not configured for native value operation.');
		}
		throw this.runtimeError('Host adapter not configured for native value operation.');
	}

	private convertFromHost(value: unknown): LuaValue {
		if (value === null || value === undefined) {
			return null;
		}
		if (typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') {
			return value;
		}
		if (isLuaTable(value)) {
			return value;
		}
		if (isLuaNativeValue(value)) {
			return value;
		}
		const adapter = this.ensureHostAdapter(null);
		return adapter.toLua(value, this);
	}

	private convertToHost(value: LuaValue, range: LuaSourceRange | null): unknown {
		if (value === null || typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') {
			return value;
		}
		const adapter = this.ensureHostAdapter(range);
		return adapter.toJs(value, this);
	}

	private isDirectLuaValue(value: unknown): value is LuaValue {
		if (value === null) {
			return true;
		}
		if (typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') {
			return true;
		}
		if (isLuaTable(value)) {
			return true;
		}
		if (isLuaNativeValue(value)) {
			return true;
		}
		if (value && typeof value === 'object' && 'call' in (value as Record<string, unknown>)) {
			const candidate = value as { call?: unknown };
			return typeof candidate.call === 'function';
		}
		return false;
	}

	private wrapHostInvocationResult(result: unknown): LuaValue[] {
		if (Array.isArray(result)) {
			const allLua = result.every(entry => this.isDirectLuaValue(entry));
			if (allLua) {
				return result as LuaValue[];
			}
			const wrapped: LuaValue[] = [];
			for (let index = 0; index < result.length; index += 1) {
				wrapped.push(this.convertFromHost(result[index]));
			}
			return wrapped;
		}
		if (result === undefined) {
			return [];
		}
		return [this.convertFromHost(result)];
	}

	private nativeTypeName(target: LuaNativeValue): string {
		if (target.typeName && target.typeName.length > 0) {
			return target.typeName;
		}
		return 'Object';
	}

	private formatNativeError(typeName: string, memberName: string, error: unknown): string {
		const detail = this.formatErrorMessage(error);
		return `[${typeName}.${memberName}] ${detail}`;
	}

	private fallbackSourceRange(): LuaSourceRange {
		return {
			chunkName: this.currentChunk,
			start: { line: 0, column: 0 },
			end: { line: 0, column: 0 },
		};
	}

	private bindNativeFunction(target: LuaNativeValue, options: { cacheKey: string; resolvedName: string | null; displayName: string; bindInstance: boolean; range: LuaSourceRange | null }): LuaFunctionValue {
		const cached = this.getCachedNativeMethod(target, options.cacheKey);
		if (cached !== null) {
			return cached;
		}
		const typeName = this.nativeTypeName(target);
		const fn = new LuaNativeFunction(`${typeName}.${options.displayName}`, this, (_lua, args) => {
			const native = target.native;
			const jsArgs: unknown[] = [];
			if (options.bindInstance) {
				let startIndex = 0;
				if (args.length > 0) {
					const maybeSelf = this.convertToHost(args[0], options.range);
					if (maybeSelf === native) {
						startIndex = 1;
					}
				}
				for (let index = startIndex; index < args.length; index += 1) {
					jsArgs.push(this.convertToHost(args[index], options.range));
				}
			} else {
				for (let index = 0; index < args.length; index += 1) {
					jsArgs.push(this.convertToHost(args[index], options.range));
				}
			}
			try {
				let callable: unknown;
				let thisArg: unknown;
				if (options.resolvedName !== null) {
					callable = Reflect.get(native as Record<string, unknown>, options.resolvedName);
					if (typeof callable !== 'function') {
						throw new Error(`Property '${options.displayName}' is not callable.`);
					}
					thisArg = native;
				} else {
					callable = native;
					if (typeof callable !== 'function') {
						throw new Error('Native value is not callable.');
					}
					thisArg = undefined;
				}
				const result = Reflect.apply(callable as (...args: unknown[]) => unknown, thisArg, jsArgs);
				return this.wrapHostInvocationResult(result);
			} catch (error) {
				if (isLuaDebuggerPauseSignal(error)) {
					throw error;
				}
				if (error instanceof LuaRuntimeError) {
					throw error;
				}
				const message = this.formatNativeError(typeName, options.displayName, error);
				if (options.range !== null) {
					throw this.runtimeErrorAt(options.range, message);
				}
				throw this.runtimeError(message);
			}
		});
		this.storeNativeMethod(target, options.cacheKey, fn);
		return fn;
	}

	private getOrCreateNativeMethod(target: LuaNativeValue, resolvedName: string, displayName: string, range: LuaSourceRange | null): LuaFunctionValue {
		const cacheKey = `method:${displayName}`;
		return this.bindNativeFunction(target, { cacheKey, resolvedName, displayName, bindInstance: true, range });
	}

	private getOrCreateNativeCallable(target: LuaNativeValue, range: LuaSourceRange | null): LuaFunctionValue {
		return this.bindNativeFunction(target, { cacheKey: 'call', resolvedName: null, displayName: 'call', bindInstance: false, range });
	}

	private normalizeNativeKey(key: LuaValue): { propertyName: string; displayName: string } | null {
		if (typeof key === 'string') {
			return { propertyName: key, displayName: key };
		}
		if (typeof key === 'number' && Number.isInteger(key)) {
			const text = String(key);
			return { propertyName: text, displayName: text };
		}
		return null;
	}

	private resolveNativePropertyName(native: object | Function, propertyName: string): string | null {
		if (propertyName in native) {
			return propertyName;
		}
		if (!this.caseInsensitiveNativeAccess) {
			return null;
		}
		const lower = propertyName.toLowerCase();
		let prototype: object | null = native;
		while (prototype && prototype !== Object.prototype) {
			const names = Object.getOwnPropertyNames(prototype);
			for (let index = 0; index < names.length; index += 1) {
				const candidate = names[index];
				if (candidate === propertyName) {
					return candidate;
				}
				if (candidate.toLowerCase() === lower) {
					return candidate;
				}
			}
			prototype = Object.getPrototypeOf(prototype);
		}
		return null;
	}

	private getNativePropertyValue(target: LuaNativeValue, key: LuaValue, range: LuaSourceRange | null): { found: boolean; value: LuaValue; resolvedName: string | null; displayName: string } {
		const normalized = this.normalizeNativeKey(key);
		if (!normalized) {
			return { found: false, value: null, resolvedName: null, displayName: '' };
		}
		const resolvedName = this.resolveNativePropertyName(target.native, normalized.propertyName);
		if (!resolvedName) {
			return { found: false, value: null, resolvedName: null, displayName: normalized.displayName };
		}
		let property: unknown;
		try {
			property = Reflect.get(target.native as Record<string, unknown>, resolvedName);
		} catch (error) {
			if (isLuaDebuggerPauseSignal(error)) {
				throw error;
			}
			const message = this.formatNativeError(this.nativeTypeName(target), normalized.displayName, error);
			if (range !== null) {
				throw this.runtimeErrorAt(range, message);
			}
			throw this.runtimeError(message);
		}
		const exists = resolvedName in (target.native as Record<string, unknown>);
		if (typeof property === 'function') {
			const fn = this.getOrCreateNativeMethod(target, resolvedName, normalized.displayName, range);
			return { found: true, value: fn, resolvedName, displayName: normalized.displayName };
		}
		if (!exists && property === undefined) {
			return { found: false, value: null, resolvedName, displayName: normalized.displayName };
		}
		if (property === undefined) {
			return { found: true, value: null, resolvedName, displayName: normalized.displayName };
		}
		return { found: true, value: this.convertFromHost(property), resolvedName, displayName: normalized.displayName };
	}

	private getNativeValueWithMetamethod(target: LuaNativeValue, key: LuaValue, range: LuaSourceRange | null): LuaValue {
		return this.getNativeValueWithMetamethodInternal(target, key, range, new Set<LuaNativeValue>());
	}

	private getNativeValueWithMetamethodInternal(target: LuaNativeValue, key: LuaValue, range: LuaSourceRange | null, visited: Set<LuaNativeValue>): LuaValue {
		if (visited.has(target)) {
			const loopMessage = 'Metatable __index loop detected.';
			if (range !== null) {
				throw this.runtimeErrorAt(range, loopMessage);
			}
			throw this.runtimeError(loopMessage);
		}
		visited.add(target);
		const property = this.getNativePropertyValue(target, key, range);
		if (property.found) {
			visited.delete(target);
			return property.value;
		}
		const metatable = target.getMetatable();
		if (metatable === null) {
			visited.delete(target);
			return null;
		}
		const handler = metatable.get('__index');
		if (handler === null) {
			visited.delete(target);
			return null;
		}
		if (isLuaTable(handler)) {
			const result = this.getTableValueWithMetamethod(handler, key, range ?? this.fallbackSourceRange());
			visited.delete(target);
			return result;
		}
		const functionValue = this.expectFunction(handler, '__index metamethod must be a function or table.', range);
		const values = functionValue.call([target, key]);
		const first = values.length > 0 ? values[0] : null;
		visited.delete(target);
		return first;
	}

	public getNativeMemberValue(target: LuaNativeValue, property: string, range: LuaSourceRange | null = null): LuaValue {
		return this.getNativeValueWithMetamethod(target, property, range);
	}

	private getNativeIndexValue(target: LuaNativeValue, key: LuaValue, range: LuaSourceRange): LuaValue {
		return this.getNativeValueWithMetamethod(target, key, range);
	}

	private setNativePropertyInternal(target: LuaNativeValue, key: { propertyName: string; displayName: string }, value: LuaValue, range: LuaSourceRange): void {
		const resolvedName = this.resolveNativePropertyName(target.native, key.propertyName) ?? key.propertyName;
		const jsValue = this.convertToHost(value, range);
		try {
			Reflect.set(target.native as Record<string, unknown>, resolvedName, jsValue);
		} catch (error) {
			const message = this.formatNativeError(this.nativeTypeName(target), key.displayName, error);
			throw this.runtimeErrorAt(range, message);
		}
		this.evictNativeMethod(target, key.displayName);
	}

	private setNativeMember(target: LuaNativeValue, property: string, value: LuaValue, range: LuaSourceRange): void {
		const normalized = { propertyName: property, displayName: property };
		this.setNativePropertyInternal(target, normalized, value, range);
	}

	private setNativeIndex(target: LuaNativeValue, key: LuaValue, value: LuaValue, range: LuaSourceRange): void {
		const normalized = this.normalizeNativeKey(key);
		if (!normalized) {
			throw this.runtimeErrorAt(range, 'Native value keys must be strings or integers.');
		}
		this.setNativePropertyInternal(target, normalized, value, range);
	}

	private enumerateNativeKeys(target: LuaNativeValue): LuaValue[] {
		const native = target.native as Record<string, unknown>;
		const keys: LuaValue[] = [];
		for (const property of Object.keys(native)) {
			const numeric = Number(property);
			if (Number.isInteger(numeric) && String(numeric) === property) {
				keys.push(numeric);
			} else {
				keys.push(property);
			}
		}
		return keys;
	}

	private createNativePairsIterator(target: LuaNativeValue): LuaValue[] {
		const keys = this.enumerateNativeKeys(target);
		let pointer = 0;
		const iterator = new LuaNativeFunction('native_pairs_iterator', this, (_lua, iteratorArgs) => {
			const nativeTarget = iteratorArgs.length > 0 ? iteratorArgs[0] : null;
			if (!isLuaNativeValue(nativeTarget) || nativeTarget !== target) {
				return [null];
			}
			if (pointer >= keys.length) {
				return [null];
			}
			const key = keys[pointer];
			pointer += 1;
			const value = this.getNativeValueWithMetamethod(target, key, null);
			return [key, value];
		});
		return [iterator, target, null];
	}

	private createNativeIpairsIterator(target: LuaNativeValue): LuaValue[] {
		const iterator = new LuaNativeFunction('native_ipairs_iterator', this, (_lua, iteratorArgs) => {
			const nativeTarget = iteratorArgs.length > 0 ? iteratorArgs[0] : null;
			const previousIndex = iteratorArgs.length > 1 ? iteratorArgs[1] : null;
			if (!isLuaNativeValue(nativeTarget) || nativeTarget !== target) {
				return [null];
			}
			const nextIndex = typeof previousIndex === 'number' ? previousIndex + 1 : 1;
			const value = this.getNativeValueWithMetamethod(target, nextIndex, null);
			if (value === null) {
				return [null];
			}
			return [nextIndex, value];
		});
		return [iterator, target, 0];
	}

	private getNativeMethodCache(target: LuaNativeValue): Map<string, LuaFunctionValue> {
		let cache = this.nativeMethodCache.get(target);
		if (!cache) {
			cache = new Map<string, LuaFunctionValue>();
			this.nativeMethodCache.set(target, cache);
		}
		return cache;
	}

	private getCachedNativeMethod(target: LuaNativeValue, key: string): LuaFunctionValue | null {
		const cache = this.nativeMethodCache.get(target);
		if (!cache) {
			return null;
		}
		const entry = cache.get(key);
		return entry ?? null;
	}

	private storeNativeMethod(target: LuaNativeValue, key: string, fn: LuaFunctionValue): void {
		const cache = this.getNativeMethodCache(target);
		cache.set(key, fn);
	}

	private evictNativeMethod(target: LuaNativeValue, key: string): void {
		const cache = this.nativeMethodCache.get(target);
		if (!cache) {
			return;
		}
		cache.delete(key);
		if (cache.size === 0) {
			this.nativeMethodCache.delete(target);
		}
	}

	private formatErrorMessage(error: unknown): string {
		if (error instanceof LuaRuntimeError || error instanceof LuaSyntaxError) {
			return error.message;
		}
		if (error instanceof Error) {
			return error.message;
		}
		return String(error);
	}

	private expectString(value: LuaValue, message: string, range: LuaSourceRange | null): string {
		if (typeof value === 'string') {
			return value;
		}
		if (range !== null) {
			throw this.runtimeErrorAt(range, message);
		}
		throw this.runtimeError(message);
	}

	private toLuaString(value: LuaValue): string {
		if (value === null) {
			return 'nil';
		}
		if (typeof value === 'boolean') {
			return value ? 'true' : 'false';
		}
		if (typeof value === 'number') {
			return Number.isFinite(value) ? value.toString() : 'nan';
		}
		if (typeof value === 'string') {
			return value;
		}
		if (isLuaTable(value)) {
			return 'table';
		}
		return 'function';
	}

	private createScriptFunction(expression: LuaFunctionExpression, environment: LuaEnvironment, name: string, implicitSelfName: string | null): LuaScriptFunction {
		return new LuaScriptFunction(name, this, expression, environment, implicitSelfName);
	}

    private invokeFunction(functionValue: LuaFunctionValue, args: ReadonlyArray<LuaValue>, range: LuaSourceRange): LuaValue[] {
        // Ensure native calls appear in the call stack with the call-site location.
        // Script functions already push a frame inside invokeScriptFunction().
        return this.withCurrentCallRange(range, () => {
            if (functionValue instanceof LuaNativeFunction) {
                this.pushCallFrame(functionValue.name && functionValue.name.length > 0 ? functionValue.name : null, range.chunkName, range.start.line, range.start.column);
                try {
                    return functionValue.call(args);
                } catch (error) {
                    if (!isLuaDebuggerPauseSignal(error)) {
                        this.recordFaultCallStack();
                    }
                    throw error;
                } finally {
                    this.callStack.pop();
                }
            }
            return functionValue.call(args);
        });
    }

	private withCurrentCallRange<T>(range: LuaSourceRange, callback: () => T): T {
		const previous = this.currentCallRange;
		this.currentCallRange = range;
		try {
			return callback();
		}
		finally {
			this.currentCallRange = previous;
		}
	}

	public getCurrentCallRange(): LuaSourceRange | null {
		return this.currentCallRange;
	}

	public invokeScriptFunction(expression: LuaFunctionExpression, closure: LuaEnvironment, name: string, args: ReadonlyArray<LuaValue>, implicitSelfName: string | null): LuaValue[] {
		const activationEnvironment = LuaEnvironment.createChild(closure);
		const callRange = this.currentCallRange;
		const rangeSource = callRange ? callRange.chunkName : expression.range.chunkName;
		const rangeLine = callRange ? callRange.start.line : expression.range.start.line;
		const rangeColumn = callRange ? callRange.start.column : expression.range.start.column;
		this.pushCallFrame(name && name.length > 0 ? name : null, rangeSource, rangeLine, rangeColumn);
		const parameters = expression.parameters;
		let argumentIndex = 0;
		if (implicitSelfName !== null) {
			const selfValue = argumentIndex < args.length ? args[argumentIndex] : null;
			activationEnvironment.set(implicitSelfName, selfValue);
			argumentIndex += 1;
		}
		for (const parameter of parameters) {
			const value = argumentIndex < args.length ? args[argumentIndex] : null;
			activationEnvironment.set(parameter.name, value, parameter.range);
			argumentIndex += 1;
		}
		let varargValues: LuaValue[] = [];
		if (expression.hasVararg) {
			const extras: LuaValue[] = [];
			for (let index = argumentIndex; index < args.length; index += 1) {
				extras.push(args[index]);
			}
			varargValues = extras;
		}
		try {
			const signal = this.withEnv(activationEnvironment, () => this.executeBlock(expression.body, activationEnvironment, varargValues, null));
			if (signal.kind === 'return') {
				return Array.from(signal.values);
			}
			if (signal.kind === 'break') {
				throw this.runtimeErrorAt(expression.range, `Cannot break from function '${name}'.`);
			}
			if (signal.kind === 'goto') {
				throw this.runtimeErrorAt(signal.origin.range, `Label '${signal.label}' not found in function '${name}'.`);
			}
			if (signal.kind === 'pause') {
				throw signal;
			}
			return [];
		} catch (error) {
			if (!isLuaDebuggerPauseSignal(error)) {
				this.recordFaultCallStack();
			}
			throw error;
		} finally {
			this.callStack.pop();
		}
	}

	private validateReservedIdentifiers(statements: ReadonlyArray<LuaStatement>): void {
		if (this.reservedIdentifiers.size === 0) {
			return;
		}
		for (const statement of statements) {
			switch (statement.kind) {
				case LuaSyntaxKind.LocalAssignmentStatement: {
					const localAssignment = statement as LuaLocalAssignmentStatement;
					for (const name of localAssignment.names) {
						this.ensureIdentifierNotReserved(name.name, name.range);
					}
					break;
				}
				case LuaSyntaxKind.LocalFunctionStatement: {
					const localFunc = statement as LuaLocalFunctionStatement;
					this.ensureIdentifierNotReserved(localFunc.name.name, localFunc.name.range);
					this.validateFunctionExpression(localFunc.functionExpression);
					break;
				}
				case LuaSyntaxKind.FunctionDeclarationStatement: {
					const funcDecl = statement as LuaFunctionDeclarationStatement;
					if (funcDecl.name.identifiers.length > 0) {
						this.ensureIdentifierNotReserved(funcDecl.name.identifiers[0], funcDecl.range);
					}
					if (funcDecl.name.methodName) {
						this.ensureIdentifierNotReserved(funcDecl.name.methodName, funcDecl.range);
					}
					this.validateFunctionExpression(funcDecl.functionExpression);
					break;
				}
				case LuaSyntaxKind.AssignmentStatement: {
					const assignment = statement as LuaAssignmentStatement;
					for (const target of assignment.left) {
						if (target.kind === LuaSyntaxKind.IdentifierExpression) {
							const identifier = target as LuaIdentifierExpression;
							this.ensureIdentifierNotReserved(identifier.name, identifier.range);
						}
					}
					break;
				}
				case LuaSyntaxKind.IfStatement: {
					const ifStatement = statement as LuaIfStatement;
					for (const clause of ifStatement.clauses) {
						this.validateReservedIdentifiers(clause.block.body);
					}
					break;
				}
				case LuaSyntaxKind.WhileStatement:
					this.validateReservedIdentifiers((statement as LuaWhileStatement).block.body);
					break;
				case LuaSyntaxKind.RepeatStatement:
					this.validateReservedIdentifiers((statement as LuaRepeatStatement).block.body);
					break;
				case LuaSyntaxKind.ForNumericStatement: {
					const numeric = statement as LuaForNumericStatement;
					this.ensureIdentifierNotReserved(numeric.variable.name, numeric.variable.range);
					this.validateReservedIdentifiers(numeric.block.body);
					break;
				}
				case LuaSyntaxKind.ForGenericStatement: {
					const generic = statement as LuaForGenericStatement;
					for (const variable of generic.variables) {
						this.ensureIdentifierNotReserved(variable.name, variable.range);
					}
					this.validateReservedIdentifiers(generic.block.body);
					break;
				}
				case LuaSyntaxKind.DoStatement:
					this.validateReservedIdentifiers((statement as LuaDoStatement).block.body);
					break;
				default:
					break;
			}
		}
	}

	private ensureIdentifierNotReserved(name: string, range: LuaSourceRange): void {
		if (this.reservedIdentifiers.has(name)) {
			throw new LuaSyntaxError(`'${name}' is reserved and cannot be redefined.`, range.chunkName, range.start.line, range.start.column);
		}
	}

	private validateFunctionExpression(expression: LuaFunctionExpression): void {
		for (const parameter of expression.parameters) {
			this.ensureIdentifierNotReserved(parameter.name, parameter.range);
		}
		this.validateReservedIdentifiers(expression.body.body);
	}

	private initializeBuiltins(): void {
		this.packageTable.set('loaded', this.packageLoaded);
		this.globals.set('package', this.packageTable);
		this.globals.set('require', new LuaNativeFunction('require', this, (_interpreter, args) => this.invokeRequireBuiltin(args)));

		this.globals.set('print', new LuaNativeFunction('print', this, (interpreter, args) => {
			const parts: string[] = [];
			for (const value of args) {
				parts.push(interpreter.toLuaString(value));
			}
			if (parts.length === 0) {
				console.log('');
			}
			else {
				console.log(parts.join('\t'));
			}
			return [];
		}));

		this.globals.set('assert', new LuaNativeFunction('assert', this, (interpreter, args) => {
			const condition = args.length > 0 ? args[0] : null;
			if (interpreter.isTruthy(condition)) {
				return Array.from(args);
			}
			const messageValue = args.length > 1 ? args[1] : 'assertion failed!';
			const message = typeof messageValue === 'string' ? messageValue : interpreter.toLuaString(messageValue);
			throw interpreter.runtimeError(message);
		}));

		this.globals.set('error', new LuaNativeFunction('error', this, (interpreter, args) => {
			const value = args.length > 0 ? args[0] : 'nil';
			const message = typeof value === 'string' ? value : interpreter.toLuaString(value);
			throw interpreter.runtimeError(message);
		}));

		this.globals.set('type', new LuaNativeFunction('type', this, (_interpreter, args) => {
			const value = args.length > 0 ? args[0] : null;
			if (isLuaNativeValue(value)) {
				return ['native'];
			}
			let result: string;
			if (value === null) {
				result = 'nil';
			}
			else if (typeof value === 'boolean') {
				result = 'boolean';
			}
			else if (typeof value === 'number') {
				result = 'number';
			}
			else if (typeof value === 'string') {
				result = 'string';
			}
			else if (isLuaTable(value)) {
				result = 'table';
			}
			else {
				result = 'function';
			}
			return [result];
		}));

		this.globals.set('tostring', new LuaNativeFunction('tostring', this, (interpreter, args) => {
			const value = args.length > 0 ? args[0] : null;
			return [interpreter.toLuaString(value)];
		}));

		this.globals.set('tonumber', new LuaNativeFunction('tonumber', this, (interpreter, args) => {
			if (args.length === 0) {
				return [null];
			}
			const value = args[0];
			if (typeof value === 'number') {
				return [value];
			}
			if (typeof value === 'string') {
				if (args.length >= 2) {
					const baseValue = Math.floor(interpreter.expectNumber(args[1], 'tonumber base must be a number.', null));
					if (baseValue >= 2 && baseValue <= 36) {
						const parsed = parseInt(value.trim(), baseValue);
						return Number.isFinite(parsed) ? [parsed] : [null];
					}
				}
				const converted = Number(value);
				return Number.isFinite(converted) ? [converted] : [null];
			}
			return [null];
		}));

		this.globals.set('setmetatable', new LuaNativeFunction('setmetatable', this, (interpreter, args) => {
			if (args.length === 0 || (!(isLuaTable(args[0])) && !(isLuaNativeValue(args[0])))) {
				throw interpreter.runtimeError('setmetatable expects a table or native value as the first argument.');
			}
			const targetValue = args[0];
			let metatable: LuaTable | null = null;
			if (args.length >= 2) {
				const metaArg = args[1];
				if (metaArg !== null && !(isLuaTable(metaArg))) {
					throw interpreter.runtimeError('setmetatable expects a table or nil as the second argument.');
				}
				if (isLuaTable(metaArg)) {
					metatable = metaArg;
				}
			}
			if (isLuaTable(targetValue)) {
				targetValue.setMetatable(metatable);
				return [targetValue];
			}
			const nativeTarget = targetValue as LuaNativeValue;
			nativeTarget.setMetatable(metatable);
			return [nativeTarget];
		}));

		this.globals.set('getmetatable', new LuaNativeFunction('getmetatable', this, (interpreter, args) => {
			if (args.length === 0 || (!(isLuaTable(args[0])) && !(isLuaNativeValue(args[0])))) {
				throw interpreter.runtimeError('getmetatable expects a table or native value as the first argument.');
			}
			const targetValue = args[0];
			let metatable: LuaTable | null = null;
			if (isLuaTable(targetValue)) {
				metatable = targetValue.getMetatable();
			} else {
				metatable = (targetValue as LuaNativeValue).getMetatable();
			}
			if (metatable === null) {
				return [null];
			}
			return [metatable];
		}));

		this.globals.set('rawequal', new LuaNativeFunction('rawequal', this, (_interpreter, args) => {
			if (args.length < 2) {
				return [false];
			}
			return [args[0] === args[1]];
		}));

		this.globals.set('rawget', new LuaNativeFunction('rawget', this, (interpreter, args) => {
			if (args.length === 0 || !(isLuaTable(args[0]))) {
				throw interpreter.runtimeError('rawget expects a table as the first argument.');
			}
			const table = args[0] as LuaTable;
			const key = args.length > 1 ? args[1] : null;
			return [table.get(key)];
		}));

		this.globals.set('rawset', new LuaNativeFunction('rawset', this, (interpreter, args) => {
			if (args.length < 2 || !(isLuaTable(args[0]))) {
				throw interpreter.runtimeError('rawset expects a table as the first argument.');
			}
			const table = args[0] as LuaTable;
			const key = args[1];
			const value = args.length >= 3 ? args[2] : null;
			table.set(key, value);
			return [table];
		}));

		this.globals.set('pcall', new LuaNativeFunction('pcall', this, (interpreter, args) => {
			const fn = interpreter.expectFunction(args.length > 0 ? args[0] : null, 'pcall expects a function.', null);
			const functionArgs = args.slice(1);
			try {
				const result = fn.call(functionArgs);
				return [true, ...result];
			}
			catch (error) {
				if (isLuaDebuggerPauseSignal(error)) {
					throw error;
				}
				const message = interpreter.formatErrorMessage(error);
				return [false, message];
			}
		}));

		this.globals.set('xpcall', new LuaNativeFunction('xpcall', this, (interpreter, args) => {
			const fn = interpreter.expectFunction(args.length > 0 ? args[0] : null, 'xpcall expects a function.', null);
			const messageHandler = interpreter.expectFunction(args.length > 1 ? args[1] : null, 'xpcall expects a message handler.', null);
			const functionArgs = args.slice(2);
			try {
				const result = fn.call(functionArgs);
				return [true, ...result];
			}
			catch (error) {
				if (isLuaDebuggerPauseSignal(error)) {
					throw error;
				}
				const formatted = interpreter.formatErrorMessage(error);
				const handlerResult = messageHandler.call([formatted]);
				const first = handlerResult.length > 0 ? handlerResult[0] : null;
				return [false, first ?? null];
			}
		}));

		this.globals.set('select', new LuaNativeFunction('select', this, (interpreter, args) => {
			if (args.length === 0) {
				throw interpreter.runtimeError('select expects at least one argument.');
			}
			const selector = args[0];
			const valueCount = args.length - 1;
			if (selector === '#') {
				return [valueCount];
			}
			const index = Math.floor(interpreter.expectNumber(selector, 'select index must be a number.', null));
			let start = index;
			if (index < 0) {
				start = valueCount + index + 1;
			}
			if (start < 1) {
				start = 1;
			}
			const result: LuaValue[] = [];
			for (let i = start; i <= valueCount; i += 1) {
				result.push(args[i]);
			}
			return result;
		}));

		this.globals.set('next', new LuaNativeFunction('next', this, (interpreter, args) => {
			if (args.length === 0 || !(isLuaTable(args[0]))) {
				throw interpreter.runtimeError('next expects a table as the first argument.');
			}
			const table = args[0] as LuaTable;
			const lastKey = args.length > 1 ? args[1] : null;
			const entries = table.entriesArray();
			if (entries.length === 0) {
				return [null];
			}
			if (lastKey === null) {
				const [firstKey, firstValue] = entries[0];
				return [firstKey, firstValue];
			}
			let returnNext = false;
			for (const [key, value] of entries) {
				if (returnNext) {
					return [key, value];
				}
				if (key === lastKey) {
					returnNext = true;
				}
			}
			return [null];
		}));

		const mathTable = createLuaTable();
		mathTable.set('abs', new LuaNativeFunction('math.abs', this, (interpreter, args) => {
			const value = args.length > 0 ? args[0] : null;
			const number = interpreter.expectNumber(value, 'math.abs expects a number.', null);
			return [Math.abs(number)];
		}));
		mathTable.set('ceil', new LuaNativeFunction('math.ceil', this, (interpreter, args) => {
			const value = args.length > 0 ? args[0] : null;
			const number = interpreter.expectNumber(value, 'math.ceil expects a number.', null);
			return [Math.ceil(number)];
		}));
		mathTable.set('floor', new LuaNativeFunction('math.floor', this, (interpreter, args) => {
			const value = args.length > 0 ? args[0] : null;
			const number = interpreter.expectNumber(value, 'math.floor expects a number.', null);
			return [Math.floor(number)];
		}));
		mathTable.set('max', new LuaNativeFunction('math.max', this, (interpreter, args) => {
			if (args.length === 0) {
				throw interpreter.runtimeError('math.max expects at least one argument.');
			}
			let result = interpreter.expectNumber(args[0], 'math.max expects numeric arguments.', null);
			for (let index = 1; index < args.length; index += 1) {
				const value = interpreter.expectNumber(args[index], 'math.max expects numeric arguments.', null);
				if (value > result) {
					result = value;
				}
			}
			return [result];
		}));
		mathTable.set('min', new LuaNativeFunction('math.min', this, (interpreter, args) => {
			if (args.length === 0) {
				throw interpreter.runtimeError('math.min expects at least one argument.');
			}
			let result = interpreter.expectNumber(args[0], 'math.min expects numeric arguments.', null);
			for (let index = 1; index < args.length; index += 1) {
				const value = interpreter.expectNumber(args[index], 'math.min expects numeric arguments.', null);
				if (value < result) {
					result = value;
				}
			}
			return [result];
		}));
		mathTable.set('sqrt', new LuaNativeFunction('math.sqrt', this, (interpreter, args) => {
			const value = args.length > 0 ? args[0] : null;
			const number = interpreter.expectNumber(value, 'math.sqrt expects a number.', null);
			if (number < 0) {
				throw interpreter.runtimeError('math.sqrt cannot operate on negative numbers.');
			}
			return [Math.sqrt(number)];
		}));
		mathTable.set('random', new LuaNativeFunction('math.random', this, (interpreter, args) => {
			const randomValue = interpreter.nextRandom();
			if (args.length === 0) {
				return [randomValue];
			}
			if (args.length === 1) {
				const upper = interpreter.expectNumber(args[0], 'math.random expects numeric bounds.', null);
				const upperInt = Math.floor(upper);
				if (upperInt < 1) {
					throw interpreter.runtimeError('math.random upper bound must be positive.');
				}
				return [Math.floor(randomValue * upperInt) + 1];
			}
			const lower = interpreter.expectNumber(args[0], 'math.random expects numeric bounds.', null);
			const upper = interpreter.expectNumber(args[1], 'math.random expects numeric bounds.', null);
			const lowerInt = Math.floor(lower);
			const upperInt = Math.floor(upper);
			if (upperInt < lowerInt) {
				throw interpreter.runtimeError('math.random upper bound must be greater than or equal to lower bound.');
			}
			const span = upperInt - lowerInt + 1;
			return [lowerInt + Math.floor(randomValue * span)];
		}));
		mathTable.set('randomseed', new LuaNativeFunction('math.randomseed', this, (interpreter, args) => {
			const seedValue = args.length > 0 ? interpreter.expectNumber(args[0], 'math.randomseed expects a number.', null) : Date.now();
			interpreter.randomSeedValue = Math.floor(seedValue) >>> 0;
			return [];
		}));
		mathTable.set('pi', Math.PI);
		this.globals.set('math', mathTable);

		const stringTable = createLuaTable();
		stringTable.set('len', new LuaNativeFunction('string.len', this, (interpreter, args) => {
			const value = args.length > 0 ? args[0] : '';
			const str = interpreter.expectString(value, 'string.len expects a string.', null);
			return [str.length];
		}));
		stringTable.set('upper', new LuaNativeFunction('string.upper', this, (interpreter, args) => {
			const value = args.length > 0 ? args[0] : '';
			const str = interpreter.expectString(value, 'string.upper expects a string.', null);
			return [str.toUpperCase()];
		}));
		stringTable.set('lower', new LuaNativeFunction('string.lower', this, (interpreter, args) => {
			const value = args.length > 0 ? args[0] : '';
			const str = interpreter.expectString(value, 'string.lower expects a string.', null);
			return [str.toLowerCase()];
		}));
		stringTable.set('sub', new LuaNativeFunction('string.sub', this, (interpreter, args) => {
			const source = args.length > 0 ? args[0] : '';
			const str = interpreter.expectString(source, 'string.sub expects a string.', null);
			const length = str.length;
			const normalizeIndex = (value: number): number => {
				const integer = Math.floor(value);
				if (integer > 0) {
					return integer;
				}
				if (integer < 0) {
					return length + integer + 1;
				}
				return 1;
			};
			const startArg = args.length > 1 ? interpreter.expectNumber(args[1], 'string.sub expects numeric indices.', null) : 1;
			const endArg = args.length > 2 ? interpreter.expectNumber(args[2], 'string.sub expects numeric indices.', null) : length;
			let startIndex = normalizeIndex(startArg);
			let endIndex = normalizeIndex(endArg);
			if (startIndex < 1) {
				startIndex = 1;
			}
			if (endIndex > length) {
				endIndex = length;
			}
			if (endIndex < startIndex) {
				return [''];
			}
			return [str.substring(startIndex - 1, endIndex)];
		}));
		stringTable.set('find', new LuaNativeFunction('string.find', this, (interpreter, args) => {
			const source = args.length > 0 ? args[0] : '';
			const pattern = args.length > 1 ? args[1] : '';
			const str = interpreter.expectString(source, 'string.find expects a string.', null);
			const pat = interpreter.expectString(pattern, 'string.find expects a pattern string.', null);
			const startIndex = args.length > 2 ? Math.max(1, Math.floor(interpreter.expectNumber(args[2], 'string.find expects numeric start index.', null))) - 1 : 0;
			const position = str.indexOf(pat, startIndex);
			if (position === -1) {
				return [null];
			}
			const first = position + 1;
			const last = first + pat.length - 1;
			return [first, last];
		}));
		stringTable.set('byte', new LuaNativeFunction('string.byte', this, (interpreter, args) => {
			const source = args.length > 0 ? args[0] : '';
			const str = interpreter.expectString(source, 'string.byte expects a string.', null);
			const positionArg = args.length > 1 ? interpreter.expectNumber(args[1], 'string.byte expects a numeric position.', null) : 1;
			const position = Math.floor(positionArg) - 1;
			if (position < 0 || position >= str.length) {
				return [null];
			}
			return [str.charCodeAt(position)];
		}));
		stringTable.set('char', new LuaNativeFunction('string.char', this, (interpreter, args) => {
			if (args.length === 0) {
				return [''];
			}
			let result = '';
			for (const value of args) {
				const code = interpreter.expectNumber(value, 'string.char expects numeric character codes.', null);
				result += String.fromCharCode(Math.floor(code));
			}
			return [result];
		}));
		this.globals.set('string', stringTable);

		const tableLibrary = createLuaTable();
		tableLibrary.set('insert', new LuaNativeFunction('table.insert', this, (interpreter, args) => {
			if (args.length < 2) {
				throw interpreter.runtimeError('table.insert expects at least two arguments.');
			}
			const target = args[0];
			if (!(isLuaTable(target))) {
				throw interpreter.runtimeError('table.insert expects a table as the first argument.');
			}
			let position: number | null = null;
			let value: LuaValue;
			if (args.length === 2) {
				value = args[1];
			}
			else {
				position = Math.floor(interpreter.expectNumber(args[1], 'table.insert position must be a number.', null));
				value = args[2];
			}
			interpreter.tableInsert(target, value, position);
			return [];
		}));

		tableLibrary.set('remove', new LuaNativeFunction('table.remove', this, (interpreter, args) => {
			if (args.length === 0 || !(isLuaTable(args[0]))) {
				throw interpreter.runtimeError('table.remove expects a table as the first argument.');
			}
			const target = args[0] as LuaTable;
			const position = args.length > 1 ? Math.floor(interpreter.expectNumber(args[1], 'table.remove position must be a number.', null)) : null;
			const removed = interpreter.tableRemove(target, position);
			return removed === null ? [] : [removed];
		}));

		tableLibrary.set('concat', new LuaNativeFunction('table.concat', this, (interpreter, args) => {
			if (args.length === 0 || !(isLuaTable(args[0]))) {
				throw interpreter.runtimeError('table.concat expects a table as the first argument.');
			}
			const target = args[0] as LuaTable;
			const separator = args.length > 1 && typeof args[1] === 'string' ? args[1] : '';
			const startIndexRaw = args.length > 2 ? interpreter.expectNumber(args[2], 'table.concat expects numeric start index.', null) : 1;
			const endIndexRaw = args.length > 3 ? interpreter.expectNumber(args[3], 'table.concat expects numeric end index.', null) : target.numericLength();
			const length = target.numericLength();
			const normalizeIndex = (value: number, fallback: number): number => {
				const integer = Math.floor(value);
				if (integer > 0) {
					return integer;
				}
				if (integer < 0) {
					return length + integer + 1;
				}
				return fallback;
			};
			const startIndex = Math.max(1, Math.min(length, normalizeIndex(startIndexRaw, 1)));
			const endIndex = Math.max(0, Math.min(length, normalizeIndex(endIndexRaw, length)));
			if (endIndex < startIndex) {
				return [''];
			}
			const parts: string[] = [];
			for (let index = startIndex; index <= endIndex; index += 1) {
				const value = target.get(index);
				parts.push(value === null ? '' : interpreter.toLuaString(value));
			}
			return [parts.join(separator)];
		}));

		tableLibrary.set('pack', new LuaNativeFunction('table.pack', this, (_interpreter, args) => {
			const table = createLuaTable();
			for (let index = 0; index < args.length; index += 1) {
				table.set(index + 1, args[index]);
			}
			table.set('n', args.length);
			return [table];
		}));

		tableLibrary.set('unpack', new LuaNativeFunction('table.unpack', this, (interpreter, args) => {
			if (args.length === 0 || !(isLuaTable(args[0]))) {
				throw interpreter.runtimeError('table.unpack expects a table as the first argument.');
			}
			const target = args[0] as LuaTable;
			const length = target.numericLength();
			const startIndexRaw = args.length > 1 ? interpreter.expectNumber(args[1], 'table.unpack expects numeric start index.', null) : 1;
			const endIndexRaw = args.length > 2 ? interpreter.expectNumber(args[2], 'table.unpack expects numeric end index.', null) : length;
			const normalizeIndex = (value: number, fallback: number): number => {
				const integer = Math.floor(value);
				if (integer > 0) {
					return integer;
				}
				if (integer < 0) {
					return length + integer + 1;
				}
				return fallback;
			};
			const startIndex = Math.max(1, Math.min(length, normalizeIndex(startIndexRaw, 1)));
			const endIndex = Math.max(0, Math.min(length, normalizeIndex(endIndexRaw, length)));
			if (endIndex < startIndex) {
				return [];
			}
			const result: LuaValue[] = [];
			for (let index = startIndex; index <= endIndex; index += 1) {
				result.push(target.get(index));
			}
			return result;
		}));

		tableLibrary.set('sort', new LuaNativeFunction('table.sort', this, (interpreter, args) => {
			if (args.length === 0 || !(isLuaTable(args[0]))) {
				throw interpreter.runtimeError('table.sort expects a table as the first argument.');
			}
			const target = args[0] as LuaTable;
			const comparator = args.length > 1 && args[1] !== null
				? interpreter.expectFunction(args[1], 'table.sort comparator must be a function.', null)
				: null;
			const length = target.numericLength();
			const values: LuaValue[] = [];
			for (let index = 1; index <= length; index += 1) {
				values.push(target.get(index));
			}
			values.sort((left, right) => {
				if (comparator) {
					const response = comparator.call([left, right]);
					const first = response.length > 0 ? response[0] : null;
					return first === true ? -1 : 1;
				}
				return interpreter.defaultSortCompare(left, right);
			});
			for (let index = 1; index <= length; index += 1) {
				target.set(index, values[index - 1] ?? null);
			}
			return [target];
		}));

		this.globals.set('table', tableLibrary);

		const osTable = createLuaTable();
		osTable.set('time', new LuaNativeFunction('os.time', this, (interpreter, args) => {
			if (args.length === 0) {
				return [Math.floor(Date.now() / 1000)];
			}
			const tableArg = args[0];
			if (!(isLuaTable(tableArg))) {
				throw this.runtimeError('os.time expects a table or no arguments.');
			}
			const year = tableArg.get('year');
			const month = tableArg.get('month');
			const day = tableArg.get('day');
			const hour = tableArg.get('hour');
			const min = tableArg.get('min');
			const sec = tableArg.get('sec');
			const date = new Date(
				interpreter.expectNumber(year, 'os.time table requires year.', null),
				interpreter.expectNumber(month, 'os.time table requires month.', null) - 1,
				interpreter.expectNumber(day, 'os.time table requires day.', null),
				interpreter.expectNumber(hour !== null ? hour : 0, 'os.time invalid hour.', null),
				interpreter.expectNumber(min !== null ? min : 0, 'os.time invalid minute.', null),
				interpreter.expectNumber(sec !== null ? sec : 0, 'os.time invalid second.', null)
			);
			return [Math.floor(date.getTime() / 1000)];
		}));
		osTable.set('date', new LuaNativeFunction('os.date', this, (interpreter, args) => {
			const formatValue = args.length > 0 ? args[0] : null;
			const timestampValue = args.length > 1 ? args[1] : null;
			const timestamp = timestampValue === null ? Math.floor(Date.now() / 1000) : Math.floor(interpreter.expectNumber(timestampValue, 'os.date expects numeric timestamp.', null));
			const date = new Date(timestamp * 1000);
			if (formatValue === null) {
				return [date.toISOString()];
			}
			const format = interpreter.expectString(formatValue, 'os.date expects a format string.', null);
			if (format === '*t') {
				const table = createLuaTable();
				table.set('year', date.getUTCFullYear());
				table.set('month', date.getUTCMonth() + 1);
				table.set('day', date.getUTCDate());
				table.set('hour', date.getUTCHours());
				table.set('min', date.getUTCMinutes());
				table.set('sec', date.getUTCSeconds());
				table.set('isdst', false);
				return [table];
			}
			return [date.toISOString()];
		}));
		osTable.set('difftime', new LuaNativeFunction('os.difftime', this, (interpreter, args) => {
			const t2 = args.length > 0 ? interpreter.expectNumber(args[0], 'os.difftime expects numeric arguments.', null) : 0;
			const t1 = args.length > 1 ? interpreter.expectNumber(args[1], 'os.difftime expects numeric arguments.', null) : 0;
			return [t2 - t1];
		}));
		this.globals.set('os', osTable);

		this.globals.set('pairs', new LuaNativeFunction('pairs', this, (interpreter, args) => {
			if (args.length === 0) {
				throw interpreter.runtimeError('pairs expects a table or native value argument.');
			}
			const target = args[0];
			const pairsMetamethod = this.extractMetamethodFunction(target, '__pairs', null);
			if (pairsMetamethod !== null) {
				const result = pairsMetamethod.call([target]);
				if (result.length < 2) {
					throw this.runtimeError('__pairs metamethod must return at least two values.');
				}
				return Array.from(result);
			}
			if (isLuaTable(target)) {
			const nextBuiltin = this.globals.get('next');
			const iterator = this.expectFunction(nextBuiltin, 'next function unavailable.', null);
				return [iterator, target, null];
			}
			if (isLuaNativeValue(target)) {
				return this.createNativePairsIterator(target);
			}
			throw interpreter.runtimeError('pairs expects a table or native value argument.');
		}));

		this.globals.set('ipairs', new LuaNativeFunction('ipairs', this, (interpreter, args) => {
			if (args.length === 0) {
				throw interpreter.runtimeError('ipairs expects a table or native value argument.');
			}
			const target = args[0];
			const ipairsMetamethod = this.extractMetamethodFunction(target, '__ipairs', null);
			if (ipairsMetamethod !== null) {
				const result = ipairsMetamethod.call([target]);
				if (result.length < 2) {
					throw this.runtimeError('__ipairs metamethod must return at least two values.');
				}
				return Array.from(result);
			}
			if (isLuaTable(target)) {
				const table = target;
				const iterator = new LuaNativeFunction('ipairs_iterator', interpreter, (_selfInterpreter, iteratorArgs) => {
					const tableArg = iteratorArgs.length > 0 ? iteratorArgs[0] : null;
					const indexValue = iteratorArgs.length > 1 ? iteratorArgs[1] : null;
					if (!(isLuaTable(tableArg))) {
						return [null];
					}
					const index = typeof indexValue === 'number' ? indexValue + 1 : 1;
					const value = tableArg.get(index);
					if (value === null) {
						return [null];
					}
					return [index, value];
				});
				return [iterator, table, 0];
			}
			if (isLuaNativeValue(target)) {
				return this.createNativeIpairsIterator(target);
			}
			throw interpreter.runtimeError('ipairs expects a table or native value argument.');
		}));

		this.globals.set('serialize', new LuaNativeFunction('serialize', this, (interpreter, args) => {
			const value = args.length > 0 ? args[0] : null;
			try {
				const serialized = interpreter.serializeValueInternal(value, new Set<LuaTable>());
				return [JSON.stringify(serialized)];
			}
			catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				throw interpreter.runtimeError(`serialize failed: ${message}`);
			}
		}));

		this.globals.set('deserialize', new LuaNativeFunction('deserialize', this, (interpreter, args) => {
			if (args.length === 0) {
				throw interpreter.runtimeError('deserialize expects a string argument.');
			}
			const source = args[0];
			if (typeof source !== 'string') {
				throw interpreter.runtimeError('deserialize expects a string argument.');
			}
			try {
				const parsed = JSON.parse(source);
				const value = interpreter.deserializeValueInternal(parsed);
				return [value];
			}
			catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				throw interpreter.runtimeError(`deserialize failed: ${message}`);
			}
		}));
	}

	private tableInsert(table: LuaTable, value: LuaValue, position: number | null): void {
		const length = table.numericLength();
		let targetIndex = position === null ? length + 1 : Math.max(1, Math.min(length + 1, position));
		for (let index = length; index >= targetIndex; index -= 1) {
			const current = table.get(index);
			table.set(index + 1, current);
		}
		table.set(targetIndex, value);
	}

	private tableRemove(table: LuaTable, position: number | null): LuaValue {
		const length = table.numericLength();
		if (length === 0) {
			return null;
		}
		let targetIndex = position === null ? length : position!;
		if (targetIndex < 1 || targetIndex > length) {
			return null;
		}
		const removed = table.get(targetIndex);
		for (let index = targetIndex; index < length; index += 1) {
			const next = table.get(index + 1);
			table.set(index, next);
		}
		table.delete(length);
		return removed;
	}

	private defaultSortCompare(left: LuaValue, right: LuaValue): number {
		if (typeof left === 'number' && typeof right === 'number') {
			if (left === right) {
				return 0;
			}
			return left < right ? -1 : 1;
		}
		const leftText = this.toLuaString(left);
		const rightText = this.toLuaString(right);
		if (leftText === rightText) {
			return 0;
		}
		return leftText < rightText ? -1 : 1;
	}

	private runtimeError(message: string): LuaRuntimeError {
		this.markFaultEnvironment();
		const range = this.currentCallRange;
		if (range !== null) {
			return new LuaRuntimeError(message, range.chunkName, range.start.line, range.start.column);
		}
		return new LuaRuntimeError(message, this.currentChunk, 0, 0);
	}

	private runtimeErrorAt(range: LuaSourceRange, message: string): LuaRuntimeError {
		this.markFaultEnvironment();
		return new LuaRuntimeError(message, range.chunkName, range.start.line, range.start.column);
	}
}

export type LuaDebuggerPauseSignal = Extract<ExecutionSignal, { kind: 'pause' }>;

export function isLuaDebuggerPauseSignal(value: unknown): value is LuaDebuggerPauseSignal {
	if (typeof value !== 'object' || value === null) {
		return false;
	}
	const candidate = value as Partial<LuaDebuggerPauseSignal>;
	return candidate.kind === 'pause' && typeof candidate.resume === 'function';
}

export function createLuaInterpreter(): LuaInterpreter {
	return new LuaInterpreter(null);
}

export function createLuaNativeFunction(name: string, interpreter: LuaInterpreter, handler: (interpreter: LuaInterpreter, args: ReadonlyArray<LuaValue>) => ReadonlyArray<LuaValue>): LuaFunctionValue {
	return new LuaNativeFunction(name, interpreter, handler);
}
export type StackFrameLanguage = 'lua' | 'js';

export type StackTraceFrame = {
	origin: StackFrameLanguage;
	functionName: string | null;
	source: string | null;
	line: number | null;
	column: number | null;
	raw: string;
	chunkAssetId?: string | null;
	chunkPath?: string | null;
};
