local prefab<const> = require('cartlib/world/prefab')
require('constants')
local bouncing_movement_component<const> = require('cartlib/physics/bouncing_movement_component')
local enemy_base<const> = require('enemies/enemy_base')

local movement_profile<const> = {
	footprint_left = 0,
	footprint_top = 0,
	footprint_right = room_tile_size,
	footprint_bottom = room_tile_size,
	world_left = 0,
	world_top = room_hud_height,
	world_right = room_width,
	world_bottom = room_height,
	collision_mask = collision_flags_solid_mask,
	include_elevators = true,
}

local marspeinenaardappel<const> = {}
marspeinenaardappel.__index = marspeinenaardappel
setmetatable(marspeinenaardappel, { __index = enemy_base })

function marspeinenaardappel:ctor()
	local movement<const> = self:get_component(bouncing_movement_component)
	movement.speed_x_num = self.speed_x_num
	movement.speed_y_num = self.speed_y_num
	movement:set_collision_world(self.room)
end

function marspeinenaardappel.choose_drop_type(self)
	if self.drop_health_chance_pct > 0
	and math.random(100) <= self.drop_health_chance_pct then
		return 'life'
	end
	if self.drop_ammo_chance_pct > 0
	and math.random(100) <= self.drop_ammo_chance_pct then
		return 'ammo'
	end
	return nil
end

function marspeinenaardappel.register()
	prefab.define({
		def_id = 'enemy.marspeinenaardappel',
		class = marspeinenaardappel,
		components = {
			enemy_base.new_collider,
			bouncing_movement_component.factory(movement_profile),
		},
		defaults = {
			speed_x_num = 0,
			speed_y_num = 0,
			order = 250,
			imgid = 'marspeinenaardappel',
			damage = 2,
			max_health = 1,
			health = 1,
			dangerous = true,
			drop_health_chance_pct = enemy_marspein_drop_health_chance_pct,
			drop_ammo_chance_pct = enemy_marspein_drop_ammo_chance_pct,
			direction = 'right',
			enemy_kind = 'marspeinenaardappel',
		},
	})
end

return marspeinenaardappel
