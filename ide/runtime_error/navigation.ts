import { centerCursorVertically, ensureCursorVisible, setCursorPosition } from '../editor/ui/view/caret/caret';
import { beginNavigationCapture, completeNavigation } from '../navigation/navigation_history';
import type { CodeEditorInput } from '../workbench/contrib/code_editor/editor_input';
import { CodeEditorPane } from '../workbench/contrib/code_editor/editor_pane';
import { getActiveCodeTabContext } from '../workbench/ui/code_tab/contexts';
import { showEditorMessage } from '../common/feedback_state';
import type { RuntimeErrorOverlay } from '../editor/contrib/runtime_error/model';
import { resetBlinkState } from '../editor/ui/view/caret/blink';
import { clearExecutionStopHighlight, clearRuntimeErrorOverlay, setActiveRuntimeErrorOverlay,
	setExecutionStopHighlight } from '../editor/contrib/runtime_error/navigation';
import { LuaError } from '../../toolchain/ts/lua/errors';
import { editorTextModelService } from '../editor/model/model_service';
import { getTextSnapshot } from '../editor/text/source_text';
import { readBlua32CompiledSource, type Blua32CompiledSource } from '../../toolchain/ts/rompack/blua32_sources';
import { resolveLuaTextFileModel } from '../workbench/services/working_copy/text_file_model';
import type { WorkspaceSourceCatalog } from '../workspace/source_catalog';
import type { EditorNavigationController } from '../workbench/contrib/resources/navigation';
import type { EditorTextModel } from '../editor/model/text_model';
import type { SourceStackTraceFrame } from '../runtime/stack_trace';
import { extractErrorMessage } from '../common/errors';
import type { CartEditor } from '../cart_editor';
import type { EditorGroupView } from '../workbench/services/editor/editor_group';
import type { ResourceIdentity } from '../common/resource';
import { clearEditorPointerSelectionState } from '../input/pointer/state';

type RuntimeErrorOverlayTarget = { input: CodeEditorInput; overlay: RuntimeErrorOverlay };

function resolveRuntimeErrorOverlayTarget(group: EditorGroupView): RuntimeErrorOverlayTarget | null {
	const active = group.model.activeTab;
	if (active?.kind === 'code_editor' && active.context.runtimeErrorOverlay !== null) return { input: active, overlay: active.context.runtimeErrorOverlay };
	for (const input of group.model.tabs) {
		if (input.kind === 'code_editor' && input.context.runtimeErrorOverlay !== null) return { input, overlay: input.context.runtimeErrorOverlay };
	}
	return null;
}

export function focusRuntimeErrorOverlay(group: EditorGroupView): boolean {
	const target = resolveRuntimeErrorOverlayTarget(group);
	if (target === null) return false;
	if (!group.activate(target.input.id)) return false;
	const pane = group.panes.getPane('code_editor') as CodeEditorPane, code = pane.code, overlay = target.overlay;
	const checkpoint = beginNavigationCapture();
	overlay.hidden = false; overlay.hovered = false; overlay.hoverLine = -1; overlay.copyButtonHovered = false; overlay.layout = null;
	setActiveRuntimeErrorOverlay(code, overlay);
	setExecutionStopHighlightForCurrentContext(group, overlay.row);
	code.view.selectionAnchor = null; clearEditorPointerSelectionState(code);
	code.caret.cursorRevealSuspended = false; code.scrollbarController.cancel();
	setCursorPosition(code, overlay.row, overlay.column); centerCursorVertically(code); resetBlinkState(code.caret);
	completeNavigation(checkpoint);
	return true;
}

export function clearAllRuntimeErrorOverlays(group: EditorGroupView): void {
	for (const input of group.model.tabs) if (input.kind === 'code_editor') input.context.runtimeErrorOverlay = null;
	const pane = group.panes.getPane('code_editor') as CodeEditorPane | undefined;
	if (pane !== undefined) clearRuntimeErrorOverlay(pane.code);
	clearExecutionStopHighlights(group);
}

