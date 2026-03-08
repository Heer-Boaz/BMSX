-- textobject.lua
-- text object with typewriter effect for system rom

local worldobject = require("worldobject")
local components = require("components")

local textobject = {}
textobject.__index = textobject
setmetatable(textobject, { __index = worldobject })

local default_char_width = 6
local default_line_height = 16
local highlight_move_timeline_id = 'textobject.highlight.move'
local highlight_vibe_timeline_id = 'textobject.highlight.vibe'
local highlight_move_in_frames = 6
local highlight_move_settle_frames = 3
local highlight_move_overshoot = 0.12
local highlight_move_ticks_per_frame = 12
local inline_whitespace_chars = { [' '] = true, ['\t'] = true, ['\r'] = true, ['\f'] = true, ['\v'] = true }
local wrap_break_chars = { ['\n'] = true, [' '] = true, ['\t'] = true, ['\r'] = true, ['\f'] = true, ['\v'] = true }

local function trim(text)
	return string.gsub(text, "^%s*(.-)%s*$", "%1")
end

local function wrap_glyphs(text, max_line_length)
	local lines = {}
	local line_map = {}
	local current_line
	local i = 1
	local logical_line_index = 1

	local function push_line(line)
		lines[#lines + 1] = line
		line_map[#lines] = logical_line_index
	end

	while i <= #text do
		local ch = string.sub(text, i, i)
		if ch == "\n" then
			if current_line then
				push_line(trim(current_line))
			else
				push_line("")
			end
			current_line = nil
			logical_line_index = logical_line_index + 1
			i = i + 1
			elseif inline_whitespace_chars[ch] then
				i = i + 1
			else
				local j = i
				while j <= #text do
					local cj = string.sub(text, j, j)
					if wrap_break_chars[cj] then
						break
					end
				j = j + 1
			end
			local word = string.sub(text, i, j - 1)
				local tentative = current_line and (current_line .. " " .. word) or word
			if #tentative <= max_line_length then
				current_line = tentative
			else
				if (current_line) then
					push_line(trim(current_line))
					current_line = word
				else
					push_line(word)
						current_line = nil
				end
			end
			i = j
		end
	end

	if current_line then
		push_line(trim(current_line))
	end

	return lines, line_map
end

local function build_highlight_move_frames(params)
	local frames = {}
	local from_y = params.from_y
	local to_y = params.to_y
	local from_h = params.from_h
	local to_h = params.to_h
	local overshoot_y = to_y + ((to_y - from_y) * highlight_move_overshoot)
	local overshoot_h = to_h + ((to_h - from_h) * highlight_move_overshoot)
	for i = 0, highlight_move_in_frames - 1 do
		local u = i / (highlight_move_in_frames - 1)
		local eased = easing.smoothstep(u)
		frames[#frames + 1] = {
			highlight_anim_y = from_y + ((overshoot_y - from_y) * eased),
			highlight_anim_h = from_h + ((overshoot_h - from_h) * eased),
		}
	end
	for i = 0, highlight_move_settle_frames - 1 do
		local u = i / (highlight_move_settle_frames - 1)
		local eased = easing.smoothstep(u)
		frames[#frames + 1] = {
			highlight_anim_y = overshoot_y + ((to_y - overshoot_y) * eased),
			highlight_anim_h = overshoot_h + ((to_h - overshoot_h) * eased),
		}
	end
	return frames
end

function textobject.new(opts)
	opts = opts or {}
	opts.type_name = "textobject"
	local self = setmetatable(worldobject.new(opts), textobject)
	self.text = { "" }
	self.full_text_lines = { "" }
	self.displayed_lines = { "" }
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
	self.layer = opts.layer or 'ui'
	self.highlight_vibe_scale = 1
	self.highlight_vibe_offset_x = 0
	self.highlight_vibe_offset_y = 0
	self.wrapped_line_to_logical_line = {}
	self.is_typing = false
	self.text_color = { r = 1, g = 1, b = 1, a = 1 }
	self.highlight_color = { r = 0, g = 0, b = 0.5, a = 1 }
	self.dimensions = opts.dimensions or opts.dims or { left = 0, top = 0, right = display_width(), bottom = display_height() }
	self.centered_block_x = 0
	self.char_width = opts.char_width or default_char_width
	self.line_height = opts.line_height or default_line_height
	self:set_dimensions(self.dimensions)
	self.custom_visual = components.customvisualcomponent.new({
		producer = function()
			self:draw()
		end,
	})
	self:add_component(self.custom_visual)
	self:define_timeline(timeline.new({
		id = highlight_move_timeline_id,
		frames = build_highlight_move_frames,
		ticks_per_frame = highlight_move_ticks_per_frame,
		playback_mode = 'once',
		apply = true,
	}))
	self:define_timeline(timeline.new({
		id = highlight_vibe_timeline_id,
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
	}))
	self:play_timeline(highlight_vibe_timeline_id, { rewind = true, snap_to_start = true })
	return self
end

function textobject:set_dimensions(rect)
	self.dimensions = rect
	self.maximum_characters_per_line = math.floor((rect.right - rect.left) / self.char_width)
	self:recenter_text_block()
end

function textobject:recenter_text_block()
	local longest = 0
	for i = 1, #self.full_text_lines do
		local line = self.full_text_lines[i]
		local width = #line * self.char_width
		if width > longest then
			longest = width
		end
	end
	self.centered_block_x = ((self.dimensions.right - self.dimensions.left) - longest) / 2 + self.dimensions.left
end

function textobject:update_displayed_text()
	self.text = self.displayed_lines
end

function textobject:compute_highlight_block()
	local highlighted = self.highlighted_line_index
	if highlighted == nil then
		return nil
	end
	local target_line = highlighted + 1
	local first = nil
	local last
	for i = 1, #self.text do
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
	local y = self.dimensions.top + (self.line_height * (first - 1))
	local h = self.line_height * (last - first + 1)
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
	local target_y, target_h = self:compute_highlight_block()
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
	local snap = (opts.snap)
	if typed == nil then
		typed = true
	end
	if type(text_or_lines) == "string" then
		self.full_text_lines, self.wrapped_line_to_logical_line = wrap_glyphs(text_or_lines, self.maximum_characters_per_line)
	else
		local joined = table.concat(text_or_lines, "\n")
		self.full_text_lines, self.wrapped_line_to_logical_line = wrap_glyphs(joined, self.maximum_characters_per_line)
	end
	self:recenter_text_block()
	if typed and not snap then
		self.displayed_lines = {}
		for i = 1, #self.full_text_lines do
			self.displayed_lines[i] = nil
		end
		self.current_line_index = 0
		self.current_char_index = 0
		self.is_typing = true
		self:update_displayed_text()
		return
	end
	self:reveal_text()
end

function textobject:reveal_text()
	self.displayed_lines = {}
	for i = 1, #self.full_text_lines do
		self.displayed_lines[i] = self.full_text_lines[i]
	end
	self.current_line_index = #self.full_text_lines
	self.current_char_index = 0
	self.is_typing = false
	self:update_displayed_text()
end

function textobject:type_next()
	if not self.is_typing then
		return
	end
	if self.current_line_index >= #self.full_text_lines then
		self.is_typing = false
		self.events:emit("text.typing.done", { totallines = #self.full_text_lines })
		return
	end
	local line_index = self.current_line_index + 1
	local line = self.full_text_lines[line_index]
	if self.current_char_index < #line then
		local char_index = self.current_char_index + 1
		local char = string.sub(line, char_index, char_index)
		self.displayed_lines[line_index] = self.displayed_lines[line_index] .. char
		self.current_char_index = self.current_char_index + 1
		self:update_displayed_text()
		self.events:emit("text.typing.char", { char = char, lineindex = self.current_line_index, charindex = self.current_char_index - 1 })
		return
	end
	self.current_line_index = self.current_line_index + 1
	self.current_char_index = 0
	if self.current_line_index >= #self.full_text_lines then
		self.is_typing = false
		self.events:emit("text.typing.done", { totallines = #self.full_text_lines })
	end
	self:update_displayed_text()
end

function textobject:draw()
	if not self.visible then
		return
	end
	self:update_highlight_animation()
	local dims = self.dimensions
	local text_color = self.text_color
	local highlight = self.highlight_color
	local line_height = self.line_height
	local bg_alpha = text_color.a
	local normal_bg_color = { r = 0, g = 0, b = 0, a = bg_alpha }
	local highlight_bg_color = { r = highlight.r, g = highlight.g, b = highlight.b, a = highlight.a * bg_alpha }
	local highlighted_logical_line = self.highlighted_line_index
	if highlighted_logical_line ~= nil and self.highlight_anim_y ~= nil then
		local margin = self.char_width / 2
		local scale = self.highlight_pulse_enabled and self.highlight_vibe_scale or 1
		local offset_x = self.highlight_jitter_enabled and self.highlight_vibe_offset_x or 0
		local offset_y = self.highlight_jitter_enabled and self.highlight_vibe_offset_y or 0
		local padded = margin * scale
		put_rectfillcolor(
			dims.left - padded + offset_x,
			self.highlight_anim_y - padded + offset_y,
			dims.right + padded + offset_x,
			self.highlight_anim_y + self.highlight_anim_h - padded + offset_y,
			self.z,
			{
				r = highlight_bg_color.r,
				g = highlight_bg_color.g,
				b = highlight_bg_color.b,
				a = highlight_bg_color.a,
			},
			{ layer = self.layer }
		)
	end
	for i = 1, #self.text do
		local line = self.text[i]
		local y = dims.top + line_height * (i - 1)
		local bg = normal_bg_color
		put_glyphs(line, self.centered_block_x, y, self.z, { color = text_color, background_color = bg, layer = self.layer })
	end
end

return textobject
