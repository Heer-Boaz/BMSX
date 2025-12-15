import { RegisterablePersistent } from '../../rompack/rompack';
import { Registry } from '../../core/registry';
import { BmsxVMRuntime } from '../vm_runtime';
import { type LuaDebuggerSessionMetrics } from '../../lua/luadebugger';
import { ide_state } from './ide_state';
import { getActiveCodeTabContext } from './editor_tabs';
import { resolveHoverChunkName } from './intellisense';
import { clamp, clamp_fallback } from '../../utils/clamp';
import { centerCursorVertically, ensureCursorVisible, setCursorPosition } from './caret';
import { clearExecutionStopHighlights, focusChunkSource, setExecutionStopHighlight, clearRuntimeErrorOverlay, updateDesiredColumn, findFunctionDefinitionRowInActiveFile, resetPointerClickTracking } from './vm_cart_editor';
import { resetBlink } from './render/render_caret';
import type { LuaCallFrame } from '../../lua/luaruntime';
import { extractErrorMessage, type LuaDebuggerPauseSignal, type StackTraceFrame } from '../../lua/luavalue';
import * as constants from './constants';

type DebuggerResumeCommand = 'continue' | 'step_over' | 'step_into' | 'step_out' | 'ignore_exception' | 'step_out_exception';

const DEBUGGER_LOG_PREFIX = '[Debugger]';

export class RuntimeDebuggerCommandExecutor implements RegisterablePersistent {
	private static _instance: RuntimeDebuggerCommandExecutor = null;

	public static get instance(): RuntimeDebuggerCommandExecutor {
		if (!RuntimeDebuggerCommandExecutor._instance) {
			RuntimeDebuggerCommandExecutor._instance = new RuntimeDebuggerCommandExecutor();
		}
		return RuntimeDebuggerCommandExecutor._instance;
	}

	get registrypersistent(): true {
		return true;
	}

	public get id(): 'dce' { return 'dce'; }

	public dispose(): void {
		this.unbind();
		if (RuntimeDebuggerCommandExecutor._instance === this) {
			RuntimeDebuggerCommandExecutor._instance = null;
		}
	}

	public bind(): void {
		Registry.instance.register(this);
	}

	public unbind(): void {
		Registry.instance.deregister(this);
	}

	private hasActiveSuspension = getLastDebuggerPauseEvent() !== null;

	constructor() {
		subscribeDebuggerLifecycleEvents((event: DebuggerLifecycleEvent) => {
			if (event.type === 'paused' || event.type === 'exception_frame_focus') {
				this.hasActiveSuspension = true;
				return;
			}
			if (event.type === 'continued') {
				this.hasActiveSuspension = false;
			}
		});
	}

	public get suspended(): boolean {
		return this.hasActiveSuspension;
	}

	public issueDebuggerCommand(command: DebuggerResumeCommand): boolean {
		if (!this.hasActiveSuspension) {
			this.logCommand(command, false, 'no_suspension');
			return false;
		}
		const runtime = BmsxVMRuntime.instance;
		if (!runtime) {
			this.logCommand(command, false, 'runtime_unavailable');
			return false;
		}
		const handled = this.dispatchCommand(runtime, command);
		if (!handled) {
			this.logCommand(command, false, 'unsupported_command');
			return false;
		}
		this.logCommand(command, true, 'ok');
		return true;
	}

	private dispatchCommand(runtime: BmsxVMRuntime, command: DebuggerResumeCommand): boolean {
		try {
			switch (command) {
				case 'continue':
					runtime.continueLuaDebugger();
					return true;
				case 'step_over':
					runtime.stepOverLuaDebugger();
					return true;
				case 'step_into':
					runtime.stepIntoLuaDebugger();
					return true;
				case 'step_out':
					runtime.stepOutLuaDebugger();
					return true;
				case 'ignore_exception':
					runtime.ignoreLuaException();
					return true;
				case 'step_out_exception':
					runtime.stepOutLuaDebugger();
					runtime.ignoreLuaException();
					return true;
				default:
					return false;
			}
		} catch (error) {
			this.logCommand(command, false, `error:${(error as Error).message}`);
			return false;
		}
	}

