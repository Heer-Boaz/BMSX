import type { PointerInputSnapshot } from '../../../common/models';
import { EditorPane } from '../../services/editor/editor_pane';
import type { EditorInput } from '../tab/model';
import { inputFocus, type InputFocusScope, type InputFocusTarget } from '../../../input/focus';

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
		this.focusTarget = inputFocus.createTarget(null, scope);
		this.focusTarget.canFocus = () => this.hasInput;
		this.unbindKeyboard = this.focusTarget.bindKeyboard(input => this.handleKeyboard(input));
		this.unbindGamepad = this.focusTarget.bindGamepad(input => this.handleGamepad(input));
	}

	public override get inputScope(): InputFocusScope { return this.focusTarget.scope; }

	public override clearInput(): void {
		this.focusTarget.release();
		super.clearInput();
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
