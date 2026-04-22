import { type LuaExpression as Expression, type LuaFunctionDeclarationStatement as FunctionDeclarationStatement, type LuaIdentifierExpression as IdentifierExpression, type LuaLocalFunctionStatement as LocalFunctionStatement, type LuaStatement as Statement, LuaSyntaxKind as SyntaxKind, LuaTableFieldKind as TableFieldKind } from '../../../../../../src/bmsx/lua/syntax/ast';
import { type CartLintIssue } from '../../../../lua_rule';
import { leaveConstLocalScope } from '../../../common/local_const_pattern';
import { declareBinding, enterBindingScope } from './bindings';
import { ConstLocalBinding, ConstLocalContext } from './types';

export function createConstLocalContext(issues: CartLintIssue[]): ConstLocalContext {
	return {
		issues,
		bindingStacksByName: new Map<string, ConstLocalBinding[]>(),
		scopeStack: [],
	};
}

export function enterConstLocalScope(context: ConstLocalContext): void {
	enterBindingScope(context);
}

export function declareConstLocalBinding(
	context: ConstLocalContext,
	declaration: IdentifierExpression,
	shouldReport: boolean,
): void {
	declareBinding(context, declaration, {
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

export function markConstLocalWrite(context: ConstLocalContext, identifier: IdentifierExpression): void {
	markConstLocalWriteByName(context, identifier.name);
}

export function lintConstLocalInExpression(expression: Expression | null, context: ConstLocalContext): void {
	if (!expression) {
		return;
	}
	switch (expression.kind) {
		case SyntaxKind.MemberExpression:
			lintConstLocalInExpression(expression.base, context);
			return;
		case SyntaxKind.IndexExpression:
			lintConstLocalInExpression(expression.base, context);
			lintConstLocalInExpression(expression.index, context);
			return;
		case SyntaxKind.BinaryExpression:
			lintConstLocalInExpression(expression.left, context);
			lintConstLocalInExpression(expression.right, context);
			return;
		case SyntaxKind.UnaryExpression:
			lintConstLocalInExpression(expression.operand, context);
			return;
		case SyntaxKind.CallExpression:
			lintConstLocalInExpression(expression.callee, context);
			for (const argument of expression.arguments) {
				lintConstLocalInExpression(argument, context);
			}
			return;
		case SyntaxKind.TableConstructorExpression:
			for (const field of expression.fields) {
				if (field.kind === TableFieldKind.ExpressionKey) {
					lintConstLocalInExpression(field.key, context);
				}
				lintConstLocalInExpression(field.value, context);
			}
			return;
		case SyntaxKind.FunctionExpression:
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

export function lintConstLocalInAssignmentTarget(target: Expression | null, context: ConstLocalContext): void {
	if (!target) {
		return;
	}
	if (target.kind === SyntaxKind.IdentifierExpression) {
		markConstLocalWrite(context, target);
		return;
	}
	if (target.kind === SyntaxKind.MemberExpression) {
		lintConstLocalInExpression(target.base, context);
		return;
	}
	if (target.kind === SyntaxKind.IndexExpression) {
		lintConstLocalInExpression(target.base, context);
		lintConstLocalInExpression(target.index, context);
	}
}

export function lintConstLocalInStatements(statements: ReadonlyArray<Statement>, context: ConstLocalContext): void {
	for (const statement of statements) {
		switch (statement.kind) {
			case SyntaxKind.LocalAssignmentStatement: {
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
			case SyntaxKind.LocalFunctionStatement: {
				const localFunction = statement as LocalFunctionStatement;
				declareConstLocalBinding(context, localFunction.name, false);
				enterConstLocalScope(context);
				for (const parameter of localFunction.functionExpression.parameters) {
					declareConstLocalBinding(context, parameter, false);
				}
				lintConstLocalInStatements(localFunction.functionExpression.body.body, context);
				leaveConstLocalScope(context);
				break;
			}
			case SyntaxKind.FunctionDeclarationStatement: {
				const declaration = statement as FunctionDeclarationStatement;
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
			case SyntaxKind.AssignmentStatement:
				for (const right of statement.right) {
					lintConstLocalInExpression(right, context);
				}
				for (const left of statement.left) {
					lintConstLocalInAssignmentTarget(left, context);
				}
				break;
			case SyntaxKind.ReturnStatement:
				for (const expression of statement.expressions) {
					lintConstLocalInExpression(expression, context);
				}
				break;
			case SyntaxKind.IfStatement:
				for (const clause of statement.clauses) {
					if (clause.condition) {
						lintConstLocalInExpression(clause.condition, context);
					}
					enterConstLocalScope(context);
					lintConstLocalInStatements(clause.block.body, context);
					leaveConstLocalScope(context);
				}
				break;
			case SyntaxKind.WhileStatement:
				lintConstLocalInExpression(statement.condition, context);
				enterConstLocalScope(context);
				lintConstLocalInStatements(statement.block.body, context);
				leaveConstLocalScope(context);
				break;
			case SyntaxKind.RepeatStatement:
				enterConstLocalScope(context);
				lintConstLocalInStatements(statement.block.body, context);
				leaveConstLocalScope(context);
				lintConstLocalInExpression(statement.condition, context);
				break;
			case SyntaxKind.ForNumericStatement:
				lintConstLocalInExpression(statement.start, context);
				lintConstLocalInExpression(statement.limit, context);
				lintConstLocalInExpression(statement.step, context);
				enterConstLocalScope(context);
				declareConstLocalBinding(context, statement.variable, false);
				lintConstLocalInStatements(statement.block.body, context);
				leaveConstLocalScope(context);
				break;
			case SyntaxKind.ForGenericStatement:
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
			case SyntaxKind.DoStatement:
				enterConstLocalScope(context);
				lintConstLocalInStatements(statement.block.body, context);
				leaveConstLocalScope(context);
				break;
			case SyntaxKind.CallStatement:
				lintConstLocalInExpression(statement.expression, context);
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

export function lintConstLocalPattern(statements: ReadonlyArray<Statement>, issues: CartLintIssue[]): void {
	const context = createConstLocalContext(issues);
	enterConstLocalScope(context);
	try {
		lintConstLocalInStatements(statements, context);
	} finally {
		leaveConstLocalScope(context);
	}
}
