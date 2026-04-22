import { defineLintRule } from '../../rule';
import { LuaAssignmentOperator as AssignmentOperator, type LuaExpression as Expression, type LuaFunctionDeclarationStatement as FunctionDeclarationStatement, type LuaLocalFunctionStatement as LocalFunctionStatement, type LuaStatement as Statement, LuaSyntaxKind as SyntaxKind } from '../../../../src/bmsx/lua/syntax/ast';
import { declareConstantCopyBinding, enterConstantCopyScope, isForbiddenConstantCopyExpression, leaveConstantCopyScope, lintConstantCopyInAssignmentTarget, lintConstantCopyInExpression, setConstantCopyBindingByName } from './impl/support/constant_copy';
import { isConstantSourceExpression } from './impl/support/expressions';
import { ConstantCopyContext } from './impl/support/types';
import { pushIssue } from './impl/support/lint_context';

export const constantCopyPatternRule = defineLintRule('cart', 'constant_copy_pattern');

export function lintConstantCopyInStatements(statements: ReadonlyArray<Statement>, context: ConstantCopyContext): void {
	for (const statement of statements) {
		switch (statement.kind) {
			case SyntaxKind.LocalAssignmentStatement: {
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
			case SyntaxKind.LocalFunctionStatement: {
				const localFunction = statement as LocalFunctionStatement;
				declareConstantCopyBinding(context, localFunction.name, false);
				enterConstantCopyScope(context);
				for (const parameter of localFunction.functionExpression.parameters) {
					declareConstantCopyBinding(context, parameter, false);
				}
				lintConstantCopyInStatements(localFunction.functionExpression.body.body, context);
				leaveConstantCopyScope(context);
				break;
			}
			case SyntaxKind.FunctionDeclarationStatement: {
				const declaration = statement as FunctionDeclarationStatement;
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
			case SyntaxKind.AssignmentStatement: {
				for (const right of statement.right) {
					lintConstantCopyInExpression(right, context);
				}
				if (statement.operator === AssignmentOperator.Assign) {
					const assignedConstantSources: boolean[] = [];
					for (let index = 0; index < statement.left.length; index += 1) {
						const right = index < statement.right.length ? statement.right[index] : null;
						assignedConstantSources[index] = right ? isConstantSourceExpression(right, context) : false;
					}
					for (let index = 0; index < statement.left.length; index += 1) {
						updateConstantCopyAssignmentTarget(context, statement.left[index], assignedConstantSources[index]);
					}
					break;
				}
				for (const left of statement.left) {
					updateConstantCopyAssignmentTarget(context, left, false);
				}
				break;
			}
			case SyntaxKind.ReturnStatement:
				for (const expression of statement.expressions) {
					lintConstantCopyInExpression(expression, context);
				}
				break;
			case SyntaxKind.IfStatement:
				for (const clause of statement.clauses) {
					if (clause.condition) {
						lintConstantCopyInExpression(clause.condition, context);
					}
					enterConstantCopyScope(context);
					lintConstantCopyInStatements(clause.block.body, context);
					leaveConstantCopyScope(context);
				}
				break;
			case SyntaxKind.WhileStatement:
				lintConstantCopyInExpression(statement.condition, context);
				enterConstantCopyScope(context);
				lintConstantCopyInStatements(statement.block.body, context);
				leaveConstantCopyScope(context);
				break;
			case SyntaxKind.RepeatStatement:
				enterConstantCopyScope(context);
				lintConstantCopyInStatements(statement.block.body, context);
				leaveConstantCopyScope(context);
				lintConstantCopyInExpression(statement.condition, context);
				break;
			case SyntaxKind.ForNumericStatement:
				lintConstantCopyInExpression(statement.start, context);
				lintConstantCopyInExpression(statement.limit, context);
				lintConstantCopyInExpression(statement.step, context);
				enterConstantCopyScope(context);
				declareConstantCopyBinding(context, statement.variable, false);
				lintConstantCopyInStatements(statement.block.body, context);
				leaveConstantCopyScope(context);
				break;
			case SyntaxKind.ForGenericStatement:
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
			case SyntaxKind.DoStatement:
				enterConstantCopyScope(context);
				lintConstantCopyInStatements(statement.block.body, context);
				leaveConstantCopyScope(context);
				break;
			case SyntaxKind.CallStatement:
				lintConstantCopyInExpression(statement.expression, context);
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

function updateConstantCopyAssignmentTarget(context: ConstantCopyContext, left: Expression, isConstantSource: boolean): void {
	if (left.kind === SyntaxKind.IdentifierExpression) {
		setConstantCopyBindingByName(context, left.name, isConstantSource);
		return;
	}
	lintConstantCopyInAssignmentTarget(left, context);
}
