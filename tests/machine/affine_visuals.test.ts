import { valuePayload } from '../../machine/ts/machine/cpu/value';
import { valueBool, asClosure, valueNil, asStringId } from '../../machine/ts/machine/cpu/value';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { profileWarmGuestKernel } from '../helpers/guest_kernel';
import { createCartlibCaseRom, createCartlibProgramHarness } from '../helpers/cartlib_cpu';
import { WORLD_CPU_MODULES, WORLD_CPU_SETUP } from '../helpers/world_cpu';
import { materializeCpuCompletionValues, runGuestToHalt } from '../helpers/cpu_test_harness';

const checks = `local assertion_failed
local assert<const> = function(condition, message)
 if not condition and assertion_failed == nil then assertion_failed = message end
end
`;

const modules = [
	...WORLD_CPU_MODULES,
	...[
		'cartlib/component/visual_component', 'cartlib/component/visual_2d_component',
		'cartlib/component/sprite_component', 'cartlib/component/custom_visual_component',
		'cartlib/component/sprite_animation_component',
		'cartlib/component/surface_component', 'cartlib/component/tile_strip_component',
		'cartlib/component/rectangle_component', 'cartlib/sprite',
		'cartlib/component/tile_layer_component', 'cartlib/component/tile_layer_row',
		'cartlib/gx/image', 'cartlib/gx/atlas', 'cartlib/gx/imgdec', 'cartlib/gx/affine_batch',
	].map(path => ({ path, source: readFileSync(`${path}.lua`, 'utf8') })),
	{ path: 'stage_tiles_component', source: readFileSync('carts/nemesis_s/stage_tiles_component.lua', 'utf8') },
	{
		path: 'cartlib/rom_dir',
		source: `local images<const> = {
 tile={imgmeta={width=2,height=3,gx_source_x=64,gx_source_y=32}},
 other={imgmeta={width=3,height=2,gx_source_x=68,gx_source_y=32}},
 tile_a={imgmeta={width=8,height=8,gx_source_x=64,gx_source_y=32}},
 tile_b={imgmeta={width=8,height=8,gx_source_x=72,gx_source_y=32}},
 tile_c={imgmeta={width=8,height=8,gx_source_x=256,gx_source_y=32}},
 surface={imgmeta={width=4,height=3,gx_source_x=64,gx_source_y=32,
  gx_page_tiles={{u=64,v=32,w=2,h=3,x=0,y=0},{u=66,v=32,w=2,h=3,x=2,y=0}}}},
}
return { image=function(id) return images[id] end }`,
	},
];

const optLevel = 3;
const rom = createCartlibCaseRom('', { optLevel, modules });

const spriteDefaults = rom.add(WORLD_CPU_SETUP + `
world:start()

local sprite<const> = require('cartlib/component/sprite_component')
local animation<const> = require('cartlib/component/sprite_animation_component')
local sprite_object<const> = require('cartlib/sprite')
local profile<const> = {imgid='tile',order=0,flip_h=false,visible=false}
local factory<const> = sprite.factory(profile)
profile.imgid='other'
local static_class<const> = {primary_sprite_factory=factory}
prefab.define({def_id='primary.static',
 class=setmetatable(static_class, {__index=sprite_object})})
local first<const> = world:spawn('primary.static',{})
local second<const> = world:spawn('primary.static',{})
assert(first.sprite_component.owner==first and second.sprite_component.owner==second
 and first.sprite_component~=second.sprite_component and first.sprite_component.imgid=='tile'
 and first.sprite_component.order==0 and first.sprite_component.flip_h==false
 and first.sprite_component.visible==false and second.sprite_component.visible==false,
 'primary construction changed the bound static profile or its independent flags')
prefab.define({def_id='primary.plain',
 class=sprite_object,
 defaults={imgid='tile',order=7,color=0xff123456,region={x=0,y=0,width=1,height=1},attachment_affine={1,0,0,1,9,12}},
 position={x=30,y=40}})
local plain<const> = world:spawn('primary.plain',{visible=false,enabled=false,imgid='other',
 order=false,color=false,presentation_order=4,region=false,attachment_affine=false})
local visual<const> = plain.sprite_component
visual:resolve_pose()
assert(visual.visible and visual.enabled and visual.imgid=='other' and visual.wox==30 and visual.woy==40
 and visual.attachment_ox==0 and visual.attachment_oy==0 and visual.region==nil
 and visual.order==0 and visual.color==0xffffffff and visual.presentation_order==4,
 'primary component inherited whole-object flags or treated object placement as visual-local')
plain.visible=true
assert(visual.visible and visual.enabled,'showing an owner could not reveal its independently enabled primary visual')
local frames<const> = {'tile','other'}
prefab.define({def_id='primary.sequence',
 class=setmetatable({primary_sprite_factory=animation.factory({frames=frames,frame_duration_ms=20})}, {__index=sprite_object})})
local sequence<const> = world:spawn('primary.sequence',{imgid='other'}).sprite_component
assert(sequence.imgid=='tile' and sequence.frames==frames,
 'ordinary owner imgid replaced the admitted animation first frame or copied its shared frame source')
prefab.define({def_id='primary.named',
 class=setmetatable({primary_sprite_factory=animation.factory({animation='idle',animations={
 idle={frames={'tile'},frame_duration_ms=20},active={frames={'other'},frame_duration_ms=20}}})}, {__index=sprite_object})})
local named<const> = world:spawn('primary.named',{animation='active',imgid='tile'}).sprite_component
assert(named.animation=='active' and named.imgid=='other',
 'ordinary named-animation selection did not use the admitted animation owner')
return true
`);
test(`Primary Sprite keeps owner visibility, static profiles and animation selection at their real owners (O${optLevel})`, () => {
	const cpu = rom.run(spriteDefaults);
	assert.deepEqual(materializeCpuCompletionValues(cpu), [valueBool(true)]);
});

