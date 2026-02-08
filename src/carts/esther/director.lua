local constants = require('constants.lua')

local director = {}
director.__index = director

local director_fsm_id = constants.ids.director_fsm
local goal_pulse_timeline_id = 'dkc.director.goal_pulse'

local function overlaps(ax, ay, aw, ah, box)
	return ax < (box.x + box.w) and (ax + aw) > box.x and ay < (box.y + box.h) and (ay + ah) > box.y
end

local function abs(value)
	if value < 0 then
		return -value
	end
	return value
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

function director:update_camera(player)
	local camera = constants.camera
	local view_w = display_width()
	local target_x = player.camera_anchor_x - (view_w * 0.5)

	if target_x < (self.camera_x - camera.deadzone_px) then
		target_x = target_x + camera.deadzone_px
	elseif target_x > (self.camera_x + camera.deadzone_px) then
		target_x = target_x - camera.deadzone_px
	else
		target_x = self.camera_x
	end

	local max_x = self.level.world_width - view_w
	if max_x < 0 then
		max_x = 0
	end
	if target_x < 0 then
		target_x = 0
	elseif target_x > max_x then
		target_x = max_x
	end

	self.camera_x = self.camera_x + ((target_x - self.camera_x) * camera.follow_lerp)
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

	self:update_camera(player)
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
	self.goal_glow_color.a = 0.1 + (self.goal_pulse * 0.24)
	put_rectfillcolor(left - 8, goal.y - 8, right + 8, goal.y + goal.h + 8, 110, self.goal_glow_color)
	put_rectfillcolor(left, goal.y, right, goal.y + goal.h, 111, constants.palette.exit_cave)
	put_rectfillcolor(left + 10, goal.y + 12, right - 10, goal.y + goal.h - 6, 112, constants.palette.exit_cave_inner)
	local barrel_left = left + 16
	local barrel_top = goal.y + goal.h - 22
	put_rectfillcolor(barrel_left, barrel_top, barrel_left + 26, barrel_top + 16, 113, constants.palette.exit_barrel)
	put_rectfillcolor(barrel_left + 5, barrel_top + 4, barrel_left + 21, barrel_top + 12, 114, constants.palette.goal)
end

function director:draw_player(player)
	local view_w = display_width()
	local px = player.x - self.camera_x
	local py = player.y
	if (px + player.width) < -12 or px > (view_w + 12) then
		return
	end

	local body_w = player.width * player.draw_scale_x
	local body_h = player.height * player.draw_scale_y
	if player.pose_name == 'roll' then
		local wobble = abs(player.roll_visual)
		body_w = body_w * (1.24 + (wobble * 0.12))
		body_h = body_h * (0.6 - (wobble * 0.08))
	end

	local draw_x = math.floor(px + ((player.width - body_w) * 0.5))
	local draw_y = math.floor(py + (player.height - body_h))
	local draw_w = math.floor(body_w)
	local draw_h = math.floor(body_h)

	if player.grounded then
		local shadow_w = math.floor(draw_w * 0.88)
		local shadow_x = math.floor(px + ((player.width - shadow_w) * 0.5))
		local shadow_y = player.y + player.height + 2
		put_rectfillcolor(shadow_x, shadow_y, shadow_x + shadow_w, shadow_y + 4, 119, constants.palette.player_shadow)
	end

	put_rectfillcolor(draw_x, draw_y, draw_x + draw_w, draw_y + draw_h, 120, constants.palette.player_body)
	local face_w = math.floor(draw_w * 0.32)
	local face_h = math.floor(draw_h * 0.24)
	local face_x = draw_x + 3
	if player.facing < 0 then
		face_x = draw_x + draw_w - face_w - 3
	end
	local face_y = draw_y + 4
	put_rectfillcolor(face_x, face_y, face_x + face_w, face_y + face_h, 121, constants.palette.player_face)
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
