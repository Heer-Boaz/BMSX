import { LuaAssignmentOperator, type LuaAssignmentStatement, LuaBinaryOperator, type LuaExpression, type LuaIfStatement, type LuaStatement, LuaSyntaxKind, LuaUnaryOperator } from '../../../../../../src/bmsx/lua/syntax/ast';
import { getRootIdentifier, isIdentifier } from './bindings';
import { isFalseOrNilExpression, isNilExpression } from './conditions';
import { getExpressionKeyName } from './expression_signatures';
import { SelfBooleanPropertyAssignmentMatch, SelfPropertyAssignmentMatch } from './types';

export function isSelfExpressionRoot(expression: LuaExpression): boolean {
	if (expression.kind === LuaSyntaxKind.IdentifierExpression) {
		return expression.name === 'self';
	}
	if (expression.kind === LuaSyntaxKind.MemberExpression || expression.kind === LuaSyntaxKind.IndexExpression) {
		return isSelfExpressionRoot(expression.base);
	}
	return false;
}

export function getSelfPropertyNameFromAliasExpression(expression: LuaExpression): string | undefined {
	if (expression.kind === LuaSyntaxKind.MemberExpression) {
		if (!isSelfExpressionRoot(expression.base)) {
			return undefined;
		}
		return expression.identifier;
	}
	if (expression.kind === LuaSyntaxKind.IndexExpression) {
		if (!isSelfExpressionRoot(expression.base)) {
			return undefined;
		}
		return getExpressionKeyName(expression.index);
	}
	return undefined;
}

export function isSelfImageIdAssignmentTarget(target: LuaExpression): boolean {
	if (target.kind === LuaSyntaxKind.MemberExpression) {
		return target.identifier === 'imgid' && isSelfExpressionRoot(target.base);
	}
	if (target.kind !== LuaSyntaxKind.IndexExpression) {
		return false;
	}
	if (!isSelfExpressionRoot(target.base)) {
		return false;
	}
	return (target.index.kind === LuaSyntaxKind.StringLiteralExpression && target.index.value === 'imgid')
		|| (target.index.kind === LuaSyntaxKind.IdentifierExpression && target.index.name === 'imgid');
}

export function isImgIdIndex(index: LuaExpression): boolean {
	return (index.kind === LuaSyntaxKind.StringLiteralExpression && index.value === 'imgid')
		|| (index.kind === LuaSyntaxKind.IdentifierExpression && index.name === 'imgid');
}

