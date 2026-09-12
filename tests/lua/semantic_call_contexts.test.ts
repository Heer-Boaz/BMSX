import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SemanticCallGraph, SemanticCallWorklist } from '../../toolchain/ts/lua/semantic/call_graph';
import { SemanticCallableUseQuery } from '../../toolchain/ts/lua/semantic/callable_use_query';
import { SemanticDemandIndex } from '../../toolchain/ts/lua/semantic/demand_index';
import { FunctionSummaryStore, TermKind } from '../../toolchain/ts/lua/semantic/function_summary';
import { WorkspaceValueIdentityIndex } from '../../toolchain/ts/lua/semantic/identity';
import { SemanticInstantiationQuery } from '../../toolchain/ts/lua/semantic/instantiate';
import { SemanticMemberQuery } from '../../toolchain/ts/lua/semantic/member_query';
import { buildLuaFileSemanticData, LuaSemanticWorkspace, type FileSemanticData } from '../../toolchain/ts/lua/semantic/model';
import { LuaSemanticQueryStore } from '../../toolchain/ts/lua/semantic/query_store';
import { SemanticQueryEvaluation } from '../../toolchain/ts/lua/semantic/query_dependencies';
import { LuaSyntaxKind } from '../../toolchain/ts/lua/syntax/ast';
import { runCompiledLua } from './cpu_test_harness';
import { LuaSourceCallQuery } from '../../toolchain/ts/lua/semantic/source_call_graph';

function callQueries(source: string, extraFiles: readonly FileSemanticData[] = []) {
	const file = buildLuaFileSemanticData(source, 'applications.lua');
	const files = [file, ...extraFiles];
	const summaries = new FunctionSummaryStore(files, new WorkspaceValueIdentityIndex({ files, globalValues: new Map() }));
	const demand = new SemanticDemandIndex(files, summaries);
	const worklist = new SemanticCallWorklist(summaries.terms.dependencies);
	const instantiation = new SemanticInstantiationQuery(summaries, demand, (call, frame) => worklist.enqueue(call, frame));
	const members = new SemanticMemberQuery(summaries, instantiation);
	const graph = new SemanticCallGraph(summaries, demand, instantiation, members, worklist);
	return { file, summaries, demand, worklist, instantiation, graph };
}

test('every navigation callsite retains its original binder call, including anonymous and computed callees', () => {
	const { file } = callQueries(`local function consume(value) return value end
local api = { run = consume }
api:run(1)
api[key](2);
(function(value) return value end)(3)
require('library')`);
	assert.equal(file.syntaxError, null);
	assert.equal(file.callSites.length, 4);
	assert.deepEqual(new Set(file.callSites.map(site => site.call)), new Set(file.callValues));
	for (const site of file.callSites) {
		assert.equal(site.call.expression, site.expression);
		assert.equal(site.call.result!.root.syntax, site.expression);
		if (site.reference !== undefined) assert.equal(site.reference.call, site.call);
	}
});

test('demand indices select the owner-bearing summary call without copying its identity', () => {
	const { summaries, demand } = callQueries(`
local function invoke(options) options.callback() end
local function forward(options) invoke(options) end
forward({ callback = function() end })`);
	for (const summary of summaries.list()) {
		for (const call of summary.calls) {
			assert.equal(call.owner, summary.id);
			assert.equal(demand.call(call.site), call, 'indexed and body-selected work must use the same static call');
		}
		for (const call of demand.compositionCalls(summary.id)) assert.equal(demand.call(call.site), call);
	}
	for (const call of demand.topLevelCalls) {
		assert.equal(call.owner, undefined);
		assert.equal(demand.call(call.site), call);
	}
});

test('one wrapper site retains paired inputs from distinct outer calls', () => {
	const source = `local seen = {}
local function register(id, definition) seen[id] = definition.task end
local function wrap(id, definition) register(id, definition) end
wrap('left', { task = 'walk' })
wrap('right', { task = 'run' })
return seen.left == 'walk', seen.right == 'run'`;
	const { summaries, demand, instantiation, graph } = callQueries(source);
	const wrapper = summaries.list().find(summary => summary.calls.length === 1)!;
	const inner = wrapper.calls[0];
	const contexts = graph.callContexts(inner.site);
	assert.equal(graph.callee(inner.site).length, 1, 'navigation may aggregate the function, not its inputs');
	for (const outer of demand.topLevelCalls) {
		const [moduleContext] = graph.callContexts(outer.site);
		assert.equal(moduleContext.ownerFrame, 0);
		assert.equal(moduleContext.inputs, outer, 'module inputs consume the existing summary without a copy');
		const application = moduleContext.applications.find(target => target.callee === wrapper.id)!;
		const context = contexts.find(item => item.ownerFrame === application.targetFrame)!;
		assert.equal(context.call.site, inner.site);
		assert.equal(context.inputs.arguments.length, 2);
		for (let index = 0; index < 2; index += 1) {
			const argument = context.inputs.arguments[index];
			assert.equal(argument, instantiation.contextualize(wrapper.parameters[index], application.targetFrame));
			const link = instantiation.values.first(argument);
			assert.equal(instantiation.values.target(link), outer.arguments[index]);
			assert.equal(instantiation.values.next(link), 0, 'the other application does not contribute a crossed input');
		}
	}
	assert.equal(contexts.filter(context => context.ownerFrame > 0).length, 2);
	for (const optimization of [0, 3] as const) assert.deepEqual(runCompiledLua(source, 'pairs.lua', optimization), [true, true]);
});

