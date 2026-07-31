import { type LuaExpression as Expression, type LuaFunctionExpression as CartFunctionExpression, type LuaStatement as Statement, LuaSyntaxKind as SyntaxKind, LuaTableFieldKind as TableFieldKind } from '../../../../../../toolchain/ts/lua/syntax/ast';
import { resolveModuleAliasInitializer } from '../../../../../../toolchain/ts/lua/semantic/module_aliases';
import { type CartLintIssue } from '../../../../lua_rule';
import { declareShadowedRequireAliasBinding } from '../../shadowed_require_alias_pattern';
import { discardBindingScope, enterBindingScope, lintScopedBindingStatements, resolveBinding } from './bindings';
import { isConstantModulePath } from './object_ownership';
import {
	CART_MODULE_CALL_FSM_REGISTER,
	CART_MODULE_CALL_PREFAB_DEFINE,
	CART_MODULE_CALL_PREFAB_SPAWN,
	type CartModuleCallKind,
	type CartModuleCallMap,
	type ShadowedRequireAliasBinding,
	type ShadowedRequireAliasContext,
} from './types';

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
	const bindingStacksByName = new Map<string, ShadowedRequireAliasBinding[]>();
	return {
		issues,
		bindingStacksByName,
		scopeStack: [],
		moduleCalls: new WeakMap(),
		pendingBindings: [],
		moduleAliasLookup: (name) => {
			const stack = bindingStacksByName.get(name);
			return stack?.[stack.length - 1]?.moduleAlias;
		},
		requireIsBuiltin: true,
	};
}

