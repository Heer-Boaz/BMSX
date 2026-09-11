import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SemanticCallGraph, SemanticCallWorklist } from '../../toolchain/ts/lua/semantic/call_graph';
import { SemanticDemandIndex } from '../../toolchain/ts/lua/semantic/demand_index';
import { FunctionSummaryStore, TermKind } from '../../toolchain/ts/lua/semantic/function_summary';
import { WorkspaceValueIdentityIndex } from '../../toolchain/ts/lua/semantic/identity';
import { SemanticInstantiationQuery } from '../../toolchain/ts/lua/semantic/instantiate';
import { SemanticMemberQuery } from '../../toolchain/ts/lua/semantic/member_query';
import { buildLuaFileSemanticData } from '../../toolchain/ts/lua/semantic/model';
import { LuaSemanticQueryStore } from '../../toolchain/ts/lua/semantic/query_store';
import { SemanticQueryEvaluation } from '../../toolchain/ts/lua/semantic/query_dependencies';
import { LuaSyntaxKind } from '../../toolchain/ts/lua/syntax/ast';
import { runCompiledLua } from './cpu_test_harness';

function callQueries(source: string) {
	const file = buildLuaFileSemanticData(source, 'applications.lua');
	const summaries = new FunctionSummaryStore([file], new WorkspaceValueIdentityIndex({ files: [file], globalValues: new Map() }));
	const demand = new SemanticDemandIndex([file], summaries);
	const worklist = new SemanticCallWorklist(summaries.terms.dependencies);
	const instantiation = new SemanticInstantiationQuery(summaries, demand, (call, frame) => worklist.enqueue(call, frame));
	const members = new SemanticMemberQuery(summaries, instantiation);
	const graph = new SemanticCallGraph(summaries, demand, instantiation, members, worklist);
	return { file, summaries, demand, worklist, instantiation, graph };
}

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
