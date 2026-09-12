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

test('named reads retain the writer context of separate factory results and nested fields', () => {
	const source = `local seen = {}
local function record(id, definition) seen[id] = definition.task end
local function make(id, task)
 return { id = id, definition = { task = task } }
end
local left = make('left', 'walk')
local right = make('right', 'run')
record(left.id, left.definition, left.definition.task)
record(right.id, right.definition, right.definition.task)
return seen.left == 'walk', seen.right == 'run'`;
	const f = queries(source);
	const calls = f.file.callSites.filter(site => site.reference?.name === 'record');
	for (const [index, site] of calls.entries()) {
		const call = f.resolver.callSources(site).heads[0];
		const id = f.values.trace(f.values.argument(call, 0));
		assert.deepEqual(literals(id), [index === 0 ? 'left' : 'right']);
		const definition = f.values.trace(f.values.argument(call, 1));
		assert.equal(definition.terminals.length, 1);
		assert.equal(definition.terminals[0].source.value.root.kind, 'owned');
		assert.equal(definition.terminals[0].activation.kind, 'invocation');
		const task = f.values.trace(f.values.argument(call, 2));
		assert.deepEqual(literals(task), [index === 0 ? 'walk' : 'run']);
		assert.equal(task.memberReads.length, 1);
		assert.equal(task.memberReads[0].name, 'task');
		assert.equal(f.values.trace(task.memberReads[0].base).terminals[0], definition.terminals[0]);
		assert.equal(id.memberReads[0].origins[0].activation, task.memberReads[0].origins[0].activation);
		assert.equal(f.values.trace(definition.root), definition);
	}
	for (const optimization of [0, 3] as const) assert.deepEqual(runCompiledLua(source, f.file.file, optimization), [true, true]);
});

test('same-name tables and equal field values retain separate authored write occurrences', () => {
	const source = `local function record(value) return value end
local left = { task = 'same' }
local right = { task = 'unrelated' }
left.task = 'same'
return record(left['task']) == 'same'`;
	const f = queries(source);
	const trace = f.values.trace(f.values.argument(f.calls('record').heads[0], 0));
	assert.deepEqual(literals(trace), ['same', 'same']);
	const origins = trace.memberReads[0].origins;
	assert.equal(origins.length, 2);
	assert.notEqual(origins[0], origins[1]);
	for (const origin of origins) {
		assert.equal(origin.activation.kind, 'module');
		assert.ok(origin.source.kind === 'declaration-write');
		assert.equal(f.resolver.writtenSources.write(origin.source.write), origin.source);
	}
	assert.equal(trace.edges.filter(edge => edge.kind === 'member' && edge.read === trace.memberReads[0]).length, 2);
	for (const optimization of [0, 3] as const) assert.deepEqual(runCompiledLua(source, f.file.file, optimization), [true]);
});

test('imported factory fields carry their provider resource and actual argument context', () => {
	const f = queries(`local function record(value) end
local make = require('factory')
local result = make('caller')
record(result.definition.task)`, { 'factory.lua': `local function make(task)
 return { definition = { task = task } }
end
return make` });
	const trace = f.values.trace(f.values.argument(f.calls('record').heads[0], 0));
	assert.deepEqual(literals(trace), ['caller']);
	const read = trace.memberReads[0];
	assert.equal(read.origins[0].source.file, f.files[1]);
	assert.equal(read.origins[0].activation.kind, 'invocation');
	assert.equal(trace.terminals[0].source.file, f.file);
	assert.equal(f.values.trace(read.base).memberReads[0].origins[0].source.file, f.files[1]);
});

test('writes through captured storage retain their own writer frame, not the storage owner', () => {
	const source = `local function record(value) return value end
local function create(value)
 local result = {}
 local function install() result.task = value end
 install()
 return result
end
local first = create('walk')
local second = create('run')
return record(first.task) == 'walk', record(second.task) == 'run'`;
	const f = queries(source);
	const sites = f.file.callSites.filter(site => site.reference?.name === 'record');
	for (const [index, site] of sites.entries()) {
		const trace = f.values.trace(f.values.argument(f.resolver.callSources(site).heads[0], 0));
		assert.deepEqual(literals(trace), [index === 0 ? 'walk' : 'run']);
		const writer = trace.memberReads[0].origins[0].activation;
		assert.ok(writer.kind === 'invocation');
		assert.equal(writer.body, f.file.functionValueFlows.find(flow => flow.members.length === 1));
		assert.equal(writer.lexicalOwner.kind, 'invocation');
	}
	for (const optimization of [0, 3] as const) assert.deepEqual(runCompiledLua(source, f.file.file, optimization), [true, true]);
});

