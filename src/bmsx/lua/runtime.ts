import {
	LuaSyntaxKind,
	LuaBinaryOperator,
	LuaUnaryOperator,
	LuaTableFieldKind,
	LuaAssignmentOperator,
} from './syntax/ast';
import type {
	LuaAssignableExpression,
	LuaAssignmentStatement,
	LuaBinaryExpression,
	LuaCallExpression,
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
	LuaLocalAssignmentStatement,
	LuaLocalFunctionStatement,
	LuaMemberExpression,
	LuaRepeatStatement,
	LuaReturnStatement,
	LuaStatement,
	LuaTableArrayField,
	LuaTableConstructorExpression,
	LuaTableExpressionField,
	LuaTableIdentifierField,
	LuaUnaryExpression,
	LuaWhileStatement,
	LuaSourceRange,
	LuaDefinitionInfo,
} from './syntax/ast';
import { LuaEnvironment } from './environment';
import { LuaRuntimeError, LuaSyntaxError } from './errors';
import { LuaFunctionValue, LuaValue, LuaTable, LuaNativeValue, type LuaCallResult, isLuaCallSignal, isLuaFunctionValue } from './value';
import {
	createLuaNativeMemberHandle,
	createLuaTable,
	extractErrorMessage,
	isHostCallable,
	isLuaNativeMemberHandle,
	isLuaTable,
	resolveNativeTypeName,
	type LuaNativeMemberHandle
} from './value';
import { LuaDebuggerController, type LuaDebuggerPauseReason } from './debugger';
import { engineCore } from '../core/engine';
import { Runtime } from '../machine/runtime/runtime';
import { isLuaHandlerFunction } from './handler_cache';
import { LuaInteropAdapter } from '../machine/firmware/js_bridge';
import { getCachedLuaParse } from './analysis/cache';
import { ScratchBuffer } from '../common/scratchbuffer';

type ExecutionFrame = any;
type StatementsFrame = any;
type LabelScope = any;
type FrameBoundary = 'path' | 'function';
type LuaInstruction = any;

export type LuaCallFrame = {
	readonly functionName: string;
	readonly source: string;
	readonly line: number;
	readonly column: number;
};

const EMPTY_VALUES: LuaValue[] = Object.freeze([]) as unknown as LuaValue[];
const EMPTY_CALLSTACK: ReadonlyArray<LuaCallFrame> = Object.freeze([]) as unknown as ReadonlyArray<LuaCallFrame>;
const NIL_VALUE_RESULT: LuaValue[] = Object.freeze([null]) as unknown as LuaValue[];

export const enum SliceResult {
	Done = 0,
	Yield = 1,
	Pause = 2,
	Fault = 3,
}

export type ExecutionSignal =
	| null
	| { readonly kind: 'return' }
	| { readonly kind: 'break'; readonly originRange: LuaSourceRange }
	| { readonly kind: 'goto'; readonly label: string; readonly originRange: LuaSourceRange }
	| {
		readonly kind: 'yield';
		readonly location: { path: string; line: number; column: number };
		readonly callStack: ReadonlyArray<LuaCallFrame>;
		readonly resume: (instructionBudget: number) => ExecutionSignal;
	}
	| {
		readonly kind: 'pause';
		readonly reason: LuaDebuggerPauseReason;
		readonly location: { path: string; line: number; column: number };
		readonly callStack: ReadonlyArray<LuaCallFrame>;
		readonly exception?: LuaRuntimeError | LuaSyntaxError;
		readonly message?: string;
		readonly toString?: () => string;
		readonly resume: () => ExecutionSignal;
	};

type PauseSignal = Extract<ExecutionSignal, { kind: 'pause' }>;
type YieldSignal = Extract<ExecutionSignal, { kind: 'yield' }>;
type MutableYieldSignal = {
	kind: 'yield';
	location: { path: string; line: number; column: number };
	callStack: ReadonlyArray<LuaCallFrame>;
	resume: (instructionBudget: number) => ExecutionSignal;
};
type NestedInterpreterState = {
	frameStack: ExecutionFrame[];
	envStack: LuaEnvironment[];
	pathEnvironment: LuaEnvironment;
	currentChunk: string;
	valueNameCache: WeakMap<object | Function, string>;
	lastFaultCallStack: LuaCallFrame[];
	lastFaultDepth: number;
	lastFaultEnvironment: LuaEnvironment;
	callStackLength: number;
	currentCallRange: LuaSourceRange;
	programCounter: number;
	programCounterStack: number[];
	lastStatementRange: LuaSourceRange;
};

type ChunkExecutionContext = {
	readonly path: LuaChunk;
	readonly pathScope: LuaEnvironment;
	readonly nested: boolean;
	readonly savedState: NestedInterpreterState | null;
};

const NORMAL_SIGNAL: ExecutionSignal = null;
const RETURN_SIGNAL: ExecutionSignal = Object.freeze({ kind: 'return' } as const);

export class LuaExecutionThread {
	private readonly runImpl: (instructionBudget: number | null) => ExecutionSignal;
	private yielded: YieldSignal = null;
	private paused: PauseSignal = null;
	private fault: Error = null;

	constructor(runImpl: (instructionBudget: number | null) => ExecutionSignal) {
		this.runImpl = runImpl;
	}

	// start fallible-boundary -- Lua thread slices report runtime faults through SliceResult.Fault.
	public runSlice(instructionBudget: number | null): SliceResult {
		try {
			const signal = this.runImpl(instructionBudget);
			return this.consumeSignal(signal);
		} catch (error) {
			this.fault = error as Error;
			return SliceResult.Fault;
		}
	}
	// end fallible-boundary

	// start fallible-boundary -- Resuming a yielded Lua thread stores thrown faults in the thread state.
	public resumeSlice(instructionBudget: number): SliceResult {
		try {
			const yielded = this.yielded;
			this.yielded = null;
			const signal = yielded.resume(instructionBudget);
			return this.consumeSignal(signal);
		} catch (error) {
			this.fault = error as Error;
			return SliceResult.Fault;
		}
	}
	// end fallible-boundary

	private consumeSignal(signal: ExecutionSignal): SliceResult {
		if (!signal) {
			return SliceResult.Done;
		}
		switch (signal.kind) {
			case 'yield':
				this.yielded = signal as YieldSignal;
				return SliceResult.Yield;
			case 'pause':
				this.paused = signal as PauseSignal;
				return SliceResult.Pause;
			default:
				return SliceResult.Done;
		}
	}

	public get isYielded(): boolean {
		return this.yielded !== null;
	}

	public takePause(): PauseSignal {
		const signal = this.paused;
		this.paused = null;
		return signal;
	}

	public takeFault(): Error {
		const fault = this.fault;
		this.fault = null;
		return fault;
	}
}

export type LuaExceptionResumeStrategy = 'propagate' | 'skip_statement';

export class LuaNativeFunction implements LuaFunctionValue {
	public readonly name: string;
	private readonly handler: (args: ReadonlyArray<LuaValue>) => LuaCallResult;

	constructor(name: string, handler: (args: ReadonlyArray<LuaValue>) => LuaCallResult) {
		this.name = name;
		this.handler = handler;
	}

	public call(args: ReadonlyArray<LuaValue>): LuaCallResult {
		try {
			return this.handler(args);
		} catch (error) {
			Runtime.instance.interpreter.recordFaultCallStack();
			throw error;
		}
	}
}

class LuaScriptFunction implements LuaFunctionValue {
	public readonly name: string;
	public readonly range: LuaSourceRange;
	private readonly interpreter: LuaInterpreter;
	public readonly expression: LuaFunctionExpression;
	public readonly closure: LuaEnvironment;
	public readonly implicitSelfName: string;

	constructor(expression: LuaFunctionExpression, closure: LuaEnvironment, name: string, implicitSelfName: string, interpreter: LuaInterpreter) {
		this.name = name;
		this.interpreter = interpreter;
		this.expression = expression;
		this.closure = closure;
		this.implicitSelfName = implicitSelfName;
		this.range = expression.range;
	}

	public call(args: ReadonlyArray<LuaValue>): LuaCallResult {
		return this.interpreter.invokeScriptFunction(this.expression, this.closure, this.name, args, this.implicitSelfName);
	}

	public getSourceRange(): LuaSourceRange {
		return this.range;
	}
}

type ResolvedAssignmentTarget =
	| { readonly kind: 'identifier'; readonly name: string; readonly environment: LuaEnvironment }
	| { readonly kind: 'member'; readonly table: LuaTable; readonly key: string }
	| { readonly kind: 'index'; readonly table: LuaTable; readonly index: LuaValue }
	| { readonly kind: 'native-member'; readonly target: LuaNativeValue; readonly key: string }
	| { readonly kind: 'native-index'; readonly target: LuaNativeValue; readonly key: LuaValue };

export class LuaInterpreter {
	private readonly globals: LuaEnvironment;
	private currentChunk: string;
	private randomSeedValue: number;
	private _reservedIdentifiers: Set<string> = new Set<string>();
	private _currentCallRange: LuaSourceRange = null;
	private _pathEnvironment: LuaEnvironment = null;
	private readonly pathDefinitions: Map<string, ReadonlyArray<LuaDefinitionInfo>> = new Map();
	private _lastFaultEnvironment: LuaEnvironment = null;
	private _debuggerController: LuaDebuggerController = null;
	private _lastFaultCallStack: LuaCallFrame[] = [];
	private valueNameCache = new WeakMap<object | Function, string>();
	private lastFaultDepth: number = 0;
	private _pendingDebuggerException: LuaRuntimeError | LuaSyntaxError = null;
	private _exceptionResumeStrategy: LuaExceptionResumeStrategy = 'propagate';
	private pendingExceptionFrame: { frame: StatementsFrame; index: number } = null;
	private yieldTargetDepth = 0;
	private readonly yieldLocation = { path: '<path>', line: 0, column: 0 };
	private readonly yieldSignal: MutableYieldSignal;
	private readonly luaValueListScratch = new ScratchBuffer<LuaValue[]>(() => []);
	private luaValueListScratchIndex = 0;
	private readonly luaTableListScratch = new ScratchBuffer<LuaTable[]>(() => []);
	private luaTableListScratchIndex = 0;
	private readonly returnValueBuffer: LuaValue[] = [];
	private adapter!: LuaInteropAdapter;
	private nativeValueCache: WeakMap<object | Function, LuaNativeValue> = new WeakMap();
	private readonly nativeMethodCache: WeakMap<LuaNativeValue, Map<string, LuaFunctionValue>> = new WeakMap<
		LuaNativeValue,
		Map<string, LuaFunctionValue>
	>();
	private readonly packageTable: LuaTable;
	private readonly packageLoaded: LuaTable;
	private _requireHandler: ((interpreter: LuaInterpreter, moduleName: string) => LuaValue) = null;
	private _outputHandler: ((text: string) => void) = (text: string) => { console.log(text); Runtime.instance.terminal.appendStdout(text); };
	private instructionBudgetRemaining: number | null = null;
	private frameStack: ExecutionFrame[] = [];
	private envStack: LuaEnvironment[] = [];
	private callStack: any[] = [];
	private _programCounter = 0;
	private programCounterStack: number[] = [];
	private lastStatementRange: LuaSourceRange = null;
	private activeStatementRange: LuaSourceRange = null;
	private activeStatementFrame: StatementsFrame = null;

	public constructor(adapter: LuaInteropAdapter) {
		this.globals = LuaEnvironment.createRoot();
		this.adapter = adapter;
		this.currentChunk = '<path>';
		this.randomSeedValue = engineCore.platform.clock.now();
		this.packageTable = createLuaTable();
		this.packageLoaded = createLuaTable();
		this.initializeBuiltins();
		this._pathEnvironment = LuaEnvironment.createChild(this.globals);
		this.yieldSignal = {
			kind: 'yield',
			location: this.yieldLocation,
			callStack: EMPTY_CALLSTACK,
			resume: (instructionBudget: number) => this.runFrameLoop(this.yieldTargetDepth, instructionBudget),
		};
	}

	public execute(source: string, path: string): LuaValue[] {
		const chunk = this.compileChunk(source, path);
		this.loadChunk(chunk);
		return this.executeChunk(chunk);
	}

	public compileChunk(source: string, path: string): LuaChunk {
		const parseEntry = getCachedLuaParse({
			path,
			source,
			withSyntaxError: true,
		});
		if (parseEntry.syntaxError) {
			throw parseEntry.syntaxError;
		}
		const chunk = parseEntry.parsed.chunk!;
		this.validateReservedIdentifiers(chunk.body);
		this.pathDefinitions.set(chunk.range.path, chunk.definitions);
		return chunk;
	}

	public loadChunk(chunk: LuaChunk): void {
		void chunk;
		throw new Error('Interpreter CPU is disabled.');
	}

	public setReservedIdentifiers(names: Iterable<string>) {
		this._reservedIdentifiers = new Set(names as Iterable<string>);
	}

	public set hostAdapter(adapter: LuaInteropAdapter) {
		this.adapter = adapter;
	}

	public set requireHandler(handler: ((interpreter: LuaInterpreter, moduleName: string) => LuaValue)) {
		this._requireHandler = handler;
	}

	public attachDebugger(controller: LuaDebuggerController): void {
		this._debuggerController = controller;
	}

	public get debuggerController(): LuaDebuggerController | null {
		return this._debuggerController;
	}

	public get packageLoadedTable(): LuaTable {
		return this.packageLoaded;
	}

	public set outputHandler(handler: ((text: string) => void)) {
		this._outputHandler = handler;
	}

	public get outputHandler(): ((text: string) => void) {
		return this._outputHandler;
	}

	public get programCounter(): number {
		return this._programCounter;
	}

	public set programCounter(value: number) {
		this._programCounter = value;
	}

	public advanceProgramCounter(): number {
		this._programCounter += 1;
		return this._programCounter;
	}

	public allocateValueList(): LuaValue[] {
		const index = this.luaValueListScratchIndex++;
		const list = this.luaValueListScratch.get(index);
		list.length = 0;
		return list;
	}

	private allocateLuaTableList(): LuaTable[] {
		const index = this.luaTableListScratchIndex++;
		const list = this.luaTableListScratch.get(index);
		list.length = 0;
		return list;
	}

	private releaseLuaTableList(list: LuaTable[]): void {
		list.length = 0;
		this.luaTableListScratchIndex -= 1;
	}

	private consumeReturnValues(): LuaValue[] {
		const result = Array.from(this.returnValueBuffer);
		this.returnValueBuffer.length = 0;
		return result;
	}

	public pushProgramCounter(): number {
		this.programCounterStack.push(this._programCounter);
		return this._programCounter;
	}

	public popProgramCounter(): number {
		const value = this.programCounterStack.pop();
		this._programCounter = value;
		return this._programCounter;
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
		if (!this._requireHandler) {
			throw this.runtimeError('require is not enabled in this interpreter.');
		}
		const value = this._requireHandler(this, moduleName);
		return [value];
	}

	public getOrCreateNativeValue(value: object | Function, typeName?: string): LuaNativeValue {
		const cached = this.nativeValueCache.get(value);
		if (cached) {
			return cached;
		}
		const nativeValue = new LuaNativeValue(value, typeName);
		this.nativeValueCache.set(value, nativeValue);
		return nativeValue;
	}

	public get globalEnvironment(): LuaEnvironment {
		return this.globals;
	}

	public enumerateGlobalEntries(): ReadonlyArray<[string, LuaValue]> {
		return this.globals.entries();
	}

	public setGlobal(name: string, value: LuaValue, range?: LuaSourceRange): void {
		this.globals.set(name, value, range);
		this.cacheValueName(value, name);
	}

	public getGlobal(name: string): LuaValue {
		return this.globals.get(name);
	}

	public get randomSeed(): number {
		return this.randomSeedValue;
	}

	public set randomSeed(seed: number) {
		this.randomSeedValue = seed;
	}

	private beginChunkExecution(path: LuaChunk): ChunkExecutionContext {
		const nested = this.frameStack.length > 0;
		const savedState: NestedInterpreterState | null = nested ? {
			frameStack: Array.from(this.frameStack),
			envStack: Array.from(this.envStack),
			pathEnvironment: this._pathEnvironment,
			currentChunk: this.currentChunk,
			valueNameCache: this.valueNameCache,
			lastFaultCallStack: this._lastFaultCallStack,
			lastFaultDepth: this.lastFaultDepth,
			lastFaultEnvironment: this._lastFaultEnvironment,
			callStackLength: this.callStack.length,
			currentCallRange: this._currentCallRange,
			programCounter: this._programCounter,
			programCounterStack: Array.from(this.programCounterStack),
			lastStatementRange: this.lastStatementRange,
		} : null;

		this.valueNameCache = new WeakMap<object | Function, string>();
		this.currentChunk = path.range.path;
		const pathScope = LuaEnvironment.createChild(this.globals);
		this._pathEnvironment = pathScope;
		this.envStack.length = 0;
		this.frameStack.length = 0;
		this._lastFaultCallStack = [];
		this.lastFaultDepth = 0;
		this.programCounterStack.length = 0;
		this.lastStatementRange = null;
		const rootScope = this.createLabelScope(path.body, null);
		this.pushStatementsFrame({
			statements: path.body,
			environment: pathScope,
			varargs: [],
			scope: rootScope,
			boundary: 'path',
			callRange: path.range,
			callName: '<path>',
		});
		return { path, pathScope, nested, savedState };
	}

