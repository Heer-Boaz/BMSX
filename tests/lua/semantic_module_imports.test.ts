import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildLuaFileSemanticData, LuaSemanticWorkspace } from '../../toolchain/ts/lua/semantic/model';
import { getLuaModuleAliasTarget, type ModuleAliasTarget } from '../../toolchain/ts/lua/semantic/module_bindings';
import { semanticSnapshot } from './semantic_test_harness';

const PUBLIC: ModuleAliasTarget = { module: 'public/api', memberPath: ['group', 'run'] };
const CALL: ModuleAliasTarget = { module: 'bridge', memberPath: ['run'] };

test('immediate module aliases compose in member order and preserve the public API boundary', () => {
	const files = [
		buildLuaFileSemanticData("local api = require('public/api'); return api['group']", 'middle.lua'),
		buildLuaFileSemanticData("local module = require('middle'); local copy = module; return copy", 'bridge.lua'),
		buildLuaFileSemanticData("return require('private/implementation')", 'public/api.lua'),
	];
	assert.deepEqual(getLuaModuleAliasTarget(files[0], files[0].moduleValues[0].source), { module: 'public/api', memberPath: ['group'] });
	for (const ordered of [files, files.toReversed()]) {
		const snapshot = semanticSnapshot(...ordered);
		const query = snapshot.symbolResolver.moduleImports;
		assert.equal(query.matchesImport(CALL, PUBLIC), true);
		assert.equal(query.matchesImport(PUBLIC, PUBLIC), true, 'the public module is not normalized away');
		assert.equal(query.matchesImport(CALL, { module: PUBLIC.module, memberPath: ['run', 'group'] }), false);
		assert.equal(query.matchesImport({ module: 'bridge', memberPath: [] }, PUBLIC), false);
		assert.equal(query.matchesImport({ module: 'bridge', memberPath: ['run', 'extra'] }, PUBLIC), false);
		assert.equal(snapshot.symbolResolver.moduleImports, query);
	}
});

test('member reexports can be called directly without manufacturing a dot-call member', () => {
	const file = buildLuaFileSemanticData("return require('public/api').group.run", 'bridge.lua');
	const query = semanticSnapshot(file).symbolResolver.moduleImports;
	assert.equal(query.matchesImport({ module: 'bridge', memberPath: [] }, PUBLIC), true);
	assert.equal(query.matchesImport(CALL, PUBLIC), false);
});

test('conditional, reassigned, factory and aggregate exports do not become guessed API aliases', () => {
	for (const source of [
		"local api = require('public/api'); if condition then return other end; return api.group",
		"local api = require('public/api'); local function replace() api = other end; return api.group",
		"local api = require('public/api'); return { run = api.group.run }",
		"local function make() return require('public/api').group end; return make()",
		"local function require(name) return replacement end; return require('public/api').group",
		"return require('public/api')[key]",
		"return require('public/api').group, other",
		"do return require('public/api').group end",
		"return global_api",
		"return function() return require('public/api').group end",
		"local broken = ; return require('public/api').group",
		'',
	]) {
		const query = semanticSnapshot(buildLuaFileSemanticData(source, 'bridge.lua')).symbolResolver.moduleImports;
		assert.equal(query.matchesImport(CALL, PUBLIC), false, source);
	}
	const query = semanticSnapshot().symbolResolver.moduleImports;
	assert.equal(query.matchesImport(CALL, PUBLIC), false, 'an absent bridge is not a namesake match');
	assert.equal(query.matchesImport(PUBLIC, PUBLIC), true, 'an explicit public spelling is already the authored contract');
});

test('ambiguous normalized module names do not choose a provider by file order', () => {
	const bridge = buildLuaFileSemanticData("return require('public/api').group", 'bridge.lua');
	for (const source of ["return require('public/api').group", '']) {
		const namesake = buildLuaFileSemanticData(source, 'carts/fixture/bridge.lua');
		for (const files of [[bridge, namesake], [namesake, bridge]]) {
			assert.equal(semanticSnapshot(...files).symbolResolver.moduleImports.matchesImport(CALL, PUBLIC), false);
		}
	}
});

test('cached failures and successes are replaced only by a new workspace snapshot', () => {
	const workspace = new LuaSemanticWorkspace();
	const consumer = buildLuaFileSemanticData("local api = require('bridge'); api.run()", 'consumer.lua');
	workspace.updateFiles([consumer]);
	const missing = workspace.getSnapshot().symbolResolver.moduleImports;
	assert.equal(missing.matchesImport(CALL, PUBLIC), false);
	workspace.updateFiles([buildLuaFileSemanticData("return require('public/api').group", 'bridge.lua')]);
	const admitted = workspace.getSnapshot().symbolResolver.moduleImports;
	assert.equal(admitted.matchesImport(CALL, PUBLIC), true);
	workspace.updateFiles([buildLuaFileSemanticData('return replacement', 'bridge.lua')]);
	const replaced = workspace.getSnapshot().symbolResolver.moduleImports;
	assert.equal(replaced.matchesImport(CALL, PUBLIC), false);
	assert.equal(admitted.matchesImport(CALL, PUBLIC), true);
	assert.equal(missing.matchesImport(CALL, PUBLIC), false);
	assert.equal(workspace.getSnapshot().getFileData(consumer.file), consumer);
});

test('long aliases and member-growing cycles terminate without recursion, caps or expanded paths', () => {
	const count = 10000;
	const files = Array.from({ length: count }, (_, index) => buildLuaFileSemanticData(
		`return require('${index + 1 === count ? 'public/api' : `link${index + 1}`}')`, `link${index}.lua`));
	files.push(buildLuaFileSemanticData("return require('loop_b')", 'loop_a.lua'));
	files.push(buildLuaFileSemanticData("return require('loop_a')", 'loop_b.lua'));
	files.push(buildLuaFileSemanticData("return require('growth').group", 'growth.lua'));
	const query = semanticSnapshot(...files).symbolResolver.moduleImports;
	for (const file of files.slice(0, count)) {
		assert.equal(query.matchesImport({ module: file.file.slice(0, -4), memberPath: PUBLIC.memberPath }, PUBLIC), true);
	}
	for (let index = 0; index < 2; index += 1) {
		assert.equal(query.matchesImport({ module: 'loop_a', memberPath: [] }, PUBLIC), false);
		assert.equal(query.matchesImport({ module: 'growth', memberPath: [] }, { module: PUBLIC.module, memberPath: Array(1000).fill('group') }), false);
	}
});
