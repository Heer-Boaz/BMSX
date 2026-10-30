import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import type { Closure } from '../../machine/ts/machine/cpu/closure';
import type { Table } from '../../machine/ts/machine/cpu/table';
import { profileWarmGuestKernel } from '../helpers/guest_kernel';
import type { StringValue } from '../../machine/ts/machine/cpu/value';
import { RunResult } from '../../machine/ts/machine/cpu/cpu';
import { createCartlibProgramHarness } from '../helpers/cartlib_cpu';
import { WORLD_CPU_MODULES, WORLD_CPU_SETUP } from '../helpers/world_cpu';
import { materializeCpuCompletionValues } from './cpu_test_harness';

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
		'cartlib/component/surface_component', 'cartlib/component/tile_strip_component',
		'cartlib/component/rectangle_component',
		'cartlib/component/tile_layer_component', 'cartlib/component/tile_layer_row',
		'cartlib/gx/image', 'cartlib/gx/atlas', 'cartlib/gx/imgdec', 'cartlib/gx/affine_batch',
	].map(path => ({ path, source: readFileSync(`${path}.lua`, 'utf8') })),
	{
		path: 'cartlib/rom_dir',
		source: `local images<const> = {
 tile={imgmeta={width=2,height=3,gx_source_x=64,gx_source_y=32}},
 other={imgmeta={width=3,height=2,gx_source_x=68,gx_source_y=32}},
 surface={imgmeta={width=4,height=3,gx_source_x=64,gx_source_y=32,
  gx_page_tiles={{u=64,v=32,w=2,h=3,x=0,y=0},{u=66,v=32,w=2,h=3,x=2,y=0}}}},
}
return { image=function(id) return images[id] end }`,
	},
];

