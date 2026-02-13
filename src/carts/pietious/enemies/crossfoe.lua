local constants = require('constants')
local behaviourtree = require('behaviourtree')

local crossfoe = {}

local function apply_spin_visual(self)
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
	self.sprite_component.imgid = imgid
	self.sprite_component.flip.flip_h = flip_h
	self.sprite_component.flip.flip_v = flip_v
end

function crossfoe.configure(self, def)
	self.width = 16
	self.height = 24
	self.cross_state = 'waiting'
	self.cross_spin_direction = 'down'
	apply_spin_visual(self)
end

function crossfoe.bt_tick_waiting(self, blackboard)
	local player = object(constants.ids.player_instance)
	local node = blackboard.nodedata
	apply_spin_visual(self)
	local wait_ticks = node.cross_wait_ticks
	if wait_ticks == nil then
		wait_ticks = constants.enemy.cross_wait_before_fly_steps
	end
	wait_ticks = wait_ticks - 1
	if wait_ticks > 0 then
		node.cross_wait_ticks = wait_ticks
		return behaviourtree.running
	end

	node.cross_wait_ticks = constants.enemy.cross_wait_before_fly_steps
	node.cross_turn_ticks = constants.enemy.cross_turn_steps
	if player.x < self.x then
		self.cross_state = 'flying_left'
	else
		self.cross_state = 'flying_right'
	end
	self.cross_spin_direction = 'left'
	apply_spin_visual(self)
	self:dispatch_state_event('takeoff')
	return behaviourtree.running
end

function crossfoe.bt_tick_flying(self, blackboard)
	local player = object(constants.ids.player_instance)
	local node = blackboard.nodedata
	apply_spin_visual(self)
	local direction_mod = self.cross_state == 'flying_left' and -1 or 1
	local next_x = self.x + (constants.enemy.cross_horizontal_speed_px * direction_mod)
	local next_left = next_x
	local next_right = next_x + self.width

	if (self.cross_state == 'flying_left' and self.x < (player.x - player.width))
		or (self.cross_state == 'flying_right' and self.x > (player.x + (player.width * 2)))
		or next_left < self.room_left
		or next_right > self.room_right
	then
		self.cross_state = 'waiting'
		self.cross_spin_direction = 'down'
		self.x = self.x - (constants.enemy.cross_horizontal_speed_px * direction_mod)
		node.cross_wait_ticks = constants.enemy.cross_wait_before_fly_steps
		node.cross_turn_ticks = constants.enemy.cross_turn_steps
		self:dispatch_state_event('land')
		return behaviourtree.running
	end

	self.x = self.x + (constants.enemy.cross_horizontal_speed_px * direction_mod)

	local turn_ticks = node.cross_turn_ticks
	if turn_ticks == nil then
		turn_ticks = constants.enemy.cross_turn_steps
	end
	turn_ticks = turn_ticks - 1
	if turn_ticks > 0 then
		node.cross_turn_ticks = turn_ticks
		return behaviourtree.running
	end

	turn_ticks = constants.enemy.cross_turn_steps
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
	node.cross_turn_ticks = turn_ticks
	return behaviourtree.running
end

function crossfoe.register_behaviour_tree(bt_id)
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
								return crossfoe.bt_tick_waiting(target, blackboard)
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
								return crossfoe.bt_tick_flying(target, blackboard)
							end,
						},
					},
				},
			},
		},
	})
end

function crossfoe.choose_drop_type(_self, random_percent_hit)
	if random_percent_hit(constants.enemy.cross_drop_health_chance_pct) then
		return 'life'
	end
	if random_percent_hit(constants.enemy.cross_drop_ammo_chance_pct) then
		return 'ammo'
	end
	return 'none'
end

return crossfoe
