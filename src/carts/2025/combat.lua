local combat<const> = {}
local globals<const> = require('globals')
local story<const> = require('story')
local timeline_builders<const> = require('timeline_builders')
local stagger<const> = require('stagger')

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

combat.all_out_shake = timeline_builders.build_all_out_shake(globals.combat_all_out_frame_count)
local round<const> = timeline_builders.round
local combat_all_out_prompt_timeline_id<const> = 'combat_all_out_prompt'

local build_all_out_prompt_portrait_frames<const> = function(params)
	local frames<const> = {}
	local in_frames<const> = params.in_frames
	local settle_frames<const> = params.settle_frames
	for i = 0, in_frames - 1 do
		local u<const> = i / (in_frames - 1)
		local eased<const> = easing.smoothstep(u)
		local x<const> = params.from_x + ((params.to_x - params.from_x) * eased)
		local y<const> = params.from_y + ((params.to_y - params.from_y) * eased)
		local scale<const> = params.from_scale + ((params.overshoot_scale - params.from_scale) * easing.smoothstep(u))
		frames[#frames + 1] = {
			x = x,
			y = y,
			sprite_component = { scale = { x = scale, y = scale } },
		}
	end
	for i = 0, settle_frames - 1 do
		local u<const> = i / (settle_frames - 1)
		local eased<const> = easing.smoothstep(u)
		local scale<const> = params.overshoot_scale + ((params.to_scale - params.overshoot_scale) * eased)
		local bob<const> = math.sin(u * math.pi) * params.settle_bob
		frames[#frames + 1] = {
			x = params.to_x,
			y = params.to_y + bob,
			sprite_component = { scale = { x = scale, y = scale } },
		}
	end
	return frames
end

local build_all_out_screen_shake_frames<const> = function(params)
	local frames<const> = {}
	for frame_index = 0, globals.combat_all_out_frame_count - 1 do
		local dx, dy = combat.all_out_shake(frame_index)
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

local combat_director<const> = {}
combat_director.__index = combat_director

function combat_director:start_combat(node_id, opts)
	self.node_id = node_id
	self.combat_node_id = node_id
	local node<const> = story[node_id]
	self.combat_monster_imgid = node.monster_imgid
	self.combat_rewards = {}
	self.skip_transition_fade = false
	self.skip_combat_fade_in = opts.skip_fade_in
	self.events:emit('combat.start')
end

function combat_director:apply_combat_round(node)
	local round<const> = node.rounds[self.combat_round_index]
	local choice_lines<const> = {}
	for i = 1, #round.options do
		choice_lines[i] = round.options[i].label
	end
	stagger.play(self, 'combat', {
		bg = oget(globals.bg_id),
		bg_dim = false,
		pose_targets = {
			oget(globals.combat_maya_a_id),
		},
		text_main = oget(globals.text_main_id),
		text_choice = oget(globals.text_choice_id),
		text_prompt = oget(globals.text_prompt_id),
		text_lines = round.prompt,
		text_choice_lines = choice_lines,
		text_typed = true,
	})
	self.choice_index = 1
end