const sceneVisualDefaults = rom.add(WORLD_CPU_SETUP + `
world:start()

local sprite<const> = require('cartlib/component/sprite_component')
local sprite_object<const> = require('cartlib/sprite')
prefab.define({def_id='visual.defaults',
 class=setmetatable(sprite_object, {__index=object_2d}),
 defaults={imgid='tile',order=7,attachment_affine={1,0,0,1,2,3}},
 position={x=9,y=12}})
prefab.define({def_id='visual.neutral',
 class=setmetatable(sprite_object, {__index=object_2d}),
 defaults={imgid='tile'}})
scenes.register('visual.defaults',{objects={
 {member_id='inherited',definition_id='visual.defaults'},
 {member_id='neutral',definition_id='visual.neutral'},
 {member_id='explicit',definition_id='visual.defaults',position={x=0,y=0},
  options={order=0,attachment_affine={1,0,0,1,0,0}}},
}})
local instance<const> = scenes.instantiate('visual.defaults')
local inherited<const>, neutral<const>, explicit<const> = instance.members.inherited, instance.members.neutral, instance.members.explicit
local iv<const>, nv<const>, ev<const> = inherited:get_component(sprite),neutral:get_component(sprite),explicit:get_component(sprite)
assert(inherited.ox==9 and inherited.oy==12 and iv.order==7
 and iv.attachment_ox==2 and iv.attachment_oy==3 and iv.imgid=='tile',
 'omitting Scene overrides lost actual prefab placement or visual inputs')
assert(neutral.ox==0 and neutral.oy==0 and nv.order==0
 and nv.attachment_xx==1 and nv.attachment_yy==1 and nv.attachment_ox==0 and nv.attachment_oy==0,
 'neutral Scene member required duplicated identity or zero-order declarations')
assert(explicit.ox==0 and explicit.oy==0 and ev.order==0
 and ev.attachment_ox==0 and ev.attachment_oy==0 and ev.imgid=='tile',
 'explicit zero and identity overrides were confused with omitted defaults')
inherited:set_position(30,40)
local second<const> = scenes.instantiate('visual.defaults')
assert(second.members.inherited.ox==9 and second.members.inherited.oy==12,
 'instance writes mutated the shared prefab placement')
return true
`);
test(`Scene members inherit prefab placement and visual defaults unless explicitly overridden (O${optLevel})`, () => {
	const cpu = rom.run(sceneVisualDefaults);
	assert.deepEqual(materializeCpuCompletionValues(cpu), [valueBool(true)]);
});

