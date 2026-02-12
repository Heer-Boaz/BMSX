local constants = require('constants')
local behaviourtree = require('behaviourtree')

local stafffoe = {}

local function speed_components_from_angle(speed_num, angle_degrees)
	local radians = math.rad(angle_degrees)
	local speed_x_num = round_to_nearest(math.cos(radians) * speed_num)
	local speed_y_num = round_to_nearest(math.sin(radians) * speed_num)
	return speed_x_num, speed_y_num
end

function stafffoe.configure(self, def)
	self.width = def.w or 21
	self.height = def.h or 30
	self.max_health = def.health or 10
	self.health = self.max_health
	self.damage = def.damage or 4
	self.staff_state = 'default'
	self.staff_spawn_count = 0
	self:set_body_hit_area(0, 0, 21, 30)
end

function stafffoe.sync_components(self)
	local imgid = 'stafffoe'
	local flip_h = false
	local flip_v = false
	self:set_body_sprite(imgid, flip_h, flip_v)
end

function stafffoe.bt_tick(self, blackboard)
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

	local player = object(constants.ids.player_instance)
	local bullets_dangerous = not player:has_inventory_item('greenvase')
	local base_angle = math.random(0, 359)
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

function stafffoe.register_behaviour_tree(bt_id)
	behaviourtree.register_definition(bt_id, {
		root = {
			type = 'action',
			action = function(target, blackboard)
				return stafffoe.bt_tick(target, blackboard)
			end,
		},
	})
end

function stafffoe.choose_drop_type(_self, _random_percent_hit)
	return 'life'
end

return stafffoe
