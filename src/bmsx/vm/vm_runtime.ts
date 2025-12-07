import { $ } from '../core/game';
import { OverlayPipelineController } from 'bmsx/core/pipelines/bmsx_vm_pipeline';
import { Service } from '../core/service';
import { taskGate } from '../core/taskgate';
import { Input } from '../input/input';
import { KeyModifier } from '../input/playerinput';
import type { LuaDefinitionInfo } from '../lua/lua_ast';
import { LuaDebuggerController, type LuaDebuggerResumeCommand } from '../lua/luadebugger';
import { LuaEnvironment } from '../lua/luaenvironment';
import { LuaError, LuaRuntimeError } from '../lua/luaerrors';
import { LuaHandlerCache, } from '../lua/luahandler_cache';
import { LuaInterpreter, type ExecutionSignal, type LuaCallFrame, } from '../lua/luaruntime';
import type { LuaFunctionValue, LuaTable, LuaValue, StackTraceFrame } from '../lua/luavalue';
import {
	convertToError, createLuaInterpreter,
	extractErrorMessage,
	isLuaDebuggerPauseSignal,
	isLuaFunctionValue,
	isLuaTable,
	setLuaTableCaseInsensitiveKeys,
	type LuaDebuggerPauseSignal
} from '../lua/luavalue';
import type { InputEvt, StorageService } from '../platform/platform';
import { publishOverlayFrame } from '../render/editor/editor_overlay_queue';
import type { BmsxCartridge, LifeCycleHandlerName, Viewport, } from '../rompack/rompack';
import { CanonicalizationType } from '../rompack/rompack';
import { fallbackclamp } from '../utils/clamp';
import { BmsxVMApi } from './vm_api';
import { TerminalMode } from './terminal_mode';
import { VMRenderFacade } from './vm_render_facade';
import type { VMFontVariant } from './font';
import { createVMCartEditor, getSourceForChunk, type VMCartEditor, } from './ide/vm_cart_editor';
import { VM_TOGGLE_KEY, EDITOR_TOGGLE_GAMEPAD_BUTTONS, EDITOR_TOGGLE_KEY, GAME_PAUSE_KEY } from './ide/constants';
import {
	emitDebuggerLifecycleEvent,
	type DebuggerPauseDisplayPayload,
	type DebuggerResumeMode
} from './ide/ide_debugger';
import { clearNativeMemberCompletionCache, getChunkResourceHint } from './ide/intellisense';
import { type FaultSnapshot } from './ide/render/render_error_overlay';
import { type LuaSemanticModel } from './ide/semantic_model';
import { setEditorCaseInsensitivity } from './ide/text_renderer';
import type { RuntimeErrorDetails } from './ide/types';
import { isLuaScriptError, registerApiBuiltins, seedDefaultLuaBuiltins } from './lua_builtins';
import { LuaFunctionRedirectCache } from './lua_handler_registry';
import { LuaEntrySnapshot, LuaJsBridge } from './lua_js_bridge';
import { buildLuaModuleAliases, type LuaRequireModuleRecord } from './lua_module_loader';
import { buildLuaFrameRawLabel, buildStackLines, convertLuaCallFrames, parseJsStackFrames, prettyPrintRuntimeError } from './runtime_error_util';
import { BmsxVMStorage } from './storage';
import type { BmsxVMRuntimeOptions, BmsxVMState, VMLuaBuiltinDescriptor, VMLuaMemberCompletion, LuaMarshalContext } from './types';
import { RenderSubmission } from '../render/gameview';
import { getWorkspaceCachedSource } from './workspace_cache';

export const VM_BUTTON_ACTIONS: ReadonlyArray<string> = [
	'console_left',
	'console_right',
	'console_up',
	'console_down',
	'console_b',
	'console_a',
	'console_x',
	'console_y',
	'console_start',
	'console_select',
	'console_rt',
	'console_lt',
	'console_rb',
	'console_lb',
];

// Flip back to 'msx' to restore default font in vm/editor
export const EDITOR_FONT_VARIANT: VMFontVariant = 'tiny';

type VMFrameState = {
	deltaSeconds: number;
	deltaForUpdate: number;
	editorActive: boolean;
	consoleActive: boolean;
	haltGame: boolean;
	debugPaused: boolean;
	updateExecuted: boolean;
	luaFaulted: boolean;
	consoleEvaluated: boolean;
	editorEvaluated: boolean;
};

export var api: BmsxVMApi; // Initialized in BmsxVMRuntime constructor

export class BmsxVMRuntime extends Service {
	private static _instance: BmsxVMRuntime = null;
	private static readonly LUA_SNAPSHOT_EXCLUDED_GLOBALS = new Set<string>(['print', 'type', 'tostring', 'tonumber', 'setmetatable', 'getmetatable', 'require', 'pairs', 'ipairs', 'serialize', 'deserialize', 'math', 'string', 'os', 'table', 'coroutine', 'debug', 'package', 'api',
	]);
	/**
	 * Preserved render queue when a fault occurs
	 * This is used to restore the render queue to its previous state
	 * so that the console mode can be drawn on top of it.
	 */
	private preservedRenderQueue: RenderSubmission[] = [];

	public static createInstance(options: BmsxVMRuntimeOptions): BmsxVMRuntime {
		const existing = BmsxVMRuntime._instance;
		if (existing) {
			throw new Error('[BmsxVMRuntime] Instance already exists.');
		}
		return new BmsxVMRuntime(options);
	}

	public static get instance(): BmsxVMRuntime {
		return BmsxVMRuntime._instance!;
	}

	public static destroy(): void {
		// No defense against multiple calls; let it throw if misused.
		BmsxVMRuntime._instance.dispose();
		BmsxVMRuntime._instance = null;
	}

	public readonly storage: BmsxVMStorage;
	public readonly storageService: StorageService;
	public readonly luaJsBridge!: LuaJsBridge;
	public readonly apiFunctionNames = new Set<string>();
	public readonly luaBuiltinMetadata = new Map<string, VMLuaBuiltinDescriptor>();
	private _activeIdeFontVariant: VMFontVariant = EDITOR_FONT_VARIANT;
	public playerIndex: number;
	public editor!: VMCartEditor;
	private readonly overlayRenderBackend = new VMRenderFacade();
	public readonly terminal!: TerminalMode;
	private _overlayResolutionMode: 'offscreen' | 'viewport'; // Set in constructor
	public set overlayResolutionMode(value: 'offscreen' | 'viewport') {
		this._overlayResolutionMode = value;
		this.overlayRenderBackend.setRenderingViewportType(value);
		this.editor?.updateViewport(this.overlayRenderBackend.viewportSize);
	}

	public get overlayResolutionMode() {
		return this._overlayResolutionMode;
	}

	public get overlayViewportSize(): Viewport {
		return this.overlayRenderBackend.viewportSize;
	}

	private readonly consoleHotkeyLatch = new Map<string, number>();
	private shortcutDisposers: Array<() => void> = [];
	private globalInputUnsubscribe: (() => void) = null;
	private luaInterpreter!: LuaInterpreter;
	private luaInitFunction: LuaFunctionValue = null;
	private luaNewGameFunction: LuaFunctionValue = null;
	private luaUpdateFunction: LuaFunctionValue = null;
	private luaDrawFunction: LuaFunctionValue = null;
	private _luaChunkName: string = null;
	public get currentChunkName(): string {
		return this._luaChunkName;
	}
	private luaVmInitialized = false;
	public get isVmInitialized(): boolean {
		return this.luaVmInitialized;
	}
	private luaRuntimeFailed = false;
	public get hasRuntimeFailed(): boolean {
		return this.luaRuntimeFailed;
	}
	private readonly luaDebuggerController: LuaDebuggerController = new LuaDebuggerController();
	private luaDebuggerSuspension: LuaDebuggerPauseSignal = null;
	public get debuggerSuspendSignal(): LuaDebuggerPauseSignal {
		return this.luaDebuggerSuspension;
	}
	private readonly debuggerEnabled = true;
	private debuggerHaltsGame = false;
	private debuggerAutoActivateOnNextPause = false;
	private overlayState = { console: false, editor: false };
	private includeJsStackTraces = false;
	private currentFrameState: VMFrameState = null;
	private pendingLuaWarnings: string[] = [];
	public readonly luaModuleAliases: Map<string, LuaRequireModuleRecord> = new Map();
	private readonly luaModuleLoadingKeys: Set<string> = new Set();
	private luaModuleIndexBuilt = false;
	public readonly luaChunkEnvironmentsByPath: Map<string, LuaEnvironment> = new Map();
	public readonly luaChunkEnvironmentsByChunkName: Map<string, LuaEnvironment> = new Map();
	public readonly chunkFunctionDefinitionKeys: Map<string, Set<string>> = new Map();
	private readonly luaGenericChunksExecuted: Set<string> = new Set();
	public readonly luaFunctionRedirectCache = new LuaFunctionRedirectCache();
	// Wrap Lua closures with stable JS stubs so FSM/input/events can hold onto durable references even across hot-reload.
	private readonly luaHandlerCache = new LuaHandlerCache(
		(fn, thisArg, args) => this.invokeLuaHandler(fn, thisArg, args),
		(error, meta) => this.handleLuaHandlerError(error, meta),
	);
	public nativeMemberCompletionCache: WeakMap<object, { dot?: VMLuaMemberCompletion[]; colon?: VMLuaMemberCompletion[] }> = new WeakMap();
	public readonly chunkSemanticCache: Map<string, { source: string; model: LuaSemanticModel; definitions: ReadonlyArray<LuaDefinitionInfo> }> = new Map();

	private readonly luaVmGate = taskGate.group('console:lua_vm');
	private handledLuaErrors = new WeakSet<any>();
	public faultSnapshot: FaultSnapshot = null;
	private faultOverlayNeedsFlush = false;
	public get doesFaultOverlayNeedFlush(): boolean {
		return this.faultOverlayNeedsFlush;
	}
	public flushedFaultOverlay(): void {
		this.faultOverlayNeedsFlush = false;
	}
	private hasCompletedInitialBoot = false;
	private readonly _canonicalization: CanonicalizationType;
	public get canonicalization(): CanonicalizationType {
		return this._canonicalization;
	}
	public get interpreter(): LuaInterpreter {
		return this.luaInterpreter;
	}