const compositeDraw = rom.add(WORLD_CPU_SETUP + `
world:start()

local sprite<const> = require('cartlib/component/sprite_component')
local commands<const> = require('cartlib/gx/command_list')
local gp0<const> = require('cartlib/gx/gp0')
local layered<const> = setmetatable({}, {__index=sprite})
layered.__index=layered
function layered:draw_visual(draw)
 draw:rect(0,0,1,1,0xff204080)
 sprite.draw_visual(self,draw)
end
prefab.define({def_id='visual.layered',
 class=object_2d,
 components={function(owner)
  local part<const> = sprite.new(owner,{imgid='tile'},'sprite')
  setmetatable(part,layered)
  part:set_draw_function(layered.draw_visual)
  return part
 end},
 position={x=10,y=20}})
local actor<const> = world:spawn('visual.layered',{})
local part<const> = actor:get_component(sprite)
part:set_imgid('other')
assert(part.draw==layered.draw_visual and part.source_width==3 and part.source_height==2,
 'source admission discarded the concrete composite producer')
bss words: word[32]
local draw<const> = commands.new(words,32)
commands.begin(draw,0x100,0)
part.draw(part,draw)
local output<const>: *word = words
assert(output[1]==(gp0.draw_rectangle | gp0.argb_to_rgb(0xff204080)),
 'renderer lost the composite layer after changing the image')
part:set_region(0,0,1,1)
assert(part.draw==sprite.draw_region_visual)
part:clear_region()
assert(part.draw==layered.draw_visual,'clearing a region discarded the concrete producer')
return true
`);
test(`Sprite source changes preserve the concrete composite draw producer (O${optLevel})`, () => {
	const cpu = rom.run(compositeDraw);
	assert.deepEqual(materializeCpuCompletionValues(cpu), [valueBool(true)]);
});

const rectangleAffine = rom.add(WORLD_CPU_SETUP + `
world:start()

local rectangle<const> = require('cartlib/component/rectangle_component')
local commands<const> = require('cartlib/gx/command_list')
local gp0<const> = require('cartlib/gx/gp0')
prefab.define({def_id='rectangle.actor',
 class=object_2d,
 components={function(owner) return rectangle.new(owner,{
 width=2,height=3,color=0xff204080,attachment_affine={2,0,0,1,1,2},
 presentation_affine={1,0,0,1,3,4}}) end},
 transform={xx=0,xy=2,yx=-3,yy=0,ox=10,oy=20}})
local actor<const> = world:spawn('rectangle.actor',{})
local part<const> = actor:get_component(rectangle)
bss words: word[32]
local draw<const> = commands.new(words,32)
commands.begin(draw,0x100,0)
part:draw_rectangle(draw)
local output<const>: *word = words
-- Native packet coordinates are the actual geometry-producer contract here,
-- not incidental UI layout. The whole local rectangle keeps its exact affine.
assert(part.width==2 and part.height==3 and actor.x==nil and actor.sx==nil)
assert(output[1]==(gp0.draw_quad | gp0.argb_to_rgb(part.color))
 and output[2]==gp0.pair16(-8,34) and output[3]==gp0.pair16(-8,42)
 and output[4]==gp0.pair16(-17,34) and output[5]==gp0.pair16(-17,42))
part.width,part.height=4,2
part:set_presentation_origin(0,0)
commands.begin(draw,0x100,0)
part:draw_rectangle(draw)
assert(output[2]==gp0.pair16(4,22) and output[3]==gp0.pair16(4,38)
 and output[4]==gp0.pair16(-2,22) and output[5]==gp0.pair16(-2,38)
 and actor.wox==10 and actor.woy==20)
kernel=function(count)
 for index=1,count do
  part:set_presentation_origin(index & 7,0)
  commands.begin(draw,0x100,0)
  part:draw_rectangle(draw)
 end
end
return true
`);
test(`Rectangle geometry owns its dimensions and composes the retained visual affine (O${optLevel})`, t => {
	const cpu = rom.run(rectangleAffine);
	assert.deepEqual(materializeCpuCompletionValues(cpu), [valueBool(true)]);
	const kernel = asClosure(cpu.getGlobalByKey(cpu.stringPool.find('kernel')!), cpu.gc);
	const profile = profileWarmGuestKernel(cpu, kernel, 256);
	assert.equal(profile.reservations, 0);
	assert.equal(profile.reservedBytes, 0);
	assert.equal(profile.retainedAfter, profile.retainedBefore);
	t.diagnostic(JSON.stringify({ optLevel, ...profile }));
});

