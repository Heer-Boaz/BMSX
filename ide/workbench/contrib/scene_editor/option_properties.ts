import type { LuaSourceLocations } from '../../../../toolchain/ts/lua/syntax/source_locations';
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
};

/** Written gameplay, spatial and component inputs are the schema; referenced Lua stays source. */
export function collectSceneOptionProperties(buffer: TextBuffer, locations: LuaSourceLocations, member: SceneSourceObject): SceneOptionProperty[] {
	const properties: SceneOptionProperty[] = [];
	const append = (field: LuaTableField, label: string): void => {
		if (field.value.kind === LuaSyntaxKind.TableConstructorExpression && field.value.fields.length > 0) {
			let arrayIndex = 0;
			for (const child of field.value.fields) {
				// These exact source fields already have local-origin controls.
				if (member.spatial !== null && member.spatial.origin.includes(child)) continue;
				const key = child.kind === LuaTableFieldKind.IdentifierKey ? child.name
					: child.kind === LuaTableFieldKind.ExpressionKey ? `[${readLuaSourceRange(buffer, locations.range(child.key.span))}]` : `[${++arrayIndex}]`;
				append(child, label ? `${label}${key[0] === '[' ? '' : '.'}${key}` : key);
			}
		} else {
			const sourceText = readLuaSourceRange(buffer, locations.range(field.value.span));
			properties.push({ field, label: label || 'options', sourceText, editable: !sourceText.includes('\n'),
				preview: readLuaExpressionPreview(buffer, locations, field.value) });
		}
	};
	const options = member.options;
	if (options !== null) append(options, options.value.kind === LuaSyntaxKind.TableConstructorExpression ? '' : 'options');
	if (member.spatial !== null) append(member.spatial.field, 'spatial');
	return properties;
}
