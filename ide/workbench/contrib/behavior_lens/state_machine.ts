import {
	LuaSyntaxKind,
	LuaTableFieldKind,
	type LuaExpression,
	type LuaTableConstructorExpression,
} from '../../../../toolchain/ts/lua/syntax/ast';
import { findNamedLuaTableField } from '../../../../toolchain/ts/lua/syntax/table_fields';
import type { SymbolID } from '../../../../toolchain/ts/lua/semantic/model';
import type { BehaviorDynamicSourceNode, BehaviorSourceNode } from './model';
import { appendFsmEventSection, appendInputHandlers, appendFsmTimelines } from './state_machine_handlers';
import type { StateMachineSourceBody, StateMachineSourceSlot, StateMachineSourceState, StateMachineSourceStates } from './state_machine_model';
import {
	appendBehaviorSourcePath,
	behaviorSourceFieldSegment,
	buildExpressionProperty,
	buildNamedTableSection,
	buildTableArraySection,
	collectNamedFields,
	createDynamicNode,
	createSourceNode,
	describeExpression,
	describeResolvedSourceTable,
	resolveSourceTable,
	SourceTableIssue,
	type BehaviorRecognizerContext,
	type ResolvedSourceTable,
} from './source';

const SCALAR_FIELDS = [
	'def_id',
	'initial',
	'clock_source',
	'is_concurrent',
	'input_eval',
	'update',
	'entering_state',
	'exiting_state',
] as const;

export function buildStateMachineBody(
	context: BehaviorRecognizerContext, path: string, resolved: ResolvedSourceTable, activeDeclarations: Set<SymbolID>,
): { body: StateMachineSourceBody; children: readonly BehaviorSourceNode[] } {
	const definition = resolved.table;
	const children: BehaviorSourceNode[] = [];
	const slots: StateMachineSourceSlot[] = [];
	appendScalarFields(context, path, definition, children, slots);
	appendFsmEventSection(context, appendBehaviorSourcePath(path, 'on'), definition, activeDeclarations, children, slots);
	appendFsmTimelines(context, appendBehaviorSourcePath(path, 'timelines'), definition, activeDeclarations, children, slots);
	appendNamedSection(context, appendBehaviorSourcePath(path, 'data'), definition, activeDeclarations, children, 'data');
	const guardField = findNamedLuaTableField(definition, 'transition_guards');
	let guards: StateMachineSourceBody['guards'] = null;
	if (guardField !== null) {
		const source = buildNamedTableSection(context, appendBehaviorSourcePath(path, 'transition_guards'), 'transition_guards', guardField.value, activeDeclarations);
		children.push(source);
		guards = { source, field: guardField,
			canEnter: source.kind === 'dynamic' ? null : findNamedLuaTableField(source.table, 'can_enter'),
			canExit: source.kind === 'dynamic' ? null : findNamedLuaTableField(source.table, 'can_exit') };
	}
	if (path.length === 0) appendTableMapSection(context, appendBehaviorSourcePath(path, 'tag_derivations'), definition, activeDeclarations, children, 'tag_derivations');
	appendExpressionListSection(context, appendBehaviorSourcePath(path, 'tags'), definition, activeDeclarations, children, 'tags');
	appendExpressionListSection(context, appendBehaviorSourcePath(path, 'event_list'), definition, activeDeclarations, children, 'event_list');
	appendExpressionListSection(context, appendBehaviorSourcePath(path, 'actioneffects'), definition, activeDeclarations, children, 'actioneffects');
	appendInputHandlers(context, appendBehaviorSourcePath(path, 'input_event_handlers'), definition, activeDeclarations, children, slots);
	const states = appendFsmStates(context, appendBehaviorSourcePath(path, 'states'), definition, activeDeclarations, children);
	return { body: { table: definition, issues: resolved.issues, initial: findNamedLuaTableField(definition, 'initial'),
		concurrent: findNamedLuaTableField(definition, 'is_concurrent'), guards, states, slots }, children };
}

