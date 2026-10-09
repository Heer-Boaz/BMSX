import { staticLuaTableFieldName } from '../../../../toolchain/ts/lua/syntax/table_fields';
import { LuaTableFieldKind } from '../../../../toolchain/ts/lua/syntax/ast';
import type { EditorTextModel } from '../../../editor/model/text_model';
import { readLuaExpressionPreview } from '../../../language/lua/source_edits';
import type { WorkbenchPropertyElement, WorkbenchPropertyTree } from '../../ui/property_tree';
import { appendWorkbenchTreeNode, rebuildWorkbenchTreeRows } from '../../ui/tree_view';
import type { AnimationTableSource } from './model';
import type { LuaTableField } from '../../../../toolchain/ts/lua/syntax/ast';

export type AnimationProperty = WorkbenchPropertyElement & {
	readonly source: AnimationTableSource;
	readonly field: LuaTableField;
};

/** Flat Details for the selected definition, track or key; nested producer code stays Source. */
export function projectAnimationDetails(tree: WorkbenchPropertyTree<AnimationProperty>, source: AnimationTableSource | undefined,
	model: EditorTextModel | undefined, excluded: readonly string[]): void {
	tree.roots.length = 0;
	tree.selectionIndex = -1;
	if (source !== undefined) {
		const fields = source.table.fields;
		const lastNamed = new Map<string, LuaTableField>();
		for (const field of fields) {
			const name = staticLuaTableFieldName(field);
			if (name !== null) lastNamed.set(name, field);
		}
		for (let index = 0; index < fields.length; index++) {
			const field = fields[index];
			const name = staticLuaTableFieldName(field);
			if (name !== null && (excluded.includes(name) || lastNamed.get(name) !== field)) continue;
			const range = source.file.chunk.locations.range(field.span);
			appendWorkbenchTreeNode(tree, null, { kind: 'property', source, field, label: name === null ? field.kind === LuaTableFieldKind.Array ? `[${index + 1}]` : '[source key]' : name,
				value: readLuaExpressionPreview(model!.buffer, source.file.chunk.locations, field.value),
				description: `${source.file.file}:${range.start.line}`, warning: !source.structural, displayLabel: '', displayValue: '', displayValueLeft: 0 });
		}
	}
	rebuildWorkbenchTreeRows(tree, null);
	tree.textDirty = true;
}
