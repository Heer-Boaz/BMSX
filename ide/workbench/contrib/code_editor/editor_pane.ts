import { requestWorkspaceAutosave } from '../../workspace/storage';
import { WorkspaceAutosaveChange } from '../../workspace/models';
import { applyRuntimeErrorOverlay } from '../../../editor/render/error_overlay';
import type { RuntimeErrorDetails } from '../../../runtime/fault_state';
import { adjustHoverTooltipScroll, isPointInHoverTooltip, pointerHitsHoverTarget } from '../../../editor/ui/hover_tooltip';
import type { HostClock } from '../../../../hosts/common/clock';
import type { KeyInputEvent } from '../../../../hosts/common/input/text';
import type { Clipboard } from '../../../../hosts/common/clipboard';
import type { Runtime } from '../../../../machine/ts/machine/runtime/runtime';
import type { RectBounds } from '../../../../machine/ts/common/rect';
import { PointerButton } from '../../../../hosts/common/input/pointer_event';
import { api } from '../../../runtime/overlay_api';
import type { SuspendedGuestSession } from '../../../runtime/suspended_guest';
import type { RuntimeSourceState } from '../../../runtime/sources';
import type { RuntimeFaultState } from '../../../runtime/fault_state';
import type { RuntimeDebuggerState } from '../../../runtime/debugger_state';
import type { EditorPart } from '../../services/editor/editor_part';
import type { CartEditor } from '../../../cart_editor';
import type { PointerInputSnapshot, WheelInputSnapshot } from '../../../common/models';
import type { EditorTextSelection } from '../../../editor/navigation/text_selection';
import type { EditorTextModel } from '../../../editor/model/text_model';
import { CodeEditorControl } from '../../../editor/ui/code_editor_control';
import { editorViewState } from '../../../editor/ui/view/state';
import { onDidChangeEditorFont } from '../../../editor/ui/view/configuration';
import { getClipboardText, cutClipboardText, pasteText } from '../../../editor/editing/text_editing_and_selection';
import { getCodeAreaBounds, handlePointerAutoScroll, measureGutterWidth, scrollHorizontally, scrollRows } from '../../../editor/ui/view/view';
import { resolveCodeAreaViewport } from '../../../editor/ui/code/area_viewport';
import { ensureCursorVisible } from '../../../editor/ui/view/caret/view';
import { clearExecutionStopHighlight, clearRuntimeErrorOverlay } from '../../../editor/contrib/runtime_error/navigation';
import { CodeEditorHoverController } from '../../../editor/contrib/hover/controller';
import { renderCodeArea } from '../../../editor/render/code_area/area';
import { drawEditorText } from '../../../editor/render/text_renderer';
import { EMPTY_DIAGNOSTICS_BY_ROW } from '../../../editor/contrib/diagnostics/model';
import { pointerCapture } from '../../../input/pointer/capture';
import { pointerHover, type PointerHoverTarget } from '../../../input/pointer/hover';
import { inputFocus, type InputFocusScope } from '../../../input/focus';
import { isCtrlDown, isMetaDown, isShiftDown, isKeyJustPressed, consumeIdeKey } from '../../../input/keyboard/key_input';
import { handleEditorEditingBindings, handleCodeFormattingKeybinding, handleSearchNavigationKeybinding } from '../../../input/keyboard/edit_bindings';
import { handleEditorPromptBindings } from '../../input/keyboard/prompt_bindings';
import { handleCodeAreaSelectionPointer } from '../../../input/pointer/code/selection';
import { updateCodeAreaPointerFeedback } from '../../../input/pointer/code/feedback';
import { handleCodeAreaPointerInput } from '../../../input/pointer/code/index';
import { handleQuickInputPointer } from '../../../input/quick_input/pointer/dispatch';
import { showEditorMessage, editorFeedbackState } from '../../../common/feedback_state';
import * as constants from '../../../common/constants';
import type { CodeEditorInput } from './editor_input';
import { EditorPane } from '../../services/editor/editor_pane';
import type { EditorGroupView } from '../../services/editor/editor_group';
import { EditorNavigationController } from '../resources/navigation';
import { CodeEditorNavigationSelection } from './navigation_selection';
import { activateCodeEditorTab, applyActiveCodeTabSelection, storeCodeTabContext } from '../../ui/code_tab/activation';
import { captureCodeEditorView, type CodeEditorLocation } from './view_snapshot';
import { EditorCompletionController } from './suggest/completion_controller';
import { EditorSearchController } from './find/search';
import { CodeEditorLineJump } from './find/line_jump';
import { RenameController } from './rename/controller';
import { openRenamePrompt } from './rename/prompt';
import { SourceInlineBars } from './inline_bar/source_inline_bars';
import { renderSearchBar, renderRenameBar, renderLineJumpBar } from './render/inline_bar/bars';
import { bindSourceCommands } from './commands';
import { handleSourceInput } from './input/keyboard/text_input';
import { buildStatusLeftInfo } from '../../render/status_bar_info';
import { getTextFileRuntimeSourceStatus } from '../../services/working_copy/runtime_source_status';