test('call bindings and applications are retained across dependency reevaluation', () => {
	const { summaries, demand, graph, worklist, instantiation } = callQueries(`
local function run(value) return value end
local function other(value) return value end
run({})`);
	const call = demand.topLevelCalls[0];
	const contexts = graph.callContexts(call.site);
	const context = contexts[0];
	const inputs = context.inputs.arguments;
	const application = context.applications[0];
	const before = worklist.evaluation.count;
	for (let index = 0; index < 10; index += 1) assert.equal(graph.callContexts(call.site), contexts);
	assert.equal(worklist.evaluation.count, before, 'a warm read does not rebind or solve an unchanged work item');
	const consumer = new SemanticQueryEvaluation(summaries.terms.dependencies);
	consumer.begin(0);
	graph.callContexts(call.site);
	consumer.end(0);
	assert.ok(consumer.isCurrent(0));
	instantiation.values.add(call.callee, summaries.list()[1].functionValue);
	assert.equal(consumer.isCurrent(0), false, 'warm context consumers are invalidated before another query solves the new target');
	assert.ok(worklist.pendingCount > 0);
	graph.solve();
	assert.ok(worklist.evaluation.count > before);
	assert.equal(context.inputs.arguments, inputs);
	assert.equal(context.applications.length, 2);
	assert.equal(context.applications[0], application);
});

test('recursive call edges retain the supplied tuple even when their target frame is reused', () => {
	const { summaries, demand, instantiation, graph } = callQueries(`
local function walk(value, next)
 if next then return walk(next) end
 return value
end
walk({ first = true }, { second = true })`);
	const summary = summaries.list()[0];
	const [outer] = demand.topLevelCalls;
	const root = graph.callContexts(outer.site)[0];
	const frame = root.applications[0].targetFrame;
	const contexts = graph.callContexts(summary.calls[0].site);
	const recursive = contexts.find(context => context.ownerFrame === frame)!;
	assert.equal(recursive.applications[0].targetFrame, frame);
	assert.equal(recursive.inputs.arguments.length, 1, 'do not replace the recursive edge with the first full frame tuple');
	assert.equal(recursive.inputs.arguments[0], instantiation.contextualize(summary.parameters[1], frame));
	assert.notEqual(recursive.inputs.arguments[0], root.inputs.arguments[0]);
	assert.equal(graph.callContexts(summary.calls[0].site), contexts);
});

test('two caller contexts retain distinct edges into an interned target with equal inputs', () => {
	const { summaries, graph } = callQueries(`
local function consume(id, definition) end
local definition = { task = 'walk' }
local function relay() consume('same', definition) end
relay()
relay()`);
	const relay = summaries.list().find(summary => summary.calls.length === 1)!;
	const contexts = graph.callContexts(relay.calls[0].site).filter(context => context.ownerFrame > 0);
	assert.equal(contexts.length, 2);
	assert.notEqual(contexts[0].ownerFrame, contexts[1].ownerFrame);
	assert.deepEqual(contexts[0].inputs.arguments, contexts[1].inputs.arguments);
	assert.equal(contexts[0].applications[0].targetFrame, contexts[1].applications[0].targetFrame);
	assert.notEqual(contexts[0].applications[0], contexts[1].applications[0], 'a shared node does not replace the caller edges');
});

test('an unresolved call keeps its written site and unknown argument contribution', () => {
	const { demand, graph, summaries } = callQueries('absent({ known = true }, 1 + 2)');
	const call = demand.topLevelCalls[0];
	const [context] = graph.callContexts(call.site);
	assert.equal(context.inputs, call);
	assert.equal(context.inputs.arguments[1], summaries.terms.unknown());
	assert.equal(context.applications.length, 0, 'no callable body has been established');
	assert.equal(graph.callContexts(call.site)[0], context, 'empty targets do not erase the input context');
});

