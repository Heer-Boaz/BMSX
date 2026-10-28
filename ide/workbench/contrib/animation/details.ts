import { staticLuaTableFieldName } from '../../../../toolchain/ts/lua/syntax/table_fields';
import { LuaTableFieldKind } from '../../../../toolchain/ts/lua/syntax/ast';
import type { EditorTextModel } from '../../../editor/model/text_model';
import { readLuaExpressionPreview } from '../../../language/lua/source_edits';
import type { WorkbenchPropertyElement, WorkbenchPropertyTree } from '../../ui/property_tree';
import { appendWorkbenchTreeNode, rebuildWorkbenchTreeRows } from '../../ui/tree_view';
import type { AnimationTableSource } from './model';
import type { LuaTableField } from '../../../../toolchain/ts/lua/syntax/ast';
import type { FileSemanticData } from '../../../../toolchain/ts/lua/semantic/model';
import type { LuaSourceReader, LuaWrittenProducer } from '../../../language/lua/source_reader';

export type AnimationProperty = WorkbenchPropertyElement & {
	readonly source: AnimationTableSource;
	readonly field: LuaTableField;
	readonly producer: LuaWrittenProducer | undefined;
};

/** Flat Details for the selected definition, track or key; nested producer code stays Source. */
export function projectAnimationDetails(tree: WorkbenchPropertyTree<AnimationProperty>, source: AnimationTableSource | undefined,
	resolveModel: (file: FileSemanticData) => EditorTextModel, reader: LuaSourceReader | undefined, excluded: readonly string[]): void {
	tree.roots.length = 0;
	tree.selectionIndex = -1;
	if (source !== undefined) {
		const model = resolveModel(source.file);
		const fields = source.table.fields;
		const lastNamed = new Map<string, LuaTableField>();
		for (const field of fields) {
			const name = staticLuaTableFieldName(field);
			if (name !== null) lastNamed.set(name, field);
		}
		let arrayIndex = 0;
		for (const field of fields) {
			const name = staticLuaTableFieldName(field);
			if (field.kind === LuaTableFieldKind.Array) arrayIndex++;
			if (name !== null && (excluded.includes(name) || lastNamed.get(name) !== field)) continue;
			const range = source.file.chunk.locations.range(field.span);
			const producer = reader!.producer(source.file, field.value);
			if (producer !== undefined) resolveModel(producer.source.file);
			appendWorkbenchTreeNode(tree, null, { kind: 'property', source, field, producer, label: name === null ? field.kind === LuaTableFieldKind.Array ? `[${arrayIndex}]` : '[source key]' : name,
				value: readLuaExpressionPreview(model.buffer, source.file.chunk.locations, field.value),
				description: `${model.resource.path}:${range.start.line}`, warning: !source.structural, displayLabel: '', displayValue: '', displayValueLeft: 0 }, false,
				name === null ? field.kind === LuaTableFieldKind.Array ? arrayIndex : field : name);
		}
	}
	rebuildWorkbenchTreeRows(tree, null);
	tree.textDirty = true;
}
