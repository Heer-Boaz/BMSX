import { centerCursorVertically, setCursorPosition } from '../../ui/caret';
import { beginNavigationCapture, completeNavigation } from '../../navigation/navigation_history';
import { activateCodeTab, getActiveCodeTabContext, setActiveTab } from '../../../workbench/ui/tabs';
import { showEditorMessage } from '../../../workbench/common/feedback_state';
import type { CodeTabContext, RuntimeErrorOverlay } from '../../../common/types';
import { resetBlink } from '../../render/render_caret';
import { showRuntimeErrorInChunk } from '../../render/render_error_overlay';
import * as constants from '../../../common/constants';
import { editorPointerState } from '../../input/pointer/editor_pointer_state';
import { editorCaretState } from '../../ui/caret_state';
import { runtimeErrorState } from './runtime_error_state';
import { editorDocumentState } from '../../editing/editor_document_state';
import { editorSessionState } from '../../ui/editor_session_state';
import { editorViewState } from '../../ui/editor_view_state';

type RuntimeErrorOverlayTarget = { context: CodeTabContext; overlay: RuntimeErrorOverlay };

function resolveRuntimeErrorOverlayTarget(): RuntimeErrorOverlayTarget {
	const activeContext = getActiveCodeTabContext();
	if (activeContext && activeContext.runtimeErrorOverlay) {
		return { context: activeContext, overlay: activeContext.runtimeErrorOverlay };
	}
	for (const context of editorSessionState.codeTabContexts.values()) {
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
	if (editorSessionState.activeTabId !== target.id) {
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
	editorDocumentState.selectionAnchor = null;
	editorPointerState.pointerSelecting = false;
	editorPointerState.pointerPrimaryWasPressed = false;
	editorCaretState.cursorRevealSuspended = false;
	editorViewState.scrollbarController.cancel();
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
	runtimeErrorState.activeOverlay = null;
	for (const context of editorSessionState.codeTabContexts.values()) {
		context.runtimeErrorOverlay = null;
	}
	clearExecutionStopHighlights();
}

export function setActiveRuntimeErrorOverlay(overlay: RuntimeErrorOverlay): void {
	if (overlay && overlay.hidden === undefined) {
		overlay.hidden = false;
	}
	runtimeErrorState.activeOverlay = overlay;
	const context = getActiveCodeTabContext();
	if (context) {
		context.runtimeErrorOverlay = overlay;
	}
}

export function setExecutionStopHighlight(row: number): void {
	const context = getActiveCodeTabContext();
	if (!context) {
		runtimeErrorState.executionStopRow = null;
		return;
	}
	let nextRow = row;
	if (nextRow !== null) {
		nextRow = editorViewState.layout.clampBufferRow(editorDocumentState.buffer, nextRow);
	}
	context.executionStopRow = nextRow;
	runtimeErrorState.executionStopRow = nextRow;
}

export function clearExecutionStopHighlights(): void {
	runtimeErrorState.executionStopRow = null;
	for (const context of editorSessionState.codeTabContexts.values()) {
		context.executionStopRow = null;
	}
}

export function syncRuntimeErrorOverlayFromContext(context: CodeTabContext): void {
	runtimeErrorState.activeOverlay = context ? context.runtimeErrorOverlay : null;
	runtimeErrorState.executionStopRow = context ? context.executionStopRow : null;
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
			showEditorMessage(messageText, constants.COLOR_STATUS_ERROR, 4.0);
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
