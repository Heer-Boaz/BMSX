import { LuaSyntaxKind, type LuaExpression, type LuaTableConstructorExpression } from '../../../../toolchain/ts/lua/syntax/ast';
import { findNamedLuaTableField, staticLuaTableFieldName } from '../../../../toolchain/ts/lua/syntax/table_fields';
import { formatLuaNumberExpression, readLuaEncodedNumber } from '../../../../toolchain/ts/lua/syntax/number_expression';
import { quoteLuaString } from '../../../../toolchain/ts/lua/syntax/string_literal';
import type { EditorTextEdit } from '../../../editor/model/text_model';
import type { TextBuffer } from '../../../editor/text/text_buffer';
import { createLuaStringValueEdit, createLuaTableFieldNumberEdits, createLuaTableFieldRemovalEdits,
	luaSourceRangeToTextRange } from '../../../language/lua/source_edits';
import { createLuaTableFieldsInsertionEdits } from '../../../language/lua/table_field_insertion';
import type { SceneSourceAffine, SceneSourceDocument, SceneSourceObject } from './model';

/** A known value is not permission to replace the expression that produced it. */
export function scenePositionAxisEditable(member: SceneSourceObject, axis: 'x' | 'y' | 'z'): boolean {
	const position = member.position;
	if (position === null || position.value.kind === LuaSyntaxKind.NilLiteralExpression) return true;
	if (position.value.kind !== LuaSyntaxKind.TableConstructorExpression) return false;
	const field = findNamedLuaTableField(position.value, axis);
	return field === null || field.value.kind === LuaSyntaxKind.NilLiteralExpression || readLuaEncodedNumber(field.value) !== null;
}

const PLACEMENT_TABLE_FIELDS: Readonly<Record<string, ReadonlySet<string>>> = {
	position: new Set(['x', 'y', 'z']), scale: new Set(['x', 'y', 'z']), rotation: new Set(['x', 'y', 'z', 'w']),
	transform: new Set(['xx', 'xy', 'xz', 'yx', 'yy', 'yz', 'zx', 'zy', 'zz', 'ox', 'oy', 'oz']),
};

function sameSceneBasis(pose: Readonly<SceneSourceAffine>, local: Readonly<SceneSourceAffine> | undefined): boolean {
	return local !== undefined && pose.family === local.family && Object.is(pose.xx, local.xx) && Object.is(pose.xy, local.xy)
		&& Object.is(pose.yx, local.yx) && Object.is(pose.yy, local.yy) && (pose.family === '2d' || local.family === '3d'
			&& Object.is(pose.xz, local.xz) && Object.is(pose.yz, local.yz) && Object.is(pose.zx, local.zx)
			&& Object.is(pose.zy, local.zy) && Object.is(pose.zz, local.zz));
}

/** Admit exactly the source fields that a world-preserving placement would rewrite. */
export function scenePlacementEditable(member: SceneSourceObject, pose: Readonly<SceneSourceAffine> | undefined,
	local: Readonly<SceneSourceAffine> | undefined): boolean {
	if (pose === undefined) return true;
	if (sameSceneBasis(pose, local)) {
		return (Object.is(pose.ox, local!.ox) || scenePositionAxisEditable(member, 'x'))
			&& (Object.is(pose.oy, local!.oy) || scenePositionAxisEditable(member, 'y'))
			&& (pose.family === '2d' || local!.family === '3d' && (Object.is(pose.oz, local!.oz) || scenePositionAxisEditable(member, 'z')));
	}
	const table = member.field.value as LuaTableConstructorExpression;
	for (const field of table.fields) {
		const name = staticLuaTableFieldName(field);
		if (name !== 'position' && name !== 'rotation' && name !== 'scale' && name !== 'skew' && name !== 'transform') continue;
		if (name === 'transform' && field !== member.transform) continue;
		const value = field.value;
		if (value.kind === LuaSyntaxKind.NilLiteralExpression || readLuaEncodedNumber(value) !== null) continue;
		if (value.kind !== LuaSyntaxKind.TableConstructorExpression || name === 'skew') return false;
		const names = PLACEMENT_TABLE_FIELDS[name];
		for (const component of value.fields) {
			const key = staticLuaTableFieldName(component);
			if (key === null || !names.has(key)
				|| component.value.kind !== LuaSyntaxKind.NilLiteralExpression && readLuaEncodedNumber(component.value) === null) return false;
		}
	}
	return true;
}

/** Rename the consuming expression, never its shared written provider. */
export function createSceneNameEdit(buffer: TextBuffer, document: SceneSourceDocument, expression: LuaExpression, name: string): EditorTextEdit {
	const locations = document.analysis.chunk.locations;
	if (expression.kind === LuaSyntaxKind.StringLiteralExpression) return createLuaStringValueEdit(buffer, locations, expression, name);
	const range = luaSourceRangeToTextRange(buffer, locations.range(expression.span));
	return { offset: range.start, deleteLength: range.end - range.start, text: quoteLuaString(name) };
}

/** Translation edits semantic position at the consuming member, not its shared
 * provider, advanced transform or independently authored rotation/scale. */