function appendFsmStates(
	context: BehaviorRecognizerContext,
	path: string,
	owner: LuaTableConstructorExpression,
	activeDeclarations: Set<SymbolID>,
	children: BehaviorSourceNode[],
): StateMachineSourceStates | null {
	const statesField = findNamedLuaTableField(owner, 'states');
	if (!statesField) {
		return null;
	}
	const resolved = resolveSourceTable(context, statesField.value, activeDeclarations);
	if (!resolved) {
		const source = createDynamicNode(context, path, 'dynamic states', statesField.value);
		children.push(source);
		return { kind: 'dynamic', source, field: statesField };
	}
	// Implicit numeric members are not string-addressable child definitions either.
	const issues = resolved.table.fields.some(field => field.kind === LuaTableFieldKind.Array)
		? resolved.issues | SourceTableIssue.NumericKey : resolved.issues;
	const initialField = findNamedLuaTableField(owner, 'initial');
	const initial = initialField && initialField.value.kind === LuaSyntaxKind.StringLiteralExpression
		? initialField.value.value
		: null;
	const stateNodes: BehaviorSourceNode[] = [];
	const entries: Extract<StateMachineSourceStates, { kind: 'resolved' }>['entries'][number][] = [];
	const stateFields = collectNamedFields(resolved.table);
	let knownStateCount = 0;
	for (let index = 0; index < stateFields.length; index += 1) {
		const entry = stateFields[index];
		if (entry.name === null) {
			const node = createSourceNode(context, appendBehaviorSourcePath(path, behaviorSourceFieldSegment(entry, index)), {
				kind: 'dynamic',
				label: `[${entry.authoredKeyLabel}]`,
				detail: `state = ${describeExpression(entry.field.value)}`,
				authoredRange: entry.field.range,
				referenceRange: null,
				resolution: entry.keyKind === 'numeric' ? 'partial' : 'unresolved',
				children: [],
			});
			stateNodes.push(node);
			entries.push({ name: null, field: entry.field, node });
			continue;
		}
		knownStateCount += 1;
		const node = buildFsmState(
			context,
			appendBehaviorSourcePath(path, behaviorSourceFieldSegment(entry, index)),
			entry.name,
			entry.field.value,
			initial === entry.name,
			activeDeclarations,
		);
		stateNodes.push(node);
		entries.push({ name: entry.name, field: entry.field, node });
	}
	const source = createSourceNode(context, path, {
		kind: 'section',
		label: issues === SourceTableIssue.None
			? `states (${knownStateCount})`
			: `states (${knownStateCount} known)`,
		detail: describeResolvedSourceTable(resolved),
		authoredRange: resolved.table.range,
		referenceRange: resolved.referenceRange,
		resolution: issues === SourceTableIssue.None ? 'complete' : 'partial',
		children: stateNodes,
	});
	children.push(source);
	return { kind: 'resolved', field: statesField, source, issues, entries };
}

function buildFsmState(
	context: BehaviorRecognizerContext,
	path: string,
	name: string,
	expression: LuaExpression,
	initial: boolean,
	activeDeclarations: Set<SymbolID>,
): StateMachineSourceState | BehaviorDynamicSourceNode {
	const resolved = resolveSourceTable(context, expression, activeDeclarations);
	if (!resolved) {
		return createDynamicNode(context, path, `state ${name}: dynamic`, expression);
	}
	const state = resolved.table;
	const concurrentField = findNamedLuaTableField(state, 'is_concurrent');
	const concurrent = concurrentField?.value.kind === LuaSyntaxKind.BooleanLiteralExpression
		&& concurrentField.value.value;
	const markers: string[] = [];
	if (initial) {
		markers.push('initial');
	}
	if (concurrent) {
		markers.push('concurrent');
	}
	const { body, children } = buildStateMachineBody(context, path, resolved, activeDeclarations);
	const sourceDetail = describeResolvedSourceTable(resolved);
	if (sourceDetail.length > 0) {
		markers.push(sourceDetail);
	}
	return createSourceNode(context, path, {
		kind: 'state',
		label: name,
		detail: markers.join(', '),
		authoredRange: state.range,
		referenceRange: resolved.referenceRange,
		resolution: resolved.resolution,
		body,
		children,
	});
}

