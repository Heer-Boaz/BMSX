import type { FileSemanticData } from '../../../../toolchain/ts/lua/semantic/model';
import {
	LuaSyntaxKind,
	LuaTableFieldKind,
	type LuaExpression,
	type LuaTableConstructorExpression,
} from '../../../../toolchain/ts/lua/syntax/ast';
import type { BehaviorDynamicSourceNode, BehaviorSourceNode } from './model';
import { appendFsmEventSection, appendInputHandlers, appendFsmTimelines } from './state_machine_handlers';
import type { StateMachineSourceBody, StateMachineSourceSlot, StateMachineSourceState, StateMachineSourceStates } from './state_machine_model';
import {
	appendBehaviorSourcePath,
	behaviorSourceFieldSegment,
	buildExpressionProperty,
	buildNamedTableSection,
	buildTableArraySection,
	createDynamicNode,
	createSourceNode,
	describeExpression,
	describeResolvedSourceTable,
	findNamedSourceField,
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
	context: BehaviorRecognizerContext, path: string, resolved: ResolvedSourceTable, activeTables: Set<LuaTableConstructorExpression>,
): { body: StateMachineSourceBody; children: readonly BehaviorSourceNode[] } {
	const file = resolved.file;
	const definition = resolved.table;
	activeTables.add(definition);
	const children: BehaviorSourceNode[] = [];
	const slots: StateMachineSourceSlot[] = [];
	appendScalarFields(context, file, path, resolved, children, slots);
	appendFsmEventSection(context, file, appendBehaviorSourcePath(path, 'on'), resolved, activeTables, children, slots);
	appendFsmTimelines(context, file, appendBehaviorSourcePath(path, 'timelines'), resolved, activeTables, children, slots);
	appendNamedSection(context, file, appendBehaviorSourcePath(path, 'data'), resolved, activeTables, children, 'data');
	const guardField = findNamedSourceField(resolved, 'transition_guards');
	let guards: StateMachineSourceBody['guards'] = null;
	if (guardField !== null) {
		const source = buildNamedTableSection(context, file, appendBehaviorSourcePath(path, 'transition_guards'), 'transition_guards', guardField.value, activeTables);
		children.push(source);
		guards = { source, field: guardField,
			canEnter: source.kind === 'dynamic' ? null : findNamedSourceField(source, 'can_enter'),
			canExit: source.kind === 'dynamic' ? null : findNamedSourceField(source, 'can_exit') };
	}
	if (path.length === 0) appendTableMapSection(context, file, appendBehaviorSourcePath(path, 'tag_derivations'), resolved, activeTables, children, 'tag_derivations');
	appendExpressionListSection(context, file, appendBehaviorSourcePath(path, 'tags'), resolved, activeTables, children, 'tags');
	appendExpressionListSection(context, file, appendBehaviorSourcePath(path, 'event_list'), resolved, activeTables, children, 'event_list');
	appendExpressionListSection(context, file, appendBehaviorSourcePath(path, 'actioneffects'), resolved, activeTables, children, 'actioneffects');
	appendInputHandlers(context, file, appendBehaviorSourcePath(path, 'input_event_handlers'), resolved, activeTables, children, slots);
	const states = appendFsmStates(context, file, appendBehaviorSourcePath(path, 'states'), resolved, activeTables, children);
	activeTables.delete(definition);
	return { body: { file, table: definition, issues: resolved.issues, initial: findNamedSourceField(resolved, 'initial'),
		concurrent: findNamedSourceField(resolved, 'is_concurrent'), guards, states, slots }, children };
}

