local constants = require('constants')
local romdir = require('romdir')

local director = {}
director.__index = director

local director_fsm_id = constants.ids.director_fsm
local goal_pulse_timeline_id = 'dkc.director.goal_pulse'

local function overlaps(ax, ay, aw, ah, box)
	return ax < (box.x + box.w) and (ax + aw) > box.x and ay < (box.y + box.h) and (ay + ah) > box.y
end

local function clamp(value, min_value, max_value)
	if value < min_value then
		return min_value
	end
	if value > max_value then
		return max_value
	end
	return value
end

function director:bind_visual()
	local rc = self:get_component('customvisualcomponent')
	rc.producer = function(_ctx)
		self:render_frame()
	end
end

function director:reset_barrels()
	local barrels = self.level.barrels
	local sp = constants.dkc.subpixels_per_px
	for i = 1, #barrels do
		local barrel = barrels[i]
		barrel.x = barrel.spawn_x
		barrel.y = barrel.spawn_y
		barrel.pos_subx = barrel.spawn_x * sp
		barrel.pos_suby = barrel.spawn_y * sp
		barrel.x_speed_subpx = 0
		barrel.y_speed_subpx = 0
		barrel.grounded = true
		barrel.state = 'idle'
		barrel.throw_lock_frames = 0
		barrel.trace_frames_left = 0
	end
end

function director:reset_level(player)
	self:reset_barrels()
	player:respawn()
	self.level_complete = false
	self.level_clear_timer_ms = 0
	self.camera_x = 0
	self.camera_target_x = 0
	self.camera_delta_x = 0
end

function director:is_player_in_goal(player)
	return overlaps(player.x, player.y, player.width, player.height, self.level.goal)
end

function director:update_camera(player)
	local cam = constants.camera
	local view_w = display_width()
	local target_x = player.camera_anchor_x - (view_w * 0.5)

	if target_x < (self.camera_x - cam.deadzone_px) then
		target_x = target_x + cam.deadzone_px
	elseif target_x > (self.camera_x + cam.deadzone_px) then
		target_x = target_x - cam.deadzone_px
	else
		target_x = self.camera_x
	end

	local max_x = self.level.world_width - view_w
	local clamped_max_x = max_x
	if clamped_max_x < 0 then
		clamped_max_x = 0
	end
	target_x = clamp(target_x, 0, clamped_max_x)

	local delta = target_x - self.camera_x
	if math.abs(delta) <= cam.snap_px then
		self.camera_x = target_x
	else
		self.camera_x = self.camera_x + clamp(delta, -cam.follow_step_px, cam.follow_step_px)
	end

	self.camera_x = math.floor(self.camera_x)
	self.camera_target_x = target_x
	self.camera_delta_x = target_x - self.camera_x
end

function director:emit_camera_metric(player)
	local telemetry = constants.telemetry
	if not telemetry.enabled then
		return
	end
	print(string.format(
		'%s|f=%d|cam=%.3f|target=%.3f|delta=%.3f|anchor=%.3f|px=%.3f|sx=%d|st=%s',
		telemetry.camera_prefix,
		player.debug_frame,
		self.camera_x,
		self.camera_target_x,
		self.camera_delta_x,
		player.camera_anchor_x,
		player.x,
		player.x_speed_subpx,
			player.pose_name
		))
end

function director:emit_event(frame, name, extra)
	local telemetry = constants.telemetry
	if not telemetry.enabled then
		return
	end
	if extra ~= nil and extra ~= '' then
		print(string.format('%s|f=%d|name=%s|%s', telemetry.event_prefix, frame, name, extra))
		return
	end
	print(string.format('%s|f=%d|name=%s', telemetry.event_prefix, frame, name))
end

function director:get_barrel_overlapping_solid(barrel, x, y)
	local solids = self.level.solids
	for i = 1, #solids do
		local solid = solids[i]
		if overlaps(x, y, barrel.w, barrel.h, solid) then
			return solid
		end
	end
	return nil
end

function director:move_barrel_horizontal_pixels(barrel, step_pixels)
	if step_pixels == 0 then
		return false
	end
	local dir = math.sign(step_pixels)
	local remain = math.abs(step_pixels)
	local sp = constants.dkc.subpixels_per_px
	while remain > 0 do
		local next_x = barrel.x + dir
		local solid = self:get_barrel_overlapping_solid(barrel, next_x, barrel.y)
		if solid ~= nil then
			if dir > 0 then
				barrel.x = solid.x - barrel.w
			else
				barrel.x = solid.x + solid.w
			end
			barrel.pos_subx = barrel.x * sp
			barrel.x_speed_subpx = 0
			return true
		end
		barrel.x = next_x
		remain = remain - 1
	end
	return false
