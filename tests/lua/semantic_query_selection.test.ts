import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SemanticDemandIndex } from '../../toolchain/ts/lua/semantic/demand_index';
import { SemanticEffectIndex } from '../../toolchain/ts/lua/semantic/effect_index';
import { FunctionSummaryStore, type FunctionSummaryID, type SemanticNameID } from '../../toolchain/ts/lua/semantic/function_summary';
import { WorkspaceValueIdentityIndex } from '../../toolchain/ts/lua/semantic/identity';
import { buildLuaFileSemanticData, LuaSemanticWorkspace } from '../../toolchain/ts/lua/semantic/model';
import { declarationValueSource, globalValueSource, literalValueSource, moduleValueSource } from '../../toolchain/ts/lua/semantic/value_graph';
import { LuaSemanticQueryStore } from '../../toolchain/ts/lua/semantic/query_store';

for (const receiver of [false, true]) test(`scalar field values cannot select unrelated storage: receiver=${receiver}`, () => {
	const file = buildLuaFileSemanticData(`local object = {}
${receiver ? 'function object:initialize()' : ''}
${receiver ? 'self' : 'object'}.callback = nil
${receiver ? 'self' : 'object'}.enabled = false
${receiver ? 'self' : 'object'}.count = 0
${receiver ? 'self' : 'object'}.label = ''
${receiver ? 'end' : ''}`, 'scalars.lua');
	const summaries = new FunctionSummaryStore([file], new WorkspaceValueIdentityIndex({ files: [file], globalValues: new Map() }));
	const demand = new SemanticDemandIndex([file], summaries);
	for (const literal of [{ kind: 'nil', value: null }, { kind: 'boolean', value: false },
		{ kind: 'number', value: 0 }, { kind: 'string', value: '' }] as const) {
		const term = summaries.terms.compileSource(literalValueSource(literal));
		assert.deepEqual(demand.relatedTerms(term), [], 'an equal scalar is not a storage alias');
	}
});

test('effect selection follows reverse candidate edges to a fixed point, including cycles and unnamed bodies', () => {
	const functionNames: SemanticNameID[] = [];
	functionNames[1] = 11 as SemanticNameID;
	functionNames[2] = 12 as SemanticNameID;
	functionNames[3] = 13 as SemanticNameID;
	functionNames[4] = 11 as SemanticNameID;
	const index = new SemanticEffectIndex(functionNames);
	index.addWriter(21 as SemanticNameID, 1 as FunctionSummaryID);
	index.addWriter(21 as SemanticNameID, 1 as FunctionSummaryID);
	index.addWriter(22 as SemanticNameID, 4 as FunctionSummaryID);
	index.addCaller(1 as FunctionSummaryID, 2 as FunctionSummaryID);
	index.addNamedCaller(12 as SemanticNameID, 3 as FunctionSummaryID);
	index.addCaller(3 as FunctionSummaryID, 1 as FunctionSummaryID);
	index.addCaller(3 as FunctionSummaryID, 5 as FunctionSummaryID);
	index.addNamedCaller(99 as SemanticNameID, 6 as FunctionSummaryID);
	const selection = index.select(21 as SemanticNameID);
	assert.deepEqual([1, 2, 3, 4, 5, 6].filter(id => selection.summaries[id]), [1, 2, 3, 5]);
	assert.deepEqual([11, 12, 13, 99].filter(id => selection.names[id]), [11, 12, 13]);
	assert.deepEqual(index.select(23 as SemanticNameID), { summaries: [], names: [] });
	const separate = index.select(22 as SemanticNameID);
	assert.deepEqual([1, 2, 3, 4, 5, 6].filter(id => separate.summaries[id]), [4]);
});

