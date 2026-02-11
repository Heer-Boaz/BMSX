local constants = require('constants.lua')
local behaviourtree = require('behaviourtree')

local player_id = constants.ids.player_instance

local stafffoe = {}

function stafffoe.configure(self, def, _context)
	self.width = def.w or 21
	self.height = def.h or 30
	self.max_health = def.health or 10
	self.health = self.max_health
	self.damage = def.damage or 4
	self:set_body_hit_area(0, 0, 21, 30)
end

function stafffoe.update_visual(_self)
	return 'stafffoe', false, false
end

function stafffoe.bt_tick(self, blackboard, random_between, speed_components_from_angle)
	local node = blackboard.nodedata
	if self.staff_state == 'default' then
		local wait_ticks = node.staff_wait_ticks
		if wait_ticks == nil then
			wait_ticks = constants.enemy.staff_wait_before_spawn_state_steps
		end
		wait_ticks = wait_ticks - 1
		if wait_ticks > 0 then
			node.staff_wait_ticks = wait_ticks
			return behaviourtree.running
		end
		self.staff_state = 'spawning'
		self.staff_spawn_count = 0
		node.staff_wait_ticks = constants.enemy.staff_wait_before_spawn_steps
		return behaviourtree.running
	end

	if self.staff_spawn_count >= constants.enemy.staff_spawn_burst_count then
		self.staff_state = 'default'
		node.staff_wait_ticks = constants.enemy.staff_wait_before_spawn_state_steps
		return behaviourtree.running
	end

	local spawn_wait = node.staff_wait_ticks
	if spawn_wait == nil then
		spawn_wait = constants.enemy.staff_wait_before_spawn_steps
	end
	spawn_wait = spawn_wait - 1
	if spawn_wait > 0 then
		node.staff_wait_ticks = spawn_wait
		return behaviourtree.running
	end

	local player = object(player_id)
	local bullets_dangerous = not player:has_inventory_item('greenvase')
	local base_angle = random_between(0, 359)
	for i = 0, 3 do
		local angle = (base_angle + (i * 90)) % 360
		local speed_x_num, speed_y_num = speed_components_from_angle(constants.enemy.staff_bullet_speed_num, angle)
		self:spawn_child_enemy('staffspawn', self.x, self.y, {
			direction = speed_x_num < 0 and 'left' or 'right',
			speedx = speed_x_num,
			speedy = speed_y_num,
			speedden = constants.enemy.staff_bullet_speed_den,
			dangerous = bullets_dangerous,
		})
	end
	self.staff_spawn_count = self.staff_spawn_count + 1
	node.staff_wait_ticks = constants.enemy.staff_wait_before_spawn_steps
	return behaviourtree.running
end

function stafffoe.choose_drop_type(_self, _random_percent_hit)
	return 'life'
end

return stafffoe
