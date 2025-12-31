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
	local impact_frames = 8
	local finisher_frames = 10
	local finisher_start = total_frames - finisher_frames

	return function(frame_index)
		if frame_index < impact_frames then
			local amp_x = 12 - (frame_index * 2)
			local amp_y = 5 - frame_index
			return round(shake_signed(frame_index * 31 + 7) * amp_x), round(shake_signed(frame_index * 47 + 13) * amp_y)
		end

		if frame_index < finisher_start then
			local step = math.floor(frame_index / 2)
			local loop = step % 16
			local base_x = 3
			local base_y = 1
			local dx = round(shake_signed(loop * 29 + 3) * base_x)
			local dy = round(shake_signed(loop * 31 + 9) * base_y)

			local segment_len = 20
			local segment_index = math.floor((frame_index - impact_frames) / segment_len)
			local segment_start = impact_frames + (segment_index * segment_len)
			local accent_at = segment_start + 5 + (shake_hash(segment_index * 73 + 11) & 7)
			local accent_len = 3
			if frame_index >= accent_at and frame_index < (accent_at + accent_len) then
				local k = frame_index - accent_at
				local intensity = (accent_len - k) / accent_len
				dx = dx + round(shake_signed(segment_index * 199 + k * 17 + 5) * 8 * intensity)
				dy = dy + round(shake_signed(segment_index * 211 + k * 19 + 9) * 3 * intensity)
			end

			return dx, dy
		end

		if frame_index >= (total_frames - 1) then
			return 0, 0
		end

		local k = frame_index - finisher_start
		local fin_len = total_frames - finisher_start
		local intensity = (fin_len - k) / fin_len
		return round(shake_signed(5000 + k * 37 + 1) * 14 * intensity), round(shake_signed(6000 + k * 41 + 3) * 5 * intensity)
	end
