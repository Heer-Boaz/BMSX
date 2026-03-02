local constants = require('constants')
local behaviourtree = require('behaviourtree')
local enemy_base = require('enemies/enemy_base')

local mijterfoe = {}
mijterfoe.__index = mijterfoe

local function new_random_direction(self)
	local horizontal = 0
	local vertical = 0
	while horizontal == 0 and vertical == 0 do
		horizontal = math.random(-1, 1)
		vertical = math.random(-1, 1)
	end
	self.horizontal_dir_mod = horizontal
	self.vertical_dir_mod = vertical
end

local function set_takeoff_heading(self)
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

local function player_triggered_takeoff(self, player)
	local player_left = player.x
	local player_top = player.y
	local player_right = player.x + player.width
	local player_bottom = player.y + player.height
	local enemy_left = self.x + 2
	local enemy_top = self.y + 2
	local enemy_right = self.x + 14
	local enemy_bottom = self.y + 14
	local overlap_x = player_right >= enemy_left and player_left <= enemy_right
	local overlap_y = player_bottom >= enemy_top and player_top <= enemy_bottom

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

local function start_flying(self, blackboard)
	set_takeoff_heading(self)
	self.mijter_state = 'flying'
	self:change_sprite_on_direction()
	blackboard.nodedata.mijter_takeoff_ticks = math.random(constants.enemy.mijter_wait_takeoff_min_steps, constants.enemy.mijter_wait_takeoff_max_steps)
	blackboard.nodedata.mijter_turn_ticks = math.random(constants.enemy.mijter_turn_min_steps, constants.enemy.mijter_turn_max_steps)
	self.events:emit('takeoff')
	return behaviourtree.running
end

function mijterfoe:ctor()
	self.mijter_state = 'waiting'
	self.horizontal_dir_mod = 0
	self.vertical_dir_mod = 0
	self.mijter_entry_lock_ticks = constants.enemy.mijter_room_entry_lock_steps
	self:change_sprite_on_direction()
end

function mijterfoe.change_sprite_on_direction(self)
	local imgid
	local flip_h
	local flip_v
	local h = self.horizontal_dir_mod
	local v = self.vertical_dir_mod
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
	self:gfx(imgid)
	self.sprite_component.flip.flip_h = flip_h
	self.sprite_component.flip.flip_v = flip_v
end

function mijterfoe.bt_tick_waiting(self, blackboard)
	local entry_lock = blackboard.nodedata.mijter_entry_lock_ticks
	if entry_lock == nil then
		entry_lock = self.mijter_entry_lock_ticks
	end
	if entry_lock > 0 then
		blackboard.nodedata.mijter_entry_lock_ticks = entry_lock - 1
		return behaviourtree.running
	end
	blackboard.nodedata.mijter_entry_lock_ticks = 0

	local player = object('pietolon')
	if player_triggered_takeoff(self, player) then
		return start_flying(self, blackboard)
	end

	local takeoff_ticks = blackboard.nodedata.mijter_takeoff_ticks
	if takeoff_ticks == nil then
		takeoff_ticks = math.random(constants.enemy.mijter_wait_takeoff_min_steps, constants.enemy.mijter_wait_takeoff_max_steps)
	end
	takeoff_ticks = takeoff_ticks - 1
	if takeoff_ticks > 0 then
		blackboard.nodedata.mijter_takeoff_ticks = takeoff_ticks
		return behaviourtree.running
	end
	return start_flying(self, blackboard)
end

function mijterfoe.bt_tick_flying(self, blackboard)
	local turn_ticks = blackboard.nodedata.mijter_turn_ticks
	if turn_ticks == nil then
		turn_ticks = math.random(constants.enemy.mijter_turn_min_steps, constants.enemy.mijter_turn_max_steps)
	end
	turn_ticks = turn_ticks - 1
	if turn_ticks <= 0 then
		new_random_direction(self)
		turn_ticks = math.random(constants.enemy.mijter_turn_min_steps, constants.enemy.mijter_turn_max_steps)
		self:change_sprite_on_direction()
	end
	blackboard.nodedata.mijter_turn_ticks = turn_ticks

	if self.x <= 0 then
		self.horizontal_dir_mod = 1
	elseif self.x + 14 >= object('c').current_room.world_width then
		self.horizontal_dir_mod = -1
	end
	if self.y <= object('c').current_room.world_top then
		self.vertical_dir_mod = 1
	elseif self.y + 14 >= object('c').current_room.world_height then
		self.vertical_dir_mod = -1
	end

	self:change_sprite_on_direction()
	self.x = self.x + (constants.enemy.mijter_speed_px * self.horizontal_dir_mod)
	self.y = self.y + (constants.enemy.mijter_speed_px * self.vertical_dir_mod)
	return behaviourtree.running
end

function mijterfoe.bt_tick(self, blackboard)
	if self.mijter_state == 'waiting' then
		return mijterfoe.bt_tick_waiting(self, blackboard)
	end
	return mijterfoe.bt_tick_flying(self, blackboard)
end

function mijterfoe.register_behaviour_tree(bt_id)
	behaviourtree.register_definition(bt_id, {
		root = {
			type = 'action',
			action = function(target, blackboard)
				return mijterfoe.bt_tick(target, blackboard)
			end,
		},
	})
end

function mijterfoe.choose_drop_type(_self)
	if math.random(100) <= constants.enemy.mijter_drop_health_chance_pct then
		return 'life'
	end
	if math.random(100) <= constants.enemy.mijter_drop_ammo_chance_pct then
		return 'ammo'
	end
	return nil
end

enemy_base.extend(mijterfoe, 'mijterfoe')

function mijterfoe.register_enemy_definition()
	define_prefab({
		def_id = 'enemy.mijterfoe',
		class = mijterfoe,
		type = 'sprite',
		bts = { 'enemy_mijterfoe' },
		defaults = {
			trigger = nil,
			conditions = {},
			damage = 2,
			max_health = 1,
			health = 1,dangerous = true,
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
