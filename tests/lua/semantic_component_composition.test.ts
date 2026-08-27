import assert from 'node:assert/strict';
import { test } from 'node:test';

const semanticModelModulePromise = import('../../toolchain/ts/lua/semantic/model');

const baseComponentSource = [
	'local base_component<const> = {}',
	'base_component.__index = base_component',
	'function base_component.new(opts)',
	'\treturn setmetatable({ parent = opts.parent }, base_component)',
	'end',
	'function base_component:on_attach() end',
	'return base_component',
].join('\n');

const worldObjectSource = [
	'local world_object<const> = {}',
	'world_object.__index = world_object',
	'function world_object:add_component(component)',
	'\treturn component',
	'end',
	'return world_object',
].join('\n');

function memberColumn(line: string, member: string): number {
	return line.lastIndexOf(member) + 1;
}

test('semantic workspace follows component surfaces published by prefab composition', async () => {
	const { LuaSemanticWorkspace } = await semanticModelModulePromise;
	const timelineSource = [
		"local base_component<const> = require('cartlib/component/base_component')",
		'local timeline_component<const> = {}',
		'timeline_component.__index = timeline_component',
		'setmetatable(timeline_component, { __index = base_component })',
		'function timeline_component.new(opts)',
		'\treturn setmetatable(base_component.new(opts), timeline_component)',
		'end',
		'function timeline_component:on_attach()',
		'\tself.parent.timelines = self',
		'end',
		'function timeline_component:play() end',
		'return timeline_component',
	];
	const effectSource = [
		"local base_component<const> = require('cartlib/component/base_component')",
		'local effect_component<const> = {}',
		'effect_component.__index = effect_component',
		'setmetatable(effect_component, { __index = base_component })',
		'function effect_component.new(opts)',
		'\treturn setmetatable(base_component.new(opts), effect_component)',
		'end',
		'function effect_component.factory()',
		'\treturn function(opts)',
		'\t\treturn effect_component.new(opts)',
		'\tend',
		'end',
		'function effect_component:on_attach()',
		'\tself.parent.effects = self',
		'end',
		'function effect_component:trigger() end',
		'return effect_component',
	];
	const actorLines = [
		"local prefab<const> = require('cartlib/world/prefab')",
		"local timeline_component<const> = require('timeline_component')",
		"local effect_component<const> = require('effect_component')",
		'local left<const> = {}',
		'function left:run()',
		'\tself.timelines:play()',
		'\tself.effects:trigger()',
		'end',
		'local right<const> = {}',
		'function right:run()',
		'\tself.timelines:play()',
		'end',
		'local left_components<const> = {',
		'\ttimeline_component.new,',
		'\teffect_component.factory(),',
		'}',
		"prefab.define({ def_id = 'left', class = left, components = left_components })",
		"prefab.define({ def_id = 'right', class = right, components = {} })",
	];
	const workspace = new LuaSemanticWorkspace();
	workspace.updateFile('cartlib/component/base_component.lua', baseComponentSource);
	workspace.updateFile('timeline_component.lua', timelineSource.join('\n'));
	workspace.updateFile('effect_component.lua', effectSource.join('\n'));
	workspace.updateFile('actor.lua', actorLines.join('\n'));
	const snapshot = workspace.getSnapshot();
	const targetAt = (line: number, member: string) => snapshot.symbolAt(
		'actor.lua',
		line,
		memberColumn(actorLines[line - 1], member),
	);

	assert.equal(targetAt(6, 'play')!.decl.file, 'timeline_component.lua');
	assert.equal(targetAt(6, 'timelines')!.decl.range.start.line, 9);
	assert.equal(targetAt(7, 'trigger')!.decl.file, 'effect_component.lua');
	assert.equal(targetAt(7, 'effects')!.decl.range.start.line, 14);
	assert.equal(targetAt(11, 'play'), null, 'an unmounted component does not leak to another prefab');

	workspace.updateFile(
		'actor.lua',
		actorLines.filter(line => line !== '\ttimeline_component.new,').join('\n'),
	);
	assert.equal(
		workspace.getSnapshot().symbolAt('actor.lua', 6, memberColumn(actorLines[5], 'play')),
		null,
		'removing the factory removes its published surface',
	);
});

test('semantic workspace validates dynamic component attachments against world_object', async () => {
	const { LuaSemanticWorkspace } = await semanticModelModulePromise;
	const componentSource = [
		"local base_component<const> = require('cartlib/component/base_component')",
		'local effect_component<const> = {}',
		'effect_component.__index = effect_component',
		'setmetatable(effect_component, { __index = base_component })',
		'function effect_component.new(opts)',
		'\treturn setmetatable(base_component.new(opts), effect_component)',
		'end',
		'function effect_component:on_attach()',
		'\tself.parent.effects = self',
		'end',
		'function effect_component:trigger() end',
		'return effect_component',
	].join('\n');
	const actorLines = [
		"local prefab<const> = require('cartlib/world/prefab')",
		"local effect_component<const> = require('effect_component')",
		'local actor<const> = {}',
		'function actor:ctor()',
		'\tself:add_component(effect_component.new({}))',
		'\tself.effects:trigger()',
		'end',
		"prefab.define({ def_id = 'actor', class = actor })",
		'local impostor<const> = {}',
		'function impostor:add_component(component)',
		'\treturn component',
		'end',
		'function impostor:ctor()',
		'\tself:add_component(effect_component.new({}))',
		'\tself.effects:trigger()',
		'end',
		"prefab.define({ def_id = 'impostor', class = impostor })",
	];
	const workspace = new LuaSemanticWorkspace();
	workspace.updateFile('cartlib/component/base_component.lua', baseComponentSource);
	workspace.updateFile('cartlib/world/world_object.lua', worldObjectSource);
	workspace.updateFile('effect_component.lua', componentSource);
	workspace.updateFile('actor.lua', actorLines.join('\n'));
	let snapshot = workspace.getSnapshot();
	let targetAt = (line: number, member: string) => snapshot.symbolAt(
		'actor.lua',
		line,
		memberColumn(actorLines[line - 1], member),
	);

	assert.equal(targetAt(6, 'effects')!.decl.range.start.line, 9);
	assert.equal(targetAt(6, 'trigger')!.decl.file, 'effect_component.lua');
	assert.equal(targetAt(15, 'trigger'), null, 'a same-named method is not the attachment contract');

	const detachedActorLines = actorLines.filter(line => !line.includes('self:add_component(effect_component'));
	workspace.updateFile('actor.lua', detachedActorLines.join('\n'));
	snapshot = workspace.getSnapshot();
	targetAt = (line: number, member: string) => snapshot.symbolAt(
		'actor.lua',
		line,
		memberColumn(detachedActorLines[line - 1], member),
	);
	assert.equal(targetAt(5, 'trigger'), null, 'removing the attachment removes its published surface');
});
