import type { EditorPaneSelection } from './editor_selection';
import type { EditorTextSelection } from '../../../editor/navigation/text_selection';
import type { EditorInput, EditorInputKind } from '../../ui/tab/model';
import type { EditorPane } from './editor_pane';
import { inputFocus, type InputFocusScope } from '../../../input/focus';
import { pointerCapture } from '../../../input/pointer/capture';
import { create_rect_bounds, write_rect_bounds, type RectBounds } from '../../../../machine/ts/common/rect';

export type EditorPaneFactories = {
	[TKind in EditorInputKind]: (scope: InputFocusScope) => EditorPane<Extract<EditorInput, { kind: TKind }>>;
};

export type EditorPaneOpenOptions = {
	readonly selection?: EditorTextSelection;
	readonly navigationSelection?: EditorPaneSelection;
	readonly preserveFocus?: boolean;
};

/** Owns the active editor pane and its input lifecycle for one editor group. */
export class EditorPanes {
	private readonly panes = new Map<EditorInputKind, EditorPane<EditorInput>>();
	private activePaneValue: EditorPane<EditorInput> | null = null;
	private readonly clearListeners = new Set<() => void>();
	private readonly disposeListeners = new Set<() => void>();
	private openGenerationValue = 0;
	private readonly contentBounds = create_rect_bounds();

	public layout(bounds: Readonly<RectBounds>): void {
		const current = this.contentBounds;
		if (current.left === bounds.left && current.top === bounds.top && current.right === bounds.right && current.bottom === bounds.bottom) return;
		write_rect_bounds(current, bounds.left, bounds.top, bounds.right, bounds.bottom);
		this.activePaneValue?.layout(current);
	}

	/** Resolution can await storage; only the latest opening may attach its input. */
	public beginOpen(): number { return ++this.openGenerationValue; }
	public get openGeneration(): number { return this.openGenerationValue; }

	public onDidClearEditor(listener: () => void): () => void {
		this.clearListeners.add(listener);
		return () => this.clearListeners.delete(listener);
	}

	public constructor(private readonly factories: EditorPaneFactories, public readonly focusScope: InputFocusScope) {}

	/** Retire captured selections before the attached control and input are detached. */
	public onWillDispose(listener: () => void): () => void {
		this.disposeListeners.add(listener);
		return () => this.disposeListeners.delete(listener);
	}

	public get activePane(): EditorPane<EditorInput> | null {
		return this.activePaneValue;
	}

	/** Query an existing control without creating or activating an editor. */
	public getPane<TKind extends EditorInputKind>(kind: TKind): EditorPane<Extract<EditorInput, { kind: TKind }>> | undefined {
		return this.panes.get(kind) as EditorPane<Extract<EditorInput, { kind: TKind }>> | undefined;
	}

	public openEditor(input: EditorInput, options: EditorPaneOpenOptions = {}): void {
		const { selection, navigationSelection, preserveFocus } = options;
		this.openGenerationValue += 1;
		const activePane = this.activePaneValue;
		if (activePane !== null && activePane.input === input) {
			// Finish the focused control's draft against its current selection.
			// Reselecting a tab is focus, not another activation of its input.
			if (selection !== undefined || navigationSelection !== undefined) {
				if (inputFocus.target?.scope.surfaceScope === this.focusScope.surfaceScope
					|| activePane.inputScope !== undefined && inputFocus.target?.scope === activePane.inputScope) inputFocus.setTarget(null);
			}
			activePane.setOptions(selection, navigationSelection);
			if (!preserveFocus) activePane.focus();
			return;
		}
		this.clearEditor();
		const pane = this.getOrCreatePane(input);
		this.activePaneValue = pane;
		pane.setInput(input, this.contentBounds, selection, navigationSelection);
		pane.layout(this.contentBounds);
		if (!preserveFocus) pane.focus();
	}

	public clearEditor(): void {
		this.openGenerationValue += 1;
		const activePane = this.activePaneValue;
		if (activePane === null) {
			return;
		}
		pointerCapture.cancelScope(this.focusScope.surfaceScope);
		if (inputFocus.target?.scope.surfaceScope === this.focusScope.surfaceScope
			|| activePane.inputScope !== undefined && inputFocus.target?.scope === activePane.inputScope) inputFocus.setTarget(null);
		activePane.clearInput();
		if (inputFocus.target?.scope.surfaceScope === this.focusScope.surfaceScope
			|| activePane.inputScope !== undefined && inputFocus.target?.scope === activePane.inputScope) inputFocus.setTarget(null);
		this.activePaneValue = null;
		for (const listener of this.clearListeners) listener();
	}

	public dispose(): void {
		for (const listener of this.disposeListeners) listener();
		this.disposeListeners.clear();
		this.clearEditor();
		for (const pane of this.panes.values()) pane.dispose();
		this.panes.clear();
		this.clearListeners.clear();
	}

	private getOrCreatePane(input: EditorInput): EditorPane<EditorInput> {
		let pane = this.panes.get(input.kind);
		if (pane === undefined) {
			pane = this.factories[input.kind](this.focusScope);
			this.panes.set(input.kind, pane);
		}
		return pane;
	}
}
