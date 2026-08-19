local prefab<const> = require('cartlib/world/prefab')
require('constants')
local bt_result<const> = require('cartlib/behaviour_tree/result')
local bt_running<const> = bt_result.running
local bt_success<const> = bt_result.success
local behaviour_tree_library<const> = require('cartlib/behaviour_tree/library')
local bt_component<const> = require('cartlib/behaviour_tree/bt_component')
local enemy_base<const> = require('enemies/enemy_base')

local crossfoe<const> = {}
crossfoe.__index = crossfoe

local apply_spin_visual<const> = function(self)
	local imgid
	local flip_h
	local flip_v
	if self.cross_spin_direction == 'left' then
		imgid = 'crossfoe_turned'
		flip_h = false
		flip_v = false
	elseif self.cross_spin_direction == 'right' then
		imgid = 'crossfoe_turned'
		flip_h = true
		flip_v = false
	elseif self.cross_spin_direction == 'up' then
		imgid = 'crossfoe'
		flip_h = false
		flip_v = true
	else
		imgid = 'crossfoe'
		flip_h = false
		flip_v = false
	end
	self:set_imgid(imgid)
	self.sprite_component.flip_h = flip_h
	self.sprite_component.flip_v = flip_v
end

function crossfoe:ctor()
	self.cross_spin_direction = 'down'
	apply_spin_visual(self)
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
	apply_spin_visual(self)
	self.castle.events:emit('cross')
	return bt_running
end

function crossfoe.tick_flight(self, node_memory)
	local player<const> = self.player
	local direction_mod<const> = node_memory.direction_mod
	local next_x<const> = self.x + (enemy_cross_horizontal_speed_px * direction_mod)
	local next_left<const> = next_x
	local next_right<const> = next_x + self.sx

	if (direction_mod < 0 and self.x < (player.x - player.width))
		or (direction_mod > 0 and self.x > (player.x + (player.width * 2)))
		or next_left < 0
		or next_right > self.room.world_width
	then
		self.cross_spin_direction = 'down'
		self.x = self.x - (enemy_cross_horizontal_speed_px * direction_mod)
		self.castle.events:emit('crossland')
		return bt_success
	end

	self.x = self.x + (enemy_cross_horizontal_speed_px * direction_mod)

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
	apply_spin_visual(self)
	node_memory.turn_ticks = turn_ticks
	return bt_running
end

function crossfoe.finish_landing(self)
	apply_spin_visual(self)
	return bt_success
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
			type = 'sequence',
			children = {
				{
					type = 'wait',
					duration_ticks = enemy_cross_wait_before_fly_steps - 1,
				},
				{
					type = 'loop',
					child = {
						type = 'sequence',
						children = {
							{
								type = 'task',
								node_memory = true,
								execute = crossfoe.execute_flight,
								tick = crossfoe.tick_flight,
							},
							{
								type = 'wait',
								duration_ticks = 1,
							},
							{
								type = 'task',
								execute = crossfoe.finish_landing,
							},
							{
								type = 'wait',
								duration_ticks = enemy_cross_wait_before_fly_steps - 1,
							},
						},
					},
				},
			},
		},
	})
	prefab.define({
		def_id = 'enemy.crossfoe',
		class = crossfoe,
		base = enemy_base,
		components = { enemy_base.new_collider, bt_component.factory(tree_id) },
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
