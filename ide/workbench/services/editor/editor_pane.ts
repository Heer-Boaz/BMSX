import type { KeyInputEvent } from '../../../../hosts/common/input/text';
import type { PlayerInput } from '../../../../hosts/common/input/player';
import type { RectBounds } from '../../../../machine/ts/common/rect';
import type { PointerInputSnapshot, WheelInputSnapshot } from '../../../common/models';
import type { EditorTextSelection } from '../../../editor/navigation/text_selection';
import type { EditorPaneSelection } from './editor_selection';
import type { EditorInput } from '../../ui/tab/model';
import type { InputFocusScope, InputFocusTarget } from '../../../input/focus';
import type { RuntimeTransport } from '../../../runtime/transport';

/** Retained workbench control for one editor-input kind. */
export abstract class EditorPane<TInput extends EditorInput> {
	/** Scope of a concrete control borrowed by this pane, when separate from its group scope. */
	public get inputScope(): InputFocusScope | undefined { return undefined; }
	protected contentBounds!: Readonly<RectBounds>;
	/** Authoring pauses gameplay, including host-only tools. Live preview panes explicitly release this hold. */
	public get suspendsRuntime(): boolean { return true; }
	/** A live inspector supplies the command scope for the shared runtime transport. */
	public get runtimeControlContext(): InputFocusTarget | undefined { return undefined; }
	/** The displayed timeline and commands must name the same physical target. */
	public get runtimeTransport(): RuntimeTransport | undefined { return undefined; }
	/** Update this view's live capture latch; its transport owns physical execution. */
	public setRuntimeCaptureRunning?(running: boolean): void;
	/** Current-font client minimum beside the game; panes already presenting scanout opt out. */
	public abstract get companionGameMinimumWidth(): number | undefined;

	/** Optional selection capability; editors without one still have an input identity. */
	public getSelection?(): EditorPaneSelection;
	private inputValue: TInput | null = null;
	protected get hasInput(): boolean { return this.inputValue !== null; }

	public get input(): TInput {
		return this.inputValue!;
	}

	public setInput(input: TInput, bounds: Readonly<RectBounds>, selection?: EditorTextSelection, navigationSelection?: EditorPaneSelection): void {
		this.inputValue = input;
		this.contentBounds = bounds;
		this.activate();
		this.setOptions(selection, navigationSelection);
	}

	/** Selection options belong to the concrete view, never to input attachment. */
	public setOptions(_selection?: EditorTextSelection, _navigationSelection?: EditorPaneSelection): void {
	}

	public clearInput(): void {
		this.inputValue = null;
	}

	protected abstract activate(): void;

	public abstract focus(): void;

	public abstract dispose(): void;

	public update(_deltaSeconds: number): void {
	}

	/** The editor group publishes content geometry, distinct from the physical canvas. */
	public layout(bounds: Readonly<RectBounds>): void { this.contentBounds = bounds; }

	public abstract draw(): void;

	public abstract handleKeyboard(event: KeyInputEvent): void;

	public handleGamepad(_input: PlayerInput): void {}

	public abstract handlePointer(
		snapshot: PointerInputSnapshot,
		justPressed: boolean,
		pointerSecondaryJustPressed: boolean,
		now: number,
		gotoModifierActive: boolean,
	): void;

	public abstract handleWheel(event: WheelInputSnapshot): void;

	public abstract drawStatusBar(bounds: Readonly<RectBounds>, textColor: number): void;
}
