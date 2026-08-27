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
		{
			declId: 'testpath|1|7|constant|constants',
			alias: 'constants',
			module: 'constants',
			memberPath: [],
		},
		{
			declId: 'testpath|2|7|constant|hud',
			alias: 'hud',
			module: 'constants',
			memberPath: ['hud'],
		},
		{
			declId: 'testpath|3|7|constant|physics',
			alias: 'physics',
			module: 'constants',
			memberPath: ['physics'],
		},
		{
			declId: 'testpath|4|7|constant|overlay',
			alias: 'overlay',
			module: 'constants',
			memberPath: ['hud', 'overlay'],
		},
		{
			declId: 'testpath|5|7|constant|combat_overlap',
			alias: 'combat_overlap',
			module: 'combat_overlap',
			memberPath: [],
		},
	]);
});

test('semantic workspace resolves transitive module aliases independently of file order', async () => {
	const { LuaSemanticWorkspace } = await semanticModelModulePromise;
	const baseSource = [
		'local base<const> = {}',
		'function base.tools.byte() end',
		'return base',
	].join('\n');
	const facadeSource = [
		"local base<const> = require('base')",
		'return base.tools',
	].join('\n');
	const mainLines = [
		"api = require('facade')",
		'api.byte()',
	];
	const workspace = new LuaSemanticWorkspace();
	workspace.updateFile('main.lua', mainLines.join('\n'));
	workspace.updateFile('facade.lua', facadeSource);
	workspace.updateFile('base.lua', baseSource);
	const target = workspace.getSnapshot().symbolAt(
		'main.lua',
		2,
		mainLines[1].indexOf('byte') + 1,
	);

	assert.ok(target, 'transitively exported member target');
	assert.equal(target!.decl.file, 'base.lua');
	assert.deepEqual(target!.decl.namePath, ['base', 'tools', 'byte']);
});

test('semantic workspace incrementally retargets transitive module aliases', async () => {
	const { LuaSemanticWorkspace } = await semanticModelModulePromise;
	const leftSource = [
		'local left<const> = {}',
		'function left.left_action() end',
		'return left',
	].join('\n');
	const rightSource = [
		'local right<const> = {}',
		'function right.right_action() end',
		'return right',
	].join('\n');
	const facadeSource = (module: string) => [
		`local facade<const> = require('${module}')`,
		'return facade',
	].join('\n');
	const mainLines = [
		"local api<const> = require('facade')",
		'api.left_action()',
		'api.right_action()',
	];
	const workspace = new LuaSemanticWorkspace();
	workspace.updateFile('main.lua', mainLines.join('\n'));
	workspace.updateFile('facade.lua', facadeSource('left'));
	workspace.updateFile('left.lua', leftSource);
	workspace.updateFile('right.lua', rightSource);
	const leftColumn = mainLines[1].indexOf('left_action') + 1;
	const rightColumn = mainLines[2].indexOf('right_action') + 1;
	const leftTarget = workspace.getSnapshot().symbolAt('main.lua', 2, leftColumn);
	assert.ok(leftTarget, 'initial transitive target');
	assert.equal(leftTarget!.decl.file, 'left.lua');
	assert.equal(workspace.getSnapshot().symbolAt('main.lua', 3, rightColumn), null);

	workspace.updateFile('facade.lua', facadeSource('right'));
	assert.equal(workspace.getSnapshot().symbolAt('main.lua', 2, leftColumn), null);
	const rightTarget = workspace.getSnapshot().symbolAt('main.lua', 3, rightColumn);
	assert.ok(rightTarget, 'retargeted transitive target');
	assert.equal(rightTarget!.decl.file, 'right.lua');
});

test('semantic workspace resolves members added to an imported module table', async () => {
	const { buildLuaFileSemanticData, LuaSemanticWorkspace } = await semanticModelModulePromise;
	const baseSource = [
		'local base<const> = {}',
		'return base',
	].join('\n');
	const facadeSource = [
		"local base<const> = require('base')",
		'function base.tools.added() end',
		'return base',
	].join('\n');
	const mainLines = [
		"local api<const> = require('facade')",
		'api.tools.added()',
	];
	const workspace = new LuaSemanticWorkspace();
	workspace.updateFiles([
		buildLuaFileSemanticData(mainLines.join('\n'), 'main.lua'),
		buildLuaFileSemanticData(facadeSource, 'facade.lua'),
		buildLuaFileSemanticData(baseSource, 'base.lua'),
	]);
	const target = workspace.getSnapshot().symbolAt(
		'main.lua',
		2,
		mainLines[1].indexOf('added') + 1,
	);

	assert.ok(target, 'imported table augmentation target');
	assert.equal(target!.decl.file, 'facade.lua');
	assert.deepEqual(target!.decl.namePath, ['base', 'tools', 'added']);
});

