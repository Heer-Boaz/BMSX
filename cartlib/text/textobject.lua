-- text_object.lua
-- Text object with typewriter effect for carts.

local worldobject<const> = require('cartlib/world/worldobject')
local text_component<const> = require('cartlib/text/textcomponent')
local timelinecomponent<const> = require('cartlib/timeline/timelinecomponent')
local fsm_component<const> = require('cartlib/fsm/fsmcomponent')
local fsm_library<const> = require('cartlib/fsm/library')
local wrap_text_lines<const> = require('cartlib/util/text').wrap_text_lines
local gp0<const> = require('cartlib/gx/gp0')
local gx_display<const> = require('cartlib/gx/display')
local font_module<const> = require('cartlib/font')
local smoothstep<const> = require('cartlib/easing').smoothstep

local text_object<const> = {}
text_object.__index = text_object
setmetatable(text_object, { __index = worldobject })

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
		owner:submit_text_background_lines(draw, x, y)
	end
	text_component.render_glyphs(self, draw, x, y)
end

function text_object_component:set_font(font)
	self.parent:set_font(font)
end

local highlight_move_timelineid<const> = 'hmove'
local highlight_vibe_timelineid<const> = 'hvibe'
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
local highlight_move_ticks_per_frame<const> = 12
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
		[highlight_move_timelineid] = {
			def = {
				frames = build_highlight_move_frames,
				ticks_per_frame = highlight_move_ticks_per_frame,
				playback_mode = 'once',
				apply = true,
			},
			autoplay = false,
		},
		[highlight_vibe_timelineid] = {
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
			autoplay = true,
			play_options = {
				rewind = true,
				snap_to_start = true,
			},
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

function text_object.new(opts)
	opts = opts or {}
	local self<const> = setmetatable(worldobject.new(opts), text_object)
	self:add_component(timelinecomponent.new({ parent = self }))
	self:add_component(fsm_component.new({ parent = self }, text_object_machine_ids))
	self.is_text_object = true
	self.text = { '' }
	self.full_text_lines = { '' }
	self.full_text_line_widths = { 0 }
	self.full_glyph_lines = {}
	self.current_line_index = 0
	self.current_char_index = 0
	self.maximum_characters_per_line = 0
	self.highlighted_line_index = nil
	self.highlight_anim_y = nil
	self.highlight_anim_h = nil
	self.highlight_target_y = nil
	self.highlight_target_h = nil
	self.highlight_last_line_index = nil
	self.highlight_move_enabled = false
	self.highlight_pulse_enabled = false
	self.highlight_jitter_enabled = false
	self.highlight_vibe_scale = 1
	self.highlight_vibe_offset_x = 0
	self.highlight_vibe_offset_y = 0
	self.wrapped_line_to_logical_line = {}
	self.wrapped_line_y_offsets = { 0 }
	self.highlight_bg_color = opts.highlight_bg_color or 0xff000080
	local font<const> = opts.font or font_module.get('default')
	local dimensions = opts.dimensions
	if not dimensions then
		local width<const>, height<const> = gx_display.size()
		dimensions = { left = 0, top = 0, right = width, bottom = height }
	end
	self.dimensions = dimensions
	self.char_width_uses_font = opts.char_width == nil
	self.char_width = opts.char_width or font.items[0x61].width
	self.blank_lines = opts.blank_lines or 0
	local line_height<const> = line_advance(font, self.blank_lines)
	self.text_component = text_object_component.new({
		text = nil,
		font = font,
		line_height = line_height,
		line_offsets = self.wrapped_line_y_offsets,
		color = opts.text_color or 0xffffffff,
		background_color = opts.normal_bg_color or 0xff000000,
		offset_y = self.dimensions.top,
		offset_z = 1,
	})
	self.display_glyph_lines = self.text_component.glyph_lines
	self.displayed_line_widths = self.text_component.layout_line_widths
	self.text_component.line_widths = self.displayed_line_widths
	self:add_component(self.text_component)
	self:set_dimensions(self.dimensions)
	return self
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

function text_object:update_highlight_animation()
	if self.highlighted_line_index == nil then
		self.highlight_last_line_index = nil
		self.highlight_anim_y = nil
		self.highlight_anim_h = nil
		self.highlight_target_y = nil
		self.highlight_target_h = nil
		return
	end
	local target_y<const>, target_h<const> = self:compute_highlight_block()
	if target_y == nil then
		self.highlight_anim_y = nil
		self.highlight_anim_h = nil
		self.highlight_target_y = nil
		self.highlight_target_h = nil
		return
	end
	if not self.highlight_move_enabled then
		self.timelines:stop(highlight_move_timelineid)
		self.highlight_anim_y = target_y
		self.highlight_anim_h = target_h
		self.highlight_target_y = target_y
		self.highlight_target_h = target_h
		self.highlight_last_line_index = self.highlighted_line_index
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
		self.timelines:play(highlight_move_timelineid, {
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
end

function text_object:set_highlighted_line(index)
	if self.highlighted_line_index == index then
		return
	end
	self.highlighted_line_index = index
	self:update_highlight_animation()
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
	self.text_component.font_id = font.id
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
	local glyph_lines<const> = self.display_glyph_lines
	local line_widths<const> = self.displayed_line_widths
	for i = 1, #self.full_text_lines do
		local line = glyph_lines[i]
		if line == nil then
			line = {}
			glyph_lines[i] = line
		end
		for glyph_index = 1, #line do
			line[glyph_index] = nil
		end
		line_widths[i] = 0
	end
	self.current_line_index = 0
	self.current_char_index = 0
	self.text_component.glyph_lines = glyph_lines
	self.text_component.line_widths = line_widths
	self.text_component.glyph_line_count = #self.full_text_lines
end

function text_object:apply_full_text()
	self.current_line_index = #self.full_text_lines
	self.current_char_index = 0
	self.text_component.glyph_lines = self.full_glyph_lines
	self.text_component.line_widths = self.full_text_line_widths
	self.text_component.glyph_line_count = #self.full_text_lines
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
	if char_index <= #source_glyphs then
		self.current_line_index = line_index
		self.current_char_index = char_index
		local glyph<const> = source_glyphs[char_index]
		local display_glyphs<const> = self.display_glyph_lines[line_index]
		display_glyphs[#display_glyphs + 1] = glyph
		self.displayed_line_widths[line_index] = self.displayed_line_widths[line_index] + glyph.advance
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

function text_object:submit_text_background_lines(draw, x, y)
	local tc<const> = self.text_component
	local glyphs<const> = tc.glyph_lines
	local highlighted_logical_line<const> = self.highlighted_line_index
	local skip_logical_line<const> = highlighted_logical_line ~= nil and (highlighted_logical_line + 1) or 0
	local line_offsets<const> = tc.line_offsets
	local line_widths<const> = tc.line_widths
	local background_color<const> = tc.background_color
	local wrapped_line_to_logical_line<const> = self.wrapped_line_to_logical_line
	local cursor_y = y
	for i = 1, tc.glyph_line_count do
		local line<const> = glyphs[i]
		if #line > 0 and wrapped_line_to_logical_line[i] ~= skip_logical_line then
			local line_y<const> = line_offsets ~= nil and (y + line_offsets[i]) or cursor_y
			local line_x = x
			local line_width<const> = line_widths[i]
			if tc.line_x_offsets ~= nil then
				line_x = x + tc.line_x_offsets[i]
			elseif tc.center_block_width ~= nil then
					line_x = x + ((tc.center_block_width - line_width) // 2)
			end
			draw:rect(line_x, line_y, line_x + line_width, line_y + tc.font.line_height, background_color)
		end
		if line_offsets == nil then
			cursor_y = cursor_y + tc.line_height
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
