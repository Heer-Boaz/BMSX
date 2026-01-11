local combat = {}

local function stat_label(stat_id)
	if stat_id == 'planning' then
		return 'Planning'
	end
	if stat_id == 'opdekin' then
		return 'Op-de-kin'
	end
	if stat_id == 'rust' then
		return 'Rust'
	end
	if stat_id == 'makeup' then
		return 'Make-up'
	end
end

local function round(x)
	if x >= 0 then
		return math.floor(x + 0.5)
	end
	return -math.floor((-x) + 0.5)
end

local function shake_hash(seed)
	seed = seed ~ (seed << 13)
	seed = seed ~ (seed >> 17)
	seed = seed ~ (seed << 5)
	return seed
end

local function shake_signed(seed)
	local h = shake_hash(seed)
	local u = (h & 0xffff) / 0xffff
	return (u * 2) - 1
end

local function build_all_out_shake(total_frames)
	local ramp_in_frames = 10
	local ramp_out_frames = 18
	local ramp_out_start = total_frames - ramp_out_frames

	local swing_period_frames = 10
	local swing_amp_x = 28
	local swing_amp_y = 10

	local jitter_amp_x = 10
	local jitter_amp_y = 7
	local micro_jitter_amp_x = 4
	local micro_jitter_amp_y = 3

	local hit_segment_len = 7
	local hit_len = 3
	local hit_amp_x = 36
	local hit_amp_y = 20
	local hit_window = hit_segment_len - hit_len + 1

	local boom_frames = 10
	local boom_amp_x = 44
	local boom_amp_y = 28

	return function(frame_index)
		if frame_index >= (total_frames - 1) then
			return 0, 0
		end

		local intensity = 1
		if frame_index < ramp_in_frames then
			local u = frame_index / (ramp_in_frames - 1)
			intensity = easing.smoothstep(u)
		elseif frame_index >= ramp_out_start then
			local u = (total_frames - 1 - frame_index) / (ramp_out_frames - 1)
			intensity = easing.smoothstep(u)
		end

		local swing_u = (frame_index / swing_period_frames) + 0.15
		local swing = easing.pingpong01(swing_u)
		swing = (easing.ease_in_out_quad(swing) - 0.5) * 2

		local bob_u = (frame_index / (swing_period_frames * 0.75)) + 0.37
		local bob = (easing.smoothstep(easing.pingpong01(bob_u)) - 0.5) * 2

		local dx = (swing * swing_amp_x)
		local dy = (bob * swing_amp_y)

		dx = dx + (shake_signed(1000 + frame_index * 31 + 7) * jitter_amp_x)
		dy = dy + (shake_signed(2000 + frame_index * 47 + 13) * jitter_amp_y)
		dx = dx + (shake_signed(3000 + frame_index * 97 + 3) * micro_jitter_amp_x)
		dy = dy + (shake_signed(4000 + frame_index * 89 + 9) * micro_jitter_amp_y)

		local segment_index = math.floor(frame_index / hit_segment_len)
		local segment_start = segment_index * hit_segment_len
		local accent_at = segment_start + (shake_hash(segment_index * 73 + 11) % hit_window)
		if frame_index >= accent_at and frame_index < (accent_at + hit_len) then
			local u = (frame_index - accent_at) / (hit_len - 1)
			local hit_u = easing.arc01(u)
			local strength = 0.7 + (((shake_hash(segment_index * 53 + 7) & 0xff) / 0xff) * 0.7)
			dx = dx + (shake_signed(segment_index * 199 + frame_index * 17 + 5) * hit_amp_x * hit_u * strength)
			dy = dy + (shake_signed(segment_index * 211 + frame_index * 19 + 9) * hit_amp_y * hit_u * strength)
		end

		if frame_index < boom_frames then
			local u = frame_index / (boom_frames - 1)
			local boom = 1 - easing.smoothstep(u)
			dx = dx + (shake_signed(5000 + frame_index * 19 + 1) * boom_amp_x * boom)
			dy = dy + (shake_signed(6000 + frame_index * 23 + 5) * boom_amp_y * boom)
		end

		return round(dx * intensity), round(dy * intensity)
	end
end

local all_out_shake = build_all_out_shake(combat_all_out_frame_count)

