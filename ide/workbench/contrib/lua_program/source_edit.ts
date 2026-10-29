import { LuaSyntaxKind, LuaTableFieldKind } from '../../../../toolchain/ts/lua/syntax/ast';
import type { LuaFieldValueEdit } from '../../../language/lua/field_value_edit';
import { luaSourceRangeToTextRange } from '../../../language/lua/source_edits';
import { mapTrackedTextLocation } from '../../../editor/text/text_location';
import type { LuaProgramInput } from './editor_input';
import type { LuaProgramProperty } from './source';
import { copyLuaProgramSourceBookmark, luaProgramPropertyEditState, mapLuaProgramSourceBookmark } from './source_selection';

/** Accepted values replace their actual written field; history retains inert source correspondence. */
export function applyLuaProgramPropertyEdit(input: LuaProgramInput, property: LuaProgramProperty, value: LuaFieldValueEdit): void {
	const model = input.sourceModels.get(property.file.file)!, field = property.field!;
	const range = luaSourceRangeToTextRange(model.buffer, property.file.chunk.locations.range(field.value.span));
	const edit = { offset: range.start, deleteLength: range.end - range.start, text: value.edit.text };
	// Editing an alias does not grant continuation to a different referenced table.
	if (property.table !== undefined && field.value !== property.table.table) { model.pushEditOperations([edit]); return; }
	const bookmark = input.sourceSelection.captureBookmark(), originIntent = input.sourceSelection.revision;
	const producer = { resource: input.workingCopy.identity, ...input.occurrenceRange };
	model.pushEditOperations([edit], luaProgramPropertyEditState.of({ bookmark, originIntent, producer }, input.editSource), changes => {
		const after = copyLuaProgramSourceBookmark(bookmark), path = after.path;
		mapLuaProgramSourceBookmark(after, model.identity, changes);
		const last = path[path.length - 1], fieldStart = range.start + value.firstTokenOffset, expressionStart = range.start + value.expressionOffset;
		path[path.length - 1] = {
			binding: field.kind === LuaTableFieldKind.Array && last.binding.start === last.binding.end
				? { resource: model.identity, start: fieldStart, end: fieldStart + 1 } : last.binding,
			table: value.expressionKind === LuaSyntaxKind.TableConstructorExpression ? { resource: model.identity, start: expressionStart, end: expressionStart + 1 } : undefined,
			references: [],
		};
		const mappedProducer = { ...producer };
		mapTrackedTextLocation(mappedProducer, model.identity, changes);
		return luaProgramPropertyEditState.of({ bookmark: { path }, originIntent, producer: mappedProducer }, input.editSource);
	});
}
