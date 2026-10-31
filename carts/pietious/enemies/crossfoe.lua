local prefab<const> = require('cartlib/world/prefab')
require('constants')
local bt_result<const> = require('cartlib/behaviour_tree/result')
local bt_running<const> = bt_result.running
local bt_success<const> = bt_result.success
local behaviour_tree_library<const> = require('cartlib/behaviour_tree/library')
local bt_component<const> = require('cartlib/behaviour_tree/bt_component')
local kinematic_movement_component<const> = require('cartlib/physics/kinematic_movement_component')
local enemy_base<const> = require('enemies/enemy_base')

local crossfoe<const> = {}
crossfoe.__index = crossfoe
setmetatable(crossfoe, { __index = enemy_base })

local upright_collision_left<const> = 4
local upright_collision_top<const> = 2
local upright_collision_right<const> = 12
local upright_collision_bottom<const> = 22
local upright_support_probe_x<const> = 8
local upright_support_probe_y<const> = 24
local turned_collision_left<const> = 2
local turned_collision_top<const> = 4
local turned_collision_right<const> = 22
local turned_collision_bottom<const> = 12

local apply_spin_state<const> = function(self)
	local imgid
	local flip_h
	local flip_v
	local collision_left
	local collision_top
	local collision_right
	local collision_bottom
	if self.cross_spin_direction == 'left' then
		imgid = 'crossfoe_turned'
		flip_h = false
		flip_v = false
		collision_left = turned_collision_left
		collision_top = turned_collision_top
		collision_right = turned_collision_right
		collision_bottom = turned_collision_bottom
	elseif self.cross_spin_direction == 'right' then
		imgid = 'crossfoe_turned'
		flip_h = true
		flip_v = false
		collision_left = turned_collision_left
		collision_top = turned_collision_top
		collision_right = turned_collision_right
		collision_bottom = turned_collision_bottom
	elseif self.cross_spin_direction == 'up' then
		imgid = 'crossfoe'
		flip_h = false
		flip_v = true
		collision_left = upright_collision_left
		collision_top = upright_collision_top
		collision_right = upright_collision_right
		collision_bottom = upright_collision_bottom
	else
		imgid = 'crossfoe'
		flip_h = false
		flip_v = false
		collision_left = upright_collision_left
		collision_top = upright_collision_top
		collision_right = upright_collision_right
		collision_bottom = upright_collision_bottom
	end
	self.sprite_component:set_imgid(imgid)
	self.sprite_component.flip_h = flip_h
	self.sprite_component.flip_v = flip_v
	self.movement:set_footprint(
		collision_left,
		collision_top,
		collision_right,
		collision_bottom
	)
end

function crossfoe:ctor()
	self.movement = self:get_component(kinematic_movement_component)
	self.movement:set_collision_world(self.room)
	self.cross_spin_direction = 'down'
	apply_spin_state(self)
end

function crossfoe.player_overlaps_takeoff_lane(self)
	local _<const>, pose_y<const> = self:get_global_position()
	local _<const>, target_y<const> = self.player:get_global_position()
	local player<const> = self.player
	return target_y + player.height >= pose_y
		and target_y <= pose_y + upright_collision_bottom
end

function crossfoe.execute_flight(self, node_memory)
	local pose_x<const> = self:get_global_position()
	local target_x<const> = self.player:get_global_position()
	if target_x < pose_x then
		node_memory.direction_mod = -1
	else
		node_memory.direction_mod = 1
	end
	node_memory.turn_ticks = enemy_cross_turn_steps
	self.cross_spin_direction = 'left'
	apply_spin_state(self)
	self.castle.events:emit('cross')
	return bt_running
end

function crossfoe.tick_flight(self, node_memory)
	local pose_x<const>, pose_y<const> = self:get_global_position()
	local target_x<const> = self.player:get_global_position()
	local player<const> = self.player
	local direction_mod<const> = node_memory.direction_mod

	if (direction_mod < 0 and pose_x < (target_x - player.width))
		or (direction_mod > 0 and pose_x > (target_x + (player.width * 2)))
	then
		local landing_delta_x<const> = -(room_tile_size * direction_mod)
		local landing_x<const> = pose_x + landing_delta_x
		if self.room:has_collision_flags_at_world(
			landing_x + upright_support_probe_x,
			pose_y + upright_support_probe_y,
			collision_flags_solid_mask
		) then
			local committed<const> = self.movement:move_x(landing_delta_x)
			if not committed then
				return bt_running
			end
			self.cross_spin_direction = 'down'
			apply_spin_state(self)
			self.castle.events:emit('crossland')
			return bt_success
		end
	end

	local committed<const>, contacts<const> = self.movement:move_x(enemy_cross_horizontal_speed_px * direction_mod)
	if not committed then
		return bt_running
	end
	if contacts ~= 0 then
		self.cross_spin_direction = 'down'
		apply_spin_state(self)
		self.castle.events:emit('crossland')
		return bt_success
	end

	local turn_ticks = node_memory.turn_ticks
	turn_ticks = turn_ticks - 1
	if turn_ticks > 0 then
		node_memory.turn_ticks = turn_ticks
		return bt_running
	end

	turn_ticks = enemy_cross_turn_steps
	local pivot_origin_x<const>, pivot_y<const> = self:get_global_position()
	local pivot_x
	if self.cross_spin_direction == 'down' then
		self.cross_spin_direction = 'left'
		pivot_x = pivot_origin_x - 4
	elseif self.cross_spin_direction == 'left' then
		self.cross_spin_direction = 'up'
		pivot_x = pivot_origin_x + 4
	elseif self.cross_spin_direction == 'up' then
		self.cross_spin_direction = 'right'
		pivot_x = pivot_origin_x - 4
	else
		self.cross_spin_direction = 'down'
		pivot_x = pivot_origin_x + 4
	end
	self:set_global_position(pivot_x, pivot_y)
	apply_spin_state(self)
	node_memory.turn_ticks = turn_ticks
	return bt_running
end

function crossfoe.choose_drop_type(_self)
	if math.random(100) <= enemy_cross_drop_health_chance_pct then
		return 'life'
	end
	if math.random(100) <= enemy_cross_drop_ammo_chance_pct then
		return 'ammo'
	end
	return nil
end

local tasks<const> = {
	flight = {
		node_memory = true,
		execute = crossfoe.execute_flight,
		tick = crossfoe.tick_flight,
	},
}
local decorators<const> = {
	player_overlaps_takeoff_lane = {
		evaluate = crossfoe.player_overlaps_takeoff_lane,
	},
}

function crossfoe.register()
	local tree_id<const> = 'enemy_crossfoe'
	behaviour_tree_library.register(tree_id, {
		root = {
			type = 'sequence',
			children = {
				{
					type = 'wait',
					duration_ticks = enemy_cross_wait_before_fly_steps,
					decorators = {
						{
							type = 'condition',
							decorator = decorators.player_overlaps_takeoff_lane,
							observer_aborts = 'self',
						},
					},
				},
				{
					type = 'task',
					task = tasks.flight,
				},
			},
		},
	})
	prefab.define({
		def_id = 'enemy.crossfoe',
		class = crossfoe,
		components = {
			enemy_base.new_collider,
			kinematic_movement_component.factory({
				footprint_left = upright_collision_left,
				footprint_top = upright_collision_top,
				footprint_right = upright_collision_right,
				footprint_bottom = upright_collision_bottom,
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
			order = 250,
			imgid = 'crossfoe',
			damage = 4,
			max_health = 3,
			health = 3,
			dangerous = true,
			direction = 'right',
			enemy_kind = 'crossfoe',
		},
	})
end

return crossfoe