	public get cart(): BmsxCartridge {
		return $.rompack.cart;
	}

	private constructor(options: BmsxVMRuntimeOptions) {
		super({ id: 'bmsx_console_runtime' });
		BmsxVMRuntime._instance = this;
		this.playerIndex = options.playerIndex;
		this.storageService = $.platform.storage;
		this.storage = new BmsxVMStorage(this.storageService, $.cart.namespace);
		const resolvedCanonicalization = options.canonicalization ?? 'none';
		this._canonicalization = resolvedCanonicalization;
		setLuaTableCaseInsensitiveKeys(this._canonicalization !== 'none');
		setEditorCaseInsensitivity(this._canonicalization !== 'none');
		this.luaJsBridge = new LuaJsBridge(this, this.luaHandlerCache);
		this.terminal = new TerminalMode(this);
		this.enableEvents();

		api = new BmsxVMApi({
			playerindex: this.playerIndex,
			storage: this.storage,
		});
		api.set_render_backend(this.overlayRenderBackend);
		this.overlayResolutionMode = 'viewport';
		seedDefaultLuaBuiltins();
		// Check the primary asset ID for the currently loaded program
		// Note that this can be null if the program was not loaded from source or has not been saved yet (then the type is BmsxVMLuaInlineProgram)!
		this.editor = createVMCartEditor(options.viewport);
		this.flushLuaWarnings();
		this.registerVMShortcuts();

		this.subscribeGlobalDebuggerHotkeys();
	}

	private extractErrorLocation(error: unknown): { line: number; column: number; chunkName: string } {
		if (error instanceof LuaError) {
			const rawChunk = typeof error.chunkName === 'string' && error.chunkName.length > 0 ? error.chunkName : null;
			const chunkName = rawChunk && rawChunk.startsWith('@') ? rawChunk.slice(1) : rawChunk;
			return {
				line: Number.isFinite(error.line) && error.line > 0 ? Math.floor(error.line) : null,
				column: Number.isFinite(error.column) && error.column > 0 ? Math.floor(error.column) : null,
				chunkName: chunkName,
			};
		}
		return { line: null, column: null, chunkName: null };
	}

	private configureInterpreter(interpreter: LuaInterpreter): void {
		interpreter.setHostAdapter({
			toLua: (value) => this.luaJsBridge.jsToLua(value),
			toJs: (luaValue) => {
				const moduleId = $.rompack.cart.chunk2lua[this._luaChunkName].source_path;
				return this.luaJsBridge.luaValueToJs(luaValue, { moduleId, path: [] });
			},
			serializeNative: (native) => native,
			deserializeNative: (token) => token as object | Function,
		});
		interpreter.setRequireHandler((ctx, module) => this.requireLuaModule(ctx, module));
		if (this.debuggerEnabled) {
			interpreter.attachDebugger(this.luaDebuggerController);
		}
	}

	private onLuaDebuggerPause(signal: LuaDebuggerPauseSignal): void {
		if (!this.debuggerEnabled) {
			return;
		}
		if (this.luaDebuggerSuspension === signal) {
			return;
		}
		const autoActivateOnPause = this.debuggerAutoActivateOnNextPause;
		this.debuggerAutoActivateOnNextPause = false;
		const controller = this.luaDebuggerController;
		const sessionMetrics = controller.handlePause(signal);
		this.luaDebuggerSuspension = signal;
		this.debuggerHaltsGame = true;
		this.setDebuggerPaused(true);
		const editorActive = this.editor?.isActive === true;
		const shouldActivateEditor = signal.reason === 'exception'
			? editorActive || autoActivateOnPause
			: signal.reason === 'breakpoint' || autoActivateOnPause;
		if (shouldActivateEditor) {
			try {
				this.activateEditor();
			}
			catch (activationError) {
				console.warn('[BmsxVMRuntime] Failed to activate IDE during debugger pause.', activationError);
			}
		}
		if (signal.reason === 'exception') {
			const snapshot = this.recordDebuggerExceptionFault(signal);
			const prettyMessage = prettyPrintRuntimeError(
				snapshot ? snapshot.chunkName : signal.location.chunk,
				snapshot ? snapshot.line : signal.location.line,
				snapshot ? snapshot.column : signal.location.column,
				snapshot ? snapshot.message : 'Runtime error',
			);
			this.presentRuntimeErrorInVM(prettyMessage, snapshot ? snapshot.details : null);
			if (editorActive || shouldActivateEditor) {
				this.editor.renderFaultOverlay();
			} else if (snapshot) {
				this.activateTerminalMode();
				this.updateOverlayState(true, false, true);
			}
		} else if (this.luaRuntimeFailed && (editorActive || shouldActivateEditor)) {
			this.editor.renderFaultOverlay();
		}
		const state = this.currentFrameState;
		if (state) {
			state.haltGame = true;
			state.deltaForUpdate = 0;
		}
		const hint = getChunkResourceHint(signal.location.chunk);
		const payload: DebuggerPauseDisplayPayload = {
			chunk: signal.location.chunk,
			line: signal.location.line,
			column: signal.location.column,
			reason: signal.reason,
			hint,
		};
		emitDebuggerLifecycleEvent({
			type: 'paused',
			suspension: signal,
			payload,
			callStack: signal.callStack,
			metrics: sessionMetrics,
		});
	}
	private pauseDebuggerForException(
		details: { chunkName: string; line: number; column: number },
		callStackOverride?: ReadonlyArray<LuaCallFrame>,
	): void {
		if (!this.debuggerEnabled) {
			return;
		}
		const controller = this.luaDebuggerController;
		const interpreter = this.luaInterpreter;
		const callStack =
			callStackOverride !== undefined
				? Array.from(callStackOverride)
				: interpreter
					? Array.from(interpreter.lastFaultCallStack)
					: [];
		const chunk =
			(details.chunkName && details.chunkName.length > 0
				? details.chunkName
				: this._luaChunkName) ?? '<chunk>';
		const line = details.line ?? 0;
		const column = details.column ?? 0;
		const normalSignal: ExecutionSignal = { kind: 'normal' };
		const suspension: LuaDebuggerPauseSignal = {
			kind: 'pause',
			reason: 'exception',
			location: { chunk, line, column },
			callStack,
			resume: () => normalSignal,
		};
		this.onLuaDebuggerPause(suspension as LuaDebuggerPauseSignal);
		controller.clearStepping();
	}

	private setDebuggerPaused(paused: boolean): void {
		const state = this.currentFrameState;
		if (state) {
			state.debugPaused = paused;
		}
	}

	private clearActiveDebuggerPause(): void {
		const hadSuspension = this.luaDebuggerSuspension !== null;
		this.luaDebuggerSuspension = null;
		this.debuggerHaltsGame = false;
		this.setDebuggerPaused(false);
		if (hadSuspension) {
			emitDebuggerLifecycleEvent({ type: 'continued', mode: 'continue' });
		}
	}

	private resumeLuaDebugger(command: LuaDebuggerResumeCommand, options?: { stepDepthOverride?: number }): void {
		if (!this.debuggerEnabled) {
			return;
		}
		const suspension = this.luaDebuggerSuspension;
		const controller = this.luaDebuggerController;
		const interpreter = this.luaInterpreter;
		controller.suppressNextAtBoundary(suspension.location.chunk, suspension.location.line, suspension.callStack.length);
		const strategy = controller.prepareResume(command, suspension, options);
		interpreter.setExceptionResumeStrategy(strategy);

		const shouldClearRuntimeErrorOverlay =
			!!suspension &&
			suspension.reason === 'exception' &&
			(command === 'continue' || command === 'ignore_exception' || command === 'step_out_exception');
		this.luaRuntimeFailed = false;
		if (shouldClearRuntimeErrorOverlay) {
			this.clearFaultSnapshot();
			this.editor?.clearRuntimeErrorOverlay();
		}
		const resumeMode = this.toDebuggerResumeMode(command);
		emitDebuggerLifecycleEvent({ type: 'continued', mode: resumeMode });
		this.luaDebuggerSuspension = null;
		this.debuggerHaltsGame = false;
		this.setDebuggerPaused(false);
		const state = this.currentFrameState;
		if (state) {
			this.updateFrameHaltingState(state);
		}
		try {
			const result = suspension.resume();
			if (result.kind === 'pause') {
				this.onLuaDebuggerPause(result);
				return;
			}
			controller.handleSilentResumeResult(command, suspension);
		}
		catch (error) {
			if (isLuaDebuggerPauseSignal(error)) {
				this.onLuaDebuggerPause(error);
				return;
			}
			this.handleLuaError(error);
		}
	}

	private toDebuggerResumeMode(command: LuaDebuggerResumeCommand): DebuggerResumeMode {
		if (command === 'step_into') {
			return 'step_into';
		}
		if (command === 'step_over') {
			return 'step_over';
		}
		if (command === 'step_out' || command === 'step_out_exception') {
			return 'step_out';
		}
		return 'continue';
	}

	public resumeDebugger(command: LuaDebuggerResumeCommand): void {
		if (!this.debuggerEnabled) {
			return;
		}
		const suspension = this.luaDebuggerSuspension;
		let options: { stepDepthOverride?: number };
		if (command === 'step_out' || command === 'step_out_exception') {
			const targetDepth = Math.max(0, suspension.callStack.length - 1);
			options = { stepDepthOverride: targetDepth };
		}
		this.resumeLuaDebugger(command, options);
	}

	public setLuaBreakpoints(breakpoints: ReadonlyMap<string, ReadonlySet<number>>): void {
		if (!this.debuggerEnabled) {
			return;
		}
		const controller = this.luaDebuggerController;
		controller.setBreakpoints(breakpoints);
	}

	private pollVMHotkeys(): void {
		if (this.shouldAcceptVMHotkey('console-font-variant', 'KeyT', KeyModifier.ctrl | KeyModifier.shift)) {
			$.consume_button(this.playerIndex, 'KeyT', 'keyboard');
			const next = this._activeIdeFontVariant === 'tiny' ? 'msx' : 'tiny';
			this.activeIdeFontVariant = next; // Toggle font variant and apply to both console and editor
			return;
		}
		if (this.terminal.isActive) {
			if (this.shouldAcceptVMHotkey('console-resolution', 'KeyM', KeyModifier.ctrl | KeyModifier.alt)) {
				$.consume_button(this.playerIndex, 'KeyModifier', 'keyboard');
				this.toggleOverlayResolutionMode();
			}
		}
		this.handleGlobalDebuggerHotkeys();
	}