const visualPlacement = rom.add(checks + WORLD_CPU_SETUP + `
world:start()

local sprite<const> = require('cartlib/component/sprite_component')
local visual<const> = require('cartlib/component/visual_component')
local custom<const> = require('cartlib/component/custom_visual_component')
prefab.define({def_id='visual.parent',
 class=object_2d,
 transform={xx=0,xy=2,yx=-3,yy=0,ox=10,oy=20}})
prefab.define({def_id='visual.child',
 class=object_2d,
 components={sprite.factory({imgid='tile',
 attachment_affine={2,0,0,1,1,2},presentation_affine={1,0,0,1,3,4}})},
 transform={xx=1,xy=0,yx=1,yy=1,ox=4,oy=5}})
local parent<const> = world:spawn('visual.parent', {})
local child<const> = world:spawn('visual.child',{parent=parent})
local part<const> = child:get_component(sprite)
part:resolve_pose()
assert(part.wxx==0 and part.wxy==4 and part.wyx==-3 and part.wyy==2
 and part.wox==-23 and part.woy==54,'visual composed the three owners in a different order')
assert(child.wox==-5 and child.woy==28
 and child.x==nil and child.y==nil and part.offset_x==nil,'presentation became a second object pose')
local basis<const> = part._visual_basis_revision
part:set_presentation_origin(5,6)
part:resolve_pose()
assert(part._visual_basis_revision==basis and part.wox==-29 and part.woy==66,
 'presentation translation rebuilt the basis or missed the affine')
parent:set_position(100,200)
part:resolve_pose()
assert(part._visual_basis_revision==basis and part.wox==61 and part.woy==246,
 'ancestor translation rebuilt the visual basis')
local physical<const> = child._origin_revision
part:set_order(9)
part:set_presentation_order(-2)
assert(part.order==9 and part.presentation_order==-2 and child._origin_revision==physical,
 'render ordering invalidated physical pose')
prefab.define({def_id='visual.nonspatial',
 class=world_object,
 components={custom.factory({draw=function() end})}})
local nonspatial<const> = world:spawn('visual.nonspatial', {})
assert(nonspatial._hierarchy==nil and nonspatial:get_component(visual)~=nil,
 'generic custom geometry fabricated a spatial capability')
return assertion_failed
`);
test(`Visual placement composes physical, attachment and presentation without moving the object (O${optLevel})`, () => {
	const cpu = rom.run(visualPlacement);
	const [failure] = materializeCpuCompletionValues(cpu);
	assert.equal(failure, valueNil(), failure === valueNil() ? undefined : cpu.stringPool.toString(asStringId(failure)));
});

