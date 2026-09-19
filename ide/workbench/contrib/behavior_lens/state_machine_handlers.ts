import type { FileSemanticData } from '../../../../toolchain/ts/lua/semantic/model';
import type { LuaExpression, LuaTableConstructorExpression } from '../../../../toolchain/ts/lua/syntax/ast';
import { findNamedLuaTableField } from '../../../../toolchain/ts/lua/syntax/table_fields';
import type { BehaviorSourceNode } from './model';
import type { StateMachineSourceSlot } from './state_machine_model';
import { appendBehaviorSourcePath, behaviorSourceFieldSegment, buildResolvedTableSection, buildTableArraySection,
	collectNamedFields, createDynamicNode, createSourceNode, describeExpression, describeResolvedSourceTable,
	resolveSourceTable, SourceTableIssue, type BehaviorRecognizerContext, type NamedSourceField, type ResolvedSourceTable } from './source';

export function appendFsmEventSection(
	context: BehaviorRecognizerContext,
	file: FileSemanticData,
	path: string,
	owner: LuaTableConstructorExpression,
	activeTables: Set<LuaTableConstructorExpression>,
	children: BehaviorSourceNode[],
	slots: StateMachineSourceSlot[],
): void {
	const fieldName = 'on';
	const field = findNamedLuaTableField(owner, fieldName);
	if (!field) {
		return;
	}
	const resolved = resolveSourceTable(context, file, field.value, activeTables);
	if (!resolved) {
		children.push(createDynamicNode(context, file, path, `dynamic ${fieldName}`, field.value));
		return;
	}
	const eventNodes: BehaviorSourceNode[] = [];
	const events = collectNamedFields(resolved.table);
	for (let index = 0; index < events.length; index += 1) {
		const event = events[index];
		const { source, spec } = buildFsmEvent(
			context, resolved.file,
			appendBehaviorSourcePath(path, behaviorSourceFieldSegment(event, index)),
			event,
			activeTables,
		);
		eventNodes.push(source);
		slots.push({ file: resolved.file, kind: 'event', source, spec, field: event.field, value: event.field.value,
			bindingComplete: (resolved.issues & SourceTableIssue.KnownMutation) === 0 });
	}
	children.push(createSourceNode(context, path, {
		kind: 'section',
		label: resolved.resolution === 'complete'
			? `events (${eventNodes.length})`
			: `events (${eventNodes.length} entries)`,
		detail: describeResolvedSourceTable(resolved),
		authoredRange: resolved.file.chunk.locations.range(resolved.table.span),
		referenceRange: resolved.referenceRange,
		resolution: resolved.resolution,
		children: eventNodes,
	}));
}

function buildFsmEvent(
	context: BehaviorRecognizerContext,
	file: FileSemanticData,
	path: string,
	event: NamedSourceField,
	activeTables: Set<LuaTableConstructorExpression>,
): { source: BehaviorSourceNode; spec: ResolvedSourceTable | null } {
	const eventName = event.name !== null ? event.name : `[${event.authoredKeyLabel}]`;
	const keyResolution = event.keyKind === 'named'
		? 'complete'
		: (event.keyKind === 'numeric' ? 'partial' : 'unresolved');
	const handler = resolveSourceTable(context, file, event.field.value, activeTables);
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
		return { spec: handler, source: createSourceNode(context, path, {
			kind: 'event',
			label: eventName,
			detail: detail.length > 0 ? detail : 'handler table',
			authoredRange: handler.file.chunk.locations.range(handler.table.span),
			referenceRange: handler.referenceRange,
			resolution: keyResolution === 'complete' ? handler.resolution : keyResolution,
			children: [],
		}) };
	}
	return { spec: null, source: createSourceNode(context, path, {
		kind: 'event',
		label: eventName,
		detail: describeExpression(event.field.value),
		authoredRange: file.chunk.locations.range(event.field.span),
		referenceRange: null,
		resolution: keyResolution,
		children: [],
	}) };
}