	private logCommand(command: DebuggerResumeCommand, handled: boolean, reason: string): void {
		console.log(`${DEBUGGER_LOG_PREFIX} command=${command} handled=${handled} reason=${reason}`);
	}
}
let initialized = false;

export function initializeDebuggerUiState(): void {
	if (initialized) {
		return;
	}
	initialized = true;
	updateExecutionState(getDebuggerExecutionState());
	subscribeDebuggerLifecycleEvents(handleDebuggerLifecycleEvent);
}
function handleDebuggerLifecycleEvent(event: DebuggerLifecycleEvent): void {
	if (event.type === 'continued') {
		updateExecutionState('running');
		ide_state.debuggerControls.sessionMetrics = null;
		return;
	}
	if (event.type === 'paused') {
		ide_state.debuggerControls.sessionMetrics = event.metrics;
		updateExecutionState('paused');
		return;
	}
	updateExecutionState('paused');
}
function updateExecutionState(state: DebuggerExecutionState): void {
	if (ide_state.debuggerControls.executionState === state) {
		return;
	}
	ide_state.debuggerControls.executionState = state;
}
export type SerializedBreakpointMap = Record<string, number[]>;

export type BreakpointToggleResult = 'added' | 'removed' | 'unchanged';
function ensureBucket(chunkKey: string): Set<number> {
	let bucket = ide_state.breakpoints.get(chunkKey);
	if (!bucket) {
		bucket = new Set<number>();
		ide_state.breakpoints.set(chunkKey, bucket);
	}
	return bucket;
}

export function hasBreakpoint(chunkName: string, line: number): boolean {
	if (!chunkName) {
		return false;
	}
	if (line === null) {
		return false;
	}
	const bucket = ide_state.breakpoints.get(chunkName);
	return bucket?.has(line) === true;
}

export function getBreakpointsForChunk(chunkName: string): ReadonlySet<number> {
	if (!chunkName) {
		return null;
	}
	const bucket = ide_state.breakpoints.get(chunkName);
	return bucket;
}

export function toggleBreakpoint(chunkName: string, line: number): BreakpointToggleResult {
	if (line === null) {
		return 'unchanged';
	}
	const chunkKey = chunkName;
	const bucket = ensureBucket(chunkKey);
	if (bucket.has(line)) {
		bucket.delete(line);
		if (bucket.size === 0) {
			ide_state.breakpoints.delete(chunkKey); // Clean up empty bucket
		}

		syncRuntimeBreakpoints();
		return 'removed';
	}
	bucket.add(line);
	syncRuntimeBreakpoints();
	return 'added';
}

export function serializeBreakpoints(): SerializedBreakpointMap {
	const payload: SerializedBreakpointMap = {};
	for (const [chunk, lines] of ide_state.breakpoints) {
		if (lines.size === 0) {
			continue;
		}
		const sorted = Array.from(lines).sort((a, b) => a - b);
		payload[chunk] = sorted;
	}
	return payload;
}

export function restoreBreakpointsFromPayload(payload: SerializedBreakpointMap): void {
	ide_state.breakpoints.clear();
	if (payload) {
		for (const [chunk, lineEntries] of Object.entries(payload)) {
			if (!Array.isArray(lineEntries) || lineEntries.length === 0) {
				continue;
			}
			const chunkKey = chunk;
			const bucket = new Set<number>();
			for (const entry of lineEntries) {
				if (entry !== null) {
					bucket.add(entry);
				}
			}
			if (bucket.size > 0) {
				ide_state.breakpoints.set(chunkKey, bucket);
			}
		}
	}
	syncRuntimeBreakpoints();
}

export function syncRuntimeBreakpoints(): void {
	const serialized = new Map<string, Set<number>>();
	for (const [chunk, lines] of ide_state.breakpoints) {
		if (lines.size === 0) {
			continue;
		}
		serialized.set(chunk, new Set(lines));
	}
	BmsxVMRuntime.instance.setDebuggerBreakpoints(serialized);
}

export function getActiveBreakpointChunkName(): string {
	const context = getActiveCodeTabContext();
	return resolveHoverChunkName(context);
}

