import {
	LuaSyntaxKind as SyntaxKind,
	type LuaExpression as Expression,
	type LuaStatement as Statement,
} from '../../../../toolchain/ts/lua/syntax/ast';
import { visitLuaExpressionChildren } from '../../../../toolchain/ts/lua/syntax/ast/traversal';
import type { LuaTokenSequence } from '../../../../toolchain/ts/lua/syntax/token_sequence';
import { type CartLintContext } from '../../lua_rule';
import { consecutiveDuplicateStatementPatternRule } from '../common/consecutive_duplicate_statement_pattern';
import { pushIssue } from './impl/support/lint_context';

const duplicateMessage = 'Consecutive duplicate statement is forbidden. Remove the duplicate or replace intentional repetition with a named loop/helper.';

export function lintConsecutiveDuplicateStatementPattern(statements: ReadonlyArray<Statement>, tokens: LuaTokenSequence, lint: CartLintContext): void {
	if (statements.length > 1) {
		let previous = statements[0];
		let previousStart = lint.locations.offset(previous.span.unit, previous.span.start);
		let previousEnd = lint.locations.offset(previous.span.unit, previous.span.end);
		for (let index = 1; index < statements.length; index += 1) {
			const statement = statements[index];
			const start = lint.locations.offset(statement.span.unit, statement.span.start);
			const end = lint.locations.offset(statement.span.unit, statement.span.end);
			if (statement.kind !== SyntaxKind.CallStatement
				&& statement.kind === previous.kind
				&& tokensEqual(tokens, previousStart, previousEnd, start, end)) {
				pushIssue(lint, consecutiveDuplicateStatementPatternRule.name, statement, duplicateMessage);
			}
			previous = statement;
			previousStart = start;
			previousEnd = end;
		}
	}
	for (let index = 0; index < statements.length; index += 1) {
		lintStatementChildren(statements[index], tokens, lint);
	}
}

function lintStatementChildren(statement: Statement, tokens: LuaTokenSequence, lint: CartLintContext): void {
	switch (statement.kind) {
		case SyntaxKind.AssignmentStatement:
			lintExpressions(statement.left, tokens, lint);
			lintExpressions(statement.right, tokens, lint);
			return;
		case SyntaxKind.LocalAssignmentStatement:
			lintExpressions(statement.values, tokens, lint);
			return;
		case SyntaxKind.LocalFunctionStatement:
		case SyntaxKind.FunctionDeclarationStatement:
			lintConsecutiveDuplicateStatementPattern(statement.functionExpression.body.body, tokens, lint);
			return;
		case SyntaxKind.ReturnStatement:
			lintExpressions(statement.expressions, tokens, lint);
			return;
		case SyntaxKind.IfStatement:
			for (let index = 0; index < statement.clauses.length; index += 1) {
				const clause = statement.clauses[index];
				if (clause.condition !== null) {
					lintExpression(clause.condition, tokens, lint);
				}
				lintConsecutiveDuplicateStatementPattern(clause.block.body, tokens, lint);
			}
			return;
		case SyntaxKind.WhileStatement:
			lintExpression(statement.condition, tokens, lint);
			lintConsecutiveDuplicateStatementPattern(statement.block.body, tokens, lint);
			return;
		case SyntaxKind.RepeatStatement:
			lintConsecutiveDuplicateStatementPattern(statement.block.body, tokens, lint);
			lintExpression(statement.condition, tokens, lint);
			return;
		case SyntaxKind.ForNumericStatement:
			lintExpression(statement.start, tokens, lint);
			lintExpression(statement.limit, tokens, lint);
			if (statement.step !== null) {
				lintExpression(statement.step, tokens, lint);
			}
			lintConsecutiveDuplicateStatementPattern(statement.block.body, tokens, lint);
			return;
		case SyntaxKind.ForGenericStatement:
			lintExpressions(statement.iterators, tokens, lint);
			lintConsecutiveDuplicateStatementPattern(statement.block.body, tokens, lint);
			return;
		case SyntaxKind.DoStatement:
			lintConsecutiveDuplicateStatementPattern(statement.block.body, tokens, lint);
			return;
		case SyntaxKind.DataDeclarationStatement:
		case SyntaxKind.RodataDeclarationStatement:
			lintExpression(statement.initializer, tokens, lint);
			return;
		case SyntaxKind.CallStatement:
			lintExpression(statement.expression, tokens, lint);
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

function lintExpressions(expressions: ReadonlyArray<Expression>, tokens: LuaTokenSequence, lint: CartLintContext): void {
	for (let index = 0; index < expressions.length; index += 1) {
		lintExpression(expressions[index], tokens, lint);
	}
}

function lintExpression(expression: Expression, tokens: LuaTokenSequence, lint: CartLintContext): void {
	if (expression.kind === SyntaxKind.FunctionExpression) {
		lintConsecutiveDuplicateStatementPattern(expression.body.body, tokens, lint);
		return;
	}
	visitLuaExpressionChildren(expression, child => {
		lintExpression(child, tokens, lint);
	});
}

/** Statement endpoints are significant token boundaries; trivia is not syntax. */
function tokensEqual(tokens: LuaTokenSequence, leftStart: number, leftEnd: number, rightStart: number, rightEnd: number): boolean {
	const left = tokens.cursor(), right = tokens.cursor();
	left.seekOffset(leftStart);
	right.seekOffset(rightStart);
	while (left.offset <= leftEnd && right.offset <= rightEnd) {
		if (left.token!.type !== right.token!.type || left.token!.lexeme !== right.token!.lexeme) return false;
		left.advanceSignificant();
		right.advanceSignificant();
	}
	return left.offset > leftEnd && right.offset > rightEnd;
}
