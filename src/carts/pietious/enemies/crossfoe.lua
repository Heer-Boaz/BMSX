local constants = require('constants')
local behaviourtree = require('behaviourtree')
local room_module = require('room')

local crossfoe = {}

local function cross_hit_area_for_spin(spin_direction)
	if spin_direction == 'left' or spin_direction == 'right' then
		return { left = 2, top = 4, right = 22, bottom = 12 }
	end
	return { left = 4, top = 2, right = 12, bottom = 22 }
end

function crossfoe.configure(self, def, _context)
	self.width = def.w or 16
	self.height = def.h or 24
	self:set_body_hit_area(4, 2, 12, 22)
end

function crossfoe.update_visual(self)
	local imgid = 'crossfoe'
	local flip_h = false
	local flip_v = false
	if self.cross_spin_direction == 'left' then
		imgid = 'crossfoe_turned'
		self:set_body_hit_area(2, 4, 22, 12)
	elseif self.cross_spin_direction == 'right' then
		imgid = 'crossfoe_turned'
		flip_h = true
		self:set_body_hit_area(2, 4, 22, 12)
	elseif self.cross_spin_direction == 'up' then
		imgid = 'crossfoe'
		flip_v = true
		self:set_body_hit_area(4, 2, 12, 22)
	else
		self:set_body_hit_area(4, 2, 12, 22)
	end
	return imgid, flip_h, flip_v
end

function crossfoe.bt_tick_waiting(self, blackboard)
	local player = object(constants.ids.player_instance)
	local node = blackboard.nodedata
	local hit = cross_hit_area_for_spin(self.cross_spin_direction)
	local player_top = player.y
	local player_bottom = player.y + player.height
	local enemy_top = self.y + hit.top
	local enemy_bottom = self.y + hit.bottom
	local overlap_y = player_bottom >= enemy_top and player_top <= enemy_bottom

	if not overlap_y then
		node.cross_wait_ticks = constants.enemy.cross_wait_before_fly_steps
		return behaviourtree.running
	end

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
	self:dispatch_state_event('takeoff')
	return behaviourtree.running
end

function crossfoe.bt_tick_flying(self, blackboard)
	local player = object(constants.ids.player_instance)
	local node = blackboard.nodedata
	local direction_mod = self.cross_state == 'flying_left' and -1 or 1
	local hit = cross_hit_area_for_spin(self.cross_spin_direction)

	if (self.cross_state == 'flying_left' and self.x < (player.x - player.width))
		or (self.cross_state == 'flying_right' and self.x > (player.x + (player.width * 2)))
		or room_module.is_solid_at_world(self.room, self.x + hit.left, self.y + hit.top)
	then
		self.cross_state = 'waiting'
		self.cross_spin_direction = 'down'
		self.x = self.x + (self.room.tile_size * -direction_mod)
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
	node.cross_turn_ticks = turn_ticks
	return behaviourtree.running
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
