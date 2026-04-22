import { type LuaExpression, type LuaFunctionExpression, type LuaStatement, LuaSyntaxKind, type LuaTableField, LuaTableFieldKind } from '../../../../../../src/bmsx/lua/syntax/ast';
import { type LuaLintIssue } from '../../../../lua_rule';
import { lintForbiddenRenderLayerString } from '../../forbidden_render_layer_string_pattern';
import { lintExpression } from '../../../../../rompacker/cart_lua_linter_runtime';
import { lintCollectionLabelPatterns } from '../../fsm_id_label_pattern';
import { lintInjectedServiceIdPropertyTableField } from '../../injected_service_id_property_pattern';
import { lintInlineStaticLookupTableExpression } from '../../inline_static_lookup_table_pattern';
import { lintTickFlagPollingPattern } from '../../tick_flag_polling_pattern';
import { lintTickInputCheckPattern } from '../../tick_input_check_pattern';
import { isPrimitiveLiteralExpression } from './conditions';
import { pushIssue } from './lint_context';

export function getTableFieldKey(field: LuaTableField): string {
	if (field.kind === LuaTableFieldKind.IdentifierKey) {
		return field.name;
	}
	if (field.kind !== LuaTableFieldKind.ExpressionKey) {
		return undefined;
	}
	if (field.key.kind === LuaSyntaxKind.StringLiteralExpression) {
		return field.key.value;
	}
	if (field.key.kind === LuaSyntaxKind.IdentifierExpression) {
		return field.key.name;
	}
	return undefined;
}

export function expressionContainsInlineTableOrFunction(expression: LuaExpression): boolean {
	switch (expression.kind) {
		case LuaSyntaxKind.TableConstructorExpression:
		case LuaSyntaxKind.FunctionExpression:
			return true;
		case LuaSyntaxKind.MemberExpression:
			return expressionContainsInlineTableOrFunction(expression.base);
		case LuaSyntaxKind.IndexExpression:
			return expressionContainsInlineTableOrFunction(expression.base)
				|| expressionContainsInlineTableOrFunction(expression.index);
		case LuaSyntaxKind.BinaryExpression:
			return expressionContainsInlineTableOrFunction(expression.left)
				|| expressionContainsInlineTableOrFunction(expression.right);
		case LuaSyntaxKind.UnaryExpression:
			return expressionContainsInlineTableOrFunction(expression.operand);
		case LuaSyntaxKind.CallExpression:
			if (expressionContainsInlineTableOrFunction(expression.callee)) {
				return true;
			}
			for (const argument of expression.arguments) {
				if (expressionContainsInlineTableOrFunction(argument)) {
					return true;
				}
			}
			return false;
		default:
			return false;
	}
}

export function isStaticLookupTableConstructor(expression: LuaExpression): boolean {
	if (expression.kind !== LuaSyntaxKind.TableConstructorExpression || expression.fields.length === 0) {
		return false;
	}
	for (const field of expression.fields) {
		if (field.kind === LuaTableFieldKind.ExpressionKey) {
			if (!isPrimitiveLiteralExpression(field.key) && field.key.kind !== LuaSyntaxKind.IdentifierExpression) {
				return false;
			}
		}
		if (!isPrimitiveLiteralExpression(field.value)) {
			return false;
		}
	}
	return true;
}

