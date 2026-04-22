import { type LuaExpression, type LuaLocalFunctionStatement, type LuaStatement, LuaSyntaxKind, LuaTableFieldKind } from '../../../../../../src/bmsx/lua/syntax/ast';
import { type LuaLintIssue } from '../../../../lua_rule';
import { declareShadowedRequireAliasBinding } from '../../shadowed_require_alias_pattern';
import { isConstantModulePath } from './object_ownership';
import { ShadowedRequireAliasBinding, ShadowedRequireAliasContext } from './types';

export function getRequiredModulePath(expression: LuaExpression): string | undefined {
	if (expression.kind !== LuaSyntaxKind.CallExpression) {
		return undefined;
	}
	if (expression.callee.kind !== LuaSyntaxKind.IdentifierExpression || expression.callee.name !== 'require') {
		return undefined;
	}
	if (expression.arguments.length === 0) {
		return undefined;
	}
	const firstArgument = expression.arguments[0];
	if (firstArgument.kind !== LuaSyntaxKind.StringLiteralExpression) {
		return undefined;
	}
	return firstArgument.value;
}

export function isConstantModuleRequireExpression(expression: LuaExpression): boolean {
	const requiredModulePath = getRequiredModulePath(expression);
	return requiredModulePath !== undefined && isConstantModulePath(requiredModulePath);
}

export function createShadowedRequireAliasContext(issues: LuaLintIssue[]): ShadowedRequireAliasContext {
	return {
		issues,
		bindingStacksByName: new Map<string, ShadowedRequireAliasBinding[]>(),
		scopeStack: [],
	};
}

export function enterShadowedRequireAliasScope(context: ShadowedRequireAliasContext): void {
	context.scopeStack.push({ names: [] });
}

export function leaveShadowedRequireAliasScope(context: ShadowedRequireAliasContext): void {
	const scope = context.scopeStack.pop();
	if (!scope) {
		return;
	}
	for (let index = scope.names.length - 1; index >= 0; index -= 1) {
		const name = scope.names[index];
		const stack = context.bindingStacksByName.get(name);
		if (!stack || stack.length === 0) {
			continue;
		}
		stack.pop();
		if (stack.length === 0) {
			context.bindingStacksByName.delete(name);
		}
	}
}

export function lintShadowedRequireAliasExpression(expression: LuaExpression | null, context: ShadowedRequireAliasContext): void {
	if (!expression) {
		return;
	}
	switch (expression.kind) {
		case LuaSyntaxKind.CallExpression:
			lintShadowedRequireAliasExpression(expression.callee, context);
			for (const argument of expression.arguments) {
				lintShadowedRequireAliasExpression(argument, context);
			}
			return;
		case LuaSyntaxKind.MemberExpression:
			lintShadowedRequireAliasExpression(expression.base, context);
			return;
		case LuaSyntaxKind.IndexExpression:
			lintShadowedRequireAliasExpression(expression.base, context);
			lintShadowedRequireAliasExpression(expression.index, context);
			return;
		case LuaSyntaxKind.BinaryExpression:
			lintShadowedRequireAliasExpression(expression.left, context);
			lintShadowedRequireAliasExpression(expression.right, context);
			return;
		case LuaSyntaxKind.UnaryExpression:
			lintShadowedRequireAliasExpression(expression.operand, context);
			return;
		case LuaSyntaxKind.TableConstructorExpression:
			for (const field of expression.fields) {
				if (field.kind === LuaTableFieldKind.ExpressionKey) {
					lintShadowedRequireAliasExpression(field.key, context);
				}
				lintShadowedRequireAliasExpression(field.value, context);
			}
			return;
		case LuaSyntaxKind.FunctionExpression:
			enterShadowedRequireAliasScope(context);
			for (const parameter of expression.parameters) {
				declareShadowedRequireAliasBinding(context, parameter, null);
			}
			lintShadowedRequireAliasStatements(expression.body.body, context);
			leaveShadowedRequireAliasScope(context);
			return;
		default:
			return;
	}
}