end

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
	local wave = smoothstep(pingpong01(u))
	local offset = (wave - 0.5) * 2 * combat_monster_hover_amp
	monster.y = self.combat_monster_base_y + offset
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

		local vanish_scale = combat_focus_vanish_scale
		local vanish_target_x = (display_width() - (monster.sx * vanish_scale)) / 2
		local vanish_target_y = ((display_height() - (monster.sy * vanish_scale)) / 2) + combat_focus_vanish_lift

		for i = 0, combat_focus_zoom_frames - 1 do
			local u = i / (combat_focus_zoom_frames - 1)
			local eased = smoothstep(u)
			local turn = arc01(u)
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
			local eased = smoothstep(u)
			local turn = arc01(u)
			local s = zoom_scale + ((vanish_scale - zoom_scale) * eased)
			local x = zoom_target_x + (vanish_target_x - zoom_target_x) * eased + (combat_focus_vanish_arc_x * turn)
			local y = zoom_target_y + (vanish_target_y - zoom_target_y) * eased + (combat_focus_vanish_arc_y * turn)
			local alpha = 1 - eased

			frames[#frames + 1] = {
				visible = alpha > 0,
				x = x,
				y = y,
				scale = { x = s, y = s },
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
			local eased = smoothstep(u)
			local turn = arc01(u)
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
			local eased = smoothstep(u)
			local turn = arc01(u)

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

	local all_out_shake = build_all_out_shake(combat_all_out_frame_count)
	local function finish_combat_fade_in(self)
		return '/combat_init'
	end

	local function finish_combat_fade_out(self)
		return '/combat_done'
	end

	local function finish_combat_intro(self)
		return '/combat_round'
	end

	local function finish_combat_hit(self)
		local monster = object(combat_monster_id)
		monster.sprite_component.colorize = { r = 1, g = 1, b = 1, a = 1 }
		local node = story[self.node_id]
		if self.combat_round_index > #node.rounds then
			return '/combat_all_out_prompt'
		end
		return '/combat_round'
	end

	local function finish_combat_dodge(self)
		local monster = object(combat_monster_id)
		monster.x = self.combat_monster_base_x
		local node = story[self.node_id]
		if self.combat_round_index > #node.rounds then
			return '/combat_all_out_prompt'
		end
		return '/combat_round'
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
					return new_timeline_range({
						id = combat_fade_timeline_id,
						frame_count = combat_fade_frame_count,
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
					local frame_index = event.frame_index
					local c = 0
					if frame_index < combat_fade_out_frames then
						local u = frame_index / (combat_fade_out_frames - 1)
						c = 1 - smoothstep(u)
					end
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
					return new_timeline_range({
						id = combat_fade_timeline_id,
						frame_count = combat_fade_frame_count,
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
			monster.y = (display_height() * 0.25) - (monster.sy / 2)

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
		timelines = {
			[combat_hit_timeline_id] = {
				create = function()
					return new_timeline_range({
						id = combat_hit_timeline_id,
						frame_count = combat_hit_frame_count,
						ticks_per_frame = combat_hit_ticks_per_frame,
						playback_mode = 'once',
					})
				end,
				autoplay = true,
				stop_on_exit = true,
				play_options = { rewind = true, snap_to_start = true },
			},
		},
		entering_state = function(self)
			clear_texts(text_ids_choice_prompt)
			set_text_lines(text_main_id, { 'RAAK!' }, false)
		end,
		tick = function(self)
			self:update_combat_hover()
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
					local frame_index = event.frame_index
					local monster = object(combat_monster_id)
					local hold_in = 3
					local hold_out = 3
					local flash_end = combat_hit_frame_count - hold_out
					if frame_index < hold_in or frame_index >= flash_end then
						monster.sprite_component.colorize = { r = 1, g = 1, b = 1, a = 1 }
						return
					end
					local flash_index = frame_index - hold_in
					if (flash_index % 2) == 0 then
						monster.sprite_component.colorize = { r = 1, g = 1, b = 1, a = 1 }
					else
						monster.sprite_component.colorize = { r = 1, g = 0.2, b = 0.2, a = 1 }
					end
				end,
			},
			['timeline.end.' .. combat_hit_timeline_id] = {
				go = function(self)
					return finish_combat_hit(self)
				end,
			},
		},
	}

	states.combat_dodge = {
		timelines = {
			[combat_dodge_timeline_id] = {
				create = function()
					return new_timeline_range({
						id = combat_dodge_timeline_id,
						frame_count = combat_dodge_frame_count,
						ticks_per_frame = combat_dodge_ticks_per_frame,
						playback_mode = 'once',
					})
				end,
				autoplay = true,
				stop_on_exit = true,
				play_options = { rewind = true, snap_to_start = true },
			},
		},
		entering_state = function(self)
			clear_texts(text_ids_choice_prompt)
			set_text_lines(text_main_id, { 'ONTWIJKT!' }, false)
			self.combat_dodge_dir = -self.combat_dodge_dir
		end,
		tick = function(self)
			self:update_combat_hover()
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
					local frame_index = event.frame_index
					local hold_in = 4
					local hold_out = 4
					local move_frames = combat_dodge_frame_count - hold_in - hold_out
					local offset = 0
					if frame_index >= hold_in and frame_index < (hold_in + move_frames) then
						local u = (frame_index - hold_in) / (move_frames - 1)
						offset = arc01(u) * combat_monster_dodge_distance * self.combat_dodge_dir
					end
					monster.x = self.combat_monster_base_x + offset
				end,
			},
			['timeline.end.' .. combat_dodge_timeline_id] = {
				go = function(self)
					return finish_combat_dodge(self)
				end,
			},
		},
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
					return new_timeline_range({
						id = combat_all_out_timeline_id,
						frame_count = combat_all_out_frame_count,
						ticks_per_frame = combat_all_out_ticks_per_frame,
						playback_mode = 'once',
					})
				end,
				autoplay = true,
				stop_on_exit = true,
				play_options = { rewind = true, snap_to_start = true },
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
					local frame_index = event.frame_index
					local dx, dy = all_out_shake(frame_index)
					local all_out = object(combat_all_out_id)
					local u = (frame_index / combat_all_out_pulse_period_frames) + 0.25
					local pulse = smoothstep(pingpong01(u))
					local s = 1 + (((pulse * 2) - 1) * combat_all_out_pulse_amp)
					all_out:get_component_by_id('base_sprite').scale = { x = s, y = s }
					local ox = (all_out.sx * (s - 1)) / 2
					local oy = (all_out.sy * (s - 1)) / 2
					all_out.x = self.all_out_origin_x + dx - ox
					all_out.y = self.all_out_origin_y + dy - oy
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
					return new_timeline_range({
						id = combat_results_fade_in_timeline_id,
						frame_count = combat_results_fade_in_frames,
						ticks_per_frame = combat_results_fade_in_ticks_per_frame,
						playback_mode = 'once',
					})
				end,
				autoplay = true,
				stop_on_exit = true,
				play_options = { rewind = true, snap_to_start = true },
			},
		},
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
					local u = event.frame_index / (combat_results_fade_in_frames - 1)
					local a = smoothstep(u)
					local bg = object(bg_id)
					bg.sprite_component.colorize = { r = combat_results_bg_r, g = combat_results_bg_g, b = combat_results_bg_b, a = combat_results_bg_a * a }
					local maya_b = object(combat_maya_b_id)
					maya_b.sprite_component.colorize = { r = 1, g = 1, b = 1, a = a }
					maya_b.x = self.combat_results_maya_start_x + (self.combat_results_maya_target_x - self.combat_results_maya_start_x) * a
					local results = object(text_results_id)
					results.text_color = { r = 1, g = 1, b = 1, a = a }
					results.centered_block_x = self.combat_results_text_start_x + (self.combat_results_text_target_x - self.combat_results_text_start_x) * a
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
					return new_timeline_range({
						id = combat_results_fade_out_timeline_id,
						frame_count = combat_results_fade_out_frames,
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
					local u = event.frame_index / (combat_results_fade_out_frames - 1)
					local a = 1 - smoothstep(u)
					local bg = object(bg_id)
					bg.sprite_component.colorize = { r = combat_results_bg_r, g = combat_results_bg_g, b = combat_results_bg_b, a = combat_results_bg_a * a }
					local maya_b = object(combat_maya_b_id)
					maya_b.sprite_component.colorize = { r = 1, g = 1, b = 1, a = a }
					local results = object(text_results_id)
					results.text_color = { r = 1, g = 1, b = 1, a = a }
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
					return new_timeline_range({
						id = combat_exit_fade_in_timeline_id,
						frame_count = combat_exit_fade_in_frames,
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
					local u = event.frame_index / (combat_exit_fade_in_frames - 1)
					local c = smoothstep(u)
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
			skip_combat_fade_in = false,
			skip_transition_fade = false,
			combat_node_id = '',
			combat_monster_imgid = '',
			combat_rewards = {},
		},
	})
end

return combat
