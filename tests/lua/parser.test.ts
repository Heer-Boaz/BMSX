import assert from 'node:assert/strict';
import { test } from 'node:test';
import { splitText } from '../../src/bmsx/common/text_lines';
import { LuaLexer } from '../../src/bmsx/lua/syntax/lexer';
import { LuaParser } from '../../src/bmsx/lua/syntax/parser';
import { LuaSyntaxKind, LuaBinaryOperator, LuaAssignmentOperator, LuaUnaryOperator } from '../../src/bmsx/lua/syntax/ast';
import type {
	LuaChunk,
	LuaCallStatement,
	LuaCallExpression,
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
	LuaReturnStatement,
	LuaIdentifierExpression,
	LuaStringLiteralExpression,
	LuaTableConstructorExpression,
	LuaIndexExpression,
} from '../../src/bmsx/lua/syntax/ast';

function parseChunk(source: string): LuaChunk {
	const lexer = new LuaLexer(source, 'path');
	const tokens = lexer.scanTokens();
	const parser = new LuaParser(tokens, 'path', splitText(source));
	return parser.parseChunk();
}

test('parses local assignment with multiple values', () => {
	const path = parseChunk('local a, b = 1, 2');
	assert.equal(path.body.length, 1);
	const statement = path.body[0];
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
	const path = parseChunk('function module.object:method(x, y, ...)\nreturn x + y\nend');
	assert.equal(path.body.length, 1);
	const statement = path.body[0];
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
	const path = parseChunk(source);
	assert.equal(path.body.length, 1);
	const statement = path.body[0];
	assert.equal(statement.kind, LuaSyntaxKind.IfStatement);
	const ifStatement = statement as LuaIfStatement;
	assert.equal(ifStatement.clauses.length, 3);
	assert.notEqual(ifStatement.clauses[0].condition, null);
	assert.notEqual(ifStatement.clauses[1].condition, null);
	assert.equal(ifStatement.clauses[2].condition, null);
});

test('parses numeric for loop', () => {
	const path = parseChunk('for i = 1, 10, 2 do sum = sum + i end');
	assert.equal(path.body.length, 1);
	const statement = path.body[0];
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
	const path = parseChunk('t[i] = t[i] + 1\nprint("updated")');
	assert.equal(path.body.length, 2);
	const assignment = path.body[0];
	assert.equal(assignment.kind, LuaSyntaxKind.AssignmentStatement);
	const assignmentStatement = assignment as LuaAssignmentStatement;
	assert.equal(assignmentStatement.left.length, 1);
	assert.equal(assignmentStatement.right.length, 1);
	assert.equal(assignmentStatement.operator, LuaAssignmentOperator.Assign);
	const callStatement = path.body[1];
	assert.equal(callStatement.kind, LuaSyntaxKind.CallStatement);
	const call = callStatement as LuaCallStatement;
	assert.equal(call.expression.kind, LuaSyntaxKind.CallExpression);
});

test('parses augmented assignment statement', () => {
	const path = parseChunk('value += 1');
	assert.equal(path.body.length, 1);
	const statement = path.body[0] as LuaAssignmentStatement;
	assert.equal(statement.kind, LuaSyntaxKind.AssignmentStatement);
	assert.equal(statement.left.length, 1);
	assert.equal(statement.right.length, 1);
	assert.equal(statement.operator, LuaAssignmentOperator.AddAssign);
});

test('parses unary minus with exponent precedence', () => {
	const path = parseChunk('local value = -2 ^ 2');
	const statement = path.body[0] as LuaLocalAssignmentStatement;
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
	const path = parseChunk('::loop::\ngoto loop');
	assert.equal(path.body.length, 2);
	const label = path.body[0] as LuaLabelStatement;
	assert.equal(label.kind, LuaSyntaxKind.LabelStatement);
	assert.equal(label.label, 'loop');
	const gotoStatement = path.body[1] as LuaGotoStatement;
	assert.equal(gotoStatement.kind, LuaSyntaxKind.GotoStatement);
	assert.equal(gotoStatement.label, 'loop');
});

test('parses floor division operator', () => {
	const path = parseChunk('return a // b');
	assert.equal(path.body.length, 1);
	const statement = path.body[0] as LuaReturnStatement;
	assert.equal(statement.kind, LuaSyntaxKind.ReturnStatement);
	assert.equal(statement.expressions.length, 1);
	const binary = statement.expressions[0] as LuaBinaryExpression;
	assert.equal(binary.operator, LuaBinaryOperator.FloorDivide);
});

