import { centerCursorVertically, setCursorPosition } from '../../ui/view/caret/caret';
import { beginNavigationCapture, completeNavigation } from '../../navigation/navigation_history';
import { activateCodeTab, isTabActive, setActiveTab } from '../../../workbench/ui/tabs';
import { getActiveCodeTabContext, getCodeTabContexts } from '../../../workbench/ui/code_tab/contexts';
import { showEditorMessage } from '../../../workbench/common/feedback_state';
import type { CodeTabContext, RuntimeErrorOverlay } from '../../../common/models';
import { resetBlink } from '../../render/caret';
import { showRuntimeErrorInChunk } from '../../render/error_overlay';
import { rebuildRuntimeErrorOverlayView } from './overlay';
import * as constants from '../../../common/constants';
import { editorPointerState } from '../../input/pointer/state';
import { editorCaretState } from '../../ui/view/caret/state';
import { runtimeErrorState } from './state';
import { editorDocumentState } from '../../editing/document_state';
import { editorViewState } from '../../ui/view/state';
import { splitText } from '../../text/source_text';

type RuntimeErrorOverlayTarget = { context: CodeTabContext; overlay: RuntimeErrorOverlay };

function resolveRuntimeErrorOverlayTarget(): RuntimeErrorOverlayTarget {
	const activeContext = getActiveCodeTabContext();
	if (activeContext && activeContext.runtimeErrorOverlay) {
		return { context: activeContext, overlay: activeContext.runtimeErrorOverlay };
	}
	for (const context of getCodeTabContexts()) {
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
	if (!isTabActive(target.id)) {
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

function rewrapRuntimeErrorOverlay(overlay: RuntimeErrorOverlay): void {
	overlay.messageLines = splitText(overlay.message);
	rebuildRuntimeErrorOverlayView(overlay);
}

export function rewrapRuntimeErrorOverlays(): void {
	const visited = new Set<RuntimeErrorOverlay>();
	const activeOverlay = runtimeErrorState.activeOverlay;
	if (activeOverlay) {
		visited.add(activeOverlay);
		rewrapRuntimeErrorOverlay(activeOverlay);
	}
	for (const context of getCodeTabContexts()) {
		const overlay = context.runtimeErrorOverlay;
		if (overlay && !visited.has(overlay)) {
			visited.add(overlay);
			rewrapRuntimeErrorOverlay(overlay);
		}
	}
}

export function clearAllRuntimeErrorOverlays(): void {
	runtimeErrorState.activeOverlay = null;
	for (const context of getCodeTabContexts()) {
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
	for (const context of getCodeTabContexts()) {
		context.executionStopRow = null;
	}
}

export function syncRuntimeErrorOverlayFromContext(context: CodeTabContext): void {
	if (context) {
		runtimeErrorState.activeOverlay = context.runtimeErrorOverlay;
		runtimeErrorState.executionStopRow = context.executionStopRow;
		return;
	}
	runtimeErrorState.activeOverlay = null;
	runtimeErrorState.executionStopRow = null;
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
