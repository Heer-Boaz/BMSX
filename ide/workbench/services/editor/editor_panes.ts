import type { EditorTextSelection } from '../../../editor/navigation/text_selection';
import type { EditorInput, EditorInputKind } from '../../ui/tab/model';
import type { EditorPane } from './editor_pane';
import { inputFocus } from '../../../input/focus';
import { pointerCapture } from '../../../input/pointer/capture';

export type EditorPaneFactories = {
	[TKind in EditorInputKind]: () => EditorPane<Extract<EditorInput, { kind: TKind }>>;
};

/** Owns the active editor pane and its input lifecycle for one editor group. */
export class EditorPanes {
	private readonly panes = new Map<EditorInputKind, EditorPane<EditorInput>>();
	private activePaneValue: EditorPane<EditorInput> | null = null;

	public constructor(private readonly factories: EditorPaneFactories) {
	}

	public get activePane(): EditorPane<EditorInput> {
		return this.activePaneValue!;
	}

	public openEditor(input: EditorInput, selection?: EditorTextSelection): void {
		const activePane = this.activePaneValue;
		if (activePane !== null && activePane.input === input) {
			activePane.setOptions(selection);
			activePane.focus();
			return;
		}
		this.clearEditor();
		const pane = this.getOrCreatePane(input);
		this.activePaneValue = pane;
		pane.setInput(input, selection);
		pane.focus();
	}

	public clearEditor(): void {
		const activePane = this.activePaneValue;
		if (activePane === null) {
			return;
		}
		pointerCapture.cancel();
		inputFocus.setTarget(null);
		activePane.clearInput();
		this.activePaneValue = null;
	}

	public dispose(): void {
		this.clearEditor();
		for (const pane of this.panes.values()) pane.dispose();
		this.panes.clear();
	}

	private getOrCreatePane(input: EditorInput): EditorPane<EditorInput> {
		let pane = this.panes.get(input.kind);
		if (pane === undefined) {
			pane = this.factories[input.kind]();
			this.panes.set(input.kind, pane);
		}
		return pane;
	}
}
