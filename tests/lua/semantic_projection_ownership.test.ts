import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SemanticDemandIndex } from '../../toolchain/ts/lua/semantic/demand_index';
import { FunctionSummaryStore, type TermID } from '../../toolchain/ts/lua/semantic/function_summary';
import { WorkspaceValueIdentityIndex } from '../../toolchain/ts/lua/semantic/identity';
import { SemanticInstantiationQuery } from '../../toolchain/ts/lua/semantic/instantiate';
import { buildLuaFileSemanticData } from '../../toolchain/ts/lua/semantic/model';
import { LuaSemanticQueryStore } from '../../toolchain/ts/lua/semantic/query_store';
import { appendValueMember, declarationValueSource, literalValueSource } from '../../toolchain/ts/lua/semantic/value_graph';
import { runCompiledLua } from './cpu_test_harness';

test('module writes and inferred receiver writes keep distinct origins in the demand index', () => {
	const file = buildLuaFileSemanticData(`local outside = { token = true }
local original = { field = outside }
local function factory(input)
	function original:configure() self.field = input end
end`, 'origins.lua');
	const summaries = new FunctionSummaryStore([file], new WorkspaceValueIdentityIndex({ files: [file], globalValues: new Map() }));
	const demand = new SemanticDemandIndex([file], summaries);
	const field = summaries.terms.nameId('field');
	const moduleWrites = demand.staticWrites(field);
	const writers = demand.receiverWriters(field);
	assert.equal(moduleWrites.length, 1);
	const [configure, factory] = summaries.list();
	assert.deepEqual(writers, [configure.id]);
	assert.equal(summaries.terms.summaryOwner(configure.writes[0].value), factory.id,
		'the captured value belongs to a different body than the write');
	assert.equal(configure.writes[0].base, configure.parameters[0], 'indexing must not change the summary receiver');
});

test('receiver selection retains each writing body once without discarding its distinct writes', () => {
	const file = buildLuaFileSemanticData(`local original = {}
function original:first() self.field = 11; self.field = 22 end
function original:second() self.field = 33 end`, 'writers.lua');
	const summaries = new FunctionSummaryStore([file], new WorkspaceValueIdentityIndex({ files: [file], globalValues: new Map() }));
	const demand = new SemanticDemandIndex([file], summaries);
	const name = summaries.terms.nameId('field');
	assert.deepEqual(demand.receiverWriters(name), summaries.list().map(summary => summary.id));
	assert.deepEqual(demand.staticWrites(name), []);
	assert.equal(summaries.list()[0].writes.length, 2);
	const query = new SemanticInstantiationQuery(summaries, demand, () => assert.fail('no calls'));
	query.projectName(name);
	const writes: TermID[] = [];
	for (let write = query.writes.firstName(name); write !== 0; write = query.writes.nextName(write)) {
		writes.push(query.writes.value(write));
	}
	assert.deepEqual(writes, [11, 22, 33].map(value => summaries.terms.compileSource(literalValueSource({ kind: 'number', value }))));
});

for (const rhs of ['11', 'outside', 'function() return 11 end']) {
	test(`demanding a field does not execute or project an uncalled writer with RHS ${rhs}`, () => {
		const source = `local outside = { token = true }
local selected = 0
local original = {}
function original:configure()
	self.field = ${rhs}
	selected = 22
end
return original.field, selected`;
		const file = buildLuaFileSemanticData(source, 'uncalled.lua');
		const summaries = new FunctionSummaryStore([file], new WorkspaceValueIdentityIndex({ files: [file], globalValues: new Map() }));
		const demand = new SemanticDemandIndex([file], summaries);
		const query = new SemanticInstantiationQuery(summaries, demand, () => assert.fail('uncalled body cannot enqueue a call'));
		const field = summaries.terms.nameId('field');
		const selected = file.decls.find(entry => entry.name === 'selected')!;
		const target = summaries.terms.compileSource(declarationValueSource(selected.id));
		query.demandEffectName(field);
		assert.equal(query.writes.firstName(field), 0);
		assert.equal(query.frames.count, 0);
		const initial = query.values.first(target);
		assert.equal(query.values.target(initial), summaries.terms.compileSource(literalValueSource({ kind: 'number', value: 0 })));
		assert.equal(query.values.next(initial), 0);

		// Broad source navigation is an explicit, separate request. It must use
		// the writing body, even when the RHS has no summary owner of its own.
		query.projectName(field);
		assert.notEqual(query.writes.firstName(field), 0);
		const projected = query.values.next(initial);
		assert.notEqual(projected, 0);
		assert.equal(query.values.target(projected), summaries.terms.compileSource(literalValueSource({ kind: 'number', value: 22 })));
		assert.equal(query.values.next(projected), 0);
		assert.equal(query.frames.count, 0, 'a source projection is not an instantiated call');
		const revision = query.getRevision();
		query.projectName(field);
		query.demandEffectName(field);
		assert.equal(query.getRevision(), revision, 'repeated demand retains existing facts');
		for (const level of [0, 3] as const) assert.deepEqual(runCompiledLua(source, file.file, level), [null, 0]);
	});
}

