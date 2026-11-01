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
setmetatable(sprite,{__index=require('cartlib/world/object_2d')})
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

test('sprite construction consumes concrete factory configuration, separate spatial/visual poses and whole source region', t => {
	const f = fixture(t, `
prefab.define({def_id='root',class=require('cartlib/world/object_2d')})
prefab.define({def_id='visual',class=require('cartlib/world/object_2d'),
 defaults={visible=false},
 components={sprites.factory({id_local='body',imgid='scene',region={x=-2,y=7,width=-3,height=0},flip_h=false,flip_v=true,presentation_order=4,enabled=0,visible='',
 attachment_affine={1,1,0,1,2,3},presentation_affine={-1,0,2,1,4,5},color=0x00123456,order=1})}})`, `
 {member_id='child',definition_id='visual',parent='parent',position = { x = 4, y = 5 },
 options={visible=0,active=false,imgid='not-component-config',order=99}},
 {member_id='parent',definition_id='root',transform = { xx = 2, xy = 0, yx = 1, yy = 3, ox = 10, oy = 20 }},`);
	const read = f.context.visualScene!, sprite = read.canvas[0];
	assert.ok(sprite.kind === 'sprite');
	assert.equal(read.canvas.length, 1); assert.ok(sprite.entry === f.context.subject!.objects[0]);
	assert.equal(sprite.image, 'scene'); assert.equal(sprite.color, 0xff123456);
	assert.equal(sprite.flipH, false); assert.equal(sprite.flipV, true); assert.equal(sprite.order, 5);
	assert.deepEqual(sprite.region, { x: -2, y: 7, width: -3, height: 0 });
	assert.ok(sprite.world === f.context.spatialScene!.worlds.get(sprite.entry));
	assert.deepEqual(sprite.attachment, { family: '2d', xx: 1, xy: 1, yx: 0, yy: 1, ox: 2, oy: 3 });
	assert.deepEqual(sprite.presentation, { family: '2d', xx: -1, xy: 0, yx: 2, yy: 1, ox: 4, oy: 5 });
	assert.equal(f.context.selection, undefined); assert.equal(f.model.buffer.getText(), f.source); assert.equal(f.model.canUndo, false);
});

test('nil-only defaults differ from Lua or defaults, and authored top color byte is not opacity', t => {
	const f = fixture(t, `
prefab.define({def_id='visual',class=sprite_object,
 defaults={imgid='prefab',color=0x00123456,flip_h=true,visible=true,attachment_affine={2,0,0,3,4,5},region={x=1,y=2,width=3,height=4}}})`, `
 {member_id='nil',definition_id='visual',options={imgid=nil,color=nil,flip_h=nil,region=false,attachment_affine=false,presentation_affine=false,enabled=false}},
 {member_id='false',definition_id='visual',options={color=false,flip_h=false,order=false,visible=false}},
 {member_id='top',definition_id='visual',options={color=0xfe123456}},`);
	const sprites = f.context.visualScene!.canvas.filter(visual => visual.kind === 'sprite');
	assert.equal(sprites.length, 2); assert.equal(sprites[0].image, 'prefab');
	assert.equal(sprites[0].color, 0xff123456); assert.equal(sprites[1].color, sprites[0].color);
	assert.equal(sprites[0].flipH, true); assert.equal(sprites[0].region, undefined);
	assert.deepEqual(sprites[0].attachment, { family: '2d', xx: 1, xy: 0, yx: 0, yy: 1, ox: 0, oy: 0 });
	assert.deepEqual(sprites[0].presentation, { family: '2d', xx: 1, xy: 0, yx: 0, yy: 1, ox: 0, oy: 0 });
});

test('fresh sprite order follows smallest-ready parent construction and implicit initialization before explicit components', t => {
	const f = fixture(t, `
prefab.define({def_id='visual',class=sprite_object,defaults={imgid='primary'},
 components={sprites.factory({imgid='explicit'})}})`, `
 {member_id='child',definition_id='visual',parent='parent'},
 {member_id='free',definition_id='visual'},
 {member_id='parent',definition_id='visual'},
 {member_id='last',definition_id='visual',options={order=-1}},`);
	const scene = f.context.subject!, sprites = f.context.visualScene!.canvas.filter(visual => visual.kind === 'sprite');
	assert.deepEqual(sprites.map(sprite => [scene.objects.indexOf(sprite.entry), sprite.image]),
		[[3, 'primary'], [1, 'primary'], [1, 'explicit'], [2, 'primary'], [2, 'explicit'], [0, 'primary'], [0, 'explicit'], [3, 'explicit']]);
});

