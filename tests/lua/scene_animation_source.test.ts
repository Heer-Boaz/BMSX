import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { LuaSourceReader } from '../../ide/language/lua/source_reader';
import { SceneAuthoringContext } from '../../ide/workbench/contrib/scene_editor/authoring_context';
import { resolveLuaTextFileModel } from '../../ide/workbench/services/working_copy/text_file_model';
import { SCENE_ANIMATION_IMPORTS, SCENE_ANIMATION_MODULES, SCENE_NAMED_ANIMATION } from '../fixtures/studio/scene_animation';
import { createSceneSourceFixture } from '../helpers/scene_sources';

function fixture(t: TestContext, definitions: string, members = "{member_id='actor',definition_id='actor'}",
	providers: readonly (readonly [string, string])[] = []) {
	const source = `local scenes=require('cartlib/world/scene_library')
local animation=require('cartlib/component/sprite_animation_component')
scenes.register('main',{objects={${members}}})`;
	const f = createSceneSourceFixture(t, source, 'scene.lua', undefined, [
		...SCENE_ANIMATION_MODULES.filter(([path]) => !providers.some(([provided]) => provided === path)),
		['prefabs.lua', SCENE_ANIMATION_IMPORTS + definitions], ...providers,
	]);
	const document = f.documents.get(f.model), context = new SceneAuthoringContext(f.model, f.documents,
		{ document, scene: document.scenes[0], sourceVersion: f.model.version });
	const resource = f.sources.catalog.resolveResource({ contextId: f.resource.contextId, path: 'prefabs.lua' })!;
	const prefabs = resolveLuaTextFileModel(f.models, f.sources.catalog, resource);
	t.after(() => context.dispose());
	const images = () => { context.refresh(); return context.visualScene!.canvas.filter(visual => visual.kind === 'sprite').map(visual => visual.image); };
	return { ...f, source, context, prefabs, images };
}

test('an explicit single-sequence factory projects its initial frame and own visual inputs, not owner options', t => {
	const f = fixture(t, `prefab.define({def_id='actor',class=object,components={
 animation.factory({frames={'first','second'},imgid='factory_static',color=0x00123456,order=4,flip_h=true})}})`,
		"{member_id='actor',definition_id='actor',options={imgid='owner_static',frames={'owner_frame'},animation='other',color=0xff000000,order=99}}");
	assert.deepEqual(f.images(), ['first']);
	const sprite = f.context.visualScene!.canvas[0]; assert.ok(sprite.kind === 'sprite');
	assert.ok(sprite.entry === f.context.subject!.objects[0]);
	assert.equal(sprite.color, 0xff123456); assert.equal(sprite.order, 4); assert.equal(sprite.flipH, true);
	assert.equal(f.model.buffer.getText(), f.source); assert.equal(f.model.canUndo, false);
});

for (const animated of [false, true]) test(`captured ${animated ? 'animated' : 'static'} defaults contain only copied own fields`, t => {
	const definition = animated ? "animation='idle',animations={idle={frames={'first'}}}" : "imgid='first'";
	const factory = animated ? 'animation' : 'sprites';
	const f = fixture(t, `local captured=setmetatable({${definition}},
 {__index={imgid='inherited',enabled=false,visible=false,color=0xff123456,region=false,attachment_affine=true}})
local actor=setmetatable({primary_sprite_factory=${factory}.factory(captured)}, {__index=sprite_object})
prefab.define({def_id='actor',class=actor})`);
	assert.deepEqual(f.images(), ['first']);
	const sprite = f.context.visualScene!.canvas[0]; assert.ok(sprite.kind === 'sprite');
	assert.equal(sprite.color, 0xffffffff); assert.equal(sprite.region, undefined); assert.equal(sprite.attachment.ox, 0);
});

test('prefab defaults supply copied own values without admitting their original prototype', t => {
	const f = fixture(t, `prefab.define({def_id='actor',class=sprite_object,
 defaults=setmetatable({imgid='own'}, {__index={visible=false,color=0xff123456}})})`);
	assert.deepEqual(f.images(), ['own']);
	const sprite = f.context.visualScene!.canvas[0]; assert.ok(sprite.kind === 'sprite');
	assert.equal(sprite.color, 0xffffffff);
});

