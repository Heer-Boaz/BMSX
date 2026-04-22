import { LuaAssignmentOperator as AssignmentOperator, type LuaExpression as Expression, type LuaIdentifierExpression as IdentifierExpression, type LuaStatement as Statement, LuaSyntaxKind as SyntaxKind } from '../../../../../../src/bmsx/lua/syntax/ast';
import { type CartLintIssue } from '../../../../lua_rule';
import { lintRuntimeTagLookupInExpression } from '../../runtime_tag_table_access_pattern';
import { declareBinding, discardBindingScope, enterBindingScope, lintNullBindingFunctionScope, lintScopedBindingStatements, resolveBinding, setBinding } from './bindings';
import { isObjectOrServiceResolverCallExpression } from './object_ownership';
import { isSelfExpressionRoot } from './self_properties';
import { isTagsContainerExpression } from './tags';
import { RuntimeTagLookupBinding, RuntimeTagLookupContext } from './types';

export function createRuntimeTagLookupContext(issues: CartLintIssue[]): RuntimeTagLookupContext {
	const context: RuntimeTagLookupContext = {
		issues,
		bindingStacksByName: new Map<string, Array<RuntimeTagLookupBinding | null>>(),
		scopeStack: [],
	};
	enterRuntimeTagLookupScope(context);
	return context;
}

export function enterRuntimeTagLookupScope(context: RuntimeTagLookupContext): void {
	enterBindingScope(context);
}

export function leaveRuntimeTagLookupScope(context: RuntimeTagLookupContext): void {
	discardBindingScope(context);
}

export function declareRuntimeTagLookupBinding(
	context: RuntimeTagLookupContext,
	declaration: IdentifierExpression,
	binding: RuntimeTagLookupBinding | null,
): void {
	declareBinding(context, declaration, binding);
}

export function resolveRuntimeTagLookupBinding(
	context: RuntimeTagLookupContext,
	name: string,
): RuntimeTagLookupBinding | null | undefined {
	return resolveBinding(context, name);
}

export function setRuntimeTagLookupBinding(
	context: RuntimeTagLookupContext,
	name: string,
	binding: RuntimeTagLookupBinding | null,
): void {
	setBinding(context, name, binding);
}

export function isRuntimeTagLookupAliasInitializer(expression: Expression | undefined): boolean {
	return isObjectOrServiceResolverCallExpression(expression);
}

export function getRuntimeTagLookupOwnerExpression(expression: Expression): Expression | undefined {
	if (expression.kind !== SyntaxKind.MemberExpression && expression.kind !== SyntaxKind.IndexExpression) {
		return undefined;
	}
	if (!isTagsContainerExpression(expression.base)) {
		return undefined;
	}
	const tagsContainer = expression.base;
	if (tagsContainer.kind !== SyntaxKind.MemberExpression && tagsContainer.kind !== SyntaxKind.IndexExpression) {
		return undefined;
	}
	return tagsContainer.base;
}

export function isRuntimeTagLookupOwnerExpression(expression: Expression, context: RuntimeTagLookupContext): boolean {
	if (isSelfExpressionRoot(expression)) {
		return true;
	}
	if (isObjectOrServiceResolverCallExpression(expression)) {
		return true;
	}
	if (expression.kind !== SyntaxKind.IdentifierExpression) {
		return false;
	}
	return !!resolveRuntimeTagLookupBinding(context, expression.name);
}

export function isRuntimeTagLookupExpression(expression: Expression, context: RuntimeTagLookupContext): boolean {
	const ownerExpression = getRuntimeTagLookupOwnerExpression(expression);
	if (!ownerExpression) {
		return false;
	}
	return isRuntimeTagLookupOwnerExpression(ownerExpression, context);
}

export function lintRuntimeTagLookupInStatements(
	statements: ReadonlyArray<Statement>,
	context: RuntimeTagLookupContext,
): void {
	for (const statement of statements) {
		switch (statement.kind) {
			case SyntaxKind.LocalAssignmentStatement:
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
			case SyntaxKind.AssignmentStatement:
				for (const left of statement.left) {
					lintRuntimeTagLookupInExpression(left, context);
				}
				for (const right of statement.right) {
					lintRuntimeTagLookupInExpression(right, context);
				}
				if (statement.operator === AssignmentOperator.Assign) {
					const pairCount = Math.min(statement.left.length, statement.right.length);
					for (let index = 0; index < pairCount; index += 1) {
						const left = statement.left[index];
						if (left.kind !== SyntaxKind.IdentifierExpression) {
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
			case SyntaxKind.LocalFunctionStatement:
				declareRuntimeTagLookupBinding(context, statement.name, null);
				lintNullBindingFunctionScope(context, statement.functionExpression, lintRuntimeTagLookupInStatements);
				break;
			case SyntaxKind.FunctionDeclarationStatement:
				lintNullBindingFunctionScope(context, statement.functionExpression, lintRuntimeTagLookupInStatements);
				break;
			case SyntaxKind.ReturnStatement:
				for (const expression of statement.expressions) {
					lintRuntimeTagLookupInExpression(expression, context);
				}
				break;
			case SyntaxKind.IfStatement:
				for (const clause of statement.clauses) {
					if (clause.condition) {
						lintRuntimeTagLookupInExpression(clause.condition, context);
					}
					lintScopedBindingStatements(context, clause.block.body, lintRuntimeTagLookupInStatements);
				}
				break;
			case SyntaxKind.WhileStatement:
				lintRuntimeTagLookupInExpression(statement.condition, context);
				lintScopedBindingStatements(context, statement.block.body, lintRuntimeTagLookupInStatements);
				break;
			case SyntaxKind.RepeatStatement:
				enterRuntimeTagLookupScope(context);
				lintRuntimeTagLookupInStatements(statement.block.body, context);
				lintRuntimeTagLookupInExpression(statement.condition, context);
				leaveRuntimeTagLookupScope(context);
				break;
			case SyntaxKind.ForNumericStatement:
				lintRuntimeTagLookupInExpression(statement.start, context);
				lintRuntimeTagLookupInExpression(statement.limit, context);
				lintRuntimeTagLookupInExpression(statement.step, context);
				enterRuntimeTagLookupScope(context);
				declareRuntimeTagLookupBinding(context, statement.variable, null);
				lintRuntimeTagLookupInStatements(statement.block.body, context);
				leaveRuntimeTagLookupScope(context);
				break;
			case SyntaxKind.ForGenericStatement:
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
			case SyntaxKind.DoStatement:
				lintScopedBindingStatements(context, statement.block.body, lintRuntimeTagLookupInStatements);
				break;
			case SyntaxKind.CallStatement:
				lintRuntimeTagLookupInExpression(statement.expression, context);
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

export function lintRuntimeTagTableAccessPattern(statements: ReadonlyArray<Statement>, issues: CartLintIssue[]): void {
	const context = createRuntimeTagLookupContext(issues);
	try {
		lintRuntimeTagLookupInStatements(statements, context);
	} finally {
		leaveRuntimeTagLookupScope(context);
	}
}
