-- textobject.lua
-- text object with typewriter effect for system rom

local worldobject = require("worldobject")
local components = require("components")

local textobject = {}
textobject.__index = textobject
setmetatable(textobject, { __index = worldobject })

local default_char_width = 6
local default_line_height = 16

local function trim(text)
	return string.gsub(text, "^%s*(.-)%s*$", "%1")
end

local function wrap_glyphs(text, max_line_length)
	local lines = {}
	local line_map = {}
	local current_line = ""
	local i = 1
	local logical_line_index = 1

	local function push_line(line)
		lines[#lines + 1] = line
		line_map[#lines] = logical_line_index
	end

	while i <= #text do
		local ch = string.sub(text, i, i)
		if ch == "\n" then
			push_line(trim(current_line))
			current_line = ""
			logical_line_index = logical_line_index + 1
			i = i + 1
		elseif ch == " " or ch == "\t" or ch == "\r" or ch == "\f" or ch == "\v" then
			i = i + 1
		else
			local j = i
			while j <= #text do
				local cj = string.sub(text, j, j)
				if cj == "\n" or cj == " " or cj == "\t" or cj == "\r" or cj == "\f" or cj == "\v" then
					break
				end
				j = j + 1
			end
			local word = string.sub(text, i, j - 1)
			local tentative = current_line == "" and word or (current_line .. " " .. word)
			if #tentative <= max_line_length then
				current_line = tentative
			else
				if current_line ~= "" then
					push_line(trim(current_line))
					current_line = word
				else
					push_line(word)
					current_line = ""
				end
			end
			i = j
		end
	end

	if trim(current_line) ~= "" then
		push_line(trim(current_line))
	end

	return lines, line_map
end

function textobject.new(opts)
	local self = setmetatable(worldobject.new(opts), textobject)
	opts = opts or {}
	self.type_name = "textobject"
	self.text = { "" }
	self.full_text_lines = { "" }
	self.displayed_lines = { "" }
	self.current_line_index = 0
	self.current_char_index = 0
	self.maximum_characters_per_line = 0
	self.highlighted_line_index = nil
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
		parent = self,
		producer = function()
			self:draw()
		end,
	})
	self:add_component(self.custom_visual)
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

function textobject:set_text(text_or_lines, opts)
	opts = opts or {}
	local typed = opts.typed
	local snap = opts.snap == true
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
			self.displayed_lines[i] = ""
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
	local dims = self.dimensions
	local text_color = self.text_color
	local highlight = self.highlight_color
	local line_height = self.line_height
	local bg_alpha = text_color.a
	local normal_bg_color = { r = 0, g = 0, b = 0, a = bg_alpha }
	local highlight_bg_color = { r = highlight.r, g = highlight.g, b = highlight.b, a = highlight.a * bg_alpha }
	local highlighted_logical_line = self.highlighted_line_index
	for i = 1, #self.text do
		local line = self.text[i]
		local y = dims.top + line_height * (i - 1)
		local bg = normal_bg_color
		if highlighted_logical_line ~= nil and self.wrapped_line_to_logical_line[i] == (highlighted_logical_line + 1) then
			local margin = self.char_width / 2
			bg = highlight_bg_color
			put_rectfillcolor(dims.left - margin, y - margin, dims.right + margin, y + line_height - margin, self.z, {
				r = bg.r,
				g = bg.g,
				b = bg.b,
				a = bg.a,
			})
		end
		put_glyphs(line, self.centered_block_x, y, self.z, { color = text_color, background_color = bg })
	end
end

return textobject
