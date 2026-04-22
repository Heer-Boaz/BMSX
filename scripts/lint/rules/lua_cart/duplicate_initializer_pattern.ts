import { defineLintRule } from '../../rule';
import { type LuaFunctionExpression, type LuaStatement, LuaSyntaxKind } from '../../../../src/bmsx/lua/syntax/ast';
import { lintScopedBindingStatements } from './impl/support/bindings';
import { declareDuplicateInitializerBinding, enterDuplicateInitializerScope, leaveDuplicateInitializerScope, lintDuplicateInitializerInExpression, resolveDuplicateInitializerBinding } from './impl/support/duplicate_initializers';
import { getExpressionSignature } from './impl/support/expression_signatures';
import { DuplicateInitializerContext } from './impl/support/types';
import { pushIssue } from './impl/support/lint_context';

export const duplicateInitializerPatternRule = defineLintRule('lua_cart', 'duplicate_initializer_pattern');

export function lintDuplicateInitializerInStatements(
	statements: ReadonlyArray<LuaStatement>,
	context: DuplicateInitializerContext,
): void {
	for (const statement of statements) {
		switch (statement.kind) {
			case LuaSyntaxKind.LocalAssignmentStatement: {
				for (const value of statement.values) {
					lintDuplicateInitializerInExpression(value, context);
				}
				const isTopLevelScope = context.scopeStack.length === 1;
				for (let index = 0; index < statement.names.length; index += 1) {
					const hasInitializer = index < statement.values.length;
					const initializerSignature = isTopLevelScope && hasInitializer
						? getExpressionSignature(statement.values[index])
						: '';
					declareDuplicateInitializerBinding(context, statement.names[index], initializerSignature);
				}
				break;
			}
			case LuaSyntaxKind.AssignmentStatement: {
				for (const left of statement.left) {
					lintDuplicateInitializerInExpression(left, context);
				}
				for (const right of statement.right) {
					lintDuplicateInitializerInExpression(right, context);
				}
				const pairCount = Math.min(statement.left.length, statement.right.length);
				for (let index = 0; index < pairCount; index += 1) {
					const left = statement.left[index];
					if (left.kind !== LuaSyntaxKind.IdentifierExpression) {
						continue;
					}
					const binding = resolveDuplicateInitializerBinding(context, left.name);
					if (!binding || binding.initializerSignature.length === 0) {
						continue;
					}
					const assignmentSignature = getExpressionSignature(statement.right[index]);
					if (assignmentSignature.length === 0 || assignmentSignature !== binding.initializerSignature) {
						continue;
					}
					pushIssue(
						context.issues,
						duplicateInitializerPatternRule.name,
						left,
						`Duplicate initializer pattern is forbidden ("${left.name}"). Do not initialize and later reassign the same value expression; keep one deterministic initialization point.`,
					);
				}
				break;
			}
			case LuaSyntaxKind.LocalFunctionStatement:
				declareDuplicateInitializerBinding(context, statement.name, '');
				lintDuplicateInitializerFunctionExpression(statement.functionExpression, context);
				break;
			case LuaSyntaxKind.FunctionDeclarationStatement:
				lintDuplicateInitializerFunctionExpression(statement.functionExpression, context);
				break;
			case LuaSyntaxKind.ReturnStatement:
				for (const expression of statement.expressions) {
					lintDuplicateInitializerInExpression(expression, context);
				}
				break;
			case LuaSyntaxKind.IfStatement:
				for (const clause of statement.clauses) {
					if (clause.condition) {
						lintDuplicateInitializerInExpression(clause.condition, context);
					}
					lintScopedBindingStatements(context, clause.block.body, lintDuplicateInitializerInStatements);
				}
				break;
			case LuaSyntaxKind.WhileStatement:
				lintDuplicateInitializerInExpression(statement.condition, context);
				lintScopedBindingStatements(context, statement.block.body, lintDuplicateInitializerInStatements);
				break;
			case LuaSyntaxKind.RepeatStatement:
				enterDuplicateInitializerScope(context);
				lintDuplicateInitializerInStatements(statement.block.body, context);
				lintDuplicateInitializerInExpression(statement.condition, context);
				leaveDuplicateInitializerScope(context);
				break;
			case LuaSyntaxKind.ForNumericStatement:
				lintDuplicateInitializerInExpression(statement.start, context);
				lintDuplicateInitializerInExpression(statement.limit, context);
				lintDuplicateInitializerInExpression(statement.step, context);
				enterDuplicateInitializerScope(context);
				declareDuplicateInitializerBinding(context, statement.variable, '');
				lintDuplicateInitializerInStatements(statement.block.body, context);
				leaveDuplicateInitializerScope(context);
				break;
			case LuaSyntaxKind.ForGenericStatement:
				for (const iterator of statement.iterators) {
					lintDuplicateInitializerInExpression(iterator, context);
				}
				enterDuplicateInitializerScope(context);
				for (const variable of statement.variables) {
					declareDuplicateInitializerBinding(context, variable, '');
				}
				lintDuplicateInitializerInStatements(statement.block.body, context);
				leaveDuplicateInitializerScope(context);
				break;
			case LuaSyntaxKind.DoStatement:
				lintScopedBindingStatements(context, statement.block.body, lintDuplicateInitializerInStatements);
				break;
			case LuaSyntaxKind.CallStatement:
				lintDuplicateInitializerInExpression(statement.expression, context);
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

function lintDuplicateInitializerFunctionExpression(functionExpression: LuaFunctionExpression, context: DuplicateInitializerContext): void {
	enterDuplicateInitializerScope(context);
	for (const parameter of functionExpression.parameters) {
		declareDuplicateInitializerBinding(context, parameter, '');
	}
	lintDuplicateInitializerInStatements(functionExpression.body.body, context);
	leaveDuplicateInitializerScope(context);
}
