import { LuaAssignmentOperator, LuaBinaryOperator, type LuaExpression, type LuaIfStatement, type LuaStatement, LuaSyntaxKind, LuaTableFieldKind, LuaUnaryOperator } from '../../../../../../src/bmsx/lua/syntax/ast';
import { assignmentDirectlyTargetsIdentifier } from './bindings';

export function countIdentifierMentionsInExpression(expression: LuaExpression | null, identifierName: string): number {
	if (!expression) {
		return 0;
	}
	switch (expression.kind) {
		case LuaSyntaxKind.IdentifierExpression:
			return expression.name === identifierName ? 1 : 0;
		case LuaSyntaxKind.MemberExpression:
			return countIdentifierMentionsInExpression(expression.base, identifierName);
		case LuaSyntaxKind.IndexExpression:
			return countIdentifierMentionsInExpression(expression.base, identifierName)
				+ countIdentifierMentionsInExpression(expression.index, identifierName);
		case LuaSyntaxKind.BinaryExpression:
			return countIdentifierMentionsInExpression(expression.left, identifierName)
				+ countIdentifierMentionsInExpression(expression.right, identifierName);
		case LuaSyntaxKind.UnaryExpression:
			return countIdentifierMentionsInExpression(expression.operand, identifierName);
		case LuaSyntaxKind.CallExpression: {
			let count = countIdentifierMentionsInExpression(expression.callee, identifierName);
			for (const argument of expression.arguments) {
				count += countIdentifierMentionsInExpression(argument, identifierName);
			}
			return count;
		}
		case LuaSyntaxKind.TableConstructorExpression: {
			let count = 0;
			for (const field of expression.fields) {
				if (field.kind === LuaTableFieldKind.ExpressionKey) {
					count += countIdentifierMentionsInExpression(field.key, identifierName);
				}
				count += countIdentifierMentionsInExpression(field.value, identifierName);
			}
			return count;
		}
		case LuaSyntaxKind.FunctionExpression:
			return countIdentifierMentionsInStatements(expression.body.body, identifierName);
		default:
			return 0;
	}
}

export function countIdentifierMentionsInStatement(statement: LuaStatement, identifierName: string): number {
	switch (statement.kind) {
		case LuaSyntaxKind.LocalAssignmentStatement: {
			let count = 0;
			for (const value of statement.values) {
				count += countIdentifierMentionsInExpression(value, identifierName);
			}
			return count;
		}
		case LuaSyntaxKind.AssignmentStatement: {
			let count = 0;
			for (const left of statement.left) {
				count += countIdentifierMentionsInExpression(left, identifierName);
			}
			for (const right of statement.right) {
				count += countIdentifierMentionsInExpression(right, identifierName);
			}
			return count;
		}
		case LuaSyntaxKind.LocalFunctionStatement: {
			let count = statement.name.name === identifierName ? 1 : 0;
			count += countIdentifierMentionsInExpression(statement.functionExpression, identifierName);
			return count;
		}
		case LuaSyntaxKind.FunctionDeclarationStatement: {
			let count = 0;
			for (const namePart of statement.name.identifiers) {
				if (namePart === identifierName) {
					count += 1;
				}
			}
			if (statement.name.methodName === identifierName) {
				count += 1;
			}
			count += countIdentifierMentionsInExpression(statement.functionExpression, identifierName);
			return count;
		}
		case LuaSyntaxKind.ReturnStatement: {
			let count = 0;
			for (const expression of statement.expressions) {
				count += countIdentifierMentionsInExpression(expression, identifierName);
			}
			return count;
		}
		case LuaSyntaxKind.IfStatement: {
			let count = 0;
			for (const clause of statement.clauses) {
				if (clause.condition) {
					count += countIdentifierMentionsInExpression(clause.condition, identifierName);
				}
				count += countIdentifierMentionsInStatements(clause.block.body, identifierName);
			}
			return count;
		}
		case LuaSyntaxKind.WhileStatement:
			return countIdentifierMentionsInExpression(statement.condition, identifierName)
				+ countIdentifierMentionsInStatements(statement.block.body, identifierName);
		case LuaSyntaxKind.RepeatStatement:
			return countIdentifierMentionsInStatements(statement.block.body, identifierName)
				+ countIdentifierMentionsInExpression(statement.condition, identifierName);
		case LuaSyntaxKind.ForNumericStatement:
			return countIdentifierMentionsInExpression(statement.start, identifierName)
				+ countIdentifierMentionsInExpression(statement.limit, identifierName)
				+ countIdentifierMentionsInExpression(statement.step, identifierName)
				+ countIdentifierMentionsInStatements(statement.block.body, identifierName);
		case LuaSyntaxKind.ForGenericStatement: {
			let count = 0;
			for (const iterator of statement.iterators) {
				count += countIdentifierMentionsInExpression(iterator, identifierName);
			}
			count += countIdentifierMentionsInStatements(statement.block.body, identifierName);
			return count;
		}
		case LuaSyntaxKind.DoStatement:
			return countIdentifierMentionsInStatements(statement.block.body, identifierName);
		case LuaSyntaxKind.CallStatement:
			return countIdentifierMentionsInExpression(statement.expression, identifierName);
		case LuaSyntaxKind.BreakStatement:
		case LuaSyntaxKind.GotoStatement:
		case LuaSyntaxKind.LabelStatement:
			return 0;
		default:
			return 0;
	}
}

