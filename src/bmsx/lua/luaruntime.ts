import {
	LuaSyntaxKind,
	LuaBinaryOperator,
	LuaUnaryOperator,
	LuaTableFieldKind,
	LuaAssignmentOperator,
} from './lua_ast';
import type {
	LuaAssignableExpression,
	LuaAssignmentStatement,
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
	LuaBreakStatement,
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
} from './lua_ast';
import { LuaEnvironment } from './luaenvironment';
import { LuaRuntimeError, LuaSyntaxError } from './luaerrors';
import { LuaLexer } from './lualexer';
import { type CanonicalizationType } from '../rompack/rompack';
import { LuaParser } from './luaparser';
import { createIdentifierCanonicalizer } from './identifier_canonicalizer';
import { LuaFunctionValue, LuaValue, LuaTable, LuaNativeValue } from './luavalue';
import {
	createLuaNativeMemberHandle,
	createLuaTable,
	extractErrorMessage,
	isLuaDebuggerPauseSignal,
	isLuaNativeMemberHandle,
	isLuaTable,
	resolveNativeTypeName,
	type LuaNativeMemberHandle
} from './luavalue';
import { LuaDebuggerController, type LuaDebuggerPauseReason } from './luadebugger';
import { $ } from '../core/game';
import { BmsxVMRuntime } from '../vm/vm_runtime';
import { isLuaHandlerFunction } from './luahandler_cache';
import { LuaInteropAdapter } from '../vm/lua_js_bridge';

export type LuaCallFrame = {
	readonly functionName: string;
	readonly source: string;
	readonly line: number;
	readonly column: number;
};

const EMPTY_VALUES: LuaValue[] = Object.freeze([]) as unknown as LuaValue[];
const EMPTY_CALLSTACK: ReadonlyArray<LuaCallFrame> = Object.freeze([]) as unknown as ReadonlyArray<LuaCallFrame>;

export const enum VmSliceResult {
	Done = 0,
	Yield = 1,
	Pause = 2,
	Fault = 3,
}

