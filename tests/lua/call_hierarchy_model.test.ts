import assert from 'node:assert/strict';
import { test } from 'node:test';

import { CallHierarchyDirection, CallHierarchyModel } from '../../ide/editor/contrib/call_hierarchy/model';
import { buildCallHierarchyPanelItems } from '../../ide/workbench/contrib/resources/panel/items';
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

test('CallHierarchyModel removes the expansion marker after resolving an empty root', () => {
	const source = 'local function unused() end';
	const frontend = buildLuaSemanticFrontend([{ path: 'unused.lua', source }]);
	const target = frontend.findSymbolsByPosition('unused.lua', 1, 16);
	assert.ok(target);
	const model = new CallHierarchyModel(frontend, [target.targets[0].id], 'unused');
	const root = model.roots[0];

	assert.equal(model.hasChildren(root, CallHierarchyDirection.CallsTo), true, 'unresolved symbols can request their incoming layer');
	assert.deepEqual(model.resolveIncomingCalls(root), []);
	assert.equal(model.hasChildren(root, CallHierarchyDirection.CallsTo), false);
});

test('CallHierarchyModel resolves outgoing callees one expanded branch at a time', () => {
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
	const frontend = buildLuaSemanticFrontend([{ path: 'calls.lua', source }]);
	const shared = frontend.findSymbolsByPosition('calls.lua', 9, 16);
	assert.ok(shared);
	const model = new CallHierarchyModel(frontend, [shared.targets[0].id], 'shared');
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

test('call hierarchy panel switches the same lazy tree between callers and callees', () => {
	const source = [
		'local function target() end',
		'local function direct()',
		'\ttarget()',
		'end',
		'local function caller()',
		'\tdirect()',
		'end',
	].join('\n');
	const frontend = buildLuaSemanticFrontend([{ path: 'calls.lua', source }]);
	const direct = frontend.findSymbolsByPosition('calls.lua', 2, 16);
	assert.ok(direct);
	const model = new CallHierarchyModel(frontend, [direct.targets[0].id], 'direct');
	const expanded = new Set([model.roots[0].id]);

	const incoming = buildCallHierarchyPanelItems(model, CallHierarchyDirection.CallsTo, expanded);
	assert.match(incoming[0].line, /^CALLERS OF - direct /);
	assert.match(incoming[1].line, /caller/);

	const outgoing = buildCallHierarchyPanelItems(model, CallHierarchyDirection.CallsFrom, expanded);
	assert.match(outgoing[0].line, /^CALLS FROM - direct /);
	assert.match(outgoing[1].line, /target/);
});
