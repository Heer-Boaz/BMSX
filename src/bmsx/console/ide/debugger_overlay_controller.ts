import { focusChunkSource, normalizeChunkName, setExecutionStopHighlight, clearExecutionStopHighlights, updateDesiredColumn, ensureCursorVisible, resetBlink, clearRuntimeErrorOverlay } from './console_cart_editor';
import { ide_state } from './ide_state';
import * as constants from './constants';
import { clamp } from '../../utils/clamp';
import { subscribeDebuggerLifecycleEvents, type DebuggerPauseDisplayPayload, type DebuggerLifecycleEvent } from '../debugger_lifecycle';
import type { LuaDebuggerSessionMetrics } from '../../lua/debugger';

const MESSAGE_BY_REASON: Record<DebuggerPauseDisplayPayload['reason'], string> = {
	breakpoint: 'Paused on breakpoint',
	step: 'Debugger paused',
	exception: 'Paused on exception',
};

export function showDebuggerPauseOverlay(payload: DebuggerPauseDisplayPayload, metrics: LuaDebuggerSessionMetrics | null): void {
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

function formatDebuggerMetrics(metrics: LuaDebuggerSessionMetrics | null): string | null {
	if (!metrics) {
		return null;
	}
	const parts: string[] = [`Session ${metrics.sessionId}`, `${metrics.pauseCount} stop${metrics.pauseCount === 1 ? '' : 's'}`];
	if (metrics.exceptionCount > 0) {
		parts.push(`${metrics.exceptionCount} exception${metrics.exceptionCount === 1 ? '' : 's'}`);
	}
	if (metrics.skippedExceptionCount > 0) {
		parts.push(`${metrics.skippedExceptionCount} skipped`);
	}
	return parts.join(' · ');
}

subscribeDebuggerLifecycleEvents((event: DebuggerLifecycleEvent) => {
	if (event.type === 'paused' || event.type === 'exception_frame_focus') {
		showDebuggerPauseOverlay(event.payload, event.type === 'paused' ? event.metrics ?? null : null);
		return;
	}
	if (event.type === 'continued') {
		clearDebuggerPauseOverlay();
	}
});
