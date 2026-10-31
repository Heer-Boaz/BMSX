import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { SceneAuthoringContext } from '../../ide/workbench/contrib/scene_editor/authoring_context';
import { resolveLuaTextFileModel } from '../../ide/workbench/services/working_copy/text_file_model';
import { LuaSourceReader } from '../../ide/language/lua/source_reader';
import { createSceneSourceFixture } from '../helpers/scene_sources';

const IMPORTS = `local prefab=require('cartlib/world/prefab')
local sprites=require('cartlib/component/sprite_component')
local sprite_object=require('cartlib/sprite')\n`;
const SPRITE_MODULE = `local component=require('cartlib/component/sprite_component')
local sprite={}
sprite.primary_sprite_factory=component.new
setmetatable(sprite,{__index={}})
function sprite.initialize(self) end
return sprite`;
function fixture(t: TestContext, definitions: string, members: string, providers: readonly (readonly [string, string])[] = []) {
	const source = `local scenes=require('cartlib/world/scene_library')
scenes.register('main',{objects={${members}}})
scenes.register('other',{objects={}})`;
	const f = createSceneSourceFixture(t, source, 'scene.lua', undefined, [
		['cartlib/world/prefab.lua', 'return {define=function() end}'],
		['cartlib/component/sprite_component.lua', 'return {new=function() end,factory=function() end}'],
		['cartlib/world/world_object.lua', 'return {}'],
		['cartlib/sprite.lua', SPRITE_MODULE], ['prefabs.lua', IMPORTS + definitions], ...providers,
	]);
	const document = f.documents.get(f.model), context = new SceneAuthoringContext(f.model, f.documents,
		{ document, scene: document.scenes[0], sourceVersion: f.model.version });
	t.after(() => context.dispose());
	return { ...f, context, source };
}

test('sprite construction consumes concrete factory configuration, affine composition and whole source region', t => {
	const f = fixture(t, `
prefab.define({def_id='root',class={},spatial={family='2d',authority='affine'}})
prefab.define({def_id='visual',class={},spatial={family='2d',authority='affine'},
 defaults={visible=false},
 components={sprites.factory({id_local='body',imgid='scene',region={x=-2,y=7,width=-3,height=0},flip_h=false,flip_v=true,presentation_order=4,enabled=0,visible='',
 attachment_affine={1,1,0,1,2,3},presentation_affine={-1,0,2,1,4,5},color=0x00123456,order=1})}})`, `
 {member_id='child',definition_id='visual',spatial={parent_id='parent',local_transform={1,0,0,1,4,5}},
 options={visible=0,active=false,imgid='not-component-config',order=99}},
 {member_id='parent',definition_id='root',spatial={local_transform={2,0,1,3,10,20}}},`);
	const read = f.context.visualScene!, sprite = read.sprites[0];
	assert.equal(read.sprites.length, 1); assert.ok(sprite.entry === f.context.subject!.objects[0]);
	assert.equal(sprite.image, 'scene'); assert.equal(sprite.color, 0xff123456);
	assert.equal(sprite.flipH, false); assert.equal(sprite.flipV, true); assert.equal(sprite.order, 5);
	assert.deepEqual(sprite.region, { x: -2, y: 7, width: -3, height: 0 });
	assert.deepEqual(sprite.affine, { xx: -3, xy: -3, yx: 7, yy: 9, ox: 47, oy: 71 });
	assert.equal(f.context.selection, undefined); assert.equal(f.model.buffer.getText(), f.source); assert.equal(f.model.canUndo, false);
});

