import {
	LuaSyntaxKind,
	type LuaExpression,
	type LuaTableConstructorExpression,
} from '../../../../toolchain/ts/lua/syntax/ast';
import { findNamedLuaTableField } from '../../../../toolchain/ts/lua/syntax/table_fields';
import type { SymbolID } from '../../../../toolchain/ts/lua/semantic/model';
import type { BehaviorSourceNode } from './model';
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
	type BehaviorRecognizerContext,
	type NamedSourceField,
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

export function buildStateMachineDefinition(
	context: BehaviorRecognizerContext,
	definition: LuaTableConstructorExpression,
	activeDeclarations: Set<SymbolID>,
): readonly BehaviorSourceNode[] {
	const children: BehaviorSourceNode[] = [];
	appendScalarFields(context, '', definition, children);
	appendFsmEventSection(context, appendBehaviorSourcePath('', 'on'), definition, activeDeclarations, children, 'on');
	appendTableMapSection(context, appendBehaviorSourcePath('', 'timelines'), definition, activeDeclarations, children, 'timelines');
	appendNamedSection(context, appendBehaviorSourcePath('', 'data'), definition, activeDeclarations, children, 'data');
	appendNamedSection(context, appendBehaviorSourcePath('', 'transition_guards'), definition, activeDeclarations, children, 'transition_guards');
	appendTableMapSection(context, appendBehaviorSourcePath('', 'tag_derivations'), definition, activeDeclarations, children, 'tag_derivations');
	appendExpressionListSection(context, appendBehaviorSourcePath('', 'tags'), definition, activeDeclarations, children, 'tags');
	appendExpressionListSection(context, appendBehaviorSourcePath('', 'event_list'), definition, activeDeclarations, children, 'event_list');
	appendExpressionListSection(context, appendBehaviorSourcePath('', 'actioneffects'), definition, activeDeclarations, children, 'actioneffects');
	appendInputHandlers(context, appendBehaviorSourcePath('', 'input_event_handlers'), definition, activeDeclarations, children);
	appendFsmStates(context, appendBehaviorSourcePath('', 'states'), definition, activeDeclarations, children);
	return children;
}

function appendFsmStates(
	context: BehaviorRecognizerContext,
	path: string,
	owner: LuaTableConstructorExpression,
	activeDeclarations: Set<SymbolID>,
	children: BehaviorSourceNode[],
): void {
	const statesField = findNamedLuaTableField(owner, 'states');
	if (!statesField) {
		return;
	}
	const resolved = resolveSourceTable(context, statesField.value, activeDeclarations);
	if (!resolved) {
		children.push(createDynamicNode(context, path, 'dynamic states', statesField.value));
		return;
	}
	const initialField = findNamedLuaTableField(owner, 'initial');
	const initial = initialField && initialField.value.kind === LuaSyntaxKind.StringLiteralExpression
		? initialField.value.value
		: null;
	const stateNodes: BehaviorSourceNode[] = [];
	const stateFields = collectNamedFields(resolved.table);
	let knownStateCount = 0;
	for (let index = 0; index < stateFields.length; index += 1) {
		const entry = stateFields[index];
		if (entry.name === null) {
			stateNodes.push(createSourceNode(context, appendBehaviorSourcePath(path, behaviorSourceFieldSegment(entry, index)), {
				kind: 'dynamic',
				label: `[${entry.authoredKeyLabel}]`,
				detail: `state = ${describeExpression(entry.field.value)}`,
				authoredRange: entry.field.range,
				referenceRange: null,
				resolution: entry.keyKind === 'numeric' ? 'partial' : 'unresolved',
				children: [],
			}));
			continue;
		}
		knownStateCount += 1;
		stateNodes.push(buildFsmState(
			context,
			appendBehaviorSourcePath(path, behaviorSourceFieldSegment(entry, index)),
			entry.name,
			entry.field.value,
			initial === entry.name,
			activeDeclarations,
		));
	}
	children.push(createSourceNode(context, path, {
		kind: 'section',
		label: resolved.resolution === 'complete'
			? `states (${knownStateCount})`
			: `states (${knownStateCount} known)`,
		detail: describeResolvedSourceTable(resolved),
		authoredRange: resolved.table.range,
		referenceRange: resolved.referenceRange,
		resolution: resolved.resolution,
		children: stateNodes,
	}));
}

function buildFsmState(
	context: BehaviorRecognizerContext,
	path: string,
	name: string,
	expression: LuaExpression,
	initial: boolean,
	activeDeclarations: Set<SymbolID>,
): BehaviorSourceNode {
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
	const children: BehaviorSourceNode[] = [];
	appendScalarFields(context, path, state, children);
	appendFsmEventSection(context, appendBehaviorSourcePath(path, 'on'), state, activeDeclarations, children, 'on');
	appendTableMapSection(context, appendBehaviorSourcePath(path, 'timelines'), state, activeDeclarations, children, 'timelines');
	appendNamedSection(context, appendBehaviorSourcePath(path, 'data'), state, activeDeclarations, children, 'data');
	appendNamedSection(context, appendBehaviorSourcePath(path, 'transition_guards'), state, activeDeclarations, children, 'transition_guards');
	appendExpressionListSection(context, appendBehaviorSourcePath(path, 'tags'), state, activeDeclarations, children, 'tags');
	appendExpressionListSection(context, appendBehaviorSourcePath(path, 'event_list'), state, activeDeclarations, children, 'event_list');
	appendExpressionListSection(context, appendBehaviorSourcePath(path, 'actioneffects'), state, activeDeclarations, children, 'actioneffects');
	appendInputHandlers(context, appendBehaviorSourcePath(path, 'input_event_handlers'), state, activeDeclarations, children);
	appendFsmStates(context, appendBehaviorSourcePath(path, 'states'), state, activeDeclarations, children);
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
		children,
	});
}

