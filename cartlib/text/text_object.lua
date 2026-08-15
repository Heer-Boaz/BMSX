-- text_object.lua
-- Text object with typewriter effect for carts.

local world_object<const> = require('cartlib/world/world_object')
local text_component<const> = require('cartlib/text/text_component')
local timeline_component<const> = require('cartlib/timeline/timeline_component')
local fsm_component<const> = require('cartlib/fsm/fsm_component')
local fsm_library<const> = require('cartlib/fsm/library')
local wrap_text_lines<const> = require('cartlib/util/text').wrap_text_lines
local gp0<const> = require('cartlib/gx/gp0')
local font_module<const> = require('cartlib/font')
local smoothstep<const> = require('cartlib/easing').smoothstep

local text_object<const> = {}
text_object.__index = text_object
setmetatable(text_object, { __index = world_object })

local text_object_component<const> = {}
text_object_component.__index = text_object_component
setmetatable(text_object_component, { __index = text_component })

function text_object_component.new(opts)
	return setmetatable(text_component.new(opts), text_object_component)
end

function text_object_component:render(draw, x, y)
	local owner<const> = self.parent
	owner:submit_highlight(draw)
	if self.background_color ~= nil then
		-- Text objects retain their wrapped, left-aligned background line view
		-- at layout, typing and highlight mutations. The command batch consumes
		-- that view without rediscovering logical-line state during presentation.
		draw:horizontal_rect_span(
			owner._background_line_indices,
			owner._background_line_count,
			owner.wrapped_line_y_offsets,
			self.line_widths,
			x,
			y,
			self.font.line_height,
			self.background_color)
	end
	owner:submit_text_glyph_lines(draw, x, y)
end

function text_object_component:set_font(font)
	self.parent:set_font(font)
end

local highlight_move_timeline_id<const> = 'hmove'
local highlight_vibe_timeline_id<const> = 'hvibe'
local highlight_vibe_play_options<const> = {
	rewind = true,
	snap_to_start = true,
}
local text_object_fsm_id<const> = 'text_object'
local text_object_machine_ids<const> = { text_object_fsm_id }
local text_object_state_idle<const> = 'idle'
local text_object_state_typing<const> = 'typing'
local typing_command_start<const> = 'type.start'
local typing_command_step<const> = 'type.step'
local typing_command_reveal<const> = 'type.reveal'
local empty_text<const> = {}
local immediate_text_opts<const> = { typed = false, snap = true }
local highlight_move_in_frames<const> = 6
local highlight_move_settle_frames<const> = 3
local highlight_move_overshoot<const> = 0.12
local highlight_move_frame_duration<const> = 12
local state_tags<const> = {
	variant = {
		idle = 'v.i',
		typing = 'v.t',
	},
	group = {
		typing = 'g.t',
	},
}

