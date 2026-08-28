import assert from 'node:assert/strict';
import { test } from 'node:test';

const semanticModelModulePromise = import('../../toolchain/ts/lua/semantic/model');

const unitBaseSource = [
	'local unit_base<const> = {}',
	'unit_base.__index = unit_base',
	'function unit_base.new(opts)',
	'\treturn setmetatable({ parent = opts.parent }, unit_base)',
	'end',
	'function unit_base:on_attach() end',
	'return unit_base',
].join('\n');

function lineNumber(lines: readonly string[], line: string): number {
	return lines.indexOf(line) + 1;
}

test('semantic workspace follows member effects through higher-order factory calls', async () => {
	const { LuaSemanticWorkspace } = await semanticModelModulePromise;
	const timerSource = [
		"local unit_base<const> = require('unit_base')",
		'local timer_unit<const> = {}',
		'timer_unit.__index = timer_unit',
		'setmetatable(timer_unit, { __index = unit_base })',
		'function timer_unit.new(opts)',
		'\treturn setmetatable(unit_base.new(opts), timer_unit)',
		'end',
		'function timer_unit:on_attach()',
		'\tself.parent.timers = self',
		'end',
		'function timer_unit:play() end',
		'return timer_unit',
	];
	const effectSource = [
		"local unit_base<const> = require('unit_base')",
		'local effect_unit<const> = {}',
		'effect_unit.__index = effect_unit',
		'setmetatable(effect_unit, { __index = unit_base })',
		'function effect_unit.new(opts)',
		'\treturn setmetatable(unit_base.new(opts), effect_unit)',
		'end',
		'function effect_unit.factory()',
		'\treturn function(opts)',
		'\t\treturn effect_unit.new(opts)',
		'\tend',
		'end',
		'function effect_unit:on_attach()',
		'\tself.parent.effects = self',
		'end',
		'function effect_unit:trigger() end',
		'return effect_unit',
	];
	const actorLines = [
		"local timer_unit<const> = require('timer_unit')",
		"local effect_unit<const> = require('effect_unit')",
		'local attach_units<const> = function(object, factories)',
		'\tfor _, factory in ipairs(factories) do',
		'\t\tlocal unit<const> = factory({ parent = object })',
		'\t\tunit:on_attach()',
		'\tend',
		'end',
		'local left<const> = {}',
		'function left:run()',
		'\tself.timers:play()',
		'\tself.effects:trigger()',
		'end',
		'local right<const> = {}',
		'function right:run()',
		'\tself.timers:play()',
		'end',
		'local left_units<const> = {',
		'\ttimer_unit.new,',
		'\teffect_unit.factory(),',
		'}',
		'attach_units(left, left_units)',
	];
	const workspace = new LuaSemanticWorkspace();
	workspace.updateFile('unit_base.lua', unitBaseSource);
	workspace.updateFile('timer_unit.lua', timerSource.join('\n'));
	workspace.updateFile('effect_unit.lua', effectSource.join('\n'));
	workspace.updateFile('actor.lua', actorLines.join('\n'));
	const snapshot = workspace.getSnapshot();
	const targetAt = (line: string, member: string) => snapshot.symbolAt(
		'actor.lua',
		lineNumber(actorLines, line),
		line.lastIndexOf(member) + 1,
	);

	assert.equal(targetAt('\tself.timers:play()', 'play')!.decl.file, 'timer_unit.lua');
	assert.equal(
		targetAt('\tself.timers:play()', 'timers')!.decl.range.start.line,
		lineNumber(timerSource, '\tself.parent.timers = self'),
	);
	assert.equal(targetAt('\tself.effects:trigger()', 'trigger')!.decl.file, 'effect_unit.lua');
	assert.equal(
		targetAt('\tself.effects:trigger()', 'effects')!.decl.range.start.line,
		lineNumber(effectSource, '\tself.parent.effects = self'),
	);
	const rightPlayLine = actorLines.lastIndexOf('\tself.timers:play()') + 1;
	assert.equal(
		snapshot.symbolAt('actor.lua', rightPlayLine, actorLines[rightPlayLine - 1].lastIndexOf('play') + 1),
		null,
		'an unattached value does not acquire factory effects',
	);

	const withoutTimer = actorLines.filter(line => line !== '\ttimer_unit.new,');
	workspace.updateFile('actor.lua', withoutTimer.join('\n'));
	const playLine = lineNumber(withoutTimer, '\tself.timers:play()');
	assert.equal(
		workspace.getSnapshot().symbolAt(
			'actor.lua',
			playLine,
			withoutTimer[playLine - 1].lastIndexOf('play') + 1,
		),
		null,
		'removing the factory removes its value effect',
	);
});

