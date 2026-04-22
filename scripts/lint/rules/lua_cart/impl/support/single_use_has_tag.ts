import { type LuaExpression as Expression, type LuaFunctionDeclarationStatement as FunctionDeclarationStatement, type LuaIdentifierExpression as IdentifierExpression, type LuaLocalFunctionStatement as LocalFunctionStatement, type LuaStatement as Statement, LuaSyntaxKind as SyntaxKind, LuaTableFieldKind as TableFieldKind } from '../../../../../../src/bmsx/lua/syntax/ast';
import { type CartLintIssue } from '../../../../lua_rule';
import { leaveSingleUseHasTagScope } from '../../single_use_has_tag_pattern';
import { declareBinding, enterBindingScope } from './bindings';
import { isSelfHasTagCall } from './tags';
import { SingleUseHasTagBinding, SingleUseHasTagContext } from './types';

export function createSingleUseHasTagContext(issues: CartLintIssue[]): SingleUseHasTagContext {
	return {
		issues,
		bindingStacksByName: new Map<string, SingleUseHasTagBinding[]>(),
		scopeStack: [],
	};
}

export function enterSingleUseHasTagScope(context: SingleUseHasTagContext): void {
	enterBindingScope(context);
}

export function declareSingleUseHasTagBinding(
	context: SingleUseHasTagContext,
	declaration: IdentifierExpression,
): void {
	declareBinding(context, declaration, {
		declaration,
		pendingReadCount: 0,
	});
}

export function markSingleUseHasTagRead(context: SingleUseHasTagContext, identifier: IdentifierExpression): void {
	const stack = context.bindingStacksByName.get(identifier.name);
	if (!stack || stack.length === 0) {
		return;
	}
	stack[stack.length - 1].pendingReadCount += 1;
}

export function lintSingleUseHasTagInExpression(expression: Expression, context: SingleUseHasTagContext): void {
	if (!expression) {
		return;
	}
	switch (expression.kind) {
		case SyntaxKind.IdentifierExpression:
			markSingleUseHasTagRead(context, expression);
			return;
		case SyntaxKind.MemberExpression:
			lintSingleUseHasTagInExpression(expression.base, context);
			return;
		case SyntaxKind.IndexExpression:
			lintSingleUseHasTagInExpression(expression.base, context);
			lintSingleUseHasTagInExpression(expression.index, context);
			return;
		case SyntaxKind.BinaryExpression:
			lintSingleUseHasTagInExpression(expression.left, context);
			lintSingleUseHasTagInExpression(expression.right, context);
			return;
		case SyntaxKind.UnaryExpression:
			lintSingleUseHasTagInExpression(expression.operand, context);
			return;
		case SyntaxKind.CallExpression:
			lintSingleUseHasTagInExpression(expression.callee, context);
			for (const argument of expression.arguments) {
				lintSingleUseHasTagInExpression(argument, context);
			}
			return;
		case SyntaxKind.TableConstructorExpression:
			for (const field of expression.fields) {
				if (field.kind === TableFieldKind.ExpressionKey) {
					lintSingleUseHasTagInExpression(field.key, context);
				}
				lintSingleUseHasTagInExpression(field.value, context);
			}
			return;
		case SyntaxKind.FunctionExpression: {
			enterSingleUseHasTagScope(context);
			lintSingleUseHasTagInStatements(expression.body.body, context);
			leaveSingleUseHasTagScope(context);
			return;
		}
		default:
			return;
	}
}

export function lintSingleUseHasTagInStatements(statements: ReadonlyArray<Statement>, context: SingleUseHasTagContext): void {
	for (const statement of statements) {
		switch (statement.kind) {
			case SyntaxKind.LocalAssignmentStatement:
				for (let index = 0; index < Math.min(statement.names.length, statement.values.length); index += 1) {
					const name = statement.names[index];
					const value = statement.values[index];
					if (isSelfHasTagCall(value)) {
						declareSingleUseHasTagBinding(context, name);
					}
					lintSingleUseHasTagInExpression(value, context);
				}
				break;
			case SyntaxKind.AssignmentStatement:
				for (const right of statement.right) {
					lintSingleUseHasTagInExpression(right, context);
				}
				break;
			case SyntaxKind.LocalFunctionStatement: {
				const localFunction = statement as LocalFunctionStatement;
				enterSingleUseHasTagScope(context);
				try {
					lintSingleUseHasTagInStatements(localFunction.functionExpression.body.body, context);
				} finally {
					leaveSingleUseHasTagScope(context);
				}
				break;
			}
			case SyntaxKind.FunctionDeclarationStatement: {
				const declaration = statement as FunctionDeclarationStatement;
				enterSingleUseHasTagScope(context);
				try {
					lintSingleUseHasTagInStatements(declaration.functionExpression.body.body, context);
				} finally {
					leaveSingleUseHasTagScope(context);
				}
				break;
			}
			case SyntaxKind.ReturnStatement:
				for (const expression of statement.expressions) {
					lintSingleUseHasTagInExpression(expression, context);
				}
				break;
			case SyntaxKind.IfStatement:
				for (const clause of statement.clauses) {
					if (clause.condition) {
						lintSingleUseHasTagInExpression(clause.condition, context);
					}
					enterSingleUseHasTagScope(context);
					try {
						lintSingleUseHasTagInStatements(clause.block.body, context);
					} finally {
						leaveSingleUseHasTagScope(context);
					}
				}
				break;
			case SyntaxKind.WhileStatement:
				lintSingleUseHasTagInExpression(statement.condition, context);
				enterSingleUseHasTagScope(context);
				try {
					lintSingleUseHasTagInStatements(statement.block.body, context);
				} finally {
					leaveSingleUseHasTagScope(context);
				}
				break;
			case SyntaxKind.RepeatStatement:
				enterSingleUseHasTagScope(context);
				try {
					lintSingleUseHasTagInStatements(statement.block.body, context);
				} finally {
					leaveSingleUseHasTagScope(context);
				}
				lintSingleUseHasTagInExpression(statement.condition, context);
				break;
			case SyntaxKind.ForNumericStatement:
				lintSingleUseHasTagInExpression(statement.start, context);
				lintSingleUseHasTagInExpression(statement.limit, context);
				lintSingleUseHasTagInExpression(statement.step, context);
				enterSingleUseHasTagScope(context);
				try {
					lintSingleUseHasTagInStatements(statement.block.body, context);
				} finally {
					leaveSingleUseHasTagScope(context);
				}
				break;
			case SyntaxKind.ForGenericStatement:
				for (const iterator of statement.iterators) {
					lintSingleUseHasTagInExpression(iterator, context);
				}
				enterSingleUseHasTagScope(context);
				try {
					lintSingleUseHasTagInStatements(statement.block.body, context);
				} finally {
					leaveSingleUseHasTagScope(context);
				}
				break;
			case SyntaxKind.DoStatement:
				enterSingleUseHasTagScope(context);
				try {
					lintSingleUseHasTagInStatements(statement.block.body, context);
				} finally {
					leaveSingleUseHasTagScope(context);
				}
				break;
			case SyntaxKind.CallStatement:
				lintSingleUseHasTagInExpression(statement.expression, context);
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

export function lintSingleUseHasTagPattern(statements: ReadonlyArray<Statement>, issues: CartLintIssue[]): void {
	const context = createSingleUseHasTagContext(issues);
	enterSingleUseHasTagScope(context);
	try {
		lintSingleUseHasTagInStatements(statements, context);
	} finally {
		leaveSingleUseHasTagScope(context);
	}
}
