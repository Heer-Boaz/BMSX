import { LuaAssignmentOperator as AssignmentOperator, type LuaAssignmentStatement as AssignmentStatement, LuaBinaryOperator as BinaryOperator, type LuaExpression as Expression, type LuaIfStatement as IfStatement, type LuaStatement as Statement, LuaSyntaxKind as SyntaxKind, LuaUnaryOperator as UnaryOperator } from '../../../../../../src/bmsx/lua/syntax/ast';
import { getRootIdentifier, isIdentifier } from './bindings';
import { isFalseOrNilExpression, isNilExpression } from './conditions';
import { getExpressionKeyName } from './expression_signatures';
import { SelfBooleanPropertyAssignmentMatch, SelfPropertyAssignmentMatch } from './types';

export function isSelfExpressionRoot(expression: Expression): boolean {
	if (expression.kind === SyntaxKind.IdentifierExpression) {
		return expression.name === 'self';
	}
	if (expression.kind === SyntaxKind.MemberExpression || expression.kind === SyntaxKind.IndexExpression) {
		return isSelfExpressionRoot(expression.base);
	}
	return false;
}

export function getSelfPropertyNameFromAliasExpression(expression: Expression): string | undefined {
	if (expression.kind === SyntaxKind.MemberExpression) {
		if (!isSelfExpressionRoot(expression.base)) {
			return undefined;
		}
		return expression.identifier;
	}
	if (expression.kind === SyntaxKind.IndexExpression) {
		if (!isSelfExpressionRoot(expression.base)) {
			return undefined;
		}
		return getExpressionKeyName(expression.index);
	}
	return undefined;
}

export function isSelfImageIdAssignmentTarget(target: Expression): boolean {
	if (target.kind === SyntaxKind.MemberExpression) {
		return target.identifier === 'imgid' && isSelfExpressionRoot(target.base);
	}
	if (target.kind !== SyntaxKind.IndexExpression) {
		return false;
	}
	if (!isSelfExpressionRoot(target.base)) {
		return false;
	}
	return (target.index.kind === SyntaxKind.StringLiteralExpression && target.index.value === 'imgid')
		|| (target.index.kind === SyntaxKind.IdentifierExpression && target.index.name === 'imgid');
}

export function isImgIdIndex(index: Expression): boolean {
	return (index.kind === SyntaxKind.StringLiteralExpression && index.value === 'imgid')
		|| (index.kind === SyntaxKind.IdentifierExpression && index.name === 'imgid');
}

export function looksLikeSpriteLikeTarget(expression: Expression): boolean {
	const root = getRootIdentifier(expression);
	if (!root) {
		return false;
	}
	if (root === 'self') {
		return true;
	}
	const loweredRoot = root.toLowerCase();
	return loweredRoot.includes('sprite');
}

export function isSpriteComponentImageIdAssignmentTarget(target: Expression): boolean {
	if (target.kind === SyntaxKind.MemberExpression) {
		if (target.identifier !== 'imgid') {
			return false;
		}
		return looksLikeSpriteLikeTarget(target.base);
	}
	if (target.kind !== SyntaxKind.IndexExpression) {
		return false;
	}
	if (!isImgIdIndex(target.index)) {
		return false;
	}
	return looksLikeSpriteLikeTarget(target.base);
}