export function lintShadowedRequireAliasStatements(
	statements: ReadonlyArray<LuaStatement>,
	context: ShadowedRequireAliasContext,
): void {
	for (const statement of statements) {
		switch (statement.kind) {
			case LuaSyntaxKind.LocalAssignmentStatement: {
				const valueCount = Math.min(statement.names.length, statement.values.length);
				for (let index = 0; index < statement.names.length; index += 1) {
					const requiredModulePath = index < valueCount ? getRequiredModulePath(statement.values[index]) ?? null : null;
					declareShadowedRequireAliasBinding(context, statement.names[index], requiredModulePath);
				}
				for (const value of statement.values) {
					lintShadowedRequireAliasExpression(value, context);
				}
				break;
			}
			case LuaSyntaxKind.LocalFunctionStatement: {
				const localFunction = statement as LuaLocalFunctionStatement;
				declareShadowedRequireAliasBinding(context, localFunction.name, null);
				enterShadowedRequireAliasScope(context);
				for (const parameter of localFunction.functionExpression.parameters) {
					declareShadowedRequireAliasBinding(context, parameter, null);
				}
				lintShadowedRequireAliasStatements(localFunction.functionExpression.body.body, context);
				leaveShadowedRequireAliasScope(context);
				break;
			}
			case LuaSyntaxKind.FunctionDeclarationStatement:
				enterShadowedRequireAliasScope(context);
				for (const parameter of statement.functionExpression.parameters) {
					declareShadowedRequireAliasBinding(context, parameter, null);
				}
				lintShadowedRequireAliasStatements(statement.functionExpression.body.body, context);
				leaveShadowedRequireAliasScope(context);
				break;
			case LuaSyntaxKind.AssignmentStatement:
				for (const left of statement.left) {
					lintShadowedRequireAliasExpression(left, context);
				}
				for (const right of statement.right) {
					lintShadowedRequireAliasExpression(right, context);
				}
				break;
			case LuaSyntaxKind.ReturnStatement:
				for (const expression of statement.expressions) {
					lintShadowedRequireAliasExpression(expression, context);
				}
				break;
			case LuaSyntaxKind.IfStatement:
				for (const clause of statement.clauses) {
					if (clause.condition) {
						lintShadowedRequireAliasExpression(clause.condition, context);
					}
					enterShadowedRequireAliasScope(context);
					lintShadowedRequireAliasStatements(clause.block.body, context);
					leaveShadowedRequireAliasScope(context);
				}
				break;
			case LuaSyntaxKind.WhileStatement:
				lintShadowedRequireAliasExpression(statement.condition, context);
				enterShadowedRequireAliasScope(context);
				lintShadowedRequireAliasStatements(statement.block.body, context);
				leaveShadowedRequireAliasScope(context);
				break;
			case LuaSyntaxKind.RepeatStatement:
				enterShadowedRequireAliasScope(context);
				lintShadowedRequireAliasStatements(statement.block.body, context);
				lintShadowedRequireAliasExpression(statement.condition, context);
				leaveShadowedRequireAliasScope(context);
				break;
			case LuaSyntaxKind.ForNumericStatement:
				lintShadowedRequireAliasExpression(statement.start, context);
				lintShadowedRequireAliasExpression(statement.limit, context);
				lintShadowedRequireAliasExpression(statement.step, context);
				enterShadowedRequireAliasScope(context);
				declareShadowedRequireAliasBinding(context, statement.variable, null);
				lintShadowedRequireAliasStatements(statement.block.body, context);
				leaveShadowedRequireAliasScope(context);
				break;
			case LuaSyntaxKind.ForGenericStatement:
				for (const iterator of statement.iterators) {
					lintShadowedRequireAliasExpression(iterator, context);
				}
				enterShadowedRequireAliasScope(context);
				for (const variable of statement.variables) {
					declareShadowedRequireAliasBinding(context, variable, null);
				}
				lintShadowedRequireAliasStatements(statement.block.body, context);
				leaveShadowedRequireAliasScope(context);
				break;
			case LuaSyntaxKind.DoStatement:
				enterShadowedRequireAliasScope(context);
				lintShadowedRequireAliasStatements(statement.block.body, context);
				leaveShadowedRequireAliasScope(context);
				break;
			case LuaSyntaxKind.CallStatement:
				lintShadowedRequireAliasExpression(statement.expression, context);
				break;
			default:
				break;
		}
	}
}

export function lintShadowedRequireAliasPattern(statements: ReadonlyArray<LuaStatement>, issues: LuaLintIssue[]): void {
	const context = createShadowedRequireAliasContext(issues);
	enterShadowedRequireAliasScope(context);
	lintShadowedRequireAliasStatements(statements, context);
	leaveShadowedRequireAliasScope(context);
}

export function isRequireCallExpression(expression: LuaExpression | undefined): boolean {
	if (!expression || expression.kind !== LuaSyntaxKind.CallExpression) {
		return false;
	}
	return expression.callee.kind === LuaSyntaxKind.IdentifierExpression && expression.callee.name === 'require';
}