export function lintInlineStaticLookupTableStatements(
	statements: ReadonlyArray<LuaStatement>,
	functionName: string,
	issues: LuaLintIssue[],
): void {
	for (const statement of statements) {
		switch (statement.kind) {
			case LuaSyntaxKind.LocalAssignmentStatement:
				for (const value of statement.values) {
					lintInlineStaticLookupTableExpression(value, functionName, issues);
				}
				break;
			case LuaSyntaxKind.AssignmentStatement:
				for (const left of statement.left) {
					lintInlineStaticLookupTableExpression(left, functionName, issues);
				}
				for (const right of statement.right) {
					lintInlineStaticLookupTableExpression(right, functionName, issues);
				}
				break;
			case LuaSyntaxKind.ReturnStatement:
				for (const expression of statement.expressions) {
					lintInlineStaticLookupTableExpression(expression, functionName, issues);
				}
				break;
			case LuaSyntaxKind.IfStatement:
				for (const clause of statement.clauses) {
					if (clause.condition) {
						lintInlineStaticLookupTableExpression(clause.condition, functionName, issues);
					}
					lintInlineStaticLookupTableStatements(clause.block.body, functionName, issues);
				}
				break;
			case LuaSyntaxKind.WhileStatement:
				lintInlineStaticLookupTableExpression(statement.condition, functionName, issues);
				lintInlineStaticLookupTableStatements(statement.block.body, functionName, issues);
				break;
			case LuaSyntaxKind.RepeatStatement:
				lintInlineStaticLookupTableStatements(statement.block.body, functionName, issues);
				lintInlineStaticLookupTableExpression(statement.condition, functionName, issues);
				break;
			case LuaSyntaxKind.ForNumericStatement:
				lintInlineStaticLookupTableExpression(statement.start, functionName, issues);
				lintInlineStaticLookupTableExpression(statement.limit, functionName, issues);
				lintInlineStaticLookupTableExpression(statement.step, functionName, issues);
				lintInlineStaticLookupTableStatements(statement.block.body, functionName, issues);
				break;
			case LuaSyntaxKind.ForGenericStatement:
				for (const iterator of statement.iterators) {
					lintInlineStaticLookupTableExpression(iterator, functionName, issues);
				}
				lintInlineStaticLookupTableStatements(statement.block.body, functionName, issues);
				break;
			case LuaSyntaxKind.DoStatement:
				lintInlineStaticLookupTableStatements(statement.block.body, functionName, issues);
				break;
			case LuaSyntaxKind.CallStatement:
				lintInlineStaticLookupTableExpression(statement.expression, functionName, issues);
				break;
			case LuaSyntaxKind.LocalFunctionStatement:
			case LuaSyntaxKind.FunctionDeclarationStatement:
			case LuaSyntaxKind.BreakStatement:
			case LuaSyntaxKind.GotoStatement:
			case LuaSyntaxKind.LabelStatement:
				break;
			default:
				break;
		}
	}
}

export function lintInlineStaticLookupTablePattern(
	functionName: string,
	functionExpression: LuaFunctionExpression,
	issues: LuaLintIssue[],
): void {
	lintInlineStaticLookupTableStatements(functionExpression.body.body, functionName, issues);
}

export function readStringFieldValueFromTable(expression: LuaExpression | undefined, fieldName: string): string | undefined {
	if (!expression || expression.kind !== LuaSyntaxKind.TableConstructorExpression) {
		return undefined;
	}
	for (const field of expression.fields) {
		if (getTableFieldKey(field) !== fieldName) {
			continue;
		}
		if (field.value.kind !== LuaSyntaxKind.StringLiteralExpression) {
			return undefined;
		}
		return field.value.value;
	}
	return undefined;
}

export function readBooleanFieldValueFromTable(expression: LuaExpression | undefined, fieldName: string): boolean | undefined {
	if (!expression || expression.kind !== LuaSyntaxKind.TableConstructorExpression) {
		return undefined;
	}
	for (const field of expression.fields) {
		if (getTableFieldKey(field) !== fieldName) {
			continue;
		}
		if (field.value.kind !== LuaSyntaxKind.BooleanLiteralExpression) {
			return undefined;
		}
		return field.value.value;
	}
	return undefined;
}

export function findTableFieldByKey(expression: LuaExpression | undefined, fieldName: string): LuaTableField | undefined {
	if (!expression || expression.kind !== LuaSyntaxKind.TableConstructorExpression) {
		return undefined;
	}
	for (const field of expression.fields) {
		if (getTableFieldKey(field) === fieldName) {
			return field;
		}
	}
	return undefined;
}

export function visitTableFieldsRecursively(
	expression: LuaExpression | undefined,
	onField: (field: LuaTableField) => void,
): void {
	if (!expression || expression.kind !== LuaSyntaxKind.TableConstructorExpression) {
		return;
	}
	for (const field of expression.fields) {
		onField(field);
		if (field.kind === LuaTableFieldKind.ExpressionKey) {
			visitTableFieldsRecursively(field.key, onField);
		}
		visitTableFieldsRecursively(field.value, onField);
	}
}

export function lintTableField(field: LuaTableField, issues: LuaLintIssue[]): void {
	lintCollectionLabelPatterns(field, issues);
	lintInjectedServiceIdPropertyTableField(field, issues);
	lintForbiddenRenderLayerString(field, issues, pushIssue);
	if (field.kind === LuaTableFieldKind.IdentifierKey
		&& field.name === 'tick'
		&& field.value.kind === LuaSyntaxKind.FunctionExpression) {
		lintTickFlagPollingPattern(field.value, issues);
		lintTickInputCheckPattern(field.value, issues);
	}
	switch (field.kind) {
		case LuaTableFieldKind.Array:
			lintExpression(field.value, issues, false);
			return;
		case LuaTableFieldKind.IdentifierKey:
			lintExpression(field.value, issues, false);
			return;
		case LuaTableFieldKind.ExpressionKey:
			lintExpression(field.key, issues, false);
			lintExpression(field.value, issues, false);
			return;
		default:
			return;
	}
}