export function countIdentifierMentionsInStatements(statements: ReadonlyArray<LuaStatement>, identifierName: string): number {
	let count = 0;
	for (const statement of statements) {
		count += countIdentifierMentionsInStatement(statement, identifierName);
	}
	return count;
}

export function expressionUsesIdentifier(expression: LuaExpression | null, name: string): boolean {
	if (!expression) {
		return false;
	}
	switch (expression.kind) {
		case LuaSyntaxKind.IdentifierExpression:
			return expression.name === name;
		case LuaSyntaxKind.MemberExpression:
			return expressionUsesIdentifier(expression.base, name);
		case LuaSyntaxKind.IndexExpression:
			return expressionUsesIdentifier(expression.base, name) || expressionUsesIdentifier(expression.index, name);
		case LuaSyntaxKind.BinaryExpression:
			return expressionUsesIdentifier(expression.left, name) || expressionUsesIdentifier(expression.right, name);
		case LuaSyntaxKind.UnaryExpression:
			return expressionUsesIdentifier(expression.operand, name);
		case LuaSyntaxKind.CallExpression:
			if (expressionUsesIdentifier(expression.callee, name)) {
				return true;
			}
			for (const argument of expression.arguments) {
				if (expressionUsesIdentifier(argument, name)) {
					return true;
				}
			}
			return false;
		case LuaSyntaxKind.TableConstructorExpression:
			for (const field of expression.fields) {
				if (field.kind === LuaTableFieldKind.ExpressionKey && expressionUsesIdentifier(field.key, name)) {
					return true;
				}
				if (expressionUsesIdentifier(field.value, name)) {
					return true;
				}
			}
			return false;
		case LuaSyntaxKind.FunctionExpression:
			// Nested function bodies are intentionally excluded for this rule.
			return false;
		default:
			return false;
	}
}

export function isUnsafeBinaryOperator(operator: LuaBinaryOperator): boolean {
	return operator !== LuaBinaryOperator.Or
		&& operator !== LuaBinaryOperator.And
		&& operator !== LuaBinaryOperator.Equal
		&& operator !== LuaBinaryOperator.NotEqual;
}

export function isUnsafeUnaryOperator(operator: LuaUnaryOperator): boolean {
	return operator === LuaUnaryOperator.Negate
		|| operator === LuaUnaryOperator.Length
		|| operator === LuaUnaryOperator.BitwiseNot;
}

export function expressionUsesIdentifierUnsafely(expression: LuaExpression | null, name: string): boolean {
	if (!expression) {
		return false;
	}
	switch (expression.kind) {
		case LuaSyntaxKind.IdentifierExpression:
			return false;
		case LuaSyntaxKind.MemberExpression:
			if (expressionUsesIdentifier(expression.base, name)) {
				return true;
			}
			return expressionUsesIdentifierUnsafely(expression.base, name);
		case LuaSyntaxKind.IndexExpression:
			if (expressionUsesIdentifier(expression.base, name) || expressionUsesIdentifier(expression.index, name)) {
				return true;
			}
			return expressionUsesIdentifierUnsafely(expression.base, name)
				|| expressionUsesIdentifierUnsafely(expression.index, name);
		case LuaSyntaxKind.BinaryExpression:
			if (isUnsafeBinaryOperator(expression.operator)
				&& (expressionUsesIdentifier(expression.left, name) || expressionUsesIdentifier(expression.right, name))) {
				return true;
			}
			return expressionUsesIdentifierUnsafely(expression.left, name)
				|| expressionUsesIdentifierUnsafely(expression.right, name);
		case LuaSyntaxKind.UnaryExpression:
			if (isUnsafeUnaryOperator(expression.operator) && expressionUsesIdentifier(expression.operand, name)) {
				return true;
			}
			return expressionUsesIdentifierUnsafely(expression.operand, name);
		case LuaSyntaxKind.CallExpression:
			if (expressionUsesIdentifier(expression.callee, name) || expressionUsesIdentifierUnsafely(expression.callee, name)) {
				return true;
			}
			for (const argument of expression.arguments) {
				if (expressionUsesIdentifierUnsafely(argument, name)) {
					return true;
				}
			}
			return false;
		case LuaSyntaxKind.TableConstructorExpression:
			for (const field of expression.fields) {
				if (field.kind === LuaTableFieldKind.ExpressionKey && expressionUsesIdentifierUnsafely(field.key, name)) {
					return true;
				}
				if (expressionUsesIdentifierUnsafely(field.value, name)) {
					return true;
				}
			}
			return false;
		case LuaSyntaxKind.FunctionExpression:
			// Nested function bodies are intentionally excluded for this rule.
			return false;
		default:
			return false;
	}
}