function appendFsmStates(
	context: BehaviorRecognizerContext,
	file: FileSemanticData,
	path: string,
	owner: ResolvedSourceTable,
	activeTables: Set<LuaTableConstructorExpression>,
	children: BehaviorSourceNode[],
): StateMachineSourceStates | null {
	const statesField = findNamedSourceField(owner, 'states');
	if (!statesField) {
		return null;
	}
	const resolved = resolveSourceTable(context, file, statesField.value, activeTables);
	if (!resolved) {
		const source = createDynamicNode(context, file, path, 'dynamic states', statesField.value);
		children.push(source);
		return { kind: 'dynamic', file, source, field: statesField };
	}
	// Implicit numeric members are not string-addressable child definitions either.
	const issues = resolved.table.fields.some(field => field.kind === LuaTableFieldKind.Array)
		? resolved.issues | SourceTableIssue.NumericKey : resolved.issues;
	const initialField = findNamedSourceField(owner, 'initial');
	const initial = initialField === null ? undefined : context.reader.stringValue(file, initialField.value);
	const stateNodes: BehaviorSourceNode[] = [];
	const entries: Extract<StateMachineSourceStates, { kind: 'resolved' }>['entries'][number][] = [];
	const stateFields = resolved.fields;
	let knownStateCount = 0;
	for (let index = 0; index < stateFields.length; index += 1) {
		const entry = stateFields[index];
		if (entry.name === null) {
			const node = createSourceNode(context, appendBehaviorSourcePath(path, behaviorSourceFieldSegment(entry, index)), {
				kind: 'dynamic',
				label: `[${entry.authoredKeyLabel}]`,
				detail: `state = ${describeExpression(entry.field.value)}`,
				authoredRange: resolved.file.chunk.locations.range(entry.field.span),
				referenceRange: null,
				resolution: entry.keyKind === 'numeric' ? 'partial' : 'unresolved',
				children: [],
			});
			stateNodes.push(node);
			entries.push({ file: resolved.file, name: null, field: entry.field, node });
			continue;
		}
		knownStateCount += 1;
		const node = buildFsmState(
			context, resolved.file,
			appendBehaviorSourcePath(path, behaviorSourceFieldSegment(entry, index)),
			entry.name,
			entry.field.value,
			initial === entry.name,
			activeTables,
		);
		stateNodes.push(node);
		entries.push({ file: resolved.file, name: entry.name, field: entry.field, node });
	}
	const source = createSourceNode(context, path, {
		kind: 'section',
		label: issues === SourceTableIssue.None
			? `states (${knownStateCount})`
			: `states (${knownStateCount} known)`,
		detail: describeResolvedSourceTable(resolved),
		authoredRange: resolved.file.chunk.locations.range(resolved.table.span),
		referenceRange: resolved.referenceRange,
		resolution: issues === SourceTableIssue.None ? 'complete' : 'partial',
		children: stateNodes,
	});
	children.push(source);
	return { kind: 'resolved', file, field: statesField, source, issues, entries };
}

function buildFsmState(
	context: BehaviorRecognizerContext,
	file: FileSemanticData,
	path: string,
	name: string,
	expression: LuaExpression,
	initial: boolean,
	activeTables: Set<LuaTableConstructorExpression>,
): StateMachineSourceState | BehaviorDynamicSourceNode {
	const resolved = resolveSourceTable(context, file, expression, activeTables);
	if (!resolved) {
		return createDynamicNode(context, file, path, `state ${name}: dynamic`, expression);
	}
	const state = resolved.table;
	const concurrentField = findNamedSourceField(resolved, 'is_concurrent');
	const concurrentValue = concurrentField && context.reader.expression(resolved.file, concurrentField.value)?.expression;
	const concurrent = concurrentValue?.kind === LuaSyntaxKind.BooleanLiteralExpression && concurrentValue.value;
	const markers: string[] = [];
	if (initial) {
		markers.push('initial');
	}
	if (concurrent) {
		markers.push('concurrent');
	}
	const { body, children } = buildStateMachineBody(context, path, resolved, activeTables);
	const sourceDetail = describeResolvedSourceTable(resolved);
	if (sourceDetail.length > 0) {
		markers.push(sourceDetail);
	}
	return createSourceNode(context, path, {
		kind: 'state',
		label: name,
		preserveLabelCase: true,
		detail: markers.join(', '),
		authoredRange: resolved.file.chunk.locations.range(state.span),
		referenceRange: resolved.referenceRange,
		resolution: resolved.resolution,
		body,
		children,
	});
}

