import { focusChunkSource, normalizeChunkName, setExecutionStopHighlight, clearExecutionStopHighlights, updateDesiredColumn, ensureCursorVisible, resetBlink, clearRuntimeErrorOverlay } from './console_cart_editor';
import { ide_state } from './ide_state';
import * as constants from './constants';
import { clamp } from '../../utils/utils.ts';
import { subscribeDebuggerLifecycleEvents, type DebuggerPauseDisplayPayload, type DebuggerLifecycleEvent } from '../debugger_lifecycle';

const MESSAGE_BY_REASON: Record<DebuggerPauseDisplayPayload['reason'], string> = {
	breakpoint: 'Paused on breakpoint',
	step: 'Debugger paused',
	exception: 'Paused on exception',
};

export function showDebuggerPauseOverlay(payload: DebuggerPauseDisplayPayload): void {
	if (!ide_state.active) {
		return;
	}
	const normalizedChunk = normalizeChunkName(payload.chunk);
	if (!normalizedChunk) {
		clearExecutionStopHighlights();
		return;
	}
	focusChunkSource(normalizedChunk, payload.hint ?? undefined);
	const safeLine = normalizeIndex(payload.line);
	const safeColumn = normalizeIndex(payload.column);
	updateDebuggerCaret(safeLine, safeColumn);
	setExecutionStopHighlight(safeLine);
	const message = MESSAGE_BY_REASON[payload.reason] ?? 'Debugger paused';
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

function normalizeIndex(value: number): number {
	if (!Number.isFinite(value)) {
		return 0;
	}
	return Math.max(0, Math.floor(value - 1));
}

function updateDebuggerCaret(row: number, column: number): void {
	const maxRow = Math.max(0, ide_state.lines.length - 1);
	const clampedRow = clamp(row, 0, maxRow);
	const lineText = ide_state.lines[clampedRow] ?? '';
	const clampedColumn = clamp(column, 0, lineText.length);
	ide_state.cursorRow = clampedRow;
	ide_state.cursorColumn = clampedColumn;
	ide_state.selectionAnchor = null;
	updateDesiredColumn();
	ensureCursorVisible();
	resetBlink();
}

subscribeDebuggerLifecycleEvents((event: DebuggerLifecycleEvent) => {
	if (event.type === 'paused' || event.type === 'exception_frame_focus') {
		showDebuggerPauseOverlay(event.payload);
		return;
	}
	if (event.type === 'continued') {
		clearDebuggerPauseOverlay();
	}
});
