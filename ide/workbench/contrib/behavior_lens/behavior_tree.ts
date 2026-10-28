import type { FileSemanticData } from '../../../../toolchain/ts/lua/semantic/model';
import {
	LuaSyntaxKind,
	type LuaExpression,
	type LuaTableConstructorExpression,
	type LuaTableField,
} from '../../../../toolchain/ts/lua/syntax/ast';
import type { BehaviorDynamicSourceNode, BehaviorSourceNode } from './model';
import type {
	BehaviorTreeSourceAttachment, BehaviorTreeSourceAttachmentGroup, BehaviorTreeSourceBody,
	BehaviorTreeSourceBranch, BehaviorTreeSourceChoice, BehaviorTreeSourceNode, BehaviorTreeSourceSummaryField,
} from './behavior_tree_model';
import {
	appendBehaviorSourcePath,
	behaviorSourceFieldSegment,
	buildNamedTableSection,
	buildTableArraySection,
	collectArrayFields,
	createDynamicNode,
	createSourceNode,
	describeResolvedSourceTable,
	describeExpression,
	findNamedSourceField,
	resolveSourceTable,
	type BehaviorRecognizerContext,
	type BehaviorSourceArrayEntry,
	type ResolvedSourceTable,
} from './source';

export function buildBehaviorTreeDefinition(
	context: BehaviorRecognizerContext,
	definition: ResolvedSourceTable,
	activeTables: Set<LuaTableConstructorExpression>,
): BehaviorTreeSourceBody {
	const file = definition.file;
	activeTables.add(definition.table);
	const children: BehaviorSourceNode[] = [];
	const rootPath = appendBehaviorSourcePath('', 'root');
	const blackboardField = findNamedSourceField(definition, 'blackboard');
	let blackboard: BehaviorSourceNode | null = null;
	if (blackboardField) {
		blackboard = buildNamedTableSection(
			context, file,
			appendBehaviorSourcePath('', 'blackboard'),
			'blackboard',
			blackboardField.value,
			activeTables,
		);
		children.push(blackboard);
	}
	const rootField = findNamedSourceField(definition, 'root');
	let root: BehaviorTreeSourceNode | null = null;
	if (rootField) {
		root = buildBehaviorTreeNode(context, file, rootPath, rootField.value, activeTables);
		children.push(root);
	}
	activeTables.delete(definition.table);
	return { root, blackboard, children };
}

function buildBehaviorTreeNode(
	context: BehaviorRecognizerContext,
	file: FileSemanticData,
	path: string,
	expression: LuaExpression,
	activeTables: Set<LuaTableConstructorExpression>,
): BehaviorTreeSourceNode {
	const resolved = resolveSourceTable(context, file, expression, activeTables);
	if (!resolved) {
		return createDynamicNode(context, file, path, 'dynamic node', expression);
	}
	const table = resolved.table;
	const typeField = findNamedSourceField(resolved, 'type');
	const nodeType = typeField === null ? null : context.reader.stringValue(resolved.file, typeField.value) ?? null;
	const typeLabel = nodeType === null ? '<dynamic type>' : nodeType;
	let detail = describeResolvedSourceTable(resolved);
	const summary = behaviorTreeNodeSummary(context, resolved, typeLabel, activeTables);
	let primaryDetail = '';
	for (const entry of summary) {
		if (primaryDetail.length > 0) primaryDetail += ' | ';
		primaryDetail += `${entry.name}=${describeExpression(entry.field.value)}`;
	}
	if (primaryDetail.length > 0) {
		detail = detail.length > 0 ? `${detail} | ${primaryDetail}` : primaryDetail;
	}
	const children: BehaviorSourceNode[] = [];
	const attachments: BehaviorTreeSourceAttachmentGroup[] = [];
	const branches: BehaviorTreeSourceBranch[] = [];
	activeTables.add(table);
	appendBehaviorTreeAttachments(context, path, resolved, activeTables, children, attachments);
	appendBehaviorTreeChildren(context, path, resolved, nodeType, activeTables, children, branches);
	activeTables.delete(table);
	return createSourceNode(context, path, {
		kind: 'node',
		table,
		file: resolved.file,
		issues: resolved.issues,
		nodeType,
		referenceLabel: resolved.referenceLabel,
		summary,
		branches,
		attachments,
		label: typeLabel,
		detail,
		authoredRange: resolved.file.chunk.locations.range(table.span),
		referenceRange: resolved.referenceRange,
		resolution: resolved.resolution !== 'complete' || typeLabel === '<dynamic type>'
			? 'partial'
			: 'complete',
		children,
	});
}

