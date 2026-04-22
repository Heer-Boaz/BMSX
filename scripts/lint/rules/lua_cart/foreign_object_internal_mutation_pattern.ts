import { defineLintRule } from '../../rule';
import { LuaAssignmentOperator, type LuaStatement, LuaSyntaxKind } from '../../../../src/bmsx/lua/syntax/ast';
import { getAssignmentTargetInfo, lintNullBindingFunctionScope, lintScopedBindingStatements } from './impl/support/bindings';
import { declareForeignObjectBinding, enterForeignObjectMutationScope, isForeignObjectAliasInitializer, leaveForeignObjectMutationScope, lintForeignObjectMutationInExpression, resolveForeignObjectBinding, setForeignObjectBinding } from './impl/support/foreign_object';
import { ForeignObjectMutationContext } from './impl/support/types';
import { pushIssue } from './impl/support/lint_context';

export const foreignObjectInternalMutationPatternRule = defineLintRule('lua_cart', 'foreign_object_internal_mutation_pattern');

export function lintForeignObjectMutationInStatements(
	statements: ReadonlyArray<LuaStatement>,
	context: ForeignObjectMutationContext,
): void {
	for (const statement of statements) {
		switch (statement.kind) {
			case LuaSyntaxKind.LocalAssignmentStatement:
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
			case LuaSyntaxKind.AssignmentStatement: {
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
				if (statement.operator === LuaAssignmentOperator.Assign) {
					const pairCount = Math.min(statement.left.length, statement.right.length);
					for (let index = 0; index < pairCount; index += 1) {
						const left = statement.left[index];
						if (left.kind !== LuaSyntaxKind.IdentifierExpression) {
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
			case LuaSyntaxKind.LocalFunctionStatement:
				declareForeignObjectBinding(context, statement.name, null);
				lintNullBindingFunctionScope(context, statement.functionExpression, lintForeignObjectMutationInStatements);
				break;
			case LuaSyntaxKind.FunctionDeclarationStatement:
				lintNullBindingFunctionScope(context, statement.functionExpression, lintForeignObjectMutationInStatements);
				break;
			case LuaSyntaxKind.ReturnStatement:
				for (const expression of statement.expressions) {
					lintForeignObjectMutationInExpression(expression, context);
				}
				break;
			case LuaSyntaxKind.IfStatement:
				for (const clause of statement.clauses) {
					if (clause.condition) {
						lintForeignObjectMutationInExpression(clause.condition, context);
					}
					lintScopedBindingStatements(context, clause.block.body, lintForeignObjectMutationInStatements);
				}
				break;
			case LuaSyntaxKind.WhileStatement:
				lintForeignObjectMutationInExpression(statement.condition, context);
				lintScopedBindingStatements(context, statement.block.body, lintForeignObjectMutationInStatements);
				break;
			case LuaSyntaxKind.RepeatStatement:
				enterForeignObjectMutationScope(context);
				lintForeignObjectMutationInStatements(statement.block.body, context);
				lintForeignObjectMutationInExpression(statement.condition, context);
				leaveForeignObjectMutationScope(context);
				break;
			case LuaSyntaxKind.ForNumericStatement:
				lintForeignObjectMutationInExpression(statement.start, context);
				lintForeignObjectMutationInExpression(statement.limit, context);
				lintForeignObjectMutationInExpression(statement.step, context);
				enterForeignObjectMutationScope(context);
				declareForeignObjectBinding(context, statement.variable, null);
				lintForeignObjectMutationInStatements(statement.block.body, context);
				leaveForeignObjectMutationScope(context);
				break;
			case LuaSyntaxKind.ForGenericStatement:
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
			case LuaSyntaxKind.DoStatement:
				lintScopedBindingStatements(context, statement.block.body, lintForeignObjectMutationInStatements);
				break;
			case LuaSyntaxKind.CallStatement:
				lintForeignObjectMutationInExpression(statement.expression, context);
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
