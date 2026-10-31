import { LuaSyntaxKind, type LuaExpression, type LuaTableConstructorExpression } from '../../../../toolchain/ts/lua/syntax/ast';
import { staticLuaTableFieldName } from '../../../../toolchain/ts/lua/syntax/table_fields';
import { formatLuaNumberExpression } from '../../../../toolchain/ts/lua/syntax/number_expression';
import { quoteLuaString } from '../../../../toolchain/ts/lua/syntax/string_literal';
import type { EditorTextEdit } from '../../../editor/model/text_model';
import type { TextBuffer } from '../../../editor/text/text_buffer';
import { createLuaStringValueEdit, createLuaTableFieldNumberEdits, createLuaTableFieldRemovalEdits,
	luaSourceRangeToTextRange, readLuaSourceRange } from '../../../language/lua/source_edits';
import { createLuaTableFieldsInsertionEdits } from '../../../language/lua/table_field_insertion';
import type { SceneSourceAffine, SceneSourceDocument, SceneSourceObject } from './model';

/** Rename the consuming expression, never its shared written provider. */
export function createSceneNameEdit(buffer: TextBuffer, document: SceneSourceDocument, expression: LuaExpression, name: string): EditorTextEdit {
	const locations = document.analysis.chunk.locations;
	if (expression.kind === LuaSyntaxKind.StringLiteralExpression) return createLuaStringValueEdit(buffer, locations, expression, name);
	const range = luaSourceRangeToTextRange(buffer, locations.range(expression.span));
	return { offset: range.start, deleteLength: range.end - range.start, text: quoteLuaString(name) };
}

/** Native spatial input edits shared by reparenting and surviving-child deletion.
 * Undefined pose means Keep Local, not a fabricated identity. Full-affine writes
 * touch only necessary coefficients and preserve inherited defaults unchanged. */
export function createScenePlacementEdits(buffer: TextBuffer, document: SceneSourceDocument, member: SceneSourceObject,
	parentId: string | undefined, pose: Readonly<SceneSourceAffine> | undefined, local: Readonly<SceneSourceAffine> | undefined,
	localSupplied: boolean): EditorTextEdit[] {
	const chunk = document.analysis.chunk, spatial = member.spatial;
	const unchanged = pose === undefined || local !== undefined && (pose.family === '2d' && local.family === '2d'
		? Object.is(pose.xx, local.xx) && Object.is(pose.xy, local.xy) && Object.is(pose.yx, local.yx)
			&& Object.is(pose.yy, local.yy) && Object.is(pose.ox, local.ox) && Object.is(pose.oy, local.oy)
		: pose.family === '3d' && local.family === '3d'
			&& Object.is(pose.xx, local.xx) && Object.is(pose.xy, local.xy) && Object.is(pose.xz, local.xz)
			&& Object.is(pose.yx, local.yx) && Object.is(pose.yy, local.yy) && Object.is(pose.yz, local.yz)
			&& Object.is(pose.zx, local.zx) && Object.is(pose.zy, local.zy) && Object.is(pose.zz, local.zz)
			&& Object.is(pose.ox, local.ox) && Object.is(pose.oy, local.oy) && Object.is(pose.oz, local.oz));
	let coefficients: number[] | undefined, affineSource: string | undefined;
	if (!unchanged) {
		coefficients = pose!.family === '2d'
			? [pose!.xx, pose!.xy, pose!.yx, pose!.yy, pose!.ox, pose!.oy]
			: [pose!.xx, pose!.xy, pose!.xz, pose!.yx, pose!.yy, pose!.yz, pose!.zx, pose!.zy, pose!.zz, pose!.ox, pose!.oy, pose!.oz];
		affineSource = '{ ' + coefficients.map(formatLuaNumberExpression).join(', ') + ' }';
	}
	const parentSource = parentId === undefined ? undefined : 'parent_id = ' + quoteLuaString(parentId);
	const table = spatial?.field.value;
	if (table?.kind !== LuaSyntaxKind.TableConstructorExpression) {
		const fields: string[] = [];
		if (parentSource !== undefined) fields.push(parentSource);
		if (!unchanged) fields.push('local_transform = ' + affineSource);
		else if (localSupplied) {
			// The provider's expression is scoped in this member's document. Read
			// its value without copying provider-local variable names into this scope.
			fields.push('local_transform = (' + readLuaSourceRange(buffer, chunk.locations.range(table!.span)) + ').local_transform');
		}
		if (spatial === null) {
			if (fields.length === 0) return [];
			return createLuaTableFieldsInsertionEdits(buffer, chunk, member.field.value as LuaTableConstructorExpression,
				0, ['spatial = { ' + fields.join(', ') + ' }']);
		}
		const range = luaSourceRangeToTextRange(buffer, chunk.locations.range(table!.span));
		return [{ offset: range.start, deleteLength: range.end - range.start, text: fields.length === 0 ? '{}' : '{ ' + fields.join(', ') + ' }' }];
	}
	const edits: EditorTextEdit[] = [], inserted: string[] = [];
	const parentFields = table.fields.filter(field => staticLuaTableFieldName(field) === 'parent_id');
	if (parentId === undefined) {
		for (const field of parentFields) edits.push(...createLuaTableFieldRemovalEdits(buffer, chunk.locations, chunk.tokens, field));
	} else if (parentFields.length > 0) {
		edits.push(createSceneNameEdit(buffer, document, parentFields[parentFields.length - 1].value, parentId));
	} else inserted.push(parentSource!);
	if (!unchanged) {
		if (spatial!.coefficients !== null) {
			for (let index = 0; index < coefficients!.length; index++) {
				const field = spatial!.coefficients[index];
				const numeric = createLuaTableFieldNumberEdits(buffer, chunk.locations, field, coefficients![index]);
				if (numeric !== null) edits.push(...numeric);
				else {
					const range = luaSourceRangeToTextRange(buffer, chunk.locations.range(field.value.span));
					edits.push({ offset: range.start, deleteLength: range.end - range.start, text: formatLuaNumberExpression(coefficients![index]) });
				}
			}
		} else if (spatial!.localTransform !== null) {
			const range = luaSourceRangeToTextRange(buffer, chunk.locations.range(spatial!.localTransform.value.span));
			edits.push({ offset: range.start, deleteLength: range.end - range.start, text: affineSource! });
		} else inserted.push('local_transform = ' + affineSource);
	}
	if (inserted.length > 0) edits.push(...createLuaTableFieldsInsertionEdits(buffer, chunk, table, 0, inserted));
	return edits;
}

/** Publish one ordered, non-overlapping document edit bundle. An inherited
 * placement insertion can coincide with a removed first parent_id field. */
export function finishSceneSpatialEdits(edits: EditorTextEdit[]): readonly EditorTextEdit[] {
	edits.sort((left, right) => left.offset - right.offset);
	for (let index = edits.length - 1; index > 0; index--) {
		const previous = edits[index - 1], current = edits[index];
		if (previous.offset !== current.offset) continue;
		edits[index - 1] = { offset: previous.offset, deleteLength: previous.deleteLength + current.deleteLength,
			text: previous.text + current.text };
		edits.splice(index, 1);
	}
	return edits;
}