	public get activeIdeFontVariant(): VMFontVariant {
		return this._activeIdeFontVariant;
	}

	public set activeIdeFontVariant(variant: VMFontVariant) {
		this._activeIdeFontVariant = variant;
		this.terminal.setFontVariant(variant);
		this.editor?.setFontVariant(variant);
	}

	private subscribeGlobalDebuggerHotkeys(): void {
		this.unsubscribeGlobalDebuggerHotkeys();
		const hub = $.platform.input;
		this.globalInputUnsubscribe = hub.subscribe((event) => this.onGlobalInputEvent(event));
	}

	private unsubscribeGlobalDebuggerHotkeys(): void {
		if (!this.globalInputUnsubscribe) {
			return;
		}
		const unsubscribe = this.globalInputUnsubscribe;
		this.globalInputUnsubscribe = null;
		unsubscribe();
	}

	private onGlobalInputEvent(event: InputEvt): void {
		if (event.type !== 'button' || event.code !== 'F8' || event.down !== true) {
			return;
		}
		const playerInput = $.input.getPlayerInput(this.playerIndex);

		const modifiers = playerInput.getModifiersState();
		if (modifiers.ctrl) {
			return;
		}
		const pressId = typeof event.pressId === 'number' ? event.pressId : null;
		const existing = this.consoleHotkeyLatch.get('debugger-f8-step');
		if (pressId !== null) {
			if (existing === pressId) {
				return;
			}
			this.consoleHotkeyLatch.set('debugger-f8-step', pressId);
		} else if (existing === null) {
			return;
		} else {
			this.consoleHotkeyLatch.set('debugger-f8-step', null);
		}
		if (this.editor?.isActive !== true) {
			this.debuggerAutoActivateOnNextPause = true;
		}
		this.beginGlobalDebuggerStepping();
	}

	private handleGlobalDebuggerHotkeys(): boolean {
		if (!this.debuggerEnabled) {
			return false;
		}
		if (this.shouldAcceptVMHotkey('debugger-f8-step', 'F8', KeyModifier.ctrl)) {
			$.consume_button(this.playerIndex, 'F8', 'keyboard');
			console.log(`[LuaDebugger] Global F8 hotkey detected (suspended=${this.luaDebuggerSuspension ? 'yes' : 'no'}).`);
			this.beginGlobalDebuggerStepping();
			return true;
		}
		return false;
	}

	private beginGlobalDebuggerStepping(): void {
		if (!this.debuggerEnabled) {
			return;
		}
		if (this.luaDebuggerSuspension) {
			console.log('[LuaDebugger] Global F8 step-over requested while suspended.');
			if (this.editor?.isActive !== true) {
				this.debuggerAutoActivateOnNextPause = true;
			}
			this.resumeDebugger('step_over');
			return;
		}
		const controller = this.luaDebuggerController;
		if (this.editor?.isActive !== true) {
			this.debuggerAutoActivateOnNextPause = true;
		}
		if (controller.hasActiveSteppingRequest()) {
			console.log('[LuaDebugger] Global F8 step already pending; waiting for next pause.');
			return;
		}
		console.log('[LuaDebugger] Global F8 step armed for next statement.');
		controller.requestStepInto();
	}

	private shouldAcceptVMHotkey(code: string, key: string, modifiers: KeyModifier): boolean {
		const state = $.get_key_state(this.playerIndex, key, modifiers);
		if (state.pressed !== true) {
			this.consoleHotkeyLatch.delete(code);
			return false;
		}
		if (typeof state.pressId === 'number') {
			const existing = this.consoleHotkeyLatch.get(code);
			if (existing === state.pressId) {
				return false;
			}
			this.consoleHotkeyLatch.set(code, state.pressId);
			return true;
		}
		if (state.justpressed !== true) {
			return false;
		}
		this.consoleHotkeyLatch.set(code, null);
		return true;
	}

	private toggleTerminalMode(): void {
		if (this.terminal.isActive) {
			this.terminal.deactivate();
			this.updateOverlayState(false, this.editor?.isActive === true, true);
			return;
		}
		this.activateTerminalMode();
	}

	private toggleEditor(): void {
		if (this.editor?.isActive === true) {
			this.editor.deactivate();
			this.updateOverlayState(this.terminal.isActive, false, true);
			return;
		}
		this.activateEditor();
	}

	public activateEditor(): void {
		if (!this.editor) {
			return;
		}
		if (this.terminal.isActive) {
			this.terminal.deactivate();
		}
		if (!this.editor.isActive === true) {
			this.editor.activate();
		}

		this.updateOverlayState(this.terminal.isActive, this.editor.isActive === true, true);
	}

	private registerVMShortcuts(): void {
		this.disposeShortcutHandlers();
		const registry = Input.instance.getGlobalShortcutRegistry();
		const disposers: Array<() => void> = [];
		disposers.push(registry.registerKeyboardShortcut(this.playerIndex, EDITOR_TOGGLE_KEY, () => this.toggleEditor()));
		disposers.push(registry.registerKeyboardShortcut(this.playerIndex, VM_TOGGLE_KEY, () => this.toggleTerminalMode()));
		disposers.push(registry.registerGamepadChord(this.playerIndex, EDITOR_TOGGLE_GAMEPAD_BUTTONS, () => this.toggleEditor()));
		disposers.push(registry.registerKeyboardShortcut(this.playerIndex, GAME_PAUSE_KEY, () => $.toggleDebuggerControls()));
		this.shortcutDisposers = disposers;
	}

	private disposeShortcutHandlers(): void {
		if (this.shortcutDisposers.length === 0) {
			return;
		}
		for (let i = 0; i < this.shortcutDisposers.length; i++) {
			this.shortcutDisposers[i]();
		}
		this.shortcutDisposers = [];
	}

	private activateTerminalMode(): void {
		if (this.terminal.isActive) {
			return;
		}
		if (this.editor?.isActive === true) {
			this.editor.deactivate();
		}
		this.terminal.activate();
		this.updateOverlayState(true, false, true);
	}

	public toggleOverlayResolutionMode(): 'offscreen' | 'viewport' {
		const next = this._overlayResolutionMode === 'offscreen' ? 'viewport' : 'offscreen';
		this.overlayResolutionMode = next;
		return next;
	}

	private renderVMOverlay(): void {
		if (!this.terminal.isActive) {
			return;
		}
		this.overlayRenderBackend.setDefaultLayer('ide');
		this.terminal.draw(this.overlayRenderBackend, this.overlayRenderBackend.viewportSize);
	}

	private advanceTerminalMode(deltaSeconds: number): void {
		if (!this.terminal.isActive) {
			return;
		}
		this.terminal.update(deltaSeconds);
		void this.terminal.handleInput(deltaSeconds);
	}

	public set jsStackEnabled(enabled: boolean) {
		this.includeJsStackTraces = enabled;
	}

	public get jsStackEnabled(): boolean {
		return this.includeJsStackTraces;
	}

	public continueFromVM(): void {
		if (this.luaDebuggerSuspension) {
			this.resumeDebugger('continue');
		}
		this.terminal.deactivate();
		this.updateOverlayState(false, this.editor?.isActive === true, true);
	}

	public clearFaultState(): { cleared: boolean; resumedDebugger: boolean } {
		const suspension = this.luaDebuggerSuspension;
		if (suspension && suspension.reason === 'exception') {
			this.resumeDebugger('ignore_exception');
			return { cleared: true, resumedDebugger: true };
		}
		if (this.luaRuntimeFailed || this.faultSnapshot) {
			this.luaRuntimeFailed = false;
			this.clearFaultSnapshot();
			this.luaInterpreter.clearLastFaultEnvironment();
			this.luaInterpreter.clearLastFaultCallStack();
			if (this.editor) {
				this.editor.clearRuntimeErrorOverlay();
			}
			return { cleared: true, resumedDebugger: false };
		}
		return { cleared: false, resumedDebugger: false };
	}

	public recordLuaWarning(message: string): void {
		this.pendingLuaWarnings.push(message);
		console.warn(message);
		this.flushLuaWarnings();
	}

	private flushLuaWarnings(): void {
		if (this.pendingLuaWarnings.length === 0) {
			return;
		}
		const messages = this.pendingLuaWarnings;
		this.pendingLuaWarnings = [];
		for (const warning of messages) {
			this.editor!.showWarningBanner(warning, 6.0);
		}
	}

	private updateOverlayState(includeVM: boolean, includeEditor: boolean, force = false): void {
		if (!force && this.overlayState.console === includeVM && this.overlayState.editor === includeEditor) {
			return;
		}
		this.overlayState = { console: includeVM, editor: includeEditor };
		const anyOverlay = includeVM || includeEditor;
		if (!anyOverlay) {
			OverlayPipelineController.setRequest('console', null);
			return;
		}
		api.set_render_backend(this.overlayRenderBackend);
		OverlayPipelineController.setRequest('console', {
			includeTerminal: includeVM,
			includeIDE: includeEditor,
			includePresentation: true,
			includeCartUpdate: false,
		});
	}

	public async boot(): Promise<void> {
		const vmToken = this.luaVmGate.begin({ blocking: true, tag: 'new_game' });
		try {
			this.luaDebuggerSuspension = null;
			this.debuggerHaltsGame = false;
			this.setDebuggerPaused(false);
			this.luaRuntimeFailed = false;
			this.luaVmInitialized = false;
			this.clearFaultSnapshot();
			this.invalidateLuaModuleIndex();
			this.luaChunkEnvironmentsByPath.clear();
			this.luaChunkEnvironmentsByChunkName.clear();
			this.luaGenericChunksExecuted.clear();
			this.editor?.clearRuntimeErrorOverlay();
			if (this.hasCompletedInitialBoot) { // Subsequent boot: reset to fresh world
				await $.reset_to_fresh_world();
			}
			api.cartdata($.rompack.cart.namespace);
			this.bootLuaProgram();
			this.hasCompletedInitialBoot = true;
		}
		catch (error) {
			throw new Error('[BmsxVMRuntime]: Failed to boot runtime: ' + error);
		}
		finally {
			this.luaVmGate.end(vmToken);
		}
	}

