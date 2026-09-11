import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FunctionSummaryStore } from '../../toolchain/ts/lua/semantic/function_summary';
import { WorkspaceValueIdentityIndex } from '../../toolchain/ts/lua/semantic/identity';
import { buildLuaFileSemanticData, LuaSemanticWorkspace } from '../../toolchain/ts/lua/semantic/model';
import { declarationValueSource, literalValueSource, semanticValueSourceKey, semanticValueSourcesEqual } from '../../toolchain/ts/lua/semantic/value_graph';
import { LuaSyntaxKind } from '../../toolchain/ts/lua/syntax/ast';
import { semanticSymbolAt } from './semantic_test_harness';

test('bound function, table and call values retain their actual constructor occurrences', () => {
	const file = buildLuaFileSemanticData([
		'local function make(value) return { item = value } end',
		'local first<const> = make({ token = true })',
		'local second<const> = make({ token = true })',
		'return first.item.token, second.item.token',
	].join('\n'), 'origins.lua');
	const [declaration, first, second] = file.chunk.body;
	assert.ok(declaration.kind === LuaSyntaxKind.LocalFunctionStatement);
	assert.ok(first.kind === LuaSyntaxKind.LocalAssignmentStatement);
	assert.ok(second.kind === LuaSyntaxKind.LocalAssignmentStatement);
	assert.ok(first.values[0].kind === LuaSyntaxKind.CallExpression);
	assert.ok(second.values[0].kind === LuaSyntaxKind.CallExpression);
	const flow = file.functionValueFlows[0];
	assert.equal(file.ownedValuesBySyntax.get(declaration.functionExpression), flow.functionValue);
	assert.equal(flow.functionValue.root.syntax, declaration.functionExpression);
	const call = file.callValues.find(entry => entry.result === file.ownedValuesBySyntax.get(first.values[0]))!;
	assert.equal(call.result!.root.syntax, first.values[0]);
	assert.equal(call.arguments[0], file.ownedValuesBySyntax.get(first.values[0].arguments[0]));
	const firstTable = file.ownedValuesBySyntax.get(first.values[0].arguments[0])!;
	const secondTable = file.ownedValuesBySyntax.get(second.values[0].arguments[0])!;
	assert.notEqual(firstTable.root.id, secondTable.root.id);
	assert.equal(semanticValueSourcesEqual(firstTable, secondTable), false);
	assert.equal(flow.ownedValues.length, 1, 'only the constructor in this body belongs to the function');
	assert.equal(flow.ownedValues[0], file.ownedValuesBySyntax.get(flow.returns[0].statement.expressions[0]));
	const ids = new Set([...file.ownedValuesBySyntax.values()].map(value => value.root.id));
	assert.equal(ids.size, file.ownedValuesBySyntax.size);
});

test('implicit receiver and closure share syntax but not bound value identity', () => {
	const file = buildLuaFileSemanticData([
		'local api<const> = {}',
		'function api:step() self = {}; return function() return self end end',
	].join('\n'), 'receiver.lua');
	const [inner, outer] = file.functionValueFlows;
	const receiver = outer.parameters[0];
	assert.ok(receiver.root.kind === 'owned');
	assert.equal(receiver.root.role, 'receiver');
	assert.equal(receiver.root.syntax, outer.expression);
	assert.equal(outer.functionValue.root.role, 'expression');
	assert.equal(outer.functionValue.root.syntax, outer.expression);
	assert.notEqual(receiver.root.id, outer.functionValue.root.id);
	assert.equal(file.ownedValuesBySyntax.get(outer.expression), outer.functionValue);
	assert.ok(outer.ownedValues.some(value => value === receiver));
	assert.ok(outer.ownedValues.includes(inner.functionValue));
	assert.ok(!inner.ownedValues.includes(inner.functionValue), 'a closure is constructed in its lexical owner');
	const summaries = new FunctionSummaryStore([file], new WorkspaceValueIdentityIndex({ files: [file], globalValues: new Map() }));
	const outerSummary = summaries.list().find(summary => summary.source === outer)!;
	assert.equal(summaries.terms.summaryOwner(summaries.terms.compileSource(receiver)), outerSummary.id);
});

test('rebinding identical syntax does not reuse another binding generation of owned roots', () => {
	const source = 'return { item = true }';
	const first = buildLuaFileSemanticData(source, 'provider.lua');
	const second = buildLuaFileSemanticData(source, 'provider.lua', undefined, first.chunk);
	const statement = first.chunk.body[0];
	assert.ok(statement.kind === LuaSyntaxKind.ReturnStatement);
	const expression = statement.expressions[0];
	const firstValue = first.ownedValuesBySyntax.get(expression)!;
	const secondValue = second.ownedValuesBySyntax.get(expression)!;
	assert.equal(firstValue.root.syntax, secondValue.root.syntax, 'the parser node may itself be retained');
	assert.notEqual(firstValue.root.id, secondValue.root.id);
	assert.notEqual(semanticValueSourceKey(firstValue), semanticValueSourceKey(secondValue));
	assert.equal(first.moduleValues[0].source, firstValue, 'exports retain the real returned constructor');
	assert.equal(second.moduleValues[0].source, secondValue);
});

test('module aliases use new provider origins without mutating retained consumer or old snapshot', () => {
	const consumer = buildLuaFileSemanticData([
		"local provider<const> = require('provider')",
		'return provider.item',
	].join('\n'), 'consumer.lua');
	const first = buildLuaFileSemanticData('return { item = true }', 'provider.lua');
	const workspace = new LuaSemanticWorkspace();
	workspace.updateFiles([first, consumer]);
	const oldSnapshot = workspace.getSnapshot();
	assert.equal(semanticSymbolAt(oldSnapshot, consumer.file, 2, 17)!.declaration.range.start.line, 1);
	const next = buildLuaFileSemanticData('return {\n  item = false\n}', first.file);
	workspace.updateFiles([next]);
	const current = workspace.getSnapshot();
	assert.equal(current.getFileData(consumer.file), consumer);
	assert.equal(current.getFileData(consumer.file)!.ownedValuesBySyntax, consumer.ownedValuesBySyntax);
	assert.equal(semanticSymbolAt(current, consumer.file, 2, 17)!.declaration.range.start.line, 2);
	assert.equal(semanticSymbolAt(oldSnapshot, consumer.file, 2, 17)!.declaration.range.start.line, 1);
	assert.notEqual(first.moduleValues[0].source, next.moduleValues[0].source);
	assert.equal(first.moduleValues[0].source.root.kind, 'owned');
});

test('a retained canonical root still receives classification from later compiled raw roots', () => {
	const file = buildLuaFileSemanticData('local index<const> = 3', 'literal.lua');
	const identities = new WorkspaceValueIdentityIndex({ files: [file], globalValues: new Map() });
	const terms = new FunctionSummaryStore([file], identities).terms;
	const declaration = declarationValueSource(file.decls[0].id);
	const declaredTerm = terms.compileSource(declaration);
	const literal = literalValueSource({ kind: 'number', value: 3 });
	assert.equal(terms.compileSource(literal), declaredTerm);
	assert.equal(terms.isNumericLiteral(declaredTerm), true);
	assert.equal(terms.compileSource(declaration), declaredTerm);
	assert.equal(terms.compileSource(literal), declaredTerm);
});
