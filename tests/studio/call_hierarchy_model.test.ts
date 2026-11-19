import { TEST_CARTRIDGE_CONTEXT_IDS } from '../helpers/runtime_sources';
import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';

import { CallHierarchyDirection, CallHierarchyModel } from '../../ide/editor/contrib/call_hierarchy/model';
import { buildLuaSemanticFrontendFromSnapshot } from '../../toolchain/ts/lua/semantic/frontend';
import { resourceIdentityKey } from '../../ide/common/resource';
import { EditorTextModelService } from '../../ide/editor/model/model_service';
import { EditorLuaSemanticProject } from '../../ide/editor/contrib/intellisense/semantic/workspace/project';

function callHierarchyFixture(t: TestContext, path: string, source: string) {
	const project = new EditorLuaSemanticProject(TEST_CARTRIDGE_CONTEXT_IDS[0], new EditorTextModelService());
	const resource = { contextId: TEST_CARTRIDGE_CONTEXT_IDS[0], path };
	project.updateDocument(resource, source);
	t.after(() => project.dispose());
	return { project, resource, address: resourceIdentityKey(resource), frontend: buildLuaSemanticFrontendFromSnapshot(project.getSnapshot()) };
}

test('CallHierarchyModel resolves incoming callers one expanded branch at a time', t => {
	const source = [
		'local function target() end',
		'local function left()',
		'\ttarget()',
		'end',
		'local function right()',
		'\ttarget()',
		'end',
		'local function shared()',
		'\tleft()',
		'\tright()',
		'end',
	].join('\n');
	const { frontend, project, address } = callHierarchyFixture(t, 'calls.lua', source);
	const target = frontend.findSymbolsByPosition(address, 1, 16);
	assert.ok(target);
	const model = new CallHierarchyModel(frontend, [target.targets[0].id], 'target', project);
	const root = model.roots[0];
	const direction = CallHierarchyDirection.CallsTo;

	assert.equal(model.hasChildren(root, direction), true);
	const directCallers = model.resolveIncomingCalls(root);
	assert.deepEqual(directCallers.map(node => node.name), ['left', 'right']);
	assert.equal(directCallers[0].kind, 'symbol');
	assert.equal(directCallers[1].kind, 'symbol');
	if (directCallers[0].kind !== 'symbol' || directCallers[1].kind !== 'symbol') {
		assert.fail('direct callers must resolve to their function declarations');
	}
	assert.equal(model.hasChildren(directCallers[0], direction), true);
	assert.equal(model.hasChildren(directCallers[1], direction), true);

	const leftCallers = model.resolveIncomingCalls(directCallers[0]);
	const rightCallers = model.resolveIncomingCalls(directCallers[1]);
	assert.deepEqual(leftCallers.map(node => node.name), ['shared']);
	assert.deepEqual(rightCallers.map(node => node.name), ['shared']);
	assert.notEqual(leftCallers[0].id, rightCallers[0].id, 'branch identity includes the parent path');
});

test('CallHierarchyModel removes the expansion marker after resolving an empty root', t => {
	const source = 'local function unused() end';
	const { frontend, project, address } = callHierarchyFixture(t, 'unused.lua', source);
	const target = frontend.findSymbolsByPosition(address, 1, 16);
	assert.ok(target);
	const model = new CallHierarchyModel(frontend, [target.targets[0].id], 'unused', project);
	const root = model.roots[0];

	assert.equal(model.hasChildren(root, CallHierarchyDirection.CallsTo), true, 'unresolved symbols can request their incoming layer');
	assert.deepEqual(model.resolveIncomingCalls(root), []);
	assert.equal(model.hasChildren(root, CallHierarchyDirection.CallsTo), false);
});

test('CallHierarchyModel resolves outgoing callees one expanded branch at a time', t => {
	const source = [
		'local function target() end',
		'local function left()',
		'\ttarget()',
		'\ttarget()',
		'end',
		'local function right()',
		'\ttarget()',
		'end',
		'local function shared()',
		'\tleft()',
		'\tright()',
		'end',
	].join('\n');
	const { frontend, project, address } = callHierarchyFixture(t, 'calls.lua', source);
	const shared = frontend.findSymbolsByPosition(address, 9, 16);
	assert.ok(shared);
	const model = new CallHierarchyModel(frontend, [shared.targets[0].id], 'shared', project);
	const root = model.roots[0];

	assert.equal(model.hasChildren(root, CallHierarchyDirection.CallsFrom), true);
	const directCallees = model.resolveOutgoingCalls(root);
	assert.deepEqual(directCallees.map(node => node.name), ['left', 'right']);
	assert.deepEqual(directCallees.map(node => node.fromRanges.length), [1, 1]);
	assert.equal(directCallees[0].kind, 'symbol');
	assert.equal(directCallees[1].kind, 'symbol');
	if (directCallees[0].kind !== 'symbol' || directCallees[1].kind !== 'symbol') {
		assert.fail('direct callees must resolve to their function declarations');
	}

	const leftCallees = model.resolveOutgoingCalls(directCallees[0]);
	const rightCallees = model.resolveOutgoingCalls(directCallees[1]);
	assert.deepEqual(leftCallees.map(node => node.name), ['target']);
	assert.deepEqual(rightCallees.map(node => node.name), ['target']);
	assert.equal(leftCallees[0].fromRanges.length, 2);
	assert.equal(rightCallees[0].fromRanges.length, 1);
	assert.notEqual(leftCallees[0].id, rightCallees[0].id, 'branch identity includes the parent path');
});