test('parses bitwise operator precedence', () => {
	const path = parseChunk('return a | b ~ c & d');
	const statement = path.body[0] as LuaReturnStatement;
	const root = statement.expressions[0] as LuaBinaryExpression;
	assert.equal(root.operator, LuaBinaryOperator.BitwiseOr);
	const left = root.left as LuaIdentifierExpression;
	assert.equal(left.name, 'a');
	const xorExpression = root.right as LuaBinaryExpression;
	assert.equal(xorExpression.operator, LuaBinaryOperator.BitwiseXor);
	const andExpression = xorExpression.right as LuaBinaryExpression;
	assert.equal(andExpression.operator, LuaBinaryOperator.BitwiseAnd);
});

test('parses shift operators as left associative', () => {
	const path = parseChunk('return a << b >> c');
	const statement = path.body[0] as LuaReturnStatement;
	const root = statement.expressions[0] as LuaBinaryExpression;
	assert.equal(root.operator, LuaBinaryOperator.ShiftRight);
	const left = root.left as LuaBinaryExpression;
	assert.equal(left.operator, LuaBinaryOperator.ShiftLeft);
});

test('parses unary bitwise not', () => {
	const path = parseChunk('return ~value');
	const statement = path.body[0] as LuaReturnStatement;
	const unary = statement.expressions[0] as LuaUnaryExpression;
	assert.equal(unary.operator, LuaUnaryOperator.BitwiseNot);
});

test('parses paren-less single string argument calls', () => {
	const simpleChunk = parseChunk('f "x"');
	const simpleCall = simpleChunk.body[0] as LuaCallStatement;
	const simpleExpression = simpleCall.expression as LuaCallExpression;
	assert.equal(simpleExpression.methodName, null);
	assert.equal((simpleExpression.arguments[0] as LuaStringLiteralExpression).value, 'x');

	const singleQuoteChunk = parseChunk("f 'x'");
	const singleQuoteCall = singleQuoteChunk.body[0] as LuaCallStatement;
	const singleQuoteExpression = singleQuoteCall.expression as LuaCallExpression;
	assert.equal((singleQuoteExpression.arguments[0] as LuaStringLiteralExpression).value, 'x');

	const longStringChunk = parseChunk('f [[multi line]]');
	const longStringCall = longStringChunk.body[0] as LuaCallStatement;
	const longStringExpression = longStringCall.expression as LuaCallExpression;
	assert.equal((longStringExpression.arguments[0] as LuaStringLiteralExpression).value, 'multi line');

	const methodChunk = parseChunk('obj:method "arg"');
	const methodCall = methodChunk.body[0] as LuaCallStatement;
	const methodExpression = methodCall.expression as LuaCallExpression;
	assert.equal(methodExpression.methodName, 'method');
	assert.equal((methodExpression.callee as LuaIdentifierExpression).name, 'obj');
	assert.equal((methodExpression.arguments[0] as LuaStringLiteralExpression).value, 'arg');

	const chainedChunk = parseChunk('(f())[1] "x"');
	const chainedCall = chainedChunk.body[0] as LuaCallStatement;
	const chainedExpression = chainedCall.expression as LuaCallExpression;
	assert.equal((chainedExpression.arguments[0] as LuaStringLiteralExpression).value, 'x');
	const calleeIndex = chainedExpression.callee as LuaIndexExpression;
	const indexedBase = calleeIndex.base as LuaCallExpression;
	assert.equal(indexedBase.arguments.length, 0);
});

test('parses paren-less table constructor arguments', () => {
	const path = parseChunk(`f { 1, 2, 3 }
obj:method { key = "value" }`);
	assert.equal(path.body.length, 2);

	const firstCall = path.body[0] as LuaCallStatement;
	const firstExpression = firstCall.expression as LuaCallExpression;
	const tableArg = firstExpression.arguments[0] as LuaTableConstructorExpression;
	assert.equal(tableArg.fields.length, 3);

	const methodCall = path.body[1] as LuaCallStatement;
	const methodExpression = methodCall.expression as LuaCallExpression;
	assert.equal(methodExpression.methodName, 'method');
	const methodTableArg = methodExpression.arguments[0] as LuaTableConstructorExpression;
	assert.equal(methodTableArg.fields.length, 1);
});

test('rejects invalid paren-less call arguments', () => {
	assert.throws(() => parseChunk('f 1'));
	assert.throws(() => parseChunk('f x'));
	const path = parseChunk("return f 'a' .. 'b'");
	const statement = path.body[0] as LuaReturnStatement;
	const binary = statement.expressions[0] as LuaBinaryExpression;
	assert.equal(binary.operator, LuaBinaryOperator.Concat);
	const callLeft = binary.left as LuaCallExpression;
	assert.equal((callLeft.arguments[0] as LuaStringLiteralExpression).value, 'a');
	const right = binary.right as LuaStringLiteralExpression;
	assert.equal(right.value, 'b');
});