end

function director:move_barrel_vertical_pixels(barrel, step_pixels)
	if step_pixels == 0 then
		return false, false
	end
	local dir = math.sign(step_pixels)
	local remain = math.abs(step_pixels)
	local sp = constants.dkc.subpixels_per_px
	while remain > 0 do
		local next_y = barrel.y + dir
		local solid = self:get_barrel_overlapping_solid(barrel, barrel.x, next_y)
		if solid ~= nil then
			if dir > 0 then
				barrel.y = solid.y - barrel.h
				barrel.pos_suby = barrel.y * sp
				barrel.y_speed_subpx = 0
				return true, true
			end
			barrel.y = solid.y + solid.h
			barrel.pos_suby = barrel.y * sp
			barrel.y_speed_subpx = 0
			return true, false
		end
		barrel.y = next_y
		remain = remain - 1
	end
	return false, false
end

function director:update_barrels(player)
	local cfg = constants.barrel
	local sp = constants.dkc.subpixels_per_px
	local barrels = self.level.barrels
	for i = 1, #barrels do
		local barrel = barrels[i]
		if player.debug_frame >= barrel.spawn_frame or barrel.state ~= 'idle' then
			if barrel.throw_lock_frames > 0 then
				barrel.throw_lock_frames = barrel.throw_lock_frames - 1
			end
				if barrel.state == 'thrown' then
					local was_grounded = barrel.grounded
					if not barrel.grounded then
						barrel.y_speed_subpx = barrel.y_speed_subpx + cfg.gravity_subpx
						if barrel.y_speed_subpx < cfg.max_fall_subpx then
							barrel.y_speed_subpx = cfg.max_fall_subpx
						end
					end

					local want_subx = barrel.pos_subx + barrel.x_speed_subpx
					local want_x = math.floor(want_subx / sp)
					local step_x = want_x - barrel.x
				local hit_x = self:move_barrel_horizontal_pixels(barrel, step_x)
				if not hit_x then
					barrel.pos_subx = want_subx
				end

					if not barrel.grounded then
						local want_suby = barrel.pos_suby - barrel.y_speed_subpx
						local want_y = math.floor(want_suby / sp)
						local step_y = want_y - barrel.y
						local hit_y, grounded = self:move_barrel_vertical_pixels(barrel, step_y)
						barrel.grounded = grounded
						if not hit_y then
							barrel.pos_suby = want_suby
						end
					else
						barrel.pos_suby = barrel.y * sp
					end

				local max_x = self.level.world_width - barrel.w
				if barrel.x < 0 then
					barrel.x = 0
					barrel.pos_subx = 0
					hit_x = true
				elseif barrel.x > max_x then
					barrel.x = max_x
					barrel.pos_subx = barrel.x * sp
					hit_x = true
				end

				local max_y = self.level.world_height - barrel.h
				if barrel.y > max_y then
					barrel.y = max_y
					barrel.pos_suby = barrel.y * sp
					barrel.y_speed_subpx = 0
					barrel.grounded = true
				end

					if barrel.grounded then
						local dir = math.sign(barrel.x_speed_subpx)
						if dir == 0 then
							dir = 1
						end
						barrel.x_speed_subpx = dir * cfg.ground_roll_subpx
					end
				if barrel.trace_frames_left > 0 then
					self:emit_event(
						player.debug_frame,
						'barrel_step',
						string.format('idx=%d|x=%d|y=%d|sx=%d|sy=%d|g=%d', i, barrel.x, barrel.y, barrel.x_speed_subpx, barrel.y_speed_subpx, bool01(barrel.grounded))
					)
					barrel.trace_frames_left = barrel.trace_frames_left - 1
				end
				if barrel.grounded and (not was_grounded) then
					self:emit_event(player.debug_frame, 'barrel_land', string.format('idx=%d|x=%d|y=%d|sx=%d', i, barrel.x, barrel.y, barrel.x_speed_subpx))
				end
				if hit_x then
					barrel.state = 'broken'
					barrel.x_speed_subpx = 0
					barrel.y_speed_subpx = 0
					self:emit_event(player.debug_frame, 'barrel_break', string.format('idx=%d|x=%d|y=%d', i, barrel.x, barrel.y))
				end
			end
		end
	end
end