const SOURCE_READING_COLUMNS = 48;
const CODE_SCROLLBARS = ['codeVertical', 'codeHorizontal'] as const;

/** One group's retained Source widget and its concrete editor-bound contributions. */
export class CodeEditorPane extends EditorPane<CodeEditorInput> {
	public readonly code: CodeEditorControl;
	public readonly completion: EditorCompletionController;
	public readonly find: EditorSearchController;
	public readonly lineJump: CodeEditorLineJump;
	public readonly rename: RenameController;
	public readonly hover: CodeEditorHoverController;
	public readonly bars: SourceInlineBars;
	public readonly navigation: EditorNavigationController;
	public readonly codeHover: PointerHoverTarget = {
		onPointerLeave: () => { this.hover.clear(); this.code.gotoHoverHighlight = null; },
		onPointerModifiersChanged: modifiers => {
			const pointer = this.code.pointer.lastPointerSnapshot;
			if (pointer !== null) pointer.modifiers = modifiers;
		},
	};
	private readonly viewMementos = new WeakMap<EditorTextModel, CodeEditorLocation>();
	private readonly subscriptions: (() => void)[];
	private unsubscribeContentChange: () => void;
	private unsubscribeBeforeContentChange: () => void;
	private unsubscribeReadOnlyChange: () => void;
	private lastReportedSemanticError: string | null = null;

	public override get inputScope(): InputFocusScope { return this.code.focusTarget.scope; }
	public override get commandTarget() { return this.code.focusTarget; }
	public override get companionGameMinimumWidth(): number {
		return measureGutterWidth(this.code) + 2 + this.code.charAdvance * (SOURCE_READING_COLUMNS + 1)
			+ constants.SCROLLBAR_WIDTH + constants.CODE_AREA_RIGHT_MARGIN;
	}

