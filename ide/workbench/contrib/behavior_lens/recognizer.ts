import type { LuaTableConstructorExpression } from '../../../../toolchain/ts/lua/syntax/ast';
import type { LuaSemanticWorkspaceSnapshot } from '../../../../toolchain/ts/lua/semantic/model';
import type { ResourceIdentity } from '../../../common/resource';
import { collectBehaviorRegistrations, type BehaviorRegistration } from './registrations';
import { buildActionEffectBody } from './action_effect';
import { buildBehaviorTreeDefinition } from './behavior_tree';
import type {
	BehaviorSourceDocument,
	BehaviorSourceDefinition,
} from './model';
import {
	appendBehaviorSourcePath,
	createDynamicNode,
	createSourceNode,
	describeResolvedSourceTable,
	resolveSourceTable,
	type BehaviorRecognizerContext,
	type SourceNodeInput,
} from './source';
import { BehaviorSourceReader } from './source_reader';
import { buildStateMachineBody } from './state_machine';
import { buildStateMachineRelations } from './state_machine_relations';

/**
 * Derives a behavior outline from the retained syntax and binding facts for one
 * authored Lua document. It never executes Lua or classifies runtime values.
 */
export function buildBehaviorSourceDocument(
	resource: ResourceIdentity,
	snapshot: LuaSemanticWorkspaceSnapshot,
): BehaviorSourceDocument {
	const analysis = snapshot.getFileData(resource.path)!;
	const reader = new BehaviorSourceReader(snapshot);
	reader.files.add(analysis);
	const { registrations } = collectBehaviorRegistrations(resource, reader);
	const definitions: BehaviorSourceDefinition[] = [];
	for (const registration of registrations) {
		definitions.push(buildDefinition(reader, registration));
	}
	return {
		resource,
		files: Array.from(reader.files, file => ({ file: file.file, revision: file.revision })),
		syntaxComplete: [...reader.files].every(file => file.syntaxError === null),
		definitions,
	};
}

function buildDefinition(
	reader: BehaviorSourceReader,
	registration: BehaviorRegistration,
): BehaviorSourceDefinition {
	const call = registration.callSite.expression;
	const definitionExpression = call.arguments[registration.definitionArgument];
	const context: BehaviorRecognizerContext = {
		reader,
		anchor: registration.anchor,
		behaviorKind: registration.behaviorKind,
		registrationRange: call.range,
		sourceIncomplete: reader.snapshot.getFileData(call.range.path)!.syntaxError !== null,
	};
	const definitionPath = appendBehaviorSourcePath('', 'definition');
	const activeTables = new Set<LuaTableConstructorExpression>();
	const resolved = definitionExpression
		? resolveSourceTable(context, definitionExpression, activeTables) : null;
	let input: SourceNodeInput & { kind: 'definition' };
	if (!definitionExpression) {
		input = {
			kind: 'definition',
			label: registration.label,
			detail: 'registration has no definition argument',
			authoredRange: call.range,
			referenceRange: null,
			resolution: 'unresolved',
			children: [],
		};
	} else if (resolved === null) {
		input = {
			kind: 'definition',
			label: registration.label,
			detail: context.sourceIncomplete ? 'unresolved registration definition | syntax recovery' : 'unresolved registration definition',
			authoredRange: definitionExpression.range,
			referenceRange: null,
			resolution: 'unresolved',
			children: [createDynamicNode(context, appendBehaviorSourcePath(definitionPath, 'value'), 'definition', definitionExpression)],
		};
	} else {
		const resolvedDetail = describeResolvedSourceTable(resolved);
		const detail = resolvedDetail.length > 0 ? `source initializer ${resolvedDetail}` : 'source initializer';
		input = {
			kind: 'definition',
			label: registration.label,
			detail,
			authoredRange: resolved.table.range,
			referenceRange: resolved.referenceRange,
			resolution: resolved.resolution,
			children: [],
		};
	}
	if (context.behaviorKind === 'behavior_tree') {
		const body = resolved === null
			? { root: null, blackboard: null, children: input.children }
			: buildBehaviorTreeDefinition(context, resolved.table, activeTables);
		return createSourceNode(context, definitionPath, { ...input, ...body });
	}
	if (context.behaviorKind === 'state_machine') {
		const source = resolved === null ? { body: null, children: input.children }
			: buildStateMachineBody(context, '', resolved, activeTables);
		const relations = source.body === null ? { scopes: [], entries: [], transitions: [] }
			: buildStateMachineRelations(context, context.anchor + definitionPath, source.body);
		return createSourceNode(context, definitionPath, { ...input, ...source, ...relations });
	}
	const source = resolved === null ? { body: null, children: input.children }
		: buildActionEffectBody(context, resolved, activeTables);
	return createSourceNode(context, definitionPath, { ...input, ...source });
}