test('a cached empty application set observes the first later callable contribution', () => {
	const { demand, graph, summaries, instantiation } = callQueries(`
local function target(value) return value end
absent(1)`);
	const call = demand.topLevelCalls[0];
	const contexts = graph.callContexts(call.site);
	const context = contexts[0];
	assert.equal(context.applications.length, 0);
	const target = summaries.list()[0];
	instantiation.values.add(context.inputs.callee, target.functionValue);
	assert.equal(graph.callContexts(call.site), contexts);
	assert.equal(context.applications.length, 1);
	assert.equal(context.applications[0].callee, target.id);
});

test('source ancestry retains complete wrapper tuples instead of crossing independently resolved arguments', () => {
	const source = `local seen = {}
local function register(id, definition) seen[id] = definition.task end
local function wrap(id, definition) register(id, definition) end
wrap('left', { task = 'walk' })
wrap('right', { task = 'run' })
return seen.left == 'walk', seen.right == 'run'`;
	const { file, summaries, instantiation, graph } = callQueries(source);
	const sources = new LuaSourceCallQuery(summaries, instantiation, graph);
	const wrap = file.functionValueFlows.find(flow => flow.calls.length === 1)!;
	const ancestry = sources.ancestry(wrap.calls[0]);
	const heads = ancestry.heads.filter(head => head.caller.kind === 'invocation');
	assert.equal(heads.length, 2);
	assert.equal(heads[0].site, heads[1].site, 'one written wrapper call, separate source contexts');
	assert.notEqual(heads[0].caller, heads[1].caller);
	const incoming = heads.map(head => ancestry.applications.filter(edge => edge.target === head.caller));
	assert.deepEqual(incoming.map(edges => edges.length), [1, 1]);
	const argumentsByCaller = incoming.map(([edge]) => edge.call.site.expression.arguments);
	assert.deepEqual(argumentsByCaller.map(args => args[0].range.start.line), [4, 5]);
	assert.deepEqual(argumentsByCaller.map(args => args[1].range.start.line), [4, 5]);
	assert.equal(ancestry.calls.filter(call => call.caller.kind === 'module').length, 2);
	assert.equal(sources.ancestry(wrap.calls[0]), ancestry);
	for (const optimization of [0, 3] as const) assert.deepEqual(runCompiledLua(source, file.file, optimization), [true, true]);
});

test('source ancestry retains all incoming applications to a shared target frame', () => {
	const { file, summaries, instantiation, graph } = callQueries(`local function observe(id, definition) end
local function consume(id, definition) observe(id, definition) end
local definition = { task = 'walk' }
local function relay() consume('same', definition) end
relay()
relay()`);
	const sources = new LuaSourceCallQuery(summaries, instantiation, graph);
	const consume = file.functionValueFlows[1];
	const ancestry = sources.ancestry(consume.calls[0]);
	const heads = ancestry.heads.filter(head => head.caller.kind === 'invocation');
	assert.equal(heads.length, 1, 'the value solver shared the consume frame');
	const incoming = ancestry.applications.filter(edge => edge.target === heads[0].caller);
	assert.equal(incoming.length, 3, 'the projected application is retained alongside both actual analysis callers');
	const callers = incoming.filter(edge => edge.call.caller.kind === 'invocation');
	assert.equal(callers.length, 2);
	assert.equal(callers[0].call.site, callers[1].call.site);
	assert.notEqual(callers[0].call.caller, callers[1].call.caller);
	const roots = ancestry.calls.filter(call => call.caller.kind === 'module');
	assert.deepEqual(roots.map(call => call.site.expression.range.start.line).sort(), [5, 6]);
});

test('recursive source ancestry remains a finite graph with a real back edge', () => {
	const { file, summaries, instantiation, graph } = callQueries(`local function walk(value, next)
if next then return walk(next) end
return value
end
walk({}, {})`);
	const sources = new LuaSourceCallQuery(summaries, instantiation, graph);
	const ancestry = sources.ancestry(file.functionValueFlows[0].calls[0]);
	assert.ok(ancestry.applications.some(edge => edge.call.caller === edge.target));
	assert.equal(new Set(ancestry.calls).size, ancestry.calls.length);
	assert.equal(new Set(ancestry.applications).size, ancestry.applications.length);
	assert.equal(ancestry.calls.filter(call => call.caller.kind === 'module').length, 1);
	assert.equal(sources.ancestry(file.functionValueFlows[0].calls[0]), ancestry);
});

