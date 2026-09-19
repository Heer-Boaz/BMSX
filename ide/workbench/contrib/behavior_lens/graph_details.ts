import type { FileSemanticData } from '../../../../toolchain/ts/lua/semantic/model';
import type { LuaTableConstructorExpression, LuaTableField } from '../../../../toolchain/ts/lua/syntax/ast';
import type { BehaviorSourceNode } from './model';
import type { BehaviorGraphDetail } from './graph_model';
import { collectArrayFields, collectNamedFields, describeExpression } from './source';

/** Source fields, not a runtime inspector or a second editable property store. */
export function appendBehaviorGraphFields(result: BehaviorGraphDetail[], file: FileSemanticData, table: LuaTableConstructorExpression, group: string, excluded?: ReadonlySet<LuaTableField>): void {
	for (const entry of collectNamedFields(table)) {
		if (excluded?.has(entry.field)) continue;
		result.push({ label: entry.name === null ? `[${entry.authoredKeyLabel}]` : entry.name,
			description: describeExpression(entry.field.value), detail: group, range: file.chunk.locations.range(entry.field.value.span) });
	}
	for (const field of collectArrayFields(table)) {
		result.push({ label: describeExpression(field.value), description: '', detail: group, range: file.chunk.locations.range(field.value.span) });
	}
}

export function appendBehaviorGraphSourceDetails(result: BehaviorGraphDetail[], source: BehaviorSourceNode, group: string): void {
	if (source.children.length === 0) {
		result.push({ label: source.label, description: source.detail, detail: group,
			range: source.referenceRange !== null ? source.referenceRange : source.authoredRange });
	}
	for (const child of source.children) appendBehaviorGraphSourceDetails(result, child, group);
}