const gxBatch = rom.add(checks + `
local commands<const> = require('cartlib/gx/command_list')
local batch<const> = require('cartlib/gx/affine_batch')
local image<const> = require('cartlib/gx/image')
bss words: word[512]
local draw<const> = commands.new(words,512)
commands.begin(draw,0x100,0)
local source<const> = image.resolve('tile')
local surface<const> = image.resolve('surface')
batch.offset_span(draw,surface._tiles, 0,2,-3,1, 10,20, 0xffffffff)
local output<const>: *word = words
assert(draw.word_count==19 and output[1]==0x2d808080
 and output[2]==0x0014000a and output[4]==0x0018000a
 and output[6]==0x00170001 and output[8]==0x001b0001,
 'first affine surface tile lost shear or native quad order')
assert(output[11]==0x0018000a and output[13]==0x001c000a
 and output[15]==0x001b0001 and output[17]==0x001f0001,
 'surface batch reconstructed or ignored source offsets')
assert(output[3]==source._quad_uv0 and output[5]==source._quad_uv1
 and output[7]==source._quad_uv2 and output[9]==source._quad_uv3,
 'affine packet changed admitted image addressing')
commands.begin(draw,0x100,0)
batch.repeated_image(draw,source,-1,1, 4,5, 1,1,-1,2, 10,20, 0xffffffff)
assert(draw.word_count==28 and output[2]==0x0006000b and output[11]==0x0014000a
 and output[20]==0x00220009,'strip endpoints were replaced with generated shadow positions')
commands.begin(draw,0x100,0)
local glyphs<const> = {source,source}
local offsets<const> = {0,4}
batch.glyph_span(draw,glyphs,offsets,1,2, -1,0,2,1, 10,20, 0xffffffff)
assert(output[2]==0x0014000a and output[11]==0x00140006,
 'glyph span ignored local x offsets under reflection')
commands.begin(draw,0x100,0)
local rows<const> = {{row_index=2,sources=glyphs,columns={3,5},first_visible_source=1,last_visible_source=2}}
batch.tile_layer(draw,rows,1,3,4, 0,1,-1,0, 10,20)
assert(output[2]==0x00140006 and output[11]==0x001c0006,
 'affine tile view failed to retain source columns or selected view origin')
commands.begin(draw,0x100,0)
draw.word_count=14
batch.glyph_span(draw,glyphs,offsets,1,1, 1,0,0,1, 0,0, 0xff204080)
assert(output[14]==0x2c402010 and draw.word_count==23,
 'dense textured quad added transport padding or lost modulation')
commands.begin(draw,0x100,0)
batch.glyph_rows(draw,glyphs,offsets,1,1,1, 0,1,-2,0,10,20,0xffffffff)
assert(output[2]==0x0014000a and output[4]==0x0016000a
 and output[6]==0x00140008 and output[8]==0x00160008
 and output[7]==0x2040 and output[9]==0x2041,
 'cropped glyph rows changed source addressing or retained the full source height')
commands.begin(draw,0x100,0)
batch.glyph_rect_span(draw,glyphs,offsets,1,1, 0,1,-2,0,10,20,0xff102030)
assert(draw.word_count==6 and output[1]==0x28302010 and output[2]==0x0014000a
 and output[3]==0x0016000a and output[4]==0x00140004 and output[5]==0x00160004,
 'glyph backgrounds lost the actual glyph geometry or raw color command')
commands.begin(draw,0x100,0)
batch.semitransparent_rect(draw,0,0,2,3,0,1,-2,0,10,20,0xff102030)
assert(output[1]==0x2a302010 and output[4]==0x00140004,
 'affine highlight lost its semitransparent primitive')
commands.begin(draw,0x100,0)
batch.semitransparent_rect(draw,1,2,3,4,1,0,0,1,5,6,0xff102030)
assert(draw.word_count==4 and output[1]==0x62302010 and output[2]==0x00080006 and output[3]==0x00020002,
 'ordinary highlights stopped using the native rectangle packet')
return assertion_failed
`);
test(`GX affine batches preserve source records and dense native packets (O${optLevel})`, () => {
	const cpu = rom.run(gxBatch);
	const [failure] = materializeCpuCompletionValues(cpu);
	assert.equal(failure, valueNil(), failure === valueNil() ? undefined : cpu.stringPool.toString(asStringId(failure)));
});

