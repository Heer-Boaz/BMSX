import type { ResourceIdentity } from '../../../common/resource';
import { computeSourceLabel } from '../../../common/paths';
import { CallHierarchyDirection, type CallHierarchyModel, type CallHierarchyNode } from '../../../editor/contrib/call_hierarchy/model';
import type { LuaSourceRange } from '../../../../toolchain/ts/lua/syntax/ast';
import { ScrollableWorkbenchTree } from '../../ui/scrollable_tree';
import { appendWorkbenchTreeNode, navigateWorkbenchTree, rebuildWorkbenchTreeRows, setWorkbenchTreeCollapsed,
	WorkbenchTreeNavigationResult, type WorkbenchTreeNavigation, type WorkbenchTreeNode } from '../../ui/tree_view';
import { revealWorkbenchListSelection } from '../../ui/list_view';

export type CallHierarchyElement = {
	readonly node: CallHierarchyNode | undefined;
	readonly range: LuaSourceRange;
	readonly resource: ResourceIdentity;
	readonly text: string;
	readonly label: string;
	readonly tooltip: string;
	readonly status: string;
	displayText: string;
};

/** One direction's lazy topology and reading state over an immutable query observation. */
export class CallHierarchyTree extends ScrollableWorkbenchTree<CallHierarchyElement> {
	public revision = 0;
	private readonly resolved = new Set<WorkbenchTreeNode<CallHierarchyElement>>();
	private readonly changeListeners = new Set<() => void>();
	public onDidChange(listener: () => void): () => void { this.changeListeners.add(listener); return () => this.changeListeners.delete(listener); }
	private changed(): void { for (const listener of this.changeListeners) listener(); }

	public constructor(private readonly model: CallHierarchyModel, public readonly direction: CallHierarchyDirection) {
		super();
		for (const root of model.roots) this.append(null, root);
		rebuildWorkbenchTreeRows(this, this.roots[0] ?? null);
		if (this.roots.length === 1 && this.roots[0].expandable) this.setCollapsed(0, false);
	}

	private append(parent: WorkbenchTreeNode<CallHierarchyElement> | null, node: CallHierarchyNode): void {
		const branch = appendWorkbenchTreeNode(this, parent, this.element(node.range, node), true, node.id);
		branch.expandable = this.model.hasChildren(node, this.direction);
	}

	private element(range: LuaSourceRange, node?: CallHierarchyNode): CallHierarchyElement {
		const resource = this.model.project.getResourceIdentity(range.path);
		const location = `${resource.path}:${range.start.line}:${range.start.column}`;
		const text = node === undefined ? `${computeSourceLabel(resource.path)}:${range.start.line}`
			: `${node.name} (${computeSourceLabel(resource.path)}:${range.start.line})`;
		return { node, range, resource, text, label: node?.name ?? text, tooltip: node === undefined ? location : `${node.name}\n${location}`,
			status: node === undefined ? location : `${node.name} | ${location}`, displayText: '' };
	}

	private resolve(branch: WorkbenchTreeNode<CallHierarchyElement>): void {
		if (this.resolved.has(branch)) return;
		this.resolved.add(branch);
		const node = branch.element.node!;
		for (const range of node.fromRanges) appendWorkbenchTreeNode(this, branch, this.element(range), false, range);
		if (node.kind === 'symbol') {
			const calls = this.direction === CallHierarchyDirection.CallsTo
				? this.model.resolveIncomingCalls(node) : this.model.resolveOutgoingCalls(node);
			for (const child of calls) this.append(branch, child);
		}
		branch.expandable = branch.children.length !== 0;
		this.revision++;
	}

	public setCollapsed(index: number, collapsed: boolean): void {
		const branch = this.rows[index];
		const revision = this.revision;
		if (!collapsed && branch.expandable) this.resolve(branch);
		if (setWorkbenchTreeCollapsed(this, index, collapsed)) this.revision++;
		if (revision !== this.revision) this.changed();
	}

	public navigate(command: WorkbenchTreeNavigation): void {
		const branch = this.rows[this.selectionIndex];
		const selected = this.selectionIndex, revision = this.revision;
		if (command === 'right' && branch?.expandable && branch.collapsed) this.resolve(branch);
		if (navigateWorkbenchTree(this, command) === WorkbenchTreeNavigationResult.Collapse) this.revision++;
		if (selected !== this.selectionIndex || revision !== this.revision) this.changed();
	}

	public select(index: number): void {
		if (this.selectionIndex === index) return;
		this.selectionIndex = index; revealWorkbenchListSelection(this); this.changed();
	}

	public restoreSelection(node: WorkbenchTreeNode<CallHierarchyElement> | undefined, scroll: number): void {
		for (let parent = node?.parent; parent != null; parent = parent.parent) parent.collapsed = false;
		rebuildWorkbenchTreeRows(this, node ?? null);
		this.scroll = scroll;
		this.revision++;
		this.changed();
	}
}
