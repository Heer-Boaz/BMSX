local constants = require('constants')
local behaviourtree = require('behaviourtree')

local mijterfoe = {}

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
	blackboard.nodedata.mijter_takeoff_ticks = math.random(constants.enemy.mijter_wait_takeoff_min_steps, constants.enemy.mijter_wait_takeoff_max_steps)
	blackboard.nodedata.mijter_turn_ticks = math.random(constants.enemy.mijter_turn_min_steps, constants.enemy.mijter_turn_max_steps)
	self:dispatch_state_event('takeoff')
	return behaviourtree.running
end

function mijterfoe.configure(self, _def)
	self.horizontal_dir_mod = 0
	self.vertical_dir_mod = 0
	self.mijter_entry_lock_ticks = constants.enemy.mijter_room_entry_lock_steps
end

function mijterfoe.sync_components(self)
	local imgid = 'meijter_up'
	local flip_h = false
	local flip_v = false
	if self:has_tag('e.w') then
		if self.direction == 'left' then
			imgid = 'meijter_r'
			flip_h = true
		elseif self.direction == 'right' then
			imgid = 'meijter_r'
		elseif self.direction == 'down' then
			imgid = 'meijter_up'
			flip_v = true
		end
	else
		local h = self.horizontal_dir_mod
		local v = self.vertical_dir_mod
		if v == -1 and h == 0 then
			imgid = 'meijter_up'
		elseif v == -1 and h == 1 then
			imgid = 'meijter_dr'
			flip_v = true
		elseif v == 0 and h == 1 then
			imgid = 'meijter_r'
		elseif v == 1 and h == 1 then
			imgid = 'meijter_dr'
		elseif v == 1 and h == 0 then
			imgid = 'meijter_up'
			flip_v = true
		elseif v == 1 and h == -1 then
			imgid = 'meijter_dr'
			flip_h = true
		elseif v == 0 and h == -1 then
			imgid = 'meijter_r'
			flip_h = true
		elseif v == -1 and h == -1 then
			imgid = 'meijter_dr'
			flip_h = true
			flip_v = true
		end
	end
	self:set_body_sprite(imgid, flip_h, flip_v)
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

	local player = object(constants.ids.player_instance)
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
	end
	blackboard.nodedata.mijter_turn_ticks = turn_ticks

	if self.x <= self.room_left then
		self.horizontal_dir_mod = 1
	elseif self.x + 14 >= self.room_right then
		self.horizontal_dir_mod = -1
	end
	if self.y <= self.room_top then
		self.vertical_dir_mod = 1
	elseif self.y + 14 >= self.room_bottom then
		self.vertical_dir_mod = -1
	end

	self.x = self.x + (constants.enemy.mijter_speed_px * self.horizontal_dir_mod)
	self.y = self.y + (constants.enemy.mijter_speed_px * self.vertical_dir_mod)
	return behaviourtree.running
end

function mijterfoe.register_behaviour_tree(bt_id)
	behaviourtree.register_definition(bt_id, {
		root = {
			type = 'selector',
			children = {
				{
					type = 'sequence',
					children = {
						{
							type = 'condition',
							condition = function(target)
								return target:has_tag('e.w')
							end,
						},
						{
							type = 'action',
							action = function(target, blackboard)
								return mijterfoe.bt_tick_waiting(target, blackboard)
							end,
						},
					},
				},
				{
					type = 'sequence',
					children = {
						{
							type = 'condition',
							condition = function(target)
								return target:has_tag('e.f')
							end,
						},
						{
							type = 'action',
							action = function(target, blackboard)
								return mijterfoe.bt_tick_flying(target, blackboard)
							end,
						},
					},
				},
			},
		},
	})
end

function mijterfoe.choose_drop_type(_self, random_percent_hit)
	if random_percent_hit(constants.enemy.mijter_drop_health_chance_pct) then
		return 'life'
	end
	if random_percent_hit(constants.enemy.mijter_drop_ammo_chance_pct) then
		return 'ammo'
	end
	return 'none'
end

return mijterfoe
