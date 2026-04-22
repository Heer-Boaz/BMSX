import { type LuaExpression, type LuaIfStatement, LuaSyntaxKind, LuaTableFieldKind } from '../../../../../../src/bmsx/lua/syntax/ast';
import { getCallMethodName } from './calls';
import { getExpressionKeyName } from './expression_signatures';
import { isSelfExpressionRoot } from './self_properties';

export function isHasTagCall(expression: LuaExpression): boolean {
	if (expression.kind !== LuaSyntaxKind.CallExpression) {
		return false;
	}
	return getCallMethodName(expression) === 'has_tag';
}

export function isTagsContainerExpression(expression: LuaExpression): boolean {
	if (expression.kind === LuaSyntaxKind.MemberExpression) {
		return expression.identifier === 'tags';
	}
	if (expression.kind !== LuaSyntaxKind.IndexExpression) {
		return false;
	}
	const keyName = getExpressionKeyName(expression.index);
	return keyName === 'tags';
}

export function countHasTagCalls(expression: LuaExpression): number {
	if (!expression) {
		return 0;
	}
	switch (expression.kind) {
		case LuaSyntaxKind.CallExpression: {
			let count = isHasTagCall(expression) ? 1 : 0;
			for (const argument of expression.arguments) {
				count += countHasTagCalls(argument);
			}
			count += countHasTagCalls(expression.callee as LuaExpression);
			return count;
		}
		case LuaSyntaxKind.MemberExpression:
			return countHasTagCalls(expression.base);
		case LuaSyntaxKind.IndexExpression:
			return countHasTagCalls(expression.base) + countHasTagCalls(expression.index);
		case LuaSyntaxKind.BinaryExpression:
			return countHasTagCalls(expression.left) + countHasTagCalls(expression.right);
		case LuaSyntaxKind.UnaryExpression:
			return countHasTagCalls(expression.operand);
		case LuaSyntaxKind.TableConstructorExpression: {
			let count = 0;
			for (const field of expression.fields) {
				if (field.kind === LuaTableFieldKind.ExpressionKey) {
					count += countHasTagCalls(field.key);
				}
				count += countHasTagCalls(field.value);
			}
			return count;
		}
		case LuaSyntaxKind.FunctionExpression:
			return 0;
		default:
			return 0;
	}
}

export function countSplitNestedIfHasTagCalls(statement: LuaIfStatement): number {
	let total = 0;
	let depth = 0;
	let current: LuaIfStatement | null = statement;
	while (current) {
		if (current.clauses.length !== 1) {
			return 0;
		}
		const clause = current.clauses[0];
		if (!clause.condition) {
			return 0;
		}
		const conditionHasTagCount = countHasTagCalls(clause.condition);
		if (conditionHasTagCount > 1) {
			return 0;
		}
		total += conditionHasTagCount;
		depth += 1;
		if (clause.block.body.length !== 1) {
			break;
		}
		const nested = clause.block.body[0];
		if (nested.kind !== LuaSyntaxKind.IfStatement) {
			break;
		}
		current = nested;
	}
	if (depth <= 1 || total <= 1) {
		return 0;
	}
	return total;
}

export function isSelfHasTagCall(expression: LuaExpression): boolean {
	if (expression.kind !== LuaSyntaxKind.CallExpression) {
		return false;
	}
	if (getCallMethodName(expression) !== 'has_tag') {
		return false;
	}
	if (expression.callee.kind === LuaSyntaxKind.MemberExpression) {
		return isSelfExpressionRoot(expression.callee.base);
	}
	if (expression.callee.kind === LuaSyntaxKind.IdentifierExpression) {
		return expression.callee.name === 'self';
	}
	return false;
}
