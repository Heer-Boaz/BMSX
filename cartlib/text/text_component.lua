local font_catalog<const> = require('cartlib/text/font_catalog')
local gp0<const> = require('cartlib/gx/gp0')
local gx_vram<const> = require('cartlib/gx/vram')
local visual_component<const> = require('cartlib/component/visual_component')
local wrap_text_lines<const> = require('cartlib/util/text').wrap_text_lines
local empty_text_lines<const> = {}
local find<const> = string.find

local text_component<const> = {}
text_component.__index = text_component
setmetatable(text_component, { __index = visual_component })

function text_component.new(opts)
	local self<const> = setmetatable(visual_component.new(opts), text_component)
	self.font = opts.font or font_catalog.get('default')
	self.line_height = opts.line_height or self.font.line_height
	self.color = opts.color or 0xffffffff
	self.background_color = opts.background_color
	self.wrap_chars = opts.wrap_chars
	self.line_offsets = opts.line_offsets
	self.line_widths = opts.line_widths
	self.line_x_offsets = opts.line_x_offsets
	self.center_block_width = opts.center_block_width
	self.text = nil
	self.glyph_lines = {}
	self.layout_line_widths = {}
	self.glyph_line_count = 0
	self._page_height = gx_vram.page_size >> 16
	self:set_text(opts.text)
	return self
end

