import { LuaSyntaxKind, type LuaExpression } from '../../../../toolchain/ts/lua/syntax/ast';
import type { FileSemanticData, LuaCallSite, SymbolID } from '../../../../toolchain/ts/lua/semantic/model';
import type { ResourceIdentity } from '../../../common/resource';
import type { BehaviorKind, BehaviorRegistrationSource } from './model';
import { appendBehaviorSourcePath, collectConstInitializers, createBehaviorSourceAnchor, describeExpression, resolveConstSourceExpression } from './source';

type BehaviorRegistrationKind = {
	readonly behaviorKind: BehaviorKind;
	readonly module: string;
	readonly member: string;
	readonly definitionArgument: number;
};

const REGISTRATIONS: readonly BehaviorRegistrationKind[] = [
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

/** Shallow source registration; topology is built only when its document is opened. */
export type BehaviorRegistration = BehaviorRegistrationSource & {
	readonly callSite: LuaCallSite;
	readonly definitionArgument: number;
	readonly anchor: string;
	readonly idLabel: string;
};

export type BehaviorRegistrationSet = {
	readonly constInitializers: ReadonlyMap<SymbolID, LuaExpression>;
	readonly registrations: readonly BehaviorRegistration[];
};

export function collectBehaviorRegistrations(resource: ResourceIdentity, analysis: FileSemanticData): BehaviorRegistrationSet {
	const constInitializers = collectConstInitializers(analysis);
	const activeDeclarations = new Set<SymbolID>();
	const occurrences = new Map<string, number>();
	const registrations: BehaviorRegistration[] = [];
	for (const callSite of analysis.callSites) {
		const registration = resolveRegistration(callSite);
		if (registration === null) continue;
		const idExpression = callSite.expression.arguments[0];
		const idLabel = idExpression ? describeExpression(idExpression) : '<unresolved id>';
		const idValue = idExpression && resolveConstSourceExpression(analysis, constInitializers, idExpression, activeDeclarations);
		const semanticId = idValue?.kind === LuaSyntaxKind.StringLiteralExpression ? idValue.value : null;
		const occurrenceKey = `${registration.behaviorKind}\0${idLabel}`;
		const occurrence = occurrences.get(occurrenceKey) || 0;
		occurrences.set(occurrenceKey, occurrence + 1);
		const anchor = createBehaviorSourceAnchor(resource, registration.behaviorKind, idLabel, occurrence);
		registrations.push({
			resource,
			behaviorKind: registration.behaviorKind,
			semanticId,
			label: `${definitionKindLabel(registration.behaviorKind)} ${semanticId === null ? idLabel : semanticId}`,
			range: idExpression ? idExpression.range : callSite.expression.range,
			occurrenceRange: callSite.expression.range,
			rowKey: anchor + appendBehaviorSourcePath('', 'definition'),
			callSite,
			definitionArgument: registration.definitionArgument,
			anchor,
			idLabel,
		});
	}
	return { constInitializers, registrations };
}

function resolveRegistration(
	callSite: LuaCallSite,
): BehaviorRegistrationKind | null {
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

export function definitionKindLabel(kind: BehaviorKind): string {
	switch (kind) {
		case 'behavior_tree':
			return 'BT';
		case 'state_machine':
			return 'FSM';
		case 'action_effect':
			return 'EFFECT';
	}
}
