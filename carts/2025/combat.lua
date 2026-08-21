local combat<const> = {}
local director_definition_id<const> = 'p3.combat.director'
local combat_director_fsm_id<const> = 'p3.combat.director.fsm'
combat.director_definition_id = director_definition_id
require('globals')
local fsm_component<const> = require('cartlib/fsm/fsm_component')
local fsm_library<const> = require('cartlib/fsm/library')
local gp0<const> = require('cartlib/gx/gp0')
local primitives<const> = require('cartlib/gx/primitives')
local prefab<const> = require('cartlib/world/prefab')
local story<const> = require('story')
local texture_residency<const> = require('texture_residency')
local timeline<const> = require('cartlib/timeline/timeline')
local timelinebuilders<const> = require('timelinebuilders')
local stagger<const> = require('stagger')
local round_number<const> = math.round
local input<const> = require('cartlib/input/input')
local gameplay_clock<const> = require('cartlib/clock').gameplay
local custom_visual_component<const> = require('cartlib/component/custom_visual_component')
local timeline_component<const> = require('cartlib/timeline/timeline_component')
local smoothstep<const> = require('cartlib/easing').smoothstep
local pingpong01<const> = require('cartlib/easing').pingpong01
local sin<const> = math.sin
local pi<const> = math.pi
local immediate_text_opts<const> = { typed = false, snap = true }
local prompt_select<const> = { '(A) select' }
local prompt_attack<const> = { '(A) ATTACK' }

local stat_label<const> = function(stat_id)
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

combat.all_out_shake = timelinebuilders.build_all_out_shake(combat_all_out_frame_count)
local combat_all_out_prompt_timeline_id<const> = 'combat_all_out_prompt'

local build_all_out_prompt_portrait_frames<const> = function(params)
	local frames<const> = {}
	local in_frames<const> = params.in_frames
	local settle_frames<const> = params.settle_frames
	for i = 0, in_frames - 1 do
		local u<const> = i / (in_frames - 1)
		local eased<const> = smoothstep(u)
		local x<const> = params.from_x + ((params.to_x - params.from_x) * eased)
		local y<const> = params.from_y + ((params.to_y - params.from_y) * eased)
		local scale<const> = params.from_scale + ((params.overshoot_scale - params.from_scale) * smoothstep(u))
		frames[#frames + 1] = {
			x = x,
			y = y,
			sprite_component = { scale_x = scale, scale_y = scale },
		}
	end
	for i = 0, settle_frames - 1 do
		local u<const> = i / (settle_frames - 1)
		local eased<const> = smoothstep(u)
		local scale<const> = params.overshoot_scale + ((params.to_scale - params.overshoot_scale) * eased)
		local bob<const> = sin(u * pi) * params.settle_bob
		frames[#frames + 1] = {
			x = params.to_x,
			y = params.to_y + bob,
			sprite_component = { scale_x = scale, scale_y = scale },
		}
	end
	return frames
end

local build_all_out_screen_shake_frames<const> = function(params)
	local frames<const> = {}
	for frame_index = 0, combat_all_out_frame_count - 1 do
		local dx, dy = combat.all_out_shake(frame_index)
		dx = round_number(dx)
		dy = round_number(dy)
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

local combat_director<const> = {}
combat_director.__index = combat_director

local draw_combat_slash<const> = function(component, draw)
	local director<const> = component.parent
	local frame<const> = director.combat_hit_slash_frame
	if not frame.slash_active then
		return
	end
	local points<const> = frame.slash_points
	draw:mode(gp0.draw_mode_blend_half)
	local x0<const>, y0<const>, x1<const>, y1<const>, x2<const>, y2<const>, x3<const>, y3<const> =
		primitives.thick_line(points[1], points[2], points[3], points[4], frame.slash_thickness)
	draw:semitransparent_quad(x0, y0, x1, y1, x2, y2, x3, y3, frame.slash_color)
end

function combat_director:ctor()
	self:add_component(custom_visual_component.new({
		parent = self,
		id_local = 'slash',
		offset_z = combat_hit_slash_z,
		draw = draw_combat_slash,
	}))
end

local combat_parallax_scale<const> = function(weight)
	if weight < 0 then
		return 1 - (combat_parallax_scale_delta * weight)
	end
	return 1 + (combat_parallax_scale_delta * weight)
end

local apply_combat_parallax_sprite<const> = function(obj, weight, offset_base_y)
	local sc<const> = obj.sprite_component
	local parallax_scale<const> = combat_parallax_scale(weight)
	sc.draw_offset_y = offset_base_y * weight
	sc.draw_scale_x = parallax_scale
	sc.draw_scale_y = parallax_scale
end

local apply_combat_parallax<const> = function(self)
	local momentum<const> = self.combat_parallax_momentum_steps
	local offset_base_y<const> = self.combat_parallax_offset_base_y
	apply_combat_parallax_sprite(self.monster, -(10 + momentum) / 15, offset_base_y)
	apply_combat_parallax_sprite(self.maya_a, (10 - momentum) / 15, offset_base_y)
end

local refresh_combat_parallax<const> = function(self)
	local momentum<const> = self.combat_parallax_momentum_steps
	self.combat_parallax_offset_base_y = (11 - momentum) / 10
	if self.combat_parallax_transform_active then
		apply_combat_parallax(self)
	end
end