function behaviorTreeNodeSummary(context: BehaviorRecognizerContext, source: ResolvedSourceTable, typeLabel: string,
	activeTables: Set<LuaTableConstructorExpression>): BehaviorTreeSourceSummaryField[] {
	const summary: BehaviorTreeSourceSummaryField[] = [];
	let fieldNames: readonly string[] = [];
	switch (typeLabel) {
		case 'task': {
			const task = findNamedSourceField(source, 'task');
			if (task?.value.kind === LuaSyntaxKind.TableConstructorExpression) {
				// Inline task callbacks are the authored behavior, not a table-size label.
				const callbacks = resolveSourceTable(context, source.file, task.value, activeTables)!;
				appendBehaviorTreeSummaryFields(context, callbacks, ['execute', 'tick', 'abort', 'node_memory'], summary);
			}
			fieldNames = summary.length === 0 ? ['task', 'interval_ticks'] : ['interval_ticks'];
			break;
		}
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
	appendBehaviorTreeSummaryFields(context, source, fieldNames, summary);
	return summary;
}

function appendBehaviorTreeSummaryFields(context: BehaviorRecognizerContext, source: ResolvedSourceTable,
	names: readonly string[], summary: BehaviorTreeSourceSummaryField[]): void {
	for (const name of names) {
		const field = findNamedSourceField(source, name);
		if (field !== null) summary.push({ name, field, stringValue: context.reader.stringValue(source.file, field.value) });
	}
}

function appendBehaviorTreeAttachments(
	context: BehaviorRecognizerContext,
	path: string,
	sourceTable: ResolvedSourceTable,
	activeTables: Set<LuaTableConstructorExpression>,
	children: BehaviorSourceNode[],
	attachments: BehaviorTreeSourceAttachmentGroup[],
): void {
	const file = sourceTable.file;
	for (const role of ['services', 'decorators'] as const) {
		const field = findNamedSourceField(sourceTable, role);
		if (!field) continue;
		const entries: BehaviorSourceArrayEntry<BehaviorTreeSourceAttachment | BehaviorDynamicSourceNode>[] = [];
		const source = buildTableArraySection(
			context, file,
			appendBehaviorSourcePath(path, role),
			role,
			field.value,
			activeTables,
			(entryContext, entryFile, entryPath, expression, active, field, index) => {
				const node = buildBehaviorTreeAttachment(entryContext, entryFile, entryPath, expression, active,
					role === 'services' ? 'service' : 'decorator', role === 'services' ? 'service' : 'type');
				entries.push({ file: entryFile, field, index, node });
				return node;
			},
		);
		children.push(source);
		attachments.push({ file, role, field, source, entries });
	}
}

function appendBehaviorTreeChildren(
	context: BehaviorRecognizerContext,
	path: string,
	sourceTable: ResolvedSourceTable,
	nodeType: string | null,
	activeTables: Set<LuaTableConstructorExpression>,
	children: BehaviorSourceNode[],
	branches: BehaviorTreeSourceBranch[],
): void {
	const file = sourceTable.file;
	const childList = findNamedSourceField(sourceTable, 'children');
	if (childList) {
		const entries: BehaviorSourceArrayEntry<BehaviorTreeSourceNode>[] = [];
		const source = buildTableArraySection(
			context, file,
			appendBehaviorSourcePath(path, 'children'),
			'children',
			childList.value,
			activeTables,
			(_entryContext, entryFile, entryPath, expression, active, field, index) => {
				const node = buildBehaviorTreeNode(context, entryFile, entryPath, expression, active);
				entries.push({ file: entryFile, field, index, node });
				return node;
			},
		);
		children.push(source);
		if (nodeType === 'sequence' || nodeType === 'selector' || nodeType === 'random_selector') {
			branches.push({ file, role: 'children', field: childList, source, entries });
		}
	}
	for (const fieldName of ['main_task', 'background_tree'] as const) {
		const field = findNamedSourceField(sourceTable, fieldName);
		if (field) {
			const node = buildBehaviorTreeNode(
				context, file,
				appendBehaviorSourcePath(path, fieldName),
				field.value,
				activeTables,
			);
			children.push(node);
			if (nodeType === 'simple_parallel') branches.push({ file, role: fieldName, field, node });
		}
	}
	const choices = findNamedSourceField(sourceTable, 'choices');
	if (choices) {
		const branch = buildBehaviorTreeChoices(
			context, file,
			appendBehaviorSourcePath(path, 'choices'),
			choices,
			activeTables,
		);
		children.push(branch.source);
		if (nodeType === 'weighted_random_selector') branches.push(branch);
	}
}

function buildBehaviorTreeChoices(
	context: BehaviorRecognizerContext,
	file: FileSemanticData,
	path: string,
	field: LuaTableField,
	activeTables: Set<LuaTableConstructorExpression>,
): Extract<BehaviorTreeSourceBranch, { role: 'choices' }> {
	const expression = field.value;
	const choices: BehaviorSourceArrayEntry<BehaviorTreeSourceChoice | BehaviorDynamicSourceNode>[] = [];
	const resolved = resolveSourceTable(context, file, expression, activeTables);
	if (!resolved) {
		return { file, role: 'choices', field, entries: choices, source: createDynamicNode(context, file, path, 'dynamic choices', expression) };
	}
	const entries = collectArrayFields(resolved.table);
	const keyedEntries = resolved.fields;
	const children: BehaviorSourceNode[] = [];
	for (let index = 0; index < entries.length; index += 1) {
		const node = buildBehaviorTreeChoice(
			context, resolved.file,
			appendBehaviorSourcePath(path, `array:${index + 1}`),
			`choice ${index + 1}`,
			entries[index].value,
			activeTables,
			false,
		);
		children.push(node);
		choices.push({ file: resolved.file, field: entries[index], index: resolved.resolution === 'complete' ? index + 1 : null, node });
	}
	for (let index = 0; index < keyedEntries.length; index += 1) {
		const entry = keyedEntries[index];
		if (entry.keyKind === 'named') {
			continue;
		}
		const entryPath = appendBehaviorSourcePath(path, behaviorSourceFieldSegment(entry, index));
		if (entry.keyKind === 'numeric') {
			const node = buildBehaviorTreeChoice(
				context, resolved.file,
				entryPath,
				`[${entry.authoredKeyLabel}]`,
				entry.field.value,
				activeTables,
				true,
			);
			children.push(node);
			choices.push({ file: resolved.file, field: entry.field, index: null, node });
			continue;
		}
		const node = createDynamicNode(context, resolved.file, entryPath, `[${entry.authoredKeyLabel}]`, entry.field.value);
		children.push(node);
		choices.push({ file: resolved.file, field: entry.field, index: null, node });
	}
	const source = createSourceNode(context, path, {
		kind: 'section',
		table: resolved.table,
		file: resolved.file,
		issues: resolved.issues,
		fields: resolved.fields,
		label: resolved.resolution === 'complete'
			? `choices (${entries.length})`
			: `choices (${children.length} authored)`,
		detail: describeResolvedSourceTable(resolved),
		authoredRange: resolved.file.chunk.locations.range(resolved.table.span),
		referenceRange: resolved.referenceRange,
		resolution: resolved.resolution,
		children,
	});
	return { file, role: 'choices', field, source, entries: choices };
}

function buildBehaviorTreeChoice(
	context: BehaviorRecognizerContext,
	file: FileSemanticData,
	path: string,
	label: string,
	expression: LuaExpression,
	activeTables: Set<LuaTableConstructorExpression>,
	explicitNumericKey: boolean,
): BehaviorTreeSourceChoice | BehaviorDynamicSourceNode {
	const choice = resolveSourceTable(context, file, expression, activeTables);
	if (!choice) {
		return createDynamicNode(context, file, path, 'dynamic choice', expression);
	}
	const child = findNamedSourceField(choice, 'child');
	if (!child) {
		return createDynamicNode(context, file, path, 'choice without child', expression);
	}
	const weight = findNamedSourceField(choice, 'weight');
	const childNode = buildBehaviorTreeNode(
		context, choice.file,
		appendBehaviorSourcePath(path, 'child'),
		child.value,
		activeTables,
	);
	return createSourceNode(context, path, {
		kind: 'section',
		issues: choice.issues,
		weight,
		file: choice.file,
		child: childNode,
		label,
		detail: weight ? `weight=${describeExpression(weight.value)}` : '',
		authoredRange: choice.file.chunk.locations.range(choice.table.span),
		referenceRange: choice.referenceRange,
		resolution: explicitNumericKey ? 'partial' : choice.resolution,
		children: [childNode],
	});
}

function buildBehaviorTreeAttachment(
	context: BehaviorRecognizerContext,
	file: FileSemanticData,
	path: string,
	expression: LuaExpression,
	activeTables: Set<LuaTableConstructorExpression>,
	kind: 'service' | 'decorator',
	primaryFieldName: string,
): BehaviorTreeSourceAttachment | BehaviorDynamicSourceNode {
	const resolved = resolveSourceTable(context, file, expression, activeTables);
	if (!resolved) {
		return createDynamicNode(context, file, path, `dynamic ${kind}`, expression);
	}
	const primary = findNamedSourceField(resolved, primaryFieldName);
	const name = primary === null ? undefined : context.reader.stringValue(resolved.file, primary.value);
	const label = name !== undefined ? name : primary === null ? `<unresolved ${kind}>` : describeExpression(primary.value);
	const detailFields = kind === 'service'
		? ['interval', 'tick_on_search_start', 'restart_timer_on_each_activation']
		: ['decorator', 'observer_aborts', 'operation', 'key', 'value', 'notify_observer', 'num_loops', 'infinite_loop'];
	let detail = describeResolvedSourceTable(resolved);
	const policy = describePresentFields(resolved, detailFields);
	if (policy.length > 0) {
		detail = detail.length > 0 ? `${detail} | ${policy}` : policy;
	}
	return createSourceNode(context, path, {
		kind,
		table: resolved.table,
		file: resolved.file,
		primary,
		label,
		preserveLabelCase: name !== undefined,
		detail,
		authoredRange: resolved.file.chunk.locations.range(resolved.table.span),
		referenceRange: resolved.referenceRange,
		resolution: resolved.resolution !== 'complete' || !primary ? 'partial' : 'complete',
		children: [],
	});
}

function describePresentFields(
	source: ResolvedSourceTable,
	fieldNames: readonly string[],
): string {
	let detail = '';
	for (let index = 0; index < fieldNames.length; index += 1) {
		const fieldName = fieldNames[index];
		const field = findNamedSourceField(source, fieldName);
		if (!field) {
			continue;
		}
		const value = `${fieldName}=${describeExpression(field.value)}`;
		detail = detail.length > 0 ? `${detail} | ${value}` : value;
	}
	return detail;
}
