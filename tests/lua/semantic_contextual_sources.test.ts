import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildLuaFileSemanticData, LuaSemanticWorkspace } from '../../toolchain/ts/lua/semantic/model';
import type { LuaSourceCall, LuaSourceCallGraph } from '../../toolchain/ts/lua/semantic/source_call_graph';
import type { LuaSourceValueTrace } from '../../toolchain/ts/lua/semantic/source_value_query';
import { LuaSyntaxKind } from '../../toolchain/ts/lua/syntax/ast';
import { runCompiledLua } from './cpu_test_harness';

function queries(source: string, providers: Readonly<Record<string, string>> = {}) {
	const file = buildLuaFileSemanticData(source, 'consumer.lua');
	const files = [file, ...Object.entries(providers).map(([path, source]) => buildLuaFileSemanticData(source, path))];
	const workspace = new LuaSemanticWorkspace();
	workspace.updateFiles(files);
	const resolver = workspace.getSnapshot().symbolResolver;
	const values = resolver.contextualSources;
	function calls(name: string): LuaSourceCallGraph {
		const site = file.callSites.find(site => site.expression.callee.kind === LuaSyntaxKind.IdentifierExpression
			&& site.expression.callee.name === name)!;
		return resolver.callSources(site);
	}
	return { file, files, workspace, resolver, values, calls };
}

function literals(trace: LuaSourceValueTrace): unknown[] {
	return trace.terminals.map(value => {
		const root = value.source.value.root;
		assert.equal(root.kind, 'literal');
		assert.ok(root.kind === 'literal');
		return root.literal.value;
	});
}

function argumentEdges(trace: LuaSourceValueTrace) {
	return trace.edges.filter(edge => edge.kind === 'argument');
}

function moduleRootedHeads(graph: LuaSourceCallGraph): readonly LuaSourceCall[] {
	const reached = new Set(graph.calls.filter(call => call.caller.kind === 'module').map(call => call.caller));
	let changed = true;
	while (changed) {
		changed = false;
		for (const edge of graph.applications) {
			if (reached.has(edge.call.caller) && !reached.has(edge.target)) {
				reached.add(edge.target);
				changed = true;
			}
		}
	}
	return graph.heads.filter(head => reached.has(head.caller));
}

test('written arguments follow ordinary aliases in the selected wrapper context, not a cross product', () => {
	const source = `local seen = {}
local function record(id, definition) seen[id] = definition end
local function wrap(id, definition)
 local alias = definition
 record(id, alias)
end
wrap('left', 'walk')
wrap('right', 'run')
return seen.left == 'walk', seen.right == 'run'`;
	const f = queries(source);
	const heads = f.calls('record').heads;
	const actual = heads.filter(head => head.caller.kind === 'invocation');
	assert.equal(actual.length, 2);
	assert.deepEqual(actual.map(head => [literals(f.values.trace(f.values.argument(head, 0))),
		literals(f.values.trace(f.values.argument(head, 1)))]), [[['left'], ['walk']], [['right'], ['run']]]);
	for (const head of actual) {
		const id = f.values.trace(f.values.argument(head, 0));
		const definition = f.values.trace(f.values.argument(head, 1));
		assert.equal(id.boundaries.length, 0);
		assert.equal(definition.boundaries.length, 0);
		assert.equal(argumentEdges(id)[0].application, argumentEdges(definition)[0].application);
		assert.equal(id.terminals[0].source.file, f.file);
		assert.equal(definition.terminals[0].source.file, f.file);
		assert.equal(f.values.trace(definition.root), definition);
	}
	const projected = f.values.trace(f.values.argument(heads.find(head => head.caller.kind === 'projection')!, 1));
	assert.equal(projected.terminals.length, 0);
	assert.deepEqual(projected.boundaries.map(boundary => boundary.reason), ['parameter-input']);
	for (const optimization of [0, 3] as const) assert.deepEqual(runCompiledLua(source, f.file.file, optimization), [true, true]);
});