test('semantic workspace follows inherited method effects without matching by method name', async () => {
	const { LuaSemanticWorkspace } = await semanticModelModulePromise;
	const objectBaseSource = [
		'local object_base<const> = {}',
		'object_base.__index = object_base',
		'function object_base:add_unit(unit)',
		'\tunit.parent = self',
		'\tunit:on_attach()',
		'\treturn unit',
		'end',
		'return object_base',
	].join('\n');
	const effectSource = [
		"local unit_base<const> = require('unit_base')",
		'local effect_unit<const> = {}',
		'effect_unit.__index = effect_unit',
		'setmetatable(effect_unit, { __index = unit_base })',
		'function effect_unit.new(opts)',
		'\treturn setmetatable(unit_base.new(opts), effect_unit)',
		'end',
		'function effect_unit:on_attach()',
		'\tself.parent.effects = self',
		'end',
		'function effect_unit:trigger() end',
		'return effect_unit',
	];
	const actorLines = [
		"local object_base<const> = require('object_base')",
		"local effect_unit<const> = require('effect_unit')",
		'local actor<const> = {}',
		'actor.__index = actor',
		'setmetatable(actor, { __index = object_base })',
		'function actor:ctor()',
		'\tself:add_unit(effect_unit.new({}))',
		'\tself.effects:trigger()',
		'end',
		'local impostor<const> = {}',
		'impostor.__index = impostor',
		'function impostor:add_unit(unit)',
		'\treturn unit',
		'end',
		'function impostor:ctor()',
		'\tself:add_unit(effect_unit.new({}))',
		'\tself.effects:trigger()',
		'end',
	];
	const workspace = new LuaSemanticWorkspace();
	workspace.updateFile('unit_base.lua', unitBaseSource);
	workspace.updateFile('object_base.lua', objectBaseSource);
	workspace.updateFile('effect_unit.lua', effectSource.join('\n'));
	workspace.updateFile('actor.lua', actorLines.join('\n'));
	let snapshot = workspace.getSnapshot();
	const actorEffectLine = lineNumber(actorLines, '\tself.effects:trigger()');
	const impostorEffectLine = actorLines.lastIndexOf('\tself.effects:trigger()') + 1;

	assert.equal(
		snapshot.symbolAt(
			'actor.lua',
			actorEffectLine,
			actorLines[actorEffectLine - 1].lastIndexOf('effects') + 1,
		)!.decl.file,
		'effect_unit.lua',
	);
	assert.equal(
		snapshot.symbolAt(
			'actor.lua',
			actorEffectLine,
			actorLines[actorEffectLine - 1].lastIndexOf('trigger') + 1,
		)!.decl.file,
		'effect_unit.lua',
	);
	assert.equal(
		snapshot.symbolAt(
			'actor.lua',
			impostorEffectLine,
			actorLines[impostorEffectLine - 1].lastIndexOf('trigger') + 1,
		),
		null,
		'a same-named method has no inferred lifecycle effect',
	);

	const detachedActorLines = actorLines.filter(line => line !== '\tself:add_unit(effect_unit.new({}))');
	workspace.updateFile('actor.lua', detachedActorLines.join('\n'));
	snapshot = workspace.getSnapshot();
	const detachedEffectLine = lineNumber(detachedActorLines, '\tself.effects:trigger()');
	assert.equal(
		snapshot.symbolAt(
			'actor.lua',
			detachedEffectLine,
			detachedActorLines[detachedEffectLine - 1].lastIndexOf('trigger') + 1,
		),
		null,
		'removing the call removes its value effect',
	);
});

