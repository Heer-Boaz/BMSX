import { defineLintRule } from '../../rule';
import { LuaAssignmentOperator as AssignmentOperator, type LuaStatement as Statement, LuaSyntaxKind as SyntaxKind } from '../../../../src/bmsx/lua/syntax/ast';
import { getAssignmentTargetInfo, lintNullBindingFunctionScope, lintScopedBindingStatements } from './impl/support/bindings';
import { declareForeignObjectBinding, enterForeignObjectMutationScope, isForeignObjectAliasInitializer, leaveForeignObjectMutationScope, lintForeignObjectMutationInExpression, resolveForeignObjectBinding, setForeignObjectBinding } from './impl/support/foreign_object';
import { ForeignObjectMutationContext } from './impl/support/types';
import { pushIssue } from './impl/support/lint_context';

export const foreignObjectInternalMutationPatternRule = defineLintRule('cart', 'foreign_object_internal_mutation_pattern');

export function lintForeignObjectMutationInStatements(
	statements: ReadonlyArray<Statement>,
	context: ForeignObjectMutationContext,
): void {
	for (const statement of statements) {
		switch (statement.kind) {
			case SyntaxKind.LocalAssignmentStatement:
				for (const value of statement.values) {
					lintForeignObjectMutationInExpression(value, context);
				}
				for (let index = 0; index < statement.names.length; index += 1) {
					const declaration = statement.names[index];
					const value = index < statement.values.length ? statement.values[index] : undefined;
					const binding = value && isForeignObjectAliasInitializer(value)
						? { declaration }
						: null;
					declareForeignObjectBinding(context, declaration, binding);
				}
				break;
			case SyntaxKind.AssignmentStatement: {
				for (const left of statement.left) {
					const targetInfo = getAssignmentTargetInfo(left);
					if (!targetInfo || targetInfo.depth < 1) {
						lintForeignObjectMutationInExpression(left, context);
						continue;
					}
					const binding = resolveForeignObjectBinding(context, targetInfo.rootName);
					if (!binding) {
						continue;
					}
					if (targetInfo.depth !== 1) {
						continue;
					}
					const propertyName = targetInfo.terminalPropertyName;
					if (!propertyName) {
						continue;
					}
					pushIssue(
						context.issues,
						foreignObjectInternalMutationPatternRule.name,
						left,
						`Direct top-level mutation on service alias ${targetInfo.rootName}.${propertyName} is forbidden. Keep ownership in the target service implementation and call domain methods/events; do not add getter/setter wrappers as a workaround.`,
					);
				}
				for (const right of statement.right) {
					lintForeignObjectMutationInExpression(right, context);
				}
				if (statement.operator === AssignmentOperator.Assign) {
					const pairCount = Math.min(statement.left.length, statement.right.length);
					for (let index = 0; index < pairCount; index += 1) {
						const left = statement.left[index];
						if (left.kind !== SyntaxKind.IdentifierExpression) {
							continue;
						}
						const right = statement.right[index];
						const binding = isForeignObjectAliasInitializer(right)
							? { declaration: left }
							: null;
						setForeignObjectBinding(context, left.name, binding);
					}
				}
				break;
			}
			case SyntaxKind.LocalFunctionStatement:
				declareForeignObjectBinding(context, statement.name, null);
				lintNullBindingFunctionScope(context, statement.functionExpression, lintForeignObjectMutationInStatements);
				break;
			case SyntaxKind.FunctionDeclarationStatement:
				lintNullBindingFunctionScope(context, statement.functionExpression, lintForeignObjectMutationInStatements);
				break;
			case SyntaxKind.ReturnStatement:
				for (const expression of statement.expressions) {
					lintForeignObjectMutationInExpression(expression, context);
				}
				break;
			case SyntaxKind.IfStatement:
				for (const clause of statement.clauses) {
					if (clause.condition) {
						lintForeignObjectMutationInExpression(clause.condition, context);
					}
					lintScopedBindingStatements(context, clause.block.body, lintForeignObjectMutationInStatements);
				}
				break;
			case SyntaxKind.WhileStatement:
				lintForeignObjectMutationInExpression(statement.condition, context);
				lintScopedBindingStatements(context, statement.block.body, lintForeignObjectMutationInStatements);
				break;
			case SyntaxKind.RepeatStatement:
				enterForeignObjectMutationScope(context);
				lintForeignObjectMutationInStatements(statement.block.body, context);
				lintForeignObjectMutationInExpression(statement.condition, context);
				leaveForeignObjectMutationScope(context);
				break;
			case SyntaxKind.ForNumericStatement:
				lintForeignObjectMutationInExpression(statement.start, context);
				lintForeignObjectMutationInExpression(statement.limit, context);
				lintForeignObjectMutationInExpression(statement.step, context);
				enterForeignObjectMutationScope(context);
				declareForeignObjectBinding(context, statement.variable, null);
				lintForeignObjectMutationInStatements(statement.block.body, context);
				leaveForeignObjectMutationScope(context);
				break;
			case SyntaxKind.ForGenericStatement:
				for (const iterator of statement.iterators) {
					lintForeignObjectMutationInExpression(iterator, context);
				}
				enterForeignObjectMutationScope(context);
				for (const variable of statement.variables) {
					declareForeignObjectBinding(context, variable, null);
				}
				lintForeignObjectMutationInStatements(statement.block.body, context);
				leaveForeignObjectMutationScope(context);
				break;
			case SyntaxKind.DoStatement:
				lintScopedBindingStatements(context, statement.block.body, lintForeignObjectMutationInStatements);
				break;
			case SyntaxKind.CallStatement:
				lintForeignObjectMutationInExpression(statement.expression, context);
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
