import { type LuaCallExpression, type LuaExpression, type LuaStatement, LuaSyntaxKind, LuaTableFieldKind } from './ast';

export function getCallReceiverName(expression: LuaCallExpression): string | undefined {
	if (expression.methodName && expression.callee.kind === LuaSyntaxKind.IdentifierExpression) {
		return expression.callee.name;
	}
	if (expression.callee.kind === LuaSyntaxKind.MemberExpression && expression.callee.base.kind === LuaSyntaxKind.IdentifierExpression) {
		return expression.callee.base.name;
	}
	return undefined;
}

export function getCallMethodName(expression: LuaCallExpression): string | undefined {
	if (expression.methodName && expression.methodName.length > 0) {
		return expression.methodName;
	}
	if (expression.callee.kind === LuaSyntaxKind.MemberExpression) {
		return expression.callee.identifier;
	}
	return undefined;
}

export function getCallLeafName(expression: LuaCallExpression): string | undefined {
	const methodName = getCallMethodName(expression);
	if (methodName !== undefined) {
		return methodName;
	}
	if (expression.callee.kind === LuaSyntaxKind.IdentifierExpression) {
		return expression.callee.name;
	}
	return undefined;
}

export function getCallReceiverExpression(expression: LuaCallExpression): LuaExpression | undefined {
	if (expression.methodName && expression.methodName.length > 0) {
		return expression.callee;
	}
	if (expression.callee.kind === LuaSyntaxKind.MemberExpression) {
		return expression.callee.base;
	}
	return undefined;
}

export function isGlobalCall(expression: LuaCallExpression, name: string): boolean {
	return expression.callee.kind === LuaSyntaxKind.IdentifierExpression && expression.callee.name === name;
}

export function isErrorCallExpression(expression: LuaExpression): boolean {
	if (expression.kind !== LuaSyntaxKind.CallExpression) {
		return false;
	}
	return expression.callee.kind === LuaSyntaxKind.IdentifierExpression && expression.callee.name === 'error';
}

export function findCallExpressionInExpression(
	expression: LuaExpression | null,
	predicate: (expression: LuaCallExpression) => boolean,
): LuaCallExpression | undefined {
	if (!expression) {
		return undefined;
	}
	if (expression.kind === LuaSyntaxKind.CallExpression && predicate(expression)) {
		return expression;
	}
	switch (expression.kind) {
		case LuaSyntaxKind.MemberExpression:
			return findCallExpressionInExpression(expression.base, predicate);
		case LuaSyntaxKind.IndexExpression:
			return findCallExpressionInExpression(expression.base, predicate)
				|| findCallExpressionInExpression(expression.index, predicate);
		case LuaSyntaxKind.BinaryExpression:
			return findCallExpressionInExpression(expression.left, predicate)
				|| findCallExpressionInExpression(expression.right, predicate);
		case LuaSyntaxKind.UnaryExpression:
			return findCallExpressionInExpression(expression.operand, predicate);
		case LuaSyntaxKind.CallExpression: {
			const fromCallee = findCallExpressionInExpression(expression.callee, predicate);
			if (fromCallee) {
				return fromCallee;
			}
			for (const argument of expression.arguments) {
				const fromArgument = findCallExpressionInExpression(argument, predicate);
				if (fromArgument) {
					return fromArgument;
				}
			}
			return undefined;
		}
		case LuaSyntaxKind.TableConstructorExpression:
			for (const field of expression.fields) {
				if (field.kind === LuaTableFieldKind.ExpressionKey) {
					const fromKey = findCallExpressionInExpression(field.key, predicate);
					if (fromKey) {
						return fromKey;
					}
				}
				const fromValue = findCallExpressionInExpression(field.value, predicate);
				if (fromValue) {
					return fromValue;
				}
			}
			return undefined;
		case LuaSyntaxKind.FunctionExpression:
			return findCallExpressionInStatements(expression.body.body, predicate);
		default:
			return undefined;
	}
}