test('semantic workspace keeps metatable-keyed storage contextual to each callsite', async () => {
	const { LuaSemanticWorkspace } = await semanticModelModulePromise;
	const storeSource = [
		'local store<const> = {}',
		'store.__index = store',
		'function store:initialize()',
		'\tself.values = {}',
		'end',
		'function store:add(value)',
		'\tself.values[getmetatable(value)] = value',
		'end',
		'function store:get(value_class)',
		'\treturn self.values[value_class]',
		'end',
		'return store',
	].join('\n');
	const leftSource = [
		'local left<const> = {}',
		'left.__index = left',
		'function left.new()',
		'\treturn setmetatable({}, left)',
		'end',
		'function left:left_only() end',
		'return left',
	].join('\n');
	const rightSource = [
		'local right<const> = {}',
		'right.__index = right',
		'function right.new()',
		'\treturn setmetatable({}, right)',
		'end',
		'function right:right_only() end',
		'return right',
	].join('\n');
	const actorLines = [
		"local store<const> = require('store')",
		"local left<const> = require('left')",
		"local right<const> = require('right')",
		'local actor<const> = {}',
		'actor.__index = actor',
		'setmetatable(actor, { __index = store })',
		'function actor:resolve_values()',
		'\tself:add(left.new())',
		'\tself:add(right.new())',
		'\tlocal left_value<const> = self:get(left)',
		'\tlocal right_value<const> = self:get(right)',
		'\tleft_value:left_only()',
		'\tright_value:right_only()',
		'\tleft_value:right_only()',
		'\tright_value:left_only()',
		'end',
	];
	const workspace = new LuaSemanticWorkspace();
	workspace.updateFile('store.lua', storeSource);
	workspace.updateFile('left.lua', leftSource);
	workspace.updateFile('right.lua', rightSource);
	workspace.updateFile('actor.lua', actorLines.join('\n'));
	let snapshot = workspace.getSnapshot();
	const targetAt = (line: string, member: string) => snapshot.symbolAt(
		'actor.lua',
		lineNumber(actorLines, line),
		line.lastIndexOf(member) + 1,
	);

	assert.equal(targetAt('\tleft_value:left_only()', 'left_only')!.decl.file, 'left.lua');
	assert.equal(targetAt('\tright_value:right_only()', 'right_only')!.decl.file, 'right.lua');
	assert.equal(targetAt('\tleft_value:right_only()', 'right_only'), null);
	assert.equal(targetAt('\tright_value:left_only()', 'left_only'), null);

	const retargetedLines = actorLines.slice();
	retargetedLines[lineNumber(actorLines, '\tlocal left_value<const> = self:get(left)') - 1]
		= '\tlocal left_value<const> = self:get(right)';
	workspace.updateFile('actor.lua', retargetedLines.join('\n'));
	snapshot = workspace.getSnapshot();
	assert.equal(
		snapshot.symbolAt(
			'actor.lua',
			lineNumber(retargetedLines, '\tleft_value:left_only()'),
			'\tleft_value:left_only()'.lastIndexOf('left_only') + 1,
		),
		null,
		'retargeting removes the previous indexed value',
	);
	assert.equal(
		snapshot.symbolAt(
			'actor.lua',
			lineNumber(retargetedLines, '\tleft_value:right_only()'),
			'\tleft_value:right_only()'.lastIndexOf('right_only') + 1,
		)!.decl.file,
		'right.lua',
	);
});
