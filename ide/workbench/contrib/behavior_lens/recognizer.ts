import type { LuaExpression } from '../../../../toolchain/ts/lua/syntax/ast';
import type { FileSemanticData, SymbolID } from '../../../../toolchain/ts/lua/semantic/model';
import type { ResourceIdentity } from '../../../common/resource';
import { collectBehaviorRegistrations, definitionKindLabel, type BehaviorRegistration } from './registrations';
import { buildActionEffectDefinition } from './action_effect';
import { buildBehaviorTreeDefinition } from './behavior_tree';
import type {
	BehaviorSourceDocument,
	BehaviorSourceNode,
} from './model';
import {
	appendBehaviorSourcePath,
	collectMutatedDeclarations,
	createDynamicNode,
	createSourceNode,
	describeResolvedSourceTable,
	resolveSourceTable,
	type BehaviorRecognizerContext,
	type ResolvedSourceTable,
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
	const definitions: BehaviorSourceNode[] = [];
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
): BehaviorSourceNode {
	const call = registration.callSite.expression;
	const idLabel = registration.idLabel;
	const definitionExpression = call.arguments[registration.definitionArgument];
	const context: BehaviorRecognizerContext = {
		analysis,
		constInitializers,
		mutatedDeclarations,
		anchor: registration.anchor,
		behaviorKind: registration.behaviorKind,
		sourceIncomplete: analysis.syntaxError !== null,
	};
	const definitionPath = appendBehaviorSourcePath('', 'definition');
	if (!definitionExpression) {
		return createSourceNode(context, definitionPath, {
			kind: 'definition',
			label: `${definitionKindLabel(registration.behaviorKind)} ${idLabel}`,
			detail: 'registration has no definition argument',
			authoredRange: call.range,
			referenceRange: null,
			resolution: 'unresolved',
			children: [],
		});
	}
	const activeDeclarations = new Set<SymbolID>();
	const resolved = resolveSourceTable(context, definitionExpression, activeDeclarations);
	if (!resolved) {
		const dynamic = createDynamicNode(
			context,
			appendBehaviorSourcePath(definitionPath, 'value'),
			'definition',
			definitionExpression,
		);
		return createSourceNode(context, definitionPath, {
			kind: 'definition',
			label: `${definitionKindLabel(registration.behaviorKind)} ${idLabel}`,
			detail: sourceDetail(context, 'unresolved registration definition'),
			authoredRange: definitionExpression.range,
			referenceRange: null,
			resolution: 'unresolved',
			children: [dynamic],
		});
	}
	const resolvedDetail = describeResolvedSourceTable(resolved);
	let detail = resolvedDetail.length > 0
		? `source initializer ${resolvedDetail}`
		: 'source initializer';
	if (context.sourceIncomplete) {
		detail += ' | syntax recovery';
	}
	return createSourceNode(context, definitionPath, {
		kind: 'definition',
		label: `${definitionKindLabel(registration.behaviorKind)} ${idLabel}`,
		detail,
		authoredRange: resolved.table.range,
		referenceRange: resolved.referenceRange,
		resolution: resolved.resolution,
		children: buildDefinitionChildren(context, resolved, activeDeclarations),
	});
}

function sourceDetail(context: BehaviorRecognizerContext, detail: string): string {
	return context.sourceIncomplete ? `${detail} | syntax recovery` : detail;
}

function buildDefinitionChildren(
	context: BehaviorRecognizerContext,
	resolved: ResolvedSourceTable,
	activeDeclarations: Set<SymbolID>,
): readonly BehaviorSourceNode[] {
	switch (context.behaviorKind) {
		case 'behavior_tree':
			return buildBehaviorTreeDefinition(context, resolved.table, activeDeclarations);
		case 'state_machine':
			return buildStateMachineDefinition(context, resolved.table, activeDeclarations);
		case 'action_effect':
			return buildActionEffectDefinition(context, resolved.table, activeDeclarations);
	}
}
