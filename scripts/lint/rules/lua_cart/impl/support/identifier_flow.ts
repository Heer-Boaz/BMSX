import { LuaAssignmentOperator as AssignmentOperator, LuaBinaryOperator as BinaryOperator, type LuaExpression as Expression, type LuaIfStatement as IfStatement, type LuaStatement as Statement, LuaSyntaxKind as SyntaxKind, LuaTableFieldKind as TableFieldKind, LuaUnaryOperator as UnaryOperator } from '../../../../../../src/bmsx/lua/syntax/ast';
import { assignmentDirectlyTargetsIdentifier } from './bindings';

export function countIdentifierMentionsInExpression(expression: Expression | null, identifierName: string): number {
	if (!expression) {
		return 0;
	}
	switch (expression.kind) {
		case SyntaxKind.IdentifierExpression:
			return expression.name === identifierName ? 1 : 0;
		case SyntaxKind.MemberExpression:
			return countIdentifierMentionsInExpression(expression.base, identifierName);
		case SyntaxKind.IndexExpression:
			return countIdentifierMentionsInExpression(expression.base, identifierName)
				+ countIdentifierMentionsInExpression(expression.index, identifierName);
		case SyntaxKind.BinaryExpression:
			return countIdentifierMentionsInExpression(expression.left, identifierName)
				+ countIdentifierMentionsInExpression(expression.right, identifierName);
		case SyntaxKind.UnaryExpression:
			return countIdentifierMentionsInExpression(expression.operand, identifierName);
		case SyntaxKind.CallExpression: {
			let count = countIdentifierMentionsInExpression(expression.callee, identifierName);
			for (const argument of expression.arguments) {
				count += countIdentifierMentionsInExpression(argument, identifierName);
			}
			return count;
		}
		case SyntaxKind.TableConstructorExpression: {
			let count = 0;
			for (const field of expression.fields) {
				if (field.kind === TableFieldKind.ExpressionKey) {
					count += countIdentifierMentionsInExpression(field.key, identifierName);
				}
				count += countIdentifierMentionsInExpression(field.value, identifierName);
			}
			return count;
		}
		case SyntaxKind.FunctionExpression:
			return countIdentifierMentionsInStatements(expression.body.body, identifierName);
		default:
			return 0;
	}
}

