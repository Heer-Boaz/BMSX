import { defineLintRule } from '../../rule';
import { LuaAssignmentOperator, type LuaFunctionDeclarationStatement, type LuaLocalFunctionStatement, type LuaStatement, LuaSyntaxKind } from '../../../../src/bmsx/lua/syntax/ast';
import { declareConstantCopyBinding, enterConstantCopyScope, isForbiddenConstantCopyExpression, leaveConstantCopyScope, lintConstantCopyInAssignmentTarget, lintConstantCopyInExpression, setConstantCopyBindingByName } from './impl/support/constant_copy';
import { isConstantSourceExpression } from './impl/support/expressions';
import { ConstantCopyContext } from './impl/support/types';
import { pushIssue } from './impl/support/lint_context';

export const constantCopyPatternRule = defineLintRule('lua_cart', 'constant_copy_pattern');

export function lintConstantCopyInStatements(statements: ReadonlyArray<LuaStatement>, context: ConstantCopyContext): void {
	for (const statement of statements) {
		switch (statement.kind) {
			case LuaSyntaxKind.LocalAssignmentStatement: {
				const valueCount = Math.min(statement.names.length, statement.values.length);
				const isConstantSourceByValue: boolean[] = [];
				const isForbiddenCopyByValue: boolean[] = [];
				for (let index = 0; index < valueCount; index += 1) {
					const value = statement.values[index];
					lintConstantCopyInExpression(value, context);
					isConstantSourceByValue[index] = isConstantSourceExpression(value, context);
					isForbiddenCopyByValue[index] = isForbiddenConstantCopyExpression(value, context);
				}
				for (let index = 0; index < statement.names.length; index += 1) {
					if (index < valueCount && isForbiddenCopyByValue[index]) {
						pushIssue(
							context.issues,
							constantCopyPatternRule.name,
							statement.values[index],
							`Local copies of constants are forbidden ("${statement.names[index].name}").`,
						);
					}
					declareConstantCopyBinding(context, statement.names[index], isConstantSourceByValue[index] ?? false);
				}
				break;
			}
			case LuaSyntaxKind.LocalFunctionStatement: {
				const localFunction = statement as LuaLocalFunctionStatement;
				declareConstantCopyBinding(context, localFunction.name, false);
				enterConstantCopyScope(context);
				for (const parameter of localFunction.functionExpression.parameters) {
					declareConstantCopyBinding(context, parameter, false);
				}
				lintConstantCopyInStatements(localFunction.functionExpression.body.body, context);
				leaveConstantCopyScope(context);
				break;
			}
			case LuaSyntaxKind.FunctionDeclarationStatement: {
				const declaration = statement as LuaFunctionDeclarationStatement;
				if (declaration.name.identifiers.length === 1 && declaration.name.methodName === null) {
					setConstantCopyBindingByName(context, declaration.name.identifiers[0], false);
				}
				enterConstantCopyScope(context);
				for (const parameter of declaration.functionExpression.parameters) {
					declareConstantCopyBinding(context, parameter, false);
				}
				lintConstantCopyInStatements(declaration.functionExpression.body.body, context);
				leaveConstantCopyScope(context);
				break;
			}
			case LuaSyntaxKind.AssignmentStatement: {
				for (const right of statement.right) {
					lintConstantCopyInExpression(right, context);
				}
				if (statement.operator === LuaAssignmentOperator.Assign) {
					const assignedConstantSources: boolean[] = [];
					for (let index = 0; index < statement.left.length; index += 1) {
						const right = index < statement.right.length ? statement.right[index] : null;
						assignedConstantSources[index] = right ? isConstantSourceExpression(right, context) : false;
					}
					for (let index = 0; index < statement.left.length; index += 1) {
						const left = statement.left[index];
						if (left.kind === LuaSyntaxKind.IdentifierExpression) {
							setConstantCopyBindingByName(context, left.name, assignedConstantSources[index]);
							continue;
						}
						lintConstantCopyInAssignmentTarget(left, context);
					}
					break;
				}
				for (const left of statement.left) {
					if (left.kind === LuaSyntaxKind.IdentifierExpression) {
						setConstantCopyBindingByName(context, left.name, false);
						continue;
					}
					lintConstantCopyInAssignmentTarget(left, context);
				}
				break;
			}
			case LuaSyntaxKind.ReturnStatement:
				for (const expression of statement.expressions) {
					lintConstantCopyInExpression(expression, context);
				}
				break;
			case LuaSyntaxKind.IfStatement:
				for (const clause of statement.clauses) {
					if (clause.condition) {
						lintConstantCopyInExpression(clause.condition, context);
					}
					enterConstantCopyScope(context);
					lintConstantCopyInStatements(clause.block.body, context);
					leaveConstantCopyScope(context);
				}
				break;
			case LuaSyntaxKind.WhileStatement:
				lintConstantCopyInExpression(statement.condition, context);
				enterConstantCopyScope(context);
				lintConstantCopyInStatements(statement.block.body, context);
				leaveConstantCopyScope(context);
				break;
			case LuaSyntaxKind.RepeatStatement:
				enterConstantCopyScope(context);
				lintConstantCopyInStatements(statement.block.body, context);
				leaveConstantCopyScope(context);
				lintConstantCopyInExpression(statement.condition, context);
				break;
			case LuaSyntaxKind.ForNumericStatement:
				lintConstantCopyInExpression(statement.start, context);
				lintConstantCopyInExpression(statement.limit, context);
				lintConstantCopyInExpression(statement.step, context);
				enterConstantCopyScope(context);
				declareConstantCopyBinding(context, statement.variable, false);
				lintConstantCopyInStatements(statement.block.body, context);
				leaveConstantCopyScope(context);
				break;
			case LuaSyntaxKind.ForGenericStatement:
				for (const iterator of statement.iterators) {
					lintConstantCopyInExpression(iterator, context);
				}
				enterConstantCopyScope(context);
				for (const variable of statement.variables) {
					declareConstantCopyBinding(context, variable, false);
				}
				lintConstantCopyInStatements(statement.block.body, context);
				leaveConstantCopyScope(context);
				break;
			case LuaSyntaxKind.DoStatement:
				enterConstantCopyScope(context);
				lintConstantCopyInStatements(statement.block.body, context);
				leaveConstantCopyScope(context);
				break;
			case LuaSyntaxKind.CallStatement:
				lintConstantCopyInExpression(statement.expression, context);
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
