import { EditorPaneSelection } from '../../services/editor/editor_selection';
import { captureWorkbenchTreeView, restoreWorkbenchTreeView, type WorkbenchTreeViewSnapshot } from '../../ui/tree_view';
import type { AemEditorInput } from './editor_input';
import { projectAemSource } from './source';

/** Authored property identity and reading state survive another pane attachment. */
export class AemNavigationSelection extends EditorPaneSelection {
	private readonly view: WorkbenchTreeViewSnapshot;

	public constructor(input: AemEditorInput) {
		super();
		projectAemSource(input);
		this.view = captureWorkbenchTreeView(input.tree, element => element.key);
	}

	public matches(other: AemNavigationSelection): boolean {
		return this.view.selected === other.view.selected;
	}

	public restore(input: AemEditorInput): void {
		projectAemSource(input);
		restoreWorkbenchTreeView(input.tree, this.view, element => element.key);
	}
}