export function lintShadowedRequireAliasExpression(expression: Expression | null, context: ShadowedRequireAliasContext): void {
	if (!expression) {
		return;
	}
	switch (expression.kind) {
		case SyntaxKind.CallExpression: {
			const callKind = classifyCartModuleCall(expression, context);
			if (callKind) {
				context.moduleCalls.set(expression, callKind);
			}
			lintShadowedRequireAliasExpression(expression.callee, context);
			for (const argument of expression.arguments) {
				lintShadowedRequireAliasExpression(argument, context);
			}
			return;
		}
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
					for (const value of statement.values) {
						lintShadowedRequireAliasExpression(value, context);
					}
					const pending = context.pendingBindings;
					const requireIsBuiltin = context.requireIsBuiltin
						&& resolveBinding(context, 'require') === undefined;
					for (let index = 0; index < statement.names.length; index += 1) {
						const initializer = index < statement.values.length ? statement.values[index] : undefined;
						const moduleAlias = initializer && statement.attributes[index] !== null
							? resolveModuleAliasInitializer(
								initializer,
								context.moduleAliasLookup,
								requireIsBuiltin,
							)
							: undefined;
						pending.push({
							declaration: statement.names[index],
							requiredModulePath: initializer && requireIsBuiltin
								? getRequiredModulePath(initializer)
								: undefined,
							moduleAlias,
						});
					}
					for (let index = 0; index < pending.length; index += 1) {
						declareShadowedRequireAliasBinding(context, pending[index]);
					}
					pending.length = 0;
					break;
				}
			case SyntaxKind.LocalFunctionStatement:
				declareShadowedRequireAliasBinding(context, {
					declaration: statement.name,
					requiredModulePath: undefined,
					moduleAlias: undefined,
				});
				lintShadowedRequireAliasFunctionExpression(statement.functionExpression, context);
				break;
			case SyntaxKind.FunctionDeclarationStatement:
				if (statement.name.identifiers.length === 1
					&& statement.name.identifiers[0] === 'require'
					&& !statement.name.methodName
					&& resolveBinding(context, 'require') === undefined) {
					context.requireIsBuiltin = false;
				}
				lintShadowedRequireAliasFunctionExpression(statement.functionExpression, context);
				break;
			case SyntaxKind.AssignmentStatement:
				for (const left of statement.left) {
					lintShadowedRequireAliasExpression(left, context);
				}
				for (const right of statement.right) {
					lintShadowedRequireAliasExpression(right, context);
				}
				for (const left of statement.left) {
					if (left.kind === SyntaxKind.IdentifierExpression
						&& left.name === 'require'
						&& resolveBinding(context, 'require') === undefined) {
						context.requireIsBuiltin = false;
					}
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
				enterBindingScope(context);
				lintShadowedRequireAliasStatements(statement.block.body, context);
				lintShadowedRequireAliasExpression(statement.condition, context);
				discardBindingScope(context);
				break;
			case SyntaxKind.ForNumericStatement:
				lintShadowedRequireAliasExpression(statement.start, context);
				lintShadowedRequireAliasExpression(statement.limit, context);
				lintShadowedRequireAliasExpression(statement.step, context);
				enterBindingScope(context);
				declareShadowedRequireAliasBinding(context, {
					declaration: statement.variable,
					requiredModulePath: undefined,
					moduleAlias: undefined,
				});
				lintShadowedRequireAliasStatements(statement.block.body, context);
				discardBindingScope(context);
				break;
			case SyntaxKind.ForGenericStatement:
				for (const iterator of statement.iterators) {
					lintShadowedRequireAliasExpression(iterator, context);
				}
				enterBindingScope(context);
				for (const variable of statement.variables) {
					declareShadowedRequireAliasBinding(context, {
						declaration: variable,
						requiredModulePath: undefined,
						moduleAlias: undefined,
					});
				}
				lintShadowedRequireAliasStatements(statement.block.body, context);
				discardBindingScope(context);
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
	const requireIsBuiltin = context.requireIsBuiltin;
	enterBindingScope(context);
	for (const parameter of functionExpression.parameters) {
		declareShadowedRequireAliasBinding(context, {
			declaration: parameter,
			requiredModulePath: undefined,
			moduleAlias: undefined,
		});
	}
	lintShadowedRequireAliasStatements(functionExpression.body.body, context);
	discardBindingScope(context);
	context.requireIsBuiltin = requireIsBuiltin;
}

export function analyzeRequireAliases(statements: ReadonlyArray<Statement>, issues: CartLintIssue[]): CartModuleCallMap {
	const context = createShadowedRequireAliasContext(issues);
	enterBindingScope(context);
	lintShadowedRequireAliasStatements(statements, context);
	discardBindingScope(context);
	return context.moduleCalls;
}

function classifyCartModuleCall(
	expression: Extract<Expression, { kind: SyntaxKind.CallExpression }>,
	context: ShadowedRequireAliasContext,
): CartModuleCallKind | undefined {
	let member = expression.methodName;
	let memberCount = member ? 1 : 0;
	let callee = expression.callee;
	while (callee.kind === SyntaxKind.MemberExpression || callee.kind === SyntaxKind.IndexExpression) {
		memberCount += 1;
		if (memberCount > 1) {
			return undefined;
		}
		if (callee.kind === SyntaxKind.MemberExpression) {
			member = callee.identifier;
		} else {
			if (callee.index.kind !== SyntaxKind.StringLiteralExpression) {
				return undefined;
			}
			member = callee.index.value;
		}
		callee = callee.base;
	}
	if (callee.kind !== SyntaxKind.IdentifierExpression) {
		return undefined;
	}
	const alias = resolveBinding(context, callee.name)?.moduleAlias;
	if (!alias || alias.memberPath.length + memberCount !== 1) {
		return undefined;
	}
	if (alias.memberPath.length === 1) {
		member = alias.memberPath[0];
	}
	if (alias.module === 'cartlib/fsm/library' && member === 'register') {
		return CART_MODULE_CALL_FSM_REGISTER;
	}
	if (alias.module !== 'cartlib/prefab') {
		return undefined;
	}
	if (member === 'define') {
		return CART_MODULE_CALL_PREFAB_DEFINE;
	}
	return member === 'spawn' ? CART_MODULE_CALL_PREFAB_SPAWN : undefined;
}

export function isRequireCallExpression(expression: Expression | undefined): boolean {
	if (!expression || expression.kind !== SyntaxKind.CallExpression) {
		return false;
	}
	return expression.callee.kind === SyntaxKind.IdentifierExpression && expression.callee.name === 'require';
}
