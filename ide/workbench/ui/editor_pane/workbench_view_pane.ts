import { PointerButton } from '../../../input/pointer/buttons';
import type { PlayerInput } from '../../../../hosts/common/input/player';
import type { PointerSnapshot } from '../../../common/models';
import { clearGotoHoverHighlight } from '../../../editor/contrib/intellisense/engine';
import { clearHoverTooltip } from '../../../editor/contrib/hover/controller';
import { editorCaretState } from '../../../editor/ui/view/caret/state';
import { editorViewState } from '../../../editor/ui/view/state';
import { editorPointerState, clearEditorPointerSelectionState } from '../../../input/pointer/state';
import { runtimeErrorState } from '../../../editor/contrib/runtime_error/state';
import { closeLineJump } from '../../contrib/code_editor/find/line_jump';
import { closeSearch } from '../../contrib/code_editor/find/search';
import { problemsPanel } from '../../contrib/problems/panel/controller';
import type { ResourcePanelController } from '../../contrib/resources/panel/controller';
import { EditorPane } from '../../services/editor/editor_pane';
import type { EditorInput } from '../tab/model';
import { editorChromeState } from '../chrome_state';
import { inputFocus } from '../../../input/focus';

type WorkbenchViewInput = Exclude<EditorInput, { kind: 'code_editor' }>;

/** Common pointer completion for non-code workbench views. */
export abstract class WorkbenchViewEditorPane<
	TInput extends WorkbenchViewInput,
> extends EditorPane<TInput> {
	protected readonly focusTarget = inputFocus.createTarget();
	private readonly unbindKeyboard = this.focusTarget.bindKeyboard(input => this.handleKeyboard(input));

	public focus(): void {
		this.focusTarget.focus();
	}

	public dispose(): void {
		this.unbindKeyboard();
	}

	public handlePointer(
		snapshot: PointerSnapshot,
		justPressed: boolean,
		_pointerSecondaryJustPressed: boolean,
		playerInput: PlayerInput,
		now: number,
		_gotoModifierActive: boolean,
	): void {
		const handled = this.handleViewPointer(snapshot, justPressed, now, playerInput);
		if (handled) {
			if (justPressed) playerInput.inputHandlers.pointer?.consumeButton('pointer_primary');
			if ((snapshot.justPressedButtons & PointerButton.Secondary) !== 0) playerInput.inputHandlers.pointer?.consumeButton('pointer_secondary');
			if ((snapshot.justPressedButtons & PointerButton.Auxiliary) !== 0) playerInput.inputHandlers.pointer?.consumeButton('pointer_aux');
		}
		clearEditorPointerSelectionState();
		editorPointerState.lastPointerRowResolution = null;
		clearHoverTooltip();
		clearGotoHoverHighlight();
	}

	protected handleViewPointer(
		_snapshot: PointerSnapshot,
		justPressed: boolean,
		_now: number,
		_playerInput: PlayerInput,
	): boolean {
		if (justPressed) this.focus();
		return false;
	}
}

/** Shared chrome lifecycle for workbench views that own the complete editor area. */
export abstract class FullWidthWorkbenchEditorPane<
	TInput extends WorkbenchViewInput,
> extends WorkbenchViewEditorPane<TInput> {
	public constructor(private readonly resourcePanel: ResourcePanelController) {
		super();
	}

	protected activate(): void {
		closeSearch(false, true);
		closeLineJump(false);
		this.resourcePanel.hide();
		problemsPanel.hide();
		editorChromeState.resourcePanelResizing = false;
		editorChromeState.problemsPanelResizing = false;
		editorViewState.scrollbarController.cancel();
		editorCaretState.cursorRevealSuspended = false;
		runtimeErrorState.activeOverlay = null;
		runtimeErrorState.executionStopRow = null;
		clearGotoHoverHighlight();
		clearHoverTooltip();
	}
}
