import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildLuaFileSemanticData, buildLuaSemanticWorkspaceSnapshot, LuaSemanticWorkspace } from '../../toolchain/ts/lua/semantic/model';
import type { LuaWrittenSource } from '../../toolchain/ts/lua/semantic/written_sources';
import { NIL_VALUE_SOURCE, readLuaExpressionSource } from '../../toolchain/ts/lua/semantic/value_graph';
import { LuaSyntaxKind, type LuaReturnStatement } from '../../toolchain/ts/lua/syntax/ast';
import { runCompiledLua } from './cpu_test_harness';

function sourceQuery(source: string) {
	const file = buildLuaFileSemanticData(source, 'sources.lua');
	const snapshot = buildLuaSemanticWorkspaceSnapshot([{ path: file.file, source, analysis: file }]);
	return { file, query: snapshot.symbolResolver.writtenSources };
}

function writtenLines(sources: readonly LuaWrittenSource[]): number[] {
	return sources.map(source => {
		switch (source.kind) {
			case 'expression': return source.expression.range.start.line;
			case 'binding-input': return source.declaration.range.start.line;
			case 'module-export': return source.export.statement.range.start.line;
			case 'module-bypass': return source.statement.range.start.line;
			case 'receiver-input': {
				assert.ok(source.value.root.kind === 'owned');
				return source.value.root.syntax.range.start.line;
			}
			default: return source.write.syntax.range.start.line;
		}
	});
}

test('bound read values include callees, arguments, literal occurrences and unmodeled computations', () => {
	const { file, query } = sourceQuery(`local function identity(value) return value end
local result = identity('same')
local other = 'same'
return result, other, 1 + 2`);
	const declaration = file.chunk.body[0];
	const assignment = file.chunk.body[1];
	const other = file.chunk.body[2];
	const result = file.chunk.body[3];
	assert.ok(declaration.kind === LuaSyntaxKind.LocalFunctionStatement);
	assert.ok(assignment.kind === LuaSyntaxKind.LocalAssignmentStatement);
	assert.ok(other.kind === LuaSyntaxKind.LocalAssignmentStatement);
	assert.ok(result.kind === LuaSyntaxKind.ReturnStatement);
	const call = assignment.values[0];
	assert.ok(call.kind === LuaSyntaxKind.CallExpression);
	assert.equal(readLuaExpressionSource(file, declaration.functionExpression), file.functionValueFlows[0].functionValue);
	assert.equal(readLuaExpressionSource(file, call), file.callValues[0].result);
	assert.equal(readLuaExpressionSource(file, call.callee), file.callValues[0].callee);
	assert.deepEqual(readLuaExpressionSource(file, call.arguments[0]), file.callValues[0].arguments[0]);
	const firstLiteral = query.expression(file, call.arguments[0]);
	const secondLiteral = query.expression(file, other.values[0]);
	assert.notEqual(firstLiteral, secondLiteral);
	assert.deepEqual(firstLiteral.value, secondLiteral.value);
	assert.equal(query.inputs(firstLiteral).kind, 'terminal');
	assert.equal(query.inputs(secondLiteral).kind, 'terminal');
	assert.equal(query.expression(file, call.arguments[0]), firstLiteral);
	const computed = query.expression(file, result.expressions[2]);
	assert.equal(computed.value.root.kind, 'unknown');
	assert.deepEqual(query.inputs(computed), { kind: 'boundary', reason: 'unknown-value' });
});

test('ordinary local aliases trace written values without requiring const spelling', () => {
	const { file, query } = sourceQuery(`local first = { task = 'walk' }
local second = first
local third = second
return third`);
	const result = file.chunk.body[3] as LuaReturnStatement;
	const root = query.expression(file, result.expressions[0]);
	const trace = query.trace(root);
	assert.deepEqual(writtenLines(trace.sources), [4, 3, 2, 1]);
	assert.deepEqual(writtenLines(trace.terminals), [1]);
	assert.equal(trace.boundaries.length, 0);
	assert.equal(query.trace(root), trace);
	for (const source of trace.sources) assert.equal(query.inputs(source), query.inputs(source));
	for (const declaration of file.decls) {
		const writes = file.declarationValuesByDeclaration.get(declaration.id);
		if (writes !== undefined) assert.deepEqual(writes, file.declarationValues.filter(write => write.declId === declaration.id));
	}
});

