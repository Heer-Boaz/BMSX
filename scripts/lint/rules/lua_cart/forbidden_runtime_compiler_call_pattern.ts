import {
	LuaSyntaxKind as SyntaxKind,
	LuaTableFieldKind,
	type LuaAssignmentStatement,
	type LuaExpression as Expression,
	type LuaFunctionExpression,
	type LuaIdentifierExpression,
	type LuaLocalAssignmentStatement,
	type LuaStatement as Statement,
} from '../../../../machine/ts/lua/syntax/ast';
import type { CartLintIssue, CartLintIssuePusher, CartLintNode } from '../../lua_rule';
import { defineLintRule } from '../../rule';

export const forbiddenRuntimeCompilerCallPatternRule = defineLintRule('cart', 'forbidden_runtime_compiler_call_pattern');

type Scope = {
	readonly parent: Scope | null;
	readonly locals: Set<string>;
};

const isRuntimeCompilerName = (name: string): boolean => name === 'load' || name === 'loadstring';

const createChildScope = (parent: Scope): Scope => ({
	parent,
	locals: new Set<string>(),
});

const declareIdentifier = (scope: Scope, identifier: LuaIdentifierExpression): void => {
	scope.locals.add(identifier.name);
};

const isLocal = (scope: Scope, name: string): boolean => {
	let current: Scope | null = scope;
	while (current !== null) {
		if (current.locals.has(name)) {
			return true;
		}
		current = current.parent;
	}
	return false;
};

const pushForbiddenRuntimeCompilerReference = (
	node: CartLintNode,
	name: string,
	issues: CartLintIssue[],
	pushIssue: CartLintIssuePusher,
): void => {
	pushIssue(
		issues,
		forbiddenRuntimeCompilerCallPatternRule.name,
		node,
		`${name} is forbidden in shipped Lua. Runtime source compilation is a host/compiler boundary; ship explicit Lua code or precompiled module exports instead.`,
	);
};

const lintIdentifier = (
	expression: LuaIdentifierExpression,
	scope: Scope,
	issues: CartLintIssue[],
	pushIssue: CartLintIssuePusher,
): void => {
	if (!isRuntimeCompilerName(expression.name)) {
		return;
	}
	if (isLocal(scope, expression.name)) {
		return;
	}
	pushForbiddenRuntimeCompilerReference(expression, expression.name, issues, pushIssue);
};

const lintFunctionExpression = (
	expression: LuaFunctionExpression,
	scope: Scope,
	issues: CartLintIssue[],
	pushIssue: CartLintIssuePusher,
): void => {
	const functionScope = createChildScope(scope);
	for (const parameter of expression.parameters) {
		declareIdentifier(functionScope, parameter);
	}
	lintForbiddenRuntimeCompilerReferences(expression.body.body, issues, pushIssue, functionScope);
};

const lintExpression = (
	expression: Expression,
	scope: Scope,
	issues: CartLintIssue[],
	pushIssue: CartLintIssuePusher,
): void => {
	switch (expression.kind) {
		case SyntaxKind.IdentifierExpression:
			lintIdentifier(expression, scope, issues, pushIssue);
			return;
		case SyntaxKind.CallExpression:
			lintExpression(expression.callee, scope, issues, pushIssue);
			for (const arg of expression.arguments) {
				lintExpression(arg, scope, issues, pushIssue);
			}
			return;
		case SyntaxKind.MemberExpression:
			lintExpression(expression.base, scope, issues, pushIssue);
			return;
		case SyntaxKind.IndexExpression:
			lintExpression(expression.base, scope, issues, pushIssue);
			lintExpression(expression.index, scope, issues, pushIssue);
			return;
		case SyntaxKind.BinaryExpression:
			lintExpression(expression.left, scope, issues, pushIssue);
			lintExpression(expression.right, scope, issues, pushIssue);
			return;
		case SyntaxKind.UnaryExpression:
			lintExpression(expression.operand, scope, issues, pushIssue);
			return;
		case SyntaxKind.TableConstructorExpression:
			for (const field of expression.fields) {
				switch (field.kind) {
					case LuaTableFieldKind.Array:
						lintExpression(field.value, scope, issues, pushIssue);
						break;
					case LuaTableFieldKind.IdentifierKey:
						lintExpression(field.value, scope, issues, pushIssue);
						break;
					case LuaTableFieldKind.ExpressionKey:
						lintExpression(field.key, scope, issues, pushIssue);
						lintExpression(field.value, scope, issues, pushIssue);
						break;
				}
			}
			return;
		case SyntaxKind.FunctionExpression:
			lintFunctionExpression(expression, scope, issues, pushIssue);
			return;
		default:
			return;
	}
};

