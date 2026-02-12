local combat = {}
local timeline_builders = require('timeline_builders.lua')
local stagger = require('stagger.lua')

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

local all_out_shake = timeline_builders.build_all_out_shake(combat_all_out_frame_count)
local round = timeline_builders.round
local combat_all_out_prompt_timeline_id = 'combat_all_out_prompt'

local function build_all_out_prompt_portrait_frames(params)
	local frames = {}
	local in_frames = params.in_frames
	local settle_frames = params.settle_frames
	for i = 0, in_frames - 1 do
		local u = i / (in_frames - 1)
		local eased = easing.smoothstep(u)
		local x = params.from_x + ((params.to_x - params.from_x) * eased)
		local y = params.from_y + ((params.to_y - params.from_y) * eased)
		local scale = params.from_scale + ((params.overshoot_scale - params.from_scale) * easing.smoothstep(u))
		frames[#frames + 1] = {
			x = x,
			y = y,
			sprite_component = { scale = { x = scale, y = scale } },
		}
	end
	for i = 0, settle_frames - 1 do
		local u = i / (settle_frames - 1)
		local eased = easing.smoothstep(u)
		local scale = params.overshoot_scale + ((params.to_scale - params.overshoot_scale) * eased)
		local bob = math.sin(u * math.pi) * params.settle_bob
		frames[#frames + 1] = {
			x = params.to_x,
			y = params.to_y + bob,
			sprite_component = { scale = { x = scale, y = scale } },
		}
	end
	return frames
end

local function build_all_out_screen_shake_frames(params)
	local frames = {}
	for frame_index = 0, combat_all_out_frame_count - 1 do
		local dx, dy = all_out_shake(frame_index)
		dx = round(dx)
		dy = round(dy)
		frames[#frames + 1] = {
			bg = {
				x = params.bg_x + dx,
				y = params.bg_y + dy,
			},
			all_out = {
				x = params.all_out_x + dx,
				y = params.all_out_y + dy,
			},
			monster = {
				x = params.monster_x + dx,
				y = params.monster_y + dy,
			},
			maya_a = {
				x = params.maya_a_x + dx,
				y = params.maya_a_y + dy,
			},
			maya_b = {
				x = params.maya_b_x + dx,
				y = params.maya_b_y + dy,
			},
		}
	end
	return frames
end

local combat_fade_frames = timeline_builders.build_combat_fade_frames()
local combat_results_fade_out_frames_table = timeline_builders.build_combat_results_fade_out_frames()
local combat_exit_fade_in_frames_table = timeline_builders.build_combat_exit_fade_in_frames()

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
	self:dispatch_state_event('combat.start')
end

function combat_director:apply_combat_round(node)
	local round = node.rounds[self.combat_round_index]
	local choice_lines = {}
	for i = 1, #round.options do
		choice_lines[i] = round.options[i].label
	end
	stagger.play(self, 'combat', {
		bg = object(bg_id),
		bg_dim = false,
		pose_targets = {
			object(combat_maya_a_id),
		},
		text_main = object(text_main_id),
		text_choice = object(text_choice_id),
		text_prompt = object(text_prompt_id),
		text_lines = round.prompt,
		text_choice_lines = choice_lines,
		text_typed = true,
	})
	self.choice_index = 1
end

local function refresh_combat_parallax(self)
	local rig_vy = combat_parallax_vy_base + combat_parallax_vy_momentum
	local rig_scale = combat_parallax_scale_base + combat_parallax_scale_momentum
	local rig_impact = 0
	if self.combat_parallax_impact_side == 'hero' then
		rig_impact = combat_parallax_impact_amp
	elseif self.combat_parallax_impact_side == 'monster' then
		rig_impact = -combat_parallax_impact_amp
	end
	local momentum = self.combat_parallax_momentum
	local hero_weight = (combat_parallax_vy_base - (combat_parallax_vy_momentum * momentum)) / rig_vy
	local monster_weight = -(combat_parallax_vy_base + (combat_parallax_vy_momentum * momentum)) / rig_vy
	local bias_px = combat_parallax_bias_base - (combat_parallax_bias_momentum * momentum)
	local flip_strength = 0
	if self.combat_parallax_impact_side ~= '' then
		flip_strength = combat_parallax_flip_strength
	end
	local hero = object(combat_maya_a_id)
	local hero_b = object(combat_maya_b_id)
	local monster = object(combat_monster_id)
	hero.sprite_component.parallax_weight = hero_weight
	hero_b.sprite_component.parallax_weight = hero_weight
	monster.sprite_component.parallax_weight = monster_weight
	self:play_timeline(combat_parallax_timeline_id, {
		rewind = true,
		snap_to_start = true,
		params = {
			vy = rig_vy,
			scale = rig_scale,
			impact = rig_impact,
			bias_px = bias_px,
			parallax_strength = combat_parallax_parallax_strength,
			scale_strength = combat_parallax_scale_strength,
			flip_strength = flip_strength,
			flip_window = combat_parallax_flip_window_seconds,
		},
	})
