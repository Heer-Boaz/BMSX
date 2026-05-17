-- textobject.lua
-- text object with typewriter effect for system rom

local worldobject<const> = require('bios/world/object')
local components<const> = require('bios/components')
local fsmlibrary<const> = require('bios/fsm/library')
local wrap_text_lines<const> = require('bios/util/wrap_text_lines')
local vdp_stream<const> = require('bios/vdp_stream')
local font_module<const> = require('bios/font')

local textobject<const> = {}
textobject.__index = textobject
setmetatable(textobject, { __index = worldobject })

local highlight_move_timeline_id<const> = 'hmove'
local highlight_vibe_timeline_id<const> = 'hvibe'
local typing_timeline_id<const> = 'type'
local textobject_fsm_id<const> = 'textobject'
local textobject_state_idle<const> = 'idle'
local textobject_state_typing<const> = 'typing'
local typing_command_start<const> = 'type.start'
local typing_command_step<const> = 'type.step'
local typing_command_reveal<const> = 'type.reveal'
local highlight_move_in_frames<const> = 6
local highlight_move_settle_frames<const> = 3
local highlight_move_overshoot<const> = 0.12
local highlight_move_ticks_per_frame<const> = 12
local typing_step_emit_char<const> = 1
local typing_step_finish_line<const> = 2
local state_tags<const> = {
	variant = {
		idle = 'v.i',
		typing = 'v.t',
	},
	group = {
		typing = 'g.t',
	},
}

local measure_line_width<const> = function(font, line)
	return font_module.measure_line_width(font, line)
end

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

local build_typing_steps<const> = function(lines)
	local steps<const> = {}
	for line_index = 1, #lines do
		local line<const> = lines[line_index]
		local line_length<const> = string.len(line)
		for char_index = 1, line_length do
			steps[#steps + 1] = {
				op = typing_step_emit_char,
				l = line_index,
				c = char_index,
				v = string.sub(line, char_index, char_index),
			}
		end
		steps[#steps + 1] = {
			op = typing_step_finish_line,
			l = line_index,
		}
	end
	return steps
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
		local eased<const> = easing.smoothstep(u)
		frames[#frames + 1] = {
			highlight_anim_y = from_y + ((overshoot_y - from_y) * eased),
			highlight_anim_h = from_h + ((overshoot_h - from_h) * eased),
		}
	end
	for i = 0, highlight_move_settle_frames - 1 do
		local u<const> = i / (highlight_move_settle_frames - 1)
		local eased<const> = easing.smoothstep(u)
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

local build_line_widths<const> = function(font, lines)
	local widths<const> = {}
	for i = 1, #lines do
		widths[i] = measure_line_width(font, lines[i])
	end
	return widths
end

