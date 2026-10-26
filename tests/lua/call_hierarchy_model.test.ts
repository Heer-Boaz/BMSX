import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';

import { CallHierarchyDirection, CallHierarchyModel } from '../../ide/editor/contrib/call_hierarchy/model';
import { buildCallHierarchyPanelItems } from '../../ide/workbench/contrib/resources/panel/items';
import {
	collapseSelectedCallHierarchyNode,
	expandSelectedCallHierarchyNode,
} from '../../ide/workbench/contrib/resources/panel/navigation';
import { buildLuaSemanticFrontendFromSnapshot } from '../../toolchain/ts/lua/semantic/frontend';
import { resourceIdentityKey } from '../../ide/common/resource';
import { EditorTextModelService } from '../../ide/editor/model/model_service';
import { EditorLuaSemanticProject } from '../../ide/editor/contrib/intellisense/semantic/workspace/project';

function callHierarchyFixture(t: TestContext, path: string, source: string) {
	const project = new EditorLuaSemanticProject(0, new EditorTextModelService());
	const resource = { domain: 0 as const, path };
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

test('call hierarchy panel switches the same lazy tree between callers and callees', t => {
	const source = [
		'local function target() end',
		'local function direct()',
		'\ttarget()',
		'end',
		'local function caller()',
		'\tdirect()',
		'end',
	].join('\n');
	const { frontend, project, resource, address } = callHierarchyFixture(t, 'calls.lua', source);
	const direct = frontend.findSymbolsByPosition(address, 2, 16);
	assert.ok(direct);
	const model = new CallHierarchyModel(frontend, [direct.targets[0].id], 'direct', project);
	const root = model.roots[0];
	const expanded = new Set([root.id]);

	const incoming = buildCallHierarchyPanelItems(model, CallHierarchyDirection.CallsTo, expanded);
	const caller = model.resolveIncomingCalls(root)[0];
	assert.equal(incoming.length, 2);
	assert.equal(incoming[0].callHierarchyNodeId, root.id);
	assert.strictEqual(incoming[0].location, root.location);
	assert.deepEqual(incoming[0].resource, resource);
	assert.equal(incoming[0].location.path, address);
	assert.equal(incoming[0].callHierarchyExpanded, true);
	assert.equal(incoming[1].callHierarchyNodeId, caller.id);
	assert.strictEqual(incoming[1].location, caller.location);
	assert.equal(incoming[1].callHierarchyExpanded, false);

	const outgoing = buildCallHierarchyPanelItems(model, CallHierarchyDirection.CallsFrom, expanded);
	const callee = model.resolveOutgoingCalls(root)[0];
	assert.equal(outgoing.length, 2);
	assert.equal(outgoing[0].callHierarchyNodeId, root.id);
	assert.strictEqual(outgoing[0].location, root.location);
	assert.equal(outgoing[1].callHierarchyNodeId, callee.id);
	assert.strictEqual(outgoing[1].location, callee.location);
	assert.notEqual(caller.id, callee.id);

	assert.equal(expandSelectedCallHierarchyNode(incoming, 1, expanded), caller.id);
	const incomingExpanded = buildCallHierarchyPanelItems(model, CallHierarchyDirection.CallsTo, expanded);
	assert.equal(incomingExpanded.length, 3);
	assert.equal(incomingExpanded[1].callHierarchyExpanded, true);
	const callSite = incomingExpanded[2];
	const range = caller.fromRanges[0];
	assert.deepEqual(callSite.location, {
		path: range.path,
		range: {
			startLine: range.start.line,
			startColumn: range.start.column,
			endLine: range.end.line,
			endColumn: range.end.column,
		},
	});
	assert.deepEqual(callSite.resource, resource);
	assert.equal(callSite.callHierarchyExpandable, false);
	assert.equal(callSite.callHierarchyExpanded, false);
	assert.equal(expandSelectedCallHierarchyNode(incomingExpanded, 2, expanded), null);

	const outgoingAfterIncomingExpansion = buildCallHierarchyPanelItems(model, CallHierarchyDirection.CallsFrom, expanded);
	assert.equal(outgoingAfterIncomingExpansion.length, 2);
	assert.equal(outgoingAfterIncomingExpansion[1].callHierarchyExpanded, false);

	assert.equal(collapseSelectedCallHierarchyNode(incomingExpanded, 0, expanded), root.id);
	const collapsed = buildCallHierarchyPanelItems(model, CallHierarchyDirection.CallsTo, expanded);
	assert.equal(collapsed.length, 1);
	assert.equal(collapsed[0].callHierarchyNodeId, root.id);
	assert.equal(collapsed[0].callHierarchyExpanded, false);
});
