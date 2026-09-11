import type { BFont } from '../../../../machine/ts/render/shared/bitmap_font';
import type { LuaSourceRange, LuaTableField } from '../../../../toolchain/ts/lua/syntax/ast';
import { uppercaseOutsideStrings } from '../../../common/text';
import { createWorkbenchGraphNode } from '../../ui/graph/model';
import type { BehaviorTreeSourceDefinition, BehaviorTreeSourceMember, BehaviorTreeSourceNode } from './behavior_tree_model';
import type { BehaviorSourceNode, BehaviorSourceRowKey } from './model';
import type { BehaviorGraphDetail, BehaviorGraphProjection, BehaviorGraphNode } from './graph_model';
import { appendBehaviorGraphFields, appendBehaviorGraphSourceDetails } from './graph_details';
import { describeExpression, SourceTableIssue } from './source';

/** Cold projection from typed source relationships. No label parsing or execution inference. */
export function projectBehaviorTreeGraph(
	definition: BehaviorTreeSourceDefinition | null,
	font: BFont,
): BehaviorGraphProjection {
	const nodes: BehaviorGraphNode[] = [];
	const nodesBySource = new Map<BehaviorSourceRowKey, BehaviorGraphNode>();
	const links: { child: BehaviorGraphNode; source: BehaviorSourceNode; range: LuaSourceRange }[] = [];
	const pending: { source: Extract<BehaviorTreeSourceNode, { kind: 'node' }>; node: BehaviorGraphNode }[] = [];

	function card(source: BehaviorSourceNode, text: string, parent: BehaviorGraphNode | null,
		details: BehaviorGraphDetail[], range: LuaSourceRange, connectionSource = source,
		member: BehaviorTreeSourceMember | null = null): BehaviorGraphNode {
		const node: BehaviorGraphNode = { ...createWorkbenchGraphNode(font, uppercaseOutsideStrings(text), 0, 0),
			source, parent, member, details, children: [] };
		nodes.push(node);
		nodesBySource.set(source.rowKey, node);
		if (parent !== null) {
			parent.children.push(node);
			links.push({ child: node, source: connectionSource, range });
		}
		return node;
	}

	function behavior(source: BehaviorTreeSourceNode, parent: BehaviorGraphNode, role: string, range: LuaSourceRange,
		details: BehaviorGraphDetail[] = [], connectionSource: BehaviorSourceNode = source,
		member: BehaviorTreeSourceMember | null = null): void {
		let text = role;
		if (source.kind === 'node') {
			text = source.nodeType === null ? '<DYNAMIC TYPE>' : source.nodeType;
			if (role.length > 0) text += `\n${role}`;
			if (source.summary.length > 0) text += `\n${source.summary}`;
			if (source.referenceLabel.length > 0) text += `\n${source.referenceLabel}`;
			const relationships = new Set<LuaTableField>();
			for (const branch of source.branches) relationships.add(branch.field);
			for (const group of source.attachments) relationships.add(group.field);
			appendBehaviorGraphFields(details, source.table, 'NODE', relationships);
			for (const group of source.attachments) {
				const label = group.role === 'services' ? 'SVC' : 'DEC';
				const membershipKnown = group.source.kind === 'section' && group.source.issues === SourceTableIssue.None;
				text += `\n${label} ${membershipKnown ? group.entries.length : '?'}`;
				if (!membershipKnown) appendBehaviorGraphSourceDetails(details, group.source, group.role);
				else {
					for (const entry of group.entries) {
						if (entry.node.kind === 'dynamic') appendBehaviorGraphSourceDetails(details, entry.node, group.role);
						else appendBehaviorGraphFields(details, entry.node.table, `${label} ${entry.index}`);
					}
				}
			}
		} else {
			text = role.length === 0 ? source.label : `${role}\n${source.label}`;
			appendBehaviorGraphSourceDetails(details, source, 'UNRESOLVED');
		}
		if (source.resolution !== 'complete') text += '\n?';
		const node = card(source, text, parent, details, range, connectionSource, member);
		if (source.kind === 'node' && source.branches.length > 0) pending.push({ source, node });
	}

	if (definition !== null) {
		const details: BehaviorGraphDetail[] = [];
		if (definition.blackboard !== null) appendBehaviorGraphSourceDetails(details, definition.blackboard, 'BLACKBOARD');
		const root = card(definition, definition.label + (definition.root === null ? '\n? NO STATIC ROOT' : ''), null,
			details, definition.occurrenceRange);
		if (definition.root !== null) behavior(definition.root, root, '', definition.root.occurrenceRange);
		while (pending.length > 0) {
			const { source, node } = pending.pop()!;
			for (const branch of source.branches) {
				if (branch.role !== 'children' && branch.role !== 'choices') {
					behavior(branch.node, node, branch.role, branch.field.value.range);
					continue;
				}
				// A warning inside one member does not revoke the enclosing list's order.
				if (branch.source.kind === 'dynamic' || branch.source.issues !== SourceTableIssue.None) {
					const details: BehaviorGraphDetail[] = [];
					appendBehaviorGraphSourceDetails(details, branch.source, branch.role);
					card(branch.source, `${branch.role}\n? PARTIAL MEMBERSHIP`, node, details, branch.field.value.range);
					continue;
				}
				if (branch.role === 'children') {
					for (let index = 0; index < branch.entries.length; index += 1) {
						const entry = branch.entries[index];
						behavior(entry.node, node, '', entry.field.value.range, [], entry.node,
							{ table: branch.source.table, branch, index });
					}
				} else {
					for (let index = 0; index < branch.entries.length; index += 1) {
						const entry = branch.entries[index];
						const member = { table: branch.source.table, branch, index };
						const choice = entry.node;
						if (choice.kind === 'dynamic') {
							behavior(choice, node, 'CHOICE', entry.field.value.range, [], choice, member);
							continue;
						}
						const details: BehaviorGraphDetail[] = [];
						let label = 'CHOICE';
						if (choice.weight !== null) {
							const weight = describeExpression(choice.weight.value);
							label += `  W=${weight}`;
							details.push({ label: 'weight', description: weight, detail: 'CHOICE', range: choice.weight.value.range });
						} else label += '  W=?';
						if (choice.issues !== SourceTableIssue.None) label += ' ? SOURCE';
						behavior(choice.child, node, label, entry.field.value.range, details, choice, member);
					}
				}
			}
		}
	}
	return { font, nodes, nodesBySource, links };
}