export function looksLikeSpriteLikeTarget(expression: LuaExpression): boolean {
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

export function isSpriteComponentImageIdAssignmentTarget(target: LuaExpression): boolean {
	if (target.kind === LuaSyntaxKind.MemberExpression) {
		if (target.identifier !== 'imgid') {
			return false;
		}
		return looksLikeSpriteLikeTarget(target.base);
	}
	if (target.kind !== LuaSyntaxKind.IndexExpression) {
		return false;
	}
	if (!isImgIdIndex(target.index)) {
		return false;
	}
	return looksLikeSpriteLikeTarget(target.base);
}

export function findSelfPropertyAssignmentInStatements(
	statements: ReadonlyArray<LuaStatement>,
	propertyPredicate: (propertyName: string) => boolean,
): SelfPropertyAssignmentMatch | undefined {
	for (const statement of statements) {
		switch (statement.kind) {
			case LuaSyntaxKind.AssignmentStatement:
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
			case LuaSyntaxKind.IfStatement:
				for (const clause of statement.clauses) {
					const nested = findSelfPropertyAssignmentInStatements(clause.block.body, propertyPredicate);
					if (nested) {
						return nested;
					}
				}
				break;
			case LuaSyntaxKind.WhileStatement: {
				const nested = findSelfPropertyAssignmentInStatements(statement.block.body, propertyPredicate);
				if (nested) {
					return nested;
				}
				break;
			}
			case LuaSyntaxKind.RepeatStatement: {
				const nested = findSelfPropertyAssignmentInStatements(statement.block.body, propertyPredicate);
				if (nested) {
					return nested;
				}
				break;
			}
			case LuaSyntaxKind.ForNumericStatement: {
				const nested = findSelfPropertyAssignmentInStatements(statement.block.body, propertyPredicate);
				if (nested) {
					return nested;
				}
				break;
			}
			case LuaSyntaxKind.ForGenericStatement: {
				const nested = findSelfPropertyAssignmentInStatements(statement.block.body, propertyPredicate);
				if (nested) {
					return nested;
				}
				break;
			}
			case LuaSyntaxKind.DoStatement: {
				const nested = findSelfPropertyAssignmentInStatements(statement.block.body, propertyPredicate);
				if (nested) {
					return nested;
				}
				break;
			}
			case LuaSyntaxKind.LocalAssignmentStatement:
			case LuaSyntaxKind.LocalFunctionStatement:
			case LuaSyntaxKind.FunctionDeclarationStatement:
			case LuaSyntaxKind.ReturnStatement:
			case LuaSyntaxKind.CallStatement:
			case LuaSyntaxKind.BreakStatement:
			case LuaSyntaxKind.GotoStatement:
			case LuaSyntaxKind.LabelStatement:
				break;
			default:
				break;
		}
	}
	return undefined;
}

export function getSelfPropertyNameFromConditionExpression(expression: LuaExpression | null): string | undefined {
	if (!expression) {
		return undefined;
	}
	if (expression.kind === LuaSyntaxKind.MemberExpression && isSelfExpressionRoot(expression.base)) {
		return expression.identifier;
	}
	if (expression.kind === LuaSyntaxKind.IndexExpression && isSelfExpressionRoot(expression.base)) {
		return getExpressionKeyName(expression.index);
	}
	if (expression.kind === LuaSyntaxKind.UnaryExpression && expression.operator === LuaUnaryOperator.Not) {
		return getSelfPropertyNameFromConditionExpression(expression.operand);
	}
	return undefined;
}

export function hasSelfPropertyResetInStatements(statements: ReadonlyArray<LuaStatement>, propertyName: string): boolean {
	for (const statement of statements) {
		if (statement.kind !== LuaSyntaxKind.AssignmentStatement || statement.operator !== LuaAssignmentOperator.Assign) {
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

export function matchesImgIdNilFallbackPattern(statement: LuaIfStatement): boolean {
	if (statement.clauses.length !== 1) {
		return false;
	}
	const clause = statement.clauses[0];
	const condition = clause.condition;
	if (!condition || condition.kind !== LuaSyntaxKind.BinaryExpression || condition.operator !== LuaBinaryOperator.Equal) {
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
	if (clauseStatement.kind !== LuaSyntaxKind.AssignmentStatement) {
		return false;
	}
	const assignment = clauseStatement as LuaAssignmentStatement;
	if (assignment.operator !== LuaAssignmentOperator.Assign || assignment.left.length !== 1 || assignment.right.length !== 1) {
		return false;
	}
	const target = assignment.left[0];
	return isIdentifier(target, variableName);
}

export function findSelfBooleanPropertyAssignmentInStatements(
	statements: ReadonlyArray<LuaStatement>,
	propertyName: string,
): SelfBooleanPropertyAssignmentMatch | undefined {
	for (const statement of statements) {
		switch (statement.kind) {
			case LuaSyntaxKind.AssignmentStatement:
				if (statement.operator !== LuaAssignmentOperator.Assign) {
					break;
				}
				for (let index = 0; index < statement.left.length && index < statement.right.length; index += 1) {
					const target = statement.left[index];
					const assignedPropertyName = getSelfAssignedPropertyNameFromTarget(target);
					if (assignedPropertyName !== propertyName) {
						continue;
					}
					const value = statement.right[index];
					if (value.kind !== LuaSyntaxKind.BooleanLiteralExpression) {
						continue;
					}
					return {
						propertyName: assignedPropertyName,
						target,
						value,
					};
				}
				break;
			case LuaSyntaxKind.IfStatement:
				for (const clause of statement.clauses) {
					const nested = findSelfBooleanPropertyAssignmentInStatements(clause.block.body, propertyName);
					if (nested) {
						return nested;
					}
				}
				break;
			case LuaSyntaxKind.WhileStatement: {
				const nested = findSelfBooleanPropertyAssignmentInStatements(statement.block.body, propertyName);
				if (nested) {
					return nested;
				}
				break;
			}
			case LuaSyntaxKind.RepeatStatement: {
				const nested = findSelfBooleanPropertyAssignmentInStatements(statement.block.body, propertyName);
				if (nested) {
					return nested;
				}
				break;
			}
			case LuaSyntaxKind.ForNumericStatement: {
				const nested = findSelfBooleanPropertyAssignmentInStatements(statement.block.body, propertyName);
				if (nested) {
					return nested;
				}
				break;
			}
			case LuaSyntaxKind.ForGenericStatement: {
				const nested = findSelfBooleanPropertyAssignmentInStatements(statement.block.body, propertyName);
				if (nested) {
					return nested;
				}
				break;
			}
			case LuaSyntaxKind.DoStatement: {
				const nested = findSelfBooleanPropertyAssignmentInStatements(statement.block.body, propertyName);
				if (nested) {
					return nested;
				}
				break;
			}
			case LuaSyntaxKind.LocalAssignmentStatement:
			case LuaSyntaxKind.LocalFunctionStatement:
			case LuaSyntaxKind.FunctionDeclarationStatement:
			case LuaSyntaxKind.ReturnStatement:
			case LuaSyntaxKind.CallStatement:
			case LuaSyntaxKind.BreakStatement:
			case LuaSyntaxKind.GotoStatement:
			case LuaSyntaxKind.LabelStatement:
				break;
			default:
				break;
		}
	}
	return undefined;
}

export function isSelfPropertyReferenceByName(expression: LuaExpression, propertyName: string): boolean {
	if (expression.kind === LuaSyntaxKind.MemberExpression && isSelfExpressionRoot(expression.base)) {
		return expression.identifier === propertyName;
	}
	if (expression.kind === LuaSyntaxKind.IndexExpression && isSelfExpressionRoot(expression.base)) {
		return getExpressionKeyName(expression.index) === propertyName;
	}
	return false;
}

export function getSelfAssignedPropertyNameFromTarget(target: LuaExpression): string | undefined {
	if (target.kind === LuaSyntaxKind.MemberExpression && isSelfExpressionRoot(target.base)) {
		return target.identifier;
	}
	if (target.kind === LuaSyntaxKind.IndexExpression && isSelfExpressionRoot(target.base)) {
		return getExpressionKeyName(target.index);
	}
	return undefined;
}
