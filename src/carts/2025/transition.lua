local transition<const> = {}
local globals<const> = require('globals')
local story<const> = require('story')
local timeline_builders<const> = require('timeline_builders')
local color<const> = require('bios/common/color')
local build_transition_frames<const> = timeline_builders.build_transition_frames
local build_transition_fade_in_frames<const> = timeline_builders.build_transition_fade_in_frames
local build_fade_frames<const> = timeline_builders.build_fade_frames

function transition.register_states(states)
	local fade_hold_black_kinds<const> = {
		transition = true,
		combat = true,
	}

	local resolve_transition_style<const> = function(node, target_kind)
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

	local build_transition_palette<const> = function(style)
		if style == 'combat' then
			return globals.p3_transition_palette_combat
		end
		if style == 'ending' then
			return globals.p3_transition_palette_ending
		end
		if style == 'choice' then
			return globals.p3_transition_palette_choice
		end
		return globals.p3_transition_palette_dialogue
	end

	local build_transition_layout<const> = function(style, palette, layout)
		local w<const> = machine_manifest.render_size.width
		local h<const> = machine_manifest.render_size.height
		local swap_frame<const> = globals.overgang_fade_out_frames - 1
		local center_x<const> = layout.center_x
		local text_top<const> = layout.text_top
		local line_height<const> = layout.line_height
		local accent_height<const> = line_height * 1.1
		local accent_y<const> = text_top + (line_height - accent_height) * 0.5

		local panel1_width<const> = w * 1.15
		local panel2_width<const> = w * 1.3
		local panel3_width<const> = w * 0.55
		local panels<const> = {
			{
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
				color = palette.panel_secondary,
				width = panel2_width,
				height = h * 0.2,
				y = h * 0.42,
				x_in = w,
				x_hold = center_x - (panel2_width / 2),
				x_out = -w * 1.3,
				offset = globals.transition_panel_gap_frames,
			},
			{
				color = palette.panel_primary,
				width = panel3_width,
				height = h * 0.14,
				y = h * 0.68,
				x_in = -w * 0.55,
				x_hold = center_x - (panel3_width / 2),
				x_out = w * 1.1,
				offset = swap_frame - globals.transition_panel_in_frames,
			},
		}

		local accent<const> = {
			color = palette.accent,
			width = w * 0.7,
			height = accent_height,
			y = accent_y,
			x_in = w,
			x_hold = center_x - (w * 0.35),
			x_out = -w * 0.3,
			offset = swap_frame - globals.transition_accent_in_frames,
		}

		return panels, accent
	end

	local finish_transition<const> = function(self)
		local node<const> = story[self.node_id]
		local came_from_fade<const> = self.skip_transition_fade
		self.node_id = node.next
		local next_kind<const> = story[self.node_id].kind
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

	local finish_transition_fade_in<const> = function(self)
		globals.hide_transition_layers()
		return '/run_node'
	end

	local finish_fade<const> = function(self)
		local node<const> = story[self.node_id]
		self.node_id = node.next
		local next_kind<const> = story[self.node_id].kind
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
			local node<const> = story[self.node_id]
			oget(globals.text_main_id):clear_text()
			oget(globals.text_choice_id):clear_text()
			oget(globals.text_prompt_id):clear_text()
			oget(globals.text_transition_id):set_text({ node.label }, { typed = false, snap = true })
			globals.reset_text_colors()
			local transition_text<const> = oget(globals.text_transition_id)
			self.transition_center_x = transition_text.centered_block_x
			self.transition_target_bg = story[node.next].bg
			transition_text.centered_block_x = machine_manifest.render_size.width
			self.transition_needs_post_fade = false
			local next_node<const> = story[node.next]
			local style<const> = resolve_transition_style(node, next_node.kind)
			self.transition_style = style
			self.transition_palette = build_transition_palette(style)
			local layout<const> = {
				center_x = machine_manifest.render_size.width / 2,
				text_top = transition_text.dimensions.top,
				line_height = transition_text.line_height,
			}
			self.transition_panels, self.transition_accent = build_transition_layout(style, self.transition_palette, layout)
			local swap_frame<const> = globals.overgang_fade_out_frames - 1
			local montage_end = globals.transition_text_in_frames + globals.transition_text_hold_frames + globals.transition_text_out_frames - 1
			for i = 1, #self.transition_panels do
				local panel<const> = self.transition_panels[i]
				local panel_end<const> = panel.offset + globals.transition_panel_in_frames + globals.transition_panel_hold_frames + globals.transition_panel_out_frames - 1
				if panel_end > montage_end then
					montage_end = panel_end
				end
			end
			local accent_end<const> = self.transition_accent.offset + globals.transition_accent_in_frames + globals.transition_accent_hold_frames + globals.transition_accent_out_frames - 1
			if accent_end > montage_end then
				montage_end = accent_end
			end
			self.transition_montage_end_frame = montage_end
			local fade_in_start = math.max(swap_frame + 1, montage_end + 1)
			local max_fade_start<const> = globals.overgang_frame_count - globals.overgang_fade_in_frames
			if fade_in_start > max_fade_start then
				fade_in_start = max_fade_start
			end
			if next_node.kind == 'combat' then
				fade_in_start = globals.overgang_frame_count
			end
			self.transition_fade_in_start = fade_in_start
			local finish_frame = montage_end
			if not self.skip_transition_fade and fade_in_start < globals.overgang_frame_count then
				finish_frame = fade_in_start + globals.overgang_fade_in_frames - 1
			end
			if finish_frame > (globals.overgang_frame_count - 1) then
				finish_frame = globals.overgang_frame_count - 1
			end
			self.transition_finish_frame = finish_frame
			globals.show_background(nil)
			local overlay<const> = self.transition_visual.overlay
			local base<const> = self.transition_palette.overlay
			local start_alpha = 0
			if self.skip_transition_fade then
				start_alpha = 1
			end
			overlay.visible = true
			overlay.x = 0
			overlay.y = 0
			overlay.width = machine_manifest.render_size.width
			overlay.height = machine_manifest.render_size.height
			overlay.color = color.with_alpha(base, start_alpha)
			for i = 1, #self.transition_panels do
				local panel<const> = self.transition_panels[i]
				local visual<const> = self.transition_visual.panels[i]
				visual.visible = true
				visual.x = panel.x_in
				visual.y = panel.y
				visual.width = panel.width
				visual.height = panel.height
				visual.color = color.with_alpha(panel.color, 0)
			end
			local accent<const> = self.transition_visual.accent
			accent.visible = true
			accent.x = self.transition_accent.x_in
			accent.y = self.transition_accent.y
			accent.width = self.transition_accent.width
			accent.height = self.transition_accent.height
			accent.color = color.with_alpha(self.transition_accent.color, 0)
			if self.skip_transition_fade then
				globals.apply_background(self.transition_target_bg)
			end
			local w<const> = machine_manifest.render_size.width
			local target<const> = {
				overlay = overlay,
				panels = self.transition_visual.panels,
				accent = accent,
				text = transition_text,
			}
			local frames<const> = build_transition_frames({
				fade_out_frames = globals.overgang_fade_out_frames,
				fade_in_frames = globals.overgang_fade_in_frames,
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
				id = globals.overgang_timeline_id,
				frames = frames,
				ticks_per_frame = globals.overgang_ticks_per_frame,
				playback_mode = 'once',
				target = target,
				apply = true,
				markers = {
					{ frame = globals.overgang_fade_out_frames - 1, event = 'transition.swap_bg' },
				},
			}))
			self:play_timeline(globals.overgang_timeline_id, { rewind = true, snap_to_start = true })
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
					globals.apply_background(self.transition_target_bg)
				end,
			},
			['timeline.end.' .. globals.overgang_timeline_id] = {
				go = function(self)
					return finish_transition(self)
				end,
			},
		},
		leaving_state = function(self)
			self:stop_timeline(globals.overgang_timeline_id)
			oget(globals.text_transition_id):clear_text()
			if self.transition_needs_post_fade or story[self.node_id].kind == 'combat' then
				globals.hide_transition_layers()
				return
			end
			globals.hide_transition_layers()
		end,
	}

	states.transition_fade_in = {
		entering_state = function(self)
			oget(globals.text_transition_id):clear_text()
			globals.show_background(nil)
			globals.hide_transition_layers()
			local overlay<const> = self.transition_visual.overlay
			local base<const> = self.transition_palette.overlay
			overlay.visible = true
			overlay.x = 0
			overlay.y = 0
			overlay.width = machine_manifest.render_size.width
			overlay.height = machine_manifest.render_size.height
			overlay.color = base
			local target<const> = { overlay = overlay }
			local frames<const> = build_transition_fade_in_frames(self.transition_palette)
			self:define_timeline(timeline.new({
				id = globals.overgang_post_fade_in_timeline_id,
				frames = frames,
				ticks_per_frame = globals.overgang_ticks_per_frame,
				playback_mode = 'once',
				target = target,
				apply = true,
			}))
			self:play_timeline(globals.overgang_post_fade_in_timeline_id, { rewind = true, snap_to_start = true })
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
			['timeline.end.' .. globals.overgang_post_fade_in_timeline_id] = {
				go = function(self)
					return finish_transition_fade_in(self)
				end,
			},
		},
		leaving_state = function(self)
			self:stop_timeline(globals.overgang_post_fade_in_timeline_id)
			globals.hide_transition_layers()
		end,
	}

	states.fade = {
		entering_state = function(self)
			local node<const> = story[self.node_id]
			globals.clear_texts(globals.text_ids_all)
			globals.reset_text_colors()
			local next_node<const> = story[node.next]
			local next_kind<const> = next_node.kind
			self.fade_hold_black = fade_hold_black_kinds[next_kind]
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
			globals.show_background(nil)
			globals.hide_transition_layers()
			local overlay<const> = self.transition_visual.overlay
			local base<const> = self.fade_palette.overlay
			overlay.visible = true
			overlay.x = 0
			overlay.y = 0
			overlay.width = machine_manifest.render_size.width
			overlay.height = machine_manifest.render_size.height
			overlay.color = color.with_alpha(base, 0)
			local target<const> = { overlay = overlay }
			local frames<const> = build_fade_frames({
				palette = self.fade_palette,
				hold_black = self.fade_hold_black,
			})
			self:define_timeline(timeline.new({
				id = globals.fade_timeline_id,
				frames = frames,
				ticks_per_frame = globals.fade_ticks_per_frame,
				playback_mode = 'once',
				target = target,
				apply = true,
				markers = {
					{ frame = globals.fade_out_frames - 1, event = 'fade.swap_bg' },
				},
			}))
			self:play_timeline(globals.fade_timeline_id, { rewind = true, snap_to_start = true })
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
					globals.apply_background(self.fade_target_bg)
				end,
			},
			['timeline.end.' .. globals.fade_timeline_id] = {
				go = function(self)
					return finish_fade(self)
				end,
			},
		},
		leaving_state = function(self)
			self:stop_timeline(globals.fade_timeline_id)
			if self.fade_hold_black then
				local base<const> = self.fade_palette.overlay
				local overlay<const> = self.transition_visual.overlay
				overlay.visible = true
				overlay.x = 0
				overlay.y = 0
				overlay.width = machine_manifest.render_size.width
				overlay.height = machine_manifest.render_size.height
				overlay.color = base
				globals.hide_transition_layers()
			else
				globals.hide_transition_layers()
			end
			self.fade_hold_black = false
		end,
	}
end

return transition
