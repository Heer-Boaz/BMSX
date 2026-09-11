import type { PlayerInput } from '../../../../hosts/common/input/player';
import type { PointerSnapshot } from '../../../common/models';
import type { EditorTextSelection } from '../../../editor/navigation/text_selection';
import type { EditorPaneSelection } from './editor_selection';
import type { EditorInput } from '../../ui/tab/model';

/** Retained workbench control for one editor-input kind. */
export abstract class EditorPane<TInput extends EditorInput> {
	/** Optional selection capability; editors without one still have an input identity. */
	public getSelection?(): EditorPaneSelection;
	private inputValue: TInput | null = null;

	public get input(): TInput {
		return this.inputValue!;
	}

	public setInput(input: TInput, selection?: EditorTextSelection, navigationSelection?: EditorPaneSelection): void {
		this.inputValue = input;
		this.activate(selection, navigationSelection);
	}

	// disable-next-line single_line_method_pattern -- Same-input activation applies pane-specific options without reattaching the retained input.
	public setOptions(selection?: EditorTextSelection, navigationSelection?: EditorPaneSelection): void {
		this.activate(selection, navigationSelection);
	}

	public clearInput(): void {
		this.inputValue = null;
	}

	protected abstract activate(selection?: EditorTextSelection, navigationSelection?: EditorPaneSelection): void;

	public abstract focus(): void;

	public abstract dispose(): void;

	public update(_deltaSeconds: number): void {
	}

	/** Attached controls can react to a workbench size change without a source-less widget. */
	public layout?(): void;

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