	// Frame state is owned by the runtime: it is created per-frame, kept intact for debugger inspection on faults,
	// and only cleared via finalize/abandon during explicit reboot/reset flows.
	// Frame state is owned by the runtime and is always finalized/abandoned by the runtime; faults capture a snapshot for inspection.
	private beginFrameState(): VMFrameState {
		if (this.currentFrameState) {
			throw new Error('[BmsxVMRuntime] Attempted to begin a new frame while another frame is active.');
		}
		const deltaSeconds = $.deltatime_seconds;
		const debugPaused = $.paused === true;
		const haltGame = debugPaused || this.debuggerHaltsGame;
		const state: VMFrameState = {
			deltaSeconds,
			deltaForUpdate: haltGame ? 0 : deltaSeconds,
			editorActive: false,
			consoleActive: false,
			haltGame,
			debugPaused,
			updateExecuted: false,
			luaFaulted: this.luaRuntimeFailed,
			consoleEvaluated: false,
			editorEvaluated: false,
		};
		this.currentFrameState = state;
		return state;
	}

	private updateFrameHaltingState(state: VMFrameState): void {
		const debugPaused = $.paused === true;
		state.debugPaused = debugPaused;
		const consoleActive = state.consoleEvaluated ? state.consoleActive : this.overlayState.console;
		const editorActive = state.editorEvaluated ? state.editorActive : this.overlayState.editor;
		const haltGame = debugPaused || this.debuggerHaltsGame || consoleActive || editorActive;
		state.haltGame = haltGame;
		state.deltaForUpdate = haltGame ? 0 : state.deltaSeconds;
		this.updateOverlayState(consoleActive, editorActive, false);
		Input.instance.setDebugHotkeysPaused(consoleActive || editorActive);
	}

	public tickUpdate(): void {
		if (!this.tickEnabled) {
			return;
		}
		if (this.currentFrameState !== null) {
			return;
		}
		this.runCartUpdateTick();
	}

	public tickDraw(): void {
		if (!this.tickEnabled) {
			return;
		}
		if (!this.currentFrameState) {
			return;
		}
		try {
			this.drawFrame({ drawGame: true, drawTerminal: false, drawEditor: false });
		} finally {
			this.abandonFrameState();
		}
	}

	public tickTerminalMode(): void {
		if (!this.tickEnabled) {
			return;
		}
		this.runTerminalUpdateTick();
	}

	public tickTerminalModeDraw(): void {
		if (!this.tickEnabled) {
			return;
		}
		if (!this.currentFrameState) {
			return;
		}
		try {
			this.drawFrame({ drawGame: true, drawTerminal: true, drawEditor: false });
		} finally {
			this.abandonFrameState();
		}
	}

	public tickIDE(): void {
		if (!this.tickEnabled) {
			return;
		}
		this.runIdeUpdateTick();
	}

	public tickIDEDraw(): void {
		if (!this.tickEnabled) {
			return;
		}
		if (!this.currentFrameState) {
			return;
		}
		try {
			this.drawFrame({ drawGame: false, drawTerminal: false, drawEditor: true });
		} finally {
			this.abandonFrameState();
		}
	}

	private applyOverlayStateToFrame(state: VMFrameState): void {
		const consoleActive = this.terminal.isActive;
		const editorActive = this.editor?.isActive === true;
		state.consoleEvaluated = true;
		state.consoleActive = consoleActive;
		state.editorEvaluated = true;
		state.editorActive = editorActive;
		this.updateOverlayState(consoleActive, editorActive, false);
		this.updateFrameHaltingState(state);
	}

	private runCartUpdateTick(): void {
		let fault: unknown = null;
		try {
			const state = this.beginFrameState();
			this.pollVMHotkeys();
			this.applyOverlayStateToFrame(state);
			this.runUpdatePhase(state);
		} catch (error) {
			fault = error;
			this.handleLuaError(error);
		} finally {
			if (fault !== null && this.currentFrameState !== null) {
				this.abandonFrameState();
			}
		}
	}

	private runTerminalUpdateTick(): void {
		if (this.currentFrameState !== null) {
			return;
		}
		const state = this.beginFrameState();
		this.pollVMHotkeys();
		this.advanceTerminalMode(state.deltaSeconds);
		this.applyOverlayStateToFrame(state);
	}

	private runIdeUpdateTick(): void {
		if (this.currentFrameState !== null) {
			return;
		}
		const state = this.beginFrameState();
		this.pollVMHotkeys();
		if (this.editor) {
			this.editor.update(state.deltaSeconds);
		}
		this.applyOverlayStateToFrame(state);
	}

	private runUpdatePhase(state: VMFrameState): void {
		this.handleGlobalDebuggerHotkeys();
		if (state.updateExecuted) {
			return;
		}
		if (!this.luaVmGate.ready) {
			state.updateExecuted = true;
			return;
		}
		if (state.luaFaulted || this.luaRuntimeFailed) {
			state.luaFaulted = true;
			state.updateExecuted = true;
			return;
		}
		if (state.haltGame) {
			state.updateExecuted = true;
			return;
		}
		try {
			if (Object.values($.rompack.cart.chunk2lua).length > 0) {
				if (this.luaUpdateFunction !== null) {
					this.invokeLuaFunction(this.luaUpdateFunction, [state.deltaSeconds]);
				}
			} else {
				$.rompack.cart.update(state.deltaSeconds);
			}
		} catch (error) {
			if (isLuaDebuggerPauseSignal(error)) {
				this.onLuaDebuggerPause(error);
			} else {
				state.luaFaulted = true;
				this.handleLuaError(error);
			}
		} finally {
			state.updateExecuted = true;
		}
	}

	private drawFrame(options: { drawGame: boolean; drawTerminal: boolean; drawEditor: boolean }): void {
		try {
			this.overlayRenderBackend.beginFrame();
			if (options.drawEditor && this.editor?.isActive) {
				this.overlayRenderBackend.setDefaultLayer('ide');
				this.editor.draw();
			} else {
				if (options.drawTerminal && this.terminal.isActive) {
					this.renderVMOverlay();
				}
				this.overlayRenderBackend.setDefaultLayer('world');
				if (options.drawGame && this.luaVmGate.ready) {
					if (this.luaRuntimeFailed || this.faultSnapshot) {
						this.overlayRenderBackend.playbackRenderQueue(this.preservedRenderQueue);
					}
					else {
						const interpreter = this.luaInterpreter;
						try {
							interpreter.pushProgramCounter();
							this.invokeLuaFunction(this.luaDrawFunction, []);
							this.preservedRenderQueue = this.overlayRenderBackend.captureCurrentFrameRenderQueue();
						} catch (error) {
							this.preservedRenderQueue = this.overlayRenderBackend.captureCurrentFrameRenderQueue();

							if (isLuaDebuggerPauseSignal(error)) {
								this.onLuaDebuggerPause(error);
							} else {
								this.handleLuaError(error);
							}
						} finally {
							interpreter.popProgramCounter();
						}
					}
				}
			}
		}
		catch (error) {
			if (isLuaDebuggerPauseSignal(error)) {
				this.onLuaDebuggerPause(error);
			} else {
				this.handleLuaError(error);
			}
		} finally {
			this.overlayRenderBackend.endFrame();
		}
	}

	public abandonFrameState(): void {
		// Clear reference to allow next frame to begin
		this.currentFrameState = null;
	}

	public override dispose(): void {
		this.disposeShortcutHandlers();
		this.terminal.deactivate();
		this.unsubscribeGlobalDebuggerHotkeys();
		this.updateOverlayState(false, false, true);
		this.luaVmInitialized = false;
		if (this.editor) {
			this.editor.shutdown();
			this.editor = null;
		}
		this.luaInterpreter = null;
		super.dispose();
		if (BmsxVMRuntime._instance === this) {
			BmsxVMRuntime._instance = null;
		}
	}

	public get state(): BmsxVMState {
		const storage = this.storage.dump();
		const vmState = this.captureVmState();
		const state: BmsxVMState = {
			luaRuntimeFailed: this.luaRuntimeFailed,
			luaChunkName: this._luaChunkName,
			storage,
		};
		if (vmState) {
			if (vmState.globals) {
				state.luaGlobals = vmState.globals;
			}
			if (vmState.locals) {
				state.luaLocals = vmState.locals;
			}
			if (vmState.randomSeed !== undefined) {
				state.luaRandomSeed = vmState.randomSeed;
			}
			if (vmState.programCounter !== undefined) {
				state.luaProgramCounter = vmState.programCounter;
			}
		}
		return state;
	}

	public set state(state: BmsxVMState) {
		if (!state) this.resetRuntimeToFreshState();
		else this.restoreFromStateSnapshot(state);
	}

	private async resetRuntimeToFreshState() {
		const asset = $.rompack.cart.path2lua[$.rompack.cart.entry_path];
		this._luaChunkName = asset.chunk_name;
		this.luaVmInitialized = false;
		await this.boot();
	}

	private restoreFromStateSnapshot(snapshot: BmsxVMState): void {
		this.clearActiveDebuggerPause();
		// The editor deliberately clears luaRuntimeFailed before calling setState when the
		// user hits "Resume". That signal tells us to keep the script environment but otherwise
		// treat the operation as a soft reboot: user code should rerun init/update hooks while
		// engine state (world objects, physics, etc.) stays untouched unless the cart's own
		// logic rebuilds it. The fallback snapshot populated above is only meant to reapply
		// plain Lua globals/locals so the user's script logic can pick up right where it left
		// off. It is not a save-state, and it intentionally skips anything that needs engine
		// cooperation to restore.
		const savedRuntimeFailed = snapshot.luaRuntimeFailed === true;

		api.cartdata($.rompack.cart.namespace);
		if (snapshot.storage !== undefined) {
			this.storage.restore(snapshot.storage);
		}
		if (this.editor) {
			this.editor.clearRuntimeErrorOverlay();
		}

		this.luaRuntimeFailed = false;
		const shouldRunInit = snapshot.luaRuntimeFailed !== true;
		this.reinitializeLuaProgramFromSnapshot(snapshot, { runInit: shouldRunInit, hotReload: false });

		if (savedRuntimeFailed) {
			this.luaRuntimeFailed = true;
		}
		this.updateOverlayState(this.terminal.isActive, this.editor?.isActive === true, true);
	}