for (const optLevel of [0, 3] as const) {
	test(`Scene members inherit prefab placement and visual defaults unless explicitly overridden (O${optLevel})`, () => {
		const { cpu } = createCartlibProgramHarness(WORLD_CPU_SETUP + `
local sprite<const> = require('cartlib/component/sprite_component')
prefab.define({def_id='visual.defaults',class={},
 spatial={family='2d',authority='affine',local_transform={1,0,0,1,9,12}},
 initial={sprite={imgid='tile',order=7,attachment_affine={1,0,0,1,2,3}}},components={sprite.new}})
prefab.define({def_id='visual.neutral',class={},
 spatial={family='2d',authority='affine',local_transform={1,0,0,1,0,0}},
 initial={sprite={imgid='tile'}},components={sprite.new}})
scenes.register('visual.defaults',{objects={
 {member_id='inherited',definition_id='visual.defaults'},
 {member_id='neutral',definition_id='visual.neutral'},
 {member_id='explicit',definition_id='visual.defaults',spatial={local_transform={1,0,0,1,0,0}},
  initial={sprite={order=0,attachment_affine={1,0,0,1,0,0}}}},
}})
local instance<const> = scenes.instantiate('visual.defaults')
local inherited<const>, neutral<const>, explicit<const> = instance.members.inherited, instance.members.neutral, instance.members.explicit
local iv<const>, nv<const>, ev<const> = inherited:get_component(sprite),neutral:get_component(sprite),explicit:get_component(sprite)
assert(inherited.spatial.ox==9 and inherited.spatial.oy==12 and iv.order==7
 and iv.attachment_ox==2 and iv.attachment_oy==3 and iv.imgid=='tile',
 'omitting Scene overrides lost actual prefab placement or visual inputs')
assert(neutral.spatial.ox==0 and neutral.spatial.oy==0 and nv.order==0
 and nv.attachment_xx==1 and nv.attachment_yy==1 and nv.attachment_ox==0 and nv.attachment_oy==0,
 'neutral Scene member required duplicated identity or zero-order declarations')
assert(explicit.spatial.ox==0 and explicit.spatial.oy==0 and ev.order==0
 and ev.attachment_ox==0 and ev.attachment_oy==0 and ev.imgid=='tile',
 'explicit zero and identity overrides were confused with omitted defaults')
inherited.spatial:set_local_origin(30,40)
local second<const> = scenes.instantiate('visual.defaults')
assert(second.members.inherited.spatial.ox==9 and second.members.inherited.spatial.oy==12,
 'instance writes mutated the shared prefab placement')
return true
`, { optLevel, modules });
		assert.equal(cpu.runUntilDepth(0, 20_000_000), RunResult.Halted);
		assert.deepEqual(materializeCpuCompletionValues(cpu), [true]);
	});

	test(`Sprite source changes preserve the concrete composite draw producer (O${optLevel})`, () => {
		const { cpu } = createCartlibProgramHarness(WORLD_CPU_SETUP + `
local sprite<const> = require('cartlib/component/sprite_component')
local commands<const> = require('cartlib/gx/command_list')
local gp0<const> = require('cartlib/gx/gp0')
local layered<const> = setmetatable({}, {__index=sprite})
layered.__index=layered
function layered:draw_visual(draw)
 draw:rect(0,0,1,1,0xff204080)
 sprite.draw_visual(self,draw)
end
prefab.define({def_id='visual.layered',class={},
 spatial={family='2d',authority='affine',local_transform={1,0,0,1,10,20}},
 initial={sprite={imgid='tile'}},components={function(context)
  local part<const> = sprite.new(context,'sprite')
  setmetatable(part,layered)
  part:set_draw_function(layered.draw_visual)
  return part
 end}})
local actor<const> = world:spawn('visual.layered',{})
local part<const> = actor:get_component(sprite)
part:set_imgid('other')
assert(part.draw==layered.draw_visual and part.source_width==3 and part.source_height==2,
 'source admission discarded the concrete composite producer')
bss words: word[32]
local draw<const> = commands.new(words)
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
`, { optLevel, modules });
		assert.equal(cpu.runUntilDepth(0, 20_000_000), RunResult.Halted);
		assert.deepEqual(materializeCpuCompletionValues(cpu), [true]);
	});

	test(`Rectangle geometry owns its dimensions and composes the retained visual affine (O${optLevel})`, t => {
		const { cpu } = createCartlibProgramHarness(WORLD_CPU_SETUP + `
local rectangle<const> = require('cartlib/component/rectangle_component')
local commands<const> = require('cartlib/gx/command_list')
local gp0<const> = require('cartlib/gx/gp0')
prefab.define({def_id='rectangle.actor',class={},spatial={family='2d',authority='affine',
 local_transform={0,2,-3,0,10,20}},components={rectangle.new},initial={rectangle={
 width=2,height=3,color=0xff204080,attachment_affine={2,0,0,1,1,2},
 presentation_affine={1,0,0,1,3,4}}}})
local actor<const> = world:spawn('rectangle.actor',{})
local part<const> = actor:get_component(rectangle)
bss words: word[32]
local draw<const> = commands.new(words)
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
 and actor.spatial.wox==10 and actor.spatial.woy==20)
kernel=function(count)
 for index=1,count do
  part:set_presentation_origin(index & 7,0)
  commands.begin(draw,0x100,0)
  part:draw_rectangle(draw)
 end
end
return true
`, { optLevel, modules });
		assert.equal(cpu.runUntilDepth(0, 20_000_000), RunResult.Halted);
		assert.deepEqual(materializeCpuCompletionValues(cpu), [true]);
		const kernel = cpu.getGlobalByKey(cpu.stringPool.find('kernel')!) as Closure;
		const profile = profileWarmGuestKernel(cpu, kernel, 256);
		assert.equal(profile.reservations, 0);
		assert.equal(profile.reservedBytes, 0);
		assert.equal(profile.retainedAfter, profile.retainedBefore);
		t.diagnostic(JSON.stringify({ optLevel, ...profile }));
	});

	test(`Visual placement composes physical, attachment and presentation without moving the object (O${optLevel})`, () => {
		const { cpu } = createCartlibProgramHarness(checks + WORLD_CPU_SETUP + `
local sprite<const> = require('cartlib/component/sprite_component')
local visual<const> = require('cartlib/component/visual_component')
local custom<const> = require('cartlib/component/custom_visual_component')
prefab.define({def_id='visual.parent',class={},spatial={family='2d',authority='affine',
 local_transform={0,2,-3,0,10,20}}})
prefab.define({def_id='visual.child',class={},spatial={family='2d',authority='affine',
 local_transform={1,0,1,1,4,5}},components={sprite.new},initial={sprite={imgid='tile',
 attachment_affine={2,0,0,1,1,2},presentation_affine={1,0,0,1,3,4}}}})
local parent<const> = world:spawn('visual.parent', {})
local child<const> = world:spawn('visual.child',{},{parent=parent.spatial})
local part<const> = child:get_component(sprite)
part:resolve_pose()
assert(part.wxx==0 and part.wxy==4 and part.wyx==-3 and part.wyy==2
 and part.wox==-23 and part.woy==54,'visual composed the three owners in a different order')
assert(child.spatial.wox==-5 and child.spatial.woy==28
 and child.x==nil and child.y==nil and part.offset_x==nil,'presentation became a second object pose')
local basis<const> = part._visual_basis_revision
part:set_presentation_origin(5,6)
part:resolve_pose()
assert(part._visual_basis_revision==basis and part.wox==-29 and part.woy==66,
 'presentation translation rebuilt the basis or missed the affine')
parent.spatial:set_local_origin(100,200)
part:resolve_pose()
assert(part._visual_basis_revision==basis and part.wox==61 and part.woy==246,
 'ancestor translation rebuilt the visual basis')
local physical<const> = child.spatial._origin_revision
part:set_order(9)
part:set_presentation_order(-2)
assert(part.order==9 and part.presentation_order==-2 and child.spatial._origin_revision==physical,
 'render ordering invalidated physical pose')
prefab.define({def_id='visual.nonspatial',class={},components={custom.factory({draw=function() end})}})
local nonspatial<const> = world:spawn('visual.nonspatial', {})
assert(nonspatial.spatial==nil and nonspatial:get_component(visual)~=nil,
 'generic custom geometry fabricated a spatial capability')
return assertion_failed
`, { optLevel, modules });
		assert.equal(cpu.runUntilDepth(0, 20_000_000), RunResult.Halted);
		const [failure] = materializeCpuCompletionValues(cpu);
		assert.equal(failure, null, failure === null ? undefined : cpu.stringPool.toString((failure as StringValue).id));
	});

	// These coordinates/words are the subject of the GX affine producer contract,
	// not incidental Workbench layout. Every source keeps its admitted UV/CLUT
	// representation while a whole batch transforms its retained local geometry.
	test(`GX affine batches preserve source records and native atomic packets (O${optLevel})`, () => {
		const { cpu } = createCartlibProgramHarness(checks + `
local commands<const> = require('cartlib/gx/command_list')
local batch<const> = require('cartlib/gx/affine_batch')
local image<const> = require('cartlib/gx/image')
bss words: word[512]
local draw<const> = commands.new(words)
commands.begin(draw,0x100,0)
local source<const> = image.resolve('tile')
local surface<const> = image.resolve('surface')
batch.offset_span(draw,surface._tiles, 0,2,-3,1, 10,20, 0xffffffff)
local output<const>: *word = words
assert(draw.word_count==25 and output[1]==0x2d808080
 and output[2]==0x0014000a and output[4]==0x0018000a
 and output[6]==0x00170001 and output[8]==0x001b0001,
 'first affine surface tile lost shear or native quad order')
assert(output[17]==0x0018000a and output[19]==0x001c000a
 and output[21]==0x001b0001 and output[23]==0x001f0001,
 'surface batch reconstructed or ignored source offsets')
assert(output[3]==source._quad_uv0 and output[5]==source._quad_uv1
 and output[7]==source._quad_uv2 and output[9]==source._quad_uv3,
 'affine packet changed admitted image addressing')
commands.begin(draw,0x100,0)
batch.repeated_image(draw,source,-1,1, 4,5, 1,1,-1,2, 10,20, 0xffffffff)
assert(draw.word_count==41 and output[2]==0x0006000b and output[17]==0x0014000a
 and output[33]==0x00220009,'strip endpoints were replaced with generated shadow positions')
commands.begin(draw,0x100,0)
local glyphs<const> = {source,source}
local offsets<const> = {0,4}
batch.glyph_span(draw,glyphs,offsets,1,2, -1,0,2,1, 10,20, 0xffffffff)
assert(output[2]==0x0014000a and output[17]==0x00140006,
 'glyph span ignored local x offsets under reflection')
commands.begin(draw,0x100,0)
local rows<const> = {{row_index=2,sources=glyphs,columns={3,5},first_visible_source=1,last_visible_source=2}}
batch.tile_layer(draw,rows,1,3,4, 0,1,-1,0, 10,20)
assert(output[2]==0x00140006 and output[17]==0x001c0006,
 'affine tile view failed to retain source columns or selected view origin')
commands.begin(draw,0x100,0)
draw.word_count=14
batch.glyph_span(draw,glyphs,offsets,1,1, 1,0,0,1, 0,0, 0xff204080)
assert(output[14]==0 and output[15]==0 and output[16]==0x2c402010 and draw.word_count==25,
 'native textured quad crossed a DMA packet block or lost modulation')
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
`, { optLevel, modules });
		assert.equal(cpu.runUntilDepth(0, 20_000_000), RunResult.Halted);
		const [failure] = materializeCpuCompletionValues(cpu);
		assert.equal(failure, null, failure === null ? undefined : cpu.stringPool.toString((failure as StringValue).id));
	});
}

test('Retained affine image batches allocate nothing warm and preserve the native rectangle lane', t => {
	const { cpu } = createCartlibProgramHarness(`
local commands<const> = require('cartlib/gx/command_list')
local batch<const> = require('cartlib/gx/affine_batch')
local image<const> = require('cartlib/gx/image')
bss words: word[1024]
local draw<const> = commands.new(words)
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
	assert.equal(cpu.runUntilDepth(0, 20_000_000), RunResult.Halted);
	const probe = cpu.getGlobalByKey(cpu.stringPool.find('probe')!) as Table;
	for (const lane of ['translation', 'affine']) {
		const kernel = probe.getStringKey(cpu.stringPool.find(lane)!) as Closure;
		const profile = profileWarmGuestKernel(cpu, kernel, 256);
		assert.equal(profile.reservations, 0);
		assert.equal(profile.reservedBytes, 0);
		assert.equal(profile.retainedAfter, profile.retainedBefore);
		t.diagnostic(`${lane}: ${JSON.stringify(profile)}`);
	}
});
