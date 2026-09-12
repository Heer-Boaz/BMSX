import type { LuaTableConstructorExpression } from '../../../../toolchain/ts/lua/syntax/ast';
import type { FileSemanticData } from '../../../../toolchain/ts/lua/semantic/model';
import { LuaRelocationAnalysis, type LuaRelocationBindingChange } from '../../../../toolchain/ts/lua/semantic/relocation';
import { sourcePositionInRange } from '../../../../toolchain/ts/lua/semantic/source_range';
import type { BehaviorSourceDocument } from './model';
import type { BehaviorTreeSourceAttachmentGroup, BehaviorTreeSourceList, BehaviorTreeSourceMember, BehaviorTreeSourceNode } from './behavior_tree_model';
import { SourceTableIssue } from './source';

export type BehaviorTreeSourceListUse = {
	readonly owner: Extract<BehaviorTreeSourceNode, { kind: 'node' }>;
	readonly branch: BehaviorTreeSourceList | BehaviorTreeSourceAttachmentGroup;
};

export type BehaviorTreeTransferRejection = 'syntax-incomplete' | 'list-incomplete' | 'owner-incomplete'
	| 'shared-role-conflict' | 'different-list-role' | 'different-write-resource' | 'same-list' | 'target-inside-source' | 'cycle' | 'subtree-incomplete';

export type BehaviorTreeTransferCheck =
	| { readonly kind: 'available'; readonly target: BehaviorTreeSourceList; readonly table: LuaTableConstructorExpression;
		readonly targetUses: readonly BehaviorTreeSourceListUse[] }
	| { readonly kind: 'unavailable'; readonly reason: BehaviorTreeTransferRejection }
	| { readonly kind: 'binding-change'; readonly changes: readonly LuaRelocationBindingChange[] };

type SourceListConsumers = {
	readonly uses: BehaviorTreeSourceListUse[];
	readonly role: BehaviorTreeSourceListUse['branch']['role'];
	issue: BehaviorTreeTransferRejection | undefined;
};

// Numeric metadata on a node/choice cannot replace its named topology fields.
const ambiguousTopology = SourceTableIssue.ComputedKey | SourceTableIssue.KnownMutation;

/**
 * One explicit source-operation analysis, independent of visible cards/folds.
 * Like LimboAI/Godot, check actual owners and descendants before a reparent;
 * unlike their instance trees, shared constructors' recognized list consumers participate.
 * No text edits, guest evaluation, layout or private document history.
 */
export class BehaviorTreeTransferAnalysis {
	public readonly listUses: readonly BehaviorTreeSourceListUse[];
	public readonly sourceUses: readonly BehaviorTreeSourceListUse[];
	private readonly consumers = new Map<LuaTableConstructorExpression, SourceListConsumers>();
	private readonly checks = new Map<BehaviorTreeSourceList, BehaviorTreeTransferCheck>();
	private readonly subtreeLists = new Set<LuaTableConstructorExpression>();
	private readonly subtreeComplete: boolean;
	private readonly bindings: LuaRelocationAnalysis;

	public constructor(private readonly document: BehaviorSourceDocument, public readonly file: FileSemanticData,
		public readonly member: BehaviorTreeSourceMember) {
		const uses: BehaviorTreeSourceListUse[] = [];
		for (const definition of document.definitions) {
			if (definition.behaviorKind === 'behavior_tree' && definition.root !== null) collectListUses(definition.root, uses);
		}
		this.listUses = uses;
		for (const use of uses) {
			if (use.branch.source.kind !== 'section') continue;
			const table = use.branch.source.table;
			const issue = use.branch.source.issues !== SourceTableIssue.None ? 'list-incomplete'
				: (use.owner.issues & ambiguousTopology) !== 0 ? 'owner-incomplete' : undefined;
			const group = this.consumers.get(table);
			if (group === undefined) this.consumers.set(table, { uses: [use], role: use.branch.role, issue });
			else {
				group.uses.push(use);
				if (group.role !== use.branch.role) group.issue = 'shared-role-conflict';
				else if (group.issue === undefined) group.issue = issue;
			}
		}
		this.sourceUses = this.consumers.get(member.table)!.uses;
		const entry = member.branch.entries[member.index];
		this.bindings = new LuaRelocationAnalysis(file, entry.field.range);
		const node = entry.node;
		this.subtreeComplete = node.kind === 'section'
			? (node.issues & ambiguousTopology) === 0 && collectSubtreeLists(node.child, this.subtreeLists, new Set())
			: collectSubtreeLists(node, this.subtreeLists, new Set());
	}

