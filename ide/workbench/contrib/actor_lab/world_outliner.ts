import type { Table } from '../../../../machine/ts/machine/cpu/table';
import type { SuspendedGuestSession } from '../../../runtime/suspended_guest';
import { ScrollableWorkbenchTree } from '../../ui/scrollable_tree';
import { appendWorkbenchTreeNode, rebuildWorkbenchTreeRows, type WorkbenchTreeNode } from '../../ui/tree_view';

export type WorldActorRow = {
	readonly hashId: number;
	label: string;
	parentHashId: number | undefined;
	arrayIndex: number;
	containsSelection: boolean;
	/** Reconciliation stamps and rows contain no borrowed guest handles. */
	seen: number;
	attached: boolean;
	row: WorkbenchTreeNode<WorldActorRow> | undefined;
};

function compareActors(a: WorkbenchTreeNode<WorldActorRow>, b: WorkbenchTreeNode<WorldActorRow>): number {
	return a.element.label < b.element.label ? -1 : a.element.label > b.element.label ? 1 : a.element.hashId - b.element.hashId;
}

/** Admitted World membership, independent of the selected actor's behavior inspector.
 * Structural producers invalidate it; motion, rendering and camera input do not. */
export class ActorWorldOutliner {
	public readonly tree = new ScrollableWorkbenchTree<WorldActorRow>();
	public revision = 0;
	private readonly members = new Map<number, WorldActorRow>();
	private worldHashId: number | undefined;
	private objectsRevision: number | undefined;
	private topologyRevision: number | undefined;
	private selection: WorkbenchTreeNode<WorldActorRow> | undefined;