function appendTableMapSection(
	context: BehaviorRecognizerContext,
	file: FileSemanticData,
	path: string,
	owner: ResolvedSourceTable,
	activeTables: Set<LuaTableConstructorExpression>,
	children: BehaviorSourceNode[],
	fieldName: string,
): void {
	const field = findNamedSourceField(owner, fieldName);
	if (!field) {
		return;
	}
	const resolved = resolveSourceTable(context, file, field.value, activeTables);
	if (!resolved) {
		children.push(createDynamicNode(context, file, path, `dynamic ${fieldName}`, field.value));
		return;
	}
	const entries = resolved.fields;
	const entryNodes: BehaviorSourceNode[] = [];
	for (let index = 0; index < entries.length; index += 1) {
		const entry = entries[index];
		if (entry.name === null) {
			entryNodes.push(createSourceNode(context, appendBehaviorSourcePath(path, behaviorSourceFieldSegment(entry, index)), {
				kind: 'dynamic',
				label: `[${entry.authoredKeyLabel}]`,
				detail: describeExpression(entry.field.value),
				authoredRange: resolved.file.chunk.locations.range(entry.field.span),
				referenceRange: null,
				resolution: entry.keyKind === 'numeric' ? 'partial' : 'unresolved',
				children: [],
			}));
			continue;
		}
		const label = entry.name;
		entryNodes.push(buildNamedTableSection(
			context, resolved.file,
			appendBehaviorSourcePath(path, behaviorSourceFieldSegment(entry, index)),
			label,
			entry.field.value,
			activeTables,
		));
	}
	children.push(createSourceNode(context, path, {
		kind: 'section',
		label: resolved.resolution === 'complete'
			? `${fieldName} (${entryNodes.length})`
			: `${fieldName} (${entryNodes.length} entries)`,
		detail: describeResolvedSourceTable(resolved),
		authoredRange: resolved.file.chunk.locations.range(resolved.table.span),
		referenceRange: resolved.referenceRange,
		resolution: resolved.resolution,
		children: entryNodes,
	}));
}

function appendNamedSection(
	context: BehaviorRecognizerContext,
	file: FileSemanticData,
	path: string,
	owner: ResolvedSourceTable,
	activeTables: Set<LuaTableConstructorExpression>,
	children: BehaviorSourceNode[],
	fieldName: string,
): void {
	const field = findNamedSourceField(owner, fieldName);
	if (field) {
		children.push(buildNamedTableSection(context, file, path, fieldName, field.value, activeTables));
	}
}

function appendExpressionListSection(
	context: BehaviorRecognizerContext,
	file: FileSemanticData,
	path: string,
	owner: ResolvedSourceTable,
	activeTables: Set<LuaTableConstructorExpression>,
	children: BehaviorSourceNode[],
	fieldName: string,
): void {
	const field = findNamedSourceField(owner, fieldName);
	if (!field) {
		return;
	}
	children.push(buildTableArraySection(
		context, file,
		path,
		fieldName,
		field.value,
		activeTables,
		buildExpressionProperty,
	));
}

function appendScalarFields(
	context: BehaviorRecognizerContext,
	file: FileSemanticData,
	path: string,
	owner: ResolvedSourceTable,
	children: BehaviorSourceNode[],
	slots: StateMachineSourceSlot[],
): void {
	for (let index = 0; index < SCALAR_FIELDS.length; index += 1) {
		const fieldName = SCALAR_FIELDS[index];
		const field = findNamedSourceField(owner, fieldName);
		if (!field) {
			continue;
		}
		const source = createSourceNode(context, appendBehaviorSourcePath(path, fieldName), {
			kind: 'property',
			label: `${fieldName} = ${describeExpression(field.value)}`,
			detail: '',
			authoredRange: file.chunk.locations.range(field.span),
			referenceRange: null,
			resolution: 'complete',
			children: [],
		});
		children.push(source);
		if (fieldName === 'update' || fieldName === 'entering_state') {
			slots.push({ file, kind: fieldName === 'update' ? 'update' : 'enter', source, field, value: field.value, spec: null, bindingComplete: true });
		}
	}
}