export function blockDirectlyAssignsIdentifier(blockStatements: ReadonlyArray<LuaStatement>, name: string): boolean {
	for (const statement of blockStatements) {
		if (assignmentDirectlyTargetsIdentifier(statement, name)) {
			return true;
		}
	}
	return false;
}

export function isSingleBranchConditionalAssignment(statement: LuaIfStatement, name: string): boolean {
	if (statement.clauses.length !== 1) {
		return false;
	}
	const onlyClause = statement.clauses[0];
	if (!onlyClause.condition) {
		return false;
	}
	return blockDirectlyAssignsIdentifier(onlyClause.block.body, name);
}

export function statementUsesIdentifierUnsafelyInCurrentScope(statement: LuaStatement, name: string): boolean {
	switch (statement.kind) {
		case LuaSyntaxKind.LocalAssignmentStatement:
			for (const value of statement.values) {
				if (expressionUsesIdentifierUnsafely(value, name)) {
					return true;
				}
			}
			return false;
		case LuaSyntaxKind.AssignmentStatement:
			for (const left of statement.left) {
				if (left.kind === LuaSyntaxKind.IdentifierExpression && left.name === name) {
					if (statement.operator !== LuaAssignmentOperator.Assign) {
						return true;
					}
				} else if (expressionUsesIdentifierUnsafely(left, name)) {
					return true;
				}
			}
			for (const right of statement.right) {
				if (expressionUsesIdentifierUnsafely(right, name)) {
					return true;
				}
			}
			return false;
		case LuaSyntaxKind.LocalFunctionStatement:
		case LuaSyntaxKind.FunctionDeclarationStatement:
			return false;
			case LuaSyntaxKind.ReturnStatement:
				for (const expression of statement.expressions) {
					if (expressionUsesIdentifierUnsafely(expression, name)) {
						return true;
					}
				}
				return false;
			case LuaSyntaxKind.IfStatement:
				for (const clause of statement.clauses) {
					if (clause.condition && expressionUsesIdentifierUnsafely(clause.condition, name)) {
						return true;
					}
					for (const nested of clause.block.body) {
						if (statementUsesIdentifierUnsafelyInCurrentScope(nested, name)) {
							return true;
						}
					}
				}
				return false;
			case LuaSyntaxKind.WhileStatement:
				if (expressionUsesIdentifierUnsafely(statement.condition, name)) {
					return true;
				}
				for (const nested of statement.block.body) {
					if (statementUsesIdentifierUnsafelyInCurrentScope(nested, name)) {
						return true;
					}
				}
				return false;
			case LuaSyntaxKind.RepeatStatement:
				for (const nested of statement.block.body) {
					if (statementUsesIdentifierUnsafelyInCurrentScope(nested, name)) {
						return true;
					}
				}
				return expressionUsesIdentifierUnsafely(statement.condition, name);
			case LuaSyntaxKind.ForNumericStatement:
				if (expressionUsesIdentifier(statement.start, name)
					|| expressionUsesIdentifier(statement.limit, name)
					|| expressionUsesIdentifier(statement.step, name)) {
					return true;
				}
				for (const nested of statement.block.body) {
					if (statementUsesIdentifierUnsafelyInCurrentScope(nested, name)) {
						return true;
					}
				}
				return false;
			case LuaSyntaxKind.ForGenericStatement:
				for (const iterator of statement.iterators) {
					if (expressionUsesIdentifierUnsafely(iterator, name)) {
						return true;
					}
				}
				for (const nested of statement.block.body) {
					if (statementUsesIdentifierUnsafelyInCurrentScope(nested, name)) {
						return true;
					}
				}
				return false;
			case LuaSyntaxKind.DoStatement:
				for (const nested of statement.block.body) {
					if (statementUsesIdentifierUnsafelyInCurrentScope(nested, name)) {
						return true;
					}
				}
				return false;
			case LuaSyntaxKind.CallStatement:
				return expressionUsesIdentifierUnsafely(statement.expression, name);
			case LuaSyntaxKind.BreakStatement:
			case LuaSyntaxKind.GotoStatement:
			case LuaSyntaxKind.LabelStatement:
				return false;
		default:
			return false;
	}
}
