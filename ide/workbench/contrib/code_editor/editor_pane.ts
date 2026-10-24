import { PointerButton } from '../../../../hosts/common/input/pointer_event';
import { handleCodeAreaSelectionPointer } from '../../../input/pointer/code/selection';
import { inputFocus } from '../../../input/focus';
import { isCtrlDown, isMetaDown, isShiftDown } from '../../../input/keyboard/key_input';
import type { SuspendedGuestSession } from '../../../runtime/suspended_guest';
import type { RectBounds } from '../../../../machine/ts/common/rect';
import { getClipboardText, cutClipboardText, pasteText } from '../../../editor/editing/text_editing_and_selection';
import { runtimeErrorOverlayPointer } from '../../../editor/contrib/runtime_error/pointer';
import { pointerHover } from '../../../input/pointer/hover';
import { codeAreaHover, updateCodeAreaPointerFeedback } from '../../../input/pointer/code/feedback';
import { handleEditorScrollbarPointer } from '../../../input/pointer/scrollbar';
import type { KeyInputEvent } from '../../../../hosts/common/input/text';
import { CodeEditorTextInput } from './native_text_input';
import type { Runtime } from '../../../../machine/ts/machine/runtime/runtime';
import type { CartEditor } from '../../../cart_editor';
import type { Clipboard } from '../../../../hosts/common/clipboard';
import * as constants from '../../../common/constants';
import type { PointerInputSnapshot, WheelInputSnapshot } from '../../../common/models';
import { showEditorMessage } from '../../../common/feedback_state';
import { editorRuntimeState } from '../../../editor/common/runtime_state';
import { editorCaretState } from '../../../editor/ui/view/caret/state';
import { editorViewState } from '../../../editor/ui/view/state';
import { getCodeAreaBounds, scrollRows, scrollColumns, refreshViewportLayout, handlePointerAutoScroll } from '../../../editor/ui/view/view';
import { renderCodeArea } from '../../../editor/render/code_area/area';
import { drawEditorText } from '../../../editor/render/text_renderer';
import { measureText } from '../../../editor/common/text/layout';
import type { EditorTextSelection } from '../../../editor/navigation/text_selection';
import { handleEditorEditingBindings, handleCodeFormattingKeybinding, handleSearchNavigationKeybinding } from '../../../input/keyboard/edit_bindings';
import { handleEditorPromptBindings } from '../../input/keyboard/prompt_bindings';
import { renderInlineWidgets } from '../../../quick_input/inline_widget';
import { handleQuickInputPointer } from '../../../input/quick_input/pointer/dispatch';
import { handleCodeAreaPointerInput } from '../../../input/pointer/code/index';
import { editorPointerState } from '../../../input/pointer/state';
import { editorInput } from './input/keyboard/text_input';
import { renameController } from './rename/controller';
import { referenceState } from '../../../editor/contrib/references/state';
import { editorSearchState } from './find/widget_state';
import { openCodeContextMenuAtCursor } from './context_menu';
import { editorChromeState } from '../../ui/chrome_state';
import {
	activateCodeEditorTab,
	applyActiveCodeTabSelection,
	storeCodeTabContext,
} from '../../ui/code_tab/activation';
import type { CodeEditorInput } from '../../ui/tab/model';
import { EditorPane } from '../../services/editor/editor_pane';
import type { RuntimeSourceState } from '../../../runtime/sources';
import type { RuntimeFaultState } from '../../../runtime/fault_state';
import type { RuntimeDebuggerState } from '../../../runtime/debugger_state';
import { buildStatusLeftInfo } from '../../render/status_bar_info';
import { getTextFileRuntimeSourceStatus } from '../../services/working_copy/runtime_source_status';
import { activeCodeEditor } from '../../../editor/ui/code_editor_state';
import { undo, redo } from '../../../editor/editing/undo_controller';
import { clearReferenceHighlights, requestSemanticRefresh } from '../../../editor/contrib/intellisense/engine';
import { CodeEditorNavigationSelection } from './navigation_selection';
import { closeLineJump } from './find/line_jump';
import { setActiveDiagnostics } from '../../../editor/contrib/diagnostics/state';

const CODE_SCROLLBARS = ['codeVertical', 'codeHorizontal'] as const;