test('known constructor import provenance survives aliases and reexports, without guessing similarly named custom calls', t => {
	const f = fixture(t, `
local bridge=require('sprite_bridge')
local defined=bridge.factory({imgid='alias',id_local='body'})
local function factory() return sprites.factory({imgid='guessed'}) end
prefab.define({def_id='visual',class=require('cartlib/world/object_2d'),
 components={defined,bridge.factory({imgid='direct'}),factory()}})`, `{member_id='source',definition_id='visual'}`, [
		['sprite_bridge.lua', "return require('cartlib/component/sprite_component')"],
	]);
	assert.deepEqual(f.context.visualScene!.canvas.filter(visual => visual.kind === 'sprite').map(sprite => sprite.image), ['alias', 'direct']);
});

test('unresolved values, competing writes, whole-region replacement and duplicate definitions never fall back to other source', t => {
	const f = fixture(t, `
prefab.define({def_id='visual',class=sprite_object,
 defaults={imgid='prefab',region={x=1,y=2,width=3,height=4}}})
prefab.define({def_id='duplicate',class=sprite_object})
prefab.define({def_id='duplicate',class=sprite_object})`, `
 {member_id='dynamic_image',definition_id='visual',options={imgid=choose()}},
 {member_id='dynamic_inputs',definition_id='visual',options=choose()},
 {member_id='partial_region',definition_id='visual',options={region={width=7}}},
 {member_id='dynamic_affine',definition_id='visual',options={attachment_affine=choose()}},
 {member_id='unknown_keys',definition_id='visual',options={[choose()]=false}},
 {member_id='dynamic_owner',definition_id='visual',options=choose()},
 {member_id='duplicate',definition_id='duplicate',options={imgid='duplicate'}},
 {member_id='proved',definition_id='visual'},`);
	assert.equal(f.context.visualScene!.canvas.length, 1);
	assert.ok(f.context.visualScene!.canvas[0].entry === f.context.subject!.objects[7]);
});

test('primary overrides never remove an explicit base_sprite producer or mistake object initialize fields for the retained initializer', t => {
	const f = fixture(t, `
prefab.define({def_id='visual',class=sprite_object,
 defaults={imgid='input'},components={sprites.factory({id_local='base_sprite',imgid='factory'})}})`, `
 {member_id='override',definition_id='visual',options={primary_sprite_factory=custom}},
 {member_id='initializer_field',definition_id='visual',options={initialize=custom}},`);
	const sprites = f.context.visualScene!.canvas.filter(visual => visual.kind === 'sprite');
	assert.deepEqual(sprites.map(sprite => f.context.subject!.objects.indexOf(sprite.entry)), [0, 1, 1]);
});

for (const [name, declaration, images] of [
	['inherited original', 'local child=setmetatable({}, {__index=sprite_object})', ['primary', 'explicit']],
	['aliased original', 'local original=sprite_object.initialize; local child=setmetatable({initialize=original}, {__index=sprite_object})', ['primary', 'explicit']],
	['known empty override', 'local child=setmetatable({}, {__index=sprite_object}); function child.initialize(self) end', ['explicit']],
	['unknown override', 'local child=setmetatable({initialize=unknown_initializer}, {__index=sprite_object})', ['explicit']],
] as const) test(`${name} initializer retains only proved implicit Sprite construction in Scene and Add`, t => {
	const f = fixture(t, `${declaration}
prefab.define({def_id='visual',class=child,defaults={imgid='primary'},
 components={sprites.factory({imgid='explicit',order=1})}})`, `{member_id='source',definition_id='visual'}`);
	const sourceVisuals = f.context.visualScene!.canvas;
	assert.deepEqual(sourceVisuals.filter(visual => visual.kind === 'sprite').map(sprite => sprite.image), images);
	const request = f.context.captureAddMember('2d')!, choice = request.choices[0], preview = request.getPreview(choice)!;
	assert.deepEqual(preview.visuals.canvas.map(({ entry, world, ...inputs }) => inputs),
		sourceVisuals.map(({ entry, world, ...inputs }) => inputs));
	assert.equal(f.model.buffer.getText(), f.source); assert.equal(f.model.canUndo, false);
	assert.equal(request.apply(choice, 17, -9, 0), true);
	const selected = f.context.selection!; assert.ok(selected.kind === 'member');
	assert.deepEqual(f.context.visualScene!.canvas.filter(visual => visual.entry === selected.entry)
		.map(({ entry, world, ...inputs }) => inputs), preview.visuals.canvas.map(({ entry, world, ...inputs }) => inputs));
	f.model.undo(); assert.equal(f.model.buffer.getText(), f.source); assert.equal(f.model.canUndo, false);
});

