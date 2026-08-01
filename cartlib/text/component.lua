local component_types<const> = require('cartlib/components/types')
local font_module<const> = require('cartlib/font')
local gx_image<const> = require('cartlib/gx/image')
local gx_gpu<const> = require('cartlib/gx/gpu')
local visualcomponent<const> = require('cartlib/render/visual_component')
local wrap_text_lines<const> = require('cartlib/util/wrap_text_lines').wrap_text_lines
local empty_text_lines<const> = {}
local opaque_texture_blend_mode<const> = gx_gpu.draw_mode_blend_half

local textcomponent<const> = {}
textcomponent.__index = textcomponent
setmetatable(textcomponent, { __index = visualcomponent })

function textcomponent.new(opts)
	local self<const> = setmetatable(visualcomponent.new(opts, component_types.text), textcomponent)
	self.font = opts.font or font_module.get('default')
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
	self:set_text(opts.text)
	return self
end

function textcomponent:set_text(text)
	self.text = text
	if type(text) == 'string' then
		if self.wrap_chars ~= nil and self.wrap_chars > 0 then
			text = wrap_text_lines(text, self.wrap_chars)
		else
			local glyph_line = self.glyph_lines[1]
			if glyph_line == nil then
				glyph_line = {}
				self.glyph_lines[1] = glyph_line
			end
			self.layout_line_widths[1] = font_module.write_glyph_line(self.font, text, glyph_line)
			self.glyph_line_count = 1
			return
		end
	end
	local lines<const> = text or empty_text_lines
	local glyph_lines<const> = self.glyph_lines
	local layout_line_widths<const> = self.layout_line_widths
	for i = 1, #lines do
		local glyph_line = glyph_lines[i]
		if glyph_line == nil then
			glyph_line = {}
			glyph_lines[i] = glyph_line
		end
		layout_line_widths[i] = font_module.write_glyph_line(self.font, lines[i], glyph_line)
	end
	self.glyph_line_count = #lines
end

function textcomponent:set_font(font)
	if self.font == font then
		return
	end
	self.font = font
	self.line_height = font.line_height
	self:set_text(self.text)
end

function textcomponent:set_wrap_chars(wrap_chars)
	if self.wrap_chars == wrap_chars then
		return
	end
	self.wrap_chars = wrap_chars
	self:set_text(self.text)
end

function textcomponent:draw()
	local obj<const> = self.parent
	self:render(obj.x + self.offset_x + self.draw_offset_x, obj.y + self.offset_y + self.draw_offset_y)
end

function textcomponent:render_glyphs(x, y)
	local glyphs<const> = self.glyph_lines
	local cursor_y = y
	local line_offsets<const> = self.line_offsets
	local line_widths<const> = self.line_widths or self.layout_line_widths
	local line_x_offsets<const> = self.line_x_offsets
	local color<const> = self.color
	for i = 1, self.glyph_line_count do
		local line<const> = glyphs[i]
		local line_y<const> = line_offsets ~= nil and (y + line_offsets[i]) or cursor_y
		local line_length<const> = #line
		if line_length > 0 then
			local line_x = x
			if line_x_offsets ~= nil then
				line_x = x + line_x_offsets[i]
			elseif self.center_block_width ~= nil then
				local line_width<const> = line_widths[i]
				line_x = x + ((self.center_block_width - line_width) // 2)
			end
			local cursor_x = line_x
			for glyph_index = 1, line_length do
				local glyph<const> = line[glyph_index]
				gx_image.blit_rect_color(glyph.image, cursor_x, line_y, color, 0, opaque_texture_blend_mode)
				cursor_x = cursor_x + glyph.advance
			end
		end
		if line_offsets == nil then
			cursor_y = cursor_y + self.line_height
		end
	end
end

function textcomponent:render(x, y)
	local glyphs<const> = self.glyph_lines
	local background_color<const> = self.background_color
	if background_color ~= nil then
		local cursor_y = y
		local line_offsets<const> = self.line_offsets
		local line_widths<const> = self.line_widths or self.layout_line_widths
		local line_x_offsets<const> = self.line_x_offsets
		for i = 1, self.glyph_line_count do
			local line<const> = glyphs[i]
			local line_y<const> = line_offsets ~= nil and (y + line_offsets[i]) or cursor_y
			local line_length<const> = #line
			if line_length > 0 then
				local line_x = x
				if line_x_offsets ~= nil then
					line_x = x + line_x_offsets[i]
				elseif self.center_block_width ~= nil then
					local line_width<const> = line_widths[i]
					line_x = x + ((self.center_block_width - line_width) // 2)
				end
				local cursor_x = line_x
				for glyph_index = 1, line_length do
					local glyph<const> = line[glyph_index]
					gx_gpu.fill_rect_color(cursor_x, line_y, cursor_x + glyph.width, line_y + glyph.height, background_color)
					cursor_x = cursor_x + glyph.advance
				end
			end
			if line_offsets == nil then
				cursor_y = cursor_y + self.line_height
			end
		end
	end
	self:render_glyphs(x, y)
end

return textcomponent
