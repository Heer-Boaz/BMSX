import type { BehaviorSourceRowKey } from './model';
import type { BehaviorTreeSourceDefinition, BehaviorTreeSourceMember, BehaviorTreeSourceNode } from './behavior_tree_model';
import { SourceTableIssue } from './source';

const indices = new WeakMap<BehaviorTreeSourceDefinition, ReadonlyMap<BehaviorSourceRowKey, BehaviorTreeSourceMember>>();

/** Authored list membership, shared by graph commands and nonvisual source operations. */
export function indexBehaviorTreeMembers(definition: BehaviorTreeSourceDefinition): ReadonlyMap<BehaviorSourceRowKey, BehaviorTreeSourceMember> {
	const existing = indices.get(definition);
	if (existing !== undefined) return existing;
	const members = new Map<BehaviorSourceRowKey, BehaviorTreeSourceMember>();
	function visit(node: BehaviorTreeSourceNode): void {
		if (node.kind === 'dynamic') return;
		for (const branch of node.branches) {
			if (branch.role !== 'children' && branch.role !== 'choices') { visit(branch.node); continue; }
			// Unknown membership hides nested graph operations too. A dynamic member
			// of a proven list is different: the written list entry is still editable.
			if (branch.source.kind === 'dynamic' || branch.source.issues !== SourceTableIssue.None) continue;
			for (let index = 0; index < branch.entries.length; index++) {
				const entry = branch.entries[index];
				const member = { file: branch.source.file, table: branch.source.table, branch, index };
				members.set(entry.node.rowKey, member);
				if (entry.node.kind === 'section') {
					members.set(entry.node.child.rowKey, member);
					visit(entry.node.child);
				} else visit(entry.node);
			}
		}
	}
	if (definition.root !== null) visit(definition.root);
	indices.set(definition, members);
	return members;
}