test('a non-table prefab default is not normalized to empty captured storage', t => {
	const f = fixture(t, `local actor=setmetatable({imgid='class_image'}, {__index=sprite_object})
prefab.define({def_id='actor',class=actor,defaults=false})`);
	assert.deepEqual(f.images(), []); assert.equal(f.model.canUndo, false);
});

test('an inherited primary animation factory wins over imgid and preserves factory defaults before Sprite overrides', t => {
	const f = fixture(t, `local base=setmetatable({primary_sprite_factory=animation.factory({
 frames={'first','second'},imgid='factory_static',color=0x00123456,order=4,flip_h=true,
 attachment_affine={1,0,0,1,3,4}})}, {__index=sprite_object})
local actor=setmetatable({}, {__index=base})
prefab.define({def_id='actor',class=actor,defaults={imgid='owner_static'}})`, `
 {member_id='default',definition_id='actor'},
 {member_id='override',definition_id='actor',options={imgid='instance_static',color=0x00abcdef,order=7,flip_h=false,
  attachment_affine={1,0,0,1,8,9}}},`);
	assert.deepEqual(f.images(), ['first', 'first']);
	const sprites = f.context.visualScene!.canvas; assert.ok(sprites[0].kind === 'sprite' && sprites[1].kind === 'sprite');
	assert.equal(sprites[0].color, 0xff123456); assert.equal(sprites[0].order, 4); assert.equal(sprites[0].flipH, true);
	assert.equal(sprites[0].attachment.ox, 3); assert.equal(sprites[0].attachment.oy, 4);
	assert.equal(sprites[1].color, 0xffabcdef); assert.equal(sprites[1].order, 7); assert.equal(sprites[1].flipH, false);
	assert.equal(sprites[1].attachment.ox, 8); assert.equal(sprites[1].attachment.oy, 9);
});

test('named primary selection uses the factory initial animation and then the actual owner animation override', t => {
	const f = fixture(t, `local actor=setmetatable({primary_sprite_factory=${SCENE_NAMED_ANIMATION}}, {__index=sprite_object})
prefab.define({def_id='actor',class=actor})`, `
 {member_id='default',definition_id='actor'},
 {member_id='run',definition_id='actor',options={animation='run'}},
 {member_id='nil',definition_id='actor',options={animation=nil}},
 {member_id='false',definition_id='actor',options={animation=false}},
 {member_id='unknown',definition_id='actor',options={animation=choose()}},
 {member_id='missing',definition_id='actor',options={animation='missing'}},`);
	assert.deepEqual(f.images(), ['idle_first', 'run_first', 'idle_first']);
	assert.deepEqual(f.context.visualScene!.canvas.map(visual => f.context.subject!.objects.indexOf(visual.entry)), [0, 1, 2]);
	assert.equal(f.model.buffer.getText(), f.source); assert.equal(f.model.canUndo, false);
});

test('prefab-default primary animation selection is applied after the captured factory default', t => {
	const f = fixture(t, `local actor=setmetatable({primary_sprite_factory=${SCENE_NAMED_ANIMATION}}, {__index=sprite_object})
prefab.define({def_id='actor',class=actor,defaults={animation='run'}})`, `
 {member_id='default',definition_id='actor'},
 {member_id='override',definition_id='actor',options={animation='idle'}},`);
	assert.deepEqual(f.images(), ['run_first', 'idle_first']);
});

test('canonical-prefix Sprite initialization wrappers retain primary animation construction and independent component profiles', t => {
	const f = fixture(t, `local actor=setmetatable({primary_sprite_factory=animation.factory({frames={'primary_first','primary_second'}})}, {__index=sprite_object})
function actor.initialize(self)
 sprite_object.initialize(self)
 self.health=self.max_health
 self.vulnerable=true
end
prefab.define({def_id='actor',class=actor,components={animation.factory({frames={'explicit_first','explicit_second'},order=1})}})`);
	assert.deepEqual(f.images(), ['primary_first', 'explicit_first']);
	assert.equal(f.model.buffer.getText(), f.source); assert.equal(f.model.canUndo, false);
});