test('equal writes, compound unknowns and nil padding retain their actual occurrences', () => {
	const source = `local value, extra = 1
value = 1
value += 3
return value, extra`;
	const { file, query } = sourceQuery(source);
	const result = file.chunk.body[3] as LuaReturnStatement;
	const trace = query.trace(query.expression(file, result.expressions[0]));
	assert.deepEqual(writtenLines(trace.terminals), [1, 2]);
	assert.deepEqual(writtenLines(trace.boundaries.map(boundary => boundary.source)), [3]);
	assert.deepEqual(trace.boundaries.map(boundary => boundary.reason), ['unknown-value']);
	const extra = query.trace(query.expression(file, result.expressions[1]));
	assert.equal(extra.terminals.length, 1);
	const implicit = extra.terminals[0];
	assert.equal(implicit.kind, 'declaration-write');
	assert.ok(implicit.kind === 'declaration-write');
	assert.equal(implicit.write.index, 1);
	assert.equal(implicit.value, NIL_VALUE_SOURCE);
	for (const optimization of [0, 3] as const) assert.deepEqual(runCompiledLua(source, file.file, optimization), [4, null]);
});

test('captured writes retain their containing body without claiming that it ran', () => {
	const { file, query } = sourceQuery(`local value = 'initial'
local function replace() value = 'later' end
return value`);
	const root = query.expression(file, (file.chunk.body[2] as LuaReturnStatement).expressions[0]);
	const trace = query.trace(root);
	assert.deepEqual(writtenLines(trace.terminals), [1, 2]);
	const [initial, later] = trace.terminals;
	assert.ok(initial.kind === 'declaration-write' && later.kind === 'declaration-write');
	assert.equal(initial.write.flow, undefined);
	assert.equal(later.write.flow, file.functionValueFlows[0]);
	assert.deepEqual(runCompiledLua("local value = 1; local function replace() value = 2 end; return value"), [1]);
});

test('logical alternatives preserve unknown and known inputs rather than a closed target count', () => {
	const { file, query } = sourceQuery(`local value = external_value or { task = 'walk' }
return value`);
	const root = query.expression(file, (file.chunk.body[1] as LuaReturnStatement).expressions[0]);
	const trace = query.trace(root);
	assert.equal(trace.terminals.length, 1);
	assert.equal(trace.terminals[0].kind, 'value-transfer');
	assert.equal(trace.boundaries.length, 1);
	assert.equal(trace.boundaries[0].reason, 'unbound-global');
	const transfer = trace.boundaries[0].source;
	assert.ok(transfer.kind === 'value-transfer');
	assert.equal(transfer.write.index, 0);
	assert.equal(transfer.flow, undefined);
});

test('cycles remain source edges and do not recurse or erase an unknown input', () => {
	const { file, query } = sourceQuery(`local left = external_value
local right = left
left = right
return left`);
	const root = query.expression(file, (file.chunk.body[3] as LuaReturnStatement).expressions[0]);
	const trace = query.trace(root);
	assert.deepEqual(writtenLines(trace.sources), [4, 1, 3, 2]);
	assert.equal(trace.terminals.length, 0);
	assert.deepEqual(trace.boundaries.map(boundary => boundary.reason), ['unbound-global']);
	assert.equal(query.inputs(trace.sources[3]), query.inputs(root), 'the back edge reuses the binding contribution set');
});

test('module, access, call and formal input boundaries keep their real source representation', () => {
	const { file, query } = sourceQuery(`local imported = require('library')
local function forward(value) return value end
return imported, imported.item, imported[computed_key], forward({})`);
	const result = file.chunk.body[2] as LuaReturnStatement;
	const traces = result.expressions.map(expression => query.trace(query.expression(file, expression)));
	assert.deepEqual(traces.map(trace => trace.boundaries[0].reason), ['module', 'access-path', 'access-path', 'call-result']);
	assert.equal(traces[1].boundaries[0].source.value.steps[0].kind, 'member');
	assert.equal(traces[2].boundaries[0].source.value.steps[0].kind, 'index');
	const returned = file.functionValueFlows[0].returns[0].statement.expressions[0];
	const formal = query.trace(query.expression(file, returned));
	assert.equal(formal.boundaries[0].reason, 'parameter-input');
});