	public async resumeFromSnapshot(state: BmsxVMState): Promise<void> {
		this.clearActiveDebuggerPause();
		if (!state) {
			this.luaRuntimeFailed = false;
			throw new Error('[BmsxVMRuntime] Cannot resume from invalid state snapshot.');
		}
		const snapshot: BmsxVMState = { ...state, luaRuntimeFailed: false };
		// Clear any previous error overlays and interpreter fault markers so a fresh
		// resume starts clean and can report new errors normally.
		this.editor?.clearRuntimeErrorOverlay();
		this.luaInterpreter.clearLastFaultEnvironment();
		this.luaInterpreter.clearLastFaultCallStack();

		// Also clear dedupe set so subsequent errors surface again after resume.
		this.handledLuaErrors = new WeakSet<object>();
		// Clear flag and any queued overlay frame before we resume swapping handlers.
		this.luaRuntimeFailed = false;
		publishOverlayFrame(null);
		this.resumeLuaProgramState(snapshot);
		this.updateOverlayState(this.terminal.isActive, this.editor?.isActive === true, true);
		this.clearFaultSnapshot();
		this.luaVmInitialized = this.luaInterpreter !== null;
	}

	private hotReloadProgramEntry(params: { chunkName: string; source: string; }): void {
		const binding = params.chunkName;
		const previousChunkState = this.captureChunkState(binding);
		const previousChunkTables = this.captureChunkTables(binding);
		const previousGlobals = this.captureGlobalStateForReload();
		const interpreter = this.luaInterpreter;
		const hotModuleId = $.rompack.cart.chunk2lua[binding].source_path;
		interpreter.clearLastFaultEnvironment();
		const results = interpreter.execute(params.source, binding);
		this.luaJsBridge.wrapLuaExecutionResults(hotModuleId, results);
		this.cacheChunkEnvironment(binding, hotModuleId);
		this.restoreChunkState(interpreter.chunkEnvironment, previousChunkState);
		this.restoreChunkTables(interpreter.chunkEnvironment, previousChunkTables);
		this.restoreGlobalStateForReload(previousGlobals);
		this.rebindChunkEnvironmentHandlers(hotModuleId);
		this.bindLifecycleHandlers();
		this.luaRuntimeFailed = false;
		this._luaChunkName = binding;
		this.luaVmInitialized = true;
		const hotSource = params.source;
		this.refreshLuaHandlersForChunk(binding, hotSource);
		this.refreshLuaModulesOnResume(binding);
		clearNativeMemberCompletionCache();
		this.clearEditorErrorOverlaysIfNoFault();
	}

	private bindLifecycleHandlers(): void {
		const env = this.luaInterpreter.globalEnvironment;
		this.luaNewGameFunction = this.resolveLuaFunction(this.getLuaGlobalValue(env, 'new_game' satisfies LifeCycleHandlerName));
		this.luaInitFunction = this.resolveLuaFunction(this.getLuaGlobalValue(env, 'init' satisfies LifeCycleHandlerName));
		this.luaUpdateFunction = this.resolveLuaFunction(this.getLuaGlobalValue(env, 'update' satisfies LifeCycleHandlerName));
		this.luaDrawFunction = this.resolveLuaFunction(this.getLuaGlobalValue(env, 'draw' satisfies LifeCycleHandlerName));
	}

	private runLuaLifecycleHandler(kind: 'init' | 'new_game'): boolean {
		const fn = kind === 'init' ? this.luaInitFunction : this.luaNewGameFunction;
		if (fn === null) {
			return true;
		}
		try {
			this.invokeLuaFunction(fn, []);
			return true;
		}
		catch (error) {
			if (isLuaDebuggerPauseSignal(error)) {
				this.onLuaDebuggerPause(error);
			} else {
				this.handleLuaError(error);
			}
			return false;
		}
	}

	public reloadLuaProgramState(options: { runInit?: boolean; }): void {
		const runInit = options.runInit !== false;
		const binding = $.rompack.cart.path2lua[$.rompack.cart.entry_path];
		this._luaChunkName = binding.chunk_name;
		if (!this.luaInterpreter) {
			if (!this.bootLuaProgram()) {
				console.info(`[BmsxVMRuntime] Lua boot failed.`);
				return;
			}
		}
		else {
			this.hotReloadProgramEntry({ source: getSourceForChunk(binding.chunk_name), chunkName: binding.chunk_name });
			if (runInit) {
				if (this.runLuaLifecycleHandler('init')) {
					// Initialization successful
					if (!this.runLuaLifecycleHandler('new_game')) {
						console.info(`[BmsxVMRuntime] Lua 'new_game' lifecycle handler failed during reload.`);
					}
				}
			}
		}
		this.updateOverlayState(this.terminal.isActive, this.editor?.isActive === true, true);
		this.luaVmInitialized = this.luaInterpreter !== null;
	}

	private resumeLuaProgramState(snapshot: BmsxVMState): void {
		const savedRuntimeFailed = snapshot.luaRuntimeFailed === true;
		const shouldRunInit = !savedRuntimeFailed;
		const binding = snapshot.luaChunkName;
		let source: string;
		try {
			source = this.resourceSourceForChunk(binding);
		}
		catch (error) {
			throw convertToError(error);
		}
		this._luaChunkName = binding;
		try {
			this.hotReloadProgramEntry({ source, chunkName: binding });
		}
		catch (error) {
			this.handleLuaError(error);
		}
		this.refreshLuaModulesOnResume(binding);
		clearNativeMemberCompletionCache();
		if (shouldRunInit) {
			this.runLuaLifecycleHandler('init');
		}
		this.restoreVmState(snapshot);
		if (savedRuntimeFailed) {
			this.luaRuntimeFailed = true;
		}
	}

	private reinitializeLuaProgramFromSnapshot(snapshot: BmsxVMState, options: { runInit: boolean; hotReload: boolean }): void {
		const binding = $.cart.path2lua[$.cart.entry_path];
		const source = this.resourceSourceForChunk(binding.chunk_name);

		this._luaChunkName = binding.chunk_name;

		this.initializeLuaInterpreterFromSnapshot({
			source,
			chunkName: binding.chunk_name,
			snapshot,
			runInit: options.runInit,
			hotReload: options.hotReload,
		});
		clearNativeMemberCompletionCache();
	}

	private refreshLuaModulesOnResume(resumeModuleId: string): void {
		const chunkNames = Object.keys($.rompack.cart.chunk2lua);
		for (let index = 0; index < chunkNames.length; index += 1) {
			const moduleId = chunkNames[index];
			if (resumeModuleId && moduleId === resumeModuleId) {
				continue;
			}
			this.refreshLuaHandlersForChunk(moduleId);
		}
	}

	private rebindChunkEnvironmentHandlers(moduleId: string): void {
		const env = this.luaInterpreter?.chunkEnvironment;
		if (!env) {
			throw new Error('[BmsxVMRuntime] No Lua environment available for rebind.');
		}
		const visited = new WeakSet<LuaTable>();
		for (const [key, value] of env.entries()) {
			const path = [key];
			if (value !== null && value !== undefined) {
				this.rebindHandlersFromLuaValue(moduleId, value, path, visited);
			}
		}
	}

	private rebindHandlersFromLuaValue(
		moduleId: string,
		value: LuaValue,
		path: ReadonlyArray<string>,
		visited: WeakSet<LuaTable>,
	): void {
		if (isLuaFunctionValue(value)) {
			this.luaHandlerCache.rebind(moduleId, path, value);
			return;
		}
		if (!isLuaTable(value)) {
			return;
		}
		const table = value as LuaTable;
		if (visited.has(table)) {
			return;
		}
		visited.add(table);
		for (const [rawKey, entry] of table.entriesArray()) {
			const segment = typeof rawKey === 'string' ? rawKey : String(rawKey);
			const nextPath = path.length === 0 ? [segment] : [...path, segment];
			this.rebindHandlersFromLuaValue(moduleId, entry, nextPath, visited);
		}
	}

	private initializeLuaInterpreterFromSnapshot(params: { source: string; chunkName: string; snapshot: BmsxVMState; runInit: boolean; hotReload: boolean }): void {
		const snapshot = params.snapshot;
		const savedRuntimeFailed = snapshot.luaRuntimeFailed === true;
		const binding = $.cart.chunk2lua[params.chunkName];
		if (params.hotReload) {
			this.hotReloadProgramEntry({ source: params.source, chunkName: binding.chunk_name });
			if (params.runInit && !savedRuntimeFailed) {
				this.runLuaLifecycleHandler('init');
				this.runLuaLifecycleHandler('new_game');
			}
			this.restoreVmState(snapshot);
			if (savedRuntimeFailed) {
				this.luaRuntimeFailed = true;
			}
			return;
		}

		this.resetLuaInteroperabilityState();
		const interpreter = createLuaInterpreter(this._canonicalization);
		this.configureInterpreter(interpreter);
		interpreter.clearLastFaultEnvironment();
		this.luaInterpreter = interpreter;
		this.luaInitFunction = null;
		this.luaNewGameFunction = null;
		this.luaUpdateFunction = null;
		this.luaDrawFunction = null;
		this.luaRuntimeFailed = false;

		registerApiBuiltins(interpreter);
		interpreter.setReservedIdentifiers(this.apiFunctionNames);

		const moduleId = $.rompack.cart.chunk2lua[binding.chunk_name].source_path;
		const results = interpreter.execute(params.source, binding.chunk_name);
		this.luaJsBridge.wrapLuaExecutionResults(moduleId, results);
		this.cacheChunkEnvironment(binding.chunk_name, moduleId);
		this.luaVmInitialized = true;

		this.bindLifecycleHandlers();

		if (params.runInit && !savedRuntimeFailed) {
			this.runLuaLifecycleHandler('init');
		}
		this.restoreVmState(snapshot);
		if (savedRuntimeFailed) {
			this.luaRuntimeFailed = true;
		}
	}

	private clearEditorErrorOverlaysIfNoFault(): void {
		if (this.luaRuntimeFailed) return;
		this.editor.clearRuntimeErrorOverlay();
		publishOverlayFrame(null);
	}

	private recordFaultSnapshot(payload: {
		message: string;
		chunkName: string;
		line: number;
		column: number;
		details: RuntimeErrorDetails;
		fromDebugger: boolean;
	}): FaultSnapshot {
		const snapshot: FaultSnapshot = {
			message: payload.message,
			chunkName: payload.chunkName,
			line: payload.line,
			column: payload.column,
			details: payload.details,
			timestampMs: $.platform.clock.dateNow(),
			fromDebugger: payload.fromDebugger,
		};
		this.faultSnapshot = snapshot;
		this.faultOverlayNeedsFlush = true;
		return snapshot;
	}