export function toggleBreakpointForEditorRow(row: number = ide_state.cursorRow): boolean {
	if (row < 0 || row >= ide_state.buffer.getLineCount()) {
		return false;
	}
	const chunkName = getActiveBreakpointChunkName();
	if (!chunkName) {
		ide_state.showMessage('No active chunk available for breakpoints.', constants.COLOR_STATUS_WARNING, 1.6);
		return false;
	}
	const lineNumber = row + 1;
	const result = toggleBreakpoint(chunkName, lineNumber);
	if (result === 'unchanged') {
		return false;
	}
	const verb = result === 'added' ? 'set' : 'cleared';
	ide_state.showMessage(`Breakpoint ${verb} at ${chunkName}:${lineNumber}`, constants.COLOR_STATUS_TEXT, 1.4);
	return true;
}
const MESSAGE_BY_REASON: Record<DebuggerPauseDisplayPayload['reason'], string> = {
	breakpoint: 'Paused on breakpoint',
	step: 'Debugger paused',
	exception: 'Paused on exception',
};

export function showDebuggerPauseOverlay(payload: DebuggerPauseDisplayPayload, metrics: LuaDebuggerSessionMetrics): void {
	if (!ide_state.active) {
		return;
	}
	const normalizedChunk = payload.chunk;
	if (!normalizedChunk) {
		clearExecutionStopHighlights();
		return;
	}
	focusChunkSource(normalizedChunk);
	const safeLine = clamp_fallback(payload.line, 1, payload.line - 1, 1);
	const safeColumn = clamp_fallback(payload.column, 1, payload.column - 1, 1);
	updateDebuggerCaret(safeLine, safeColumn);
	setExecutionStopHighlight(safeLine);
	const baseMessage = MESSAGE_BY_REASON[payload.reason] ?? 'Debugger paused';
	const metricsText = formatDebuggerMetrics(metrics);
	const message = metricsText ? `${baseMessage} — ${metricsText}` : baseMessage;
	ide_state.showMessage(message, constants.COLOR_STATUS_WARNING, 3.0);
}

export function clearDebuggerPauseOverlay(): void {
	clearExecutionStopHighlights();
	resetBlink();
}

export function prepareDebuggerStepOverlay(): void {
	if (!ide_state.active) {
		return;
	}
	clearRuntimeErrorOverlay();
	ide_state.showMessage('Debugger stepping…', constants.COLOR_STATUS_WARNING, 2.0);
}

function updateDebuggerCaret(row: number, column: number): void {
	const maxRow = Math.max(0, ide_state.buffer.getLineCount() - 1);
	const clampedRow = clamp(row, 0, maxRow);
	const lineText = ide_state.buffer.getLineContent(clampedRow);
	const clampedColumn = clamp(column, 0, lineText.length);
	ide_state.cursorRow = clampedRow;
	ide_state.cursorColumn = clampedColumn;
	ide_state.selectionAnchor = null;
	updateDesiredColumn();
	ensureCursorVisible();
	resetBlink();
}

function formatDebuggerMetrics(metrics: LuaDebuggerSessionMetrics): string {
	if (!metrics) {
		return null;
	}
	const parts: string[] = [`${metrics.pauseCount} stop${metrics.pauseCount === 1 ? '' : 's'}`];
	if (metrics.exceptionCount > 0) {
		parts.push(`${metrics.exceptionCount} exception${metrics.exceptionCount === 1 ? '' : 's'}`);
	}
	if (metrics.skippedExceptionCount > 0) {
		parts.push(`${metrics.skippedExceptionCount} skipped`);
	}
	return parts.join(' · ');
}