test('written parameters retain the incoming lane in addition to body writes', () => {
	const { file, query } = sourceQuery(`local function replace(value, condition)
 if condition then value = 7 end
 return value
end
return replace(3, false), replace(3, true)`);
	const returned = file.functionValueFlows[0].returns[0].statement.expressions[0];
	const trace = query.trace(query.expression(file, returned));
	assert.deepEqual(writtenLines(trace.terminals), [2]);
	assert.deepEqual(trace.boundaries.map(boundary => boundary.reason), ['parameter-input']);
	const entry = trace.boundaries[0].source;
	assert.ok(entry.kind === 'binding-input');
	assert.equal(entry.declaration, file.decls.find(declaration => declaration.name === 'value'));
	for (const optimization of [0, 3] as const) assert.deepEqual(runCompiledLua(file.source, file.file, optimization), [3, 7]);
});

test('a reassigned implicit receiver retains its entry input and its own written source', () => {
	const { file, query } = sourceQuery(`local object = {}
function object:pick(replace)
 if replace then self = { field = 8 } end
 return self
end
return object:pick(false) == object, object:pick(true).field == 8`);
	const returned = file.functionValueFlows[0].returns[0].statement.expressions[0];
	const trace = query.trace(query.expression(file, returned));
	assert.deepEqual(writtenLines(trace.terminals), [3]);
	assert.deepEqual(trace.boundaries.map(boundary => boundary.reason), ['receiver']);
	assert.equal(trace.boundaries[0].source.kind, 'receiver-input');
	assert.equal(trace.terminals[0].kind, 'value-transfer');
	for (const optimization of [0, 3] as const) assert.deepEqual(runCompiledLua(file.source, file.file, optimization), [true, true]);
});

test('source global contributions include writes from all files, with no same-name local merging', () => {
	const first = buildLuaFileSemanticData('shared = 1; return shared', 'first.lua');
	const second = buildLuaFileSemanticData('shared = unknown_value; local shared = 9; return shared', 'second.lua');
	const snapshot = buildLuaSemanticWorkspaceSnapshot([first, second].map(analysis => ({ path: analysis.file, source: analysis.source, analysis })));
	const query = snapshot.symbolResolver.writtenSources;
	const global = query.trace(query.expression(first, (first.chunk.body[1] as LuaReturnStatement).expressions[0]));
	assert.equal(global.terminals.length, 1);
	assert.equal(global.terminals[0].file, first);
	assert.equal(global.boundaries.length, 1);
	assert.equal(global.boundaries[0].source.file, second);
	const local = query.trace(query.expression(second, (second.chunk.body[2] as LuaReturnStatement).expressions[0]));
	assert.equal(local.terminals.length, 1);
	assert.equal(local.terminals[0].file, second);
	assert.equal(local.boundaries.length, 0);
});

test('builtin transfer facts are consumed without re-recognizing the builtin name in the query', () => {
	const { file, query } = sourceQuery(`local value = setmetatable({}, {})
local function setmetatable(value) return value end
local other = setmetatable({})
return value, other`);
	const returned = file.chunk.body[3] as LuaReturnStatement;
	const builtin = query.trace(query.expression(file, returned.expressions[0]));
	assert.equal(builtin.terminals.length, 1);
	assert.equal(builtin.terminals[0].kind, 'value-transfer');
	assert.equal(builtin.boundaries.length, 0);
	const ordinary = query.trace(query.expression(file, returned.expressions[1]));
	assert.equal(ordinary.terminals.length, 0);
	assert.equal(ordinary.boundaries[0].reason, 'call-result');
});

