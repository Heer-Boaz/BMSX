import { ScrollableWorkbenchTree } from '../../ui/scrollable_tree';
import { appendWorkbenchTreeNode, navigateWorkbenchTree, rebuildWorkbenchTreeRows, setWorkbenchTreeCollapsed,
	WorkbenchTreeNavigationResult, type WorkbenchTreeNavigation, type WorkbenchTreeNode } from '../../ui/tree_view';
import { revealWorkbenchListSelection } from '../../ui/list_view';
import type { WorkspaceTextSearchFile, WorkspaceTextSearchMatch } from './search';

export type WorkspaceSearchElement = {
	readonly file: WorkspaceTextSearchFile;
	readonly match: WorkspaceTextSearchMatch | undefined;
};

/** File grouping and reading state over captured observations; snippets are formatted only when visible. */
export class WorkspaceSearchTree extends ScrollableWorkbenchTree<WorkspaceSearchElement> {
	private files: readonly WorkspaceTextSearchFile[] | undefined;
	private fileCount = 0;
	private readonly listeners = new Set<() => void>();
	public onDidChange(listener: () => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }
	private changed(): void { for (const listener of this.listeners) listener(); }
	public clear(): void {
		this.files = undefined; this.fileCount = 0; this.roots.length = 0; this.rows.length = 0;
		this.selectionIndex = this.hoverIndex = -1; this.scroll = 0;
	}
	public sync(files: readonly WorkspaceTextSearchFile[]): void {
		if (files !== this.files) { this.clear(); this.files = files; }
		if (this.fileCount > 0) this.appendMatches(this.roots[this.fileCount - 1]);
		for (; this.fileCount < files.length; this.fileCount++) {
			const file = files[this.fileCount];
			const root = appendWorkbenchTreeNode(this, null, { file, match: undefined });
			this.rows.push(root);
			this.appendMatches(root);
		}
	}
	private appendMatches(root: WorkbenchTreeNode<WorkspaceSearchElement>): void {
		const file = root.element.file;
		for (let index = root.children.length; index < file.matches.length; index++) {
			const child = appendWorkbenchTreeNode(this, root, { file, match: file.matches[index] });
			if (!root.collapsed) this.rows.push(child);
		}
	}
	public select(index: number): void {
		if (index === this.selectionIndex) return;
		this.selectionIndex = index; revealWorkbenchListSelection(this); this.changed();
	}
	public setCollapsed(index: number, collapsed: boolean): void {
		if (setWorkbenchTreeCollapsed(this, index, collapsed)) this.changed();
	}
	public navigate(command: WorkbenchTreeNavigation): void {
		if (navigateWorkbenchTree(this, command) !== WorkbenchTreeNavigationResult.None) this.changed();
	}
	public restore(node: WorkbenchTreeNode<WorkspaceSearchElement> | undefined, scroll: number): void {
		for (let parent = node?.parent; parent != null; parent = parent.parent) parent.collapsed = false;
		rebuildWorkbenchTreeRows(this, node ?? null); this.scroll = scroll; this.changed();
	}
}