export function navigateToRuntimeErrorFrameTarget(frame: StackTraceFrame): void {
	if (frame.origin !== 'lua') {
		return;
	}
	const source = frame.source ?? '';
	if (source.length === 0) {
		ide_state.showMessage('Runtime frame is missing a chunk reference.', constants.COLOR_STATUS_ERROR, 1.6);
		return;
	}
	const normalizedChunk = source;
	try {
		focusChunkSource(normalizedChunk);
	} catch (error) {
		const message = extractErrorMessage(error);
		ide_state.showMessage(`Failed to open runtime chunk: ${message}`, constants.COLOR_STATUS_ERROR, 1.6);
		return;
	}
	const activeContext = getActiveCodeTabContext();
	if (!activeContext) {
		ide_state.showMessage('Unable to activate editor context for runtime frame.', constants.COLOR_STATUS_ERROR, 1.6);
		return;
	}
	const lastRowIndex = Math.max(0, ide_state.buffer.getLineCount() - 1);
	let targetRow: number = null;
	if (typeof frame.line === 'number' && frame.line > 0) {
		targetRow = clamp(frame.line - 1, 0, lastRowIndex);
	}
	if (targetRow === null && frame.functionName) {
		targetRow = findFunctionDefinitionRowInActiveFile(frame.functionName);
	}
	if (targetRow === null) {
		targetRow = 0;
	}
	const targetLine = ide_state.buffer.getLineContent(targetRow);
	let targetColumn = 0;
	if (typeof frame.column === 'number' && frame.column > 0) {
		targetColumn = clamp(frame.column - 1, 0, targetLine.length);
	}
	if (targetColumn === 0 && frame.functionName && frame.functionName.length > 0) {
		const nameIndex = targetLine.indexOf(frame.functionName);
		if (nameIndex >= 0) {
			targetColumn = nameIndex;
		}
	}
	ide_state.selectionAnchor = null;
	ide_state.pointerSelecting = false;
	resetPointerClickTracking();
	setCursorPosition(targetRow, targetColumn);
	ide_state.cursorRevealSuspended = false;
	centerCursorVertically();
	ensureCursorVisible();
}

export type DebuggerPauseFrameHint = { asset_id: string; path?: string; };

export type DebuggerPauseDisplayPayload = {
	chunk: string;
	line: number;
	column: number;
	reason: LuaDebuggerPauseSignal['reason'];
	hint: DebuggerPauseFrameHint;
};

export type DebuggerResumeMode = 'continue' | 'step_into' | 'step_over' | 'step_out';

export type DebuggerLifecyclePausedEvent = {
	type: 'paused';
	suspension: LuaDebuggerPauseSignal;
	payload: DebuggerPauseDisplayPayload;
	callStack: ReadonlyArray<LuaCallFrame>;
	metrics: LuaDebuggerSessionMetrics;
};

export type DebuggerLifecycleContinuedEvent = {
	type: 'continued';
	mode: DebuggerResumeMode;
};

export type DebuggerLifecycleExceptionFrameEvent = {
	type: 'exception_frame_focus';
	payload: DebuggerPauseDisplayPayload;
};

export type DebuggerLifecycleEvent = DebuggerLifecyclePausedEvent |
	DebuggerLifecycleContinuedEvent |
	DebuggerLifecycleExceptionFrameEvent;

export type DebuggerExecutionState = 'inactive' | 'running' | 'paused';
type DebuggerLifecycleListener = (event: DebuggerLifecycleEvent) => void;
const listeners = new Set<DebuggerLifecycleListener>();
let lastPausedEvent: DebuggerLifecyclePausedEvent = null;
let debuggerState: DebuggerExecutionState = 'inactive';

export function emitDebuggerLifecycleEvent(event: DebuggerLifecycleEvent): void {
	if (event.type === 'paused') {
		debuggerState = 'paused';
		lastPausedEvent = event;
	}
	else if (event.type === 'continued') {
		debuggerState = 'running';
		lastPausedEvent = null;
	}
	else if (event.type === 'exception_frame_focus') {
		debuggerState = 'paused';
	}
	for (const listener of listeners) {
		listener(event);
	}
}

export function subscribeDebuggerLifecycleEvents(
	listener: DebuggerLifecycleListener,
	{ replayCurrentPause }: { replayCurrentPause?: boolean; } = {}
): () => void {
	listeners.add(listener);
	if (replayCurrentPause !== false && lastPausedEvent) {
		listener(lastPausedEvent);
	}
	return () => {
		listeners.delete(listener);
	};
}

export function getDebuggerExecutionState(): DebuggerExecutionState {
	return debuggerState;
}

export function getLastDebuggerPauseEvent(): DebuggerLifecyclePausedEvent {
	return lastPausedEvent;
}

subscribeDebuggerLifecycleEvents((event: DebuggerLifecycleEvent) => {
	if (event.type === 'paused' || event.type === 'exception_frame_focus') {
		showDebuggerPauseOverlay(event.payload, event.type === 'paused' ? event.metrics : null);
		return;
	}
	if (event.type === 'continued') {
		clearDebuggerPauseOverlay();
	}
});
