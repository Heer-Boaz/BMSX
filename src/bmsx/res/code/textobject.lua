-- textobject.lua
-- Text object with typewriter effect for system ROM

local WorldObject = require("worldobject")
local components = require("components")

local TextObject = {}
TextObject.__index = TextObject
setmetatable(TextObject, { __index = WorldObject })

local DEFAULT_CHAR_WIDTH = 6
local DEFAULT_LINE_HEIGHT = 16

local function split_lines(text)
	local lines = {}
	local start = 1
	while true do
		local pos = string.find(text, "\n", start, true)
		if not pos then
			lines[#lines + 1] = string.sub(text, start)
			break
		end
		lines[#lines + 1] = string.sub(text, start, pos - 1)
		start = pos + 1
	end
	return lines
end

function TextObject.new(opts)
	local self = setmetatable(WorldObject.new(opts), TextObject)
	opts = opts or {}
	self.type_name = "TextObject"
	self.text = { "" }
	self.full_text_lines = { "" }
	self.displayed_lines = { "" }
	self.current_line_index = 0
	self.current_char_index = 0
	self.maximum_characters_per_line = 0
	self.highlighted_line_index = nil
	self.is_typing = false
	self.text_color = { r = 1, g = 1, b = 1, a = 1 }
	self.highlight_color = { r = 0, g = 0, b = 0.5, a = 1 }
	self.dimensions = opts.dimensions or opts.dims or { left = 0, top = 0, right = display_width(), bottom = display_height() }
	self.centered_block_x = 0
	self.char_width = opts.char_width or DEFAULT_CHAR_WIDTH
	self.line_height = opts.line_height or DEFAULT_LINE_HEIGHT
	self:set_dimensions(self.dimensions)
	self.custom_visual = components.CustomVisualComponent.new({
		parent = self,
		producer = function()
			self:draw()
		end,
	})
	self:add_component(self.custom_visual)
	return self
end

function TextObject:set_dimensions(rect)
	self.dimensions = rect
	self.maximum_characters_per_line = math.floor((rect.right - rect.left) / self.char_width)
	self:recenter_text_block()
end

function TextObject:recenter_text_block()
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

function TextObject:update_displayed_text()
	self.text = self.displayed_lines
end

function TextObject:set_text(text_or_lines)
	local lines
	if type(text_or_lines) == "string" then
		lines = split_lines(text_or_lines)
	else
		lines = text_or_lines
	end
	self.full_text_lines = lines
	self.displayed_lines = {}
	for i = 1, #lines do
		self.displayed_lines[i] = ""
	end
	self.current_line_index = 0
	self.current_char_index = 0
	self.is_typing = true
	self:recenter_text_block()
	self:update_displayed_text()
end

function TextObject:type_next()
	if not self.is_typing then
		return
	end
	if self.current_line_index >= #self.full_text_lines then
		self.is_typing = false
		self.events:emit("text.typing.done", { totalLines = #self.full_text_lines })
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
		self.events:emit("text.typing.char", { char = char, lineIndex = self.current_line_index, charIndex = self.current_char_index - 1 })
		return
	end
	self.current_line_index = self.current_line_index + 1
	self.current_char_index = 0
	if self.current_line_index >= #self.full_text_lines then
		self.is_typing = false
		self.events:emit("text.typing.done", { totalLines = #self.full_text_lines })
	end
	self:update_displayed_text()
end

function TextObject:draw()
	if not self.visible then
		return
	end
	local dims = self.dimensions
	local text_color = self.text_color
	local highlight = self.highlight_color
	local line_height = self.line_height
	for i = 1, #self.text do
		local line = self.text[i]
		local y = dims.top + line_height * (i - 1)
		if self.highlighted_line_index ~= nil and self.highlighted_line_index == (i - 1) then
			local margin = self.char_width / 2
			rectfill_color(dims.left - margin, y - margin, dims.right + margin, y + line_height - margin, self.z, {
				r = highlight.r,
				g = highlight.g,
				b = highlight.b,
				a = highlight.a * text_color.a,
			})
		end
		write_color(line, self.centered_block_x, y, self.z, text_color)
	end
end

return TextObject