test('nil-only defaults differ from Lua or defaults, and authored top color byte is not opacity', t => {
	const f = fixture(t, `
prefab.define({def_id='visual',class=sprite_object,spatial={family='2d',authority='affine'},
 defaults={imgid='prefab',color=0x00123456,flip_h=true,visible=true,attachment_affine={2,0,0,3,4,5},region={x=1,y=2,width=3,height=4}}})`, `
 {member_id='nil',definition_id='visual',options={imgid=nil,color=nil,flip_h=nil,region=false,attachment_affine=false,presentation_affine=false,enabled=false}},
 {member_id='false',definition_id='visual',options={color=false,flip_h=false,order=false,visible=false}},
 {member_id='top',definition_id='visual',options={color=0xfe123456}},`);
	const sprites = f.context.visualScene!.sprites;
	assert.equal(sprites.length, 2); assert.equal(sprites[0].image, 'prefab');
	assert.equal(sprites[0].color, 0xff123456); assert.equal(sprites[1].color, sprites[0].color);
	assert.equal(sprites[0].flipH, true); assert.equal(sprites[0].region, undefined);
	assert.deepEqual(sprites[0].affine, { xx: 1, xy: 0, yx: 0, yy: 1, ox: 0, oy: 0 });
});

test('fresh sprite order follows smallest-ready parent construction and implicit initialization before explicit components', t => {
	const f = fixture(t, `
prefab.define({def_id='visual',class=sprite_object,spatial={family='2d',authority='affine'},defaults={imgid='primary'},
 components={sprites.factory({imgid='explicit'})}})`, `
 {member_id='child',definition_id='visual',spatial={parent_id='parent'}},
 {member_id='free',definition_id='visual'},
 {member_id='parent',definition_id='visual'},
 {member_id='last',definition_id='visual',options={order=-1}},`);
	const scene = f.context.subject!, sprites = f.context.visualScene!.sprites;
	assert.deepEqual(sprites.map(sprite => [scene.objects.indexOf(sprite.entry), sprite.image]),
		[[3, 'primary'], [1, 'primary'], [1, 'explicit'], [2, 'primary'], [2, 'explicit'], [0, 'primary'], [0, 'explicit'], [3, 'explicit']]);
});

test('known constructor import provenance survives aliases and reexports, without guessing similarly named custom calls', t => {
	const f = fixture(t, `
local bridge=require('sprite_bridge')
local defined=bridge.factory({imgid='alias',id_local='body'})
local function factory() return sprites.factory({imgid='guessed'}) end
prefab.define({def_id='visual',class={},spatial={family='2d',authority='affine'},
 components={defined,bridge.factory({imgid='direct'}),factory()}})`, `{member_id='source',definition_id='visual'}`, [
		['sprite_bridge.lua', "return require('cartlib/component/sprite_component')"],
	]);
	assert.deepEqual(f.context.visualScene!.sprites.map(sprite => sprite.image), ['alias', 'direct']);
});

test('unresolved values, competing writes, whole-region replacement and duplicate definitions never fall back to other source', t => {
	const f = fixture(t, `
prefab.define({def_id='visual',class=sprite_object,spatial={family='2d',authority='affine'},
 defaults={imgid='prefab',region={x=1,y=2,width=3,height=4}}})
prefab.define({def_id='duplicate',class=sprite_object,spatial={family='2d',authority='affine'}})
prefab.define({def_id='duplicate',class=sprite_object,spatial={family='2d',authority='affine'}})`, `
 {member_id='dynamic_image',definition_id='visual',options={imgid=choose()}},
 {member_id='dynamic_inputs',definition_id='visual',options=choose()},
 {member_id='partial_region',definition_id='visual',options={region={width=7}}},
 {member_id='dynamic_affine',definition_id='visual',options={attachment_affine=choose()}},
 {member_id='unknown_keys',definition_id='visual',options={[choose()]=false}},
 {member_id='dynamic_owner',definition_id='visual',options=choose()},
 {member_id='duplicate',definition_id='duplicate',options={imgid='duplicate'}},
 {member_id='proved',definition_id='visual'},`);
	assert.equal(f.context.visualScene!.sprites.length, 1);
	assert.ok(f.context.visualScene!.sprites[0].entry === f.context.subject!.objects[7]);
});

