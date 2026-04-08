import { centerCursorVertically, setCursorPosition } from '../../caret';
import { beginNavigationCapture, completeNavigation } from '../../navigation_history';
import { activateCodeTab, getActiveCodeTabContext, setActiveTab } from '../../editor_tabs';
import { ide_state } from '../../ide_state';
import type { CodeTabContext, RuntimeErrorOverlay } from '../../types';
import { resetBlink } from '../../render/render_caret';
import { showRuntimeErrorInChunk } from '../../render/render_error_overlay';
import * as constants from '../../constants';

type RuntimeErrorOverlayTarget = { context: CodeTabContext; overlay: RuntimeErrorOverlay };

function resolveRuntimeErrorOverlayTarget(): RuntimeErrorOverlayTarget {
	const activeContext = getActiveCodeTabContext();
	if (activeContext && activeContext.runtimeErrorOverlay) {
		return { context: activeContext, overlay: activeContext.runtimeErrorOverlay };
	}
	for (const context of ide_state.codeTabContexts.values()) {
		if (context.runtimeErrorOverlay) {
			return { context, overlay: context.runtimeErrorOverlay };
		}
	}
	return null;
}

function ensureActiveContext(target: CodeTabContext): void {
	if (!target) {
		return;
	}
	if (ide_state.activeTabId !== target.id) {
		setActiveTab(target.id);
		return;
	}
	syncRuntimeErrorOverlayFromContext(target);
}

export function focusRuntimeErrorOverlay(): boolean {
	const target = resolveRuntimeErrorOverlayTarget();
	if (!target) {
		return false;
	}
	ensureActiveContext(target.context);
	if (!getActiveCodeTabContext()) {
		activateCodeTab();
	}
	const overlay = target.context.runtimeErrorOverlay;
	if (!overlay) {
		return false;
	}
	const navigationCheckpoint = beginNavigationCapture();
	overlay.hidden = false;
	overlay.hovered = false;
	overlay.hoverLine = -1;
	overlay.copyButtonHovered = false;
	overlay.layout = null;
	setActiveRuntimeErrorOverlay(overlay);
	setExecutionStopHighlight(overlay.row);
	ide_state.selectionAnchor = null;
	ide_state.pointerSelecting = false;
	ide_state.pointerPrimaryWasPressed = false;
	ide_state.cursorRevealSuspended = false;
	ide_state.scrollbarController.cancel();
	setCursorPosition(overlay.row, overlay.column);
	centerCursorVertically();
	resetBlink();
	completeNavigation(navigationCheckpoint);
	return true;
}

export function clearRuntimeErrorOverlay(): void {
	setActiveRuntimeErrorOverlay(null);
}

export function clearAllRuntimeErrorOverlays(): void {
	ide_state.runtimeErrorOverlay = null;
	for (const context of ide_state.codeTabContexts.values()) {
		context.runtimeErrorOverlay = null;
	}
	clearExecutionStopHighlights();
}

export function setActiveRuntimeErrorOverlay(overlay: RuntimeErrorOverlay): void {
	if (overlay && overlay.hidden === undefined) {
		overlay.hidden = false;
	}
	ide_state.runtimeErrorOverlay = overlay;
	const context = getActiveCodeTabContext();
	if (context) {
		context.runtimeErrorOverlay = overlay;
	}
}

export function setExecutionStopHighlight(row: number): void {
	const context = getActiveCodeTabContext();
	if (!context) {
		ide_state.executionStopRow = null;
		return;
	}
	let nextRow = row;
	if (nextRow !== null) {
		nextRow = ide_state.layout.clampBufferRow(ide_state.buffer, nextRow);
	}
	context.executionStopRow = nextRow;
	ide_state.executionStopRow = nextRow;
}

export function clearExecutionStopHighlights(): void {
	ide_state.executionStopRow = null;
	for (const context of ide_state.codeTabContexts.values()) {
		context.executionStopRow = null;
	}
}

export function syncRuntimeErrorOverlayFromContext(context: CodeTabContext): void {
	ide_state.runtimeErrorOverlay = context ? context.runtimeErrorOverlay : null;
	ide_state.executionStopRow = context ? context.executionStopRow : null;
}

export function tryShowLuaErrorOverlay(error: unknown): boolean {
	let candidate: { line?: unknown; column?: unknown; path?: unknown; message?: unknown };
	if (typeof error === 'string') {
		candidate = { message: error };
	} else if (error && typeof error === 'object') {
		candidate = error as { line?: unknown; column?: unknown; path?: unknown; message?: unknown };
	} else {
		throw new Error('[CartEditor] Lua error payload is neither an object nor a string.');
	}
	const rawLine = candidate.line as number;
	const rawColumn = candidate.column as number;
	const path = candidate.path as string;
	const messageText = candidate.message as string;
	const hasLine = rawLine !== null && rawLine > 0;
	const hasColumn = rawColumn !== null && rawColumn > 0;
	if (!hasLine && !hasColumn) {
		if (messageText) {
			ide_state.showMessage(messageText, constants.COLOR_STATUS_ERROR, 4.0);
			return true;
		}
		return false;
	}
	const safeLine = hasLine ? rawLine : 0;
	const safeColumn = hasColumn ? rawColumn : 0;
	const baseMessage = messageText ?? 'Unprintable error';
	showRuntimeErrorInChunk(path, safeLine, safeColumn, baseMessage);
	return true;
}
