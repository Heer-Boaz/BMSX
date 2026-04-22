import { LuaAssignmentOperator as AssignmentOperator, type LuaExpression as Expression, type LuaFunctionDeclarationStatement as FunctionDeclarationStatement, type LuaFunctionExpression as CartFunctionExpression, type LuaIdentifierExpression as IdentifierExpression, type LuaLocalFunctionStatement as LocalFunctionStatement, type LuaStatement as Statement, LuaSyntaxKind as SyntaxKind, LuaTableFieldKind as TableFieldKind } from '../../../../../../src/bmsx/lua/syntax/ast';
import { type CartLintIssue } from '../../../../lua_rule';
import { leaveSingleUseLocalScope } from '../../../common/single_use_local_pattern';
import { declareBinding, enterBindingScope } from './bindings';
import { getRangeLineSpan } from './expressions';
import { SINGLE_USE_LOCAL_SMALL_HELPER_MAX_LINES } from './general';
import { isRequireCallExpression } from './require_aliases';
import { isSelfHasTagCall } from './tags';
import { SingleUseLocalBinding, SingleUseLocalContext, SingleUseLocalReportKind } from './types';

export function isSingleUseLocalCandidateValue(expression: Expression | undefined): boolean {
	if (!expression || expression.kind !== SyntaxKind.CallExpression) {
		return false;
	}
	if (isRequireCallExpression(expression)) {
		return false;
	}
	if (isSelfHasTagCall(expression)) {
		return false;
	}
	return true;
}

export function isTrivialSingleUseLocalHelperFunctionExpression(expression: CartFunctionExpression): boolean {
	if (getRangeLineSpan(expression) > SINGLE_USE_LOCAL_SMALL_HELPER_MAX_LINES) {
		return false;
	}
	if (expression.parameters.length !== 0) {
		return false;
	}
	const bodyStatements = expression.body.body;
	if (bodyStatements.length !== 1) {
		return false;
	}
	const onlyStatement = bodyStatements[0];
	if (onlyStatement.kind !== SyntaxKind.ReturnStatement) {
		return false;
	}
	if (onlyStatement.expressions.length !== 1) {
		return false;
	}
	return true;
}

export function resolveSingleUseLocalReportKindForValue(expression: Expression | undefined): SingleUseLocalReportKind | null {
	if (isSingleUseLocalCandidateValue(expression)) {
		return 'call_result';
	}
	if (expression && expression.kind === SyntaxKind.FunctionExpression && isTrivialSingleUseLocalHelperFunctionExpression(expression)) {
		return 'small_helper';
	}
	return null;
}

export function createSingleUseLocalContext(issues: CartLintIssue[]): SingleUseLocalContext {
	return {
		issues,
		bindingStacksByName: new Map<string, SingleUseLocalBinding[]>(),
		scopeStack: [],
	};
}

export function enterSingleUseLocalScope(context: SingleUseLocalContext): void {
	enterBindingScope(context);
}

export function declareSingleUseLocalBinding(
	context: SingleUseLocalContext,
	declaration: IdentifierExpression,
	reportKind: SingleUseLocalReportKind | null,
): void {
	const isTopLevelScope = context.scopeStack.length === 1;
	declareBinding(context, declaration, {
		declaration,
		reportKind: isTopLevelScope && !declaration.name.startsWith('_') ? reportKind : null,
		readCount: 0,
		callReadCount: 0,
	});
}

export function markSingleUseLocalRead(context: SingleUseLocalContext, identifier: IdentifierExpression, isCallRead = false): void {
	const stack = context.bindingStacksByName.get(identifier.name);
	if (!stack || stack.length === 0) {
		return;
	}
	const binding = stack[stack.length - 1];
	binding.readCount += 1;
	if (isCallRead) {
		binding.callReadCount += 1;
	}
}

export function lintSingleUseLocalInExpression(expression: Expression, context: SingleUseLocalContext): void {
	if (!expression) {
		return;
	}
	switch (expression.kind) {
		case SyntaxKind.IdentifierExpression:
			markSingleUseLocalRead(context, expression);
			return;
		case SyntaxKind.MemberExpression:
			lintSingleUseLocalInExpression(expression.base, context);
			return;
		case SyntaxKind.IndexExpression:
			lintSingleUseLocalInExpression(expression.base, context);
			lintSingleUseLocalInExpression(expression.index, context);
			return;
		case SyntaxKind.BinaryExpression:
			lintSingleUseLocalInExpression(expression.left, context);
			lintSingleUseLocalInExpression(expression.right, context);
			return;
			case SyntaxKind.UnaryExpression:
				lintSingleUseLocalInExpression(expression.operand, context);
				return;
			case SyntaxKind.CallExpression:
				if (expression.callee.kind === SyntaxKind.IdentifierExpression) {
					markSingleUseLocalRead(context, expression.callee, true);
				} else {
					lintSingleUseLocalInExpression(expression.callee, context);
				}
				for (const argument of expression.arguments) {
					lintSingleUseLocalInExpression(argument, context);
				}
				return;
			case SyntaxKind.TableConstructorExpression:
			for (const field of expression.fields) {
				if (field.kind === TableFieldKind.ExpressionKey) {
					lintSingleUseLocalInExpression(field.key, context);
				}
				lintSingleUseLocalInExpression(field.value, context);
			}
				return;
			case SyntaxKind.FunctionExpression: {
				enterSingleUseLocalScope(context);
				for (const parameter of expression.parameters) {
					declareSingleUseLocalBinding(context, parameter, null);
				}
				lintSingleUseLocalInStatements(expression.body.body, context);
				leaveSingleUseLocalScope(context);
				return;
			}
		default:
			return;
	}
}