	/** First query computes evidence; repeated hover/enablement returns the retained result. */
	public checkTarget(target: BehaviorTreeSourceList): BehaviorTreeTransferCheck {
		let check = this.checks.get(target);
		if (check === undefined) {
			check = this.computeTarget(target);
			this.checks.set(target, check);
		}
		return check;
	}

	private computeTarget(target: BehaviorTreeSourceList): BehaviorTreeTransferCheck {
		if (!this.document.syntaxComplete) return { kind: 'unavailable', reason: 'syntax-incomplete' };
		if (target.source.kind === 'dynamic') return { kind: 'unavailable', reason: 'list-incomplete' };
		if (target.source.table.range.path !== this.member.table.range.path) return { kind: 'unavailable', reason: 'different-write-resource' };
		const targetConsumers = this.consumers.get(target.source.table)!;
		const sourceIssue = this.consumers.get(this.member.table)!.issue;
		if (sourceIssue !== undefined) return { kind: 'unavailable', reason: sourceIssue };
		const targetIssue = targetConsumers.issue;
		if (targetIssue !== undefined) return { kind: 'unavailable', reason: targetIssue };
		if (target.role !== this.member.branch.role) return { kind: 'unavailable', reason: 'different-list-role' };
		if (target.source.table === this.member.table) return { kind: 'unavailable', reason: 'same-list' };
		const field = this.member.branch.entries[this.member.index].field;
		const start = target.source.table.range.start;
		if (sourcePositionInRange(start.line, start.column, field.range)) return { kind: 'unavailable', reason: 'target-inside-source' };
		if (this.subtreeLists.has(target.source.table)) return { kind: 'unavailable', reason: 'cycle' };
		if (!this.subtreeComplete) return { kind: 'unavailable', reason: 'subtree-incomplete' };
		const changes = this.bindings.getBindingChangesAt(target.source.table.range.end);
		if (changes.length !== 0) return { kind: 'binding-change', changes };
		return { kind: 'available', target, table: target.source.table, targetUses: targetConsumers.uses };
	}
}

function collectListUses(node: BehaviorTreeSourceNode, uses: BehaviorTreeSourceListUse[]): void {
	if (node.kind === 'dynamic') return;
	for (const branch of node.attachments) uses.push({ owner: node, branch });
	for (const branch of node.branches) {
		if (branch.role === 'children') {
			uses.push({ owner: node, branch });
			for (const entry of branch.entries) collectListUses(entry.node, uses);
		} else if (branch.role === 'choices') {
			uses.push({ owner: node, branch });
			for (const entry of branch.entries) if (entry.node.kind === 'section') collectListUses(entry.node.child, uses);
		} else collectListUses(branch.node, uses);
	}
}

/** Follow only runtime child roles; callbacks/attachments do not become tree edges. */
function collectSubtreeLists(node: BehaviorTreeSourceNode, lists: Set<LuaTableConstructorExpression>, seen: Set<LuaTableConstructorExpression>): boolean {
	if (node.kind === 'dynamic' || (node.issues & ambiguousTopology) !== 0) return false;
	if (seen.has(node.table)) return true;
	seen.add(node.table);
	// Mirrors the actual node_program.lua dispatch, not a general-purpose BT catalog.
	switch (node.nodeType) {
		case 'sequence': case 'selector': case 'random_selector': case 'weighted_random_selector':
			if (node.branches.length !== 1) return false;
			break;
		case 'simple_parallel':
			if (node.branches.length !== 2) return false;
			break;
		case 'task': case 'timeline': case 'wait': case 'set_blackboard': case 'add_blackboard':
			return true;
		default: return false;
	}
	for (const branch of node.branches) {
		if (branch.role === 'children' || branch.role === 'choices') {
			if (branch.source.kind === 'dynamic' || branch.source.issues !== SourceTableIssue.None) return false;
			lists.add(branch.source.table);
			if (branch.role === 'children') {
				for (const entry of branch.entries) if (!collectSubtreeLists(entry.node, lists, seen)) return false;
			} else {
				for (const { node: choice } of branch.entries) {
					if (choice.kind === 'dynamic' || (choice.issues & ambiguousTopology) !== 0
						|| !collectSubtreeLists(choice.child, lists, seen)) return false;
				}
			}
		} else if (!collectSubtreeLists(branch.node, lists, seen)) return false;
	}
	return true;
}
