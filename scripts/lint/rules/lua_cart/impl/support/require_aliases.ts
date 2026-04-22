import { type LuaExpression as Expression, type LuaFunctionExpression as CartFunctionExpression, type LuaStatement as Statement, LuaSyntaxKind as SyntaxKind, LuaTableFieldKind as TableFieldKind } from '../../../../../../src/bmsx/lua/syntax/ast';
import { type CartLintIssue } from '../../../../lua_rule';
import { declareShadowedRequireAliasBinding } from '../../shadowed_require_alias_pattern';
import { discardBindingScope, enterBindingScope, lintScopedBindingStatements } from './bindings';
import { isConstantModulePath } from './object_ownership';
import { ShadowedRequireAliasBinding, ShadowedRequireAliasContext } from './types';

export function getRequiredModulePath(expression: Expression): string | undefined {
	if (expression.kind !== SyntaxKind.CallExpression) {
		return undefined;
	}
	if (expression.callee.kind !== SyntaxKind.IdentifierExpression || expression.callee.name !== 'require') {
		return undefined;
	}
	if (expression.arguments.length === 0) {
		return undefined;
	}
	const firstArgument = expression.arguments[0];
	if (firstArgument.kind !== SyntaxKind.StringLiteralExpression) {
		return undefined;
	}
	return firstArgument.value;
}

export function isConstantModuleRequireExpression(expression: Expression): boolean {
	const requiredModulePath = getRequiredModulePath(expression);
	return requiredModulePath !== undefined && isConstantModulePath(requiredModulePath);
}

export function createShadowedRequireAliasContext(issues: CartLintIssue[]): ShadowedRequireAliasContext {
	return {
		issues,
		bindingStacksByName: new Map<string, ShadowedRequireAliasBinding[]>(),
		scopeStack: [],
	};
}

export function enterShadowedRequireAliasScope(context: ShadowedRequireAliasContext): void {
	enterBindingScope(context);
}

export function leaveShadowedRequireAliasScope(context: ShadowedRequireAliasContext): void {
	discardBindingScope(context);
}

export function lintShadowedRequireAliasExpression(expression: Expression | null, context: ShadowedRequireAliasContext): void {
	if (!expression) {
		return;
	}
	switch (expression.kind) {
		case SyntaxKind.CallExpression:
			lintShadowedRequireAliasExpression(expression.callee, context);
			for (const argument of expression.arguments) {
				lintShadowedRequireAliasExpression(argument, context);
			}
			return;
		case SyntaxKind.MemberExpression:
			lintShadowedRequireAliasExpression(expression.base, context);
			return;
		case SyntaxKind.IndexExpression:
			lintShadowedRequireAliasExpression(expression.base, context);
			lintShadowedRequireAliasExpression(expression.index, context);
			return;
		case SyntaxKind.BinaryExpression:
			lintShadowedRequireAliasExpression(expression.left, context);
			lintShadowedRequireAliasExpression(expression.right, context);
			return;
		case SyntaxKind.UnaryExpression:
			lintShadowedRequireAliasExpression(expression.operand, context);
			return;
		case SyntaxKind.TableConstructorExpression:
			for (const field of expression.fields) {
				if (field.kind === TableFieldKind.ExpressionKey) {
					lintShadowedRequireAliasExpression(field.key, context);
				}
				lintShadowedRequireAliasExpression(field.value, context);
			}
			return;
		case SyntaxKind.FunctionExpression:
			lintShadowedRequireAliasFunctionExpression(expression, context);
			return;
		default:
			return;
	}
}

