local prefab<const> = require('cartlib/world/prefab')
local velocity<const> = require('cartlib/velocity')
local world<const> = require('cartlib/world/world')
require('constants')
local bt_result<const> = require('cartlib/behaviour_tree/result')
local bt_running<const> = bt_result.running
local bt_success<const> = bt_result.success
local behaviour_tree_library<const> = require('cartlib/behaviour_tree/library')
local bt_component<const> = require('cartlib/behaviour_tree/bt_component')
local enemy_base<const> = require('enemies/enemy_base')
local abs<const> = math.abs

local cloud<const> = {}
cloud.__index = cloud

local full_circle_milliradians<const> = 6283
local cloud_wave_pos_start_millirad<const> = 253
local cloud_wave_peak_start_millirad<const> = 848
local cloud_wave_peak_end_millirad<const> = 2294
local cloud_wave_pos_end_millirad<const> = 2889
local cloud_wave_neg_start_millirad<const> = 3394
local cloud_wave_trough_start_millirad<const> = 3990
local cloud_wave_trough_end_millirad<const> = 5435
local cloud_wave_neg_end_millirad<const> = 6030

function cloud:ctor()
	self.cloud_anim_frame = 1
	self:set_imgid('cloud_1')
end

function cloud.execute_move(self, node_memory)
	node_memory.move_accum = 0
	node_memory.wave_accum = 0
	node_memory.wave_phase_millirad = 0
	return cloud.tick_move(self, node_memory)
end

function cloud.tick_move(self, node_memory)
	local room<const> = self.room
	local dir_modifier<const> = self.direction == 'left' and -1 or 1
	local move_x<const>, move_accum<const> = velocity.consume_axis_accum(
		node_memory.move_accum,
		enemy_cloud_horizontal_speed_num,
		enemy_cloud_horizontal_speed_den
	)
	node_memory.move_accum = move_accum
	self.x = self.x + (move_x * dir_modifier)

	local wave_accum<const> = node_memory.wave_accum
	local wave_phase = node_memory.wave_phase_millirad
	local wave_speed_num = 0
	if wave_phase >= cloud_wave_pos_start_millirad and wave_phase < cloud_wave_pos_end_millirad then
		if wave_phase >= cloud_wave_peak_start_millirad and wave_phase < cloud_wave_peak_end_millirad then
			wave_speed_num = 2
		else
			wave_speed_num = 1
		end
	elseif wave_phase >= cloud_wave_neg_start_millirad and wave_phase < cloud_wave_neg_end_millirad then
		if wave_phase >= cloud_wave_trough_start_millirad and wave_phase < cloud_wave_trough_end_millirad then
			wave_speed_num = -2
		else
			wave_speed_num = -1
		end
	end
	local wave_dy<const>, next_wave_accum<const> = velocity.consume_axis_accum(wave_accum, wave_speed_num, enemy_cloud_wave_speed_den)
	self.y = self.y + wave_dy
	wave_phase = wave_phase + enemy_cloud_wave_phase_step_millirad
	if wave_phase >= full_circle_milliradians then
		wave_phase = wave_phase - full_circle_milliradians
	end
	node_memory.wave_accum = next_wave_accum
	node_memory.wave_phase_millirad = wave_phase

	if self.direction == 'left' then
		if self.x < 0 then
			self.direction = 'right'
		end
	else
		if self.x + 22 >= room.world_width then
			self.direction = 'left'
		end
	end
	return bt_running
end

function cloud.advance_animation(self)
	if self.cloud_anim_frame == 1 then
		self.cloud_anim_frame = 2
		self:set_imgid('cloud_2')
	else
		self.cloud_anim_frame = 1
		self:set_imgid('cloud_1')
	end
	return bt_success
end

function cloud.spawn_vlok_burst(self)
	local room<const> = self.room
	for _ = 1, 3 do
		local random_x = 0
		local random_y = 0
		while abs(random_x + random_y) < 2 do
			random_x = math.random(-5, 4)
			random_y = math.random(-5, 4)
		end
		world:spawn('enemy.vlokfoe', {
			castle = self.castle,
			room = room,
			player = self.player,
			direction = random_x < 0 and 'left' or 'right',
			speed_x_num = random_x,
			speed_y_num = random_y,
			speed_den = 5,
			speed_accum_x = 0,
			speed_accum_y = 0,
			pos = {
				x = self.x + 16,
				y = self.y + 12,
				z = 140,
			},
		})
	end
	return bt_success
end

function cloud.choose_drop_type(_self)
	return nil
end

function cloud.register()
	local tree_id<const> = 'enemy_cloud'
	behaviour_tree_library.register(tree_id, {
		root = {
			type = 'parallel_all',
			children = {
				{
					type = 'sequence',
					children = {
						{
							type = 'wait',
							duration_ticks = enemy_cloud_anim_switch_steps,
						},
						{
							type = 'loop',
							child = {
								type = 'sequence',
								children = {
									{
										type = 'task',
										execute = cloud.advance_animation,
									},
									{
										type = 'wait',
										duration_ticks = enemy_cloud_anim_switch_steps,
									},
								},
							},
						},
					},
				},
				{
					type = 'task',
					node_memory = true,
					execute = cloud.execute_move,
					tick = cloud.tick_move,
				},
				{
					type = 'sequence',
					children = {
						{
							type = 'wait',
							duration_ticks = enemy_cloud_spawn_vlok_steps - 1,
						},
						{
							type = 'loop',
							child = {
								type = 'sequence',
								children = {
									{
										type = 'task',
										execute = cloud.spawn_vlok_burst,
									},
									{
										type = 'wait',
										duration_ticks = enemy_cloud_spawn_vlok_steps,
									},
								},
							},
						},
					},
				},
			},
		},
	})
	prefab.define({
		def_id = 'enemy.cloud',
		class = cloud,
		base = enemy_base,
		components = { enemy_base.new_collider, bt_component.factory(tree_id) },
		defaults = {
			damage = 2,
			max_health = 15,
			health = 15,dangerous = true,
			speed_x_num = 0,
			speed_y_num = 0,
			speed_den = 1,
			speed_accum_x = 0,
			speed_accum_y = 0,
			direction = 'right',
			enemy_kind = 'cloud',
		},
	})
end

return cloud
