local collision_storage<const> = require('collision_storage')
local collider_2d_component<const> = require('cartlib/collision/collider_2d_component')
local fixed_point_velocity_component<const> = require('cartlib/physics/fixed_point_velocity_component')
local prefab<const> = require('cartlib/world/prefab')
local enemy<const> = require('enemies/enemy')
local foe<const> = require('enemies/foe')
require('constants')

local sint_pop<const> = {}
sint_pop.__index = sint_pop
setmetatable(sint_pop, { __index = foe })
local hit_area<const> = {
	left = 0,
	top = 0,
	right = 16,
	bottom = 32,
}

function sint_pop:ctor()
	self.motion = self:get_component(fixed_point_velocity_component)
	self.motion:set_velocity_pixels_per_second(sint_pop_move_to_player_speed_x_px_per_second, 0)
end

function sint_pop:on_destroyed(projectile)
	local pose_x<const>, pose_y<const> = self:get_global_position()
	local formation<const> = self.formation
	local remaining<const> = formation.remaining - 1
	formation.remaining = remaining
	local drop_definition_id
	if remaining == 0 then
		drop_definition_id = ids_roodje_def
	end
	self.scene:spawn(ids_small_explosion_def, {
		position = { x = pose_x, y = pose_y + 8 },
		stage = self.stage,
		drop_definition_id = drop_definition_id,
	})
	self.events:emit('enemy.small.destroyed')
	enemy.on_destroyed(self, projectile)
end

function sint_pop.register()
	prefab.define({
		def_id = ids_sint_pop_def,
		class = sint_pop,
		components = {
			collider_2d_component.factory({
				geometry_pool = collision_storage.area, local_area = hit_area,
				layer = collision_enemy_layer, mask = collision_enemy_mask,
			}),
			fixed_point_velocity_component.new,
		},
		defaults = {
			imgid = assets_sint_pop,
			order = sint_pop_draw_z,
			group_type = sint_pop_group_up,
			flight_phase = sint_pop_flight_approach,
			max_health = 1,
			small_fry = true,
		},
	})
end

return sint_pop