test('positive source activations can descend entirely from hypothetical projection', () => {
	const { file, summaries, instantiation, graph } = callQueries(`local function consume(value) end
local function unused()
 local function relay(value) consume(value) end
 relay({})
end`);
	const sources = new LuaSourceCallQuery(summaries, instantiation, graph);
	const relay = file.functionValueFlows.find(flow => flow.calls.some(call => call.expression.range.start.line === 3))!;
	const ancestry = sources.ancestry(relay.calls[0]);
	assert.ok(ancestry.applications.some(edge => edge.target.kind === 'invocation'));
	assert.ok(ancestry.calls.some(call => call.caller.kind === 'projection'));
	assert.equal(ancestry.calls.filter(call => call.caller.kind === 'module').length, 0);
	const projected = ancestry.heads.find(head => head.caller.kind === 'projection')!;
	assert.ok(projected.caller.kind === 'projection');
	assert.equal(projected.caller.lexicalOwner.kind, 'projection');
});

test('source activations retain captured lexical owners separately from their callers', () => {
	const source = `local function consume(value) return value end
local function make(value)
 return function() return consume(value) end
end
local left = make(7)
local right = make(8)
local left_value = left()
local right_value = right()
return left_value == 7, right_value == 8`;
	const { file, summaries, instantiation, graph } = callQueries(source);
	const sources = new LuaSourceCallQuery(summaries, instantiation, graph);
	const closure = file.functionValueFlows.find(flow => flow.calls.some(call => call.expression.range.start.line === 3))!;
	const ancestry = sources.ancestry(closure.calls[0]);
	const heads = ancestry.heads.filter(head => head.caller.kind === 'invocation');
	assert.equal(heads.length, 2);
	for (const head of heads) {
		assert.ok(head.caller.kind === 'invocation');
		const lexicalOwner = head.caller.lexicalOwner;
		assert.equal(lexicalOwner.kind, 'invocation');
		const creation = ancestry.applications.filter(edge => edge.target === lexicalOwner);
		assert.equal(creation.length, 1);
		assert.ok([5, 6].includes(creation[0].call.site.expression.range.start.line));
		const invocation = ancestry.applications.filter(edge => edge.target === head.caller);
		assert.equal(invocation.length, 1);
		assert.ok([7, 8].includes(invocation[0].call.site.expression.range.start.line));
	}
	const [left, right] = heads;
	assert.ok(left.caller.kind === 'invocation' && right.caller.kind === 'invocation');
	assert.notEqual(left.caller.lexicalOwner, right.caller.lexicalOwner);
	for (const optimization of [0, 3] as const) assert.deepEqual(runCompiledLua(source, file.file, optimization), [true, true]);
});

for (const [name, factory, calls, expected] of [
	['nested closures', 'return function(extra) return function() return consume(value + extra) end end',
		'local left_inner = left(70); local right_inner = right(80); return left_inner(), right_inner()', [77, 88]],
	['stored closures', 'return { run = function() return consume(value) end }',
		'return left.run(), right.run()', [7, 8]],
	['forwarded closures', 'return function() return consume(value) end',
		'local function forward(callback) return callback() end; return forward(left), forward(right)', [7, 8]],
] as const) {
	test(`a cold source query discovers creator contexts for ${name}`, () => {
		const source = `local function consume(value) return value end
local function make(value) ${factory} end
local left = make(7)
local right = make(8)
${calls}`;
		const file = buildLuaFileSemanticData(source, 'closures.lua');
		const queries = new LuaSemanticQueryStore([file], new Map());
		const call = file.refs.find(ref => ref.name === 'consume' && ref.call !== undefined)!.call!;
		const ancestry = queries.callSources(call);
		const heads = ancestry.heads.filter(head => head.caller.kind === 'invocation');
		assert.equal(heads.length, 2);
		for (const head of heads) {
			assert.ok(head.caller.kind === 'invocation');
			assert.equal(head.caller.lexicalOwner.kind, 'invocation');
			assert.equal(ancestry.applications.filter(edge => edge.target === head.caller).length, 1);
		}
		const metrics = queries.metrics();
		assert.equal(queries.callSources(call), ancestry);
		assert.deepEqual(queries.metrics(), metrics, 'warm reads do not repeat creator demand');
		for (const optimization of [0, 3] as const) assert.deepEqual(runCompiledLua(source, file.file, optimization), expected);
	});
}

test('querying a returned but uninvoked closure does not fabricate its invocation', () => {
	const file = buildLuaFileSemanticData(`local function consume(value) return value end
local function make(value) return function() return consume(value) end end
local left = make(7)
local right = make(8)`, 'uninvoked.lua');
	const queries = new LuaSemanticQueryStore([file], new Map());
	const call = file.refs.find(ref => ref.name === 'consume' && ref.call !== undefined)!.call!;
	const ancestry = queries.callSources(call);
	assert.equal(ancestry.heads.length, 1);
	assert.equal(ancestry.heads[0].caller.kind, 'projection');
	assert.equal(ancestry.calls.filter(call => call.caller.kind === 'module').length, 0);
});

