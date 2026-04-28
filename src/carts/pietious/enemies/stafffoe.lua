local constants<const> = require('constants')
local behaviourtree<const> = require('bios/behaviourtree')
local enemy_base<const> = require('enemies/enemy_base')

local stafffoe<const> = {}
stafffoe.__index = stafffoe

local staff_shot_speed_x<const> = { 16, 15, 11, 6, 0, -6, -11, -15, -16, -15, -11, -6, 0, 6, 11, 15 }
local staff_shot_speed_y<const> = { 0, 6, 11, 15, 16, 15, 11, 6, 0, -6, -11, -15, -16, -15, -11, -6 }

function stafffoe:ctor()
	self.staff_state = 'default'
	self.staff_spawn_count = 0
	self:gfx('stafffoe')
end

function stafffoe.bt_tick(self, blackboard)
	local node<const> = blackboard.nodedata
	if self.staff_state == 'default' then
		local wait_ticks = node.staff_wait_ticks or constants.enemy.staff_wait_before_spawn_state_steps
		wait_ticks = wait_ticks - 1
		if wait_ticks > 0 then
			node.staff_wait_ticks = wait_ticks
			return 'RUNNING'
		end
		self.staff_state = 'spawning'
		self.staff_spawn_count = 0
		node.staff_wait_ticks = constants.enemy.staff_wait_before_spawn_steps
		return 'RUNNING'
	end

	if self.staff_spawn_count >= constants.enemy.staff_spawn_burst_count then
		self.staff_state = 'default'
		node.staff_wait_ticks = constants.enemy.staff_wait_before_spawn_state_steps
		return 'RUNNING'
	end

	local spawn_wait = node.staff_wait_ticks or constants.enemy.staff_wait_before_spawn_steps
	spawn_wait = spawn_wait - 1
	if spawn_wait > 0 then
		node.staff_wait_ticks = spawn_wait
		return 'RUNNING'
	end

	local player<const> = oget('pietolon')
	local bullets_dangerous<const> = not player.inventory_items.greenvase
	local base_vector_index<const> = math.random(0, 15)
	for i = 0, 3 do
		local vector_index<const> = ((base_vector_index + (i * 4)) % 16) + 1
		local speed_x_num<const> = staff_shot_speed_x[vector_index]
		local speed_y_num<const> = staff_shot_speed_y[vector_index]
		inst('enemy.staffspawn', {
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
	oget('c').events:emit('staffspawn')
	self.staff_spawn_count = self.staff_spawn_count + 1
	node.staff_wait_ticks = constants.enemy.staff_wait_before_spawn_steps
	return 'RUNNING'
end

function stafffoe.register_behaviour_tree(bt_id)
	behaviourtree.register_definition(bt_id, {
		root = {
			type = 'ACTION',
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
		def_id = 'enemy.stafffoe',
		class = stafffoe,
		type = 'sprite',
		bts = { 'enemy_stafffoe' },
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
			enemy_kind = 'stafffoe',
		},
	})
end

return stafffoe