test('unbound globals and definitions from another source retain their file owner', () => {
	const definition = buildLuaFileSemanticData('shared_value = { task = "walk" }', 'definition.lua');
	const consumer = buildLuaFileSemanticData('return shared_value, missing_value', 'consumer.lua');
	const snapshot = buildLuaSemanticWorkspaceSnapshot([definition, consumer].map(analysis => ({ path: analysis.file, source: analysis.source, analysis })));
	const query = snapshot.symbolResolver.writtenSources;
	const returned = consumer.chunk.body[0] as LuaReturnStatement;
	const known = query.trace(query.expression(consumer, returned.expressions[0]));
	assert.equal(known.root.file, consumer);
	assert.equal(known.terminals.length, 1);
	assert.equal(known.terminals[0].file, definition);
	const missing = query.trace(query.expression(consumer, returned.expressions[1]));
	assert.equal(missing.boundaries[0].source.file, consumer);
	assert.equal(missing.boundaries[0].reason, 'unbound-global');
});

test('new workspace generations share binder facts but not old source-query answers', () => {
	const workspace = new LuaSemanticWorkspace();
	const consumer = buildLuaFileSemanticData('return shared_value', 'consumer.lua');
	workspace.updateFiles([consumer]);
	const before = workspace.getSnapshot();
	const expression = (consumer.chunk.body[0] as LuaReturnStatement).expressions[0];
	const beforeQuery = before.symbolResolver.writtenSources;
	const missing = beforeQuery.trace(beforeQuery.expression(consumer, expression));
	assert.equal(missing.boundaries[0].reason, 'unbound-global');
	const definition = buildLuaFileSemanticData('shared_value = {}', 'definition.lua');
	workspace.updateFiles([definition]);
	const after = workspace.getSnapshot();
	const afterQuery = after.symbolResolver.writtenSources;
	assert.equal(after.getFileData(consumer.file), consumer);
	assert.equal(after.getFileData(consumer.file)!.readValuesBySyntax, consumer.readValuesBySyntax);
	assert.notEqual(afterQuery, beforeQuery);
	const found = afterQuery.trace(afterQuery.expression(consumer, expression));
	assert.equal(found.terminals[0].file, definition);
	assert.equal(found.boundaries.length, 0);
	assert.equal(beforeQuery.trace(beforeQuery.expression(consumer, expression)), missing);
	assert.equal(missing.boundaries.length, 1);
});

test('iteration-value uncertainty does not erase the written loop binding', () => {
	const { file, query } = sourceQuery('for index = 1, 4 do consume(index) end');
	const loop = file.chunk.body[0];
	assert.ok(loop.kind === LuaSyntaxKind.ForNumericStatement);
	const call = loop.block.body[0];
	assert.ok(call.kind === LuaSyntaxKind.CallStatement);
	const expression = call.expression.arguments[0];
	assert.equal(readLuaExpressionSource(file, expression).root.kind, 'declaration');
	assert.equal(file.callValues[0].arguments[0].root.kind, 'unknown', 'may-value simplification remains separate');
	const trace = query.trace(query.expression(file, expression));
	const boundary = trace.boundaries[0].source;
	assert.ok(boundary.kind === 'declaration-write');
	assert.equal(boundary.write.syntax, loop);
	assert.equal(boundary.write.index, 0);
	assert.equal(boundary.value.root.kind, 'unknown');
});

test('incomplete member syntax is not a value alias to its receiver', () => {
	const { file, query } = sourceQuery('local options = {}; local value = options.');
	assert.notEqual(file.syntaxError, null);
	const statement = file.chunk.body[1];
	assert.ok(statement.kind === LuaSyntaxKind.LocalAssignmentStatement);
	const expression = statement.values[0];
	assert.ok(expression.kind === LuaSyntaxKind.MemberExpression);
	const trace = query.trace(query.expression(file, expression));
	assert.equal(trace.terminals.length, 0);
	assert.equal(trace.boundaries[0].reason, 'unknown-value');
	assert.equal(file.memberAccesses.length, 1, 'completion still owns the actual receiver expression');
	assert.equal(file.memberAccesses[0].receiver.root.kind, 'declaration');
});