local refresh_combat_parallax<const> = function(self)
	local rig_vy<const> = combat_parallax_vy_base + combat_parallax_vy_momentum
	local rig_scale<const> = combat_parallax_scale_base + combat_parallax_scale_momentum
	local rig_impact = 0
	if self.combat_parallax_impact_side == 'hero' then
		rig_impact = combat_parallax_impact_amp
	elseif self.combat_parallax_impact_side == 'monster' then
		rig_impact = -combat_parallax_impact_amp
	end
	local momentum<const> = self.combat_parallax_momentum
	local hero_weight<const> = (combat_parallax_vy_base - (combat_parallax_vy_momentum * momentum)) / rig_vy
	local monster_weight<const> = -(combat_parallax_vy_base + (combat_parallax_vy_momentum * momentum)) / rig_vy
	local bias_px<const> = combat_parallax_bias_base - (combat_parallax_bias_momentum * momentum)
	local flip_strength = 0
	if self.combat_parallax_impact_side then
		flip_strength = combat_parallax_flip_strength
	end
	local hero<const> = oget(globals.combat_maya_a_id)
	local hero_b<const> = oget(globals.combat_maya_b_id)
	local monster<const> = oget(globals.combat_monster_id)
	hero.sprite_component.parallax_weight = hero_weight
	hero_b.sprite_component.parallax_weight = hero_weight
	monster.sprite_component.parallax_weight = monster_weight
	self:play_timeline(globals.combat_parallax_timeline_id, {
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
	self.combat_parallax_impact_side = nil
	refresh_combat_parallax(self)
end

function combat_director:disable_combat_parallax()
	self.combat_parallax_enabled = false
	self:stop_timeline(globals.combat_parallax_timeline_id)
	set_sprite_parallax_rig(0, 1, 0, 0, 0, 1, 1, 0, combat_parallax_flip_window_seconds)
	local hero<const> = oget(globals.combat_maya_a_id)
	local hero_b<const> = oget(globals.combat_maya_b_id)
	local monster<const> = oget(globals.combat_monster_id)
	hero.sprite_component.parallax_weight = 0
	hero_b.sprite_component.parallax_weight = 0
	monster.sprite_component.parallax_weight = 0
end

function combat_director:push_combat_momentum(side, power)
	local delta<const> = side == 'hero' and power or -power
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

function combat_director:skip_typing()
	if oget(globals.text_main_id):is_typing() then
		oget(globals.text_main_id):reveal_text()
		consume_action('b')
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
				slash_color = { r = 1, g = 1, b = 1, a = 0 },
				slash_z = globals.combat_hit_slash_z,
			}
				self.combat_hit_slash_rc = attach_component(self, 'customvisualcomponent')
				self.combat_hit_slash_rc:add_producer(function(ctx)
					local frame<const> = ctx.parent.combat_hit_slash_frame
					if not frame.slash_active then
						return
					end
					local points<const> = frame.slash_points
					local z<const> = frame.slash_z
					local color<const> = frame.slash_color
					local thickness<const> = frame.slash_thickness
					local n<const> = #points / 2
					for i = 0, n - 1 do
						local x0<const> = points[i * 2 + 1]
						local y0<const> = points[i * 2 + 2]
						local x1<const> = points[((i + 1) % n) * 2 + 1]
						local y1<const> = points[((i + 1) % n) * 2 + 2]
						memwrite(
							vdp_stream_claim_words(sys_vdp_stream_packet_header_words + 11),
							sys_vdp_cmd_draw_line,
							11,
							0,
							x0,
							y0,
							x1,
							y1,
							z,
							sys_vdp_layer_world,
							color.r,
							color.g,
							color.b,
							color.a,
							thickness
						)
					end
				end)
			globals.hide_combat_sprites()
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
			globals.hide_combat_sprites()
		end,
	}

	states.combat_done = {
		entering_state = function(self)
			self:disable_combat_parallax()
			oget(globals.director_instance_id).events:emit('combat.end', {
				combat_node_id = self.combat_node_id,
				next_node_id = self.node_id,
				monster_imgid = self.combat_monster_imgid,
				rewards = self.combat_rewards,
				skip_transition_fade = self.skip_transition_fade,
			})
			return '/idle'
		end,
	}

	local finish_combat_fade_in<const> = function(self)
		return '/combat_init'
	end

	local finish_combat_fade_out<const> = function(self)
		return '/combat_done'
	end

	local finish_combat_intro<const> = function(self)
		return '/combat_round'
	end

	local finish_combat_exchange<const> = function(self)
		local node<const> = story[self.node_id]
		if self.combat_round_index > #node.rounds then
			return '/combat_all_out_prompt'
		end
		return '/combat_round'
	end

	local finish_combat_hit<const> = function(self)
		local monster<const> = oget(globals.combat_monster_id)
		monster.sprite_component.colorize = { r = 1, g = 1, b = 1, a = 1 }
		monster.x = self.combat_monster_base_x
		monster.y = self.combat_monster_base_y
		monster.sprite_component.scale = { x = 1, y = 1 }
		return '/combat_exchange_miss'
	end

	local finish_combat_dodge<const> = function(self)
		local monster<const> = oget(globals.combat_monster_id)
		monster.x = self.combat_monster_base_x
		monster.y = self.combat_monster_base_y
		monster.sprite_component.scale = { x = 1, y = 1 }
		return '/combat_exchange_hit'
	end

	local finish_combat_all_out<const> = function(self)
		return '/combat_focus'
	end

	local finish_combat_focus<const> = function(self)
		globals.hide_combat_sprites()
		globals.clear_texts(globals.text_ids_all)
		return '/combat_results_setup'
	end

	local finish_combat_results_fade_in<const> = function(self)
		local bg<const> = oget(globals.director_instance_id).combat_results_visual
		bg.visible = true
		bg.r = globals.combat_results_bg_r
		bg.g = globals.combat_results_bg_g
		bg.b = globals.combat_results_bg_b
		bg.a = globals.combat_results_bg_a
		local maya_b<const> = oget(globals.combat_maya_b_id)
		maya_b.sprite_component.colorize = { r = 1, g = 1, b = 1, a = 1 }
		maya_b.x = self.combat_results_maya_target_x
		local results<const> = oget(globals.text_results_id)
		results.text_color = { r = 1, g = 1, b = 1, a = 1 }
		results.centered_block_x = self.combat_results_text_target_x
		return '/combat_results'
	end

	local finish_combat_results_fade_out<const> = function(self)
		oget(globals.combat_maya_b_id).visible = false
		oget(globals.text_results_id):clear_text()
		local bg<const> = oget(globals.director_instance_id).combat_results_visual
		bg.visible = false
		bg.r = 1
		bg.g = 1
		bg.b = 1
		bg.a = 1
		globals.hide_combat_sprites()
		local next_kind<const> = story[self.node_id].kind
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

	local finish_combat_exit_fade_in<const> = function(self)
		local bg<const> = oget(globals.bg_id)
		bg.sprite_component.colorize = { r = 1, g = 1, b = 1, a = 1 }
		return '/combat_done'
	end

	states.combat_fade_in = {
		timelines = {
			[globals.combat_fade_timeline_id] = {
				autoplay = false,
				stop_on_exit = true,
				on_end = {
					go = function(self)
						return finish_combat_fade_in(self)
					end,
				},
			},
		},
		entering_state = function(self)
			globals.clear_texts(globals.text_ids_all)
			globals.hide_combat_sprites()
			globals.hide_transition_layers()
			local bg<const> = oget(globals.bg_id)
			bg.visible = true
			bg.sprite_component.colorize = { r = 1, g = 1, b = 1, a = 1 }
			self:play_timeline(globals.combat_fade_timeline_id, { rewind = true, snap_to_start = true, target = bg })
		end,
		input_eval = 'first',
		input_event_handlers = {
			['b[jp]'] = {
				go = function(self)
					return finish_combat_fade_in(self)
				end,
			},
		},
		leaving_state = function(self)
			local bg<const> = oget(globals.bg_id)
			bg.sprite_component.colorize = { r = 0, g = 0, b = 0, a = 1 }
		end,
	}

	states.combat_fade_out = {
		timelines = {
			[globals.combat_fade_timeline_id] = {
				autoplay = false,
				stop_on_exit = true,
				on_end = {
					go = function(self)
						return finish_combat_fade_out(self)
					end,
				},
			},
		},
		entering_state = function(self)
			globals.clear_texts(globals.text_ids_core)
			self:play_timeline(globals.combat_fade_timeline_id, { rewind = true, snap_to_start = true, target = oget(globals.bg_id) })
		end,
		input_eval = 'first',
		input_event_handlers = {
			['b[jp]'] = {
				go = function(self)
					return finish_combat_fade_out(self)
				end,
			},
		},
	}

	states.combat_init = {
		entering_state = function(self)
			local node<const> = story[self.node_id]
			globals.clear_texts(globals.text_ids_transition_results)
			globals.reset_text_colors()
			globals.hide_transition_layers()

			local bg<const> = oget(globals.bg_id)
			bg.visible = false

			self.combat_round_index = 1
			self.combat_points = 0
			self.combat_max_points = #node.rounds

			local monster<const> = oget(globals.combat_monster_id)
			monster:gfx(node.monster_imgid)
			monster.visible = false
			monster.sprite_component.colorize = { r = 1, g = 1, b = 1, a = 1 }
			monster.z = 200
			monster.sprite_component.scale = { x = 1, y = 1 }

			monster.x = (display_width() * 0.65) - (monster.sx / 2)
			monster.y = (display_height() * 0.25) - (monster.sy / 3)

				self.combat_monster_base_x = monster.x
				self.combat_monster_base_y = monster.y
				self.combat_monster_start_x = (display_width() * 0.2) - (monster.sx / 2)
				self.combat_monster_start_y = self.combat_monster_base_y + globals.combat_intro_monster_start_y_offset
				self.combat_monster_start_scale = math.max(1, display_width() / monster.sx, display_height() / monster.sy)

			local maya_a<const> = oget(globals.combat_maya_a_id)
			maya_a:gfx('maya_a')
			maya_a.visible = false
			maya_a.x = 0
			maya_a.y = display_height() - maya_a.sy
			maya_a.z = 300
			self.combat_maya_a_base_x = maya_a.x
			self.combat_maya_a_base_y = maya_a.y
			self.combat_maya_a_start_x = display_width()
			self.combat_maya_a_start_scale = globals.combat_intro_maya_a_scale_ratio

			local all_out<const> = oget(globals.combat_all_out_id)
			all_out.visible = false
			all_out.x = 0
			all_out.y = 0
			all_out.z = 800

			local maya_b<const> = oget(globals.combat_maya_b_id)
			maya_b:gfx('maya_b')
			maya_b.visible = true
			maya_b.sprite_component.colorize = { r = 1, g = 1, b = 1, a = 1 }
			maya_b.x = display_width() - maya_b.sx
			maya_b.y = display_height() - maya_b.sy
			maya_b.z = 300
			self.combat_maya_b_start_x = maya_b.x
			self.combat_maya_b_base_y = maya_b.y
			self.combat_maya_b_start_scale = globals.combat_intro_maya_b_start_scale
			self.combat_maya_b_end_scale = globals.combat_intro_maya_b_end_scale
			self.combat_maya_b_start_right_x = self.combat_maya_b_start_x + maya_b.sx
			self.combat_maya_b_exit_right_x = self.combat_maya_b_start_right_x + maya_b.sx

			self:reset_combat_parallax()
			return '/combat_intro'
		end,
	}

	states.combat_intro = {
		timelines = {
			[globals.combat_intro_timeline_id] = {
				autoplay = false,
				stop_on_exit = true,
				on_end = {
					go = function(self)
						return finish_combat_intro(self)
					end,
				},
			},
		},
		entering_state = function(self)
			local monster<const> = oget(globals.combat_monster_id)
			local maya_a<const> = oget(globals.combat_maya_a_id)
			local maya_b<const> = oget(globals.combat_maya_b_id)
			local targets<const> = {
				monster = monster,
				maya_a = maya_a,
				maya_b = maya_b,
			}
			self:play_timeline(globals.combat_intro_timeline_id, {
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
		leaving_state = function(self)
			local monster<const> = oget(globals.combat_monster_id)
			monster.sprite_component.scale = { x = 1, y = 1 }
			monster.x = self.combat_monster_base_x
			monster.y = self.combat_monster_base_y
			monster.visible = true

			local maya_a<const> = oget(globals.combat_maya_a_id)
			maya_a.sprite_component.scale = { x = 1, y = 1 }
			maya_a.x = self.combat_maya_a_base_x
			maya_a.y = self.combat_maya_a_base_y
			maya_a.visible = true

			local maya_b<const> = oget(globals.combat_maya_b_id)
			maya_b.sprite_component.scale = { x = 1, y = 1 }
			maya_b.visible = false
			maya_b.x = self.combat_maya_b_start_x
			maya_b.y = self.combat_maya_b_base_y
		end,
	}

	states.combat_round = {
		entering_state = function(self)
			local node<const> = story[self.node_id]
			globals.clear_texts(globals.text_ids_transition_results)
			local bg<const> = oget(globals.bg_id)
			bg.visible = false
			local monster<const> = oget(globals.combat_monster_id)
			monster:gfx(node.monster_imgid)
			monster.visible = true
			local maya_a<const> = oget(globals.combat_maya_a_id)
			maya_a:gfx('maya_a')
			maya_a.visible = true
			oget(globals.combat_all_out_id).visible = false
			oget(globals.combat_maya_b_id).visible = false
			self:apply_combat_round(node)
			self:play_timeline(globals.combat_hover_timeline_id, {
				rewind = true,
				snap_to_start = true,
				target = monster,
				params = { base_y = self.combat_monster_base_y },
			})
		end,
		update = function(self)
			if self.stagger_blocked then
				return
			end
				local main<const> = oget(globals.text_main_id)
				if main:is_typing() then
					main:type_next()
					return
				end
			oget(globals.text_prompt_id):set_text({ '(A) select' }, { typed = false, snap = true })
			local choice_text<const> = oget(globals.text_choice_id)
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
					local node<const> = story[self.node_id]
					local round<const> = node.rounds[self.combat_round_index]
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
						if oget(globals.text_main_id):is_typing() then return end
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
		leaving_state = function(self)
			self:stop_timeline(globals.combat_hover_timeline_id)
		end,
	}

	states.combat_hit = {
		timelines = {
			[globals.combat_hit_timeline_id] = {
				autoplay = false,
				stop_on_exit = true,
				on_end = {
					go = function(self)
						return finish_combat_hit(self)
					end,
				},
			},
		},
		entering_state = function(self)
			globals.clear_texts(globals.text_ids_choice_prompt)
			oget(globals.text_main_id):set_text({ 'RAAK!' }, { typed = false, snap = true })
			self:push_combat_momentum('hero', combat_parallax_momentum_step)
			local monster<const> = oget(globals.combat_monster_id)
			monster.x = self.combat_monster_base_x
			monster.y = self.combat_monster_base_y
			monster.sprite_component.scale = { x = 1, y = 1 }
			local targets<const> = {
				monster = monster,
				slash_frame = self.combat_hit_slash_frame,
			}
			self:play_timeline(globals.combat_hit_timeline_id, {
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
		leaving_state = function(self)
			self.combat_hit_slash_frame.slash_active = false
		end,
	}

	states.combat_dodge = {
		timelines = {
			[globals.combat_dodge_timeline_id] = {
				autoplay = false,
				stop_on_exit = true,
				on_end = {
					go = function(self)
						return finish_combat_dodge(self)
					end,
				},
			},
		},
			entering_state = function(self)
				globals.clear_texts(globals.text_ids_choice_prompt)
				oget(globals.text_main_id):set_text({ 'ONTWIJKT!' }, { typed = false, snap = true })
				local monster<const> = oget(globals.combat_monster_id)
				monster.sprite_component.scale = { x = 1, y = 1 }
				self.combat_dodge_dir = -self.combat_dodge_dir
				self:play_timeline(globals.combat_dodge_timeline_id, {
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
	}

	states.combat_exchange_hit = {
		timelines = {
			[globals.combat_exchange_hit_timeline_id] = {
				autoplay = false,
				stop_on_exit = true,
				on_end = {
					go = function(self)
						return finish_combat_exchange(self)
					end,
				},
			},
		},
		entering_state = function(self)
			local monster<const> = oget(globals.combat_monster_id)
			local maya_a<const> = oget(globals.combat_maya_a_id)
				local overlay<const> = oget(globals.director_instance_id).transition_visual.overlay
			globals.clear_texts(globals.text_ids_choice_prompt)
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
				overlay.x = 0
				overlay.y = 0
					overlay.width = display_width()
					overlay.height = display_height()
					overlay.r = 0
					overlay.g = 0
					overlay.b = 0
					overlay.a = 0
			local targets<const> = {
				monster = monster,
				maya_a = maya_a,
				overlay = overlay,
			}
			self:play_timeline(globals.combat_exchange_hit_timeline_id, {
				rewind = true,
				snap_to_start = true,
				target = targets,
				params = {
					frame_count = globals.combat_exchange_hit_frame_count,
					monster_base_x = self.combat_monster_base_x,
					monster_base_y = self.combat_monster_base_y,
					maya_base_x = self.combat_maya_a_base_x,
					maya_base_y = self.combat_maya_a_base_y,
					maya_offset_x = globals.combat_exchange_hit_recoil_distance,
					maya_offset_y = globals.combat_exchange_hit_recoil_lift,
					maya_hold_frames = globals.combat_exchange_hit_recoil_hold_frames,
					maya_recover_frames = globals.combat_exchange_hit_recoil_recover_frames,
					maya_bob_amp = 0,
					maya_bob_period_frames = combat_exchange_miss_dodge_bob_period_frames,
					maya_react_scale_x = globals.combat_exchange_hit_scale_x,
					maya_react_scale_y = globals.combat_exchange_hit_scale_y,
					maya_impact_scale_x = globals.combat_exchange_hit_impact_scale_x,
					maya_impact_scale_y = globals.combat_exchange_hit_impact_scale_y,
					flash = true,
					flash_r = p3_cyan_r,
					flash_g = p3_cyan_g,
					flash_b = p3_cyan_b,
					squash = true,
					cam_shake_x = globals.combat_exchange_hit_shake_x,
					cam_shake_y = globals.combat_exchange_hit_shake_y,
					overlay_alpha = globals.combat_exchange_hit_overlay_alpha,
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
		leaving_state = function(self)
			local monster<const> = oget(globals.combat_monster_id)
			local maya_a<const> = oget(globals.combat_maya_a_id)
			local overlay<const> = oget(globals.director_instance_id).transition_visual.overlay
					monster.x = self.combat_monster_base_x
				monster.y = self.combat_monster_base_y
				maya_a.x = self.combat_maya_a_base_x
				maya_a.y = self.combat_maya_a_base_y
				monster.sprite_component.scale = { x = 1, y = 1 }
				maya_a.sprite_component.scale = { x = 1, y = 1 }
				monster.sprite_component.colorize = { r = 1, g = 1, b = 1, a = 1 }
				maya_a.sprite_component.colorize = { r = 1, g = 1, b = 1, a = 1 }
				overlay.visible = false
				overlay.r = 0
				overlay.g = 0
				overlay.b = 0
				overlay.a = 0
		end,
	}

	states.combat_exchange_miss = {
		timelines = {
			[globals.combat_exchange_miss_timeline_id] = {
				autoplay = false,
				stop_on_exit = true,
				on_end = {
					go = function(self)
						return finish_combat_exchange(self)
					end,
				},
			},
		},
		entering_state = function(self)
			local monster<const> = oget(globals.combat_monster_id)
			local maya_a<const> = oget(globals.combat_maya_a_id)
			local overlay<const> = oget(globals.director_instance_id).transition_visual.overlay
			globals.clear_texts(globals.text_ids_choice_prompt)
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
				overlay.x = 0
				overlay.y = 0
					overlay.width = display_width()
					overlay.height = display_height()
					overlay.r = 0
					overlay.g = 0
					overlay.b = 0
					overlay.a = 0
			local targets<const> = {
				monster = monster,
				maya_a = maya_a,
				overlay = overlay,
			}
			self:play_timeline(globals.combat_exchange_miss_timeline_id, {
				rewind = true,
				snap_to_start = true,
				target = targets,
				params = {
					frame_count = globals.combat_exchange_miss_frame_count,
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
		leaving_state = function(self)
			local monster<const> = oget(globals.combat_monster_id)
			local maya_a<const> = oget(globals.combat_maya_a_id)
			local overlay<const> = oget(globals.director_instance_id).transition_visual.overlay
					monster.x = self.combat_monster_base_x
				monster.y = self.combat_monster_base_y
				maya_a.x = self.combat_maya_a_base_x
				maya_a.y = self.combat_maya_a_base_y
				monster.sprite_component.scale = { x = 1, y = 1 }
				maya_a.sprite_component.scale = { x = 1, y = 1 }
				monster.sprite_component.colorize = { r = 1, g = 1, b = 1, a = 1 }
				maya_a.sprite_component.colorize = { r = 1, g = 1, b = 1, a = 1 }
				overlay.visible = false
				overlay.r = 0
				overlay.g = 0
				overlay.b = 0
				overlay.a = 0
		end,
	}

	states.combat_all_out_prompt = {
		entering_state = function(self)
			globals.clear_texts(globals.text_ids_choice_prompt)
			oget(globals.text_main_id):set_text({ 'Het monster lijkt rijp voor de sloop!' }, { typed = true, snap = false })
			oget(globals.text_choice_id):set_text({ 'ALL-OUT-ATTACK!!' }, { typed = false, snap = true })
			self.choice_index = 1
			oget(globals.text_choice_id).highlight_jitter_enabled = true
			local portrait<const> = oget(globals.combat_all_out_id)
			portrait:gfx('maya_v_s')
			portrait.visible = true
			portrait.z = 750
			portrait.sprite_component.scale = { x = 1, y = 1 }
			local target_x<const> = math.floor(display_width() * 0.08)
			local target_y<const> = math.floor(display_height() - portrait.sy)
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
			self:play_timeline(globals.combat_hover_timeline_id, {
				rewind = true,
				snap_to_start = true,
				target = oget(globals.combat_monster_id),
				params = { base_y = self.combat_monster_base_y },
			})
		end,
			update = function(self)
				local main<const> = oget(globals.text_main_id)
				if main:is_typing() then
					main:type_next()
					return
				end
			oget(globals.text_prompt_id):set_text({ '(A) ATTACK' }, { typed = false, snap = true })
			oget(globals.text_choice_id).highlighted_line_index = 0
		end,
		input_eval = 'first',
		input_event_handlers = {
			['b[jp]'] = {
				go = function(self) self:skip_typing() end
			},
				['a[jp]'] = {
					go = function(self)
						if oget(globals.text_main_id):is_typing() then return end
						return '/combat_all_out'
					end,
				},
		},
		leaving_state = function(self)
			self:stop_timeline(globals.combat_hover_timeline_id)
			self:stop_timeline(combat_all_out_prompt_timeline_id)
			local portrait<const> = oget(globals.combat_all_out_id)
			portrait.visible = false
			portrait.sprite_component.scale = { x = 1, y = 1 }
			oget(globals.text_choice_id).highlight_jitter_enabled = false
		end,
	}

	states.combat_all_out = {
		timelines = {
			[globals.combat_all_out_timeline_id] = {
				autoplay = false,
				stop_on_exit = true,
				on_end = {
					go = function(self)
						return finish_combat_all_out(self)
					end,
				},
			},
		},
		entering_state = function(self)
			self:disable_combat_parallax() -- Disable parallax during "All Out" sequence.
			globals.clear_texts(globals.text_ids_all)
			local all_out<const> = oget(globals.combat_all_out_id)
			all_out:gfx('all_out')
			all_out.sprite_component.scale = { x = 1, y = 1 }
			all_out.visible = true
			all_out.x = 0
			all_out.y = 0
			all_out.z = 800
			local monster<const> = oget(globals.combat_monster_id)
			local maya_a<const> = oget(globals.combat_maya_a_id)
			local maya_b<const> = oget(globals.combat_maya_b_id)
			local bg<const> = oget(globals.bg_id)
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
			self:play_timeline(globals.combat_all_out_timeline_id, {
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
		leaving_state = function(self)
			local all_out<const> = oget(globals.combat_all_out_id)
			local monster<const> = oget(globals.combat_monster_id)
			local maya_a<const> = oget(globals.combat_maya_a_id)
			local maya_b<const> = oget(globals.combat_maya_b_id)
			local bg<const> = oget(globals.bg_id)
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
				local monster<const> = oget(globals.combat_monster_id)

				self:play_timeline(globals.combat_focus_timeline_id, {
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
					globals.hide_combat_sprites()
					globals.clear_texts(globals.text_ids_all)
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
			local node<const> = story[self.node_id]
				local rewards<const> = node.rewards[self.combat_points + 1]
			self.combat_rewards = rewards
			oget(globals.director_instance_id).events:emit('combat.results', {
				combat_node_id = self.combat_node_id,
				monster_imgid = self.combat_monster_imgid,
			})

			globals.clear_texts(globals.text_ids_core)

			local monster<const> = oget(globals.combat_monster_id)
			monster.visible = false
			local maya_a<const> = oget(globals.combat_maya_a_id)
			maya_a.visible = false
			local all_out<const> = oget(globals.combat_all_out_id)
			all_out.visible = false

				local bg<const> = oget(globals.director_instance_id).combat_results_visual
				bg.visible = true
				bg.x = 0
				bg.y = 0
				bg.width = display_width()
				bg.height = display_height()
				bg.r = globals.combat_results_bg_r
				bg.g = globals.combat_results_bg_g
				bg.b = globals.combat_results_bg_b
				bg.a = 0

			local maya_b<const> = oget(globals.combat_maya_b_id)
			maya_b:gfx('maya_b')
			maya_b.visible = true
			self.combat_results_maya_target_x = display_width() - maya_b.sx
			self.combat_results_maya_start_x = display_width()
			maya_b.x = self.combat_results_maya_start_x
			maya_b.y = display_height() - maya_b.sy
			maya_b.sprite_component.colorize = { r = 1, g = 1, b = 1, a = 0 }
			maya_b.z = 300

			local lines<const> = { 'Combat Results:' }
			for i = 1, #rewards do
				local effect<const> = rewards[i]
				lines[#lines + 1] = stat_label(effect.stat) .. ' +' .. effect.add
			end
			oget(globals.text_results_id):set_text(lines, { typed = false, snap = true })
			local results<const> = oget(globals.text_results_id)
			results.text_color = { r = 1, g = 1, b = 1, a = 0 }
			self.combat_results_text_target_x = results.centered_block_x / 2
			self.combat_results_text_start_x = -display_width()
			results.centered_block_x = self.combat_results_text_start_x
			return '/combat_results_fade_in'
		end,
	}

	states.combat_results_fade_in = {
		timelines = {
			[globals.combat_results_fade_in_timeline_id] = {
				create = function()
			return timeline.new({
				id = globals.combat_results_fade_in_timeline_id,
				frames = timeline_builders.build_combat_results_fade_in_frames,
				ticks_per_frame = globals.combat_results_fade_in_ticks_per_frame,
				playback_mode = 'once',
				apply = true,
			})
		end,
				autoplay = false,
				stop_on_exit = true,
				on_end = {
					go = function(self)
						return finish_combat_results_fade_in(self)
					end,
				},
			},
		},
		entering_state = function(self)
			self:play_timeline(globals.combat_results_fade_in_timeline_id, {
				rewind = true,
				snap_to_start = true,
				target = {
					bg = oget(globals.director_instance_id).combat_results_visual,
					maya_b = oget(globals.combat_maya_b_id),
					results = oget(globals.text_results_id),
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
	}

	states.combat_results = {
		input_eval = 'first',
		input_event_handlers = {
			['a[jp]'] = {
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
			[globals.combat_results_fade_out_timeline_id] = {
				autoplay = false,
				stop_on_exit = true,
				on_end = {
					go = function(self)
						return finish_combat_results_fade_out(self)
					end,
				},
			},
		},
		entering_state = function(self)
			globals.clear_texts(globals.text_ids_core)
			self:play_timeline(globals.combat_results_fade_out_timeline_id, {
				rewind = true,
				snap_to_start = true,
				target = {
					bg = oget(globals.director_instance_id).combat_results_visual,
					maya_b = oget(globals.combat_maya_b_id),
					results = oget(globals.text_results_id),
				},
			})
		end,
		input_eval = 'first',
		input_event_handlers = {
			['b[jp]'] = {
				go = function(self)
					return finish_combat_results_fade_out(self)
				end,
			},
		},
	}

	states.combat_exit_fade_in = {
		timelines = {
			[globals.combat_exit_fade_in_timeline_id] = {
				autoplay = false,
				stop_on_exit = true,
				on_end = {
					go = function(self)
						return finish_combat_exit_fade_in(self)
					end,
				},
			},
		},
		entering_state = function(self)
			local bg<const> = globals.show_background(self.combat_exit_target_bg)
			bg.sprite_component.colorize = { r = 0, g = 0, b = 0, a = 1 }
			self:play_timeline(globals.combat_exit_fade_in_timeline_id, { rewind = true, snap_to_start = true, target = bg })
		end,
		input_eval = 'first',
		input_event_handlers = {
			['b[jp]'] = {
				go = function(self)
					return finish_combat_exit_fade_in(self)
				end,
			},
		},
		leaving_state = function(self)
			local bg<const> = oget(globals.bg_id)
			bg.sprite_component.colorize = { r = 1, g = 1, b = 1, a = 1 }
		end,
	}

	-- ARCHITECTURE: Engineering guidelines for FSM states that use timelines.
	--
	-- DEFINING timelines
	--   All timelines are declared once here, at the FSM root, using `def = { ... }`.
	--   The engine calls timeline.new(def) internally — no timeline.new() call needed
	--   in cart code. The `id` field in `def` is optional; it defaults to the key.
	--   autoplay = false at root level: registration only, no automatic playback.
	--
	-- PER-STATE BEHAVIOUR (in individual state `timelines` blocks, no `def`)
	--   autoplay = true   — play automatically on state enter (no runtime target/params).
	--   autoplay = false  — play manually via self:play_timeline(id, opts) in
	--                       entering_state. Required when `target` or `params` depend
	--                       on runtime values (e.g. self.combat_monster_base_x).
	--   stop_on_exit = true  — stop the timeline automatically on state exit.
	--   on_end  — transition or action when the timeline finishes.
	--   on_frame  — action fired on every timeline frame update.
	define_fsm(globals.combat_director_fsm_id, {
		initial = 'boot',
		timelines = {
			-- Track-driven timelines (no frames, driven by wave/parallax tracks)
			[globals.combat_hover_timeline_id] = {
				def = {
					playback_mode = 'loop',
					tracks = {
						{
							kind = 'wave',
							path = { 'y' },
							base = 'base_y',
							amp = globals.combat_monster_hover_amp,
							period = combat_monster_hover_period_seconds,
							phase = 0.25,
							wave = 'pingpong',
							ease = easing.smoothstep,
						},
					},
				},
				autoplay = false,
			},
			[globals.combat_parallax_timeline_id] = {
				def = {
					playback_mode = 'once',
					duration_seconds = combat_parallax_impact_duration_seconds,
					tracks = {
						{ kind = 'sprite_parallax_rig' },
					},
				},
				autoplay = false,
			},
			-- Frame-driven applied animation timelines (frames built by builder fns)
			-- These require a `target` and optional `params` at play time, so
			-- individual states use autoplay = false + entering_state play calls.
			[globals.combat_focus_timeline_id] = {
				def = {
					frames = timeline_builders.build_combat_focus_frames,
					ticks_per_frame = globals.combat_focus_ticks_per_frame,
					playback_mode = 'once',
					apply = true,
					markers = {
						{ frame = 0, event = 'combat_focus.snap' },
						{ u = 1, event = 'combat_focus.done' },
					},
				},
				autoplay = false,
			},
			[globals.combat_intro_timeline_id] = {
				def = {
					frames = timeline_builders.build_combat_intro_frames,
					ticks_per_frame = globals.combat_intro_ticks_per_frame,
					playback_mode = 'once',
					apply = true,
				},
				autoplay = false,
			},
			[globals.combat_hit_timeline_id] = {
				def = {
					frames = timeline_builders.build_combat_hit_frames,
					ticks_per_frame = globals.combat_hit_ticks_per_frame,
					playback_mode = 'once',
					apply = true,
				},
				autoplay = false,
			},
			[globals.combat_exchange_hit_timeline_id] = {
				def = {
					frames = timeline_builders.build_combat_exchange_frames,
					ticks_per_frame = globals.combat_exchange_hit_ticks_per_frame,
					playback_mode = 'once',
					apply = true,
				},
				autoplay = false,
			},
			[globals.combat_exchange_miss_timeline_id] = {
				def = {
					frames = timeline_builders.build_combat_exchange_frames,
					ticks_per_frame = globals.combat_exchange_miss_ticks_per_frame,
					playback_mode = 'once',
					apply = true,
				},
				autoplay = false,
			},
			[combat_all_out_prompt_timeline_id] = {
				def = {
					frames = build_all_out_prompt_portrait_frames,
					ticks_per_frame = 16,
					playback_mode = 'once',
					apply = true,
				},
				autoplay = false,
			},
			[globals.combat_dodge_timeline_id] = {
				def = {
					frames = timeline_builders.build_combat_dodge_frames,
					ticks_per_frame = globals.combat_dodge_ticks_per_frame,
					playback_mode = 'once',
					apply = true,
				},
				autoplay = false,
			},
			[globals.combat_all_out_timeline_id] = {
				def = {
					frames = build_all_out_screen_shake_frames,
					ticks_per_frame = globals.combat_all_out_ticks_per_frame,
					playback_mode = 'once',
					apply = true,
				},
				autoplay = false,
			},
			-- Fade timelines. These use a fixed target (globals.bg_id / etc.) that is only
			-- valid at runtime, so individual states call play_timeline manually.
			[globals.combat_fade_timeline_id] = {
				def = {
					frames = timeline_builders.build_combat_fade_frames(),
					ticks_per_frame = globals.combat_fade_ticks_per_frame,
					playback_mode = 'once',
					apply = true,
				},
				autoplay = false,
			},
			[globals.combat_results_fade_in_timeline_id] = {
				def = {
					frames = timeline_builders.build_combat_results_fade_in_frames,
					ticks_per_frame = globals.combat_results_fade_in_ticks_per_frame,
					playback_mode = 'once',
					apply = true,
				},
				autoplay = false,
			},
			[globals.combat_results_fade_out_timeline_id] = {
				def = {
					frames = timeline_builders.build_combat_results_fade_out_frames(),
					ticks_per_frame = globals.combat_results_fade_out_ticks_per_frame,
					playback_mode = 'once',
					apply = true,
				},
				autoplay = false,
			},
			[globals.combat_exit_fade_in_timeline_id] = {
				def = {
					frames = timeline_builders.build_combat_exit_fade_in_frames(),
					ticks_per_frame = globals.combat_exit_fade_in_ticks_per_frame,
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
	define_prefab({
		def_id = globals.combat_director_def_id,
		class = combat_director,
		type = 'object',
		fsms = { globals.combat_director_fsm_id },
		defaults = {
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
			combat_parallax_momentum = 0,
				combat_parallax_impact_side = nil,
			skip_combat_fade_in = false,
			skip_transition_fade = false,
			combat_node_id = nil,
			combat_rewards = {},
		},
	})
end

return combat
