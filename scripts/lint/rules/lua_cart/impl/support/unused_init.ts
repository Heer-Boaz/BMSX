import { LuaAssignmentOperator as AssignmentOperator, type LuaExpression as Expression, type LuaIdentifierExpression as IdentifierExpression, type LuaLocalFunctionStatement as LocalFunctionStatement, type LuaStatement as Statement, LuaSyntaxKind as SyntaxKind, LuaTableFieldKind as TableFieldKind } from '../../../../../../src/bmsx/lua/syntax/ast';
import { type CartLintIssue } from '../../../../lua_rule';
import { markUnusedInitValueWrite } from '../../unused_init_value_pattern';
import { declareBinding, discardBindingScope, enterBindingScope, resolveBinding } from './bindings';
import { UnusedInitValueBinding, UnusedInitValueContext } from './types';

export function enterUnusedInitValueScope(context: UnusedInitValueContext): void {
	enterBindingScope(context);
}

export function leaveUnusedInitValueScope(context: UnusedInitValueContext): void {
	discardBindingScope(context);
}

export function createUnusedInitValueContext(issues: CartLintIssue[]): UnusedInitValueContext {
	const context: UnusedInitValueContext = {
		issues,
		bindingStacksByName: new Map<string, UnusedInitValueBinding[]>(),
		scopeStack: [],
	};
	enterUnusedInitValueScope(context);
	return context;
}

export function resolveUnusedInitValueBinding(context: UnusedInitValueContext, name: string): UnusedInitValueBinding | undefined {
	return resolveBinding(context, name);
}