	private clearFaultSnapshot(): void {
		this.faultSnapshot = null;
		this.faultOverlayNeedsFlush = false;
	}

	private recordDebuggerExceptionFault(signal: LuaDebuggerPauseSignal): FaultSnapshot {
		const exception = this.luaInterpreter.pendingDebuggerException;
		if (this.faultSnapshot && this.luaRuntimeFailed) {
			this.faultOverlayNeedsFlush = true;
			return this.faultSnapshot;
		}
		const signalLine = fallbackclamp(signal.location.line, 1, Number.MAX_SAFE_INTEGER, null);
		const signalColumn = fallbackclamp(signal.location.column, 1, Number.MAX_SAFE_INTEGER, null);
		if (!exception) {
			this.luaRuntimeFailed = true;
			return this.recordFaultSnapshot({
				message: 'Runtime error',
				chunkName: signal.location.chunk,
				line: signalLine,
				column: signalColumn,
				details: this.buildRuntimeErrorDetailsForEditor(null, 'Runtime error'),
				fromDebugger: true,
			});
		}
		const message = extractErrorMessage(exception);
		let chunkName: string = exception.chunkName;
		if (!chunkName || chunkName.length === 0) {
			chunkName = signal.location.chunk;
		}
		const normalizedLine = fallbackclamp(exception.line, 1, Number.MAX_SAFE_INTEGER, null);
		const normalizedColumn = fallbackclamp(exception.column, 1, Number.MAX_SAFE_INTEGER, null);
		this.luaRuntimeFailed = true;
		return this.recordFaultSnapshot({
			message,
			chunkName,
			line: normalizedLine ?? signalLine,
			column: normalizedColumn ?? signalColumn,
			details: this.buildRuntimeErrorDetailsForEditor(exception, message),
			fromDebugger: true,
		});
	}

	public presentRuntimeErrorInVM(
		prettyMessage: string,
		details: RuntimeErrorDetails,
	): void {
		this.terminal.appendStderr(prettyMessage);
		const stackLines = buildStackLines(details, this.jsStackEnabled);
		for (let index = 0; index < stackLines.length; index += 1) {
			this.terminal.appendStderr(stackLines[index]);
		}
	}

	public markSourceChunkAsDirty(chunkName: string): void {
		this.luaGenericChunksExecuted.delete(chunkName);
	}

	private captureVmState(): { globals?: LuaEntrySnapshot; locals?: LuaEntrySnapshot; randomSeed?: number; programCounter?: number } {
		const interpreter = this.luaInterpreter;
		if (!this.luaVmInitialized || !interpreter?.chunkEnvironment) return null;
		const globals = this.captureLuaEntryCollection(interpreter.enumerateGlobalEntries());
		const locals = this.captureLuaEntryCollection(interpreter.enumerateChunkEntries());
		const randomSeed = interpreter.getRandomSeed();
		const programCounter = interpreter.programCounter;
		return {
			globals: globals,
			locals: locals,
			randomSeed: randomSeed,
			programCounter: programCounter,
		};
	}

	private captureLuaEntryCollection(entries: ReadonlyArray<[string, LuaValue]>): LuaEntrySnapshot {
		// The IDE uses this fallback snapshot when a cart does not expose
		// __bmsx_snapshot_save/__bmsx_snapshot_load. It exists purely to let the editor
		// "resume" after a runtime failure without rebooting the whole cart. Unlike a
		// deterministic save-state we lean on the fact that native JS objects stay alive
		// across hot reloads: Lua tables are serialized, native references are kept by
		// identity, and Lua functions get refreshed by the reload pipeline.
		if (!entries || entries.length === 0) {
			return null;
		}
		const ctx = this.luaJsBridge.createLuaSnapshotContext();
		const snapshotRoot: Record<string, unknown> = {};
		let count = 0;
		for (const [name, value] of entries) {
			if (this.shouldSkipLuaSnapshotEntry(name, value)) {
				continue;
			}
			try {
				const serialized = this.luaJsBridge.serializeLuaValueForSnapshot(value, ctx);
				snapshotRoot[name] = serialized;
				count += 1;
			}
			catch (error) {
				console.warn(`[BmsxVMRuntime] Skipped Lua snapshot entry '${name}':`, error);
			}
		}
		return count > 0 ? { root: snapshotRoot, objects: ctx.objects } : null;
	}

	private captureChunkState(chunkName: string): LuaEntrySnapshot {
		const env = this.luaChunkEnvironmentsByChunkName.get(chunkName);
		if (!env) {
			return null;
		}
		return this.captureLuaEntryCollection(env.entries());
	}

	private captureChunkTables(chunkName: string): Map<string, LuaTable> {
		const env = this.luaChunkEnvironmentsByChunkName.get(chunkName);
		if (!env) {
			return null;
		}
		const tables = new Map<string, LuaTable>();
		for (const [name, value] of env.entries()) {
			if (typeof name === 'string' && isLuaTable(value)) {
				tables.set(name, value);
			}
		}
		return tables;
	}

	private restoreChunkState(env: LuaEnvironment, snapshot: LuaEntrySnapshot): void {
		if (!env || !snapshot) {
			return;
		}
		const entries = this.luaJsBridge.materializeLuaEntrySnapshot(snapshot);
		for (const [name, value] of entries) {
			if (!name) {
				continue;
			}
			const existing = env.get(name);
			if (isLuaFunctionValue(existing)) {
				continue;
			}
			if (isLuaTable(existing) && isLuaTable(value)) {
				this.luaJsBridge.applyLuaTableSnapshot(existing, value);
				continue;
			}
			env.set(name, value);
		}
	}

	private restoreChunkTables(env: LuaEnvironment, previousTables: Map<string, LuaTable>): void {
		if (!env || previousTables.size === 0) {
			return;
		}
		const visited = new WeakSet<LuaTable>();
		for (const [name, freshValue] of env.entries()) {
			if (typeof name !== 'string' || !isLuaTable(freshValue)) {
				continue;
			}
			const previous = previousTables.get(name);
			if (!previous) {
				continue;
			}
			this.luaJsBridge.mergeLuaTablePreservingState(previous, freshValue, visited);
			env.set(name, previous);
		}
	}

	private captureGlobalStateForReload(): LuaEntrySnapshot {
		return this.captureLuaEntryCollection(this.luaInterpreter.enumerateGlobalEntries());
	}

	private restoreGlobalStateForReload(globals: LuaEntrySnapshot): void {
		if (!globals) {
			return;
		}
		const entries = this.luaJsBridge.materializeLuaEntrySnapshot(globals);
		for (const [name, value] of entries) {
			if (!name || this.apiFunctionNames.has(name) || BmsxVMRuntime.LUA_SNAPSHOT_EXCLUDED_GLOBALS.has(name)) {
				continue;
			}
			const existing = this.luaInterpreter.getGlobal(name);
			if (isLuaFunctionValue(existing)) {
				continue;
			}
			if (isLuaTable(existing) && isLuaTable(value)) {
				this.luaJsBridge.applyLuaTableSnapshot(existing, value);
				continue;
			}
			this.luaInterpreter.setGlobal(name, value);
		}
	}

	private shouldSkipLuaSnapshotEntry(name: string, value: LuaValue): boolean {
		if (!name || this.apiFunctionNames.has(name)) {
			return true;
		}
		if (BmsxVMRuntime.LUA_SNAPSHOT_EXCLUDED_GLOBALS.has(name)) {
			return true;
		}
		if (isLuaFunctionValue(value)) {
			return true;
		}
		return false;
	}

	private restoreVmState(snapshot: BmsxVMState): void {
		const interpreter = this.luaInterpreter;
		if (snapshot.luaRandomSeed !== undefined) {
			interpreter.setRandomSeed(snapshot.luaRandomSeed);
		}
		if (snapshot.luaProgramCounter !== undefined) {
			interpreter.programCounter = snapshot.luaProgramCounter;
		}
		if (snapshot.luaGlobals) {
			this.restoreLuaGlobals(snapshot.luaGlobals);
		}
		if (snapshot.luaLocals) {
			this.restoreLuaLocals(snapshot.luaLocals);
		}
	}

	private restoreLuaGlobals(globals: LuaEntrySnapshot): void {
		const interpreter = this.luaInterpreter;
		const entries = this.luaJsBridge.materializeLuaEntrySnapshot(globals);
		for (const [name, value] of entries) {
			if (!name || this.apiFunctionNames.has(name) || BmsxVMRuntime.LUA_SNAPSHOT_EXCLUDED_GLOBALS.has(name)) {
				continue;
			}
			const existing = interpreter.getGlobal(name);
			if (isLuaTable(existing) && isLuaTable(value)) {
				this.luaJsBridge.applyLuaTableSnapshot(existing, value);
				continue;
			}
			try {
				interpreter.setGlobal(name, value);
			}
			catch (error) {
				if ($.debug) {
					console.warn(`[BmsxVMRuntime] Failed to restore Lua global '${name}':`, error);
				}
			}
		}
	}

	private restoreLuaLocals(locals: LuaEntrySnapshot): void {
		const interpreter = this.luaInterpreter;
		const entries = this.luaJsBridge.materializeLuaEntrySnapshot(locals);
		for (const [name, value] of entries) {
			if (!name || !interpreter.hasChunkBinding(name)) {
				continue;
			}
			const env = interpreter.chunkEnvironment;
			if (env) {
				const current = env.get(name);
				if (isLuaTable(current) && isLuaTable(value)) {
					this.luaJsBridge.applyLuaTableSnapshot(current, value);
					continue;
				}
			}
			try {
				interpreter.assignChunkValue(name, value);
			}
			catch (error) {
				if ($.debug) {
					console.warn(`[BmsxVMRuntime] Failed to restore Lua local '${name}':`, error);
				}
			}
		}
	}

	private resetLuaInteroperabilityState(): void {
		this.luaGenericChunksExecuted.clear();
		this.handledLuaErrors = new WeakSet<object>();
		this.luaFunctionRedirectCache.clear();
		setLuaTableCaseInsensitiveKeys(this._canonicalization !== 'none');
	}