local function build_combat_fade_frames()
	local frames = {}
	for frame_index = 0, combat_fade_frame_count - 1 do
		local c = 0
		if frame_index < combat_fade_out_frames then
			local u = frame_index / (combat_fade_out_frames - 1)
			c = 1 - easing.smoothstep(u)
		end
		frames[#frames + 1] = { c = c }
	end
	return frames
end

local function build_combat_dodge_frames(params)
	local frames = {}
	local dir = params.dir
	local anticipate_frames = combat_dodge_anticipation_frames
	local peak_frames = combat_dodge_peak_frames
	local recover_frames = combat_dodge_recover_frames
	local move_frames = combat_dodge_frame_count - anticipate_frames - peak_frames - recover_frames
	local move_end = anticipate_frames + move_frames
	local peak_end = move_end + peak_frames

	for frame_index = 0, combat_dodge_frame_count - 1 do
		local offset = 0
		local scale_x = 1
		local scale_y = 1
		if frame_index < anticipate_frames then
			local u = frame_index / (anticipate_frames - 1)
			offset = -combat_monster_dodge_distance * 0.2 * easing.smoothstep(u) * dir
			local t = easing.smoothstep(u)
			scale_x = 1 + (combat_dodge_anticipation_scale_x * t)
			scale_y = 1 + (combat_dodge_anticipation_scale_y * t)
		elseif frame_index < move_end then
			local u = (frame_index - anticipate_frames) / (move_frames - 1)
			offset = combat_monster_dodge_distance * easing.ease_out_quad(u) * dir
			local t = easing.ease_out_quad(u)
			scale_x = 1 + (combat_dodge_move_scale_x * t)
			scale_y = 1 + (combat_dodge_move_scale_y * t)
		elseif frame_index < peak_end then
			offset = combat_monster_dodge_distance * dir
			scale_x = 1 + combat_dodge_move_scale_x
			scale_y = 1 + combat_dodge_move_scale_y
		else
			local u = (frame_index - peak_end) / (recover_frames - 1)
			local t = 1 - easing.ease_in_quad(u)
			offset = combat_monster_dodge_distance * t * dir
			scale_x = 1 + (combat_dodge_move_scale_x * t)
			scale_y = 1 + (combat_dodge_move_scale_y * t)
		end
		frames[#frames + 1] = { offset = offset, scale_x = scale_x, scale_y = scale_y }
	end

	return frames
end

local function build_combat_all_out_frames(params)
	local frames = {}
	local origin_x = params.origin_x
	local origin_y = params.origin_y
	local sprite_w = params.sprite_w
	local sprite_h = params.sprite_h

	for frame_index = 0, combat_all_out_frame_count - 1 do
		local dx, dy = all_out_shake(frame_index)
		local u = (frame_index / combat_all_out_pulse_period_frames) + 0.25
		local pulse = easing.smoothstep(easing.pingpong01(u))
		local s_base = 1 + (pulse * combat_all_out_pulse_amp)
		local squash_u = (frame_index / (combat_all_out_pulse_period_frames * 0.5)) + 0.15
		local squash = easing.pingpong01(squash_u)
		squash = (easing.ease_in_out_quad(squash) - 0.5) * 2
		local jitter = shake_signed(7000 + frame_index * 29 + 9) * 0.04
		local sx = s_base + (squash * combat_all_out_pulse_amp * 0.6) + jitter
		local sy = s_base - (squash * combat_all_out_pulse_amp * 0.4) - (jitter * 0.6)
		local ox = (sprite_w * (sx - 1)) / 2
		local oy = (sprite_h * (sy - 1)) / 2
		frames[#frames + 1] = { x = origin_x + dx - ox, y = origin_y + dy - oy, sx = sx, sy = sy }
	end

	return frames
end

local function build_combat_results_fade_in_frames(params)
	local frames = {}
	local maya_start_x = params.maya_start_x
	local maya_target_x = params.maya_target_x
	local text_start_x = params.text_start_x
	local text_target_x = params.text_target_x

	for frame_index = 0, combat_results_fade_in_frames - 1 do
		local u = frame_index / (combat_results_fade_in_frames - 1)
		local a = easing.smoothstep(u)
		frames[#frames + 1] = {
			a = a,
			bg_a = combat_results_bg_a * a,
			maya_x = maya_start_x + (maya_target_x - maya_start_x) * a,
			text_x = text_start_x + (text_target_x - text_start_x) * a,
		}
	end

	return frames
end

local function build_combat_results_fade_out_frames()
	local frames = {}
	for frame_index = 0, combat_results_fade_out_frames - 1 do
		local u = frame_index / (combat_results_fade_out_frames - 1)
		local a = 1 - easing.smoothstep(u)
		frames[#frames + 1] = { a = a, bg_a = combat_results_bg_a * a }
	end
	return frames
end

local function build_combat_exit_fade_in_frames()
	local frames = {}
	for frame_index = 0, combat_exit_fade_in_frames - 1 do
		local u = frame_index / (combat_exit_fade_in_frames - 1)
		local c = easing.smoothstep(u)
		frames[#frames + 1] = { c = c }
	end
	return frames
end

local combat_fade_frames = build_combat_fade_frames()
local combat_results_fade_out_frames_table = build_combat_results_fade_out_frames()
local combat_exit_fade_in_frames_table = build_combat_exit_fade_in_frames()

local combat_director = {}
combat_director.__index = combat_director

function combat_director:start_combat(node_id, opts)
	self.node_id = node_id
	self.combat_node_id = node_id
	local node = story[node_id]
	self.combat_monster_imgid = node.monster_imgid
	self.combat_rewards = {}
	self.skip_transition_fade = false
	self.skip_combat_fade_in = opts.skip_fade_in
	if self.skip_combat_fade_in then
		self.sc:transition_to(combat_director_fsm_id .. ':/combat_init')
		return
	end
	self.sc:transition_to(combat_director_fsm_id .. ':/combat_fade_in')
end

function combat_director:apply_combat_round(node)
	local round = node.rounds[self.combat_round_index]
	set_text_lines(text_main_id, round.prompt, true)
	local choice_lines = {}
	for i = 1, #round.options do
		choice_lines[i] = round.options[i].label
	end
	set_text_lines(text_choice_id, choice_lines, false)
	self.choice_index = 1
end

function combat_director:update_combat_hover()
	self.combat_hover_time = self.combat_hover_time + game.deltatime_seconds
	local monster = object(combat_monster_id)
	local u = (self.combat_hover_time / combat_monster_hover_period_seconds) + 0.25
	local wave = easing.smoothstep(easing.pingpong01(u))
	local offset = (wave - 0.5) * 2 * combat_monster_hover_amp
	monster.y = self.combat_monster_base_y + offset
end

function combat_director:apply_combat_parallax(dt)
	if not self.combat_parallax_enabled then
		return
	end
	self.combat_parallax_impact_t = self.combat_parallax_impact_t + dt
	local momentum = self.combat_parallax_momentum
	local impact_side = self.combat_parallax_impact_side
	local rig_vy = combat_parallax_vy_base + combat_parallax_vy_momentum
	local rig_scale = combat_parallax_scale_base + combat_parallax_scale_momentum
	local rig_impact = 0
	if impact_side == 'hero' then
		rig_impact = combat_parallax_impact_amp
	elseif impact_side == 'monster' then
		rig_impact = -combat_parallax_impact_amp
	end
	set_sprite_parallax_rig(rig_vy, rig_scale, rig_impact, self.combat_parallax_impact_t)
	local hero_weight = (combat_parallax_vy_base - (combat_parallax_vy_momentum * momentum)) / rig_vy
	local monster_weight = -(combat_parallax_vy_base + (combat_parallax_vy_momentum * momentum)) / rig_vy
	local hero = object(combat_maya_a_id)
	local monster = object(combat_monster_id)
	hero.sprite_component.parallax_weight = hero_weight
	monster.sprite_component.parallax_weight = monster_weight
	print("Applied combat parallax: " .. momentum)
end

function combat_director:reset_combat_parallax()
	self.combat_parallax_enabled = true
	self.combat_parallax_momentum = 0
	self.combat_parallax_impact_t = 0
	self.combat_parallax_impact_side = ''
	self:apply_combat_parallax(0)
end

function combat_director:disable_combat_parallax()
	self.combat_parallax_enabled = false
	set_sprite_parallax_rig(0, 1, 0, 0)
	local hero = object(combat_maya_a_id)
	local monster = object(combat_monster_id)
	hero.sprite_component.parallax_weight = 0
	monster.sprite_component.parallax_weight = 0
end

function combat_director:push_combat_momentum(side, power)
	local delta = side == 'hero' and power or -power
	local next = self.combat_parallax_momentum + delta
	if next < -1 then
		next = -1
	end
	if next > 1 then
		next = 1
	end
	self.combat_parallax_momentum = next
	self.combat_parallax_impact_t = 0
	self.combat_parallax_impact_side = side
end

function combat_director:tick(_dt)
	if not self.combat_parallax_enabled then
		return
	end
	self:apply_combat_parallax(game.deltatime_seconds)
end

function combat_director:is_typing()
	return object(text_main_id).is_typing
end

function combat_director:skip_typing()
	if self:is_typing() then
		finish_text(text_main_id)
		$.consume_action('b')
		return true
	end
	return false
end

function combat_director:resolve_combat_rewards(node)
	return node.rewards[self.combat_points + 1]
end

	function combat.setup_timelines(self)

		local function build_combat_focus_frames(params)
			local frames = {}

			local monster = params.monster
			local base_x = params.base_x
			local base_y = params.base_y

			local zoom_scale = combat_focus_zoom_scale
			local zoom_target_x = (display_width() - (monster.sx * zoom_scale)) / 2
			local zoom_target_y = (display_height() - (monster.sy * zoom_scale)) / 2

			local vanish_scale_x = combat_focus_vanish_scale_x
			local vanish_scale_y = combat_focus_vanish_scale_y
			local vanish_center_x = display_width() / 2
			local vanish_bottom_y = zoom_target_y + (monster.sy * zoom_scale)

			for i = 0, combat_focus_zoom_frames - 1 do
				local u = i / (combat_focus_zoom_frames - 1)
				local eased = easing.smoothstep(u)
				local turn = easing.arc01(u)
			local s = 1 + ((zoom_scale - 1) * eased)
			local x = base_x + (zoom_target_x - base_x) * eased + (combat_focus_zoom_arc_x * turn)
			local y = base_y + (zoom_target_y - base_y) * eased + (combat_focus_zoom_arc_y * turn)

			frames[#frames + 1] = {
				visible = true,
				x = x,
				y = y,
				scale = { x = s, y = s },
				colorize = { r = 1, g = 1, b = 1, a = 1 },
			}
		end

			for i = 0, combat_focus_vanish_frames - 1 do
				local u = i / (combat_focus_vanish_frames - 1)
				local eased = easing.smoothstep(u)
				local melt = easing.ease_out_quad(eased)
				local turn = easing.arc01(u)
				local sx = zoom_scale + ((vanish_scale_x - zoom_scale) * melt)
				local sy = zoom_scale + ((vanish_scale_y - zoom_scale) * melt)
				local center_x = vanish_center_x + (combat_focus_vanish_arc_x * turn)
				local bottom_y = vanish_bottom_y + (combat_focus_vanish_lift * melt) + (combat_focus_vanish_arc_y * turn)
				local x = center_x - (monster.sx * sx) / 2
				local y = bottom_y - (monster.sy * sy)
				local alpha = 1 - easing.ease_in_quad(u)

				frames[#frames + 1] = {
					visible = alpha > 0,
					x = x,
					y = y,
					scale = { x = sx, y = sy },
					colorize = { r = 1, g = 1, b = 1, a = alpha },
				}
			end

		return frames
	end

	self:define_timeline(new_timeline({
		id = combat_focus_timeline_id,
		frames = build_combat_focus_frames,
		ticks_per_frame = combat_focus_ticks_per_frame,
		playback_mode = 'once',
		markers = {
			{ frame = 0, event = 'combat_focus.snap' },
			{ u = 1, event = 'combat_focus.done' },
		},
	}))
end

function combat.define_fsm()
	local states = {}

	states.boot = {
		entering_state = function(self)
			combat.setup_timelines(self)
			self.combat_hit_slash_frame = {
				slash_active = false,
				slash_points = { 0, 0, 0, 0 },
				slash_thickness = 0,
				slash_color = { r = 1, g = 1, b = 1, a = 0 },
				slash_z = combat_hit_slash_z,
			}
			self.combat_hit_slash_rc = attach_component(self, 'customvisualcomponent')
			self.combat_hit_slash_rc:add_producer(function(ctx)
				local frame = ctx.parent.combat_hit_slash_frame
				if not frame.slash_active then
					return
				end
				ctx.rc:submit_poly({
					points = frame.slash_points,
					z = frame.slash_z,
					color = frame.slash_color,
					thickness = frame.slash_thickness,
				})
			end)
			hide_combat_sprites()
			return '/idle'
		end,
	}

	states.idle = {
		entering_state = function()
			hide_combat_sprites()
		end,
	}

	states.combat_done = {
		entering_state = function(self)
			self:disable_combat_parallax()
			object(director_instance_id).events:emit('combat.end', {
				combat_node_id = self.combat_node_id,
				next_node_id = self.node_id,
				monster_imgid = self.combat_monster_imgid,
				rewards = self.combat_rewards,
				skip_transition_fade = self.skip_transition_fade,
			})
			return '/idle'
		end,
	}

	local function build_combat_intro_frames(self, monster, maya_a, maya_b)
		local frames = {}

		local monster_start_scale = self.combat_monster_start_scale
		local monster_start_x = self.combat_monster_start_x
		local monster_start_y = self.combat_monster_start_y
		local monster_base_x = self.combat_monster_base_x
		local monster_base_y = self.combat_monster_base_y
		local monster_start_ox = (monster.sx * (monster_start_scale - 1)) / 2
		local monster_start_oy = (monster.sy * (monster_start_scale - 1)) / 2
		local monster_hidden_x = monster_start_x - monster_start_ox
		local monster_hidden_y = monster_start_y - monster_start_oy

		local maya_a_start_scale = self.combat_maya_a_start_scale
		local maya_a_start_x = self.combat_maya_a_start_x
		local maya_a_base_x = self.combat_maya_a_base_x
		local maya_a_base_y = self.combat_maya_a_base_y
		local maya_a_hidden_y = maya_a_base_y - (maya_a.sy * (maya_a_start_scale - 1))

		local maya_b_start_scale = self.combat_maya_b_start_scale
		local maya_b_end_scale = self.combat_maya_b_end_scale
		local maya_b_start_right_x = self.combat_maya_b_start_right_x
		local maya_b_exit_right_x = self.combat_maya_b_exit_right_x
		local maya_b_base_x = self.combat_maya_b_start_x
		local maya_b_base_y = self.combat_maya_b_base_y

		for i = 0, combat_intro_maya_b_frames - 1 do
			local u = i / (combat_intro_maya_b_frames - 1)
			local eased = easing.smoothstep(u)
			local turn = easing.arc01(u)
			local s = maya_b_start_scale + (maya_b_end_scale - maya_b_start_scale) * eased
			local right_x = maya_b_start_right_x + (maya_b_exit_right_x - maya_b_start_right_x) * eased
			local x = right_x - (maya_b.sx * s)
			local y = maya_b_base_y - (maya_b.sy * (s - 1)) + (combat_intro_maya_b_arc_y * turn)

			frames[#frames + 1] = {
				monster_visible = false,
				monster_x = monster_hidden_x,
				monster_y = monster_hidden_y,
				monster_scale = monster_start_scale,
				maya_a_visible = false,
				maya_a_x = maya_a_start_x,
				maya_a_y = maya_a_hidden_y,
				maya_a_scale = maya_a_start_scale,
				maya_b_visible = true,
				maya_b_x = x,
				maya_b_y = y,
				maya_b_scale = s,
			}
		end

		for i = 0, combat_intro_reveal_frames - 1 do
			local u = i / (combat_intro_reveal_frames - 1)
			local eased = easing.smoothstep(u)
			local turn = easing.arc01(u)

			local monster_scale = monster_start_scale + (1 - monster_start_scale) * eased
			local monster_ox = (monster.sx * (monster_scale - 1)) / 2
			local monster_oy = (monster.sy * (monster_scale - 1)) / 2
			local monster_x = monster_start_x + (monster_base_x - monster_start_x) * eased + (combat_intro_monster_arc_x * turn) - monster_ox
			local monster_y = monster_start_y + (monster_base_y - monster_start_y) * eased + (combat_intro_monster_arc_y * turn) - monster_oy

			local maya_a_scale = maya_a_start_scale + (1 - maya_a_start_scale) * eased
			local maya_a_x = maya_a_start_x + (maya_a_base_x - maya_a_start_x) * eased + (combat_intro_maya_a_arc_x * turn)
			local maya_a_y = maya_a_base_y - (maya_a.sy * (maya_a_scale - 1)) + (combat_intro_maya_a_arc_y * turn)

			frames[#frames + 1] = {
				monster_visible = true,
				monster_x = monster_x,
				monster_y = monster_y,
				monster_scale = monster_scale,
				maya_a_visible = true,
				maya_a_x = maya_a_x,
				maya_a_y = maya_a_y,
				maya_a_scale = maya_a_scale,
				maya_b_visible = false,
				maya_b_x = maya_b_base_x,
				maya_b_y = maya_b_base_y,
				maya_b_scale = 1,
			}
		end

		return frames
	end

	local function build_combat_exchange_frames(self, params)
		local frames = {}
		local frame_count = params.frame_count
		local monster_base_x = self.combat_monster_base_x
		local monster_base_y = self.combat_monster_base_y
		local maya_base_x = self.combat_maya_a_base_x
		local maya_base_y = self.combat_maya_a_base_y
		local impact_start = math.floor(frame_count * combat_exchange_impact_start_ratio)
		local impact_end = math.floor(frame_count * combat_exchange_impact_end_ratio)
		local impact_frames = impact_end - impact_start + 1
		local maya_hold_frames = params.maya_hold_frames or 0
		local maya_recover_frames = params.maya_recover_frames or 0
		local maya_bob_amp = params.maya_bob_amp
		local maya_bob_period_frames = params.maya_bob_period_frames
		local maya_react_scale_x = params.maya_react_scale_x
		local maya_react_scale_y = params.maya_react_scale_y
		local maya_impact_scale_x = params.maya_impact_scale_x
		local maya_impact_scale_y = params.maya_impact_scale_y
		local maya_hold_end = impact_end + maya_hold_frames
		local maya_recover_end = maya_hold_end + maya_recover_frames
		local anticipate_frames = combat_exchange_anticipate_frames
		local lunge_frames = combat_exchange_lunge_frames
		local hitstop_frames = combat_exchange_hitstop_frames
		local recover_frames = frame_count - anticipate_frames - lunge_frames - hitstop_frames
		local lunge_end = anticipate_frames + lunge_frames
		local hitstop_end = lunge_end + hitstop_frames

		for i = 0, frame_count - 1 do
			local lunge = 0
			if i < anticipate_frames then
			local u = i / (anticipate_frames - 1)
			lunge = -0.10 * easing.smoothstep(u)
		elseif i < lunge_end then
			local u = (i - anticipate_frames) / (lunge_frames - 1)
			lunge = easing.ease_in_out_quad(u)
		elseif i < hitstop_end then
			lunge = 1.0
		else
			local u = (i - hitstop_end) / (recover_frames - 1)
			lunge = 1.0 - easing.ease_in_quad(u)
			end

			local impact_u = 0
			if i >= impact_start and i <= impact_end then
				local ru = (i - impact_start) / (impact_frames - 1)
				impact_u = easing.arc01(ru)
			end

			local maya_u = 0
			if i >= impact_start and i <= impact_end then
				local ru = (i - impact_start) / (impact_frames - 1)
				maya_u = easing.ease_out_quad(ru)
			elseif i > impact_end and i <= maya_hold_end then
				maya_u = 1
			elseif i > maya_hold_end and i <= maya_recover_end and maya_recover_frames > 0 then
				local ru = (i - maya_hold_end) / (maya_recover_frames - 1)
				maya_u = 1 - easing.ease_in_quad(ru)
			end

			local forward = lunge
			if forward < 0 then
				forward = 0
			end

			local monster_x = monster_base_x - (combat_exchange_lunge_distance * forward)
			local monster_y = monster_base_y + (combat_exchange_lunge_lift * forward)
			if impact_u > 0 then
				monster_x = monster_x - (combat_exchange_lunge_distance * combat_exchange_lunge_punch * impact_u)
				monster_y = monster_y + (combat_exchange_lunge_lift * combat_exchange_lunge_punch * impact_u)
			end

			local s = 1
			if lunge < 0 then
				s = 1 - (0.04 * (-lunge))
			else
				s = 1 + ((combat_exchange_lunge_scale - 1) * forward)
			end

			local maya_x = maya_base_x
			local maya_y = maya_base_y
			local maya_scale = { x = 1, y = 1 }
			local maya_colorize = { r = 1, g = 1, b = 1, a = 1 }
			local overlay_alpha = 0
			local bob = 0

			if maya_u > 0 then
				maya_x = maya_x + (params.maya_offset_x * maya_u)
				maya_y = maya_y + (params.maya_offset_y * maya_u)
				maya_scale = {
					x = 1 + (maya_react_scale_x * maya_u),
					y = 1 + (maya_react_scale_y * maya_u),
				}
				local bob_u = easing.pingpong01((i - impact_start) / maya_bob_period_frames)
				bob = (bob_u - 0.5) * 2 * maya_bob_amp
			end

			if impact_u > 0 then
				if params.squash then
					maya_scale = {
						x = maya_scale.x + (maya_impact_scale_x * impact_u),
						y = maya_scale.y + (maya_impact_scale_y * impact_u),
					}
				end
				if params.flash then
					local flash_index = i - impact_start
					if (flash_index % 2) == 1 then
						maya_colorize = { r = params.flash_r, g = params.flash_g, b = params.flash_b, a = 1 }
					end
				end
				local cam_dx = round(shake_signed(i * 19 + 5) * params.cam_shake_x * impact_u)
				local cam_dy = round(shake_signed(i * 23 + 11) * params.cam_shake_y * impact_u)
				monster_x = monster_x + cam_dx
				monster_y = monster_y + cam_dy
				maya_x = maya_x + cam_dx
				maya_y = maya_y + cam_dy
				overlay_alpha = params.overlay_alpha * impact_u
			end
			maya_y = maya_y + bob

			frames[#frames + 1] = {
				monster_x = monster_x,
				monster_y = monster_y,
				monster_scale = { x = s, y = s },
				monster_colorize = { r = 1, g = 1, b = 1, a = 1 },
				maya_x = maya_x,
				maya_y = maya_y,
				maya_scale = maya_scale,
				maya_colorize = maya_colorize,
				impact_u = impact_u,
				overlay_alpha = overlay_alpha,
			}
		end

		return frames
	end

	local function build_combat_hit_frames(self, monster)
		local frames = {}
		local base_x = self.combat_hit_origin_x
		local base_y = self.combat_hit_origin_y
		local hold_in = combat_hit_stop_frames
		local peak_frames = combat_hit_peak_frames
		local recover_frames = combat_hit_recover_frames
		local move_frames = combat_hit_frame_count - hold_in - peak_frames - recover_frames
		local peak_start = hold_in + move_frames
		local recover_start = peak_start + peak_frames
		local slash_start = hold_in
		local slash_end = recover_start - 1
		local path_dx = (combat_hit_slash_path_end_x_ratio - combat_hit_slash_path_start_x_ratio) * monster.sx
		local path_dy = (combat_hit_slash_path_end_y_ratio - combat_hit_slash_path_start_y_ratio) * monster.sy
		local path_len = math.sqrt((path_dx * path_dx) + (path_dy * path_dy))
		local path_nx = path_dx / path_len
		local path_ny = path_dy / path_len
		local base_length = monster.sx * combat_hit_slash_length_ratio
		local base_thickness = monster.sy * combat_hit_slash_thickness_ratio

		for frame_index = 0, combat_hit_frame_count - 1 do
			local kick = 0
			if frame_index >= hold_in and frame_index < peak_start then
				local u = (frame_index - hold_in) / (move_frames - 1)
				kick = easing.ease_out_quad(u)
			elseif frame_index >= peak_start and frame_index < recover_start then
				kick = 1
			elseif frame_index >= recover_start then
				local u = (frame_index - recover_start) / (recover_frames - 1)
				kick = 1 - easing.ease_in_quad(u)
			end

			local dx = combat_hit_knockback_x * kick
			local dy = combat_hit_knockback_y * kick
			if frame_index >= hold_in and frame_index < (hold_in + combat_hit_shake_frames) then
				local k = frame_index - hold_in
				local intensity = (combat_hit_shake_frames - k) / combat_hit_shake_frames
				dx = dx + round(shake_signed(frame_index * 31 + 7) * combat_hit_shake_x * intensity)
				dy = dy + round(shake_signed(frame_index * 37 + 11) * combat_hit_shake_y * intensity)
			end

			local monster_x = base_x + dx
			local monster_y = base_y + dy
			local monster_scale = {
				x = 1 + (combat_hit_scale_x * kick),
				y = 1 + (combat_hit_scale_y * kick),
			}

			local monster_colorize = { r = 1, g = 1, b = 1, a = 1 }
			if frame_index >= hold_in and frame_index < recover_start then
				local flash_index = frame_index - hold_in
				if (flash_index % 2) == 1 then
					monster_colorize = { r = 1, g = 0.2, b = 0.2, a = 1 }
				end
			end

			local slash_active = frame_index >= slash_start and frame_index <= slash_end
			local slash_points = nil
			local slash_thickness = 0
			local slash_color = nil
			if slash_active then
				local u = (frame_index - slash_start) / (slash_end - slash_start)
				local arc = easing.arc01(u)
				local center_x = monster_x + (monster.sx * (combat_hit_slash_path_start_x_ratio + ((combat_hit_slash_path_end_x_ratio - combat_hit_slash_path_start_x_ratio) * u)))
				local center_y = monster_y + (monster.sy * (combat_hit_slash_path_start_y_ratio + ((combat_hit_slash_path_end_y_ratio - combat_hit_slash_path_start_y_ratio) * u)))
				local scale = 1 + ((combat_hit_slash_peak_scale - 1) * arc)
				local half = (base_length * scale) / 2
				local x0 = center_x - (path_nx * half)
				local y0 = center_y - (path_ny * half)
				local x1 = center_x + (path_nx * half)
				local y1 = center_y + (path_ny * half)
				slash_points = { x0, y0, x1, y1 }
				slash_thickness = base_thickness * (combat_hit_slash_taper_floor + ((1 - combat_hit_slash_taper_floor) * arc))
				slash_color = { r = 1, g = 1, b = 1, a = combat_hit_slash_alpha * arc }
			end

			frames[#frames + 1] = {
				monster_x = monster_x,
				monster_y = monster_y,
				monster_scale = monster_scale,
				monster_colorize = monster_colorize,
				slash_active = slash_active,
				slash_points = slash_points,
				slash_thickness = slash_thickness,
				slash_color = slash_color,
				slash_z = combat_hit_slash_z,
			}
		end

		return frames
	end

	local function finish_combat_fade_in(self)
		return '/combat_init'
	end

	local function finish_combat_fade_out(self)
		return '/combat_done'
	end

	local function finish_combat_intro(self)
		return '/combat_round'
	end

	local function finish_combat_exchange(self)
		local node = story[self.node_id]
		if self.combat_round_index > #node.rounds then
			return '/combat_all_out_prompt'
		end
		return '/combat_round'
	end

	local function finish_combat_hit(self)
		local monster = object(combat_monster_id)
		monster.sprite_component.colorize = { r = 1, g = 1, b = 1, a = 1 }
		monster.x = self.combat_monster_base_x
		monster.y = self.combat_monster_base_y
		monster:get_component_by_id('base_sprite').scale = { x = 1, y = 1 }
		return '/combat_exchange_miss'
	end

	local function finish_combat_dodge(self)
		local monster = object(combat_monster_id)
		monster.x = self.combat_monster_base_x
		monster.y = self.combat_monster_base_y
		monster:get_component_by_id('base_sprite').scale = { x = 1, y = 1 }
		return '/combat_exchange_hit'
	end

	local function finish_combat_all_out(self)
		return '/combat_focus'
	end

	local function finish_combat_focus(self)
		hide_combat_sprites()
		clear_texts(text_ids_all)
		return '/combat_results_setup'
	end

	local function finish_combat_results_fade_in(self)
		local bg = object(bg_id)
		bg.sprite_component.colorize = { r = combat_results_bg_r, g = combat_results_bg_g, b = combat_results_bg_b, a = combat_results_bg_a }
		local maya_b = object(combat_maya_b_id)
		maya_b.sprite_component.colorize = { r = 1, g = 1, b = 1, a = 1 }
		maya_b.x = self.combat_results_maya_target_x
		local results = object(text_results_id)
		results.text_color = { r = 1, g = 1, b = 1, a = 1 }
		results.centered_block_x = self.combat_results_text_target_x
		return '/combat_results'
	end

	local function finish_combat_results_fade_out(self)
		object(combat_maya_b_id).visible = false
		clear_text(text_results_id)
		local bg = object(bg_id)
		local bg_sprite = bg:get_component_by_id('base_sprite')
		bg.visible = false
		bg:set_image(self.combat_results_prev_bg_imgid)
		bg_sprite.scale = { x = self.combat_results_prev_bg_scale_x, y = self.combat_results_prev_bg_scale_y }
		bg.sprite_component.colorize = { r = 1, g = 1, b = 1, a = 1 }
		hide_combat_sprites()
		local next_kind = story[self.node_id].kind
		if next_kind == 'transition' then
			self.skip_transition_fade = true
			return '/combat_done'
		end
		if next_kind == 'fade' then
			self.combat_exit_target_bg = story[story[self.node_id].next].bg
		else
			self.combat_exit_target_bg = story[self.node_id].bg
		end
		return '/combat_exit_fade_in'
	end

	local function finish_combat_exit_fade_in(self)
		local bg = object(bg_id)
		bg.sprite_component.colorize = { r = 1, g = 1, b = 1, a = 1 }
		return '/combat_done'
	end

	states.combat_fade_in = {
		timelines = {
			[combat_fade_timeline_id] = {
				create = function()
					return new_timeline({
						id = combat_fade_timeline_id,
						frames = combat_fade_frames,
						ticks_per_frame = combat_fade_ticks_per_frame,
						playback_mode = 'once',
					})
				end,
				autoplay = true,
				stop_on_exit = true,
				play_options = { rewind = true, snap_to_start = true },
			},
		},
		entering_state = function(self)
			clear_texts(text_ids_all)
			hide_combat_sprites()
			hide_transition_layers()
			local bg = object(bg_id)
			bg.visible = true
			bg.sprite_component.colorize = { r = 1, g = 1, b = 1, a = 1 }
		end,
		input_eval = 'first',
		input_event_handlers = {
			['b[jp]'] = {
				go = function(self)
					return finish_combat_fade_in(self)
				end,
			},
		},
		on = {
			['timeline.frame.' .. combat_fade_timeline_id] = {
				go = function(self, _state, event)
					local c = event.frame_value.c
					local bg = object(bg_id)
					bg.sprite_component.colorize = { r = c, g = c, b = c, a = 1 }
				end,
			},
			['timeline.end.' .. combat_fade_timeline_id] = {
				go = function(self)
					return finish_combat_fade_in(self)
				end,
			},
		},
		leaving_state = function(self)
			local bg = object(bg_id)
			bg.sprite_component.colorize = { r = 0, g = 0, b = 0, a = 1 }
		end,
	}

	states.combat_fade_out = {
		timelines = {
			[combat_fade_timeline_id] = {
				create = function()
					return new_timeline({
						id = combat_fade_timeline_id,
						frames = combat_fade_frames,
						ticks_per_frame = combat_fade_ticks_per_frame,
						playback_mode = 'once',
					})
				end,
				autoplay = true,
				stop_on_exit = true,
				play_options = { rewind = true, snap_to_start = true },
			},
		},
		entering_state = function(self)
			clear_texts(text_ids_core)
		end,
		input_eval = 'first',
		input_event_handlers = {
			['b[jp]'] = {
				go = function(self)
					return finish_combat_fade_out(self)
				end,
			},
		},
		on = {
			['timeline.end.' .. combat_fade_timeline_id] = {
				go = function(self)
					return finish_combat_fade_out(self)
				end,
			},
		},
	}

	states.combat_init = {
		entering_state = function(self)
			local node = story[self.node_id]
			clear_texts(text_ids_transition_results)
			reset_text_colors()
			hide_transition_layers()

			local bg = object(bg_id)
			bg.visible = false

			self.combat_round_index = 1
			self.combat_points = 0
			self.combat_max_points = #node.rounds
			self.combat_hover_time = 0

			local monster = object(combat_monster_id)
			monster:set_image(node.monster_imgid)
			monster.visible = false
			monster.sprite_component.colorize = { r = 1, g = 1, b = 1, a = 1 }
			monster.z = 200
			monster:get_component_by_id('base_sprite').scale = { x = 1, y = 1 }

			monster.x = (display_width() * 0.65) - (monster.sx / 2)
			monster.y = (display_height() * 0.25) - (monster.sy / 3)

			self.combat_monster_base_x = monster.x
			self.combat_monster_base_y = monster.y
			self.combat_monster_start_x = (display_width() * 0.2) - (monster.sx / 2)
			self.combat_monster_start_y = self.combat_monster_base_y
			self.combat_monster_start_scale = math.max(1, display_width() / monster.sx, display_height() / monster.sy)

			local maya_a = object(combat_maya_a_id)
			maya_a:set_image('maya_a')
			maya_a.visible = false
			maya_a.x = 0
			maya_a.y = display_height() - maya_a.sy
			maya_a.z = 300
			self.combat_maya_a_base_x = maya_a.x
			self.combat_maya_a_base_y = maya_a.y
			self.combat_maya_a_start_x = display_width()
			self.combat_maya_a_start_scale = combat_intro_maya_a_scale_ratio

			local all_out = object(combat_all_out_id)
			all_out.visible = false
			all_out.x = 0
			all_out.y = 0
			all_out.z = 800

			local maya_b = object(combat_maya_b_id)
			maya_b:set_image('maya_b')
			maya_b.visible = true
			maya_b.sprite_component.colorize = { r = 1, g = 1, b = 1, a = 1 }
			maya_b.x = display_width() - maya_b.sx
			maya_b.y = display_height() - maya_b.sy
			maya_b.z = 300
			self.combat_maya_b_start_x = maya_b.x
			self.combat_maya_b_base_y = maya_b.y
			self.combat_maya_b_start_scale = combat_intro_maya_b_start_scale
			self.combat_maya_b_end_scale = combat_intro_maya_b_end_scale
			self.combat_maya_b_start_right_x = self.combat_maya_b_start_x + maya_b.sx
			self.combat_maya_b_exit_right_x = self.combat_maya_b_start_right_x + maya_b.sx

			self:reset_combat_parallax()
			return '/combat_intro'
		end,
	}

	states.combat_intro = {
		entering_state = function(self)
			local monster = object(combat_monster_id)
			local maya_a = object(combat_maya_a_id)
			local maya_b = object(combat_maya_b_id)
			local frames = build_combat_intro_frames(self, monster, maya_a, maya_b)
			self:define_timeline(new_timeline({
				id = combat_intro_timeline_id,
				frames = frames,
				ticks_per_frame = combat_intro_ticks_per_frame,
				playback_mode = 'once',
			}))
			self:play_timeline(combat_intro_timeline_id, { rewind = true, snap_to_start = true })
		end,
		input_eval = 'first',
		input_event_handlers = {
			['b[jp]'] = {
				go = function(self)
					return finish_combat_intro(self)
				end,
			},
		},
		on = {
			['timeline.frame.' .. combat_intro_timeline_id] = {
				go = function(_self, _state, event)
					local frame = event.frame_value
					local monster = object(combat_monster_id)
					local maya_a = object(combat_maya_a_id)
					local maya_b = object(combat_maya_b_id)

					monster.visible = frame.monster_visible
					monster:get_component_by_id('base_sprite').scale = { x = frame.monster_scale, y = frame.monster_scale }
					monster.x = frame.monster_x
					monster.y = frame.monster_y

					maya_a.visible = frame.maya_a_visible
					maya_a:get_component_by_id('base_sprite').scale = { x = frame.maya_a_scale, y = frame.maya_a_scale }
					maya_a.x = frame.maya_a_x
					maya_a.y = frame.maya_a_y

					maya_b.visible = frame.maya_b_visible
					maya_b:get_component_by_id('base_sprite').scale = { x = frame.maya_b_scale, y = frame.maya_b_scale }
					maya_b.x = frame.maya_b_x
					maya_b.y = frame.maya_b_y
				end,
			},
			['timeline.end.' .. combat_intro_timeline_id] = {
				go = function(self)
					return finish_combat_intro(self)
				end,
			},
		},
		leaving_state = function(self)
			local monster = object(combat_monster_id)
			monster:get_component_by_id('base_sprite').scale = { x = 1, y = 1 }
			monster.x = self.combat_monster_base_x
			monster.y = self.combat_monster_base_y
			monster.visible = true

			local maya_a = object(combat_maya_a_id)
			maya_a:get_component_by_id('base_sprite').scale = { x = 1, y = 1 }
			maya_a.x = self.combat_maya_a_base_x
			maya_a.y = self.combat_maya_a_base_y
			maya_a.visible = true

			local maya_b = object(combat_maya_b_id)
			maya_b:get_component_by_id('base_sprite').scale = { x = 1, y = 1 }
			maya_b.visible = false
			maya_b.x = self.combat_maya_b_start_x
			maya_b.y = self.combat_maya_b_base_y
		end,
	}

	states.combat_round = {
		entering_state = function(self)
			local node = story[self.node_id]
			clear_texts(text_ids_transition_results)
			local bg = object(bg_id)
			bg.visible = false
			local monster = object(combat_monster_id)
			monster:set_image(node.monster_imgid)
			monster.visible = true
			local maya_a = object(combat_maya_a_id)
			maya_a:set_image('maya_a')
			maya_a.visible = true
			object(combat_all_out_id).visible = false
			object(combat_maya_b_id).visible = false
			self:apply_combat_round(node)
		end,
		tick = function(self)
			self:update_combat_hover()
			local main = object(text_main_id)
			if main.is_typing then
				main:type_next()
				return
			end
			set_prompt_line('(A) select')
			local choice_text = object(text_choice_id)
			choice_text.highlighted_line_index = self.choice_index - 1
		end,
		input_eval = 'first',
		input_event_handlers = {
			['up[jp]'] = {
				go = function(self)
					self.choice_index = math.max(1, self.choice_index - 1)
				end,
			},
			['down[jp]'] = {
				go = function(self)
					local node = story[self.node_id]
					local round = node.rounds[self.combat_round_index]
					self.choice_index = math.min(#round.options, self.choice_index + 1)
				end,
			},
			['b[jp]'] = {
				go = function(self) self:skip_typing() end
			},
			['a[jp]'] = {
				go = function(self)
					if self:is_typing() then return end
					local node = story[self.node_id]
					local round = node.rounds[self.combat_round_index]
					local option = round.options[self.choice_index]
					self.combat_points = self.combat_points + option.points
					self.combat_round_index = self.combat_round_index + 1
					if option.outcome == 'hit' then
						return '/combat_hit'
					end
					return '/combat_dodge'
				end,
			},
		},
	}

	states.combat_hit = {
		entering_state = function(self)
			clear_texts(text_ids_choice_prompt)
			set_text_lines(text_main_id, { 'RAAK!' }, false)
			self:push_combat_momentum('hero', combat_parallax_momentum_step)
			local monster = object(combat_monster_id)
			monster.x = self.combat_monster_base_x
			monster.y = self.combat_monster_base_y
			monster:get_component_by_id('base_sprite').scale = { x = 1, y = 1 }
			self.combat_hit_origin_x = monster.x
			self.combat_hit_origin_y = monster.y
			local frames = build_combat_hit_frames(self, monster)
			self:define_timeline(new_timeline({
				id = combat_hit_timeline_id,
				frames = frames,
				ticks_per_frame = combat_hit_ticks_per_frame,
				playback_mode = 'once',
			}))
			self:play_timeline(combat_hit_timeline_id, { rewind = true, snap_to_start = true })
		end,
		input_eval = 'first',
		input_event_handlers = {
			['b[jp]'] = {
				go = function(self)
					return finish_combat_hit(self)
				end,
			},
		},
		on = {
			['timeline.frame.' .. combat_hit_timeline_id] = {
				go = function(self, _state, event)
					local frame = event.frame_value
					local monster = object(combat_monster_id)
					monster.x = frame.monster_x
					monster.y = frame.monster_y
					monster:get_component_by_id('base_sprite').scale = frame.monster_scale
					monster.sprite_component.colorize = frame.monster_colorize
					self.combat_hit_slash_frame.slash_active = frame.slash_active
					self.combat_hit_slash_frame.slash_points = frame.slash_points
					self.combat_hit_slash_frame.slash_thickness = frame.slash_thickness
					self.combat_hit_slash_frame.slash_color = frame.slash_color
					self.combat_hit_slash_frame.slash_z = frame.slash_z
				end,
			},
			['timeline.end.' .. combat_hit_timeline_id] = {
				go = function(self)
					return finish_combat_hit(self)
				end,
			},
		},
		leaving_state = function(self)
			self:stop_timeline(combat_hit_timeline_id)
			self.combat_hit_slash_frame.slash_active = false
		end,
	}

	states.combat_dodge = {
		timelines = {
			[combat_dodge_timeline_id] = {
				create = function()
					return new_timeline({
						id = combat_dodge_timeline_id,
						frames = build_combat_dodge_frames,
						ticks_per_frame = combat_dodge_ticks_per_frame,
						playback_mode = 'once',
					})
				end,
				autoplay = false,
				stop_on_exit = true,
			},
		},
		entering_state = function(self)
			clear_texts(text_ids_choice_prompt)
			set_text_lines(text_main_id, { 'ONTWIJKT!' }, false)
			local monster = object(combat_monster_id)
			monster:get_component_by_id('base_sprite').scale = { x = 1, y = 1 }
			self.combat_dodge_dir = -self.combat_dodge_dir
			self:play_timeline(combat_dodge_timeline_id, {
				rewind = true,
				snap_to_start = true,
				params = { dir = self.combat_dodge_dir },
			})
		end,
		input_eval = 'first',
		input_event_handlers = {
			['b[jp]'] = {
				go = function(self)
					return finish_combat_dodge(self)
				end,
			},
		},
		on = {
			['timeline.frame.' .. combat_dodge_timeline_id] = {
				go = function(self, _state, event)
					local monster = object(combat_monster_id)
					local frame = event.frame_value
					monster.x = self.combat_monster_base_x + frame.offset
					monster:get_component_by_id('base_sprite').scale = { x = frame.scale_x, y = frame.scale_y }
				end,
			},
			['timeline.end.' .. combat_dodge_timeline_id] = {
				go = function(self)
					return finish_combat_dodge(self)
				end,
			},
		},
	}

	states.combat_exchange_hit = {
		entering_state = function(self)
			local monster = object(combat_monster_id)
			local maya_a = object(combat_maya_a_id)
			local overlay = object(transition_overlay_id)
			clear_texts(text_ids_choice_prompt)
			self:push_combat_momentum('monster', combat_parallax_momentum_step)
			monster.visible = true
			maya_a.visible = true
			monster.x = self.combat_monster_base_x
			monster.y = self.combat_monster_base_y
			maya_a.x = self.combat_maya_a_base_x
			maya_a.y = self.combat_maya_a_base_y
			monster:get_component_by_id('base_sprite').scale = { x = 1, y = 1 }
			maya_a:get_component_by_id('base_sprite').scale = { x = 1, y = 1 }
			monster.sprite_component.colorize = { r = 1, g = 1, b = 1, a = 1 }
			maya_a.sprite_component.colorize = { r = 1, g = 1, b = 1, a = 1 }
			overlay.visible = true
			overlay:set_image('whitepixel')
			overlay.x = 0
			overlay.y = 0
			overlay:get_component_by_id('base_sprite').scale = { x = display_width(), y = display_height() }
			overlay.sprite_component.colorize = { r = 0, g = 0, b = 0, a = 0 }

			local frames = build_combat_exchange_frames(self, {
				frame_count = combat_exchange_hit_frame_count,
				maya_offset_x = combat_exchange_hit_recoil_distance,
				maya_offset_y = combat_exchange_hit_recoil_lift,
				maya_hold_frames = combat_exchange_hit_recoil_hold_frames,
				maya_recover_frames = combat_exchange_hit_recoil_recover_frames,
				maya_bob_amp = 0,
				maya_bob_period_frames = combat_exchange_miss_dodge_bob_period_frames,
				maya_react_scale_x = combat_exchange_hit_scale_x,
				maya_react_scale_y = combat_exchange_hit_scale_y,
				maya_impact_scale_x = combat_exchange_hit_impact_scale_x,
				maya_impact_scale_y = combat_exchange_hit_impact_scale_y,
				flash = true,
				flash_r = p3_cyan_r,
				flash_g = p3_cyan_g,
				flash_b = p3_cyan_b,
				squash = true,
				cam_shake_x = combat_exchange_hit_shake_x,
				cam_shake_y = combat_exchange_hit_shake_y,
				overlay_alpha = combat_exchange_hit_overlay_alpha,
			})

			self:define_timeline(new_timeline({
				id = combat_exchange_hit_timeline_id,
				frames = frames,
				ticks_per_frame = combat_exchange_hit_ticks_per_frame,
				playback_mode = 'once',
			}))
			self:play_timeline(combat_exchange_hit_timeline_id, { rewind = true, snap_to_start = true })
		end,
		input_eval = 'first',
		input_event_handlers = {
			['b[jp]'] = {
				go = function(self)
					return finish_combat_exchange(self)
				end,
			},
		},
		on = {
			['timeline.frame.' .. combat_exchange_hit_timeline_id] = {
				go = function(_self, _state, event)
					local frame = event.frame_value
					local monster = object(combat_monster_id)
					local maya_a = object(combat_maya_a_id)
					local overlay = object(transition_overlay_id)
					monster.x = frame.monster_x
					monster.y = frame.monster_y
					monster:get_component_by_id('base_sprite').scale = frame.monster_scale
					monster.sprite_component.colorize = frame.monster_colorize
					maya_a.x = frame.maya_x
					maya_a.y = frame.maya_y
					maya_a:get_component_by_id('base_sprite').scale = frame.maya_scale
					maya_a.sprite_component.colorize = frame.maya_colorize
					if frame.overlay_alpha > 0 then
						overlay.sprite_component.colorize = { r = p3_cyan_r, g = p3_cyan_g, b = p3_cyan_b, a = frame.overlay_alpha }
					else
						overlay.sprite_component.colorize = { r = 0, g = 0, b = 0, a = 0 }
					end
				end,
			},
			['timeline.end.' .. combat_exchange_hit_timeline_id] = {
				go = function(self)
					return finish_combat_exchange(self)
				end,
			},
		},
		leaving_state = function(self)
			local monster = object(combat_monster_id)
			local maya_a = object(combat_maya_a_id)
			local overlay = object(transition_overlay_id)
			monster.x = self.combat_monster_base_x
			monster.y = self.combat_monster_base_y
			maya_a.x = self.combat_maya_a_base_x
			maya_a.y = self.combat_maya_a_base_y
			monster:get_component_by_id('base_sprite').scale = { x = 1, y = 1 }
			maya_a:get_component_by_id('base_sprite').scale = { x = 1, y = 1 }
			monster.sprite_component.colorize = { r = 1, g = 1, b = 1, a = 1 }
			maya_a.sprite_component.colorize = { r = 1, g = 1, b = 1, a = 1 }
			overlay.visible = false
			overlay.sprite_component.colorize = { r = 0, g = 0, b = 0, a = 0 }
		end,
	}

	states.combat_exchange_miss = {
		entering_state = function(self)
			local monster = object(combat_monster_id)
			local maya_a = object(combat_maya_a_id)
			local overlay = object(transition_overlay_id)
			clear_texts(text_ids_choice_prompt)
			monster.visible = true
			maya_a.visible = true
			monster.x = self.combat_monster_base_x
			monster.y = self.combat_monster_base_y
			maya_a.x = self.combat_maya_a_base_x
			maya_a.y = self.combat_maya_a_base_y
			monster:get_component_by_id('base_sprite').scale = { x = 1, y = 1 }
			maya_a:get_component_by_id('base_sprite').scale = { x = 1, y = 1 }
			monster.sprite_component.colorize = { r = 1, g = 1, b = 1, a = 1 }
			maya_a.sprite_component.colorize = { r = 1, g = 1, b = 1, a = 1 }
			overlay.visible = true
			overlay:set_image('whitepixel')
			overlay.x = 0
			overlay.y = 0
			overlay:get_component_by_id('base_sprite').scale = { x = display_width(), y = display_height() }
			overlay.sprite_component.colorize = { r = 0, g = 0, b = 0, a = 0 }

			local frames = build_combat_exchange_frames(self, {
				frame_count = combat_exchange_miss_frame_count,
				maya_offset_x = combat_exchange_miss_dodge_distance,
				maya_offset_y = combat_exchange_miss_dodge_lift,
				maya_hold_frames = combat_exchange_miss_dodge_hold_frames,
				maya_recover_frames = combat_exchange_miss_dodge_recover_frames,
				maya_bob_amp = combat_exchange_miss_dodge_bob_amp,
				maya_bob_period_frames = combat_exchange_miss_dodge_bob_period_frames,
				maya_react_scale_x = combat_exchange_miss_dodge_scale_x,
				maya_react_scale_y = combat_exchange_miss_dodge_scale_y,
				maya_impact_scale_x = 0,
				maya_impact_scale_y = 0,
				flash = false,
				flash_r = 1,
				flash_g = 1,
				flash_b = 1,
				squash = false,
				cam_shake_x = 0,
				cam_shake_y = 0,
				overlay_alpha = 0,
			})

			self:define_timeline(new_timeline({
				id = combat_exchange_miss_timeline_id,
				frames = frames,
				ticks_per_frame = combat_exchange_miss_ticks_per_frame,
				playback_mode = 'once',
			}))
			self:play_timeline(combat_exchange_miss_timeline_id, { rewind = true, snap_to_start = true })
		end,
		input_eval = 'first',
		input_event_handlers = {
			['b[jp]'] = {
				go = function(self)
					return finish_combat_exchange(self)
				end,
			},
		},
		on = {
			['timeline.frame.' .. combat_exchange_miss_timeline_id] = {
				go = function(_self, _state, event)
					local frame = event.frame_value
					local monster = object(combat_monster_id)
					local maya_a = object(combat_maya_a_id)
					local overlay = object(transition_overlay_id)
					monster.x = frame.monster_x
					monster.y = frame.monster_y
					monster:get_component_by_id('base_sprite').scale = frame.monster_scale
					monster.sprite_component.colorize = frame.monster_colorize
					maya_a.x = frame.maya_x
					maya_a.y = frame.maya_y
					maya_a:get_component_by_id('base_sprite').scale = frame.maya_scale
					maya_a.sprite_component.colorize = frame.maya_colorize
					if frame.overlay_alpha > 0 then
						overlay.sprite_component.colorize = { r = p3_cyan_r, g = p3_cyan_g, b = p3_cyan_b, a = frame.overlay_alpha }
					else
						overlay.sprite_component.colorize = { r = 0, g = 0, b = 0, a = 0 }
					end
				end,
			},
			['timeline.end.' .. combat_exchange_miss_timeline_id] = {
				go = function(self)
					return finish_combat_exchange(self)
				end,
			},
		},
		leaving_state = function(self)
			local monster = object(combat_monster_id)
			local maya_a = object(combat_maya_a_id)
			local overlay = object(transition_overlay_id)
			monster.x = self.combat_monster_base_x
			monster.y = self.combat_monster_base_y
			maya_a.x = self.combat_maya_a_base_x
			maya_a.y = self.combat_maya_a_base_y
			monster:get_component_by_id('base_sprite').scale = { x = 1, y = 1 }
			maya_a:get_component_by_id('base_sprite').scale = { x = 1, y = 1 }
			monster.sprite_component.colorize = { r = 1, g = 1, b = 1, a = 1 }
			maya_a.sprite_component.colorize = { r = 1, g = 1, b = 1, a = 1 }
			overlay.visible = false
			overlay.sprite_component.colorize = { r = 0, g = 0, b = 0, a = 0 }
		end,
	}

	states.combat_all_out_prompt = {
		entering_state = function(self)
			clear_texts(text_ids_choice_prompt)
			set_text_lines(text_main_id, { 'Het monster lijkt rijp voor de sloop!' }, true)
			set_text_lines(text_choice_id, { 'ALL-OUT-ATTACK!!' }, false)
			self.choice_index = 1
		end,
		tick = function(self)
			self:update_combat_hover()
			local main = object(text_main_id)
			if main.is_typing then
				main:type_next()
				return
			end
			set_prompt_line('(A) ATTACK')
			object(text_choice_id).highlighted_line_index = 0
		end,
		input_eval = 'first',
		input_event_handlers = {
			['b[jp]'] = {
				go = function(self) self:skip_typing() end
			},
			['a[jp]'] = {
				go = function(self)
					if self:is_typing() then return end
					return '/combat_all_out'
				end,
			},
		},
	}

	states.combat_all_out = {
		timelines = {
			[combat_all_out_timeline_id] = {
				create = function()
					return new_timeline({
						id = combat_all_out_timeline_id,
						frames = build_combat_all_out_frames,
						ticks_per_frame = combat_all_out_ticks_per_frame,
						playback_mode = 'once',
					})
				end,
				autoplay = false,
				stop_on_exit = true,
			},
		},
		entering_state = function(self)
			hide_combat_sprites()
			clear_texts(text_ids_all)
			local all_out = object(combat_all_out_id)
			all_out:get_component_by_id('base_sprite').scale = { x = 1, y = 1 }
			all_out.visible = true
			all_out.x = 0
			all_out.y = 0
			self.all_out_origin_x = all_out.x
			self.all_out_origin_y = all_out.y
			self:play_timeline(combat_all_out_timeline_id, {
				rewind = true,
				snap_to_start = true,
				params = {
					origin_x = self.all_out_origin_x,
					origin_y = self.all_out_origin_y,
					sprite_w = all_out.sx,
					sprite_h = all_out.sy,
				},
			})
		end,
		input_eval = 'first',
		input_event_handlers = {
			['b[jp]'] = {
				go = function(self)
					return finish_combat_all_out(self)
				end,
			},
		},
		on = {
			['timeline.frame.' .. combat_all_out_timeline_id] = {
				go = function(self, _state, event)
					local frame = event.frame_value
					local all_out = object(combat_all_out_id)
					all_out:get_component_by_id('base_sprite').scale = { x = frame.sx, y = frame.sy }
					all_out.x = frame.x
					all_out.y = frame.y
				end,
			},
			['timeline.end.' .. combat_all_out_timeline_id] = {
				go = function(self)
					return finish_combat_all_out(self)
				end,
			},
		},
		leaving_state = function(self)
			local all_out = object(combat_all_out_id)
			all_out:get_component_by_id('base_sprite').scale = { x = 1, y = 1 }
			all_out.visible = false
			all_out.x = self.all_out_origin_x
			all_out.y = self.all_out_origin_y
		end,
	}

	states.combat_focus = {
		entering_state = function(self)
			local monster = object(combat_monster_id)

			self:play_timeline(combat_focus_timeline_id, {
				rewind = true,
				snap_to_start = true,
				params = {
					monster = monster,
					base_x = self.combat_monster_base_x,
					base_y = self.combat_monster_base_y,
				},
			})
		end,
		input_eval = 'first',
		input_event_handlers = {
			['b[jp]'] = {
				go = function(self)
					return finish_combat_focus(self)
				end,
			},
		},
		on = {
			['timeline.frame.' .. combat_focus_timeline_id] = {
				go = function(_self, _state, event)
					local frame = event.frame_value
					local monster = object(combat_monster_id)
					monster.visible = frame.visible
					monster:get_component_by_id('base_sprite').scale = frame.scale
					monster.x = frame.x
					monster.y = frame.y
					monster.sprite_component.colorize = frame.colorize
				end,
			},
			['combat_focus.snap'] = {
				go = function(self)
					hide_combat_sprites()
					clear_texts(text_ids_all)
				end,
			},
			['combat_focus.done'] = {
				go = function(self)
					return '/combat_results_setup'
				end,
			},
		},
	}

	states.combat_results_setup = {
		entering_state = function(self)
			local node = story[self.node_id]
			local rewards = self:resolve_combat_rewards(node)
			self.combat_rewards = rewards
			object(director_instance_id).events:emit('combat.results', {
				combat_node_id = self.combat_node_id,
				monster_imgid = self.combat_monster_imgid,
			})

			clear_texts(text_ids_core)

			local monster = object(combat_monster_id)
			monster.visible = false
			local maya_a = object(combat_maya_a_id)
			maya_a.visible = false
			local all_out = object(combat_all_out_id)
			all_out.visible = false

			local bg = object(bg_id)
			local bg_sprite = bg:get_component_by_id('base_sprite')
			self.combat_results_prev_bg_imgid = bg.imgid
			self.combat_results_prev_bg_scale_x = bg_sprite.scale.x
			self.combat_results_prev_bg_scale_y = bg_sprite.scale.y
			bg.visible = true
			bg:set_image('whitepixel')
			bg.x = 0
			bg.y = 0
			bg_sprite.scale = { x = display_width(), y = display_height() }
			bg.sprite_component.colorize = { r = combat_results_bg_r, g = combat_results_bg_g, b = combat_results_bg_b, a = 0 }

			local maya_b = object(combat_maya_b_id)
			maya_b:set_image('maya_b')
			maya_b.visible = true
			self.combat_results_maya_target_x = display_width() - maya_b.sx
			self.combat_results_maya_start_x = display_width()
			maya_b.x = self.combat_results_maya_start_x
			maya_b.y = display_height() - maya_b.sy
			maya_b.sprite_component.colorize = { r = 1, g = 1, b = 1, a = 0 }
			maya_b.z = 300

			local lines = { 'Combat Results:' }
			for i = 1, #rewards do
				local effect = rewards[i]
				lines[#lines + 1] = stat_label(effect.stat) .. ' +' .. effect.add
			end
			set_text_lines(text_results_id, lines, false)
			local results = object(text_results_id)
			results.text_color = { r = 1, g = 1, b = 1, a = 0 }
			self.combat_results_text_target_x = results.centered_block_x / 2
			self.combat_results_text_start_x = -display_width()
			results.centered_block_x = self.combat_results_text_start_x
			return '/combat_results_fade_in'
		end,
	}

	states.combat_results_fade_in = {
		timelines = {
			[combat_results_fade_in_timeline_id] = {
				create = function()
					return new_timeline({
						id = combat_results_fade_in_timeline_id,
						frames = build_combat_results_fade_in_frames,
						ticks_per_frame = combat_results_fade_in_ticks_per_frame,
						playback_mode = 'once',
					})
				end,
				autoplay = false,
				stop_on_exit = true,
			},
		},
		entering_state = function(self)
			self:play_timeline(combat_results_fade_in_timeline_id, {
				rewind = true,
				snap_to_start = true,
				params = {
					maya_start_x = self.combat_results_maya_start_x,
					maya_target_x = self.combat_results_maya_target_x,
					text_start_x = self.combat_results_text_start_x,
					text_target_x = self.combat_results_text_target_x,
				},
			})
		end,
		input_eval = 'first',
		input_event_handlers = {
			['b[jp]'] = {
				go = function(self)
					return finish_combat_results_fade_in(self)
				end,
			},
		},
		on = {
			['timeline.frame.' .. combat_results_fade_in_timeline_id] = {
				go = function(self, _state, event)
					local frame = event.frame_value
					local bg = object(bg_id)
					bg.sprite_component.colorize = { r = combat_results_bg_r, g = combat_results_bg_g, b = combat_results_bg_b, a = frame.bg_a }
					local maya_b = object(combat_maya_b_id)
					maya_b.sprite_component.colorize = { r = 1, g = 1, b = 1, a = frame.a }
					maya_b.x = frame.maya_x
					local results = object(text_results_id)
					results.text_color = { r = 1, g = 1, b = 1, a = frame.a }
					results.centered_block_x = frame.text_x
				end,
			},
			['timeline.end.' .. combat_results_fade_in_timeline_id] = {
				go = function(self)
					return finish_combat_results_fade_in(self)
				end,
			},
		},
	}

	states.combat_results = {
		input_eval = 'first',
		input_event_handlers = {
			['a[jp]'] = {
				go = function(self)
					local node = story[self.node_id]
					self.node_id = node.next
					return '/combat_results_fade_out'
				end,
			},
		},
	}

	states.combat_results_fade_out = {
		timelines = {
			[combat_results_fade_out_timeline_id] = {
				create = function()
					return new_timeline({
						id = combat_results_fade_out_timeline_id,
						frames = combat_results_fade_out_frames_table,
						ticks_per_frame = combat_results_fade_out_ticks_per_frame,
						playback_mode = 'once',
					})
				end,
				autoplay = true,
				stop_on_exit = true,
				play_options = { rewind = true, snap_to_start = true },
			},
		},
		entering_state = function(self)
			clear_texts(text_ids_core)
		end,
		input_eval = 'first',
		input_event_handlers = {
			['b[jp]'] = {
				go = function(self)
					return finish_combat_results_fade_out(self)
				end,
			},
		},
		on = {
			['timeline.frame.' .. combat_results_fade_out_timeline_id] = {
				go = function(self, _state, event)
					local frame = event.frame_value
					local bg = object(bg_id)
					bg.sprite_component.colorize = { r = combat_results_bg_r, g = combat_results_bg_g, b = combat_results_bg_b, a = frame.bg_a }
					local maya_b = object(combat_maya_b_id)
					maya_b.sprite_component.colorize = { r = 1, g = 1, b = 1, a = frame.a }
					local results = object(text_results_id)
					results.text_color = { r = 1, g = 1, b = 1, a = frame.a }
				end,
			},
			['timeline.end.' .. combat_results_fade_out_timeline_id] = {
				go = function(self)
					return finish_combat_results_fade_out(self)
				end,
			},
		},
	}

	states.combat_exit_fade_in = {
		timelines = {
			[combat_exit_fade_in_timeline_id] = {
				create = function()
					return new_timeline({
						id = combat_exit_fade_in_timeline_id,
						frames = combat_exit_fade_in_frames_table,
						ticks_per_frame = combat_exit_fade_in_ticks_per_frame,
						playback_mode = 'once',
					})
				end,
				autoplay = true,
				stop_on_exit = true,
				play_options = { rewind = true, snap_to_start = true },
			},
		},
		entering_state = function(self)
			local bg = object(bg_id)
			apply_background(self.combat_exit_target_bg)
			bg.visible = true
			bg.sprite_component.colorize = { r = 0, g = 0, b = 0, a = 1 }
		end,
		input_eval = 'first',
		input_event_handlers = {
			['b[jp]'] = {
				go = function(self)
					return finish_combat_exit_fade_in(self)
				end,
			},
		},
		on = {
			['timeline.frame.' .. combat_exit_fade_in_timeline_id] = {
				go = function(self, _state, event)
					local c = event.frame_value.c
					local bg = object(bg_id)
					bg.sprite_component.colorize = { r = c, g = c, b = c, a = 1 }
				end,
			},
			['timeline.end.' .. combat_exit_fade_in_timeline_id] = {
				go = function(self)
					return finish_combat_exit_fade_in(self)
				end,
			},
		},
		leaving_state = function(self)
			local bg = object(bg_id)
			bg.sprite_component.colorize = { r = 1, g = 1, b = 1, a = 1 }
		end,
	}

	define_fsm(combat_director_fsm_id, {
		initial = 'boot',
		states = states,
	})
end

function combat.register_director()
	define_world_object({
		def_id = combat_director_def_id,
		class = combat_director,
		fsms = { combat_director_fsm_id },
		defaults = {
			node_id = '',
			choice_index = 1,
			combat_round_index = 1,
			combat_points = 0,
			combat_max_points = 0,
			combat_hover_time = 0,
			combat_monster_base_x = 0,
			combat_monster_base_y = 0,
			combat_hit_origin_x = 0,
			combat_hit_origin_y = 0,
			combat_monster_start_x = 0,
			combat_monster_start_y = 0,
			combat_monster_start_scale = 1,
			combat_maya_a_base_x = 0,
			combat_maya_a_base_y = 0,
			combat_maya_a_start_x = 0,
			combat_maya_a_start_scale = 1,
			combat_maya_b_start_x = 0,
			combat_maya_b_base_y = 0,
			combat_maya_b_start_scale = 1,
			combat_maya_b_end_scale = 1,
			combat_maya_b_start_right_x = 0,
			combat_maya_b_exit_right_x = 0,
			combat_dodge_dir = 1,
			all_out_origin_x = 0,
			all_out_origin_y = 0,
			combat_exit_target_bg = '',
			combat_results_prev_bg_imgid = '',
			combat_results_prev_bg_scale_x = 1,
			combat_results_prev_bg_scale_y = 1,
			combat_results_maya_target_x = 0,
			combat_results_maya_start_x = 0,
			combat_results_text_target_x = 0,
			combat_results_text_start_x = 0,
			combat_parallax_enabled = false,
			combat_parallax_momentum = 0,
			combat_parallax_impact_t = 0,
			combat_parallax_impact_side = '',
			skip_combat_fade_in = false,
			skip_transition_fade = false,
			combat_node_id = '',
			combat_monster_imgid = '',
			combat_rewards = {},
		},
	})
end

return combat
