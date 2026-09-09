import {
	LuaSyntaxKind,
	type LuaExpression,
	type LuaTableConstructorExpression,
	type LuaTableField,
} from '../../../../toolchain/ts/lua/syntax/ast';
import { findNamedLuaTableField } from '../../../../toolchain/ts/lua/syntax/table_fields';
import type { SymbolID } from '../../../../toolchain/ts/lua/semantic/model';
import type { BehaviorDynamicSourceNode, BehaviorSourceNode } from './model';
import type {
	BehaviorTreeSourceAttachment, BehaviorTreeSourceAttachmentGroup, BehaviorTreeSourceBody,
	BehaviorTreeSourceBranch, BehaviorTreeSourceChoice, BehaviorTreeSourceNode,
} from './behavior_tree_model';
import {
	appendBehaviorSourcePath,
	behaviorSourceFieldSegment,
	buildNamedTableSection,
	buildTableArraySection,
	collectArrayFields,
	collectNamedFields,
	createDynamicNode,
	createSourceNode,
	describeResolvedSourceTable,
	describeExpression,
	resolveSourceTable,
	type BehaviorRecognizerContext,
	type BehaviorSourceArrayEntry,
} from './source';

export function buildBehaviorTreeDefinition(
	context: BehaviorRecognizerContext,
	definition: LuaTableConstructorExpression,
	activeDeclarations: Set<SymbolID>,
): BehaviorTreeSourceBody {
	const children: BehaviorSourceNode[] = [];
	const rootPath = appendBehaviorSourcePath('', 'root');
	const blackboardField = findNamedLuaTableField(definition, 'blackboard');
	let blackboard: BehaviorSourceNode | null = null;
	if (blackboardField) {
		blackboard = buildNamedTableSection(
			context,
			appendBehaviorSourcePath('', 'blackboard'),
			'blackboard',
			blackboardField.value,
			activeDeclarations,
		);
		children.push(blackboard);
	}
	const rootField = findNamedLuaTableField(definition, 'root');
	let root: BehaviorTreeSourceNode | null = null;
	if (rootField) {
		root = buildBehaviorTreeNode(context, rootPath, rootField.value, activeDeclarations);
		children.push(root);
	}
	return { root, blackboard, children };
}

function buildBehaviorTreeNode(
	context: BehaviorRecognizerContext,
	path: string,
	expression: LuaExpression,
	activeDeclarations: Set<SymbolID>,
): BehaviorTreeSourceNode {
	const resolved = resolveSourceTable(context, expression, activeDeclarations);
	if (!resolved) {
		return createDynamicNode(context, path, 'dynamic node', expression);
	}
	const table = resolved.table;
	const typeField = findNamedLuaTableField(table, 'type');
	const nodeType = typeField && typeField.value.kind === LuaSyntaxKind.StringLiteralExpression
		? typeField.value.value
		: null;
	const typeLabel = nodeType === null ? '<dynamic type>' : nodeType;
	let detail = describeResolvedSourceTable(resolved);
	const primaryDetail = behaviorTreeNodeDetail(table, typeLabel);
	if (primaryDetail.length > 0) {
		detail = detail.length > 0 ? `${detail} | ${primaryDetail}` : primaryDetail;
	}
	const children: BehaviorSourceNode[] = [];
	const attachments: BehaviorTreeSourceAttachmentGroup[] = [];
	const branches: BehaviorTreeSourceBranch[] = [];
	appendBehaviorTreeAttachments(context, path, table, activeDeclarations, children, attachments);
	appendBehaviorTreeChildren(context, path, table, nodeType, activeDeclarations, children, branches);
	return createSourceNode(context, path, {
		kind: 'node',
		table,
		nodeType,
		referenceLabel: resolved.referenceLabel,
		branches,
		attachments,
		label: typeLabel,
		detail,
		authoredRange: table.range,
		referenceRange: resolved.referenceRange,
		resolution: resolved.resolution !== 'complete' || typeLabel === '<dynamic type>'
			? 'partial'
			: 'complete',
		children,
	});
}

function behaviorTreeNodeDetail(table: LuaTableConstructorExpression, typeLabel: string): string {
	let fieldNames: readonly string[] = [];
	switch (typeLabel) {
		case 'task':
			fieldNames = ['task', 'interval_ticks'];
			break;
		case 'timeline':
			fieldNames = ['timeline_id', 'play_options'];
			break;
		case 'wait':
			fieldNames = ['duration_ticks', 'minimum_duration_ticks', 'maximum_duration_ticks'];
			break;
		case 'simple_parallel':
			fieldNames = ['finish_mode'];
			break;
		case 'set_blackboard':
		case 'add_blackboard':
			fieldNames = ['key', 'value'];
			break;
	}
	return describePresentFields(table, fieldNames);
}

