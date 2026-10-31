local collider_2d_component<const> = require('cartlib/collision/collider_2d_component')
local geometry_pool<const> = require('cartlib/collision/geometry_pool')
local overlap_2d_system<const> = require('cartlib/collision/overlap_2d_system')
local prefab<const> = require('cartlib/world/prefab')
local world<const> = require('cartlib/world/world')

bss geometry: word[32]
local pool<const> = geometry_pool.new(geometry, 64, 2)
local definition_id<const> = 'cartlib_test.overlap_actor'
prefab.define({
	def_id = definition_id, class = {},
	spatial = { family = '2d', authority = 'affine', local_transform = { 1, 0, 0, 1, 32, 32 } },
	components = { collider_2d_component.factory({ geometry_pool = pool, local_area = { left = 0, top = 0, right = 8, bottom = 8 }, layer = 1, mask = 1 }) },
})

local record_phase<const> = function(self, _event, _emitter, payload)
	local phases<const> = self.contact_phases
	phases[#phases + 1] = payload.phase
	if payload.contact ~= nil then self.contact_depth = payload.contact.depth end
end

return {
	kind = 'unit',
	tests = {
		reactivation_replaces_contact = function()
			local owner<const> = getmetatable(world).new()
			owner:configure({ framebuffer_count = 1, gameplay_interval_vblanks = 1, frame_interval_vblanks = 1,
				spaces = { 'test' }, systems = {} })
			local phases<const> = {}
			local a<const> = owner:spawn(definition_id, { contact_phases = phases })
			local b<const> = owner:spawn(definition_id, {})
			local collider<const> = a:get_component(collider_2d_component)
			a.events:on({ event = 'overlap.begin', handler = record_phase })
			a.events:on({ event = 'overlap.stay', handler = record_phase })
			a.events:on({ event = 'overlap.end', handler = record_phase })
			local overlap<const> = overlap_2d_system.new(owner)
			overlap:update()
			assert(phases[1] == 'begin' and #phases == 1 and a.contact_depth == 8,
				'the real GEO pass did not begin the admitted physical contact')
			overlap:update()
			assert(phases[2] == 'stay' and #phases == 2, 'an unchanged contact did not stay')
			collider:set_enabled(false)
			collider:set_enabled(true)
			overlap:update()
			assert(phases[3] == 'end' and phases[4] == 'begin' and #phases == 4,
				'a reactivated collider did not end its old contact before beginning its new contact')
			overlap:update()
			assert(phases[5] == 'stay' and #phases == 5, 'the replacement contact did not stay')
			-- Rotate the exact polygon while retaining the same world square.
			-- A basis publication is not a new contact identity or a replacement AABB.
			a.spatial:set_local_affine(0, 1, -1, 0, 40, 32)
			overlap:update()
			assert(phases[6] == 'stay' and #phases == 6 and a.contact_depth == 8,
				'transformed polygon contact lost its retained identity or exact geometry')
			a.spatial:set_local_origin(80, 32)
			overlap:update()
			assert(phases[7] == 'end' and #phases == 7, 'new physical origin did not retire the old contact')
			owner:clear()
			assert(a.world == nil and b.world == nil and pool._free ~= 0,
				'World retirement did not release the real collider slots')
		end,
	},
}