test('primary static factory defaults survive nil and false no-setter overlays while explicit scalar setters keep their own rules', t => {
	const f = fixture(t, `local actor=setmetatable({primary_sprite_factory=sprites.factory({imgid='factory_image',color=0x00123456,order=4,
 flip_h=true,region={x=1,y=2,width=3,height=4},attachment_affine={1,0,0,1,3,4},presentation_affine={1,0,0,1,5,6}})}, {__index=sprite_object})
prefab.define({def_id='actor',class=actor})`, `
 {member_id='nil',definition_id='actor',options={imgid=nil,color=nil,order=nil,flip_h=nil,region=nil,attachment_affine=nil,presentation_affine=nil}},
 {member_id='false',definition_id='actor',options={color=false,order=false,flip_h=false,region=false,attachment_affine=false,presentation_affine=false}},
 {member_id='override',definition_id='actor',options={imgid='owner_image',color=0x00abcdef,order=7,
  region={x=8,y=9,width=10,height=11},attachment_affine={1,0,0,1,12,13},presentation_affine={1,0,0,1,14,15}}},
 {member_id='no_image',definition_id='actor',options={imgid=false}},`);
	assert.deepEqual(f.images(), ['factory_image', 'factory_image', 'owner_image']);
	const sprites = f.context.visualScene!.canvas, entries = f.context.subject!.objects;
	const nil = sprites.find(sprite => sprite.entry === entries[0]), falsy = sprites.find(sprite => sprite.entry === entries[1]);
	const overridden = sprites.find(sprite => sprite.entry === entries[2]);
	assert.ok(nil?.kind === 'sprite' && falsy?.kind === 'sprite' && overridden?.kind === 'sprite');
	assert.equal(nil.color, 0xff123456); assert.equal(nil.order, 4); assert.equal(nil.flipH, true);
	assert.equal(falsy.color, 0xffffffff); assert.equal(falsy.order, 0); assert.equal(falsy.flipH, false);
	assert.deepEqual(nil.region, { x: 1, y: 2, width: 3, height: 4 }); assert.deepEqual(falsy.region, nil.region);
	assert.equal(falsy.attachment.ox, 3); assert.equal(falsy.attachment.oy, 4);
	assert.equal(falsy.presentation.ox, 5); assert.equal(falsy.presentation.oy, 6);
	assert.deepEqual(overridden.region, { x: 8, y: 9, width: 10, height: 11 });
	assert.equal(overridden.attachment.ox, 12); assert.equal(overridden.attachment.oy, 13);
	assert.equal(overridden.presentation.ox, 14); assert.equal(overridden.presentation.oy, 15);
});

for (const factory of ['sprites', 'animation']) for (const [field, receivers] of [
	['region', ['false', 'true', '7', "'not_a_region'", 'unknown_region', 'choose_region()']],
	['attachment_affine', ['true', '7', "'not_an_affine'", 'unknown_attachment', 'choose_attachment()']],
	['presentation_affine', ['true', '7', "'not_an_affine'", 'unknown_presentation', 'choose_presentation()']],
] as const) for (const receiver of receivers)
	test(`a later owner setter cannot mask the primary ${factory} constructor receiver ${field}=${receiver}`, t => {
		const f = fixture(t, `local actor=setmetatable({primary_sprite_factory=${factory}.factory({
 imgid='factory_image',frames={'first','second'},${field}=${receiver}})}, {__index=sprite_object})
prefab.define({def_id='actor',class=actor})`, `
 {member_id='actor',definition_id='actor',options={imgid='owner_image',
  region={x=1,y=2,width=3,height=4},attachment_affine={1,0,0,1,5,6},presentation_affine={1,0,0,1,7,8}}}`);
		assert.deepEqual(f.images(), []);
		assert.equal(f.model.buffer.getText(), f.source); assert.equal(f.model.canUndo, false);
	});

