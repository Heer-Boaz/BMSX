import type { LuaTableConstructorExpression } from '../../../../toolchain/ts/lua/syntax/ast';
import type { BehaviorSourceNode } from './model';
import type { ActionEffectSourceBody, ActionEffectSourceField } from './action_effect_model';
import {
	appendBehaviorSourcePath,
	behaviorSourceFieldSegment,
	buildExpressionProperty,
	buildTableArraySection,
	collectNamedFields,
	createSourceNode,
	describeExpression,
	type BehaviorRecognizerContext,
	type BehaviorSourceArrayEntry,
	type ResolvedSourceTable,
} from './source';

/** One cold source generation. Display nodes are also the typed fields' source occurrences. */
export function buildActionEffectBody(
	context: BehaviorRecognizerContext, resolved: ResolvedSourceTable, activeTables: Set<LuaTableConstructorExpression>,
): { body: ActionEffectSourceBody; children: readonly BehaviorSourceNode[] } {
	const children: BehaviorSourceNode[] = [];
	const fields: ActionEffectSourceField[] = [];
	const authored = collectNamedFields(resolved.table);
	for (let index = 0; index < authored.length; index += 1) {
		const entry = authored[index];
		const field = entry.field;
		switch (entry.name) {
			case 'required_tags': case 'blocked_tags': case 'required_state_paths': case 'blocked_state_paths': {
				const entries: BehaviorSourceArrayEntry<BehaviorSourceNode>[] = [];
				const source = buildTableArraySection(context, appendBehaviorSourcePath('', entry.name), entry.name, field.value, activeTables,
					(childContext, path, expression, active, field, index) => {
						const node = buildExpressionProperty(childContext, path, expression, active);
						entries.push({ field, index, node });
						return node;
					});
				children.push(source);
				fields.push({ kind: 'list', name: entry.name, field, source, entries });
				break;
			}
			case 'event': case 'handler': case 'can_trigger': case 'cooldown_ms': case 'calculate_cooldown_ms':
			case 'initial_cooldown_ms': case 'defer_cooldown_commit': case 'period_ms': {
				const source = createSourceNode(context, appendBehaviorSourcePath('', entry.name), {
					kind: 'property', label: `${entry.name} = ${describeExpression(field.value)}`, detail: '',
					authoredRange: field.range, referenceRange: null, resolution: 'complete', children: [],
				});
				children.push(source);
				fields.push({ kind: 'value', name: entry.name, field, source });
				break;
			}
			case null: {
				const source = createSourceNode(context, appendBehaviorSourcePath('', behaviorSourceFieldSegment(entry, index)), {
					kind: 'dynamic', label: `[${entry.authoredKeyLabel}] = ${describeExpression(field.value)}`,
					detail: entry.keyKind === 'numeric' ? 'numeric key, not a named effect field' : 'computed effect field',
					authoredRange: field.range, referenceRange: null, resolution: 'unresolved', children: [],
				});
				children.push(source);
				fields.push({ kind: 'unknown', field, source });
				break;
			}
		}
	}
	return { body: { table: resolved.table, issues: resolved.issues, fields }, children };
}