const tilePackets = rom.add(WORLD_CPU_SETUP + checks + `
bss words: word[64]
rodata tape: u16[8] = {1,1,2,2,3,1,4,2}
local commands<const> = require('cartlib/gx/command_list')
local gp0<const> = require('cartlib/gx/gp0')
local image<const> = require('cartlib/gx/image')
local tile_layer<const> = require('cartlib/component/tile_layer_component')
local stage_tiles<const> = require('stage_tiles_component')
local output<const>: *word = words
local draw<const> = commands.new(words,64)
world:start()
prefab.define({def_id='tiles',class=object_2d})
local owner<const> = world:spawn('tiles',{})
local tile_a<const>, tile_b<const>, tile_c<const> = image.resolve('tile_a'), image.resolve('tile_b'), image.resolve('tile_c')
local raw<const> = 0x65808080
local fixed<const> = 0x75808080
local base_offset<const> = gp0.drawing_offset_word(0,0)
local layer<const> = tile_layer.new(owner,{columns=129,tile_size=8})
layer:resize(129,129)
layer:set_tile(127,'tile_a')
layer:set_tile(129,'tile_b')
layer:set_visible_columns(127,3)
commands.begin(draw,tile_a._blit_draw_mode,0)
layer:draw_visual(draw)
assert(draw.word_count==12 and output[1]==gp0.drawing_offset_word(-1008,0)
 and output[2]==raw and output[3]==1008 and output[4]==0x2040 and output[5]==0x00080008
 and output[6]==gp0.drawing_offset_word(16,0)
 and output[7]==raw and output[8]==0 and output[9]==0x2048 and output[11]==base_offset,
 'sparse rows must preserve local positions and offsets across signed coordinate domains')

layer:replace_indexed_tiles({127},1,'other')
layer:set_tile(129,nil)
layer:set_visible_columns(127,1)
commands.begin(draw,tile_a._blit_draw_mode,0)
layer:draw_visual(draw)
assert(draw.word_count==7 and output[2]==raw and output[4]==0x2044 and output[5]==0x00020003,
 'animation and topology edits must retain an actual non-cell-sized source')
layer:set_tile(127,'tile_b')
commands.begin(draw,tile_a._blit_draw_mode,0)
layer:draw_visual(draw)
assert(draw.word_count==6 and output[2]==fixed and output[4]==0x2048,
 'replacing the last variable-size source must recover fixed GP0 packets')

-- A synthetic tape, not a game cart. Two retained slots wrap during scroll.
local stage<const> = stage_tiles.new(owner,{},'tape')
local art<const> = { resolve=function(_,index) if index==1 then return tile_a end return tile_b end }
stage:configure(5,1,8,art)
stage._rows[1].tape_address = tape
stage._rows[1].tape_count = 4
stage:set_visible_columns(1,2)
stage:set_visible_columns(2,2)
commands.begin(draw,tile_a._blit_draw_mode,0)
stage:draw_visual(draw)
assert(draw.word_count==9 and output[1]==gp0.drawing_offset_word(-8,0)
 and output[2]==fixed and output[3]==8 and output[4]==0x2048
 and output[5]==fixed and output[6]==16 and output[7]==0x2040 and output[8]==base_offset,
 'incremental scrolling must preserve the dense packet order over the ring wrap')
stage:set_tile_source(3,1,tile_c)
commands.begin(draw,tile_a._blit_draw_mode,0)
stage:draw_visual(draw)
assert(draw.word_count==12 and output[2]==raw and output[4]==0x2048
 and output[6]==(gp0.draw_mode | tile_c._blit_draw_mode)
 and output[7]==raw and output[9]==0x2000 and output[11]==base_offset,
 'an override must change the page and UV in the mirrored slot without reordering the row')
stage:set_tile_source(3,1,nil)
stage:set_visible_columns(1,2)
stage:set_visible_columns(3,3)
commands.begin(draw,tile_a._blit_draw_mode,0)
stage:draw_visual(draw)
assert(draw.word_count==9 and output[2]==fixed and output[3]==16 and output[4]==0x2040
 and output[5]==fixed and output[6]==24 and output[7]==0x2048,
 'reverse scrolling and resizing the ring must not keep an old source or a ghost sparse slot')
return assertion_failed
`);
test('GX tile packets track sparse and wrapped rows without changing visible order or drawing state', () => {
	const cpu = rom.run(tilePackets, 1_000_000);
	const [failure] = materializeCpuCompletionValues(cpu);
	assert.equal(failure, valueNil(), failure === valueNil() ? undefined : cpu.stringPool.toString(asStringId(failure)));
});

