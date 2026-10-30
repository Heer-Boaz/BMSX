import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { load } from 'js-yaml';
import type { Closure } from '../../../machine/ts/machine/cpu/closure';
import { RunResult } from '../../../machine/ts/machine/cpu/cpu';
import type { Table } from '../../../machine/ts/machine/cpu/table';
import { createCartlibProgramHarness } from '../../helpers/cartlib_cpu';
import { runCompletionClosure } from '../../lua/cpu_test_harness';

// Only ROM-data loading is replaced: use the actual authored timing values in
// the real globals module. The real cart samplers, color/easing, Transform and
// Visual2D owners execute as compiled BLua, not mock property-write receivers.
const config = load(readFileSync('carts/2025/res/data/transition_config.yaml', 'utf8')) as Record<string, string | number>;
const configSource = `{${Object.entries(config).map(([key, value]) => `${key}=${JSON.stringify(value)}`).join(',')}}`;
const globalsSource = readFileSync('carts/2025/globals.lua', 'utf8').replace(
	/local bin<const>[\s\S]*?local transition_config<const> = [^\n]+/,
	`local transition_config<const> = ${configSource}`,
);
const modules = [
	{ path: 'globals', source: globalsSource },
	...['timelinebuilders', 'combat_pose'].map(path => ({ path, source: readFileSync(`carts/2025/${path}.lua`, 'utf8') })),
	{ path: 'cartlib/color', source: readFileSync('cartlib/color.lua', 'utf8') },
	{ path: 'slash_component', source: readFileSync('carts/2025/slash_component.lua', 'utf8') },
	...['cartlib/component/custom_visual_component', 'cartlib/gx/primitives', 'cartlib/gx/gp0'].map(path => ({path,source:readFileSync(`${path}.lua`,'utf8')})),
];

