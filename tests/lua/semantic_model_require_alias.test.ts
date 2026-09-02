import assert from 'node:assert/strict';
import { test } from 'node:test';
import { semanticSymbolAt } from './semantic_test_harness';

const semanticWorkspaceModulePromise = import('../../toolchain/ts/lua/semantic/model');

test('semantic file data records direct and chained require aliases', async () => {
	const { buildLuaFileSemanticData } = await semanticWorkspaceModulePromise;
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

test('semantic call sites retain function-local module targets', async () => {
	const { buildLuaFileSemanticData } = await semanticWorkspaceModulePromise;
	const source = [
		'local register<const> = function()',
		"\tlocal trees<const> = require('cartlib/behaviour_tree/library')",
		"\ttrees.register('guard', { root = { type = 'task' } })",
		'end',
		'return register',
	].join('\n');
	const data = buildLuaFileSemanticData(source, 'function_local_alias.lua');
	const registration = data.callSites.find(callSite => callSite.expression.range.start.line === 3)!;
	assert.deepEqual(registration.moduleTarget, {
		module: 'cartlib/behaviour_tree/library',
		memberPath: ['register'],
	});
	assert.equal(registration.moduleTargetBinding, 'immutable');
});

test('semantic call sites retain the module target active at each call', async () => {
	const { buildLuaFileSemanticData } = await semanticWorkspaceModulePromise;
	const source = [
		"local api = require('left')",
		'api.first()',
		"api = require('right')",
		'api.second()',
	].join('\n');
	const data = buildLuaFileSemanticData(source, 'temporal_alias.lua');
	const first = data.callSites.find(callSite => callSite.expression.range.start.line === 2)!;
	const second = data.callSites.find(callSite => callSite.expression.range.start.line === 4)!;
	assert.deepEqual(first.moduleTarget, { module: 'left', memberPath: ['first'] });
	assert.deepEqual(second.moduleTarget, { module: 'right', memberPath: ['second'] });
	assert.equal(first.moduleTargetBinding, 'mutable');
	assert.equal(second.moduleTargetBinding, 'mutable');
});

test('semantic call sites resolve the callee before traversing argument closures', async () => {
	const { buildLuaFileSemanticData } = await semanticWorkspaceModulePromise;
	const source = [
		"local api = require('left')",
		'api.run(function()',
		"\tapi = require('right')",
		'end)',
	].join('\n');
	const data = buildLuaFileSemanticData(source, 'callee_before_arguments.lua');
	const call = data.callSites.find(callSite => callSite.expression.range.start.line === 2)!;
	assert.deepEqual(call.moduleTarget, { module: 'left', memberPath: ['run'] });
	assert.equal(call.moduleTargetBinding, 'mutable');
});

test('semantic call sites retain immutable module targets copied from mutable aliases', async () => {
	const { buildLuaFileSemanticData } = await semanticWorkspaceModulePromise;
	const source = [
		"local mutable = require('left')",
		'local retained<const> = mutable',
		"mutable = require('right')",
		'retained.run()',
	].join('\n');
	const data = buildLuaFileSemanticData(source, 'retained_alias.lua');
	const call = data.callSites.find(callSite => callSite.expression.range.start.line === 4)!;
	assert.deepEqual(call.moduleTarget, { module: 'left', memberPath: ['run'] });
	assert.equal(call.moduleTargetBinding, 'immutable');
});

test('semantic file data does not create module aliases after require is assigned globally', async () => {
	const { buildLuaFileSemanticData } = await semanticWorkspaceModulePromise;
	const source = [
		"local constants<const> = require('constants')",
		'require = function(name)',
		'\treturn name',
		'end',
		"local combat<const> = require('combat')",
	].join('\n');
	const data = buildLuaFileSemanticData(source, 'testpath');
	assert.deepEqual(data.moduleAliases, [
		{
			declId: 'testpath|1|7|constant|constants',
			alias: 'constants',
			module: 'constants',
			memberPath: [],
		},
	]);
	assert.deepEqual(data.moduleReferences.map(reference => reference.value), ['constants']);
});

test('semantic workspace resolves transitive module aliases independently of file order', async () => {
	const { LuaSemanticWorkspace } = await semanticWorkspaceModulePromise;
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
	const target = semanticSymbolAt(workspace.getSnapshot(),
		'main.lua',
		2,
		mainLines[1].indexOf('byte') + 1,
	);

	assert.ok(target, 'transitively exported member target');
	assert.equal(target!.declaration.file, 'base.lua');
	assert.deepEqual(target!.declaration.namePath, ['base', 'tools', 'byte']);
});

test('semantic workspace incrementally retargets transitive module aliases', async () => {
	const { LuaSemanticWorkspace } = await semanticWorkspaceModulePromise;
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
	const leftTarget = semanticSymbolAt(workspace.getSnapshot(), 'main.lua', 2, leftColumn);
	assert.ok(leftTarget, 'initial transitive target');
	assert.equal(leftTarget!.declaration.file, 'left.lua');
	assert.equal(semanticSymbolAt(workspace.getSnapshot(), 'main.lua', 3, rightColumn), null);

	workspace.updateFile('facade.lua', facadeSource('right'));
	assert.equal(semanticSymbolAt(workspace.getSnapshot(), 'main.lua', 2, leftColumn), null);
	const rightTarget = semanticSymbolAt(workspace.getSnapshot(), 'main.lua', 3, rightColumn);
	assert.ok(rightTarget, 'retargeted transitive target');
	assert.equal(rightTarget!.declaration.file, 'right.lua');
});

test('semantic workspace resolves members added to an imported module table', async () => {
	const { buildLuaFileSemanticData, LuaSemanticWorkspace } = await semanticWorkspaceModulePromise;
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
	const target = semanticSymbolAt(workspace.getSnapshot(),
		'main.lua',
		2,
		mainLines[1].indexOf('added') + 1,
	);

	assert.ok(target, 'imported table augmentation target');
	assert.equal(target!.declaration.file, 'facade.lua');
	assert.deepEqual(target!.declaration.namePath, ['base', 'tools', 'added']);
});

test('semantic workspace incrementally removes imported table augmentations', async () => {
	const { buildLuaFileSemanticData, LuaSemanticWorkspace } = await semanticWorkspaceModulePromise;
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
	assert.ok(semanticSymbolAt(workspace.getSnapshot(), 'main.lua', 2, column));

	workspace.updateFile('facade.lua', "local base<const> = require('base')\nreturn base");
	assert.equal(semanticSymbolAt(workspace.getSnapshot(), 'main.lua', 2, column), null);
});

test('semantic workspace terminates circular module aliases without a false target', async () => {
	const { LuaSemanticWorkspace } = await semanticWorkspaceModulePromise;
	const workspace = new LuaSemanticWorkspace();
	workspace.updateFile('main.lua', "local api<const> = require('left')\napi.value()");
	workspace.updateFile('left.lua', "local left<const> = require('right')\nreturn left");
	workspace.updateFile('right.lua', "local right<const> = require('left')\nreturn right");

	assert.equal(semanticSymbolAt(workspace.getSnapshot(), 'main.lua', 2, 5), null);
});

test('semantic workspace resolves require-alias member definitions through module returns', async () => {
	const { LuaSemanticWorkspace } = await semanticWorkspaceModulePromise;
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
	const updateTarget = semanticSymbolAt(snapshot, 'main.lua', 2, 'room_api.update()'.indexOf('update') + 1);
	assert.ok(updateTarget, 'module function target');
	assert.equal(updateTarget!.declaration.file, 'room.lua');
	assert.deepEqual(updateTarget!.declaration.namePath, ['room', 'update']);
	const valueTarget = semanticSymbolAt(snapshot, 'main.lua', 3, 'return room_api.value'.indexOf('value') + 1);
	assert.ok(valueTarget, 'module value target');
	assert.equal(valueTarget!.declaration.file, 'room.lua');
	assert.deepEqual(valueTarget!.declaration.namePath, ['room', 'value']);
});

test('semantic workspace preserves require-alias member paths', async () => {
	const { LuaSemanticWorkspace } = await semanticWorkspaceModulePromise;
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
	const drawColumn = 'hud.draw()'.indexOf('draw') + 1;
	const drawTarget = semanticSymbolAt(workspace.getSnapshot(), 'main.lua', 2, drawColumn);
	assert.ok(drawTarget, 'nested module function target');
	assert.equal(drawTarget!.declaration.file, 'constants.lua');
	assert.deepEqual(drawTarget!.declaration.namePath, ['constants', 'hud', 'draw']);
});

test('semantic workspace resolves fields exported by module table literals', async () => {
	const { LuaSemanticWorkspace } = await semanticWorkspaceModulePromise;
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
	const registerTarget = semanticSymbolAt(snapshot, 'main.lua', 3, registerColumn);
	assert.ok(registerTarget, 'module table export target');
	assert.equal(registerTarget!.declaration.file, 'director.lua');
	assert.deepEqual(registerTarget!.declaration.namePath, ['register']);
	const updateColumn = mainLines[3].indexOf('update') + 1;
	const updateTarget = semanticSymbolAt(snapshot, 'main.lua', 4, updateColumn);
	assert.ok(updateTarget, 'nested module table member target');
	assert.equal(updateTarget!.declaration.file, 'director.lua');
	assert.deepEqual(updateTarget!.declaration.namePath, ['director', 'update']);
});

test('semantic workspace resolves methods on module-owned class instances', async () => {
	const { LuaSemanticWorkspace } = await semanticWorkspaceModulePromise;
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
	const runTarget = semanticSymbolAt(workspace.getSnapshot(),
		'main.lua',
		2,
		mainLines[1].indexOf('run') + 1,
	);

	assert.ok(runTarget, 'module-owned instance method target');
	assert.equal(runTarget!.declaration.file, 'service.lua');
	assert.deepEqual(runTarget!.declaration.namePath, ['service_class', 'run']);
});

test('semantic workspace resolves inherited module members through class metatables', async () => {
	const { LuaSemanticWorkspace } = await semanticWorkspaceModulePromise;
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
	const disposeTarget = semanticSymbolAt(workspace.getSnapshot(),
		'main.lua',
		2,
		mainLines[1].indexOf('dispose') + 1,
	);

	assert.ok(disposeTarget, 'inherited module method target');
	assert.equal(disposeTarget!.declaration.file, 'base.lua');
	assert.deepEqual(disposeTarget!.declaration.namePath, ['base', 'dispose']);
	assert.equal(
		semanticSymbolAt(workspace.getSnapshot(),
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
	const activateTarget = semanticSymbolAt(workspace.getSnapshot(),
		'main.lua',
		3,
		mainLines[2].indexOf('activate') + 1,
	);
	assert.ok(activateTarget, 'incrementally added inherited method target');
	assert.equal(activateTarget!.declaration.file, 'base.lua');
	assert.deepEqual(activateTarget!.declaration.namePath, ['base', 'activate']);
});

test('semantic workspace batch retargets inherited members through reverse class dependencies', async () => {
	const { buildLuaFileSemanticData, LuaSemanticWorkspace } = await semanticWorkspaceModulePromise;
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
	const leftTarget = semanticSymbolAt(workspace.getSnapshot(), 'main.lua', 2, leftColumn);
	assert.ok(leftTarget, 'initial inherited member target');
	assert.equal(leftTarget!.declaration.file, 'base_left.lua');
	assert.equal(semanticSymbolAt(workspace.getSnapshot(), 'main.lua', 3, rightColumn), null);

	workspace.updateFiles([
		buildLuaFileSemanticData(derivedRightSource, 'derived.lua'),
	]);
	assert.equal(workspace.version, 2, 'incremental batch commits once');
	assert.equal(semanticSymbolAt(workspace.getSnapshot(), 'main.lua', 2, leftColumn), null);
	const rightTarget = semanticSymbolAt(workspace.getSnapshot(), 'main.lua', 3, rightColumn);
	assert.ok(rightTarget, 'retargeted inherited member target');
	assert.equal(rightTarget!.declaration.file, 'base_right.lua');
});

test('semantic workspace resolves explicit-self methods through metatable inheritance', async () => {
	const { LuaSemanticWorkspace } = await semanticWorkspaceModulePromise;
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
		"local base_left<const> = require('base_left')",
		'local derived<const> = {}',
		'derived.__index = derived',
		'setmetatable(derived, { __index = base_left })',
		'function derived.initialize(self)',
		'\tself:left_action()',
		'\tself:right_action()',
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
	const leftColumn = derivedLeftLines[5].indexOf('left_action') + 1;
	const rightColumn = derivedLeftLines[6].indexOf('right_action') + 1;
	const initialLeftTarget = semanticSymbolAt(workspace.getSnapshot(), 'derived.lua', 6, leftColumn);
	assert.ok(initialLeftTarget, 'metatable base method target');
	assert.equal(initialLeftTarget!.declaration.file, 'base_left.lua');
	assert.equal(semanticSymbolAt(workspace.getSnapshot(), 'derived.lua', 7, rightColumn), null);

	workspace.updateFile('derived.lua', derivedRightSource);
	assert.equal(semanticSymbolAt(workspace.getSnapshot(), 'derived.lua', 6, leftColumn), null);
	const reboundRightTarget = semanticSymbolAt(workspace.getSnapshot(), 'derived.lua', 7, rightColumn);
	assert.ok(reboundRightTarget, 'retargeted metatable base method target');
	assert.equal(reboundRightTarget!.declaration.file, 'base_right.lua');
});

test('semantic workspace retains fields initialized through a base explicit-self receiver', async () => {
	const { LuaSemanticWorkspace } = await semanticWorkspaceModulePromise;
	const objectBaseSource = [
		'local object_base<const> = {}',
		'object_base.__index = object_base',
		'function object_base.initialize(self)',
		'\tself.events = {}',
		'end',
		'return object_base',
	].join('\n');
	const derivedLines = [
		"local object_base<const> = require('object_base')",
		'local derived<const> = {}',
		'derived.__index = derived',
		'setmetatable(derived, { __index = object_base })',
		'function derived:land()',
		'\treturn self.events',
		'end',
		'return derived',
	];
	const workspace = new LuaSemanticWorkspace();
	workspace.updateFile('object_base.lua', objectBaseSource);
	workspace.updateFile('derived.lua', derivedLines.join('\n'));
	const eventsTarget = semanticSymbolAt(workspace.getSnapshot(),
		'derived.lua',
		6,
		derivedLines[5].indexOf('events') + 1,
	);

	assert.ok(eventsTarget, 'field initialized by the base explicit-self receiver');
	assert.equal(eventsTarget!.declaration.file, 'object_base.lua');
	assert.deepEqual(eventsTarget!.declaration.namePath, ['self', 'events']);
});

test('explicit self receivers project writes without adopting call argument members', async () => {
	const { LuaSemanticWorkspace } = await semanticWorkspaceModulePromise;
	const sourceLines = [
		'local actor<const> = {}',
		'function actor.initialize(self)',
		'\tself.events = {}',
		'end',
		'local foreign<const> = { foreign_only = true }',
		'actor.initialize(foreign)',
		'local projected<const> = foreign.events',
		'function actor:read()',
		'\treturn self.foreign_only',
		'end',
		'return actor',
	];
	const workspace = new LuaSemanticWorkspace();
	workspace.updateFile('actor.lua', sourceLines.join('\n'));
	const snapshot = workspace.getSnapshot();
	const projectedTarget = semanticSymbolAt(snapshot,
		'actor.lua',
		7,
		sourceLines[6].indexOf('events') + 1,
	);

	assert.ok(projectedTarget, 'receiver write projected onto the explicit call argument');
	assert.deepEqual(projectedTarget!.declaration.namePath, ['self', 'events']);
	assert.equal(
		semanticSymbolAt(snapshot, 'actor.lua', 9, sourceLines[8].indexOf('foreign_only') + 1),
		null,
		'foreign argument members do not become actor instance members',
	);
});

test('higher-order callback parameters retain every callsite receiver alternative', async () => {
	const { LuaSemanticWorkspace } = await semanticWorkspaceModulePromise;
	const sourceLines = [
		'local left<const> = {}',
		'left.__index = left',
		'function left:left_only() end',
		'function left:probe()',
		'\treturn self.right_only',
		'end',
		'local right<const> = {}',
		'right.__index = right',
		'function right:right_only() end',
		'local callback<const> = function(actor)',
		'\tactor:left_only()',
		'\tactor:right_only()',
		'end',
		'local dispatch<const> = function(fn, actor)',
		'\tfn(actor)',
		'end',
		'dispatch(callback, setmetatable({}, left))',
		'dispatch(callback, setmetatable({}, right))',
	];
	const workspace = new LuaSemanticWorkspace();
	workspace.updateFile('callbacks.lua', sourceLines.join('\n'));
	const snapshot = workspace.getSnapshot();
	const targetAt = (line: number, name: string) => semanticSymbolAt(snapshot,
		'callbacks.lua',
		line,
		sourceLines[line - 1].indexOf(name) + 1,
	);

	assert.equal(targetAt(11, 'left_only')!.declaration.namePath.join('.'), 'left.left_only');
	assert.equal(targetAt(12, 'right_only')!.declaration.namePath.join('.'), 'right.right_only');
	assert.equal(
		targetAt(5, 'right_only'),
		null,
		'callback alternatives do not merge their receiver classes',
	);
});

test('callback roles follow explicit executor arguments', async () => {
	const { LuaSemanticWorkspace } = await semanticWorkspaceModulePromise;
	const sourceLines = [
		'local visual<const> = {}',
		'visual.__index = visual',
		'function visual:visual_only() end',
		'local actor<const> = {}',
		'actor.__index = actor',
		'function actor:actor_only() end',
		'function actor.initialize(self)',
		'\tself.visual = setmetatable({}, visual)',
		'end',
		'local apply_frame<const> = function(target)',
		'\ttarget:visual_only()',
		'\ttarget:actor_only()',
		'end',
		'local on_finished<const> = function(owner)',
		'\towner:actor_only()',
		'\towner:visual_only()',
		'end',
		'local unrelated<const> = function(value)',
		'\tvalue:actor_only()',
		'end',
		'local run_sequence<const> = function(owner, apply, finish)',
		'\tapply(owner.visual)',
		'\tfinish(owner)',
		'end',
		'run_sequence(setmetatable({}, actor), apply_frame, on_finished)',
	];
	const workspace = new LuaSemanticWorkspace();
	workspace.updateFile('sequence.lua', sourceLines.join('\n'));
	const snapshot = workspace.getSnapshot();
	const targetAt = (line: number, name: string) => semanticSymbolAt(snapshot,
		'sequence.lua',
		line,
		sourceLines[line - 1].indexOf(name) + 1,
	);

	assert.equal(targetAt(11, 'visual_only')!.declaration.namePath.join('.'), 'visual.visual_only');
	assert.equal(targetAt(12, 'actor_only'), null, 'the apply callback receives the visual value');
	assert.equal(targetAt(15, 'actor_only')!.declaration.namePath.join('.'), 'actor.actor_only');
	assert.equal(targetAt(16, 'visual_only'), null, 'the completion callback receives the owner');
	assert.equal(targetAt(19, 'actor_only'), null, 'uncalled callbacks remain unbound');
});

test('semantic workspace retargets literal-keyed registry results after an edit', async () => {
	const { LuaSemanticWorkspace } = await semanticWorkspaceModulePromise;
	const registrySource = [
		'local registry<const> = {}',
		'local entries<const> = {}',
		'function registry.define(id, value_class)',
		'\tentries[id] = value_class',
		'end',
		'function registry.create(id)',
		'\treturn setmetatable({}, entries[id])',
		'end',
		'return registry',
	].join('\n');
	const constantsLeftSource = [
		"left_id = 'left'",
		"right_id = 'right'",
		"selected_id = 'left'",
	].join('\n');
	const constantsRightSource = constantsLeftSource.replace("selected_id = 'left'", "selected_id = 'right'");
	const leftSource = [
		"local registry<const> = require('registry')",
		"require('constants')",
		'local left<const> = {}',
		'left.__index = left',
		'function left:left_action() end',
		'registry.define(left_id, left)',
		'return left',
	].join('\n');
	const rightSource = [
		"local registry<const> = require('registry')",
		"require('constants')",
		'local right<const> = {}',
		'right.__index = right',
		'function right:right_action() end',
		'registry.define(right_id, right)',
		'return right',
	].join('\n');
	const mainLines = [
		"local registry<const> = require('registry')",
		"require('constants')",
		"require('left')",
		"require('right')",
		'local selected<const> = registry.create(selected_id)',
		'selected:left_action()',
		'selected:right_action()',
	];
	const workspace = new LuaSemanticWorkspace();
	workspace.updateFile('registry.lua', registrySource);
	workspace.updateFile('constants.lua', constantsLeftSource);
	workspace.updateFile('left.lua', leftSource);
	workspace.updateFile('right.lua', rightSource);
	workspace.updateFile('main.lua', mainLines.join('\n'));
	const leftColumn = mainLines[5].indexOf('left_action') + 1;
	const rightColumn = mainLines[6].indexOf('right_action') + 1;
	const initialTarget = semanticSymbolAt(workspace.getSnapshot(), 'main.lua', 6, leftColumn);
	assert.ok(initialTarget, 'initial literal registry target');
	assert.equal(initialTarget!.declaration.file, 'left.lua');
	assert.equal(semanticSymbolAt(workspace.getSnapshot(), 'main.lua', 7, rightColumn), null);

	workspace.updateFile('constants.lua', constantsRightSource);
	assert.equal(semanticSymbolAt(workspace.getSnapshot(), 'main.lua', 6, leftColumn), null);
	const reboundTarget = semanticSymbolAt(workspace.getSnapshot(), 'main.lua', 7, rightColumn);
	assert.ok(reboundTarget, 'retargeted literal registry target');
	assert.equal(reboundTarget!.declaration.file, 'right.lua');
});

test('semantic workspace retains exported table identity across local shadowing', async () => {
	const { LuaSemanticWorkspace } = await semanticWorkspaceModulePromise;
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
	const entryTarget = semanticSymbolAt(workspace.getSnapshot(),
		'main.lua',
		3,
		mainLines[2].indexOf('entry') + 1,
	);

	assert.ok(entryTarget, 'exported nested table member target');
	assert.equal(entryTarget!.declaration.file, 'signature.lua');
	assert.deepEqual(entryTarget!.declaration.namePath, ['internal_operand', 'entry']);
});
