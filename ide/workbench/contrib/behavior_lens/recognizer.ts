import type { LuaExpression } from '../../../../toolchain/ts/lua/syntax/ast';
import type { FileSemanticData, SymbolID } from '../../../../toolchain/ts/lua/semantic/model';
import type { ResourceIdentity } from '../../../common/resource';
import { collectBehaviorRegistrations, definitionKindLabel, type BehaviorRegistration } from './registrations';
import { buildActionEffectDefinition } from './action_effect';
import { buildBehaviorTreeDefinition } from './behavior_tree';
import type {
	BehaviorSourceDocument,
	BehaviorSourceDefinition,
} from './model';
import {
	appendBehaviorSourcePath,
	collectMutatedDeclarations,
	createDynamicNode,
	createSourceNode,
	describeResolvedSourceTable,
	resolveSourceTable,
	type BehaviorRecognizerContext,
	type SourceNodeInput,
} from './source';
import { buildStateMachineDefinition } from './state_machine';

/**
 * Derives a behavior outline from the retained syntax and binding facts for one
 * authored Lua document. It never executes Lua or classifies runtime values.
 */
export function buildBehaviorSourceDocument(
	resource: ResourceIdentity,
	analysis: FileSemanticData,
): BehaviorSourceDocument {
	const { constInitializers, registrations } = collectBehaviorRegistrations(resource, analysis);
	const mutatedDeclarations = collectMutatedDeclarations(analysis);
	const definitions: BehaviorSourceDefinition[] = [];
	for (const registration of registrations) {
		definitions.push(buildDefinition(analysis, constInitializers, mutatedDeclarations, registration));
	}
	return {
		resource,
		definitions,
	};
}

function buildDefinition(
	analysis: FileSemanticData,
	constInitializers: ReadonlyMap<SymbolID, LuaExpression>,
	mutatedDeclarations: ReadonlySet<SymbolID>,
	registration: BehaviorRegistration,
): BehaviorSourceDefinition {
	const call = registration.callSite.expression;
	const idLabel = registration.idLabel;
	const definitionExpression = call.arguments[registration.definitionArgument];
	const context: BehaviorRecognizerContext = {
		analysis,
		constInitializers,
		mutatedDeclarations,
		anchor: registration.anchor,
		behaviorKind: registration.behaviorKind,
		registrationRange: call.range,
		sourceIncomplete: analysis.syntaxError !== null,
	};
	const definitionPath = appendBehaviorSourcePath('', 'definition');
	const activeDeclarations = new Set<SymbolID>();
	const resolved = definitionExpression
		? resolveSourceTable(context, definitionExpression, activeDeclarations) : null;
	let input: SourceNodeInput & { kind: 'definition' };
	if (!definitionExpression) {
		input = {
			kind: 'definition',
			label: `${definitionKindLabel(registration.behaviorKind)} ${idLabel}`,
			detail: 'registration has no definition argument',
			authoredRange: call.range,
			referenceRange: null,
			resolution: 'unresolved',
			children: [],
		};
	} else if (resolved === null) {
		input = {
			kind: 'definition',
			label: `${definitionKindLabel(registration.behaviorKind)} ${idLabel}`,
			detail: context.sourceIncomplete ? 'unresolved registration definition | syntax recovery' : 'unresolved registration definition',
			authoredRange: definitionExpression.range,
			referenceRange: null,
			resolution: 'unresolved',
			children: [createDynamicNode(context, appendBehaviorSourcePath(definitionPath, 'value'), 'definition', definitionExpression)],
		};
	} else {
		const resolvedDetail = describeResolvedSourceTable(resolved);
		let detail = resolvedDetail.length > 0 ? `source initializer ${resolvedDetail}` : 'source initializer';
		if (context.sourceIncomplete) detail += ' | syntax recovery';
		input = {
			kind: 'definition',
			label: `${definitionKindLabel(registration.behaviorKind)} ${idLabel}`,
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
			: buildBehaviorTreeDefinition(context, resolved.table, activeDeclarations);
		return createSourceNode(context, definitionPath, { ...input, ...body });
	}
	return createSourceNode(context, definitionPath, {
		...input,
		children: resolved === null ? input.children
			: context.behaviorKind === 'state_machine'
				? buildStateMachineDefinition(context, resolved.table, activeDeclarations)
				: buildActionEffectDefinition(context, resolved.table, activeDeclarations),
	});
}
