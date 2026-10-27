import type { PointerInputSnapshot } from '../../../common/models';
import { EditorPane, type EditorPaneClearReason } from '../../services/editor/editor_pane';
import type { EditorInput } from '../../common/editor_inputs';
import { inputFocus, InputFocusScope, type InputFocusTarget } from '../../../input/focus';

type WorkbenchViewInput = Exclude<EditorInput, { kind: 'code_editor' }>;

/** Common pointer completion for non-code workbench views. */
export abstract class WorkbenchViewEditorPane<
	TInput extends WorkbenchViewInput,
> extends EditorPane<TInput> {
	protected readonly focusTarget: InputFocusTarget;
	private readonly unbindKeyboard: () => void;
	private readonly unbindGamepad: () => void;

	public constructor(scope: InputFocusScope) {
		super();
		this.focusTarget = inputFocus.createTarget(null, new InputFocusScope(scope.surfaceScope, scope));
		this.focusTarget.canFocus = () => this.hasInput;
		this.unbindKeyboard = this.focusTarget.bindKeyboard(input => this.handleKeyboard(input));
		this.unbindGamepad = this.focusTarget.bindGamepad(input => this.handleGamepad(input));
	}

	public override get inputScope(): InputFocusScope { return this.focusTarget.scope; }
	public override get commandTarget(): InputFocusTarget { return this.focusTarget; }

	public override clearInput(reason: EditorPaneClearReason = 'deactivate'): void {
		this.focusTarget.scope.interaction = undefined;
		this.focusTarget.scope.runtime = undefined;
		this.focusTarget.scope.retireContext();
		this.focusTarget.release();
		super.clearInput(reason);
	}

	public focus(): void {
		this.commandTarget.focus();
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
		const activation = inputFocus.interactionRevision;
		this.handleViewPointer(snapshot, justPressed, now);
		if (snapshot.valid && snapshot.insideViewport && snapshot.justPressedButtons !== 0
			&& activation === inputFocus.interactionRevision) this.focusTarget.activate();
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