fsmlibrary.register(textobject_fsm_id, {
	initial = textobject_state_idle,
	tag_derivations = {
		[state_tags.group.typing] = { state_tags.variant.typing },
	},
	timelines = {
		[highlight_move_timeline_id] = {
			def = {
				frames = build_highlight_move_frames,
				ticks_per_frame = highlight_move_ticks_per_frame,
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
						ease = easing.smoothstep,
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
		[typing_command_start] = '/' .. textobject_state_typing,
		[typing_command_reveal] = function(self, state)
			self:apply_full_text()
			if state.current_id ~= textobject_state_idle then
				return '/' .. textobject_state_idle
			end
		end,
	},
	states = {
		[textobject_state_idle] = {
			tags = { state_tags.variant.idle },
		},
		[textobject_state_typing] = {
			tags = { state_tags.variant.typing },
			entering_state = function(self)
				self:play_timeline(typing_timeline_id, {
					rewind = true,
					snap_to_start = false,
					params = self.full_text_lines,
				})
			end,
			timelines = {
				[typing_timeline_id] = {
					def = {
						frames = build_typing_steps,
						playback_mode = 'once',
						autotick = false,
					},
					autoplay = false,
					stop_on_exit = true,
					on_frame = function(self, _state, event)
						self:apply_typing_step(event.frame_value)
					end,
					on_end = function(self)
						self:finish_typing()
						return '/' .. textobject_state_idle
					end,
				},
			},
			on = {
				[typing_command_step] = function(self)
					self:advance_timeline(typing_timeline_id)
				end,
			},
		},
	},
})

function textobject.new(opts)
	opts = opts or {}
	opts.type_name = 'textobject'
	opts.fsm_id = opts.fsm_id or textobject_fsm_id
	local self<const> = setmetatable(worldobject.new(opts), textobject)
	self.is_textobject = true
	self.text = { '' }
	self.full_text_lines = { '' }
	self.full_text_line_widths = { 0 }
	self.displayed_lines = { '' }
	self.displayed_line_widths = { 0 }
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
	self.layer = opts.layer or sys_vdp_layer_ui
	self.highlight_vibe_scale = 1
	self.highlight_vibe_offset_x = 0
	self.highlight_vibe_offset_y = 0
	self.wrapped_line_to_logical_line = {}
	self.wrapped_line_y_offsets = { 0 }
	self.text_color = opts.text_color or 0xffffffff
	self.highlight_color = opts.highlight_color or 0xb3000080
	self.normal_bg_color = opts.normal_bg_color or 0xff000000
	self.highlight_bg_color = opts.highlight_bg_color or 0xb3000080
	self.font = opts.font or font_module.get('default')
	self.dimensions = opts.dimensions or { left = 0, top = 0, right = machine_manifest.render_size.width, bottom = machine_manifest.render_size.height }
	self.centered_block_x = 0
	self.char_width = opts.char_width or self.font.glyphs['a'].width
	self.blank_lines = opts.blank_lines or 0
	self.line_height = line_advance(self.font, self.blank_lines)
	self.text_offset = { x = 0, y = self.dimensions.top, z = 1 }
	self:set_dimensions(self.dimensions)
	self.text_component = components.textcomponent.new({
			text = self.text,
			font = self.font,
			line_height = self.line_height,
			line_offsets = self.wrapped_line_y_offsets,
			line_widths = self.displayed_line_widths,
			color = self.text_color,
			background_color = self.normal_bg_color,
			offset = self.text_offset,
		layer = self.layer,
	})
	self.text_component.prepare_render = function()
		self:sync_text_component()
	end
	self.text_component.render = function(tc, x, y, z, glyphs)
		self:submit_text_lines(tc, x, y, z, glyphs)
	end
	self:add_component(self.text_component)
	self.custom_visual = components.customvisualcomponent.new({
		producer = function()
			self:submit_highlight()
		end,
	})
	self:add_component(self.custom_visual)
	self:sync_text_component()
	return self
end

function textobject:set_dimensions(rect)
	self.dimensions = rect
	self.maximum_characters_per_line = (rect.right - rect.left) // self.char_width
	self.text_offset.y = rect.top - self.y
	self:recenter_text_block()
end

function textobject:recenter_text_block()
	local longest = 0
	local widths<const> = self.full_text_line_widths
	for i = 1, #widths do
		local width<const> = widths[i]
		if width > longest then
			longest = width
		end
	end
	self.centered_block_x = ((self.dimensions.right - self.dimensions.left) - longest) / 2 + self.dimensions.left
end

function textobject:update_displayed_text()
	self.text = self.displayed_lines
	self.text_component.text = self.displayed_lines
	self.text_component.line_widths = self.displayed_line_widths
end

function textobject:compute_highlight_block()
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
	local highlight_padding_y<const> = (self.line_height - self.font.line_height) / 2
	local first_y<const> = self.wrapped_line_y_offsets[first]
	local last_y<const> = self.wrapped_line_y_offsets[last]
	local y<const> = self.dimensions.top + first_y - highlight_padding_y
	local h<const> = (last_y - first_y) + self.font.line_height + (highlight_padding_y * 2)
	return y, h
end

function textobject:update_highlight_animation()
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
		self:stop_timeline(highlight_move_timeline_id)
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
		self:play_timeline(highlight_move_timeline_id, {
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

function textobject:set_text(text_or_lines, opts)
	opts = opts or {}
	local typed = opts.typed
	local snap<const> = (opts.snap)
	if typed == nil then
		typed = true
	end
	self.full_text_lines, self.wrapped_line_to_logical_line = build_wrapped_lines(text_or_lines, self.maximum_characters_per_line)
	self.full_text_line_widths = build_line_widths(self.font, self.full_text_lines)
	self.wrapped_line_y_offsets = build_wrapped_line_y_offsets(self.font, self.blank_lines, self.wrapped_line_to_logical_line)
	self:recenter_text_block()
	if typed and not snap then
		self:reset_typing_buffer()
		self:dispatch_command(typing_command_start)
		return
	end
	self:reveal_text()
end

function textobject:clear_text()
	self:set_text({}, { typed = false, snap = true })
	self.highlighted_line_index = nil
end

function textobject:reset_typing_buffer()
	self.displayed_lines = {}
	self.displayed_line_widths = {}
	for i = 1, #self.full_text_lines do
		self.displayed_lines[i] = ''
		self.displayed_line_widths[i] = 0
	end
	self.current_line_index = 0
	self.current_char_index = 0
	self:update_displayed_text()
end

function textobject:apply_full_text()
	self.displayed_lines = {}
	self.displayed_line_widths = {}
	for i = 1, #self.full_text_lines do
		self.displayed_lines[i] = self.full_text_lines[i]
		self.displayed_line_widths[i] = self.full_text_line_widths[i]
	end
	self.current_line_index = #self.full_text_lines
	self.current_char_index = 0
	self:update_displayed_text()
end

function textobject:reveal_text()
	self:dispatch_command(typing_command_reveal)
end

function textobject:apply_typing_step(step)
	if step.op == typing_step_emit_char then
		self.current_line_index = step.l - 1
		self.current_char_index = step.c
		self.displayed_lines[step.l] = self.displayed_lines[step.l] .. step.v
		self.displayed_line_widths[step.l] = self.displayed_line_widths[step.l] + (self.font.glyphs[step.v] or self.font.glyphs['?']).advance
		self:update_displayed_text()
		self.events:emit('char', { char = step.v, lineindex = step.l - 1, charindex = step.c - 1 })
		return
	end
	self.current_line_index = step.l
	self.current_char_index = 0
	self:update_displayed_text()
end

function textobject:finish_typing()
	self.current_line_index = #self.full_text_lines
	self.current_char_index = 0
	self.events:emit('done', { totallines = #self.full_text_lines })
end

function textobject:is_typing()
	return self:has_tag(state_tags.group.typing)
end

function textobject:type_next()
	self:dispatch_command(typing_command_step)
end

function textobject:sync_text_component()
	self.text_offset.x = self.centered_block_x - self.x
	self.text_offset.y = self.dimensions.top - self.y
	self.text_component.text = self.text
	self.text_component.font = self.font
	self.text_component.line_height = self.line_height
	self.text_component.line_offsets = self.wrapped_line_y_offsets
	self.text_component.line_widths = self.displayed_line_widths
	self.text_component.color = self.text_color
	self.text_component.background_color = self.normal_bg_color
	self.text_component.layer = self.layer
end

function textobject:submit_text_background_lines(x, y, z, glyphs)
	local tc<const> = self.text_component
	local highlighted_logical_line<const> = self.highlighted_line_index
	local skip_logical_line<const> = highlighted_logical_line ~= nil and (highlighted_logical_line + 1) or 0
	local line_offsets<const> = tc.line_offsets
	local line_widths<const> = tc.line_widths
	local background_color<const> = tc.background_color
	local wrapped_line_to_logical_line<const> = self.wrapped_line_to_logical_line
	local cursor_y = y
	for i = 1, #glyphs do
		local line<const> = glyphs[i]
		if string.len(line) > 0 and wrapped_line_to_logical_line[i] ~= skip_logical_line then
			local line_y<const> = line_offsets ~= nil and (y + line_offsets[i]) or cursor_y
			local line_x = x
			local line_width<const> = line_widths[i]
			if tc.line_x_offsets ~= nil then
				line_x = x + tc.line_x_offsets[i]
			elseif tc.center_block_width ~= nil then
				line_x = x + ((tc.center_block_width - line_width) / 2)
			end
			vdp_stream.fill_rect_color(line_x, line_y, line_x + line_width, line_y + tc.font.line_height, z, tc.layer, background_color)
		end
		if line_offsets == nil then
			cursor_y = cursor_y + tc.line_height
		end
	end
end

function textobject:submit_text_lines(tc, x, y, z, glyphs)
	if tc.background_color ~= nil then
		self:submit_text_background_lines(x, y, z - 1, glyphs)
	end
	components.textcomponent.render_glyphs(tc, x, y, z, glyphs)
end

function textobject:submit_highlight()
	self:update_highlight_animation()
	local dims<const> = self.dimensions
	local highlighted_logical_line<const> = self.highlighted_line_index
	if highlighted_logical_line ~= nil and self.highlight_anim_y ~= nil then
		local horizontal_margin<const> = self.char_width / 2
		local scale<const> = self.highlight_pulse_enabled and self.highlight_vibe_scale or 1
		local offset_x<const> = self.highlight_jitter_enabled and self.highlight_vibe_offset_x or 0
		local offset_y<const> = self.highlight_jitter_enabled and self.highlight_vibe_offset_y or 0
		local padded_x<const> = horizontal_margin * scale
		local highlight_z<const> = self.z + self.text_offset.z - 0.5
		vdp_stream.fill_rect_color(dims.left - padded_x + offset_x, self.highlight_anim_y + offset_y, dims.right + padded_x + offset_x, self.highlight_anim_y + self.highlight_anim_h + offset_y, highlight_z, self.layer, self.highlight_bg_color)
	end
end

return textobject
