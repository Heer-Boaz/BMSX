local transition = {}
local timeline_builders = require('timeline_builders.lua')
local build_transition_frames = timeline_builders.build_transition_frames
local build_transition_fade_in_frames = timeline_builders.build_transition_fade_in_frames
local build_fade_frames = timeline_builders.build_fade_frames

function transition.register_states(states)

	local function resolve_transition_style(node, target_kind)
		if node.transition_style then
			return node.transition_style
		end
		if target_kind == 'combat' then
			return 'combat'
		end
		if target_kind == 'ending' then
			return 'ending'
		end
		if target_kind == 'choice' then
			return 'choice'
		end
		return 'dialogue'
	end

	local function build_transition_palette(style)
		if style == 'combat' then
			return p3_transition_palette_combat
		end
		if style == 'ending' then
			return p3_transition_palette_ending
		end
		if style == 'choice' then
			return p3_transition_palette_choice
		end
		return p3_transition_palette_dialogue
	end

		local function setup_overlay()
			local overlay = object(transition_overlay_id)
			overlay.visible = true
			overlay:set_image('whitepixel')
			overlay.x = 0
			overlay.y = 0
			overlay.sprite_component.scale = { x = display_width(), y = display_height() }
			return overlay
		end

	local function hide_transition_panels()
		for i = 1, #transition_panel_ids do
			local panel = object(transition_panel_ids[i])
			panel.visible = false
			panel.sprite_component.colorize = { r = 0, g = 0, b = 0, a = 0 }
		end
		local accent = object(transition_accent_id)
		accent.visible = false
		accent.sprite_component.colorize = { r = 0, g = 0, b = 0, a = 0 }
	end

	local function build_transition_layout(style, palette, layout)
		local w = display_width()
		local h = display_height()
		local swap_frame = overgang_fade_out_frames - 1
		local center_x = layout.center_x
		local text_top = layout.text_top
		local line_height = layout.line_height
		local accent_height = line_height * 1.1
		local accent_y = text_top + (line_height - accent_height) * 0.5

		local panel1_width = w * 1.15
		local panel2_width = w * 1.3
		local panel3_width = w * 0.55
		local panels = {
			{
				id = transition_panel_ids[1],
				color = palette.panel_primary,
				width = panel1_width,
				height = h * 0.22,
				y = h * 0.12,
				x_in = -w * 1.2,
				x_hold = center_x - (panel1_width / 2),
				x_out = w,
				offset = 0,
			},
			{
				id = transition_panel_ids[2],
				color = palette.panel_secondary,
				width = panel2_width,
				height = h * 0.2,
				y = h * 0.42,
				x_in = w,
				x_hold = center_x - (panel2_width / 2),
				x_out = -w * 1.3,
				offset = transition_panel_gap_frames,
			},
			{
				id = transition_panel_ids[3],
				color = palette.panel_primary,
				width = panel3_width,
				height = h * 0.14,
				y = h * 0.68,
				x_in = -w * 0.55,
				x_hold = center_x - (panel3_width / 2),
				x_out = w * 1.1,
				offset = swap_frame - transition_panel_in_frames,
			},
		}

		local accent = {
			id = transition_accent_id,
			color = palette.accent,
			width = w * 0.7,
			height = accent_height,
			y = accent_y,
			x_in = w,
			x_hold = center_x - (w * 0.35),
			x_out = -w * 0.3,
			offset = swap_frame - transition_accent_in_frames,
		}

		return panels, accent
	end

		local function configure_panel(panel)
			local sprite = object(panel.id)
			sprite.visible = true
			sprite:set_image('whitepixel')
			sprite.x = panel.x_in
			sprite.y = panel.y
			sprite.sprite_component.scale = { x = panel.width, y = panel.height }
		end

	local function finish_transition(self)
		local node = story[self.node_id]
		local came_from_fade = self.skip_transition_fade
		self.node_id = node.next
		local next_kind = story[self.node_id].kind
		self.skip_transition_fade = false
		self.transition_needs_post_fade = came_from_fade and next_kind ~= 'combat'
		if next_kind == 'combat' then
			self.skip_combat_fade_in = true
		end
		if self.transition_needs_post_fade then
			return '/transition_fade_in'
		end
		return '/run_node'
	end

	local function finish_transition_fade_in(self)
		hide_transition_layers()
		return '/run_node'
	end

	local function finish_fade(self)
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
	end

	states.transition = {
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
			self.transition_needs_post_fade = false
			local next_node = story[node.next]
			local style = resolve_transition_style(node, next_node.kind)
			self.transition_style = style
			self.transition_palette = build_transition_palette(style)
			local layout = {
				center_x = display_width() / 2,
				text_top = transition_text.dimensions.top,
				line_height = transition_text.line_height,
			}
			self.transition_panels, self.transition_accent = build_transition_layout(style, self.transition_palette, layout)
			local swap_frame = overgang_fade_out_frames - 1
			local montage_end = transition_text_in_frames + transition_text_hold_frames + transition_text_out_frames - 1
			for i = 1, #self.transition_panels do
				local panel = self.transition_panels[i]
				local panel_end = panel.offset + transition_panel_in_frames + transition_panel_hold_frames + transition_panel_out_frames - 1
				if panel_end > montage_end then
					montage_end = panel_end
				end
			end
			local accent_end = self.transition_accent.offset + transition_accent_in_frames + transition_accent_hold_frames + transition_accent_out_frames - 1
			if accent_end > montage_end then
				montage_end = accent_end
			end
			self.transition_montage_end_frame = montage_end
			local fade_in_start = math.max(swap_frame + 1, montage_end + 1)
			local max_fade_start = overgang_frame_count - overgang_fade_in_frames
			if fade_in_start > max_fade_start then
				fade_in_start = max_fade_start
			end
			if next_node.kind == 'combat' then
				fade_in_start = overgang_frame_count
			end
			self.transition_fade_in_start = fade_in_start
			local finish_frame = montage_end
			if not self.skip_transition_fade and fade_in_start < overgang_frame_count then
				finish_frame = fade_in_start + overgang_fade_in_frames - 1
			end
			if finish_frame > (overgang_frame_count - 1) then
				finish_frame = overgang_frame_count - 1
			end
			self.transition_finish_frame = finish_frame
			local bg = object(bg_id)
			bg.visible = true
			bg.sprite_component.colorize = { r = 1, g = 1, b = 1, a = 1 }
			local overlay = setup_overlay()
			local base = self.transition_palette.overlay
			local start_alpha = 0
			if self.skip_transition_fade then
				start_alpha = 1
			end
			overlay.sprite_component.colorize = { r = base.r, g = base.g, b = base.b, a = start_alpha }
			for i = 1, #self.transition_panels do
				local panel = self.transition_panels[i]
				configure_panel(panel)
				local sprite = object(panel.id)
				sprite.sprite_component.colorize = { r = panel.color.r, g = panel.color.g, b = panel.color.b, a = 0 }
			end
			configure_panel(self.transition_accent)
			local accent = object(self.transition_accent.id)
			accent.sprite_component.colorize = { r = self.transition_accent.color.r, g = self.transition_accent.color.g, b = self.transition_accent.color.b, a = 0 }
			if self.skip_transition_fade then
				apply_background(self.transition_target_bg)
			end
			local w = display_width()
			local target = {
				overlay = overlay,
				panels = {},
				accent = accent,
				text = transition_text,
			}
			for i = 1, #transition_panel_ids do
				target.panels[i] = object(transition_panel_ids[i])
			end
			local frames = build_transition_frames({
				fade_out_frames = overgang_fade_out_frames,
				fade_in_frames = overgang_fade_in_frames,
				fade_in_start = self.transition_fade_in_start,
				finish_frame = self.transition_finish_frame,
				skip_fade = self.skip_transition_fade,
				palette = self.transition_palette,
				panels = self.transition_panels,
				accent = self.transition_accent,
				center_x = self.transition_center_x,
				start_x = w,
				end_x = -w,
			})
			self:define_timeline(timeline.new({
				id = overgang_timeline_id,
				frames = frames,
				ticks_per_frame = overgang_ticks_per_frame,
				playback_mode = 'once',
				target = target,
				apply = true,
				markers = {
					{ frame = overgang_fade_out_frames - 1, event = 'transition.swap_bg' },
				},
			}))
			self:play_timeline(overgang_timeline_id, { rewind = true, snap_to_start = true })
		end,
		input_eval = 'first',
		input_event_handlers = {
			['b[jp]'] = {
				go = function(self)
					return finish_transition(self)
				end,
			},
		},
		on = {
			['transition.swap_bg'] = {
				go = function(self)
					if self.skip_transition_fade then
						return
					end
					apply_background(self.transition_target_bg)
				end,
			},
			['timeline.end.' .. overgang_timeline_id] = {
				go = function(self)
					return finish_transition(self)
				end,
			},
		},
		leaving_state = function(self)
			self:stop_timeline(overgang_timeline_id)
			clear_text(text_transition_id)
			if self.transition_needs_post_fade or story[self.node_id].kind == 'combat' then
				hide_transition_panels()
				return
			end
			hide_transition_layers()
		end,
	}

	states.transition_fade_in = {
		entering_state = function(self)
			clear_text(text_transition_id)
			local bg = object(bg_id)
			bg.visible = true
			bg.sprite_component.colorize = { r = 1, g = 1, b = 1, a = 1 }
			hide_transition_panels()
			local overlay = setup_overlay()
			local base = self.transition_palette.overlay
			overlay.sprite_component.colorize = { r = base.r, g = base.g, b = base.b, a = 1 }
			local target = { overlay = overlay }
			local frames = build_transition_fade_in_frames(self.transition_palette)
			self:define_timeline(timeline.new({
				id = overgang_post_fade_in_timeline_id,
				frames = frames,
				ticks_per_frame = overgang_ticks_per_frame,
				playback_mode = 'once',
				target = target,
				apply = true,
			}))
			self:play_timeline(overgang_post_fade_in_timeline_id, { rewind = true, snap_to_start = true })
		end,
		input_eval = 'first',
		input_event_handlers = {
			['b[jp]'] = {
				go = function(self)
					return finish_transition_fade_in(self)
				end,
			},
		},
		on = {
			['timeline.end.' .. overgang_post_fade_in_timeline_id] = {
				go = function(self)
					return finish_transition_fade_in(self)
				end,
			},
		},
		leaving_state = function(self)
			self:stop_timeline(overgang_post_fade_in_timeline_id)
			hide_transition_layers()
		end,
	}

	states.fade = {
		entering_state = function(self)
			local node = story[self.node_id]
			clear_texts(text_ids_all)
			reset_text_colors()
			local next_node = story[node.next]
			local next_kind = next_node.kind
			self.fade_hold_black = next_kind == 'transition' or next_kind == 'combat'
			local target_kind = next_kind
			if next_kind == 'transition' then
				target_kind = story[next_node.next].kind
			end
			self.fade_style = resolve_transition_style(next_node, target_kind)
			self.fade_palette = build_transition_palette(self.fade_style)
			if next_kind == 'transition' then
				self.fade_target_bg = story[next_node.next].bg
			else
				self.fade_target_bg = next_node.bg
			end
			local bg = object(bg_id)
			bg.visible = true
			bg.sprite_component.colorize = { r = 1, g = 1, b = 1, a = 1 }
			hide_transition_panels()
			local overlay = setup_overlay()
			local base = self.fade_palette.overlay
			overlay.sprite_component.colorize = { r = base.r, g = base.g, b = base.b, a = 0 }
			local target = { overlay = overlay }
			local frames = build_fade_frames({
				palette = self.fade_palette,
				hold_black = self.fade_hold_black,
			})
			self:define_timeline(timeline.new({
				id = fade_timeline_id,
				frames = frames,
				ticks_per_frame = fade_ticks_per_frame,
				playback_mode = 'once',
				target = target,
				apply = true,
				markers = {
					{ frame = fade_out_frames - 1, event = 'fade.swap_bg' },
				},
			}))
			self:play_timeline(fade_timeline_id, { rewind = true, snap_to_start = true })
		end,
		input_eval = 'first',
		input_event_handlers = {
			['b[jp]'] = {
				go = function(self)
					return finish_fade(self)
				end,
			},
		},
		on = {
			['fade.swap_bg'] = {
				go = function(self)
					apply_background(self.fade_target_bg)
				end,
			},
			['timeline.end.' .. fade_timeline_id] = {
				go = function(self)
					return finish_fade(self)
				end,
			},
		},
		leaving_state = function(self)
			self:stop_timeline(fade_timeline_id)
			if self.fade_hold_black then
				local base = self.fade_palette.overlay
				local overlay = object(transition_overlay_id)
				overlay.visible = true
				overlay.sprite_component.colorize = { r = base.r, g = base.g, b = base.b, a = 1 }
				hide_transition_panels()
			else
				hide_transition_layers()
			end
			self.fade_hold_black = false
		end,
	}
end

return transition
