import { type LuaExpression, type LuaFunctionDeclarationStatement, type LuaIdentifierExpression, type LuaLocalFunctionStatement, type LuaStatement, LuaSyntaxKind, LuaTableFieldKind } from '../../../../../../src/bmsx/lua/syntax/ast';
import { type LuaLintIssue } from '../../../../lua_rule';
import { leaveConstLocalScope } from '../../../common/local_const_pattern';
import { ConstLocalBinding, ConstLocalContext } from './types';

export function createConstLocalContext(issues: LuaLintIssue[]): ConstLocalContext {
	return {
		issues,
		bindingStacksByName: new Map<string, ConstLocalBinding[]>(),
		scopeStack: [],
	};
}

export function enterConstLocalScope(context: ConstLocalContext): void {
	context.scopeStack.push({ names: [] });
}

export function declareConstLocalBinding(
	context: ConstLocalContext,
	declaration: LuaIdentifierExpression,
	shouldReport: boolean,
): void {
	const scope = context.scopeStack[context.scopeStack.length - 1];
	scope.names.push(declaration.name);
	let stack = context.bindingStacksByName.get(declaration.name);
	if (!stack) {
		stack = [];
		context.bindingStacksByName.set(declaration.name, stack);
	}
	stack.push({
		declaration,
		shouldReport,
		writeCountAfterDeclaration: 0,
	});
}

export function markConstLocalWriteByName(context: ConstLocalContext, name: string): void {
	const stack = context.bindingStacksByName.get(name);
	if (!stack || stack.length === 0) {
		return;
	}
	const binding = stack[stack.length - 1];
	if (!binding.shouldReport) {
		return;
	}
	binding.writeCountAfterDeclaration += 1;
}

export function markConstLocalWrite(context: ConstLocalContext, identifier: LuaIdentifierExpression): void {
	markConstLocalWriteByName(context, identifier.name);
}

export function lintConstLocalInExpression(expression: LuaExpression | null, context: ConstLocalContext): void {
	if (!expression) {
		return;
	}
	switch (expression.kind) {
		case LuaSyntaxKind.MemberExpression:
			lintConstLocalInExpression(expression.base, context);
			return;
		case LuaSyntaxKind.IndexExpression:
			lintConstLocalInExpression(expression.base, context);
			lintConstLocalInExpression(expression.index, context);
			return;
		case LuaSyntaxKind.BinaryExpression:
			lintConstLocalInExpression(expression.left, context);
			lintConstLocalInExpression(expression.right, context);
			return;
		case LuaSyntaxKind.UnaryExpression:
			lintConstLocalInExpression(expression.operand, context);
			return;
		case LuaSyntaxKind.CallExpression:
			lintConstLocalInExpression(expression.callee, context);
			for (const argument of expression.arguments) {
				lintConstLocalInExpression(argument, context);
			}
			return;
		case LuaSyntaxKind.TableConstructorExpression:
			for (const field of expression.fields) {
				if (field.kind === LuaTableFieldKind.ExpressionKey) {
					lintConstLocalInExpression(field.key, context);
				}
				lintConstLocalInExpression(field.value, context);
			}
			return;
		case LuaSyntaxKind.FunctionExpression:
			enterConstLocalScope(context);
			for (const parameter of expression.parameters) {
				declareConstLocalBinding(context, parameter, false);
			}
			lintConstLocalInStatements(expression.body.body, context);
			leaveConstLocalScope(context);
			return;
		default:
			return;
	}
}

export function lintConstLocalInAssignmentTarget(target: LuaExpression | null, context: ConstLocalContext): void {
	if (!target) {
		return;
	}
	if (target.kind === LuaSyntaxKind.IdentifierExpression) {
		markConstLocalWrite(context, target);
		return;
	}
	if (target.kind === LuaSyntaxKind.MemberExpression) {
		lintConstLocalInExpression(target.base, context);
		return;
	}
	if (target.kind === LuaSyntaxKind.IndexExpression) {
		lintConstLocalInExpression(target.base, context);
		lintConstLocalInExpression(target.index, context);
	}
}

