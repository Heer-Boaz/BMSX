local prefab<const> = require('cartlib/world/prefab')
local velocity<const> = require('cartlib/velocity')
local world<const> = require('cartlib/world/world')
require('constants')
local bt_result<const> = require('cartlib/behaviour_tree/result')
local bt_running<const> = bt_result.running
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

function cloud.bt_tick(self, node_memory)
	local room<const> = self.room
	if self.cloud_anim_frame == 2 then
		self:set_imgid('cloud_2')
	else
		self:set_imgid('cloud_1')
	end

	local anim_ticks = node_memory.cloud_anim_ticks or enemy_cloud_anim_switch_steps
	anim_ticks = anim_ticks - 1
	if anim_ticks <= 0 then
		if self.cloud_anim_frame == 1 then
			self.cloud_anim_frame = 2
		else
			self.cloud_anim_frame = 1
		end
		anim_ticks = enemy_cloud_anim_switch_steps
	end
	node_memory.cloud_anim_ticks = anim_ticks

	local dir_modifier<const> = self.direction == 'left' and -1 or 1
	local move_accum = node_memory.cloud_move_accum or 0
	move_accum = move_accum + enemy_cloud_horizontal_speed_num
	while move_accum >= enemy_cloud_horizontal_speed_den do
		self.x = self.x + dir_modifier
		move_accum = move_accum - enemy_cloud_horizontal_speed_den
	end
	node_memory.cloud_move_accum = move_accum

	local wave_accum<const> = node_memory.cloud_wave_accum or 0
	local wave_phase = node_memory.cloud_wave_phase_millirad or 0
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
	node_memory.cloud_wave_accum = next_wave_accum
	node_memory.cloud_wave_phase_millirad = wave_phase

	if self.direction == 'left' then
		if self.x < 0 then
			self.direction = 'right'
		end
	else
		if self.x + 22 >= room.world_width then
			self.direction = 'left'
		end
	end

	local vlok_ticks = node_memory.cloud_vlok_ticks or enemy_cloud_spawn_vlok_steps
	vlok_ticks = vlok_ticks - 1
	if vlok_ticks <= 0 then
		for i = 1, 3 do
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
		vlok_ticks = enemy_cloud_spawn_vlok_steps
	end
	node_memory.cloud_vlok_ticks = vlok_ticks
	return bt_running
end

function cloud.choose_drop_type(_self)
	return nil
end

function cloud.register()
	local tree_id<const> = 'enemy_cloud'
	behaviour_tree_library.register(tree_id, {
		root = {
			type = 'task',
			node_memory = true,
			tick = cloud.bt_tick,
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