test('imports follow the canonical export and ordinary aliases in their original file', () => {
	for (const source of ['return { task = "walk" }', 'local first = {}; local second = first; return second',
		'module<const>\nreturn { task = "walk" }', 'return function(value) return value end']) {
		const library = buildLuaFileSemanticData(source, 'library/definition.lua');
		const consumer = buildLuaFileSemanticData('local imported = require("library/definition"); return imported', 'consumer.lua');
		const workspace = new LuaSemanticWorkspace();
		workspace.updateFiles([library, consumer]);
		const query = workspace.getSnapshot().symbolResolver.writtenSources;
		const result = consumer.chunk.body[1] as LuaReturnStatement;
		const trace = query.trace(query.expression(consumer, result.expressions[0]));
		assert.equal(trace.root.file, consumer);
		assert.equal(trace.terminals.length, 1);
		assert.equal(trace.terminals[0].file, library);
		assert.equal(trace.boundaries.length, 0);
		const exported = trace.sources.find(source => source.kind === 'module-export')!;
		assert.ok(exported.kind === 'module-export');
		assert.equal(exported.export, library.moduleValues[0]);
		assert.equal(exported.export.statement, library.chunk.body[library.chunk.body.length - 1]);
		assert.equal(exported.export.bypassingReturns.length, 0, 'function-body returns are not module exits');
		assert.equal(query.trace(trace.root), trace);
	}
});

test('reexports retain each written module edge, including cyclic imports', () => {
	const leaf = buildLuaFileSemanticData('return {}', 'leaf.lua');
	const middle = buildLuaFileSemanticData('local alias = require("leaf"); return alias', 'middle.lua');
	const consumer = buildLuaFileSemanticData('return require("middle")', 'consumer.lua');
	const workspace = new LuaSemanticWorkspace();
	workspace.updateFiles([leaf, middle, consumer]);
	const query = workspace.getSnapshot().symbolResolver.writtenSources;
	const expression = (consumer.chunk.body[0] as LuaReturnStatement).expressions[0];
	const trace = query.trace(query.expression(consumer, expression));
	assert.deepEqual(trace.sources.filter(source => source.kind === 'module-export').map(source => source.file.file), ['middle.lua', 'leaf.lua']);
	assert.equal(trace.terminals[0].file, leaf);
	assert.equal(trace.boundaries.length, 0);
	const cyclicLeaf = buildLuaFileSemanticData('return require("middle")', 'leaf.lua');
	workspace.updateFiles([cyclicLeaf]);
	const cyclicQuery = workspace.getSnapshot().symbolResolver.writtenSources;
	const cyclicTrace = cyclicQuery.trace(cyclicQuery.expression(consumer, expression));
	assert.equal(cyclicTrace.sources.length, 4);
	assert.equal(cyclicTrace.terminals.length, 0);
	const inputs = cyclicQuery.inputs(cyclicTrace.sources[3]);
	assert.ok(inputs.kind === 'contributions');
	assert.equal(inputs.sources[0], cyclicTrace.sources[1], 'cycle is retained, not capped or silently expanded');
	assert.equal(trace.terminals[0].file, leaf, 'old snapshot still owns its original export');
});

test('factory exports move the unresolved call boundary to the provider, not the importer', () => {
	const library = buildLuaFileSemanticData('local function create() return {} end; return create()', 'library.lua');
	const consumer = buildLuaFileSemanticData('return require("library")', 'consumer.lua');
	const workspace = new LuaSemanticWorkspace();
	workspace.updateFiles([library, consumer]);
	const query = workspace.getSnapshot().symbolResolver.writtenSources;
	const trace = query.trace(query.expression(consumer, (consumer.chunk.body[0] as LuaReturnStatement).expressions[0]));
	assert.equal(trace.terminals.length, 0, 'written-source tracking does not manufacture call-return proof');
	assert.equal(trace.boundaries.length, 1);
	const boundary = trace.boundaries[0];
	assert.equal(boundary.reason, 'call-result');
	assert.equal(boundary.source.file, library);
	assert.ok(boundary.source.kind === 'module-export');
	assert.equal(boundary.source.export.statement, library.chunk.body[1]);
	assert.equal(boundary.source.value.root.kind, 'owned');
});