export function declareUnusedInitValueBinding(context: UnusedInitValueContext, declaration: IdentifierExpression, pendingInitValue: boolean): void {
	declareBinding(context, declaration, {
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

export function lintUnusedInitValuesInExpression(expression: Expression | null, context: UnusedInitValueContext): void {
	if (!expression) {
		return;
	}
	switch (expression.kind) {
		case SyntaxKind.IdentifierExpression:
			markUnusedInitValueRead(context, expression.name);
			return;
		case SyntaxKind.MemberExpression:
			lintUnusedInitValuesInExpression(expression.base, context);
			return;
		case SyntaxKind.IndexExpression:
			lintUnusedInitValuesInExpression(expression.base, context);
			lintUnusedInitValuesInExpression(expression.index, context);
			return;
		case SyntaxKind.BinaryExpression:
			lintUnusedInitValuesInExpression(expression.left, context);
			lintUnusedInitValuesInExpression(expression.right, context);
			return;
		case SyntaxKind.UnaryExpression:
			lintUnusedInitValuesInExpression(expression.operand, context);
			return;
		case SyntaxKind.CallExpression:
			lintUnusedInitValuesInExpression(expression.callee, context);
			for (const argument of expression.arguments) {
				lintUnusedInitValuesInExpression(argument, context);
			}
			return;
		case SyntaxKind.TableConstructorExpression:
			for (const field of expression.fields) {
				if (field.kind === TableFieldKind.ExpressionKey) {
					lintUnusedInitValuesInExpression(field.key, context);
				}
				lintUnusedInitValuesInExpression(field.value, context);
			}
			return;
		case SyntaxKind.FunctionExpression:
			lintUnusedInitValuesInFunctionBody(expression.body.body, context.issues, expression.parameters);
			return;
		default:
			return;
	}
}

export function lintUnusedInitValuesInAssignmentTarget(
	target: Expression,
	operator: AssignmentOperator,
	context: UnusedInitValueContext,
): void {
	if (target.kind === SyntaxKind.IdentifierExpression) {
		if (operator !== AssignmentOperator.Assign) {
			markUnusedInitValueRead(context, target.name);
		}
		return;
	}
	if (target.kind === SyntaxKind.MemberExpression) {
		lintUnusedInitValuesInExpression(target.base, context);
		return;
	}
	if (target.kind === SyntaxKind.IndexExpression) {
		lintUnusedInitValuesInExpression(target.base, context);
		lintUnusedInitValuesInExpression(target.index, context);
	}
}

export function lintUnusedInitValuesInStatements(
	statements: ReadonlyArray<Statement>,
	context: UnusedInitValueContext,
	isGuaranteedPath: boolean,
): void {
	for (const statement of statements) {
		switch (statement.kind) {
			case SyntaxKind.LocalAssignmentStatement:
				for (const value of statement.values) {
					lintUnusedInitValuesInExpression(value, context);
				}
				for (let index = 0; index < statement.names.length; index += 1) {
					declareUnusedInitValueBinding(context, statement.names[index], index < statement.values.length);
				}
				break;
			case SyntaxKind.AssignmentStatement:
				for (const right of statement.right) {
					lintUnusedInitValuesInExpression(right, context);
				}
				for (const left of statement.left) {
					lintUnusedInitValuesInAssignmentTarget(left, statement.operator, context);
				}
				for (const left of statement.left) {
					if (left.kind === SyntaxKind.IdentifierExpression) {
						markUnusedInitValueWrite(context, left, isGuaranteedPath);
					}
				}
				break;
			case SyntaxKind.LocalFunctionStatement: {
				const localFunction = statement as LocalFunctionStatement;
				declareUnusedInitValueBinding(context, localFunction.name, false);
				lintUnusedInitValuesInFunctionBody(
					localFunction.functionExpression.body.body,
					context.issues,
					localFunction.functionExpression.parameters,
				);
				break;
			}
			case SyntaxKind.FunctionDeclarationStatement:
				lintUnusedInitValuesInFunctionBody(
					statement.functionExpression.body.body,
					context.issues,
					statement.functionExpression.parameters,
				);
				break;
			case SyntaxKind.ReturnStatement:
				for (const expression of statement.expressions) {
					lintUnusedInitValuesInExpression(expression, context);
				}
				break;
			case SyntaxKind.IfStatement:
				for (const clause of statement.clauses) {
					if (clause.condition) {
						lintUnusedInitValuesInExpression(clause.condition, context);
					}
					enterUnusedInitValueScope(context);
					lintUnusedInitValuesInStatements(clause.block.body, context, false);
					leaveUnusedInitValueScope(context);
				}
				break;
			case SyntaxKind.WhileStatement:
				lintUnusedInitValuesInExpression(statement.condition, context);
				enterUnusedInitValueScope(context);
				lintUnusedInitValuesInStatements(statement.block.body, context, false);
				leaveUnusedInitValueScope(context);
				break;
			case SyntaxKind.RepeatStatement:
				enterUnusedInitValueScope(context);
				lintUnusedInitValuesInStatements(statement.block.body, context, false);
				lintUnusedInitValuesInExpression(statement.condition, context);
				leaveUnusedInitValueScope(context);
				break;
			case SyntaxKind.ForNumericStatement:
				lintUnusedInitValuesInExpression(statement.start, context);
				lintUnusedInitValuesInExpression(statement.limit, context);
				lintUnusedInitValuesInExpression(statement.step, context);
				enterUnusedInitValueScope(context);
				declareUnusedInitValueBinding(context, statement.variable, false);
				lintUnusedInitValuesInStatements(statement.block.body, context, false);
				leaveUnusedInitValueScope(context);
				break;
			case SyntaxKind.ForGenericStatement:
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
			case SyntaxKind.DoStatement:
				enterUnusedInitValueScope(context);
				lintUnusedInitValuesInStatements(statement.block.body, context, isGuaranteedPath);
				leaveUnusedInitValueScope(context);
				break;
			case SyntaxKind.CallStatement:
				lintUnusedInitValuesInExpression(statement.expression, context);
				break;
			case SyntaxKind.BreakStatement:
			case SyntaxKind.GotoStatement:
			case SyntaxKind.LabelStatement:
				break;
			default:
				break;
		}
	}
}

export function lintUnusedInitValuesInFunctionBody(
	statements: ReadonlyArray<Statement>,
	issues: CartLintIssue[],
	parameters: ReadonlyArray<IdentifierExpression>,
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