test('static call selection crosses an unwritten intermediate member without creating that path', () => {
	const file = buildLuaFileSemanticData(`local object = {}
function object:run() end
local first
local middle
local last
first = object
middle = first
last = middle
last:run()
last:run()
last:missing()
last:missing()
`, 'aliases.lua');
	const summaries = new FunctionSummaryStore([file], new WorkspaceValueIdentityIndex({ files: [file], globalValues: new Map() }));
	const terms = summaries.terms;
	const middle = terms.compileSource(declarationValueSource(file.decls.find(entry => entry.name === 'middle')!.id));
	const run = terms.nameId('run');
	assert.equal(terms.retainedMember(middle, run), undefined);
	const demand = new SemanticDemandIndex([file], summaries);
	assert.equal(terms.retainedMember(middle, run), undefined, 'selection is not a producer of storage paths');
	const target = file.decls.find(entry => entry.name === 'run')!.id;
	assert.deepEqual(demand.directTargets(file.callValues[0]), [], 'an alias candidate is not a bound direct target');
	assert.deepEqual(demand.directTargets(file.callValues[1]), []);
	assert.deepEqual(demand.directTargets(file.callValues[2]), []);
	assert.deepEqual(demand.directTargets(file.callValues[3]), []);
	assert.equal(demand.staticCalleeEvaluations, 2, 'positive and negative queries are keyed by callee, not callsite');
	const query = new LuaSemanticQueryStore([file], new Map());
	assert.deepEqual(query.callee(file.callValues[0]).map(fact => fact.calleeFn), [target]);
	assert.deepEqual(query.callee(file.callValues[1]).map(fact => fact.calleeFn), [target]);
	assert.deepEqual(query.callee(file.callValues[2]), []);
	assert.deepEqual(query.callee(file.callValues[3]), []);
});

test('effect body slicing is demanded once per body, not for every candidate', () => {
	const lines = ['local owner = {}'];
	for (let index = 0; index < 64; index += 1) {
		lines.push(`function owner:write_${index}() self.payload = ${index} end`);
	}
	lines.push('function owner:dispatch() self:write_0() end');
	const file = buildLuaFileSemanticData(lines.join('\n'), 'effects.lua');
	const summaries = new FunctionSummaryStore([file], new WorkspaceValueIdentityIndex({ files: [file], globalValues: new Map() }));
	const demand = new SemanticDemandIndex([file], summaries);
	const dispatch = summaries.list().find(summary => summary.calls.length === 1)!;
	const name = summaries.terms.nameId('payload');
	assert.equal(demand.effectBodyEvaluations, 0);
	assert.deepEqual(demand.callsForEffect(dispatch.id, name), dispatch.calls);
	assert.equal(demand.effectBodyEvaluations, 1, 'the other 64 bodies were not sliced');
	assert.equal(demand.callsForEffect(dispatch.id, name), demand.callsForEffect(dispatch.id, name));
	assert.equal(demand.effectBodyEvaluations, 1);
	const writer = summaries.list()[0];
	assert.deepEqual(demand.callsForEffect(writer.id, name), []);
	assert.equal(demand.effectBodyEvaluations, 2);
});

test('edited, removed and reintroduced providers use a fresh term universe while old snapshots remain exact', () => {
	const workspace = new LuaSemanticWorkspace();
	const use = buildLuaFileSemanticData("local provider = require('provider')\nlocal item = provider.make()\nlocal value = item.marker", 'use.lua');
	const first = buildLuaFileSemanticData('local provider = {}\nfunction provider.make() return { marker = 11 } end\nreturn provider', 'provider.lua');
	workspace.updateFiles([first, use]);
	const old = workspace.getSnapshot();
	const reference = use.refs.find(ref => ref.name === 'marker')!;
	const firstTarget = old.symbolResolver.resolveReferenceTargets(reference);
	assert.equal(firstTarget.length, 1);
	assert.equal(first.chunk.locations.range(old.symbolResolver.getDeclaration(firstTarget[0]).span).start.line, 2);

	const replacement = buildLuaFileSemanticData('local provider = {}\n\n\nfunction provider.make() return { marker = 22 } end\nreturn provider', 'provider.lua');
	workspace.updateFiles([replacement]);
	const changed = workspace.getSnapshot();
	assert.equal(changed.getFileData('use.lua'), use);
	const changedTarget = changed.symbolResolver.resolveReferenceTargets(reference);
	assert.equal(changedTarget.length, 1);
	assert.equal(replacement.chunk.locations.range(changed.symbolResolver.getDeclaration(changedTarget[0]).span).start.line, 4);
	assert.deepEqual(old.symbolResolver.resolveReferenceTargets(reference), firstTarget);
	assert.equal(first.chunk.locations.range(old.symbolResolver.getDeclaration(firstTarget[0]).span).start.line, 2);

	workspace.updateFiles([], ['provider.lua']);
	const removed = workspace.getSnapshot();
	assert.deepEqual(removed.symbolResolver.resolveReferenceTargets(reference), []);
	workspace.updateFiles([first]);
	assert.deepEqual(workspace.getSnapshot().symbolResolver.resolveReferenceTargets(reference), firstTarget);
	assert.deepEqual(removed.symbolResolver.resolveReferenceTargets(reference), []);
});


