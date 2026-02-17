local constants = require('constants')
local behaviourtree = require('behaviourtree')
local enemy_base = require('enemies/enemy_base')

local stafffoe = {}
stafffoe.__index = stafffoe

local function speed_components_from_angle(speed_num, angle_degrees)
	local radians = math.rad(angle_degrees)
	local speed_x_num = round_to_nearest(math.cos(radians) * speed_num)
	local speed_y_num = round_to_nearest(math.sin(radians) * speed_num)
	return speed_x_num, speed_y_num
end

function stafffoe:ctor()
	self.staff_state = 'default'
	self.staff_spawn_count = 0
	self:gfx('stafffoe')
end

function stafffoe.bt_tick(self, blackboard)
	local node = blackboard.nodedata
	local room = service('c').current_room
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

	local player = object('pietolon')
	local bullets_dangerous = player.inventory_items.greenvase ~= true
	local base_angle = math.random(0, 359)
	for i = 0, 3 do
		local angle = (base_angle + (i * 90)) % 360
		local speed_x_num, speed_y_num = speed_components_from_angle(constants.enemy.staff_bullet_speed_num, angle)
		inst('enemy.def.staffspawn', {
			space_id = room.space_id,
			despawn_on_room_switch = true,
			direction = speed_x_num < 0 and 'left' or 'right',
			speed_x_num = speed_x_num,
			speed_y_num = speed_y_num,
			speed_den = constants.enemy.staff_bullet_speed_den,
			speed_accum_x = 0,
			speed_accum_y = 0,
			dangerous = bullets_dangerous,
			pos = {
				x = self.x,
				y = self.y,
				z = 140,
			},
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

function stafffoe.choose_drop_type(_self)
	return 'life'
end

enemy_base.extend(stafffoe, 'stafffoe')

function stafffoe.register_enemy_definition()
	define_prefab({
		def_id = 'enemy.def.stafffoe',
		class = stafffoe,
		type = 'sprite',
		bts = { 'enemy.bt.stafffoe' },
		defaults = {
			conditions = {},
			damage = 4,
			max_health = 10,
			health = 10,dangerous = true,
			speed_x_num = 0,
			speed_y_num = 0,
			speed_den = 1,
			speed_accum_x = 0,
			speed_accum_y = 0,
			direction = 'right',
			despawn_on_room_switch = false,
			enemy_kind = 'stafffoe',
		},
	})
end

return stafffoe
