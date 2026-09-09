import type { LuaTableConstructorExpression, LuaTableField } from '../../../../toolchain/ts/lua/syntax/ast';
import type { BehaviorDynamicSourceNode, BehaviorSourceNode } from './model';
import type { BehaviorSourceArrayEntry, BehaviorSourceTableSection, SourceTableIssue } from './source';

export type ActionEffectSourceValueName = 'event' | 'handler' | 'can_trigger' | 'cooldown_ms'
	| 'calculate_cooldown_ms' | 'initial_cooldown_ms' | 'defer_cooldown_commit' | 'period_ms';
export type ActionEffectSourceRequirementName = 'required_tags' | 'blocked_tags' | 'required_state_paths' | 'blocked_state_paths';

/** Authored properties and requirements, not trigger steps or evaluated callback results. */
export type ActionEffectSourceField = {
	readonly field: LuaTableField;
} & ({
	readonly kind: 'value';
	readonly name: ActionEffectSourceValueName;
	readonly source: BehaviorSourceNode;
} | {
	readonly kind: 'list';
	readonly name: ActionEffectSourceRequirementName;
	readonly source: BehaviorSourceTableSection;
	readonly entries: readonly BehaviorSourceArrayEntry<BehaviorSourceNode>[];
} | {
	readonly kind: 'unknown';
	readonly source: BehaviorDynamicSourceNode;
});

export type ActionEffectSourceBody = {
	readonly table: LuaTableConstructorExpression;
	readonly issues: SourceTableIssue;
	readonly fields: readonly ActionEffectSourceField[];
};

export type ActionEffectSourceDefinition = BehaviorSourceNode & {
	readonly kind: 'definition';
	readonly behaviorKind: 'action_effect';
	readonly body: ActionEffectSourceBody | null;
};
