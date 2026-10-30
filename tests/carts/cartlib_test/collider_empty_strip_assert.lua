local collider_2d_component<const> = require('cartlib/collision/collider_2d_component')
local collision_2d<const> = require('cartlib/collision/collision_2d')
local geometry_pool<const> = require('cartlib/collision/geometry_pool')
local overlap_2d_system<const> = require('cartlib/collision/overlap_2d_system')
local tile_strip_component<const> = require('cartlib/component/tile_strip_component')
local tile_strip_collider<const> = require('cartlib/collision/tile_strip_collider_2d_component')
local scratch_record_batch<const> = require('cartlib/util/scratch_record_batch')
local prefab<const> = require('cartlib/world/prefab')
local world<const> = require('cartlib/world/world')

bss geometry: word[320]
local pool<const> = geometry_pool.new(geometry, 256, 5)
local definition_id<const> = 'cartlib_test.empty_strip'
prefab.define({
	def_id = definition_id, class = {},
	spatial = { family = '2d', authority = 'affine', local_transform = { 1, 0, 0, 1, 32, 32 } },
	initial = { collider = { geometry_pool = pool, layer = 1, mask = 1 } },
	components = {
		tile_strip_component.factory({ imgid = 'collision_tile', first_tile = 0, step_x = 4, step_y = 0, maximum_tiles = 3 }),
		tile_strip_collider.factory({}),
	},
})

local record_phase<const> = function(self, _event, _emitter, payload)
	local phases<const> = self.contact_phases
	phases[#phases + 1] = payload.phase
	assert(payload.other_id == self.expected_other.id
		and payload.other_collider_id == self.expected_other:get_component(collider_2d_component).id,
		'packed GEO result indices named an omitted empty source instead of the real collider')
end

return {
	kind = 'unit',
	tests = {
		compact_indices_and_empty_contact_lifetime = function()
			local owner<const> = getmetatable(world).new()
			owner:configure({ framebuffer_count = 1, gameplay_interval_vblanks = 1, frame_interval_vblanks = 1,
				spaces = { 'test' }, systems = {} })
			-- Authored/source indices 0 and 2 stay empty. Hardware indices 0,1,2
			-- must map back to these concrete colliders at source indices 1,3,4.
			local empty_before<const> = owner:spawn(definition_id, {})
			local a<const> = owner:spawn(definition_id, { contact_phases = {} })
			local empty_between<const> = owner:spawn(definition_id, {})
			local b<const> = owner:spawn(definition_id, {})
			local c<const> = owner:spawn(definition_id, {})
			local strip_a<const> = a:get_component(tile_strip_component)
			local strip_b<const> = b:get_component(tile_strip_component)
			local strip_c<const> = c:get_component(tile_strip_component)
			strip_a:set_range(0, 0)
			strip_b:set_range(0, 0)
			strip_c:set_range(0, 0)
			b.spatial:set_local_origin(33, 32)
			c.spatial:set_local_origin(32, 33)
			local ca<const> = a:get_component(collider_2d_component)
			local cb<const> = b:get_component(collider_2d_component)
			local cc<const> = c:get_component(collider_2d_component)
			local ce0<const> = empty_before:get_component(collider_2d_component)
			local ce2<const> = empty_between:get_component(collider_2d_component)
			local sources<const> = { ce0, ca, ce2, cb, cc }
			local pairs<const> = scratch_record_batch.new(3)
			assert(collision_2d.collect_overlaps(sources, 5, pairs) == 3,
				'real GEO did not consume all compacted 24-byte instance records')
			local seen = 0
			for index = 1, 3 do
				local pair<const> = pairs.items[index]
				if pair.a == ca and pair.b == cb then seen = seen | 1
				elseif pair.a == ca and pair.b == cc then seen = seen | 2
				elseif pair.a == cb and pair.b == cc then seen = seen | 4
				else error('packed hardware indices were used as un-compacted source indices') end
			end
			assert(seen == 7, 'compaction duplicated or dropped an actual collider pair')
			assert(collision_2d.collides(ce0, ca) == nil and collision_2d.collides(ca, ce2) == nil,
				'direct pair query fabricated empty source geometry')
			assert(collision_2d.collides(ca, cb) ~= nil,
				'direct GEO pair did not use the same admitted instance stride')
			strip_b:set_range(0, -1)
			strip_c:set_range(0, -1)
			assert(collision_2d.collect_overlaps(sources, 5, pairs) == 0,
				'one participating shape fabricated a full-pass pair')
			strip_a:set_range(0, -1)
			assert(collision_2d.collect_overlaps(sources, 5, pairs) == 0,
				'all-empty sources fabricated a full-pass pair')

			strip_a:set_range(0, 0)
			strip_b:set_range(0, 2)
			a.expected_other = b
			a.events:on({ event = 'overlap.begin', handler = record_phase })
			a.events:on({ event = 'overlap.stay', handler = record_phase })
			a.events:on({ event = 'overlap.end', handler = record_phase })
			local overlap<const> = overlap_2d_system.new(owner)
			overlap:update()
			strip_b:set_range(0, 0)
			overlap:update()
			strip_b:set_range(0, -1)
			overlap:update()
			overlap:update()
			strip_b:set_range(0, 2)
			overlap:update()
			local phases<const> = a.contact_phases
			assert(#phases == 4 and phases[1] == 'begin' and phases[2] == 'stay'
				and phases[3] == 'end' and phases[4] == 'begin',
				'shrink/empty/re-expansion did not retire and replace the actual physical contact')
			owner:clear()
			assert(strip_a._collider == nil and strip_b._collider == nil and strip_c._collider == nil,
				'teardown retained a concrete strip geometry binding')
			for _ = 1, 5 do geometry_pool.acquire(pool) end
			assert(not pcall(geometry_pool.acquire, pool), 'real collider teardown lost or grew a fixed pool slot')
		end,
	},
}
