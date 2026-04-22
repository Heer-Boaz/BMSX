local constants<const> = require('constants')
local behaviourtree<const> = require('behaviourtree')
local enemy_base<const> = require('enemies/enemy_base')

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
	self:gfx('cloud_1')
end

function cloud.bt_tick(self, blackboard)
	local node<const> = blackboard.nodedata
	local room<const> = oget('room')
	if self.cloud_anim_frame == 2 then
		self:gfx('cloud_2')
	else
		self:gfx('cloud_1')
	end

	local anim_ticks = node.cloud_anim_ticks or constants.enemy.cloud_anim_switch_steps
	anim_ticks = anim_ticks - 1
	if anim_ticks <= 0 then
		if self.cloud_anim_frame == 1 then
			self.cloud_anim_frame = 2
		else
			self.cloud_anim_frame = 1
		end
		anim_ticks = constants.enemy.cloud_anim_switch_steps
	end
	node.cloud_anim_ticks = anim_ticks

	local dir_modifier<const> = self.direction == 'left' and -1 or 1
	local move_accum = node.cloud_move_accum or 0
	move_accum = move_accum + constants.enemy.cloud_horizontal_speed_num
	while move_accum >= constants.enemy.cloud_horizontal_speed_den do
		self.x = self.x + dir_modifier
		move_accum = move_accum - constants.enemy.cloud_horizontal_speed_den
	end
	node.cloud_move_accum = move_accum

	local wave_accum<const> = node.cloud_wave_accum or 0
	local wave_phase = node.cloud_wave_phase_millirad or 0
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
	local wave_dy<const>, next_wave_accum<const> = consume_axis_accum(wave_accum, wave_speed_num, constants.enemy.cloud_wave_speed_den)
	self.y = self.y + wave_dy
	wave_phase = wave_phase + constants.enemy.cloud_wave_phase_step_millirad
	if wave_phase >= full_circle_milliradians then
		wave_phase = wave_phase - full_circle_milliradians
	end
	node.cloud_wave_accum = next_wave_accum
	node.cloud_wave_phase_millirad = wave_phase

	if self.direction == 'left' then
		if self.x < 0 then
			self.direction = 'right'
		end
	else
		if self.x + 22 >= oget('room').world_width then
			self.direction = 'left'
		end
	end

	local vlok_ticks = node.cloud_vlok_ticks or constants.enemy.cloud_spawn_vlok_steps
	vlok_ticks = vlok_ticks - 1
	if vlok_ticks <= 0 then
		for i = 1, 3 do
			local random_x = 0
			local random_y = 0
			while math.abs(random_x + random_y) < 2 do
				random_x = math.random(-5, 4)
				random_y = math.random(-5, 4)
			end
			inst('enemy.vlokfoe', {
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
		vlok_ticks = constants.enemy.cloud_spawn_vlok_steps
	end
	node.cloud_vlok_ticks = vlok_ticks
	return behaviourtree.running
end

function cloud.register_behaviour_tree(bt_id)
	behaviourtree.register_definition(bt_id, {
		root = {
			type = 'action',
			action = function(target, blackboard)
				return cloud.bt_tick(target, blackboard)
			end,
		},
	})
end

function cloud.choose_drop_type(_self)
	return nil
end

enemy_base.extend(cloud, 'cloud')

function cloud.register_enemy_definition()
	define_prefab({
		def_id = 'enemy.cloud',
		class = cloud,
		type = 'sprite',
		bts = { 'enemy_cloud' },
		defaults = {
			conditions = {},
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
