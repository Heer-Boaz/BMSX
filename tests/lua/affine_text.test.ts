import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import type { Closure } from '../../machine/ts/machine/cpu/closure';
import { RunResult } from '../../machine/ts/machine/cpu/cpu';
import type { Table } from '../../machine/ts/machine/cpu/table';
import type { StringValue } from '../../machine/ts/machine/cpu/value';
import { createCartlibProgramHarness } from '../helpers/cartlib_cpu';
import { profileWarmGuestKernel } from '../helpers/guest_kernel';
import { WORLD_CPU_MODULES, WORLD_CPU_SETUP } from '../helpers/world_cpu';
import { materializeCpuCompletionValues } from './cpu_test_harness';

const modules = [
	...WORLD_CPU_MODULES,
	...[
		'cartlib/component/visual_component', 'cartlib/component/visual_2d_component',
		'cartlib/gx/image', 'cartlib/gx/atlas', 'cartlib/gx/imgdec', 'cartlib/gx/affine_batch',
		'cartlib/text/font_catalog', 'cartlib/text/text_component', 'cartlib/text/text_object',
		'cartlib/font', 'cartlib/util/text',
	].map(path => ({ path, source: readFileSync(`${path}.lua`, 'utf8') })),
	{ path: 'cartlib/rom_dir', source: `return {image=function()
		return {imgmeta={width=2,height=3,gx_source_x=64,gx_source_y=32}}
	end}` },
];

const setup = WORLD_CPU_SETUP + `
local failed
local assert<const> = function(condition,message)
 if not condition and failed == nil then failed=message end
end
local commands<const> = require('cartlib/gx/command_list')
local text_component<const> = require('cartlib/text/text_component')
local text_object<const> = require('cartlib/text/text_object')
local catalog<const> = require('cartlib/text/font_catalog')
require('cartlib/gx/vram').page_size=(100 << 16) | 100
catalog.replace('fixture',{glyphs={a='glyph',b='glyph',[' ']='glyph',['?']='glyph'},line_height=3,advance_padding=1})
local font<const> = catalog.get('fixture')
bss text_words: word[512]
local output<const>: *word = text_words
local draw<const> = commands.new(text_words,512)
`;

const plain = `
prefab.define({def_id='text.plain',class={},spatial={family='2d',authority='affine',
 local_transform={0,1,-1,0,10,20}},components={text_component.new},
 initial={text={font=font,text='aa\\nb',color=0xffffffff}}})
local actor<const> = world:spawn('text.plain',{})
local text<const> = actor:get_component(text_component)
local rows<const> = text.glyph_lines
commands.begin(draw,0x100,0)
text:draw_visual(draw)
assert(output[2]==0x0014000a and output[4]==0x0016000a
 and output[6]==0x00140007 and output[8]==0x00160007,
 'affine text did not transform retained glyph geometry')
assert(output[17]==0x0017000a,'affine text lost glyph advances')
local basis<const> = text._visual_basis_revision
actor.spatial:set_local_origin(-100,20)
commands.begin(draw,0x100,0)
text:draw_visual(draw)
assert(draw.word_count==1 and text._visual_basis_revision==basis and text.glyph_lines==rows,
 'origin-only text movement rebuilt layout/basis or culled using untransformed coordinates')
actor.spatial:set_local_origin(10,20)
text:set_glyph_visible_height(1)
commands.begin(draw,0x100,0)
text:draw_visual(draw)
assert(output[6]==0x00140009 and output[8]==0x00160009,
 'affine glyph reveal used full source height')
text:set_glyph_visible_height(3)
text.background_color=0xff123456
commands.begin(draw,0x100,0)
text:draw_visual(draw)
assert(output[1]==0x28563412 and output[2]==0x0014000a
 and output[4]==0x00140007,'glyph background did not share the text affine')
text.background_color=nil
actor.spatial:set_local_affine(1,0,0,1,10,20)
commands.begin(draw,0x100,0)
text:draw_visual(draw)
assert((output[1] & 0xff000000)==0x65000000,
 'ordinary text stopped using the admitted native glyph span')
text:set_center_block_width(20)
commands.begin(draw,0x100,0)
text:draw_visual(draw)
assert(output[2]==0x00140011,'text centering became a second object pose')
assert(actor.x==nil and actor.y==nil and text.offset_x==nil and text.glyph_lines==rows,
 'text retained legacy object coordinates or rebuilt glyph rows for placement')
probe={run=function(count)
 for index=1,count do
  actor.spatial:set_local_origin(10+index%3,20)
  commands.begin(draw,0x100,0)
  text:draw_visual(draw)
 end
end,affine=function(count)
 actor.spatial:set_local_affine(0,1,-1,0,10,20)
 for index=1,count do
  actor.spatial:set_local_origin(10+index%3,20)
  commands.begin(draw,0x100,0)
  text:draw_visual(draw)
 end
end}
return failed
`;

