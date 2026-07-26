import { centerCursorVertically, ensureCursorVisible, setCursorPosition } from '../editor/ui/view/caret/caret';
import { beginNavigationCapture, completeNavigation } from '../navigation/navigation_history';
import { activateCodeTab, isTabActive, setActiveTab } from '../workbench/ui/tabs';
import { getActiveCodeTabContext, getCodeTabContexts } from '../workbench/ui/code_tab/contexts';
import { showEditorMessage } from '../common/feedback_state';
import type { CodeTabContext, RuntimeErrorOverlay } from '../common/models';
import { resetBlink } from '../editor/render/caret';
import { rebuildRuntimeErrorOverlayView } from '../editor/contrib/runtime_error/overlay';
import * as constants from '../common/constants';
import { editorPointerState } from '../input/pointer/state';
import { editorCaretState } from '../editor/ui/view/caret/state';
import { runtimeErrorState } from '../editor/contrib/runtime_error/state';
import { editorDocumentState } from '../editor/editing/document_state';
import { editorViewState } from '../editor/ui/view/state';
import { splitText } from '../../machine/ts/common/text_lines';
import {
	clearExecutionStopHighlight,
	clearRuntimeErrorOverlay,
	setActiveRuntimeErrorOverlay,
	setExecutionStopHighlight as setEditorExecutionStopHighlight,
} from '../editor/contrib/runtime_error/navigation';
import { LuaError } from '../../machine/ts/lua/errors';
import type { StackTraceFrame } from '../language/lua/interpreter/value';
import { extractErrorMessage } from '../language/lua/interpreter/value';
import { clamp } from '../../machine/ts/common/clamp';
import type { CartEditor } from '../cart_editor';
import type { Runtime } from '../../machine/ts/machine/runtime/runtime';
import type { RuntimeSourceState } from '../runtime/sources';
import type { ResourcePanelController } from '../workbench/contrib/resources/panel/controller';
import { focusChunkSourceForContext } from '../workbench/contrib/resources/navigation';
import { findFunctionDefinitionRowInActiveFile } from '../editor/contrib/intellisense/engine';
import { resetPointerClickTracking } from '../input/pointer/state';

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

function ensureActiveContext(resourcePanel: ResourcePanelController, target: CodeTabContext): void {
	if (!target) {
		return;
	}
	if (!isTabActive(target.id)) {
		setActiveTab(resourcePanel, target.id);
		return;
	}
	syncRuntimeErrorOverlayFromContext(target);
}

export function focusRuntimeErrorOverlay(resourcePanel: ResourcePanelController): boolean {
	const target = resolveRuntimeErrorOverlayTarget();
	if (!target) {
		return false;
	}
	ensureActiveContext(resourcePanel, target.context);
	if (!getActiveCodeTabContext()) {
		activateCodeTab(resourcePanel);
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
	setExecutionStopHighlightForCurrentContext(overlay.row);
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
	setActiveRuntimeErrorOverlay(null);
	for (const context of getCodeTabContexts()) {
		context.runtimeErrorOverlay = null;
	}
	clearExecutionStopHighlights();
}

export function setActiveRuntimeErrorOverlayForCurrentContext(overlay: RuntimeErrorOverlay): void {
	setActiveRuntimeErrorOverlay(overlay);
	const context = getActiveCodeTabContext();
	if (context) {
		context.runtimeErrorOverlay = overlay;
	}
}

export function setExecutionStopHighlightForCurrentContext(row: number): void {
	setEditorExecutionStopHighlight(row);
	const context = getActiveCodeTabContext();
	if (context) {
		context.executionStopRow = runtimeErrorState.executionStopRow;
	}
}

export function clearExecutionStopHighlights(): void {
	clearExecutionStopHighlight();
	for (const context of getCodeTabContexts()) {
		context.executionStopRow = null;
	}
}

export function syncRuntimeErrorOverlayFromContext(context: CodeTabContext): void {
	if (context) {
		setActiveRuntimeErrorOverlay(context.runtimeErrorOverlay);
		setEditorExecutionStopHighlight(context.executionStopRow);
		return;
	}
	setActiveRuntimeErrorOverlay(null);
	clearExecutionStopHighlight();
}

export function showLuaErrorOverlay(editor: CartEditor, error: unknown): boolean {
	if (!(error instanceof LuaError)) {
		return false;
	}
	if (error.line <= 0 && error.column <= 0) {
		showEditorMessage(error.message, constants.COLOR_STATUS_ERROR, 4.0);
		return true;
	}
	editor.showRuntimeErrorInChunk(error.path, error.line, error.column, error.message);
	return true;
}

export function navigateToRuntimeErrorFrameTarget(
	editor: CartEditor,
	sources: RuntimeSourceState,
	runtime: Runtime,
	frame: StackTraceFrame,
): void {
	if (frame.origin !== 'lua') {
		return;
	}
	try {
		focusChunkSourceForContext(editor, sources, runtime.machine.cpu.activeCartridgeSlot(), frame.source);
	} catch (error) {
		showEditorMessage(
			`Failed to open runtime path: ${extractErrorMessage(error)}`,
			constants.COLOR_STATUS_ERROR,
			1.6,
		);
		return;
	}
	const lastRowIndex = editorDocumentState.buffer.getLineCount() - 1;
	let targetRow = frame.line > 0 ? clamp(frame.line - 1, 0, lastRowIndex) : -1;
	if (targetRow < 0 && frame.functionName) {
		targetRow = findFunctionDefinitionRowInActiveFile(frame.functionName);
	}
	if (targetRow < 0) {
		targetRow = 0;
	}
	const targetLine = editorDocumentState.buffer.getLineContent(targetRow);
	let targetColumn = frame.column > 0 ? clamp(frame.column - 1, 0, targetLine.length) : 0;
	if (targetColumn === 0 && frame.functionName) {
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

export { clearRuntimeErrorOverlay };