function appendFsmEventSection(
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
	const eventNodes: BehaviorSourceNode[] = [];
	const events = collectNamedFields(resolved.table);
	for (let index = 0; index < events.length; index += 1) {
		const event = events[index];
		eventNodes.push(buildFsmEvent(
			context,
			appendBehaviorSourcePath(path, behaviorSourceFieldSegment(event, index)),
			event,
			activeDeclarations,
		));
	}
	children.push(createSourceNode(context, path, {
		kind: 'section',
		label: resolved.resolution === 'complete'
			? `events (${eventNodes.length})`
			: `events (${eventNodes.length} entries)`,
		detail: describeResolvedSourceTable(resolved),
		authoredRange: resolved.table.range,
		referenceRange: resolved.referenceRange,
		resolution: resolved.resolution,
		children: eventNodes,
	}));
}

function buildFsmEvent(
	context: BehaviorRecognizerContext,
	path: string,
	event: NamedSourceField,
	activeDeclarations: Set<SymbolID>,
): BehaviorSourceNode {
	const eventName = event.name !== null ? event.name : `[${event.authoredKeyLabel}]`;
	const keyResolution = event.keyKind === 'named'
		? 'complete'
		: (event.keyKind === 'numeric' ? 'partial' : 'unresolved');
	const handler = resolveSourceTable(context, event.field.value, activeDeclarations);
	if (handler) {
		const go = findNamedLuaTableField(handler.table, 'go');
		const emitter = findNamedLuaTableField(handler.table, 'emitter');
		let detail = go ? `go=${describeExpression(go.value)}` : '';
		if (emitter) {
			const emitterDetail = `emitter=${describeExpression(emitter.value)}`;
			detail = detail.length > 0 ? `${detail} | ${emitterDetail}` : emitterDetail;
		}
		const sourceDetail = describeResolvedSourceTable(handler);
		if (sourceDetail.length > 0) {
			detail = detail.length > 0 ? `${detail} | ${sourceDetail}` : sourceDetail;
		}
		return createSourceNode(context, path, {
			kind: 'event',
			label: eventName,
			detail: detail.length > 0 ? detail : 'handler table',
			authoredRange: handler.table.range,
			referenceRange: handler.referenceRange,
			resolution: keyResolution === 'complete' ? handler.resolution : keyResolution,
			children: [],
		});
	}
	return createSourceNode(context, path, {
		kind: 'event',
		label: eventName,
		detail: describeExpression(event.field.value),
		authoredRange: event.field.range,
		referenceRange: null,
		resolution: keyResolution,
		children: [],
	});
}

function appendInputHandlers(
	context: BehaviorRecognizerContext,
	path: string,
	owner: LuaTableConstructorExpression,
	activeDeclarations: Set<SymbolID>,
	children: BehaviorSourceNode[],
): void {
	const field = findNamedLuaTableField(owner, 'input_event_handlers');
	if (!field) {
		return;
	}
	children.push(buildTableArraySection(
		context,
		path,
		'input handlers',
		field.value,
		activeDeclarations,
		buildInputHandler,
	));
}

function buildInputHandler(
	context: BehaviorRecognizerContext,
	path: string,
	expression: LuaExpression,
	activeDeclarations: Set<SymbolID>,
): BehaviorSourceNode {
	const resolved = resolveSourceTable(context, expression, activeDeclarations);
	if (!resolved) {
		return createDynamicNode(context, path, 'dynamic input handler', expression);
	}
	const pattern = findNamedLuaTableField(resolved.table, 'pattern');
	const go = findNamedLuaTableField(resolved.table, 'go');
	const playerIndex = findNamedLuaTableField(resolved.table, 'player_index');
	const emitter = findNamedLuaTableField(resolved.table, 'emitter');
	let detail = go ? `go=${describeExpression(go.value)}` : '';
	if (playerIndex) {
		const suffix = `player=${describeExpression(playerIndex.value)}`;
		detail = detail.length > 0 ? `${detail} | ${suffix}` : suffix;
	}
	if (emitter) {
		const suffix = `emitter=${describeExpression(emitter.value)}`;
		detail = detail.length > 0 ? `${detail} | ${suffix}` : suffix;
	}
	return createSourceNode(context, path, {
		kind: 'event',
		label: pattern ? describeExpression(pattern.value) : '<unresolved input>',
		detail,
		authoredRange: resolved.table.range,
		referenceRange: resolved.referenceRange,
		resolution: resolved.resolution !== 'complete' || !pattern ? 'partial' : 'complete',
		children: [],
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
): void {
	for (let index = 0; index < SCALAR_FIELDS.length; index += 1) {
		const fieldName = SCALAR_FIELDS[index];
		const field = findNamedLuaTableField(owner, fieldName);
		if (!field) {
			continue;
		}
		children.push(createSourceNode(context, appendBehaviorSourcePath(path, fieldName), {
			kind: 'property',
			label: `${fieldName} = ${describeExpression(field.value)}`,
			detail: '',
			authoredRange: field.range,
			referenceRange: null,
			resolution: 'complete',
			children: [],
		}));
	}
}
