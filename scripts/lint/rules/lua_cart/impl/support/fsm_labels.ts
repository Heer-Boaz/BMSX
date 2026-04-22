import { type LuaExpression, type LuaStatement, LuaSyntaxKind, type LuaTableField, LuaTableFieldKind } from '../../../../../../src/bmsx/lua/syntax/ast';
import { type LintRuleName } from '../../../../rule';
import { type LuaLintIssue } from '../../../../lua_rule';
import { getExpressionKeyName } from './expression_signatures';
import { appendSuggestionMessage } from './general';
import { getSelfAssignedPropertyNameFromTarget } from './self_properties';
import { pushIssue } from './lint_context';

export function containsServiceLabel(value: string): boolean {
	return value.toLowerCase().includes('service');
}

export function containsLabel(value: string, label: string): boolean {
	return value.toLowerCase().includes(label.toLowerCase());
}

export function removeLabel(value: string, label: string): string | undefined {
	const stripped = value
		.replace(new RegExp(label, 'gi'), '')
		.replace(/[._-]{2,}/g, '_')
		.replace(/^[._-]+|[._-]+$/g, '');
	if (stripped.length === 0 || stripped === value) {
		return undefined;
	}
	return stripped;
}

export function removeServiceLabel(value: string): string | undefined {
	return removeLabel(value, 'service');
}

export function normalizeStateNameToken(stateName: string): string {
	if (stateName.startsWith('/')) {
		return stateName.slice(1);
	}
	return stateName;
}

export function getStateNameFromStateField(field: LuaTableField): string | undefined {
	if (field.kind === LuaTableFieldKind.IdentifierKey) {
		return field.name;
	}
	if (field.kind === LuaTableFieldKind.ExpressionKey) {
		return getExpressionKeyName(field.key);
	}
	return undefined;
}

export function findStateNameMirrorAssignmentInExpression(
	expression: LuaExpression | null,
	stateName: string,
): { readonly propertyName: string; readonly valueNode: LuaExpression; } | undefined {
	if (!expression) {
		return undefined;
	}
	switch (expression.kind) {
		case LuaSyntaxKind.MemberExpression:
			return findStateNameMirrorAssignmentInExpression(expression.base, stateName);
		case LuaSyntaxKind.IndexExpression:
			return findStateNameMirrorAssignmentInExpression(expression.base, stateName)
				|| findStateNameMirrorAssignmentInExpression(expression.index, stateName);
		case LuaSyntaxKind.BinaryExpression:
			return findStateNameMirrorAssignmentInExpression(expression.left, stateName)
				|| findStateNameMirrorAssignmentInExpression(expression.right, stateName);
		case LuaSyntaxKind.UnaryExpression:
			return findStateNameMirrorAssignmentInExpression(expression.operand, stateName);
		case LuaSyntaxKind.CallExpression: {
			const fromCallee = findStateNameMirrorAssignmentInExpression(expression.callee, stateName);
			if (fromCallee) {
				return fromCallee;
			}
			for (const argument of expression.arguments) {
				const fromArgument = findStateNameMirrorAssignmentInExpression(argument, stateName);
				if (fromArgument) {
					return fromArgument;
				}
			}
			return undefined;
		}
		case LuaSyntaxKind.TableConstructorExpression:
			for (const field of expression.fields) {
				if (field.kind === LuaTableFieldKind.ExpressionKey) {
					const fromKey = findStateNameMirrorAssignmentInExpression(field.key, stateName);
					if (fromKey) {
						return fromKey;
					}
				}
				const fromValue = findStateNameMirrorAssignmentInExpression(field.value, stateName);
				if (fromValue) {
					return fromValue;
				}
			}
			return undefined;
		case LuaSyntaxKind.FunctionExpression:
			return findStateNameMirrorAssignmentInStatements(expression.body.body, stateName);
		default:
			return undefined;
	}
}