local combat_hover_track<const> = function(target, params, _event, time_seconds)
	local w<const> = pingpong01((time_seconds / combat_monster_hover_period_seconds) + 0.25)
	local hover<const> = (smoothstep(w) - 0.5) * 2 * combat_monster_hover_amp
	local momentum<const> = target.combat_parallax_momentum_steps
	params.monster.y = params.monster_base_y + hover
	target.combat_parallax_offset_base_y = ((11 - momentum) / 10) - hover
	if target.combat_parallax_transform_active then
		apply_combat_parallax(target)
	end
end

function combat_director:start_combat(node_id, skip_fade_in)
	self.node_id = node_id
	self.combat_node_id = node_id
	local node<const> = story[node_id]
	self.combat_monster_imgid = node.monster_imgid
	self.combat_rewards = {}
	self.skip_transition_fade = false
	self.skip_combat_fade_in = skip_fade_in
	self.events:emit('combat.start')
end

function combat_director:apply_combat_round(node)
	local round<const> = node.rounds[self.combat_round_index]
	local choice_lines<const> = {}
	for i = 1, #round.options do
		choice_lines[i] = round.options[i].label
	end
	stagger.play(self, 'combat', {
		bg = self.background,
		bg_dim = false,
		pose_targets = {
			self.maya_a,
		},
		text_main = self.text_main,
		text_choice = self.text_choice,
		text_prompt = self.text_prompt,
		text_lines = round.prompt,
		text_choice_lines = choice_lines,
		text_typed = true,
	})
	self.choice_index = 1
	self.text_prompt:clear_text()
end

function combat_director:reset_combat_parallax()
	self.combat_parallax_enabled = true
	self.combat_parallax_momentum_steps = 0
	refresh_combat_parallax(self)
end

function combat_director:disable_combat_parallax()
	self.combat_parallax_enabled = false
	self:clear_combat_parallax_transform()
end

function combat_director:activate_combat_parallax_transform()
	self.combat_parallax_transform_active = true
	apply_combat_parallax(self)
end

function combat_director:clear_combat_parallax_transform()
	self.combat_parallax_transform_active = false
	local monster<const> = self.monster
	local maya_a<const> = self.maya_a
	monster.sprite_component.draw_offset_y = 0
	monster.sprite_component.draw_scale_x = 1
	monster.sprite_component.draw_scale_y = 1
	maya_a.sprite_component.draw_offset_y = 0
	maya_a.sprite_component.draw_scale_x = 1
	maya_a.sprite_component.draw_scale_y = 1
end

function combat_director:push_combat_momentum(side, power)
	local delta<const> = side == 'hero' and power or -power
	local next = self.combat_parallax_momentum_steps + delta
	if next < -combat_parallax_momentum_limit_steps then
		next = -combat_parallax_momentum_limit_steps
	end
	if next > combat_parallax_momentum_limit_steps then
		next = combat_parallax_momentum_limit_steps
	end
	self.combat_parallax_momentum_steps = next
	if self.combat_parallax_enabled then
		refresh_combat_parallax(self)
	end
end

function combat_director:skip_typing()
	if self.text_main:is_typing() then
		self.text_main:reveal_text()
		input.consume(1, gameplay_clock, 'b')
		return true
	end
	return false
end

