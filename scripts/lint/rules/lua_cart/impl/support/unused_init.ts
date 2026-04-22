import { LuaAssignmentOperator, type LuaExpression, type LuaIdentifierExpression, type LuaLocalFunctionStatement, type LuaStatement, LuaSyntaxKind, LuaTableFieldKind } from '../../../../../../src/bmsx/lua/syntax/ast';
import { type LuaLintIssue } from '../../../../lua_rule';
import { markUnusedInitValueWrite } from '../../unused_init_value_pattern';
import { declareLuaBinding, discardLuaBindingScope, enterLuaBindingScope, resolveLuaBinding } from './bindings';
import { UnusedInitValueBinding, UnusedInitValueContext } from './types';

export function enterUnusedInitValueScope(context: UnusedInitValueContext): void {
	enterLuaBindingScope(context);
}

export function leaveUnusedInitValueScope(context: UnusedInitValueContext): void {
	discardLuaBindingScope(context);
}

export function createUnusedInitValueContext(issues: LuaLintIssue[]): UnusedInitValueContext {
	const context: UnusedInitValueContext = {
		issues,
		bindingStacksByName: new Map<string, UnusedInitValueBinding[]>(),
		scopeStack: [],
	};
	enterUnusedInitValueScope(context);
	return context;
}

export function resolveUnusedInitValueBinding(context: UnusedInitValueContext, name: string): UnusedInitValueBinding | undefined {
	return resolveLuaBinding(context, name);
}

export function declareUnusedInitValueBinding(context: UnusedInitValueContext, declaration: LuaIdentifierExpression, pendingInitValue: boolean): void {
	declareLuaBinding(context, declaration, {
		declaration,
		pendingInitValue,
	});
}

export function markUnusedInitValueRead(context: UnusedInitValueContext, name: string): void {
	const binding = resolveUnusedInitValueBinding(context, name);
	if (!binding || !binding.pendingInitValue) {
		return;
	}
	binding.pendingInitValue = false;
}

export function lintUnusedInitValuesInExpression(expression: LuaExpression | null, context: UnusedInitValueContext): void {
	if (!expression) {
		return;
	}
	switch (expression.kind) {
		case LuaSyntaxKind.IdentifierExpression:
			markUnusedInitValueRead(context, expression.name);
			return;
		case LuaSyntaxKind.MemberExpression:
			lintUnusedInitValuesInExpression(expression.base, context);
			return;
		case LuaSyntaxKind.IndexExpression:
			lintUnusedInitValuesInExpression(expression.base, context);
			lintUnusedInitValuesInExpression(expression.index, context);
			return;
		case LuaSyntaxKind.BinaryExpression:
			lintUnusedInitValuesInExpression(expression.left, context);
			lintUnusedInitValuesInExpression(expression.right, context);
			return;
		case LuaSyntaxKind.UnaryExpression:
			lintUnusedInitValuesInExpression(expression.operand, context);
			return;
		case LuaSyntaxKind.CallExpression:
			lintUnusedInitValuesInExpression(expression.callee, context);
			for (const argument of expression.arguments) {
				lintUnusedInitValuesInExpression(argument, context);
			}
			return;
		case LuaSyntaxKind.TableConstructorExpression:
			for (const field of expression.fields) {
				if (field.kind === LuaTableFieldKind.ExpressionKey) {
					lintUnusedInitValuesInExpression(field.key, context);
				}
				lintUnusedInitValuesInExpression(field.value, context);
			}
			return;
		case LuaSyntaxKind.FunctionExpression:
			lintUnusedInitValuesInFunctionBody(expression.body.body, context.issues, expression.parameters);
			return;
		default:
			return;
	}
}

export function lintUnusedInitValuesInAssignmentTarget(
	target: LuaExpression,
	operator: LuaAssignmentOperator,
	context: UnusedInitValueContext,
): void {
	if (target.kind === LuaSyntaxKind.IdentifierExpression) {
		if (operator !== LuaAssignmentOperator.Assign) {
			markUnusedInitValueRead(context, target.name);
		}
		return;
	}
	if (target.kind === LuaSyntaxKind.MemberExpression) {
		lintUnusedInitValuesInExpression(target.base, context);
		return;
	}
	if (target.kind === LuaSyntaxKind.IndexExpression) {
		lintUnusedInitValuesInExpression(target.base, context);
		lintUnusedInitValuesInExpression(target.index, context);
	}
}

