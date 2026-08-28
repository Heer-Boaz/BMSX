import assert from 'node:assert/strict';
import { test } from 'node:test';

import { CallHierarchyModel } from '../../ide/editor/contrib/call_hierarchy/model';
import { buildLuaSemanticFrontend } from '../../toolchain/ts/lua/semantic/frontend';

test('CallHierarchyModel resolves incoming callers one expanded branch at a time', () => {
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
	const frontend = buildLuaSemanticFrontend([{ path: 'calls.lua', source }]);
	const target = frontend.findSymbolsByPosition('calls.lua', 1, 16);
	assert.ok(target);
	const model = new CallHierarchyModel(frontend, [target.targets[0].id], 'target');
	const root = model.roots[0];

	assert.equal(model.hasChildren(root), true);
	const directCallers = model.resolveIncomingCalls(root);
	assert.deepEqual(directCallers.map(node => node.name), ['left', 'right']);
	assert.equal(directCallers[0].kind, 'symbol');
	assert.equal(directCallers[1].kind, 'symbol');
	if (directCallers[0].kind !== 'symbol' || directCallers[1].kind !== 'symbol') {
		assert.fail('direct callers must resolve to their function declarations');
	}
	assert.equal(model.hasChildren(directCallers[0]), true);
	assert.equal(model.hasChildren(directCallers[1]), true);

	const leftCallers = model.resolveIncomingCalls(directCallers[0]);
	const rightCallers = model.resolveIncomingCalls(directCallers[1]);
	assert.deepEqual(leftCallers.map(node => node.name), ['shared']);
	assert.deepEqual(rightCallers.map(node => node.name), ['shared']);
	assert.notEqual(leftCallers[0].id, rightCallers[0].id, 'branch identity includes the parent path');
});

test('CallHierarchyModel removes the expansion marker after resolving an empty root', () => {
	const source = 'local function unused() end';
	const frontend = buildLuaSemanticFrontend([{ path: 'unused.lua', source }]);
	const target = frontend.findSymbolsByPosition('unused.lua', 1, 16);
	assert.ok(target);
	const model = new CallHierarchyModel(frontend, [target.targets[0].id], 'unused');
	const root = model.roots[0];

	assert.equal(model.hasChildren(root), true, 'unresolved symbols can request their incoming layer');
	assert.deepEqual(model.resolveIncomingCalls(root), []);
	assert.equal(model.hasChildren(root), false);
});