end

function combat_director:reset_combat_parallax()
	self.combat_parallax_enabled = true
	self.combat_parallax_momentum = 0
	self.combat_parallax_impact_side = ''
	refresh_combat_parallax(self)
end

function combat_director:disable_combat_parallax()
	self.combat_parallax_enabled = false
	self:stop_timeline(combat_parallax_timeline_id)
	set_sprite_parallax_rig(0, 1, 0, 0, 0, 1, 1, 0, combat_parallax_flip_window_seconds)
	local hero = object(combat_maya_a_id)
	local hero_b = object(combat_maya_b_id)
	local monster = object(combat_monster_id)
	hero.sprite_component.parallax_weight = 0
	hero_b.sprite_component.parallax_weight = 0
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
	self.combat_parallax_impact_side = side
	if self.combat_parallax_enabled then
		refresh_combat_parallax(self)
	end
end

function combat_director:is_typing()
	return object(text_main_id).is_typing
end

function combat_director:skip_typing()
	if self:is_typing() then
		finish_text(text_main_id)
		consume_action('b')
		return true
	end
	return false
end

function combat_director:resolve_combat_rewards(node)
	return node.rewards[self.combat_points + 1]
end

function combat.setup_timelines(self)
	self:define_timeline(new_timeline({
		id = combat_hover_timeline_id,
		playback_mode = 'loop',
		tracks = {
			{
				kind = 'wave',
				path = { 'y' },
				base = 'base_y',
				amp = combat_monster_hover_amp,
				period = combat_monster_hover_period_seconds,
				phase = 0.25,
				wave = 'pingpong',
				ease = easing.smoothstep,
			},
		},
	}))
	self:define_timeline(new_timeline({
		id = combat_parallax_timeline_id,
		playback_mode = 'once',
		duration_seconds = combat_parallax_impact_duration_seconds,
		tracks = {
			{
				kind = 'sprite_parallax_rig',
			},
		},
	}))
	self:define_timeline(new_timeline({
		id = combat_focus_timeline_id,
		frames = timeline_builders.build_combat_focus_frames,
		ticks_per_frame = combat_focus_ticks_per_frame,
		playback_mode = 'once',
		apply = true,
		markers = {
			{ frame = 0, event = 'combat_focus.snap' },
			{ u = 1, event = 'combat_focus.done' },
		},
	}))
	self:define_timeline(new_timeline({
		id = combat_intro_timeline_id,
		frames = timeline_builders.build_combat_intro_frames,
		ticks_per_frame = combat_intro_ticks_per_frame,
		playback_mode = 'once',
		apply = true,
	}))
	self:define_timeline(new_timeline({
		id = combat_hit_timeline_id,
		frames = timeline_builders.build_combat_hit_frames,
		ticks_per_frame = combat_hit_ticks_per_frame,
		playback_mode = 'once',
		apply = true,
	}))
	self:define_timeline(new_timeline({
		id = combat_exchange_hit_timeline_id,
		frames = timeline_builders.build_combat_exchange_frames,
		ticks_per_frame = combat_exchange_hit_ticks_per_frame,
		playback_mode = 'once',
		apply = true,
	}))
	self:define_timeline(new_timeline({
		id = combat_exchange_miss_timeline_id,
		frames = timeline_builders.build_combat_exchange_frames,
		ticks_per_frame = combat_exchange_miss_ticks_per_frame,
		playback_mode = 'once',
		apply = true,
	}))
	self:define_timeline(new_timeline({
		id = combat_all_out_prompt_timeline_id,
		frames = build_all_out_prompt_portrait_frames,
		ticks_per_frame = 16,
		playback_mode = 'once',
		apply = true,
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
		on = {
			['combat.start'] = {
				go = function(self)
					if self.skip_combat_fade_in then
						return '/combat_init'
					end
					return '/combat_fade_in'
				end,
			},
		},
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
		monster.sprite_component.scale = { x = 1, y = 1 }
		return '/combat_exchange_miss'
	end

	local function finish_combat_dodge(self)
		local monster = object(combat_monster_id)
		monster.x = self.combat_monster_base_x
		monster.y = self.combat_monster_base_y
		monster.sprite_component.scale = { x = 1, y = 1 }
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
		local bg_sprite = bg.sprite_component
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
						target = object(bg_id),
						apply = true,
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
						target = object(bg_id),
						apply = true,
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

			local monster = object(combat_monster_id)
			monster:set_image(node.monster_imgid)
			monster.visible = false
			monster.sprite_component.colorize = { r = 1, g = 1, b = 1, a = 1 }
			monster.z = 200
			monster.sprite_component.scale = { x = 1, y = 1 }

			monster.x = (display_width() * 0.65) - (monster.sx / 2)
			monster.y = (display_height() * 0.25) - (monster.sy / 3)

				self.combat_monster_base_x = monster.x
				self.combat_monster_base_y = monster.y
				self.combat_monster_start_x = (display_width() * 0.2) - (monster.sx / 2)
				self.combat_monster_start_y = self.combat_monster_base_y + combat_intro_monster_start_y_offset
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
			local targets = {
				monster = monster,
				maya_a = maya_a,
				maya_b = maya_b,
			}
			self:play_timeline(combat_intro_timeline_id, {
				rewind = true,
				snap_to_start = true,
				target = targets,
				params = {
					monster_sx = monster.sx,
					monster_sy = monster.sy,
					maya_a_sy = maya_a.sy,
					maya_b_sx = maya_b.sx,
					maya_b_sy = maya_b.sy,
					monster_start_scale = self.combat_monster_start_scale,
					monster_start_x = self.combat_monster_start_x,
					monster_start_y = self.combat_monster_start_y,
					monster_base_x = self.combat_monster_base_x,
					monster_base_y = self.combat_monster_base_y,
					maya_a_start_scale = self.combat_maya_a_start_scale,
					maya_a_start_x = self.combat_maya_a_start_x,
					maya_a_base_x = self.combat_maya_a_base_x,
					maya_a_base_y = self.combat_maya_a_base_y,
					maya_b_start_scale = self.combat_maya_b_start_scale,
					maya_b_end_scale = self.combat_maya_b_end_scale,
					maya_b_start_right_x = self.combat_maya_b_start_right_x,
					maya_b_exit_right_x = self.combat_maya_b_exit_right_x,
					maya_b_base_x = self.combat_maya_b_start_x,
					maya_b_base_y = self.combat_maya_b_base_y,
				},
			})
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
			['timeline.end.' .. combat_intro_timeline_id] = {
				go = function(self)
					return finish_combat_intro(self)
				end,
			},
		},
		leaving_state = function(self)
			self:stop_timeline(combat_intro_timeline_id)
			local monster = object(combat_monster_id)
			monster.sprite_component.scale = { x = 1, y = 1 }
			monster.x = self.combat_monster_base_x
			monster.y = self.combat_monster_base_y
			monster.visible = true

			local maya_a = object(combat_maya_a_id)
			maya_a.sprite_component.scale = { x = 1, y = 1 }
			maya_a.x = self.combat_maya_a_base_x
			maya_a.y = self.combat_maya_a_base_y
			maya_a.visible = true

			local maya_b = object(combat_maya_b_id)
			maya_b.sprite_component.scale = { x = 1, y = 1 }
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
			self:play_timeline(combat_hover_timeline_id, {
				rewind = true,
				snap_to_start = true,
				target = monster,
				params = { base_y = self.combat_monster_base_y },
			})
		end,
		tick = function(self)
			if self.stagger_blocked then
				return
			end
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
					if self.stagger_blocked then return end
					self.choice_index = math.max(1, self.choice_index - 1)
				end,
			},
			['down[jp]'] = {
				go = function(self)
					if self.stagger_blocked then return end
					local node = story[self.node_id]
					local round = node.rounds[self.combat_round_index]
					self.choice_index = math.min(#round.options, self.choice_index + 1)
				end,
			},
			['b[jp]'] = {
				go = function(self)
					if self.stagger_blocked then return end
					self:skip_typing()
				end
			},
			['a[jp]'] = {
				go = function(self)
					if self.stagger_blocked then return end
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
		leaving_state = function(self)
			self:stop_timeline(combat_hover_timeline_id)
		end,
	}

	states.combat_hit = {
		entering_state = function(self)
			clear_texts(text_ids_choice_prompt)
			set_text_lines(text_main_id, { 'RAAK!' }, false)
			self:push_combat_momentum('hero', combat_parallax_momentum_step)
			local monster = object(combat_monster_id)
			monster.x = self.combat_monster_base_x
			monster.y = self.combat_monster_base_y
			monster.sprite_component.scale = { x = 1, y = 1 }
			local targets = {
				monster = monster,
				slash_frame = self.combat_hit_slash_frame,
			}
			self:play_timeline(combat_hit_timeline_id, {
				rewind = true,
				snap_to_start = true,
				target = targets,
				params = {
					base_x = monster.x,
					base_y = monster.y,
					monster_sx = monster.sx,
					monster_sy = monster.sy,
				},
			})
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
						frames = timeline_builders.build_combat_dodge_frames,
						ticks_per_frame = combat_dodge_ticks_per_frame,
						playback_mode = 'once',
						apply = true,
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
				monster.sprite_component.scale = { x = 1, y = 1 }
				self.combat_dodge_dir = -self.combat_dodge_dir
				self:play_timeline(combat_dodge_timeline_id, {
					rewind = true,
					snap_to_start = true,
					target = monster,
					params = {
						dir = self.combat_dodge_dir,
						base_x = self.combat_monster_base_x,
				},
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
				monster.sprite_component.scale = { x = 1, y = 1 }
				maya_a.sprite_component.scale = { x = 1, y = 1 }
				monster.sprite_component.colorize = { r = 1, g = 1, b = 1, a = 1 }
				maya_a.sprite_component.colorize = { r = 1, g = 1, b = 1, a = 1 }
				overlay.visible = true
				overlay:set_image('whitepixel')
				overlay.x = 0
				overlay.y = 0
					overlay.sprite_component.scale = { x = display_width(), y = display_height() }
					overlay.sprite_component.colorize = { r = 0, g = 0, b = 0, a = 0 }
			local targets = {
				monster = monster,
				maya_a = maya_a,
				overlay = overlay,
			}
			self:play_timeline(combat_exchange_hit_timeline_id, {
				rewind = true,
				snap_to_start = true,
				target = targets,
				params = {
					frame_count = combat_exchange_hit_frame_count,
					monster_base_x = self.combat_monster_base_x,
					monster_base_y = self.combat_monster_base_y,
					maya_base_x = self.combat_maya_a_base_x,
					maya_base_y = self.combat_maya_a_base_y,
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
				},
			})
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
			['timeline.end.' .. combat_exchange_hit_timeline_id] = {
				go = function(self)
					return finish_combat_exchange(self)
				end,
			},
		},
		leaving_state = function(self)
			self:stop_timeline(combat_exchange_hit_timeline_id)
			local monster = object(combat_monster_id)
			local maya_a = object(combat_maya_a_id)
			local overlay = object(transition_overlay_id)
					monster.x = self.combat_monster_base_x
				monster.y = self.combat_monster_base_y
				maya_a.x = self.combat_maya_a_base_x
				maya_a.y = self.combat_maya_a_base_y
				monster.sprite_component.scale = { x = 1, y = 1 }
				maya_a.sprite_component.scale = { x = 1, y = 1 }
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
				monster.sprite_component.scale = { x = 1, y = 1 }
				maya_a.sprite_component.scale = { x = 1, y = 1 }
				monster.sprite_component.colorize = { r = 1, g = 1, b = 1, a = 1 }
				maya_a.sprite_component.colorize = { r = 1, g = 1, b = 1, a = 1 }
				overlay.visible = true
				overlay:set_image('whitepixel')
				overlay.x = 0
				overlay.y = 0
					overlay.sprite_component.scale = { x = display_width(), y = display_height() }
					overlay.sprite_component.colorize = { r = 0, g = 0, b = 0, a = 0 }
			local targets = {
				monster = monster,
				maya_a = maya_a,
				overlay = overlay,
			}
			self:play_timeline(combat_exchange_miss_timeline_id, {
				rewind = true,
				snap_to_start = true,
				target = targets,
				params = {
					frame_count = combat_exchange_miss_frame_count,
					monster_base_x = self.combat_monster_base_x,
					monster_base_y = self.combat_monster_base_y,
					maya_base_x = self.combat_maya_a_base_x,
					maya_base_y = self.combat_maya_a_base_y,
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
				},
			})
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
			['timeline.end.' .. combat_exchange_miss_timeline_id] = {
				go = function(self)
					return finish_combat_exchange(self)
				end,
			},
		},
		leaving_state = function(self)
			self:stop_timeline(combat_exchange_miss_timeline_id)
			local monster = object(combat_monster_id)
			local maya_a = object(combat_maya_a_id)
			local overlay = object(transition_overlay_id)
					monster.x = self.combat_monster_base_x
				monster.y = self.combat_monster_base_y
				maya_a.x = self.combat_maya_a_base_x
				maya_a.y = self.combat_maya_a_base_y
				monster.sprite_component.scale = { x = 1, y = 1 }
				maya_a.sprite_component.scale = { x = 1, y = 1 }
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
			object(text_choice_id).highlight_jitter_enabled = true
			local portrait = object(combat_all_out_id)
			portrait:set_image('maya_v_s')
			portrait.visible = true
			portrait.z = 750
			portrait.sprite_component.scale = { x = 1, y = 1 }
			local target_x = math.floor(display_width() * 0.08)
			local target_y = math.floor(display_height() - portrait.sy)
			self:play_timeline(combat_all_out_prompt_timeline_id, {
				rewind = true,
				snap_to_start = true,
				target = portrait,
				params = {
					from_x = -portrait.sx * 0.6,
					from_y = target_y + 20,
					to_x = target_x,
					to_y = target_y,
					from_scale = 0.9,
					overshoot_scale = 1.08,
					to_scale = 1,
					in_frames = 10,
					settle_frames = 6,
					settle_bob = 6,
				},
			})
			self:play_timeline(combat_hover_timeline_id, {
				rewind = true,
				snap_to_start = true,
				target = object(combat_monster_id),
				params = { base_y = self.combat_monster_base_y },
			})
		end,
		tick = function(self)
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
		leaving_state = function(self)
			self:stop_timeline(combat_hover_timeline_id)
			self:stop_timeline(combat_all_out_prompt_timeline_id)
			local portrait = object(combat_all_out_id)
			portrait.visible = false
			portrait.sprite_component.scale = { x = 1, y = 1 }
			object(text_choice_id).highlight_jitter_enabled = false
		end,
	}

	states.combat_all_out = {
		timelines = {
			[combat_all_out_timeline_id] = {
				create = function()
					return new_timeline({
						id = combat_all_out_timeline_id,
						frames = build_all_out_screen_shake_frames,
						ticks_per_frame = combat_all_out_ticks_per_frame,
						playback_mode = 'once',
						apply = true,
					})
				end,
				autoplay = false,
				stop_on_exit = true,
			},
		},
		entering_state = function(self)
			self:disable_combat_parallax() -- Disable parallax during "All Out" sequence.
			clear_texts(text_ids_all)
			local all_out = object(combat_all_out_id)
			all_out:set_image('all_out')
			all_out.sprite_component.scale = { x = 1, y = 1 }
			all_out.visible = true
			all_out.x = 0
			all_out.y = 0
			all_out.z = 800
			local monster = object(combat_monster_id)
			local maya_a = object(combat_maya_a_id)
			local maya_b = object(combat_maya_b_id)
			local bg = object(bg_id)
			self.all_out_shake_all_out_x = all_out.x
			self.all_out_shake_all_out_y = all_out.y
			self.all_out_shake_monster_x = monster.x
			self.all_out_shake_monster_y = monster.y
			self.all_out_shake_maya_a_x = maya_a.x
			self.all_out_shake_maya_a_y = maya_a.y
			self.all_out_shake_maya_b_x = maya_b.x
			self.all_out_shake_maya_b_y = maya_b.y
			self.all_out_shake_bg_x = bg.x
			self.all_out_shake_bg_y = bg.y
			self:play_timeline(combat_all_out_timeline_id, {
				rewind = true,
				snap_to_start = true,
				target = {
					bg = bg,
					all_out = all_out,
					monster = monster,
					maya_a = maya_a,
					maya_b = maya_b,
				},
				params = {
					bg_x = self.all_out_shake_bg_x,
					bg_y = self.all_out_shake_bg_y,
					all_out_x = self.all_out_shake_all_out_x,
					all_out_y = self.all_out_shake_all_out_y,
					monster_x = self.all_out_shake_monster_x,
					monster_y = self.all_out_shake_monster_y,
					maya_a_x = self.all_out_shake_maya_a_x,
					maya_a_y = self.all_out_shake_maya_a_y,
					maya_b_x = self.all_out_shake_maya_b_x,
					maya_b_y = self.all_out_shake_maya_b_y,
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
			['timeline.end.' .. combat_all_out_timeline_id] = {
				go = function(self)
					return finish_combat_all_out(self)
				end,
			},
		},
		leaving_state = function(self)
			local all_out = object(combat_all_out_id)
			local monster = object(combat_monster_id)
			local maya_a = object(combat_maya_a_id)
			local maya_b = object(combat_maya_b_id)
			local bg = object(bg_id)
			all_out.x = self.all_out_shake_all_out_x
			all_out.y = self.all_out_shake_all_out_y
			all_out.visible = false
			monster.x = self.all_out_shake_monster_x
			monster.y = self.all_out_shake_monster_y
			maya_a.x = self.all_out_shake_maya_a_x
			maya_a.y = self.all_out_shake_maya_a_y
			maya_b.x = self.all_out_shake_maya_b_x
			maya_b.y = self.all_out_shake_maya_b_y
			bg.x = self.all_out_shake_bg_x
			bg.y = self.all_out_shake_bg_y
		end,
	}

	states.combat_focus = {
			entering_state = function(self)
				local monster = object(combat_monster_id)

				self:play_timeline(combat_focus_timeline_id, {
					rewind = true,
					snap_to_start = true,
					target = monster,
					params = {
						base_x = self.combat_monster_base_x,
						base_y = self.combat_monster_base_y,
						monster_sx = monster.sx,
						monster_sy = monster.sy,
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
			self:disable_combat_parallax() -- Not required, as the "All Out" state already does this, but just to be safe.
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
			local bg_sprite = bg.sprite_component
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
				frames = timeline_builders.build_combat_results_fade_in_frames,
				ticks_per_frame = combat_results_fade_in_ticks_per_frame,
				playback_mode = 'once',
				apply = true,
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
				target = {
					bg = object(bg_id),
					maya_b = object(combat_maya_b_id),
					results = object(text_results_id),
				},
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
						target = {
							bg = object(bg_id),
							maya_b = object(combat_maya_b_id),
							results = object(text_results_id),
						},
						apply = true,
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
						target = object(bg_id),
						apply = true,
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
	define_prefab({
		def_id = combat_director_def_id,
		class = combat_director,
		fsms = { combat_director_fsm_id },
		defaults = {
			node_id = '',
			choice_index = 1,
			combat_round_index = 1,
			combat_points = 0,
			combat_max_points = 0,
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
			all_out_shake_all_out_x = 0,
			all_out_shake_all_out_y = 0,
			all_out_shake_monster_x = 0,
			all_out_shake_monster_y = 0,
			all_out_shake_maya_a_x = 0,
			all_out_shake_maya_a_y = 0,
			all_out_shake_maya_b_x = 0,
			all_out_shake_maya_b_y = 0,
			all_out_shake_bg_x = 0,
			all_out_shake_bg_y = 0,
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