test('global storage is distinct from every navigation occurrence and remains selectively indexable', () => {
	const file = buildLuaFileSemanticData('handler = function() end\nhandler = function() end\nhandler()', 'globals.lua');
	const occurrences = file.decls.filter(declaration => declaration.name === 'handler');
	assert.equal(occurrences.length, 2);
	for (const winner of occurrences) {
		const identities = new WorkspaceValueIdentityIndex({ files: [file], globalValues: new Map([['handler', winner.id]]) });
		const summaries = new FunctionSummaryStore([file], identities);
		const global = summaries.terms.compileSource(globalValueSource('handler'));
		assert.equal(summaries.terms.isIndexableAnchor(global), true);
		for (const occurrence of occurrences) {
			assert.notEqual(global, summaries.terms.compileSource(declarationValueSource(occurrence.id)));
		}
		const query = new LuaSemanticQueryStore([file], new Map([['handler', winner.id]]));
		assert.deepEqual(new Set(query.callee(file.callValues[0]).map(fact => fact.calleeFn)), new Set(occurrences.map(entry => entry.id)));
	}
});

test('raw global storage selects callee uses, argument dependencies and indexed writers', () => {
	const file = buildLuaFileSemanticData(`registry = {}
function handler(value) end
function publish(key, value) registry[key] = value end
function forward() handler(registry) end
handler(registry)`, 'global_selection.lua');
	const summaries = new FunctionSummaryStore([file], new WorkspaceValueIdentityIndex({ files: [file], globalValues: new Map() }));
	const demand = new SemanticDemandIndex([file], summaries);
	const registry = summaries.terms.compileSource(globalValueSource('registry'));
	const handler = summaries.terms.compileSource(globalValueSource('handler'));
	const publish = summaries.list().find(summary => summary.source.declaration === file.decls.find(entry => entry.name === 'publish')!.id)!;
	const forward = summaries.list().find(summary => summary.source.declaration === file.decls.find(entry => entry.name === 'forward')!.id)!;
	assert.deepEqual(demand.storageWriters(registry), [publish.id]);
	assert.ok(demand.dependentSummariesForTerm(registry).includes(publish.id));
	assert.ok(demand.dependentSummariesForTerm(registry).includes(forward.id));
	assert.deepEqual(demand.dependentCallsForTerm(registry), forward.calls);
	assert.equal(demand.calleeCallsForTerm(handler).length, 2);
	assert.equal(demand.topLevelCallsForTerm(handler).length, 1);
	assert.equal(demand.topLevelCallsForTerm(registry).length, 1);
	assert.deepEqual(demand.directTargets(file.callValues[0]), [], 'raw globals have candidates, not lexical call proof');
});

for (const invoked of [false, true]) test(`body global publication requires a call: invoked=${invoked}`, () => {
	const file = buildLuaFileSemanticData(`function install()
 handler = function() end
end
${invoked ? 'install()' : ''}
handler()`, 'global_effect.lua');
	const target = file.decls.find(entry => entry.name === 'handler')!;
	const query = new LuaSemanticQueryStore([file], new Map([['handler', target.id]]));
	const use = file.callValues[file.callValues.length - 1];
	assert.deepEqual(query.functions(globalValueSource('handler')), invoked ? [target.id] : []);
	assert.deepEqual(query.callee(use).map(fact => fact.calleeFn), invoked ? [target.id] : []);
});


test('calling one global writer does not publish a sibling occurrence', () => {
	const file = buildLuaFileSemanticData(`function first()
 handler = function() end
end
function second()
 handler = function() end
end
first()
handler()`, 'global_siblings.lua');
	const occurrences = file.decls.filter(entry => entry.name === 'handler');
	assert.equal(occurrences.length, 2);
	const query = new LuaSemanticQueryStore([file], new Map([['handler', occurrences[1].id]]));
	assert.deepEqual(query.functions(globalValueSource('handler')), [occurrences[0].id]);
	assert.deepEqual(query.callee(file.callValues[1]).map(fact => fact.calleeFn), [occurrences[0].id]);
});

