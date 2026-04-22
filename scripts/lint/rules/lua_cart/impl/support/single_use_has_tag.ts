import { type LuaExpression, type LuaFunctionDeclarationStatement, type LuaIdentifierExpression, type LuaLocalFunctionStatement, type LuaStatement, LuaSyntaxKind, LuaTableFieldKind } from '../../../../../../src/bmsx/lua/syntax/ast';
import { type LuaLintIssue } from '../../../../lua_rule';
import { leaveSingleUseHasTagScope } from '../../single_use_has_tag_pattern';
import { declareLuaBinding, enterLuaBindingScope } from './bindings';
import { isSelfHasTagCall } from './tags';
import { SingleUseHasTagBinding, SingleUseHasTagContext } from './types';

export function createSingleUseHasTagContext(issues: LuaLintIssue[]): SingleUseHasTagContext {
	return {
		issues,
		bindingStacksByName: new Map<string, SingleUseHasTagBinding[]>(),
		scopeStack: [],
	};
}

export function enterSingleUseHasTagScope(context: SingleUseHasTagContext): void {
	enterLuaBindingScope(context);
}

export function declareSingleUseHasTagBinding(
	context: SingleUseHasTagContext,
	declaration: LuaIdentifierExpression,
): void {
	declareLuaBinding(context, declaration, {
		declaration,
		pendingReadCount: 0,
	});
}

export function markSingleUseHasTagRead(context: SingleUseHasTagContext, identifier: LuaIdentifierExpression): void {
	const stack = context.bindingStacksByName.get(identifier.name);
	if (!stack || stack.length === 0) {
		return;
	}
	stack[stack.length - 1].pendingReadCount += 1;
}

export function lintSingleUseHasTagInExpression(expression: LuaExpression, context: SingleUseHasTagContext): void {
	if (!expression) {
		return;
	}
	switch (expression.kind) {
		case LuaSyntaxKind.IdentifierExpression:
			markSingleUseHasTagRead(context, expression);
			return;
		case LuaSyntaxKind.MemberExpression:
			lintSingleUseHasTagInExpression(expression.base, context);
			return;
		case LuaSyntaxKind.IndexExpression:
			lintSingleUseHasTagInExpression(expression.base, context);
			lintSingleUseHasTagInExpression(expression.index, context);
			return;
		case LuaSyntaxKind.BinaryExpression:
			lintSingleUseHasTagInExpression(expression.left, context);
			lintSingleUseHasTagInExpression(expression.right, context);
			return;
		case LuaSyntaxKind.UnaryExpression:
			lintSingleUseHasTagInExpression(expression.operand, context);
			return;
		case LuaSyntaxKind.CallExpression:
			lintSingleUseHasTagInExpression(expression.callee, context);
			for (const argument of expression.arguments) {
				lintSingleUseHasTagInExpression(argument, context);
			}
			return;
		case LuaSyntaxKind.TableConstructorExpression:
			for (const field of expression.fields) {
				if (field.kind === LuaTableFieldKind.ExpressionKey) {
					lintSingleUseHasTagInExpression(field.key, context);
				}
				lintSingleUseHasTagInExpression(field.value, context);
			}
			return;
		case LuaSyntaxKind.FunctionExpression: {
			enterSingleUseHasTagScope(context);
			lintSingleUseHasTagInStatements(expression.body.body, context);
			leaveSingleUseHasTagScope(context);
			return;
		}
		default:
			return;
	}
}

export function lintSingleUseHasTagInStatements(statements: ReadonlyArray<LuaStatement>, context: SingleUseHasTagContext): void {
	for (const statement of statements) {
		switch (statement.kind) {
			case LuaSyntaxKind.LocalAssignmentStatement:
				for (let index = 0; index < Math.min(statement.names.length, statement.values.length); index += 1) {
					const name = statement.names[index];
					const value = statement.values[index];
					if (isSelfHasTagCall(value)) {
						declareSingleUseHasTagBinding(context, name);
					}
					lintSingleUseHasTagInExpression(value, context);
				}
				break;
			case LuaSyntaxKind.AssignmentStatement:
				for (const right of statement.right) {
					lintSingleUseHasTagInExpression(right, context);
				}
				break;
			case LuaSyntaxKind.LocalFunctionStatement: {
				const localFunction = statement as LuaLocalFunctionStatement;
				enterSingleUseHasTagScope(context);
				try {
					lintSingleUseHasTagInStatements(localFunction.functionExpression.body.body, context);
				} finally {
					leaveSingleUseHasTagScope(context);
				}
				break;
			}
			case LuaSyntaxKind.FunctionDeclarationStatement: {
				const declaration = statement as LuaFunctionDeclarationStatement;
				enterSingleUseHasTagScope(context);
				try {
					lintSingleUseHasTagInStatements(declaration.functionExpression.body.body, context);
				} finally {
					leaveSingleUseHasTagScope(context);
				}
				break;
			}
			case LuaSyntaxKind.ReturnStatement:
				for (const expression of statement.expressions) {
					lintSingleUseHasTagInExpression(expression, context);
				}
				break;
			case LuaSyntaxKind.IfStatement:
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
			case LuaSyntaxKind.WhileStatement:
				lintSingleUseHasTagInExpression(statement.condition, context);
				enterSingleUseHasTagScope(context);
				try {
					lintSingleUseHasTagInStatements(statement.block.body, context);
				} finally {
					leaveSingleUseHasTagScope(context);
				}
				break;
			case LuaSyntaxKind.RepeatStatement:
				enterSingleUseHasTagScope(context);
				try {
					lintSingleUseHasTagInStatements(statement.block.body, context);
				} finally {
					leaveSingleUseHasTagScope(context);
				}
				lintSingleUseHasTagInExpression(statement.condition, context);
				break;
			case LuaSyntaxKind.ForNumericStatement:
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
			case LuaSyntaxKind.ForGenericStatement:
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
			case LuaSyntaxKind.DoStatement:
				enterSingleUseHasTagScope(context);
				try {
					lintSingleUseHasTagInStatements(statement.block.body, context);
				} finally {
					leaveSingleUseHasTagScope(context);
				}
				break;
			case LuaSyntaxKind.CallStatement:
				lintSingleUseHasTagInExpression(statement.expression, context);
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

export function lintSingleUseHasTagPattern(statements: ReadonlyArray<LuaStatement>, issues: LuaLintIssue[]): void {
	const context = createSingleUseHasTagContext(issues);
	enterSingleUseHasTagScope(context);
	try {
		lintSingleUseHasTagInStatements(statements, context);
	} finally {
		leaveSingleUseHasTagScope(context);
	}
}