test('missing, nil, non-callable and competing builtin initializer/factory sources never grant implicit sprite correspondence', t => {
	for (const source of [
		"return setmetatable({}, {__index=require('cartlib/world/object_2d')})",
		"return setmetatable({initialize=nil,primary_sprite_factory=nil}, {__index=require('cartlib/world/object_2d')})",
		"return setmetatable({initialize=function() end}, {__index=require('cartlib/world/object_2d')})",
		"return setmetatable({primary_sprite_factory=function() end}, {__index=require('cartlib/world/object_2d')})",
		"return setmetatable({initialize=false,primary_sprite_factory=false}, {__index=require('cartlib/world/object_2d')})",
		SPRITE_MODULE.replace('return sprite', 'sprite.initialize=custom; return sprite'),
		SPRITE_MODULE.replace('return sprite', 'sprite.primary_sprite_factory=custom; return sprite'),
	]) {
		const f = fixture(t, `prefab.define({def_id='visual',class=sprite_object,
 defaults={imgid='implicit'},components={sprites.factory({imgid='explicit'})}})`, `{member_id='source',definition_id='visual'}`);
		const resource = f.sources.catalog.resolveResource({ contextId: f.resource.contextId, path: 'cartlib/sprite.lua' })!;
		const provider = resolveLuaTextFileModel(f.models, f.sources.catalog, resource);
		provider.pushEditOperations([{ offset: 0, deleteLength: provider.buffer.getText().length, text: source }]);
		f.context.refresh(); assert.deepEqual(f.context.visualScene!.canvas.filter(visual => visual.kind === 'sprite').map(sprite => sprite.image), ['explicit']);
	}
});

test('dependency generations replace constructor preview once, retain older reads, and unbound documents never gain visual authority', t => {
	const definition = `prefab.define({def_id='visual',class=require('cartlib/world/object_2d'),components={sprites.factory({imgid='before'})}})`;
	const f = fixture(t, definition, `{member_id='source',definition_id='visual'}`), before = f.context.visualScene!;
	const calls = t.mock.method(LuaSourceReader.prototype, 'call');
	for (let frame = 0; frame < 100; frame++) assert.ok(f.context.visualScene === before);
	assert.equal(calls.mock.callCount(), 0, 'steady reads reuse admitted producer and sprite records');
	const resource = f.sources.catalog.resolveResource({ contextId: f.resource.contextId, path: 'prefabs.lua' })!;
	const provider = resolveLuaTextFileModel(f.models, f.sources.catalog, resource);
	provider.pushEditOperations([{ offset: provider.buffer.getText().indexOf('before'), deleteLength: 6, text: 'after' }]);
	f.context.refresh(); const after = f.context.visualScene!;
	assert.notEqual(after, before); assert.ok(after.canvas[0].kind === 'sprite' && before.canvas[0].kind === 'sprite');
	assert.equal(after.canvas[0].image, 'after'); assert.equal(before.canvas[0].image, 'before');
	assert.ok(after.canvas[0].entry === before.canvas[0].entry);
	const unbound = new SceneAuthoringContext(f.model, f.documents); t.after(() => unbound.dispose());
	const document = f.documents.get(f.model), scene = document.scenes[0];
	unbound.select(document, f.model.version, { kind: 'scene', scene });
	assert.equal(unbound.visualScene, undefined);
	f.context.dispose(); assert.equal(f.context.visualScene, undefined);
});

