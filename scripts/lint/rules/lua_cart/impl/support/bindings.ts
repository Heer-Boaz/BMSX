import { LuaAssignmentOperator, LuaBinaryOperator, type LuaCallExpression, type LuaExpression, type LuaFunctionExpression, type LuaIdentifierExpression, type LuaStatement, LuaSyntaxKind } from '../../../../../../src/bmsx/lua/syntax/ast';
import { evaluateTopLevelStringConstantExpression } from './conditions';
import { getConstantCopyBinding } from './constant_copy';
import { getExpressionKeyName } from './expression_signatures';
import { AssignmentTargetInfo, ConstantCopyContext, SingleUseLocalBinding, TopLevelLocalStringConstant } from './types';

export type NamedLuaBindingScope = {
	readonly names: string[];
};

export type LuaBindingContext<TBinding> = {
	readonly bindingStacksByName: Map<string, TBinding[]>;
	readonly scopeStack: NamedLuaBindingScope[];
};

export function enterLuaBindingScope(context: { readonly scopeStack: NamedLuaBindingScope[] }): void {
	context.scopeStack.push({ names: [] });
}

export function declareLuaBinding<TBinding>(
	context: LuaBindingContext<TBinding>,
	declaration: LuaIdentifierExpression,
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

export function resolveLuaBinding<TBinding>(context: LuaBindingContext<TBinding>, name: string): TBinding | undefined {
	const stack = context.bindingStacksByName.get(name);
	if (!stack || stack.length === 0) {
		return undefined;
	}
	return stack[stack.length - 1];
}

export function setLuaBinding<TBinding>(context: LuaBindingContext<TBinding>, name: string, binding: TBinding): void {
	const stack = context.bindingStacksByName.get(name);
	if (!stack || stack.length === 0) {
		return;
	}
	stack[stack.length - 1] = binding;
}

export function leaveLuaBindingScope<TBinding>(
	scopeStack: NamedLuaBindingScope[],
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

export function discardLuaBindingScope<TBinding>(context: LuaBindingContext<TBinding>): void {
	leaveLuaBindingScope(context.scopeStack, context.bindingStacksByName, () => {});
}

export function lintScopedBindingStatements<TBinding, TContext extends LuaBindingContext<TBinding>>(
	context: TContext,
	statements: ReadonlyArray<LuaStatement>,
	lintStatements: (statements: ReadonlyArray<LuaStatement>, context: TContext) => void,
): void {
	enterLuaBindingScope(context);
	lintStatements(statements, context);
	discardLuaBindingScope(context);
}

export function lintNullBindingFunctionScope<TBinding, TContext extends LuaBindingContext<TBinding | null>>(
	context: TContext,
	functionExpression: LuaFunctionExpression,
	lintStatements: (statements: ReadonlyArray<LuaStatement>, context: TContext) => void,
): void {
	enterLuaBindingScope(context);
	for (const parameter of functionExpression.parameters) {
		declareLuaBinding(context, parameter, null);
	}
	lintStatements(functionExpression.body.body, context);
	discardLuaBindingScope(context);
}

export function isIdentifier(expression: LuaExpression, name: string): boolean {
	return expression.kind === LuaSyntaxKind.IdentifierExpression && expression.name === name;
}

export function isIdentifierExpression(expression: LuaExpression): expression is LuaIdentifierExpression {
	return expression.kind === LuaSyntaxKind.IdentifierExpression;
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
	statements: ReadonlyArray<LuaStatement>,
): TopLevelLocalStringConstant[] {
	const constants: TopLevelLocalStringConstant[] = [];
	const knownValues = new Map<string, string>();
	for (const statement of statements) {
		if (statement.kind !== LuaSyntaxKind.LocalAssignmentStatement) {
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

export function getRootIdentifier(expression: LuaExpression): string | undefined {
	if (expression.kind === LuaSyntaxKind.IdentifierExpression) {
		return expression.name;
	}
	if (expression.kind === LuaSyntaxKind.MemberExpression || expression.kind === LuaSyntaxKind.IndexExpression) {
		return getRootIdentifier(expression.base);
	}
	return undefined;
}

export function getAssignmentTargetInfo(target: LuaExpression): AssignmentTargetInfo | undefined {
	if (target.kind === LuaSyntaxKind.IdentifierExpression) {
		return {
			depth: 0,
			rootName: target.name,
		};
	}
	if (target.kind === LuaSyntaxKind.MemberExpression) {
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
	if (target.kind === LuaSyntaxKind.IndexExpression) {
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

export function getReturnedCallToIdentifier(statement: LuaStatement, name: string): LuaCallExpression | undefined {
	if (statement.kind !== LuaSyntaxKind.ReturnStatement || statement.expressions.length !== 1) {
		return undefined;
	}
	const expression = statement.expressions[0];
	if (expression.kind !== LuaSyntaxKind.CallExpression) {
		return undefined;
	}
	if (expression.callee.kind !== LuaSyntaxKind.IdentifierExpression || expression.callee.name !== name) {
		return undefined;
	}
	return expression;
}

export function conditionComparesIdentifierWithValue(condition: LuaExpression, name: string): boolean {
	if (condition.kind !== LuaSyntaxKind.BinaryExpression || condition.operator !== LuaBinaryOperator.Equal) {
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

export function assignmentDirectlyTargetsIdentifier(statement: LuaStatement, name: string): boolean {
	if (statement.kind !== LuaSyntaxKind.AssignmentStatement || statement.operator !== LuaAssignmentOperator.Assign) {
		return false;
	}
	for (const left of statement.left) {
		if (left.kind === LuaSyntaxKind.IdentifierExpression && left.name === name) {
			return true;
		}
	}
	return false;
}
