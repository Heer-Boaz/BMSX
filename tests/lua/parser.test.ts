import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LuaLexer } from '../../src/bmsx/lua/lexer';
import { LuaParser } from '../../src/bmsx/lua/parser';
import { LuaSyntaxKind, LuaBinaryOperator, LuaAssignmentOperator } from '../../src/bmsx/lua/ast';
import type {
	LuaChunk,
	LuaCallStatement,
	LuaFunctionDeclarationStatement,
	LuaIfStatement,
	LuaLocalAssignmentStatement,
	LuaNumericLiteralExpression,
	LuaForNumericStatement,
	LuaAssignmentStatement,
	LuaUnaryExpression,
	LuaBinaryExpression,
	LuaGotoStatement,
	LuaLabelStatement,
} from '../../src/bmsx/lua/ast';

function parseChunk(source: string): LuaChunk {
	const lexer = new LuaLexer(source, 'chunk');
	const tokens = lexer.scanTokens();
	const parser = new LuaParser(tokens, 'chunk');
	return parser.parseChunk();
}

test('parses local assignment with multiple values', () => {
	const chunk = parseChunk('local a, b = 1, 2');
	assert.equal(chunk.body.length, 1);
	const statement = chunk.body[0];
	assert.equal(statement.kind, LuaSyntaxKind.LocalAssignmentStatement);
	const localStatement = statement as LuaLocalAssignmentStatement;
	assert.equal(localStatement.names.length, 2);
	assert.equal(localStatement.names[0].name, 'a');
	assert.equal(localStatement.names[1].name, 'b');
	assert.equal(localStatement.values.length, 2);
	const firstValue = localStatement.values[0] as LuaNumericLiteralExpression;
	const secondValue = localStatement.values[1] as LuaNumericLiteralExpression;
	assert.equal(firstValue.value, 1);
	assert.equal(secondValue.value, 2);
});

test('parses function declaration with method name and parameters', () => {
	const chunk = parseChunk('function module.object:method(x, y, ...)\nreturn x + y\nend');
	assert.equal(chunk.body.length, 1);
	const statement = chunk.body[0];
	assert.equal(statement.kind, LuaSyntaxKind.FunctionDeclarationStatement);
	const functionStatement = statement as LuaFunctionDeclarationStatement;
	assert.deepEqual(functionStatement.name.identifiers, ['module', 'object']);
	assert.equal(functionStatement.name.methodName, 'method');
	const funcExpr = functionStatement.functionExpression;
	assert.equal(funcExpr.parameters.length, 2);
	assert.equal(funcExpr.parameters[0].name, 'x');
	assert.equal(funcExpr.parameters[1].name, 'y');
	assert.equal(funcExpr.hasVararg, true);
	assert.equal(funcExpr.body.body.length, 1);
});

test('parses if-elseif-else statement', () => {
	const source = `
if a then
	call()
elseif b then
	call_b()
else
	call_c()
end`;
	const chunk = parseChunk(source);
	assert.equal(chunk.body.length, 1);
	const statement = chunk.body[0];
	assert.equal(statement.kind, LuaSyntaxKind.IfStatement);
	const ifStatement = statement as LuaIfStatement;
	assert.equal(ifStatement.clauses.length, 3);
	assert.notEqual(ifStatement.clauses[0].condition, null);
	assert.notEqual(ifStatement.clauses[1].condition, null);
	assert.equal(ifStatement.clauses[2].condition, null);
});

test('parses numeric for loop', () => {
	const chunk = parseChunk('for i = 1, 10, 2 do sum = sum + i end');
	assert.equal(chunk.body.length, 1);
	const statement = chunk.body[0];
	assert.equal(statement.kind, LuaSyntaxKind.ForNumericStatement);
	const forStatement = statement as LuaForNumericStatement;
	assert.equal(forStatement.variable.name, 'i');
	const start = forStatement.start as LuaNumericLiteralExpression;
	const limit = forStatement.limit as LuaNumericLiteralExpression;
	assert.equal(start.value, 1);
	assert.equal(limit.value, 10);
	assert.notEqual(forStatement.step, null);
	assert.equal(forStatement.block.body.length, 1);
});

test('parses table assignment and preserves call statement', () => {
	const chunk = parseChunk('t[i] = t[i] + 1\nprint("updated")');
	assert.equal(chunk.body.length, 2);
	const assignment = chunk.body[0];
	assert.equal(assignment.kind, LuaSyntaxKind.AssignmentStatement);
	const assignmentStatement = assignment as LuaAssignmentStatement;
	assert.equal(assignmentStatement.left.length, 1);
	assert.equal(assignmentStatement.right.length, 1);
	assert.equal(assignmentStatement.operator, LuaAssignmentOperator.Assign);
	const callStatement = chunk.body[1];
	assert.equal(callStatement.kind, LuaSyntaxKind.CallStatement);
	const call = callStatement as LuaCallStatement;
	assert.equal(call.expression.kind, LuaSyntaxKind.CallExpression);
});

test('parses augmented assignment statement', () => {
	const chunk = parseChunk('value += 1');
	assert.equal(chunk.body.length, 1);
	const statement = chunk.body[0] as LuaAssignmentStatement;
	assert.equal(statement.kind, LuaSyntaxKind.AssignmentStatement);
	assert.equal(statement.left.length, 1);
	assert.equal(statement.right.length, 1);
	assert.equal(statement.operator, LuaAssignmentOperator.AddAssign);
});

test('parses unary minus with exponent precedence', () => {
	const chunk = parseChunk('local value = -2 ^ 2');
	const statement = chunk.body[0] as LuaLocalAssignmentStatement;
	assert.equal(statement.values.length, 1);
	const unary = statement.values[0] as LuaUnaryExpression;
	assert.equal(unary.kind, LuaSyntaxKind.UnaryExpression);
	const binary = unary.operand as LuaBinaryExpression;
	assert.equal(binary.operator, LuaBinaryOperator.Exponent);
	const base = binary.left as LuaNumericLiteralExpression;
	const exponent = binary.right as LuaNumericLiteralExpression;
	assert.equal(base.value, 2);
	assert.equal(exponent.value, 2);
});

test('parses goto and label statements', () => {
	const chunk = parseChunk('::loop::\ngoto loop');
	assert.equal(chunk.body.length, 2);
	const label = chunk.body[0] as LuaLabelStatement;
	assert.equal(label.kind, LuaSyntaxKind.LabelStatement);
	assert.equal(label.label, 'loop');
	const gotoStatement = chunk.body[1] as LuaGotoStatement;
	assert.equal(gotoStatement.kind, LuaSyntaxKind.GotoStatement);
	assert.equal(gotoStatement.label, 'loop');
});