function appendTableMapSection(
	context: BehaviorRecognizerContext,
	path: string,
	owner: LuaTableConstructorExpression,
	activeDeclarations: Set<SymbolID>,
	children: BehaviorSourceNode[],
	fieldName: string,
): void {
	const field = findNamedLuaTableField(owner, fieldName);
	if (!field) {
		return;
	}
	const resolved = resolveSourceTable(context, field.value, activeDeclarations);
	if (!resolved) {
		children.push(createDynamicNode(context, path, `dynamic ${fieldName}`, field.value));
		return;
	}
	const entries = collectNamedFields(resolved.table);
	const entryNodes: BehaviorSourceNode[] = [];
	for (let index = 0; index < entries.length; index += 1) {
		const entry = entries[index];
		if (entry.name === null) {
			entryNodes.push(createSourceNode(context, appendBehaviorSourcePath(path, behaviorSourceFieldSegment(entry, index)), {
				kind: 'dynamic',
				label: `[${entry.authoredKeyLabel}]`,
				detail: describeExpression(entry.field.value),
				authoredRange: entry.field.range,
				referenceRange: null,
				resolution: entry.keyKind === 'numeric' ? 'partial' : 'unresolved',
				children: [],
			}));
			continue;
		}
		const label = entry.name;
		entryNodes.push(buildNamedTableSection(
			context,
			appendBehaviorSourcePath(path, behaviorSourceFieldSegment(entry, index)),
			label,
			entry.field.value,
			activeDeclarations,
		));
	}
	children.push(createSourceNode(context, path, {
		kind: 'section',
		label: resolved.resolution === 'complete'
			? `${fieldName} (${entryNodes.length})`
			: `${fieldName} (${entryNodes.length} entries)`,
		detail: describeResolvedSourceTable(resolved),
		authoredRange: resolved.table.range,
		referenceRange: resolved.referenceRange,
		resolution: resolved.resolution,
		children: entryNodes,
	}));
}

function appendNamedSection(
	context: BehaviorRecognizerContext,
	path: string,
	owner: LuaTableConstructorExpression,
	activeDeclarations: Set<SymbolID>,
	children: BehaviorSourceNode[],
	fieldName: string,
): void {
	const field = findNamedLuaTableField(owner, fieldName);
	if (field) {
		children.push(buildNamedTableSection(context, path, fieldName, field.value, activeDeclarations));
	}
}

function appendExpressionListSection(
	context: BehaviorRecognizerContext,
	path: string,
	owner: LuaTableConstructorExpression,
	activeDeclarations: Set<SymbolID>,
	children: BehaviorSourceNode[],
	fieldName: string,
): void {
	const field = findNamedLuaTableField(owner, fieldName);
	if (!field) {
		return;
	}
	children.push(buildTableArraySection(
		context,
		path,
		fieldName,
		field.value,
		activeDeclarations,
		buildExpressionProperty,
	));
}

function appendScalarFields(
	context: BehaviorRecognizerContext,
	path: string,
	owner: LuaTableConstructorExpression,
	children: BehaviorSourceNode[],
	slots: StateMachineSourceSlot[],
): void {
	for (let index = 0; index < SCALAR_FIELDS.length; index += 1) {
		const fieldName = SCALAR_FIELDS[index];
		const field = findNamedLuaTableField(owner, fieldName);
		if (!field) {
			continue;
		}
		const source = createSourceNode(context, appendBehaviorSourcePath(path, fieldName), {
			kind: 'property',
			label: `${fieldName} = ${describeExpression(field.value)}`,
			detail: '',
			authoredRange: field.range,
			referenceRange: null,
			resolution: 'complete',
			children: [],
		});
		children.push(source);
		if (fieldName === 'update' || fieldName === 'entering_state') {
			slots.push({ kind: fieldName === 'update' ? 'update' : 'enter', source, field, value: field.value, spec: null, bindingComplete: true });
		}
	}
}