export function lintUnusedInitValuesInStatements(
	statements: ReadonlyArray<LuaStatement>,
	context: UnusedInitValueContext,
	isGuaranteedPath: boolean,
): void {
	for (const statement of statements) {
		switch (statement.kind) {
			case LuaSyntaxKind.LocalAssignmentStatement:
				for (const value of statement.values) {
					lintUnusedInitValuesInExpression(value, context);
				}
				for (let index = 0; index < statement.names.length; index += 1) {
					declareUnusedInitValueBinding(context, statement.names[index], index < statement.values.length);
				}
				break;
			case LuaSyntaxKind.AssignmentStatement:
				for (const right of statement.right) {
					lintUnusedInitValuesInExpression(right, context);
				}
				for (const left of statement.left) {
					lintUnusedInitValuesInAssignmentTarget(left, statement.operator, context);
				}
				for (const left of statement.left) {
					if (left.kind === LuaSyntaxKind.IdentifierExpression) {
						markUnusedInitValueWrite(context, left, isGuaranteedPath);
					}
				}
				break;
			case LuaSyntaxKind.LocalFunctionStatement: {
				const localFunction = statement as LuaLocalFunctionStatement;
				declareUnusedInitValueBinding(context, localFunction.name, false);
				lintUnusedInitValuesInFunctionBody(
					localFunction.functionExpression.body.body,
					context.issues,
					localFunction.functionExpression.parameters,
				);
				break;
			}
			case LuaSyntaxKind.FunctionDeclarationStatement:
				lintUnusedInitValuesInFunctionBody(
					statement.functionExpression.body.body,
					context.issues,
					statement.functionExpression.parameters,
				);
				break;
			case LuaSyntaxKind.ReturnStatement:
				for (const expression of statement.expressions) {
					lintUnusedInitValuesInExpression(expression, context);
				}
				break;
			case LuaSyntaxKind.IfStatement:
				for (const clause of statement.clauses) {
					if (clause.condition) {
						lintUnusedInitValuesInExpression(clause.condition, context);
					}
					enterUnusedInitValueScope(context);
					lintUnusedInitValuesInStatements(clause.block.body, context, false);
					leaveUnusedInitValueScope(context);
				}
				break;
			case LuaSyntaxKind.WhileStatement:
				lintUnusedInitValuesInExpression(statement.condition, context);
				enterUnusedInitValueScope(context);
				lintUnusedInitValuesInStatements(statement.block.body, context, false);
				leaveUnusedInitValueScope(context);
				break;
			case LuaSyntaxKind.RepeatStatement:
				enterUnusedInitValueScope(context);
				lintUnusedInitValuesInStatements(statement.block.body, context, false);
				lintUnusedInitValuesInExpression(statement.condition, context);
				leaveUnusedInitValueScope(context);
				break;
			case LuaSyntaxKind.ForNumericStatement:
				lintUnusedInitValuesInExpression(statement.start, context);
				lintUnusedInitValuesInExpression(statement.limit, context);
				lintUnusedInitValuesInExpression(statement.step, context);
				enterUnusedInitValueScope(context);
				declareUnusedInitValueBinding(context, statement.variable, false);
				lintUnusedInitValuesInStatements(statement.block.body, context, false);
				leaveUnusedInitValueScope(context);
				break;
			case LuaSyntaxKind.ForGenericStatement:
				for (const iterator of statement.iterators) {
					lintUnusedInitValuesInExpression(iterator, context);
				}
				enterUnusedInitValueScope(context);
				for (const variable of statement.variables) {
					declareUnusedInitValueBinding(context, variable, false);
				}
				lintUnusedInitValuesInStatements(statement.block.body, context, false);
				leaveUnusedInitValueScope(context);
				break;
			case LuaSyntaxKind.DoStatement:
				enterUnusedInitValueScope(context);
				lintUnusedInitValuesInStatements(statement.block.body, context, isGuaranteedPath);
				leaveUnusedInitValueScope(context);
				break;
			case LuaSyntaxKind.CallStatement:
				lintUnusedInitValuesInExpression(statement.expression, context);
				break;
			case LuaSyntaxKind.BreakStatement:
			case LuaSyntaxKind.GotoStatement:
			case LuaSyntaxKind.LabelStatement:
				break;
			default:
				break;
		}
	}
}

export function lintUnusedInitValuesInFunctionBody(
	statements: ReadonlyArray<LuaStatement>,
	issues: LuaLintIssue[],
	parameters: ReadonlyArray<LuaIdentifierExpression>,
): void {
	const context = createUnusedInitValueContext(issues);
	try {
		for (const parameter of parameters) {
			declareUnusedInitValueBinding(context, parameter, false);
		}
		lintUnusedInitValuesInStatements(statements, context, true);
	} finally {
		leaveUnusedInitValueScope(context);
	}
}
