import type { LuaTableConstructorExpression } from '../../../../toolchain/ts/lua/syntax/ast';
import type { SymbolID } from '../../../../toolchain/ts/lua/semantic/model';
import type { BehaviorSourceNode } from './model';
import {
	appendBehaviorSourcePath,
	buildExpressionProperty,
	buildTableArraySection,
	collectNamedFields,
	createSourceNode,
	describeExpression,
	type BehaviorRecognizerContext,
} from './source';

const ACTION_EFFECT_FIELDS = new Set([
	'event',
	'handler',
	'can_trigger',
	'cooldown_ms',
	'calculate_cooldown_ms',
	'initial_cooldown_ms',
	'defer_cooldown_commit',
	'period_ms',
	'required_tags',
	'blocked_tags',
	'required_state_paths',
	'blocked_state_paths',
]);

const ACTION_EFFECT_LIST_FIELDS = new Set([
	'required_tags',
	'blocked_tags',
	'required_state_paths',
	'blocked_state_paths',
]);

export function buildActionEffectDefinition(
	context: BehaviorRecognizerContext,
	definition: LuaTableConstructorExpression,
	activeDeclarations: Set<SymbolID>,
): readonly BehaviorSourceNode[] {
	const children: BehaviorSourceNode[] = [];
	const fields = collectNamedFields(definition);
	for (let index = 0; index < fields.length; index += 1) {
		const entry = fields[index];
		if (entry.name === null || !ACTION_EFFECT_FIELDS.has(entry.name)) {
			continue;
		}
		const path = appendBehaviorSourcePath('', entry.name);
		if (ACTION_EFFECT_LIST_FIELDS.has(entry.name)) {
			children.push(buildTableArraySection(
				context,
				path,
				entry.name,
				entry.field.value,
				activeDeclarations,
				buildExpressionProperty,
			));
			continue;
		}
		children.push(createSourceNode(context, path, {
			kind: 'property',
			label: `${entry.name} = ${describeExpression(entry.field.value)}`,
			detail: '',
			authoredRange: entry.field.range,
			referenceRange: null,
			resolution: 'complete',
			children: [],
		}));
	}
	return children;
}