test('a cold closure-source query preserves imported creator and caller resources', () => {
	const library = buildLuaFileSemanticData(`local function consume(value) return value end
local function make(value) return function() return consume(value) end end
return make`, 'library.lua');
	const { file, summaries, instantiation, graph } = callQueries(`local make = require('library')
local left = make(7)
local right = make(8)
left()
right()`, [library]);
	const sources = new LuaSourceCallQuery(summaries, instantiation, graph);
	const call = library.refs.find(ref => ref.name === 'consume' && ref.call !== undefined)!.call!;
	const ancestry = sources.ancestry(call);
	const heads = ancestry.heads.filter(head => head.caller.kind === 'invocation');
	assert.equal(heads.length, 2);
	for (const head of heads) {
		assert.equal(head.site.expression.range.path, library.file);
		assert.ok(head.caller.kind === 'invocation');
		const creator = head.caller.lexicalOwner;
		assert.equal(creator.kind, 'invocation');
		const creation = ancestry.applications.filter(edge => edge.target === creator);
		assert.equal(creation.length, 1);
		assert.equal(creation[0].call.site.expression.range.path, file.file);
		const invocation = ancestry.applications.filter(edge => edge.target === head.caller);
		assert.equal(invocation.length, 1);
		assert.equal(invocation[0].call.site.expression.range.path, file.file);
	}
});

for (const [name, body, moduleCalls] of [
	['nested factory', `local function make(value) return function() return consume(value) end end
 local left = make(7); local right = make(8)
 local a = left(); local b = right(); return a == 7 and b == 8`, 'return entry()'],
	['anonymous alias cycle', `local callback = function() return consume(value) end
 local alias = callback; callback = alias
 local result = alias(); return result == value`, 'return entry(7), entry(8)'],
	['indexed callback', `local callback = function() return consume(value) end
 local holder = {}; holder[1] = callback
 local result = holder[1](); return result == value`, 'return entry(7), entry(8)'],
	['member callback', `local holder = { run = function() return consume(value) end }
 local result = holder.run(); return result == value`, 'return entry(7), entry(8)'],
] as const) {
	test(`cold callable-use demand discovers module-rooted applications through a ${name}`, () => {
		const source = `local function consume(value) return value end
local function entry(value)
 ${body}
end
${moduleCalls}`;
		const file = buildLuaFileSemanticData(source, 'uses.lua');
		const queries = new LuaSemanticQueryStore([file], new Map());
		const call = file.refs.find(ref => ref.name === 'consume' && ref.call !== undefined)!.call!;
		const graph = queries.callSources(call);
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
		const heads = graph.heads.filter(head => reached.has(head.caller));
		assert.equal(heads.length, 2, 'a positive analysis frame without module ancestry is not sufficient');
		for (const head of heads) {
			assert.ok(head.caller.kind === 'invocation');
			assert.ok(reached.has(head.caller.lexicalOwner));
			assert.ok(graph.applications.some(edge => edge.target === head.caller && reached.has(edge.call.caller)));
		}
		assert.notEqual(heads[0].caller, heads[1].caller);
		const metrics = queries.metrics();
		assert.equal(queries.callSources(call), graph);
		assert.deepEqual(queries.metrics(), metrics);
		for (const optimization of [0, 3] as const) {
			assert.deepEqual(runCompiledLua(source, file.file, optimization), name === 'nested factory' ? [true] : [true, true]);
		}
	});
}

test('exact callee-use index retains all static sites without publishing applications', () => {
	const { summaries, demand, instantiation } = callQueries(`local function entry(callback, key)
 callback()
 local holder = { run = callback }
 holder.run()
 holder[key]()
end
entry(function() end, 'run')`);
	for (const summary of summaries.list()) {
		for (const call of summary.calls) assert.ok(demand.calleeCallsForTerm(call.callee).includes(call));
	}
	for (const call of demand.topLevelCalls) assert.ok(demand.calleeCallsForTerm(call.callee).includes(call));
	assert.equal(instantiation.frames.count, 0, 'a use is a selection fact, not a resolved function call');
});

test('callable-use reads track empty reverse rows and cycles, not unrelated assignment growth', () => {
	const { summaries, demand, instantiation } = callQueries(`local function run() end
local function other() end
local pending
local alias = pending
pending = alias
pending()`);
	const uses = new SemanticCallableUseQuery(summaries, demand, instantiation);
	const [run, other] = summaries.list();
	const call = demand.topLevelCalls[0];
	assert.deepEqual(uses.calls(run.id), []);
	const before = uses.evaluations;
	instantiation.values.add(call.callee, other.functionValue);
	assert.deepEqual(uses.calls(run.id), []);
	assert.equal(uses.evaluations, before);
	instantiation.values.add(call.callee, run.functionValue);
	assert.deepEqual(uses.calls(run.id), [call]);
	assert.equal(uses.evaluations, before + 1);
	assert.equal(instantiation.frames.count, 0, 'reverse use selection never solves callees itself');
});