test('primary overrides never remove an explicit base_sprite producer or mistake object initialize fields for the retained initializer', t => {
	const f = fixture(t, `
prefab.define({def_id='visual',class=sprite_object,spatial={family='2d',authority='affine'},
 defaults={imgid='input'},components={sprites.factory({id_local='base_sprite',imgid='factory'})}})`, `
 {member_id='override',definition_id='visual',options={primary_sprite_factory=custom}},
 {member_id='initializer_field',definition_id='visual',options={initialize=custom}},`);
	const sprites = f.context.visualScene!.sprites;
	assert.deepEqual(sprites.map(sprite => f.context.subject!.objects.indexOf(sprite.entry)), [0, 1, 1]);
});

test('missing, nil, non-callable and competing builtin initializer/factory sources never grant implicit sprite correspondence', t => {
	for (const source of [
		'return {}',
		'return {initialize=nil,primary_sprite_factory=nil}',
		'return {initialize=function() end}',
		'return {primary_sprite_factory=function() end}',
		'return {initialize=false,primary_sprite_factory=false}',
		SPRITE_MODULE.replace('return sprite', 'sprite.initialize=custom; return sprite'),
		SPRITE_MODULE.replace('return sprite', 'sprite.primary_sprite_factory=custom; return sprite'),
	]) {
		const f = fixture(t, `prefab.define({def_id='visual',class=sprite_object,spatial={family='2d',authority='affine'},
 defaults={imgid='implicit'},components={sprites.factory({imgid='explicit'})}})`, `{member_id='source',definition_id='visual'}`);
		const resource = f.sources.catalog.resolveResource({ contextId: f.resource.contextId, path: 'cartlib/sprite.lua' })!;
		const provider = resolveLuaTextFileModel(f.models, f.sources.catalog, resource);
		provider.pushEditOperations([{ offset: 0, deleteLength: provider.buffer.getText().length, text: source }]);
		f.context.refresh(); assert.deepEqual(f.context.visualScene!.sprites.map(sprite => sprite.image), ['explicit']);
	}
});

test('dependency generations replace constructor preview once, retain older reads, and unbound documents never gain visual authority', t => {
	const definition = `prefab.define({def_id='visual',class={},spatial={family='2d',authority='affine'},components={sprites.factory({imgid='before'})}})`;
	const f = fixture(t, definition, `{member_id='source',definition_id='visual'}`), before = f.context.visualScene!;
	const calls = t.mock.method(LuaSourceReader.prototype, 'call');
	for (let frame = 0; frame < 100; frame++) assert.ok(f.context.visualScene === before);
	assert.equal(calls.mock.callCount(), 0, 'steady reads reuse admitted producer and sprite records');
	const resource = f.sources.catalog.resolveResource({ contextId: f.resource.contextId, path: 'prefabs.lua' })!;
	const provider = resolveLuaTextFileModel(f.models, f.sources.catalog, resource);
	provider.pushEditOperations([{ offset: provider.buffer.getText().indexOf('before'), deleteLength: 6, text: 'after' }]);
	f.context.refresh(); const after = f.context.visualScene!;
	assert.notEqual(after, before); assert.equal(after.sprites[0].image, 'after'); assert.equal(before.sprites[0].image, 'before');
	assert.ok(after.sprites[0].entry === before.sprites[0].entry);
	const unbound = new SceneAuthoringContext(f.model, f.documents); t.after(() => unbound.dispose());
	const document = f.documents.get(f.model), scene = document.scenes[0];
	unbound.select(document, f.model.version, { kind: 'scene', scene });
	assert.equal(unbound.visualScene, undefined);
	f.context.dispose(); assert.equal(f.context.visualScene, undefined);
});