	public readonly part: EditorPart;
	public constructor(scope: InputFocusScope, public readonly group: EditorGroupView, public readonly editor: CartEditor,
		public readonly clipboard: Clipboard, public readonly sources: RuntimeSourceState,
		public readonly guest: SuspendedGuestSession, public readonly fault: RuntimeFaultState,
		public readonly runtime: Runtime, public readonly debuggerState: RuntimeDebuggerState, clock: HostClock) {
		super();
		this.part = editor.editorParts.partForGroup(group);
		const code = this.code = new CodeEditorControl(scope, editorViewState.font, clock);
		this.completion = new EditorCompletionController(code, sources, guest, fault, runtime);
		this.find = new EditorSearchController(code, sources.catalog);
		this.lineJump = new CodeEditorLineJump(code);
		this.rename = new RenameController(code, sources.catalog, editor.crossFileRename);
		this.hover = new CodeEditorHoverController(code, sources, guest, fault, runtime);
		this.bars = new SourceInlineBars(code, this.find, this.rename, this.lineJump);
		this.navigation = editor.navigation;
		code.focusTarget.canFocus = () => this.hasInput && code.geometry.cachedContentWidth > 0
			&& code.geometry.clientBounds.left < code.geometry.clientBounds.right
			&& code.geometry.clientBounds.top < code.geometry.clientBounds.bottom;
		this.subscriptions = [
			code.focusTarget.bindKeyboard(input => this.handleKeyboard(input)),
			code.focusTarget.bindClipboard({
				get readOnly() { return code.model.readOnly; },
				copy: () => getClipboardText(code), cut: () => cutClipboardText(code),
				paste: contents => {
					if (contents.text.length > 0) pasteText(code, contents.text);
					else if (contents.images.length > 0) showEditorMessage('Source files accept text, not images.', 'warning', 4);
				},
			}),
			code.focusTarget.onDidBlur(() => {
				pointerCapture.cancelTarget(code); code.model.breakUndoSequence();
				code.pointer.lastPointerClickTimeMs = 0;
			}),
			bindSourceCommands(this),
			this.find.onDidChangeLayout(() => this.layoutInlineWidgets()),
			this.rename.onDidChangeLayout(() => this.layoutInlineWidgets()),
			this.lineJump.onDidChangeLayout(() => this.layoutInlineWidgets()),
			code.onDidChangeViewState(() => requestWorkspaceAutosave(WorkspaceAutosaveChange.EditorSession)),
			code.focusTarget.onDidCancelInput(() => {
				pointerCapture.cancelTarget(code); code.scrollbarController.cancel(); this.completion.clearInput();
				this.hover.clear(); code.gotoHoverHighlight = null;
			}),
			onDidChangeEditorFont(font => {
				code.setFont(font); this.hover.clear();
				if (code.runtimeError.activeOverlay !== null) code.runtimeError.activeOverlay.layout = null;
				if (this.hasInput) { this.layout(this.contentBounds); code.caret.cursorRevealSuspended = false; ensureCursorVisible(code); }
			}),
		];
	}

	public focus(): void { this.code.focusTarget.focus(); }
	public override getSelection(): CodeEditorNavigationSelection { return new CodeEditorNavigationSelection(this.input); }

	protected activate(): void {
		this.input.initializeViewState(this.viewMementos.get(this.input.workingCopy));
		this.layoutInlineWidgets();
		activateCodeEditorTab(this.code, this.input, this.editor.codeDocuments.get(this.input.workingCopy));
		if (this.code.runtimeError.activeOverlay !== null) this.code.runtimeError.activeOverlay.layout = null;
		if (this.find.state.query.length > 0) this.find.startSearchJob();
		const model = this.input.workingCopy;
		this.unsubscribeReadOnlyChange = model.onDidChangeReadOnly(() => { if (model.readOnly) this.completion.clearInput(); });
		this.unsubscribeBeforeContentChange = model.onWillChangeContent(() => { this.hover.clear(); this.code.gotoHoverHighlight = null; });
		this.unsubscribeContentChange = model.onDidChangeContent(event => {
			this.completion.updateAfterEdit(event.editContext); this.code.references.clear();
			if (this.find.state.query.length > 0 && this.find.state.scope === 'local') this.find.startSearchJob();
		});
	}

	public override setOptions(selection?: EditorTextSelection, navigationSelection?: CodeEditorNavigationSelection): void {
		if (selection !== undefined) applyActiveCodeTabSelection(this.code, selection);
		navigationSelection?.restore(this.input, this.code);
	}

	public override clearInput(): void {
		const scope = this.code.focusTarget.scope;
		if (this.editor.contextMenu.visible && this.editor.contextMenu.invocationOrigin?.scope === scope) this.editor.contextMenu.hide(false);
		if (this.part.quickInput.visible && this.part.quickInput.invocationOrigin?.scope === scope) this.part.quickInput.hide(false);
		if (this.part.actionPrompt.visible && this.part.actionPrompt.invocationOrigin?.scope === scope) this.part.actionPrompt.close('cancel', false);
		storeCodeTabContext(this.code, this.input.context);
		this.viewMementos.set(this.input.workingCopy, captureCodeEditorView(this.input));
		this.completion.clearInput(); this.find.closeSearch(false); this.lineJump.close(false); this.rename.cancel();
		pointerHover.release(this.codeHover); this.hover.clear(); this.code.gotoHoverHighlight = null; this.code.references.clear();
		this.unsubscribeBeforeContentChange(); this.unsubscribeContentChange(); this.unsubscribeReadOnlyChange();
		clearRuntimeErrorOverlay(this.code); clearExecutionStopHighlight(this.code);
		this.code.caret.cursorRevealSuspended = false;
		this.code.detach();
		super.clearInput();
	}