export function createSceneTranslationEdits(buffer: TextBuffer, document: SceneSourceDocument, member: SceneSourceObject,
	local: Readonly<SceneSourceAffine>, initial: Readonly<SceneSourceAffine>): EditorTextEdit[] {
	const axes = local.family === '2d' ? ['x', 'y'] as const : ['x', 'y', 'z'] as const;
	const values = local.family === '2d' ? [local.ox, local.oy] : [local.ox, local.oy, local.oz];
	const previous = initial.family === '2d' ? [initial.ox, initial.oy] : [initial.ox, initial.oy, initial.oz];
	const changed = axes.filter((_axis, index) => !Object.is(values[index], previous[index]));
	if (changed.length === 0) return [];
	const chunk = document.analysis.chunk, position = member.position;
	if (position?.value.kind === LuaSyntaxKind.TableConstructorExpression) {
		const edits: EditorTextEdit[] = [], inserted: string[] = [];
		for (let index = 0; index < axes.length; index++) {
			if (!changed.includes(axes[index])) continue;
			const field = findNamedLuaTableField(position.value, axes[index]);
			if (field === null) inserted.push(axes[index] + ' = ' + formatLuaNumberExpression(values[index]));
			else {
				const numeric = createLuaTableFieldNumberEdits(buffer, chunk.locations, field, values[index]);
				if (numeric !== null) edits.push(...numeric);
				else {
					const range = luaSourceRangeToTextRange(buffer, chunk.locations.range(field.value.span));
					edits.push({ offset: range.start, deleteLength: range.end - range.start, text: formatLuaNumberExpression(values[index]) });
				}
			}
		}
		if (inserted.length > 0) edits.push(...createLuaTableFieldsInsertionEdits(buffer, chunk, position.value, 0, inserted));
		return edits;
	}
	const fields: string[] = [];
	for (let index = 0; index < axes.length; index++) if (changed.includes(axes[index]))
		fields.push(axes[index] + ' = ' + formatLuaNumberExpression(values[index]));
	const source = '{ ' + fields.join(', ') + ' }';
	if (position === null) return createLuaTableFieldsInsertionEdits(buffer, chunk, member.field.value as LuaTableConstructorExpression, 0, ['position = ' + source]);
	const range = luaSourceRangeToTextRange(buffer, chunk.locations.range(position.value.span));
	return [{ offset: range.start, deleteLength: range.end - range.start, text: source }];
}

/** Parent changes keep ordinary placement semantic. A changed complete basis
 * uses the public advanced transform input, preserving shear exactly without
 * pretending every affine has a lossless TRS decomposition. */
export function createScenePlacementEdits(buffer: TextBuffer, document: SceneSourceDocument, member: SceneSourceObject,
	parentId: string | undefined, pose: Readonly<SceneSourceAffine> | undefined,
	local: Readonly<SceneSourceAffine> | undefined): EditorTextEdit[] {
	const chunk = document.analysis.chunk, table = member.field.value as LuaTableConstructorExpression;
	const edits: EditorTextEdit[] = [], inserted: string[] = [];
	const parentFields = table.fields.filter(field => staticLuaTableFieldName(field) === 'parent');
	if (parentId === undefined) {
		for (const field of parentFields) edits.push(...createLuaTableFieldRemovalEdits(buffer, chunk.locations, chunk.tokens, field));
	} else if (parentFields.length > 0) edits.push(createSceneNameEdit(buffer, document, parentFields[parentFields.length - 1].value, parentId));
	else inserted.push('parent = ' + quoteLuaString(parentId));
	if (pose !== undefined) {
		if (sameSceneBasis(pose, local)) edits.push(...createSceneTranslationEdits(buffer, document, member, pose, local!));
		else {
			const coefficients = pose.family === '2d' ? [pose.xx, pose.xy, pose.yx, pose.yy, pose.ox, pose.oy]
				: [pose.xx, pose.xy, pose.xz, pose.yx, pose.yy, pose.yz, pose.zx, pose.zy, pose.zz, pose.ox, pose.oy, pose.oz];
			const names = pose.family === '2d' ? ['xx', 'xy', 'yx', 'yy', 'ox', 'oy']
				: ['xx', 'xy', 'xz', 'yx', 'yy', 'yz', 'zx', 'zy', 'zz', 'ox', 'oy', 'oz'];
			const source = '{ ' + coefficients.map((value, index) => names[index] + ' = ' + formatLuaNumberExpression(value)).join(', ') + ' }';
			const transform = member.transform;
			if (transform === null) inserted.push('transform = ' + source);
			else {
				const range = luaSourceRangeToTextRange(buffer, chunk.locations.range(transform.value.span));
				edits.push({ offset: range.start, deleteLength: range.end - range.start, text: source });
			}
			// These are construction channel edits on the new advanced base. They
			// must not reapply the previous pose after the exact replacement.
			for (const field of table.fields) if (['position', 'rotation', 'scale', 'skew'].includes(staticLuaTableFieldName(field)!))
				edits.push(...createLuaTableFieldRemovalEdits(buffer, chunk.locations, chunk.tokens, field));
		}
	}
	if (inserted.length > 0) edits.push(...createLuaTableFieldsInsertionEdits(buffer, chunk, table, 0, inserted));
	return edits;
}

/** Publish one ordered, non-overlapping document edit bundle. An inherited
 * placement insertion can coincide with a removed first parent field. */
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
