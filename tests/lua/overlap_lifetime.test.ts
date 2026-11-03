import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import type { Closure } from '../../machine/ts/machine/cpu/closure';
import { RunResult } from '../../machine/ts/machine/cpu/cpu';
import type { Table } from '../../machine/ts/machine/cpu/table';
import { createCartlibProgramHarness } from '../helpers/cartlib_cpu';
import { profileWarmGuestKernel } from '../helpers/guest_kernel';
import { WORLD_CPU_MODULES, WORLD_CPU_SETUP } from '../helpers/world_cpu';
import { runCompletionClosure } from './cpu_test_harness';

const modules = [
	...WORLD_CPU_MODULES,
	...[
		'cartlib/collision/geometry_pool', 'cartlib/collision/shape_geometry',
		'cartlib/collision/collision_shape', 'cartlib/collision/sprite_shape',
		'cartlib/collision/collider_2d_component', 'cartlib/component/sprite_component',
		'cartlib/world/base_system', 'cartlib/collision/overlap_2d_system',
		'cartlib/util/scratch_record_batch',
	].map(path => ({ path, source: readFileSync(`${path}.lua`, 'utf8') })),
	// Real World, Collider2D, events and overlap history; only the GEO result
	// producer is controlled so row retirement is independent of geometry.
	{ path: 'cartlib/collision/collision_2d', source: `
local source<const> = { pair_count = 0 }
local contact<const> = { normal = { x = 1, y = 0 }, depth = 1, point = { x = 0, y = 0 } }
local other_contact<const> = { normal = { x = -1, y = 0 }, depth = 1, point = { x = 0, y = 0 } }
function source.collect_overlaps(colliders, _count, batch)
 for index = 1, source.pair_count do
  local pair<const> = batch:get(index)
  pair.a = colliders[index * 2 - 1]
  pair.b = colliders[index * 2]
  pair.contact = contact
  pair.contact_other = other_contact
 end
 return source.pair_count
end
return source
` },
	{ path: 'cartlib/rom_dir', source: 'return {}' },
	{ path: 'cartlib/gx/image', source: 'return {}' },
];

const setup = WORLD_CPU_SETUP + `
local collider<const> = require('cartlib/collision/collider_2d_component')
local geometry_pool<const> = require('cartlib/collision/geometry_pool')
local overlap_system<const> = require('cartlib/collision/overlap_2d_system')
local collision<const> = require('cartlib/collision/collision_2d')
bss geometry: word[512]
local storage<const> = geometry_pool.new(geometry, 64, 32)
local actor<const> = setmetatable({}, { __index = object_2d })
function actor:on_overlap(event, _emitter, payload)
 assert(payload.collider_id == self.body.id and payload.other_collider_id ~= self.body.id)
 if event == 'overlap.begin' then
  assert(payload.phase == 'begin' and payload.contact.depth == 1)
  self.begins = self.begins + 1
 elseif event == 'overlap.stay' then
  assert(payload.phase == 'stay' and payload.contact.depth == 1)
  self.stays = self.stays + 1
 else
  assert(event == 'overlap.end' and payload.phase == 'end' and payload.contact == nil)
  self.ends = self.ends + 1
 end
end
function actor:bind()
 self.body = self:get_component(collider)
 self.events:on({ event = 'overlap.begin', handler = self.on_overlap })
 self.events:on({ event = 'overlap.stay', handler = self.on_overlap })
 self.events:on({ event = 'overlap.end', handler = self.on_overlap })
end
prefab.define({ def_id = 'overlap.actor', class = actor,
 components = { collider.factory({ geometry_pool = storage, local_area = { left=0, top=0, right=1, bottom=1 } }) },
 defaults = { begins = 0, stays = 0, ends = 0 } })
prefab.define({ def_id = 'overlap.stage', class = world_object })
local overlap<const> = overlap_system.new(world)
probe = { overlap = overlap }
`;

