import type { KeyInputEvent } from '../../../../hosts/common/input/text';
import type { PlayerInput } from '../../../../hosts/common/input/player';
import type { RectBounds } from '../../../../machine/ts/common/rect';
import type { PointerInputSnapshot, WheelInputSnapshot } from '../../../common/models';
import type { EditorTextSelection } from '../../../editor/navigation/text_selection';
import type { EditorPaneSelection } from './editor_selection';
import type { EditorInput } from '../../common/editor_inputs';
import { inputFocus, type InputFocusScope, type InputFocusTarget } from '../../../input/focus';
import type { EditorSourceLocation, EditorSourceLocationRequest } from '../../../editor/navigation/source_location';
import type { EditorFont } from '../../../editor/ui/view/font';

export type EditorPaneClearReason = 'deactivate' | 'move';

export type EditorPaneOpenOptions = {
	readonly selection?: EditorTextSelection;
	readonly navigationSelection?: EditorPaneSelection;
	readonly preserveFocus?: boolean;
	/** The requesting location can retire during model or attachment publication. */
	readonly isCurrent?: () => boolean;
};

/** Intrinsic constraints of one retained input, independent of any attached control. */
export type EditorPaneConstraints = { minimumWidth: number; minimumHeight: number; companionWidth: number | undefined };

/** Explicit contribution for clients with no intrinsic floor or optional companion presentation. */
export function measureUnconstrainedEditor(_input: EditorInput, _font: EditorFont, _companionRequested: boolean, target: EditorPaneConstraints): void {
	target.minimumWidth = 0; target.minimumHeight = 0; target.companionWidth = undefined;
}

/** Retained workbench control for one editor-input kind. */
export abstract class EditorPane<TInput extends EditorInput> {
	/** Root chrome addresses the attached client, independently of the last keyboard-focused leaf. */
	public abstract get commandTarget(): InputFocusTarget;
	/** Scope of a concrete control borrowed by this pane, when separate from its group scope. */
	public get inputScope(): InputFocusScope | undefined { return undefined; }
	protected contentBounds!: Readonly<RectBounds>;
	/** Attached transient chrome may extend the contribution's intrinsic height; prospective views do not inherit it. */
	public get minimumClientHeight(): number { return 0; }

	/** Optional selection capability; editors without one still have an input identity. */
	public getSelection?(): EditorPaneSelection;
	/** The contribution owns source meaning and the canonical generation behind its selection. */
	public getSourceLocation?(): EditorSourceLocation | undefined | Promise<EditorSourceLocation | undefined>;
	/** Cheap selection capability; command presentation must not resolve or read source. */
	public get canOpenSource(): boolean { return this.getSourceLocation !== undefined; }
	/** Contributions with semantic sub-selection capture its real lifetime before draft publication. */
	public captureSourceLocation(): EditorSourceLocationRequest | undefined {
		return this.canOpenSource ? { readLocation: () => this.getSourceLocation!() } : undefined;
	}
	private inputValue: TInput | null = null;
	protected get hasInput(): boolean { return this.inputValue !== null; }

	public get input(): TInput {
		return this.inputValue!;
	}

	public setInput(input: TInput, bounds: Readonly<RectBounds>, options: EditorPaneOpenOptions = {}): void {
		if (options.isCurrent?.() === false || options.navigationSelection?.isDisposed) return;
		this.inputValue = input;
		this.contentBounds = bounds;
		this.activate();
		if (this.inputValue !== input || options.isCurrent?.() === false || options.navigationSelection?.isDisposed) return;
		this.setOptions(options.selection, options.navigationSelection);
	}

	/** Selection options belong to the concrete view, never to input attachment. */
	public setOptions(_selection?: EditorTextSelection, _navigationSelection?: EditorPaneSelection): void {
	}

	public clearInput(_reason: EditorPaneClearReason = 'deactivate'): void {
		this.inputValue = null;
	}

	protected abstract activate(): void;

	public abstract focus(): void;

	/** Continue only for this input's unchanged attachment and completed concrete focus request. */
	protected focusInput(input: TInput): boolean {
		if (this.inputValue !== input) return false;
		const target = this.commandTarget, scope = target.scope, context = scope.contextGeneration;
		return target.focus() && scope.contextGeneration === context && inputFocus.admittedTarget === target;
	}

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
