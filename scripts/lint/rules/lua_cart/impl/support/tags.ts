import { type LuaExpression as Expression, type LuaIfStatement as IfStatement, LuaSyntaxKind as SyntaxKind, LuaTableFieldKind as TableFieldKind } from '../../../../../../src/bmsx/lua/syntax/ast';
import { getCallMethodName } from '../../../../../../src/bmsx/lua/syntax/calls';
import { getExpressionKeyName } from './expression_signatures';
import { isSelfExpressionRoot } from './self_properties';

export function isHasTagCall(expression: Expression): boolean {
	if (expression.kind !== SyntaxKind.CallExpression) {
		return false;
	}
	return getCallMethodName(expression) === 'has_tag';
}

export function isTagsContainerExpression(expression: Expression): boolean {
	if (expression.kind === SyntaxKind.MemberExpression) {
		return expression.identifier === 'tags';
	}
	if (expression.kind !== SyntaxKind.IndexExpression) {
		return false;
	}
	const keyName = getExpressionKeyName(expression.index);
	return keyName === 'tags';
}

export function countHasTagCalls(expression: Expression): number {
	if (!expression) {
		return 0;
	}
	switch (expression.kind) {
		case SyntaxKind.CallExpression: {
			let count = isHasTagCall(expression) ? 1 : 0;
			for (const argument of expression.arguments) {
				count += countHasTagCalls(argument);
			}
			count += countHasTagCalls(expression.callee as Expression);
			return count;
		}
		case SyntaxKind.MemberExpression:
			return countHasTagCalls(expression.base);
		case SyntaxKind.IndexExpression:
			return countHasTagCalls(expression.base) + countHasTagCalls(expression.index);
		case SyntaxKind.BinaryExpression:
			return countHasTagCalls(expression.left) + countHasTagCalls(expression.right);
		case SyntaxKind.UnaryExpression:
			return countHasTagCalls(expression.operand);
		case SyntaxKind.TableConstructorExpression: {
			let count = 0;
			for (const field of expression.fields) {
				if (field.kind === TableFieldKind.ExpressionKey) {
					count += countHasTagCalls(field.key);
				}
				count += countHasTagCalls(field.value);
			}
			return count;
		}
		case SyntaxKind.FunctionExpression:
			return 0;
		default:
			return 0;
	}
}

export function countSplitNestedIfHasTagCalls(statement: IfStatement): number {
	let total = 0;
	let depth = 0;
	let current: IfStatement | null = statement;
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
		if (nested.kind !== SyntaxKind.IfStatement) {
			break;
		}
		current = nested;
	}
	if (depth <= 1 || total <= 1) {
		return 0;
	}
	return total;
}

export function isSelfHasTagCall(expression: Expression): boolean {
	if (expression.kind !== SyntaxKind.CallExpression) {
		return false;
	}
	if (getCallMethodName(expression) !== 'has_tag') {
		return false;
	}
	if (expression.callee.kind === SyntaxKind.MemberExpression) {
		return isSelfExpressionRoot(expression.callee.base);
	}
	if (expression.callee.kind === SyntaxKind.IdentifierExpression) {
		return expression.callee.name === 'self';
	}
	return false;
}