test('captured inputs follow the lexical creator through body-local factory and callable aliases', () => {
	const source = `local function record(value) return value end
local function entry()
 local function make(value) return function() return record(value) end end
 local first = make(7)
 local second = make(8)
 local left = first; local right = second
 return left(), right()
end
return entry()`;
	const f = queries(source);
	const heads = moduleRootedHeads(f.calls('record'));
	assert.equal(heads.length, 2);
	assert.deepEqual(heads.map(head => literals(f.values.trace(f.values.argument(head, 0)))), [[7], [8]]);
	for (const head of heads) {
		const trace = f.values.trace(f.values.argument(head, 0));
		assert.ok(head.caller.kind === 'invocation');
		assert.equal(argumentEdges(trace)[0].application.target, head.caller.lexicalOwner);
	}
	for (const optimization of [0, 3] as const) assert.deepEqual(runCompiledLua(source, f.file.file, optimization), [7, 8]);
});

test('known factory returns retain provider files, argument sources and the call boundary', () => {
	const f = queries(`local factory = require('factory')
local function record(value) return value end
local input = 'walk'
local value = factory(input)
return record(value)`, {
		'factory.lua': `local function make(value)
 local alias = value
 return alias
end
return make`,
	});
	const trace = f.values.trace(f.values.argument(f.calls('record').heads[0], 0));
	assert.deepEqual(literals(trace), ['walk']);
	assert.equal(trace.boundaries.length, 0);
	assert.equal(trace.callResults.length, 1, 'known targets are explicit, not silently declared exhaustive');
	assert.equal(trace.callResults[0].applications.length, 1);
	const returned = trace.sources.find(value => value.source.kind === 'function-return')!;
	assert.equal(returned.source.file, f.files[1]);
	assert.equal(returned.activation, trace.callResults[0].applications[0].target);
	assert.equal(trace.terminals[0].source.file, f.file);
	assert.equal(trace.edges.find(edge => edge.kind === 'return')!.to, returned);
});

test('a module factory result follows the canonical export into its provider body', () => {
	const f = queries(`local function record(value) end
record(require('library'))`, {
		'library.lua': `local function make() return 'provider' end
return make()`,
	});
	const trace = f.values.trace(f.values.argument(f.calls('record').heads[0], 0));
	assert.deepEqual(literals(trace), ['provider']);
	assert.equal(trace.terminals[0].source.file, f.files[1]);
	assert.equal(trace.callResults[0].call.site.expression.range.path, 'library.lua');
	assert.equal(trace.callResults[0].call.caller.kind, 'module');
});

test('formal writes stay contributions beside the actual input and retain foreign-body projection', () => {
	const source = `local function record(value) return value end
local function replace(value, condition)
 if condition then value = 'written' end
 local function unused() value = 'other body' end
 return record(value)
end
return replace('input', false) == 'input', replace('input', true) == 'written'`;
	const f = queries(source);
	for (const head of f.calls('record').heads.filter(head => head.caller.kind === 'invocation')) {
		const trace = f.values.trace(f.values.argument(head, 0));
		assert.deepEqual(new Set(literals(trace)), new Set(['input', 'written', 'other body']));
		const other = trace.terminals.find(value => value.source.kind === 'declaration-write'
			&& value.source.write.syntax.range.start.line === 4)!;
		assert.equal(other.activation.kind, 'projection', 'an uncalled captured write is not an effect in this activation');
	}
	for (const optimization of [0, 3] as const) assert.deepEqual(runCompiledLua(source, f.file.file, optimization), [true, true]);
});

test('receiver lanes come from call syntax, not whether the target was declared as a method', () => {
	const source = `local function record(value, extra) return value, extra end
local object = {}
function object:pick(value) return record(self, value) end
object:pick('colon')
object.pick('explicit', 'dot')`;
	const f = queries(source);
	const actual = f.calls('record').heads.filter(head => head.caller.kind === 'invocation');
	assert.equal(actual.length, 2);
	const receiver = f.values.trace(f.values.argument(actual[0], 0));
	const root = receiver.terminals[0].source.value.root;
	assert.ok(root.kind === 'owned' && root.syntax.kind === LuaSyntaxKind.TableConstructorExpression);
	assert.deepEqual(literals(f.values.trace(f.values.argument(actual[0], 1))), ['colon']);
	assert.deepEqual(literals(f.values.trace(f.values.argument(actual[1], 0))), ['explicit']);
	assert.deepEqual(literals(f.values.trace(f.values.argument(actual[1], 1))), ['dot']);
});

