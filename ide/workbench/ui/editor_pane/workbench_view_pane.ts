import { clearRuntimeErrorOverlay } from '../../../editor/contrib/runtime_error/navigation';
import type { PointerInputSnapshot } from '../../../common/models';
import { editorCaretState } from '../../../editor/ui/view/caret/state';
import { editorViewState } from '../../../editor/ui/view/state';
import { editorPointerState, clearEditorPointerSelectionState } from '../../../input/pointer/state';
import { runtimeErrorState } from '../../../editor/contrib/runtime_error/state';
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
	private readonly unbindKeyboard: () => void;
	private readonly unbindGamepad: () => void;

	public constructor() {
		super();
		this.focusTarget.canFocus = () => this.hasInput;
		this.unbindKeyboard = this.focusTarget.bindKeyboard(input => this.handleKeyboard(input));
		this.unbindGamepad = this.focusTarget.bindGamepad(input => this.handleGamepad(input));
	}

	public focus(): void {
		this.focusTarget.focus();
	}

	public dispose(): void {
		this.unbindKeyboard();
		this.unbindGamepad();
	}

	public handlePointer(
		snapshot: PointerInputSnapshot,
		justPressed: boolean,
		_pointerSecondaryJustPressed: boolean,
		now: number,
		_gotoModifierActive: boolean,
	): void {
		this.handleViewPointer(snapshot, justPressed, now);
		clearEditorPointerSelectionState();
		editorPointerState.lastPointerRowResolution = null;
	}

	protected handleViewPointer(
		_snapshot: PointerInputSnapshot,
		justPressed: boolean,
		_now: number,
	): boolean {
		if (justPressed) this.focusTarget.focus();
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
		this.resourcePanel.hide();
		problemsPanel.hide();
		editorChromeState.resourcePanelResizing = false;
		editorChromeState.problemsPanelResizing = false;
		editorViewState.scrollbarController.cancel();
		editorCaretState.cursorRevealSuspended = false;
		clearRuntimeErrorOverlay();
		runtimeErrorState.executionStopRow = null;
	}
}