test('semantic workspace incrementally removes imported table augmentations', async () => {
	const { buildLuaFileSemanticData, LuaSemanticWorkspace } = await semanticModelModulePromise;
	const baseSource = 'local base<const> = {}\nreturn base';
	const facadeSource = [
		"local base<const> = require('base')",
		'function base.added() end',
		'return base',
	].join('\n');
	const mainLines = [
		"local api<const> = require('facade')",
		'api.added()',
	];
	const workspace = new LuaSemanticWorkspace();
	workspace.updateFiles([
		buildLuaFileSemanticData(baseSource, 'base.lua'),
		buildLuaFileSemanticData(facadeSource, 'facade.lua'),
		buildLuaFileSemanticData(mainLines.join('\n'), 'main.lua'),
	]);
	const column = mainLines[1].indexOf('added') + 1;
	assert.ok(workspace.getSnapshot().symbolAt('main.lua', 2, column));

	workspace.updateFile('facade.lua', "local base<const> = require('base')\nreturn base");
	assert.equal(workspace.getSnapshot().symbolAt('main.lua', 2, column), null);
});

test('semantic workspace terminates circular module aliases without a false target', async () => {
	const { LuaSemanticWorkspace } = await semanticModelModulePromise;
	const workspace = new LuaSemanticWorkspace();
	workspace.updateFile('main.lua', "local api<const> = require('left')\napi.value()");
	workspace.updateFile('left.lua', "local left<const> = require('right')\nreturn left");
	workspace.updateFile('right.lua', "local right<const> = require('left')\nreturn right");

	assert.equal(workspace.getSnapshot().symbolAt('main.lua', 2, 5), null);
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

test('semantic workspace batch retargets inherited members through reverse class dependencies', async () => {
	const { buildLuaFileSemanticData, LuaSemanticWorkspace } = await semanticModelModulePromise;
	const baseLeftSource = [
		'local base_left<const> = {}',
		'function base_left:left_action() end',
		'return base_left',
	].join('\n');
	const baseRightSource = [
		'local base_right<const> = {}',
		'function base_right:right_action() end',
		'return base_right',
	].join('\n');
	const derivedLeftSource = [
		"local base_left<const> = require('base_left')",
		'local derived<const> = {}',
		'derived.__index = derived',
		'setmetatable(derived, { __index = base_left })',
		'return derived',
	].join('\n');
	const derivedRightSource = [
		"local base_right<const> = require('base_right')",
		'local derived<const> = {}',
		'derived.__index = derived',
		'setmetatable(derived, { __index = base_right })',
		'return derived',
	].join('\n');
	const mainLines = [
		"local derived<const> = require('derived')",
		'derived:left_action()',
		'derived:right_action()',
	];
	const workspace = new LuaSemanticWorkspace();
	workspace.updateFiles([
		buildLuaFileSemanticData(mainLines.join('\n'), 'main.lua'),
		buildLuaFileSemanticData(derivedLeftSource, 'derived.lua'),
		buildLuaFileSemanticData(baseLeftSource, 'base_left.lua'),
		buildLuaFileSemanticData(baseRightSource, 'base_right.lua'),
	]);
	assert.equal(workspace.version, 1, 'one workspace version per source batch');
	const leftColumn = mainLines[1].indexOf('left_action') + 1;
	const rightColumn = mainLines[2].indexOf('right_action') + 1;
	const leftTarget = workspace.getSnapshot().symbolAt('main.lua', 2, leftColumn);
	assert.ok(leftTarget, 'initial inherited member target');
	assert.equal(leftTarget!.decl.file, 'base_left.lua');
	assert.equal(workspace.getSnapshot().symbolAt('main.lua', 3, rightColumn), null);

	workspace.updateFiles([
		buildLuaFileSemanticData(derivedRightSource, 'derived.lua'),
	]);
	assert.equal(workspace.version, 2, 'incremental batch commits once');
	assert.equal(workspace.getSnapshot().symbolAt('main.lua', 2, leftColumn), null);
	const rightTarget = workspace.getSnapshot().symbolAt('main.lua', 3, rightColumn);
	assert.ok(rightTarget, 'retargeted inherited member target');
	assert.equal(rightTarget!.decl.file, 'base_right.lua');
});

test('semantic workspace resolves explicit-self methods through prefab inheritance', async () => {
	const { LuaSemanticWorkspace } = await semanticModelModulePromise;
	const baseLeftSource = [
		'local base_left<const> = {}',
		'function base_left:left_action() end',
		'return base_left',
	].join('\n');
	const baseRightSource = [
		'local base_right<const> = {}',
		'function base_right:right_action() end',
		'return base_right',
	].join('\n');
	const derivedLeftLines = [
		"local prefab<const> = require('cartlib/world/prefab')",
		"local base_left<const> = require('base_left')",
		'local derived<const> = {}',
		'function derived.initialize(self)',
		'\tself:left_action()',
		'\tself:right_action()',
		'end',
		'local function register()',
		"\tprefab.define({ def_id = 'derived', class = derived, base = base_left })",
		'end',
		'return derived',
	];
	const derivedRightSource = derivedLeftLines
		.join('\n')
		.replaceAll('base_left', 'base_right');
	const workspace = new LuaSemanticWorkspace();
	workspace.updateFile('base_left.lua', baseLeftSource);
	workspace.updateFile('base_right.lua', baseRightSource);
	workspace.updateFile('derived.lua', derivedLeftLines.join('\n'));
	const leftColumn = derivedLeftLines[4].indexOf('left_action') + 1;
	const rightColumn = derivedLeftLines[5].indexOf('right_action') + 1;
	const initialLeftTarget = workspace.getSnapshot().symbolAt('derived.lua', 5, leftColumn);
	assert.ok(initialLeftTarget, 'prefab base method target');
	assert.equal(initialLeftTarget!.decl.file, 'base_left.lua');
	assert.equal(workspace.getSnapshot().symbolAt('derived.lua', 6, rightColumn), null);

	workspace.updateFile('derived.lua', derivedRightSource);
	assert.equal(workspace.getSnapshot().symbolAt('derived.lua', 5, leftColumn), null);
	const reboundRightTarget = workspace.getSnapshot().symbolAt('derived.lua', 6, rightColumn);
	assert.ok(reboundRightTarget, 'retargeted prefab base method target');
	assert.equal(reboundRightTarget!.decl.file, 'base_right.lua');
});

test('semantic workspace applies the prefab runtime default base', async () => {
	const { LuaSemanticWorkspace } = await semanticModelModulePromise;
	const worldObjectSource = [
		'local world_object<const> = {}',
		'function world_object:mark_for_disposal() end',
		'return world_object',
	].join('\n');
	const derivedLines = [
		"local prefab<const> = require('cartlib/world/prefab')",
		'local derived<const> = {}',
		'derived.initialize = function(self)',
		'\tself:mark_for_disposal()',
		'end',
		'local function register()',
		"\tprefab.define({ def_id = 'derived', class = derived })",
		'end',
		'return derived',
	];
	const workspace = new LuaSemanticWorkspace();
	workspace.updateFile('cartlib/world/world_object.lua', worldObjectSource);
	workspace.updateFile('derived.lua', derivedLines.join('\n'));
	const target = workspace.getSnapshot().symbolAt(
		'derived.lua',
		4,
		derivedLines[3].indexOf('mark_for_disposal') + 1,
	);

	assert.ok(target, 'default world object method target');
	assert.equal(target!.decl.file, 'cartlib/world/world_object.lua');
	assert.deepEqual(target!.decl.namePath, ['world_object', 'mark_for_disposal']);
});

test('semantic workspace retargets spawn results when a global prefab id changes', async () => {
	const { LuaSemanticWorkspace } = await semanticModelModulePromise;
	const constantsLeftSource = [
		"left_def = 'left'",
		"right_def = 'right'",
		"selected_def = 'left'",
	].join('\n');
	const constantsRightSource = constantsLeftSource.replace("selected_def = 'left'", "selected_def = 'right'");
	const leftSource = [
		"local prefab<const> = require('cartlib/world/prefab')",
		"require('constants')",
		'local left<const> = {}',
		'function left:left_action() end',
		'prefab.define({ def_id = left_def, class = left })',
		'return left',
	].join('\n');
	const rightSource = [
		"local prefab<const> = require('cartlib/world/prefab')",
		"require('constants')",
		'local right<const> = {}',
		'function right:right_action() end',
		'prefab.define({ def_id = right_def, class = right })',
		'return right',
	].join('\n');
	const mainLines = [
		"local world<const> = require('cartlib/world/world')",
		"require('constants')",
		'local spawned<const> = world:spawn(selected_def, {})',
		'spawned:left_action()',
		'spawned:right_action()',
	];
	const workspace = new LuaSemanticWorkspace();
	workspace.updateFile('constants.lua', constantsLeftSource);
	workspace.updateFile('left.lua', leftSource);
	workspace.updateFile('right.lua', rightSource);
	workspace.updateFile('main.lua', mainLines.join('\n'));
	const leftColumn = mainLines[3].indexOf('left_action') + 1;
	const rightColumn = mainLines[4].indexOf('right_action') + 1;
	const initialTarget = workspace.getSnapshot().symbolAt('main.lua', 4, leftColumn);
	assert.ok(initialTarget, 'global prefab id target');
	assert.equal(initialTarget!.decl.file, 'left.lua');
	assert.equal(workspace.getSnapshot().symbolAt('main.lua', 5, rightColumn), null);

	workspace.updateFile('constants.lua', constantsRightSource);
	assert.equal(workspace.getSnapshot().symbolAt('main.lua', 4, leftColumn), null);
	const reboundTarget = workspace.getSnapshot().symbolAt('main.lua', 5, rightColumn);
	assert.ok(reboundTarget, 'retargeted global prefab id target');
	assert.equal(reboundTarget!.decl.file, 'right.lua');
});

test('semantic workspace resolves spawn results through exported prefab ids', async () => {
	const { LuaSemanticWorkspace } = await semanticModelModulePromise;
	const actorSource = [
		"local prefab<const> = require('cartlib/world/prefab')",
		'local actor<const> = {}',
		"local definition_id<const> = 'actor'",
		'function actor:run() end',
		'prefab.define({ def_id = definition_id, class = actor })',
		'return { definition_id = definition_id }',
	].join('\n');
	const mainLines = [
		"local world<const> = require('cartlib/world/world')",
		"local actor_module<const> = require('actor')",
		'local actor<const> = world:spawn(actor_module.definition_id, {})',
		'actor:run()',
	];
	const workspace = new LuaSemanticWorkspace();
	workspace.updateFile('actor.lua', actorSource);
	workspace.updateFile('main.lua', mainLines.join('\n'));
	const target = workspace.getSnapshot().symbolAt(
		'main.lua',
		4,
		mainLines[3].indexOf('run') + 1,
	);

	assert.ok(target, 'exported prefab id target');
	assert.equal(target!.decl.file, 'actor.lua');
	assert.deepEqual(target!.decl.namePath, ['actor', 'run']);
});

test('semantic workspace retains exported table identity across local shadowing', async () => {
	const { LuaSemanticWorkspace } = await semanticModelModulePromise;
	const signatureSource = [
		'local signature<const> = {}',
		'local internal_operand<const> = { entry = 1 }',
		'signature.operand = internal_operand',
		'return signature',
	].join('\n');
	const mainLines = [
		"local signature<const> = require('signature')",
		'local operand<const> = signature.operand',
		'local selected<const> = operand.entry',
		'local passthrough<const> = function(operand) return operand end',
	];
	const workspace = new LuaSemanticWorkspace();
	workspace.updateFile('main.lua', mainLines.join('\n'));
	workspace.updateFile('signature.lua', signatureSource);
	const entryTarget = workspace.getSnapshot().symbolAt(
		'main.lua',
		3,
		mainLines[2].indexOf('entry') + 1,
	);

	assert.ok(entryTarget, 'exported nested table member target');
	assert.equal(entryTarget!.decl.file, 'signature.lua');
	assert.deepEqual(entryTarget!.decl.namePath, ['internal_operand', 'entry']);
});