export function visitCallExpressionsInExpression(
	expression: LuaExpression | null,
	visitor: (expression: LuaCallExpression) => void,
): void {
	if (!expression) {
		return;
	}
	if (expression.kind === LuaSyntaxKind.CallExpression) {
		visitor(expression);
	}
	switch (expression.kind) {
		case LuaSyntaxKind.MemberExpression:
			visitCallExpressionsInExpression(expression.base, visitor);
			return;
		case LuaSyntaxKind.IndexExpression:
			visitCallExpressionsInExpression(expression.base, visitor);
			visitCallExpressionsInExpression(expression.index, visitor);
			return;
		case LuaSyntaxKind.BinaryExpression:
			visitCallExpressionsInExpression(expression.left, visitor);
			visitCallExpressionsInExpression(expression.right, visitor);
			return;
		case LuaSyntaxKind.UnaryExpression:
			visitCallExpressionsInExpression(expression.operand, visitor);
			return;
		case LuaSyntaxKind.CallExpression:
			visitCallExpressionsInExpression(expression.callee, visitor);
			for (const argument of expression.arguments) {
				visitCallExpressionsInExpression(argument, visitor);
			}
			return;
		case LuaSyntaxKind.TableConstructorExpression:
			for (const field of expression.fields) {
				if (field.kind === LuaTableFieldKind.ExpressionKey) {
					visitCallExpressionsInExpression(field.key, visitor);
				}
				visitCallExpressionsInExpression(field.value, visitor);
			}
			return;
		case LuaSyntaxKind.FunctionExpression:
			visitCallExpressionsInStatements(expression.body.body, visitor);
			return;
		default:
			return;
	}
}

