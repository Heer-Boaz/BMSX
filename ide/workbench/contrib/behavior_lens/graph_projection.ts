import type { BFont } from '../../../../machine/ts/render/shared/bitmap_font';
import type { LuaSourceRange, LuaTableField } from '../../../../toolchain/ts/lua/syntax/ast';
import { uppercaseOutsideStrings } from '../../../common/text';
import { createWorkbenchGraphNode } from '../../ui/graph/model';
import type { BehaviorTreeSourceDefinition, BehaviorTreeSourceNode } from './behavior_tree_model';
import type { BehaviorSourceNode, BehaviorSourceRowKey } from './model';
import type { BehaviorGraphDetail, BehaviorGraphProjection, BehaviorGraphNode } from './graph_model';
import { appendBehaviorGraphFields, appendBehaviorGraphSourceDetails } from './graph_details';
import { describeExpression } from './source';

/** Cold projection from typed source relationships. No label parsing or execution inference. */
export function projectBehaviorTreeGraph(
	definition: BehaviorTreeSourceDefinition | null,
	collapsed: ReadonlySet<BehaviorSourceRowKey>,
	font: BFont,
): BehaviorGraphProjection {
	const nodes: BehaviorGraphNode[] = [];
	const nodesBySource = new Map<BehaviorSourceRowKey, BehaviorGraphNode>();
	const links: { child: BehaviorGraphNode; source: BehaviorSourceNode; range: LuaSourceRange }[] = [];
	const pending: { source: Extract<BehaviorTreeSourceNode, { kind: 'node' }>; node: BehaviorGraphNode }[] = [];

	function card(source: BehaviorSourceNode, text: string, parent: BehaviorGraphNode | null,
		expandable: boolean, details: BehaviorGraphDetail[], range: LuaSourceRange, connectionSource = source): BehaviorGraphNode {
		const node: BehaviorGraphNode = { ...createWorkbenchGraphNode(font, uppercaseOutsideStrings(text), 0, 0),
			source, parent, expandable, details, children: [] };
		nodes.push(node);
		nodesBySource.set(source.rowKey, node);
		if (parent !== null) {
			parent.children.push(node);
			links.push({ child: node, source: connectionSource, range });
		}
		return node;
	}

	function behavior(source: BehaviorTreeSourceNode, parent: BehaviorGraphNode, role: string, range: LuaSourceRange,
		details: BehaviorGraphDetail[] = [], connectionSource: BehaviorSourceNode = source): void {
		let expandable = false;
		let text = role;
		if (source.kind === 'node') {
			expandable = source.branches.length > 0;
			text += `\n${source.nodeType === null ? '<DYNAMIC TYPE>' : source.nodeType}`;
			if (source.referenceLabel.length > 0) text += `\n${source.referenceLabel}`;
			const relationships = new Set<LuaTableField>();
			for (const branch of source.branches) relationships.add(branch.field);
			for (const group of source.attachments) relationships.add(group.field);
			appendBehaviorGraphFields(details, source.table, 'NODE', relationships);
			for (const group of source.attachments) {
				const label = group.role === 'services' ? 'SVC' : 'DEC';
				text += `\n${label} ${group.source.resolution === 'complete' ? group.entries.length : '?'}`;
				if (group.source.resolution !== 'complete') appendBehaviorGraphSourceDetails(details, group.source, group.role);
				else {
					for (const entry of group.entries) {
						if (entry.node.kind === 'dynamic') appendBehaviorGraphSourceDetails(details, entry.node, group.role);
						else appendBehaviorGraphFields(details, entry.node.table, `${label} ${entry.index}`);
					}
				}
			}
		} else {
			text += `\n${source.label}`;
			appendBehaviorGraphSourceDetails(details, source, 'UNRESOLVED');
		}
		if (source.resolution !== 'complete') text += '\n? PARTIAL SOURCE';
		if (expandable) text += collapsed.has(source.rowKey) ? '\n+ CHILDREN' : '\n- CHILDREN';
		const node = card(source, text, parent, expandable, details, range, connectionSource);
		if (source.kind === 'node' && expandable && !collapsed.has(source.rowKey)) pending.push({ source, node });
	}

	if (definition !== null) {
		const details: BehaviorGraphDetail[] = [];
		if (definition.blackboard !== null) appendBehaviorGraphSourceDetails(details, definition.blackboard, 'BLACKBOARD');
		const root = card(definition, definition.label + (definition.root === null ? '\n? NO STATIC ROOT' : ''), null,
			false, details, definition.occurrenceRange);
		if (definition.root !== null) behavior(definition.root, root, 'ROOT', definition.root.occurrenceRange);
		while (pending.length > 0) {
			const { source, node } = pending.pop()!;
			for (const branch of source.branches) {
				if (branch.role !== 'children' && branch.role !== 'choices') {
					behavior(branch.node, node, branch.role, branch.field.value.range);
					continue;
				}
				if (branch.source.resolution !== 'complete') {
					const details: BehaviorGraphDetail[] = [];
					appendBehaviorGraphSourceDetails(details, branch.source, branch.role);
					card(branch.source, `${branch.role}\n? PARTIAL MEMBERSHIP`, node, false, details, branch.field.value.range);
					continue;
				}
				if (branch.role === 'children') {
					for (const entry of branch.entries) behavior(entry.node, node, `CHILD ${entry.index}`, entry.field.value.range);
				} else {
					for (const entry of branch.entries) {
						const choice = entry.node;
						if (choice.kind === 'dynamic') {
							behavior(choice, node, `CHOICE ${entry.index}`, entry.field.value.range);
							continue;
						}
						const details: BehaviorGraphDetail[] = [];
						let label = `CHOICE ${entry.index}`;
						if (choice.weight !== null) {
							const weight = describeExpression(choice.weight.value);
							label += `  W=${weight}`;
							details.push({ label: 'weight', description: weight, detail: 'CHOICE', range: choice.weight.value.range });
						} else label += '  W=?';
						if (choice.resolution !== 'complete') label += ' ? SOURCE';
						behavior(choice.child, node, label, entry.field.value.range, details, choice);
					}
				}
			}
		}
	}
	return { font, nodes, nodesBySource, links };
}
