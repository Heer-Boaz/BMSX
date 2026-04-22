import { LuaAssignmentOperator, type LuaExpression, type LuaFunctionDeclarationStatement, type LuaFunctionExpression, type LuaIdentifierExpression, type LuaLocalFunctionStatement, type LuaStatement, LuaSyntaxKind, LuaTableFieldKind } from '../../../../../../src/bmsx/lua/syntax/ast';
import { type LuaLintIssue } from '../../../../lua_rule';
import { leaveSingleUseLocalScope } from '../../../common/single_use_local_pattern';
import { getRangeLineSpan } from './expressions';
import { SINGLE_USE_LOCAL_SMALL_HELPER_MAX_LINES } from './general';
import { isRequireCallExpression } from './require_aliases';
import { isSelfHasTagCall } from './tags';
import { SingleUseLocalBinding, SingleUseLocalContext, SingleUseLocalReportKind } from './types';

export function isSingleUseLocalCandidateValue(expression: LuaExpression | undefined): boolean {
	if (!expression || expression.kind !== LuaSyntaxKind.CallExpression) {
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

export function isTrivialSingleUseLocalHelperFunctionExpression(expression: LuaFunctionExpression): boolean {
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
	if (onlyStatement.kind !== LuaSyntaxKind.ReturnStatement) {
		return false;
	}
	if (onlyStatement.expressions.length !== 1) {
		return false;
	}
	return true;
}

export function resolveSingleUseLocalReportKindForValue(expression: LuaExpression | undefined): SingleUseLocalReportKind | null {
	if (isSingleUseLocalCandidateValue(expression)) {
		return 'call_result';
	}
	if (expression && expression.kind === LuaSyntaxKind.FunctionExpression && isTrivialSingleUseLocalHelperFunctionExpression(expression)) {
		return 'small_helper';
	}
	return null;
}

export function createSingleUseLocalContext(issues: LuaLintIssue[]): SingleUseLocalContext {
	return {
		issues,
		bindingStacksByName: new Map<string, SingleUseLocalBinding[]>(),
		scopeStack: [],
	};
}

export function enterSingleUseLocalScope(context: SingleUseLocalContext): void {
	context.scopeStack.push({ names: [] });
}

export function declareSingleUseLocalBinding(
	context: SingleUseLocalContext,
	declaration: LuaIdentifierExpression,
	reportKind: SingleUseLocalReportKind | null,
): void {
	const isTopLevelScope = context.scopeStack.length === 1;
	const scope = context.scopeStack[context.scopeStack.length - 1];
	scope.names.push(declaration.name);
	let stack = context.bindingStacksByName.get(declaration.name);
	if (!stack) {
		stack = [];
		context.bindingStacksByName.set(declaration.name, stack);
	}
	stack.push({
		declaration,
		reportKind: isTopLevelScope && !declaration.name.startsWith('_') ? reportKind : null,
		readCount: 0,
		callReadCount: 0,
	});
}

export function markSingleUseLocalRead(context: SingleUseLocalContext, identifier: LuaIdentifierExpression, isCallRead = false): void {
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

export function lintSingleUseLocalInExpression(expression: LuaExpression, context: SingleUseLocalContext): void {
	if (!expression) {
		return;
	}
	switch (expression.kind) {
		case LuaSyntaxKind.IdentifierExpression:
			markSingleUseLocalRead(context, expression);
			return;
		case LuaSyntaxKind.MemberExpression:
			lintSingleUseLocalInExpression(expression.base, context);
			return;
		case LuaSyntaxKind.IndexExpression:
			lintSingleUseLocalInExpression(expression.base, context);
			lintSingleUseLocalInExpression(expression.index, context);
			return;
		case LuaSyntaxKind.BinaryExpression:
			lintSingleUseLocalInExpression(expression.left, context);
			lintSingleUseLocalInExpression(expression.right, context);
			return;
			case LuaSyntaxKind.UnaryExpression:
				lintSingleUseLocalInExpression(expression.operand, context);
				return;
			case LuaSyntaxKind.CallExpression:
				if (expression.callee.kind === LuaSyntaxKind.IdentifierExpression) {
					markSingleUseLocalRead(context, expression.callee, true);
				} else {
					lintSingleUseLocalInExpression(expression.callee, context);
				}
				for (const argument of expression.arguments) {
					lintSingleUseLocalInExpression(argument, context);
				}
				return;
			case LuaSyntaxKind.TableConstructorExpression:
			for (const field of expression.fields) {
				if (field.kind === LuaTableFieldKind.ExpressionKey) {
					lintSingleUseLocalInExpression(field.key, context);
				}
				lintSingleUseLocalInExpression(field.value, context);
			}
				return;
			case LuaSyntaxKind.FunctionExpression: {
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
	target: LuaExpression,
	operator: LuaAssignmentOperator,
	context: SingleUseLocalContext,
): void {
	if (target.kind === LuaSyntaxKind.IdentifierExpression) {
		if (operator !== LuaAssignmentOperator.Assign) {
			markSingleUseLocalRead(context, target);
		}
		return;
	}
	if (target.kind === LuaSyntaxKind.MemberExpression) {
		lintSingleUseLocalInExpression(target.base, context);
		return;
	}
	if (target.kind === LuaSyntaxKind.IndexExpression) {
		lintSingleUseLocalInExpression(target.base, context);
		lintSingleUseLocalInExpression(target.index, context);
	}
}

export function lintSingleUseLocalInStatements(statements: ReadonlyArray<LuaStatement>, context: SingleUseLocalContext): void {
	for (const statement of statements) {
		switch (statement.kind) {
				case LuaSyntaxKind.LocalAssignmentStatement:
					for (const value of statement.values) {
						lintSingleUseLocalInExpression(value, context);
					}
					for (let index = 0; index < statement.names.length; index += 1) {
						const value = index < statement.values.length ? statement.values[index] : undefined;
						const reportKind = resolveSingleUseLocalReportKindForValue(value);
						declareSingleUseLocalBinding(context, statement.names[index], reportKind);
					}
					break;
			case LuaSyntaxKind.AssignmentStatement:
				for (const right of statement.right) {
					lintSingleUseLocalInExpression(right, context);
				}
				for (const left of statement.left) {
					lintSingleUseLocalInAssignmentTarget(left, statement.operator, context);
				}
				break;
			case LuaSyntaxKind.LocalFunctionStatement: {
				const localFunction = statement as LuaLocalFunctionStatement;
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
				case LuaSyntaxKind.FunctionDeclarationStatement: {
					const declaration = statement as LuaFunctionDeclarationStatement;
					enterSingleUseLocalScope(context);
					for (const parameter of declaration.functionExpression.parameters) {
						declareSingleUseLocalBinding(context, parameter, null);
					}
					lintSingleUseLocalInStatements(declaration.functionExpression.body.body, context);
					leaveSingleUseLocalScope(context);
					break;
			}
			case LuaSyntaxKind.ReturnStatement:
				for (const expression of statement.expressions) {
					lintSingleUseLocalInExpression(expression, context);
				}
				break;
			case LuaSyntaxKind.IfStatement:
				for (const clause of statement.clauses) {
					if (clause.condition) {
						lintSingleUseLocalInExpression(clause.condition, context);
					}
					enterSingleUseLocalScope(context);
					lintSingleUseLocalInStatements(clause.block.body, context);
					leaveSingleUseLocalScope(context);
				}
				break;
			case LuaSyntaxKind.WhileStatement:
				lintSingleUseLocalInExpression(statement.condition, context);
				enterSingleUseLocalScope(context);
				lintSingleUseLocalInStatements(statement.block.body, context);
				leaveSingleUseLocalScope(context);
				break;
			case LuaSyntaxKind.RepeatStatement:
				enterSingleUseLocalScope(context);
				lintSingleUseLocalInStatements(statement.block.body, context);
				leaveSingleUseLocalScope(context);
				lintSingleUseLocalInExpression(statement.condition, context);
				break;
				case LuaSyntaxKind.ForNumericStatement:
					lintSingleUseLocalInExpression(statement.start, context);
					lintSingleUseLocalInExpression(statement.limit, context);
					lintSingleUseLocalInExpression(statement.step, context);
					enterSingleUseLocalScope(context);
					declareSingleUseLocalBinding(context, statement.variable, null);
					lintSingleUseLocalInStatements(statement.block.body, context);
					leaveSingleUseLocalScope(context);
					break;
				case LuaSyntaxKind.ForGenericStatement:
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
			case LuaSyntaxKind.DoStatement:
				enterSingleUseLocalScope(context);
				lintSingleUseLocalInStatements(statement.block.body, context);
				leaveSingleUseLocalScope(context);
				break;
			case LuaSyntaxKind.CallStatement:
				lintSingleUseLocalInExpression(statement.expression, context);
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

export function lintSingleUseLocalPattern(statements: ReadonlyArray<LuaStatement>, issues: LuaLintIssue[]): void {
	const context = createSingleUseLocalContext(issues);
	enterSingleUseLocalScope(context);
	try {
		lintSingleUseLocalInStatements(statements, context);
	} finally {
		leaveSingleUseLocalScope(context);
	}
}
