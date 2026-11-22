import assert from 'node:assert/strict';
import { test } from 'node:test';
import { valueBool } from '../../machine/ts/machine/cpu/value';
import { createCartlibProgramHarness } from '../helpers/cartlib_cpu';
import { materializeCpuCompletionValues, runGuestToHalt } from '../helpers/cpu_test_harness';

test('packed frame keys and authored frame keys agree on crossing, seek and target binding', () => {
	const { cpu } = createCartlibProgramHarness(`
local component<const> = require('cartlib/timeline/timeline_component')
local timeline<const> = require('cartlib/timeline/timeline')

-- Four frames, two ordered tracks: signed values (-3, -8, -11)
-- and a Boolean (true, false). Both tracks change at frame 1.
rodata clip: word[] = {
 0x4, 0x18, 0x20, 0x48, 0x68, 0x74,
 0x30000, 0x50003, 0x0, 0xfffffffd, 0x1, 0xfffffff8,
 0x3, 0xfffffff5, 0x0, 0x1, 0x1, 0x0,
 0x1, 0x30002, 0x10001, 0x40002, 0x20001, 0x1,
 0x30002, 0x10001, 0x20000, 0x40004, 0x5, 0x50005,
 0x70007, 0x8,
}

local apply_value<const> = function(target, value) target.value = value end
local apply_visible<const> = function(target, visible)
 assert(type(visible)=='boolean')
 target.visible = visible
 target.value_at_visibility = target.value
end
local packed<const> = {
 phase='presentation', frames=timeline.range(4), frame_duration=50,
 packed_frame_steps=&clip,
 tracks={
  {kind='value', interpolation='step', apply=apply_value},
  {kind='value', interpolation='step', apply=apply_visible, boolean=true},
 },
}
local ordinary<const> = {
 phase='presentation', frames=timeline.range(4), frame_duration=50,
 tracks={
  {kind='value', interpolation='step', apply=apply_value,
   keys={{frame=0,value=-3},{frame=1,value=-8},{frame=3,value=-11}}},
  {kind='value', interpolation='step', apply=apply_visible,
   keys={{frame=0,value=true},{frame=1,value=false}}},
 },
}
local a<const>,b<const> = {},{}
local packed_player<const> = component.new(a, {clock_mode='manual'})
local ordinary_player<const> = component.new(b, {clock_mode='manual'})
-- Both evaluator representations have otherwise the same shape.
packed_player:define('clip',packed)
ordinary_player:define('clip',ordinary)
for _, player in ipairs({packed_player,ordinary_player}) do
 local owner<const> = player.owner
 player:play('clip')
 assert(owner.value==-3 and owner.visible==true and owner.value_at_visibility==-3)
 player:advance_to('clip',1)
 assert(owner.value==-8 and owner.visible==false and owner.value_at_visibility==-8)
 player:advance_to('clip',0)
 assert(owner.value==-3 and owner.visible==true and owner.value_at_visibility==-3)
 player:seek('clip',3)
 assert(owner.value==-11 and owner.visible==false and owner.value_at_visibility==-11)
 player:advance_to('clip',2)
 assert(owner.value==-8 and owner.visible==false)
end
local rebound<const> = {}
packed_player:play('clip',{bindings={target=rebound},rewind=true,snap_to_start=true})
assert(rebound.value==-3 and rebound.visible==true and a.value==-8)
return true
`, { optLevel: 3 });
	runGuestToHalt(cpu, 12_000_000);
	assert.deepEqual(materializeCpuCompletionValues(cpu), [valueBool(true)]);
});
