import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compileLuaChunkToProgram } from '../../toolchain/ts/lua/compiler';
import { SemanticDemandIndex } from '../../toolchain/ts/lua/semantic/demand_index';
import { FunctionSummaryStore } from '../../toolchain/ts/lua/semantic/function_summary';
import { WorkspaceValueIdentityIndex } from '../../toolchain/ts/lua/semantic/identity';
import { SemanticInstantiationQuery, WriteSet } from '../../toolchain/ts/lua/semantic/instantiate';
import { buildLuaFileSemanticData, LuaSemanticWorkspace } from '../../toolchain/ts/lua/semantic/model';
import { declarationValueSource, literalValueSource } from '../../toolchain/ts/lua/semantic/value_graph';
import { runCompiledTestSystem } from '../helpers/blua32';
import { materializeCpuCompletionValues, parseLuaChunk } from './cpu_test_harness';

test('each write belongs to its executing function, not the captured declaration', () => {
	const file = buildLuaFileSemanticData([
		'local selected = 0',
		'local function left() selected = 11 end',
		'local function right() selected = 22 end',
	].join('\n'), 'writes.lua');
	const selected = file.decls.find(declaration => declaration.name === 'selected')!;
	const [left, right] = file.functionValueFlows;
	const values = file.declarationValues.filter(entry => entry.declId === selected.id);
	assert.deepEqual(values.map(entry => entry.flow), [undefined, left, right]);
	const summaries = new FunctionSummaryStore([file], new WorkspaceValueIdentityIndex({ files: [file], globalValues: new Map() }));
	const target = summaries.terms.compileSource(declarationValueSource(selected.id));
	for (const [index, value] of [11, 22].entries()) {
		assert.deepEqual(summaries.list()[index].aliases, [{
			target,
			source: summaries.terms.compileSource(literalValueSource({ kind: 'number', value })),
			relation: 'value',
		}]);
	}
	const demand = new SemanticDemandIndex([file], summaries);
	assert.deepEqual(demand.aliases.filter(alias => alias.target === target), [{
		target,
		source: summaries.terms.compileSource(literalValueSource({ kind: 'number', value: 0 })),
		relation: 'value',
	}]);
});

test('equal writes in different functions retain separate execution owners', () => {
	const file = buildLuaFileSemanticData([
		'local selected = 0',
		'local function left() selected = 11 end',
		'local function right() selected = 11 end',
	].join('\n'), 'equal.lua');
	const selected = file.decls.find(declaration => declaration.name === 'selected')!;
	const values = file.declarationValues.filter(entry => entry.declId === selected.id);
	assert.equal(values.length, 3);
	assert.equal(values[1].flow, file.functionValueFlows[0]);
	assert.equal(values[2].flow, file.functionValueFlows[1]);
});

test('summary and instantiated field rows retain equal RHS occurrences and writer scopes', () => {
	const file = buildLuaFileSemanticData(`local object = { task = 'same' }
local function install()
 object.task = 'same'
 object.task = 'same'
end`, 'equal-fields.lua');
	const summaries = new FunctionSummaryStore([file], new WorkspaceValueIdentityIndex({ files: [file], globalValues: new Map() }));
	const summary = summaries.list()[0];
	const field = file.decls.find(declaration => declaration.name === 'task')!;
	const sources = file.declarationValuesByDeclaration.get(field.id)!;
	assert.equal(summary.writes.length, 2, 'equal semantic values are not equal source occurrences');
	assert.equal(summary.writes[0].value, summary.writes[1].value);
	assert.deepEqual(summary.writes.map(write => write.source), sources.slice(1));
	const demand = new SemanticDemandIndex([file], summaries);
	assert.equal(demand.staticWrites(summary.writes[0].name)[0].source, sources[0]);
	const writes = new WriteSet(summaries.terms.dependencies);
	for (const frame of [-summary.id, 1, 2]) {
		for (const write of summary.writes) {
			assert.equal(writes.add(write, frame), true);
			assert.equal(writes.add(write, frame), false);
		}
	}
	const frames: number[] = [];
	const origins = [];
	for (let link = writes.first(summary.writes[0].base); link !== 0; link = writes.next(link)) {
		frames.push(writes.frame(link));
		origins.push(writes.source(link));
	}
	assert.deepEqual(frames, [-summary.id, -summary.id, 1, 1, 2, 2]);
	assert.deepEqual(origins, [sources[1], sources[2], sources[1], sources[2], sources[1], sources[2]]);
});

test('member replacement summaries contain their own values rather than a module-wide union', () => {
	const file = buildLuaFileSemanticData([
		'local api<const> = { selected = 0 }',
		'local function left() api.selected = 11 end',
		'local function right() api.selected = 22 end',
	].join('\n'), 'members.lua');
	const summaries = new FunctionSummaryStore([file], new WorkspaceValueIdentityIndex({ files: [file], globalValues: new Map() }));
	for (const [index, value] of [11, 22].entries()) {
		const summary = summaries.list()[index];
		assert.equal(summary.writes.length, 1);
		assert.equal(summary.writes[0].value, summaries.terms.compileSource(literalValueSource({ kind: 'number', value })));
	}
});