export function findSelfPropertyAssignmentInStatements(
	statements: ReadonlyArray<Statement>,
	propertyPredicate: (propertyName: string) => boolean,
): SelfPropertyAssignmentMatch | undefined {
	for (const statement of statements) {
		switch (statement.kind) {
			case SyntaxKind.AssignmentStatement:
				for (const target of statement.left) {
					const propertyName = getSelfAssignedPropertyNameFromTarget(target);
					if (!propertyName || !propertyPredicate(propertyName)) {
						continue;
					}
					return {
						propertyName,
						target,
					};
				}
				break;
			case SyntaxKind.IfStatement:
				for (const clause of statement.clauses) {
					const nested = findSelfPropertyAssignmentInStatements(clause.block.body, propertyPredicate);
					if (nested) {
						return nested;
					}
				}
				break;
			case SyntaxKind.WhileStatement: {
				const nested = findSelfPropertyAssignmentInStatements(statement.block.body, propertyPredicate);
				if (nested) {
					return nested;
				}
				break;
			}
			case SyntaxKind.RepeatStatement: {
				const nested = findSelfPropertyAssignmentInStatements(statement.block.body, propertyPredicate);
				if (nested) {
					return nested;
				}
				break;
			}
			case SyntaxKind.ForNumericStatement: {
				const nested = findSelfPropertyAssignmentInStatements(statement.block.body, propertyPredicate);
				if (nested) {
					return nested;
				}
				break;
			}
			case SyntaxKind.ForGenericStatement: {
				const nested = findSelfPropertyAssignmentInStatements(statement.block.body, propertyPredicate);
				if (nested) {
					return nested;
				}
				break;
			}
			case SyntaxKind.DoStatement: {
				const nested = findSelfPropertyAssignmentInStatements(statement.block.body, propertyPredicate);
				if (nested) {
					return nested;
				}
				break;
			}
			case SyntaxKind.LocalAssignmentStatement:
			case SyntaxKind.LocalFunctionStatement:
			case SyntaxKind.FunctionDeclarationStatement:
			case SyntaxKind.ReturnStatement:
			case SyntaxKind.CallStatement:
			case SyntaxKind.BreakStatement:
			case SyntaxKind.GotoStatement:
			case SyntaxKind.LabelStatement:
				break;
			default:
				break;
		}
	}
	return undefined;
}

export function getSelfPropertyNameFromConditionExpression(expression: Expression | null): string | undefined {
	if (!expression) {
		return undefined;
	}
	if (expression.kind === SyntaxKind.MemberExpression && isSelfExpressionRoot(expression.base)) {
		return expression.identifier;
	}
	if (expression.kind === SyntaxKind.IndexExpression && isSelfExpressionRoot(expression.base)) {
		return getExpressionKeyName(expression.index);
	}
	if (expression.kind === SyntaxKind.UnaryExpression && expression.operator === UnaryOperator.Not) {
		return getSelfPropertyNameFromConditionExpression(expression.operand);
	}
	return undefined;
}

export function hasSelfPropertyResetInStatements(statements: ReadonlyArray<Statement>, propertyName: string): boolean {
	for (const statement of statements) {
		if (statement.kind !== SyntaxKind.AssignmentStatement || statement.operator !== AssignmentOperator.Assign) {
			continue;
		}
		for (let index = 0; index < statement.left.length && index < statement.right.length; index += 1) {
			const targetPropertyName = getSelfAssignedPropertyNameFromTarget(statement.left[index]);
			if (targetPropertyName !== propertyName) {
				continue;
			}
			if (isFalseOrNilExpression(statement.right[index])) {
				return true;
			}
		}
	}
	return false;
}

export function matchesImgIdNilFallbackPattern(statement: IfStatement): boolean {
	if (statement.clauses.length !== 1) {
		return false;
	}
	const clause = statement.clauses[0];
	const condition = clause.condition;
	if (!condition || condition.kind !== SyntaxKind.BinaryExpression || condition.operator !== BinaryOperator.Equal) {
		return false;
	}
	let variableName: string | undefined;
	if (isNilExpression(condition.left) && isIdentifier(condition.right, 'imgid')) {
		variableName = 'imgid';
	}
	if (isNilExpression(condition.right) && isIdentifier(condition.left, 'imgid')) {
		variableName = 'imgid';
	}
	if (variableName !== 'imgid') {
		return false;
	}
	if (clause.block.body.length !== 1) {
		return false;
	}
	const clauseStatement = clause.block.body[0];
	if (clauseStatement.kind !== SyntaxKind.AssignmentStatement) {
		return false;
	}
	const assignment = clauseStatement as AssignmentStatement;
	if (assignment.operator !== AssignmentOperator.Assign || assignment.left.length !== 1 || assignment.right.length !== 1) {
		return false;
	}
	const target = assignment.left[0];
	return isIdentifier(target, variableName);
}