const rich = `
prefab.define({def_id='text.rich',class={},base=text_object,spatial={family='2d',authority='affine',
 local_transform={0,1,-1,0,40,50}},initial={text={font=font,text='aa b\\nb',
 layout_rect={left=0,top=2,right=20,bottom=30},wrap_chars=3,color=0xffffffff,background_color=0xff000000}}})
local actor<const> = world:spawn('text.rich',{})
local text<const> = actor.text_component
assert(actor.maximum_characters_per_line==3 and #actor.full_text_lines==3
 and text.layout_x==7 and text.layout_y==2,
 'rich text ignored its explicit wrap limit or local layout rectangle')
assert(actor.dimensions==nil and actor.x==nil and actor.y==nil and text.offset_x==nil,
 'rich text retained world-anchored layout state')
local rows<const> = actor.full_glyph_lines
actor:set_highlighted_line(0)
commands.begin(draw,0x100,0)
text:draw_visual(draw)
local highlight
for index=1,draw.word_count-1 do
 if (output[index] & 0xff000000)==0x2a000000 then highlight=index break end
end
assert(highlight~=nil and output[highlight+1]==0x00310026,
 'highlight rectangle escaped the same local-to-world affine as glyphs')
assert(actor._background_line_count==1 and actor._background_line_indices[1]==3,
 'highlight geometry changed the retained background-line selection')
text:set_glyph_visible_height(1)
commands.begin(draw,0x100,0)
text:draw_visual(draw)
assert(text.glyph_lines==rows and text.glyph_visible_height==1,
 'rich glyph-row reveal replaced its retained layout')
text:set_glyph_visible_height(3)
actor.spatial:set_local_origin(60,70)
commands.begin(draw,0x100,0)
text:draw_visual(draw)
assert(text.layout_x==7 and text.layout_y==2 and actor.full_glyph_lines==rows,
 'moving rich text rewrote local layout or copied glyph rows')
actor:set_layout_rect({left=0,top=2,right=40,bottom=30})
assert(actor.maximum_characters_per_line==3 and text.layout_x==17,
 'layout changes discarded the explicitly authored wrap limit')
actor:set_wrap_chars(6)
assert(actor.maximum_characters_per_line==6 and #actor.full_text_lines==2,
 'rich text wrap setter bypassed its layout owner')
probe={run=function(count)
 for index=1,count do
  actor.spatial:set_local_origin(40+index%3,50)
  commands.begin(draw,0x100,0)
  text:draw_visual(draw)
 end
end}
return failed
`;

for (const optLevel of [0, 3] as const) {
	for (const [name, fixture] of [['plain', plain], ['rich', rich]] as const) {
		test(`Text ${name} retains local layout and transforms its complete geometry (O${optLevel})`, t => {
			const { cpu } = createCartlibProgramHarness(setup + fixture, { optLevel, modules });
			assert.equal(cpu.runUntilDepth(0, 30_000_000), RunResult.Halted);
			const [failure] = materializeCpuCompletionValues(cpu);
			assert.equal(failure, null, failure === null ? undefined : cpu.stringPool.toString((failure as StringValue).id));
			if (optLevel === 3) {
				const probe = cpu.getGlobalByKey(cpu.stringPool.find('probe')!) as Table;
				for (const lane of name === 'plain' ? ['run', 'affine'] : ['run']) {
					const kernel = probe.getStringKey(cpu.stringPool.find(lane)!) as Closure;
					const profile = profileWarmGuestKernel(cpu, kernel, 256);
					assert.equal(profile.reservations, 0);
					assert.equal(profile.reservedBytes, 0);
					assert.equal(profile.retainedAfter, profile.retainedBefore);
					t.diagnostic(`${name}/${lane}: ${JSON.stringify(profile)}`);
				}
			}
		});
	}
}
