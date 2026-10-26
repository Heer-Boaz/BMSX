import { pointerCapture, type PointerCaptureTarget } from '../../../input/pointer/capture';
import { PointerButton } from '../../../../hosts/common/input/pointer_event';
import { handleCodeAreaSelectionPointer } from '../../../input/pointer/code/selection';
import { inputFocus } from '../../../input/focus';
import { isCtrlDown, isMetaDown, isShiftDown } from '../../../input/keyboard/key_input';
import type { SuspendedGuestSession } from '../../../runtime/suspended_guest';
import type { RectBounds } from '../../../../machine/ts/common/rect';
import { getClipboardText, cutClipboardText, pasteText } from '../../../editor/editing/text_editing_and_selection';
import { clearExecutionStopHighlight, clearRuntimeErrorOverlay } from '../../../editor/contrib/runtime_error/navigation';
import { pointerHover } from '../../../input/pointer/hover';
import { codeAreaHover, updateCodeAreaPointerFeedback } from '../../../input/pointer/code/feedback';
import { handleEditorScrollbarPointer } from '../../../input/pointer/scrollbar';
import type { KeyInputEvent } from '../../../../hosts/common/input/text';
import { CodeEditorTextInput } from './native_text_input';
import type { Runtime } from '../../../../machine/ts/machine/runtime/runtime';
import type { CartEditor } from '../../../cart_editor';
import type { Clipboard } from '../../../../hosts/common/clipboard';
import * as constants from '../../../common/constants';
import type { PointerInputSnapshot, PointerSnapshot, WheelInputSnapshot } from '../../../common/models';
import { showEditorMessage } from '../../../common/feedback_state';
import { editorRuntimeState } from '../../../editor/common/runtime_state';
import { editorCaretState } from '../../../editor/ui/view/caret/state';
import { editorViewState } from '../../../editor/ui/view/state';
import { getCodeAreaBounds, measureGutterWidth, scrollRows, scrollHorizontally, handlePointerAutoScroll } from '../../../editor/ui/view/view';
import { resolveCodeAreaViewport } from '../../../editor/ui/code/area_viewport';
import { rewrapRuntimeErrorOverlays } from '../../../runtime_error/navigation';
import { renderCodeArea } from '../../../editor/render/code_area/area';
import { drawEditorText } from '../../../editor/render/text_renderer';
import { measureText } from '../../../editor/common/text/layout';
import type { EditorTextSelection } from '../../../editor/navigation/text_selection';
import { handleEditorEditingBindings, handleCodeFormattingKeybinding, handleSearchNavigationKeybinding } from '../../../input/keyboard/edit_bindings';
import { handleEditorPromptBindings } from '../../input/keyboard/prompt_bindings';
import { layoutInlineWidgets, renderInlineWidgets } from '../../../quick_input/inline_widget';
import { handleQuickInputPointer } from '../../../input/quick_input/pointer/dispatch';
import { handleCodeAreaPointerInput } from '../../../input/pointer/code/index';
import { editorPointerState } from '../../../input/pointer/state';
import { editorInput } from './input/keyboard/text_input';
import { renameController } from './rename/controller';
import { referenceState } from '../../../editor/contrib/references/state';
import { editorSearchState } from './find/widget_state';
import { openCodeContextMenuAtCursor } from './context_menu';
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
import { ensureCursorVisible } from '../../../editor/ui/view/caret/view';
import type { EditorTextModel } from '../../../editor/model/text_model';
import { captureCodeEditorView, type CodeEditorLocation } from './view_snapshot';

// A short source line remains readable without making the gutter part of its text budget.
const SOURCE_READING_COLUMNS = 48;

const CODE_SCROLLBARS = ['codeVertical', 'codeHorizontal'] as const;

export class CodeEditorPane extends EditorPane<CodeEditorInput> implements PointerCaptureTarget {
	public override get inputScope() {
		return this.hasInput && activeCodeEditor.view === this.input.context.view ? activeCodeEditor.focusTarget.scope : undefined;
	}
	public override get companionGameMinimumWidth(): number {
		return measureGutterWidth() + 2 + editorViewState.charAdvance * (SOURCE_READING_COLUMNS + 1)
			+ constants.SCROLLBAR_WIDTH + constants.CODE_AREA_RIGHT_MARGIN;
	}