export function lintConstLocalInStatements(statements: ReadonlyArray<LuaStatement>, context: ConstLocalContext): void {
	for (const statement of statements) {
		switch (statement.kind) {
			case LuaSyntaxKind.LocalAssignmentStatement: {
				const hasInitializer = statement.values.length > 0;
				for (const value of statement.values) {
					lintConstLocalInExpression(value, context);
				}
				for (let index = 0; index < statement.names.length; index += 1) {
					declareConstLocalBinding(
						context,
						statement.names[index],
						hasInitializer && statement.attributes[index] !== 'const',
					);
				}
				break;
			}
			case LuaSyntaxKind.LocalFunctionStatement: {
				const localFunction = statement as LuaLocalFunctionStatement;
				declareConstLocalBinding(context, localFunction.name, false);
				enterConstLocalScope(context);
				for (const parameter of localFunction.functionExpression.parameters) {
					declareConstLocalBinding(context, parameter, false);
				}
				lintConstLocalInStatements(localFunction.functionExpression.body.body, context);
				leaveConstLocalScope(context);
				break;
			}
			case LuaSyntaxKind.FunctionDeclarationStatement: {
				const declaration = statement as LuaFunctionDeclarationStatement;
				if (declaration.name.identifiers.length === 1 && declaration.name.methodName === null) {
					markConstLocalWriteByName(context, declaration.name.identifiers[0]);
				}
				enterConstLocalScope(context);
				for (const parameter of declaration.functionExpression.parameters) {
					declareConstLocalBinding(context, parameter, false);
				}
				lintConstLocalInStatements(declaration.functionExpression.body.body, context);
				leaveConstLocalScope(context);
				break;
			}
			case LuaSyntaxKind.AssignmentStatement:
				for (const right of statement.right) {
					lintConstLocalInExpression(right, context);
				}
				for (const left of statement.left) {
					lintConstLocalInAssignmentTarget(left, context);
				}
				break;
			case LuaSyntaxKind.ReturnStatement:
				for (const expression of statement.expressions) {
					lintConstLocalInExpression(expression, context);
				}
				break;
			case LuaSyntaxKind.IfStatement:
				for (const clause of statement.clauses) {
					if (clause.condition) {
						lintConstLocalInExpression(clause.condition, context);
					}
					enterConstLocalScope(context);
					lintConstLocalInStatements(clause.block.body, context);
					leaveConstLocalScope(context);
				}
				break;
			case LuaSyntaxKind.WhileStatement:
				lintConstLocalInExpression(statement.condition, context);
				enterConstLocalScope(context);
				lintConstLocalInStatements(statement.block.body, context);
				leaveConstLocalScope(context);
				break;
			case LuaSyntaxKind.RepeatStatement:
				enterConstLocalScope(context);
				lintConstLocalInStatements(statement.block.body, context);
				leaveConstLocalScope(context);
				lintConstLocalInExpression(statement.condition, context);
				break;
			case LuaSyntaxKind.ForNumericStatement:
				lintConstLocalInExpression(statement.start, context);
				lintConstLocalInExpression(statement.limit, context);
				lintConstLocalInExpression(statement.step, context);
				enterConstLocalScope(context);
				declareConstLocalBinding(context, statement.variable, false);
				lintConstLocalInStatements(statement.block.body, context);
				leaveConstLocalScope(context);
				break;
			case LuaSyntaxKind.ForGenericStatement:
				for (const iterator of statement.iterators) {
					lintConstLocalInExpression(iterator, context);
				}
				enterConstLocalScope(context);
				for (const variable of statement.variables) {
					declareConstLocalBinding(context, variable, false);
				}
				lintConstLocalInStatements(statement.block.body, context);
				leaveConstLocalScope(context);
				break;
			case LuaSyntaxKind.DoStatement:
				enterConstLocalScope(context);
				lintConstLocalInStatements(statement.block.body, context);
				leaveConstLocalScope(context);
				break;
			case LuaSyntaxKind.CallStatement:
				lintConstLocalInExpression(statement.expression, context);
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

export function lintConstLocalPattern(statements: ReadonlyArray<LuaStatement>, issues: LuaLintIssue[]): void {
	const context = createConstLocalContext(issues);
	enterConstLocalScope(context);
	try {
		lintConstLocalInStatements(statements, context);
	} finally {
		leaveConstLocalScope(context);
	}
}