function appendBehaviorTreeAttachments(
	context: BehaviorRecognizerContext,
	path: string,
	table: LuaTableConstructorExpression,
	activeDeclarations: Set<SymbolID>,
	children: BehaviorSourceNode[],
	attachments: BehaviorTreeSourceAttachmentGroup[],
): void {
	for (const role of ['services', 'decorators'] as const) {
		const field = findNamedLuaTableField(table, role);
		if (!field) continue;
		const entries: BehaviorSourceArrayEntry<BehaviorTreeSourceAttachment | BehaviorDynamicSourceNode>[] = [];
		const source = buildTableArraySection(
			context,
			appendBehaviorSourcePath(path, role),
			role,
			field.value,
			activeDeclarations,
			(entryContext, entryPath, expression, active, entryField, index) => {
				const node = buildBehaviorTreeAttachment(entryContext, entryPath, expression, active,
					role === 'services' ? 'service' : 'decorator', role === 'services' ? 'service' : 'type');
				entries.push({ field: entryField, index, node });
				return node;
			},
		);
		children.push(source);
		attachments.push({ role, field, source, entries });
	}
}

function appendBehaviorTreeChildren(
	context: BehaviorRecognizerContext,
	path: string,
	table: LuaTableConstructorExpression,
	nodeType: string | null,
	activeDeclarations: Set<SymbolID>,
	children: BehaviorSourceNode[],
	branches: BehaviorTreeSourceBranch[],
): void {
	const childList = findNamedLuaTableField(table, 'children');
	if (childList) {
		const entries: BehaviorSourceArrayEntry<BehaviorTreeSourceNode>[] = [];
		const source = buildTableArraySection(
			context,
			appendBehaviorSourcePath(path, 'children'),
			'children',
			childList.value,
			activeDeclarations,
			(_entryContext, entryPath, expression, active, field, index) => {
				const node = buildBehaviorTreeNode(context, entryPath, expression, active);
				entries.push({ field, index, node });
				return node;
			},
		);
		children.push(source);
		if (nodeType === 'sequence' || nodeType === 'selector' || nodeType === 'random_selector') {
			branches.push({ role: 'children', field: childList, source, entries });
		}
	}
	for (const fieldName of ['main_task', 'background_tree'] as const) {
		const field = findNamedLuaTableField(table, fieldName);
		if (field) {
			const node = buildBehaviorTreeNode(
				context,
				appendBehaviorSourcePath(path, fieldName),
				field.value,
				activeDeclarations,
			);
			children.push(node);
			if (nodeType === 'simple_parallel') branches.push({ role: fieldName, field, node });
		}
	}
	const choices = findNamedLuaTableField(table, 'choices');
	if (choices) {
		const branch = buildBehaviorTreeChoices(
			context,
			appendBehaviorSourcePath(path, 'choices'),
			choices,
			activeDeclarations,
		);
		children.push(branch.source);
		if (nodeType === 'weighted_random_selector') branches.push(branch);
	}
}

function buildBehaviorTreeChoices(
	context: BehaviorRecognizerContext,
	path: string,
	field: LuaTableField,
	activeDeclarations: Set<SymbolID>,
): Extract<BehaviorTreeSourceBranch, { role: 'choices' }> {
	const expression = field.value;
	const choices: BehaviorSourceArrayEntry<BehaviorTreeSourceChoice | BehaviorDynamicSourceNode>[] = [];
	const resolved = resolveSourceTable(context, expression, activeDeclarations);
	if (!resolved) {
		return { role: 'choices', field, entries: choices, source: createDynamicNode(context, path, 'dynamic choices', expression) };
	}
	const entries = collectArrayFields(resolved.table);
	const keyedEntries = collectNamedFields(resolved.table);
	const children: BehaviorSourceNode[] = [];
	for (let index = 0; index < entries.length; index += 1) {
		const node = buildBehaviorTreeChoice(
			context,
			appendBehaviorSourcePath(path, `array:${index + 1}`),
			`choice ${index + 1}`,
			entries[index].value,
			activeDeclarations,
			false,
		);
		children.push(node);
		choices.push({ field: entries[index], index: resolved.resolution === 'complete' ? index + 1 : null, node });
	}
	for (let index = 0; index < keyedEntries.length; index += 1) {
		const entry = keyedEntries[index];
		if (entry.keyKind === 'named') {
			continue;
		}
		const entryPath = appendBehaviorSourcePath(path, behaviorSourceFieldSegment(entry, index));
		if (entry.keyKind === 'numeric') {
			const node = buildBehaviorTreeChoice(
				context,
				entryPath,
				`[${entry.authoredKeyLabel}]`,
				entry.field.value,
				activeDeclarations,
				true,
			);
			children.push(node);
			choices.push({ field: entry.field, index: null, node });
			continue;
		}
		const node = createDynamicNode(context, entryPath, `[${entry.authoredKeyLabel}]`, entry.field.value);
		children.push(node);
		choices.push({ field: entry.field, index: null, node });
	}
	const source = createSourceNode(context, path, {
		kind: 'section',
		table: resolved.table,
		issues: resolved.issues,
		label: resolved.resolution === 'complete'
			? `choices (${entries.length})`
			: `choices (${children.length} authored)`,
		detail: describeResolvedSourceTable(resolved),
		authoredRange: resolved.table.range,
		referenceRange: resolved.referenceRange,
		resolution: resolved.resolution,
		children,
	});
	return { role: 'choices', field, source, entries: choices };
}