test('unresolved source calls retain arguments and method receivers without inventing applications', () => {
	const { file, summaries, instantiation, graph } = callQueries('absent(1 + 2, {}); object:missing({}); unknown[index](7)');
	const sources = new LuaSourceCallQuery(summaries, instantiation, graph);
	for (const call of file.callValues) {
		const ancestry = sources.ancestry(call);
		assert.equal(ancestry.heads.length, 1);
		assert.equal(ancestry.heads[0].site, call);
		assert.equal(ancestry.calls.length, 1);
		assert.equal(ancestry.applications.length, 0);
	}
	const [plain, method] = file.callValues;
	assert.equal(plain.arguments[0].root.kind, 'unknown');
	assert.equal(method.arguments.length, 2, 'the bound tuple includes the implicit receiver');
	assert.equal(method.expression.arguments.length, 1, 'written syntax is not normalized into synthetic arguments');
});

test('source calls without symbol references still reach their original anonymous function body', () => {
	const { file, summaries, instantiation, graph } = callQueries('(function(value) return value end)({})');
	const sources = new LuaSourceCallQuery(summaries, instantiation, graph);
	const ancestry = sources.ancestry(file.callValues[0]);
	assert.equal(ancestry.applications.length, 1);
	const target = ancestry.applications[0].target;
	assert.ok(target.kind === 'invocation');
	assert.equal(target.body, file.functionValueFlows[0]);
	assert.equal(target.body.declaration, undefined);
});

test('an imported factory application keeps the provider body and consumer call source', () => {
	const library = buildLuaFileSemanticData('local api = {}; function api.make(value) return { value = value } end; return api', 'library.lua');
	const { file, summaries, instantiation, graph } = callQueries('local api = require("library"); return api.make(7)', [library]);
	const sources = new LuaSourceCallQuery(summaries, instantiation, graph);
	const ancestry = sources.ancestry(file.callValues[1]);
	assert.equal(ancestry.applications.length, 1);
	assert.equal(ancestry.heads[0].site.expression.range.path, file.file);
	const target = ancestry.applications[0].target;
	assert.ok(target.kind === 'invocation');
	assert.equal(target.body, library.functionValueFlows[0]);
	assert.equal(target.body.returns[0].statement.range.path, library.file);
});

test('incoming application index retains negative dependencies and updates after its first read', () => {
	const { summaries, graph, demand } = callQueries('local function called() end; called()');
	const subscriber = new SemanticQueryEvaluation(summaries.terms.dependencies);
	subscriber.begin(0);
	assert.equal(graph.incomingApplications(1).length, 0);
	subscriber.end(0);
	assert.equal(subscriber.isCurrent(0), true);
	const [context] = graph.callContexts(demand.topLevelCalls[0].site);
	const application = context.applications[0];
	assert.equal(application.targetFrame, 1);
	assert.equal(subscriber.isCurrent(0), false);
	const incoming = graph.incomingApplications(1);
	assert.equal(incoming.length, 1);
	assert.equal(incoming[0].context, context);
	assert.equal(incoming[0].application, application);
	assert.equal(graph.incomingApplications(1), incoming);
});

test('caller-context demand observes a later incoming fact even without a new closure invocation', () => {
	const { file, summaries, demand, instantiation, graph } = callQueries(`local function consume(value) return value end
local function make(value) return function() return consume(value) end end
local pending
local unused = pending(7)`);
	const sources = new LuaSourceCallQuery(summaries, instantiation, graph);
	const site = file.refs.find(ref => ref.name === 'consume' && ref.call !== undefined)!.call!;
	assert.equal(sources.ancestry(site).heads.filter(head => head.caller.kind === 'invocation').length, 0);
	const before = graph.getCallerContextEvaluations();
	const factory = summaries.list().find(summary => summary.source.declaration === file.decls.find(decl => decl.name === 'make')!.id)!;
	instantiation.values.add(demand.topLevelCalls[0].callee, factory.functionValue);
	graph.callee(demand.topLevelCalls[0].site);
	assert.equal(graph.getCallerContextEvaluations(), before, 'ordinary callee solving does not enumerate caller contexts');
	assert.equal(sources.ancestry(site).heads.filter(head => head.caller.kind === 'invocation').length, 0);
	assert.ok(graph.getCallerContextEvaluations() > before, 'the previously empty creator-caller row was invalidated');
});