export function lintSingleUseLocalInAssignmentTarget(
	target: Expression,
	operator: AssignmentOperator,
	context: SingleUseLocalContext,
): void {
	if (target.kind === SyntaxKind.IdentifierExpression) {
		if (operator !== AssignmentOperator.Assign) {
			markSingleUseLocalRead(context, target);
		}
		return;
	}
	if (target.kind === SyntaxKind.MemberExpression) {
		lintSingleUseLocalInExpression(target.base, context);
		return;
	}
	if (target.kind === SyntaxKind.IndexExpression) {
		lintSingleUseLocalInExpression(target.base, context);
		lintSingleUseLocalInExpression(target.index, context);
	}
}

export function lintSingleUseLocalInStatements(statements: ReadonlyArray<Statement>, context: SingleUseLocalContext): void {
	for (const statement of statements) {
		switch (statement.kind) {
				case SyntaxKind.LocalAssignmentStatement:
					for (const value of statement.values) {
						lintSingleUseLocalInExpression(value, context);
					}
					for (let index = 0; index < statement.names.length; index += 1) {
						const value = index < statement.values.length ? statement.values[index] : undefined;
						const reportKind = resolveSingleUseLocalReportKindForValue(value);
						declareSingleUseLocalBinding(context, statement.names[index], reportKind);
					}
					break;
			case SyntaxKind.AssignmentStatement:
				for (const right of statement.right) {
					lintSingleUseLocalInExpression(right, context);
				}
				for (const left of statement.left) {
					lintSingleUseLocalInAssignmentTarget(left, statement.operator, context);
				}
				break;
			case SyntaxKind.LocalFunctionStatement: {
				const localFunction = statement as LocalFunctionStatement;
				const reportKind = isTrivialSingleUseLocalHelperFunctionExpression(localFunction.functionExpression) ? 'small_helper' : null;
				declareSingleUseLocalBinding(context, localFunction.name, reportKind);
				enterSingleUseLocalScope(context);
				for (const parameter of localFunction.functionExpression.parameters) {
					declareSingleUseLocalBinding(context, parameter, null);
					}
					lintSingleUseLocalInStatements(localFunction.functionExpression.body.body, context);
					leaveSingleUseLocalScope(context);
					break;
				}
				case SyntaxKind.FunctionDeclarationStatement: {
					const declaration = statement as FunctionDeclarationStatement;
					enterSingleUseLocalScope(context);
					for (const parameter of declaration.functionExpression.parameters) {
						declareSingleUseLocalBinding(context, parameter, null);
					}
					lintSingleUseLocalInStatements(declaration.functionExpression.body.body, context);
					leaveSingleUseLocalScope(context);
					break;
			}
			case SyntaxKind.ReturnStatement:
				for (const expression of statement.expressions) {
					lintSingleUseLocalInExpression(expression, context);
				}
				break;
			case SyntaxKind.IfStatement:
				for (const clause of statement.clauses) {
					if (clause.condition) {
						lintSingleUseLocalInExpression(clause.condition, context);
					}
					enterSingleUseLocalScope(context);
					lintSingleUseLocalInStatements(clause.block.body, context);
					leaveSingleUseLocalScope(context);
				}
				break;
			case SyntaxKind.WhileStatement:
				lintSingleUseLocalInExpression(statement.condition, context);
				enterSingleUseLocalScope(context);
				lintSingleUseLocalInStatements(statement.block.body, context);
				leaveSingleUseLocalScope(context);
				break;
			case SyntaxKind.RepeatStatement:
				enterSingleUseLocalScope(context);
				lintSingleUseLocalInStatements(statement.block.body, context);
				leaveSingleUseLocalScope(context);
				lintSingleUseLocalInExpression(statement.condition, context);
				break;
				case SyntaxKind.ForNumericStatement:
					lintSingleUseLocalInExpression(statement.start, context);
					lintSingleUseLocalInExpression(statement.limit, context);
					lintSingleUseLocalInExpression(statement.step, context);
					enterSingleUseLocalScope(context);
					declareSingleUseLocalBinding(context, statement.variable, null);
					lintSingleUseLocalInStatements(statement.block.body, context);
					leaveSingleUseLocalScope(context);
					break;
				case SyntaxKind.ForGenericStatement:
					for (const iterator of statement.iterators) {
					lintSingleUseLocalInExpression(iterator, context);
				}
					enterSingleUseLocalScope(context);
					for (const variable of statement.variables) {
						declareSingleUseLocalBinding(context, variable, null);
					}
					lintSingleUseLocalInStatements(statement.block.body, context);
					leaveSingleUseLocalScope(context);
					break;
			case SyntaxKind.DoStatement:
				enterSingleUseLocalScope(context);
				lintSingleUseLocalInStatements(statement.block.body, context);
				leaveSingleUseLocalScope(context);
				break;
			case SyntaxKind.CallStatement:
				lintSingleUseLocalInExpression(statement.expression, context);
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

export function lintSingleUseLocalPattern(statements: ReadonlyArray<Statement>, issues: CartLintIssue[]): void {
	const context = createSingleUseLocalContext(issues);
	enterSingleUseLocalScope(context);
	try {
		lintSingleUseLocalInStatements(statements, context);
	} finally {
		leaveSingleUseLocalScope(context);
	}
}
