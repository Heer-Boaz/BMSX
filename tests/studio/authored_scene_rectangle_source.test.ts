import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test, { type TestContext } from 'node:test';
import { LuaSourceReader } from '../../ide/language/lua/source_reader';
import { SceneAuthoringContext } from '../../ide/workbench/contrib/scene_editor/authoring_context';
import { resolveLuaTextFileModel } from '../../ide/workbench/services/working_copy/text_file_model';
import { createSceneSourceFixture } from '../helpers/scene_sources';

const IMPORTS = `local prefab=require('cartlib/world/prefab')
local rectangles=require('cartlib/component/rectangle_component')
local sprites=require('cartlib/component/sprite_component')
local object=require('cartlib/world/object_2d')
`;

function fixture(t: TestContext, definitions: string, members: string, providers: readonly (readonly [string, string])[] = []) {
	const source = `local scenes=require('cartlib/world/scene_library')
scenes.register('main',{objects={${members}}})`;
	const f = createSceneSourceFixture(t, source, 'scene.lua', undefined, [
		['cartlib/world/prefab.lua', 'return {define=function() end}'],
		['cartlib/component/rectangle_component.lua', readFileSync('cartlib/component/rectangle_component.lua', 'utf8')],
		['cartlib/component/sprite_component.lua', 'return {new=function() end,factory=function() end}'],
		['prefabs.lua', IMPORTS + definitions], ...providers,
	]);
	const document = f.documents.get(f.model), context = new SceneAuthoringContext(f.model, f.documents,
		{ document, scene: document.scenes[0], sourceVersion: f.model.version });
	t.after(() => context.dispose());
	return { ...f, context, source };
}

test('rectangle forwarding consumes concrete owner inputs without the implicit primary Sprite gate', t => {
	const f = fixture(t, `
prefab.define({def_id='root',class=object})
prefab.define({def_id='rectangle',class=object,
 defaults={width=20,height=30,color=0x00123456,order=2,visible=false,
  attachment_affine={1,1,0,1,2,3},presentation_affine={-1,0,2,1,4,5}},
 components={function(owner) return rectangles.new(owner,owner) end}})`, `
 {member_id='child',definition_id='rectangle',parent='parent',position={x=4,y=5},
  options={width=-7,height=0,color=nil,visible=0,presentation_order=3,primary_sprite_factory=false}},
 {member_id='parent',definition_id='root',transform={xx=2,xy=0,yx=1,yy=3,ox=10,oy=20}}`);
	const read = f.context.visualScene!, rectangle = read.canvas[0];
	assert.equal(read.canvas.length, 1); assert.equal(read.models.length, 0);
	assert.ok(rectangle.kind === 'rectangle');
	assert.equal(rectangle.entry, f.context.subject!.objects[0]);
	assert.equal(rectangle.world, f.context.spatialScene!.worlds.get(rectangle.entry));
	assert.equal(rectangle.width, -7); assert.equal(rectangle.height, 0);
	assert.equal(rectangle.color, 0xff123456); assert.equal(rectangle.order, 5);
	assert.deepEqual(rectangle.attachment, { family: '2d', xx: 1, xy: 1, yx: 0, yy: 1, ox: 2, oy: 3 });
	assert.deepEqual(rectangle.presentation, { family: '2d', xx: -1, xy: 0, yx: 2, yy: 1, ox: 4, oy: 5 });
	assert.equal(f.context.selection, undefined); assert.equal(f.model.buffer.getText(), f.source); assert.equal(f.model.canUndo, false);
});

test('direct rectangle new receives nil config; aliases and trivial literal-config wrappers retain exact builtin identity', t => {
	const f = fixture(t, `
local bridge=require('rectangle_bridge')
local new=bridge.new
local forward=function(owner) return new(owner,{width=8,height=9,color=0x10345678},'panel') end
prefab.define({def_id='rectangle',class=object,defaults={width=200,height=300,color=0xffffff},
 components={rectangles.new,new,function(owner) return new(owner) end,forward,
 function(owner) return bridge.new(owner,{width=0,height=-2,color=0}) end}})`,
		`{member_id='source',definition_id='rectangle'}`, [
			['rectangle_bridge.lua', "return require('cartlib/component/rectangle_component')"],
		]);
	assert.deepEqual(f.context.visualScene!.canvas.map(visual => {
		assert.ok(visual.kind === 'rectangle'); return [visual.width, visual.height, visual.color];
	}), [[8, 9, 0xff345678], [0, -2, 0xff000000]]);
});