test('known field writes do not erase unknown bases, unknown replacements or unwritten fields', () => {
	const f = queries(`local function record(...) end
local object = { task = 'walk' }
if condition then object = external_factory() end
object.task = another_factory()
record(object.task, object.missing, object[1], object[key])`);
	const call = f.calls('record').heads[0];
	const task = f.values.trace(f.values.argument(call, 0));
	assert.deepEqual(literals(task), ['walk']);
	assert.equal(task.callResults.length, 1, 'the unknown RHS remains a call boundary beside the known write');
	assert.equal(task.callResults[0].applications.length, 0);
	const base = f.values.trace(task.memberReads[0].base);
	assert.equal(base.callResults.length, 1, 'a known member does not close its storage origins');
	assert.equal(base.callResults[0].applications.length, 0);
	const missing = f.values.trace(f.values.argument(call, 1));
	assert.equal(missing.memberReads.length, 1);
	assert.equal(missing.memberReads[0].origins.length, 0);
	assert.deepEqual(missing.boundaries.map(boundary => boundary.reason), ['unwritten-member']);
	for (const lane of [2, 3]) {
		const indexed = f.values.trace(f.values.argument(call, lane));
		assert.equal(indexed.memberReads.length, 0);
		assert.deepEqual(indexed.boundaries.map(boundary => boundary.reason), ['access-path']);
	}
});

test('warm named-field traces retain their joins and do not re-evaluate unrelated fields', () => {
	const f = queries(`local function record(value) end
local function make(task) return { task = task } end
local unrelated = { note = 'other' }
record(make('retained').task, unrelated.note)`);
	const call = f.calls('record').heads[0];
	const root = f.values.argument(call, 0);
	const trace = f.values.trace(root);
	assert.deepEqual(literals(trace), ['retained']);
	f.values.trace(f.values.argument(call, 1));
	const before = f.resolver.getSemanticQueryMetrics();
	const evaluated = f.values.evaluations;
	for (let index = 0; index < 1000; index += 1) assert.equal(f.values.trace(root), trace);
	assert.deepEqual(f.resolver.getSemanticQueryMetrics(), before);
	assert.equal(f.values.evaluations, evaluated);
});

test('a field written in an uncalled body remains projected with an unresolved formal input', () => {
	const f = queries(`local function record(value) end
local function unused(value)
 local object = { task = value }
 record(object.task)
end`);
	const call = f.calls('record').heads.find(head => head.caller.kind === 'projection')!;
	const trace = f.values.trace(f.values.argument(call, 0));
	assert.equal(trace.memberReads[0].origins[0].activation, call.caller);
	assert.equal(trace.terminals.length, 0);
	assert.deepEqual(trace.boundaries.map(boundary => boundary.reason), ['parameter-input']);
});

test('a method callee retains the original named write through the existing prototype join', () => {
	const source = `local function record(value) return value end
local prototype = {}
function prototype:run(value) return value end
local object = setmetatable({}, { __index = prototype })
return record(object:run('result')) == 'result'`;
	const f = queries(source);
	const trace = f.values.trace(f.values.argument(f.calls('record').heads[0], 0));
	assert.deepEqual(literals(trace), ['result']);
	const callee = f.values.trace(trace.callResults[0].callee);
	assert.equal(callee.memberReads.length, 1);
	assert.equal(callee.memberReads[0].name, 'run');
	assert.equal(callee.terminals.length, 1);
	assert.ok(callee.terminals[0].source.kind === 'declaration-write');
	assert.equal(callee.terminals[0].source.write.syntax, f.file.chunk.body[2]);
});

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