const tapePackets = rom.add(WORLD_CPU_SETUP + checks + `
bss original_words: word[64]
bss tape_words: word[64]
bss palette_uvs: word[4]
bss palette_modes: word[4]
rodata tape: u8[16] = {8,0,1,1,2,2,2,1,1,7,1,1,3,3,1,2}
rodata rows: word[3] = {0,8,9}
local commands<const> = require('cartlib/gx/command_list')
local gp0<const> = require('cartlib/gx/gp0')
local image<const> = require('cartlib/gx/image')
local layers<const> = require('cartlib/component/tile_layer_component')
local original<const> = commands.new(original_words,64)
local packed<const> = commands.new(tape_words,64)
local original_data<const>: *word = original_words
local packed_data<const>: *word = tape_words
local uvs<const>: *word = palette_uvs
local modes<const>: *word = palette_modes
local art<const> = {'tile_a','tile_b','tile_c'}
for ordinal=1,#art do
 local source<const> = image.resolve(art[ordinal])
 uvs[ordinal] = source._blit_uv_word
 modes[ordinal] = source._blit_draw_mode
end
world:start()
prefab.define({def_id='terrain',class=object_2d})
local owner<const> = world:spawn('terrain',{})
local layer<const> = layers.new(owner,{tile_size=8, attachment_affine={1,0,0,1,9,12}})
layer:resize(12,4)
layer:set_tile(1,'tile_a')
layer:set_tile(3,'tile_b')
layer:set_tile(4,'tile_a')
layer:set_tile(10,'tile_c')
layer:set_tile(12,'tile_b')
local target<const> = gp0.pair16(128,96)
commands.begin(original,modes[1],target)
commands.begin(packed,modes[1],target)
layer:draw_visual(original)
commands.fixed_tile_tape(packed,tape,rows,3,8,palette_modes,palette_uvs,9,12)
local old_index, new_index = 0, 0
while new_index < packed.word_count do
 local old_word<const> = original_data[old_index]
 local new_word<const> = packed_data[new_index]
 if new_word==0x75808080 and old_word==0x65808080 then
  assert(original_data[old_index+3]==0x00080008, 'only fixed 8x8 rectangles may use compact packets')
  assert(original_data[old_index+1]==packed_data[new_index+1] and original_data[old_index+2]==packed_data[new_index+2],
   'compact rectangle changed the position or source')
  old_index = old_index + 4
  new_index = new_index + 3
 else
  assert(new_word==old_word, 'tape reordered tiles or GPU state')
  old_index = old_index + 1
  new_index = new_index + 1
 end
end
assert(old_index==original.word_count and packed.draw_mode==original.draw_mode
 and packed.drawing_offset==original.drawing_offset,
 'tape did not preserve total coverage or subsequent draw state')
return assertion_failed
`);
test('fixed room tape preserves tile placement and live GPU state across holes and texture pages', () => {
	const cpu = rom.run(tapePackets, 1_000_000);
	const [failure] = materializeCpuCompletionValues(cpu);
	assert.equal(failure, valueNil(), failure === valueNil() ? undefined : cpu.stringPool.toString(asStringId(failure)));
});

test('A large image catalog keeps compact source records and both native format draw contracts', () => {
	const { cpu } = createCartlibProgramHarness(checks + `
local commands<const> = require('cartlib/gx/command_list')
local image<const> = require('cartlib/gx/image')
local blend<const> = require('cartlib/gx/gp0').draw_mode_blend_half
sources = {}
for index=1,1024 do sources[index]=image.resolve('catalog_'..index) end
assert(image.resolve('catalog_1')==sources[1], 'image lookup replaced a retained source')
local surface<const> = image.resolve('surface')
assert(surface.draw==nil and surface.draw_source_rect==nil
 and surface.draw_affine==nil and surface.draw_quad==nil,
 'split-surface parent acquired unsupported single-image operations')
bss words: word[64]
local draw<const> = commands.new(words,64)
local output<const>: *word = words
for format=1,2 do
 local source<const> = format==1 and sources[1] or image.resolve('palette')
 local uv<const> = format==1 and 0x2040 or 0x1810
 commands.begin(draw,source._blit_draw_mode,0)
 source:blit(draw,10,20)
 assert(draw.word_count==4 and output[1]==0x75808080
  and output[2]==0x0014000a and output[3]==uv,
  'fixed 8x8 source lost its admitted three-word blit')
 commands.begin(draw,source._blit_draw_mode,0)
 source:draw(draw,10,20,0xffffffff,0,blend)
 assert(draw.word_count==5 and output[1]==0x65808080
  and output[2]==0x0014000a and output[3]==uv and output[4]==0x00080008,
  'format draw lost its native rectangle or source addressing')
 commands.begin(draw,source._blit_draw_mode,0)
 source:draw_source_rect(draw,1,2,3,4,10,20,0xffffffff,0,blend)
 assert(draw.word_count==5 and output[3]==uv+0x201 and output[4]==0x00040003,
  'source-region draw lost its admitted texture origin')
 commands.begin(draw,source._blit_draw_mode,0)
 source:draw_affine(draw,10,20,8,0,0,8,1,0xffffffff,blend)
 assert(draw.word_count==10 and output[1]==0x2d808080
  and output[3]==uv+7 and (output[5]&0xffff)==uv
  and output[7]==uv+0x707 and output[9]==uv+0x700,
  'affine draw lost horizontal reflection or native quad addressing')
 commands.begin(draw,source._blit_draw_mode,0)
 source:draw_quad(draw,1,1,6,1,1,6,6,6,10,20,18,20,10,28,18,28,0xffffffff,blend)
 assert(draw.word_count==10 and output[3]==uv+0x101 and output[9]==uv+0x606
  and output[2]==0x0014000a and output[8]==0x001c0012,
  'explicit quad draw changed source coordinates or vertex order')
end
return assertion_failed
`, { optLevel: 3, modules: [...modules, {
		path: 'cartlib/rom_dir',
		source: `local ordinary<const> = {imgmeta={width=8,height=8,gx_source_x=64,gx_source_y=32}}
local palette<const> = {imgmeta={width=8,height=8,gx_atlas_id='palette',texture_u=16,texture_v=24}}
local surface<const> = {imgmeta={width=16,height=8,gx_source_x=64,gx_source_y=32,
 gx_page_tiles={{u=64,v=32,w=8,h=8,x=0,y=0},{u=72,v=32,w=8,h=8,x=8,y=0}}}}
local texture<const> = {addr=0,len=0,texturemeta={mode=0,word_width=32,height=64,
 texture_word_count=2048,clut_word_count=16}}
return {
 image=function(id)
  if id=='palette' then return palette end
  if id=='surface' then return surface end
  return ordinary
 end,
 texture=function() return texture end,
}`,
	}] });
	runGuestToHalt(cpu, 20_000_000);
	const [failure] = materializeCpuCompletionValues(cpu);
	assert.equal(failure, valueNil(), failure === valueNil() ? undefined : cpu.stringPool.toString(asStringId(failure)));
	const sources = valuePayload(cpu.getGlobalByKey(cpu.stringPool.find('sources')!));
	let sourceBytes = 0;
	for (let index = 1; index <= 1024; index += 1) sourceBytes += cpu.gc.tables.getTrackedHeapBytes(valuePayload(cpu.gc.tables.getInteger(sources, index)));
	// The thousand-image stage exhausted RAM with 672-byte source descriptors.
	// This is a retained-memory budget, independent of the sharing mechanism.
	assert.ok(sourceBytes < 400 * 1024, `image source descriptors retained ${sourceBytes} bytes`);
});