test('unshaped and missing modules are boundaries, not invented constructor exports', () => {
	for (const source of ['', 'do return {} end', 'return {}\nlocal later = 1', 'return {}, {}']) {
		const library = buildLuaFileSemanticData(source, 'library.lua');
		assert.equal(library.syntaxError, null);
		assert.equal(library.moduleValues.length, 0);
		const consumer = buildLuaFileSemanticData('return require("library"), require("missing")', 'consumer.lua');
		const workspace = new LuaSemanticWorkspace();
		workspace.updateFiles([library, consumer]);
		const query = workspace.getSnapshot().symbolResolver.writtenSources;
		for (const expression of (consumer.chunk.body[0] as LuaReturnStatement).expressions) {
			const trace = query.trace(query.expression(consumer, expression));
			assert.equal(trace.terminals.length, 0);
			assert.equal(trace.boundaries.length, 1);
			assert.equal(trace.boundaries[0].reason, 'module');
		}
	}
});

test('earlier module returns are publication boundaries, never additional exports', () => {
	const library = buildLuaFileSemanticData(`local function make() return { function_body = true } end
if external_condition then return { early = true } end
do if other_condition then return end end
return { canonical = true }`, 'library.lua');
	const consumer = buildLuaFileSemanticData('return require("library")', 'consumer.lua');
	const workspace = new LuaSemanticWorkspace();
	workspace.updateFiles([library, consumer]);
	assert.equal(library.moduleValues.length, 1);
	const entry = library.moduleValues[0];
	assert.equal(entry.statement, library.chunk.body[3]);
	assert.deepEqual(entry.bypassingReturns.map(statement => statement.range.start.line), [2, 3]);
	assert.equal(library.functionValueFlows[0].returns.length, 1);
	const query = workspace.getSnapshot().symbolResolver.writtenSources;
	const trace = query.trace(query.expression(consumer, (consumer.chunk.body[0] as LuaReturnStatement).expressions[0]));
	assert.equal(trace.terminals.length, 1);
	assert.deepEqual(writtenLines(trace.terminals), [4]);
	assert.deepEqual(trace.boundaries.map(boundary => boundary.reason), ['module-publication', 'module-publication']);
	assert.deepEqual(writtenLines(trace.boundaries.map(boundary => boundary.source)), [2, 3]);
	for (const boundary of trace.boundaries) {
		assert.equal(boundary.source.file, library);
		assert.equal(boundary.source.kind, 'module-bypass');
		assert.equal(boundary.source.value.root.kind, 'unknown');
	}
});

test('adding and editing an export replaces module answers without reparsing its importer', () => {
	const consumer = buildLuaFileSemanticData('return require("library")', 'consumer.lua');
	const expression = (consumer.chunk.body[0] as LuaReturnStatement).expressions[0];
	const workspace = new LuaSemanticWorkspace();
	workspace.updateFiles([consumer]);
	const before = workspace.getSnapshot().symbolResolver.writtenSources;
	const missing = before.trace(before.expression(consumer, expression));
	assert.equal(missing.boundaries[0].reason, 'module');
	const library = buildLuaFileSemanticData('return {}', 'library.lua');
	workspace.updateFiles([library]);
	const after = workspace.getSnapshot();
	assert.equal(after.getFileData(consumer.file), consumer);
	const query = after.symbolResolver.writtenSources;
	const found = query.trace(query.expression(consumer, expression));
	assert.equal(found.terminals[0].file, library);
	assert.equal(found.boundaries.length, 0);
	workspace.updateFiles([buildLuaFileSemanticData('return external_value', 'library.lua')]);
	const edited = workspace.getSnapshot().symbolResolver.writtenSources;
	const changed = edited.trace(edited.expression(consumer, expression));
	assert.equal(changed.terminals.length, 0);
	assert.equal(changed.boundaries[0].reason, 'unbound-global');
	assert.equal(found.terminals[0].file, library);
	assert.equal(before.trace(before.expression(consumer, expression)), missing);
});