local append_wrapped_logical_line<const> = function(wrapped_lines, wrapped_line_to_logical_line, logical_line_index, line, max_chars)
	if string.len(line) == 0 then
		wrapped_lines[#wrapped_lines + 1] = ''
		wrapped_line_to_logical_line[#wrapped_line_to_logical_line + 1] = logical_line_index
		return
	end
	local line_chunks<const> = wrap_text_lines(line, max_chars)
	for i = 1, #line_chunks do
		wrapped_lines[#wrapped_lines + 1] = line_chunks[i]
		wrapped_line_to_logical_line[#wrapped_line_to_logical_line + 1] = logical_line_index
	end
end

local build_wrapped_lines<const> = function(text_or_lines, max_chars)
	local wrapped_lines<const> = {}
	local wrapped_line_to_logical_line<const> = {}
	if type(text_or_lines) == 'string' then
		local line_start = 1
		local logical_line_index = 1
		local text_length<const> = string.len(text_or_lines)
		if text_length == 0 then
			wrapped_lines[1] = ''
			wrapped_line_to_logical_line[1] = 1
			return wrapped_lines, wrapped_line_to_logical_line
		end
		while true do
			local newline_index<const> = string.find(text_or_lines, '\n', line_start, true)
			if newline_index == nil then
				append_wrapped_logical_line(
					wrapped_lines,
					wrapped_line_to_logical_line,
					logical_line_index,
					string.sub(text_or_lines, line_start, text_length),
					max_chars
				)
				break
			end
			append_wrapped_logical_line(
				wrapped_lines,
				wrapped_line_to_logical_line,
				logical_line_index,
				string.sub(text_or_lines, line_start, newline_index - 1),
				max_chars
			)
			logical_line_index = logical_line_index + 1
			line_start = newline_index + 1
			if line_start > text_length then
				append_wrapped_logical_line(wrapped_lines, wrapped_line_to_logical_line, logical_line_index, '', max_chars)
				break
			end
		end
		return wrapped_lines, wrapped_line_to_logical_line
	end
	if #text_or_lines == 0 then
		wrapped_lines[1] = ''
		wrapped_line_to_logical_line[1] = 1
		return wrapped_lines, wrapped_line_to_logical_line
	end
	for logical_line_index = 1, #text_or_lines do
		append_wrapped_logical_line(
			wrapped_lines,
			wrapped_line_to_logical_line,
			logical_line_index,
			text_or_lines[logical_line_index],
			max_chars
		)
	end
	return wrapped_lines, wrapped_line_to_logical_line
end

local build_highlight_move_frames<const> = function(params)
	local frames<const> = {}
	local from_y<const> = params.from_y
	local to_y<const> = params.to_y
	local from_h<const> = params.from_h
	local to_h<const> = params.to_h
	local overshoot_y<const> = to_y + ((to_y - from_y) * highlight_move_overshoot)
	local overshoot_h<const> = to_h + ((to_h - from_h) * highlight_move_overshoot)
	for i = 0, highlight_move_in_frames - 1 do
		local u<const> = i / (highlight_move_in_frames - 1)
		local eased<const> = smoothstep(u)
		frames[#frames + 1] = {
			highlight_anim_y = from_y + ((overshoot_y - from_y) * eased),
			highlight_anim_h = from_h + ((overshoot_h - from_h) * eased),
		}
	end
	for i = 0, highlight_move_settle_frames - 1 do
		local u<const> = i / (highlight_move_settle_frames - 1)
		local eased<const> = smoothstep(u)
		frames[#frames + 1] = {
			highlight_anim_y = overshoot_y + ((to_y - overshoot_y) * eased),
			highlight_anim_h = overshoot_h + ((to_h - overshoot_h) * eased),
		}
	end
	return frames
end

local line_advance<const> = function(font, blank_lines)
	return font.line_height * (blank_lines + 1)
end

local build_wrapped_line_y_offsets<const> = function(font, blank_lines, wrapped_line_to_logical_line)
	local wrapped_line_y_offsets<const> = {}
	if #wrapped_line_to_logical_line == 0 then
		return wrapped_line_y_offsets
	end
	local cursor_y = 0
	wrapped_line_y_offsets[1] = 0
	for i = 2, #wrapped_line_to_logical_line do
		cursor_y = cursor_y + font.line_height
		if wrapped_line_to_logical_line[i] ~= wrapped_line_to_logical_line[i - 1] then
			cursor_y = cursor_y + (font.line_height * blank_lines)
		end
		wrapped_line_y_offsets[i] = cursor_y
	end
	return wrapped_line_y_offsets
end

local write_glyph_lines<const> = function(font, lines, glyph_lines, widths)
	for i = 1, #lines do
		local glyphs = glyph_lines[i]
		if glyphs == nil then
			glyphs = {}
			glyph_lines[i] = glyphs
		end
		widths[i] = font_module.write_glyph_line(font, lines[i], glyphs)
	end
end

fsm_library.register(text_object_fsm_id, {
	initial = text_object_state_idle,
	tag_derivations = {
		[state_tags.group.typing] = { state_tags.variant.typing },
	},
	timelines = {
		[highlight_move_timeline_id] = {
			def = {
				frames = build_highlight_move_frames,
				frame_duration = highlight_move_frame_duration,
				playback_mode = 'once',
				apply = true,
			},
			autoplay = false,
		},
		[highlight_vibe_timeline_id] = {
			def = {
				playback_mode = 'loop',
				tracks = {
					{
						kind = 'wave',
						path = { 'highlight_vibe_scale' },
						base = 1,
						amp = 0.12,
						period = 0.9,
						phase = 0.12,
						wave = 'pingpong',
						ease = smoothstep,
					},
					{
						kind = 'wave',
						path = { 'highlight_vibe_offset_x' },
						base = 0,
						amp = 0.6,
						period = 0.35,
						phase = 0.4,
						wave = 'sin',
					},
					{
						kind = 'wave',
						path = { 'highlight_vibe_offset_y' },
						base = 0,
						amp = 0.5,
						period = 0.4,
						phase = 0.08,
						wave = 'sin',
					},
				},
			},
			autoplay = false,
		},
	},
	on = {
		[typing_command_start] = '/' .. text_object_state_typing,
		[typing_command_reveal] = function(self, state)
			self:apply_full_text()
			if state.current_id ~= text_object_state_idle then
				return '/' .. text_object_state_idle
			end
		end,
	},
	states = {
		[text_object_state_idle] = {
			tags = { state_tags.variant.idle },
		},
		[text_object_state_typing] = {
			tags = { state_tags.variant.typing },
			on = {
				[typing_command_step] = function(self)
					if self:advance_typing() then
						self:finish_typing()
						return '/' .. text_object_state_idle
					end
				end,
			},
		},
	},
})

function text_object.initialize(self)
	world_object.initialize(self)
	self:add_component(timeline_component.new({ parent = self }))
	self:add_component(fsm_component.new({ parent = self }, text_object_machine_ids))
	self.is_text_object = true
	if self.text == nil then
		self.text = { '' }
	end
	self.full_text_lines = { '' }
	self.full_text_line_widths = { 0 }
	self.full_glyph_lines = {}
	self._background_line_indices = {}
	self._background_line_count = 0
	self._has_visible_glyphs = false
	self.current_line_index = 0
	self.current_char_index = 0
	self.maximum_characters_per_line = 0
	self.highlighted_line_index = nil
	self.highlight_anim_y = nil
	self.highlight_anim_h = nil
	self.highlight_target_y = nil
	self.highlight_target_h = nil
	self.highlight_last_line_index = nil
	if self.highlight_move_enabled == nil then
		self.highlight_move_enabled = false
	end
	if self.highlight_pulse_enabled == nil then
		self.highlight_pulse_enabled = false
	end
	if self.highlight_jitter_enabled == nil then
		self.highlight_jitter_enabled = false
	end
	self.highlight_vibe_scale = 1
	self.highlight_vibe_offset_x = 0
	self.highlight_vibe_offset_y = 0
	self.wrapped_line_to_logical_line = {}
	self.wrapped_line_y_offsets = { 0 }
	self.highlight_bg_color = self.highlight_bg_color or 0xff000080
	local font<const> = self.font or font_module.get('default')
	local dimensions<const> = self.dimensions
	self.dimensions = dimensions
	self.char_width_uses_font = self.char_width == nil
	self.char_width = self.char_width or font.items[0x61].width
	self.blank_lines = self.blank_lines or 0
	local line_height<const> = line_advance(font, self.blank_lines)
	self.text_component = text_object_component.new({
		text = nil,
		font = font,
		line_height = line_height,
		line_offsets = self.wrapped_line_y_offsets,
		color = self.text_color or 0xffffffff,
		background_color = self.normal_bg_color or 0xff000000,
		offset_y = self.dimensions.top,
		offset_z = 1,
	})
	self.displayed_line_widths = self.text_component.layout_line_widths
	self.text_component.line_widths = self.displayed_line_widths
	self:add_component(self.text_component)
	self:set_dimensions(self.dimensions)
end

-- The attached component remains addressable while the text object admits it
-- to active render views only when glyphs or highlight geometry can emit work.
local update_text_component_admission<const> = function(self)
	self.text_component:set_enabled(
		self._has_visible_glyphs or self.highlight_anim_y ~= nil)
end

local rebuild_background_line_view<const> = function(self)
	local indices<const> = self._background_line_indices
	local lines<const> = self.text_component.glyph_lines
	local highlighted_logical_line<const> = self.highlighted_line_index
	local skip_logical_line<const> = highlighted_logical_line ~= nil and (highlighted_logical_line + 1) or 0
	local wrapped_line_to_logical_line<const> = self.wrapped_line_to_logical_line
	local count = 0
	for line_index = 1, self.text_component.glyph_line_count do
		if lines[line_index].visible_count > 0
		and wrapped_line_to_logical_line[line_index] ~= skip_logical_line then
			count = count + 1
			indices[count] = line_index
		end
	end
	self._background_line_count = count
end

function text_object:onspawn(_pos)
	self:position_text_component()
end

function text_object:set_dimensions(rect)
	self.dimensions = rect
	self.maximum_characters_per_line = (rect.right - rect.left) // self.char_width
	self:rebuild_text_layout()
	if self:is_typing() then
		self:reset_typing_buffer()
	else
		self:apply_full_text()
	end
end

function text_object:position_text_component()
	local longest = 0
	local widths<const> = self.full_text_line_widths
	for i = 1, #self.full_text_lines do
		local width<const> = widths[i]
		if width > longest then
			longest = width
		end
	end
	local dimensions<const> = self.dimensions
	self.text_component.offset_x = ((dimensions.right - dimensions.left) - longest) / 2 + dimensions.left - self.x
	self.text_component.offset_y = dimensions.top - self.y
end

function text_object:rebuild_text_layout()
	self.full_text_lines, self.wrapped_line_to_logical_line = build_wrapped_lines(self.text, self.maximum_characters_per_line)
	write_glyph_lines(self.text_component.font, self.full_text_lines, self.full_glyph_lines, self.full_text_line_widths)
	self.wrapped_line_y_offsets = build_wrapped_line_y_offsets(self.text_component.font, self.blank_lines, self.wrapped_line_to_logical_line)
	self.text_component.line_offsets = self.wrapped_line_y_offsets
	self:position_text_component()
	self:update_highlight_animation()
end

function text_object:compute_highlight_block()
	local highlighted<const> = self.highlighted_line_index
	if highlighted == nil then
		return nil
	end
	local target_line<const> = highlighted + 1
	local first = nil
	local last
	for i = 1, #self.wrapped_line_to_logical_line do
		if self.wrapped_line_to_logical_line[i] == target_line then
			if first == nil then
				first = i
			end
			last = i
		end
	end
	if first == nil then
		return nil
	end
	local font<const> = self.text_component.font
	local highlight_padding_y<const> = (self.text_component.line_height - font.line_height) / 2
	local first_y<const> = self.wrapped_line_y_offsets[first]
	local last_y<const> = self.wrapped_line_y_offsets[last]
	local y<const> = self.dimensions.top + first_y - highlight_padding_y
	local h<const> = (last_y - first_y) + font.line_height + (highlight_padding_y * 2)
	return y, h
end

-- Highlight motion owns its timeline admission. An inactive highlight is not
-- an animation that happens to render nothing: it has no frame work at all.
-- This mirrors the play/stop scheduling used by retained animation players.
local update_highlight_vibe<const> = function(self)
	local entry<const> = self.timelines:get(highlight_vibe_timeline_id)
	local active<const> = self.highlight_anim_y ~= nil
		and (self.highlight_pulse_enabled or self.highlight_jitter_enabled)
	if entry.playing == active then
		return
	end
	if active then
		self.timelines:play(highlight_vibe_timeline_id, highlight_vibe_play_options)
	else
		self.timelines:stop(highlight_vibe_timeline_id)
	end
end

function text_object:update_highlight_animation()
	if self.highlighted_line_index == nil then
		self.highlight_last_line_index = nil
		self.highlight_anim_y = nil
		self.highlight_anim_h = nil
		self.highlight_target_y = nil
		self.highlight_target_h = nil
		update_highlight_vibe(self)
		return
	end
	local target_y<const>, target_h<const> = self:compute_highlight_block()
	if target_y == nil then
		self.highlight_anim_y = nil
		self.highlight_anim_h = nil
		self.highlight_target_y = nil
		self.highlight_target_h = nil
		update_highlight_vibe(self)
		return
	end
	if not self.highlight_move_enabled then
		self.timelines:stop(highlight_move_timeline_id)
		self.highlight_anim_y = target_y
		self.highlight_anim_h = target_h
		self.highlight_target_y = target_y
		self.highlight_target_h = target_h
		self.highlight_last_line_index = self.highlighted_line_index
		update_highlight_vibe(self)
		return
	end
	if self.highlight_anim_y == nil then
		self.highlight_anim_y = target_y
		self.highlight_anim_h = target_h
	end
	if self.highlight_target_y ~= target_y or self.highlight_target_h ~= target_h or self.highlight_last_line_index ~= self.highlighted_line_index then
		self.highlight_target_y = target_y
		self.highlight_target_h = target_h
		self.highlight_last_line_index = self.highlighted_line_index
		self.timelines:play(highlight_move_timeline_id, {
			rewind = true,
			snap_to_start = true,
			params = {
				from_y = self.highlight_anim_y,
				to_y = target_y,
				from_h = self.highlight_anim_h,
				to_h = target_h,
			},
		})
	end
	update_highlight_vibe(self)
end

function text_object:set_highlighted_line(index)
	if self.highlighted_line_index == index then
		return
	end
	self.highlighted_line_index = index
	self:update_highlight_animation()
	rebuild_background_line_view(self)
	update_text_component_admission(self)
end

function text_object:set_highlight_pulse_enabled(enabled)
	if self.highlight_pulse_enabled == enabled then
		return
	end
	self.highlight_pulse_enabled = enabled
	update_highlight_vibe(self)
end

function text_object:set_highlight_jitter_enabled(enabled)
	if self.highlight_jitter_enabled == enabled then
		return
	end
	self.highlight_jitter_enabled = enabled
	update_highlight_vibe(self)
end

function text_object:set_text(text_or_lines, opts)
	local typed = true
	local snap
	if opts ~= nil then
		if opts.typed ~= nil then
			typed = opts.typed
		end
		snap = opts.snap
	end
	self.text = text_or_lines
	self:rebuild_text_layout()
	if typed and not snap then
		self:reset_typing_buffer()
		self.state_machines:dispatch(typing_command_start)
		return
	end
	self:reveal_text()
end

function text_object:set_font(font)
	self.text_component.font = font
	self.text_component.line_height = line_advance(font, self.blank_lines)
	if self.char_width_uses_font then
		self.char_width = font.items[0x61].width
	end
	self.maximum_characters_per_line = (self.dimensions.right - self.dimensions.left) // self.char_width
	self:rebuild_text_layout()
	if self:is_typing() then
		self:reset_typing_buffer()
	else
		self:apply_full_text()
	end
end

function text_object:clear_text()
	self:set_text(empty_text, immediate_text_opts)
	self:set_highlighted_line(nil)
end

function text_object:reset_typing_buffer()
	local line_widths<const> = self.displayed_line_widths
	for i = 1, #self.full_text_lines do
		self.full_glyph_lines[i].visible_count = 0
		line_widths[i] = 0
	end
	self.current_line_index = 0
	self.current_char_index = 0
	self._has_visible_glyphs = false
	self.text_component.glyph_lines = self.full_glyph_lines
	self.text_component.line_widths = line_widths
	self.text_component.glyph_line_count = #self.full_text_lines
	self._background_line_count = 0
	update_text_component_admission(self)
end

function text_object:apply_full_text()
	self.current_line_index = #self.full_text_lines
	self.current_char_index = 0
	local has_visible_glyphs = false
	for i = 1, #self.full_text_lines do
		local line<const> = self.full_glyph_lines[i]
		line.visible_count = line.glyph_count
		if line.glyph_count > 0 then
			has_visible_glyphs = true
		end
	end
	self._has_visible_glyphs = has_visible_glyphs
	self.text_component.glyph_lines = self.full_glyph_lines
	self.text_component.line_widths = self.full_text_line_widths
	self.text_component.glyph_line_count = #self.full_text_lines
	rebuild_background_line_view(self)
	update_text_component_admission(self)
end

function text_object:reveal_text()
	self.state_machines:dispatch(typing_command_reveal)
end

function text_object:advance_typing()
	local line_index = self.current_line_index
	if line_index == 0 then
		line_index = 1
	end
	local char_index<const> = self.current_char_index + 1
	local source_glyphs<const> = self.full_glyph_lines[line_index]
	if char_index <= source_glyphs.glyph_count then
		self.current_line_index = line_index
		self.current_char_index = char_index
		source_glyphs.visible_count = char_index
		if not self._has_visible_glyphs then
			self._has_visible_glyphs = true
			update_text_component_admission(self)
		end
		if char_index == 1 then
			local highlighted_logical_line<const> = self.highlighted_line_index
			if highlighted_logical_line == nil
			or self.wrapped_line_to_logical_line[line_index] ~= highlighted_logical_line + 1 then
				local background_line_count<const> = self._background_line_count + 1
				self._background_line_count = background_line_count
				self._background_line_indices[background_line_count] = line_index
			end
		end
		if char_index < source_glyphs.glyph_count then
			self.displayed_line_widths[line_index] = source_glyphs.x_offsets[char_index + 1]
		else
			self.displayed_line_widths[line_index] = self.full_text_line_widths[line_index]
		end
		return false
	end
	self.current_line_index = line_index + 1
	self.current_char_index = 0
	return self.current_line_index > #self.full_text_lines
end

function text_object:finish_typing()
	self.current_line_index = #self.full_text_lines
	self.current_char_index = 0
end

function text_object:is_typing()
	return self:has_tag(state_tags.group.typing)
end

function text_object:type_next()
	self.state_machines:dispatch(typing_command_step)
end

function text_object:submit_text_glyph_lines(draw, x, y)
	local tc<const> = self.text_component
	local lines<const> = tc.glyph_lines
	local span_binding<const> = tc.font.span_binding
	local blit_span<const> = span_binding.writer
	local uniform_draw_mode_source<const> = span_binding.uniform_draw_mode_source
	local line_offsets<const> = self.wrapped_line_y_offsets
	local color<const> = tc.color
	for i = 1, tc.glyph_line_count do
		local line<const> = lines[i]
		local line_length<const> = line.visible_count
		if line_length > 0 then
			blit_span(
				draw,
				line,
				line.x_offsets,
				1,
				line_length,
				x,
				y + line_offsets[i],
				color,
				uniform_draw_mode_source)
		end
	end
end

function text_object:submit_highlight(draw)
	local dims<const> = self.dimensions
	local highlighted_logical_line<const> = self.highlighted_line_index
	if highlighted_logical_line ~= nil and self.highlight_anim_y ~= nil then
		local horizontal_margin<const> = self.char_width / 2
		local scale<const> = self.highlight_pulse_enabled and self.highlight_vibe_scale or 1
		local offset_x<const> = self.highlight_jitter_enabled and self.highlight_vibe_offset_x or 0
		local offset_y<const> = self.highlight_jitter_enabled and self.highlight_vibe_offset_y or 0
		local padded_x<const> = horizontal_margin * scale
		draw:mode(gp0.draw_mode_blend_half)
		draw:semitransparent_rect(dims.left - padded_x + offset_x, self.highlight_anim_y + offset_y, dims.right + padded_x + offset_x, self.highlight_anim_y + self.highlight_anim_h + offset_y, self.highlight_bg_color)
	end
end

return text_object