test('one closure query does not enumerate unrelated creators using the same callee', () => {
	const counts: number[] = [];
	for (const creators of [1, 128]) {
		const lines = ['local function consume(value) return value end'];
		for (let index = 0; index < creators; index += 1) {
			lines.push(`local function make_${index}(value) return function() return consume(value) end end`,
				`local callback_${index} = make_${index}(${index + 1})`, `callback_${index}()`);
		}
		const file = buildLuaFileSemanticData(lines.join('\n'), 'creators.lua');
		const queries = new LuaSemanticQueryStore([file], new Map());
		const call = file.refs.find(ref => ref.name === 'consume' && ref.call !== undefined)!.call!;
		const graph = queries.callSources(call);
		assert.equal(graph.heads.filter(head => head.caller.kind === 'invocation').length, 1);
		assert.equal(graph.calls.filter(call => call.caller.kind === 'module').length, 2);
		counts.push(queries.metrics().instantiatedCalls);
		const before = queries.metrics();
		assert.equal(queries.callSources(call), graph);
		assert.deepEqual(queries.metrics(), before);
	}
	assert.equal(counts[1], counts[0], 'unrelated creator bodies do not add instantiated frames');
});

test('source ancestry refreshes when a reused frame gains a caller without changing the head contexts', () => {
	const { file, summaries, instantiation, graph, demand } = callQueries(`local function observe(id) end
local function consume(id) observe(id) end
local function relay() consume('same') end
relay()
absent()`);
	const sources = new LuaSourceCallQuery(summaries, instantiation, graph);
	const headSite = file.functionValueFlows[1].calls[0];
	const before = sources.ancestry(headSite);
	const retainedHead = before.heads.find(head => head.caller.kind === 'invocation')!;
	assert.equal(before.applications.filter(edge => edge.target === retainedHead.caller).length, 2);
	const missing = demand.topLevelCalls[1];
	const relay = summaries.list().find(summary => summary.source === file.functionValueFlows[2])!;
	instantiation.values.add(missing.callee, relay.functionValue);
	graph.callContexts(missing.site);
	const after = sources.ancestry(headSite);
	assert.notEqual(after, before);
	assert.ok(after.heads.includes(retainedHead));
	assert.equal(after.applications.filter(edge => edge.target === retainedHead.caller).length, 3);
	assert.deepEqual(after.calls.filter(call => call.caller.kind === 'module').map(call => call.site.expression.range.start.line).sort(), [4, 5]);
	assert.equal(before.applications.filter(edge => edge.target === retainedHead.caller).length, 2, 'published source graphs are not mutated');
	assert.equal(sources.ancestry(headSite), after);
});

test('source ancestry answers belong to one immutable workspace, including imported changes', () => {
	const file = buildLuaFileSemanticData('local api = require("library"); api.make(7)', 'consumer.lua');
	const library = buildLuaFileSemanticData('return {}', 'library.lua');
	const workspace = new LuaSemanticWorkspace();
	workspace.updateFiles([file, library]);
	const first = workspace.getSnapshot().symbolResolver.callSources(file.callSites[1]);
	assert.equal(first.applications.length, 0);
	const edited = buildLuaFileSemanticData('local api = {}; function api.make(value) return {} end; return api', 'library.lua');
	workspace.updateFiles([edited]);
	const snapshot = workspace.getSnapshot();
	assert.equal(snapshot.getFileData(file.file), file);
	const second = snapshot.symbolResolver.callSources(file.callSites[1]);
	assert.equal(second.applications.length, 1);
	assert.equal(first.applications.length, 0);
	assert.notEqual(second.heads[0], first.heads[0]);
	assert.equal(second.heads[0].site, first.heads[0].site);
	assert.equal(snapshot.symbolResolver.callSources(file.callSites[1]), second);
});

test('a new owner frame invalidates an already retained site context collection', () => {
	const { summaries, demand, graph, instantiation } = callQueries(`
local function consume(value) end
local function wrap(value) consume(value) end
wrap({ first = true })`);
	const wrap = summaries.list().find(summary => summary.calls.length === 1)!;
	const call = wrap.calls[0];
	const contexts = graph.callContexts(call.site);
	const originalCount = contexts.length;
	const frame = instantiation.instantiate(demand.topLevelCalls[0].site, wrap.id, 0, 0, [summaries.terms.unknown()], undefined);
	assert.equal(graph.callContexts(call.site), contexts);
	assert.equal(contexts.length, originalCount + 1);
	assert.ok(contexts.some(context => context.ownerFrame === frame));
});