test('rectangle width height and color are required raw inputs, not fabricated zero or white defaults', t => {
	const f = fixture(t, `
prefab.define({def_id='rectangle',class=object,components={function(owner) return rectangles.new(owner,owner) end}})`, `
 {member_id='missing_all',definition_id='rectangle'},
 {member_id='missing_width',definition_id='rectangle',options={height=2,color=3}},
 {member_id='missing_height',definition_id='rectangle',options={width=1,color=3}},
 {member_id='missing_color',definition_id='rectangle',options={width=1,height=2}},
 {member_id='false_width',definition_id='rectangle',options={width=false,height=2,color=3}},
 {member_id='false_color',definition_id='rectangle',options={width=1,height=2,color=false}},
 {member_id='unknown_height',definition_id='rectangle',options={width=1,height=choose(),color=3}},
 {member_id='zero',definition_id='rectangle',options={width=0,height=0,color=0}}`);
	const canvas = f.context.visualScene!.canvas;
	assert.deepEqual(canvas.map(visual => f.context.subject!.objects.indexOf(visual.entry)), [7]);
	assert.ok(canvas[0].kind === 'rectangle'); assert.equal(canvas[0].width, 0); assert.equal(canvas[0].height, 0);
});

test('owner-forwarding rectangles follow actual component flags, Lua truthiness and nil-only owner defaults', t => {
	const f = fixture(t, `
prefab.define({def_id='rectangle',class=object,defaults={width=4,height=5,color=0x123456,order=8,
 attachment_affine={2,0,0,3,4,5}},components={function(owner) return rectangles.new(owner,owner) end}})`, `
 {member_id='disabled',definition_id='rectangle',options={enabled=false}},
 {member_id='hidden',definition_id='rectangle',options={visible=false}},
 {member_id='unknown',definition_id='rectangle',options={enabled=choose()}},
 {member_id='truthy',definition_id='rectangle',options={enabled=0,visible='',order=false,
  presentation_order=false,attachment_affine=false,presentation_affine=false}},
 {member_id='nil',definition_id='rectangle',options={width=nil,color=nil}}`);
	const canvas = f.context.visualScene!.canvas;
	assert.deepEqual(canvas.map(visual => f.context.subject!.objects.indexOf(visual.entry)), [3, 4]);
	assert.equal(canvas[0].order, 0); assert.equal(canvas[1].order, 8);
	assert.deepEqual(canvas[0].attachment, { family: '2d', xx: 1, xy: 0, yx: 0, yy: 1, ox: 0, oy: 0 });
});

test('one canvas order interleaves sprite and rectangle construction stably across the parent-ready sequence', t => {
	const f = fixture(t, `
prefab.define({def_id='mixed',class=object,defaults={width=4,height=5,color=0x123456},components={
 sprites.factory({imgid='first'}),function(owner) return rectangles.new(owner,owner) end,
 sprites.factory({imgid='last'}),function(owner) return rectangles.new(owner,{width=6,height=7,color=1,order=-1}) end}})`, `
 {member_id='child',definition_id='mixed',parent='parent'},
 {member_id='free',definition_id='mixed'},
 {member_id='parent',definition_id='mixed'}`);
	const canvas = f.context.visualScene!.canvas, scene = f.context.subject!;
	assert.deepEqual(canvas.map(visual => [scene.objects.indexOf(visual.entry), visual.kind, visual.order]), [
		[1, 'rectangle', -1], [2, 'rectangle', -1], [0, 'rectangle', -1],
		[1, 'sprite', 0], [1, 'rectangle', 0], [1, 'sprite', 0],
		[2, 'sprite', 0], [2, 'rectangle', 0], [2, 'sprite', 0],
		[0, 'sprite', 0], [0, 'rectangle', 0], [0, 'sprite', 0],
	]);
});