export class CodeEditorPane extends EditorPane<CodeEditorInput> {
	private readonly nativeText = new CodeEditorTextInput();
	public override getSelection(): CodeEditorNavigationSelection {
		return new CodeEditorNavigationSelection(this.input);
	}
	private unsubscribeContentChange: () => void;
	private unsubscribeBeforeContentChange: () => void;
	private readonly unbindKeyboard = activeCodeEditor.focusTarget.bindKeyboard(input => this.handleKeyboard(input));
	private readonly unbindClipboard = activeCodeEditor.focusTarget.bindClipboard({
		get readOnly() { return activeCodeEditor.model.readOnly; },
		copy: getClipboardText,
		cut: cutClipboardText,
		paste: contents => {
			if (contents.text.length > 0) pasteText(contents.text);
			else if (contents.images.length > 0) showEditorMessage('Source files accept text, not images.', constants.COLOR_STATUS_WARNING, 4);
		},
	});
	private readonly unbindBlur = activeCodeEditor.focusTarget.onDidBlur(() => activeCodeEditor.model.breakUndoSequence());
	public constructor(
		private readonly editor: CartEditor,
		private readonly clipboard: Clipboard,
		private readonly sources: RuntimeSourceState,
		private readonly guest: SuspendedGuestSession,
		private readonly fault: RuntimeFaultState,
		private readonly runtime: Runtime,
		private readonly debuggerState: RuntimeDebuggerState,
	) {
		super();
		activeCodeEditor.focusTarget.registerCommand('contextMenu', {
			isEnabled: () => true,
			run: () => openCodeContextMenuAtCursor(this.editor),
		});
		activeCodeEditor.focusTarget.registerCommand('undo', {
			isEnabled: () => !activeCodeEditor.model.readOnly && activeCodeEditor.model.canUndo,
			run: undo,
		});
		activeCodeEditor.focusTarget.registerCommand('redo', {
			isEnabled: () => !activeCodeEditor.model.readOnly && activeCodeEditor.model.canRedo,
			run: redo,
		});
	}

	public focus(): void {
		activeCodeEditor.focusTarget.focus();
	}

	public dispose(): void {
		this.unbindKeyboard(); this.unbindClipboard();
		this.unbindBlur();
	}

	protected activate(): void {
		this.editor.resourcePanel.hide();
		editorChromeState.resourcePanelResizing = false;
		activateCodeEditorTab(this.input);
		activeCodeEditor.focusTarget.textInput = this.nativeText;
		setActiveDiagnostics(this.input.context.model, this.editor.diagnostics.diagnostics);
		this.unsubscribeBeforeContentChange = this.input.context.model.onWillChangeContent(() => {
			activeCodeEditor.clearInlineEdit(); activeCodeEditor.clearVisualCursor();
		});
		this.unsubscribeContentChange = this.input.context.model.onDidChangeContent(event => {
			editorViewState.layout.onDidChangeContent(this.input.context.model.buffer, event);
			this.editor.completion.updateAfterEdit(event.editContext);
			clearReferenceHighlights();
			requestSemanticRefresh();
		});
	}

	public override setOptions(selection?: EditorTextSelection, navigationSelection?: CodeEditorNavigationSelection): void {
		if (selection) {
			applyActiveCodeTabSelection(selection);
		}
		navigationSelection?.restore(this.input);
	}

	public override clearInput(): void {
		this.editor.completion.clearInput();
		activeCodeEditor.focusTarget.release();
		activeCodeEditor.focusTarget.textInput = undefined;
		this.editor.search.closeSearch(false);
		closeLineJump(false);
		pointerHover.release(codeAreaHover);
		pointerHover.release(runtimeErrorOverlayPointer);
		editorViewState.scrollbarController.cancel();
		this.unsubscribeBeforeContentChange();
		this.unsubscribeContentChange();
		storeCodeTabContext(this.input.context);
		activeCodeEditor.detach();
		setActiveDiagnostics(null, []);
		super.clearInput();
	}

	public override layout(bounds: Readonly<RectBounds>): void {
		super.layout(bounds);
		refreshViewportLayout();
		this.editor.completion.layoutPopup(bounds.bottom - bounds.top, editorViewState.lineHeight);
	}

	public override update(deltaSeconds: number): void {
		this.editor.completion.processPending(deltaSeconds);
		const pointer = editorPointerState.lastPointerSnapshot;
		const blocked = this.editor.actionPrompt.visible || this.editor.quickInput.visible || this.editor.contextMenu.visible;
		if (pointer !== null && !blocked) {
			const bounds = getCodeAreaBounds();
			if (editorPointerState.pointerSelecting && (pointer.pressedButtons & PointerButton.Primary) !== 0) {
				const view = activeCodeEditor.view;
				const row = view.cursorRow, column = view.cursorColumn;
				if (handlePointerAutoScroll(pointer.viewportX, pointer.viewportY, bounds)) handleCodeAreaSelectionPointer(pointer, bounds);
				if (view.cursorRow !== row || view.cursorColumn !== column) inputFocus.notifyTargetChanged();
			}
			if (pointerHover.has(codeAreaHover)) updateCodeAreaPointerFeedback(this.sources, this.guest, this.fault, this.runtime, pointer,
				true, isCtrlDown(pointer) || isMetaDown(pointer), editorPointerState.pointerSelecting, this.input.context, bounds);
		} else pointerHover.release(codeAreaHover);
		const semanticError = editorViewState.layout.getLastSemanticError();
		if (semanticError && semanticError !== editorRuntimeState.lastReportedSemanticError) {
			showEditorMessage(semanticError, constants.COLOR_STATUS_ERROR, 2.0);
			editorRuntimeState.lastReportedSemanticError = semanticError;
		} else if (!semanticError && editorRuntimeState.lastReportedSemanticError) {
			editorRuntimeState.lastReportedSemanticError = null;
		}
	}

