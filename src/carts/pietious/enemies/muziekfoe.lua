local constants = require('constants.lua')
local behaviourtree = require('behaviourtree')
local room_module = require('room.lua')

local muziekfoe = {}

function muziekfoe.configure(self, def, _context)
	self.width = def.w or 24
	self.height = def.h or 16
	self.max_health = def.health or 3
	self.health = self.max_health
	self.damage = def.damage or 4
	self:set_body_hit_area(0, 0, 24, 16)
end

function muziekfoe.update_visual(_self)
	return 'muziekfoe', false, false
end

function muziekfoe.bt_tick(self, blackboard, get_delta_from_source_to_target_scaled, random_between)
	local node = blackboard.nodedata
	local dir_modifier = self.direction == 'left' and -1 or 1
	local move_accum = node.muziek_move_accum
	if move_accum == nil then
		move_accum = 0
	end
	move_accum = move_accum + constants.enemy.muziek_horizontal_speed_num
	while move_accum >= constants.enemy.muziek_horizontal_speed_den do
		self.x = self.x + dir_modifier
		move_accum = move_accum - constants.enemy.muziek_horizontal_speed_den
	end
	node.muziek_move_accum = move_accum

	if self.direction == 'left' then
		if self.x < self.room_left or room_module.is_solid_at_world(self.room, self.x, self.y) then
			self.direction = 'right'
		end
	else
		if self.x + 24 >= self.room_right or room_module.is_solid_at_world(self.room, self.x + 24, self.y + 16) then
			self.direction = 'left'
		end
	end

	local noot_ticks = node.muziek_noot_ticks
	if noot_ticks == nil then
		noot_ticks = constants.enemy.muziek_spawn_noot_steps
	end
	noot_ticks = noot_ticks - 1
	if noot_ticks <= 0 then
		local player = object(constants.ids.player_instance)
		local source_x = self.x + 12
		local source_y = self.y + 8
		local target_x = player.x
		local target_y = player.y + player.height
		local delta_scale = 8
		local delta_x, delta_y = get_delta_from_source_to_target_scaled(source_x, source_y, target_x, target_y, delta_scale)
		local delta_divisor = random_between(1, 2)
		self:spawn_child_enemy('nootfoe', self.x + 12, self.y, {
			direction = delta_x < 0 and 'left' or 'right',
			speedx = delta_x,
			speedy = delta_y,
			speedden = delta_scale * delta_divisor,
		})
		noot_ticks = constants.enemy.muziek_spawn_noot_steps
	end
	node.muziek_noot_ticks = noot_ticks
	return behaviourtree.running
end

function muziekfoe.choose_drop_type(_self, random_percent_hit)
	if random_percent_hit(constants.enemy.muziek_drop_health_chance_pct) then
		return 'life'
	end
	if random_percent_hit(constants.enemy.muziek_drop_ammo_chance_pct) then
		return 'ammo'
	end
	return 'none'
end

return muziekfoe
