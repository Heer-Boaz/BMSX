import type { PlayerInput } from '../../../../hosts/common/input/player';
import type { RectBounds } from '../../../../machine/ts/common/rect';
import type { PointerSnapshot } from '../../../common/models';
import type { EditorTextSelection } from '../../../editor/navigation/text_selection';
import type { EditorPaneSelection } from './editor_selection';
import type { EditorInput } from '../../ui/tab/model';
import type { InputFocusTarget } from '../../../input/focus';

/** Retained workbench control for one editor-input kind. */
export abstract class EditorPane<TInput extends EditorInput> {
	protected contentBounds!: Readonly<RectBounds>;
	/** Authoring pauses gameplay, including host-only tools. Live preview panes explicitly release this hold. */
	public get suspendsRuntime(): boolean { return true; }
	/** A live inspector supplies the command scope for the shared runtime transport. */
	public get runtimeControlContext(): InputFocusTarget | undefined { return undefined; }
	/** Avoid a second scanout panel when this editor already presents the game. */
	public get showsGameFrame(): boolean { return false; }

	/** Optional selection capability; editors without one still have an input identity. */
	public getSelection?(): EditorPaneSelection;
	private inputValue: TInput | null = null;

	public get input(): TInput {
		return this.inputValue!;
	}

	public setInput(input: TInput, bounds: Readonly<RectBounds>, selection?: EditorTextSelection, navigationSelection?: EditorPaneSelection): void {
		this.inputValue = input;
		this.contentBounds = bounds;
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

	/** The editor group publishes content geometry, distinct from the physical canvas. */
	public layout(bounds: Readonly<RectBounds>): void { this.contentBounds = bounds; }

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

	public abstract drawStatusBar(bounds: Readonly<RectBounds>, textColor: number): void;
}