for (const factory of ['sprites', 'animation'])
	test(`primary ${factory} constructor nil region and false affine receivers preserve the real no-resolution rules`, t => {
		const f = fixture(t, `local actor=setmetatable({primary_sprite_factory=${factory}.factory({
 imgid='factory_image',frames={'first','second'},region=nil,attachment_affine=false,presentation_affine=false})}, {__index=sprite_object})
prefab.define({def_id='actor',class=actor})`, `
 {member_id='actor',definition_id='actor',options={
  region={x=1,y=2,width=3,height=4},attachment_affine={1,0,0,1,5,6},presentation_affine={1,0,0,1,7,8}}}`);
		assert.deepEqual(f.images(), [factory === 'sprites' ? 'factory_image' : 'first']);
		const visual = f.context.visualScene!.canvas[0]; assert.ok(visual.kind === 'sprite');
		assert.deepEqual(visual.region, { x: 1, y: 2, width: 3, height: 4 });
		assert.equal(visual.attachment.ox, 5); assert.equal(visual.attachment.oy, 6);
		assert.equal(visual.presentation.ox, 7); assert.equal(visual.presentation.oy, 8);
	});

for (const factory of ['sprites', 'animation'])
	test(`primary ${factory} construction only stores captured table fields before complete owner setters replace them`, t => {
		const f = fixture(t, `local actor=setmetatable({primary_sprite_factory=${factory}.factory({
 imgid='factory_image',frames={'first','second'},region={x=unknown_x,y=unknown_y,width=unknown_width,height=unknown_height},
 attachment_affine={unknown_xx,unknown_xy,unknown_yx,unknown_yy,unknown_ox,unknown_oy},
 presentation_affine={unknown_xx,unknown_xy,unknown_yx,unknown_yy,unknown_ox,unknown_oy}})}, {__index=sprite_object})
prefab.define({def_id='actor',class=actor})`, `
 {member_id='actor',definition_id='actor',options={
  region={x=1,y=2,width=3,height=4},attachment_affine={1,0,0,1,5,6},presentation_affine={1,0,0,1,7,8}}}`);
		assert.deepEqual(f.images(), [factory === 'sprites' ? 'factory_image' : 'first']);
		const visual = f.context.visualScene!.canvas[0]; assert.ok(visual.kind === 'sprite');
		assert.deepEqual(visual.region, { x: 1, y: 2, width: 3, height: 4 });
		assert.equal(visual.attachment.ox, 5); assert.equal(visual.presentation.oy, 8);
		assert.equal(f.model.buffer.getText(), f.source); assert.equal(f.model.canUndo, false);
	});

for (const factory of ['sprites', 'animation']) for (const image of ['true', '7', '{}', 'unknown_image', 'choose_image()'])
	test(`primary ${factory} eager captured imgid=${image} cannot be rescued by an owner image or known animation frame`, t => {
		const f = fixture(t, `local actor=setmetatable({primary_sprite_factory=${factory}.factory({
 imgid=${image},frames={'first','second'}})}, {__index=sprite_object})
prefab.define({def_id='actor',class=actor})`, "{member_id='actor',definition_id='actor',options={imgid='owner_image'}}");
		assert.deepEqual(f.images(), []);
		assert.equal(f.model.buffer.getText(), f.source); assert.equal(f.model.canUndo, false);
	});

for (const factory of ['sprites', 'animation']) for (const image of ['nil', 'false'])
	test(`primary ${factory} captured imgid=${image} skips eager image resolution before its later real image selection`, t => {
		const f = fixture(t, `local actor=setmetatable({primary_sprite_factory=${factory}.factory({
 imgid=${image},frames={'first','second'}})}, {__index=sprite_object})
prefab.define({def_id='actor',class=actor})`, "{member_id='actor',definition_id='actor',options={imgid='owner_image'}}");
		assert.deepEqual(f.images(), [factory === 'sprites' ? 'owner_image' : 'first']);
		assert.equal(f.model.buffer.getText(), f.source); assert.equal(f.model.canUndo, false);
	});

for (const factory of ['sprites', 'animation']) for (const state of ['enabled=false', 'visible=false'])
	test(`owner visibility and enabled fields do not reactivate a disabled primary ${factory} factory: ${state}`, t => {
		const f = fixture(t, `local actor=setmetatable({primary_sprite_factory=${factory}.factory({imgid='image',frames={'first','second'},${state}})}, {__index=sprite_object})
prefab.define({def_id='actor',class=actor})`, "{member_id='actor',definition_id='actor',options={enabled=true,visible=true}}");
		assert.deepEqual(f.images(), []); assert.equal(f.model.canUndo, false);
	});

