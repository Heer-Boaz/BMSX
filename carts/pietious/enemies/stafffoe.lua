local prefab<const> = require('cartlib/world/prefab')
local world<const> = require('cartlib/world/world')
require('constants')
local bt_result<const> = require('cartlib/behaviour_tree/result')
local bt_success<const> = bt_result.success
local behaviour_tree_library<const> = require('cartlib/behaviour_tree/library')
local bt_component<const> = require('cartlib/behaviour_tree/bt_component')
local enemy_base<const> = require('enemies/enemy_base')

local stafffoe<const> = {}
stafffoe.__index = stafffoe

local staff_shot_speed_x<const> = { 16, 15, 11, 6, 0, -6, -11, -15, -16, -15, -11, -6, 0, 6, 11, 15 }
local staff_shot_speed_y<const> = { 0, 6, 11, 15, 16, 15, 11, 6, 0, -6, -11, -15, -16, -15, -11, -6 }

function stafffoe.spawn_burst(self)
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
	return bt_success
end

function stafffoe.choose_drop_type(_self)
	return 'life'
end

local tasks<const> = {
	spawn_burst = {
		execute = stafffoe.spawn_burst,
	},
}

function stafffoe.register()
	local tree_id<const> = 'enemy_stafffoe'
	behaviour_tree_library.register(tree_id, {
		root = {
			type = 'sequence',
			children = {
				{
					type = 'wait',
					duration_ticks = enemy_staff_wait_before_spawn_state_steps - 1,
				},
				{
					type = 'loop',
					count = enemy_staff_spawn_burst_count,
					child = {
						type = 'sequence',
						children = {
							{
								type = 'wait',
								duration_ticks = enemy_staff_wait_before_spawn_steps,
							},
							{
								type = 'task',
								task = tasks.spawn_burst,
							},
						},
					},
				},
				{
					type = 'wait',
					duration_ticks = 1,
				},
			},
		},
	})
	prefab.define({
		def_id = 'enemy.stafffoe',
		class = stafffoe,
		base = enemy_base,
		components = { enemy_base.new_collider, bt_component.factory(tree_id) },
		defaults = {
			imgid = 'stafffoe',
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
