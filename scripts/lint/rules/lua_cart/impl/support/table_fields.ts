import { type LuaExpression as Expression, type LuaFunctionExpression as CartFunctionExpression, type LuaStatement as Statement, LuaSyntaxKind as SyntaxKind, type LuaTableField as TableField, LuaTableFieldKind as TableFieldKind } from '../../../../../../src/bmsx/lua/syntax/ast';
import { type CartLintIssue } from '../../../../lua_rule';
import { lintForbiddenRenderLayerString } from '../../forbidden_render_layer_string_pattern';
import { lintExpression } from '../../../../../rompacker/cart_lua_linter_runtime';
import { lintCollectionLabelPatterns } from '../../fsm_id_label_pattern';
import { lintInjectedServiceIdPropertyTableField } from '../../injected_service_id_property_pattern';
import { lintInlineStaticLookupTableExpression } from '../../inline_static_lookup_table_pattern';
import { lintTickFlagPollingPattern } from '../../tick_flag_polling_pattern';
import { lintTickInputCheckPattern } from '../../tick_input_check_pattern';
import { isPrimitiveLiteralExpression } from './conditions';
import { pushIssue } from './lint_context';

export function getTableFieldKey(field: TableField): string {
	if (field.kind === TableFieldKind.IdentifierKey) {
		return field.name;
	}
	if (field.kind !== TableFieldKind.ExpressionKey) {
		return undefined;
	}
	if (field.key.kind === SyntaxKind.StringLiteralExpression) {
		return field.key.value;
	}
	if (field.key.kind === SyntaxKind.IdentifierExpression) {
		return field.key.name;
	}
	return undefined;
}

