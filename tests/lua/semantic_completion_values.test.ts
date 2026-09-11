import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LuaCompletion } from '../../toolchain/ts/lua/analysis/completion';
import { SemanticDemandIndex } from '../../toolchain/ts/lua/semantic/demand_index';
import { FunctionSummaryStore } from '../../toolchain/ts/lua/semantic/function_summary';
import { WorkspaceValueIdentityIndex } from '../../toolchain/ts/lua/semantic/identity';
import { SemanticInstantiationQuery } from '../../toolchain/ts/lua/semantic/instantiate';
import { buildLuaFileSemanticData, LuaSemanticWorkspace } from '../../toolchain/ts/lua/semantic/model';
import { NIL_VALUE_SOURCE, semanticValueSourcesEqual } from '../../toolchain/ts/lua/semantic/value_graph';
import { runCompiledLua } from './cpu_test_harness';

test('written empty, nil and unmodeled returns remain distinct first-value facts', () => {
	const source = [
		'local function empty() return end',
		'local function explicit() return nil end',
		'local function unknown(value) return value + 1 end',
		'local function mixed(enabled) if enabled then return function() return 7 end else return nil end end',
	].join('\n');
	const file = buildLuaFileSemanticData(source, 'returns.lua');
	const summaries = new FunctionSummaryStore([file], new WorkspaceValueIdentityIndex({ files: [file], globalValues: new Map() }));
	const nil = summaries.terms.compileSource(NIL_VALUE_SOURCE);
	const checked: string[] = [];
	for (const summary of summaries.list()) {
		const declaration = file.decls.find(item => item.id === summary.source.declaration);
		if (declaration?.name === 'empty' || declaration?.name === 'explicit') {
			checked.push(declaration.name);
			assert.deepEqual(summary.returns, [nil]);
			assert.equal(summary.source.completion, LuaCompletion.None);
			assert.ok(semanticValueSourcesEqual(summary.source.returns[0].firstValue, NIL_VALUE_SOURCE));
		} else if (declaration?.name === 'unknown') {
			checked.push(declaration.name);
			assert.deepEqual(summary.returns, [summaries.terms.unknown()]);
			assert.equal(summary.source.returns[0].firstValue.root.kind, 'unknown');
		} else if (declaration?.name === 'mixed') {
			checked.push(declaration.name);
			assert.equal(summary.returns.length, 2);
			assert.ok(summary.returns.includes(nil));
			assert.equal(summary.source.completion, LuaCompletion.None);
		}
	}
	assert.deepEqual(checked, ['empty', 'explicit', 'unknown', 'mixed']);
	assert.deepEqual(runCompiledLua(source + '\nreturn empty() == nil, explicit() == nil, unknown(3), mixed(false) == nil, mixed(true)()', 'returns.lua'),
		[true, true, 4, true, 7]);
});

test('body fallthrough adds nil to the same instantiated return relation as the known callback', () => {
	const source = [
		'local callback<const> = function() return 7 end',
		'local function choose(enabled) if enabled then return callback end end',
		'local chosen = choose(false)',
		'return chosen == nil',
	].join('\n');
	const file = buildLuaFileSemanticData(source, 'choose.lua');
	const summaries = new FunctionSummaryStore([file], new WorkspaceValueIdentityIndex({ files: [file], globalValues: new Map() }));
	const summary = summaries.list().find(item => item.source.expression.parameters.length === 1)!;
	assert.equal(summary.source.completion, LuaCompletion.Fallthrough);
	assert.equal(summary.source.returns.length, 1, 'implicit completion is not a fabricated written return');
	assert.equal(summary.returns.length, 2);
	assert.ok(summary.returns.includes(summaries.terms.compileSource(NIL_VALUE_SOURCE)));
	const demand = new SemanticDemandIndex([file], summaries);
	const query = new SemanticInstantiationQuery(summaries, demand, () => assert.fail('the chosen function body has no calls'));
	const call = demand.topLevelCalls[0];
	query.instantiate(call.site, summary.id, 0, 0, call.arguments, call.result);
	const values = [];
	for (let link = query.values.first(call.result!); link !== 0; link = query.values.next(link)) values.push(query.values.target(link));
	assert.deepEqual(values, summary.returns);
	assert.deepEqual(runCompiledLua(source, 'choose.lua'), [true]);
});

test('known and unmodeled written returns both contribute rather than reporting a singleton', () => {
	const file = buildLuaFileSemanticData([
		'local callback<const> = function() return 7 end',
		'local function choose(enabled, value) if enabled then return callback else return value + 1 end end',
	].join('\n'), 'unknown-return.lua');
	const summaries = new FunctionSummaryStore([file], new WorkspaceValueIdentityIndex({ files: [file], globalValues: new Map() }));
	const summary = summaries.list().find(item => item.source.expression.parameters.length === 2)!;
	assert.equal(summary.returns.length, 2);
	assert.ok(summary.returns.includes(summaries.terms.unknown()));
	assert.equal(summary.source.completion, LuaCompletion.None);
});

test('non-exiting bodies do not manufacture nil while unresolved jumps retain unknown completion', () => {
	const source = [
		'local function forever() ::again:: goto again end',
		'local function incomplete() goto absent end',
		'local function jumping() goto result; if false then ::result:: return 9 end end',
	].join('\n');
	const file = buildLuaFileSemanticData(source, 'jumps.lua');
	const summaries = new FunctionSummaryStore([file], new WorkspaceValueIdentityIndex({ files: [file], globalValues: new Map() }));
	assert.deepEqual(summaries.list()[0].returns, []);
	assert.equal(summaries.list()[1].source.completion, LuaCompletion.Unresolved);
	assert.deepEqual(summaries.list()[1].returns, [summaries.terms.unknown()]);
	assert.equal(summaries.list()[2].source.completion, LuaCompletion.None);
	assert.equal(summaries.list()[2].returns.length, 1);
	for (const optimization of [0, 3] as const) {
		assert.deepEqual(runCompiledLua('local function jumping() goto result; if false then ::result:: return 9 end end; return jumping()', 'cross-block.lua', optimization), [9]);
	}
});

test('completion belongs to immutable bound bodies and survives unchanged-file snapshot sharing', () => {
	const workspace = new LuaSemanticWorkspace();
	workspace.updateFile('provider.lua', 'return function(enabled) if enabled then return 9 end end');
	workspace.updateFile('consumer.lua', "local provider<const> = require('provider'); return provider(false)");
	const before = workspace.getSnapshot();
	const provider = before.getFileData('provider.lua')!;
	assert.equal(provider.functionValueFlows[0].completion, LuaCompletion.Fallthrough);
	workspace.updateFile('consumer.lua', "local provider<const> = require('provider'); return provider(true)");
	assert.equal(workspace.getSnapshot().getFileData(provider.file), provider);
	workspace.updateFile(provider.file, 'return function(enabled) if enabled then return 9 else return 10 end end');
	assert.equal(workspace.getSnapshot().getFileData(provider.file)!.functionValueFlows[0].completion, LuaCompletion.None);
	assert.equal(before.getFileData(provider.file)!.functionValueFlows[0].completion, LuaCompletion.Fallthrough);
});