test('owner configuration reads the captured ordinary class lineage after nil-only options and defaults', t => {
	const f = fixture(t, `
local parent=setmetatable({width=4,height=5,color=0x123456,enabled=false,
 attachment_affine={2,0,0,3,4,5}},{__index=object})
local child=setmetatable({height=6},{__index=parent})
prefab.define({def_id='rectangle',class=child,defaults={width=7},
 components={function(owner) return rectangles.new(owner,owner) end}})`, `
 {member_id='class_disabled',definition_id='rectangle'},
 {member_id='shown',definition_id='rectangle',options={enabled=true,width=nil}},
 {member_id='replaced',definition_id='rectangle',options={enabled=true,width=0,attachment_affine=false}}`);
	const canvas = f.context.visualScene!.canvas;
	assert.deepEqual(canvas.map(visual => f.context.subject!.objects.indexOf(visual.entry)), [1, 2]);
	assert.ok(canvas[0].kind === 'rectangle' && canvas[1].kind === 'rectangle');
	assert.equal(canvas[0].width, 7); assert.equal(canvas[0].height, 6); assert.equal(canvas[1].width, 0);
	assert.deepEqual(canvas[0].attachment, { family: '2d', xx: 2, xy: 0, yx: 0, yy: 3, ox: 4, oy: 5 });
	assert.deepEqual(canvas[1].attachment, { family: '2d', xx: 1, xy: 0, yx: 0, yy: 1, ox: 0, oy: 0 });
});

test('forwarding proof refuses arbitrary bodies, unknown calls, different owners and mutated config', t => {
	const f = fixture(t, `
local config={width=1,height=2,color=3}
config.width=9
local custom={new=function() end}
prefab.define({def_id='rectangle',class=object,defaults={width=1,height=2,color=3},components={
 function(owner) owner.width=1 return rectangles.new(owner,owner) end,
 function(owner) if choose() then return rectangles.new(owner,owner) end end,
 function(owner,extra) return rectangles.new(owner,owner) end,
 function(owner,...) return rectangles.new(owner,owner) end,
 function(owner) return rectangles.new(other,owner) end,
 function(owner) return custom.new(owner,owner) end,
 function(owner) return rectangles.new(owner,choose()) end,
 function(owner) return rectangles.new(owner,config) end,
 function(owner) return rectangles.new(owner,{width=1,height=2,color=3,unused=choose()}) end,
 function(owner) return rectangles.new(owner,owner,choose()) end,
 function(owner) return rectangles.new(owner,owner),other end}})`, `{member_id='source',definition_id='rectangle'}`);
	assert.deepEqual(f.context.visualScene!.canvas, []);
});

test('constructor replacement and ambiguous forwarding function writes revoke source correspondence', t => {
	for (const replacement of [
		'rectangles.new=function(owner,input) return {} end',
		'rectangles[key()]=function() end',
		'forward=function(owner) return {} end',
	]) {
		const f = fixture(t, `
local forward=function(owner) return rectangles.new(owner,owner) end
${replacement}
prefab.define({def_id='rectangle',class=object,defaults={width=1,height=2,color=3},components={forward}})`,
			`{member_id='source',definition_id='rectangle'}`);
		assert.deepEqual(f.context.visualScene!.canvas, []);
	}
});

test('an initializer makes later owner configuration unavailable in both Scene and Add preview', t => {
	const f = fixture(t, `
local actor=setmetatable({width=8,height=4,color=0x123456},{__index=object})
function actor:initialize() self.width=64 end
prefab.define({def_id='rectangle',class=actor,
 components={function(owner) return rectangles.new(owner,owner) end}})`, `{member_id='source',definition_id='rectangle'}`);
	assert.deepEqual(f.context.visualScene!.canvas, []);
	const request = f.context.captureAddMember('2d')!, choice = request.choices[0];
	assert.deepEqual(request.getPreview(choice)!.visuals.canvas, []);
});

test('an unknown earlier factory revokes later owner inputs but not an already proved construction prefix', t => {
	const f = fixture(t, `
local function change(owner) owner.width=64 return {} end
prefab.define({def_id='rectangle',class=object,defaults={width=8,height=4,color=0x123456},components={
 sprites.factory({imgid='prefix'}),rectangles.new,
 function(owner) return rectangles.new(owner,owner) end,change,
 function(owner) return rectangles.new(owner,owner) end}})`, `{member_id='source',definition_id='rectangle'}`);
	const canvas = f.context.visualScene!.canvas;
	assert.deepEqual(canvas.map(visual => visual.kind), ['sprite', 'rectangle']);
	assert.ok(canvas[1].kind === 'rectangle'); assert.equal(canvas[1].width, 8);
	const request = f.context.captureAddMember('2d')!, choice = request.choices[0];
	assert.deepEqual(request.getPreview(choice)!.visuals.canvas.map(({ entry, world, ...inputs }) => inputs),
		canvas.map(({ entry, world, ...inputs }) => inputs));
});

