import assert from 'node:assert/strict';
import test from 'node:test';
import { LuaSourceReader } from '../../ide/language/lua/source_reader';
import { isSceneSpriteInitializer } from '../../ide/workbench/contrib/scene_editor/sprite_initialization';
import { buildLuaSemanticWorkspaceSnapshot } from '../../toolchain/ts/lua/semantic/model';
import { createPathModuleProjectFixture } from '../helpers/lua_semantic_project';

const SPRITE = 'local sprite={}; function sprite.initialize(owner) owner.sprite_component={} end; return sprite';

/** Source-generation proof only: no shipped carts, runtime execution or assets. */
function fixture(source: string, providers: readonly (readonly [string, string])[] = []) {
	const main = `local sprite=require('cartlib/sprite')\n${source}`;
	const files = [...new Map<string, string>([['main.lua', main], ['cartlib/sprite.lua', SPRITE], ...providers])]
		.map(([path, source]) => ({ path, source }));
	const snapshot = buildLuaSemanticWorkspaceSnapshot(...createPathModuleProjectFixture(files));
	const file = snapshot.getFileData('main.lua')!, reader = new LuaSourceReader(snapshot);
	const returned = file.moduleValues[0].statement.expressions[0], initializer = reader.expression(file, returned);
	const sprite = reader.module(file, 'cartlib/sprite')!, canonical = reader.member(sprite.file, sprite.expression, 'initialize');
	return { reader, initializer, canonical, prove: () => isSceneSpriteInitializer(reader, initializer, canonical) };
}

test('the canonical Sprite initializer and its authored aliases prove the same construction', () => {
	for (const source of ['return sprite.initialize', 'local initialize=sprite.initialize; return initialize']) {
		const f = fixture(source); assert.equal(f.prove(), true); assert.ok(f.initializer === f.canonical);
		assert.equal(isSceneSpriteInitializer(f.reader, undefined, f.canonical), false);
		assert.equal(isSceneSpriteInitializer(f.reader, null, f.canonical), false);
		assert.equal(isSceneSpriteInitializer(f.reader, f.initializer, undefined), false);
	}
});

test('a sole canonical first call proves construction before ordinary owner field writes', () => {
	for (const source of [
		'return function(owner) sprite.initialize(owner) end',
		'return function(subject) sprite.initialize(subject); subject.health=subject.max_health; subject.vulnerable=true end',
		'local initialize=sprite.initialize; return function(actor) initialize(actor); actor.last_strike=0 end',
		// This is a construction prefix, not a field-name whitelist or proof of final visibility.
		'return function(actor) sprite.initialize(actor); actor.visible=false; actor.order=7; actor.primary_sprite_factory=nil end',
		'return function(actor) sprite.initialize(actor); actor.health,actor.vulnerable=3,true end',
	]) assert.equal(fixture(source).prove(), true, source);
});

for (const source of [
	'return nil',
	'return false',
	'return {}',
	'return choose_initializer()',
	'return function(owner) end',
	'return function() sprite.initialize(owner) end',
	'return function(owner,other) sprite.initialize(owner) end',
	'return function(owner,...) sprite.initialize(owner) end',
	'local class={}; function class:initialize() sprite.initialize(self) end; return class.initialize',
	'local class={}; function class:initialize(owner) sprite.initialize(owner) end; return class.initialize',
	'return function(owner) owner.health=0; sprite.initialize(owner) end',
	'return function(owner) if flag then sprite.initialize(owner) end end',
	'return function(owner) do sprite.initialize(owner) end end',
	'return function(owner) local alias=owner; sprite.initialize(alias) end',
	'return function(owner) sprite.initialize(other) end',
	'return function(subject) sprite.initialize(self) end',
	'return function(owner) sprite.initialize(owner.child) end',
	'return function(owner) sprite.initialize(owner,other) end',
	'return function(owner) sprite:initialize(owner) end',
	'return function(owner) sprite.initialize(owner); sprite.initialize(owner) end',
	'return function(owner) sprite.initialize(owner); owner:refresh() end',
	'return function(owner) sprite.initialize(owner); owner.health=calculate(owner) end',
	'return function(owner) sprite.initialize(owner); owner=other end',
	'return function(owner) sprite.initialize(owner); other.saved=owner end',
	'return function(owner) sprite.initialize(owner); owner.sprite_component.visible=false end',
	"return function(owner) sprite.initialize(owner); owner['visible']=false end",
	'return function(owner) sprite.initialize(owner); owner.health,other.health=1,2 end',
	'return function(owner) sprite.initialize(owner); local alias=owner end',
	'return function(owner) sprite.initialize(owner); return owner end',
	'return function(owner) sprite.initialize(owner); if flag then owner.health=0 end end',
	'local other={initialize=function(owner) end}; return function(owner) other.initialize(owner) end',
	'local initialize=function(owner) sprite.initialize(owner) end; return function(owner) initialize(owner) end',
]) test(`unproved initializer construction remains source-only: ${source}`, () => {
	assert.equal(fixture(source).prove(), false);
});

test('canonical callable replacement and competing alias writes retire construction proof', () => {
	const source = 'return function(owner) sprite.initialize(owner); owner.health=1 end';
	const original = fixture(source); assert.equal(original.prove(), true);
	for (const changed of [
		` sprite.initialize=function(owner) end; ${source}`,
		` sprite[key]=function(owner) end; ${source}`,
		'local initialize=sprite.initialize; initialize=other; return function(owner) initialize(owner) end',
	]) assert.equal(fixture(changed).prove(), false, changed);
	const nonFunction = fixture(source, [['cartlib/sprite.lua', 'return {initialize=false}']]);
	assert.equal(nonFunction.prove(), false);
	assert.equal(original.prove(), true, 'a new source generation never mutates the old immutable proof');
});

test('canonical ownership follows the actual function source rather than a module filename', () => {
	const f = fixture('return function(owner) sprite.initialize(owner); owner.health=1 end', [
		['cartlib/sprite.lua', "return {initialize=require('sprite_initializer')}"],
		['sprite_initializer.lua', 'return function(owner) owner.sprite_component={} end'],
	]);
	assert.equal(f.prove(), true);
});