for (const demandBeforeCall of [true, false]) {
	test(`an instantiated method writes only its argument receiver; demand before call = ${demandBeforeCall}`, () => {
		const source = `local original = {}
local actual = {}
function original:configure() self.field = 22 end
original.configure(actual)
return original.field, actual.field`;
		const file = buildLuaFileSemanticData(source, 'called.lua');
		const summaries = new FunctionSummaryStore([file], new WorkspaceValueIdentityIndex({ files: [file], globalValues: new Map() }));
		const demand = new SemanticDemandIndex([file], summaries);
		const query = new SemanticInstantiationQuery(summaries, demand, () => assert.fail('literal writer contains no calls'));
		const field = summaries.terms.nameId('field');
		const call = demand.topLevelCalls[0];
		const actual = file.decls.find(entry => entry.name === 'actual')!;
		const actualTerm = summaries.terms.compileSource(declarationValueSource(actual.id));
		if (demandBeforeCall) query.demandName(field);
		query.instantiate(call.site, summaries.list()[0].id, 0, 0, call.arguments, call.result);
		if (!demandBeforeCall) query.demandName(field);
		const write = query.writes.firstName(field);
		assert.notEqual(write, 0);
		assert.equal(query.writes.base(write), actualTerm);
		assert.equal(query.writes.nextName(write), 0, 'no projected write on the declaring receiver');
		assert.equal(query.frames.count, 1);
		for (const level of [0, 3] as const) assert.deepEqual(runCompiledLua(source, file.file, level), [null, 22]);
	});
}

for (const projectFirst of [true, false]) {
	test(`projected and module writes coexist without duplicate publication; project first = ${projectFirst}`, () => {
		const file = buildLuaFileSemanticData(`local original = { field = 11 }
function original:configure() self.field = 22 end`, 'both.lua');
		const summaries = new FunctionSummaryStore([file], new WorkspaceValueIdentityIndex({ files: [file], globalValues: new Map() }));
		const demand = new SemanticDemandIndex([file], summaries);
		const query = new SemanticInstantiationQuery(summaries, demand, () => assert.fail('no calls'));
		const name = summaries.terms.nameId('field');
		if (projectFirst) query.projectName(name);
		else query.demandName(name);
		const module = query.writes.firstName(name);
		assert.equal(query.writes.value(module), demand.staticWrites(name)[0].value);
		query.projectName(name);
		const projection = query.writes.nextName(module);
		assert.equal(query.writes.value(projection), summaries.get(demand.receiverWriters(name)[0]).writes[0].value);
		assert.equal(query.writes.nextName(projection), 0);
		const revision = query.getRevision();
		query.projectName(name);
		query.demandName(name);
		assert.equal(query.getRevision(), revision);
	});
}

test('public navigation still finds possible fields inside uncalled methods in either query order', () => {
	const source = `local outside = { token = true }
local original = {}
function original:configure()
	self.field = outside
	self.other = { nested = true }
end
function original:read() return self.field, self.other end
return original`;
	const file = buildLuaFileSemanticData(source, 'navigation.lua');
	for (const order of [['field', 'other'], ['other', 'field']]) {
		const query = new LuaSemanticQueryStore([file], new Map());
		const receiver = file.functionValueFlows[1].parameters[0];
		for (const name of order) {
			const declaration = file.decls.find(entry => entry.name === name)!;
			assert.deepEqual(query.member(receiver, name), [declaration.id]);
		}
	}
});

for (const order of [['field', 'token'], ['token', 'field']]) {
	test(`a projected nested writer retains lexical values; name order = ${order.join(',')}`, () => {
		const source = `local original = {}
local function factory()
	local captured = { token = true }
	function original:configure() self.field = captured end
end
function original:read() return self.field.token end`;
		const file = buildLuaFileSemanticData(source, 'capture.lua');
		const receiver = file.functionValueFlows[2].parameters[0];
		const token = file.decls.find(entry => entry.name === 'token')!;
		const field = file.decls.find(entry => entry.name === 'field')!;
		const query = new LuaSemanticQueryStore([file], new Map());
		for (const name of order) {
			assert.deepEqual(name === 'field'
				? query.member(receiver, name)
				: query.member(appendValueMember(receiver, 'field'), name), [name === 'field' ? field.id : token.id]);
		}
		const execution = `${source}\nfactory()\noriginal:configure()\nreturn original:read()`;
		for (const level of [0, 3] as const) assert.deepEqual(runCompiledLua(execution, file.file, level), [true]);
	});
}

for (const projectNameFirst of [true, false]) {
	test(`projected local table writes do not depend on demand order; name first = ${projectNameFirst}`, () => {
		const file = buildLuaFileSemanticData(`local original = {}
local function factory()
	local captured = { token = true }
	function original:configure() self.field = captured end
end`, 'lexical.lua');
		const summaries = new FunctionSummaryStore([file], new WorkspaceValueIdentityIndex({ files: [file], globalValues: new Map() }));
		const demand = new SemanticDemandIndex([file], summaries);
		const query = new SemanticInstantiationQuery(summaries, demand, () => assert.fail('no calls'));
		const token = summaries.terms.nameId('token');
		query.demandName(token);
		assert.equal(query.writes.firstName(token), 0, 'the table constructor is not a module write');
		if (projectNameFirst) query.projectName(token);
		query.compose(summaries.list()[0].id);
		if (!projectNameFirst) query.projectName(token);
		const write = query.writes.firstName(token);
		assert.notEqual(write, 0);
		assert.equal(query.writes.declaration(write), file.decls.find(entry => entry.name === 'token')!.id);
		assert.equal(query.writes.nextName(write), 0);
		assert.equal(query.frames.count, 0);
	});
}
