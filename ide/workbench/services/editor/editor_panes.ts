import type { EditorTextSelection } from '../../../editor/navigation/text_selection';
import type { EditorTabDescriptor, EditorTabKind } from '../../ui/tab/model';
import type { EditorPane } from './editor_pane';

export type EditorPaneFactories = {
	[TKind in EditorTabKind]: () => EditorPane<Extract<EditorTabDescriptor, { kind: TKind }>>;
};

/** Owns the active editor pane and its input lifecycle for one editor group. */
export class EditorPanes {
	private readonly panes = new Map<EditorTabKind, EditorPane<EditorTabDescriptor>>();
	private activePaneValue: EditorPane<EditorTabDescriptor> | null = null;

	public constructor(private readonly factories: EditorPaneFactories) {
	}

	public get activePane(): EditorPane<EditorTabDescriptor> {
		return this.activePaneValue!;
	}

	public openEditor(input: EditorTabDescriptor, selection?: EditorTextSelection): void {
		const activePane = this.activePaneValue;
		if (activePane !== null && activePane.input === input) {
			activePane.setOptions(selection);
			return;
		}
		if (activePane !== null) {
			activePane.clearInput();
		}
		const pane = this.getOrCreatePane(input);
		this.activePaneValue = pane;
		pane.setInput(input, selection);
	}

	public clearEditor(): void {
		const activePane = this.activePaneValue;
		if (activePane === null) {
			return;
		}
		activePane.clearInput();
		this.activePaneValue = null;
	}

	private getOrCreatePane(input: EditorTabDescriptor): EditorPane<EditorTabDescriptor> {
		let pane = this.panes.get(input.kind);
		if (pane === undefined) {
			pane = this.factories[input.kind]();
			this.panes.set(input.kind, pane);
		}
		return pane;
	}
}
