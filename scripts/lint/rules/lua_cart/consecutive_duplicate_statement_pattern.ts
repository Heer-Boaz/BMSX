import {
	LuaSyntaxKind as SyntaxKind,
	type LuaExpression as Expression,
	type LuaSourcePosition as SourcePosition,
	type LuaStatement as Statement,
} from '../../../../toolchain/ts/lua/syntax/ast';
import { visitLuaExpressionChildren } from '../../../../toolchain/ts/lua/syntax/ast/traversal';
import { type LuaToken as Token } from '../../../../toolchain/ts/lua/syntax/token';
import { type CartLintIssue } from '../../lua_rule';
import { consecutiveDuplicateStatementPatternRule } from '../common/consecutive_duplicate_statement_pattern';
import { pushIssue } from './impl/support/lint_context';

const duplicateMessage = 'Consecutive duplicate statement is forbidden. Remove the duplicate or replace intentional repetition with a named loop/helper.';

export function lintConsecutiveDuplicateStatementPattern(statements: ReadonlyArray<Statement>, tokens: ReadonlyArray<Token>, issues: CartLintIssue[]): void {
	if (statements.length > 1) {
		let previous = statements[0];
		let previousStart = firstTokenAtOrAfter(tokens, previous.range.start);
		let previousEnd = firstTokenAfter(tokens, previous.range.end);
		for (let index = 1; index < statements.length; index += 1) {
			const statement = statements[index];
			const start = firstTokenAtOrAfter(tokens, statement.range.start);
			const end = firstTokenAfter(tokens, statement.range.end);
			if (statement.kind !== SyntaxKind.CallStatement
				&& statement.kind === previous.kind
				&& tokensEqual(tokens, previousStart, previousEnd, start, end)) {
				pushIssue(issues, consecutiveDuplicateStatementPatternRule.name, statement, duplicateMessage);
			}
			previous = statement;
			previousStart = start;
			previousEnd = end;
		}
	}
	for (let index = 0; index < statements.length; index += 1) {
		lintStatementChildren(statements[index], tokens, issues);
	}
}

function lintStatementChildren(statement: Statement, tokens: ReadonlyArray<Token>, issues: CartLintIssue[]): void {
	switch (statement.kind) {
		case SyntaxKind.AssignmentStatement:
			lintExpressions(statement.left, tokens, issues);
			lintExpressions(statement.right, tokens, issues);
			return;
		case SyntaxKind.LocalAssignmentStatement:
			lintExpressions(statement.values, tokens, issues);
			return;
		case SyntaxKind.LocalFunctionStatement:
		case SyntaxKind.FunctionDeclarationStatement:
			lintConsecutiveDuplicateStatementPattern(statement.functionExpression.body.body, tokens, issues);
			return;
		case SyntaxKind.ReturnStatement:
			lintExpressions(statement.expressions, tokens, issues);
			return;
		case SyntaxKind.IfStatement:
			for (let index = 0; index < statement.clauses.length; index += 1) {
				const clause = statement.clauses[index];
				if (clause.condition !== null) {
					lintExpression(clause.condition, tokens, issues);
				}
				lintConsecutiveDuplicateStatementPattern(clause.block.body, tokens, issues);
			}
			return;
		case SyntaxKind.WhileStatement:
			lintExpression(statement.condition, tokens, issues);
			lintConsecutiveDuplicateStatementPattern(statement.block.body, tokens, issues);
			return;
		case SyntaxKind.RepeatStatement:
			lintConsecutiveDuplicateStatementPattern(statement.block.body, tokens, issues);
			lintExpression(statement.condition, tokens, issues);
			return;
		case SyntaxKind.ForNumericStatement:
			lintExpression(statement.start, tokens, issues);
			lintExpression(statement.limit, tokens, issues);
			if (statement.step !== null) {
				lintExpression(statement.step, tokens, issues);
			}
			lintConsecutiveDuplicateStatementPattern(statement.block.body, tokens, issues);
			return;
		case SyntaxKind.ForGenericStatement:
			lintExpressions(statement.iterators, tokens, issues);
			lintConsecutiveDuplicateStatementPattern(statement.block.body, tokens, issues);
			return;
		case SyntaxKind.DoStatement:
			lintConsecutiveDuplicateStatementPattern(statement.block.body, tokens, issues);
			return;
		case SyntaxKind.DataDeclarationStatement:
		case SyntaxKind.RodataDeclarationStatement:
			lintExpression(statement.initializer, tokens, issues);
			return;
		case SyntaxKind.CallStatement:
			lintExpression(statement.expression, tokens, issues);
			return;
		case SyntaxKind.BreakStatement:
		case SyntaxKind.HaltUntilIrqStatement:
		case SyntaxKind.StructDeclarationStatement:
		case SyntaxKind.BssDeclarationStatement:
		case SyntaxKind.GotoStatement:
		case SyntaxKind.LabelStatement:
			return;
	}
}

function lintExpressions(expressions: ReadonlyArray<Expression>, tokens: ReadonlyArray<Token>, issues: CartLintIssue[]): void {
	for (let index = 0; index < expressions.length; index += 1) {
		lintExpression(expressions[index], tokens, issues);
	}
}

function lintExpression(expression: Expression, tokens: ReadonlyArray<Token>, issues: CartLintIssue[]): void {
	if (expression.kind === SyntaxKind.FunctionExpression) {
		lintConsecutiveDuplicateStatementPattern(expression.body.body, tokens, issues);
		return;
	}
	visitLuaExpressionChildren(expression, child => {
		lintExpression(child, tokens, issues);
	});
}

function firstTokenAtOrAfter(tokens: ReadonlyArray<Token>, position: SourcePosition): number {
	let low = 0;
	let high = tokens.length;
	while (low < high) {
		const middle = (low + high) >>> 1;
		if (tokenStartsBefore(tokens[middle], position)) {
			low = middle + 1;
		}
		else {
			high = middle;
		}
	}
	return low;
}

function firstTokenAfter(tokens: ReadonlyArray<Token>, position: SourcePosition): number {
	let low = 0;
	let high = tokens.length;
	while (low < high) {
		const middle = (low + high) >>> 1;
		if (tokenStartsAfter(tokens[middle], position)) {
			high = middle;
		}
		else {
			low = middle + 1;
		}
	}
	return low;
}

function tokenStartsBefore(token: Token, position: SourcePosition): boolean {
	return token.line < position.line || (token.line === position.line && token.column < position.column);
}

function tokenStartsAfter(token: Token, position: SourcePosition): boolean {
	return token.line > position.line || (token.line === position.line && token.column > position.column);
}

function tokensEqual(tokens: ReadonlyArray<Token>, leftStart: number, leftEnd: number, rightStart: number, rightEnd: number): boolean {
	const count = leftEnd - leftStart;
	if (count !== rightEnd - rightStart) {
		return false;
	}
	for (let index = 0; index < count; index += 1) {
		const left = tokens[leftStart + index];
		const right = tokens[rightStart + index];
		if (left.type !== right.type || left.lexeme !== right.lexeme) {
			return false;
		}
	}
	return true;
}
