import { LuaAssignmentOperator as AssignmentOperator, LuaBinaryOperator as BinaryOperator, type LuaCallExpression as CallExpression, type LuaExpression as Expression, type LuaFunctionExpression as CartFunctionExpression, type LuaIdentifierExpression as IdentifierExpression, type LuaStatement as Statement, LuaSyntaxKind as SyntaxKind } from '../../../../../../src/bmsx/lua/syntax/ast';
import { evaluateTopLevelStringConstantExpression } from './conditions';
import { getConstantCopyBinding } from './constant_copy';
import { getExpressionKeyName } from './expression_signatures';
import { AssignmentTargetInfo, ConstantCopyContext, SingleUseLocalBinding, TopLevelLocalStringConstant } from './types';

export type NamedBindingScope = {
	readonly names: string[];
};

export type BindingContext<TBinding> = {
	readonly bindingStacksByName: Map<string, TBinding[]>;
	readonly scopeStack: NamedBindingScope[];
};

export function enterBindingScope(context: { readonly scopeStack: NamedBindingScope[] }): void {
	context.scopeStack.push({ names: [] });
}

export function declareBinding<TBinding>(
	context: BindingContext<TBinding>,
	declaration: IdentifierExpression,
	binding: TBinding,
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

export function resolveBinding<TBinding>(context: BindingContext<TBinding>, name: string): TBinding | undefined {
	const stack = context.bindingStacksByName.get(name);
	if (!stack || stack.length === 0) {
		return undefined;
	}
	return stack[stack.length - 1];
}

export function setBinding<TBinding>(context: BindingContext<TBinding>, name: string, binding: TBinding): void {
	const stack = context.bindingStacksByName.get(name);
	if (!stack || stack.length === 0) {
		return;
	}
	stack[stack.length - 1] = binding;
}

export function leaveBindingScope<TBinding>(
	scopeStack: NamedBindingScope[],
	bindingStacksByName: Map<string, TBinding[]>,
	visitBinding: (binding: TBinding) => void,
): void {
	const scope = scopeStack.pop();
	if (!scope) {
		return;
	}
	for (let index = scope.names.length - 1; index >= 0; index -= 1) {
		const name = scope.names[index];
		const stack = bindingStacksByName.get(name);
		if (!stack || stack.length === 0) {
			continue;
		}
		const binding = stack.pop();
		if (binding !== undefined) {
			visitBinding(binding);
		}
		if (stack.length === 0) {
			bindingStacksByName.delete(name);
		}
	}
}

export function discardBindingScope<TBinding>(context: BindingContext<TBinding>): void {
	leaveBindingScope(context.scopeStack, context.bindingStacksByName, () => {});
}

export function lintScopedBindingStatements<TBinding, TContext extends BindingContext<TBinding>>(
	context: TContext,
	statements: ReadonlyArray<Statement>,
	lintStatements: (statements: ReadonlyArray<Statement>, context: TContext) => void,
): void {
	enterBindingScope(context);
	lintStatements(statements, context);
	discardBindingScope(context);
}

export function lintNullBindingFunctionScope<TBinding, TContext extends BindingContext<TBinding | null>>(
	context: TContext,
	functionExpression: CartFunctionExpression,
	lintStatements: (statements: ReadonlyArray<Statement>, context: TContext) => void,
): void {
	enterBindingScope(context);
	for (const parameter of functionExpression.parameters) {
		declareBinding(context, parameter, null);
	}
	lintStatements(functionExpression.body.body, context);
	discardBindingScope(context);
}

export function isIdentifier(expression: Expression, name: string): boolean {
	return expression.kind === SyntaxKind.IdentifierExpression && expression.name === name;
}

export function isIdentifierExpression(expression: Expression): expression is IdentifierExpression {
	return expression.kind === SyntaxKind.IdentifierExpression;
}

export function isConstantSourceIdentifierName(name: string, context: ConstantCopyContext): boolean {
	const binding = getConstantCopyBinding(context, name);
	if (binding) {
		return binding.isConstantSource;
	}
	return name === 'constants';
}

export function collectTopLevelLocalStringConstants(
	path: string,
	statements: ReadonlyArray<Statement>,
): TopLevelLocalStringConstant[] {
	const constants: TopLevelLocalStringConstant[] = [];
	const knownValues = new Map<string, string>();
	for (const statement of statements) {
		if (statement.kind !== SyntaxKind.LocalAssignmentStatement) {
			continue;
		}
		const valueCount = Math.min(statement.names.length, statement.values.length);
		const resolvedValues: Array<string | undefined> = [];
		for (let index = 0; index < valueCount; index += 1) {
			resolvedValues[index] = evaluateTopLevelStringConstantExpression(statement.values[index], knownValues);
		}
		for (let index = 0; index < valueCount; index += 1) {
			const resolved = resolvedValues[index];
			if (resolved === undefined) {
				continue;
			}
			const name = statement.names[index];
			knownValues.set(name.name, resolved);
			constants.push({
				path,
				name: name.name,
				value: resolved,
				declaration: name,
			});
		}
	}
	return constants;
}

export function getRootIdentifier(expression: Expression): string | undefined {
	if (expression.kind === SyntaxKind.IdentifierExpression) {
		return expression.name;
	}
	if (expression.kind === SyntaxKind.MemberExpression || expression.kind === SyntaxKind.IndexExpression) {
		return getRootIdentifier(expression.base);
	}
	return undefined;
}

export function getAssignmentTargetInfo(target: Expression): AssignmentTargetInfo | undefined {
	if (target.kind === SyntaxKind.IdentifierExpression) {
		return {
			depth: 0,
			rootName: target.name,
		};
	}
	if (target.kind === SyntaxKind.MemberExpression) {
		const baseInfo = getAssignmentTargetInfo(target.base);
		if (!baseInfo) {
			return undefined;
		}
		return {
			depth: baseInfo.depth + 1,
			rootName: baseInfo.rootName,
			terminalPropertyName: target.identifier,
		};
	}
	if (target.kind === SyntaxKind.IndexExpression) {
		const baseInfo = getAssignmentTargetInfo(target.base);
		if (!baseInfo) {
			return undefined;
		}
		return {
			depth: baseInfo.depth + 1,
			rootName: baseInfo.rootName,
			terminalPropertyName: getExpressionKeyName(target.index),
		};
	}
	return undefined;
}

export function getReturnedCallToIdentifier(statement: Statement, name: string): CallExpression | undefined {
	if (statement.kind !== SyntaxKind.ReturnStatement || statement.expressions.length !== 1) {
		return undefined;
	}
	const expression = statement.expressions[0];
	if (expression.kind !== SyntaxKind.CallExpression) {
		return undefined;
	}
	if (expression.callee.kind !== SyntaxKind.IdentifierExpression || expression.callee.name !== name) {
		return undefined;
	}
	return expression;
}

export function conditionComparesIdentifierWithValue(condition: Expression, name: string): boolean {
	if (condition.kind !== SyntaxKind.BinaryExpression || condition.operator !== BinaryOperator.Equal) {
		return false;
	}
	return isIdentifier(condition.left, name) || isIdentifier(condition.right, name);
}

export function singleUseLocalMessage(binding: SingleUseLocalBinding): string {
	if (binding.reportKind === 'small_helper') {
		return `Small one-off local helper "${binding.declaration.name}" is forbidden. Inline it, or keep it only if it materially reduces complexity.`;
	}
	return `One-off cached call-result local "${binding.declaration.name}" is forbidden. Inline the call/value instead.`;
}

export function assignmentDirectlyTargetsIdentifier(statement: Statement, name: string): boolean {
	if (statement.kind !== SyntaxKind.AssignmentStatement || statement.operator !== AssignmentOperator.Assign) {
		return false;
	}
	for (const left of statement.left) {
		if (left.kind === SyntaxKind.IdentifierExpression && left.name === name) {
			return true;
		}
	}
	return false;
}