for (const optLevel of [0, 3] as const) {
	test(`Overlap retires every history row and preserves begin/stay/end across empty passes and clear (O${optLevel})`, () => {
		const { cpu } = createCartlibProgramHarness(setup + `
local actors<const> = {}
for index = 1, 32 do actors[index] = world:spawn('overlap.actor') end
collision.pair_count = 16
overlap:update()
for index = 1, 32 do assert(actors[index].begins == 1 and actors[index].stays == 0) end
local contact<const> = overlap.overlap_pairs.items[1].contact
overlap:update()
for index = 1, 32 do assert(actors[index].begins == 1 and actors[index].stays == 1) end
collision.pair_count = 8
overlap:update()
for index = 1, 16 do assert(actors[index].stays == 2 and actors[index].ends == 0) end
for index = 17, 32 do assert(actors[index].stays == 1 and actors[index].ends == 1) end
collision.pair_count = 0
overlap:update()
for index = 1, 32 do assert(actors[index].ends == 1, 'separation skipped an earlier pair row') end
assert(next(overlap.prev_pairs) == nil and next(overlap.next_pairs) == nil,
 'empty overlap pass retained old collider keys')
collision.pair_count = 16
overlap:update()
for index = 1, 32 do assert(actors[index].begins == 2 and actors[index].ends == 1) end
overlap:clear()
assert(next(overlap.prev_pairs) == nil and next(overlap.next_pairs) == nil,
 'clear retained old collider keys')
assert(overlap.overlap_pairs.items[1].contact == contact, 'clear discarded reusable scalar contact scratch')
collision.pair_count = 0
overlap:update()
for index = 1, 32 do assert(actors[index].ends == 1, 'clear replayed retired end events') end
collision.pair_count = 16
overlap:update()
for index = 1, 32 do assert(actors[index].begins == 3, 'clear preserved a stale stay pair') end
`, { optLevel, modules });
		assert.equal(cpu.runUntilDepth(0, 20_000_000), RunResult.Halted);
	});

	for (const retire of ['empty', 'clear'] as const) {
		test(`Overlap releases disposed actors, colliders and their stage after ${retire} retirement (O${optLevel})`, () => {
			const { cpu } = createCartlibProgramHarness(setup + `
function probe.retire()
 local weak<const> = setmetatable({}, { __mode = 'v' })
 local stage<const> = world:spawn('overlap.stage')
 local actors<const> = {}
 weak[65] = stage
 for index = 1, 32 do
  local object<const> = world:spawn('overlap.actor', { stage = stage })
  actors[index] = object
  weak[index] = object
  weak[index + 32] = object.body
 end
 collision.pair_count = 16
 overlap:update()
 overlap:update()
 for index = 1, 32 do actors[index]:mark_for_disposal() end
 stage:mark_for_disposal()
 collision.pair_count = 0
 ${retire === 'empty' ? 'overlap:update()' : 'overlap:clear()'}
 assert(#world._objects == 0 and next(overlap.prev_pairs) == nil and next(overlap.next_pairs) == nil,
  'retirement did not release World and overlap membership')
 probe.weak = weak
end
`, { optLevel, modules });
			assert.equal(cpu.runUntilDepth(0, 20_000_000), RunResult.Halted);
			const probe = cpu.getGlobalByKey(cpu.stringPool.find('probe')!) as Table;
			runCompletionClosure(cpu, probe.getStringKey(cpu.stringPool.find('retire')!) as Closure, []);
			cpu.collectTrackedHeapBytes();
			const weak = probe.getStringKey(cpu.stringPool.find('weak')!) as Table;
			for (let index = 1; index <= 65; index += 1) {
				assert.equal(weak.getInteger(index), null, `retired object/geometry owner ${index} remained reachable`);
			}
		});
	}

	test(`Warm overlap history and scalar contacts allocate nothing while pairs enter and leave (O${optLevel})`, t => {
		const { cpu } = createCartlibProgramHarness(setup + `
for index = 1, 32 do world:spawn('overlap.actor') end
kernel = function(count)
 for index = 1, count do
  collision.pair_count = 16
  overlap:update()
  collision.pair_count = 0
  overlap:update()
 end
end
`, { optLevel, modules });
		assert.equal(cpu.runUntilDepth(0, 20_000_000), RunResult.Halted);
		const kernel = cpu.getGlobalByKey(cpu.stringPool.find('kernel')!) as Closure;
		const profile = profileWarmGuestKernel(cpu, kernel, 128);
		assert.equal(profile.reservations, 0);
		assert.equal(profile.reservedBytes, 0);
		assert.equal(profile.retainedAfter, profile.retainedBefore);
		t.diagnostic(JSON.stringify({ optLevel, ...profile }));
	});
}
