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

local upright_collision_left<const> = 4
local upright_collision_top<const> = 2
local upright_collision_right<const> = 12
local upright_collision_bottom<const> = 22
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
	self:set_imgid(imgid)
	self.sprite_component.flip_h = flip_h
	self.sprite_component.flip_v = flip_v
	self.movement:set_local_bounds(
		collision_left,
		collision_top,
		collision_right,
		collision_bottom
	)
end

function crossfoe:ctor()
	self.movement = self:get_component(kinematic_movement_component)
	self.cross_spin_direction = 'down'
	apply_spin_state(self)
end

function crossfoe.await_takeoff(self, node_memory)
	local player<const> = self.player
	if player.y + player.height >= self.y
	and player.y <= self.y + upright_collision_bottom then
		local elapsed_ticks<const> = node_memory.elapsed_ticks or 0
		if elapsed_ticks < enemy_cross_wait_before_fly_steps then
			node_memory.elapsed_ticks = elapsed_ticks + 1
			return bt_running
		end
		node_memory.elapsed_ticks = 0
		return bt_success
	end
	node_memory.elapsed_ticks = 0
	return bt_running
end

function crossfoe.execute_flight(self, node_memory)
	local player<const> = self.player
	if player.x < self.x then
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
	local player<const> = self.player
	local rm<const> = self.room
	local direction_mod<const> = node_memory.direction_mod

	if (direction_mod < 0 and self.x < (player.x - player.width))
		or (direction_mod > 0 and self.x > (player.x + (player.width * 2)))
	then
		self.cross_spin_direction = 'down'
		self.movement:move_x(rm, -(room_tile_size * direction_mod))
		apply_spin_state(self)
		self.castle.events:emit('crossland')
		return bt_success
	end

	if self.movement:move_x(rm, enemy_cross_horizontal_speed_px * direction_mod) ~= 0 then
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
	if self.cross_spin_direction == 'down' then
		self.cross_spin_direction = 'left'
		self.x = self.x - 4
	elseif self.cross_spin_direction == 'left' then
		self.cross_spin_direction = 'up'
		self.x = self.x + 4
	elseif self.cross_spin_direction == 'up' then
		self.cross_spin_direction = 'right'
		self.x = self.x - 4
	else
		self.cross_spin_direction = 'down'
		self.x = self.x + 4
	end
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

function crossfoe.register()
	local tree_id<const> = 'enemy_crossfoe'
	behaviour_tree_library.register(tree_id, {
		root = {
			type = 'loop',
			child = {
				type = 'sequence',
				children = {
					{
						type = 'task',
						node_memory = true,
						tick = crossfoe.await_takeoff,
					},
					{
						type = 'task',
						node_memory = true,
						execute = crossfoe.execute_flight,
						tick = crossfoe.tick_flight,
					},
				},
			},
		},
	})
	prefab.define({
		def_id = 'enemy.crossfoe',
		class = crossfoe,
		base = enemy_base,
		components = {
			enemy_base.new_collider,
			kinematic_movement_component.factory({
				local_left = upright_collision_left,
				local_top = upright_collision_top,
				local_right = upright_collision_right,
				local_bottom = upright_collision_bottom,
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
			damage = 4,
			max_health = 3,
			health = 3,
			dangerous = true,
			speed_x_num = 0,
			speed_y_num = 0,
			speed_den = 1,
			speed_accum_x = 0,
			speed_accum_y = 0,
			direction = 'right',
			enemy_kind = 'crossfoe',
		},
	})
end

return crossfoe