export function findCallExpressionInStatements(
	statements: ReadonlyArray<LuaStatement>,
	predicate: (expression: LuaCallExpression) => boolean,
): LuaCallExpression | undefined {
	for (const statement of statements) {
		switch (statement.kind) {
			case LuaSyntaxKind.LocalAssignmentStatement:
				for (const value of statement.values) {
					const fromValue = findCallExpressionInExpression(value, predicate);
					if (fromValue) {
						return fromValue;
					}
				}
				break;
			case LuaSyntaxKind.AssignmentStatement:
				for (const left of statement.left) {
					const fromLeft = findCallExpressionInExpression(left, predicate);
					if (fromLeft) {
						return fromLeft;
					}
				}
				for (const right of statement.right) {
					const fromRight = findCallExpressionInExpression(right, predicate);
					if (fromRight) {
						return fromRight;
					}
				}
				break;
			case LuaSyntaxKind.LocalFunctionStatement: {
				const fromFunction = findCallExpressionInStatements(statement.functionExpression.body.body, predicate);
				if (fromFunction) {
					return fromFunction;
				}
				break;
			}
			case LuaSyntaxKind.FunctionDeclarationStatement: {
				const fromFunction = findCallExpressionInStatements(statement.functionExpression.body.body, predicate);
				if (fromFunction) {
					return fromFunction;
				}
				break;
			}
			case LuaSyntaxKind.ReturnStatement:
				for (const expression of statement.expressions) {
					const fromExpression = findCallExpressionInExpression(expression, predicate);
					if (fromExpression) {
						return fromExpression;
					}
				}
				break;
			case LuaSyntaxKind.IfStatement:
				for (const clause of statement.clauses) {
					const fromCondition = findCallExpressionInExpression(clause.condition, predicate);
					if (fromCondition) {
						return fromCondition;
					}
					const fromBlock = findCallExpressionInStatements(clause.block.body, predicate);
					if (fromBlock) {
						return fromBlock;
					}
				}
				break;
			case LuaSyntaxKind.WhileStatement: {
				const fromCondition = findCallExpressionInExpression(statement.condition, predicate);
				if (fromCondition) {
					return fromCondition;
				}
				const fromBlock = findCallExpressionInStatements(statement.block.body, predicate);
				if (fromBlock) {
					return fromBlock;
				}
				break;
			}
			case LuaSyntaxKind.RepeatStatement: {
				const fromBlock = findCallExpressionInStatements(statement.block.body, predicate);
				if (fromBlock) {
					return fromBlock;
				}
				const fromCondition = findCallExpressionInExpression(statement.condition, predicate);
				if (fromCondition) {
					return fromCondition;
				}
				break;
			}
			case LuaSyntaxKind.ForNumericStatement: {
				const fromStart = findCallExpressionInExpression(statement.start, predicate);
				if (fromStart) {
					return fromStart;
				}
				const fromLimit = findCallExpressionInExpression(statement.limit, predicate);
				if (fromLimit) {
					return fromLimit;
				}
				const fromStep = findCallExpressionInExpression(statement.step, predicate);
				if (fromStep) {
					return fromStep;
				}
				const fromBlock = findCallExpressionInStatements(statement.block.body, predicate);
				if (fromBlock) {
					return fromBlock;
				}
				break;
			}
			case LuaSyntaxKind.ForGenericStatement:
				for (const iterator of statement.iterators) {
					const fromIterator = findCallExpressionInExpression(iterator, predicate);
					if (fromIterator) {
						return fromIterator;
					}
				}
				{
					const fromBlock = findCallExpressionInStatements(statement.block.body, predicate);
					if (fromBlock) {
						return fromBlock;
					}
				}
				break;
			case LuaSyntaxKind.DoStatement: {
				const fromBlock = findCallExpressionInStatements(statement.block.body, predicate);
				if (fromBlock) {
					return fromBlock;
				}
				break;
			}
			case LuaSyntaxKind.CallStatement: {
				const fromCall = findCallExpressionInExpression(statement.expression, predicate);
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

export function visitCallExpressionsInStatements(
	statements: ReadonlyArray<LuaStatement>,
	visitor: (expression: LuaCallExpression) => void,
): void {
	for (const statement of statements) {
		switch (statement.kind) {
			case LuaSyntaxKind.LocalAssignmentStatement:
				for (const value of statement.values) {
					visitCallExpressionsInExpression(value, visitor);
				}
				break;
			case LuaSyntaxKind.AssignmentStatement:
				for (const left of statement.left) {
					visitCallExpressionsInExpression(left, visitor);
				}
				for (const right of statement.right) {
					visitCallExpressionsInExpression(right, visitor);
				}
				break;
			case LuaSyntaxKind.LocalFunctionStatement:
				visitCallExpressionsInStatements(statement.functionExpression.body.body, visitor);
				break;
			case LuaSyntaxKind.FunctionDeclarationStatement:
				visitCallExpressionsInStatements(statement.functionExpression.body.body, visitor);
				break;
			case LuaSyntaxKind.ReturnStatement:
				for (const expression of statement.expressions) {
					visitCallExpressionsInExpression(expression, visitor);
				}
				break;
			case LuaSyntaxKind.IfStatement:
				for (const clause of statement.clauses) {
					visitCallExpressionsInExpression(clause.condition, visitor);
					visitCallExpressionsInStatements(clause.block.body, visitor);
				}
				break;
			case LuaSyntaxKind.WhileStatement:
				visitCallExpressionsInExpression(statement.condition, visitor);
				visitCallExpressionsInStatements(statement.block.body, visitor);
				break;
			case LuaSyntaxKind.RepeatStatement:
				visitCallExpressionsInStatements(statement.block.body, visitor);
				visitCallExpressionsInExpression(statement.condition, visitor);
				break;
			case LuaSyntaxKind.ForNumericStatement:
				visitCallExpressionsInExpression(statement.start, visitor);
				visitCallExpressionsInExpression(statement.limit, visitor);
				visitCallExpressionsInExpression(statement.step, visitor);
				visitCallExpressionsInStatements(statement.block.body, visitor);
				break;
			case LuaSyntaxKind.ForGenericStatement:
				for (const iterator of statement.iterators) {
					visitCallExpressionsInExpression(iterator, visitor);
				}
				visitCallExpressionsInStatements(statement.block.body, visitor);
				break;
			case LuaSyntaxKind.DoStatement:
				visitCallExpressionsInStatements(statement.block.body, visitor);
				break;
			case LuaSyntaxKind.CallStatement:
				visitCallExpressionsInExpression(statement.expression, visitor);
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
