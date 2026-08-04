import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
	auditCartlibHotPaths,
	readCartlibHotPathManifest,
} from '../../scripts/analysis/cartlib_hot_paths';
import {
	indexTopLevelLuaFunctions,
	luaFunctionCallTargetCounts,
	luaFunctionSyntaxCount,
} from '../../scripts/analysis/lua_hot_paths';
import { parseLuaChunk } from '../../toolchain/ts/lua/analysis/parse';
import { LuaSyntaxKind } from '../../toolchain/ts/lua/syntax/ast';

const repoRoot = process.cwd();
const manifest = readCartlibHotPathManifest(repoRoot);

test('pre-CORE cartlib hot-path inventory matches live named functions and dispatch anchors', () => {
	assert.deepEqual(auditCartlibHotPaths(repoRoot, manifest), []);
});

test('cartlib hot-path audit rejects stale function identities and surface omissions', () => {
	const staleIdentity = structuredClone(manifest);
	const updateIndex = staleIdentity.cartlib_functions.indexOf('cartlib/world/world.lua::world_class:update');
	staleIdentity.cartlib_functions[updateIndex] = 'cartlib/world/world.lua::world_class:update_missing';
	assert.ok(auditCartlibHotPaths(repoRoot, staleIdentity).some(
		error => error === 'cartlib/world/world.lua::world_class:update_missing: named top-level function is missing',
	));

	const missingSurfaceFunction = structuredClone(manifest);
	missingSurfaceFunction.cartlib_functions.shift();
	assert.ok(auditCartlibHotPaths(repoRoot, missingSurfaceFunction).some(
		error => error === 'scripts/cartlib_hot_paths.json: missing surface hot function cartlib/action_effects.lua::actioneffectcomponent:trigger',
	));
});

test('cartlib hot-path audit rejects stale dispatch anchors and un-inventoried observed targets', () => {
	const staleCall = structuredClone(manifest);
	staleCall.dispatch_boundaries.find(boundary => boundary.id === 'ecs-system-update')!.call = 'systems[]:tick';
	assert.ok(auditCartlibHotPaths(repoRoot, staleCall).some(
		error => error === 'ecs-system-update: call systems[]:tick expected 1, found 0',
	));

	const missingTarget = structuredClone(manifest);
	const target = 'carts/2025/cart.lua::draw_director_visual';
	missingTarget.cart_functions.splice(missingTarget.cart_functions.indexOf(target), 1);
	assert.ok(auditCartlibHotPaths(repoRoot, missingTarget).some(
		error => error === `custom-visual-producer: target is not inventoried (${target})`,
	));
});

test('cartlib hot-path audit rejects stale blocker evidence and unexplained callback gaps', () => {
	const staleBlocker = structuredClone(manifest);
	staleBlocker.known_blockers.find(blocker => blocker.id === 'render-depth-sort')!.evidence.count = 2;
	assert.ok(auditCartlibHotPaths(repoRoot, staleBlocker).some(
		error => error === 'render-depth-sort: blocker evidence expected 2, found 1',
	));

	const unexplainedGap = structuredClone(manifest);
	const boundary = unexplainedGap.dispatch_boundaries.find(entry => entry.id === 'fsm-state-update-handler')!;
	if (boundary.coverage === 'blocked') {
		boundary.reason = '';
	}
	assert.ok(auditCartlibHotPaths(repoRoot, unexplainedGap).some(
		error => error === 'fsm-state-update-handler: blocked dispatch needs a reason',
	));
});

test('direct hot-function analysis records nested closures but not their bodies', () => {
	const source = [
		'local outer<const> = function()',
		'\tdirect_call()',
		'\tlocal callback<const> = function()',
		'\t\tnested_call()',
		'\t\treturn {}',
		'\tend',
		'\treturn callback',
		'end',
	].join('\n');
	const parsed = parseLuaChunk(source, 'nested.lua', source.split('\n'));
	const outer = indexTopLevelLuaFunctions(parsed.chunk).get('outer')!;
	const calls = luaFunctionCallTargetCounts(outer);
	assert.equal(calls.get('direct_call'), 1);
	assert.equal(calls.has('nested_call'), false);
	assert.equal(luaFunctionSyntaxCount(outer, LuaSyntaxKind.FunctionExpression), 1);
	assert.equal(luaFunctionSyntaxCount(outer, LuaSyntaxKind.TableConstructorExpression), 0);
});