test('Retained affine image batches allocate nothing warm and preserve the native rectangle lane', t => {
	const { cpu } = createCartlibProgramHarness(`
local commands<const> = require('cartlib/gx/command_list')
local batch<const> = require('cartlib/gx/affine_batch')
local image<const> = require('cartlib/gx/image')
bss words: word[1024]
local draw<const> = commands.new(words,1024)
local tile<const> = image.resolve('tile')
local surface<const> = image.resolve('surface')
local glyphs<const> = {tile,tile,tile,tile}
local offsets<const> = {0,4,8,12}
probe = {
 translation=function(iterations)
  for index=1,iterations do
   commands.begin(draw,0x100,0)
   commands.blit_offset_span(draw,surface._tiles,index%7,0,0xffffffff)
   commands.blit_span(draw,glyphs,offsets,1,4,index%7,0,0xffffffff)
   for i=0,3 do tile:blit(draw,index%7+i*4,0) end
  end
  return draw.word_count
 end,
 affine=function(iterations)
  for index=1,iterations do
   commands.begin(draw,0x100,0)
   batch.offset_span(draw,surface._tiles,1,0.25,0.5,1,index%7,0,0xffffffff)
   batch.glyph_span(draw,glyphs,offsets,1,4,1,0.25,0.5,1,index%7,0,0xffffffff)
   batch.repeated_image(draw,tile,0,3,4,0,1,0.25,0.5,1,index%7,0,0xffffffff)
  end
  return draw.word_count
 end,
}
`, { optLevel: 3, modules });
	runGuestToHalt(cpu, 20_000_000);
	const probe = valuePayload(cpu.getGlobalByKey(cpu.stringPool.find('probe')!));
	for (const lane of ['translation', 'affine']) {
		const kernel = asClosure(cpu.gc.tables.getStringKey(probe, cpu.stringPool.find(lane)!), cpu.gc);
		const profile = profileWarmGuestKernel(cpu, kernel, 256);
		assert.equal(profile.reservations, 0);
		assert.equal(profile.reservedBytes, 0);
		assert.equal(profile.retainedAfter, profile.retainedBefore);
		t.diagnostic(`${lane}: ${JSON.stringify(profile)}`);
	}
});