test('explicit literal configuration remains admitted after unknown initializer and factory owner effects', t => {
	const f = fixture(t, `
local actor=setmetatable({initialize=unknown_initializer},{__index=object})
prefab.define({def_id='rectangle',class=actor,defaults={width=8,height=4,color=0x123456},components={unknown_factory,
 function(owner) return rectangles.new(owner,owner) end,
 function(owner) return rectangles.new(owner,{width=12,height=6,color=0x654321}) end}})`, `{member_id='source',definition_id='rectangle'}`);
	const canvas = f.context.visualScene!.canvas;
	assert.equal(canvas.length, 1); assert.ok(canvas[0].kind === 'rectangle');
	assert.equal(canvas[0].width, 12); assert.equal(canvas[0].height, 6); assert.equal(canvas[0].color, 0xff654321);
	const request = f.context.captureAddMember('2d')!, choice = request.choices[0];
	assert.deepEqual(request.getPreview(choice)!.visuals.canvas.map(({ entry, world, ...inputs }) => inputs),
		canvas.map(({ entry, world, ...inputs }) => inputs));
});

test('rectangle Add preview and appended member share constructor inputs without changing source before admission', t => {
	const f = fixture(t, `
prefab.define({def_id='mixed',class=object,position={x=44,y=55},scale={x=-2,y=3},
 defaults={width=4,height=5,color=0x123456},components={
 sprites.factory({imgid='sprite',order=2}),function(owner) return rectangles.new(owner,owner) end}})`, '');
	const request = f.context.captureAddMember('2d')!, choice = request.choices[0], preview = request.getPreview(choice)!;
	assert.deepEqual(preview.visuals.canvas.map(visual => visual.kind), ['rectangle', 'sprite']);
	assert.deepEqual(preview.world, { family: '2d', xx: -2, xy: -0, yx: -0, yy: 3, ox: 0, oy: 0 });
	for (const visual of preview.visuals.canvas) { assert.equal(visual.entry, choice); assert.equal(visual.world, preview.world); }
	assert.equal(f.model.buffer.getText(), f.source); assert.equal(f.model.canUndo, false);
	assert.equal(request.apply(choice, 7, 8, 0), true);
	assert.deepEqual(f.context.visualScene!.canvas.map(({ entry, world, ...inputs }) => inputs),
		preview.visuals.canvas.map(({ entry, world, ...inputs }) => inputs));
	for (const visual of f.context.visualScene!.canvas) assert.deepEqual(visual.world, { ...preview.world, ox: 7, oy: 8 });
	f.model.undo(); assert.equal(f.model.buffer.getText(), f.source); assert.equal(f.model.canUndo, false);
});

test('rectangle source generations retain admitted records and invalidate dependent previews on provider edits', t => {
	const f = fixture(t, `
prefab.define({def_id='rectangle',class=object,defaults={width=4,height=5,color=0x123456},
 components={function(owner) return rectangles.new(owner,owner) end}})`, `{member_id='source',definition_id='rectangle'}`);
	const before = f.context.visualScene!, request = f.context.captureAddMember('2d')!, preview = request.getPreview(request.choices[0]);
	const reads = t.mock.method(LuaSourceReader.prototype, 'callable');
	for (let frame = 0; frame < 100; frame++) {
		assert.equal(f.context.visualScene, before); assert.equal(request.getPreview(request.choices[0]), preview);
	}
	assert.equal(reads.mock.callCount(), 0); reads.mock.restore();
	const resource = f.sources.catalog.resolveResource({ contextId: f.resource.contextId, path: 'prefabs.lua' })!;
	const provider = resolveLuaTextFileModel(f.models, f.sources.catalog, resource), text = provider.buffer.getText();
	provider.pushEditOperations([{ offset: text.indexOf('width=4'), deleteLength: 7, text: 'width=9' }]);
	f.context.refresh(); const after = f.context.visualScene!;
	assert.notEqual(after, before); assert.ok(before.canvas[0].kind === 'rectangle' && after.canvas[0].kind === 'rectangle');
	assert.equal(before.canvas[0].width, 4); assert.equal(after.canvas[0].width, 9);
	assert.equal(before.canvas[0].entry, after.canvas[0].entry); assert.equal(request.getPreview(request.choices[0]), undefined);
	assert.equal(f.model.buffer.getText(), f.source); assert.equal(f.model.canUndo, false);
	f.context.dispose(); assert.equal(f.context.visualScene, undefined);
});
