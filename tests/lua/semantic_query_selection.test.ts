import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SemanticDemandIndex } from '../../toolchain/ts/lua/semantic/demand_index';
import { SemanticEffectIndex } from '../../toolchain/ts/lua/semantic/effect_index';
import { FunctionSummaryStore, type FunctionSummaryID, type SemanticNameID } from '../../toolchain/ts/lua/semantic/function_summary';
import { WorkspaceValueIdentityIndex } from '../../toolchain/ts/lua/semantic/identity';
import { buildLuaFileSemanticData, LuaSemanticWorkspace } from '../../toolchain/ts/lua/semantic/model';
import { declarationValueSource } from '../../toolchain/ts/lua/semantic/value_graph';

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
	assert.deepEqual(demand.directTargets(file.callValues[0]), [target]);
	assert.deepEqual(demand.directTargets(file.callValues[1]), [target]);
	assert.deepEqual(demand.directTargets(file.callValues[2]), []);
	assert.deepEqual(demand.directTargets(file.callValues[3]), []);
	assert.equal(demand.staticCalleeEvaluations, 2, 'positive and negative queries are keyed by callee, not callsite');
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
	assert.equal(old.symbolResolver.getDeclaration(firstTarget[0]).range.start.line, 2);

	const replacement = buildLuaFileSemanticData('local provider = {}\n\n\nfunction provider.make() return { marker = 22 } end\nreturn provider', 'provider.lua');
	workspace.updateFiles([replacement]);
	const changed = workspace.getSnapshot();
	assert.equal(changed.getFileData('use.lua'), use);
	const changedTarget = changed.symbolResolver.resolveReferenceTargets(reference);
	assert.equal(changedTarget.length, 1);
	assert.equal(changed.symbolResolver.getDeclaration(changedTarget[0]).range.start.line, 4);
	assert.deepEqual(old.symbolResolver.resolveReferenceTargets(reference), firstTarget);
	assert.equal(old.symbolResolver.getDeclaration(firstTarget[0]).range.start.line, 2);

	workspace.updateFiles([], ['provider.lua']);
	const removed = workspace.getSnapshot();
	assert.deepEqual(removed.symbolResolver.resolveReferenceTargets(reference), []);
	workspace.updateFiles([first]);
	assert.deepEqual(workspace.getSnapshot().symbolResolver.resolveReferenceTargets(reference), firstTarget);
	assert.deepEqual(removed.symbolResolver.resolveReferenceTargets(reference), []);
});
