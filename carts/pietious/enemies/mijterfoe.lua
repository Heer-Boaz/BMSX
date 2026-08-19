local prefab<const> = require('cartlib/world/prefab')
require('constants')
local bt_result<const> = require('cartlib/behaviour_tree/result')
local bt_running<const> = bt_result.running
local bt_success<const> = bt_result.success
local behaviour_tree_library<const> = require('cartlib/behaviour_tree/library')
local bt_component<const> = require('cartlib/behaviour_tree/bt_component')
local enemy_base<const> = require('enemies/enemy_base')

local mijterfoe<const> = {}
mijterfoe.__index = mijterfoe

local new_random_direction<const> = function(self)
	local horizontal = 0
	local vertical = 0
	while horizontal == 0 and vertical == 0 do
		horizontal = math.random(-1, 1)
		vertical = math.random(-1, 1)
	end
	self.horizontal_dir_mod = horizontal
	self.vertical_dir_mod = vertical
end

local set_takeoff_heading<const> = function(self)
	if self.direction == 'up' then
		self.horizontal_dir_mod = 0
		self.vertical_dir_mod = -1
	elseif self.direction == 'right' then
		self.horizontal_dir_mod = 1
		self.vertical_dir_mod = 0
	elseif self.direction == 'down' then
		self.horizontal_dir_mod = 0
		self.vertical_dir_mod = 1
	else
		self.horizontal_dir_mod = -1
		self.vertical_dir_mod = 0
	end
end

local player_triggered_takeoff<const> = function(self, player)
	local player_left<const> = player.x
	local player_top<const> = player.y
	local player_right<const> = player.x + player.width
	local player_bottom<const> = player.y + player.height
	local enemy_left<const> = self.x + 2
	local enemy_top<const> = self.y + 2
	local enemy_right<const> = self.x + 14
	local enemy_bottom<const> = self.y + 14
	local overlap_x<const> = player_right >= enemy_left and player_left <= enemy_right
	local overlap_y<const> = player_bottom >= enemy_top and player_top <= enemy_bottom

	if self.direction == 'up' then
		return overlap_x and player_top < enemy_top
	end
	if self.direction == 'right' then
		return overlap_y and player_left > enemy_right
	end
	if self.direction == 'down' then
		return overlap_x and player_top > enemy_bottom
	end
	return overlap_y and player_right < enemy_left
end

function mijterfoe:ctor()
	self.horizontal_dir_mod = 0
	self.vertical_dir_mod = 0
	self:change_sprite_on_direction()
end

function mijterfoe.change_sprite_on_direction(self)
	local imgid
	local flip_h
	local flip_v
	local h<const> = self.horizontal_dir_mod
	local v<const> = self.vertical_dir_mod
	if v == -1 and h == 0 then
		imgid = 'meijter_up'
		flip_h = false
		flip_v = false
	elseif v == -1 and h == 1 then
		imgid = 'meijter_dr'
		flip_h = false
		flip_v = true
	elseif v == 0 and h == 1 then
		imgid = 'meijter_r'
		flip_h = false
		flip_v = false
	elseif v == 1 and h == 1 then
		imgid = 'meijter_dr'
		flip_h = false
		flip_v = false
	elseif v == 1 and h == 0 then
		imgid = 'meijter_up'
		flip_h = false
		flip_v = true
	elseif v == 1 and h == -1 then
		imgid = 'meijter_dr'
		flip_h = true
		flip_v = false
	elseif v == 0 and h == -1 then
		imgid = 'meijter_r'
		flip_h = true
		flip_v = false
	else
		imgid = 'meijter_dr'
		flip_h = true
		flip_v = true
	end
	self:set_imgid(imgid)
	self.sprite_component.flip_h = flip_h
	self.sprite_component.flip_v = flip_v
end

function mijterfoe.await_player_takeoff(self)
	if player_triggered_takeoff(self, self.player) then
		return bt_success
	end
	return bt_running
end

function mijterfoe.execute_flight(self, node_memory)
	set_takeoff_heading(self)
	self:change_sprite_on_direction()
	node_memory.next_takeoff_ticks = math.random(
		enemy_mijter_wait_takeoff_min_steps,
		enemy_mijter_wait_takeoff_max_steps
	)
	node_memory.turn_ticks = math.random(enemy_mijter_turn_min_steps, enemy_mijter_turn_max_steps)
	self.events:emit('takeoff')
	return bt_running
end

function mijterfoe.tick_flight(self, node_memory)
	local turn_ticks = node_memory.turn_ticks
	turn_ticks = turn_ticks - 1
	if turn_ticks <= 0 then
		new_random_direction(self)
		turn_ticks = math.random(enemy_mijter_turn_min_steps, enemy_mijter_turn_max_steps)
		self:change_sprite_on_direction()
	end
	node_memory.turn_ticks = turn_ticks

	if self.x <= 0 then
		self.horizontal_dir_mod = 1
	elseif self.x + 14 >= self.room.world_width then
		self.horizontal_dir_mod = -1
	end
	if self.y <= self.room.world_top then
		self.vertical_dir_mod = 1
	elseif self.y + 14 >= self.room.world_height then
		self.vertical_dir_mod = -1
	end

	self:change_sprite_on_direction()
	self.x = self.x + (enemy_mijter_speed_px * self.horizontal_dir_mod)
	self.y = self.y + (enemy_mijter_speed_px * self.vertical_dir_mod)
	return bt_running
end

function mijterfoe.choose_drop_type(_self)
	if math.random(100) <= enemy_mijter_drop_health_chance_pct then
		return 'life'
	end
	if math.random(100) <= enemy_mijter_drop_ammo_chance_pct then
		return 'ammo'
	end
	return nil
end

function mijterfoe.register()
	local tree_id<const> = 'enemy_mijterfoe'
	behaviour_tree_library.register(tree_id, {
		root = {
			type = 'sequence',
			children = {
				{
					type = 'wait',
					duration_ticks = enemy_mijter_room_entry_lock_steps,
				},
				{
					type = 'parallel_one',
					children = {
						{
							type = 'task',
							tick = mijterfoe.await_player_takeoff,
						},
						{
							type = 'wait',
							minimum_duration_ticks = enemy_mijter_wait_takeoff_min_steps - 1,
							maximum_duration_ticks = enemy_mijter_wait_takeoff_max_steps - 1,
						},
					},
				},
				{
					type = 'task',
					node_memory = true,
					execute = mijterfoe.execute_flight,
					tick = mijterfoe.tick_flight,
				},
			},
		},
	})
	prefab.define({
		def_id = 'enemy.mijterfoe',
		class = mijterfoe,
		base = enemy_base,
		components = { enemy_base.new_collider, bt_component.factory(tree_id) },
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
			direction = 'right',
			enemy_kind = 'mijterfoe',
		},
	})
end

return mijterfoe
