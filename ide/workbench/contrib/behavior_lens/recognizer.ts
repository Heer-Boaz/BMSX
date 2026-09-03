import { LuaSyntaxKind, type LuaExpression } from '../../../../toolchain/ts/lua/syntax/ast';
import type { FileSemanticData, LuaCallSite, SymbolID } from '../../../../toolchain/ts/lua/semantic/model';
import type { ResourceIdentity } from '../../../common/resource';
import { buildActionEffectDefinition } from './action_effect';
import { buildBehaviorTreeDefinition } from './behavior_tree';
import type {
	BehaviorKind,
	BehaviorRegistrationSource,
	BehaviorSourceDocument,
	BehaviorSourceNode,
} from './model';
import {
	appendBehaviorSourcePath,
	collectConstInitializers,
	collectMutatedDeclarations,
	createBehaviorSourceAnchor,
	createDynamicNode,
	createSourceNode,
	describeResolvedSourceTable,
	describeExpression,
	resolveSourceTable,
	type BehaviorRecognizerContext,
	type ResolvedSourceTable,
} from './source';
import { buildStateMachineDefinition } from './state_machine';

type BehaviorRegistration = {
	readonly behaviorKind: BehaviorKind;
	readonly module: string;
	readonly member: string;
	readonly definitionArgument: number;
};

const REGISTRATIONS: readonly BehaviorRegistration[] = [
	{
		behaviorKind: 'behavior_tree',
		module: 'cartlib/behaviour_tree/library',
		member: 'register',
		definitionArgument: 1,
	},
	{
		behaviorKind: 'state_machine',
		module: 'cartlib/fsm/library',
		member: 'register',
		definitionArgument: 1,
	},
	{
		behaviorKind: 'action_effect',
		module: 'cartlib/actioneffects',
		member: 'register_effect',
		definitionArgument: 1,
	},
];

/**
 * Derives a behavior outline from the retained syntax and binding facts for one
 * authored Lua document. It never executes Lua or classifies runtime values.
 */
export function buildBehaviorSourceDocument(
	resource: ResourceIdentity,
	analysis: FileSemanticData,
): BehaviorSourceDocument {
	const constInitializers = collectConstInitializers(analysis);
	const mutatedDeclarations = collectMutatedDeclarations(analysis);
	const definitions: BehaviorSourceNode[] = [];
	const registrationOccurrences = new Map<string, number>();
	for (let index = 0; index < analysis.callSites.length; index += 1) {
		const callSite = analysis.callSites[index];
		const registration = resolveRegistration(callSite);
		if (registration) {
			const idExpression = callSite.expression.arguments[0];
			const idLabel = idExpression ? describeExpression(idExpression) : '<unresolved id>';
			const occurrenceKey = `${registration.behaviorKind}\0${idLabel}`;
			const occurrence = registrationOccurrences.get(occurrenceKey) || 0;
			registrationOccurrences.set(occurrenceKey, occurrence + 1);
			definitions.push(buildDefinition(
				resource,
				analysis,
				constInitializers,
				mutatedDeclarations,
				callSite,
				registration,
				idLabel,
				occurrence,
			));
		}
	}
	return {
		resource,
		definitions,
	};
}

/**
 * Collects source-owned registration identities without executing Lua or
 * assigning runtime meaning to an authored occurrence.
 */
export function collectBehaviorRegistrationSources(
	resource: ResourceIdentity,
	analysis: FileSemanticData,
): readonly BehaviorRegistrationSource[] {
	const constInitializers = collectConstInitializers(analysis);
	const activeDeclarations = new Set<SymbolID>();
	const sources: BehaviorRegistrationSource[] = [];
	for (let index = 0; index < analysis.callSites.length; index += 1) {
		const callSite = analysis.callSites[index];
		const registration = resolveRegistration(callSite);
		if (registration === null) {
			continue;
		}
		const idExpression = callSite.expression.arguments[0];
		if (idExpression === undefined) {
			continue;
		}
		const semanticId = resolveRegistrationId(
			analysis,
			constInitializers,
			idExpression,
			activeDeclarations,
		);
		if (semanticId === null) {
			continue;
		}
		sources.push({
			resource,
			behaviorKind: registration.behaviorKind,
			semanticId,
			range: idExpression.range,
		});
	}
	return sources;
}

function resolveRegistrationId(
	analysis: FileSemanticData,
	constInitializers: ReadonlyMap<SymbolID, LuaExpression>,
	expression: LuaExpression,
	activeDeclarations: Set<SymbolID>,
): string | null {
	if (expression.kind === LuaSyntaxKind.StringLiteralExpression) {
		return expression.value;
	}
	if (expression.kind !== LuaSyntaxKind.IdentifierExpression) {
		return null;
	}
	const declarationId = analysis.referencesBySyntax.get(expression)?.target;
	if (declarationId === undefined || activeDeclarations.has(declarationId)) {
		return null;
	}
	const initializer = constInitializers.get(declarationId);
	if (initializer === undefined) {
		return null;
	}
	activeDeclarations.add(declarationId);
	const value = resolveRegistrationId(
		analysis,
		constInitializers,
		initializer,
		activeDeclarations,
	);
	activeDeclarations.delete(declarationId);
	return value;
}

function resolveRegistration(
	callSite: LuaCallSite,
): BehaviorRegistration | null {
	const target = callSite.moduleTarget;
	if (callSite.expression.method !== null
		|| callSite.moduleTargetBinding !== 'immutable'
		|| !target
		|| target.memberPath.length !== 1) {
		return null;
	}
	for (let index = 0; index < REGISTRATIONS.length; index += 1) {
		const registration = REGISTRATIONS[index];
		if (target.module === registration.module && target.memberPath[0] === registration.member) {
			return registration;
		}
	}
	return null;
}

function buildDefinition(
	resource: ResourceIdentity,
	analysis: FileSemanticData,
	constInitializers: ReadonlyMap<SymbolID, LuaExpression>,
	mutatedDeclarations: ReadonlySet<SymbolID>,
	callSite: LuaCallSite,
	registration: BehaviorRegistration,
	idLabel: string,
	occurrence: number,
): BehaviorSourceNode {
	const call = callSite.expression;
	const definitionExpression = call.arguments[registration.definitionArgument];
	const context: BehaviorRecognizerContext = {
		analysis,
		constInitializers,
		mutatedDeclarations,
		anchor: createBehaviorSourceAnchor(resource, registration.behaviorKind, idLabel, occurrence),
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

function definitionKindLabel(kind: BehaviorKind): string {
	switch (kind) {
		case 'behavior_tree':
			return 'BT';
		case 'state_machine':
			return 'FSM';
		case 'action_effect':
			return 'EFFECT';
	}
}