	private runChunkExecution(context: ChunkExecutionContext, instructionBudget: number | null): ExecutionSignal {
		let suspended = false;
		try {
			const signal = this.runFrameLoop(0, instructionBudget);
			if (signal !== null && signal.kind === 'return') {
				return signal;
			}
			if (signal !== null && signal.kind === 'break') {
				throw this.runtimeErrorAt(signal.originRange, 'Unexpected break outside of loop.');
			}
			if (signal !== null && signal.kind === 'goto') {
				throw this.runtimeErrorAt(signal.originRange, `Label '${signal.label}' not found.`);
			}
			if (signal !== null && signal.kind === 'pause') {
				suspended = true;
				return this.wrapPauseSignal(signal, (resumed) => {
					if (resumed !== null && resumed.kind === 'pause') {
						return resumed;
					}
					if (resumed !== null && resumed.kind === 'yield') {
						return this.wrapYieldSignal(resumed as YieldSignal, context);
					}
					return this.handleChunkContinuation(resumed, context);
				});
			}
			if (signal !== null && signal.kind === 'yield') {
				suspended = true;
				return this.wrapYieldSignal(signal as YieldSignal, context);
			}
			return NORMAL_SIGNAL;
		} catch (error) {
			this.recordFaultCallStack();
			throw error;
		} finally {
			if (!suspended) {
				this.finalizeChunkExecution(context.pathScope, context.savedState, context.nested);
			}
		}
	}

	public executeChunk(path: LuaChunk): LuaValue[] {
		const context = this.beginChunkExecution(path);
		const signal = this.runChunkExecution(context, null);
		if (signal !== null && signal.kind === 'return') {
			return this.consumeReturnValues();
		}
		return [];
	}

	public enumerateChunkEntries(): ReadonlyArray<[string, LuaValue]> {
		return this._pathEnvironment!.entries();
	}

	public get pathEnvironment(): LuaEnvironment {
		return this._pathEnvironment;
	}

	public getChunkDefinitions(path: string): ReadonlyArray<LuaDefinitionInfo> {
		return this.pathDefinitions.get(path);
	}

	public hasChunkBinding(name: string): boolean {
		return this._pathEnvironment!.resolve(name) !== null;
	}

	public assignChunkValue(name: string, value: LuaValue): void {
		const target = this._pathEnvironment!.resolve(name);
		target.assignExisting(name, value);
	}

	public get lastFaultEnvironment(): LuaEnvironment {
		return this._lastFaultEnvironment;
	}

	public clearLastFaultEnvironment(): void {
		this._lastFaultEnvironment = null;
		this._lastFaultCallStack = [];
		this.lastFaultDepth = 0;
	}

	public markFaultEnvironment(): void {
		this._lastFaultEnvironment = this.envStack.length > 0 ? this.envStack[this.envStack.length - 1] : null;
		this.recordFaultCallStack();
	}

	public get lastFaultCallStack(): ReadonlyArray<LuaCallFrame> {
		return this._lastFaultCallStack;
	}

	public resolveValueName(value: LuaValue): string | undefined {
		if (value === null) return undefined;
		if (typeof value !== 'object') return undefined;
		const cached = this.valueNameCache.get(value);
		if (cached) return cached;
		const pathEntries = this.enumerateChunkEntries();
		for (let i = 0; i < pathEntries.length; i++) {
			const entry = pathEntries[i]!;
			const name = entry[0];
			const entryValue = entry[1];
			this.cacheValueName(entryValue, name);
			if (entryValue === value) return name;
		}
		const globalEntries = this.enumerateGlobalEntries();
		for (let i = 0; i < globalEntries.length; i++) {
			const entry = globalEntries[i]!;
			const name = entry[0];
			const entryValue = entry[1];
			this.cacheValueName(entryValue, name);
			if (entryValue === value) return name;
		}
		return undefined;
	}

	private cacheValueName(value: LuaValue, name: string): void {
		if (value !== null && typeof value === 'object') {
			this.valueNameCache.set(value, name);
		}
	}

	public get pendingDebuggerException(): LuaRuntimeError | LuaSyntaxError {
		return this._pendingDebuggerException;
	}

	public set debuggerResumeStrategy(strategy: LuaExceptionResumeStrategy) {
		this._exceptionResumeStrategy = strategy;
	}

	public recordFaultCallStack(): void {
		const depth = this.callStack.length;
		if (depth === 0) {
			this._lastFaultCallStack = [];
			this.lastFaultDepth = 0;
			return;
		}
		const snapshot = this.callStack.map(frame => ({
			functionName: frame.functionName,
			source: frame.source,
			line: frame.line,
			column: frame.column,
		}));
		const snapshotDepth = snapshot.length;
		const innermostRange = this.activeStatementRange ?? this.lastStatementRange;
		if (innermostRange) {
			const innermost = snapshot[snapshot.length - 1];
			const alreadyCaptured =
				innermost.source === innermostRange.path &&
				innermost.line === innermostRange.start.line &&
				innermost.column === innermostRange.start.column;
			if (!alreadyCaptured) {
				innermost.source = innermostRange.path;
				innermost.line = innermostRange.start.line;
				innermost.column = innermostRange.start.column;
			}
		}
		if (this._lastFaultCallStack.length > 0 && snapshotDepth < this.lastFaultDepth) {
			return;
		}
		const controller = this._debuggerController;
		const decorated = controller ? controller.decorateCallStack(snapshot, { consume: false }) : snapshot;
		this._lastFaultCallStack = decorated.map(frame => ({
			functionName: frame.functionName,
			source: frame.source,
			line: frame.line,
			column: frame.column,
		}));
		this.lastFaultDepth = snapshotDepth;
	}

	private createLabelScope(statements: ReadonlyArray<LuaStatement>, parent: LabelScope): LabelScope {
		void statements;
		void parent;
		return {} as LabelScope;
	}

	private popFrame(): ExecutionFrame {
		return this.frameStack.pop();
	}

	private pushStatementsFrame(config: {
		readonly statements: ReadonlyArray<LuaStatement>;
		readonly environment: LuaEnvironment;
		readonly varargs: ReadonlyArray<LuaValue>;
		readonly scope: LabelScope;
		readonly boundary: FrameBoundary;
		readonly callRange: LuaSourceRange;
		readonly callName?: string;
	}): void {
		this.frameStack.push(config as ExecutionFrame);
	}

	private stepFrame(_frame: ExecutionFrame): ExecutionSignal {
		void _frame;
		throw new Error('Interpreter CPU is disabled.');
	}

	private popUntilBoundary(): void {
		this.frameStack.length = 0;
	}

	private tryConsumeBreak(): boolean {
		return false;
	}

	private tryConsumeGoto(_instruction: LuaInstruction): boolean {
		void _instruction;
		return false;
	}

	private runFrameLoop(targetDepth: number = 0, instructionBudget: number | null = null): ExecutionSignal {
		const ownsBudget = instructionBudget !== null;
		const previousBudget = this.instructionBudgetRemaining;
		if (ownsBudget) {
			this.instructionBudgetRemaining = instructionBudget;
		}
		try {
			while (this.frameStack.length > targetDepth) {
				if (this.instructionBudgetRemaining !== null && this.instructionBudgetRemaining <= 0) {
					return this.createYieldSignal(targetDepth);
				}
				const frame = this.frameStack[this.frameStack.length - 1];
				const scratchIndex = this.luaValueListScratchIndex;
				const tableScratchIndex = this.luaTableListScratchIndex;
				let signal: ExecutionSignal;
				try {
					signal = this.stepFrame(frame);
				} catch (error) {
					if (error instanceof LuaRuntimeError || error instanceof LuaSyntaxError) {
						this.markFaultEnvironment();
						this.markPendingException(error);
						const range = this.activeStatementRange ?? this.lastStatementRange ?? this.fallbackSourceRange();
						const pause = this.createPauseSignal('exception', range, error);
						return this.bindPauseResume(pause, targetDepth);
					}
					throw error;
				} finally {
					this.luaValueListScratchIndex = scratchIndex;
					this.luaTableListScratchIndex = tableScratchIndex;
				}
				if (signal !== null && signal.kind === 'pause') {
					return this.bindPauseResume(signal as PauseSignal, targetDepth);
				}
				if (signal === null) {
					if (this.instructionBudgetRemaining !== null && this.instructionBudgetRemaining <= 0) {
						return this.createYieldSignal(targetDepth);
					}
					continue;
				}
				const processed = this.processSignal(signal);
				if (processed !== null && processed.kind === 'pause') {
					return this.bindPauseResume(processed as PauseSignal, targetDepth);
				}
				if (processed === null) {
					if (this.instructionBudgetRemaining !== null && this.instructionBudgetRemaining <= 0) {
						return this.createYieldSignal(targetDepth);
					}
					continue;
				}
				return processed;
			}
			return NORMAL_SIGNAL;
		} finally {
			if (ownsBudget) {
				this.instructionBudgetRemaining = previousBudget;
			}
		}
	}

	private processSignal(signal: ExecutionSignal): ExecutionSignal {
		let current = signal;
		while (true) {
			if (current === null) {
				return NORMAL_SIGNAL;
			}
			if (current.kind === 'pause') {
				return current;
			}
			if (current.kind === 'return') {
				this.popUntilBoundary();
				return current;
			}
			if (current.kind === 'break') {
				if (this.tryConsumeBreak()) {
					current = NORMAL_SIGNAL;
					continue;
				}
				return current;
			}
			if (current.kind === 'goto') {
				if (this.tryConsumeGoto(current)) {
					current = NORMAL_SIGNAL;
					continue;
				}
				return current;
			}
			return current;
		}
	}

	private snapshotCallStack(): ReadonlyArray<LuaCallFrame> {
		const snapshot = this.callStack.map(frame => ({
			functionName: frame.functionName,
			source: frame.source,
			line: frame.line,
			column: frame.column,
		}));
		const controller = this._debuggerController;
		const decorated = controller ? controller.decorateCallStack(snapshot, { consume: true }) : snapshot;
		return decorated.map(frame => ({
			functionName: frame.functionName,
			source: frame.source,
			line: frame.line,
			column: frame.column,
		}));
	}

	public createPauseSignal(reason: LuaDebuggerPauseReason, range: LuaSourceRange, exception: LuaRuntimeError | LuaSyntaxError = null): PauseSignal {
		const location = { path: range.path, line: range.start.line, column: range.start.column };
		const message = exception ? exception.message : `${reason} at ${location.path}:${location.line}:${location.column}`;
		return {
			kind: 'pause',
			reason,
			location,
			callStack: this.snapshotCallStack(),
			exception,
			message,
			toString: () => message,
			resume: () => NORMAL_SIGNAL,
		};
	}

	private createYieldSignal(targetDepth: number): YieldSignal {
		const range = this.activeStatementRange ?? this.lastStatementRange ?? this.fallbackSourceRange();
		this.yieldTargetDepth = targetDepth;
		this.yieldLocation.path = range.path;
		this.yieldLocation.line = range.start.line;
		this.yieldLocation.column = range.start.column;
		this.yieldSignal.callStack = this.snapshotCallStack();
		return this.yieldSignal;
	}

	private wrapPauseSignal(signal: PauseSignal, continuation: (resumed: ExecutionSignal) => ExecutionSignal): PauseSignal {
		return {
			kind: 'pause',
			reason: signal.reason,
			location: signal.location,
			callStack: signal.callStack,
			exception: signal.exception,
			message: signal.message,
			toString: signal.toString,
			resume: () => {
				const resumed = signal.resume();
				if (resumed !== null && resumed.kind === 'pause') {
					return resumed;
				}
				return continuation(resumed);
			},
		};
	}

	private wrapYieldSignal(signal: YieldSignal, context: ChunkExecutionContext): YieldSignal {
		return {
			kind: 'yield',
			location: signal.location,
			callStack: signal.callStack,
			resume: (instructionBudget: number) => {
				const resumed = signal.resume(instructionBudget);
				if (resumed !== null && resumed.kind === 'yield') {
					return this.wrapYieldSignal(resumed as YieldSignal, context);
				}
				return this.handleChunkContinuation(resumed, context);
			},
		};
	}

	private bindPauseResume(signal: PauseSignal, targetDepth: number): ExecutionSignal {
		return {
			kind: 'pause',
			reason: signal.reason,
			location: signal.location,
			callStack: signal.callStack,
			exception: signal.exception,
			message: signal.message,
			toString: signal.toString,
			resume: () => this.resumeFromPause(targetDepth),
		};
	}

	public resumeFromPause(targetDepth: number): ExecutionSignal {
		const pending = this._pendingDebuggerException;
		const strategy = this._exceptionResumeStrategy;
		this._pendingDebuggerException = null;
		this._exceptionResumeStrategy = 'propagate';
		if (pending !== null) {
			if (strategy === 'propagate') {
				this.pendingExceptionFrame = null;
				throw pending;
			}
			if (strategy === 'skip_statement') {
				this.skipPendingExceptionFrame();
			}
		}
		return this.runFrameLoop(targetDepth);
	}

	public markPendingException(error: LuaRuntimeError | LuaSyntaxError): void {
		this._pendingDebuggerException = error;
		const frame = this.activeStatementFrame;
		this.pendingExceptionFrame = frame ? { frame, index: frame.index } : null;
	}

	private skipPendingExceptionFrame(): void {
		if (this.pendingExceptionFrame !== null) {
			const { frame, index } = this.pendingExceptionFrame;
			if (this.frameStack.includes(frame)) {
				frame.index = index + 1;
			}
			this.pendingExceptionFrame = null;
		}
	}

	private finalizeFunctionExecution(startingDepth: number): void {
		while (this.frameStack.length > startingDepth) {
			this.popFrame();
		}
	}

	private finalizeChunkExecution(pathScope: LuaEnvironment, savedState: NestedInterpreterState | null, nested: boolean): void {
		if (nested) {
			this.frameStack.length = 0;
			this.envStack.length = 0;
			for (const frame of savedState.frameStack) {
				this.frameStack.push(frame);
			}
			for (const env of savedState.envStack) {
				this.envStack.push(env);
			}
			this._pathEnvironment = savedState.pathEnvironment;
			this.currentChunk = savedState.currentChunk;
			this.valueNameCache = savedState.valueNameCache;
			this._lastFaultCallStack = savedState.lastFaultCallStack;
			this.lastFaultDepth = savedState.lastFaultDepth;
			this._lastFaultEnvironment = savedState.lastFaultEnvironment;
			this._currentCallRange = savedState.currentCallRange;
			this._programCounter = savedState.programCounter;
			this.programCounterStack.length = 0;
			for (const pc of savedState.programCounterStack) {
				this.programCounterStack.push(pc);
			}
			this.lastStatementRange = savedState.lastStatementRange;
			this.callStack.length = savedState.callStackLength;
			return;
		}
		this.frameStack.length = 0;
		this.envStack.length = 0;
		this._pathEnvironment = pathScope;
	}

	private handleChunkContinuation(signal: ExecutionSignal, context: ChunkExecutionContext): ExecutionSignal {
		if (signal !== null && signal.kind === 'return') {
			this.finalizeChunkExecution(context.pathScope, context.savedState, context.nested);
			return RETURN_SIGNAL;
		}
		if (signal !== null && signal.kind === 'break') {
			this.finalizeChunkExecution(context.pathScope, context.savedState, context.nested);
			throw this.runtimeErrorAt(signal.originRange, 'Unexpected break outside of loop.');
		}
		if (signal !== null && signal.kind === 'goto') {
			this.finalizeChunkExecution(context.pathScope, context.savedState, context.nested);
			throw this.runtimeErrorAt(signal.originRange, `Label '${signal.label}' not found.`);
		}
		this.finalizeChunkExecution(context.pathScope, context.savedState, context.nested);
		return NORMAL_SIGNAL;
	}

	public executeLocalAssignment(statement: LuaLocalAssignmentStatement, environment: LuaEnvironment, varargs: ReadonlyArray<LuaValue>): void {
		if (statement.names.length === 1 && statement.attributes[0] === 'const' && statement.values.length === 1 && statement.values[0].kind === LuaSyntaxKind.FunctionExpression) {
			const identifier = statement.names[0];
			environment.set(identifier.name, null, identifier.range);
			const functionValue = new LuaScriptFunction(statement.values[0] as LuaFunctionExpression, environment, identifier.name, null, this);
			environment.assignExisting(identifier.name, functionValue, true);
			return;
		}
		const values = this.evaluateExpressionList(statement.values, environment, varargs);
		const lastIndex = statement.values.length - 1;
		const lastExpression = lastIndex >= 0 ? statement.values[lastIndex] : null;
		const hasMultiReturn = lastExpression !== null && this.isMultiReturnExpression(lastExpression);
		for (let index = 0; index < statement.names.length; index += 1) {
			const identifier = statement.names[index];
			if (statement.attributes[index] === 'const') {
				const hasInitializer = statement.values.length > 0 && (index < lastIndex || index === lastIndex || hasMultiReturn);
				if (!hasInitializer) {
					throw this.runtimeErrorAt(identifier.range, `Constant local '${identifier.name}' must have an initializer.`);
				}
			}
			const value = index < values.length ? values[index] : null;
			environment.set(identifier.name, value, identifier.range, statement.attributes[index] === 'const');
		}
	}

	public executeLocalFunction(statement: LuaLocalFunctionStatement, environment: LuaEnvironment): void {
		environment.set(statement.name.name, null, statement.name.range);
		const functionValue = new LuaScriptFunction(statement.functionExpression, environment, statement.name.name, null, this);
		environment.assignExisting(statement.name.name, functionValue);
	}

