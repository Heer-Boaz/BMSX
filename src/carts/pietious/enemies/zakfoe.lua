local constants = require('constants.lua')
local behaviourtree = require('behaviourtree')

local zakfoe = {}

function zakfoe.configure(_self, _def, _context)
end

function zakfoe.update_visual(self)
	local imgid = 'zakfoe_stand'
	if self.zak_state == 'jump' then
		imgid = 'zakfoe_jump'
	elseif self.zak_state == 'recovery' then
		imgid = 'zakfoe_recover'
	end
	return imgid, self.direction == 'left', false
end

function zakfoe.bt_tick(self, blackboard)
	local node = blackboard.nodedata
	local tile_size = self.room.tile_size

	if self.zak_state == 'prepare' then
		local prepare_ticks = node.zak_prepare_ticks
		if prepare_ticks == nil then
			prepare_ticks = constants.enemy.zak_prepare_jump_steps
		end
		prepare_ticks = prepare_ticks - 1
		if prepare_ticks > 0 then
			node.zak_prepare_ticks = prepare_ticks
			return behaviourtree.running
		end
		node.zak_prepare_ticks = nil
		self.current_vertical_speed = constants.enemy.zak_vertical_speed_start
		self.zak_ground_y = self.spawn_y
		self.zak_state = 'jump'
		node.zak_jump_ticks = constants.enemy.zak_jump_steps
		return behaviourtree.running
	end

	if self.zak_state == 'jump' then
		local jump_ticks = node.zak_jump_ticks
		if jump_ticks == nil then
			jump_ticks = constants.enemy.zak_jump_steps
		end

		local direction_mod = self.direction == 'right' and 1 or -1
		self.x = self.x + (constants.enemy.zak_horizontal_speed_px * direction_mod)
		self.y = self.y + self.current_vertical_speed
		self.current_vertical_speed = self.current_vertical_speed + constants.enemy.zak_vertical_speed_step

		if self.direction == 'left' then
			if self.x < self.room_left
				or self:is_collision_tile(self.x + 2, self.y + 2)
				or not self:is_collision_tile(self.x + 2 - (tile_size / 2), self.y + 14 + tile_size)
			then
				self.direction = 'right'
			end
		else
			if self.x + 14 >= self.room_right
				or self:is_collision_tile(self.x + 14, self.y + 2)
				or not self:is_collision_tile(self.x + 14 + (tile_size / 2), self.y + 14 + tile_size)
			then
				self.direction = 'left'
			end
		end

		jump_ticks = jump_ticks - 1
		if jump_ticks > 0 then
			node.zak_jump_ticks = jump_ticks
			return behaviourtree.running
		end
		node.zak_jump_ticks = nil
		self.y = self.zak_ground_y
		self.zak_state = 'recovery'
		node.zak_recovery_ticks = constants.enemy.zak_recovery_steps
		return behaviourtree.running
	end

	local recovery_ticks = node.zak_recovery_ticks
	if recovery_ticks == nil then
		recovery_ticks = constants.enemy.zak_recovery_steps
	end
	recovery_ticks = recovery_ticks - 1
	if recovery_ticks > 0 then
		node.zak_recovery_ticks = recovery_ticks
		return behaviourtree.running
	end
	node.zak_recovery_ticks = nil
	self.zak_state = 'prepare'
	node.zak_prepare_ticks = constants.enemy.zak_prepare_jump_steps
	return behaviourtree.running
end

function zakfoe.choose_drop_type(_self, random_percent_hit)
	if random_percent_hit(constants.enemy.zak_drop_health_chance_pct) then
		return 'life'
	end
	if random_percent_hit(constants.enemy.zak_drop_ammo_chance_pct) then
		return 'ammo'
	end
	return 'none'
end

return zakfoe
