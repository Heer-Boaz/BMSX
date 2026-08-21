import {
	type LuaTableConstructorExpression as TableConstructorExpression,
	type LuaTableField as TableField,
	LuaTableFieldKind as TableFieldKind,
	LuaSyntaxKind as SyntaxKind,
	LuaUnaryOperator as UnaryOperator,
} from '../../../../toolchain/ts/lua/syntax/ast';
import { type CartLintIssue } from '../../lua_rule';
import { defineLintRule } from '../../rule';
import { pushIssue } from './impl/support/lint_context';

export const duplicateTableKeyPatternRule = defineLintRule('cart', 'duplicate_table_key_pattern');

type StaticTableKey = string | number | boolean;

function staticTableKey(field: TableField, arrayIndex: number): StaticTableKey | undefined {
	if (field.kind === TableFieldKind.Array) {
		return arrayIndex;
	}
	if (field.kind === TableFieldKind.IdentifierKey) {
		return field.name;
	}
	const key = field.key;
	switch (key.kind) {
		case SyntaxKind.StringLiteralExpression:
		case SyntaxKind.NumericLiteralExpression:
		case SyntaxKind.BooleanLiteralExpression:
			return key.value;
		case SyntaxKind.UnaryExpression:
			if (key.operator === UnaryOperator.Negate
				&& key.operand.kind === SyntaxKind.NumericLiteralExpression) {
				return -key.operand.value;
			}
			return undefined;
		default:
			return undefined;
	}
}

export function lintDuplicateTableKeyPattern(
	expression: TableConstructorExpression,
	issues: CartLintIssue[],
): void {
	const keys = new Set<StaticTableKey>();
	let arrayIndex = 0;
	for (const field of expression.fields) {
		if (field.kind === TableFieldKind.Array) {
			arrayIndex += 1;
		}
		const key = staticTableKey(field, arrayIndex);
		if (key === undefined) {
			continue;
		}
		if (keys.has(key)) {
			pushIssue(
				issues,
				duplicateTableKeyPatternRule.name,
				field,
				`Duplicate table key ${JSON.stringify(key)} is forbidden; the later field silently replaces the earlier value.`,
			);
			continue;
		}
		keys.add(key);
	}
}