test('owner visibility follows actual class lineage, options and defaults without inventing unknown ancestry', t => {
	const declarations = `
local object=require('cartlib/world/object_2d')
local hidden=setmetatable({visible=false},{__index=object})
local inherited=setmetatable({}, {__index=hidden})
local visible=setmetatable({visible=0},{__index=hidden})
local computed=setmetatable({visible=unknown}, {__index=object})
local unknown_class=setmetatable({}, {__index=unknown})
prefab.define({def_id='hidden',class=hidden,components={sprites.factory({imgid='hidden'})}})
prefab.define({def_id='inherited',class=inherited,components={sprites.factory({imgid='inherited'})}})
prefab.define({def_id='visible',class=visible,components={sprites.factory({imgid='visible'})}})
prefab.define({def_id='defaults',class=hidden,defaults={visible=true},components={sprites.factory({imgid='defaults'})}})
prefab.define({def_id='computed',class=computed,components={sprites.factory({imgid='computed'})}})
prefab.define({def_id='unknown',class=unknown_class,components={sprites.factory({imgid='unknown'})}})`;
	const f = fixture(t, declarations, `
 {member_id='hidden',definition_id='hidden'},
 {member_id='inherited',definition_id='inherited'},
 {member_id='visible',definition_id='visible'},
 {member_id='defaults',definition_id='defaults'},
 {member_id='options',definition_id='hidden',options={visible=true}},
 {member_id='hidden_override',definition_id='visible',options={visible=false}},
 {member_id='computed',definition_id='computed'},
 {member_id='known_override',definition_id='computed',options={visible=true}},
 {member_id='unknown_dimension',definition_id='unknown',options={visible=true}},`);
	assert.deepEqual(f.context.visualScene!.canvas.filter(visual => visual.kind === 'sprite').map(sprite => f.context.subject!.objects.indexOf(sprite.entry)), [2,3,4,7]);
});

test('actual constructor member replacement revokes builtin semantics even when replacement is a known function', t => {
	for (const replacement of [
		'sprites.new=function(context) return {} end',
		'sprites.factory=function(definition) return function(context) return {} end end',
		'sprites[key()]=function() return {} end',
	]) {
		const f = fixture(t, `${replacement}
prefab.define({def_id='visual',class=require('cartlib/world/object_2d'),
 components={sprites.new,sprites.factory({imgid='factory'})}})`, `{member_id='source',definition_id='visual'}`);
		const images = f.context.visualScene!.canvas.filter(visual => visual.kind === 'sprite').map(sprite => sprite.image);
		assert.deepEqual(images, []);
	}
});

test('a replaced prefab define callable never grants spatial or visual construction semantics', t => {
	const f = fixture(t, `prefab.define=function(definition) return definition end
prefab.define({def_id='visual',class=require('cartlib/world/object_2d'),components={sprites.factory({imgid='unproved'})}})`,
		`{member_id='source',definition_id='visual'}`);
	assert.equal(f.context.visualScene!.canvas.length, 0);
	const entry = f.context.subject!.objects[0]; assert.ok(entry.kind === 'object');
	assert.equal(f.context.spatialScene!.worlds.get(entry), undefined);
});

test('prefab placement borrows the same constructor inputs and linear pose as the member it will append', t => {
	const f = fixture(t, `
prefab.define({def_id='visual',class=sprite_object,
 transform={xx=2,xy=1,yx=-1,yy=3,ox=44,oy=55},position={x=90},
 defaults={imgid='primary',color=0x00123456,flip_h=true,order=2,region={x=1,y=2,width=3,height=4},
  attachment_affine={1,1,0,1,2,3},presentation_affine={-1,0,2,1,4,5}},
 components={sprites.factory({imgid='explicit',order=-1,presentation_order=1,flip_v=true})}})`, '');
	const request = f.context.captureAddMember('2d')!, choice = request.choices[0], version = f.model.version;
	const preview = request.getPreview(choice)!;
	assert.ok(preview); assert.deepEqual(preview.world, { family: '2d', xx: 2, xy: 1, yx: -1, yy: 3, ox: 0, oy: 0 });
	assert.deepEqual(preview.visuals.canvas.filter(visual => visual.kind === 'sprite').map(sprite => sprite.image), ['explicit', 'primary']);
	assert.equal(preview.visuals.models.length, 0);
	for (const sprite of preview.visuals.canvas) { assert.equal(sprite.entry, choice); assert.equal(sprite.world, preview.world); }
	const reads = t.mock.method(LuaSourceReader.prototype, 'memberState');
	for (let frame = 0; frame < 100; frame++) assert.equal(request.getPreview(choice), preview);
	assert.equal(f.context.captureAddMember('2d')!.getPreview(choice), preview, 'the immutable projection, not a request, retains selected producer output');
	assert.equal(reads.mock.callCount(), 0, 'steady preview queries do not reparse visual or spatial inputs'); reads.mock.restore();
	assert.equal(f.model.version, version); assert.equal(f.model.buffer.getText(), f.source); assert.equal(f.model.canUndo, false);
	assert.equal(f.context.selection, undefined);
	assert.equal(request.apply(choice, -17, 43, 0), true); assert.equal(request.getPreview(choice), undefined);
	const appended = f.context.visualScene!;
	assert.deepEqual(appended.canvas.filter(visual => visual.kind === 'sprite').map(({ entry, world, ...inputs }) => inputs),
		preview.visuals.canvas.filter(visual => visual.kind === 'sprite').map(({ entry, world, ...inputs }) => inputs));
	for (const sprite of appended.canvas) assert.deepEqual(sprite.world, { ...preview.world, ox: -17, oy: 43 });
	assert.equal(preview.world.ox, 0); assert.equal(preview.world.oy, 0);
	f.model.undo(); assert.equal(f.model.buffer.getText(), f.source); assert.equal(f.model.canUndo, false);
});

