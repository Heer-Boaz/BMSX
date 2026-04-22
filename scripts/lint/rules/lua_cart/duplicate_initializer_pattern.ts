import { defineLintRule } from '../../rule';
import { type LuaFunctionExpression as CartFunctionExpression, type LuaStatement as Statement, LuaSyntaxKind as SyntaxKind } from '../../../../src/bmsx/lua/syntax/ast';
import { lintScopedBindingStatements } from './impl/support/bindings';
import { declareDuplicateInitializerBinding, enterDuplicateInitializerScope, leaveDuplicateInitializerScope, lintDuplicateInitializerInExpression, resolveDuplicateInitializerBinding } from './impl/support/duplicate_initializers';
import { getExpressionSignature } from './impl/support/expression_signatures';
import { DuplicateInitializerContext } from './impl/support/types';
import { pushIssue } from './impl/support/lint_context';

export const duplicateInitializerPatternRule = defineLintRule('cart', 'duplicate_initializer_pattern');

export function lintDuplicateInitializerInStatements(
	statements: ReadonlyArray<Statement>,
	context: DuplicateInitializerContext,
): void {
	for (const statement of statements) {
		switch (statement.kind) {
			case SyntaxKind.LocalAssignmentStatement: {
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
			case SyntaxKind.AssignmentStatement: {
				for (const left of statement.left) {
					lintDuplicateInitializerInExpression(left, context);
				}
				for (const right of statement.right) {
					lintDuplicateInitializerInExpression(right, context);
				}
				const pairCount = Math.min(statement.left.length, statement.right.length);
				for (let index = 0; index < pairCount; index += 1) {
					const left = statement.left[index];
					if (left.kind !== SyntaxKind.IdentifierExpression) {
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
			case SyntaxKind.LocalFunctionStatement:
				declareDuplicateInitializerBinding(context, statement.name, '');
				lintDuplicateInitializerFunctionExpression(statement.functionExpression, context);
				break;
			case SyntaxKind.FunctionDeclarationStatement:
				lintDuplicateInitializerFunctionExpression(statement.functionExpression, context);
				break;
			case SyntaxKind.ReturnStatement:
				for (const expression of statement.expressions) {
					lintDuplicateInitializerInExpression(expression, context);
				}
				break;
			case SyntaxKind.IfStatement:
				for (const clause of statement.clauses) {
					if (clause.condition) {
						lintDuplicateInitializerInExpression(clause.condition, context);
					}
					lintScopedBindingStatements(context, clause.block.body, lintDuplicateInitializerInStatements);
				}
				break;
			case SyntaxKind.WhileStatement:
				lintDuplicateInitializerInExpression(statement.condition, context);
				lintScopedBindingStatements(context, statement.block.body, lintDuplicateInitializerInStatements);
				break;
			case SyntaxKind.RepeatStatement:
				enterDuplicateInitializerScope(context);
				lintDuplicateInitializerInStatements(statement.block.body, context);
				lintDuplicateInitializerInExpression(statement.condition, context);
				leaveDuplicateInitializerScope(context);
				break;
			case SyntaxKind.ForNumericStatement:
				lintDuplicateInitializerInExpression(statement.start, context);
				lintDuplicateInitializerInExpression(statement.limit, context);
				lintDuplicateInitializerInExpression(statement.step, context);
				enterDuplicateInitializerScope(context);
				declareDuplicateInitializerBinding(context, statement.variable, '');
				lintDuplicateInitializerInStatements(statement.block.body, context);
				leaveDuplicateInitializerScope(context);
				break;
			case SyntaxKind.ForGenericStatement:
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
			case SyntaxKind.DoStatement:
				lintScopedBindingStatements(context, statement.block.body, lintDuplicateInitializerInStatements);
				break;
			case SyntaxKind.CallStatement:
				lintDuplicateInitializerInExpression(statement.expression, context);
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

function lintDuplicateInitializerFunctionExpression(functionExpression: CartFunctionExpression, context: DuplicateInitializerContext): void {
	enterDuplicateInitializerScope(context);
	for (const parameter of functionExpression.parameters) {
		declareDuplicateInitializerBinding(context, parameter, '');
	}
	lintDuplicateInitializerInStatements(functionExpression.body.body, context);
	leaveDuplicateInitializerScope(context);
}