function combat.define_fsm()
	local states<const> = {}

	states.boot = {
		entering_state = function(self)
			self.combat_hit_slash_frame = {
				slash_active = false,
				slash_points = { 0, 0, 0, 0 },
				slash_thickness = 0,
				slash_color = p3_white_color,
			}
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
		entering_state = function(self)
			hide_combat_visuals(self.combat_visuals)
		end,
	}

	states.combat_done = {
		entering_state = function(self)
			self:disable_combat_parallax()
			self.events:emit('combat.end', {
				combat_node_id = self.combat_node_id,
				next_node_id = self.node_id,
				monster_imgid = self.combat_monster_imgid,
				rewards = self.combat_rewards,
				skip_transition_fade = self.skip_transition_fade,
			})
			return '/idle'
		end,
	}

	local finish_combat_exchange<const> = function(self)
		local node<const> = story[self.node_id]
		if self.combat_round_index > #node.rounds then
			return '/combat_all_out_prompt'
		end
		return '/combat_round'
	end

	local finish_combat_hit<const> = function(self)
		local monster<const> = self.monster
		monster.sprite_component.color = p3_white_color
		monster.x = self.combat_monster_base_x
		monster.y = self.combat_monster_base_y
		monster.sprite_component.scale_x = 1
		monster.sprite_component.scale_y = 1
		return '/combat_exchange_miss'
	end

	local finish_combat_dodge<const> = function(self)
		local monster<const> = self.monster
		monster.x = self.combat_monster_base_x
		monster.y = self.combat_monster_base_y
		monster.sprite_component.scale_x = 1
		monster.sprite_component.scale_y = 1
		return '/combat_exchange_hit'
	end

	local finish_combat_results_fade_in<const> = function(self)
		local bg<const> = self.combat_results_visual
		bg.visible = true
		bg.color = combat_results_bg_visible_color
		local maya_b<const> = self.maya_b
		maya_b.sprite_component.color = p3_white_color
		maya_b.x = self.combat_results_maya_target_x
		local results<const> = self.text_results
		results.text_component.color = p3_white_color
		results.text_component.offset_x = self.combat_results_text_target_x
		return '/combat_results'
	end

	local finish_combat_results_fade_out<const> = function(self)
		local maya_b<const> = self.maya_b
		maya_b.visible = false
		maya_b:set_z(combat_maya_z)
		self.text_results:clear_text()
		local bg<const> = self.combat_results_visual
		bg.visible = false
		bg.color = p3_black_color
		hide_combat_visuals(self.combat_visuals)
		local next_kind<const> = story[self.node_id].kind
		if next_kind == 'transition' then
			texture_residency.replace_background(story[story[self.node_id].next].bg)
			self.skip_transition_fade = true
			return '/combat_done'
		end
		if next_kind == 'fade' then
			self.combat_exit_target_bg = story[story[self.node_id].next].bg
		else
			self.combat_exit_target_bg = story[self.node_id].bg
		end
		texture_residency.replace_background(self.combat_exit_target_bg)
		return '/combat_exit_fade_in'
	end

	local finish_combat_exit_fade_in<const> = function(self)
		local bg<const> = self.background
		bg.surface_component.color = p3_white_color
		return '/combat_done'
	end

	states.combat_fade_in = {
		timelines = {
			[combat_fade_timeline_id] = {
				autoplay = false,
				stop_on_exit = true,
				on_finished = '/combat_init'
			},
		},
		entering_state = function(self)
			clear_texts(self.texts)
			hide_combat_visuals(self.combat_visuals)
			local transition_visual<const> = self.transition_visual
			hide_transition_layers(transition_visual)
			local overlay<const> = transition_visual.overlay
			overlay.visible = true
			overlay.x = 0
			overlay.y = 0
			overlay.width = screen_width
			overlay.height = screen_height
			overlay.color = 0
			overlay.blend_mode = gp0.draw_mode_blend_subtract
			overlay.blend_color = 0
			self.timelines:play(combat_fade_timeline_id, { rewind = true, snap_to_start = true, target = { overlay = overlay } })
		end,
		input_eval = 'first',
		input_event_handlers = {
			{ pattern = 'b[jp]', go = '/combat_init' },
		},
		exiting_state = function(self)
			local overlay<const> = self.transition_visual.overlay
			overlay.visible = false
			overlay.color = 0
			overlay.blend_color = 0
		end,
	}

	states.combat_fade_out = {
		timelines = {
			[combat_fade_timeline_id] = {
				autoplay = false,
				stop_on_exit = true,
				on_finished = '/combat_done'
			},
		},
		entering_state = function(self)
			clear_texts(self.story_texts)
			local transition_visual<const> = self.transition_visual
			hide_transition_layers(transition_visual)
			local overlay<const> = transition_visual.overlay
			overlay.visible = true
			overlay.x = 0
			overlay.y = 0
			overlay.width = screen_width
			overlay.height = screen_height
			overlay.color = 0
			overlay.blend_mode = gp0.draw_mode_blend_subtract
			overlay.blend_color = 0
			self.timelines:play(combat_fade_timeline_id, { rewind = true, snap_to_start = true, target = { overlay = overlay } })
		end,
		input_eval = 'first',
		input_event_handlers = {
			{ pattern = 'b[jp]', go = '/combat_done' },
		},
	}

	states.combat_init = {
		entering_state = function(self)
			local node<const> = story[self.node_id]
			clear_texts(self.transition_result_texts)
			reset_text_colors(self)
			hide_transition_layers(self.transition_visual)

			local bg<const> = self.background
			bg.visible = false

			self.combat_round_index = 1
			self.combat_points = 0
			self.combat_max_points = #node.rounds

			local monster<const> = self.monster
			texture_residency.load_combat_workset(node.monster_imgid)
			monster:set_imgid(node.monster_imgid)
			monster.visible = false
			monster.sprite_component.color = p3_white_color
			monster:set_z(200)
			monster.sprite_component.scale_x = 1
			monster.sprite_component.scale_y = 1

			monster.x = (screen_width * 0.65) - (monster.sx / 2)
			monster.y = (screen_height * 0.25) - (monster.sy / 3)

			self.combat_monster_base_x = monster.x
			self.combat_monster_base_y = monster.y
			self.combat_monster_start_x = (screen_width * 0.2) - (monster.sx / 2)
			self.combat_monster_start_y = self.combat_monster_base_y + combat_intro_monster_start_y_offset
			self.combat_monster_start_scale = math.max(1, screen_width / monster.sx, screen_height / monster.sy)

			local maya_a<const> = self.maya_a
			maya_a:set_imgid('maya_a')
			maya_a.visible = false
			maya_a.x = 0
			maya_a.y = screen_height - maya_a.sy
			maya_a:set_z(combat_maya_z)
			self.combat_maya_a_base_x = maya_a.x
			self.combat_maya_a_base_y = maya_a.y
			self.combat_maya_a_start_x = screen_width
			self.combat_maya_a_start_scale = combat_intro_maya_a_scale_ratio

			local all_out<const> = self.all_out
			all_out.visible = false
			all_out.x = 0
			all_out.y = 0
			all_out:set_z(800)

			local maya_b<const> = self.maya_b
			maya_b:set_imgid('maya_b')
			maya_b.visible = true
			maya_b.sprite_component.color = p3_white_color
			maya_b.x = screen_width - maya_b.sx
			maya_b.y = screen_height - maya_b.sy
			maya_b:set_z(combat_maya_z)
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
		timelines = {
				[combat_intro_timeline_id] = {
					autoplay = false,
					stop_on_exit = true,
					on_finished = '/combat_round',
				},
			},
		entering_state = function(self)
			local monster<const> = self.monster
			local maya_a<const> = self.maya_a
			local maya_b<const> = self.maya_b
			local targets<const> = {
				monster = monster,
				maya_a = maya_a,
				maya_b = maya_b,
			}
			self.timelines:play(combat_intro_timeline_id, {
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
			self:activate_combat_parallax_transform()
		end,
		input_eval = 'first',
		input_event_handlers = {
			{ pattern = 'b[jp]', go = '/combat_round' },
		},
		exiting_state = function(self)
			local monster<const> = self.monster
			monster.sprite_component.scale_x = 1
			monster.sprite_component.scale_y = 1
			monster.x = self.combat_monster_base_x
			monster.y = self.combat_monster_base_y
			monster.visible = true

			local maya_a<const> = self.maya_a
			maya_a.sprite_component.scale_x = 1
			maya_a.sprite_component.scale_y = 1
			maya_a.x = self.combat_maya_a_base_x
			maya_a.y = self.combat_maya_a_base_y
			maya_a.visible = true

			local maya_b<const> = self.maya_b
			maya_b.sprite_component.scale_x = 1
			maya_b.sprite_component.scale_y = 1
			maya_b.visible = false
			maya_b.x = self.combat_maya_b_start_x
			maya_b.y = self.combat_maya_b_base_y
		end,
	}

	states.combat_round = {
		entering_state = function(self)
			local node<const> = story[self.node_id]
			clear_texts(self.transition_result_texts)
			local bg<const> = self.background
			bg.visible = false
			local monster<const> = self.monster
			monster:set_imgid(node.monster_imgid)
			monster.visible = true
			local maya_a<const> = self.maya_a
			maya_a:set_imgid('maya_a')
			maya_a.visible = true
			self.all_out.visible = false
			local maya_b<const> = self.maya_b
			maya_b.visible = false
			self:apply_combat_round(node)
			self.timelines:play(combat_hover_timeline_id, {
				rewind = true,
				snap_to_start = true,
				target = self,
				params = {
					monster = monster,
					monster_base_y = self.combat_monster_base_y,
				},
			})
			self:activate_combat_parallax_transform()
		end,
		update = function(self)
			if self.stagger_blocked then
				return
			end
			local main<const> = self.text_main
			if main:is_typing() then
				main:type_next()
				if not main:is_typing() then
					self.text_prompt:set_text(prompt_select, immediate_text_opts)
					self.text_choice:set_highlighted_line(self.choice_index - 1)
				end
				return
			end
		end,
		input_eval = 'first',
		input_event_handlers = {
			{
				pattern = 'up[jp]',
				go = function(self)
					if self.stagger_blocked then return end
					self.choice_index = math.max(1, self.choice_index - 1)
					if not self.text_main:is_typing() then
						self.text_choice:set_highlighted_line(self.choice_index - 1)
					end
				end,
			},
			{
				pattern = 'down[jp]',
				go = function(self)
					if self.stagger_blocked then return end
					local node<const> = story[self.node_id]
					local round<const> = node.rounds[self.combat_round_index]
					self.choice_index = math.min(#round.options, self.choice_index + 1)
					if not self.text_main:is_typing() then
						self.text_choice:set_highlighted_line(self.choice_index - 1)
					end
				end,
			},
			{
				pattern = 'b[jp]',
				go = function(self)
					if self.stagger_blocked then return end
					if self:skip_typing() then
						self.text_prompt:set_text(prompt_select, immediate_text_opts)
						self.text_choice:set_highlighted_line(self.choice_index - 1)
					end
				end,
			},
			{
				pattern = 'a[jp]',
				go = function(self)
					if self.stagger_blocked then return end
					if self.text_main:is_typing() then return end
					local node<const> = story[self.node_id]
					local round<const> = node.rounds[self.combat_round_index]
					local option<const> = round.options[self.choice_index]
					self.combat_points = self.combat_points + option.points
					self.combat_round_index = self.combat_round_index + 1
					if option.outcome == 'hit' then
						return '/combat_hit'
					end
					return '/combat_dodge'
				end,
			},
		},
		exiting_state = function(self)
			self.timelines:stop(combat_hover_timeline_id)
			self:clear_combat_parallax_transform()
			refresh_combat_parallax(self)
		end,
	}

	states.combat_hit = {
		timelines = {
			[combat_hit_timeline_id] = {
				autoplay = false,
				stop_on_exit = true,
				on_finished = {
					go = function(self)
						return finish_combat_hit(self)
					end,
				},
			},
		},
		entering_state = function(self)
			clear_texts(self.choice_prompt_texts)
			self.text_main:set_text({ 'RAAK!' }, { typed = false, snap = true })
			self:push_combat_momentum('hero', combat_parallax_momentum_step)
			local monster<const> = self.monster
			local maya_a<const> = self.maya_a
			monster.x = self.combat_monster_base_x
			monster.y = self.combat_monster_base_y
			monster.sprite_component.scale_x = 1
			monster.sprite_component.scale_y = 1
			local targets<const> = {
				monster = monster,
				slash_frame = self.combat_hit_slash_frame,
			}
			self.timelines:play(combat_hit_timeline_id, {
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
			self:activate_combat_parallax_transform()
		end,
		input_eval = 'first',
		input_event_handlers = {
			{
				pattern = 'b[jp]',
				go = function(self)
					return finish_combat_hit(self)
				end,
			},
		},
		exiting_state = function(self)
			self.combat_hit_slash_frame.slash_active = false
		end,
	}

	states.combat_dodge = {
		timelines = {
			[combat_dodge_timeline_id] = {
				autoplay = false,
				stop_on_exit = true,
				on_finished = {
					go = function(self)
						return finish_combat_dodge(self)
					end,
				},
			},
		},
			entering_state = function(self)
				clear_texts(self.choice_prompt_texts)
				self.text_main:set_text({ 'ONTWIJKT!' }, { typed = false, snap = true })
				local monster<const> = self.monster
				local maya_a<const> = self.maya_a
				monster.sprite_component.scale_x = 1
				monster.sprite_component.scale_y = 1
				self.combat_dodge_dir = -self.combat_dodge_dir
				self.timelines:play(combat_dodge_timeline_id, {
					rewind = true,
					snap_to_start = true,
					target = monster,
					params = {
						dir = self.combat_dodge_dir,
						base_x = self.combat_monster_base_x,
				},
			})
			self:activate_combat_parallax_transform()
		end,
		input_eval = 'first',
		input_event_handlers = {
			{
				pattern = 'b[jp]',
				go = function(self)
					return finish_combat_dodge(self)
				end,
			},
		},
	}

	states.combat_exchange_hit = {
		timelines = {
			[combat_exchange_hit_timeline_id] = {
				autoplay = false,
				stop_on_exit = true,
				on_finished = {
					go = function(self)
						return finish_combat_exchange(self)
					end,
				},
			},
		},
		entering_state = function(self)
			local monster<const> = self.monster
			local maya_a<const> = self.maya_a
			local overlay<const> = self.transition_visual.overlay
			clear_texts(self.choice_prompt_texts)
			self:push_combat_momentum('monster', combat_parallax_momentum_step)
			monster.visible = true
			maya_a.visible = true
			monster.x = self.combat_monster_base_x
			monster.y = self.combat_monster_base_y
			maya_a.x = self.combat_maya_a_base_x
			maya_a.y = self.combat_maya_a_base_y
			monster.sprite_component.scale_x = 1
			monster.sprite_component.scale_y = 1
			maya_a.sprite_component.scale_x = 1
			maya_a.sprite_component.scale_y = 1
			monster.sprite_component.color = p3_white_color
			maya_a.sprite_component.color = p3_white_color
			overlay.visible = true
			overlay.x = 0
			overlay.y = 0
			overlay.width = screen_width
			overlay.height = screen_height
			overlay.color = 0
			overlay.blend_mode = gp0.draw_mode_blend_add
			overlay.blend_color = 0
			local targets<const> = {
				monster = monster,
				maya_a = maya_a,
				overlay = overlay,
			}
			self.timelines:play(combat_exchange_hit_timeline_id, {
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
					flash_color = p3_cyan_color,
					squash = true,
					cam_shake_x = combat_exchange_hit_shake_x,
					cam_shake_y = combat_exchange_hit_shake_y,
					overlay_strength = combat_exchange_hit_overlay_strength,
				},
			})
			self:activate_combat_parallax_transform()
		end,
		input_eval = 'first',
		input_event_handlers = {
			{
				pattern = 'b[jp]',
				go = function(self)
					return finish_combat_exchange(self)
				end,
			},
		},
		exiting_state = function(self)
			local monster<const> = self.monster
			local maya_a<const> = self.maya_a
			local overlay<const> = self.transition_visual.overlay
			monster.x = self.combat_monster_base_x
			monster.y = self.combat_monster_base_y
			maya_a.x = self.combat_maya_a_base_x
			maya_a.y = self.combat_maya_a_base_y
			monster.sprite_component.scale_x = 1
			monster.sprite_component.scale_y = 1
			maya_a.sprite_component.scale_x = 1
			maya_a.sprite_component.scale_y = 1
			monster.sprite_component.color = p3_white_color
			maya_a.sprite_component.color = p3_white_color
			overlay.visible = false
			overlay.color = 0
			overlay.blend_color = 0
		end,
	}

	states.combat_exchange_miss = {
		timelines = {
			[combat_exchange_miss_timeline_id] = {
				autoplay = false,
				stop_on_exit = true,
				on_finished = {
					go = function(self)
						return finish_combat_exchange(self)
					end,
				},
			},
		},
		entering_state = function(self)
			local monster<const> = self.monster
			local maya_a<const> = self.maya_a
			local overlay<const> = self.transition_visual.overlay
			clear_texts(self.choice_prompt_texts)
			monster.visible = true
			maya_a.visible = true
			monster.x = self.combat_monster_base_x
			monster.y = self.combat_monster_base_y
			maya_a.x = self.combat_maya_a_base_x
			maya_a.y = self.combat_maya_a_base_y
			monster.sprite_component.scale_x = 1
			monster.sprite_component.scale_y = 1
			maya_a.sprite_component.scale_x = 1
			maya_a.sprite_component.scale_y = 1
			monster.sprite_component.color = p3_white_color
			maya_a.sprite_component.color = p3_white_color
			overlay.visible = true
			overlay.x = 0
			overlay.y = 0
			overlay.width = screen_width
			overlay.height = screen_height
			overlay.color = 0
			overlay.blend_mode = gp0.draw_mode_blend_add
			overlay.blend_color = 0
			local targets<const> = {
				monster = monster,
				maya_a = maya_a,
				overlay = overlay,
			}
			self.timelines:play(combat_exchange_miss_timeline_id, {
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
					flash_color = p3_white_color,
					squash = false,
					cam_shake_x = 0,
					cam_shake_y = 0,
					overlay_strength = 0,
				},
			})
			self:activate_combat_parallax_transform()
		end,
		input_eval = 'first',
		input_event_handlers = {
			{
				pattern = 'b[jp]',
				go = function(self)
					return finish_combat_exchange(self)
				end,
			},
		},
		exiting_state = function(self)
			local monster<const> = self.monster
			local maya_a<const> = self.maya_a
			local overlay<const> = self.transition_visual.overlay
			monster.x = self.combat_monster_base_x
			monster.y = self.combat_monster_base_y
			maya_a.x = self.combat_maya_a_base_x
			maya_a.y = self.combat_maya_a_base_y
			monster.sprite_component.scale_x = 1
			monster.sprite_component.scale_y = 1
			maya_a.sprite_component.scale_x = 1
			maya_a.sprite_component.scale_y = 1
			monster.sprite_component.color = p3_white_color
			maya_a.sprite_component.color = p3_white_color
			overlay.visible = false
			overlay.color = 0
			overlay.blend_color = 0
		end,
	}

	states.combat_all_out_prompt = {
		entering_state = function(self)
			clear_texts(self.choice_prompt_texts)
			self.text_main:set_text({ 'Het monster lijkt rijp voor de sloop!' }, { typed = true, snap = false })
			self.text_choice:set_text({ 'ALL-OUT-ATTACK!!' }, { typed = false, snap = true })
			self.choice_index = 1
			self.text_choice:set_highlight_jitter_enabled(true)
			local monster<const> = self.monster
			local maya_a<const> = self.maya_a
			local portrait<const> = self.all_out_portrait
			portrait:set_imgid('maya_v_s')
			portrait.visible = true
			portrait:set_z(750)
			portrait.sprite_component.scale_x = 1
			portrait.sprite_component.scale_y = 1
			local target_x<const> = (screen_width * 0.08) // 1
			local target_y<const> = (screen_height - portrait.sy) // 1
			self.timelines:play(combat_all_out_prompt_timeline_id, {
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
			self.timelines:play(combat_hover_timeline_id, {
				rewind = true,
				snap_to_start = true,
				target = self,
				params = {
					monster = monster,
					monster_base_y = self.combat_monster_base_y,
				},
			})
			self:activate_combat_parallax_transform()
		end,
		update = function(self)
			local main<const> = self.text_main
			if main:is_typing() then
				main:type_next()
				if not main:is_typing() then
					self.text_prompt:set_text(prompt_attack, immediate_text_opts)
					self.text_choice:set_highlighted_line(0)
				end
				return
			end
		end,
		input_eval = 'first',
		input_event_handlers = {
			{
				pattern = 'b[jp]',
				go = function(self)
					if self:skip_typing() then
						self.text_prompt:set_text(prompt_attack, immediate_text_opts)
						self.text_choice:set_highlighted_line(0)
					end
				end
			},
				{
					pattern = 'a[jp]',
					go = function(self)
						if self.text_main:is_typing() then return end
						return '/combat_all_out'
					end,
				},
		},
		exiting_state = function(self)
			self.timelines:stop(combat_hover_timeline_id)
			self.timelines:stop(combat_all_out_prompt_timeline_id)
			self:clear_combat_parallax_transform()
			local portrait<const> = self.all_out_portrait
			portrait.visible = false
			portrait.sprite_component.scale_x = 1
			portrait.sprite_component.scale_y = 1
			self.text_choice:set_highlight_jitter_enabled(false)
		end,
	}

	states.combat_all_out = {
		timelines = {
			[combat_all_out_timeline_id] = {
				autoplay = false,
				stop_on_exit = true,
				on_finished = '/combat_focus',
			},
		},
		entering_state = function(self)
			self:disable_combat_parallax()
			clear_texts(self.texts)
			local all_out<const> = self.all_out
			texture_residency.load_all_out()
			all_out.visible = true
			all_out.x = 0
			all_out.y = 0
			all_out:set_z(800)
			local monster<const> = self.monster
			local maya_a<const> = self.maya_a
			local maya_b<const> = self.maya_b
			local bg<const> = self.background
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
			monster.visible = false
			maya_a.visible = false
			maya_b.visible = false
			self.timelines:play(combat_all_out_timeline_id, {
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
			{
				pattern = 'b[jp]',
				go = '/combat_focus',
			},
		},
		exiting_state = function(self)
			local all_out<const> = self.all_out
			local monster<const> = self.monster
			local maya_a<const> = self.maya_a
			local maya_b<const> = self.maya_b
			local bg<const> = self.background
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
			local monster<const> = self.monster
			monster.visible = true

			self.timelines:play(combat_focus_timeline_id, {
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
			{
				pattern = 'b[jp]',
				go = function(self)
					hide_combat_visuals(self.combat_visuals)
					clear_texts(self.texts)
					return '/combat_results_setup'
				end,
			},
		},
		on = {
			['combat_focus.snap'] = {
				go = function(self)
					hide_combat_visuals(self.combat_visuals)
					clear_texts(self.texts)
				end,
			},
			['combat_focus.done'] = {
				go = '/combat_results_setup',
			},
		},
	}

	states.combat_results_setup = {
		entering_state = function(self)
			self:disable_combat_parallax()
			local node<const> = story[self.node_id]
			local rewards<const> = node.rewards[self.combat_points + 1]
			self.combat_rewards = rewards
			self.events:emit('combat.results', {
				combat_node_id = self.combat_node_id,
				monster_imgid = self.combat_monster_imgid,
			})

			clear_texts(self.story_texts)

			local monster<const> = self.monster
			monster.visible = false
			local maya_a<const> = self.maya_a
			maya_a.visible = false
			local all_out<const> = self.all_out
			all_out.visible = false

			local bg<const> = self.combat_results_visual
			bg.visible = true
			bg.x = 0
			bg.y = 0
			bg.width = screen_width
			bg.height = screen_height
			bg.color = p3_black_color

			local maya_b<const> = self.maya_b
			maya_b:set_imgid('maya_b')
			maya_b.visible = true
			maya_b:set_z(combat_results_maya_z)
			self.combat_results_maya_target_x = screen_width - maya_b.sx
			self.combat_results_maya_start_x = screen_width
			maya_b.x = self.combat_results_maya_start_x
			maya_b.y = screen_height - maya_b.sy
			maya_b.sprite_component.color = p3_black_color

			local lines<const> = { 'Combat Results:' }
			for i = 1, #rewards do
				local effect<const> = rewards[i]
				lines[#lines + 1] = stat_label(effect.stat) .. ' +' .. effect.add
			end
			self.text_results:set_text(lines, { typed = false, snap = true })
			local results<const> = self.text_results
			results.text_component.color = p3_black_color
			self.combat_results_text_target_x = results.text_component.offset_x / 2
			self.combat_results_text_start_x = -screen_width
			results.text_component.offset_x = self.combat_results_text_start_x
			return '/combat_results_fade_in'
		end,
	}

	states.combat_results_fade_in = {
		timelines = {
			[combat_results_fade_in_timeline_id] = {
				autoplay = false,
				stop_on_exit = true,
				on_finished = {
					go = function(self)
						return finish_combat_results_fade_in(self)
					end,
				},
			},
		},
		entering_state = function(self)
			self.timelines:play(combat_results_fade_in_timeline_id, {
				rewind = true,
				snap_to_start = true,
				target = {
					bg = self.combat_results_visual,
					maya_b = self.maya_b,
					results = self.text_results,
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
			{
				pattern = 'b[jp]',
				go = function(self)
					return finish_combat_results_fade_in(self)
				end,
			},
		},
	}

	states.combat_results = {
		input_eval = 'first',
		input_event_handlers = {
			{
				pattern = 'a[jp]',
				go = function(self)
					local node<const> = story[self.node_id]
					self.node_id = node.next
					return '/combat_results_fade_out'
				end,
			},
		},
	}

	states.combat_results_fade_out = {
		timelines = {
			[combat_results_fade_out_timeline_id] = {
				autoplay = false,
				stop_on_exit = true,
				on_finished = {
					go = function(self)
						return finish_combat_results_fade_out(self)
					end,
				},
			},
		},
		entering_state = function(self)
			clear_texts(self.story_texts)
			self.timelines:play(combat_results_fade_out_timeline_id, {
				rewind = true,
				snap_to_start = true,
				target = {
					bg = self.combat_results_visual,
					maya_b = self.maya_b,
					results = self.text_results,
				},
			})
		end,
		input_eval = 'first',
		input_event_handlers = {
			{
				pattern = 'b[jp]',
				go = function(self)
					return finish_combat_results_fade_out(self)
				end,
			},
		},
	}

	states.combat_exit_fade_in = {
		timelines = {
			[combat_exit_fade_in_timeline_id] = {
				autoplay = false,
				stop_on_exit = true,
				on_finished = {
					go = function(self)
						return finish_combat_exit_fade_in(self)
					end,
				},
			},
		},
		entering_state = function(self)
			local bg<const> = show_background(self.background, self.combat_exit_target_bg)
			bg.surface_component.color = p3_black_color
			self.timelines:play(combat_exit_fade_in_timeline_id, { rewind = true, snap_to_start = true, target = bg })
		end,
		input_eval = 'first',
		input_event_handlers = {
			{
				pattern = 'b[jp]',
				go = function(self)
					return finish_combat_exit_fade_in(self)
				end,
			},
		},
		exiting_state = function(self)
			local bg<const> = self.background
			bg.surface_component.color = p3_white_color
		end,
	}

	-- ARCHITECTURE: Engineering guidelines for FSM states that use timelines.
	--
	-- DEFINING timelines
	--   All timelines are declared once here, at the FSM root, using `def = { ... }`.
	--   The dictionary key is the timeline identity; `def` contains only authored
	--   evaluation data and is compiled by the owner's timeline component.
	--   autoplay = false at root level: registration only, no automatic playback.
	--
	-- PER-STATE BEHAVIOUR (in individual state `timelines` blocks, no `def`)
	--   autoplay = true   — play automatically on state enter (no runtime target/params).
	--   autoplay = false  — play manually via self.timelines:play(id, opts) in
	--                       entering_state. Required when `target` or `params` depend
	--                       on runtime values (e.g. self.combat_monster_base_x).
	--   stop_on_exit = true  — stop the timeline automatically on state exit.
	--   on_finished  — transition or action when the timeline finishes.
	--   apply      — compiled sampled output owned by the timeline definition.
	fsm_library.register(combat_director_fsm_id, {
		initial = 'boot',
		timelines = {
			-- Track-driven timelines (no frames, driven by wave/parallax tracks)
			[combat_hover_timeline_id] = {
				def = {
					playback_mode = 'loop',
					tracks = {
						{ kind = 'sample', apply = combat_hover_track },
					},
				},
				autoplay = false,
			},
			-- Frame-driven applied animation timelines (frames built by builder fns)
			-- These require a `target` and optional `params` at play time, so
			-- individual states use autoplay = false + entering_state play calls.
			[combat_focus_timeline_id] = {
				def = {
					frames = timelinebuilders.build_combat_focus_frames,
					frame_duration = combat_focus_frame_duration,
					playback_mode = 'once',
					apply = true,
					tracks = {
						{
							kind = 'event',
							keys = {
								{ frame = 0, event = 'combat_focus.snap', direction = 'forward' },
								{ u = 1, event = 'combat_focus.done', direction = 'forward' },
							},
						},
					},
				},
				autoplay = false,
			},
			[combat_intro_timeline_id] = {
				def = {
					frames = timelinebuilders.build_combat_intro_frames,
					frame_duration = combat_intro_frame_duration,
					playback_mode = 'once',
					apply = true,
				},
				autoplay = false,
			},
			[combat_hit_timeline_id] = {
				def = {
					frames = timelinebuilders.build_combat_hit_frames,
					frame_duration = combat_hit_frame_duration,
					playback_mode = 'once',
					apply = true,
				},
				autoplay = false,
			},
			[combat_exchange_hit_timeline_id] = {
				def = {
					frames = timelinebuilders.build_combat_exchange_frames,
					frame_duration = combat_exchange_hit_frame_duration,
					playback_mode = 'once',
					apply = true,
				},
				autoplay = false,
			},
			[combat_exchange_miss_timeline_id] = {
				def = {
					frames = timelinebuilders.build_combat_exchange_frames,
					frame_duration = combat_exchange_miss_frame_duration,
					playback_mode = 'once',
					apply = true,
				},
				autoplay = false,
			},
			[combat_all_out_prompt_timeline_id] = {
				def = {
					frames = build_all_out_prompt_portrait_frames,
					frame_duration = 16,
					playback_mode = 'once',
					apply = true,
				},
				autoplay = false,
			},
			[combat_dodge_timeline_id] = {
				def = {
					frames = timelinebuilders.build_combat_dodge_frames,
					frame_duration = combat_dodge_frame_duration,
					playback_mode = 'once',
					apply = true,
				},
				autoplay = false,
			},
			[combat_all_out_timeline_id] = {
				def = {
					frames = build_all_out_screen_shake_frames,
					frame_duration = combat_all_out_frame_duration,
					playback_mode = 'once',
					apply = true,
				},
				autoplay = false,
			},
			-- Fade timelines bind their retained targets when the state starts.
			[combat_fade_timeline_id] = {
				def = {
					frames = timelinebuilders.build_combat_fade_frames(),
					frame_duration = combat_fade_frame_duration,
					playback_mode = 'once',
					apply = true,
				},
				autoplay = false,
			},
			[combat_results_fade_in_timeline_id] = {
				def = {
					frames = timelinebuilders.build_combat_results_fade_in_frames,
					frame_duration = combat_results_fade_in_frame_duration,
					playback_mode = 'once',
					apply = true,
				},
				autoplay = false,
			},
			[combat_results_fade_out_timeline_id] = {
				def = {
					frames = timelinebuilders.build_combat_results_fade_out_frames(),
					frame_duration = combat_results_fade_out_frame_duration,
					playback_mode = 'once',
					apply = true,
				},
				autoplay = false,
			},
			[combat_exit_fade_in_timeline_id] = {
				def = {
					frames = timelinebuilders.build_combat_exit_fade_in_frames(),
					frame_duration = combat_exit_fade_in_frame_duration,
					playback_mode = 'once',
					apply = true,
				},
				autoplay = false,
			},
		},
		states = states,
	})
end

function combat.register_director()
	prefab.define({
		def_id = director_definition_id,
		class = combat_director,
		components = {
			timeline_component.new,
			fsm_component.factory({ combat_director_fsm_id }),
		},
		defaults = {
			player_index = 1,
			node_id = nil,
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
			combat_exit_target_bg = nil,
			combat_results_maya_target_x = 0,
			combat_results_maya_start_x = 0,
			combat_results_text_target_x = 0,
			combat_results_text_start_x = 0,
			combat_parallax_enabled = false,
			combat_parallax_transform_active = false,
			combat_parallax_momentum_steps = 0,
			combat_parallax_offset_base_y = 0,
			skip_combat_fade_in = false,
			skip_transition_fade = false,
			combat_node_id = nil,
		},
	})
end

return combat
