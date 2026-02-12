local constants = require('constants')
local behaviourtree = require('behaviourtree')

local cloud = {}
local full_circle_milliradians = 6283

local function consume_axis_accum(accum, speed_num, speed_den)
	accum = accum + speed_num
	local delta = 0
	while accum >= speed_den do
		delta = delta + 1
		accum = accum - speed_den
	end
	while accum <= -speed_den do
		delta = delta - 1
		accum = accum + speed_den
	end
	return delta, accum
end

function cloud.configure(self, def, _context)
	self.width = def.w or 32
	self.height = def.h or 24
	self.max_health = def.health or 15
	self.health = self.max_health
	self.damage = def.damage or 2
	self:set_body_hit_area(0, 2, 22, 30)
end

function cloud.on_configured(self, context)
	self:play_timeline(context.cloud_timeline_id, { rewind = true, snap_to_start = true })
end

function cloud.update_visual(self, timeline_id)
	local timeline = self:get_timeline(timeline_id)
	return timeline:value(), false, false
end

function cloud.bt_tick(self, blackboard)
	local node = blackboard.nodedata
	local dir_modifier = self.direction == 'left' and -1 or 1
	local move_accum = node.cloud_move_accum
	if move_accum == nil then
		move_accum = 0
	end
	move_accum = move_accum + constants.enemy.cloud_horizontal_speed_num
	while move_accum >= constants.enemy.cloud_horizontal_speed_den do
		self.x = self.x + dir_modifier
		move_accum = move_accum - constants.enemy.cloud_horizontal_speed_den
	end
	node.cloud_move_accum = move_accum

	local wave_accum = node.cloud_wave_accum
	if wave_accum == nil then
		wave_accum = 0
	end
	local wave_phase = node.cloud_wave_phase_millirad
	if wave_phase == nil then
		wave_phase = 0
	end
	local wave_speed_num = round_to_nearest(math.sin(wave_phase / constants.enemy.cloud_wave_phase_denominator) * constants.enemy.cloud_wave_speed_num)
	local wave_dy, next_wave_accum = consume_axis_accum(wave_accum, wave_speed_num, constants.enemy.cloud_wave_speed_den)
	self.y = self.y + wave_dy
	wave_phase = wave_phase + constants.enemy.cloud_wave_phase_step_millirad
	if wave_phase >= full_circle_milliradians then
		wave_phase = wave_phase - full_circle_milliradians
	end
	node.cloud_wave_accum = next_wave_accum
	node.cloud_wave_phase_millirad = wave_phase

	if self.direction == 'left' then
		if self.x < self.room_left then
			self.direction = 'right'
		end
	else
		if self.x + 22 >= self.room_right then
			self.direction = 'left'
		end
	end

	local vlok_ticks = node.cloud_vlok_ticks
	if vlok_ticks == nil then
		vlok_ticks = constants.enemy.cloud_spawn_vlok_steps
	end
	vlok_ticks = vlok_ticks - 1
	if vlok_ticks <= 0 then
		for i = 1, 3 do
				local random_x = 0
				local random_y = 0
				while math.abs(random_x + random_y) < 2 do
					random_x = math.random(-5, 4)
					random_y = math.random(-5, 4)
				end
			self:spawn_child_enemy('vlokfoe', self.x + 16, self.y + 12, {
				direction = random_x < 0 and 'left' or 'right',
				speedx = random_x,
				speedy = random_y,
				speedden = 5,
			})
		end
		vlok_ticks = constants.enemy.cloud_spawn_vlok_steps
	end
	node.cloud_vlok_ticks = vlok_ticks
	return behaviourtree.running
end

function cloud.choose_drop_type(_self, _random_percent_hit)
	return 'none'
end

return cloud