export function appendInputHandlers(
	context: BehaviorRecognizerContext,
	file: FileSemanticData,
	path: string,
	owner: LuaTableConstructorExpression,
	activeTables: Set<LuaTableConstructorExpression>,
	children: BehaviorSourceNode[],
	slots: StateMachineSourceSlot[],
): void {
	const field = findNamedLuaTableField(owner, 'input_event_handlers');
	if (!field) {
		return;
	}
	children.push(buildTableArraySection(
		context, file,
		path,
		'input handlers',
		field.value,
		activeTables,
		(entryContext, entryFile, entryPath, expression, active, entryField, index) => {
			const { source, spec } = buildInputHandler(entryContext, entryFile, entryPath, expression, active);
			slots.push({ file: entryFile, kind: 'input', source, spec, field: entryField, value: expression, bindingComplete: index !== null });
			return source;
		},
	));
}

function buildInputHandler(
	context: BehaviorRecognizerContext,
	file: FileSemanticData,
	path: string,
	expression: LuaExpression,
	activeTables: Set<LuaTableConstructorExpression>,
): { source: BehaviorSourceNode; spec: ResolvedSourceTable | null } {
	const resolved = resolveSourceTable(context, file, expression, activeTables);
	if (!resolved) {
		return { spec: null, source: createDynamicNode(context, file, path, 'dynamic input handler', expression) };
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
	return { spec: resolved, source: createSourceNode(context, path, {
		kind: 'event',
		label: pattern ? describeExpression(pattern.value) : '<unresolved input>',
		detail,
		authoredRange: resolved.file.chunk.locations.range(resolved.table.span),
		referenceRange: resolved.referenceRange,
		resolution: resolved.resolution !== 'complete' || !pattern ? 'partial' : 'complete',
		children: [],
	}) };
}

/** Timeline identity may be computed; its completion slot still has authored source. */
export function appendFsmTimelines(context: BehaviorRecognizerContext, file: FileSemanticData, path: string, owner: LuaTableConstructorExpression,
	active: Set<LuaTableConstructorExpression>, children: BehaviorSourceNode[], slots: StateMachineSourceSlot[]): void {
	const field = findNamedLuaTableField(owner, 'timelines');
	if (field === null) return;
	const resolved = resolveSourceTable(context, file, field.value, active);
	if (resolved === null) {
		children.push(createDynamicNode(context, file, path, 'dynamic timelines', field.value));
		return;
	}
	const entries = collectNamedFields(resolved.table);
	const nodes: BehaviorSourceNode[] = [];
	for (let index = 0; index < entries.length; index += 1) {
		const entry = entries[index];
		const entryPath = appendBehaviorSourcePath(path, behaviorSourceFieldSegment(entry, index));
		const label = entry.name === null ? `[${entry.authoredKeyLabel}]` : entry.name;
		const table = resolveSourceTable(context, resolved.file, entry.field.value, active);
		if (table === null) {
			nodes.push(createDynamicNode(context, resolved.file, entryPath, `unresolved ${label}`, entry.field.value));
			continue;
		}
		const source = buildResolvedTableSection(context, entryPath, label, table, resolved.file.chunk.locations.range(entry.field.span));
		nodes.push(source);
		const finished = findNamedLuaTableField(source.table, 'on_finished');
		if (finished !== null) slots.push({ file: source.file, kind: 'timeline-finished', source, field: finished, value: finished.value,
			spec: resolveSourceTable(context, source.file, finished.value, active),
			bindingComplete: source.issues === SourceTableIssue.None && (resolved.issues & SourceTableIssue.KnownMutation) === 0 });
	}
	children.push(createSourceNode(context, path, {
		kind: 'section', label: resolved.resolution === 'complete' ? `timelines (${nodes.length})` : `timelines (${nodes.length} entries)`,
		detail: describeResolvedSourceTable(resolved), authoredRange: resolved.file.chunk.locations.range(resolved.table.span), referenceRange: resolved.referenceRange,
		resolution: resolved.resolution, children: nodes,
	}));
}
