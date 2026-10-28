import { EditorPaneSelection } from '../../services/editor/editor_selection';
import type { WorkspaceSearchInput } from './editor_input';

/** Navigation retains an observation, never an editable source range or a control attachment. */
export class WorkspaceSearchNavigationSelection extends EditorPaneSelection {
	private readonly query: string;
	private readonly files;
	private readonly selected;
	private readonly scroll: number;
	public constructor(input: WorkspaceSearchInput) {
		super(); this.query = input.query; this.files = input.search.files;
		this.selected = input.tree.rows[input.tree.selectionIndex]; this.scroll = input.tree.scroll;
		this.add({ dispose: input.onDidChange(() => {
			if (input.query !== this.query || input.search.files !== this.files) this.dispose();
		}) });
	}
	public matches(other: WorkspaceSearchNavigationSelection): boolean { return this.query === other.query && this.files === other.files && this.selected === other.selected; }
	public restore(input: WorkspaceSearchInput): void {
		input.tree.restore(this.selected, this.scroll);
	}
}