	public executeFunctionDeclaration(statement: LuaFunctionDeclarationStatement, environment: LuaEnvironment): void {
		const functionNameParts = statement.name.identifiers;
		if (functionNameParts.length === 0) {
			throw this.runtimeErrorAt(statement.range, 'Function declaration missing name.');
		}
		const functionDisplayName = this.composeFunctionName(statement.name);
		const implicitSelfName = statement.name.methodName !== null ? 'self' : null;
		const functionValue = new LuaScriptFunction(statement.functionExpression, environment, functionDisplayName, implicitSelfName, this);

		if (statement.name.methodName !== null) {
			const methodTable = this.resolveTableFromPath(functionNameParts, environment, functionDisplayName, statement.range);
			methodTable.set(statement.name.methodName, functionValue);
			return;
		}

		if (functionNameParts.length === 1) {
			const resolvedEnv = environment.resolve(functionNameParts[0], statement.range);
			if (resolvedEnv !== null) {
				resolvedEnv.assignExisting(functionNameParts[0], functionValue);
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
		const currentValue: LuaValue = this.lookupIdentifier(parts[0], environment, range);
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

	public executeAssignment(statement: LuaAssignmentStatement, environment: LuaEnvironment, varargs: ReadonlyArray<LuaValue>): void {
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

	public executeReturn(statement: LuaReturnStatement, environment: LuaEnvironment, varargs: ReadonlyArray<LuaValue>): ExecutionSignal {
		const values = this.allocateValueList();
		this.appendExpressionListInto(statement.expressions, environment, varargs, values);
		this.returnValueBuffer.length = 0;
		for (let index = 0; index < values.length; index += 1) {
			this.returnValueBuffer.push(values[index]);
		}
		return RETURN_SIGNAL;
	}

	public assignGenericLoopVariables(statement: LuaForGenericStatement, loopEnvironment: LuaEnvironment, results: ReadonlyArray<LuaValue>): void {
		for (let index = 0; index < statement.variables.length; index += 1) {
			const variable = statement.variables[index];
			const value = index < results.length ? results[index] : null;
			loopEnvironment.assignExisting(variable.name, value);
		}
	}

	public evaluateExpressionList(expressions: ReadonlyArray<LuaExpression>, environment: LuaEnvironment, varargs: ReadonlyArray<LuaValue>): LuaValue[] {
		if (expressions.length === 0) {
			return EMPTY_VALUES;
		}
		const results = this.allocateValueList();
		this.evaluateExpressionListInto(expressions, environment, varargs, results);
		return results;
	}

	private evaluateExpressionListInto(expressions: ReadonlyArray<LuaExpression>, environment: LuaEnvironment, varargs: ReadonlyArray<LuaValue>, out: LuaValue[]): void {
		out.length = 0;
		this.appendExpressionListInto(expressions, environment, varargs, out);
	}

	private appendExpressionListInto(expressions: ReadonlyArray<LuaExpression>, environment: LuaEnvironment, varargs: ReadonlyArray<LuaValue>, out: LuaValue[]): void {
		if (expressions.length === 0) {
			return;
		}
		for (let index = 0; index < expressions.length; index += 1) {
			const expression = expressions[index];
			if (index === expressions.length - 1) {
				this.evaluateExpressionAllInto(expression, environment, varargs, out);
				continue;
			}
			out.push(this.evaluateExpressionFirst(expression, environment, varargs));
		}
	}

	private evaluateExpressionAllInto(expression: LuaExpression, environment: LuaEnvironment, varargs: ReadonlyArray<LuaValue>, out: LuaValue[]): void {
		switch (expression.kind) {
			case LuaSyntaxKind.VarargExpression:
				for (let index = 0; index < varargs.length; index += 1) {
					out.push(varargs[index]);
				}
				return;
			case LuaSyntaxKind.CallExpression: {
				const values = this.evaluateCallExpression(expression as LuaCallExpression, environment, varargs);
				for (let index = 0; index < values.length; index += 1) {
					out.push(values[index]);
				}
				return;
			}
			default:
				out.push(this.evaluateExpressionFirst(expression, environment, varargs));
				return;
		}
	}

	private isMultiReturnExpression(expression: LuaExpression): boolean {
		return expression.kind === LuaSyntaxKind.CallExpression || expression.kind === LuaSyntaxKind.VarargExpression;
	}

	private evaluateExpressionFirst(expression: LuaExpression, environment: LuaEnvironment, varargs: ReadonlyArray<LuaValue>): LuaValue {
		switch (expression.kind) {
			case LuaSyntaxKind.NumericLiteralExpression:
				return expression.value;
			case LuaSyntaxKind.StringLiteralExpression:
				return expression.value;
			case LuaSyntaxKind.BooleanLiteralExpression:
				return expression.value;
			case LuaSyntaxKind.NilLiteralExpression:
				return null;
			case LuaSyntaxKind.VarargExpression:
				return varargs.length > 0 ? varargs[0] : null;
			case LuaSyntaxKind.IdentifierExpression:
				return this.lookupIdentifier(expression.name, environment, expression.range);
			case LuaSyntaxKind.FunctionExpression:
				return new LuaScriptFunction(expression as LuaFunctionExpression, environment, '<anonymous>', null, this);
			case LuaSyntaxKind.TableConstructorExpression:
				return this.evaluateTableConstructor(expression as LuaTableConstructorExpression, environment, varargs);
			case LuaSyntaxKind.BinaryExpression:
				return this.evaluateBinaryExpression(expression as LuaBinaryExpression, environment, varargs);
			case LuaSyntaxKind.UnaryExpression:
				return this.evaluateUnaryExpression(expression as LuaUnaryExpression, environment, varargs);
			case LuaSyntaxKind.CallExpression: {
				const values = this.evaluateCallExpression(expression as LuaCallExpression, environment, varargs);
				return values.length > 0 ? values[0] : null;
			}
			case LuaSyntaxKind.MemberExpression:
				return this.evaluateMemberExpression(expression as LuaMemberExpression, environment, varargs);
			case LuaSyntaxKind.IndexExpression:
				return this.evaluateIndexExpression(expression as LuaIndexExpression, environment, varargs);
			default:
				throw this.runtimeError('Unsupported expression kind.');
		}
	}

	public evaluateSingleExpression(expression: LuaExpression, environment: LuaEnvironment, varargs: ReadonlyArray<LuaValue>): LuaValue {
		return this.evaluateExpressionFirst(expression, environment, varargs);
	}

	private evaluateMemberExpression(expression: LuaMemberExpression, environment: LuaEnvironment, varargs: ReadonlyArray<LuaValue>): LuaValue {
		const baseValue = this.evaluateSingleExpression(expression.base, environment, varargs);
		if (isLuaTable(baseValue)) {
			return this.getTableValueWithMetamethod(baseValue, expression.identifier, expression.range);
		}
		if (baseValue instanceof LuaNativeValue) {
			return this.getNativeValueWithMetamethod(baseValue, expression.identifier, expression.range);
		}
		throw this.runtimeErrorAt(expression.range, 'Attempted to index field on a non-table value.');
	}

	private evaluateIndexExpression(expression: LuaIndexExpression, environment: LuaEnvironment, varargs: ReadonlyArray<LuaValue>): LuaValue {
		const baseValue = this.evaluateSingleExpression(expression.base, environment, varargs);
		if (isLuaTable(baseValue)) {
			const indexValue = this.evaluateExpressionFirst(expression.index, environment, varargs);
			return this.getTableValueWithMetamethod(baseValue, indexValue, expression.range);
		}
		if (baseValue instanceof LuaNativeValue) {
			const indexValue = this.evaluateExpressionFirst(expression.index, environment, varargs);
			return this.getNativeValueWithMetamethod(baseValue, indexValue, expression.range);
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
				return this.unaryMetamethodOrThrow(operand, '__unm', expression.range, 'Unary minus operand must be a number or define __unm metamethod.');
			case LuaUnaryOperator.Not:
				return !this.isTruthy(operand);
			case LuaUnaryOperator.Length:
				if (typeof operand === 'string') {
					return operand.length;
				}
				if (isLuaTable(operand)) {
					const lenArgs = this.allocateValueList();
					lenArgs.push(operand);
					const metamethodResult = this.invokeMetamethod(operand, '__len', lenArgs);
					if (isLuaCallSignal(metamethodResult)) {
						return metamethodResult as any;
					}
					if (metamethodResult !== null) {
						const first = metamethodResult.length > 0 ? metamethodResult[0] : null;
						return this.expectNumber(first, 'Metamethod __len must return a number.', expression.range);
					}
					return operand.numericLength();
				}
				if (operand instanceof LuaNativeValue) {
					// Allow # to work on native JS arrays to keep Lua length checks consistent with 0-based native arrays.
					const native = operand.native;
					if (Array.isArray(native)) {
						return native.length;
					}
					const metatable = this.getMetatableForValue(operand);
					if (metatable !== null) {
						const handler = metatable.get('__len');
						if (handler !== null) {
							const fn = this.expectFunction(handler, '__len metamethod must be a function.', expression.range);
							const args = this.allocateValueList();
							args.push(operand);
							const first = this.firstCallValue(fn.call(args));
							return this.expectNumber(first, '__len metamethod must return a number.', expression.range);
						}
					}
				}
				throw this.runtimeErrorAt(expression.range, 'Length operator expects a string or table.');
			case LuaUnaryOperator.BitwiseNot:
				if (typeof operand === 'number') {
					return this.bitwiseNot(operand);
				}
				return this.unaryMetamethodOrThrow(operand, '__bnot', expression.range, 'Bitwise not operand must be a number or define __bnot metamethod.');
			default:
				throw this.runtimeErrorAt(expression.range, 'Unsupported unary operator.');
		}
	}

	public evaluateCallExpression(expression: LuaCallExpression, environment: LuaEnvironment, varargs: ReadonlyArray<LuaValue>): LuaValue[] {
		const calleeValue = this.evaluateSingleExpression(expression.callee, environment, varargs);
		if (expression.methodName !== null) {
			if (isLuaTable(calleeValue)) {
				const methodValue = this.getTableValueWithMetamethod(calleeValue, expression.methodName, expression.range);
				const functionValue = this.expectFunction(methodValue, LuaInterpreter.buildMethodNotFoundOnTableMessage, expression.methodName, expression.range);
				const args = this.buildCallArguments(expression, environment, varargs, calleeValue);
				return this.invokeFunction(functionValue, args, expression.range);
			}
			if (calleeValue instanceof LuaNativeValue) {
				const methodValue = this.getNativeValueWithMetamethod(calleeValue, expression.methodName, expression.range);
				const functionValue = this.expectFunction(methodValue, LuaInterpreter.buildMethodNotFoundOnNativeValueMessage, expression.methodName, expression.range);
				const args = this.buildCallArguments(expression, environment, varargs, calleeValue);
				return this.invokeFunction(functionValue, args, expression.range);
			}
			throw this.runtimeErrorAt(expression.range, 'Method call requires a table or native instance.');
		}
		if (isLuaTable(calleeValue) || calleeValue instanceof LuaNativeValue) {
			const callMetamethod = this.extractMetamethodFunction(calleeValue, '__call', expression.range);
			if (callMetamethod !== null) {
				const args = this.buildCallArguments(expression, environment, varargs, calleeValue);
				return this.invokeFunction(callMetamethod, args, expression.range);
			}
		}
		const functionValue = this.expectFunction(calleeValue, LuaInterpreter.buildCallErrorMessage, expression.callee, calleeValue, expression.range);
		const args = this.buildCallArguments(expression, environment, varargs, null);
		return this.invokeFunction(functionValue, args, expression.range);
	}

	private buildCallArguments(expression: LuaCallExpression, environment: LuaEnvironment, varargs: ReadonlyArray<LuaValue>, selfValue: LuaValue): LuaValue[] {
		if (selfValue === null && expression.arguments.length === 0) {
			return EMPTY_VALUES;
		}
		const args = this.allocateValueList();
		if (selfValue !== null) {
			args.push(selfValue);
		}
		this.appendExpressionListInto(expression.arguments, environment, varargs, args);
		return args;
	}

	private evaluateTableConstructor(expression: LuaTableConstructorExpression, environment: LuaEnvironment, varargs: ReadonlyArray<LuaValue>): LuaTable {
		const table = createLuaTable();
		const arrayFieldValues = this.allocateValueList();
		let arrayIndex = 1;
		for (const field of expression.fields) {
			if (field.kind === LuaTableFieldKind.Array) {
				const arrayField = field as LuaTableArrayField;
				arrayFieldValues.length = 0;
				this.evaluateExpressionAllInto(arrayField.value, environment, varargs, arrayFieldValues);
				if (arrayFieldValues.length === 0) {
					table.set(arrayIndex, null);
					arrayIndex += 1;
				}
				else {
					for (const value of arrayFieldValues) {
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
				const keyValue = this.evaluateExpressionFirst(expressionField.key, environment, varargs);
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
			const resolvedEnvironment = environment.resolve(identifier.name, identifier.range);
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
			if (baseValue instanceof LuaNativeValue) {
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
			const indexValue = this.evaluateExpressionFirst(indexExpression.index, environment, varargs);
			if (isLuaTable(baseValue)) {
				return {
					kind: 'index',
					table: baseValue,
					index: indexValue,
				};
			}
			if (baseValue instanceof LuaNativeValue) {
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
				target.environment.assignExisting(target.name, value);
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
			const value = this.lookupIdentifier(target.name, environment, range);
			return value;
		}
		if (target.kind === 'member') {
			return this.getTableValueWithMetamethod(target.table, target.key, range);
		}
		if (target.kind === 'index') {
			return this.getTableValueWithMetamethod(target.table, target.index, range);
		}
		if (target.kind === 'native-member') {
			return this.getNativeValueWithMetamethod(target.target, target.key, range);
		}
		if (target.kind === 'native-index') {
			return this.getNativeValueWithMetamethod(target.target, target.key, range);
		}
		throw this.runtimeError('Unsupported assignment target kind.');
	}

		private tableVisited(visited: ReadonlyArray<LuaTable>, table: LuaTable): boolean {
			for (let index = 0; index < visited.length; index += 1) {
				if (visited[index] === table) {
					return true;
				}
			}
			return false;
		}

		private invokeNewIndexMetamethod(receiver: LuaTable, key: LuaValue, value: LuaValue, functionValue: LuaFunctionValue): void {
			const args = this.allocateValueList();
			args.push(receiver);
			args.push(key);
			args.push(value);
			const result = functionValue.call(args);
			if (isLuaCallSignal(result)) {
				return;
			}
		}

		private getTableValueWithMetamethod(table: LuaTable, key: LuaValue, range: LuaSourceRange): LuaValue {
			const direct = table.get(key);
			if (direct !== null) {
				return direct;
			}
			const metatable = table.getMetatable();
			if (metatable === null) {
				return null;
			}
			const firstHandler = metatable.get('__index');
			if (firstHandler === null) {
				return null;
			}
			if (!isLuaTable(firstHandler)) {
				const functionValue = this.expectFunction(firstHandler, '__index metamethod must be a function or table.', range);
				return this.callFunctionForFirstValue(functionValue, table, key);
			}
			let current = firstHandler;
			let visited: LuaTable[] | null = this.allocateLuaTableList();
			visited.push(table);
			try {
				for (;;) {
					if (this.tableVisited(visited, current)) {
						throw this.throwErrorWithRangeOrCurrentRange(range, 'Metatable __index loop detected.');
					}
					visited.push(current);
					const currentDirect = current.get(key);
					if (currentDirect !== null) {
						return currentDirect;
					}
					const currentMetatable = current.getMetatable();
					if (currentMetatable === null) {
						return null;
					}
					const handler = currentMetatable.get('__index');
					if (handler === null) {
						return null;
					}
					if (isLuaTable(handler)) {
						current = handler;
						continue;
					}
					const functionValue = this.expectFunction(handler, '__index metamethod must be a function or table.', range);
					const receiver = current;
					this.releaseLuaTableList(visited);
					visited = null;
					return this.callFunctionForFirstValue(functionValue, receiver, key);
				}
			} finally {
				if (visited !== null) {
					this.releaseLuaTableList(visited);
				}
			}
		}

		private setTableValueWithMetamethod(table: LuaTable, key: LuaValue, value: LuaValue, range: LuaSourceRange): void {
			if (table.has(key)) {
				table.set(key, value);
				return;
		}
		const metatable = table.getMetatable();
			if (metatable === null) {
				table.set(key, value);
				return;
			}
			const firstHandler = metatable.get('__newindex');
			if (firstHandler === null) {
				table.set(key, value);
				return;
			}
			if (!isLuaTable(firstHandler)) {
				const functionValue = this.expectFunction(firstHandler, '__newindex metamethod must be a function or table.', range);
				this.invokeNewIndexMetamethod(table, key, value, functionValue);
				return;
			}
			let current = firstHandler;
			let visited: LuaTable[] | null = this.allocateLuaTableList();
			visited.push(table);
			try {
				for (;;) {
					if (this.tableVisited(visited, current)) {
						throw this.runtimeErrorAt(range, 'Metatable __newindex loop detected.');
					}
					visited.push(current);
					if (current.has(key)) {
						current.set(key, value);
						return;
					}
					const currentMetatable = current.getMetatable();
					if (currentMetatable === null) {
						current.set(key, value);
						return;
					}
					const handler = currentMetatable.get('__newindex');
					if (handler === null) {
						current.set(key, value);
						return;
					}
					if (isLuaTable(handler)) {
						current = handler;
						continue;
					}
					const functionValue = this.expectFunction(handler, '__newindex metamethod must be a function or table.', range);
					const receiver = current;
					this.releaseLuaTableList(visited);
					visited = null;
					this.invokeNewIndexMetamethod(receiver, key, value, functionValue);
					return;
				}
			} finally {
				if (visited !== null) {
					this.releaseLuaTableList(visited);
				}
			}
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

	private invokeMetamethod(table: LuaTable, name: string, args: ReadonlyArray<LuaValue>): LuaCallResult {
		const metatable = table.getMetatable();
		if (metatable === null) {
			return null;
		}
		const handler = metatable.get(name);
		if (handler === null) {
			return null;
		}
		const functionValue = this.expectFunction(handler, LuaInterpreter.buildMetamethodMustBeFunctionMessage, name, null);
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
				value.forEachEntry((key, entryValue) => {
					const serializedKey = this.serializeValueInternal(key, visited);
					const serializedValue = this.serializeValueInternal(entryValue, visited);
					entriesData.push({ key: serializedKey, value: serializedValue });
				});
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
		let methodName: string = null;
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
		let value: LuaValue = this.globals.get(segments[0]);
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
		const functionValue = this.expectFunction(value, LuaInterpreter.buildFunctionNotFoundDuringDeserializationMessage, name, null);
		return functionValue;
	}

	private lookupIdentifier(name: string, environment: LuaEnvironment, accessRange: LuaSourceRange | null = null): LuaValue {
		const value = environment.get(name, accessRange);
		if (value !== null) {
			return value;
		}
		return this.globals.get(name, accessRange);
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
		if (left instanceof LuaNativeValue && right instanceof LuaNativeValue) {
			return left.native === right.native;
		}
		const handler = this.extractSharedMetamethodFunction(left, right, '__eq', expression.range);
		if (handler !== null) {
			const args = this.allocateValueList();
			args.push(left);
			args.push(right);
			const result = handler.call(args);
			if (isLuaCallSignal(result)) {
				return result as any;
			}
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
			const args = this.allocateValueList();
			args.push(metaLeft);
			args.push(metaRight);
			const result = handler.call(args);
			if (isLuaCallSignal(result)) {
				return result as any;
			}
			const first = result.length > 0 ? result[0] : null;
			return this.expectBoolean(first, LuaInterpreter.buildMetamethodMustReturnBooleanMessage, metamethodName, expression.range);
		}
		// Fail, so let's see whether we can give a better error message
		if (left === null || left === undefined) {
			throw this.runtimeErrorAt(expression.left.range, `Attempt to compare nil value to ${right ?? 'nil'}: ${message}`);
		}
		else throw this.runtimeErrorAt(expression.range, message);
	}

	private invokeUnaryMetamethod(operand: LuaValue, name: string, range: LuaSourceRange): LuaValue {
		const handler = this.extractMetamethodFunction(operand, name, range);
		if (handler === null) {
			return null;
		}
		const args = this.allocateValueList();
		args.push(operand);
		return this.firstCallValue(handler.call(args));
	}

	private invokeBinaryMetamethod(left: LuaValue, right: LuaValue, name: string, range: LuaSourceRange): LuaValue {
		const leftHandler = this.extractMetamethodFunction(left, name, range);
		if (leftHandler !== null) {
			return this.callFunctionForFirstValue(leftHandler, left, right);
		}
		const rightHandler = this.extractMetamethodFunction(right, name, range);
		if (rightHandler !== null) {
			return this.callFunctionForFirstValue(rightHandler, left, right);
		}
		return null;
	}

	private extractMetamethodFunction(value: LuaValue, name: string, range: LuaSourceRange): LuaFunctionValue {
		let metatable: LuaTable = null;
		if (isLuaTable(value)) {
			metatable = value.getMetatable();
		} else if (value instanceof LuaNativeValue) {
			metatable = value.metatable;
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
		return this.expectFunction(handler, LuaInterpreter.buildMetamethodMustBeFunctionMessage, name, range);
	}

	private getMetatableForValue(value: LuaValue): LuaTable {
		if (isLuaTable(value)) {
			return value.getMetatable();
		}
		if (value instanceof LuaNativeValue) {
			return value.metatable;
		}
		return null;
	}

	private extractSharedMetamethodFunction(left: LuaValue, right: LuaValue, name: string, range: LuaSourceRange): LuaFunctionValue {
		const leftMetatable = this.getMetatableForValue(left);
		const rightMetatable = this.getMetatableForValue(right);
		if (leftMetatable === null || rightMetatable === null || leftMetatable !== rightMetatable) {
			return null;
		}
		const handler = leftMetatable.get(name);
		if (handler === null) {
			return null;
		}
		return this.expectFunction(handler, LuaInterpreter.buildMetamethodMustBeFunctionMessage, name, range);
	}

	public isTruthy(value: LuaValue): boolean {
		if (value === null) {
			return false;
		}
		if (value === false) {
			return false;
		}
		return true;
	}

	private argumentOrNil(args: ReadonlyArray<LuaValue>, index: number): LuaValue {
		if (index < args.length) {
			return args[index];
		}
		return null;
	}

	private firstCallValue(result: LuaCallResult): LuaValue {
		if (isLuaCallSignal(result)) {
			return result as any;
		}
		return result.length > 0 ? result[0] : null;
	}

	private callFunctionForFirstValue(functionValue: LuaFunctionValue, first: LuaValue, second: LuaValue): LuaValue {
		const args = this.allocateValueList();
		args.push(first);
		args.push(second);
		return this.firstCallValue(functionValue.call(args));
	}

	private unaryMetamethodOrThrow(operand: LuaValue, name: string, range: LuaSourceRange, message: string): LuaValue {
		const result = this.invokeUnaryMetamethod(operand, name, range);
		if (result !== null) {
			return result;
		}
		throw this.runtimeErrorAt(range, message);
	}

	private protectedCallSuccess(result: LuaCallResult): LuaCallResult {
		if (isLuaCallSignal(result)) {
			return result;
		}
		const values = this.allocateValueList();
		values.push(true);
		for (let index = 0; index < result.length; index += 1) {
			values.push(result[index]);
		}
		return values;
	}

	public expectNumber(value: LuaValue, message: string, range: LuaSourceRange | null): number;
	public expectNumber<A>(value: LuaValue, messageFactory: (arg: A) => string, arg: A, range: LuaSourceRange | null): number;
	public expectNumber(value: LuaValue, messageOrFactory: string | ((arg: unknown) => string), argOrRange: unknown, range?: LuaSourceRange | null): number {
		if (typeof value === 'number') {
			return value;
		}
		if (typeof messageOrFactory === 'string') {
			this.throwErrorWithRangeOrCurrentRange(argOrRange as LuaSourceRange | null, messageOrFactory);
		}
		this.throwErrorWithRangeOrCurrentRange(range, (messageOrFactory as (arg: unknown) => string)(argOrRange));
	}

	private static describeNonFunctionValue(value: LuaValue): string {
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
		if (value instanceof LuaNativeValue) {
			return 'a native value';
		}
		return 'a non-callable value';
	}

	private static buildCallErrorMessage(callee: LuaExpression, value: LuaValue): string {
		const description = LuaInterpreter.describeNonFunctionValue(value);
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

	private static buildMethodNotFoundOnTableMessage(methodName: string): string {
		return `Method '${methodName}' not found on table.`;
	}

	private static buildMethodNotFoundOnNativeValueMessage(methodName: string): string {
		return `Method '${methodName}' not found on native value.`;
	}

	private static buildMetamethodMustBeFunctionMessage(name: string): string {
		return `Metamethod ${name} must be a function.`;
	}

	private static buildFunctionNotFoundDuringDeserializationMessage(name: string): string {
		return `Function '${name}' not found during deserialization.`;
	}

	private static buildMetamethodMustReturnBooleanMessage(metamethodName: string): string {
		return `${metamethodName} metamethod must return a boolean.`;
	}

	private static buildStringFormatSpecifierNumberMessage(specifier: string): string {
		return `string.format %${specifier} expects a number.`;
	}

	private expectBoolean(value: LuaValue, message: string, range: LuaSourceRange | null): boolean;
	private expectBoolean<A>(value: LuaValue, messageFactory: (arg: A) => string, arg: A, range: LuaSourceRange | null): boolean;
	private expectBoolean(value: LuaValue, messageOrFactory: string | ((arg: unknown) => string), argOrRange: unknown, range?: LuaSourceRange | null): boolean {
		if (typeof value === 'boolean') {
			return value;
		}
		if (typeof messageOrFactory === 'string') {
			this.throwErrorWithRangeOrCurrentRange(argOrRange as LuaSourceRange | null, messageOrFactory);
		}
		this.throwErrorWithRangeOrCurrentRange(range, (messageOrFactory as (arg: unknown) => string)(argOrRange));
	}

	// TODO: Eigenlijk verraadt deze naming-pijn dat de signature zelf te polymorf is.
	// Je bent handmatig overloads aan het demultiplexen in één implementatie met “arg soup”.

	// Dus los van de naam is de echte geur:

	// te veel positional overload ambiguity
	// runtime parsing van argumentrollen
	// namen moeten dat puin opvangen

	// Als je ooit zin hebt om dit echt strak te trekken, dan zou ik intern één private helper maken met een genormaliseerde shape, zoiets als:
	public expectFunction(value: LuaValue, message: string, range: LuaSourceRange | null): LuaFunctionValue;
	public expectFunction<A>(value: LuaValue, messageFactory: (arg: A) => string, arg: A, range: LuaSourceRange | null): LuaFunctionValue;
	public expectFunction<A, B>(value: LuaValue, messageFactory: (argA: A, argB: B) => string, argA: A, argB: B, range: LuaSourceRange | null): LuaFunctionValue;
	public expectFunction(
		value: LuaValue,
		messageOrFactory: string | ((arg1: unknown, arg2?: unknown) => string),
		firstExtraArgOrRange: unknown,
		secondExtraArgOrRange?: unknown,
		explicitRange?: LuaSourceRange | null,
	): LuaFunctionValue {
		const range = explicitRange !== undefined
			? explicitRange
			: (secondExtraArgOrRange !== undefined ? (secondExtraArgOrRange as LuaSourceRange | null) : (firstExtraArgOrRange as LuaSourceRange | null));
		if (value instanceof LuaNativeValue) {
			return this.getOrCreateNativeCallable(value, range);
		}
		if (isLuaFunctionValue(value)) {
			return value;
		}
			const valueTypeSuffix = this.valueTypeSuffix(value);
			if (typeof messageOrFactory === 'string') {
				const failureMessage = `${messageOrFactory}${valueTypeSuffix}`;
				this.throwErrorWithRangeOrCurrentRange(firstExtraArgOrRange as LuaSourceRange | null, failureMessage);
			}
			if (explicitRange !== undefined) {
				const baseMessage = (messageOrFactory as (arg1: unknown, arg2: unknown) => string)(firstExtraArgOrRange, secondExtraArgOrRange);
				const failureMessage = `${baseMessage}${valueTypeSuffix}`;
				this.throwErrorWithRangeOrCurrentRange(explicitRange, failureMessage);
			}
			const baseMessage = (messageOrFactory as (arg: unknown) => string)(firstExtraArgOrRange);
			const failureMessage = `${baseMessage}${valueTypeSuffix}`;
			this.throwErrorWithRangeOrCurrentRange(secondExtraArgOrRange as LuaSourceRange | null, failureMessage);
		}

		private valueTypeSuffix(value: unknown): string {
			const ctorName = value && typeof value === 'object' ? (value as { constructor?: { name?: string } }).constructor?.name : undefined;
			return ` (value type=${typeof value}${ctorName ? ` ctor=${ctorName}` : ''})`;
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
		if (value instanceof LuaNativeValue) {
			return value;
		}
		return this.adapter.toLua(value);
	}

	private convertToHost(value: LuaValue): unknown {
		if (value === null || typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') {
			return value;
		}
		return this.adapter.convertFromLua(value);
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
		if (value instanceof LuaNativeValue) {
			return true;
		}
		if (isLuaFunctionValue(value)) {
			return true;
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
			return EMPTY_VALUES;
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
		const detail = extractErrorMessage(error);
		return `[${typeName}.${memberName}] ${detail}`;
	}

	private throwNativeError(typeName: string, memberName: string, range: LuaSourceRange | null, error: unknown): never {
		if (error instanceof LuaRuntimeError) {
			throw error;
		}
		this.throwErrorWithRangeOrCurrentRange(range, this.formatNativeError(typeName, memberName, error));
	}

	public fallbackSourceRange(): LuaSourceRange {
		return {
			path: this.currentChunk,
			start: { line: 0, column: 0 },
			end: { line: 0, column: 0 },
		};
	}

	private bindNativeFunction(target: LuaNativeValue, options: { cacheKey: string; resolvedName: string; displayName: string; bindInstance: boolean; range: LuaSourceRange }): LuaFunctionValue {
		const cached = this.getCachedNativeMethod(target, options.cacheKey);
		if (cached !== null) {
			return cached;
		}
		const typeName = this.nativeTypeName(target);
		const fn = new LuaNativeFunction(`${typeName}.${options.displayName}`, (args) => {
			const native = target.native;
			const jsArgs: unknown[] = [];
			if (options.bindInstance) {
				let startIndex = 0;
				if (args.length > 0) {
					const firstHostArg = this.convertToHost(args[0]);
					if (firstHostArg === native) {
						startIndex = 1;
					}
				}
				for (let index = startIndex; index < args.length; index += 1) {
					jsArgs.push(this.convertToHost(args[index]));
				}
			} else {
				for (let index = 0; index < args.length; index += 1) {
					jsArgs.push(this.convertToHost(args[index]));
				}
			}
			try {
				let callable: unknown;
				let thisArg: unknown;
				if (options.resolvedName !== null) {
					callable = Reflect.get(native as Record<string, unknown>, options.resolvedName);
					if (!isHostCallable(callable)) {
						throw new Error(`Property '${options.displayName}' is not callable.`);
					}
					thisArg = native;
				} else {
					callable = native;
					if (!isHostCallable(callable)) {
						throw new Error('Native value is not callable.');
					}
					thisArg = undefined;
				}
				const result = Reflect.apply(callable, thisArg, jsArgs);
				return this.wrapHostInvocationResult(result);
			} catch (error) {
				this.throwNativeError(typeName, options.displayName, options.range, error);
			}
		});
		this.storeNativeMethod(target, options.cacheKey, fn);
		return fn;
	}

	private makeNativeMemberHandle(target: object | Function, path: ReadonlyArray<string>, options: { displayName: string; bindInstance: boolean; range: LuaSourceRange | null }): LuaNativeMemberHandle {
		const typeName = resolveNativeTypeName(target);
		const handleName = `${typeName}.${options.displayName}`;
		const callImpl = (args: ReadonlyArray<LuaValue>): LuaValue[] => {
			let member: unknown = target;
			for (let index = 0; index < path.length; index += 1) {
				member = Reflect.get(member as Record<string, unknown>, path[index]);
			}
			if (!isHostCallable(member)) {
				this.throwNativeError(typeName, options.displayName, options.range, new Error('Member is not callable.'));
			}
			const jsArgs: unknown[] = [];
			let startIndex = 0;
			if (options.bindInstance && args.length > 0) {
				const receiverArg = this.convertToHost(args[0]);
				if (receiverArg === target) {
					startIndex = 1;
				}
			}
			for (let index = startIndex; index < args.length; index += 1) {
				jsArgs.push(this.convertToHost(args[index]));
			}
			try {
				const result = Reflect.apply(member, options.bindInstance ? target : undefined, jsArgs);
				return this.wrapHostInvocationResult(result);
			} catch (error) {
				this.throwNativeError(typeName, options.displayName, options.range, error);
			}
		};
		return createLuaNativeMemberHandle({ name: handleName, target, path, callImpl });
	}

	private getOrCreateNativeMemberHandle(target: LuaNativeValue, path: ReadonlyArray<string>, displayName: string, range: LuaSourceRange, bindInstance: boolean): LuaNativeMemberHandle {
		const cacheKey = `member:${path.join('.')}`;
		const cached = this.getCachedNativeMethod(target, cacheKey);
		if (cached && isLuaNativeMemberHandle(cached)) {
			return cached;
		}
		const handle = this.makeNativeMemberHandle(target.native, path, { displayName, bindInstance, range });
		this.storeNativeMethod(target, cacheKey, handle);
		return handle;
	}

	public createNativeMemberHandle(target: object | Function, path: ReadonlyArray<string>): LuaNativeMemberHandle {
		const native = this.getOrCreateNativeValue(target, resolveNativeTypeName(target));
		return this.getOrCreateNativeMemberHandle(native, path, path.join('.'), null, true);
	}

	private getOrCreateNativeCallable(target: LuaNativeValue, range: LuaSourceRange): LuaFunctionValue {
		return this.bindNativeFunction(target, { cacheKey: 'call', resolvedName: null, displayName: 'call', bindInstance: false, range });
	}

	private normalizeNativeKey(key: LuaValue): { propertyName: string; displayName: string } {
		if (typeof key === 'string') {
			return { propertyName: key, displayName: key };
		}
		if (typeof key === 'number' && Number.isInteger(key)) {
			const text = String(key);
			return { propertyName: text, displayName: text };
		}
		return null;
	}

	private resolveNativePropertyName(native: object | Function, propertyName: string): string {
		if (propertyName in native) {
			return propertyName;
		}
		return null;
	}

	private getNativePropertyValue(target: LuaNativeValue, key: LuaValue, range: LuaSourceRange): { found: boolean; value: LuaValue; resolvedName: string; displayName: string } {
		if (Array.isArray(target.native) && typeof key === 'number' && Number.isInteger(key)) {
			const zeroIndex = key - 1;
			if (zeroIndex < 0 || zeroIndex >= target.native.length) {
				return { found: true, value: null, resolvedName: String(zeroIndex), displayName: String(key) };
			}
			const property = target.native[zeroIndex];
			return { found: true, value: this.convertFromHost(property), resolvedName: String(zeroIndex), displayName: String(key) };
		}
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
			property = Reflect.get(target.native, resolvedName);
		} catch (error) {
			const message = this.formatNativeError(this.nativeTypeName(target), normalized.displayName, error);
			this.throwErrorWithRangeOrCurrentRange(range, message)
		}
		if (property === undefined && Array.isArray(target.native) && typeof key === 'number' && Number.isInteger(key)) {
			return { found: true, value: null, resolvedName, displayName: normalized.displayName };
		}
		if (isHostCallable(property)) { // Bind functions as native callables or member handles
			if (isLuaHandlerFunction(property)) {
				return { found: true, value: this.convertFromHost(property), resolvedName, displayName: normalized.displayName };
			}
			const handle = this.getOrCreateNativeMemberHandle(target, [resolvedName], normalized.displayName, range, true);
			return { found: true, value: handle, resolvedName, displayName: normalized.displayName };
		}
		if (property === undefined) {
			return { found: false, value: null, resolvedName, displayName: normalized.displayName };
		}
		return { found: true, value: this.convertFromHost(property), resolvedName, displayName: normalized.displayName };
	}

		private getNativeValueWithMetamethod(target: LuaNativeValue, key: LuaValue, range: LuaSourceRange): LuaValue {
			const getMissingPropertyMessage = (property: ReturnType<typeof this.getNativePropertyValue>, target: LuaNativeValue): string => {
				const keyName = property.displayName && property.displayName.length > 0
					? property.displayName
				: typeof key === 'string' || typeof key === 'number'
					? String(key)
						: '<unknown>';
				return `Attempted to index missing native member '${keyName}' on ${this.nativeTypeName(target)}. Did you forget to define it as a 'default' or 'override' member (e.g. via 'define_prefab')?`;
			}
			const property = this.getNativePropertyValue(target, key, range);
			if (property.found) {
				return property.value;
			}
			const metatable = target.metatable;
			if (metatable === null) {
				this.throwErrorWithRangeOrCurrentRange(range, getMissingPropertyMessage(property, target));
			}
			const handler = metatable?.get('__index');
			if (!handler) {
				this.throwErrorWithRangeOrCurrentRange(range, getMissingPropertyMessage(property, target));
			}
			else if (isLuaTable(handler)) {
				return this.getTableValueWithMetamethod(handler, key, range);
			}
				const functionValue = this.expectFunction(handler, '__index metamethod must be a function or table.', range);
				return this.callFunctionForFirstValue(functionValue, target, key);
			}

	private setNativeProperty(target: LuaNativeValue, key: { propertyName: string; displayName: string }, value: LuaValue, range: LuaSourceRange): void {
		if (Array.isArray(target.native)) {
			if (key.propertyName === 'length') {
				throw this.runtimeErrorAt(range, 'Cannot assign length on native Array from Lua.');
			}
			const numeric = Number(key.propertyName);
			if (Number.isInteger(numeric)) {
				const zeroIndex = numeric >= 1 ? numeric - 1 : numeric;
				if (zeroIndex < 0) {
					throw this.runtimeErrorAt(range, 'Array index must be positive.');
				}
				const jsValue = this.convertToHost(value);
				target.native[zeroIndex] = jsValue;
				this.evictNativeMethod(target, key.displayName);
				return;
			}
		}
		const resolvedName = this.resolveNativePropertyName(target.native, key.propertyName) ?? key.propertyName;
		const jsValue = this.convertToHost(value);
		try {
			Reflect.set(target.native, resolvedName, jsValue);
		} catch (error) {
			const message = this.formatNativeError(this.nativeTypeName(target), key.displayName, error);
			throw this.runtimeErrorAt(range, message);
		}
		this.evictNativeMethod(target, key.displayName);
	}

	private setNativeMember(target: LuaNativeValue, property: string, value: LuaValue, range: LuaSourceRange): void {
		const normalized = { propertyName: property, displayName: property };
		this.setNativeProperty(target, normalized, value, range);
	}

	private setNativeIndex(target: LuaNativeValue, key: LuaValue, value: LuaValue, range: LuaSourceRange): void {
		const normalized = this.normalizeNativeKey(key);
		if (!normalized) {
			throw this.runtimeErrorAt(range, 'Native value keys must be strings or integers.');
		}
		this.setNativeProperty(target, normalized, value, range);
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
		const iterator = new LuaNativeFunction('native_pairs_iterator', (iteratorArgs) => {
				const nativeTarget = iteratorArgs.length > 0 ? iteratorArgs[0] : null;
				if (!(nativeTarget instanceof LuaNativeValue) || nativeTarget !== target) {
					return NIL_VALUE_RESULT;
				}
				if (pointer >= keys.length) {
					return NIL_VALUE_RESULT;
				}
			const key = keys[pointer];
			pointer += 1;
			const value = this.getNativeValueWithMetamethod(target, key, null);
			return [key, value];
		});
		return [iterator, target, null];
	}

	private createNativeIpairsIterator(target: LuaNativeValue): LuaValue[] {
		const iterator = new LuaNativeFunction('native_ipairs_iterator', (iteratorArgs) => {
			const nativeTarget = iteratorArgs.length > 0 ? iteratorArgs[0] : null;
				const previousIndex = iteratorArgs.length > 1 ? iteratorArgs[1] : null;
				if (!(nativeTarget instanceof LuaNativeValue) || nativeTarget !== target) {
					return NIL_VALUE_RESULT;
				}
				const nextIndex = typeof previousIndex === 'number' ? previousIndex + 1 : 1;
				const value = this.getNativeValueWithMetamethod(target, nextIndex, null);
				if (value === null) {
					return NIL_VALUE_RESULT;
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

	private getCachedNativeMethod(target: LuaNativeValue, key: string): LuaFunctionValue {
		const cache = this.nativeMethodCache.get(target);
		if (!cache) {
			return null;
		}
		const entry = cache.get(key);
		return entry;
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

	private expectString(value: LuaValue, message: string, range: LuaSourceRange | null): string {
		if (typeof value === 'string') {
			return value;
		}
		this.throwErrorWithRangeOrCurrentRange(range, message);
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

	private bindScriptArguments(activationEnvironment: LuaEnvironment, expression: LuaFunctionExpression, args: ReadonlyArray<LuaValue>, implicitSelfName: string): LuaValue[] {
		const parameters = expression.parameters;
		let argumentIndex = 0;
		if (implicitSelfName !== null) {
			activationEnvironment.set(implicitSelfName, this.argumentOrNil(args, argumentIndex));
			argumentIndex += 1;
		}
		for (const parameter of parameters) {
			activationEnvironment.set(parameter.name, this.argumentOrNil(args, argumentIndex), parameter.range);
			argumentIndex += 1;
		}
		if (!expression.hasVararg) {
			return EMPTY_VALUES;
		}
		const varargValues: LuaValue[] = [];
		for (let index = argumentIndex; index < args.length; index += 1) {
			varargValues.push(args[index]);
		}
		return varargValues;
	}

	private invokeFunction(functionValue: LuaFunctionValue, args: ReadonlyArray<LuaValue>, range: LuaSourceRange): LuaValue[] {
		// Ensure native calls appear in the call stack with the call-site location.
		// Script functions already push a frame inside invokeScriptFunction().
		return this.withCurrentCallRange(range, () => {
			if (functionValue instanceof LuaNativeFunction) {
				this.callStack.push({
					functionName: functionValue.name && functionValue.name.length > 0 ? functionValue.name : null,
					source: range.path,
					line: range.start.line,
					column: range.start.column,
				});

				try {
					const result = functionValue.call(args);
					if (isLuaCallSignal(result)) {
						return result as any;
					}
					return result;
				} catch (error) {
					this.recordFaultCallStack();
					throw error;
				} finally {
					this.callStack.pop();
				}
			}
			return functionValue.call(args) as any;
		});
	}

	private withCurrentCallRange<T>(range: LuaSourceRange, callback: () => T): T {
		const previous = this._currentCallRange;
		this._currentCallRange = range;
		try {
			return callback();
		}
		finally {
			this._currentCallRange = previous;
		}
	}

	public get currentCallRange(): LuaSourceRange {
		return this._currentCallRange;
	}

	public createFunctionExecutionThread(functionValue: LuaFunctionValue, args: ReadonlyArray<LuaValue>): LuaExecutionThread {
		if (functionValue instanceof LuaNativeFunction) {
			return new LuaExecutionThread(() => {
				const result = functionValue.call(args);
				return isLuaCallSignal(result) ? result : NORMAL_SIGNAL;
			});
		}
		if (functionValue instanceof LuaScriptFunction) {
			let started = false;
			let startingDepth = 0;
			let expression: LuaFunctionExpression = null;
			let closure: LuaEnvironment = null;
			let name = '';
			let implicitSelfName: string = null;
			let callRange: LuaSourceRange = null;
			let activationEnvironment: LuaEnvironment = null;
			let varargValues: LuaValue[] = [];

			return new LuaExecutionThread((instructionBudget) => {
				try {
					if (!started) {
						started = true;
						startingDepth = this.frameStack.length;
						expression = functionValue.expression;
						closure = functionValue.closure;
						name = functionValue.name;
						implicitSelfName = functionValue.implicitSelfName;
							callRange = this._currentCallRange ?? expression.range;

							activationEnvironment = LuaEnvironment.createChild(closure);
							varargValues = this.bindScriptArguments(activationEnvironment, expression, args, implicitSelfName);
							const scope = this.createLabelScope(expression.body.body, null);
							this.pushStatementsFrame({
							statements: expression.body.body,
							environment: activationEnvironment,
							varargs: varargValues,
							scope,
							boundary: 'function',
							callRange,
							callName: name,
						});
					}

					const signal = this.runFrameLoop(startingDepth, instructionBudget);
					if (!signal) return NORMAL_SIGNAL;

					switch (signal.kind) {
						case 'return':
							this.consumeReturnValues();
							return NORMAL_SIGNAL;
						case 'break':
							throw this.runtimeErrorAt(expression.range, `Cannot break from function '${name}'.`);
						case 'goto':
							throw this.runtimeErrorAt(signal.originRange, `Label '${signal.label}' not found in function '${name}'.`);
						default:
							return signal;
					}
				} catch (error) {
					this.recordFaultCallStack();
					throw error;
				}
			});
		}

		return new LuaExecutionThread(() => {
			const result = functionValue.call(args);
			return isLuaCallSignal(result) ? result : NORMAL_SIGNAL;
		});
	}

	public invokeScriptFunction(expression: LuaFunctionExpression, closure: LuaEnvironment, name: string, args: ReadonlyArray<LuaValue>, implicitSelfName: string): LuaCallResult {
		const activationEnvironment = LuaEnvironment.createChild(closure);
		const callRange = this._currentCallRange ?? expression.range;
		const varargValues = this.bindScriptArguments(activationEnvironment, expression, args, implicitSelfName);
		const startingDepth = this.frameStack.length;
		const scope = this.createLabelScope(expression.body.body, null);
		this.pushStatementsFrame({
			statements: expression.body.body,
			environment: activationEnvironment,
			varargs: varargValues,
			scope,
			boundary: 'function',
			callRange,
			callName: name,
		});
		let suspended = false;
		try {
			const signal = this.runFrameLoop(startingDepth);
			if (signal?.kind === 'pause') {
				suspended = true;
				return this.wrapPauseSignal(signal, (resumed) => {
					if (!resumed) return resumed;
					switch (resumed.kind) {
						case 'return':
							return resumed;
						case 'break':
							throw this.runtimeErrorAt(expression.range, `Cannot break from function '${name}'.`);
						case 'goto':
							throw this.runtimeErrorAt(resumed.originRange, `Label '${resumed.label}' not found in function '${name}'.`);
						default:
							return resumed;
					}
				});
			}
			return this.resolveFunctionSignal(signal, expression, name);
		} catch (error) {
			this.recordFaultCallStack();
			throw error;
		} finally {
			if (!suspended) {
				this.finalizeFunctionExecution(startingDepth);
			}
		}
	}

	private resolveFunctionSignal(signal: ExecutionSignal, expression: LuaFunctionExpression, name: string): LuaValue[] {
		if (!signal) return [];
		switch (signal.kind) {
			case 'return':
				return this.consumeReturnValues();
			case 'break':
				throw this.runtimeErrorAt(expression.range, `Cannot break from function '${name}'.`);
			case 'goto':
				throw this.runtimeErrorAt(signal.originRange, `Label '${signal.label}' not found in function '${name}'.`);
			default:
				return [];
		}
	}

	private validateReservedIdentifiers(statements: ReadonlyArray<LuaStatement>): void {
		if (this._reservedIdentifiers.size === 0) {
			return;
		}
		for (const statement of statements) {
			switch (statement.kind) {
				case LuaSyntaxKind.LocalAssignmentStatement: {
					break;
				}
				case LuaSyntaxKind.LocalFunctionStatement: {
					const localFunc = statement as LuaLocalFunctionStatement;
					this.validateFunctionExpression(localFunc.functionExpression);
					break;
				}
				case LuaSyntaxKind.FunctionDeclarationStatement: {
					const funcDecl = statement as LuaFunctionDeclarationStatement;
					if (funcDecl.name.identifiers.length === 1 && !funcDecl.name.methodName) {
						this.ensureIdentifierNotReserved(funcDecl.name.identifiers[0], funcDecl.range);
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
		if (this._reservedIdentifiers.has(name)) {
			throw new LuaSyntaxError(`'${name}' is reserved and cannot be redefined.`, range.path, range.start.line, range.start.column);
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
		this.globals.set('require', new LuaNativeFunction('require', (args) => this.invokeRequireBuiltin(args)));

		this.globals.set('print', new LuaNativeFunction('print', (args) => {
			const parts: string[] = [];
			for (const value of args) {
				parts.push(this.toLuaString(value));
			}
			if (parts.length === 0) {
				this.outputHandler('');
			}
			else {
				this.outputHandler(parts.join('\t'));
			}
			return EMPTY_VALUES;
		}));

		// array(...): create a native JS array (0-based) and expose it to Lua as a native value.
		// - array(a, b, c) -> native Array [a, b, c]
		// - array(table) copies 1-based numeric entries into a native Array, appending any non-numeric keys.
		// The array stays native so that JS receives real arrays via the bridge.
			this.globals.set('array', new LuaNativeFunction('array', (args) => {
				const nativeArray: unknown[] = [];
				if (args.length === 1 && isLuaTable(args[0])) {
					const source = args[0] as LuaTable;
					source.forEachEntry((key, value) => {
						if (typeof key === 'number' && Number.isInteger(key) && key >= 1) {
							nativeArray[key - 1] = value;
							return;
						}
						nativeArray.push(value);
					});
					return [this.getOrCreateNativeValue(nativeArray, 'Array')];
				}
			for (let index = 0; index < args.length; index += 1) {
				nativeArray[index] = args[index];
			}
			return [this.getOrCreateNativeValue(nativeArray, 'Array')];
		}));

			this.globals.set('assert', new LuaNativeFunction('assert', (args) => {
				const condition = args.length > 0 ? args[0] : null;
				if (this.isTruthy(condition)) {
					return args;
				}
			const messageValue = args.length > 1 ? args[1] : 'assertion failed!';
			const message = typeof messageValue === 'string' ? messageValue : this.toLuaString(messageValue);
			throw this.runtimeError(message);
		}));

		this.globals.set('error', new LuaNativeFunction('error', (args) => {
			const value = args.length > 0 ? args[0] : 'nil';
			const message = typeof value === 'string' ? value : this.toLuaString(value);
			throw this.runtimeError(message);
		}));

		this.globals.set('type', new LuaNativeFunction('type', (args) => {
			const value = args.length > 0 ? args[0] : null;
			let result: string;
			if (value instanceof LuaNativeValue) {
				result = 'native';
			}
			else {
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
			}
			return [result];
		}));

		this.globals.set('tostring', new LuaNativeFunction('tostring', (args) => {
			const value = args.length > 0 ? args[0] : null;
			return [this.toLuaString(value)];
		}));

		this.globals.set('tonumber', new LuaNativeFunction('tonumber', (args) => {
			if (args.length === 0) {
				return [null];
			}
			const value = args[0];
			if (typeof value === 'number') {
				return [value];
			}
			if (typeof value === 'string') {
				if (args.length >= 2) {
					const baseValue = Math.floor(this.expectNumber(args[1], 'tonumber base must be a number.', null));
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

		this.globals.set('setmetatable', new LuaNativeFunction('setmetatable', (args) => {
			if (args.length === 0 || (!(isLuaTable(args[0])) && !(args[0] instanceof LuaNativeValue))) {
				throw this.runtimeError('setmetatable expects a table or native value as the first argument.');
			}
			const targetValue = args[0];
			let metatable: LuaTable = null;
			if (args.length >= 2) {
				const metaArg = args[1];
				if (metaArg !== null && !(isLuaTable(metaArg))) {
					throw this.runtimeError('setmetatable expects a table or nil as the second argument.');
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
			nativeTarget.metatable = metatable;
			return [nativeTarget];
		}));

		this.globals.set('getmetatable', new LuaNativeFunction('getmetatable', (args) => {
			if (args.length === 0 || (!(isLuaTable(args[0])) && !(args[0] instanceof LuaNativeValue))) {
				throw this.runtimeError('getmetatable expects a table or native value as the first argument.');
			}
			const targetValue = args[0];
			let metatable: LuaTable = null;
			if (isLuaTable(targetValue)) {
				metatable = targetValue.getMetatable();
			} else {
				metatable = (targetValue as LuaNativeValue).metatable as LuaTable;
			}
			if (metatable === null) {
				return [null];
			}
			return [metatable];
		}));

		this.globals.set('rawequal', new LuaNativeFunction('rawequal', (args) => {
			if (args.length < 2) {
				return [false];
			}
			return [args[0] === args[1]];
		}));

		this.globals.set('rawget', new LuaNativeFunction('rawget', (args) => {
			if (args.length === 0 || !(isLuaTable(args[0]))) {
				throw this.runtimeError('rawget expects a table as the first argument.');
			}
			const table = args[0] as LuaTable;
			const key = args.length > 1 ? args[1] : null;
			return [table.get(key)];
		}));

		this.globals.set('rawset', new LuaNativeFunction('rawset', (args) => {
			if (args.length < 2 || !(isLuaTable(args[0]))) {
				throw this.runtimeError('rawset expects a table as the first argument.');
			}
			const table = args[0] as LuaTable;
			const key = args[1];
			const value = args.length >= 3 ? args[2] : null;
			table.set(key, value);
			return [table];
		}));

		// start fallible-boundary -- Lua pcall converts protected-call failures into Lua return values.
		this.globals.set('pcall', new LuaNativeFunction('pcall', (args) => {
			const fn = this.expectFunction(args.length > 0 ? args[0] : null, 'pcall expects a function.', null);
			const functionArgs = this.allocateValueList();
			for (let index = 1; index < args.length; index += 1) {
				functionArgs.push(args[index]);
			}
			try {
				const result = fn.call(functionArgs);
				return this.protectedCallSuccess(result);
			} catch (error) {
				const message = extractErrorMessage(error);
				const values = this.allocateValueList();
				values.push(false);
				values.push(message);
				return values;
			}
		}));
		// end fallible-boundary

		// start fallible-boundary -- Lua xpcall converts protected-call failures into Lua return values.
		this.globals.set('xpcall', new LuaNativeFunction('xpcall', (args) => {
			const fn = this.expectFunction(args.length > 0 ? args[0] : null, 'xpcall expects a function.', null);
			const messageHandler = this.expectFunction(args.length > 1 ? args[1] : null, 'xpcall expects a message handler.', null);
			const functionArgs = this.allocateValueList();
			for (let index = 2; index < args.length; index += 1) {
				functionArgs.push(args[index]);
			}
			try {
				const result = fn.call(functionArgs);
				return this.protectedCallSuccess(result);
			} catch (error) {
				const formatted = extractErrorMessage(error);
				const handlerArgs = this.allocateValueList();
				handlerArgs.push(formatted);
				const handlerResult = messageHandler.call(handlerArgs);
				if (isLuaCallSignal(handlerResult)) {
					return handlerResult;
				}
				const first = handlerResult.length > 0 ? handlerResult[0] : null;
				const values = this.allocateValueList();
				values.push(false);
				values.push(first);
				return values;
			}
		}));
		// end fallible-boundary

		this.globals.set('select', new LuaNativeFunction('select', (args) => {
			if (args.length === 0) {
				throw this.runtimeError('select expects at least one argument.');
			}
			const selector = args[0];
			const valueCount = args.length - 1;
			if (selector === '#') {
				return [valueCount];
			}
			const index = Math.floor(this.expectNumber(selector, 'select index must be a number.', null));
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

		this.globals.set('next', new LuaNativeFunction('next', (args) => {
			if (args.length === 0 || !(isLuaTable(args[0]))) {
				throw this.runtimeError('next expects a table as the first argument.');
				}
				const table = args[0] as LuaTable;
				const lastKey = args.length > 1 ? args[1] : null;
				return table.nextEntry(lastKey) ?? NIL_VALUE_RESULT;
			}));

		const maxSafeInteger = Number.MAX_SAFE_INTEGER;
		const radToDeg = 180 / Math.PI;
		const degToRad = Math.PI / 180;
		const mathTable = createLuaTable();
		mathTable.set('abs', new LuaNativeFunction('abs', (args) => {
			const value = args.length > 0 ? args[0] : null;
			const number = this.expectNumber(value, 'math.abs expects a number.', null);
			return [Math.abs(number)];
		}));
		mathTable.set('acos', new LuaNativeFunction('acos', (args) => {
			const value = args.length > 0 ? args[0] : null;
			const number = this.expectNumber(value, 'math.acos expects a number.', null);
			return [Math.acos(number)];
		}));
		mathTable.set('asin', new LuaNativeFunction('asin', (args) => {
			const value = args.length > 0 ? args[0] : null;
			const number = this.expectNumber(value, 'math.asin expects a number.', null);
			return [Math.asin(number)];
		}));
		mathTable.set('atan', new LuaNativeFunction('atan', (args) => {
			const value = args.length > 0 ? args[0] : null;
			const y = this.expectNumber(value, 'math.atan expects a number.', null);
			if (args.length > 1) {
				const x = this.expectNumber(args[1], 'math.atan expects a number.', null);
				return [Math.atan2(y, x)];
			}
			return [Math.atan(y)];
		}));
		mathTable.set('ceil', new LuaNativeFunction('ceil', (args) => {
			const value = args.length > 0 ? args[0] : null;
			const number = this.expectNumber(value, 'math.ceil expects a number.', null);
			return [Math.ceil(number)];
		}));
		mathTable.set('cos', new LuaNativeFunction('cos', (args) => {
			const value = args.length > 0 ? args[0] : null;
			const number = this.expectNumber(value, 'math.cos expects a number.', null);
			return [Math.cos(number)];
		}));
		mathTable.set('deg', new LuaNativeFunction('deg', (args) => {
			const value = args.length > 0 ? args[0] : null;
			const number = this.expectNumber(value, 'math.deg expects a number.', null);
			return [number * radToDeg];
		}));
		mathTable.set('exp', new LuaNativeFunction('exp', (args) => {
			const value = args.length > 0 ? args[0] : null;
			const number = this.expectNumber(value, 'math.exp expects a number.', null);
			return [Math.exp(number)];
		}));
		mathTable.set('floor', new LuaNativeFunction('floor', (args) => {
			const value = args.length > 0 ? args[0] : null;
			const number = this.expectNumber(value, 'math.floor expects a number.', null);
			return [Math.floor(number)];
		}));
		mathTable.set('fmod', new LuaNativeFunction('fmod', (args) => {
			const value = args.length > 0 ? args[0] : null;
			const divisorValue = args.length > 1 ? args[1] : null;
			const number = this.expectNumber(value, 'math.fmod expects a number.', null);
			const divisor = this.expectNumber(divisorValue, 'math.fmod expects a number.', null);
			return [number % divisor];
		}));
		mathTable.set('log', new LuaNativeFunction('log', (args) => {
			const value = args.length > 0 ? args[0] : null;
			const number = this.expectNumber(value, 'math.log expects a number.', null);
			if (args.length > 1) {
				const base = this.expectNumber(args[1], 'math.log expects a number.', null);
				return [Math.log(number) / Math.log(base)];
			}
			return [Math.log(number)];
		}));
		mathTable.set('max', new LuaNativeFunction('max', (args) => {
			if (args.length === 0) {
				throw this.runtimeError('math.max expects at least one argument.');
			}
			let result = this.expectNumber(args[0], 'math.max expects numeric arguments.', null);
			for (let index = 1; index < args.length; index += 1) {
				const value = this.expectNumber(args[index], 'math.max expects numeric arguments.', null);
				if (value > result) {
					result = value;
				}
			}
			return [result];
		}));
		mathTable.set('min', new LuaNativeFunction('min', (args) => {
			if (args.length === 0) {
				throw this.runtimeError('math.min expects at least one argument.');
			}
			let result = this.expectNumber(args[0], 'math.min expects numeric arguments.', null);
			for (let index = 1; index < args.length; index += 1) {
				const value = this.expectNumber(args[index], 'math.min expects numeric arguments.', null);
				if (value < result) {
					result = value;
				}
			}
			return [result];
		}));
		mathTable.set('modf', new LuaNativeFunction('modf', (args) => {
			const value = args.length > 0 ? args[0] : null;
			const number = this.expectNumber(value, 'math.modf expects a number.', null);
			const integerPart = Math.trunc(number);
			return [integerPart, number - integerPart];
		}));
		mathTable.set('rad', new LuaNativeFunction('rad', (args) => {
			const value = args.length > 0 ? args[0] : null;
			const number = this.expectNumber(value, 'math.rad expects a number.', null);
			return [number * degToRad];
		}));
		mathTable.set('sin', new LuaNativeFunction('sin', (args) => {
			const value = args.length > 0 ? args[0] : null;
			const number = this.expectNumber(value, 'math.sin expects a number.', null);
			return [Math.sin(number)];
		}));
		mathTable.set('sign', new LuaNativeFunction('sign', (args) => {
			const value = args.length > 0 ? args[0] : null;
			const number = this.expectNumber(value, 'math.sign expects a number.', null);
			if (number < 0) {
				return [-1];
			}
			if (number > 0) {
				return [1];
			}
			return [0];
		}));
		mathTable.set('sqrt', new LuaNativeFunction('sqrt', (args) => {
			const value = args.length > 0 ? args[0] : null;
			const number = this.expectNumber(value, 'math.sqrt expects a number.', null);
			if (number < 0) {
				throw this.runtimeError('math.sqrt cannot operate on negative numbers.');
			}
			return [Math.sqrt(number)];
		}));
		mathTable.set('tan', new LuaNativeFunction('tan', (args) => {
			const value = args.length > 0 ? args[0] : null;
			const number = this.expectNumber(value, 'math.tan expects a number.', null);
			return [Math.tan(number)];
		}));
		mathTable.set('tointeger', new LuaNativeFunction('tointeger', (args) => {
			const value = args.length > 0 ? args[0] : null;
			if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isInteger(value)) {
				return [null];
			}
			return [value];
		}));
		mathTable.set('type', new LuaNativeFunction('type', (args) => {
			const value = args.length > 0 ? args[0] : null;
			if (typeof value !== 'number') {
				return [null];
			}
			if (Number.isInteger(value)) {
				return ['integer'];
			}
			return ['float'];
		}));
		mathTable.set('ult', new LuaNativeFunction('ult', (args) => {
			const left = this.expectNumber(args[0], 'math.ult expects a number.', null) >>> 0;
			const right = this.expectNumber(args[1], 'math.ult expects a number.', null) >>> 0;
			return [left < right];
		}));
		mathTable.set('random', new LuaNativeFunction('random', (args) => {
			const randomValue = this.nextRandom();
			if (args.length === 0) {
				return [randomValue];
			}
			if (args.length === 1) {
				const upper = this.expectNumber(args[0], 'math.random expects numeric bounds.', null);
				const upperInt = Math.floor(upper);
				if (upperInt < 1) {
					throw this.runtimeError('math.random upper bound must be positive.');
				}
				return [Math.floor(randomValue * upperInt) + 1];
			}
			const lower = this.expectNumber(args[0], 'math.random expects numeric bounds.', null);
			const upper = this.expectNumber(args[1], 'math.random expects numeric bounds.', null);
			const lowerInt = Math.floor(lower);
			const upperInt = Math.floor(upper);
			if (upperInt < lowerInt) {
				throw this.runtimeError('math.random upper bound must be greater than or equal to lower bound.');
			}
			const span = upperInt - lowerInt + 1;
			return [lowerInt + Math.floor(randomValue * span)];
		}));
		mathTable.set('randomseed', new LuaNativeFunction('randomseed', (args) => {
			const seedValue = args.length > 0 ? this.expectNumber(args[0], 'math.randomseed expects a number.', null) : engineCore.platform.clock.now();
			this.randomSeedValue = Math.floor(seedValue) >>> 0;
			return EMPTY_VALUES;
		}));
		mathTable.set('huge', Number.POSITIVE_INFINITY);
		mathTable.set('maxinteger', maxSafeInteger);
		mathTable.set('mininteger', -maxSafeInteger);
		mathTable.set('pi', Math.PI);
		this.globals.set('math', mathTable);

		const stringTable = createLuaTable();
		const packNativeEndian = (() => {
			const probe = new Uint8Array([1, 0]);
			return new Uint16Array(probe.buffer)[0] === 1 ? 'little' : 'big';
		})();
		const packDefaultAlign = 8;
		const packIntSize = 4;
		const packLongSize = 4;
		const packSizeTSize = 4;
		const packLuaIntegerSize = 8;
		const packLuaNumberSize = 8;
		const packMaxSafeInteger = Number.MAX_SAFE_INTEGER;
		const packStringToBytes = (text: string): Uint8Array => {
			const bytes = new Uint8Array(text.length);
			for (let i = 0; i < text.length; i += 1) {
				const code = text.charCodeAt(i);
				if (code > 0xff) {
					throw this.runtimeError('string.pack expects a byte string.');
				}
				bytes[i] = code;
			}
			return bytes;
		};
		const packBytesToString = (bytes: Uint8Array): string => {
			if (bytes.length === 0) {
				return '';
			}
			const chunkSize = 0x8000;
			let out = '';
			for (let i = 0; i < bytes.length; i += chunkSize) {
				const chunk = bytes.subarray(i, i + chunkSize);
				out += String.fromCharCode(...chunk);
			}
			return out;
		};
		const packParseFormat = (format: string): Array<{
			kind: 'pad' | 'align' | 'int' | 'float' | 'fixed' | 'z' | 'len';
			size?: number;
			signed?: boolean;
			littleEndian?: boolean;
			align?: number;
			lenSize?: number;
		}> => {
			const tokens: Array<{
				kind: 'pad' | 'align' | 'int' | 'float' | 'fixed' | 'z' | 'len';
				size?: number;
				signed?: boolean;
				littleEndian?: boolean;
				align?: number;
				lenSize?: number;
			}> = [];
			let index = 0;
			let littleEndian = packNativeEndian === 'little';
			let maxAlign = packDefaultAlign;
			const readNumber = (start: number): { found: boolean; value: number; nextIndex: number } => {
				let cursor = start;
				let value = 0;
				let found = false;
				while (cursor < format.length) {
					const code = format.charCodeAt(cursor);
					if (code < 48 || code > 57) {
						break;
					}
					found = true;
					value = value * 10 + (code - 48);
					cursor += 1;
				}
				return { found, value, nextIndex: cursor };
			};
			const pushInt = (size: number, signed: boolean): void => {
				if (size < 1 || size > 8) {
					throw this.runtimeError(`string.pack invalid integer size ${size}.`);
				}
				tokens.push({
					kind: 'int',
					size,
					signed,
					littleEndian,
					align: Math.min(size, maxAlign),
				});
			};
			const pushFloat = (size: number): void => {
				tokens.push({
					kind: 'float',
					size,
					littleEndian,
					align: Math.min(size, maxAlign),
				});
				};
				while (index < format.length) {
					const ch = format.charAt(index);
					switch (ch) {
						case ' ':
						case '\t':
						case '\n':
						case '\r':
							index += 1;
							continue;
					}
					if (ch === '<') {
					littleEndian = true;
					index += 1;
					continue;
				}
				if (ch === '>') {
					littleEndian = false;
					index += 1;
					continue;
				}
				if (ch === '=') {
					littleEndian = packNativeEndian === 'little';
					index += 1;
					continue;
				}
				if (ch === '!') {
					const parsed = readNumber(index + 1);
					if (!parsed.found || parsed.value <= 0) {
						throw this.runtimeError('string.pack alignment must be a positive integer.');
					}
					maxAlign = parsed.value;
					index = parsed.nextIndex;
					continue;
				}
				if (ch === 'x') {
					tokens.push({ kind: 'pad' });
					index += 1;
					continue;
				}
				if (ch === 'X') {
					tokens.push({ kind: 'align' });
					index += 1;
					continue;
				}
				if (ch === 'b') {
					pushInt(1, true);
					index += 1;
					continue;
				}
				if (ch === 'B') {
					pushInt(1, false);
					index += 1;
					continue;
				}
				if (ch === 'h') {
					pushInt(2, true);
					index += 1;
					continue;
				}
				if (ch === 'H') {
					pushInt(2, false);
					index += 1;
					continue;
				}
				if (ch === 'l') {
					pushInt(packLongSize, true);
					index += 1;
					continue;
				}
				if (ch === 'L') {
					pushInt(packLongSize, false);
					index += 1;
					continue;
				}
				if (ch === 'j') {
					pushInt(packLuaIntegerSize, true);
					index += 1;
					continue;
				}
				if (ch === 'J') {
					pushInt(packLuaIntegerSize, false);
					index += 1;
					continue;
				}
				if (ch === 'T') {
					pushInt(packSizeTSize, false);
					index += 1;
					continue;
				}
				if (ch === 'i' || ch === 'I') {
					const parsed = readNumber(index + 1);
					const size = parsed.found ? parsed.value : packIntSize;
					pushInt(size, ch === 'i');
					index = parsed.nextIndex;
					continue;
				}
				if (ch === 'f') {
					pushFloat(4);
					index += 1;
					continue;
				}
				if (ch === 'd') {
					pushFloat(8);
					index += 1;
					continue;
				}
				if (ch === 'n') {
					pushFloat(packLuaNumberSize);
					index += 1;
					continue;
				}
				if (ch === 'c') {
					const parsed = readNumber(index + 1);
					if (!parsed.found) {
						throw this.runtimeError('string.pack expected a size for c format.');
					}
					tokens.push({ kind: 'fixed', size: parsed.value });
					index = parsed.nextIndex;
					continue;
				}
				if (ch === 'z') {
					tokens.push({ kind: 'z' });
					index += 1;
					continue;
				}
				if (ch === 's') {
					const parsed = readNumber(index + 1);
					const lenSize = parsed.found ? parsed.value : packSizeTSize;
					if (lenSize < 1 || lenSize > 8) {
						throw this.runtimeError(`string.pack invalid length size ${lenSize}.`);
					}
					tokens.push({
						kind: 'len',
						lenSize,
						littleEndian,
						align: Math.min(lenSize, maxAlign),
					});
					index = parsed.nextIndex;
					continue;
				}
				throw this.runtimeError(`string.pack unsupported format option '${ch}'.`);
			}
			return tokens;
		};
		const packGetNextAlign = (tokens: ReturnType<typeof packParseFormat>, startIndex: number): number => {
			for (let i = startIndex + 1; i < tokens.length; i += 1) {
				const token = tokens[i];
				if (token.kind === 'pad' || token.kind === 'align') {
					continue;
				}
				if (token.align) {
					return token.align;
				}
				return 1;
				}
				return 1;
			};
			const packAlignmentPadding = (offset: number, align: number): number => {
				return (align - (offset % align)) % align;
			};
			const packPadToAlign = (bytes: number[], offset: number, align: number): number => {
				if (align <= 1) {
					return offset;
				}
				const padding = packAlignmentPadding(offset, align);
			for (let i = 0; i < padding; i += 1) {
				bytes.push(0);
			}
			return offset + padding;
		};
		const packWriteInt = (value: number, size: number, signed: boolean, littleEndian: boolean, bytes: number[]): void => {
			if (!Number.isFinite(value) || !Number.isInteger(value)) {
				throw this.runtimeError('string.pack integer value must be a finite integer.');
			}
			if (!Number.isSafeInteger(value)) {
				throw this.runtimeError('string.pack integer value exceeds safe integer range.');
			}
			const bits = BigInt(size * 8);
			let big = BigInt(value);
			if (signed) {
				const min = -(1n << (bits - 1n));
				const max = (1n << (bits - 1n)) - 1n;
				if (big < min || big > max) {
					throw this.runtimeError('string.pack integer value out of range.');
				}
				if (big < 0) {
					big = (1n << bits) + big;
				}
			}
			else {
				const max = (1n << bits) - 1n;
				if (big < 0 || big > max) {
					throw this.runtimeError('string.pack unsigned integer value out of range.');
				}
			}
			const tmp: number[] = new Array(size);
			for (let i = 0; i < size; i += 1) {
				tmp[i] = Number(big & 0xffn);
				big >>= 8n;
			}
			if (littleEndian) {
				for (let i = 0; i < size; i += 1) {
					bytes.push(tmp[i]);
				}
				return;
			}
			for (let i = size - 1; i >= 0; i -= 1) {
				bytes.push(tmp[i]);
			}
		};
		const packReadInt = (bytes: Uint8Array, offset: number, size: number, signed: boolean, littleEndian: boolean): number => {
			let big = 0n;
			if (littleEndian) {
				for (let i = 0; i < size; i += 1) {
					big |= BigInt(bytes[offset + i]) << (8n * BigInt(i));
				}
			}
			else {
				for (let i = 0; i < size; i += 1) {
					big = (big << 8n) | BigInt(bytes[offset + i]);
				}
			}
			if (signed) {
				const bits = BigInt(size * 8);
				const signBit = 1n << (bits - 1n);
				if (big & signBit) {
					big -= 1n << bits;
				}
			}
			const num = Number(big);
			if (!Number.isSafeInteger(num) || Math.abs(num) > packMaxSafeInteger) {
				throw this.runtimeError('string.unpack integer exceeds safe integer range.');
			}
			return num;
		};
		const packWriteFloat = (value: number, size: number, littleEndian: boolean, bytes: number[]): void => {
			const buffer = new ArrayBuffer(size);
			const view = new DataView(buffer);
			if (size === 4) {
				view.setFloat32(0, value, littleEndian);
			}
			else {
				view.setFloat64(0, value, littleEndian);
			}
			const u8 = new Uint8Array(buffer);
			for (let i = 0; i < u8.length; i += 1) {
				bytes.push(u8[i]);
			}
		};
		const packReadFloat = (bytes: Uint8Array, offset: number, size: number, littleEndian: boolean): number => {
			const buffer = new ArrayBuffer(size);
			const u8 = new Uint8Array(buffer);
			for (let i = 0; i < size; i += 1) {
				u8[i] = bytes[offset + i];
			}
			const view = new DataView(buffer);
			return size === 4 ? view.getFloat32(0, littleEndian) : view.getFloat64(0, littleEndian);
		};
		stringTable.set('len', new LuaNativeFunction('len', (args) => {
			const value = args.length > 0 ? args[0] : '';
			const str = this.expectString(value, 'string.len expects a string.', null);
			return [str.length];
		}));
		stringTable.set('upper', new LuaNativeFunction('upper', (args) => {
			const value = args.length > 0 ? args[0] : '';
			const str = this.expectString(value, 'string.upper expects a string.', null);
			return [str.toUpperCase()];
		}));
		stringTable.set('lower', new LuaNativeFunction('lower', (args) => {
			const value = args.length > 0 ? args[0] : '';
			const str = this.expectString(value, 'string.lower expects a string.', null);
			return [str.toLowerCase()];
		}));
		stringTable.set('sub', new LuaNativeFunction('sub', (args) => {
			const source = args.length > 0 ? args[0] : '';
			const str = this.expectString(source, 'string.sub expects a string.', null);
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
			const startArg = args.length > 1 ? this.expectNumber(args[1], 'string.sub expects numeric indices.', null) : 1;
			const endArg = args.length > 2 ? this.expectNumber(args[2], 'string.sub expects numeric indices.', null) : length;
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
		stringTable.set('find', new LuaNativeFunction('find', (args) => {
			const source = args.length > 0 ? args[0] : '';
			const pattern = args.length > 1 ? args[1] : '';
			const str = this.expectString(source, 'string.find expects a string.', null);
			const pat = this.expectString(pattern, 'string.find expects a pattern string.', null);
			let startIndex = 0;
			if (args.length > 2) {
				startIndex = Math.floor(this.expectNumber(args[2], 'string.find expects numeric start index.', null));
				if (startIndex < 1) {
					startIndex = 1;
				}
				startIndex -= 1;
			}
			const position = str.indexOf(pat, startIndex);
			if (position === -1) {
				return [null];
			}
			const first = position + 1;
			const last = first + pat.length - 1;
			return [first, last];
		}));
		stringTable.set('byte', new LuaNativeFunction('byte', (args) => {
			const source = args.length > 0 ? args[0] : '';
			const str = this.expectString(source, 'string.byte expects a string.', null);
			const positionArg = args.length > 1 ? this.expectNumber(args[1], 'string.byte expects a numeric position.', null) : 1;
			const position = Math.floor(positionArg) - 1;
			if (position < 0 || position >= str.length) {
				return [null];
			}
			return [str.charCodeAt(position)];
		}));
		stringTable.set('char', new LuaNativeFunction('char', (args) => {
			if (args.length === 0) {
				return [''];
			}
			let result = '';
			for (const value of args) {
				const code = this.expectNumber(value, 'string.char expects numeric character codes.', null);
				result += String.fromCharCode(Math.floor(code));
			}
			return [result];
		}));
		stringTable.set('format', new LuaNativeFunction('format', (args) => {
			if (args.length === 0) {
				throw this.runtimeError('string.format expects a format string.');
			}
			const template = this.expectString(args[0], 'string.format expects a format string.', null);
			let argumentIndex = 1;
			let output = '';

			const takeArgument = (): LuaValue => {
				const value = argumentIndex < args.length ? args[argumentIndex] : null;
				argumentIndex += 1;
				return value;
			};

			const readInteger = (startIndex: number): { found: boolean; value: number; nextIndex: number } => {
				let cursor = startIndex;
				while (cursor < template.length) {
					const code = template.charCodeAt(cursor);
					if (code < 48 || code > 57) {
						break;
					}
					cursor += 1;
				}
				if (cursor === startIndex) {
					return { found: false, value: 0, nextIndex: startIndex };
				}
				return { found: true, value: parseInt(template.slice(startIndex, cursor), 10), nextIndex: cursor };
			};

			for (let index = 0; index < template.length; index += 1) {
				const current = template.charAt(index);
				if (current !== '%') {
					output += current;
					continue;
				}
				if (index === template.length - 1) {
					throw this.runtimeError('string.format incomplete format specifier.');
				}
				if (template.charAt(index + 1) === '%') {
					output += '%';
					index += 1;
					continue;
				}

				let cursor = index + 1;
				const flags = { leftAlign: false, plus: false, space: false, zeroPad: false, alternate: false };
				while (true) {
					const flag = template.charAt(cursor);
					if (flag === '-') {
						flags.leftAlign = true;
						cursor += 1;
						continue;
					}
					if (flag === '+') {
						flags.plus = true;
						cursor += 1;
						continue;
					}
					if (flag === ' ') {
						flags.space = true;
						cursor += 1;
						continue;
					}
					if (flag === '0') {
						flags.zeroPad = true;
						cursor += 1;
						continue;
					}
					if (flag === '#') {
						flags.alternate = true;
						cursor += 1;
						continue;
					}
					break;
				}

				let width: number = null;
				if (template.charAt(cursor) === '*') {
					const widthArg = Math.trunc(this.expectNumber(takeArgument(), 'string.format width must be a number.', null));
					if (widthArg < 0) {
						flags.leftAlign = true;
						width = -widthArg;
					}
					else {
						width = widthArg;
					}
					cursor += 1;
				}
				else {
					const parsedWidth = readInteger(cursor);
					if (parsedWidth.found) {
						width = parsedWidth.value;
						cursor = parsedWidth.nextIndex;
					}
				}

				let precision: number = null;
				if (template.charAt(cursor) === '.') {
					cursor += 1;
					if (template.charAt(cursor) === '*') {
						const precisionArg = Math.trunc(this.expectNumber(takeArgument(), 'string.format precision must be a number.', null));
						precision = precisionArg >= 0 ? precisionArg : null;
						cursor += 1;
					}
					else {
						const parsedPrecision = readInteger(cursor);
						precision = parsedPrecision.found ? parsedPrecision.value : 0;
						cursor = parsedPrecision.nextIndex;
					}
				}

				while (template.charAt(cursor) === 'l' || template.charAt(cursor) === 'L' || template.charAt(cursor) === 'h') {
					cursor += 1;
				}

				const specifier = template.charAt(cursor);
				if (specifier.length === 0) {
					throw this.runtimeError('string.format incomplete format specifier.');
				}

				const signPrefix = (value: number): string => {
					if (value < 0) {
						return '-';
					}
					if (flags.plus) {
						return '+';
					}
					if (flags.space) {
						return ' ';
					}
					return '';
				};

				const applyPadding = (content: string, sign: string, prefix: string, allowZeroPadding: boolean): string => {
					const totalLength = sign.length + prefix.length + content.length;
					if (width !== null && totalLength < width) {
						const paddingLength = width - totalLength;
						if (flags.leftAlign) {
							return `${sign}${prefix}${content}${' '.repeat(paddingLength)}`;
						}
						const padChar = allowZeroPadding ? '0' : ' ';
						if (padChar === '0') {
							return `${sign}${prefix}${'0'.repeat(paddingLength)}${content}`;
						}
						return `${' '.repeat(paddingLength)}${sign}${prefix}${content}`;
					}
					return `${sign}${prefix}${content}`;
					};
					const zeroPadding = flags.zeroPad && !flags.leftAlign;

					switch (specifier) {
						case 's': {
							const value = takeArgument();
							let text = this.toLuaString(value);
						if (precision !== null) {
							text = text.substring(0, precision);
						}
						output += applyPadding(text, '', '', false);
						break;
					}
					case 'c': {
						const value = takeArgument();
						const code = Math.trunc(this.expectNumber(value, 'string.format %c expects a number.', null));
						const character = String.fromCharCode(code);
						output += applyPadding(character, '', '', false);
						break;
					}
					case 'd':
					case 'i':
					case 'u':
					case 'o':
					case 'x':
						case 'X': {
							const value = takeArgument();
							let number = this.expectNumber(value, LuaInterpreter.buildStringFormatSpecifierNumberMessage, specifier, null);
							let integerValue = Math.trunc(number);
							let unsigned = false;
							switch (specifier) {
								case 'u':
								case 'o':
								case 'x':
								case 'X':
									unsigned = true;
									break;
							}
							if (unsigned) {
							integerValue = integerValue >>> 0;
						}
						const negative = !unsigned && integerValue < 0;
						const sign = negative ? '-' : (specifier === 'd' || specifier === 'i') ? signPrefix(integerValue) : '';
						const magnitude = negative ? -integerValue : integerValue;
						let base = 10;
						if (specifier === 'o') {
							base = 8;
						}
						if (specifier === 'x' || specifier === 'X') {
							base = 16;
						}
						let digits = Math.trunc(magnitude).toString(base);
						if (specifier === 'X') {
							digits = digits.toUpperCase();
						}
						if (precision !== null) {
							const required = Math.max(precision, 0);
							if (digits.length < required) {
								digits = '0'.repeat(required - digits.length) + digits;
							}
							if (precision === 0 && magnitude === 0) {
								digits = '';
							}
						}
						let prefix = '';
						if (flags.alternate) {
							if ((specifier === 'x' || specifier === 'X') && magnitude !== 0) {
								prefix = specifier === 'x' ? '0x' : '0X';
							}
							if (specifier === 'o') {
								if (digits.length === 0) {
									digits = '0';
								}
								else if (digits.charAt(0) !== '0') {
									digits = `0${digits}`;
								}
							}
						}
							const allowZeroPad = zeroPadding && precision === null;
							output += applyPadding(digits, sign, prefix, allowZeroPad);
						break;
					}
					case 'f':
					case 'F': {
						const value = takeArgument();
						const number = this.expectNumber(value, 'string.format %f expects a number.', null);
						const sign = signPrefix(number);
						const fractionDigits = precision !== null ? Math.max(0, precision) : 6;
						const text = Math.abs(number).toFixed(fractionDigits);
						const formatted = flags.alternate && fractionDigits === 0 && text.indexOf('.') === -1 ? `${text}.` : text;
							output += applyPadding(formatted, sign, '', zeroPadding);
						break;
					}
					case 'e':
					case 'E': {
						const value = takeArgument();
						const number = this.expectNumber(value, 'string.format %e expects a number.', null);
						const sign = signPrefix(number);
						const fractionDigits = precision !== null ? Math.max(0, precision) : 6;
						let text = Math.abs(number).toExponential(fractionDigits);
						if (specifier === 'E') {
							text = text.toUpperCase();
						}
							output += applyPadding(text, sign, '', zeroPadding);
						break;
					}
					case 'g':
					case 'G': {
						const value = takeArgument();
						const number = this.expectNumber(value, 'string.format %g expects a number.', null);
						const sign = signPrefix(number);
						const significant = precision === null ? 6 : precision === 0 ? 1 : precision;
						let text = Math.abs(number).toPrecision(significant);
						if (!flags.alternate) {
							if (text.indexOf('e') !== -1 || text.indexOf('E') !== -1) {
								const parts = text.split(/e/i);
								let mantissa = parts[0];
								const exponent = parts[1];
								if (mantissa.indexOf('.') !== -1) {
									while (mantissa.endsWith('0')) {
										mantissa = mantissa.slice(0, -1);
									}
									if (mantissa.endsWith('.')) {
										mantissa = mantissa.slice(0, -1);
									}
								}
								text = `${mantissa}e${exponent}`;
							}
							else if (text.indexOf('.') !== -1) {
								while (text.endsWith('0')) {
									text = text.slice(0, -1);
								}
								if (text.endsWith('.')) {
									text = text.slice(0, -1);
								}
							}
						}
						if (specifier === 'G') {
							text = text.toUpperCase();
						}
							output += applyPadding(text, sign, '', zeroPadding);
						break;
					}
						case 'q': {
							const value = takeArgument();
							const raw = this.toLuaString(value);
						let escaped = '"';
						for (let charIndex = 0; charIndex < raw.length; charIndex += 1) {
							const code = raw.charCodeAt(charIndex);
							switch (code) {
								case 10:
									escaped += '\\n';
									break;
								case 13:
									escaped += '\\r';
									break;
								case 9:
									escaped += '\\t';
									break;
								case 92:
									escaped += '\\\\';
									break;
								case 34:
									escaped += '\\"';
									break;
								default:
									if (code < 32 || code === 127) {
										const decimal = code.toString(10);
										escaped += `\\${decimal.padStart(3, '0')}`;
									}
									else {
										escaped += raw.charAt(charIndex);
									}
									break;
							}
						}
						escaped += '"';
						output += applyPadding(escaped, '', '', false);
						break;
					}
					default:
						throw this.runtimeError(`string.format unsupported format specifier '%${specifier}'.`);
				}

				index = cursor;
			}

			return [output];
		}));
		stringTable.set('pack', new LuaNativeFunction('pack', (args) => {
			if (args.length === 0) {
				throw this.runtimeError('string.pack expects a format string.');
			}
			const format = this.expectString(args[0], 'string.pack expects a format string.', null);
			const tokens = packParseFormat(format);
			const bytes: number[] = [];
			let offset = 0;
			let argIndex = 1;
			const takeArg = (): LuaValue => {
				if (argIndex >= args.length) {
					throw this.runtimeError('string.pack missing value for format.');
				}
				const value = args[argIndex];
				argIndex += 1;
				return value;
			};
			for (let i = 0; i < tokens.length; i += 1) {
				const token = tokens[i];
				switch (token.kind) {
					case 'pad':
						bytes.push(0);
						offset += 1;
						break;
					case 'align': {
						const align = packGetNextAlign(tokens, i);
						offset = packPadToAlign(bytes, offset, align);
						break;
					}
					case 'int': {
						offset = packPadToAlign(bytes, offset, token.align);
						const value = this.expectNumber(takeArg(), 'string.pack expects a number.', null);
						packWriteInt(value, token.size, token.signed, token.littleEndian, bytes);
						offset += token.size;
						break;
					}
					case 'float': {
						offset = packPadToAlign(bytes, offset, token.align);
						const value = this.expectNumber(takeArg(), 'string.pack expects a number.', null);
						packWriteFloat(value, token.size, token.littleEndian, bytes);
						offset += token.size;
						break;
					}
					case 'fixed': {
						const text = this.expectString(takeArg(), 'string.pack expects a string.', null);
						const raw = packStringToBytes(text);
						const length = token.size;
						for (let j = 0; j < length; j += 1) {
							bytes.push(j < raw.length ? raw[j] : 0);
						}
						offset += length;
						break;
					}
					case 'z': {
						const text = this.expectString(takeArg(), 'string.pack expects a string.', null);
						const raw = packStringToBytes(text);
						for (let j = 0; j < raw.length; j += 1) {
							if (raw[j] === 0) {
								throw this.runtimeError('string.pack z strings must not contain zero bytes.');
							}
							bytes.push(raw[j]);
						}
						bytes.push(0);
						offset += raw.length + 1;
						break;
					}
					case 'len': {
						offset = packPadToAlign(bytes, offset, token.align);
						const text = this.expectString(takeArg(), 'string.pack expects a string.', null);
						const raw = packStringToBytes(text);
						packWriteInt(raw.length, token.lenSize, false, token.littleEndian, bytes);
						offset += token.lenSize;
						for (let j = 0; j < raw.length; j += 1) {
							bytes.push(raw[j]);
						}
						offset += raw.length;
						break;
					}
					default:
						throw this.runtimeError('string.pack invalid format token.');
				}
			}
			return [packBytesToString(new Uint8Array(bytes))];
		}));
		stringTable.set('packsize', new LuaNativeFunction('packsize', (args) => {
			if (args.length === 0) {
				throw this.runtimeError('string.packsize expects a format string.');
			}
			const format = this.expectString(args[0], 'string.packsize expects a format string.', null);
			const tokens = packParseFormat(format);
			let offset = 0;
			for (let i = 0; i < tokens.length; i += 1) {
				const token = tokens[i];
				switch (token.kind) {
					case 'pad':
						offset += 1;
						break;
					case 'align': {
						const align = packGetNextAlign(tokens, i);
						const padding = packAlignmentPadding(offset, align);
						offset += padding;
						break;
					}
					case 'int': {
						const align = token.align;
						const padding = packAlignmentPadding(offset, align);
						offset += padding + token.size;
						break;
					}
					case 'float': {
						const align = token.align;
						const padding = packAlignmentPadding(offset, align);
						offset += padding + token.size;
						break;
					}
					case 'fixed':
						offset += token.size;
						break;
					case 'z':
					case 'len':
						throw this.runtimeError('string.packsize format is variable-length.');
					default:
						throw this.runtimeError('string.packsize invalid format token.');
				}
			}
			return [offset];
		}));
		stringTable.set('unpack', new LuaNativeFunction('unpack', (args) => {
			if (args.length < 2) {
				throw this.runtimeError('string.unpack expects a format string and source string.');
			}
			const format = this.expectString(args[0], 'string.unpack expects a format string.', null);
			const source = this.expectString(args[1], 'string.unpack expects a source string.', null);
			const startValue = args.length > 2 ? this.expectNumber(args[2], 'string.unpack expects a numeric start index.', null) : 1;
			const startIndex = Math.floor(startValue);
			const bytes = packStringToBytes(source);
			if (startIndex < 1 || startIndex > bytes.length + 1) {
				throw this.runtimeError('string.unpack start index out of range.');
			}
			const tokens = packParseFormat(format);
			const results: LuaValue[] = [];
			let offset = startIndex - 1;
			const ensure = (length: number): void => {
				if (offset + length > bytes.length) {
					throw this.runtimeError('string.unpack string is too short.');
				}
			};
			for (let i = 0; i < tokens.length; i += 1) {
				const token = tokens[i];
				switch (token.kind) {
					case 'pad':
						ensure(1);
						offset += 1;
						break;
					case 'align': {
						const align = packGetNextAlign(tokens, i);
						const padding = packAlignmentPadding(offset, align);
						ensure(padding);
						offset += padding;
						break;
					}
					case 'int': {
						const align = token.align;
						const padding = packAlignmentPadding(offset, align);
						ensure(padding + token.size);
						offset += padding;
						const value = packReadInt(bytes, offset, token.size, token.signed, token.littleEndian);
						results.push(value);
						offset += token.size;
						break;
					}
					case 'float': {
						const align = token.align;
						const padding = packAlignmentPadding(offset, align);
						ensure(padding + token.size);
						offset += padding;
						const value = packReadFloat(bytes, offset, token.size, token.littleEndian);
						results.push(value);
						offset += token.size;
						break;
					}
					case 'fixed': {
						ensure(token.size);
						const slice = bytes.subarray(offset, offset + token.size);
						results.push(packBytesToString(slice));
						offset += token.size;
						break;
					}
					case 'z': {
						let end = offset;
						while (end < bytes.length && bytes[end] !== 0) {
							end += 1;
						}
						if (end >= bytes.length) {
							throw this.runtimeError('string.unpack zero-terminated string not found.');
						}
						const slice = bytes.subarray(offset, end);
						results.push(packBytesToString(slice));
						offset = end + 1;
						break;
					}
					case 'len': {
						const align = token.align;
						const padding = packAlignmentPadding(offset, align);
						ensure(padding + token.lenSize);
						offset += padding;
						const length = packReadInt(bytes, offset, token.lenSize, false, token.littleEndian);
						offset += token.lenSize;
						if (length < 0) {
							throw this.runtimeError('string.unpack invalid length.');
						}
						ensure(length);
						const slice = bytes.subarray(offset, offset + length);
						results.push(packBytesToString(slice));
						offset += length;
						break;
					}
					default:
						throw this.runtimeError('string.unpack invalid format token.');
				}
			}
			results.push(offset + 1);
			return results;
		}));
		this.globals.set('string', stringTable);

		const tableLibrary = createLuaTable();
		tableLibrary.set('insert', new LuaNativeFunction('insert', (args) => {
			if (args.length < 2) {
				throw this.runtimeError('table.insert expects at least two arguments.');
			}
			const target = args[0];
			if (!(isLuaTable(target))) {
				throw this.runtimeError('table.insert expects a table as the first argument.');
			}
			let position: number = null;
			let value: LuaValue;
			if (args.length === 2) {
				value = args[1];
			}
			else {
				position = Math.floor(this.expectNumber(args[1], 'table.insert position must be a number.', null));
				value = args[2];
			}
			this.tableInsert(target, value, position);
			return EMPTY_VALUES;
		}));

		tableLibrary.set('remove', new LuaNativeFunction('remove', (args) => {
			if (args.length === 0 || !(isLuaTable(args[0]))) {
				throw this.runtimeError('table.remove expects a table as the first argument.');
			}
			const target = args[0] as LuaTable;
			const position = args.length > 1 ? Math.floor(this.expectNumber(args[1], 'table.remove position must be a number.', null)) : null;
			const removed = this.tableRemove(target, position);
			return removed === null ? EMPTY_VALUES : [removed];
		}));

		tableLibrary.set('concat', new LuaNativeFunction('concat', (args) => {
			if (args.length === 0 || !(isLuaTable(args[0]))) {
				throw this.runtimeError('table.concat expects a table as the first argument.');
			}
			const target = args[0] as LuaTable;
			const separator = args.length > 1 && typeof args[1] === 'string' ? args[1] : '';
			const startIndexRaw = args.length > 2 ? this.expectNumber(args[2], 'table.concat expects numeric start index.', null) : 1;
			const endIndexRaw = args.length > 3 ? this.expectNumber(args[3], 'table.concat expects numeric end index.', null) : target.numericLength();
			const length = target.numericLength();
			const startIndex = this.tableRangeStart(length, startIndexRaw);
			const endIndex = this.tableRangeEnd(length, endIndexRaw);
			if (endIndex < startIndex) {
				return [''];
			}
			const parts: string[] = [];
			for (let index = startIndex; index <= endIndex; index += 1) {
				const value = target.get(index);
				parts.push(value === null ? '' : this.toLuaString(value));
			}
			return [parts.join(separator)];
		}));

		tableLibrary.set('pack', new LuaNativeFunction('pack', (args) => {
			const table = createLuaTable();
			for (let index = 0; index < args.length; index += 1) {
				table.set(index + 1, args[index]);
			}
			table.set('n', args.length);
			return [table];
		}));

		tableLibrary.set('unpack', new LuaNativeFunction('unpack', (args) => {
			if (args.length === 0 || !(isLuaTable(args[0]))) {
				throw this.runtimeError('table.unpack expects a table as the first argument.');
			}
			const target = args[0] as LuaTable;
			const length = target.numericLength();
			const startIndexRaw = args.length > 1 ? this.expectNumber(args[1], 'table.unpack expects numeric start index.', null) : 1;
			const endIndexRaw = args.length > 2 ? this.expectNumber(args[2], 'table.unpack expects numeric end index.', null) : length;
			const startIndex = this.tableRangeStart(length, startIndexRaw);
			const endIndex = this.tableRangeEnd(length, endIndexRaw);
			if (endIndex < startIndex) {
				return EMPTY_VALUES;
			}
			const result = this.allocateValueList();
			for (let index = startIndex; index <= endIndex; index += 1) {
				result.push(target.get(index));
			}
			return result;
		}));

		// table.fromnative(value): convert a native Array (or LuaNativeValue wrapping one) into a Lua table.
		// Numeric slots become 1-based Lua indices; the original native Array is kept on __native for pass-through.
		tableLibrary.set('fromnative', new LuaNativeFunction('table.fromnative', (args) => {
			if (args.length === 0) {
				return [createLuaTable()];
			}
			const source = args[0];
			if (isLuaTable(source)) {
				return [source];
			}
			let nativeValue: unknown = source;
			if (source instanceof LuaNativeValue) {
				nativeValue = source.native;
			}
			if (!Array.isArray(nativeValue)) {
				return [createLuaTable()];
			}
			const table = createLuaTable();
			const array = nativeValue as unknown[];
			for (let index = 0; index < array.length; index += 1) {
				table.set(index + 1, this.convertFromHost(array[index]));
			}
			table.set('__native', this.getOrCreateNativeValue(array, 'Array'));
			return [table];
		}));

		tableLibrary.set('sort', new LuaNativeFunction('sort', (args) => {
			if (args.length === 0 || !(isLuaTable(args[0]))) {
				throw this.runtimeError('table.sort expects a table as the first argument.');
			}
			const target = args[0] as LuaTable;
			const comparator = args.length > 1 && args[1] !== null
				? this.expectFunction(args[1], 'table.sort comparator must be a function.', null)
				: null;
			const length = target.numericLength();
			const values = this.allocateValueList();
			for (let index = 1; index <= length; index += 1) {
				values.push(target.get(index));
			}
			const comparatorArgs = comparator ? this.allocateValueList() : null;
			if (comparatorArgs !== null) {
				comparatorArgs.length = 2;
			}
			values.sort((left, right) => {
				if (comparator) {
					comparatorArgs![0] = left;
					comparatorArgs![1] = right;
					const response = comparator.call(comparatorArgs!);
					if (isLuaCallSignal(response)) {
						return 1;
					}
					const first = response.length > 0 ? response[0] : null;
						return this.isTruthy(first) ? -1 : 1;
				}
				return this.defaultSortCompare(left, right);
			});
			for (let index = 1; index <= length; index += 1) {
				target.set(index, values[index - 1]);
			}
			return [target];
		}));

		this.globals.set('table', tableLibrary);

		const osTable = createLuaTable();
		osTable.set('time', new LuaNativeFunction('os.time', (args) => {
			if (args.length === 0) {
				return [Math.floor(engineCore.platform.clock.now() / 1000)];
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
				this.expectNumber(year, 'os.time table requires year.', null),
				this.expectNumber(month, 'os.time table requires month.', null) - 1,
				this.expectNumber(day, 'os.time table requires day.', null),
				this.expectNumber(hour !== null ? hour : 0, 'os.time invalid hour.', null),
				this.expectNumber(min !== null ? min : 0, 'os.time invalid minute.', null),
				this.expectNumber(sec !== null ? sec : 0, 'os.time invalid second.', null)
			);
			return [Math.floor(date.getTime() / 1000)];
		}));
		osTable.set('date', new LuaNativeFunction('os.date', (args) => {
			const formatValue = args.length > 0 ? args[0] : null;
			const timestampValue = args.length > 1 ? args[1] : null;
			const timestamp = timestampValue === null ? Math.floor(engineCore.platform.clock.now() / 1000) : Math.floor(this.expectNumber(timestampValue, 'os.date expects numeric timestamp.', null));
			const date = new Date(timestamp * 1000);
			if (formatValue === null) {
				return [date.toISOString()];
			}
			const format = this.expectString(formatValue, 'os.date expects a format string.', null);
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
		osTable.set('difftime', new LuaNativeFunction('os.difftime', (args) => {
			const t2 = args.length > 0 ? this.expectNumber(args[0], 'os.difftime expects numeric arguments.', null) : 0;
			const t1 = args.length > 1 ? this.expectNumber(args[1], 'os.difftime expects numeric arguments.', null) : 0;
			return [t2 - t1];
		}));
		this.globals.set('os', osTable);

		this.globals.set('pairs', new LuaNativeFunction('pairs', (args) => {
			if (args.length === 0) {
				throw this.runtimeError('pairs expects a table or native value argument.');
			}
			const target = args[0];
			const pairsMetamethod = this.extractMetamethodFunction(target, '__pairs', null);
			if (pairsMetamethod !== null) {
				const metaArgs = this.allocateValueList();
				metaArgs.push(target);
				const result = pairsMetamethod.call(metaArgs);
				if (isLuaCallSignal(result)) {
					return result;
				}
					if (result.length < 2) {
						throw this.runtimeError('__pairs metamethod must return at least two values.');
					}
					return result;
				}
			if (isLuaTable(target)) {
				const nextBuiltin = this.globals.get('next');
				const iterator = this.expectFunction(nextBuiltin, 'next function unavailable.', null);
				return [iterator, target, null];
			}
			if (target instanceof LuaNativeValue) {
				return this.createNativePairsIterator(target);
			}
			throw this.runtimeError('pairs expects a table or native value argument.');
		}));

		this.globals.set('ipairs', new LuaNativeFunction('ipairs', (args) => {
			if (args.length === 0) {
				throw this.runtimeError('ipairs expects a table or native value argument.');
			}
			const target = args[0];
			const ipairsMetamethod = this.extractMetamethodFunction(target, '__ipairs', null);
			if (ipairsMetamethod !== null) {
				const metaArgs = this.allocateValueList();
				metaArgs.push(target);
				const result = ipairsMetamethod.call(metaArgs);
				if (isLuaCallSignal(result)) {
					return result;
				}
					if (result.length < 2) {
						throw this.runtimeError('__ipairs metamethod must return at least two values.');
					}
					return result;
				}
				if (isLuaTable(target)) {
					const iterator = new LuaNativeFunction('ipairs_iterator', (iteratorArgs) => {
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
					return [iterator, target, 0];
				}
			if (target instanceof LuaNativeValue) {
				return this.createNativeIpairsIterator(target);
			}
			throw this.runtimeError('ipairs expects a table or native value argument.');
		}));

		this.globals.set('serialize', new LuaNativeFunction('serialize', (args) => {
			const value = args.length > 0 ? args[0] : null;
			try {
				const serialized = this.serializeValueInternal(value, new Set<LuaTable>());
				return [JSON.stringify(serialized)];
			}
			catch (error) {
				const message = extractErrorMessage(error);
				throw this.runtimeError(`serialize failed: ${message}`);
			}
		}));

		this.globals.set('deserialize', new LuaNativeFunction('deserialize', (args) => {
			if (args.length === 0) {
				throw this.runtimeError('deserialize expects a string argument.');
			}
			const source = args[0];
			if (typeof source !== 'string') {
				throw this.runtimeError('deserialize expects a string argument.');
			}
			try {
				const parsed = JSON.parse(source);
				const value = this.deserializeValueInternal(parsed);
				return [value];
			}
			catch (error) {
				const message = extractErrorMessage(error);
				throw this.runtimeError(`deserialize failed: ${message}`);
			}
			}));
		}

	private normalizeTableRangeIndex(length: number, value: number, fallback: number): number {
		const integer = Math.floor(value);
		if (integer > 0) {
			return integer;
		}
		if (integer < 0) {
			return length + integer + 1;
		}
		return fallback;
	}

	private tableRangeStart(length: number, value: number): number {
		const index = this.normalizeTableRangeIndex(length, value, 1);
		if (index < 1 || length < 1) {
			return 1;
		}
		return index > length ? length : index;
	}

	private tableRangeEnd(length: number, value: number): number {
		const index = this.normalizeTableRangeIndex(length, value, length);
		if (index < 0) {
			return 0;
		}
		return index > length ? length : index;
	}

	private tableInsert(table: LuaTable, value: LuaValue, position: number): void {
		const length = table.numericLength();
		let targetIndex = position === null ? length + 1 : position;
		if (targetIndex < 1) {
			targetIndex = 1;
		} else if (targetIndex > length + 1) {
			targetIndex = length + 1;
		}
		for (let index = length; index >= targetIndex; index -= 1) {
			const current = table.get(index);
			table.set(index + 1, current);
		}
		table.set(targetIndex, value);
	}

	private tableRemove(table: LuaTable, position: number): LuaValue {
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

	public runtimeError(message: string): LuaRuntimeError {
		this.markFaultEnvironment();
		const range = this._currentCallRange;
		if (range !== null) return new LuaRuntimeError(message, range.path, range.start.line, range.start.column);
		return new LuaRuntimeError(message, this.currentChunk, 0, 0);
	}

	public runtimeErrorAt(range: LuaSourceRange, message: string): LuaRuntimeError {
		this.markFaultEnvironment();
		return new LuaRuntimeError(message, range.path, range.start.line, range.start.column);
	}

	private throwErrorWithRangeOrCurrentRange(range: LuaSourceRange | null, message: string): never {
		if (range !== null) throw this.runtimeErrorAt(range, message);
		throw this.runtimeError(message);
	}

}