function buildBehaviorTreeChoice(
	context: BehaviorRecognizerContext,
	path: string,
	label: string,
	expression: LuaExpression,
	activeDeclarations: Set<SymbolID>,
	explicitNumericKey: boolean,
): BehaviorTreeSourceChoice | BehaviorDynamicSourceNode {
	const choice = resolveSourceTable(context, expression, activeDeclarations);
	if (!choice) {
		return createDynamicNode(context, path, 'dynamic choice', expression);
	}
	const child = findNamedLuaTableField(choice.table, 'child');
	if (!child) {
		return createDynamicNode(context, path, 'choice without child', expression);
	}
	const weight = findNamedLuaTableField(choice.table, 'weight');
	const childNode = buildBehaviorTreeNode(
		context,
		appendBehaviorSourcePath(path, 'child'),
		child.value,
		activeDeclarations,
	);
	return createSourceNode(context, path, {
		kind: 'section',
		issues: choice.issues,
		weight,
		child: childNode,
		label,
		detail: weight ? `weight=${describeExpression(weight.value)}` : '',
		authoredRange: choice.table.range,
		referenceRange: choice.referenceRange,
		resolution: explicitNumericKey ? 'partial' : choice.resolution,
		children: [childNode],
	});
}

function buildBehaviorTreeAttachment(
	context: BehaviorRecognizerContext,
	path: string,
	expression: LuaExpression,
	activeDeclarations: Set<SymbolID>,
	kind: 'service' | 'decorator',
	primaryFieldName: string,
): BehaviorTreeSourceAttachment | BehaviorDynamicSourceNode {
	const resolved = resolveSourceTable(context, expression, activeDeclarations);
	if (!resolved) {
		return createDynamicNode(context, path, `dynamic ${kind}`, expression);
	}
	const primary = findNamedLuaTableField(resolved.table, primaryFieldName);
	const label = primary ? describeExpression(primary.value) : `<unresolved ${kind}>`;
	const detailFields = kind === 'service'
		? ['interval', 'tick_on_search_start', 'restart_timer_on_each_activation']
		: ['decorator', 'observer_aborts', 'operation', 'key', 'value', 'notify_observer', 'num_loops', 'infinite_loop'];
	let detail = describeResolvedSourceTable(resolved);
	const policy = describePresentFields(resolved.table, detailFields);
	if (policy.length > 0) {
		detail = detail.length > 0 ? `${detail} | ${policy}` : policy;
	}
	return createSourceNode(context, path, {
		kind,
		table: resolved.table,
		primary,
		label,
		detail,
		authoredRange: resolved.table.range,
		referenceRange: resolved.referenceRange,
		resolution: resolved.resolution !== 'complete' || !primary ? 'partial' : 'complete',
		children: [],
	});
}

function describePresentFields(
	table: LuaTableConstructorExpression,
	fieldNames: readonly string[],
): string {
	let detail = '';
	for (let index = 0; index < fieldNames.length; index += 1) {
		const fieldName = fieldNames[index];
		const field = findNamedLuaTableField(table, fieldName);
		if (!field) {
			continue;
		}
		const value = `${fieldName}=${describeExpression(field.value)}`;
		detail = detail.length > 0 ? `${detail} | ${value}` : value;
	}
	return detail;
}
