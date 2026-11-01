import type { LuaSourceLocations } from '../../../../toolchain/ts/lua/syntax/source_locations';
import { LuaSyntaxKind, LuaTableFieldKind, type LuaTableField, type LuaStringLiteralExpression, type LuaBooleanLiteralExpression } from '../../../../toolchain/ts/lua/syntax/ast';
import { firstLineTextPreview } from '../../../common/text';
import type { TextBuffer } from '../../../editor/text/text_buffer';
import { readLuaExpressionPreview, readLuaSourceRange } from '../../../language/lua/source_edits';
import type { SceneSourceObject } from './model';

export type SceneOptionProperty = {
	readonly field: LuaTableField;
	readonly label: string;
	readonly sourceText: string;
	readonly preview: string;
	readonly editable: boolean;
} & ({ readonly kind: 'string'; readonly literal: LuaStringLiteralExpression }
	| { readonly kind: 'boolean'; readonly literal: LuaBooleanLiteralExpression } | { readonly kind: 'expression' });

/** Gameplay/component property values; spatial placement belongs to the semantic transform inspector. */
export function collectSceneOptionProperties(buffer: TextBuffer, locations: LuaSourceLocations, member: SceneSourceObject): SceneOptionProperty[] {
	const properties: SceneOptionProperty[] = [];
	const append = (field: LuaTableField, label: string): void => {
		if (field.value.kind === LuaSyntaxKind.TableConstructorExpression && field.value.fields.length > 0) {
			let arrayIndex = 0;
			for (const child of field.value.fields) {
				const key = child.kind === LuaTableFieldKind.IdentifierKey ? child.name
					: child.kind === LuaTableFieldKind.ExpressionKey ? `[${readLuaSourceRange(buffer, locations.range(child.key.span))}]` : `[${++arrayIndex}]`;
				append(child, label ? `${label}${key[0] === '[' ? '' : '.'}${key}` : key);
			}
		} else {
			const sourceText = readLuaSourceRange(buffer, locations.range(field.value.span));
			if (field.value.kind === LuaSyntaxKind.StringLiteralExpression) {
				const literal = field.value;
				properties.push({ kind: 'string', literal, field, label: label || 'options', sourceText,
					editable: !literal.value.includes('\n') && !literal.value.includes('\r'), preview: firstLineTextPreview(literal.value) });
			} else if (field.value.kind === LuaSyntaxKind.BooleanLiteralExpression) {
				properties.push({ kind: 'boolean', literal: field.value, field, label: label || 'options', sourceText,
					editable: true, preview: sourceText });
			} else properties.push({ kind: 'expression', field, label: label || 'options', sourceText,
				editable: !sourceText.includes('\n'), preview: readLuaExpressionPreview(buffer, locations, field.value) });
		}
	};
	const options = member.options;
	if (options !== null) append(options, options.value.kind === LuaSyntaxKind.TableConstructorExpression ? '' : 'options');
	return properties;
}
