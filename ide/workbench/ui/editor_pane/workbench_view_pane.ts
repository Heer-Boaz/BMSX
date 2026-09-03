import type { PlayerInput } from '../../../../hosts/common/input/player';
import type { PointerSnapshot } from '../../../common/models';
import { clearGotoHoverHighlight } from '../../../editor/contrib/intellisense/engine';
import { clearHoverTooltip } from '../../../editor/contrib/hover/controller';
import { editorCaretState } from '../../../editor/ui/view/caret/state';
import { editorViewState } from '../../../editor/ui/view/state';
import { editorPointerState, stopPointerSelectionAndResetClicks } from '../../../input/pointer/state';
import { runtimeErrorState } from '../../../editor/contrib/runtime_error/state';
import { closeEditorContextMenu } from '../../contrib/context_menu/widget';
import { closeLineJump } from '../../contrib/code_editor/find/line_jump';
import { closeSearch } from '../../contrib/code_editor/find/search';
import { problemsPanel } from '../../contrib/problems/panel/controller';
import type { ResourcePanelController } from '../../contrib/resources/panel/controller';
import { EditorPane } from '../../services/editor/editor_pane';
import type { EditorTabDescriptor } from '../tab/model';
import { editorChromeState } from '../chrome_state';

type WorkbenchViewInput = Exclude<EditorTabDescriptor, { kind: 'code_editor' }>;

/** Common pointer completion for non-code workbench views. */
export abstract class WorkbenchViewEditorPane<
	TInput extends WorkbenchViewInput,
> extends EditorPane<TInput> {
	public handlePointer(
		snapshot: PointerSnapshot,
		justPressed: boolean,
		_pointerSecondaryJustPressed: boolean,
		playerInput: PlayerInput,
		now: number,
		_gotoModifierActive: boolean,
	): void {
		const handled = this.handleViewPointer(snapshot, justPressed, now);
		if (handled && justPressed) {
			playerInput.inputHandlers.pointer?.consumeButton('pointer_primary');
		}
		stopPointerSelectionAndResetClicks(snapshot);
		editorPointerState.lastPointerRowResolution = null;
		clearHoverTooltip();
		clearGotoHoverHighlight();
	}

	protected handleViewPointer(
		_snapshot: PointerSnapshot,
		_justPressed: boolean,
		_now: number,
	): boolean {
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
		closeEditorContextMenu();
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