test('indexed global callees retain their called writer and key-specific value', () => {
	const file = buildLuaFileSemanticData(`registry = {}
local function target() end
function publish(key, value) registry[key] = value end
publish('chosen', target)
local chosen = 'chosen'
registry[chosen]()
registry['missing']()`, 'global_index.lua');
	const query = new LuaSemanticQueryStore([file], new Map());
	const target = file.decls.find(entry => entry.name === 'target')!;
	assert.deepEqual(query.functions(file.callValues[1].callee), [target.id]);
	assert.equal(query.callContexts(file.callValues[1]).flatMap(context => context.applications).length, 1);
	assert.deepEqual(query.functions(file.callValues[2].callee), []);
	assert.equal(query.callContexts(file.callValues[2]).flatMap(context => context.applications).length, 0);
});


test('compiler imports do not execute a same-name global runtime function', () => {
	const file = buildLuaFileSemanticData(`function require(name)
 leaked = function() end
end
local imported = require('provider')
local function load() return require('provider') end
load()`, 'import_use.lua');
	const provider = buildLuaFileSemanticData('return { marker = true }', 'provider.lua');
	const files = [file, provider];
	const query = new LuaSemanticQueryStore(files, new Map());
	const imported = file.decls.find(entry => entry.name === 'imported')!;
	assert.equal(query.member(declarationValueSource(imported.id), 'marker').length, 1);
	const imports = file.callSites.map(site => site.call).filter(call => call.module !== undefined);
	assert.equal(imports.length, 2);
	for (const call of imports) {
		assert.deepEqual(query.callee(call), []);
		assert.equal(query.callContexts(call).flatMap(context => context.applications).length, 0);
	}
	assert.deepEqual(query.functions(globalValueSource('leaked')), []);
});

for (const invoked of [false, true]) test(`module exports copy raw globals without merging storage: invoked=${invoked}`, () => {
	const provider = buildLuaFileSemanticData(`function install()
 shared = function() end
end
${invoked ? 'install()' : ''}
return shared`, 'provider.lua');
	const identities = new WorkspaceValueIdentityIndex({ files: [provider], globalValues: new Map() });
	const summaries = new FunctionSummaryStore([provider], identities);
	const global = summaries.terms.compileSource(globalValueSource('shared'));
	const module = summaries.terms.compileSource(moduleValueSource('provider'));
	assert.notEqual(global, module);
	assert.ok(!summaries.terms.isGlobalStorage(module));
	assert.ok(!summaries.terms.isModuleAnchor(global));
	const query = new LuaSemanticQueryStore([provider], new Map());
	const target = provider.decls.find(entry => entry.name === 'shared')!;
	assert.deepEqual(query.functions(moduleValueSource('provider')), invoked ? [target.id] : []);
});

for (const invoked of [false, true]) test(`global argument forwarding retains call-gated publication: invoked=${invoked}`, () => {
	const file = buildLuaFileSemanticData(`function install() handler = function() end end
function consume(callback) callback() end
${invoked ? 'install()' : ''}
consume(handler)`, 'global_argument.lua');
	const query = new LuaSemanticQueryStore([file], new Map());
	const call = file.functionValueFlows.find(flow => flow.calls.length === 1)!.calls[0];
	const target = file.decls.find(entry => entry.name === 'handler')!;
	assert.deepEqual(query.callee(call).map(fact => fact.calleeFn), invoked ? [target.id] : []);
});


test('const aliases copy raw global values without merging their storage identities', () => {
	const file = buildLuaFileSemanticData('shared = function() end; local captured<const> = shared; return captured', 'const_global.lua');
	const summaries = new FunctionSummaryStore([file], new WorkspaceValueIdentityIndex({ files: [file], globalValues: new Map() }));
	const captured = file.decls.find(entry => entry.name === 'captured')!;
	const global = summaries.terms.compileSource(globalValueSource('shared'));
	const alias = summaries.terms.compileSource(declarationValueSource(captured.id));
	const module = summaries.terms.compileSource(moduleValueSource('const_global'));
	assert.notEqual(global, alias);
	assert.notEqual(global, module);
	assert.ok(!summaries.terms.isModuleAnchor(global));
	assert.ok(!summaries.terms.isGlobalStorage(module));
	const query = new LuaSemanticQueryStore([file], new Map());
	assert.deepEqual(query.functions(moduleValueSource('const_global')), [file.decls.find(entry => entry.name === 'shared')!.id]);
});