	private bootLuaProgram() {
		const entryAsset = $.rompack.cart.path2lua[$.rompack.cart.entry_path];
		if (!entryAsset) {
			throw new Error(`[BmsxVMRuntime] Cannot boot Lua program: no entry asset found at path '${$.rompack.cart.entry_path}'.`);
		}
		const chunkName = entryAsset.chunk_name;
		if (!chunkName || chunkName.length === 0) {
			throw new Error('[BmsxVMRuntime] Cannot boot Lua program: entry asset has no chunk name.');
		}

		const source = this.resourceSourceForChunk(chunkName);
		if (!source || source.length === 0) {
			throw new Error(`[BmsxVMRuntime] Cannot boot Lua program: entry chunk '${chunkName}' has no source code.`);
		}

		this.resetLuaInteroperabilityState();
		const interpreter = createLuaInterpreter(this._canonicalization);
		this.configureInterpreter(interpreter);
		interpreter.clearLastFaultEnvironment();
		this.luaInterpreter = interpreter;
		this.luaInitFunction = null;
		this.luaNewGameFunction = null;
		this.luaUpdateFunction = null;
		this.luaDrawFunction = null;
		this._luaChunkName = chunkName;
		this.luaRuntimeFailed = false;

		try {
			registerApiBuiltins(interpreter);
			interpreter.setReservedIdentifiers(this.apiFunctionNames);
			const moduleId = $.rompack.cart.chunk2lua[chunkName].source_path;
			const results = interpreter.execute(source, chunkName);
			this.luaJsBridge.wrapLuaExecutionResults(moduleId, results);
			this.cacheChunkEnvironment(chunkName, moduleId);
			this.luaVmInitialized = true;
		}
		catch (error) {
			console.info(`[BmsxVMRuntime] Lua boot '${chunkName}' failed.`);
			this.handleLuaError(error);
			return;
		}

		this.bindLifecycleHandlers();

		const ok = this.runLuaLifecycleHandler('init');
		if (!ok) {
			return;
		}
		return this.runLuaLifecycleHandler('new_game');
	}

	public async reloadProgramAndResetWorld(options?: { runInit?: boolean }): Promise<void> {
		const vmToken = this.luaVmGate.begin({ blocking: true, tag: 'reload_and_reset' });
		try {
			// Reset the fault state
			this.clearActiveDebuggerPause();
			this.luaRuntimeFailed = false;
			this.clearFaultSnapshot();

			// Reload the program source from the cartridge and reset the world
			await $.reset_to_fresh_world();
			try {
				this.reloadLuaProgramState({ runInit: options?.runInit !== false });
			} catch (error) {
				this.handleLuaError(error);
			}
		}
		finally {
			this.luaVmGate.end(vmToken);
		}
	}

	private resolveLuaFunction(value: LuaValue): LuaFunctionValue {
		if (value === null) {
			return null;
		}
		if (typeof value === 'object' && value !== null && 'call' in value) {
			return value as LuaFunctionValue;
		}
		return null;
	}

	private invokeLuaFunction(fn: LuaFunctionValue, args: unknown[]): LuaValue[] {
		const luaArgs = args.map((value) => this.luaJsBridge.jsToLua(value));
		return fn.call(luaArgs);
	}

	public handleLuaError(error: unknown): void {
		if (!(error instanceof Error)) {
			error = convertToError(error);
		}
		// Pause signal has its own handler
		if (isLuaDebuggerPauseSignal(error)) {
			console.info('[BmsxVMRuntime] Lua debugger pause signal received: ', error);
			this.onLuaDebuggerPause(error);
			return;
		}

		// Avoid handling the same Error object repeatedly
		if (this.handledLuaErrors.has(error)) {
			return;
		}

		// Extract message and location info
		const message = extractErrorMessage(error);
		const { line, column, chunkName } = this.extractErrorLocation(error);

		this.luaRuntimeFailed = true;
		const interpreter = this.luaInterpreter;
		const callStackSnapshot = interpreter ? Array.from(interpreter.lastFaultCallStack) : [];
		const runtimeDetails = this.buildRuntimeErrorDetailsForEditor(error, message);
		const snapshot = this.recordFaultSnapshot({
			message,
			chunkName,
			line,
			column,
			details: runtimeDetails,
			fromDebugger: false,
		});
		this.pauseDebuggerForException({ chunkName: snapshot.chunkName, line: snapshot.line, column: snapshot.column }, callStackSnapshot);
		const prettyMessage = prettyPrintRuntimeError(chunkName, line, column, message);
		console.error('[BmsxVMRuntime] Lua runtime error:', prettyMessage, error);
		this.handledLuaErrors.add(error);
	}

	private buildRuntimeErrorDetailsForEditor(error: unknown, message: string): RuntimeErrorDetails {
		const interpreter = this.luaInterpreter;
		let luaFrames: StackTraceFrame[] = [];
		if (interpreter) {
			const callFrames = interpreter.lastFaultCallStack;
			// Convert recorded call sites
			luaFrames = convertLuaCallFrames(callFrames);
			// If the thrown error includes precise location, prepend it as the current frame
			if (error instanceof LuaError) {
				const src = typeof error.chunkName === 'string' && error.chunkName.length > 0 ? error.chunkName : null;
				const line = Number.isFinite(error.line) && error.line > 0 ? Math.floor(error.line) : null;
				const col = Number.isFinite(error.column) && error.column > 0 ? Math.floor(error.column) : null;
				// Only inject if not already represented as the innermost frame
				const innermostCall = callFrames.length > 0 ? callFrames[callFrames.length - 1] : null;
				const innermostFrame = luaFrames.length > 0 ? luaFrames[0] : null;
				const effectiveSource = src !== null ? src : innermostFrame ? innermostFrame.source : null;
				const resolvedLine = line !== null ? line : (innermostFrame ? innermostFrame.line : null);
				const resolvedColumn = col !== null ? col : (innermostFrame ? innermostFrame.column : null);
				const alreadyCaptured =
					!!innermostFrame &&
					innermostFrame.source === (effectiveSource ?? '') &&
					innermostFrame.line === (resolvedLine ?? 0) &&
					innermostFrame.column === (resolvedColumn ?? 0);
				if (!alreadyCaptured) {
					const fnName =
						innermostCall && innermostCall.functionName && innermostCall.functionName.length > 0
							? innermostCall.functionName
							: innermostFrame && innermostFrame.functionName && innermostFrame.functionName.length > 0
								? innermostFrame.functionName
								: null;
					if (innermostFrame && effectiveSource && innermostFrame.source === effectiveSource) {
						const hint = getChunkResourceHint(effectiveSource);
						const updated: StackTraceFrame = {
							origin: innermostFrame.origin,
							functionName: fnName,
							source: effectiveSource,
							line: resolvedLine,
							column: resolvedColumn,
							raw: buildLuaFrameRawLabel(fnName, effectiveSource),
							chunkasset_id: innermostFrame.chunkasset_id,
							chunkPath: innermostFrame.chunkPath,
						};
						if (!updated.chunkasset_id && hint) {
							updated.chunkasset_id = hint.asset_id;
							if (hint.path && hint.path.length > 0) {
								updated.chunkPath = hint.path;
							}
						}
						luaFrames[0] = updated;
					} else {
						const frameSource = src !== null ? src : effectiveSource;
						const top: StackTraceFrame = {
							origin: 'lua',
							functionName: fnName,
							source: frameSource,
							line: resolvedLine,
							column: resolvedColumn,
							raw: buildLuaFrameRawLabel(fnName, frameSource),
						};
						if (frameSource && frameSource.length > 0) {
							const hint = getChunkResourceHint(frameSource);
							if (hint) {
								top.chunkasset_id = hint.asset_id;
								if (hint.path && hint.path.length > 0) {
									top.chunkPath = hint.path;
								}
							}
						}
						luaFrames.unshift(top);
					}
				}
			}
			interpreter.clearLastFaultCallStack();
		}
		let stackText: string = null;
		if (this.includeJsStackTraces && error instanceof Error && typeof error.stack === 'string') {
			stackText = error.stack;
		}
		const jsFrames = this.includeJsStackTraces ? parseJsStackFrames(stackText) : [];
		if (luaFrames.length === 0 && jsFrames.length === 0) {
			return null;
		}
		return {
			message,
			luaStack: luaFrames,
			jsStack: jsFrames,
		};
	}

	public createApiRuntimeError(message: string): LuaRuntimeError {
		this.luaInterpreter.markFaultEnvironment();
		const range = this.luaInterpreter.getCurrentCallRange();
		const chunkName = range ? range.chunkName : (this._luaChunkName ?? 'lua');
		const line = range ? range.start.line : 0;
		const column = range ? range.start.column : 0;
		return new LuaRuntimeError(message, chunkName, line, column);
	}

	private getLuaGlobalValue(env: LuaEnvironment, name: string): LuaValue {
		if (!name) {
			return null;
		}
		return env.get(this.canonicalizeIdentifier(name));
	}

	public canonicalizeIdentifier(name: string): string {
		if (this._canonicalization) {
			if (this._canonicalization === 'upper') {
				return name.toUpperCase();
			}
			if (this._canonicalization === 'lower') {
				return name.toLowerCase();
			}
		}
		return name;
	}

	public callLuaFunction(fn: LuaFunctionValue, args: unknown[]): unknown[] {
		// Marshal JS→Lua, call, then marshal Lua→JS with path context for error breadcrumbs.
		const luaArgs: LuaValue[] = [];
		for (let index = 0; index < args.length; index += 1) {
			luaArgs.push(this.luaJsBridge.jsToLua(args[index]));
		}
		const results = fn.call(luaArgs);
		const output: unknown[] = [];
		const moduleId = $.rompack.cart.chunk2lua[this._luaChunkName].source_path;
		const baseCtx = this.ensureMarshalContext({ moduleId, path: [] });
		for (let i = 0; i < results.length; i += 1) {
			output.push(this.luaJsBridge.luaValueToJs(results[i], this.extendMarshalContext(baseCtx, `ret${i}`)));
		}
		return output;
	}

