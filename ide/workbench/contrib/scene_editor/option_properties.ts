import type { LuaSourceLocations } from '../../../../toolchain/ts/lua/syntax/source_locations';
import { create_rect_bounds, type RectBounds } from '../../../../machine/ts/common/rect';
import { LuaSyntaxKind, LuaTableFieldKind, type LuaTableField } from '../../../../toolchain/ts/lua/syntax/ast';
import type { TextBuffer } from '../../../editor/text/text_buffer';
import { readLuaExpressionPreview, readLuaSourceRange } from '../../../language/lua/source_edits';
import type { SceneSourceObject } from './model';

export type SceneOptionProperty = {
	readonly field: LuaTableField;
	readonly label: string;
	readonly sourceText: string;
	readonly preview: string;
	readonly editable: boolean;
	text: string;
	readonly contentBounds: RectBounds;
	readonly bounds: RectBounds;
};

/** The written options are the inspector schema. Never evaluate referenced Lua. */
export function collectSceneOptionProperties(buffer: TextBuffer, locations: LuaSourceLocations, member: SceneSourceObject): SceneOptionProperty[] {
	const properties: SceneOptionProperty[] = [];
	const options = member.options;
	if (options === null) return properties;
	const append = (field: LuaTableField, label: string): void => {
		if (field.value.kind === LuaSyntaxKind.TableConstructorExpression && field.value.fields.length > 0) {
			let arrayIndex = 0;
			for (const child of field.value.fields) {
				// Positional fields already have their dedicated world-unit controls.
				if (member.position !== null && (child === member.position.x || child === member.position.y || child === member.position.z)) continue;
				const key = child.kind === LuaTableFieldKind.IdentifierKey ? child.name
					: child.kind === LuaTableFieldKind.ExpressionKey ? `[${readLuaSourceRange(buffer, locations.range(child.key.span))}]` : `[${++arrayIndex}]`;
				append(child, label === '' ? key : `${label}${key[0] === '[' ? '' : '.'}${key}`);
			}
		} else {
			const sourceText = readLuaSourceRange(buffer, locations.range(field.value.span));
			properties.push({ field, label: label === '' ? 'options' : label, sourceText, editable: !sourceText.includes('\n'),
				preview: readLuaExpressionPreview(buffer, locations, field.value), text: '', contentBounds: create_rect_bounds(), bounds: create_rect_bounds() });
		}
	};
	append(options, options.value.kind === LuaSyntaxKind.TableConstructorExpression ? '' : 'options');
	return properties;
}
