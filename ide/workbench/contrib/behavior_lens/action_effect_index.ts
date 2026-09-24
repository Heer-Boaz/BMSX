import type { FileSemanticData } from '../../../../toolchain/ts/lua/semantic/model';
import type { LuaTableField } from '../../../../toolchain/ts/lua/syntax/ast';
import type { ActionEffectSourceDefinition } from './action_effect_model';
import type { BehaviorSourceRowKey } from './model';

export type EffectPropertyWrite = { readonly file: FileSemanticData; readonly field: LuaTableField; readonly sourceSelection: 'field' | 'value' };
const indices = new WeakMap<ActionEffectSourceDefinition, ReadonlyMap<BehaviorSourceRowKey, EffectPropertyWrite>>();

/** Written fields only. Referenced initializers and runtime values are not edit targets. */
export function indexActionEffectWrites(definition: ActionEffectSourceDefinition): ReadonlyMap<BehaviorSourceRowKey, EffectPropertyWrite> {
	const existing = indices.get(definition);
	if (existing !== undefined) return existing;
	const writes = new Map<BehaviorSourceRowKey, EffectPropertyWrite>();
	if (definition.body !== null) for (const field of definition.body.fields) {
		if (field.kind === 'unknown') continue;
		writes.set(field.source.rowKey, { file: definition.body.file, field: field.field, sourceSelection: field.kind === 'value' ? 'field' : 'value' });
		if (field.kind === 'list') for (const entry of field.entries) {
			writes.set(entry.node.rowKey, { file: entry.file, field: entry.field, sourceSelection: 'value' });
		}
	}
	indices.set(definition, writes);
	return writes;
}
