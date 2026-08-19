local prefab<const> = require('cartlib/world/prefab')
require('constants')
local bt_result<const> = require('cartlib/behaviour_tree/result')
local bt_running<const> = bt_result.running
local behaviour_tree_library<const> = require('cartlib/behaviour_tree/library')
local bt_component<const> = require('cartlib/behaviour_tree/bt_component')
local kinematic_movement_component<const> = require('cartlib/physics/kinematic_movement_component')
local enemy_base<const> = require('enemies/enemy_base')

local horizontal_contacts<const> = kinematic_movement_component.contact_left
	| kinematic_movement_component.contact_right
local vertical_contacts<const> = kinematic_movement_component.contact_up
	| kinematic_movement_component.contact_down

local marspeinenaardappel<const> = {}
marspeinenaardappel.__index = marspeinenaardappel

-- disable-next-line single_line_method_pattern -- constructor owns the local enemy sprite id at the class boundary.
function marspeinenaardappel:ctor()
	self.movement = self:get_component(kinematic_movement_component)
	self.movement:set_collision_world(self.room)
	self:set_imgid('marspeinenaardappel')
end

function marspeinenaardappel.move_and_bounce(self)
	local speed_x<const> = self.speed_x_num
	local speed_y<const> = self.speed_y_num
	local contacts<const> = self.movement:move(speed_x, speed_y)
	if (contacts & horizontal_contacts) ~= 0 then
		self.speed_x_num = -speed_x
	end
	if (contacts & vertical_contacts) ~= 0 then
		self.speed_y_num = -speed_y
	end

	return bt_running
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
	local tree_id<const> = 'enemy_marspeinenaardappel'
	behaviour_tree_library.register(tree_id, {
		root = {
			type = 'task',
			tick = marspeinenaardappel.move_and_bounce,
		},
	})
	prefab.define({
		def_id = 'enemy.marspeinenaardappel',
		class = marspeinenaardappel,
		base = enemy_base,
		components = {
			enemy_base.new_collider,
			kinematic_movement_component.factory({
				local_left = 0,
				local_top = 0,
				local_right = room_tile_size,
				local_bottom = room_tile_size,
				world_left = 0,
				world_top = room_hud_height,
				world_right = room_width,
				world_bottom = room_height,
				collision_mask = collision_flags_solid_mask,
				include_elevators = true,
			}),
			bt_component.factory(tree_id),
		},
		defaults = {
			damage = 2,
			max_health = 1,
			health = 1,
			dangerous = true,
			speed_x_num = 0,
			speed_y_num = 0,
			speed_den = 1,
			speed_accum_x = 0,
			speed_accum_y = 0,
			drop_health_chance_pct = enemy_marspein_drop_health_chance_pct,
			drop_ammo_chance_pct = enemy_marspein_drop_ammo_chance_pct,
			direction = 'right',
			enemy_kind = 'marspeinenaardappel',
		},
	})
end

return marspeinenaardappel