test('nested writes do not acquire the outer function that declared their destination', () => {
	const file = buildLuaFileSemanticData([
		'local function outer()',
		'\tlocal selected = 0',
		'\tlocal function inner() selected = 11 end',
		'\treturn inner',
		'end',
	].join('\n'), 'nested.lua');
	const [inner, outer] = file.functionValueFlows;
	const selected = file.decls.find(declaration => declaration.name === 'selected')!;
	const values = file.declarationValues.filter(entry => entry.declId === selected.id);
	assert.deepEqual(values.map(entry => entry.flow), [outer, inner]);
	const summaries = new FunctionSummaryStore([file], new WorkspaceValueIdentityIndex({ files: [file], globalValues: new Map() }));
	const target = summaries.terms.compileSource(declarationValueSource(selected.id));
	assert.deepEqual(summaries.list()[0].aliases.filter(alias => alias.target === target).map(alias => alias.source),
		[summaries.terms.compileSource(literalValueSource({ kind: 'number', value: 11 }))]);
	assert.deepEqual(summaries.list()[1].aliases.filter(alias => alias.target === target).map(alias => alias.source),
		[summaries.terms.compileSource(literalValueSource({ kind: 'number', value: 0 }))]);
});

test('a module write stays a module effect even when a function first named the member', () => {
	const file = buildLuaFileSemanticData([
		'local api<const> = {}',
		'local function install() api.selected = 11 end',
		'api.selected = 22',
	].join('\n'), 'module-write.lua');
	const summaries = new FunctionSummaryStore([file], new WorkspaceValueIdentityIndex({ files: [file], globalValues: new Map() }));
	const demand = new SemanticDemandIndex([file], summaries);
	const writes = demand.staticWrites(summaries.terms.nameId('selected'));
	assert.equal(writes.length, 1);
	assert.equal(file.memberValues.length, 1);
	assert.equal(file.functionValueFlows[0].members.length, 1);
	const declaration = file.decls.find(entry => entry.name === 'selected')!;
	const target = summaries.terms.compileSource(declarationValueSource(declaration.id));
	assert.deepEqual(demand.aliases.filter(alias => alias.target === target).map(alias => alias.source),
		[summaries.terms.compileSource(literalValueSource({ kind: 'number', value: 22 }))]);
});

test('the public resolver sees a module replacement after a function introduced the field', () => {
	const workspace = new LuaSemanticWorkspace();
	workspace.updateFile('module-write.lua', [
		'local api<const> = {}',
		'local function install() api.selected = { from_function = true } end',
		'api.selected = { from_module = true }',
		'local selected<const> = api.selected',
		'return selected.from_module',
	].join('\n'));
	const snapshot = workspace.getSnapshot();
	const selected = snapshot.getFileData('module-write.lua')!.decls.find(entry => entry.name === 'selected' && entry.kind === 'constant')!;
	assert.deepEqual(snapshot.symbolResolver.getMembers(declarationValueSource(selected.id)).map(entry => entry.name), ['from_module']);
});

test('instantiation publishes only the selected function writes, with compiled BLua as execution oracle', () => {
	const source = [
		'local selected = 0',
		'local function left() selected = 11 end',
		'local function right() selected = 22 end',
		'left()',
		'local after_left<const> = selected',
		'right()',
		'return after_left, selected',
	].join('\n');
	const file = buildLuaFileSemanticData(source, 'execute.lua');
	const summaries = new FunctionSummaryStore([file], new WorkspaceValueIdentityIndex({ files: [file], globalValues: new Map() }));
	const demand = new SemanticDemandIndex([file], summaries);
	const query = new SemanticInstantiationQuery(summaries, demand, () => assert.fail('literal setters contain no calls'));
	const selected = file.decls.find(entry => entry.name === 'selected')!;
	const target = summaries.terms.compileSource(declarationValueSource(selected.id));
	assert.equal(query.values.target(query.values.first(target)), summaries.terms.compileSource(literalValueSource({ kind: 'number', value: 0 })));
	assert.equal(query.values.next(query.values.first(target)), 0);
	query.instantiate(file.callValues[0], summaries.list()[0].id, 0, 0, [], undefined);
	const left = query.values.next(query.values.first(target));
	assert.equal(query.values.target(left), summaries.terms.compileSource(literalValueSource({ kind: 'number', value: 11 })));
	assert.equal(query.values.next(left), 0, 'the other body must not have published its value');
	query.instantiate(file.callValues[1], summaries.list()[1].id, 0, 0, [], undefined);
	const right = query.values.next(left);
	assert.equal(query.values.target(right), summaries.terms.compileSource(literalValueSource({ kind: 'number', value: 22 })));
	assert.equal(query.values.next(right), 0);
	const compiled = compileLuaChunkToProgram(parseLuaChunk(source, file.file), [], {
		entrySource: source, programDomain: 'system', optLevel: 0,
	});
	assert.deepEqual(materializeCpuCompletionValues(runCompiledTestSystem(compiled, 100000)), [11, 22]);
});