function director:tick(dt)
	local player = object(self.player_id)
	self.player_ref = player

	if player.y > (self.level.world_height + 110) then
		self:reset_level(player)
	end

	if (not self.level_complete) and self:is_player_in_goal(player) then
		self.level_complete = true
		self.level_clear_timer_ms = 0
	end

	if self.level_complete then
		self.level_clear_timer_ms = self.level_clear_timer_ms + dt
		if self.level_clear_timer_ms >= 1500 then
			self:reset_level(player)
		end
	end

	self:update_barrels(player)
	self:update_camera(player)
	self:emit_camera_metric(player)
end

function director:draw_parallax_layer(blocks, factor, color, z)
	local cam = self.camera_x * factor
	local view_w = display_width()
	for i = 1, #blocks do
		local block = blocks[i]
		local left = math.floor(block.x - cam)
		local right = left + block.w
		if right > 0 and left < view_w then
			put_rectfillcolor(left, block.y, right, block.y + block.h, z, color)
		end
	end
end

function director:draw_trunks()
	local view_w = display_width()
	for i = 1, #self.level.trunks do
		local trunk = self.level.trunks[i]
		local left = math.floor(trunk.x - (self.camera_x * 0.62))
		local right = left + trunk.w
		if right > 0 and left < view_w then
			put_rectfillcolor(left, trunk.y, right, trunk.y + trunk.h, 56, constants.palette.trunk)
		end
	end
end

function director:draw_level_solids()
	local solids = self.level.solids
	local view_w = display_width()
	for i = 1, #solids do
		local solid = solids[i]
		local left = math.floor(solid.x - self.camera_x)
		local right = left + solid.w
		if right > 0 and left < view_w then
			put_rectfillcolor(left, solid.y, right, solid.y + solid.h, 80, constants.palette.ground)
			put_rectfillcolor(left, solid.y, right, solid.y + 6, 81, constants.palette.ground_top)
		end
	end
end

function director:draw_goal()
	local goal = self.level.goal
	local left = math.floor(goal.x - self.camera_x)
	local right = left + goal.w
	local view_w = display_width()
	if right <= 0 or left >= view_w then
		return
	end
	self.goal_glow_color.a = 0.1 + (self.goal_pulse * 0.24)
	put_rectfillcolor(left - 8, goal.y - 8, right + 8, goal.y + goal.h + 8, 110, self.goal_glow_color)
	put_rectfillcolor(left, goal.y, right, goal.y + goal.h, 111, constants.palette.exit_cave)
	put_rectfillcolor(left + 10, goal.y + 12, right - 10, goal.y + goal.h - 6, 112, constants.palette.exit_cave_inner)
	local barrel_left = left + 16
	local barrel_top = goal.y + goal.h - 22
	put_rectfillcolor(barrel_left, barrel_top, barrel_left + 26, barrel_top + 16, 113, constants.palette.exit_barrel)
	put_rectfillcolor(barrel_left + 5, barrel_top + 4, barrel_left + 21, barrel_top + 12, 114, constants.palette.goal)
end

function director:draw_barrel(barrel, z_base)
	local view_w = display_width()
	local left = math.floor(barrel.x - self.camera_x)
	local right = left + barrel.w
	if right <= 0 or left >= view_w then
		return
	end
	local top = barrel.y
	local bottom = top + barrel.h
	local palette = constants.palette
	if barrel.grounded then
		put_rectfillcolor(left + 1, bottom + 1, right - 1, bottom + 4, z_base - 2, palette.barrel_shadow)
	end
	put_rectfillcolor(left, top, right, bottom, z_base, palette.barrel_body)
	put_rectfillcolor(left + 2, top + 1, right - 2, bottom - 1, z_base + 1, palette.barrel_inner)
	put_rectfillcolor(left + 4, top, left + 6, bottom, z_base + 2, palette.barrel_band)
	put_rectfillcolor(right - 6, top, right - 4, bottom, z_base + 2, palette.barrel_band)
end

function director:draw_barrels(player, draw_held)
	local barrels = self.level.barrels
	for i = 1, #barrels do
		local barrel = barrels[i]
		local is_held = player.carried_barrel_index == i
		local visible = player.debug_frame >= barrel.spawn_frame or barrel.state ~= 'idle'
		if visible and barrel.state ~= 'broken' and ((draw_held and is_held) or ((not draw_held) and (not is_held))) then
			if draw_held then
				self:draw_barrel(barrel, 130)
			else
				self:draw_barrel(barrel, 116)
			end
		end
	end