test('body projection is retained as a context, not labelled as a module call', () => {
	const { summaries, graph } = callQueries(`
local function consume(value) return value end
local function uncalled(value) return consume(value) end`);
	const body = summaries.list().find(summary => summary.calls.length === 1)!;
	const [context] = graph.callContexts(body.calls[0].site);
	assert.equal(context.ownerFrame, -body.id);
	assert.equal(context.inputs.arguments[0], summaries.projectExternalTerm(body.calls[0].arguments[0]));
	assert.equal(context.applications.length, 1);
	assert.ok(context.applications[0].targetFrame > 0, 'an instantiated analysis target is not proof of runtime execution');
});

test('projecting a caller body does not suppress a later request for its call contexts', () => {
	const { file, graph } = callQueries(`local function observe(value) end
local function consume(value) observe(value) end
local function relay() consume('same') end
relay()
relay()`);
	graph.callContexts(file.functionValueFlows[1].calls[0]);
	const caller = file.functionValueFlows[2].calls[0];
	const contexts = graph.callContexts(caller);
	assert.equal(contexts.filter(context => context.ownerFrame > 0).length, 2);
	assert.equal(contexts.filter(context => context.ownerFrame < 0).length, 1);
});

test('method receiver and explicit arguments stay in their original input lanes', () => {
	const { summaries, demand, graph, instantiation } = callQueries(`
local api = {}
function api:use(id, definition) return definition end
api:use('first', { value = 1 })
api:use('second', { value = 2 })`);
	const body = summaries.list()[0];
	assert.equal(body.parameters.length, 3);
	for (const call of demand.topLevelCalls) {
		const [context] = graph.callContexts(call.site);
		assert.equal(context.inputs.arguments.length, 3);
		const target = context.applications.find(item => item.callee === body.id)!;
		for (let lane = 0; lane < 3; lane += 1) {
			const parameter = instantiation.contextualize(body.parameters[lane], target.targetFrame);
			assert.equal(instantiation.values.target(instantiation.values.first(parameter)), call.arguments[lane]);
		}
	}
});

test('different anonymous callable bodies at one source binding retain separate applications', () => {
	const { summaries, demand, graph } = callQueries(`
local run = function() return 1 end
run = function() return 2 end
run()`);
	const [context] = graph.callContexts(demand.topLevelCalls[0].site);
	assert.deepEqual(context.applications.map(target => target.callee), summaries.list().map(summary => summary.id));
	assert.notEqual(context.applications[0].targetFrame, context.applications[1].targetFrame);
	assert.notEqual(context.applications[0].callable, context.applications[1].callable);
});

test('nested callable context retains closure-owned inputs', () => {
	const { summaries, demand, graph, instantiation } = callQueries(`
local function consume(id, definition) return definition end
local function make(id)
 return function(definition) return consume(id, definition) end
end
local left = make('left')
local right = make('right')
left({ first = true })
right({ second = true })`);
	const nested = summaries.list().find(summary => summary.lexicalOwner !== undefined)!;
	for (const call of demand.topLevelCalls) graph.callContexts(call.site);
	const contexts = graph.callContexts(nested.calls[0].site).filter(context => context.ownerFrame > 0);
	assert.equal(contexts.length, 2);
	for (const context of contexts) {
		const [id, definition] = context.inputs.arguments;
		assert.equal(summaries.terms.kind(id), TermKind.ContextRoot);
		assert.equal(summaries.terms.operand(id), instantiation.frames.closure(context.ownerFrame));
		assert.equal(summaries.terms.operand(definition), context.ownerFrame);
	}
	assert.notEqual(contexts[0].inputs.arguments[0], contexts[1].inputs.arguments[0]);
});

test('fresh workspace query stores do not reuse source contexts from a previous snapshot', () => {
	const before = buildLuaFileSemanticData('local function run() end\nrun(1)', 'replace.lua');
	const after = buildLuaFileSemanticData('local function run() end\nrun(2)', 'replace.lua');
	const first = new LuaSemanticQueryStore([before], new Map()).callContexts(before.callValues[0]);
	const second = new LuaSemanticQueryStore([after], new Map()).callContexts(after.callValues[0]);
	assert.notEqual(first[0], second[0]);
	const firstSite = first[0].call.site.result!.root.syntax;
	const secondSite = second[0].call.site.result!.root.syntax;
	assert.ok(firstSite.kind === LuaSyntaxKind.CallExpression);
	assert.ok(secondSite.kind === LuaSyntaxKind.CallExpression);
	assert.notEqual(firstSite, secondSite);
	assert.deepEqual(firstSite.arguments[0], before.callSites[0].expression.arguments[0]);
	assert.deepEqual(secondSite.arguments[0], after.callSites[0].expression.arguments[0]);
});