export function findStateNameMirrorAssignmentInStatements(
	statements: ReadonlyArray<LuaStatement>,
	stateName: string,
): { readonly propertyName: string; readonly valueNode: LuaExpression; } | undefined {
	for (const statement of statements) {
		switch (statement.kind) {
			case LuaSyntaxKind.LocalAssignmentStatement:
				for (const value of statement.values) {
					const fromValue = findStateNameMirrorAssignmentInExpression(value, stateName);
					if (fromValue) {
						return fromValue;
					}
				}
				break;
			case LuaSyntaxKind.AssignmentStatement: {
				for (let index = 0; index < statement.left.length && index < statement.right.length; index += 1) {
					const propertyName = getSelfAssignedPropertyNameFromTarget(statement.left[index]);
					if (!propertyName) {
						continue;
					}
					const right = statement.right[index];
					if (right.kind !== LuaSyntaxKind.StringLiteralExpression) {
						continue;
					}
					if (normalizeStateNameToken(right.value) !== stateName) {
						continue;
					}
					return { propertyName, valueNode: right };
				}
				for (const left of statement.left) {
					const fromLeft = findStateNameMirrorAssignmentInExpression(left, stateName);
					if (fromLeft) {
						return fromLeft;
					}
				}
				for (const right of statement.right) {
					const fromRight = findStateNameMirrorAssignmentInExpression(right, stateName);
					if (fromRight) {
						return fromRight;
					}
				}
				break;
			}
			case LuaSyntaxKind.LocalFunctionStatement: {
				const fromFunction = findStateNameMirrorAssignmentInStatements(statement.functionExpression.body.body, stateName);
				if (fromFunction) {
					return fromFunction;
				}
				break;
			}
			case LuaSyntaxKind.FunctionDeclarationStatement: {
				const fromFunction = findStateNameMirrorAssignmentInStatements(statement.functionExpression.body.body, stateName);
				if (fromFunction) {
					return fromFunction;
				}
				break;
			}
			case LuaSyntaxKind.ReturnStatement:
				for (const expression of statement.expressions) {
					const fromExpression = findStateNameMirrorAssignmentInExpression(expression, stateName);
					if (fromExpression) {
						return fromExpression;
					}
				}
				break;
			case LuaSyntaxKind.IfStatement:
				for (const clause of statement.clauses) {
					const fromCondition = findStateNameMirrorAssignmentInExpression(clause.condition, stateName);
					if (fromCondition) {
						return fromCondition;
					}
					const fromBlock = findStateNameMirrorAssignmentInStatements(clause.block.body, stateName);
					if (fromBlock) {
						return fromBlock;
					}
				}
				break;
			case LuaSyntaxKind.WhileStatement: {
				const fromCondition = findStateNameMirrorAssignmentInExpression(statement.condition, stateName);
				if (fromCondition) {
					return fromCondition;
				}
				const fromBlock = findStateNameMirrorAssignmentInStatements(statement.block.body, stateName);
				if (fromBlock) {
					return fromBlock;
				}
				break;
			}
			case LuaSyntaxKind.RepeatStatement: {
				const fromBlock = findStateNameMirrorAssignmentInStatements(statement.block.body, stateName);
				if (fromBlock) {
					return fromBlock;
				}
				const fromCondition = findStateNameMirrorAssignmentInExpression(statement.condition, stateName);
				if (fromCondition) {
					return fromCondition;
				}
				break;
			}
			case LuaSyntaxKind.ForNumericStatement: {
				const fromStart = findStateNameMirrorAssignmentInExpression(statement.start, stateName);
				if (fromStart) {
					return fromStart;
				}
				const fromLimit = findStateNameMirrorAssignmentInExpression(statement.limit, stateName);
				if (fromLimit) {
					return fromLimit;
				}
				const fromStep = findStateNameMirrorAssignmentInExpression(statement.step, stateName);
				if (fromStep) {
					return fromStep;
				}
				const fromBlock = findStateNameMirrorAssignmentInStatements(statement.block.body, stateName);
				if (fromBlock) {
					return fromBlock;
				}
				break;
			}
			case LuaSyntaxKind.ForGenericStatement:
				for (const iterator of statement.iterators) {
					const fromIterator = findStateNameMirrorAssignmentInExpression(iterator, stateName);
					if (fromIterator) {
						return fromIterator;
					}
				}
				{
					const fromBlock = findStateNameMirrorAssignmentInStatements(statement.block.body, stateName);
					if (fromBlock) {
						return fromBlock;
					}
				}
				break;
			case LuaSyntaxKind.DoStatement: {
				const fromBlock = findStateNameMirrorAssignmentInStatements(statement.block.body, stateName);
				if (fromBlock) {
					return fromBlock;
				}
				break;
			}
			case LuaSyntaxKind.CallStatement: {
				const fromCall = findStateNameMirrorAssignmentInExpression(statement.expression, stateName);
				if (fromCall) {
					return fromCall;
				}
				break;
			}
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

export function lintCollectionStringValuesForLabel(
	expression: LuaExpression,
	label: string,
	rule: LintRuleName,
	issues: LuaLintIssue[],
	messagePrefix: string,
): void {
	if (expression.kind === LuaSyntaxKind.StringLiteralExpression) {
		if (!containsLabel(expression.value, label)) {
			return;
		}
		pushIssue(
			issues,
			rule,
			expression,
			appendSuggestionMessage(
				`${messagePrefix} must not contain "${label}" ("${expression.value}").`,
				expression.value,
				label,
			),
		);
		return;
	}
	if (expression.kind !== LuaSyntaxKind.TableConstructorExpression) {
		return;
	}
	for (const field of expression.fields) {
		if (field.kind !== LuaTableFieldKind.Array || field.value.kind !== LuaSyntaxKind.StringLiteralExpression) {
			continue;
		}
		const value = field.value.value;
		if (!containsLabel(value, label)) {
			continue;
		}
		pushIssue(
			issues,
			rule,
			field.value,
			appendSuggestionMessage(
				`${messagePrefix} must not contain "${label}" ("${value}").`,
				value,
				label,
			),
		);
	}
}
