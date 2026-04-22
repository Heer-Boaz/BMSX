import { LuaAssignmentOperator, type LuaExpression, type LuaIdentifierExpression, type LuaStatement, LuaSyntaxKind } from '../../../../../../src/bmsx/lua/syntax/ast';
import { type LuaLintIssue } from '../../../../lua_rule';
import { lintRuntimeTagLookupInExpression } from '../../runtime_tag_table_access_pattern';
import { isObjectOrServiceResolverCallExpression } from './object_ownership';
import { isSelfExpressionRoot } from './self_properties';
import { isTagsContainerExpression } from './tags';
import { RuntimeTagLookupBinding, RuntimeTagLookupContext } from './types';

export function createRuntimeTagLookupContext(issues: LuaLintIssue[]): RuntimeTagLookupContext {
	const context: RuntimeTagLookupContext = {
		issues,
		bindingStacksByName: new Map<string, Array<RuntimeTagLookupBinding | null>>(),
		scopeStack: [],
	};
	enterRuntimeTagLookupScope(context);
	return context;
}

export function enterRuntimeTagLookupScope(context: RuntimeTagLookupContext): void {
	context.scopeStack.push({ names: [] });
}

export function leaveRuntimeTagLookupScope(context: RuntimeTagLookupContext): void {
	const scope = context.scopeStack.pop();
	if (!scope) {
		return;
	}
	for (const name of scope.names) {
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

export function declareRuntimeTagLookupBinding(
	context: RuntimeTagLookupContext,
	declaration: LuaIdentifierExpression,
	binding: RuntimeTagLookupBinding | null,
): void {
	const scope = context.scopeStack[context.scopeStack.length - 1];
	scope.names.push(declaration.name);
	let stack = context.bindingStacksByName.get(declaration.name);
	if (!stack) {
		stack = [];
		context.bindingStacksByName.set(declaration.name, stack);
	}
	stack.push(binding);
}

export function resolveRuntimeTagLookupBinding(
	context: RuntimeTagLookupContext,
	name: string,
): RuntimeTagLookupBinding | null | undefined {
	const stack = context.bindingStacksByName.get(name);
	if (!stack || stack.length === 0) {
		return undefined;
	}
	return stack[stack.length - 1];
}

export function setRuntimeTagLookupBinding(
	context: RuntimeTagLookupContext,
	name: string,
	binding: RuntimeTagLookupBinding | null,
): void {
	const stack = context.bindingStacksByName.get(name);
	if (!stack || stack.length === 0) {
		return;
	}
	stack[stack.length - 1] = binding;
}

export function isRuntimeTagLookupAliasInitializer(expression: LuaExpression | undefined): boolean {
	return isObjectOrServiceResolverCallExpression(expression);
}

export function getRuntimeTagLookupOwnerExpression(expression: LuaExpression): LuaExpression | undefined {
	if (expression.kind !== LuaSyntaxKind.MemberExpression && expression.kind !== LuaSyntaxKind.IndexExpression) {
		return undefined;
	}
	if (!isTagsContainerExpression(expression.base)) {
		return undefined;
	}
	const tagsContainer = expression.base;
	if (tagsContainer.kind !== LuaSyntaxKind.MemberExpression && tagsContainer.kind !== LuaSyntaxKind.IndexExpression) {
		return undefined;
	}
	return tagsContainer.base;
}

export function isRuntimeTagLookupOwnerExpression(expression: LuaExpression, context: RuntimeTagLookupContext): boolean {
	if (isSelfExpressionRoot(expression)) {
		return true;
	}
	if (isObjectOrServiceResolverCallExpression(expression)) {
		return true;
	}
	if (expression.kind !== LuaSyntaxKind.IdentifierExpression) {
		return false;
	}
	return !!resolveRuntimeTagLookupBinding(context, expression.name);
}

export function isRuntimeTagLookupExpression(expression: LuaExpression, context: RuntimeTagLookupContext): boolean {
	const ownerExpression = getRuntimeTagLookupOwnerExpression(expression);
	if (!ownerExpression) {
		return false;
	}
	return isRuntimeTagLookupOwnerExpression(ownerExpression, context);
}

export function lintRuntimeTagLookupInStatements(
	statements: ReadonlyArray<LuaStatement>,
	context: RuntimeTagLookupContext,
): void {
	for (const statement of statements) {
		switch (statement.kind) {
			case LuaSyntaxKind.LocalAssignmentStatement:
				for (const value of statement.values) {
					lintRuntimeTagLookupInExpression(value, context);
				}
				for (let index = 0; index < statement.names.length; index += 1) {
					const declaration = statement.names[index];
					const value = index < statement.values.length ? statement.values[index] : undefined;
					const binding = value && isRuntimeTagLookupAliasInitializer(value)
						? { declaration }
						: null;
					declareRuntimeTagLookupBinding(context, declaration, binding);
				}
				break;
			case LuaSyntaxKind.AssignmentStatement:
				for (const left of statement.left) {
					lintRuntimeTagLookupInExpression(left, context);
				}
				for (const right of statement.right) {
					lintRuntimeTagLookupInExpression(right, context);
				}
				if (statement.operator === LuaAssignmentOperator.Assign) {
					const pairCount = Math.min(statement.left.length, statement.right.length);
					for (let index = 0; index < pairCount; index += 1) {
						const left = statement.left[index];
						if (left.kind !== LuaSyntaxKind.IdentifierExpression) {
							continue;
						}
						const right = statement.right[index];
						const binding = isRuntimeTagLookupAliasInitializer(right)
							? { declaration: left }
							: null;
						setRuntimeTagLookupBinding(context, left.name, binding);
					}
				}
				break;
			case LuaSyntaxKind.LocalFunctionStatement:
				declareRuntimeTagLookupBinding(context, statement.name, null);
				enterRuntimeTagLookupScope(context);
				for (const parameter of statement.functionExpression.parameters) {
					declareRuntimeTagLookupBinding(context, parameter, null);
				}
				lintRuntimeTagLookupInStatements(statement.functionExpression.body.body, context);
				leaveRuntimeTagLookupScope(context);
				break;
			case LuaSyntaxKind.FunctionDeclarationStatement:
				enterRuntimeTagLookupScope(context);
				for (const parameter of statement.functionExpression.parameters) {
					declareRuntimeTagLookupBinding(context, parameter, null);
				}
				lintRuntimeTagLookupInStatements(statement.functionExpression.body.body, context);
				leaveRuntimeTagLookupScope(context);
				break;
			case LuaSyntaxKind.ReturnStatement:
				for (const expression of statement.expressions) {
					lintRuntimeTagLookupInExpression(expression, context);
				}
				break;
			case LuaSyntaxKind.IfStatement:
				for (const clause of statement.clauses) {
					if (clause.condition) {
						lintRuntimeTagLookupInExpression(clause.condition, context);
					}
					enterRuntimeTagLookupScope(context);
					lintRuntimeTagLookupInStatements(clause.block.body, context);
					leaveRuntimeTagLookupScope(context);
				}
				break;
			case LuaSyntaxKind.WhileStatement:
				lintRuntimeTagLookupInExpression(statement.condition, context);
				enterRuntimeTagLookupScope(context);
				lintRuntimeTagLookupInStatements(statement.block.body, context);
				leaveRuntimeTagLookupScope(context);
				break;
			case LuaSyntaxKind.RepeatStatement:
				enterRuntimeTagLookupScope(context);
				lintRuntimeTagLookupInStatements(statement.block.body, context);
				lintRuntimeTagLookupInExpression(statement.condition, context);
				leaveRuntimeTagLookupScope(context);
				break;
			case LuaSyntaxKind.ForNumericStatement:
				lintRuntimeTagLookupInExpression(statement.start, context);
				lintRuntimeTagLookupInExpression(statement.limit, context);
				lintRuntimeTagLookupInExpression(statement.step, context);
				enterRuntimeTagLookupScope(context);
				declareRuntimeTagLookupBinding(context, statement.variable, null);
				lintRuntimeTagLookupInStatements(statement.block.body, context);
				leaveRuntimeTagLookupScope(context);
				break;
			case LuaSyntaxKind.ForGenericStatement:
				for (const iterator of statement.iterators) {
					lintRuntimeTagLookupInExpression(iterator, context);
				}
				enterRuntimeTagLookupScope(context);
				for (const variable of statement.variables) {
					declareRuntimeTagLookupBinding(context, variable, null);
				}
				lintRuntimeTagLookupInStatements(statement.block.body, context);
				leaveRuntimeTagLookupScope(context);
				break;
			case LuaSyntaxKind.DoStatement:
				enterRuntimeTagLookupScope(context);
				lintRuntimeTagLookupInStatements(statement.block.body, context);
				leaveRuntimeTagLookupScope(context);
				break;
			case LuaSyntaxKind.CallStatement:
				lintRuntimeTagLookupInExpression(statement.expression, context);
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

export function lintRuntimeTagTableAccessPattern(statements: ReadonlyArray<LuaStatement>, issues: LuaLintIssue[]): void {
	const context = createRuntimeTagLookupContext(issues);
	try {
		lintRuntimeTagLookupInStatements(statements, context);
	} finally {
		leaveRuntimeTagLookupScope(context);
	}
}