test('missing arguments are nil, while an unmodeled tail result lane remains unknown', () => {
	const source = `local function record(first, second) return second end
local function many() return 1, 2 end
local function forward(first, second) return record(first, second) end
local a = forward(1)
local b = forward(many())
return a, b`;
	const f = queries(source);
	const actual = f.calls('record').heads.filter(head => head.caller.kind === 'invocation');
	assert.equal(actual.length, 2);
	const missing = f.values.trace(f.values.argument(actual[0], 1));
	assert.deepEqual(literals(missing), [null]);
	const absent = missing.terminals[0].source;
	assert.ok(absent.kind === 'call-input');
	assert.equal(absent.index, 1);
	assert.equal(absent.call.expression.range.start.line, 4);
	const expanded = f.values.trace(f.values.argument(actual[1], 1));
	assert.equal(expanded.terminals.length, 0);
	assert.deepEqual(expanded.boundaries.map(boundary => boundary.reason), ['unknown-value']);
	const tail = expanded.boundaries[0].source.source;
	assert.ok(tail.kind === 'call-input');
	assert.equal(tail.index, 1);
	assert.equal(tail.call.expression.range.start.line, 5);
	for (const optimization of [0, 3] as const) assert.deepEqual(runCompiledLua(source, f.file.file, optimization), [null, 2]);
});

test('empty returns and reachable fallthrough retain their own written nil origins', () => {
	const f = queries(`local function record(value) end
local function choose(condition)
 if condition then return end
end
record(choose(false))`);
	const trace = f.values.trace(f.values.argument(f.calls('record').heads[0], 0));
	assert.deepEqual(literals(trace), [null, null]);
	assert.deepEqual(trace.terminals.map(value => value.source.kind), ['function-return', 'function-completion']);
	assert.equal(trace.callResults.length, 1);
});

test('unresolved call results retain the call site even when no return source is known', () => {
	const f = queries('local function record(value) end; record(external_value(1))');
	const trace = f.values.trace(f.values.argument(f.calls('record').heads[0], 0));
	assert.equal(trace.terminals.length, 0);
	assert.equal(trace.callResults.length, 1);
	assert.equal(trace.callResults[0].applications.length, 0);
	assert.equal(trace.callResults[0].call.site.expression.arguments[0].kind, LuaSyntaxKind.NumericLiteralExpression);
});

test('recursive argument/return dependencies remain finite labelled edges', () => {
	const source = `local function record(value) return value end
local function walk(value, next)
 if next then return walk(next) end
 return record(value)
end
return walk('first', 'second') == 'second'`;
	const f = queries(source);
	const [head] = moduleRootedHeads(f.calls('record'));
	const trace = f.values.trace(f.values.argument(head, 0));
	assert.deepEqual(new Set(literals(trace)), new Set(['first', 'second', null]));
	assert.equal(new Set(trace.sources).size, trace.sources.length);
	assert.ok(argumentEdges(trace).some(edge => edge.application.call.caller === edge.application.target));
	assert.equal(f.values.trace(trace.root), trace);
	for (const optimization of [0, 3] as const) assert.deepEqual(runCompiledLua(source, f.file.file, optimization), [true]);
});

test('warm contextual traces retain identity and do not re-solve calls', () => {
	const f = queries(`local function record(value) end
local function identity(value) return value end
record(identity('retained'))`);
	const head = f.calls('record').heads[0];
	const root = f.values.argument(head, 0);
	const trace = f.values.trace(root);
	const before = f.resolver.getSemanticQueryMetrics();
	const evaluated = f.values.evaluations;
	for (let index = 0; index < 1000; index += 1) {
		assert.equal(f.values.argument(head, 0), root);
		assert.equal(f.values.trace(root), trace);
	}
	assert.deepEqual(f.resolver.getSemanticQueryMetrics(), before);
	assert.equal(f.values.evaluations, evaluated);
});