export function findSelfBooleanPropertyAssignmentInStatements(
	statements: ReadonlyArray<Statement>,
	propertyName: string,
): SelfBooleanPropertyAssignmentMatch | undefined {
	for (const statement of statements) {
		switch (statement.kind) {
			case SyntaxKind.AssignmentStatement:
				if (statement.operator !== AssignmentOperator.Assign) {
					break;
				}
				for (let index = 0; index < statement.left.length && index < statement.right.length; index += 1) {
					const target = statement.left[index];
					const assignedPropertyName = getSelfAssignedPropertyNameFromTarget(target);
					if (assignedPropertyName !== propertyName) {
						continue;
					}
					const value = statement.right[index];
					if (value.kind !== SyntaxKind.BooleanLiteralExpression) {
						continue;
					}
					return {
						propertyName: assignedPropertyName,
						target,
						value,
					};
				}
				break;
			case SyntaxKind.IfStatement:
				for (const clause of statement.clauses) {
					const nested = findSelfBooleanPropertyAssignmentInStatements(clause.block.body, propertyName);
					if (nested) {
						return nested;
					}
				}
				break;
			case SyntaxKind.WhileStatement: {
				const nested = findSelfBooleanPropertyAssignmentInStatements(statement.block.body, propertyName);
				if (nested) {
					return nested;
				}
				break;
			}
			case SyntaxKind.RepeatStatement: {
				const nested = findSelfBooleanPropertyAssignmentInStatements(statement.block.body, propertyName);
				if (nested) {
					return nested;
				}
				break;
			}
			case SyntaxKind.ForNumericStatement: {
				const nested = findSelfBooleanPropertyAssignmentInStatements(statement.block.body, propertyName);
				if (nested) {
					return nested;
				}
				break;
			}
			case SyntaxKind.ForGenericStatement: {
				const nested = findSelfBooleanPropertyAssignmentInStatements(statement.block.body, propertyName);
				if (nested) {
					return nested;
				}
				break;
			}
			case SyntaxKind.DoStatement: {
				const nested = findSelfBooleanPropertyAssignmentInStatements(statement.block.body, propertyName);
				if (nested) {
					return nested;
				}
				break;
			}
			case SyntaxKind.LocalAssignmentStatement:
			case SyntaxKind.LocalFunctionStatement:
			case SyntaxKind.FunctionDeclarationStatement:
			case SyntaxKind.ReturnStatement:
			case SyntaxKind.CallStatement:
			case SyntaxKind.BreakStatement:
			case SyntaxKind.GotoStatement:
			case SyntaxKind.LabelStatement:
				break;
			default:
				break;
		}
	}
	return undefined;
}

export function isSelfPropertyReferenceByName(expression: Expression, propertyName: string): boolean {
	if (expression.kind === SyntaxKind.MemberExpression && isSelfExpressionRoot(expression.base)) {
		return expression.identifier === propertyName;
	}
	if (expression.kind === SyntaxKind.IndexExpression && isSelfExpressionRoot(expression.base)) {
		return getExpressionKeyName(expression.index) === propertyName;
	}
	return false;
}

export function getSelfAssignedPropertyNameFromTarget(target: Expression): string | undefined {
	if (target.kind === SyntaxKind.MemberExpression && isSelfExpressionRoot(target.base)) {
		return target.identifier;
	}
	if (target.kind === SyntaxKind.IndexExpression && isSelfExpressionRoot(target.base)) {
		return getExpressionKeyName(target.index);
	}
	return undefined;
}
