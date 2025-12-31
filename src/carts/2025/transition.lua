local transition = {}

function transition.register_states(states)

	states.transition = {
		timelines = {
			[overgang_timeline_id] = {
				create = function()
					return new_timeline_range({
						id = overgang_timeline_id,
						frame_count = overgang_frame_count,
						ticks_per_frame = overgang_ticks_per_frame,
						playback_mode = 'once',
					})
				end,
				autoplay = true,
				stop_on_exit = true,
				play_options = { rewind = true, snap_to_start = true },
			},
		},
		entering_state = function(self)
			local node = story[self.node_id]
			clear_text(text_main_id)
			clear_text(text_choice_id)
			clear_text(text_prompt_id)
			set_text_lines(text_transition_id, { node.label }, false)
			reset_text_colors()
			local transition_text = object(text_transition_id)
			self.transition_center_x = transition_text.centered_block_x
			self.transition_target_bg = story[node.next].bg
			transition_text.centered_block_x = display_width()
			local bg = object(bg_id)
			bg.visible = true
			local c = 1
			if self.skip_transition_fade then
				c = 0
			end
			bg.sprite_component.colorize = { r = c, g = c, b = c, a = 1 }
			if self.skip_transition_fade then
				apply_background(self.transition_target_bg)
			end
		end,
		on = {
			['timeline.frame.' .. overgang_timeline_id] = {
				go = function(self, _state, event)
					local frame_index = event.frame_index
					local bg = object(bg_id)
					if self.skip_transition_fade then
						bg.sprite_component.colorize = { r = 0, g = 0, b = 0, a = 1 }
					else
						if frame_index == (overgang_fade_out_frames - 1) then
							apply_background(self.transition_target_bg)
						end
						local fade_in_start = overgang_frame_count - overgang_fade_in_frames
						local node = story[self.node_id]
						if story[node.next].kind == 'combat' then
							fade_in_start = overgang_frame_count
						end
						local c = 1
						if frame_index < overgang_fade_out_frames then
							local u = frame_index / (overgang_fade_out_frames - 1)
							c = 1 - u
						elseif frame_index < fade_in_start then
							c = 0
						else
							local u = (frame_index - fade_in_start) / (overgang_fade_in_frames - 1)
							c = u
						end
						bg.sprite_component.colorize = { r = c, g = c, b = c, a = 1 }
					end
					local center_x = self.transition_center_x
					local start_x = display_width()
					local end_x = -display_width()
					local x = start_x
					if frame_index < overgang_in_frames then
						local u = frame_index / (overgang_in_frames - 1)
						x = start_x + (center_x - start_x) * u
					elseif frame_index < (overgang_in_frames + overgang_hold_frames) then
						x = center_x
					else
						local out_index = frame_index - (overgang_in_frames + overgang_hold_frames)
						local u = out_index / (overgang_out_frames - 1)
						x = center_x + (end_x - center_x) * u
					end
					local transition_text = object(text_transition_id)
					transition_text.centered_block_x = x
				end,
			},
			['timeline.end.' .. overgang_timeline_id] = {
				go = function(self)
					local node = story[self.node_id]
					local came_from_fade = self.skip_transition_fade
					self.node_id = node.next
					local next_kind = story[self.node_id].kind
					self.skip_transition_fade = false
					if next_kind == 'combat' then
						self.skip_combat_fade_in = true
					end
					if came_from_fade and next_kind ~= 'combat' then
						return '/transition_fade_in'
					end
					return '/run_node'
				end,
			},
		},
		leaving_state = function(self)
			clear_text(text_transition_id)
		end,
	}

	states.transition_fade_in = {
		timelines = {
			[overgang_post_fade_in_timeline_id] = {
				create = function()
					return new_timeline_range({
						id = overgang_post_fade_in_timeline_id,
						frame_count = overgang_fade_in_frames,
						ticks_per_frame = overgang_ticks_per_frame,
						playback_mode = 'once',
					})
				end,
				autoplay = true,
				stop_on_exit = true,
				play_options = { rewind = true, snap_to_start = true },
			},
		},
		entering_state = function(self)
			clear_text(text_transition_id)
			local bg = object(bg_id)
			bg.visible = true
			bg.sprite_component.colorize = { r = 0, g = 0, b = 0, a = 1 }
		end,
		on = {
			['timeline.frame.' .. overgang_post_fade_in_timeline_id] = {
				go = function(self, _state, event)
					local u = event.frame_index / (overgang_fade_in_frames - 1)
					local c = smoothstep(u)
					local bg = object(bg_id)
					bg.sprite_component.colorize = { r = c, g = c, b = c, a = 1 }
				end,
			},
			['timeline.end.' .. overgang_post_fade_in_timeline_id] = {
				go = function(self)
					local bg = object(bg_id)
					bg.sprite_component.colorize = { r = 1, g = 1, b = 1, a = 1 }
					return '/run_node'
				end,
			},
		},
		leaving_state = function(self)
			local bg = object(bg_id)
			bg.sprite_component.colorize = { r = 1, g = 1, b = 1, a = 1 }
		end,
	}

	states.fade = {
		timelines = {
			[fade_timeline_id] = {
				create = function()
					return new_timeline_range({
						id = fade_timeline_id,
						frame_count = fade_frame_count,
						ticks_per_frame = fade_ticks_per_frame,
						playback_mode = 'once',
					})
				end,
				autoplay = true,
				stop_on_exit = true,
				play_options = { rewind = true, snap_to_start = true },
			},
		},
		entering_state = function(self)
			local node = story[self.node_id]
			clear_texts(text_ids_all)
			reset_text_colors()
			local next_node = story[node.next]
			local next_kind = next_node.kind
			self.fade_hold_black = next_kind == 'transition' or next_kind == 'combat'
			if next_kind == 'transition' then
				self.fade_target_bg = story[next_node.next].bg
			else
				self.fade_target_bg = next_node.bg
			end
			local bg = object(bg_id)
			bg.visible = true
			bg.sprite_component.colorize = { r = 1, g = 1, b = 1, a = 1 }
		end,
		on = {
			['timeline.frame.' .. fade_timeline_id] = {
				go = function(self, _state, event)
					local frame_index = event.frame_index
					if frame_index == (fade_out_frames - 1) then
						apply_background(self.fade_target_bg)
					end
					local c = 1
					if frame_index < fade_out_frames then
						local u = frame_index / (fade_out_frames - 1)
						c = 1 - smoothstep(u)
					else
						if self.fade_hold_black then
							c = 0
						else
							local fade_in_start = fade_out_frames + fade_hold_frames
							if frame_index < fade_in_start then
								c = 0
							else
								local u = (frame_index - fade_in_start) / (fade_in_frames - 1)
								c = smoothstep(u)
							end
						end
					end
					local bg = object(bg_id)
					bg.sprite_component.colorize = { r = c, g = c, b = c, a = 1 }
				end,
			},
			['timeline.end.' .. fade_timeline_id] = {
				go = function(self)
					local node = story[self.node_id]
					self.node_id = node.next
					local next_kind = story[self.node_id].kind
					if next_kind == 'combat' then
						self.skip_combat_fade_in = true
					end
					if next_kind == 'transition' then
						self.skip_transition_fade = true
					end
					return '/run_node'
				end,
			},
		},
		leaving_state = function(self)
			local bg = object(bg_id)
			local c = 1
			if self.fade_hold_black then
				c = 0
			end
			bg.sprite_component.colorize = { r = c, g = c, b = c, a = 1 }
			self.fade_hold_black = false
		end,
	}
end

return transition
