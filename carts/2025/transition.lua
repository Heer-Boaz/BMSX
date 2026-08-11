local transition<const> = {}
require('globals')
local surface_component<const> = require('cartlib/component/surfacecomponent')
local gp0<const> = require('cartlib/gx/gp0')
local texture_residency<const> = require('texture_residency')
local story<const> = require('story')
local timeline<const> = require('cartlib/timeline/timeline')
local timelinebuilders<const> = require('timelinebuilders')
local apply_transition_frame<const> = timelinebuilders.apply_transition_frame
local build_transition_fade_in_frames<const> = timelinebuilders.build_transition_fade_in_frames
local build_fade_frames<const> = timelinebuilders.build_fade_frames
local background_binding_ids<const> = { 'background' }

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

	local build_transition_layout<const> = function(style, palette, layout)
		local w<const> = screen_width
		local h<const> = screen_height
		local swap_frame<const> = overgang_fade_out_frames - 1
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
				offset = transition_panel_gap_frames,
			},
			{
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

		local accent<const> = {
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
		self.background.surface_component.color = p3_white_color
		hide_transition_layers(self.transition_visual)
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
			self.text_main:clear_text()
			self.text_choice:clear_text()
			self.text_prompt:clear_text()
			self.text_transition:set_text({ node.label }, { typed = false, snap = true })
			reset_text_colors(self)
			local transition_text<const> = self.text_transition
			self.transition_center_x = transition_text.text_component.offset_x
			self.transition_target_bg = story[node.next].bg
			transition_text.text_component.offset_x = screen_width
			self.transition_needs_post_fade = false
			local next_node<const> = story[node.next]
			if not self.skip_transition_fade and self.transition_target_bg ~= nil then
				texture_residency.preload_background(self.transition_target_bg)
			end
			local style<const> = resolve_transition_style(node, next_node.kind)
			self.transition_style = style
			self.transition_palette = build_transition_palette(style)
			local layout<const> = {
				center_x = screen_width / 2,
				text_top = transition_text.dimensions.top,
				line_height = transition_text.text_component.line_height,
			}
			self.transition_panels, self.transition_accent = build_transition_layout(style, self.transition_palette, layout)
			local swap_frame<const> = overgang_fade_out_frames - 1
			local montage_end = transition_text_in_frames + transition_text_hold_frames + transition_text_out_frames - 1
			for i = 1, #self.transition_panels do
				local panel<const> = self.transition_panels[i]
				local panel_end<const> = panel.offset + transition_panel_in_frames + transition_panel_hold_frames + transition_panel_out_frames - 1
				if panel_end > montage_end then
					montage_end = panel_end
				end
			end
			local accent_end<const> = self.transition_accent.offset + transition_accent_in_frames + transition_accent_hold_frames + transition_accent_out_frames - 1
			if accent_end > montage_end then
				montage_end = accent_end
			end
			self.transition_montage_end_frame = montage_end
			local fade_in_start = math.max(swap_frame + 1, montage_end + 1)
			local max_fade_start<const> = overgang_frame_count - overgang_fade_in_frames
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
			show_background(self.background, nil)
			local overlay<const> = self.transition_visual.overlay
			local background<const> = self.background
			overlay.visible = true
			overlay.x = 0
			overlay.y = 0
			overlay.width = screen_width
			overlay.height = screen_height
			overlay.blend_mode = gp0.draw_mode_blend_subtract
			overlay.blend_color = 0
			overlay.color = 0
			for i = 1, #self.transition_panels do
				local panel<const> = self.transition_panels[i]
				local visual<const> = self.transition_visual.panels[i]
				visual.visible = true
				visual.x = panel.x_in
				visual.y = panel.y
				visual.width = panel.width
				visual.height = panel.height
				visual.color = 0
			end
			local accent<const> = self.transition_visual.accent
			accent.visible = true
			accent.x = self.transition_accent.x_in
			accent.y = self.transition_accent.y
			accent.width = self.transition_accent.width
			accent.height = self.transition_accent.height
			accent.color = 0
			if self.skip_transition_fade then
				apply_background(self.background, self.transition_target_bg)
				background.surface_component.color = p3_black_color
			else
				background.surface_component.color = p3_white_color
			end
			local w<const> = screen_width
			local target<const> = {
				bg = background,
				overlay = overlay,
				panels = self.transition_visual.panels,
				accent = accent,
				text = transition_text,
			}
			local transition_params<const> = {
				fade_out_frames = overgang_fade_out_frames,
				fade_in_frames = overgang_fade_in_frames,
				fade_in_start = self.transition_fade_in_start,
				skip_fade = self.skip_transition_fade,
				palette = self.transition_palette,
				panels = self.transition_panels,
				accent = self.transition_accent,
				center_x = self.transition_center_x,
					start_x = w,
					end_x = -w,
				}
				local tracks<const> = {}
				if self.transition_target_bg ~= nil then
					tracks[1] = {
						kind = 'value',
						interpolation = 'step',
						binding = 'background',
						apply = surface_component.set_imgid,
						keys = {
							{ frame = overgang_fade_out_frames - 1, value = self.transition_target_bg },
						},
					}
				end
				self.timelines:define(overgang_timeline_id, {
				frames = timeline.range(self.transition_finish_frame + 1),
				frame_duration = overgang_frame_duration,
				playback_mode = 'once',
				bindings = background_binding_ids,
				target = target,
				params = transition_params,
				apply = apply_transition_frame,
					tracks = tracks,
			})
			-- Keep the playhead at -1: the first scheduled tick must apply frame 0.
			-- Snapping here consumes that frame during state entry and shifts the authored cadence.
			self.timelines:play(overgang_timeline_id, {
				rewind = true,
				snap_to_start = false,
				bindings = { background = background.surface_component },
			})
		end,
		input_eval = 'first',
		input_event_handlers = {
			{
				pattern = 'b[jp]',
				go = function(self)
					self.timelines:seek_to_end(overgang_timeline_id)
					return finish_transition(self)
				end,
			},
		},
		on = {
			['timeline.end.' .. overgang_timeline_id] = {
				go = function(self)
					return finish_transition(self)
				end,
			},
		},
		leaving_state = function(self)
			self.timelines:stop(overgang_timeline_id)
			self.text_transition:clear_text()
			if self.transition_needs_post_fade or story[self.node_id].kind == 'combat' then
				hide_transition_layers(self.transition_visual)
				return
			end
			hide_transition_layers(self.transition_visual)
		end,
	}

	states.transition_fade_in = {
		entering_state = function(self)
			self.text_transition:clear_text()
			local background<const> = show_background(self.background, nil)
			hide_transition_layers(self.transition_visual)
			background.surface_component.color = p3_black_color
			local frames<const> = build_transition_fade_in_frames()
			self.timelines:define(overgang_post_fade_in_timeline_id, {
				frames = frames,
				frame_duration = overgang_frame_duration,
				playback_mode = 'once',
				target = background,
				apply = true,
			})
			self.timelines:play(overgang_post_fade_in_timeline_id, { rewind = true, snap_to_start = true })
		end,
		input_eval = 'first',
		input_event_handlers = {
			{
				pattern = 'b[jp]',
				go = function(self)
					self.timelines:seek_to_end(overgang_post_fade_in_timeline_id)
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
			self.timelines:stop(overgang_post_fade_in_timeline_id)
			self.background.surface_component.color = p3_white_color
			hide_transition_layers(self.transition_visual)
		end,
	}

	states.fade = {
		entering_state = function(self)
			local node<const> = story[self.node_id]
			clear_texts(self.texts)
			reset_text_colors(self)
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
			if self.fade_target_bg ~= nil then
				texture_residency.preload_background(self.fade_target_bg)
			end
			show_background(self.background, nil)
			hide_transition_layers(self.transition_visual)
			local overlay<const> = self.transition_visual.overlay
			local background<const> = self.background
			overlay.visible = true
			overlay.x = 0
			overlay.y = 0
			overlay.width = screen_width
			overlay.height = screen_height
			overlay.color = 0
			overlay.blend_mode = gp0.draw_mode_blend_subtract
			overlay.blend_color = 0
			background.surface_component.color = p3_white_color
			local target<const> = { bg = background, overlay = overlay }
			local frames<const> = build_fade_frames({
				hold_black = self.fade_hold_black,
				frame_count = next_kind == 'transition' and fade_out_frames or fade_frame_count,
			})
			local tracks<const> = {}
			if not self.fade_hold_black then
				tracks[1] = {
					kind = 'value',
					interpolation = 'step',
					binding = 'background',
					apply = surface_component.set_imgid,
					keys = {
						{ frame = fade_out_frames - 1, value = self.fade_target_bg },
					},
				}
			end
			self.timelines:define(fade_timeline_id, {
				frames = frames,
				frame_duration = fade_frame_duration,
				playback_mode = 'once',
				bindings = background_binding_ids,
				target = target,
				apply = true,
				tracks = tracks,
			})
			self.timelines:play(fade_timeline_id, {
				rewind = true,
				snap_to_start = true,
				bindings = { background = background.surface_component },
			})
		end,
		input_eval = 'first',
		input_event_handlers = {
			{
				pattern = 'b[jp]',
				go = function(self)
					self.timelines:seek_to_end(fade_timeline_id)
					return finish_fade(self)
				end,
			},
		},
		on = {
			['timeline.end.' .. fade_timeline_id] = {
				go = function(self)
					return finish_fade(self)
				end,
			},
		},
		leaving_state = function(self)
			self.timelines:stop(fade_timeline_id)
			hide_transition_layers(self.transition_visual)
			self.fade_hold_black = false
		end,
	}
end

return transition
