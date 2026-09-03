import { centerCursorVertically, ensureCursorVisible, setCursorPosition } from '../editor/ui/view/caret/caret';
import { beginNavigationCapture, completeNavigation } from '../navigation/navigation_history';
import { isTabActive, setActiveTab } from '../workbench/ui/tabs';
import {
	getActiveCodeTabContext,
	getCodeTabContexts,
	upsertCodeEditorTab,
} from '../workbench/ui/code_tab/contexts';
import { showEditorMessage } from '../common/feedback_state';
import type { RuntimeErrorOverlay } from '../editor/contrib/runtime_error/model';
import type { CodeTabContext } from '../workbench/ui/code_tab/model';
import { resetBlink } from '../editor/render/caret';
import { rebuildRuntimeErrorOverlayView } from '../editor/contrib/runtime_error/overlay';
import * as constants from '../common/constants';
import { editorPointerState } from '../input/pointer/state';
import { editorCaretState } from '../editor/ui/view/caret/state';
import { runtimeErrorState } from '../editor/contrib/runtime_error/state';
import { activeCodeEditor } from '../editor/ui/code_editor_state';
import { editorViewState } from '../editor/ui/view/state';
import { splitText } from '../../machine/ts/common/text_lines';
import {
	clearExecutionStopHighlight,
	clearRuntimeErrorOverlay,
	setActiveRuntimeErrorOverlay,
	setExecutionStopHighlight as setEditorExecutionStopHighlight,
} from '../editor/contrib/runtime_error/navigation';
import { LuaError } from '../../toolchain/ts/lua/errors';
import type { SourceStackTraceFrame } from '../runtime/stack_trace';
import { extractErrorMessage } from '../language/lua/interpreter/value';
import { clamp } from '../../machine/ts/common/clamp';
import type { CartEditor } from '../cart_editor';
import type { EditorPanes } from '../workbench/services/editor/editor_panes';
import type { ResourceIdentity } from '../common/resource';
import { resetPointerClickTracking } from '../input/pointer/state';

type RuntimeErrorOverlayTarget = { context: CodeTabContext; overlay: RuntimeErrorOverlay };

function resolveRuntimeErrorOverlayTarget(): RuntimeErrorOverlayTarget | null {
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

function activateRuntimeErrorContext(editorPanes: EditorPanes, target: CodeTabContext): void {
	upsertCodeEditorTab(target);
	if (!isTabActive(target.id)) {
		setActiveTab(editorPanes, target.id);
		return;
	}
	syncRuntimeErrorOverlayFromContext(target);
}

export function focusRuntimeErrorOverlay(editorPanes: EditorPanes): boolean {
	const target = resolveRuntimeErrorOverlayTarget();
	if (!target) {
		return false;
	}
	activateRuntimeErrorContext(editorPanes, target.context);
	const overlay = target.overlay;
	const navigationCheckpoint = beginNavigationCapture();
	overlay.hidden = false;
	overlay.hovered = false;
	overlay.hoverLine = -1;
	overlay.copyButtonHovered = false;
	overlay.layout = null;
	setActiveRuntimeErrorOverlay(overlay);
	setExecutionStopHighlightForCurrentContext(overlay.row);
	activeCodeEditor.view.selectionAnchor = null;
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

export function focusExecutionStop(
	editor: CartEditor,
	resource: ResourceIdentity,
	line: number,
	column: number,
): void {
	const navigationCheckpoint = beginNavigationCapture();
	editor.navigation.focusChunkSource(resource);
	const row = line - 1;
	setExecutionStopHighlightForCurrentContext(row);
	activeCodeEditor.view.selectionAnchor = null;
	editorPointerState.pointerSelecting = false;
	editorPointerState.pointerPrimaryWasPressed = false;
	editorCaretState.cursorRevealSuspended = false;
	editorViewState.scrollbarController.cancel();
	setCursorPosition(row, column - 1);
	centerCursorVertically();
	resetBlink();
	completeNavigation(navigationCheckpoint);
}

export function syncRuntimeErrorOverlayFromContext(context: CodeTabContext): void {
	setActiveRuntimeErrorOverlay(context.runtimeErrorOverlay);
	setEditorExecutionStopHighlight(context.executionStopRow);
}

export function showLuaErrorOverlay(
	editor: CartEditor,
	resource: ResourceIdentity,
	error: unknown,
): boolean {
	if (!(error instanceof LuaError)) {
		return false;
	}
	if (error.line <= 0 && error.column <= 0) {
		showEditorMessage(error.message, constants.COLOR_STATUS_ERROR, 4.0);
		return true;
	}
	editor.showRuntimeErrorInChunk(
		{ domain: resource.domain, path: error.path },
		error.line,
		error.column,
		error.message,
	);
	return true;
}

export function navigateToRuntimeErrorFrameTarget(
	editor: CartEditor,
	frame: SourceStackTraceFrame,
): void {
	try {
		editor.navigation.focusChunkSource(frame.resource);
	} catch (error) {
		showEditorMessage(
			`Failed to open runtime path: ${extractErrorMessage(error)}`,
			constants.COLOR_STATUS_ERROR,
			1.6,
		);
		return;
	}
	const lastRowIndex = activeCodeEditor.model.buffer.getLineCount() - 1;
	const targetRow = clamp(frame.line - 1, 0, lastRowIndex);
	const targetLine = activeCodeEditor.model.buffer.getLineContent(targetRow);
	const targetColumn = clamp(frame.column - 1, 0, targetLine.length);
	activeCodeEditor.view.selectionAnchor = null;
	editorPointerState.pointerSelecting = false;
	resetPointerClickTracking();
	setCursorPosition(targetRow, targetColumn);
	editorCaretState.cursorRevealSuspended = false;
	centerCursorVertically();
	ensureCursorVisible();
}

export { clearRuntimeErrorOverlay };
