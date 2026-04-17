import { Runtime } from '../../../../machine/runtime/runtime';
import * as workbenchMode from '../../../runtime/workbench_mode';
import { type LuaDebuggerSessionMetrics } from '../../../../lua/debugger';
import { editorRuntimeState } from '../../../editor/common/runtime_state';
import { editorDebuggerState } from './state';
import { showEditorMessage } from '../../common/feedback_state';
import { focusChunkSource } from '../resources/navigation';
import { getActiveCodeTabContext } from '../../ui/code_tab/contexts';
import { clamp, clamp_fallback } from '../../../../common/clamp';
import { centerCursorVertically, ensureCursorVisible, setCursorPosition, updateDesiredColumn } from '../../../editor/ui/caret';
import { resetPointerClickTracking, editorPointerState } from '../../../editor/input/pointer/state';
import { resetBlink } from '../../../editor/render/caret';
import type { LuaCallFrame } from '../../../../lua/runtime';
import { extractErrorMessage, type LuaDebuggerPauseSignal, type StackTraceFrame } from '../../../../lua/value';
import * as constants from '../../../common/constants';
import { findFunctionDefinitionRowInActiveFile } from '../../../editor/contrib/intellisense/engine';
import { clearExecutionStopHighlights, setExecutionStopHighlight, clearRuntimeErrorOverlay } from '../../../editor/contrib/runtime_error/navigation';
import { editorCaretState } from '../../../editor/ui/caret_state';
import { editorDocumentState } from '../../../editor/editing/document_state';

type DebuggerResumeCommand = 'continue' | 'step_over' | 'step_into' | 'step_out' | 'ignore_exception' | 'step_out_exception';

const DEBUGGER_LOG_PREFIX = '[Debugger]';

export class RuntimeDebuggerCommandExecutor {
	private static _instance: RuntimeDebuggerCommandExecutor = null;

	public static get instance(): RuntimeDebuggerCommandExecutor {
		if (!RuntimeDebuggerCommandExecutor._instance) {
			RuntimeDebuggerCommandExecutor._instance = new RuntimeDebuggerCommandExecutor();
		}
		return RuntimeDebuggerCommandExecutor._instance;
	}

