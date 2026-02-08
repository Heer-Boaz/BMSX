local constants = require('constants.lua')

local director = {}
director.__index = director

local director_fsm_id = constants.ids.director_fsm
local goal_pulse_timeline_id = 'dk.director.goal_pulse'

local function clamp(value, min_value, max_value)
	if value < min_value then
		return min_value
	end
	if value > max_value then
		return max_value
	end
	return value
end

local function abs(value)
	if value < 0 then
		return -value
	end
	return value
end

local function overlaps(ax, ay, aw, ah, box)
	return ax < (box.x + box.w) and (ax + aw) > box.x and ay < (box.y + box.h) and (ay + ah) > box.y
end

function director:bind_visual()
	local rc = self:get_component('customvisualcomponent')
	rc.producer = function(_ctx)
		self:render_frame()
	end
end

function director:reset_level(player)
	player:respawn()
	self.level_complete = false
	self.level_clear_timer_ms = 0
	self.camera_x = 0
end

function director:is_player_in_goal(player)
	return overlaps(player.x, player.y, player.width, player.height, self.level.goal)
end

function director:update_camera(player, dt)
	local camera = constants.camera
	local view_w = display_width()
	local target_x = player.camera_anchor_x - (view_w * 0.5)
	if target_x < (self.camera_x - camera.deadzone) then
		target_x = target_x + camera.deadzone
	elseif target_x > (self.camera_x + camera.deadzone) then
		target_x = target_x - camera.deadzone
	else
		target_x = self.camera_x
	end
	local max_x = self.level.world_width - view_w
	target_x = clamp(target_x, 0, max_x)
	local blend = dt * camera.follow_lerp
	if blend > 1 then
		blend = 1
	end
	self.camera_x = self.camera_x + ((target_x - self.camera_x) * blend)
end

function director:tick(dt)
	local player = object(self.player_id)
	self.player_ref = player
	if player.y > (self.level.world_height + 110) then
		self:reset_level(player)
	end
	if not self.level_complete and self:is_player_in_goal(player) then
		self.level_complete = true
		self.level_clear_timer_ms = 0
	end
	if self.level_complete then
		self.level_clear_timer_ms = self.level_clear_timer_ms + dt
		if self.level_clear_timer_ms >= 1500 then
			self:reset_level(player)
		end
	end
	self:update_camera(player, dt)
end

function director:draw_parallax_layer(blocks, factor, color, z)
	local camera_x = self.camera_x * factor
	local view_w = display_width()
	for i = 1, #blocks do
		local block = blocks[i]
		local left = math.floor(block.x - camera_x)
		local right = left + block.w
		if right > 0 and left < view_w then
			put_rectfillcolor(left, block.y, right, block.y + block.h, z, color)
		end
	end
end

function director:draw_level_solids()
	local solids = self.level.solids
	local view_w = display_width()
	local camera_x = self.camera_x
	for i = 1, #solids do
		local solid = solids[i]
		local left = math.floor(solid.x - camera_x)
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
	self.goal_glow_color.a = 0.12 + (self.goal_pulse * 0.28)
	put_rectfillcolor(left - 8, goal.y - 8, right + 8, goal.y + goal.h + 8, 110, self.goal_glow_color)
	put_rectfillcolor(left, goal.y, right, goal.y + goal.h, 111, constants.palette.goal)
	local pole_x = left + math.floor(goal.w * 0.5) - 2
	put_rectfillcolor(pole_x, goal.y - 24, pole_x + 4, goal.y + goal.h, 112, constants.palette.goal_pole)
	local flag_w = 18 + math.floor(self.goal_pulse * 8)
	put_rectfillcolor(pole_x + 4, goal.y - 24, pole_x + 4 + flag_w, goal.y - 10, 113, constants.palette.goal)
end

function director:draw_player(player)
	local view_w = display_width()
	local px = player.x - self.camera_x
	local py = player.y
	if (px + player.width) < -12 or px > (view_w + 12) then
		return
	end
	local wobble = abs(player.roll_wobble)
	local body_w = player.width * player.visual_scale_x
	local body_h = player.height * player.visual_scale_y
	if player.pose_name == 'roll' then
		body_w = body_w * (1.18 + (wobble * 0.12))
		body_h = body_h * (0.64 - (wobble * 0.06))
	else
		body_w = body_w * (1 + (wobble * 0.08))
		body_h = body_h * (1 - (wobble * 0.04))
	end
	local draw_x = math.floor(px + ((player.width - body_w) * 0.5))
	local draw_y = math.floor(py + (player.height - body_h))
	local draw_w = math.floor(body_w)
	local draw_h = math.floor(body_h)

	if player.grounded then
		local shadow_w = math.floor(draw_w * 0.92)
		local shadow_x = math.floor(px + ((player.width - shadow_w) * 0.5))
		local shadow_y = player.y + player.height + 2
		put_rectfillcolor(shadow_x, shadow_y, shadow_x + shadow_w, shadow_y + 4, 119, constants.palette.player_shadow)
	end

	put_rectfillcolor(draw_x, draw_y, draw_x + draw_w, draw_y + draw_h, 120, constants.palette.player_body)
	local face_w = math.floor(draw_w * 0.34)
	local face_h = math.floor(draw_h * 0.28)
	local face_x = draw_x + 3
	if player.facing < 0 then
		face_x = draw_x + draw_w - face_w - 3
	end
	local face_y = draw_y + 4
	put_rectfillcolor(face_x, face_y, face_x + face_w, face_y + face_h, 121, constants.palette.player_face)
	local hand_w = math.floor(draw_w * 0.22)
	local hand_h = math.floor(draw_h * 0.24)
	local hand_x = draw_x + draw_w - hand_w - 2
	if player.facing < 0 then
		hand_x = draw_x + 2
	end
	local hand_y = draw_y + draw_h - hand_h - 2
	put_rectfillcolor(hand_x, hand_y, hand_x + hand_w, hand_y + hand_h, 122, constants.palette.player_face)
end

function director:draw_ui()
	local view_w = display_width()
	put_rectfillcolor(4, 4, view_w - 4, 22, 390, constants.palette.ui_banner)
	put_glyphs(constants.ui.help_line, 10, 10, 391, self.ui_glyph_opts)
	if self.level_complete then
		local left = math.floor((view_w - 120) * 0.5)
		local right = left + 120
		put_rectfillcolor(left, 92, right, 120, 392, constants.palette.ui_banner)
		put_glyphs(constants.ui.clear_line, left + 18, 102, 393, self.ui_glyph_opts)
	end
end

function director:render_frame()
	local view_w = display_width()
	local view_h = display_height()
	put_rectfillcolor(0, 0, view_w, view_h, 0, constants.palette.sky)
	self:draw_parallax_layer(self.level.decor_far, 0.2, constants.palette.far, 20)
	self:draw_parallax_layer(self.level.decor_mid, 0.45, constants.palette.mid, 40)
	self:draw_level_solids()
	self:draw_goal()
	self:draw_player(self.player_ref)
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
					self:define_timeline(new_timeline({
						id = goal_pulse_timeline_id,
						playback_mode = 'loop',
						tracks = {
							{
								kind = 'wave',
								path = { 'goal_pulse' },
								base = 0.5,
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
			level_complete = false,
			level_clear_timer_ms = 0,
			goal_pulse = 0.5,
			goal_glow_color = { r = constants.palette.goal.r, g = constants.palette.goal.g, b = constants.palette.goal.b, a = 0.2 },
			ui_glyph_opts = { layer = 'ui', color = constants.palette.ui_text },
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