export function expressionContainsInlineTableOrFunction(expression: Expression): boolean {
	switch (expression.kind) {
		case SyntaxKind.TableConstructorExpression:
		case SyntaxKind.FunctionExpression:
			return true;
		case SyntaxKind.MemberExpression:
			return expressionContainsInlineTableOrFunction(expression.base);
		case SyntaxKind.IndexExpression:
			return expressionContainsInlineTableOrFunction(expression.base)
				|| expressionContainsInlineTableOrFunction(expression.index);
		case SyntaxKind.BinaryExpression:
			return expressionContainsInlineTableOrFunction(expression.left)
				|| expressionContainsInlineTableOrFunction(expression.right);
		case SyntaxKind.UnaryExpression:
			return expressionContainsInlineTableOrFunction(expression.operand);
		case SyntaxKind.CallExpression:
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

export function isStaticLookupTableConstructor(expression: Expression): boolean {
	if (expression.kind !== SyntaxKind.TableConstructorExpression || expression.fields.length === 0) {
		return false;
	}
	for (const field of expression.fields) {
		if (field.kind === TableFieldKind.ExpressionKey) {
			if (!isPrimitiveLiteralExpression(field.key) && field.key.kind !== SyntaxKind.IdentifierExpression) {
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
	statements: ReadonlyArray<Statement>,
	functionName: string,
	issues: CartLintIssue[],
): void {
	for (const statement of statements) {
		switch (statement.kind) {
			case SyntaxKind.LocalAssignmentStatement:
				for (const value of statement.values) {
					lintInlineStaticLookupTableExpression(value, functionName, issues);
				}
				break;
			case SyntaxKind.AssignmentStatement:
				for (const left of statement.left) {
					lintInlineStaticLookupTableExpression(left, functionName, issues);
				}
				for (const right of statement.right) {
					lintInlineStaticLookupTableExpression(right, functionName, issues);
				}
				break;
			case SyntaxKind.ReturnStatement:
				for (const expression of statement.expressions) {
					lintInlineStaticLookupTableExpression(expression, functionName, issues);
				}
				break;
			case SyntaxKind.IfStatement:
				for (const clause of statement.clauses) {
					if (clause.condition) {
						lintInlineStaticLookupTableExpression(clause.condition, functionName, issues);
					}
					lintInlineStaticLookupTableStatements(clause.block.body, functionName, issues);
				}
				break;
			case SyntaxKind.WhileStatement:
				lintInlineStaticLookupTableExpression(statement.condition, functionName, issues);
				lintInlineStaticLookupTableStatements(statement.block.body, functionName, issues);
				break;
			case SyntaxKind.RepeatStatement:
				lintInlineStaticLookupTableStatements(statement.block.body, functionName, issues);
				lintInlineStaticLookupTableExpression(statement.condition, functionName, issues);
				break;
			case SyntaxKind.ForNumericStatement:
				lintInlineStaticLookupTableExpression(statement.start, functionName, issues);
				lintInlineStaticLookupTableExpression(statement.limit, functionName, issues);
				lintInlineStaticLookupTableExpression(statement.step, functionName, issues);
				lintInlineStaticLookupTableStatements(statement.block.body, functionName, issues);
				break;
			case SyntaxKind.ForGenericStatement:
				for (const iterator of statement.iterators) {
					lintInlineStaticLookupTableExpression(iterator, functionName, issues);
				}
				lintInlineStaticLookupTableStatements(statement.block.body, functionName, issues);
				break;
			case SyntaxKind.DoStatement:
				lintInlineStaticLookupTableStatements(statement.block.body, functionName, issues);
				break;
			case SyntaxKind.CallStatement:
				lintInlineStaticLookupTableExpression(statement.expression, functionName, issues);
				break;
			case SyntaxKind.LocalFunctionStatement:
			case SyntaxKind.FunctionDeclarationStatement:
			case SyntaxKind.BreakStatement:
			case SyntaxKind.GotoStatement:
			case SyntaxKind.LabelStatement:
				break;
			default:
				break;
		}
	}
}

export function lintInlineStaticLookupTablePattern(
	functionName: string,
	functionExpression: CartFunctionExpression,
	issues: CartLintIssue[],
): void {
	lintInlineStaticLookupTableStatements(functionExpression.body.body, functionName, issues);
}

export function readStringFieldValueFromTable(expression: Expression | undefined, fieldName: string): string | undefined {
	if (!expression || expression.kind !== SyntaxKind.TableConstructorExpression) {
		return undefined;
	}
	for (const field of expression.fields) {
		if (getTableFieldKey(field) !== fieldName) {
			continue;
		}
		if (field.value.kind !== SyntaxKind.StringLiteralExpression) {
			return undefined;
		}
		return field.value.value;
	}
	return undefined;
}

export function readBooleanFieldValueFromTable(expression: Expression | undefined, fieldName: string): boolean | undefined {
	if (!expression || expression.kind !== SyntaxKind.TableConstructorExpression) {
		return undefined;
	}
	for (const field of expression.fields) {
		if (getTableFieldKey(field) !== fieldName) {
			continue;
		}
		if (field.value.kind !== SyntaxKind.BooleanLiteralExpression) {
			return undefined;
		}
		return field.value.value;
	}
	return undefined;
}

export function findTableFieldByKey(expression: Expression | undefined, fieldName: string): TableField | undefined {
	if (!expression || expression.kind !== SyntaxKind.TableConstructorExpression) {
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
	expression: Expression | undefined,
	onField: (field: TableField) => void,
): void {
	if (!expression || expression.kind !== SyntaxKind.TableConstructorExpression) {
		return;
	}
	for (const field of expression.fields) {
		onField(field);
		if (field.kind === TableFieldKind.ExpressionKey) {
			visitTableFieldsRecursively(field.key, onField);
		}
		visitTableFieldsRecursively(field.value, onField);
	}
}

export function lintTableField(field: TableField, issues: CartLintIssue[]): void {
	lintCollectionLabelPatterns(field, issues);
	lintInjectedServiceIdPropertyTableField(field, issues);
	lintForbiddenRenderLayerString(field, issues, pushIssue);
	if (field.kind === TableFieldKind.IdentifierKey
		&& field.name === 'tick'
		&& field.value.kind === SyntaxKind.FunctionExpression) {
		lintTickFlagPollingPattern(field.value, issues);
		lintTickInputCheckPattern(field.value, issues);
	}
	switch (field.kind) {
		case TableFieldKind.Array:
			lintExpression(field.value, issues, false);
			return;
		case TableFieldKind.IdentifierKey:
			lintExpression(field.value, issues, false);
			return;
		case TableFieldKind.ExpressionKey:
			lintExpression(field.key, issues, false);
			lintExpression(field.value, issues, false);
			return;
		default:
			return;
	}
}
