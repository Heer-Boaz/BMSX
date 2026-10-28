import { EditorPaneSelection } from '../../services/editor/editor_selection';
import type { CallHierarchyInput } from './editor_input';

/** Selection refers to retained query topology, never a reusable pane or current source AST. */
export class CallHierarchyNavigationSelection extends EditorPaneSelection {
	public readonly tree;
	public readonly node;
	public readonly scroll: number;
	public constructor(input: CallHierarchyInput) {
		super();
		this.tree = input.tree;
		this.node = input.tree.rows[input.tree.selectionIndex];
		this.scroll = input.tree.scroll;
	}
	public matches(other: CallHierarchyNavigationSelection): boolean { return this.tree === other.tree && this.node === other.node; }
	public restore(input: CallHierarchyInput): void {
		input.setDirection(this.tree.direction);
		input.tree.restoreSelection(this.node, this.scroll);
	}
}