const lintLocalAssignmentStatement = (
	statement: LuaLocalAssignmentStatement,
	scope: Scope,
	issues: CartLintIssue[],
	pushIssue: CartLintIssuePusher,
): void => {
	for (const value of statement.values) {
		lintExpression(value, scope, issues, pushIssue);
	}
	for (const name of statement.names) {
		declareIdentifier(scope, name);
	}
};

const lintAssignmentStatement = (
	statement: LuaAssignmentStatement,
	scope: Scope,
	issues: CartLintIssue[],
	pushIssue: CartLintIssuePusher,
): void => {
	for (const left of statement.left) {
		lintExpression(left, scope, issues, pushIssue);
	}
	for (const right of statement.right) {
		lintExpression(right, scope, issues, pushIssue);
	}
};

export function lintForbiddenRuntimeCompilerReferences(
	statements: ReadonlyArray<Statement>,
	issues: CartLintIssue[],
	pushIssue: CartLintIssuePusher,
	scope: Scope = { parent: null, locals: new Set<string>() },
): void {
	for (const statement of statements) {
		switch (statement.kind) {
			case SyntaxKind.LocalAssignmentStatement:
				lintLocalAssignmentStatement(statement, scope, issues, pushIssue);
				break;
			case SyntaxKind.AssignmentStatement:
				lintAssignmentStatement(statement, scope, issues, pushIssue);
				break;
			case SyntaxKind.LocalFunctionStatement:
				declareIdentifier(scope, statement.name);
				lintFunctionExpression(statement.functionExpression, scope, issues, pushIssue);
				break;
			case SyntaxKind.FunctionDeclarationStatement:
				if (isRuntimeCompilerName(statement.name.identifiers[0]) && !isLocal(scope, statement.name.identifiers[0])) {
					pushForbiddenRuntimeCompilerReference(statement, statement.name.identifiers[0], issues, pushIssue);
				}
				lintFunctionExpression(statement.functionExpression, scope, issues, pushIssue);
				break;
			case SyntaxKind.ReturnStatement:
				for (const expression of statement.expressions) {
					lintExpression(expression, scope, issues, pushIssue);
				}
				break;
			case SyntaxKind.IfStatement:
				for (const clause of statement.clauses) {
					if (clause.condition) {
						lintExpression(clause.condition, scope, issues, pushIssue);
					}
					lintForbiddenRuntimeCompilerReferences(clause.block.body, issues, pushIssue, createChildScope(scope));
				}
				break;
			case SyntaxKind.WhileStatement:
				lintExpression(statement.condition, scope, issues, pushIssue);
				lintForbiddenRuntimeCompilerReferences(statement.block.body, issues, pushIssue, createChildScope(scope));
				break;
			case SyntaxKind.RepeatStatement: {
				const blockScope = createChildScope(scope);
				lintForbiddenRuntimeCompilerReferences(statement.block.body, issues, pushIssue, blockScope);
				lintExpression(statement.condition, blockScope, issues, pushIssue);
				break;
			}
			case SyntaxKind.ForNumericStatement: {
				lintExpression(statement.start, scope, issues, pushIssue);
				lintExpression(statement.limit, scope, issues, pushIssue);
				if (statement.step) {
					lintExpression(statement.step, scope, issues, pushIssue);
				}
				const loopScope = createChildScope(scope);
				declareIdentifier(loopScope, statement.variable);
				lintForbiddenRuntimeCompilerReferences(statement.block.body, issues, pushIssue, loopScope);
				break;
			}
			case SyntaxKind.ForGenericStatement: {
				for (const iterator of statement.iterators) {
					lintExpression(iterator, scope, issues, pushIssue);
				}
				const loopScope = createChildScope(scope);
				for (const variable of statement.variables) {
					declareIdentifier(loopScope, variable);
				}
				lintForbiddenRuntimeCompilerReferences(statement.block.body, issues, pushIssue, loopScope);
				break;
			}
			case SyntaxKind.DoStatement:
				lintForbiddenRuntimeCompilerReferences(statement.block.body, issues, pushIssue, createChildScope(scope));
				break;
			case SyntaxKind.CallStatement:
				lintExpression(statement.expression, scope, issues, pushIssue);
				break;
			default:
				break;
		}
	}
}