local write_lines<const> = function(self, lines, first_index, line_count)
	local glyph_lines<const> = self.glyph_lines
	local layout_line_widths<const> = self.layout_line_widths
	local has_glyphs = false
	for i = 1, line_count do
		local line<const> = lines[first_index + i - 1]
		local glyph_line = glyph_lines[i]
		if glyph_line == nil then
			glyph_line = {}
			glyph_lines[i] = glyph_line
		end
		layout_line_widths[i] = font_catalog.write_glyph_range(self.font, line, 1, #line, glyph_line)
		if #line ~= 0 then
			has_glyphs = true
		end
	end
	self.glyph_line_count = line_count
	if has_glyphs then
		self:set_draw_function(text_component.draw_visual)
	else
		self:set_draw_function(nil)
	end
end

-- Authored line breaks remain part of one string resource. Layout writes each
-- source range directly into its retained glyph row; it never allocates
-- substring or split tables just to discover the text's line structure.
local write_string_lines<const> = function(self, text)
	local glyph_lines<const> = self.glyph_lines
	local layout_line_widths<const> = self.layout_line_widths
	local text_length<const> = #text
	local line_start = 1
	local line_count = 0
	local has_glyphs = false
	while true do
		local newline<const> = find(text, '\n', line_start, true)
		local line_end = text_length
		if newline ~= nil then
			line_end = newline - 1
		end
		line_count = line_count + 1
		local glyph_line = glyph_lines[line_count]
		if glyph_line == nil then
			glyph_line = {}
			glyph_lines[line_count] = glyph_line
		end
		layout_line_widths[line_count] = font_catalog.write_glyph_range(
			self.font,
			text,
			line_start,
			line_end,
			glyph_line
		)
		if line_end >= line_start then
			has_glyphs = true
		end
		if newline == nil then
			break
		end
		line_start = newline + 1
	end
	self.glyph_line_count = line_count
	if has_glyphs then
		self:set_draw_function(text_component.draw_visual)
	else
		self:set_draw_function(nil)
	end
end

function text_component:set_text(text)
	self.text = text
	if type(text) == 'string' then
		if self.wrap_chars ~= nil and self.wrap_chars > 0 then
			local lines<const> = wrap_text_lines(text, self.wrap_chars)
			write_lines(self, lines, 1, #lines)
			return
		end
		write_string_lines(self, text)
		return
	end
	local lines<const> = text or empty_text_lines
	write_lines(self, lines, 1, #lines)
end

function text_component:set_font(font)
	if self.font == font then
		return
	end
	self.font = font
	self.line_height = font.line_height
	self:set_text(self.text)
end

function text_component:set_wrap_chars(wrap_chars)
	if self.wrap_chars == wrap_chars then
		return
	end
	self.wrap_chars = wrap_chars
	self:set_text(self.text)
end

function text_component:draw_visual(draw)
	local obj<const> = self.parent
	local x<const> = obj.x + self.offset_x + self.draw_offset_x
	local y<const> = obj.y + self.offset_y + self.draw_offset_y
	local glyphs<const> = self.glyph_lines
	local page_height<const> = self._page_height
	local first_line = 1
	local last_line = self.glyph_line_count
	local line_offsets<const> = self.line_offsets
	if line_offsets == nil then
		local line_height<const> = self.line_height
		if y >= page_height or y + last_line * line_height <= 0 then
			return
		end
		if y < 0 then
			first_line = ((-y) // line_height) + 1
		end
		local visible_last<const> = ((page_height - 1 - y) // line_height) + 1
		if visible_last < last_line then
			last_line = visible_last
		end
	end
	local background_color<const> = self.background_color
	if background_color ~= nil then
		local cursor_y = y + (first_line - 1) * self.line_height
		local line_widths<const> = self.line_widths or self.layout_line_widths
		local line_x_offsets<const> = self.line_x_offsets
		for i = first_line, last_line do
			local line<const> = glyphs[i]
			local line_y<const> = line_offsets ~= nil and (y + line_offsets[i]) or cursor_y
			local line_length<const> = line.visible_count
			if line_length > 0 then
				local line_x = x
				if line_x_offsets ~= nil then
					line_x = x + line_x_offsets[i]
				elseif self.center_block_width ~= nil then
					local line_width<const> = line_widths[i]
					line_x = x + ((self.center_block_width - line_width) // 2)
				end
				local x_offsets<const> = line.x_offsets
				for glyph_index = 1, line_length do
					local glyph<const> = line[glyph_index]
					local glyph_x<const> = line_x + x_offsets[glyph_index]
					draw:rect(glyph_x, line_y, glyph_x + glyph.width, line_y + glyph.height, background_color)
				end
			end
			if line_offsets == nil then
				cursor_y = cursor_y + self.line_height
			end
		end
	end
	self:render_glyphs(draw, x, y, first_line, last_line)
end

function text_component:render_glyphs(draw, x, y, first_line, last_line)
	local glyphs<const> = self.glyph_lines
	local span_binding<const> = self.font.span_binding
	local blit_span<const> = span_binding.writer
	local uniform_draw_mode_source<const> = span_binding.uniform_draw_mode_source
	local cursor_y = y + (first_line - 1) * self.line_height
	local line_offsets<const> = self.line_offsets
	local line_widths<const> = self.line_widths or self.layout_line_widths
	local line_x_offsets<const> = self.line_x_offsets
	local color<const> = self.color
	for i = first_line, last_line do
		local line<const> = glyphs[i]
		local line_y<const> = line_offsets ~= nil and (y + line_offsets[i]) or cursor_y
		local line_length<const> = line.visible_count
		if line_length > 0 then
			local line_x = x
			if line_x_offsets ~= nil then
				line_x = x + line_x_offsets[i]
			elseif self.center_block_width ~= nil then
				local line_width<const> = line_widths[i]
				line_x = x + ((self.center_block_width - line_width) // 2)
			end
			blit_span(
				draw,
				line,
				line.x_offsets,
				1,
				line_length,
				line_x,
				line_y,
				color,
				uniform_draw_mode_source)
		end
		if line_offsets == nil then
			cursor_y = cursor_y + self.line_height
		end
	end
end

-- Glyph-row reveals select a separate retained renderer. Ordinary text keeps
-- the span writer above and therefore pays no clip-mode branch per glyph.
function text_component:render_visible_glyph_rows(draw, x, y, first_line, last_line)
	local visible_height<const> = self.glyph_visible_height
	if visible_height == 0 then
		return
	end
	local glyphs<const> = self.glyph_lines
	local cursor_y = y + (first_line - 1) * self.line_height
	local line_offsets<const> = self.line_offsets
	local line_widths<const> = self.line_widths or self.layout_line_widths
	local line_x_offsets<const> = self.line_x_offsets
	local color<const> = self.color
	for i = first_line, last_line do
		local line<const> = glyphs[i]
		local line_y<const> = line_offsets ~= nil and (y + line_offsets[i]) or cursor_y
		local line_length<const> = line.visible_count
		if line_length > 0 then
			local line_x = x
			if line_x_offsets ~= nil then
				line_x = x + line_x_offsets[i]
			elseif self.center_block_width ~= nil then
				local line_width<const> = line_widths[i]
				line_x = x + ((self.center_block_width - line_width) // 2)
			end
			local x_offsets<const> = line.x_offsets
			for glyph_index = 1, line_length do
				local glyph<const> = line[glyph_index]
				glyph:draw_source_rect(
					draw,
					0, 0,
					glyph.width, visible_height,
					line_x + x_offsets[glyph_index], line_y,
					color,
					0,
					gp0.draw_mode_blend_half)
			end
		end
		if line_offsets == nil then
			cursor_y = cursor_y + self.line_height
		end
	end
end

-- Selects a top-to-bottom glyph reveal measured in source rows. A full-height
-- value restores the ordinary span renderer instead of leaving normal text on
-- the per-glyph clipped path.
function text_component:set_glyph_visible_height(height)
	if height == self.line_height then
		height = nil
	end
	self.glyph_visible_height = height
	if height == nil then
		self.render_glyphs = nil
	else
		self.render_glyphs = text_component.render_visible_glyph_rows
	end
end

return text_component
