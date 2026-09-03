import type { PlayerInput } from '../../../../hosts/common/input/player';
import type { PointerSnapshot } from '../../../common/models';
import type { EditorTextSelection } from '../../../editor/navigation/text_selection';
import type { EditorTabDescriptor } from '../../ui/tab/model';

/** Retained workbench control for one editor-input kind. */
export abstract class EditorPane<TInput extends EditorTabDescriptor> {
	private inputValue: TInput | null = null;

	public get input(): TInput {
		return this.inputValue!;
	}

	public setInput(input: TInput, selection?: EditorTextSelection): void {
		this.inputValue = input;
		this.activate(selection);
	}

	// disable-next-line single_line_method_pattern -- Same-input activation applies pane-specific options without reattaching the retained input.
	public setOptions(selection?: EditorTextSelection): void {
		this.activate(selection);
	}

	public clearInput(): void {
		this.inputValue = null;
	}

	protected abstract activate(selection?: EditorTextSelection): void;

	public update(_deltaSeconds: number): void {
	}

	public abstract draw(): void;

	public abstract handleKeyboard(playerInput: PlayerInput): void;

	public abstract handlePointer(
		snapshot: PointerSnapshot,
		justPressed: boolean,
		pointerSecondaryJustPressed: boolean,
		playerInput: PlayerInput,
		now: number,
		gotoModifierActive: boolean,
	): void;

	public abstract handleWheel(
		direction: number,
		steps: number,
		activePointer: PointerSnapshot | null,
		playerInput: PlayerInput,
	): void;

	public abstract drawStatusBar(statusTop: number, textColor: number): void;
}
