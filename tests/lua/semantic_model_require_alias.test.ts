import assert from 'node:assert/strict';
import { test } from 'node:test';

const semanticModelModulePromise = import('../../machine/ts/lua/semantic/model');

test('semantic file data records direct and chained require aliases', async () => {
	const { buildLuaFileSemanticData } = await semanticModelModulePromise;
	const source = [
		"local constants<const> = require('constants')",
		"local hud<const> = constants.hud",
		"local physics<const> = constants['physics']",
		"local overlay<const> = require('constants').hud.overlay",
		"local combat_overlap<const> = require('combat_overlap')",
		'return constants, hud, physics, overlay, combat_overlap',
	].join('\n');
	const data = buildLuaFileSemanticData(source, 'testpath');
	assert.deepEqual(data.moduleAliases, [
		{ alias: 'constants', module: 'constants', memberPath: [] },
		{ alias: 'hud', module: 'constants', memberPath: ['hud'] },
		{ alias: 'physics', module: 'constants', memberPath: ['physics'] },
		{ alias: 'overlay', module: 'constants', memberPath: ['hud', 'overlay'] },
		{ alias: 'combat_overlap', module: 'combat_overlap', memberPath: [] },
	]);
});

test('semantic workspace resolves require-alias member definitions through module returns', async () => {
	const { LuaSemanticWorkspace } = await semanticModelModulePromise;
	const roomSource = [
		'local room = {}',
		'function room.update() end',
		'room.value = 1',
		'return room',
	].join('\n');
	const mainSource = [
		"local room_api<const> = require('room')",
		'room_api.update()',
		'return room_api.value',
	].join('\n');
	const workspace = new LuaSemanticWorkspace();
	workspace.updateFile('room.lua', roomSource);
	workspace.updateFile('main.lua', mainSource);
	const snapshot = workspace.getSnapshot();
	const updateTarget = snapshot.symbolAt('main.lua', 2, mainSource.split('\n')[1]!.indexOf('update') + 1);
	assert.ok(updateTarget, 'module function target');
	assert.equal(updateTarget!.decl.file, 'room.lua');
	assert.deepEqual(updateTarget!.decl.namePath, ['room', 'update']);
	const valueTarget = snapshot.symbolAt('main.lua', 3, mainSource.split('\n')[2]!.indexOf('value') + 1);
	assert.ok(valueTarget, 'module value target');
	assert.equal(valueTarget!.decl.file, 'room.lua');
	assert.deepEqual(valueTarget!.decl.namePath, ['room', 'value']);
});

test('semantic workspace preserves require-alias member paths', async () => {
	const { LuaSemanticWorkspace } = await semanticModelModulePromise;
	const constantsSource = [
		'local constants = {}',
		'function constants.hud.draw() end',
		'return constants',
	].join('\n');
	const mainSource = [
		"local hud<const> = require('constants').hud",
		'hud.draw()',
	].join('\n');
	const workspace = new LuaSemanticWorkspace();
	workspace.updateFile('constants.lua', constantsSource);
	workspace.updateFile('main.lua', mainSource);
	const drawColumn = mainSource.split('\n')[1]!.indexOf('draw') + 1;
	const drawTarget = workspace.getSnapshot().symbolAt('main.lua', 2, drawColumn);
	assert.ok(drawTarget, 'nested module function target');
	assert.equal(drawTarget!.decl.file, 'constants.lua');
	assert.deepEqual(drawTarget!.decl.namePath, ['constants', 'hud', 'draw']);
});