const fixture = `
require('globals')
local h<const> = require('cartlib/world/spatial_hierarchy')
local visual2<const> = require('cartlib/component/visual_2d_component')
local timeline_component<const> = require('cartlib/timeline/timeline_component')
local range<const> = require('cartlib/timeline/timeline').range
local builders<const> = require('timelinebuilders')
local graph<const> = h.new()
local make_visual<const> = function(x,y,width,height)
	local owner<const> = { spatial=h.create2(graph,nil,1,0,0,1,0,0) }
	local v<const> = visual2.new({owner=owner,initial={visual={attachment_affine={1,0,0,1,x,y}}}},'visual')
	v.source_width, v.source_height = width,height
	return v
end
local monster<const> = make_visual(208,60,72,96)
local maya_a<const> = make_visual(0,240,120,180)
local maya_b<const> = make_visual(320,240,120,180)
local overlay<const> = {color=0,blend_color=0}
local slash<const> = require('slash_component').new({owner={monster=monster},initial={slash={order=650}}})
local capture<const> = {mode=function() end,semitransparent_quad=function(self,x0,y0,x1,y1,x2,y2,x3,y3,color)
	self.center_x=(x0+x1+x2+x3)/4
	self.center_y=(y0+y1+y2+y3)/4
	self.color=color
end}
local owner<const> = {}
local timelines<const> = timeline_component.new({owner=owner,clock_mode='manual'})
local intro_params<const> = {
	monster_width=72,monster_height=96,maya_a_height=180,maya_b_width=120,maya_b_height=180,
	monster_start_scale=2.5,monster_start_x=28,monster_start_y=60,
	monster_base_x=172,monster_base_y=28,
	maya_a_start_scale=0.6,maya_a_start_x=320,maya_a_base_x=0,maya_a_base_y=60,
	maya_b_start_scale=1.08,maya_b_end_scale=0.9,maya_b_start_right_x=320,maya_b_exit_right_x=440,
	maya_b_base_x=200,maya_b_base_y=60,enemy_weight=-2/3,hero_weight=2/3,camera_y=1.1,
}
local hit_params<const> = {base_x=172,base_y=28,monster_width=72,monster_height=96,enemy_weight=-2/3,camera_y=1.1}
local dodge_params<const> = {base_x=172,base_y=28,dir=1,enemy_weight=-2/3,camera_y=1.1}
local exchange_params<const> = {
	frame_count=combat_exchange_hit_frame_count,monster_base_x=172,monster_base_y=28,maya_base_x=0,maya_base_y=60,
	maya_hold_frames=3,maya_recover_frames=5,maya_bob_amp=0,maya_bob_period_frames=6,
	maya_react_scale_x=.16,maya_react_scale_y=-.12,maya_impact_scale_x=.24,maya_impact_scale_y=-.2,
	maya_offset_x=28,maya_offset_y=36,squash=true,flash=true,flash_color=p3_cyan_color,
	cam_shake_x=20,cam_shake_y=16,overlay_strength=.35,enemy_weight=-2/3,hero_weight=2/3,camera_y=1.1,
}
builders.prepare_combat_sample('intro',intro_params)
builders.prepare_combat_sample('hit',hit_params)
builders.prepare_combat_sample('exchange',exchange_params)
local focus_params<const> = builders.prepare_combat_sample('focus',{base_x=172,base_y=28,monster_width=72,monster_height=96})
timelines:define('intro',{phase='presentation',frames=range(40),target={monster=monster,maya_a=maya_a,maya_b=maya_b},
	params=intro_params,apply=builders.apply_combat_intro_frames})
timelines:define('hit',{phase='presentation',frames=range(combat_hit_frame_count),target={monster=monster,slash_frame=slash},
	params=hit_params,apply=builders.apply_combat_hit_frames})
timelines:define('dodge',{phase='presentation',frames=range(combat_dodge_frame_count),target=monster,
	params=dodge_params,apply=builders.apply_combat_dodge_frames})
timelines:define('exchange',{phase='presentation',frames=range(combat_exchange_hit_frame_count),target={monster=monster,maya_a=maya_a,overlay=overlay},
	params=exchange_params,apply=builders.apply_combat_exchange_frames})
timelines:define('focus',{phase='presentation',frames=range(combat_focus_zoom_frames+combat_focus_vanish_frames),target=monster,
	params=focus_params,apply=builders.apply_combat_focus_frames})
local spatial<const> = monster.spatial
local depth_scale<const> = 1 + combat_parallax_scale_delta*2/3
timelines:seek('intro',0)
assert(not monster.visible and not maya_a.visible and maya_b.visible, 'intro frame zero must publish only the incoming portrait')
timelines:seek('intro',39)
monster:resolve_pose()
assert(monster.visible and maya_a.visible and not maya_b.visible, 'intro final sample lost visibility handoff')
assert(math.abs(monster.wxx-depth_scale)<1e-12, 'intro dropped momentum depth when publishing its final affine')
assert(math.abs(monster.wox-(172))<1e-12, 'intro compounded its immutable attachment baseline')
timelines:seek('hit',combat_hit_stop_frames+1)
assert(slash.slash_active and slash.slash_thickness>0, 'range sampling dropped the substantive slash geometry output')
timelines:seek('focus',combat_focus_zoom_frames+combat_focus_vanish_frames-1)
assert(not monster.visible, 'focus final sample must finish the melt and hide its geometry')
assert(monster.spatial==spatial and spatial.ox==0 and spatial.oy==0 and monster.attachment_ox==208 and monster.attachment_oy==60,
	'presentation sampling changed physical placement or authored attachment')
timelines:seek('hit',combat_hit_stop_frames+1)
h.write_local2(spatial,1,.25,.5,1,8,12)
slash:draw_visual(capture)
local pose<const> = monster:resolve_pose()
local center_x<const>, center_y<const> = (slash.slash_x0+slash.slash_x1)/2,(slash.slash_y0+slash.slash_y1)/2
assert(math.abs(capture.center_x-(pose.wox+pose.wxx*center_x+pose.wyx*center_y))<1e-9
	and math.abs(capture.center_y-(pose.woy+pose.wxy*center_x+pose.wyy*center_y))<1e-9,
	'slash emission detached its local geometry from the actual visual affine')
assert(capture.color==p3_white_color, 'slash emission lost the authored blend geometry color')
probe={run=function(count)
	for i=1,count do
		timelines:seek('intro',i%40)
		timelines:seek('hit',i%combat_hit_frame_count)
		slash:draw_visual(capture)
		timelines:seek('dodge',i%combat_dodge_frame_count)
		timelines:seek('exchange',i%combat_exchange_hit_frame_count)
		timelines:seek('focus',i%(combat_focus_zoom_frames+combat_focus_vanish_frames))
		monster:resolve_pose()
		maya_a:resolve_pose()
		maya_b:resolve_pose()
	end
end}
`;

for (const optLevel of [0, 3] as const) {
	test(`2025 range samplers retain spatial ownership and allocate nothing when warm (O${optLevel})`, t => {
		const { cpu } = createCartlibProgramHarness(fixture, { modules, optLevel, firmwareMath: true });
		assert.equal(cpu.runUntilDepth(0, 30_000_000), RunResult.Halted);
		const probe = cpu.getGlobalByKey(cpu.stringPool.find('probe')!) as Table;
		const run = probe.getStringKey(cpu.stringPool.find('run')!) as Closure;
		runCompletionClosure(cpu, run, [64]);
		const heap = cpu.luaHeap;
		const before = cpu.collectTrackedHeapBytes();
		const reserve = heap.reserve;
		let reservations = 0;
		heap.reserve = function (...args) { reservations += 1; reserve.apply(heap, args); };
		let cycles: number;
		try { cycles = runCompletionClosure(cpu, run, [256]); } finally { heap.reserve = reserve; }
		assert.equal(reservations, 0);
		assert.equal(heap.usedBytes(), before);
		t.diagnostic(JSON.stringify({ iterations: 256, samples: 1280, cycles, reservations }));
	});
}