end

function director:draw_player(player)
	local view_w = display_width()
	local px = player.x - self.camera_x
	if (px + player.width) < -12 or px > (view_w + 12) then
		return
	end

	local frame_id = player.visual_frame_id
	local frame_meta = assets.img[romdir.token(frame_id)].imgmeta
	local sx = player.draw_scale_x
	local sy = player.draw_scale_y

	if player.pose_name == 'roll' then
		local wobble = math.abs(player.roll_visual)
		sx = sx * (1.0 + (wobble * 0.26))
		sy = sy * (1.0 - (wobble * 0.14))
	end

	local fw = frame_meta.width * sx
	local fh = frame_meta.height * sy
	local draw_x = math.floor(px + ((player.width - fw) * 0.5))
	local draw_y = math.floor(player.y + player.height - fh)

	if player.grounded then
		local shadow_w = math.floor(fw * 0.82)
		local shadow_x = math.floor(px + ((player.width - shadow_w) * 0.5))
		local shadow_y = player.y + player.height + 2
		put_rectfillcolor(shadow_x, shadow_y, shadow_x + shadow_w, shadow_y + 4, 119, constants.palette.player_shadow)
	end

	put_sprite(frame_id, draw_x, draw_y, 120, {
		flip_h = player.facing < 0,
		scale = { x = sx, y = sy },
	})
end

function director:draw_ui()
	local view_w = display_width()
	put_rectfillcolor(4, 4, view_w - 4, 22, 390, constants.palette.ui_bg)
	put_glyphs(constants.ui.help, 10, 10, 391, self.ui_glyph_opts)
	if self.level_complete then
		local left = math.floor((view_w - 128) * 0.5)
		local right = left + 128
		put_rectfillcolor(left, 92, right, 120, 392, constants.palette.ui_bg)
		put_glyphs(constants.ui.clear, left + 22, 102, 393, self.ui_glyph_opts)
	end
end

function director:render_frame()
	local view_w = display_width()
	local view_h = display_height()
	put_rectfillcolor(0, 0, view_w, math.floor(view_h * 0.48), 0, constants.palette.sky_1)
	put_rectfillcolor(0, math.floor(view_h * 0.48), view_w, view_h, 1, constants.palette.sky_2)
	self:draw_parallax_layer(self.level.decor_far, 0.22, constants.palette.canopy_far, 20)
	self:draw_parallax_layer(self.level.decor_mid, 0.48, constants.palette.canopy_mid, 40)
	self:draw_trunks()
	self:draw_level_solids()
	self:draw_goal()
	self:draw_barrels(self.player_ref, false)
	self:draw_player(self.player_ref)
	self:draw_barrels(self.player_ref, true)
	self:draw_ui()
end

local function define_director_fsm()
	define_fsm(director_fsm_id, {
		initial = 'boot',
		states = {
			boot = {
					entering_state = function(self)
						self:bind_visual()
						self.player_ref = object(self.player_id)
						self:reset_barrels()
						self:define_timeline(new_timeline({
						id = goal_pulse_timeline_id,
						playback_mode = 'loop',
						tracks = {
							{
								kind = 'wave',
								path = { 'goal_pulse' },
								base = 0.45,
								amp = 0.35,
								period = 0.9,
								phase = 0.1,
								wave = 'sin',
								ease = easing.smoothstep,
							},
						},
					}))
					self:play_timeline(goal_pulse_timeline_id, { rewind = true, snap_to_start = true })
					return '/playing'
				end,
			},
			playing = {},
		},
	})
end

local function register_director_definition()
	define_world_object({
		def_id = constants.ids.director_def,
		class = director,
		fsms = { director_fsm_id },
		components = { 'customvisualcomponent' },
		defaults = {
			player_id = constants.ids.player_instance,
			camera_x = 0,
			camera_target_x = 0,
			camera_delta_x = 0,
			level_complete = false,
			level_clear_timer_ms = 0,
			goal_pulse = 0.4,
			goal_glow_color = {
				r = constants.palette.goal.r,
				g = constants.palette.goal.g,
				b = constants.palette.goal.b,
				a = 0.2,
			},
			ui_glyph_opts = { layer = 'ui', color = constants.palette.ui_fg },
		},
	})
end

return {
	director = director,
	define_director_fsm = define_director_fsm,
	register_director_definition = register_director_definition,
	director_def_id = constants.ids.director_def,
	director_instance_id = constants.ids.director_instance,
	director_fsm_id = constants.ids.director_fsm,
}