test('prefab preview never invents custom draws, hidden visuals, dynamic input or an unresolved spatial basis', t => {
	const f = fixture(t, `
local object=require('cartlib/world/object_2d')
prefab.define({def_id='custom',class=object,components={function() end}})
prefab.define({def_id='hidden',class=sprite_object,defaults={imgid='hidden',visible=false}})
prefab.define({def_id='dynamic_image',class=sprite_object,defaults={imgid=choose()}})
prefab.define({def_id='dynamic_visible',class=sprite_object,defaults={imgid='hidden',visible=choose()}})
prefab.define({def_id='dynamic_affine',class=sprite_object,defaults={imgid='hidden',attachment_affine=choose()}})
prefab.define({def_id='dynamic_pose',class=sprite_object,transform=choose(),defaults={imgid='not-proved'}})
prefab.define({def_id='mixed',class=object,components={function() end,sprites.factory({imgid='proved'}),sprites.factory({imgid=choose()})}})`, '');
	const request = f.context.captureAddMember('2d')!;
	assert.deepEqual(request.choices.map(choice => choice.id), ['custom', 'hidden', 'dynamic_image', 'dynamic_visible', 'dynamic_affine', 'dynamic_pose', 'mixed']);
	for (const choice of request.choices) {
		const preview = request.getPreview(choice);
		if (choice.id === 'dynamic_pose') assert.equal(preview, undefined);
		else {
			assert.ok(preview); assert.equal(preview.visuals.models.length, 0);
			assert.deepEqual(preview.visuals.canvas.filter(visual => visual.kind === 'sprite').map(sprite => sprite.image), choice.id === 'mixed' ? ['proved'] : []);
		}
	}
	assert.equal(f.model.buffer.getText(), f.source); assert.equal(f.model.canUndo, false);
	const dynamic = request.choices.find(choice => choice.id === 'dynamic_pose')!;
	assert.equal(request.apply(dynamic, 7, 8, 0), true, 'missing preview never narrows independent Add admission');
});

test('prefab preview generations preserve old reads and retire captured authority when a dependency changes', t => {
	const f = fixture(t, `prefab.define({def_id='visual',class=sprite_object,defaults={imgid='before'}})`, '');
	const request = f.context.captureAddMember('2d')!, choice = request.choices[0], before = request.getPreview(choice)!;
	const resource = f.sources.catalog.resolveResource({ contextId: f.resource.contextId, path: 'prefabs.lua' })!;
	const provider = resolveLuaTextFileModel(f.models, f.sources.catalog, resource);
	provider.pushEditOperations([{ offset: provider.buffer.getText().indexOf('before'), deleteLength: 6, text: 'after' }]);
	assert.equal(request.getPreview(choice), undefined); assert.equal(request.isCurrent(), false);
	const next = f.context.captureAddMember('2d')!, after = next.getPreview(next.choices[0])!;
	assert.notEqual(next.choices[0], choice); assert.notEqual(after, before);
	assert.ok(after.visuals.canvas[0].kind === 'sprite' && before.visuals.canvas[0].kind === 'sprite');
	assert.equal(after.visuals.canvas[0].image, 'after'); assert.equal(before.visuals.canvas[0].image, 'before');
	assert.equal(f.model.buffer.getText(), f.source); assert.equal(f.model.canUndo, false);
	f.context.dispose(); assert.equal(next.getPreview(next.choices[0]), undefined);
});