	private readonly nativeText = new CodeEditorTextInput();
	private readonly viewMementos = new WeakMap<EditorTextModel, CodeEditorLocation>();
	private layoutWidth = -1;
	private textTop = -1;
	private textBottom = -1;
	private selectionPointerX = 0;
	private selectionPointerY = 0;
	public override getSelection(): CodeEditorNavigationSelection {
		return new CodeEditorNavigationSelection(this.input);
	}
	private unsubscribeContentChange: () => void;
	private unsubscribeBeforeContentChange: () => void;
	private unsubscribeReadOnlyChange: () => void;
	private readonly unbindKeyboard = activeCodeEditor.focusTarget.bindKeyboard(input => this.handleKeyboard(input));
	private readonly unbindClipboard = activeCodeEditor.focusTarget.bindClipboard({
		get readOnly() { return activeCodeEditor.model.readOnly; },
		copy: getClipboardText,
		cut: cutClipboardText,
		paste: contents => {
			if (contents.text.length > 0) pasteText(contents.text);
			else if (contents.images.length > 0) showEditorMessage('Source files accept text, not images.', 'warning', 4);
		},
	});
	private readonly unbindBlur = activeCodeEditor.focusTarget.onDidBlur(() => {
		pointerCapture.cancelTarget(this); activeCodeEditor.model.breakUndoSequence();
	});
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
		activeCodeEditor.focusTarget.canFocus = () => this.hasInput && this.contentBounds.left < this.contentBounds.right
			&& editorViewState.cachedContentWidth > 0
			&& editorViewState.codeAreaTop < editorViewState.codeAreaBottom;
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
		pointerCapture.cancelTarget(this);
		activeCodeEditor.focusTarget.canFocus = undefined;
		this.unbindKeyboard(); this.unbindClipboard();
		this.unbindBlur();
	}

	protected activate(): void {
		this.input.initializeViewState(this.viewMementos.get(this.input.workingCopy));
		activateCodeEditorTab(this.input);
		this.layoutWidth = this.contentBounds.right - this.contentBounds.left;
		activeCodeEditor.focusTarget.textInput = this.nativeText;
		setActiveDiagnostics(this.input.context.model, this.editor.diagnostics.diagnostics);
		this.unsubscribeReadOnlyChange = this.input.context.model.onDidChangeReadOnly(() => {
			if (this.input.context.model.readOnly) this.editor.completion.clearInput();
		});
		this.unsubscribeBeforeContentChange = this.input.context.model.onWillChangeContent(() => {
			pointerCapture.cancelTarget(this);
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
		storeCodeTabContext(this.input.context);
		this.viewMementos.set(this.input.workingCopy, captureCodeEditorView(this.input));
		pointerCapture.cancelTarget(this);
		this.editor.completion.clearInput();
		activeCodeEditor.focusTarget.release();
		activeCodeEditor.focusTarget.textInput = undefined;
		this.editor.search.closeSearch(false);
		closeLineJump(false);
		pointerHover.release(codeAreaHover);
		this.unsubscribeBeforeContentChange();
		this.unsubscribeContentChange();
		this.unsubscribeReadOnlyChange();
		clearRuntimeErrorOverlay();
		clearExecutionStopHighlight();
		editorCaretState.cursorRevealSuspended = false;
		activeCodeEditor.detach();
		setActiveDiagnostics(null, []);
		super.clearInput();
	}

	public override layout(bounds: Readonly<RectBounds>): void {
		super.layout(bounds);
		this.textTop = editorViewState.codeAreaTop; this.textBottom = editorViewState.codeAreaBottom;
		if (bounds.left < bounds.right && this.textTop < this.textBottom) {
			activeCodeEditor.clearVisualCursor();
			const width = bounds.right - bounds.left;
			if (width !== this.layoutWidth) editorViewState.layout.markVisualLinesDirty();
			this.layoutWidth = width;
			resolveCodeAreaViewport();
			rewrapRuntimeErrorOverlays(this.editor.editorGroup);
		}
		layoutInlineWidgets();
		if (!activeCodeEditor.focusTarget.canFocus!()) {
			pointerCapture.cancelTarget(this);
			activeCodeEditor.focusTarget.release();
			pointerHover.release(codeAreaHover);
		}
		this.editor.completion.layoutPopup(bounds.bottom - bounds.top, editorViewState.lineHeight);
	}

	public override update(deltaSeconds: number): void {
		if (this.textTop !== editorViewState.codeAreaTop || this.textBottom !== editorViewState.codeAreaBottom) {
			this.textTop = editorViewState.codeAreaTop; this.textBottom = editorViewState.codeAreaBottom;
			if (this.textTop === this.textBottom) {
				pointerCapture.cancelTarget(this);
				activeCodeEditor.focusTarget.release();
				pointerHover.release(codeAreaHover);
			} else if (!editorCaretState.cursorRevealSuspended) ensureCursorVisible();
		}
		layoutInlineWidgets();
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
			showEditorMessage(semanticError, 'error', 2.0);
			editorRuntimeState.lastReportedSemanticError = semanticError;
		} else if (!semanticError && editorRuntimeState.lastReportedSemanticError) {
			editorRuntimeState.lastReportedSemanticError = null;
		}
	}

	public draw(): void {
		this.editor.completion.layoutPopup(this.contentBounds.bottom - this.contentBounds.top, editorViewState.lineHeight);
		renderInlineWidgets();
		if (!activeCodeEditor.focusTarget.canFocus!()) return;
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
			this,
		);
	}

	public beginPointerSelection(snapshot: PointerSnapshot): void {
		this.selectionPointerX = snapshot.viewportX; this.selectionPointerY = snapshot.viewportY;
		editorPointerState.pointerSelecting = true;
		pointerCapture.capture(this);
	}

	public handleCapturedPointer(snapshot: PointerSnapshot): void {
		if (snapshot.viewportX === this.selectionPointerX && snapshot.viewportY === this.selectionPointerY) return;
		this.selectionPointerX = snapshot.viewportX; this.selectionPointerY = snapshot.viewportY;
		handleCodeAreaSelectionPointer(snapshot, getCodeAreaBounds());
	}

	public releaseCapturedPointer(snapshot: PointerSnapshot): void {
		this.handleCapturedPointer(snapshot); this.cancelPointer();
	}

	public cancelPointer(): void {
		pointerCapture.release(this);
		if (editorPointerState.pointerSelecting) editorPointerState.lastPointerSnapshot = null;
		editorPointerState.pointerSelecting = false;
		editorPointerState.lastPointerRowResolution = null;
	}

	public handleWheel(event: WheelInputSnapshot): void {
		if (this.editor.completion.handlePointerWheel(event)) return;
		const bounds = getCodeAreaBounds();
		if (!event.valid || !event.insideViewport || event.viewportY < bounds.codeTop || event.viewportY >= bounds.codeBottom || event.viewportX < bounds.codeLeft || event.viewportX >= bounds.codeRight) return;
		const horizontal = isShiftDown(event) && event.deltaX === 0;
		scrollHorizontally((horizontal ? event.deltaY : event.deltaX) * editorViewState.charAdvance);
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
				detailColor = constants.STATUS_MESSAGE_TEXT_COLORS.error;
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
