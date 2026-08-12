local prefab<const> = require('cartlib/world/prefab')
local spriteobject<const> = require('cartlib/sprite')
local world<const> = require('cartlib/world/world')
require('constants')
local behaviourtree<const> = require('cartlib/behaviourtree/bt')
local bt_running<const> = behaviourtree.result.running
local behaviourtreelibrary<const> = require('cartlib/behaviourtree/library')
local btcomponent<const> = require('cartlib/behaviourtree/btcomponent')
local enemy_base<const> = require('enemies/enemy_base')

local stafffoe<const> = {}
stafffoe.__index = stafffoe

local staff_shot_speed_x<const> = { 16, 15, 11, 6, 0, -6, -11, -15, -16, -15, -11, -6, 0, 6, 11, 15 }
local staff_shot_speed_y<const> = { 0, 6, 11, 15, 16, 15, 11, 6, 0, -6, -11, -15, -16, -15, -11, -6 }

function stafffoe:ctor()
	self.staff_state = 'default'
	self.staff_spawn_count = 0
	self:set_imgid('stafffoe')
end

function stafffoe.bt_tick(self, blackboard)
	local node<const> = blackboard.node_data
	if self.staff_state == 'default' then
		local wait_ticks = node.staff_wait_ticks or enemy_staff_wait_before_spawn_state_steps
		wait_ticks = wait_ticks - 1
		if wait_ticks > 0 then
			node.staff_wait_ticks = wait_ticks
			return bt_running
		end
		self.staff_state = 'spawning'
		self.staff_spawn_count = 0
		node.staff_wait_ticks = enemy_staff_wait_before_spawn_steps
		return bt_running
	end

	if self.staff_spawn_count >= enemy_staff_spawn_burst_count then
		self.staff_state = 'default'
		node.staff_wait_ticks = enemy_staff_wait_before_spawn_state_steps
		return bt_running
	end

	local spawn_wait = node.staff_wait_ticks or enemy_staff_wait_before_spawn_steps
	spawn_wait = spawn_wait - 1
	if spawn_wait > 0 then
		node.staff_wait_ticks = spawn_wait
		return bt_running
	end

	local player<const> = self.player
	local bullets_dangerous<const> = not player.inventory_items.greenvase
	local base_vector_index<const> = math.random(0, 15)
	for i = 0, 3 do
		local vector_index<const> = ((base_vector_index + (i * 4)) % 16) + 1
		local speed_x_num<const> = staff_shot_speed_x[vector_index]
		local speed_y_num<const> = staff_shot_speed_y[vector_index]
		world:spawn('enemy.staffspawn', {
			castle = self.castle,
			room = self.room,
			player = player,
			direction = speed_x_num < 0 and 'left' or 'right',
			speed_x_num = speed_x_num,
			speed_y_num = speed_y_num,
			speed_den = enemy_staff_bullet_speed_den,
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
	self.castle.events:emit('staffspawn')
	self.staff_spawn_count = self.staff_spawn_count + 1
	node.staff_wait_ticks = enemy_staff_wait_before_spawn_steps
	return bt_running
end

function stafffoe.choose_drop_type(_self)
	return 'life'
end

enemy_base.extend(stafffoe, 'stafffoe')

function stafffoe.register()
	local root<const> = behaviourtree.action_node.new('enemy_stafffoe', stafffoe.bt_tick)
	behaviourtreelibrary.register(root)
	prefab.define({
		def_id = 'enemy.stafffoe',
		class = stafffoe,
		base = spriteobject,
		components = { btcomponent.factory(root.id) },
		defaults = {
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