export function setActiveRuntimeErrorOverlayForCurrentContext(group: EditorGroupView, overlay: RuntimeErrorOverlay): void {
	const context = getActiveCodeTabContext(group);
	if (context === null) return;
	context.runtimeErrorOverlay = overlay;
	const pane = group.panes.getPane('code_editor') as CodeEditorPane | undefined;
	if (pane !== undefined && pane.code.view === context.view) setActiveRuntimeErrorOverlay(pane.code, overlay);
}

export function setExecutionStopHighlightForCurrentContext(group: EditorGroupView, row: number): void {
	const context = getActiveCodeTabContext(group);
	if (context === null) return;
	context.executionStopRow = context.model.clampRow(row);
	const pane = group.panes.getPane('code_editor') as CodeEditorPane | undefined;
	if (pane !== undefined && pane.code.view === context.view) setExecutionStopHighlight(pane.code, context.executionStopRow);
}

export function clearExecutionStopHighlights(group: EditorGroupView): void {
	for (const input of group.model.tabs) if (input.kind === 'code_editor') input.context.executionStopRow = null;
	const pane = group.panes.getPane('code_editor') as CodeEditorPane | undefined;
	if (pane !== undefined) clearExecutionStopHighlight(pane.code);
}

export type CapturedSourceNavigation = { readonly generation: number; readonly model: EditorTextModel; readonly version: number };

/** Admit captured locations against authored text; callers recheck this receipt before painting. */
export async function focusCapturedRuntimeSource(navigation: EditorNavigationController, group: EditorGroupView, catalog: WorkspaceSourceCatalog,
	identity: ResourceIdentity, source: Blua32CompiledSource): Promise<CapturedSourceNavigation | undefined> {
	const resource = catalog.resolveResource(identity);
	if (resource === undefined) {
		showEditorMessage(`Installed source '${identity.path}' is not available in the authoring workspace.`, 'warning', 4);
		return undefined;
	}
	const model = editorTextModelService.get(resource) ?? resolveLuaTextFileModel(editorTextModelService, catalog, resource);
	if (getTextSnapshot(model.buffer) !== readBlua32CompiledSource(source)) {
		showEditorMessage(`Installed source '${identity.path}' differs from the authoring document.`, 'warning', 4);
		return undefined;
	}
	const version = model.version;
	const generation = await navigation.focusChunkSource(group, identity);
	return generation === undefined ? undefined : { generation, model, version };
}

export function showLuaErrorOverlay(editor: CartEditor, resource: ResourceIdentity, error: unknown): boolean {
	if (!(error instanceof LuaError)) return false;
	if (error.line <= 0 && error.column <= 0) { showEditorMessage(error.message, 'error', 4); return true; }
	editor.showRuntimeErrorInChunk({ contextId: resource.contextId, path: error.path }, error.line, error.column, error.message);
	return true;
}

export async function navigateToRuntimeErrorFrameTarget(pane: CodeEditorPane, frame: SourceStackTraceFrame,
	source: Blua32CompiledSource): Promise<void> {
	try {
		const receipt = await focusCapturedRuntimeSource(pane.navigation, pane.group, pane.sources.catalog, frame.resource, source);
		if (receipt === undefined || receipt.generation !== pane.group.panes.openGeneration
			|| receipt.model.version !== receipt.version || editorTextModelService.get(frame.resource) !== receipt.model) return;
	} catch (error) {
		showEditorMessage(`Failed to open runtime path: ${extractErrorMessage(error)}`, 'error', 1.6); return;
	}
	const code = pane.code;
	const row = code.model.clampRow(frame.line - 1), column = code.model.clampColumn(row, frame.column - 1);
	code.view.selectionAnchor = null; clearEditorPointerSelectionState(code);
	setCursorPosition(code, row, column); code.caret.cursorRevealSuspended = false;
	centerCursorVertically(code); ensureCursorVisible(code);
}