	public invalidate(): void { this.objectsRevision = undefined; }
	public clear(): void {
		this.members.clear(); this.selection = undefined; this.worldHashId = undefined; this.objectsRevision = undefined; this.topologyRevision = undefined;
		this.tree.roots.length = 0; rebuildWorkbenchTreeRows(this.tree, null);
		this.tree.scroll = 0; this.tree.horizontalScrollbar.setScroll(0);
		this.revision++;
	}
	public update(guest: SuspendedGuestSession, world: Table | undefined, selectedHashId: number): boolean {
		if (world === undefined) {
			if (this.worldHashId === undefined) return false;
			this.clear(); return true;
		}
		if (world.hashId !== this.worldHashId) { this.clear(); this.worldHashId = world.hashId; }
		const objectsRevision = guest.readStringMember(world, '_objects_revision') as number;
		const topologyRevision = guest.readStringMember(guest.readStringMember(world, '_spatial_hierarchy'), '_topology_revision') as number;
		if (objectsRevision === this.objectsRevision && topologyRevision === this.topologyRevision) {
			const selectionChanged = this.updateSelection(selectedHashId, false);
			return this.refreshVisibleLabels(guest, world) || selectionChanged;
		}
		this.objectsRevision = objectsRevision; this.topologyRevision = topologyRevision;
		const tree = this.tree;
		const stamp = ++this.revision, objects = guest.readStringMember(world, '_objects') as Table;
		for (let i = 1; i <= objects.arrayLength; i++) {
			const actor = objects.getInteger(i) as Table, parent = guest.readStringMember(actor, 'parent') as Table | null;
			let entry = this.members.get(actor.hashId);
			if (entry === undefined) {
				entry = { hashId: actor.hashId, label: '', parentHashId: undefined, arrayIndex: i,
					containsSelection: false, seen: stamp, attached: false, row: undefined };
				this.members.set(actor.hashId, entry);
			}
			entry.label = guest.formatValue(guest.readStringMember(actor, 'id'));
			entry.parentHashId = parent === null ? undefined : parent.hashId;
			entry.arrayIndex = i;
			entry.seen = stamp; entry.attached = false;
			if (entry.row !== undefined) entry.row.children.length = 0;
		}
		for (const [id, entry] of this.members) if (entry.seen !== stamp) this.members.delete(id);
		tree.roots.length = 0;
		for (const entry of this.members.values()) this.attach(entry);
		for (const entry of this.members.values()) {
			const row = entry.row!;
			row.expandable = row.children.length !== 0;
		}
		this.updateSelection(selectedHashId, true);
		this.rebuildRows();
		return true;
	}
	/** Membership revisions bind a scalar slot once; selecting an actor does not
	 * search every live object again on each inspection. The borrow stays local. */
	public readActor(guest: SuspendedGuestSession, world: Table | undefined, hashId: number): Table | undefined {
		const entry = this.members.get(hashId);
		if (entry === undefined) return undefined;
		return (guest.readStringMember(world!, '_objects') as Table).getInteger(entry.arrayIndex) as Table;
	}
	public reveal(hashId: number): void {
		this.updateSelection(hashId, false);
		const row = this.members.get(hashId)?.row;
		if (row === undefined) { this.tree.selectionIndex = -1; return; }
		for (let parent = row.parent; parent !== null; parent = parent.parent) parent.collapsed = false;
		rebuildWorkbenchTreeRows(this.tree, row);
		this.tree.scrollbar.reveal(this.tree.selectionIndex, this.tree.selectionIndex + 1);
	}
	private updateSelection(hashId: number, topologyChanged: boolean): boolean {
		const selected = this.members.get(hashId)?.row;
		if (selected === this.selection && !topologyChanged) return false;
		for (let row = this.selection; row !== undefined && row !== null; row = row.parent) row.element.containsSelection = false;
		this.selection = selected;
		for (let row = selected; row !== undefined && row !== null; row = row.parent) row.element.containsSelection = true;
		return true;
	}
	private refreshVisibleLabels(guest: SuspendedGuestSession, world: Table): boolean {
		// Virtualized property bindings, not a World census: ordinary motion reads
		// only the already-bound visible slots and never rebuilds the hierarchy.
		const tree = this.tree, objects = guest.readStringMember(world, '_objects') as Table;
		const first = tree.scroll | 0, end = Math.min(tree.rows.length, first + tree.layout.visibleRowCount);
		let changed = false;
		for (let i = first; i < end; i++) {
			const entry = tree.rows[i].element, actor = objects.getInteger(entry.arrayIndex) as Table;
			const label = guest.formatValue(guest.readStringMember(actor, 'id'));
			if (entry.label !== label) { entry.label = label; changed = true; }
		}
		if (changed) { this.revision++; this.rebuildRows(); }
		return changed;
	}
	private rebuildRows(): void {
		const tree = this.tree, focused = tree.rows[tree.selectionIndex]?.element.hashId;
		const scroll = tree.scroll, anchor = tree.rows[scroll | 0]?.element.hashId;
		tree.roots.sort(compareActors);
		for (const entry of this.members.values()) entry.row!.children.sort(compareActors);
		const focusedRow = focused === undefined ? undefined : this.members.get(focused)?.row;
		rebuildWorkbenchTreeRows(tree, focusedRow === undefined ? null : focusedRow);
		if (anchor !== undefined) {
			const index = tree.rows.findIndex(row => row.element.hashId === anchor);
			if (index !== -1) tree.scroll = index + scroll - (scroll | 0);
		}
	}
	private attach(entry: WorldActorRow): WorkbenchTreeNode<WorldActorRow> {
		if (entry.attached) return entry.row!;
		// A pending parent outside admitted membership is not an Outliner row.
		const parentEntry = entry.parentHashId === undefined ? undefined : this.members.get(entry.parentHashId);
		const parent = parentEntry === undefined ? null : this.attach(parentEntry);
		const row = entry.row, depth = parent === null ? 0 : parent.depth + 1;
		if (row === undefined || row.parent !== parent || row.depth !== depth)
			entry.row = appendWorkbenchTreeNode(this.tree, parent, entry, row === undefined ? false : row.collapsed, entry.hashId);
		else (parent === null ? this.tree.roots : parent.children).push(row);
		entry.attached = true;
		return entry.row!;
	}
}