	public dispose(): void {
		if (this.hasInput) this.clearInput();
		for (const unsubscribe of this.subscriptions) unsubscribe();
		this.completion.dispose(); this.find.dispose(); this.lineJump.dispose(); this.rename.dispose();
		this.code.dispose();
	}

	public layoutInlineWidgets(): void {
		this.bars.layout(this.contentBounds);
		if (this.code.model !== null) resolveCodeAreaViewport(this.code);
	}

	public override layout(bounds: Readonly<RectBounds>): void {
		super.layout(bounds); this.layoutInlineWidgets();
		if (!this.code.focusTarget.canFocus!()) { pointerCapture.cancelTarget(this.code); this.code.focusTarget.release(); pointerHover.release(this.codeHover); }
		this.completion.layoutPopup(bounds.bottom - bounds.top, this.code.lineHeight);
	}

	public override update(deltaSeconds: number): void {
		this.code.update(deltaSeconds); this.completion.processPending(deltaSeconds);
		const pointer = this.code.pointer.lastPointerSnapshot;
		const blocked = !this.editor.surfaces.isAdmitted(this.group.paneSurface) || this.editor.contextMenu.visible;
		if (pointer !== null && !blocked) {
			const bounds = getCodeAreaBounds(this.code);
			const selection = this.code.pointer.selectionSnapshot;
			if (this.code.pointer.pointerSelecting && (selection.pressedButtons & PointerButton.Primary) !== 0) {
				const view = this.code.view, row = view.cursorRow, column = view.cursorColumn;
				if (handlePointerAutoScroll(this.code, selection.viewportX, selection.viewportY, bounds)) handleCodeAreaSelectionPointer(this.code, selection, bounds);
				if (view.cursorRow !== row || view.cursorColumn !== column) inputFocus.notifyTargetChanged();
			}
			if (pointerHover.has(this.codeHover)) updateCodeAreaPointerFeedback(this.code, this.hover, this.sources, pointer,
				true, isCtrlDown(pointer) || isMetaDown(pointer), this.code.pointer.pointerSelecting, bounds);
		} else pointerHover.release(this.codeHover);
		const semanticError = this.code.layout.document.getLastSemanticError();
		if (semanticError !== null && semanticError !== this.lastReportedSemanticError) showEditorMessage(semanticError, 'error', 2);
		this.lastReportedSemanticError = semanticError;
	}

	public draw(): void {
		api.pushClipRect(this.contentBounds.left, this.contentBounds.top, this.contentBounds.right, this.contentBounds.bottom);
		renderSearchBar(this.code, this.find, this.bars); renderRenameBar(this.rename, this.bars); renderLineJumpBar(this.lineJump, this.bars);
		if (this.code.focusTarget.canFocus!()) {
			const renameActive = this.rename.isActive(), diagnostics = this.editor.diagnostics.get(this.input.workingCopy);
			renderCodeArea(this.code, this.completion, this.code.focusTarget.hasFocus,
				this.debuggerState.breakpoints.get(this.input.workingCopy.resource),
				renameActive ? this.rename.getHighlightMatches() : this.code.references.getMatches(),
				renameActive ? this.rename.getActiveIndex() : this.code.references.getActiveIndex(),
				this.find.state.matches, this.find.state.currentIndex,
				this.find.state.scope === 'local' && this.find.state.query.length > 0,
				diagnostics?.status === 'ready' ? diagnostics.byRow : EMPTY_DIAGNOSTICS_BY_ROW);
		}
		api.popClipRect();
	}

	public openFind(scope: 'local' | 'global'): void {
		this.code.references.clear(); this.lineJump.close(false); this.rename.cancel(); this.completion.closeSession();
		this.find.openSearch(true, scope); this.find.state.field.focusTarget.focus();
	}

	public openLineJump(): void {
		this.code.references.clear(); this.find.closeSearch(false); this.rename.cancel(); this.completion.closeSession();
		this.lineJump.open(); this.lineJump.state.field.focusTarget.focus();
	}