test('owner visibility follows options, defaults and raw class/base copy precedence without defaulting unknown inheritance', t => {
	const declarations = `
local inherited={}; setmetatable(inherited,{__index=unknown})
local replaced={}; setmetatable(replaced,{__index=unknown})
local hidden_base={visible=false}; setmetatable(hidden_base,{__index=unknown})
prefab.define({def_id='class_hidden',class={visible=false},spatial={family='2d',authority='affine'},components={sprites.factory({imgid='class_hidden'})}})
prefab.define({def_id='base_hidden',class={},base={visible=false},spatial={family='2d',authority='affine'},components={sprites.factory({imgid='base_hidden'})}})
prefab.define({def_id='class_wins',class={visible=0},base={visible=false},spatial={family='2d',authority='affine'},components={sprites.factory({imgid='class_wins'})}})
prefab.define({def_id='defaults_win',class={visible=false},defaults={visible=true},spatial={family='2d',authority='affine'},components={sprites.factory({imgid='defaults_win'})}})
prefab.define({def_id='unknown_class',class=unknown,spatial={family='2d',authority='affine'},components={sprites.factory({imgid='unknown_class'})}})
prefab.define({def_id='unknown_base',class={},base=unknown,spatial={family='2d',authority='affine'},components={sprites.factory({imgid='unknown_base'})}})
prefab.define({def_id='unknown_prototype',class={},base=inherited,spatial={family='2d',authority='affine'},components={sprites.factory({imgid='unknown_prototype'})}})
prefab.define({def_id='known_own_base',class={},base=hidden_base,spatial={family='2d',authority='affine'},components={sprites.factory({imgid='known_own_base'})}})
prefab.define({def_id='replaced_prototype',class=replaced,spatial={family='2d',authority='affine'},components={sprites.factory({imgid='replaced_prototype'})}})
prefab.define({def_id='same_class_base',class=inherited,base=inherited,spatial={family='2d',authority='affine'},components={sprites.factory({imgid='same_class_base'})}})`;
	const f = fixture(t, declarations, `
 {member_id='class_hidden',definition_id='class_hidden'},
 {member_id='base_hidden',definition_id='base_hidden'},
 {member_id='class_wins',definition_id='class_wins'},
 {member_id='defaults_win',definition_id='defaults_win'},
 {member_id='options_win',definition_id='class_hidden',options={visible=true}},
 {member_id='options_hide',definition_id='class_wins',options={visible=false}},
 {member_id='unknown_class',definition_id='unknown_class'},
 {member_id='unknown_base',definition_id='unknown_base'},
 {member_id='overridden_unknown',definition_id='unknown_base',options={visible=''}},
 {member_id='unknown_prototype',definition_id='unknown_prototype'},
 {member_id='known_own_base',definition_id='known_own_base'},
 {member_id='replaced_prototype',definition_id='replaced_prototype'},
 {member_id='same_class_base',definition_id='same_class_base'},`);
	assert.deepEqual(f.context.visualScene!.sprites.map(sprite => f.context.subject!.objects.indexOf(sprite.entry)), [2, 3, 4, 8, 11]);
});

test('actual constructor member replacement revokes builtin semantics even when replacement is a known function', t => {
	for (const replacement of [
		'sprites.new=function(context) return {} end',
		'sprites.factory=function(definition) return function(context) return {} end end',
		'sprites[key()]=function() return {} end',
	]) {
		const f = fixture(t, `${replacement}
prefab.define({def_id='visual',class={},spatial={family='2d',authority='affine'},
 components={sprites.new,sprites.factory({imgid='factory'})}})`, `{member_id='source',definition_id='visual'}`);
		const images = f.context.visualScene!.sprites.map(sprite => sprite.image);
		assert.deepEqual(images, []);
	}
});

test('a replaced prefab define callable never grants spatial or visual construction semantics', t => {
	const f = fixture(t, `prefab.define=function(definition) return definition end
prefab.define({def_id='visual',class={},spatial={family='2d',authority='affine'},components={sprites.factory({imgid='unproved'})}})`,
		`{member_id='source',definition_id='visual'}`);
	assert.equal(f.context.visualScene!.sprites.length, 0);
	const entry = f.context.subject!.objects[0]; assert.ok(entry.kind === 'object');
	assert.equal(f.context.spatialScene!.worlds.get(entry), undefined);
});
