import assert from 'node:assert/strict';
import { test } from 'node:test';

const semanticModelModulePromise = import('../../toolchain/ts/lua/semantic/model');

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

test('semantic workspace resolves fields exported by module table literals', async () => {
	const { LuaSemanticWorkspace } = await semanticModelModulePromise;
	const directorSource = [
		'local director = {}',
		'local function register_director() end',
		'function director.update() end',
		'return {',
		'\tdirector = director,',
		'\tregister = register_director,',
		'}',
	].join('\n');
	const mainLines = [
		'module<entry>',
		"local director_module<const> = require('director')",
		'director_module.register()',
		'director_module.director.update()',
	];
	const mainSource = mainLines.join('\n');
	const workspace = new LuaSemanticWorkspace();
	workspace.updateFile('main.lua', mainSource);
	workspace.updateFile('director.lua', directorSource);
	const snapshot = workspace.getSnapshot();
	const registerColumn = mainLines[2].indexOf('register') + 1;
	const registerTarget = snapshot.symbolAt('main.lua', 3, registerColumn);
	assert.ok(registerTarget, 'module table export target');
	assert.equal(registerTarget!.decl.file, 'director.lua');
	assert.deepEqual(registerTarget!.decl.namePath, ['register']);
	const updateColumn = mainLines[3].indexOf('update') + 1;
	const updateTarget = snapshot.symbolAt('main.lua', 4, updateColumn);
	assert.ok(updateTarget, 'nested module table member target');
	assert.equal(updateTarget!.decl.file, 'director.lua');
	assert.deepEqual(updateTarget!.decl.namePath, ['director', 'update']);
});

test('semantic workspace resolves methods on module-owned class instances', async () => {
	const { LuaSemanticWorkspace } = await semanticModelModulePromise;
	const serviceSource = [
		'local service',
		'local service_class<const> = {}',
		'service_class.__index = service_class',
		'function service_class.new()',
		'\tlocal self<const> = setmetatable({}, service_class)',
		'\treturn self',
		'end',
		'function service_class:run() end',
		'service = service_class.new()',
		'return service',
	].join('\n');
	const mainLines = [
		"local service<const> = require('service')",
		'service:run()',
	];
	const workspace = new LuaSemanticWorkspace();
	workspace.updateFile('main.lua', mainLines.join('\n'));
	workspace.updateFile('service.lua', serviceSource);
	const runTarget = workspace.getSnapshot().symbolAt(
		'main.lua',
		2,
		mainLines[1].indexOf('run') + 1,
	);

	assert.ok(runTarget, 'module-owned instance method target');
	assert.equal(runTarget!.decl.file, 'service.lua');
	assert.deepEqual(runTarget!.decl.namePath, ['service_class', 'run']);
});

test('semantic workspace resolves inherited module members through class metatables', async () => {
	const { LuaSemanticWorkspace } = await semanticModelModulePromise;
	const baseSource = [
		'local base<const> = {}',
		'function base:dispose() end',
		'return base',
	].join('\n');
	const middleSource = [
		"local base<const> = require('base')",
		'local middle<const> = {}',
		'middle.__index = middle',
		'setmetatable(middle, { __index = base })',
		'return middle',
	].join('\n');
	const leafSource = [
		"local middle<const> = require('middle')",
		'local leaf<const> = {}',
		'leaf.__index = leaf',
		'setmetatable(leaf, { __index = middle })',
		'return leaf',
	].join('\n');
	const mainLines = [
		"local leaf<const> = require('leaf')",
		'leaf:dispose()',
		'leaf:activate()',
	];
	const workspace = new LuaSemanticWorkspace();
	workspace.updateFile('main.lua', mainLines.join('\n'));
	workspace.updateFile('leaf.lua', leafSource);
	workspace.updateFile('middle.lua', middleSource);
	workspace.updateFile('base.lua', baseSource);
	const disposeTarget = workspace.getSnapshot().symbolAt(
		'main.lua',
		2,
		mainLines[1].indexOf('dispose') + 1,
	);

	assert.ok(disposeTarget, 'inherited module method target');
	assert.equal(disposeTarget!.decl.file, 'base.lua');
	assert.deepEqual(disposeTarget!.decl.namePath, ['base', 'dispose']);
	assert.equal(
		workspace.getSnapshot().symbolAt(
			'main.lua',
			3,
			mainLines[2].indexOf('activate') + 1,
		),
		null,
	);
	workspace.updateFile('base.lua', [
		'local base<const> = {}',
		'function base:dispose() end',
		'function base:activate() end',
		'return base',
	].join('\n'));
	const activateTarget = workspace.getSnapshot().symbolAt(
		'main.lua',
		3,
		mainLines[2].indexOf('activate') + 1,
	);
	assert.ok(activateTarget, 'incrementally added inherited method target');
	assert.equal(activateTarget!.decl.file, 'base.lua');
	assert.deepEqual(activateTarget!.decl.namePath, ['base', 'activate']);
});