test('explicit named factories do not receive the owning object animation selection', t => {
	const f = fixture(t, `prefab.define({def_id='actor',class=object,components={${SCENE_NAMED_ANIMATION}}})`,
		"{member_id='actor',definition_id='actor',options={animation='run'}}");
	assert.deepEqual(f.images(), ['idle_first']);
});

test('owner and prefab-default primary factory overrides are admitted by their actual application, not discarded wholesale', t => {
	const f = fixture(t, `prefab.define({def_id='actor',class=sprite_object,defaults={imgid='static',
 primary_sprite_factory=animation.factory({frames={'default_first','default_second'}})}})`, `
 {member_id='default',definition_id='actor'},
 {member_id='override',definition_id='actor',options={primary_sprite_factory=animation.factory({frames={'own_first','own_second'}})}},
 {member_id='unknown',definition_id='actor',options={primary_sprite_factory=custom}},`);
	assert.deepEqual(f.images(), ['default_first', 'own_first']);
});

test('factory aliases and reexports retain callable provenance without admitting similarly named custom factories', t => {
	const f = fixture(t, `local bridge=require('animation_bridge')
local factory=bridge.factory
local stored=factory({frames={'aliased_first','aliased_second'}})
local custom={factory=function() return function() end end}
prefab.define({def_id='actor',class=object,components={stored,bridge.factory({frames={'direct_first'}}),custom.factory({frames={'guessed'}})}})`,
		undefined, [['animation_bridge.lua', "return require('cartlib/component/sprite_animation_component')"]]);
	assert.deepEqual(f.images(), ['aliased_first', 'direct_first']);
});

for (const replacement of [
	'animation.factory=function(definition) return function(owner) end end',
	'animation[key()]=function(definition) return function(owner) end end',
]) test(`unproved animation factory replacement grants no initial-frame correspondence: ${replacement}`, t => {
	const f = fixture(t, `${replacement}
prefab.define({def_id='actor',class=object,components={animation.factory({frames={'unproved'},imgid='not_a_fallback'})}})`);
	assert.deepEqual(f.images(), []); assert.equal(f.model.canUndo, false);
});

for (const initializer of ['function actor.initialize(self) end', 'actor.initialize=unknown_initializer'])
	test(`an unproved implicit initializer does not hide independent explicit animation components: ${initializer}`, t => {
		const f = fixture(t, `local actor=setmetatable({primary_sprite_factory=animation.factory({frames={'implicit'}})}, {__index=sprite_object})
${initializer}
prefab.define({def_id='actor',class=actor,components={animation.factory({frames={'explicit'}})}})`);
		assert.deepEqual(f.images(), ['explicit']);
	});

for (const configuration of [
	"frames={}", "frames=unknown_frames", "frames={choose(),'later'}", "frames={'first',choose()}",
	"animation='missing',animations={idle={frames={'first'}}}",
	"animations={idle={frames={'first'}}}",
	"animation=choose(),animations={idle={frames={'first'}}}",
	"animation='idle',animations={idle={frames={'first'}},other={frames={choose()}}}",
]) test(`unproved eager animation admission stays source-only without an imgid fallback: ${configuration}`, t => {
	const f = fixture(t, `local actor=setmetatable({primary_sprite_factory=animation.factory({${configuration},imgid='not_a_fallback'})}, {__index=sprite_object})
prefab.define({def_id='actor',class=actor})`, "{member_id='actor',definition_id='actor',options={animation='idle',imgid='also_not_a_fallback'}}");
	assert.deepEqual(f.images(), []); assert.equal(f.model.buffer.getText(), f.source); assert.equal(f.model.canUndo, false);
});

test('mutated captured frame tables do not become immutable initial-frame declarations', t => {
	const f = fixture(t, `local frames={'before','later'}; frames[1]='after'
prefab.define({def_id='actor',class=object,components={animation.factory({frames=frames,imgid='not_a_fallback'})}})`);
	assert.deepEqual(f.images(), []); assert.equal(f.model.canUndo, false);
});