export function lintShadowedRequireAliasStatements(
	statements: ReadonlyArray<Statement>,
	context: ShadowedRequireAliasContext,
): void {
	for (const statement of statements) {
		switch (statement.kind) {
			case SyntaxKind.LocalAssignmentStatement: {
				const valueCount = Math.min(statement.names.length, statement.values.length);
				for (let index = 0; index < statement.names.length; index += 1) {
					const requiredModulePath = index < valueCount ? getRequiredModulePath(statement.values[index]) : undefined;
					declareShadowedRequireAliasBinding(context, statement.names[index], requiredModulePath);
				}
				for (const value of statement.values) {
					lintShadowedRequireAliasExpression(value, context);
				}
				break;
			}
			case SyntaxKind.LocalFunctionStatement:
				declareShadowedRequireAliasBinding(context, statement.name, undefined);
				lintShadowedRequireAliasFunctionExpression(statement.functionExpression, context);
				break;
			case SyntaxKind.FunctionDeclarationStatement:
				lintShadowedRequireAliasFunctionExpression(statement.functionExpression, context);
				break;
			case SyntaxKind.AssignmentStatement:
				for (const left of statement.left) {
					lintShadowedRequireAliasExpression(left, context);
				}
				for (const right of statement.right) {
					lintShadowedRequireAliasExpression(right, context);
				}
				break;
			case SyntaxKind.ReturnStatement:
				for (const expression of statement.expressions) {
					lintShadowedRequireAliasExpression(expression, context);
				}
				break;
			case SyntaxKind.IfStatement:
				for (const clause of statement.clauses) {
					if (clause.condition) {
						lintShadowedRequireAliasExpression(clause.condition, context);
					}
					lintScopedBindingStatements(context, clause.block.body, lintShadowedRequireAliasStatements);
				}
				break;
			case SyntaxKind.WhileStatement:
				lintShadowedRequireAliasExpression(statement.condition, context);
				lintScopedBindingStatements(context, statement.block.body, lintShadowedRequireAliasStatements);
				break;
			case SyntaxKind.RepeatStatement:
				enterShadowedRequireAliasScope(context);
				lintShadowedRequireAliasStatements(statement.block.body, context);
				lintShadowedRequireAliasExpression(statement.condition, context);
				leaveShadowedRequireAliasScope(context);
				break;
			case SyntaxKind.ForNumericStatement:
				lintShadowedRequireAliasExpression(statement.start, context);
				lintShadowedRequireAliasExpression(statement.limit, context);
				lintShadowedRequireAliasExpression(statement.step, context);
				enterShadowedRequireAliasScope(context);
				declareShadowedRequireAliasBinding(context, statement.variable, undefined);
				lintShadowedRequireAliasStatements(statement.block.body, context);
				leaveShadowedRequireAliasScope(context);
				break;
			case SyntaxKind.ForGenericStatement:
				for (const iterator of statement.iterators) {
					lintShadowedRequireAliasExpression(iterator, context);
				}
				enterShadowedRequireAliasScope(context);
				for (const variable of statement.variables) {
					declareShadowedRequireAliasBinding(context, variable, undefined);
				}
				lintShadowedRequireAliasStatements(statement.block.body, context);
				leaveShadowedRequireAliasScope(context);
				break;
			case SyntaxKind.DoStatement:
				lintScopedBindingStatements(context, statement.block.body, lintShadowedRequireAliasStatements);
				break;
			case SyntaxKind.CallStatement:
				lintShadowedRequireAliasExpression(statement.expression, context);
				break;
			default:
				break;
		}
	}
}

function lintShadowedRequireAliasFunctionExpression(functionExpression: CartFunctionExpression, context: ShadowedRequireAliasContext): void {
	enterShadowedRequireAliasScope(context);
	for (const parameter of functionExpression.parameters) {
		declareShadowedRequireAliasBinding(context, parameter, undefined);
	}
	lintShadowedRequireAliasStatements(functionExpression.body.body, context);
	leaveShadowedRequireAliasScope(context);
}

export function lintShadowedRequireAliasPattern(statements: ReadonlyArray<Statement>, issues: CartLintIssue[]): void {
	const context = createShadowedRequireAliasContext(issues);
	enterShadowedRequireAliasScope(context);
	lintShadowedRequireAliasStatements(statements, context);
	leaveShadowedRequireAliasScope(context);
}

export function isRequireCallExpression(expression: Expression | undefined): boolean {
	if (!expression || expression.kind !== SyntaxKind.CallExpression) {
		return false;
	}
	return expression.callee.kind === SyntaxKind.IdentifierExpression && expression.callee.name === 'require';
}