	public dispose(): void {
		if (RuntimeDebuggerCommandExecutor._instance === this) {
			RuntimeDebuggerCommandExecutor._instance = null;
		}
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
		const runtime = Runtime.instance;
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

	private dispatchCommand(runtime: Runtime, command: DebuggerResumeCommand): boolean {
		try {
			switch (command) {
				case 'continue':
					workbenchMode.continueLuaDebugger(runtime);
					return true;
				case 'step_over':
					workbenchMode.stepOverLuaDebugger(runtime);
					return true;
				case 'step_into':
					workbenchMode.stepIntoLuaDebugger(runtime);
					return true;
				case 'step_out':
					workbenchMode.stepOutLuaDebugger(runtime);
					return true;
				case 'ignore_exception':
					workbenchMode.ignoreLuaException(runtime);
					return true;
				case 'step_out_exception':
					workbenchMode.stepOutLuaDebugger(runtime);
					workbenchMode.ignoreLuaException(runtime);
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
		editorDebuggerState.controls.sessionMetrics = null;
		return;
	}
	if (event.type === 'paused') {
		editorDebuggerState.controls.sessionMetrics = event.metrics;
		updateExecutionState('paused');
		return;
	}
	updateExecutionState('paused');
}
function updateExecutionState(state: DebuggerExecutionState): void {
	if (editorDebuggerState.controls.executionState === state) {
		return;
	}
	editorDebuggerState.controls.executionState = state;
}
export type SerializedBreakpointMap = Record<string, number[]>;

export type BreakpointToggleResult = 'added' | 'removed' | 'unchanged';
function ensureBucket(pathKey: string): Set<number> {
	let bucket = editorDebuggerState.breakpoints.get(pathKey);
	if (!bucket) {
		bucket = new Set<number>();
		editorDebuggerState.breakpoints.set(pathKey, bucket);
	}
	return bucket;
}

export function getBreakpointsForChunk(path: string): ReadonlySet<number> {
	if (!path) {
		return null;
	}
	const bucket = editorDebuggerState.breakpoints.get(path);
	return bucket;
}

export function toggleBreakpoint(path: string, line: number): BreakpointToggleResult {
	if (line === null) {
		return 'unchanged';
	}
	const pathKey = path;
	const bucket = ensureBucket(pathKey);
	if (bucket.has(line)) {
		bucket.delete(line);
		if (bucket.size === 0) {
			editorDebuggerState.breakpoints.delete(pathKey);
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
	for (const [path, lines] of editorDebuggerState.breakpoints) {
		if (lines.size === 0) {
			continue;
		}
		const sorted = new Array<number>(lines.size);
		let index = 0;
		for (const line of lines) {
			sorted[index] = line;
			index += 1;
		}
		sorted.sort((a, b) => a - b);
		payload[path] = sorted;
	}
	return payload;
}

export function restoreBreakpointsFromPayload(payload: SerializedBreakpointMap | null): void {
	editorDebuggerState.breakpoints.clear();
	if (payload === null) {
		syncRuntimeBreakpoints();
		return;
	}
	for (const path in payload) {
		const lineEntries = payload[path];
		if (lineEntries.length === 0) {
			continue;
		}
		editorDebuggerState.breakpoints.set(path, new Set(lineEntries));
	}
	syncRuntimeBreakpoints();
}

export function syncRuntimeBreakpoints(): void {
	workbenchMode.setDebuggerBreakpoints(Runtime.instance, editorDebuggerState.breakpoints);
}

export function getActiveBreakpointPath(): string {
	const context = getActiveCodeTabContext();
	return context.descriptor.path;
}

export function toggleBreakpointForEditorRow(row: number = editorDocumentState.cursorRow): boolean {
	if (row < 0 || row >= editorDocumentState.buffer.getLineCount()) {
		return false;
	}
	const path = getActiveBreakpointPath();
	if (!path) {
		showEditorMessage('No active path available for breakpoints.', constants.COLOR_STATUS_WARNING, 1.6);
		return false;
	}
	const lineNumber = row + 1;
	const result = toggleBreakpoint(path, lineNumber);
	if (result === 'unchanged') {
		return false;
	}
	const verb = result === 'added' ? 'set' : 'cleared';
	showEditorMessage(`Breakpoint ${verb} at ${path}:${lineNumber}`, constants.COLOR_STATUS_TEXT, 1.4);
	return true;
}
const MESSAGE_BY_REASON: Record<DebuggerPauseDisplayPayload['reason'], string> = {
	breakpoint: 'Paused on breakpoint',
	step: 'Debugger paused',
	exception: 'Paused on exception',
};

export function showDebuggerPauseOverlay(payload: DebuggerPauseDisplayPayload, metrics: LuaDebuggerSessionMetrics): void {
	if (!editorRuntimeState.active) {
		return;
	}
	const normalizedChunk = payload.path;
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
	showEditorMessage(message, constants.COLOR_STATUS_WARNING, 3.0);
}

export function clearDebuggerPauseOverlay(): void {
	clearExecutionStopHighlights();
	resetBlink();
}

export function prepareDebuggerStepOverlay(): void {
	if (!editorRuntimeState.active) {
		return;
	}
	clearRuntimeErrorOverlay();
	showEditorMessage('Debugger stepping…', constants.COLOR_STATUS_WARNING, 2.0);
}

function updateDebuggerCaret(row: number, column: number): void {
	const maxRow = Math.max(0, editorDocumentState.buffer.getLineCount() - 1);
	const clampedRow = clamp(row, 0, maxRow);
	const lineText = editorDocumentState.buffer.getLineContent(clampedRow);
	const clampedColumn = clamp(column, 0, lineText.length);
	editorDocumentState.cursorRow = clampedRow;
	editorDocumentState.cursorColumn = clampedColumn;
	editorDocumentState.selectionAnchor = null;
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
		showEditorMessage('Runtime frame is missing a path reference.', constants.COLOR_STATUS_ERROR, 1.6);
		return;
	}
	const normalizedChunk = source;
	try {
		focusChunkSource(normalizedChunk);
	} catch (error) {
		const message = extractErrorMessage(error);
		showEditorMessage(`Failed to open runtime path: ${message}`, constants.COLOR_STATUS_ERROR, 1.6);
		return;
	}
	const activeContext = getActiveCodeTabContext();
	if (!activeContext) {
		showEditorMessage('Unable to activate editor context for runtime frame.', constants.COLOR_STATUS_ERROR, 1.6);
		return;
	}
	const lastRowIndex = Math.max(0, editorDocumentState.buffer.getLineCount() - 1);
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
	const targetLine = editorDocumentState.buffer.getLineContent(targetRow);
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
	editorDocumentState.selectionAnchor = null;
	editorPointerState.pointerSelecting = false;
	resetPointerClickTracking();
	setCursorPosition(targetRow, targetColumn);
	editorCaretState.cursorRevealSuspended = false;
	centerCursorVertically();
	ensureCursorVisible();
}

export type DebuggerPauseDisplayPayload = {
	path: string;
	line: number;
	column: number;
	reason: LuaDebuggerPauseSignal['reason'];
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