	public draw(): void {
		this.editor.completion.layoutPopup(this.contentBounds.bottom - this.contentBounds.top, editorViewState.lineHeight);
		renderInlineWidgets();
		const renameActive = renameController.isActive();
		renderCodeArea(
			this.editor.completion,
			activeCodeEditor.focusTarget.hasFocus,
			this.debuggerState.breakpoints.get(
				this.input.context.model.resource,
			),
			renameActive ? renameController.getHighlightMatches() : referenceState.getMatches(),
			renameActive ? renameController.getActiveIndex() : referenceState.getActiveIndex(),
			editorSearchState.matches,
			editorSearchState.currentIndex,
			editorSearchState.scope === 'local' && editorSearchState.query.length > 0,
		);
	}

	public handleKeyboard(playerInput: KeyInputEvent): void {
		if (handleEditorPromptBindings(playerInput, this.editor)) {
			return;
		}
		if (handleSearchNavigationKeybinding(playerInput)) {
			return;
		}
		if (handleEditorEditingBindings(playerInput)) {
			return;
		}
		if (this.editor.completion.handleKeybindings(playerInput)) {
			return;
		}
		if (handleCodeFormattingKeybinding(playerInput)) {
			return;
		}
		editorInput.handleEditorInput(playerInput, this.editor);
	}

	public handlePointer(
		snapshot: PointerInputSnapshot,
		justPressed: boolean,
		pointerSecondaryJustPressed: boolean,
		now: number,
		gotoModifierActive: boolean,
	): void {
		if (handleQuickInputPointer(this.editor, this.sources, snapshot, justPressed)) {
			return;
		}
		if (handleEditorScrollbarPointer(snapshot, CODE_SCROLLBARS)) return;
		handleCodeAreaPointerInput(
			this.editor,
			this.sources,
			snapshot,
			justPressed,
			gotoModifierActive,
			pointerSecondaryJustPressed,
			now,
			this.clipboard,
		);
	}

	public handleWheel(event: WheelInputSnapshot): void {
		if (this.editor.completion.handlePointerWheel(event)) return;
		const bounds = getCodeAreaBounds();
		if (!event.valid || !event.insideViewport || event.viewportY < bounds.codeTop || event.viewportY >= bounds.codeBottom || event.viewportX < bounds.codeLeft || event.viewportX >= bounds.codeRight) return;
		const horizontal = isShiftDown(event) && event.deltaX === 0;
		scrollColumns(horizontal ? event.deltaY : event.deltaX);
		if (!horizontal) scrollRows(event.deltaY);
		editorCaretState.cursorRevealSuspended = true;
	}

	public drawStatusBar(bounds: Readonly<RectBounds>, textColor: number): void {
		const leftX = bounds.left + 4;
		const statusLeftInfo = buildStatusLeftInfo();

		if (statusLeftInfo && statusLeftInfo.length > 0) {
			drawEditorText(editorViewState.font, statusLeftInfo, leftX, bounds.top + 2, 0, textColor);
		}
		const context = this.input.context;
		let detail = '';
		let detailColor = textColor;
		switch (getTextFileRuntimeSourceStatus(this.sources, context.model)) {
			case 'applied':
				detail = 'SOURCE APPLIED';
				break;
			case 'pending':
				detail = 'SOURCE NOT APPLIED';
				break;
			case 'failed':
				detail = 'ASSET APPLY FAILED';
				detailColor = constants.COLOR_STATUS_WARNING;
				break;
			case 'untracked':
				detail = 'SOURCE NOT CHECKED';
				break;
			case 'source_only':
				detail = 'SOURCE ONLY';
				break;
		}
		if (detail.length > 0) {
			drawEditorText(
				editorViewState.font,
				detail,
				bounds.right - measureText(detail) - 4,
				bounds.top + 2,
				0,
				detailColor,
			);
		}
	}
}