export function countIdentifierMentionsInStatement(statement: Statement, identifierName: string): number {
	switch (statement.kind) {
		case SyntaxKind.LocalAssignmentStatement: {
			let count = 0;
			for (const value of statement.values) {
				count += countIdentifierMentionsInExpression(value, identifierName);
			}
			return count;
		}
		case SyntaxKind.AssignmentStatement: {
			let count = 0;
			for (const left of statement.left) {
				count += countIdentifierMentionsInExpression(left, identifierName);
			}
			for (const right of statement.right) {
				count += countIdentifierMentionsInExpression(right, identifierName);
			}
			return count;
		}
		case SyntaxKind.LocalFunctionStatement: {
			let count = statement.name.name === identifierName ? 1 : 0;
			count += countIdentifierMentionsInExpression(statement.functionExpression, identifierName);
			return count;
		}
		case SyntaxKind.FunctionDeclarationStatement: {
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
		case SyntaxKind.ReturnStatement: {
			let count = 0;
			for (const expression of statement.expressions) {
				count += countIdentifierMentionsInExpression(expression, identifierName);
			}
			return count;
		}
		case SyntaxKind.IfStatement: {
			let count = 0;
			for (const clause of statement.clauses) {
				if (clause.condition) {
					count += countIdentifierMentionsInExpression(clause.condition, identifierName);
				}
				count += countIdentifierMentionsInStatements(clause.block.body, identifierName);
			}
			return count;
		}
		case SyntaxKind.WhileStatement:
			return countIdentifierMentionsInExpression(statement.condition, identifierName)
				+ countIdentifierMentionsInStatements(statement.block.body, identifierName);
		case SyntaxKind.RepeatStatement:
			return countIdentifierMentionsInStatements(statement.block.body, identifierName)
				+ countIdentifierMentionsInExpression(statement.condition, identifierName);
		case SyntaxKind.ForNumericStatement:
			return countIdentifierMentionsInExpression(statement.start, identifierName)
				+ countIdentifierMentionsInExpression(statement.limit, identifierName)
				+ countIdentifierMentionsInExpression(statement.step, identifierName)
				+ countIdentifierMentionsInStatements(statement.block.body, identifierName);
		case SyntaxKind.ForGenericStatement: {
			let count = 0;
			for (const iterator of statement.iterators) {
				count += countIdentifierMentionsInExpression(iterator, identifierName);
			}
			count += countIdentifierMentionsInStatements(statement.block.body, identifierName);
			return count;
		}
		case SyntaxKind.DoStatement:
			return countIdentifierMentionsInStatements(statement.block.body, identifierName);
		case SyntaxKind.CallStatement:
			return countIdentifierMentionsInExpression(statement.expression, identifierName);
		case SyntaxKind.BreakStatement:
		case SyntaxKind.GotoStatement:
		case SyntaxKind.LabelStatement:
			return 0;
		default:
			return 0;
	}
}

export function countIdentifierMentionsInStatements(statements: ReadonlyArray<Statement>, identifierName: string): number {
	let count = 0;
	for (const statement of statements) {
		count += countIdentifierMentionsInStatement(statement, identifierName);
	}
	return count;
}

export function expressionUsesIdentifier(expression: Expression | null, name: string): boolean {
	if (!expression) {
		return false;
	}
	switch (expression.kind) {
		case SyntaxKind.IdentifierExpression:
			return expression.name === name;
		case SyntaxKind.MemberExpression:
			return expressionUsesIdentifier(expression.base, name);
		case SyntaxKind.IndexExpression:
			return expressionUsesIdentifier(expression.base, name) || expressionUsesIdentifier(expression.index, name);
		case SyntaxKind.BinaryExpression:
			return expressionUsesIdentifier(expression.left, name) || expressionUsesIdentifier(expression.right, name);
		case SyntaxKind.UnaryExpression:
			return expressionUsesIdentifier(expression.operand, name);
		case SyntaxKind.CallExpression:
			if (expressionUsesIdentifier(expression.callee, name)) {
				return true;
			}
			for (const argument of expression.arguments) {
				if (expressionUsesIdentifier(argument, name)) {
					return true;
				}
			}
			return false;
		case SyntaxKind.TableConstructorExpression:
			for (const field of expression.fields) {
				if (field.kind === TableFieldKind.ExpressionKey && expressionUsesIdentifier(field.key, name)) {
					return true;
				}
				if (expressionUsesIdentifier(field.value, name)) {
					return true;
				}
			}
			return false;
		case SyntaxKind.FunctionExpression:
			// Nested function bodies are intentionally excluded for this rule.
			return false;
		default:
			return false;
	}
}

export function isUnsafeBinaryOperator(operator: BinaryOperator): boolean {
	return operator !== BinaryOperator.Or
		&& operator !== BinaryOperator.And
		&& operator !== BinaryOperator.Equal
		&& operator !== BinaryOperator.NotEqual;
}

export function isUnsafeUnaryOperator(operator: UnaryOperator): boolean {
	return operator === UnaryOperator.Negate
		|| operator === UnaryOperator.Length
		|| operator === UnaryOperator.BitwiseNot;
}

export function expressionUsesIdentifierUnsafely(expression: Expression | null, name: string): boolean {
	if (!expression) {
		return false;
	}
	switch (expression.kind) {
		case SyntaxKind.IdentifierExpression:
			return false;
		case SyntaxKind.MemberExpression:
			if (expressionUsesIdentifier(expression.base, name)) {
				return true;
			}
			return expressionUsesIdentifierUnsafely(expression.base, name);
		case SyntaxKind.IndexExpression:
			if (expressionUsesIdentifier(expression.base, name) || expressionUsesIdentifier(expression.index, name)) {
				return true;
			}
			return expressionUsesIdentifierUnsafely(expression.base, name)
				|| expressionUsesIdentifierUnsafely(expression.index, name);
		case SyntaxKind.BinaryExpression:
			if (isUnsafeBinaryOperator(expression.operator)
				&& (expressionUsesIdentifier(expression.left, name) || expressionUsesIdentifier(expression.right, name))) {
				return true;
			}
			return expressionUsesIdentifierUnsafely(expression.left, name)
				|| expressionUsesIdentifierUnsafely(expression.right, name);
		case SyntaxKind.UnaryExpression:
			if (isUnsafeUnaryOperator(expression.operator) && expressionUsesIdentifier(expression.operand, name)) {
				return true;
			}
			return expressionUsesIdentifierUnsafely(expression.operand, name);
		case SyntaxKind.CallExpression:
			if (expressionUsesIdentifier(expression.callee, name) || expressionUsesIdentifierUnsafely(expression.callee, name)) {
				return true;
			}
			for (const argument of expression.arguments) {
				if (expressionUsesIdentifierUnsafely(argument, name)) {
					return true;
				}
			}
			return false;
		case SyntaxKind.TableConstructorExpression:
			for (const field of expression.fields) {
				if (field.kind === TableFieldKind.ExpressionKey && expressionUsesIdentifierUnsafely(field.key, name)) {
					return true;
				}
				if (expressionUsesIdentifierUnsafely(field.value, name)) {
					return true;
				}
			}
			return false;
		case SyntaxKind.FunctionExpression:
			// Nested function bodies are intentionally excluded for this rule.
			return false;
		default:
			return false;
	}
}

export function blockDirectlyAssignsIdentifier(blockStatements: ReadonlyArray<Statement>, name: string): boolean {
	for (const statement of blockStatements) {
		if (assignmentDirectlyTargetsIdentifier(statement, name)) {
			return true;
		}
	}
	return false;
}

export function isSingleBranchConditionalAssignment(statement: IfStatement, name: string): boolean {
	if (statement.clauses.length !== 1) {
		return false;
	}
	const onlyClause = statement.clauses[0];
	if (!onlyClause.condition) {
		return false;
	}
	return blockDirectlyAssignsIdentifier(onlyClause.block.body, name);
}

export function statementUsesIdentifierUnsafelyInCurrentScope(statement: Statement, name: string): boolean {
	switch (statement.kind) {
		case SyntaxKind.LocalAssignmentStatement:
			for (const value of statement.values) {
				if (expressionUsesIdentifierUnsafely(value, name)) {
					return true;
				}
			}
			return false;
		case SyntaxKind.AssignmentStatement:
			for (const left of statement.left) {
				if (left.kind === SyntaxKind.IdentifierExpression && left.name === name) {
					if (statement.operator !== AssignmentOperator.Assign) {
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
		case SyntaxKind.LocalFunctionStatement:
		case SyntaxKind.FunctionDeclarationStatement:
			return false;
			case SyntaxKind.ReturnStatement:
				for (const expression of statement.expressions) {
					if (expressionUsesIdentifierUnsafely(expression, name)) {
						return true;
					}
				}
				return false;
			case SyntaxKind.IfStatement:
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
			case SyntaxKind.WhileStatement:
				if (expressionUsesIdentifierUnsafely(statement.condition, name)) {
					return true;
				}
				for (const nested of statement.block.body) {
					if (statementUsesIdentifierUnsafelyInCurrentScope(nested, name)) {
						return true;
					}
				}
				return false;
			case SyntaxKind.RepeatStatement:
				for (const nested of statement.block.body) {
					if (statementUsesIdentifierUnsafelyInCurrentScope(nested, name)) {
						return true;
					}
				}
				return expressionUsesIdentifierUnsafely(statement.condition, name);
			case SyntaxKind.ForNumericStatement:
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
			case SyntaxKind.ForGenericStatement:
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
			case SyntaxKind.DoStatement:
				for (const nested of statement.block.body) {
					if (statementUsesIdentifierUnsafelyInCurrentScope(nested, name)) {
						return true;
					}
				}
				return false;
			case SyntaxKind.CallStatement:
				return expressionUsesIdentifierUnsafely(statement.expression, name);
			case SyntaxKind.BreakStatement:
			case SyntaxKind.GotoStatement:
			case SyntaxKind.LabelStatement:
				return false;
		default:
			return false;
	}
}