	public openRename(preview: boolean): void {
		this.find.closeSearch(false); this.lineJump.close(false); this.completion.closeSession();
		if (openRenamePrompt(this.rename, preview ? this.group : undefined)) this.rename.getField().focusTarget.focus();
	}

	public showRuntimeError(line: number, column: number, message: string, details?: RuntimeErrorDetails, path = ''): void {
		const applied = applyRuntimeErrorOverlay(this.code, line, column, message, details, path);
		this.input.context.runtimeErrorOverlay = applied.overlay;
		this.input.context.executionStopRow = applied.targetRow;
		this.code.runtimeError.activeOverlay = applied.overlay;
		this.code.runtimeError.executionStopRow = applied.targetRow;
		showEditorMessage(applied.statusLine, 'error', 2);
	}

	public handleKeyboard(input: KeyInputEvent): void {
		if (handleEditorPromptBindings(this.code, input, this.editor.commands)
			|| handleSearchNavigationKeybinding(this.find, input) || handleEditorEditingBindings(this.code, input)
			|| this.completion.handleKeybindings(input) || handleCodeFormattingKeybinding(this.code, input)) return;
		if (isKeyJustPressed('Escape', input)) {
			if (this.lineJump.state.visible) {
				consumeIdeKey('Escape', input); this.lineJump.close(false); return;
			}
			if (this.find.state.visible) {
				consumeIdeKey('Escape', input); this.find.closeSearch(false); return;
			}
			const overlay = this.code.runtimeError.activeOverlay;
			if (overlay !== null) {
				consumeIdeKey('Escape', input);
				pointerHover.release(this.code.runtimeErrorPointer);
				overlay.hidden = !overlay.hidden; overlay.hovered = false; overlay.hoverLine = -1;
				overlay.copyButtonHovered = false; overlay.layout = null;
				editorFeedbackState.message.visible = false;
				return;
			}
		}
		handleSourceInput(this.code, input, this.editor.breakpoints);
	}

	public handlePointer(snapshot: PointerInputSnapshot, justPressed: boolean, secondary: boolean, now: number, goto: boolean): void {
		if (snapshot.valid && snapshot.insideViewport && snapshot.justPressedButtons !== 0) this.code.focusTarget.activate();
		this.code.acceptPointerInput(snapshot);
		if (handleQuickInputPointer(this.find, this.rename, this.lineJump, this.bars, snapshot, justPressed)) return;
		if (this.code.scrollbarController.begin(CODE_SCROLLBARS, snapshot, this.code.lineHeight)) return;
		handleCodeAreaPointerInput(this, snapshot, justPressed, goto, secondary, now);
	}

	public handleWheel(event: WheelInputSnapshot): void {
		if (this.completion.handlePointerWheel(event)) return;
		const tooltip = this.code.hoverTooltip;
		if (tooltip !== null) {
			const inside = isPointInHoverTooltip(this.code, event.viewportX, event.viewportY);
			if ((inside || pointerHitsHoverTarget(this.code, event, tooltip)) && (adjustHoverTooltipScroll(this.code, event.deltaY) || inside)) return;
		}
		const bounds = getCodeAreaBounds(this.code);
		if (!event.valid || !event.insideViewport || event.viewportY < bounds.codeTop || event.viewportY >= bounds.codeBottom || event.viewportX < bounds.codeLeft || event.viewportX >= bounds.codeRight) return;
		const horizontal = isShiftDown(event) && event.deltaX === 0;
		scrollHorizontally(this.code, (horizontal ? event.deltaY : event.deltaX) * this.code.charAdvance);
		if (!horizontal) scrollRows(this.code, event.deltaY);
		this.code.caret.cursorRevealSuspended = true;
	}
	public drawStatusBar(bounds: Readonly<RectBounds>, textColor: number): void {
		const leftX = bounds.left + 4;
		const statusLeftInfo = buildStatusLeftInfo(this.code);

		if (statusLeftInfo && statusLeftInfo.length > 0) {
			drawEditorText(this.code.font, statusLeftInfo, leftX, bounds.top + 2, 0, textColor);
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
				this.code.font,
				detail,
				bounds.right - this.code.font.measure(detail) - 4,
				bounds.top + 2,
				0,
				detailColor,
			);
		}
	}
}