export type ExecutionSignal =
	| null
	| { readonly kind: 'return' }
	| { readonly kind: 'break'; readonly origin: LuaStatement }
	| { readonly kind: 'goto'; readonly label: string; readonly origin: LuaGotoStatement }
	| {
		readonly kind: 'yield';
		readonly location: { chunk: string; line: number; column: number };
		readonly callStack: ReadonlyArray<LuaCallFrame>;
		readonly resume: (instructionBudget: number) => ExecutionSignal;
	}
	| {
		readonly kind: 'pause';
		readonly reason: LuaDebuggerPauseReason;
		readonly location: { chunk: string; line: number; column: number };
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
	location: { chunk: string; line: number; column: number };
	callStack: ReadonlyArray<LuaCallFrame>;
	resume: (instructionBudget: number) => ExecutionSignal;
};
type NestedInterpreterState = {
	frameStack: ExecutionFrame[];
	envStack: LuaEnvironment[];
	chunkEnvironment: LuaEnvironment;
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
	readonly chunk: LuaChunk;
	readonly chunkScope: LuaEnvironment;
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

	public runSlice(instructionBudget: number | null): VmSliceResult {
		try {
			const signal = this.runImpl(instructionBudget);
			return this.consumeSignal(signal);
		} catch (error) {
			if (isLuaDebuggerPauseSignal(error)) {
				this.paused = error as PauseSignal;
				return VmSliceResult.Pause;
			}
			this.fault = error as Error;
			return VmSliceResult.Fault;
		}
	}

	public resumeSlice(instructionBudget: number): VmSliceResult {
		try {
			const yielded = this.yielded;
			this.yielded = null;
			const signal = yielded.resume(instructionBudget);
			return this.consumeSignal(signal);
		} catch (error) {
			if (isLuaDebuggerPauseSignal(error)) {
				this.paused = error as PauseSignal;
				return VmSliceResult.Pause;
			}
			this.fault = error as Error;
			return VmSliceResult.Fault;
		}
	}

	private consumeSignal(signal: ExecutionSignal): VmSliceResult {
		if (!signal) {
			return VmSliceResult.Done;
		}
		switch (signal.kind) {
			case 'yield':
				this.yielded = signal as YieldSignal;
				return VmSliceResult.Yield;
			case 'pause':
				this.paused = signal as PauseSignal;
				return VmSliceResult.Pause;
			default:
				return VmSliceResult.Done;
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

export interface LuaHostAdapter {
	toJs(value: LuaValue, interpreter: LuaInterpreter): unknown;
}

export class LuaNativeFunction implements LuaFunctionValue {
	public readonly name: string;
	private readonly handler: (args: ReadonlyArray<LuaValue>) => ReadonlyArray<LuaValue>;

	constructor(name: string, handler: (args: ReadonlyArray<LuaValue>) => ReadonlyArray<LuaValue>) {
		this.name = name;
		this.handler = handler;
	}

	public call(args: ReadonlyArray<LuaValue>): LuaValue[] {
		try {
			const result = this.handler(args);
			return Array.from(result);
		} catch (error) {
			if (isLuaDebuggerPauseSignal(error)) {
				throw error;
			}
			BmsxVMRuntime.instance.interpreter.recordFaultCallStack();
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

	public call(args: ReadonlyArray<LuaValue>): LuaValue[] {
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

type LabelMetadata = {
	readonly index: number;
	readonly statement: LuaLabelStatement;
};

type LabelScope = {
	readonly labels: Map<string, LabelMetadata>;
	readonly parent: LabelScope;
};

type FrameBoundary = 'chunk' | 'function' | 'block';

type StatementsFrame = {
	readonly kind: 'statements';
	statements: ReadonlyArray<LuaStatement>;
	index: number;
	environment: LuaEnvironment;
	varargs: ReadonlyArray<LuaValue>;
	scope: LabelScope;
	boundary: FrameBoundary;
	callFramePushed: boolean;
	callRange: LuaSourceRange;
};

type WhileFrame = {
	readonly kind: 'while';
	readonly statement: LuaWhileStatement;
	environment: LuaEnvironment;
	varargs: ReadonlyArray<LuaValue>;
	scope: LabelScope;
	readonly loopEnvironment: LuaEnvironment;
};

type RepeatFrame = {
	readonly kind: 'repeat';
	readonly statement: LuaRepeatStatement;
	readonly baseEnvironment: LuaEnvironment;
	environment: LuaEnvironment;
	varargs: ReadonlyArray<LuaValue>;
	scope: LabelScope;
	iterationEnvironment: LuaEnvironment | null;
	state: 'body' | 'condition';
};

type NumericForFrame = {
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

type GenericForFrame = {
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

type ExecutionFrame = StatementsFrame | WhileFrame | RepeatFrame | NumericForFrame | GenericForFrame;

export class LuaInterpreter {
	private readonly globals: LuaEnvironment;
	private currentChunk: string;
	private randomSeedValue: number;
	private _reservedIdentifiers: Set<string> = new Set<string>();
	private _currentCallRange: LuaSourceRange = null;
	private _chunkEnvironment: LuaEnvironment = null;
	private readonly chunkDefinitions: Map<string, ReadonlyArray<LuaDefinitionInfo>> = new Map();
	private readonly envStack: LuaEnvironment[] = [];
	private _lastFaultEnvironment: LuaEnvironment = null;
	private readonly callStack: LuaCallFrame[] = [];
	private debuggerController: LuaDebuggerController = null;
	private _lastFaultCallStack: LuaCallFrame[] = [];
	private valueNameCache = new WeakMap<object | Function, string>();
	private lastFaultDepth: number = 0;
	private _pendingDebuggerException: LuaRuntimeError | LuaSyntaxError = null;
	private _exceptionResumeStrategy: LuaExceptionResumeStrategy = 'propagate';
	private pendingExceptionFrame: { frame: StatementsFrame; index: number } = null;
	private programCounterValue = 0;
	private readonly programCounterStack: number[] = [];
	private instructionBudgetRemaining: number | null = null;
	private yieldTargetDepth = 0;
	private readonly yieldLocation = { chunk: '<chunk>', line: 0, column: 0 };
	private readonly yieldSignal: MutableYieldSignal;
	private readonly luaValueListScratch: LuaValue[][] = [];
	private luaValueListScratchIndex = 0;
	private readonly returnValueBuffer: LuaValue[] = [];
	private adapter!: LuaInteropAdapter;
	private caseInsensitiveNativeAccess = true;
	private identifierCanonicalizationMode: CanonicalizationType = 'none';
	private readonly canonicalize: (value: string) => string;
	private nativeValueCache: WeakMap<object | Function, LuaNativeValue> = new WeakMap();
	private readonly nativeMethodCache: WeakMap<LuaNativeValue, Map<string, LuaFunctionValue>> = new WeakMap<
		LuaNativeValue,
		Map<string, LuaFunctionValue>
	>();
	private readonly packageTable: LuaTable;
	private readonly packageLoaded: LuaTable;
	private _requireHandler: ((interpreter: LuaInterpreter, moduleName: string) => LuaValue) = null;
	private _outputHandler: ((text: string) => void) = (text: string) => { console.log(text); BmsxVMRuntime.instance.terminal.appendStdout(text); };
	private readonly frameStack: ExecutionFrame[] = [];
	private activeStatementRange: LuaSourceRange = null;
	private activeStatementFrame: StatementsFrame = null;
	private lastStatementRange: LuaSourceRange = null;

	public constructor(adapter: LuaInteropAdapter, canonicalization: CanonicalizationType = 'none') {
		this.globals = LuaEnvironment.createRoot();
		this.adapter = adapter;
		this.identifierCanonicalizationMode = canonicalization;
		this.canonicalize = createIdentifierCanonicalizer(canonicalization);
		this.caseInsensitiveNativeAccess = canonicalization !== 'none';
		this.currentChunk = '<chunk>';
		this.randomSeedValue = $.platform.clock.now();
		this.packageTable = createLuaTable();
		this.packageLoaded = createLuaTable();
		this.initializeBuiltins();
		this._chunkEnvironment = LuaEnvironment.createChild(this.globals);
		this.yieldSignal = {
			kind: 'yield',
			location: this.yieldLocation,
			callStack: EMPTY_CALLSTACK,
			resume: (instructionBudget: number) => this.runFrameLoop(this.yieldTargetDepth, instructionBudget),
		};
	}

	public execute(source: string, chunkName: string): LuaValue[] {
		const chunk = this.prepareChunk(source, chunkName);
		return this.executeChunk(chunk);
	}

	private prepareChunk(source: string, chunkName: string): LuaChunk {
		const lexer = new LuaLexer(source, chunkName, { canonicalizeIdentifiers: this.identifierCanonicalizationMode });
		const tokens = lexer.scanTokens();
		const parser = new LuaParser(tokens, chunkName, source);
		const chunk = parser.parseChunk();
		this.validateReservedIdentifiers(chunk.body);
		this.chunkDefinitions.set(chunk.range.chunkName, chunk.definitions);
		return chunk;
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
		this.debuggerController = controller;
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
		return this.programCounterValue;
	}

	public set programCounter(value: number) {
		this.programCounterValue = value;
	}

	public advanceProgramCounter(): number {
		this.programCounterValue += 1;
		if (this.instructionBudgetRemaining !== null) {
			this.instructionBudgetRemaining -= 1;
		}
		return this.programCounterValue;
	}

	private allocateValueList(): LuaValue[] {
		const index = this.luaValueListScratchIndex++;
		let list = this.luaValueListScratch[index];
		if (list === undefined) {
			list = [];
			this.luaValueListScratch[index] = list;
		}
		list.length = 0;
		return list;
	}

	private consumeReturnValues(): LuaValue[] {
		const result = Array.from(this.returnValueBuffer);
		this.returnValueBuffer.length = 0;
		return result;
	}

	public pushProgramCounter(): number {
		this.programCounterStack.push(this.programCounterValue);
		return this.programCounterValue;
	}

	public popProgramCounter(): number {
		const restored = this.programCounterStack.pop()!;
		this.programCounterValue = restored;
		return restored;
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
		let cached = this.nativeValueCache.get(value);
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

	private beginChunkExecution(chunk: LuaChunk): ChunkExecutionContext {
		const nested = this.frameStack.length > 0;
		const savedState: NestedInterpreterState | null = nested ? {
			frameStack: Array.from(this.frameStack),
			envStack: Array.from(this.envStack),
			chunkEnvironment: this._chunkEnvironment,
			currentChunk: this.currentChunk,
			valueNameCache: this.valueNameCache,
			lastFaultCallStack: this._lastFaultCallStack,
			lastFaultDepth: this.lastFaultDepth,
			lastFaultEnvironment: this._lastFaultEnvironment,
			callStackLength: this.callStack.length,
			currentCallRange: this._currentCallRange,
			programCounter: this.programCounterValue,
			programCounterStack: Array.from(this.programCounterStack),
			lastStatementRange: this.lastStatementRange,
		} : null;

		this.valueNameCache = new WeakMap<object | Function, string>();
		this.currentChunk = chunk.range.chunkName;
		const chunkScope = LuaEnvironment.createChild(this.globals);
		this._chunkEnvironment = chunkScope;
		this.envStack.length = 0;
		this.frameStack.length = 0;
		this._lastFaultCallStack = [];
		this.lastFaultDepth = 0;
		this.programCounterStack.length = 0;
		this.lastStatementRange = null;
		const rootScope = this.createLabelScope(chunk.body, null);
		this.pushStatementsFrame({
			statements: chunk.body,
			environment: chunkScope,
			varargs: [],
			scope: rootScope,
			boundary: 'chunk',
			callRange: chunk.range,
			callName: '<chunk>',
		});
		return { chunk, chunkScope, nested, savedState };
	}

	private runChunkExecution(context: ChunkExecutionContext, instructionBudget: number | null): ExecutionSignal {
		let suspended = false;
		try {
			const signal = this.runFrameLoop(0, instructionBudget);
			if (signal !== null && signal.kind === 'return') {
				return signal;
			}
			if (signal !== null && signal.kind === 'break') {
				const breakStatement = signal.origin as LuaBreakStatement;
				throw this.runtimeErrorAt(breakStatement.range, 'Unexpected break outside of loop.');
			}
			if (signal !== null && signal.kind === 'goto') {
				throw this.runtimeErrorAt(signal.origin.range, `Label '${signal.label}' not found.`);
			}
			if (signal !== null && signal.kind === 'pause') {
				suspended = true;
				const wrapped = this.wrapPauseSignal(signal, (resumed) => {
					if (resumed !== null && resumed.kind === 'pause') {
						return resumed;
					}
					if (resumed !== null && resumed.kind === 'yield') {
						return this.wrapYieldSignal(resumed as YieldSignal, context);
					}
					return this.handleChunkContinuation(resumed, context);
				});
				throw wrapped;
			}
			if (signal !== null && signal.kind === 'yield') {
				suspended = true;
				return this.wrapYieldSignal(signal as YieldSignal, context);
			}
			return NORMAL_SIGNAL;
		} catch (error) {
			if (!isLuaDebuggerPauseSignal(error)) {
				this.recordFaultCallStack();
			}
			if (isLuaDebuggerPauseSignal(error)) {
				suspended = true;
			}
			throw error;
		} finally {
			if (!suspended) {
				this.finalizeChunkExecution(context.chunkScope, context.savedState, context.nested);
			}
		}
	}

	protected executeChunk(chunk: LuaChunk): LuaValue[] {
		const context = this.beginChunkExecution(chunk);
		const signal = this.runChunkExecution(context, null);
		if (signal !== null && signal.kind === 'return') {
			return this.consumeReturnValues();
		}
		return [];
	}

	public enumerateChunkEntries(): ReadonlyArray<[string, LuaValue]> {
		return this._chunkEnvironment!.entries();
	}

	public get chunkEnvironment(): LuaEnvironment {
		return this._chunkEnvironment;
	}

	public getChunkDefinitions(chunkName: string): ReadonlyArray<LuaDefinitionInfo> {
		return this.chunkDefinitions.get(chunkName);
	}

	public hasChunkBinding(name: string): boolean {
		return this._chunkEnvironment!.resolve(name) !== null;
	}

	public assignChunkValue(name: string, value: LuaValue): void {
		const target = this._chunkEnvironment!.resolve(name);
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
		if (typeof value !== 'object' && typeof value !== 'function') return undefined;
		const cached = this.valueNameCache.get(value);
		if (cached) return cached;
		const chunkEntries = this.enumerateChunkEntries();
		for (let i = 0; i < chunkEntries.length; i++) {
			const entry = chunkEntries[i]!;
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
		if (value !== null && (typeof value === 'object' || typeof value === 'function')) {
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
		let snapshotDepth = snapshot.length;
		const innermostRange = this.activeStatementRange ?? this.lastStatementRange;
		if (innermostRange) {
			const innermost = snapshot[snapshot.length - 1];
			const alreadyCaptured =
				innermost.source === innermostRange.chunkName &&
				innermost.line === innermostRange.start.line &&
				innermost.column === innermostRange.start.column;
			if (!alreadyCaptured) {
				innermost.source = innermostRange.chunkName;
				innermost.line = innermostRange.start.line;
				innermost.column = innermostRange.start.column;
			}
		}
		if (this._lastFaultCallStack.length > 0 && snapshotDepth < this.lastFaultDepth) {
			return;
		}
		const controller = this.debuggerController;
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
		return { labels: this.buildLabelMap(statements), parent };
	}

	private pushFrame(frame: ExecutionFrame): void {
		this.frameStack.push(frame);
		this.envStack.push(frame.environment);
	}

	private popFrame(): ExecutionFrame {
		const frame = this.frameStack.pop()!;
		this.envStack.pop();
		if (frame.kind === 'statements' && frame.callFramePushed) {
			this.callStack.pop();
		}
		return frame;
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
		const callRange = config.callRange ?? this.fallbackSourceRange();
		let callFramePushed = false;
		if (config.boundary !== 'block') {
			this.callStack.push({
				functionName: config.callName && config.callName.length > 0 ? config.callName : null,
				source: callRange.chunkName,
				line: callRange.start.line,
				column: callRange.start.column,
			});
			callFramePushed = true;
		}
		const frame: StatementsFrame = {
			kind: 'statements',
			statements: config.statements,
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
				let signal: ExecutionSignal;
					try {
						signal = this.stepFrame(frame);
					} catch (error) {
						if (isLuaDebuggerPauseSignal(error)) {
							return this.bindPauseResume(error as PauseSignal, targetDepth);
						}
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

	private stepFrame(frame: ExecutionFrame): ExecutionSignal {
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
				throw this.runtimeError('Unsupported execution frame.');
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
		const controller = this.debuggerController;
		const decorated = controller ? controller.decorateCallStack(snapshot, { consume: true }) : snapshot;
		return decorated.map(frame => ({
			functionName: frame.functionName,
			source: frame.source,
			line: frame.line,
			column: frame.column,
		}));
	}

	private createPauseSignal(reason: LuaDebuggerPauseReason, range: LuaSourceRange, exception: LuaRuntimeError | LuaSyntaxError = null): PauseSignal {
		const location = { chunk: range.chunkName, line: range.start.line, column: range.start.column };
		const message = exception ? exception.message : `${reason} at ${location.chunk}:${location.line}:${location.column}`;
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
		this.yieldLocation.chunk = range.chunkName;
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

	private finalizeChunkExecution(chunkScope: LuaEnvironment, savedState: NestedInterpreterState | null, nested: boolean): void {
		if (nested) {
			this.frameStack.length = 0;
			this.envStack.length = 0;
			for (const frame of savedState.frameStack) {
				this.frameStack.push(frame);
			}
			for (const env of savedState.envStack) {
				this.envStack.push(env);
			}
			this._chunkEnvironment = savedState.chunkEnvironment;
			this.currentChunk = savedState.currentChunk;
			this.valueNameCache = savedState.valueNameCache;
			this._lastFaultCallStack = savedState.lastFaultCallStack;
			this.lastFaultDepth = savedState.lastFaultDepth;
			this._lastFaultEnvironment = savedState.lastFaultEnvironment;
			this._currentCallRange = savedState.currentCallRange;
			this.programCounterValue = savedState.programCounter;
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
		this._chunkEnvironment = chunkScope;
	}

	private handleChunkContinuation(signal: ExecutionSignal, context: ChunkExecutionContext): ExecutionSignal {
		if (signal !== null && signal.kind === 'return') {
			this.finalizeChunkExecution(context.chunkScope, context.savedState, context.nested);
			return RETURN_SIGNAL;
		}
		if (signal !== null && signal.kind === 'break') {
			this.finalizeChunkExecution(context.chunkScope, context.savedState, context.nested);
			const breakStatement = signal.origin as LuaBreakStatement;
			throw this.runtimeErrorAt(breakStatement.range, 'Unexpected break outside of loop.');
		}
		if (signal !== null && signal.kind === 'goto') {
			this.finalizeChunkExecution(context.chunkScope, context.savedState, context.nested);
			throw this.runtimeErrorAt(signal.origin.range, `Label '${signal.label}' not found.`);
		}
		this.finalizeChunkExecution(context.chunkScope, context.savedState, context.nested);
		return NORMAL_SIGNAL;
	}

	private stepStatementsFrame(frame: StatementsFrame): ExecutionSignal {
		while (frame.index < frame.statements.length && frame.statements[frame.index].kind === LuaSyntaxKind.LabelStatement) {
			frame.index += 1;
		}
		if (frame.index >= frame.statements.length) {
			this.popFrame();
			return NORMAL_SIGNAL;
		}
		const statement = frame.statements[frame.index];
		this.activeStatementRange = statement.range ?? this.fallbackSourceRange();
		this.activeStatementFrame = frame;
		if (this.debuggerController) {
			const reason = this.debuggerController.shouldPause(this.activeStatementRange.chunkName, this.activeStatementRange.start.line, this.callStack.length);
			if (reason !== null) {
				const pause = this.createPauseSignal(reason, this.activeStatementRange);
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
					this.executeLocalAssignment(statement as LuaLocalAssignmentStatement, frame.environment, frame.varargs);
					frame.index += 1;
					return NORMAL_SIGNAL;
				case LuaSyntaxKind.LocalFunctionStatement:
					this.executeLocalFunction(statement as LuaLocalFunctionStatement, frame.environment);
					frame.index += 1;
					return NORMAL_SIGNAL;
				case LuaSyntaxKind.FunctionDeclarationStatement:
					this.executeFunctionDeclaration(statement as LuaFunctionDeclarationStatement, frame.environment);
					frame.index += 1;
					return NORMAL_SIGNAL;
				case LuaSyntaxKind.AssignmentStatement:
					this.executeAssignment(statement as LuaAssignmentStatement, frame.environment, frame.varargs);
					frame.index += 1;
					return NORMAL_SIGNAL;
				case LuaSyntaxKind.ReturnStatement:
					return this.executeReturn(statement as LuaReturnStatement, frame.environment, frame.varargs);
				case LuaSyntaxKind.BreakStatement:
					return { kind: 'break', origin: statement };
				case LuaSyntaxKind.IfStatement: {
					const ifStatement = statement as LuaIfStatement;
					for (const clause of ifStatement.clauses) {
						if (clause.condition === null || this.isTruthy(this.evaluateSingleExpression(clause.condition, frame.environment, frame.varargs))) {
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
					const startValue = this.expectNumber(this.evaluateSingleExpression(numeric.start, frame.environment, frame.varargs), 'Numeric for loop start must be a number.', numeric.start.range);
					const limitValue = this.expectNumber(this.evaluateSingleExpression(numeric.limit, frame.environment, frame.varargs), 'Numeric for loop limit must be a number.', numeric.limit.range);
					let stepValue = 1;
					if (numeric.step !== null) {
						stepValue = this.expectNumber(this.evaluateSingleExpression(numeric.step, frame.environment, frame.varargs), 'Numeric for loop step must be a number.', numeric.step.range);
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
					const iteratorValues = this.evaluateExpressionList(generic.iterators, frame.environment, frame.varargs);
					if (iteratorValues.length === 0) {
						throw this.runtimeErrorAt(generic.range, 'Generic for loop requires an iterator function.');
					}
					const iteratorFunction = this.expectFunction(iteratorValues[0], 'Generic for loop requires an iterator function.', generic.range);
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
				case LuaSyntaxKind.CallStatement:
					this.evaluateCallExpression((statement as LuaCallStatement).expression, frame.environment, frame.varargs);
					frame.index += 1;
					return NORMAL_SIGNAL;
				case LuaSyntaxKind.GotoStatement:
					return { kind: 'goto', label: (statement as LuaGotoStatement).label, origin: statement as LuaGotoStatement };
				default:
					throw this.runtimeError('Unsupported statement kind.');
			}
		}
		catch (error) {
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
		const condition = this.evaluateSingleExpression(frame.statement.condition, frame.loopEnvironment, frame.varargs);
		if (!this.isTruthy(condition)) {
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
			this.envStack[this.envStack.length - 1] = iterationEnvironment;
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
		const condition = this.evaluateSingleExpression(frame.statement.condition, frame.iterationEnvironment, frame.varargs);
		if (this.isTruthy(condition)) {
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
			const callArgs = this.allocateValueList();
			callArgs.push(frame.stateValue);
			callArgs.push(frame.control);
			const results = frame.iteratorFunction.call(callArgs);
			if (results.length === 0 || results[0] === null || results[0] === false) {
				this.popFrame();
				return NORMAL_SIGNAL;
			}
			frame.control = results[0];
			frame.pendingResults = results;
			this.assignGenericLoopVariables(frame.statement, frame.loopEnvironment, results);
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

	private tryConsumeBreak(): boolean {
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

	private tryConsumeGoto(signal: Extract<ExecutionSignal, { kind: 'goto' }>): boolean {
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

	private popUntilBoundary(): void {
		while (this.frameStack.length > 0) {
			const frame = this.popFrame();
			if (frame.kind === 'statements' && frame.boundary !== 'block') {
				return;
			}
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
		const functionValue = new LuaScriptFunction(statement.functionExpression, environment, statement.name.name, null, this);
		environment.set(statement.name.name, functionValue, statement.name.range);
	}

	private executeFunctionDeclaration(statement: LuaFunctionDeclarationStatement, environment: LuaEnvironment): void {
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
		let currentValue: LuaValue = this.lookupIdentifier(parts[0], environment);
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
		const values = this.allocateValueList();
		this.appendExpressionListInto(statement.expressions, environment, varargs, values);
		this.returnValueBuffer.length = 0;
		for (let index = 0; index < values.length; index += 1) {
			this.returnValueBuffer.push(values[index]);
		}
		return RETURN_SIGNAL;
	}

	private assignGenericLoopVariables(statement: LuaForGenericStatement, loopEnvironment: LuaEnvironment, results: ReadonlyArray<LuaValue>): void {
		for (let index = 0; index < statement.variables.length; index += 1) {
			const variable = statement.variables[index];
			const value = index < results.length ? results[index] : null;
			loopEnvironment.assignExisting(variable.name, value);
		}
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
				return this.lookupIdentifier(expression.name, environment);
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

	private evaluateSingleExpression(expression: LuaExpression, environment: LuaEnvironment, varargs: ReadonlyArray<LuaValue>): LuaValue {
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
					const lenArgs = this.allocateValueList();
					lenArgs.push(operand);
					const metamethodResult = this.invokeMetamethod(operand, '__len', lenArgs);
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
							const values = fn.call(args);
							const first = values.length > 0 ? values[0] : null;
							return this.expectNumber(first, '__len metamethod must return a number.', expression.range);
						}
					}
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
			return this.getNativeValueWithMetamethod(target.target, target.key, range);
		}
		if (target.kind === 'native-index') {
			return this.getNativeValueWithMetamethod(target.target, target.key, range);
		}
		throw this.runtimeError('Unsupported assignment target kind.');
	}

	private getTableValueWithMetamethod(table: LuaTable, key: LuaValue, range: LuaSourceRange, visited: Set<LuaTable> = new Set<LuaTable>()): LuaValue {
		if (visited.has(table)) {
			throw this.throwErrorWithRangeOrCurrentRange(range, 'Metatable __index loop detected.');
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
			const result = this.getTableValueWithMetamethod(handler, key, range, visited);
			visited.delete(table);
			return result;
		}
		const functionValue = this.expectFunction(handler, '__index metamethod must be a function or table.', range);
		const args = this.allocateValueList();
		args.push(table);
		args.push(key);
		const values = functionValue.call(args);
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
		const args = this.allocateValueList();
		args.push(table);
		args.push(key);
		args.push(value);
		functionValue.call(args);
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

	private invokeMetamethod(table: LuaTable, name: string, args: ReadonlyArray<LuaValue>): LuaValue[] {
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

	private lookupIdentifier(name: string, environment: LuaEnvironment): LuaValue {
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
		if (left instanceof LuaNativeValue && right instanceof LuaNativeValue) {
			return left.native === right.native;
		}
		const handler = this.extractSharedMetamethodFunction(left, right, '__eq', expression.range);
		if (handler !== null) {
			const args = this.allocateValueList();
			args.push(left);
			args.push(right);
			const result = handler.call(args);
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
		const result = handler.call(args);
		if (result.length === 0) {
			return null;
		}
		return result[0];
	}

	private invokeBinaryMetamethod(left: LuaValue, right: LuaValue, name: string, range: LuaSourceRange): LuaValue {
		const leftHandler = this.extractMetamethodFunction(left, name, range);
		if (leftHandler !== null) {
			const args = this.allocateValueList();
			args.push(left);
			args.push(right);
			const result = leftHandler.call(args);
			if (result.length === 0) {
				return null;
			}
			return result[0];
		}
		const rightHandler = this.extractMetamethodFunction(right, name, range);
		if (rightHandler !== null) {
			const args = this.allocateValueList();
			args.push(left);
			args.push(right);
			const result = rightHandler.call(args);
			if (result.length === 0) {
				return null;
			}
			return result[0];
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

	private isTruthy(value: LuaValue): boolean {
		if (value === null) {
			return false;
		}
		if (value === false) {
			return false;
		}
		return true;
	}

	private expectNumber(value: LuaValue, message: string, range: LuaSourceRange | null): number;
	private expectNumber<A>(value: LuaValue, messageFactory: (arg: A) => string, arg: A, range: LuaSourceRange | null): number;
	private expectNumber(value: LuaValue, messageOrFactory: string | ((arg: unknown) => string), argOrRange: unknown, range?: LuaSourceRange | null): number {
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

	public expectFunction(value: LuaValue, message: string, range: LuaSourceRange | null): LuaFunctionValue;
	public expectFunction<A>(value: LuaValue, messageFactory: (arg: A) => string, arg: A, range: LuaSourceRange | null): LuaFunctionValue;
	public expectFunction<A, B>(value: LuaValue, messageFactory: (argA: A, argB: B) => string, argA: A, argB: B, range: LuaSourceRange | null): LuaFunctionValue;
	public expectFunction(
		value: LuaValue,
		messageOrFactory: string | ((arg1: unknown, arg2?: unknown) => string),
		arg1OrRange: unknown,
		arg2OrRange?: unknown,
		rangeMaybe?: LuaSourceRange | null,
	): LuaFunctionValue {
		const range = rangeMaybe !== undefined
			? rangeMaybe
			: (arg2OrRange !== undefined ? (arg2OrRange as LuaSourceRange | null) : (arg1OrRange as LuaSourceRange | null));
		if (value instanceof LuaNativeValue) {
			return this.getOrCreateNativeCallable(value, range);
		}
		if (typeof value === 'function') {
			const wrapped = this.convertFromHost(value);
			if (wrapped instanceof LuaNativeValue) {
				return this.getOrCreateNativeCallable(wrapped, range);
			}
			if (wrapped && typeof wrapped === 'object' && 'call' in (wrapped as Record<string, unknown>)) {
				const candidate = wrapped as LuaFunctionValue;
				if (typeof candidate.call === 'function') {
					return candidate;
				}
			}
		}
		if (typeof value === 'object' && value !== null) {
			if ('call' in value) {
				const candidate = value as LuaFunctionValue;
				if (typeof candidate.call === 'function') {
					return candidate;
				}
			}
		}
		const ctorName = value && typeof value === 'object' ? (value as { constructor?: { name?: string } }).constructor?.name : undefined;
		if (typeof messageOrFactory === 'string') {
			const failureMessage = `${messageOrFactory} (value type=${typeof value}${ctorName ? ` ctor=${ctorName}` : ''})`;
			this.throwErrorWithRangeOrCurrentRange(arg1OrRange as LuaSourceRange | null, failureMessage);
		}
		if (rangeMaybe !== undefined) {
			const baseMessage = (messageOrFactory as (arg1: unknown, arg2: unknown) => string)(arg1OrRange, arg2OrRange);
			const failureMessage = `${baseMessage} (value type=${typeof value}${ctorName ? ` ctor=${ctorName}` : ''})`;
			this.throwErrorWithRangeOrCurrentRange(rangeMaybe, failureMessage);
		}
		const baseMessage = (messageOrFactory as (arg: unknown) => string)(arg1OrRange);
		const failureMessage = `${baseMessage} (value type=${typeof value}${ctorName ? ` ctor=${ctorName}` : ''})`;
		this.throwErrorWithRangeOrCurrentRange(arg2OrRange as LuaSourceRange | null, failureMessage);
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

	private fallbackSourceRange(): LuaSourceRange {
		return {
			chunkName: this.currentChunk,
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
					const maybeSelf = this.convertToHost(args[0]);
					if (maybeSelf === native) {
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

	private makeNativeMemberHandle(target: object | Function, path: ReadonlyArray<string>, options: { displayName: string; bindInstance: boolean; range: LuaSourceRange | null }): LuaNativeMemberHandle {
		const typeName = resolveNativeTypeName(target);
		const handleName = `${typeName}.${options.displayName}`;
		const callImpl = (args: ReadonlyArray<LuaValue>): LuaValue[] => {
			let member: unknown = target;
			for (let index = 0; index < path.length; index += 1) {
				member = Reflect.get(member as Record<string, unknown>, path[index]);
			}
			if (typeof member !== 'function') {
				const message = this.formatNativeError(typeName, options.displayName, new Error('Member is not callable.'));
				if (options.range !== null) {
					throw this.runtimeErrorAt(options.range, message);
				}
				throw this.runtimeError(message);
			}
			const jsArgs: unknown[] = [];
			let startIndex = 0;
			if (options.bindInstance && args.length > 0) {
				const maybeSelf = this.convertToHost(args[0]);
				if (maybeSelf === target) {
					startIndex = 1;
				}
			}
			for (let index = startIndex; index < args.length; index += 1) {
				jsArgs.push(this.convertToHost(args[index]));
			}
			try {
				const result = Reflect.apply(member as (...args: unknown[]) => unknown, options.bindInstance ? target : undefined, jsArgs);
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
		if (!this.caseInsensitiveNativeAccess) {
			return null;
		}
		const upper = propertyName.toUpperCase();
		let prototype: object = native;
		while (prototype && prototype !== Object.prototype) {
			const names = Object.getOwnPropertyNames(prototype);
			for (let index = 0; index < names.length; index += 1) {
				const candidate = names[index];
				if (candidate === propertyName) {
					return candidate;
				}
				if (candidate.toUpperCase() === upper) {
					return candidate;
				}
			}
			prototype = Object.getPrototypeOf(prototype);
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
		if (typeof property === 'function') { // Bind functions as native callables or member handles
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

	private getNativeValueWithMetamethod(target: LuaNativeValue, key: LuaValue, range: LuaSourceRange, visited: Set<LuaNativeValue> = new Set<LuaNativeValue>()): LuaValue {
		const getMissingPropertyMessage = (property: ReturnType<typeof this.getNativePropertyValue>, target: LuaNativeValue): string => {
			const keyName = property.displayName && property.displayName.length > 0
				? property.displayName
				: typeof key === 'string' || typeof key === 'number'
					? String(key)
					: '<unknown>';
			return `Attempted to index missing native member '${keyName}' on ${this.nativeTypeName(target)}. Did you forget to define it as a 'default' or 'override' member (e.g. via 'define_world_object')?`;
		}
		if (visited.has(target)) {
			const loopMessage = 'Metatable __index loop detected.';
			this.throwErrorWithRangeOrCurrentRange(range, loopMessage);
		}
		visited.add(target);
		const property = this.getNativePropertyValue(target, key, range);
		if (property.found) {
			visited.delete(target);
			return property.value;
		}
		const metatable = target.metatable;
		if (metatable === null) {
			visited.delete(target);
			this.throwErrorWithRangeOrCurrentRange(range, getMissingPropertyMessage(property, target));
		}
		const handler = metatable?.get('__index');
		if (!handler) {
			visited.delete(target);
			this.throwErrorWithRangeOrCurrentRange(range, getMissingPropertyMessage(property, target));
		}
		else if (isLuaTable(handler)) {
			const result = this.getTableValueWithMetamethod(handler, key, range);
			visited.delete(target);
			return result;
		}
		const functionValue = this.expectFunction(handler, '__index metamethod must be a function or table.', range);
		const args = this.allocateValueList();
		args.push(target);
		args.push(key);
		const values = functionValue.call(args);
		const first = values.length > 0 ? values[0] : null;
		visited.delete(target);
		return first;
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
		const iterator = new LuaNativeFunction('native_ipairs_iterator', (iteratorArgs) => {
			const nativeTarget = iteratorArgs.length > 0 ? iteratorArgs[0] : null;
			const previousIndex = iteratorArgs.length > 1 ? iteratorArgs[1] : null;
			if (!(nativeTarget instanceof LuaNativeValue) || nativeTarget !== target) {
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



	private invokeFunction(functionValue: LuaFunctionValue, args: ReadonlyArray<LuaValue>, range: LuaSourceRange): LuaValue[] {
		// Ensure native calls appear in the call stack with the call-site location.
		// Script functions already push a frame inside invokeScriptFunction().
		return this.withCurrentCallRange(range, () => {
			if (functionValue instanceof LuaNativeFunction) {
				this.callStack.push({
					functionName: functionValue.name && functionValue.name.length > 0 ? functionValue.name : null,
					source: range.chunkName,
					line: range.start.line,
					column: range.start.column,
				});

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
				functionValue.call(args);
				return NORMAL_SIGNAL;
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
							varargValues.length = 0;
							if (expression.hasVararg) {
								const extras: LuaValue[] = [];
								for (let index = argumentIndex; index < args.length; index += 1) {
									extras.push(args[index]);
								}
								varargValues = extras;
							}
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
								throw this.runtimeErrorAt(signal.origin.range, `Label '${signal.label}' not found in function '${name}'.`);
							default:
								return signal;
						}
					} catch (error) {
						if (!isLuaDebuggerPauseSignal(error)) {
							this.recordFaultCallStack();
						}
						throw error;
					}
				});
			}

		return new LuaExecutionThread(() => {
			functionValue.call(args);
			return NORMAL_SIGNAL;
		});
	}

	public invokeScriptFunction(expression: LuaFunctionExpression, closure: LuaEnvironment, name: string, args: ReadonlyArray<LuaValue>, implicitSelfName: string): LuaValue[] {
		const activationEnvironment = LuaEnvironment.createChild(closure);
		const callRange = this._currentCallRange ?? expression.range;
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
				const wrapped = this.wrapPauseSignal(signal, (resumed) => {
					if (!resumed) return resumed;
					switch (resumed.kind) {
						case 'return':
							return resumed;
						case 'break':
							throw this.runtimeErrorAt(expression.range, `Cannot break from function '${name}'.`);
						case 'goto':
							throw this.runtimeErrorAt(resumed.origin.range, `Label '${resumed.label}' not found in function '${name}'.`);
						default:
							return resumed;
					}
				});
				throw wrapped;
			}
			return this.resolveFunctionSignal(signal, expression, name);
		} catch (error) {
			if (!isLuaDebuggerPauseSignal(error)) {
				this.recordFaultCallStack();
			}
			if (isLuaDebuggerPauseSignal(error)) {
				suspended = true;
			}
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
				throw this.runtimeErrorAt(signal.origin.range, `Label '${signal.label}' not found in function '${name}'.`);
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
		if (this._reservedIdentifiers.has(this.canonicalize(name))) {
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
		this.packageTable.set(this.canonicalize('loaded'), this.packageLoaded);
		this.globals.set(this.canonicalize('package'), this.packageTable);
		this.globals.set(this.canonicalize('require'), new LuaNativeFunction(this.canonicalize('require'), (args) => this.invokeRequireBuiltin(args)));

		this.globals.set(this.canonicalize('print'), new LuaNativeFunction(this.canonicalize('print'), (args) => {
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
		this.globals.set(this.canonicalize('array'), new LuaNativeFunction(this.canonicalize('array'), (args) => {
			const nativeArray: unknown[] = [];
			if (args.length === 1 && isLuaTable(args[0])) {
				const source = args[0] as LuaTable;
				const entries = source.entriesArray();
				for (let index = 0; index < entries.length; index += 1) {
					const [key, value] = entries[index];
					if (typeof key === 'number' && Number.isInteger(key) && key >= 1) {
						nativeArray[key - 1] = value;
						continue;
					}
					nativeArray.push(value);
				}
				return [this.getOrCreateNativeValue(nativeArray, 'Array')];
			}
			for (let index = 0; index < args.length; index += 1) {
				nativeArray[index] = args[index];
			}
			return [this.getOrCreateNativeValue(nativeArray, 'Array')];
		}));

		this.globals.set(this.canonicalize('assert'), new LuaNativeFunction(this.canonicalize('assert'), (args) => {
			const condition = args.length > 0 ? args[0] : null;
			if (this.isTruthy(condition)) {
				return Array.from(args);
			}
			const messageValue = args.length > 1 ? args[1] : 'assertion failed!';
			const message = typeof messageValue === 'string' ? messageValue : this.toLuaString(messageValue);
			throw this.runtimeError(message);
		}));

		this.globals.set(this.canonicalize('error'), new LuaNativeFunction(this.canonicalize('error'), (args) => {
			const value = args.length > 0 ? args[0] : 'nil';
			const message = typeof value === 'string' ? value : this.toLuaString(value);
			throw this.runtimeError(message);
		}));

		this.globals.set(this.canonicalize('type'), new LuaNativeFunction(this.canonicalize('type'), (args) => {
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

		this.globals.set(this.canonicalize('tostring'), new LuaNativeFunction(this.canonicalize('tostring'), (args) => {
			const value = args.length > 0 ? args[0] : null;
			return [this.toLuaString(value)];
		}));

		this.globals.set(this.canonicalize('tonumber'), new LuaNativeFunction(this.canonicalize('tonumber'), (args) => {
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

		this.globals.set(this.canonicalize('setmetatable'), new LuaNativeFunction(this.canonicalize('setmetatable'), (args) => {
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

		this.globals.set(this.canonicalize('getmetatable'), new LuaNativeFunction(this.canonicalize('getmetatable'), (args) => {
			if (args.length === 0 || (!(isLuaTable(args[0])) && !(args[0] instanceof LuaNativeValue))) {
				throw this.runtimeError('getmetatable expects a table or native value as the first argument.');
			}
			const targetValue = args[0];
			let metatable: LuaTable = null;
			if (isLuaTable(targetValue)) {
				metatable = targetValue.metatable as LuaTable;
			} else {
				metatable = (targetValue as LuaNativeValue).metatable as LuaTable;
			}
			if (metatable === null) {
				return [null];
			}
			return [metatable];
		}));

		this.globals.set(this.canonicalize('rawequal'), new LuaNativeFunction(this.canonicalize('rawequal'), (args) => {
			if (args.length < 2) {
				return [false];
			}
			return [args[0] === args[1]];
		}));

		this.globals.set(this.canonicalize('rawget'), new LuaNativeFunction(this.canonicalize('rawget'), (args) => {
			if (args.length === 0 || !(isLuaTable(args[0]))) {
				throw this.runtimeError('rawget expects a table as the first argument.');
			}
			const table = args[0] as LuaTable;
			const key = args.length > 1 ? args[1] : null;
			return [table.get(key)];
		}));

		this.globals.set(this.canonicalize('rawset'), new LuaNativeFunction(this.canonicalize('rawset'), (args) => {
			if (args.length < 2 || !(isLuaTable(args[0]))) {
				throw this.runtimeError('rawset expects a table as the first argument.');
			}
			const table = args[0] as LuaTable;
			const key = args[1];
			const value = args.length >= 3 ? args[2] : null;
			table.set(key, value);
			return [table];
		}));

		this.globals.set(this.canonicalize('pcall'), new LuaNativeFunction(this.canonicalize('pcall'), (args) => {
			const fn = this.expectFunction(args.length > 0 ? args[0] : null, 'pcall expects a function.', null);
			const functionArgs = this.allocateValueList();
			for (let index = 1; index < args.length; index += 1) {
				functionArgs.push(args[index]);
			}
			try {
				const result = fn.call(functionArgs);
				const values = this.allocateValueList();
				values.push(true);
				for (let index = 0; index < result.length; index += 1) {
					values.push(result[index]);
				}
				return values;
			}
			catch (error) {
				if (isLuaDebuggerPauseSignal(error)) {
					throw error;
				}
				const message = extractErrorMessage(error);
				const values = this.allocateValueList();
				values.push(false);
				values.push(message);
				return values;
			}
		}));

		this.globals.set(this.canonicalize('xpcall'), new LuaNativeFunction(this.canonicalize('xpcall'), (args) => {
			const fn = this.expectFunction(args.length > 0 ? args[0] : null, 'xpcall expects a function.', null);
			const messageHandler = this.expectFunction(args.length > 1 ? args[1] : null, 'xpcall expects a message handler.', null);
			const functionArgs = this.allocateValueList();
			for (let index = 2; index < args.length; index += 1) {
				functionArgs.push(args[index]);
			}
			try {
				const result = fn.call(functionArgs);
				const values = this.allocateValueList();
				values.push(true);
				for (let index = 0; index < result.length; index += 1) {
					values.push(result[index]);
				}
				return values;
			}
			catch (error) {
				if (isLuaDebuggerPauseSignal(error)) {
					throw error;
				}
				const formatted = extractErrorMessage(error);
				const handlerArgs = this.allocateValueList();
				handlerArgs.push(formatted);
				const handlerResult = messageHandler.call(handlerArgs);
				const first = handlerResult.length > 0 ? handlerResult[0] : null;
				const values = this.allocateValueList();
				values.push(false);
				values.push(first);
				return values;
			}
		}));

		this.globals.set(this.canonicalize('select'), new LuaNativeFunction(this.canonicalize('select'), (args) => {
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

		this.globals.set(this.canonicalize('next'), new LuaNativeFunction(this.canonicalize('next'), (args) => {
			if (args.length === 0 || !(isLuaTable(args[0]))) {
				throw this.runtimeError('next expects a table as the first argument.');
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
		mathTable.set(this.canonicalize('abs'), new LuaNativeFunction(this.canonicalize('abs'), (args) => {
			const value = args.length > 0 ? args[0] : null;
			const number = this.expectNumber(value, 'math.abs expects a number.', null);
			return [Math.abs(number)];
		}));
		mathTable.set(this.canonicalize('ceil'), new LuaNativeFunction(this.canonicalize('ceil'), (args) => {
			const value = args.length > 0 ? args[0] : null;
			const number = this.expectNumber(value, 'math.ceil expects a number.', null);
			return [Math.ceil(number)];
		}));
		mathTable.set(this.canonicalize('floor'), new LuaNativeFunction(this.canonicalize('floor'), (args) => {
			const value = args.length > 0 ? args[0] : null;
			const number = this.expectNumber(value, 'math.floor expects a number.', null);
			return [Math.floor(number)];
		}));
		mathTable.set(this.canonicalize('max'), new LuaNativeFunction(this.canonicalize('max'), (args) => {
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
		mathTable.set(this.canonicalize('min'), new LuaNativeFunction(this.canonicalize('min'), (args) => {
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
		mathTable.set(this.canonicalize('sqrt'), new LuaNativeFunction(this.canonicalize('sqrt'), (args) => {
			const value = args.length > 0 ? args[0] : null;
			const number = this.expectNumber(value, 'math.sqrt expects a number.', null);
			if (number < 0) {
				throw this.runtimeError('math.sqrt cannot operate on negative numbers.');
			}
			return [Math.sqrt(number)];
		}));
		mathTable.set(this.canonicalize('random'), new LuaNativeFunction(this.canonicalize('random'), (args) => {
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
		mathTable.set(this.canonicalize('randomseed'), new LuaNativeFunction(this.canonicalize('randomseed'), (args) => {
			const seedValue = args.length > 0 ? this.expectNumber(args[0], 'math.randomseed expects a number.', null) : $.platform.clock.now();
			this.randomSeedValue = Math.floor(seedValue) >>> 0;
			return EMPTY_VALUES;
		}));
		mathTable.set(this.canonicalize('pi'), Math.PI);
		this.globals.set(this.canonicalize('math'), mathTable);

		const stringTable = createLuaTable();
		stringTable.set(this.canonicalize('len'), new LuaNativeFunction(this.canonicalize('len'), (args) => {
			const value = args.length > 0 ? args[0] : '';
			const str = this.expectString(value, 'string.len expects a string.', null);
			return [str.length];
		}));
		stringTable.set(this.canonicalize('upper'), new LuaNativeFunction(this.canonicalize('upper'), (args) => {
			const value = args.length > 0 ? args[0] : '';
			const str = this.expectString(value, 'string.upper expects a string.', null);
			return [str.toUpperCase()];
		}));
		stringTable.set(this.canonicalize('lower'), new LuaNativeFunction(this.canonicalize('lower'), (args) => {
			const value = args.length > 0 ? args[0] : '';
			const str = this.expectString(value, 'string.lower expects a string.', null);
			return [str.toLowerCase()];
		}));
		stringTable.set(this.canonicalize('sub'), new LuaNativeFunction(this.canonicalize('sub'), (args) => {
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
		stringTable.set(this.canonicalize('find'), new LuaNativeFunction(this.canonicalize('find'), (args) => {
			const source = args.length > 0 ? args[0] : '';
			const pattern = args.length > 1 ? args[1] : '';
			const str = this.expectString(source, 'string.find expects a string.', null);
			const pat = this.expectString(pattern, 'string.find expects a pattern string.', null);
			const startIndex = args.length > 2 ? Math.max(1, Math.floor(this.expectNumber(args[2], 'string.find expects numeric start index.', null))) - 1 : 0;
			const position = str.indexOf(pat, startIndex);
			if (position === -1) {
				return [null];
			}
			const first = position + 1;
			const last = first + pat.length - 1;
			return [first, last];
		}));
		stringTable.set(this.canonicalize('byte'), new LuaNativeFunction(this.canonicalize('byte'), (args) => {
			const source = args.length > 0 ? args[0] : '';
			const str = this.expectString(source, 'string.byte expects a string.', null);
			const positionArg = args.length > 1 ? this.expectNumber(args[1], 'string.byte expects a numeric position.', null) : 1;
			const position = Math.floor(positionArg) - 1;
			if (position < 0 || position >= str.length) {
				return [null];
			}
			return [str.charCodeAt(position)];
		}));
		stringTable.set(this.canonicalize('char'), new LuaNativeFunction(this.canonicalize('char'), (args) => {
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
		stringTable.set(this.canonicalize('format'), new LuaNativeFunction(this.canonicalize('format'), (args) => {
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

				switch (specifier) {
					case 's': {
						const value = takeArgument();
						let text = value === null ? 'nil' : this.toLuaString(value);
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
						const unsigned = specifier === 'u' || specifier === 'o' || specifier === 'x' || specifier === 'X';
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
						const allowZeroPad = flags.zeroPad && !flags.leftAlign && precision === null;
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
						const allowZeroPad = flags.zeroPad && !flags.leftAlign;
						output += applyPadding(formatted, sign, '', allowZeroPad);
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
						const allowZeroPad = flags.zeroPad && !flags.leftAlign;
						output += applyPadding(text, sign, '', allowZeroPad);
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
						const allowZeroPad = flags.zeroPad && !flags.leftAlign;
						output += applyPadding(text, sign, '', allowZeroPad);
						break;
					}
					case 'q': {
						const value = takeArgument();
						const raw = value === null ? 'nil' : this.toLuaString(value);
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
		this.globals.set(this.canonicalize('string'), stringTable);

		const tableLibrary = createLuaTable();
		tableLibrary.set(this.canonicalize('insert'), new LuaNativeFunction(this.canonicalize('insert'), (args) => {
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

		tableLibrary.set(this.canonicalize('remove'), new LuaNativeFunction(this.canonicalize('remove'), (args) => {
			if (args.length === 0 || !(isLuaTable(args[0]))) {
				throw this.runtimeError('table.remove expects a table as the first argument.');
			}
			const target = args[0] as LuaTable;
			const position = args.length > 1 ? Math.floor(this.expectNumber(args[1], 'table.remove position must be a number.', null)) : null;
			const removed = this.tableRemove(target, position);
			return removed === null ? EMPTY_VALUES : [removed];
		}));

		tableLibrary.set(this.canonicalize('concat'), new LuaNativeFunction(this.canonicalize('concat'), (args) => {
			if (args.length === 0 || !(isLuaTable(args[0]))) {
				throw this.runtimeError('table.concat expects a table as the first argument.');
			}
			const target = args[0] as LuaTable;
			const separator = args.length > 1 && typeof args[1] === 'string' ? args[1] : '';
			const startIndexRaw = args.length > 2 ? this.expectNumber(args[2], 'table.concat expects numeric start index.', null) : 1;
			const endIndexRaw = args.length > 3 ? this.expectNumber(args[3], 'table.concat expects numeric end index.', null) : target.numericLength();
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
				parts.push(value === null ? '' : this.toLuaString(value));
			}
			return [parts.join(separator)];
		}));

		tableLibrary.set(this.canonicalize('pack'), new LuaNativeFunction(this.canonicalize('pack'), (args) => {
			const table = createLuaTable();
			for (let index = 0; index < args.length; index += 1) {
				table.set(index + 1, args[index]);
			}
			table.set('n', args.length);
			return [table];
		}));

		tableLibrary.set(this.canonicalize('unpack'), new LuaNativeFunction(this.canonicalize('unpack'), (args) => {
			if (args.length === 0 || !(isLuaTable(args[0]))) {
				throw this.runtimeError('table.unpack expects a table as the first argument.');
			}
			const target = args[0] as LuaTable;
			const length = target.numericLength();
			const startIndexRaw = args.length > 1 ? this.expectNumber(args[1], 'table.unpack expects numeric start index.', null) : 1;
			const endIndexRaw = args.length > 2 ? this.expectNumber(args[2], 'table.unpack expects numeric end index.', null) : length;
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
		tableLibrary.set(this.canonicalize('fromnative'), new LuaNativeFunction(this.canonicalize('table.fromnative'), (args) => {
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

		tableLibrary.set(this.canonicalize('sort'), new LuaNativeFunction(this.canonicalize('sort'), (args) => {
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
					const first = response.length > 0 ? response[0] : null;
					return first === true ? -1 : 1;
				}
				return this.defaultSortCompare(left, right);
			});
			for (let index = 1; index <= length; index += 1) {
				target.set(index, values[index - 1]);
			}
			return [target];
		}));

		this.globals.set(this.canonicalize('table'), tableLibrary);

		const osTable = createLuaTable();
		osTable.set(this.canonicalize('time'), new LuaNativeFunction(this.canonicalize('os.time'), (args) => {
			if (args.length === 0) {
				return [Math.floor($.platform.clock.now() / 1000)];
			}
			const tableArg = args[0];
			if (!(isLuaTable(tableArg))) {
				throw this.runtimeError('os.time expects a table or no arguments.');
			}
			const year = tableArg.get(this.canonicalize('year'));
			const month = tableArg.get(this.canonicalize('month'));
			const day = tableArg.get(this.canonicalize('day'));
			const hour = tableArg.get(this.canonicalize('hour'));
			const min = tableArg.get(this.canonicalize('min'));
			const sec = tableArg.get(this.canonicalize('sec'));
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
		osTable.set(this.canonicalize('date'), new LuaNativeFunction(this.canonicalize('os.date'), (args) => {
			const formatValue = args.length > 0 ? args[0] : null;
			const timestampValue = args.length > 1 ? args[1] : null;
			const timestamp = timestampValue === null ? Math.floor($.platform.clock.now() / 1000) : Math.floor(this.expectNumber(timestampValue, 'os.date expects numeric timestamp.', null));
			const date = new Date(timestamp * 1000);
			if (formatValue === null) {
				return [date.toISOString()];
			}
			const format = this.expectString(formatValue, 'os.date expects a format string.', null);
			if (format === '*t') {
				const table = createLuaTable();
				table.set(this.canonicalize('year'), date.getUTCFullYear());
				table.set(this.canonicalize('month'), date.getUTCMonth() + 1);
				table.set(this.canonicalize('day'), date.getUTCDate());
				table.set(this.canonicalize('hour'), date.getUTCHours());
				table.set(this.canonicalize('min'), date.getUTCMinutes());
				table.set(this.canonicalize('sec'), date.getUTCSeconds());
				table.set(this.canonicalize('isdst'), false);
				return [table];
			}
			return [date.toISOString()];
		}));
		osTable.set(this.canonicalize('difftime'), new LuaNativeFunction(this.canonicalize('os.difftime'), (args) => {
			const t2 = args.length > 0 ? this.expectNumber(args[0], 'os.difftime expects numeric arguments.', null) : 0;
			const t1 = args.length > 1 ? this.expectNumber(args[1], 'os.difftime expects numeric arguments.', null) : 0;
			return [t2 - t1];
		}));
		this.globals.set(this.canonicalize('os'), osTable);

		this.globals.set(this.canonicalize('pairs'), new LuaNativeFunction(this.canonicalize('pairs'), (args) => {
			if (args.length === 0) {
				throw this.runtimeError('pairs expects a table or native value argument.');
			}
			const target = args[0];
			const pairsMetamethod = this.extractMetamethodFunction(target, '__pairs', null);
			if (pairsMetamethod !== null) {
				const metaArgs = this.allocateValueList();
				metaArgs.push(target);
				const result = pairsMetamethod.call(metaArgs);
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
			if (target instanceof LuaNativeValue) {
				return this.createNativePairsIterator(target);
			}
			throw this.runtimeError('pairs expects a table or native value argument.');
		}));

		this.globals.set(this.canonicalize('ipairs'), new LuaNativeFunction(this.canonicalize('ipairs'), (args) => {
			if (args.length === 0) {
				throw this.runtimeError('ipairs expects a table or native value argument.');
			}
			const target = args[0];
			const ipairsMetamethod = this.extractMetamethodFunction(target, this.canonicalize('__ipairs'), null);
			if (ipairsMetamethod !== null) {
				const metaArgs = this.allocateValueList();
				metaArgs.push(target);
				const result = ipairsMetamethod.call(metaArgs);
				if (result.length < 2) {
					throw this.runtimeError('__ipairs metamethod must return at least two values.');
				}
				return Array.from(result);
			}
			if (isLuaTable(target)) {
				const table = target;
				const iterator = new LuaNativeFunction(this.canonicalize('ipairs_iterator'), (iteratorArgs) => {
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
			if (target instanceof LuaNativeValue) {
				return this.createNativeIpairsIterator(target);
			}
			throw this.runtimeError('ipairs expects a table or native value argument.');
		}));

		this.globals.set(this.canonicalize('serialize'), new LuaNativeFunction(this.canonicalize('serialize'), (args) => {
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

		this.globals.set(this.canonicalize('deserialize'), new LuaNativeFunction(this.canonicalize('deserialize'), (args) => {
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

	private tableInsert(table: LuaTable, value: LuaValue, position: number): void {
		const length = table.numericLength();
		let targetIndex = position === null ? length + 1 : Math.max(1, Math.min(length + 1, position));
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

	private runtimeError(message: string): LuaRuntimeError {
		this.markFaultEnvironment();
		const range = this._currentCallRange;
		if (range !== null) return new LuaRuntimeError(message, range.chunkName, range.start.line, range.start.column);
		return new LuaRuntimeError(message, this.currentChunk, 0, 0);
	}

	private runtimeErrorAt(range: LuaSourceRange, message: string): LuaRuntimeError {
		this.markFaultEnvironment();
		return new LuaRuntimeError(message, range.chunkName, range.start.line, range.start.column);
	}

	private throwErrorWithRangeOrCurrentRange(range: LuaSourceRange | null, message: string): never {
		if (range !== null) throw this.runtimeErrorAt(range, message);
		throw this.runtimeError(message);
	}

}