	private invokeLuaHandler(fn: LuaFunctionValue, thisArg: unknown, args: ReadonlyArray<unknown>): unknown {
		// Lua colon syntax injects the receiver as the first argument; we mirror that here so
		// Lua-side handlers defined with ':' see the expected self.
		const callArgs: unknown[] = [];
		if (thisArg !== undefined) {
			callArgs.push(thisArg);
		}
		for (let index = 0; index < args.length; index += 1) {
			callArgs.push(args[index]);
		}
		const results = this.callLuaFunction(fn, callArgs);
		return results.length > 0 ? results[0] : undefined;
	}

	private handleLuaHandlerError(error: unknown, meta?: { hid: string; moduleId: string; path?: string }): void {
		// Annotate the error message with the handler ID if not already present
		const wrappedError = convertToError(error);
		if (meta && meta.hid && !wrappedError.message.startsWith(`[${meta.hid}]`)) {
			wrappedError.message = `[${meta.hid}] ${wrappedError.message}`;
		}
		this.luaInterpreter.recordFaultCallStack();
		this.handleLuaError(wrappedError);
		throw wrappedError; // Rethrow for higher-level handling
	}

	public ensureMarshalContext(context?: LuaMarshalContext): LuaMarshalContext {
		if (context) {
			return context;
		}
		const moduleId = this._luaChunkName ?? 'lua::runtime';
		// Marshal contexts annotate where a value came from (module + path) so errors/diagnostics
		// can report meaningful breadcrumbs for mixed JS/Lua graphs.
		return {
			moduleId,
			path: [],
		};
	}

	public extendMarshalContext(ctx: LuaMarshalContext, segment: string): LuaMarshalContext {
		if (!segment) {
			return ctx;
		}
		return {
			moduleId: ctx.moduleId,
			path: ctx.path.concat(segment),
		};
	}

	private refreshPackageLoadedEntry(packageKey: string, results: ReadonlyArray<LuaValue>): void {
		const packageLoaded = this.luaInterpreter.getPackageLoadedTable();
		const moduleValue = results.length > 0 && results[0] !== null ? results[0] : true;
		packageLoaded?.set(packageKey, moduleValue);
	}

	private rebindModuleExportHandlers(moduleId: string, moduleValue: LuaValue): void {
		const visited = new WeakSet<LuaTable>();
		this.rebindHandlersFromLuaValue(moduleId, moduleValue, [], visited);
	}

	public invalidateLuaModuleIndex(): void {
		this.luaModuleIndexBuilt = false;
		this.luaModuleAliases.clear();
		this.chunkSemanticCache.clear();
	}

	private cacheChunkEnvironment(chunkName: string, moduleId?: string): void {
		const environment = this.luaInterpreter?.chunkEnvironment;
		if (!environment) {
			return;
		}
		const definitions = this.luaInterpreter.getChunkDefinitions(chunkName);
		const effectiveModuleId = moduleId ?? $.rompack.cart.chunk2lua[chunkName]?.chunk_name;
		this.pruneRemovedChunkFunctionExports(chunkName, environment, definitions, this.luaInterpreter.globalEnvironment);
		this.installFunctionRedirectsForChunk(effectiveModuleId, environment, definitions);
		this.luaJsBridge.wrapDynamicChunkFunctions(effectiveModuleId, environment, chunkName);
		const asset = $.rompack.cart.chunk2lua[chunkName];
		this.luaChunkEnvironmentsByChunkName.set(chunkName, environment);
		if (asset?.source_path) {
			this.luaChunkEnvironmentsByPath.set(asset.source_path, environment);
		}
	}

	private collectChunkFunctionDefinitionKeys(definitions: ReadonlyArray<LuaDefinitionInfo>): Set<string> {
		const keys = new Set<string>();
		if (!definitions) {
			return keys;
		}
		for (let index = 0; index < definitions.length; index += 1) {
			const entry = definitions[index];
			if (entry.kind !== 'function') {
				continue;
			}
			if (!entry.namePath || entry.namePath.length === 0) {
				continue;
			}
			const key = entry.namePath.join('.');
			if (key.length > 0) {
				keys.add(key);
			}
		}
		return keys;
	}

	private pruneRemovedChunkFunctionExports(
		normalizedChunk: string,
		environment: LuaEnvironment,
		definitions: ReadonlyArray<LuaDefinitionInfo>,
		globalEnv: LuaEnvironment,
	): void {
		if (!environment) {
			return;
		}
		const previousKeys = this.chunkFunctionDefinitionKeys.get(normalizedChunk);
		const currentKeys = this.collectChunkFunctionDefinitionKeys(definitions);
		if (previousKeys && previousKeys.size > 0) {
			for (const key of previousKeys) {
				if (!currentKeys.has(key)) {
					const path = key.split('.');
					this.clearExportInEnvironment(environment, path);
					this.clearExportInEnvironment(globalEnv, path);
				}
			}
		}
		this.chunkFunctionDefinitionKeys.set(normalizedChunk, currentKeys);
	}

	private installFunctionRedirectsForChunk(
		moduleId: string,
		environment: LuaEnvironment,
		definitions: ReadonlyArray<LuaDefinitionInfo>,
	): void {
		const definitionKeys = this.collectChunkFunctionDefinitionKeys(definitions);
		if (definitionKeys.size === 0) {
			return;
		}
		for (const key of definitionKeys) {
			const segments = key.split('.');
			this.luaJsBridge.wrapFunctionByPath(moduleId, environment, segments);
		}
	}

	private clearExportInEnvironment(env: LuaEnvironment, pathParts: ReadonlyArray<string>): void {
		if (!env || !pathParts || pathParts.length === 0) {
			return;
		}
		if (pathParts.length === 1) {
			env.set(pathParts[0], null);
			return;
		}
		const first = env.get(pathParts[0]);
		if (first === null || !isLuaTable(first)) {
			return;
		}
		let current: LuaTable = first;
		for (let index = 1; index < pathParts.length - 1; index += 1) {
			const nextValue = current.get(pathParts[index]);
			if (nextValue === null || !isLuaTable(nextValue)) {
				return;
			}
			current = nextValue;
		}
		current.set(pathParts[pathParts.length - 1], null);
	}

	public ensureLuaModuleIndex(): void {
		if (this.luaModuleIndexBuilt) {
			return;
		}
		const aliases = buildLuaModuleAliases($.rompack.cart);
		this.luaModuleAliases.clear();
		for (const [key, record] of aliases) {
			this.luaModuleAliases.set(key, record);
		}
		this.luaModuleIndexBuilt = true;
	}

	private requireLuaModule(interpreter: LuaInterpreter, moduleName: string): LuaValue {
		this.ensureLuaModuleIndex();
		if (!moduleName || moduleName.length === 0) {
			throw this.createApiRuntimeError(`require(moduleName) received an invalid module name '${moduleName}'.`);
		}
		const record = this.luaModuleAliases.get(moduleName);
		if (!record) {
			throw this.createApiRuntimeError(`Module '${moduleName}' not found.`);
		}
		const packageLoaded = interpreter.getPackageLoadedTable();
		const cached = packageLoaded.get(record.packageKey);
		if (cached !== null) {
			return cached;
		}
		if (this.luaModuleLoadingKeys.has(record.packageKey)) {
			const pending = packageLoaded.get(record.packageKey);
			return pending === null ? true : pending;
		}
		const source = this.resourceSourceForChunk($.rompack.cart.path2lua[record.path].chunk_name);
		const resourceInfo: { path?: string } = {};
		resourceInfo.path = record.path;
		this.luaModuleLoadingKeys.add(record.packageKey);
		packageLoaded.set(record.packageKey, true);
		const previousChunkName = this._luaChunkName;
		this._luaChunkName = record.chunkName;
		try {
			const moduleId = $.rompack.cart.path2lua[record.path]?.chunk_name;
			const results = interpreter.execute(source, record.chunkName);
			this.luaJsBridge.wrapLuaExecutionResults(moduleId, results);
			this.cacheChunkEnvironment(record.chunkName, moduleId);
			const moduleValue = results.length > 0 && results[0] !== null ? results[0] : true;
			packageLoaded.set(record.packageKey, moduleValue);
			this.rebindChunkEnvironmentHandlers(moduleId);
			this.rebindModuleExportHandlers(moduleId, moduleValue);
			return moduleValue;
		}
		catch (error) {
			packageLoaded.delete(record.packageKey);
			if (isLuaScriptError(error)) {
				throw error;
			}
			const message = extractErrorMessage(error);
			throw this.createApiRuntimeError(message);
		}
		finally {
			this.luaModuleLoadingKeys.delete(record.packageKey);
			this._luaChunkName = previousChunkName;
		}
	}

	private refreshLuaHandlersForChunk(chunkName: string, sourceOverride?: string): void {
		this.luaGenericChunksExecuted.delete(chunkName);
		this.reloadGenericLuaChunk(chunkName, sourceOverride);
		clearNativeMemberCompletionCache();
		this.clearEditorErrorOverlaysIfNoFault();
	}

	private reloadGenericLuaChunk(chunkName: string, sourceOverride?: string): void {
		const interpreter = this.luaInterpreter;
		const previousChunkState = this.captureChunkState(chunkName);
		const previousChunkTables = this.captureChunkTables(chunkName);
		const previousGlobals = this.captureGlobalStateForReload();
		const source = sourceOverride ? sourceOverride : this.resourceSourceForChunk(chunkName);
		const moduleId = chunkName;
		const results = interpreter.execute(source, chunkName);
		this.luaJsBridge.wrapLuaExecutionResults(moduleId, results);
		this.cacheChunkEnvironment(chunkName, moduleId);
		this.restoreChunkState(interpreter.chunkEnvironment, previousChunkState);
		this.restoreChunkTables(interpreter.chunkEnvironment, previousChunkTables);
		this.restoreGlobalStateForReload(previousGlobals);
		this.refreshPackageLoadedEntry(chunkName, results);
		const moduleValue = results.length > 0 && results[0] !== null ? results[0] : true;
		this.rebindChunkEnvironmentHandlers(moduleId);
		this.rebindModuleExportHandlers(moduleId, moduleValue);
		this.luaGenericChunksExecuted.add(chunkName);
	}

	public resourceSourceForChunk(chunkName: string): string {
		const binding = $.cart.chunk2lua[chunkName];
		if (!binding) return null; // This can happen for non-existent chunks, such as debugger tabs that don't refer to real chunks
		const cached = getWorkspaceCachedSource(binding.normalized_source_path);
		if (cached !== null) {
			return cached;
		}
		return binding.src;
	}
}
