import { centerCursorVertically, ensureCursorVisible, setCursorPosition } from '../editor/ui/view/caret/caret';
import { beginNavigationCapture, completeNavigation } from '../navigation/navigation_history';
import type { CodeEditorInput } from '../workbench/contrib/code_editor/editor_input';
import { getActiveCodeTabContext } from '../workbench/ui/code_tab/contexts';
import { showEditorMessage } from '../common/feedback_state';
import type { RuntimeErrorOverlay } from '../editor/contrib/runtime_error/model';
import type { CodeTabContext } from '../workbench/ui/code_tab/model';
import { resetBlink } from '../editor/render/caret';
import { rebuildRuntimeErrorOverlayView } from '../editor/contrib/runtime_error/overlay';
import { editorPointerState } from '../input/pointer/state';
import { editorCaretState } from '../editor/ui/view/caret/state';
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
import { extractErrorMessage } from '../common/errors';
import { clamp } from '../../machine/ts/common/clamp';
import type { CartEditor } from '../cart_editor';
import type { EditorGroupView } from '../workbench/services/editor/editor_group';
import type { ResourceIdentity } from '../common/resource';
import { resetPointerClickTracking } from '../input/pointer/state';

type RuntimeErrorOverlayTarget = { input: CodeEditorInput; overlay: RuntimeErrorOverlay };

function resolveRuntimeErrorOverlayTarget(group: EditorGroupView): RuntimeErrorOverlayTarget | null {
	const active = group.model.activeTab;
	if (active?.kind === 'code_editor' && active.context.runtimeErrorOverlay !== null) {
		return { input: active, overlay: active.context.runtimeErrorOverlay };
	}
	for (const input of group.model.tabs) {
		if (input.kind === 'code_editor' && input.context.runtimeErrorOverlay !== null) {
			return { input, overlay: input.context.runtimeErrorOverlay };
		}
	}
	return null;
}

export function focusRuntimeErrorOverlay(group: EditorGroupView): boolean {
	const target = resolveRuntimeErrorOverlayTarget(group);
	if (!target) {
		return false;
	}
	if (group.model.activeTab !== target.input) group.activate(target.input.id);
	else syncRuntimeErrorOverlayFromContext(target.input.context);
	const overlay = target.overlay;
	const navigationCheckpoint = beginNavigationCapture();
	overlay.hidden = false;
	overlay.hovered = false;
	overlay.hoverLine = -1;
	overlay.copyButtonHovered = false;
	overlay.layout = null;
	setActiveRuntimeErrorOverlay(overlay);
	setExecutionStopHighlightForCurrentContext(group, overlay.row);
	activeCodeEditor.view.selectionAnchor = null;
	editorPointerState.pointerSelecting = false;
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

export function rewrapRuntimeErrorOverlays(group: EditorGroupView): void {
	for (const input of group.model.tabs) {
		if (input.kind !== 'code_editor') continue;
		const overlay = input.context.runtimeErrorOverlay;
		if (overlay) {
			rewrapRuntimeErrorOverlay(overlay);
		}
	}
}

export function clearAllRuntimeErrorOverlays(group: EditorGroupView): void {
	for (const input of group.model.tabs) {
		if (input.kind !== 'code_editor') continue;
		if (input.context.view === activeCodeEditor.view) setActiveRuntimeErrorOverlay(null);
		input.context.runtimeErrorOverlay = null;
	}
	clearExecutionStopHighlights(group);
}

export function setActiveRuntimeErrorOverlayForCurrentContext(group: EditorGroupView, overlay: RuntimeErrorOverlay): void {
	const context = getActiveCodeTabContext(group);
	if (context) {
		context.runtimeErrorOverlay = overlay;
		if (context.view === activeCodeEditor.view) setActiveRuntimeErrorOverlay(overlay);
	}
}

export function setExecutionStopHighlightForCurrentContext(group: EditorGroupView, row: number): void {
	const context = getActiveCodeTabContext(group);
	if (context) {
		context.executionStopRow = clamp(row, 0, context.model.buffer.getLineCount() - 1);
		if (context.view === activeCodeEditor.view) setEditorExecutionStopHighlight(context.executionStopRow);
	}
}

export function clearExecutionStopHighlights(group: EditorGroupView): void {
	for (const input of group.model.tabs) {
		if (input.kind !== 'code_editor') continue;
		if (input.context.view === activeCodeEditor.view) clearExecutionStopHighlight();
		input.context.executionStopRow = null;
	}
}

export async function focusExecutionStop(
	editor: CartEditor,
	resource: ResourceIdentity,
	line: number,
	column: number,
): Promise<number | undefined> {
	const row = line - 1;
	const generation = await editor.navigation.focusChunkSource(resource, { row, startColumn: column - 1, endColumn: column - 1 });
	if (generation !== editor.editorGroup.panes.openGeneration) return undefined;
	setExecutionStopHighlightForCurrentContext(editor.editorGroup, row);
	centerCursorVertically();
	return generation;
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
		showEditorMessage(error.message, 'error', 4.0);
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

export async function navigateToRuntimeErrorFrameTarget(
	editor: CartEditor,
	frame: SourceStackTraceFrame,
): Promise<void> {
	try {
		const generation = await editor.navigation.focusChunkSource(frame.resource);
		if (generation !== editor.editorGroup.panes.openGeneration) return;
	} catch (error) {
		showEditorMessage(
			`Failed to open runtime path: ${extractErrorMessage(error)}`,
			'error',
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