test('equal actuals at a shared frame keep distinct, paired application labels for every lane', () => {
	const f = queries(`local function record(id, definition) end
local function consume(id, definition) record(id, definition) end
local definition = 'shared'
local function relay() consume('same', definition) end
relay()
relay()`);
	const [head] = moduleRootedHeads(f.calls('record'));
	const id = f.values.trace(f.values.argument(head, 0));
	const definition = f.values.trace(f.values.argument(head, 1));
	const idEdges = argumentEdges(id);
	const definitionEdges = argumentEdges(definition);
	assert.equal(idEdges.length, 3, 'projected caller plus two different actual callers, not a single first caller');
	assert.deepEqual(idEdges.map(edge => edge.application), definitionEdges.map(edge => edge.application));
	const actual = idEdges.filter(edge => edge.application.call.caller.kind === 'invocation');
	assert.equal(actual.length, 2);
	assert.equal(actual[0].to.source, actual[1].to.source, 'same written argument');
	assert.notEqual(actual[0].to.activation, actual[1].to.activation, 'different caller source contexts');
	assert.equal(actual[0].application.target, actual[1].application.target, 'interned target remains shared');
});

test('one known callable does not erase an unresolved replacement from callee source tracking', () => {
	const f = queries(`local function record(value) end
local function known(value) return value end
local selected = known
if condition then selected = external_factory() end
record(selected('written'))`);
	const trace = f.values.trace(f.values.argument(f.calls('record').heads[0], 0));
	assert.deepEqual(literals(trace), ['written']);
	assert.equal(trace.callResults.length, 1);
	const call = trace.callResults[0];
	assert.equal(call.applications.length, 1, 'only a may target, not a closed callee set');
	const callee = f.values.trace(call.callee);
	assert.equal(callee.terminals.length, 1);
	assert.equal(callee.callResults.length, 1);
	assert.equal(callee.callResults[0].applications.length, 0, 'the unknown replacement is still a source call boundary');
});

test('a call-callee source retains colon member ownership, independently of its receiver lane', () => {
	const f = queries('local object = {}; function object:pick() end; object:pick()');
	const site = f.file.callSites[0];
	const callee = f.resolver.writtenSources.callee(site.call);
	const receiver = f.resolver.writtenSources.argument(site.call, 0);
	assert.equal(callee.value, site.call.callee);
	assert.deepEqual(callee.value.steps, [{ kind: 'member', name: 'pick' }]);
	assert.equal(receiver.value.steps.length, 0);
	assert.notEqual(callee, receiver);
});

test('changing only an imported provider replaces contextual answers, not the unchanged importer facts', () => {
	const f = queries(`local function record(value) end
record(require('library'))`, { 'library.lua': "local function make() return 'before' end; return make()" });
	const site = f.file.callSites.find(site => site.expression.callee.kind === LuaSyntaxKind.IdentifierExpression
		&& site.expression.callee.name === 'record')!;
	const oldHead = f.resolver.callSources(site).heads[0];
	const oldRoot = f.values.argument(oldHead, 0);
	const oldTrace = f.values.trace(oldRoot);
	assert.deepEqual(literals(oldTrace), ['before']);
	const provider = buildLuaFileSemanticData("local function make() return 'after' end; return make()", 'library.lua');
	f.workspace.updateFiles([provider]);
	const snapshot = f.workspace.getSnapshot();
	assert.equal(snapshot.getFileData(f.file.file), f.file);
	const query = snapshot.symbolResolver.contextualSources;
	const head = snapshot.symbolResolver.callSources(site).heads[0];
	const trace = query.trace(query.argument(head, 0));
	assert.deepEqual(literals(trace), ['after']);
	assert.equal(trace.terminals[0].source.file, provider);
	assert.notEqual(head, oldHead);
	assert.equal(f.values.trace(oldRoot), oldTrace);
	assert.equal(oldTrace.terminals[0].source.file, f.files[1]);
	assert.deepEqual(literals(oldTrace), ['before']);
});

test('cyclic written aliases and unknown input expressions survive contextual tracing', () => {
	const f = queries(`local function record(value) end
local function forward(value)
 local alias = value
 value = alias
 record(value)
end
forward(1 + 2)`);
	const [head] = moduleRootedHeads(f.calls('record'));
	const trace = f.values.trace(f.values.argument(head, 0));
	assert.equal(trace.terminals.length, 0);
	assert.deepEqual(trace.boundaries.map(boundary => boundary.reason), ['unknown-value']);
	assert.equal(new Set(trace.sources).size, trace.sources.length);
	assert.ok(trace.edges.some(edge => edge.kind === 'written' && edge.to !== trace.root
		&& trace.edges.some(back => back.from === edge.to && back.to === edge.from)), 'written cycle is retained');
});