test('ordinary source edits and exact Undo replace named initial-frame selection without mutating old projections', t => {
	const f = fixture(t, `local actor=setmetatable({primary_sprite_factory=${SCENE_NAMED_ANIMATION}}, {__index=sprite_object})
prefab.define({def_id='actor',class=actor})`, "{member_id='actor',definition_id='actor',options={animation='run'}}");
	assert.deepEqual(f.images(), ['run_first']); const before = f.context.visualScene!;
	const offset = f.source.indexOf("animation='run'") + "animation='".length;
	f.model.pushEditOperations([{ offset, deleteLength: 3, text: 'idle' }]);
	assert.deepEqual(f.images(), ['idle_first']); assert.ok(f.context.visualScene !== before);
	assert.ok(before.canvas[0].kind === 'sprite'); assert.equal(before.canvas[0].image, 'run_first');
	f.model.undo(); assert.deepEqual(f.images(), ['run_first']);
	assert.equal(f.model.buffer.getText(), f.source); assert.equal(f.model.canUndo, false);
});

test('dependency edits replace frames once, retain old reads and retire captured Add authority', t => {
	const f = fixture(t, `local actor=setmetatable({primary_sprite_factory=animation.factory({frames={'before','later'}})}, {__index=sprite_object})
prefab.define({def_id='actor',class=actor})`);
	assert.deepEqual(f.images(), ['before']); const before = f.context.visualScene!;
	const request = f.context.captureAddMember('2d')!, choice = request.choices[0], preview = request.getPreview(choice)!;
	const offset = f.prefabs.buffer.getText().indexOf('before');
	f.prefabs.pushEditOperations([{ offset, deleteLength: 6, text: 'after' }]);
	assert.equal(request.getPreview(choice), undefined); assert.equal(request.isCurrent(), false);
	assert.deepEqual(f.images(), ['after']); const after = f.context.visualScene!;
	assert.ok(after !== before && after.canvas[0].entry === before.canvas[0].entry);
	assert.ok(before.canvas[0].kind === 'sprite' && preview.visuals.canvas[0].kind === 'sprite');
	assert.equal(before.canvas[0].image, 'before'); assert.equal(preview.visuals.canvas[0].image, 'before');
	f.prefabs.undo(); assert.deepEqual(f.images(), ['before']);
	assert.equal(f.model.buffer.getText(), f.source); assert.equal(f.model.canUndo, false);
});

test('idle source and Add reads retain animation output without rediscovering factories', t => {
	const f = fixture(t, `local actor=setmetatable({primary_sprite_factory=animation.factory({frames={'first','second'}})}, {__index=sprite_object})
prefab.define({def_id='actor',class=actor})`);
	assert.deepEqual(f.images(), ['first']); const read = f.context.visualScene!;
	const request = f.context.captureAddMember('2d')!, choice = request.choices[0], preview = request.getPreview(choice)!;
	const calls = t.mock.method(LuaSourceReader.prototype, 'call');
	for (let frame = 0; frame < 100; frame++) {
		assert.ok(f.context.visualScene === read); assert.ok(request.getPreview(choice) === preview);
	}
	assert.equal(calls.mock.callCount(), 0); assert.equal(f.model.canUndo, false);
});

test('Add uses the same initial animation frame as the real appended occurrence and ordinary Undo removes it', t => {
	const f = fixture(t, `local actor=setmetatable({primary_sprite_factory=${SCENE_NAMED_ANIMATION}}, {__index=sprite_object})
prefab.define({def_id='actor',class=actor})`, '');
	const request = f.context.captureAddMember('2d')!, choice = request.choices[0], preview = request.getPreview(choice)!;
	assert.deepEqual(preview.visuals.canvas.filter(visual => visual.kind === 'sprite').map(visual => visual.image), ['idle_first']);
	assert.equal(request.apply(choice, 12, -7, 0), true);
	const selected = f.context.selection!; assert.ok(selected.kind === 'member');
	assert.deepEqual(f.images(), ['idle_first']); assert.ok(f.context.visualScene!.canvas[0].entry === selected.entry);
	assert.equal(request.getPreview(choice), undefined); assert.equal(f.model.canUndo, true);
	f.model.undo(); assert.deepEqual(f.images(), []); assert.equal(f.model.buffer.getText(), f.source); assert.equal(f.model.canUndo, false);
});
