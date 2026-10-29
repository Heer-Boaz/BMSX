import type { BehaviorSourceRowKey } from './model';
import type { BehaviorTreeSourceDefinition, BehaviorTreeSourceMember, BehaviorTreeSourceNode } from './behavior_tree_model';
import { SourceTableIssue } from './source';

export type BehaviorTreeSourceIndex = {
	readonly members: ReadonlyMap<BehaviorSourceRowKey, BehaviorTreeSourceMember>;
	readonly edges: ReadonlySet<BehaviorSourceRowKey>;
};
const indices = new WeakMap<BehaviorTreeSourceDefinition, BehaviorTreeSourceIndex>();

/** Authored list membership, shared by graph commands and nonvisual source operations. */
export function indexBehaviorTreeSource(definition: BehaviorTreeSourceDefinition): BehaviorTreeSourceIndex {
	const existing = indices.get(definition);
	if (existing !== undefined) return existing;
	const members = new Map<BehaviorSourceRowKey, BehaviorTreeSourceMember>();
	const edges = new Set<BehaviorSourceRowKey>();
	function visit(node: BehaviorTreeSourceNode, orderedAncestors: boolean): void {
		if (node.kind === 'dynamic') return;
		for (const branch of node.branches) {
			if (branch.role !== 'children' && branch.role !== 'choices') {
				edges.add(branch.node.rowKey); visit(branch.node, orderedAncestors); continue;
			}
			const ordered = branch.source.kind !== 'dynamic' && branch.source.issues === SourceTableIssue.None;
			const admitMembers = orderedAncestors && ordered;
			// Structural edits require ordered ancestry. Each source edge depends
			// only on its particular local relationship, not its ancestor's membership.
			edges.add(branch.source.rowKey);
			for (let index = 0; index < branch.entries.length; index++) {
				const entry = branch.entries[index];
				if (ordered) edges.add(entry.node.rowKey);
				if (admitMembers) {
					const member = { file: branch.source.file, table: branch.source.table, branch, index };
					members.set(entry.node.rowKey, member);
					if (entry.node.kind === 'section') members.set(entry.node.child.rowKey, member);
				}
				if (entry.node.kind === 'section') {
					visit(entry.node.child, admitMembers);
				} else visit(entry.node, admitMembers);
			}
		}
	}
	if (definition.root !== null) { edges.add(definition.root.rowKey); visit(definition.root, true); }
	const index = { members, edges };
	indices.set(definition, index);
	return index;
}
