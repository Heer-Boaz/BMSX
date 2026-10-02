import { valueTag, ValueTag } from '../../../../machine/ts/machine/cpu/value';
import type { SuspendedGuestSession, SuspendedGuestValue } from '../../../runtime/suspended_guest';
import type { WorkbenchPropertyElement, WorkbenchPropertyTree } from '../../ui/property_tree';
import { appendWorkbenchTreeNode, rebuildWorkbenchTreeRows, type WorkbenchTreeNode } from '../../ui/tree_view';

type Property = WorkbenchPropertyElement & { kind: 'group' | 'property'; value: string; description: string };
type Node = WorkbenchTreeNode<WorkbenchPropertyElement>;
type ValueRow = {
	tag: ValueTag;
	scalar: number;
	seen: number;
	entries?: Map<ValueTag, Map<number, Node>>;
};

/** A live variables tree retains typed keys and display state, never borrowed guest values. */
export class RuntimeValueTree {
	private readonly values = new WeakMap<Node, ValueRow>();
	private topologyChanged = false;
	private generation = 0;
	public constructor(private readonly tree: WorkbenchPropertyTree<WorkbenchPropertyElement>, private readonly guest: SuspendedGuestSession) {}

	public updateRoot(index: number, label: string, value: SuspendedGuestValue, description: string): void {
		let node = this.tree.roots[index];
		if (node === undefined) node = this.append(null, label);
		this.update(node, value, description);
	}

	public finish(rootCount: number): void {
		if (this.tree.roots.length !== rootCount) { this.tree.roots.length = rootCount; this.topologyChanged = true; }
		if (this.topologyChanged) {
			rebuildWorkbenchTreeRows(this.tree, this.tree.rows[this.tree.selectionIndex] ?? null);
			this.tree.textDirty = true;
			this.topologyChanged = false;
		}
	}

	private append(parent: Node | null, label: string): Node {
		this.topologyChanged = true;
		const node = appendWorkbenchTreeNode<WorkbenchPropertyElement>(this.tree, parent, { kind: 'property', label, value: '', description: '',
			warning: false, displayLabel: '', displayValue: '', displayValueLeft: 0 }, true);
		this.values.set(node, { tag: ValueTag.Nil, scalar: 0, seen: 0 });
		return node;
	}

	private update(node: Node, value: SuspendedGuestValue, description: string): void {
		const row = this.values.get(node)!, tag = valueTag(value), scalar = this.guest.identityScalar(value, tag);
		const changed = row.tag !== tag || row.scalar !== scalar;
		if (changed) {
			row.tag = tag; row.scalar = scalar; row.entries?.clear();
			if (node.children.length !== 0) { node.children.length = 0; this.topologyChanged = true; }
		}
		const element = node.element as Property;
		let cycle = false;
		if (tag === ValueTag.Table) for (let parent = node.parent; parent !== null; parent = parent.parent) {
			const ancestor = this.values.get(parent)!;
			if (ancestor.tag === ValueTag.Table && ancestor.scalar === scalar) { cycle = true; break; }
		}
		const display = tag === ValueTag.Table ? `${this.guest.previewValue(value, 1, 3)}${cycle ? ' (cycle)' : ''}`
			: changed || element.value === '' ? this.guest.formatValue(value) : element.value;
		if (element.value !== display || element.description !== description) {
			element.value = display; element.description = description;
			this.tree.textDirty = true;
		}
		element.kind = tag === ValueTag.Table ? 'group' : 'property';
		node.expandable = tag === ValueTag.Table && !cycle;
		if (!node.expandable || node.collapsed) return;
		const entries = row.entries ??= new Map<ValueTag, Map<number, Node>>();
		const generation = ++this.generation;
		let count = 0;
		this.guest.visitTableEntries(value, (key, entry) => {
			const keyTag = valueTag(key), keyScalar = this.guest.identityScalar(key, keyTag);
			let byScalar = entries.get(keyTag);
			if (byScalar === undefined) { byScalar = new Map(); entries.set(keyTag, byScalar); }
			let child = byScalar.get(keyScalar);
			if (child === undefined) {
				const keyText = this.guest.formatValue(key);
				child = this.append(node, keyTag === ValueTag.String ? keyText : `[${keyText}${keyTag === ValueTag.Table ? ` #${keyScalar}` : ''}]`);
				byScalar.set(keyScalar, child);
			}
			this.values.get(child)!.seen = generation;
			if (node.children[count] !== child) { node.children[count] = child; this.topologyChanged = true; }
			count++;
			this.update(child, entry, this.guest.formatValue(entry));
		});
		if (node.children.length !== count) { node.children.length = count; this.topologyChanged = true; }
		for (const [keyTag, byScalar] of entries) {
			for (const [keyScalar, child] of byScalar) if (this.values.get(child)!.seen !== generation) byScalar.delete(keyScalar);
			if (byScalar.size === 0) entries.delete(keyTag);
		}
	}
}
