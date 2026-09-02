import {
	LuaSyntaxKind,
	type LuaExpression,
	type LuaTableConstructorExpression,
} from '../../../../toolchain/ts/lua/syntax/ast';
import type { SymbolID } from '../../../../toolchain/ts/lua/semantic/model';
import type { BehaviorSourceNode } from './model';
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
	findNamedField,
	resolveSourceTable,
	type BehaviorRecognizerContext,
} from './source';

export function buildBehaviorTreeDefinition(
	context: BehaviorRecognizerContext,
	definition: LuaTableConstructorExpression,
	activeDeclarations: Set<SymbolID>,
): readonly BehaviorSourceNode[] {
	const children: BehaviorSourceNode[] = [];
	const rootPath = appendBehaviorSourcePath('', 'root');
	const blackboard = findNamedField(definition, 'blackboard');
	if (blackboard) {
		children.push(buildNamedTableSection(
			context,
			appendBehaviorSourcePath('', 'blackboard'),
			'blackboard',
			blackboard.value,
			activeDeclarations,
		));
	}
	const root = findNamedField(definition, 'root');
	if (root) {
		children.push(buildBehaviorTreeNode(context, rootPath, root.value, activeDeclarations));
	}
	return children;
}

function buildBehaviorTreeNode(
	context: BehaviorRecognizerContext,
	path: string,
	expression: LuaExpression,
	activeDeclarations: Set<SymbolID>,
): BehaviorSourceNode {
	const resolved = resolveSourceTable(context, expression, activeDeclarations);
	if (!resolved) {
		return createDynamicNode(context, path, 'dynamic node', expression);
	}
	const table = resolved.table;
	const typeField = findNamedField(table, 'type');
	const typeLabel = typeField && typeField.value.kind === LuaSyntaxKind.StringLiteralExpression
		? typeField.value.value
		: '<dynamic type>';
	let detail = describeResolvedSourceTable(resolved);
	const primaryDetail = behaviorTreeNodeDetail(table, typeLabel);
	if (primaryDetail.length > 0) {
		detail = detail.length > 0 ? `${detail} | ${primaryDetail}` : primaryDetail;
	}
	const children: BehaviorSourceNode[] = [];
	appendBehaviorTreeAttachments(context, path, table, activeDeclarations, children);
	appendBehaviorTreeChildren(context, path, table, activeDeclarations, children);
	return createSourceNode(context, path, {
		kind: 'node',
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
): void {
	const services = findNamedField(table, 'services');
	if (services) {
		children.push(buildTableArraySection(
			context,
			appendBehaviorSourcePath(path, 'services'),
			'services',
			services.value,
			activeDeclarations,
			buildBehaviorTreeService,
		));
	}
	const decorators = findNamedField(table, 'decorators');
	if (decorators) {
		children.push(buildTableArraySection(
			context,
			appendBehaviorSourcePath(path, 'decorators'),
			'decorators',
			decorators.value,
			activeDeclarations,
			buildBehaviorTreeDecorator,
		));
	}
}

function appendBehaviorTreeChildren(
	context: BehaviorRecognizerContext,
	path: string,
	table: LuaTableConstructorExpression,
	activeDeclarations: Set<SymbolID>,
	children: BehaviorSourceNode[],
): void {
	const childList = findNamedField(table, 'children');
	if (childList) {
		children.push(buildTableArraySection(
			context,
			appendBehaviorSourcePath(path, 'children'),
			'children',
			childList.value,
			activeDeclarations,
			buildBehaviorTreeNode,
		));
	}
	for (const fieldName of ['main_task', 'background_tree'] as const) {
		const field = findNamedField(table, fieldName);
		if (field) {
			children.push(buildBehaviorTreeNode(
				context,
				appendBehaviorSourcePath(path, fieldName),
				field.value,
				activeDeclarations,
			));
		}
	}
	const choices = findNamedField(table, 'choices');
	if (choices) {
		children.push(buildBehaviorTreeChoices(
			context,
			appendBehaviorSourcePath(path, 'choices'),
			choices.value,
			activeDeclarations,
		));
	}
}

function buildBehaviorTreeChoices(
	context: BehaviorRecognizerContext,
	path: string,
	expression: LuaExpression,
	activeDeclarations: Set<SymbolID>,
): BehaviorSourceNode {
	const resolved = resolveSourceTable(context, expression, activeDeclarations);
	if (!resolved) {
		return createDynamicNode(context, path, 'dynamic choices', expression);
	}
	const entries = collectArrayFields(resolved.table);
	const keyedEntries = collectNamedFields(resolved.table);
	const children: BehaviorSourceNode[] = [];
	for (let index = 0; index < entries.length; index += 1) {
		children.push(buildBehaviorTreeChoice(
			context,
			appendBehaviorSourcePath(path, `array:${index + 1}`),
			`choice ${index + 1}`,
			entries[index].value,
			activeDeclarations,
			false,
		));
	}
	for (let index = 0; index < keyedEntries.length; index += 1) {
		const entry = keyedEntries[index];
		if (entry.keyKind === 'named') {
			continue;
		}
		const entryPath = appendBehaviorSourcePath(path, behaviorSourceFieldSegment(entry, index));
		if (entry.keyKind === 'numeric') {
			children.push(buildBehaviorTreeChoice(
				context,
				entryPath,
				`[${entry.authoredKeyLabel}]`,
				entry.field.value,
				activeDeclarations,
				true,
			));
			continue;
		}
		children.push(createDynamicNode(context, entryPath, `[${entry.authoredKeyLabel}]`, entry.field.value));
	}
	return createSourceNode(context, path, {
		kind: 'section',
		label: resolved.resolution === 'complete'
			? `choices (${entries.length})`
			: `choices (${children.length} authored)`,
		detail: describeResolvedSourceTable(resolved),
		authoredRange: resolved.table.range,
		referenceRange: resolved.referenceRange,
		resolution: resolved.resolution,
		children,
	});
}

function buildBehaviorTreeChoice(
	context: BehaviorRecognizerContext,
	path: string,
	label: string,
	expression: LuaExpression,
	activeDeclarations: Set<SymbolID>,
	explicitNumericKey: boolean,
): BehaviorSourceNode {
	const choice = resolveSourceTable(context, expression, activeDeclarations);
	if (!choice) {
		return createDynamicNode(context, path, 'dynamic choice', expression);
	}
	const child = findNamedField(choice.table, 'child');
	if (!child) {
		return createDynamicNode(context, path, 'choice without child', expression);
	}
	const weight = findNamedField(choice.table, 'weight');
	const childNode = buildBehaviorTreeNode(
		context,
		appendBehaviorSourcePath(path, 'child'),
		child.value,
		activeDeclarations,
	);
	return createSourceNode(context, path, {
		kind: 'section',
		label,
		detail: weight ? `weight=${describeExpression(weight.value)}` : '',
		authoredRange: choice.table.range,
		referenceRange: choice.referenceRange,
		resolution: explicitNumericKey ? 'partial' : choice.resolution,
		children: [childNode],
	});
}

function buildBehaviorTreeService(
	context: BehaviorRecognizerContext,
	path: string,
	expression: LuaExpression,
	activeDeclarations: Set<SymbolID>,
): BehaviorSourceNode {
	return buildBehaviorTreeAttachment(context, path, expression, activeDeclarations, 'service', 'service');
}

function buildBehaviorTreeDecorator(
	context: BehaviorRecognizerContext,
	path: string,
	expression: LuaExpression,
	activeDeclarations: Set<SymbolID>,
): BehaviorSourceNode {
	return buildBehaviorTreeAttachment(context, path, expression, activeDeclarations, 'decorator', 'type');
}

function buildBehaviorTreeAttachment(
	context: BehaviorRecognizerContext,
	path: string,
	expression: LuaExpression,
	activeDeclarations: Set<SymbolID>,
	kind: 'service' | 'decorator',
	primaryFieldName: string,
): BehaviorSourceNode {
	const resolved = resolveSourceTable(context, expression, activeDeclarations);
	if (!resolved) {
		return createDynamicNode(context, path, `dynamic ${kind}`, expression);
	}
	const primary = findNamedField(resolved.table, primaryFieldName);
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
		const field = findNamedField(table, fieldName);
		if (!field) {
			continue;
		}
		const value = `${fieldName}=${describeExpression(field.value)}`;
		detail = detail.length > 0 ? `${detail} | ${value}` : value;
	}
	return detail;
}
