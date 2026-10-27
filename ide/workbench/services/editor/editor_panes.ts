import type { EditorPaneSelection } from './editor_selection';
import type { EditorTextSelection } from '../../../editor/navigation/text_selection';
import type { EditorInput, EditorInputKind } from '../../ui/tab/model';
import type { EditorPane, EditorPaneClearReason } from './editor_pane';
import type { EditorGroupView } from './editor_group';
import { inputFocus, type InputFocusScope } from '../../../input/focus';
import { pointerCapture } from '../../../input/pointer/capture';
import { create_rect_bounds, write_rect_bounds, type RectBounds } from '../../../../machine/ts/common/rect';

export type EditorPaneFactories = {
	[TKind in EditorInputKind]: (group: EditorGroupView) => EditorPane<Extract<EditorInput, { kind: TKind }>>;
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
	private readonly showListeners = new Set<(options: EditorPaneOpenOptions) => void>();
	private readonly disposeListeners = new Set<() => void>();
	private openGenerationValue = 0;
	private layoutRevision = 0;
	public readonly contentBounds = create_rect_bounds();
	private readonly contentClip = create_rect_bounds();

	public layout(bounds: Readonly<RectBounds>, clip: Readonly<RectBounds> = bounds): void {
		const current = this.contentBounds, previousClip = this.contentClip;
		if (current.left === bounds.left && current.top === bounds.top && current.right === bounds.right && current.bottom === bounds.bottom
			&& previousClip.left === clip.left && previousClip.top === clip.top && previousClip.right === clip.right && previousClip.bottom === clip.bottom) return;
		write_rect_bounds(current, bounds.left, bounds.top, bounds.right, bounds.bottom);
		write_rect_bounds(previousClip, clip.left, clip.top, clip.right, clip.bottom);
		this.layoutRevision++;
		this.activePaneValue?.layout(current);
	}

	/** The container arranges the attached input before native input and focus can enter it. */
	public onWillShowEditor(listener: (options: EditorPaneOpenOptions) => void): () => void {
		this.showListeners.add(listener);
		return () => this.showListeners.delete(listener);
	}

	/** Resolution can await storage; only the latest opening may attach its input. */
	public beginOpen(): number { return ++this.openGenerationValue; }
	public get openGeneration(): number { return this.openGenerationValue; }

	public onDidClearEditor(listener: () => void): () => void {
		this.clearListeners.add(listener);
		return () => this.clearListeners.delete(listener);
	}

	public readonly focusScope: InputFocusScope;
	public constructor(private readonly factories: EditorPaneFactories, private readonly group: EditorGroupView) {
		this.focusScope = group.focusScope;
	}

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
		const focusRevision = inputFocus.revision;
		this.openGenerationValue += 1;
		const activePane = this.activePaneValue;
		const reusing = activePane !== null && activePane.input === input;
		let pane: EditorPane<EditorInput>;
		if (reusing) {
			// Finish the focused control's draft against its current selection.
			// Reselecting a tab is focus, not another activation of its input.
			if (selection !== undefined || navigationSelection !== undefined) {
				if (inputFocus.target?.scope.surfaceScope === this.focusScope.surfaceScope
					|| activePane.inputScope !== undefined && inputFocus.target?.scope === activePane.inputScope) inputFocus.setTarget(null);
			}
			activePane.setOptions(selection, navigationSelection);
			pane = activePane;
		} else {
			const generation = this.clearEditor();
			if (this.openGenerationValue !== generation) return;
			pane = this.getOrCreatePane(input);
			this.activePaneValue = pane;
			pane.setInput(input, this.contentBounds, selection, navigationSelection);
		}
		if (this.activePaneValue !== pane || pane.input !== input) return;
		const layoutRevision = this.layoutRevision;
		for (const listener of this.showListeners) {
			listener(options);
			if (this.activePaneValue !== pane || pane.input !== input) return;
		}
		if (!reusing && this.layoutRevision === layoutRevision) pane.layout(this.contentBounds);
		if (!preserveFocus && (inputFocus.revision === focusRevision || inputFocus.target === null)) pane.focus();
	}

	/** The receipt names this clear, independently of openings performed by its observers. */
	public clearEditor(reason: EditorPaneClearReason = 'deactivate'): number {
		const generation = ++this.openGenerationValue;
		const activePane = this.activePaneValue;
		if (activePane === null) {
			return generation;
		}
		pointerCapture.cancelScope(this.focusScope.surfaceScope);
		if (inputFocus.target?.scope.surfaceScope === this.focusScope.surfaceScope
			|| activePane.inputScope !== undefined && inputFocus.target?.scope === activePane.inputScope) inputFocus.setTarget(null);
		activePane.clearInput(reason);
		if (inputFocus.target?.scope.surfaceScope === this.focusScope.surfaceScope
			|| activePane.inputScope !== undefined && inputFocus.target?.scope === activePane.inputScope) inputFocus.setTarget(null);
		this.activePaneValue = null;
		this.focusScope.retireContext();
		for (const listener of this.clearListeners) listener();
		return generation;
	}

	public dispose(): void {
		for (const listener of this.disposeListeners) listener();
		this.disposeListeners.clear();
		this.clearEditor();
		for (const pane of this.panes.values()) pane.dispose();
		this.panes.clear();
		this.clearListeners.clear();
		this.showListeners.clear();
	}

	private getOrCreatePane(input: EditorInput): EditorPane<EditorInput> {
		let pane = this.panes.get(input.kind);
		if (pane === undefined) {
			pane = this.factories[input.kind](this.group);
			this.panes.set(input.kind, pane);
		}
		return pane;
	}
}
