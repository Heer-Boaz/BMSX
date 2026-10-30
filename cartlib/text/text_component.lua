local font_catalog<const> = require('cartlib/text/font_catalog')
local gp0<const> = require('cartlib/gx/gp0')
local gx_vram<const> = require('cartlib/gx/vram')
local visual_2d_component<const> = require('cartlib/component/visual_2d_component')
local affine2<const> = require('cartlib/math/affine2')
local affine_batch<const> = require('cartlib/gx/affine_batch')
local shallow_copy<const> = require('cartlib/util/shallow_copy')
local wrap_text_lines<const> = require('cartlib/util/text').wrap_text_lines
local empty_text_lines<const> = {}
local empty_definition<const> = {}
local find<const> = string.find

local text_component<const> = {}
text_component.__index = text_component
setmetatable(text_component, { __index = visual_2d_component })

-- Rich text installs its wrapped rows itself. Common initialization prepares
-- that same final component without admitting a throwaway unwrapped layout.
function text_component._initialize(self, input, defaults)
	if defaults == nil then defaults = empty_definition end
	self.font = input.font
	if self.font == nil then self.font = defaults.font end
	if self.font == nil then self.font = font_catalog.get('default') end
	self.line_height = input.line_height
	if self.line_height == nil then self.line_height = defaults.line_height end
	if self.line_height == nil then self.line_height = self.font.line_height end
	self.color = input.color
	if self.color == nil then self.color = defaults.color end
	if self.color == nil then self.color = 0xffffffff end
	self.background_color = input.background_color
	if self.background_color == nil then self.background_color = defaults.background_color end
	self.wrap_chars = input.wrap_chars
	if self.wrap_chars == nil then self.wrap_chars = defaults.wrap_chars end
	self.line_offsets = input.line_offsets
	if self.line_offsets == nil then self.line_offsets = defaults.line_offsets end
	self.line_widths = input.line_widths
	if self.line_widths == nil then self.line_widths = defaults.line_widths end
	self.line_x_offsets = input.line_x_offsets
	if self.line_x_offsets == nil then self.line_x_offsets = defaults.line_x_offsets end
	self.center_block_width = input.center_block_width
	if self.center_block_width == nil then self.center_block_width = defaults.center_block_width end
	self.text = nil
	self.glyph_lines = {}
	self.layout_line_widths = {}
	self.glyph_line_count = 0
	self._page_width = gx_vram.page_size & 0xffff
	self._page_height = gx_vram.page_size >> 16
	self._layout_revision = 0
	self._bounds_basis_revision = -1
	self._bounds_layout_revision = -1
end

function text_component.new(context, id_local, defaults)
	if id_local == nil then id_local = 'text' end
	local self<const>, input<const> = visual_2d_component.new(context, id_local, defaults)
	setmetatable(self, text_component)
	text_component._initialize(self, input, defaults)
	local text = input.text
	if text == nil and defaults ~= nil then text = defaults.text end
	self:set_text(text)
	return self
end

function text_component.factory(definition)
	local defaults<const> = shallow_copy(definition)
	return function(context)
		return text_component.new(context, defaults.id_local, defaults)
	end
end

function text_component:_update_reveal_bounds()
	local top, bottom = self._source_layout_top, self._source_layout_bottom
	local uniform_line_cull = self._source_uniform_line_cull
	local height<const> = self.glyph_visible_height
	if height ~= nil then
		local reveal_top<const> = self._min_line_y + height
		local reveal_bottom<const> = self._max_line_y + height
		if reveal_top < top then top = reveal_top end
		if reveal_bottom > bottom then bottom = reveal_bottom end
		if height < 0 or height > self.line_height then uniform_line_cull = false end
	end
	self._layout_top, self._layout_bottom = top, bottom
	self._uniform_line_cull = uniform_line_cull
	self._layout_revision = self._layout_revision + 1
end

function text_component:_rebuild_layout_bounds()
	local glyphs<const> = self.glyph_lines
	local line_offsets<const> = self.line_offsets
	local line_widths<const> = self.line_widths or self.layout_line_widths
	local line_x_offsets<const> = self.line_x_offsets
	local center_width<const> = self.center_block_width
	local left, top, right, bottom = 0, 0, 0, 0
	local min_line_y, max_line_y = 0, 0
	local empty = true
	local uniform_line_cull = line_offsets == nil and self.line_height > 0
	for index = 1, self.glyph_line_count do
		local line<const> = glyphs[index]
		if line.glyph_count > 0 then
			local x = 0
			if line_x_offsets ~= nil then
				x = line_x_offsets[index]
			elseif center_width ~= nil then
				x = (center_width - line_widths[index]) // 2
			end
			local y<const> = line_offsets ~= nil and line_offsets[index] or ((index - 1) * self.line_height)
			local height<const> = line.geometry_bottom
			local line_left<const>, line_right<const> = x + line.geometry_left, x + line.geometry_right
			local line_bottom<const> = y + height
			if empty then
				left, top, right, bottom = line_left, y, line_right, line_bottom
				min_line_y, max_line_y = y, y
				empty = false
			else
				if line_left < left then left = line_left end
				if y < top then top = y end
				if line_right > right then right = line_right end
				if line_bottom > bottom then bottom = line_bottom end
				if y < min_line_y then min_line_y = y end
				if y > max_line_y then max_line_y = y end
			end
			if height > self.line_height then uniform_line_cull = false end
		end
	end
	self._layout_left, self._layout_right = left, right
	self._source_layout_top, self._source_layout_bottom = top, bottom
	self._min_line_y, self._max_line_y = min_line_y, max_line_y
	self._layout_empty = empty
	self._source_uniform_line_cull = uniform_line_cull
	self:_update_reveal_bounds()
end

function text_component:_layout_visible()
	if self._layout_empty then return false end
	if self._bounds_basis_revision ~= self._visual_basis_revision
	or self._bounds_layout_revision ~= self._layout_revision then
		self._bounds_left, self._bounds_top, self._bounds_right, self._bounds_bottom = affine2.basis_bounds(
			self.wxx, self.wxy, self.wyx, self.wyy,
			self._layout_left, self._layout_top, self._layout_right, self._layout_bottom)
		self._bounds_basis_revision = self._visual_basis_revision
		self._bounds_layout_revision = self._layout_revision
	end
	return self.wox + self._bounds_right > 0 and self.wox + self._bounds_left < self._page_width
		and self.woy + self._bounds_bottom > 0 and self.woy + self._bounds_top < self._page_height
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
	self:_rebuild_layout_bounds()
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
	self:_rebuild_layout_bounds()
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

function text_component:set_center_block_width(width)
	if self.center_block_width == width then return end
	self.center_block_width = width
	self:_rebuild_layout_bounds()
end

function text_component:set_line_height(height)
	if self.line_height == height then return end
	self.line_height = height
	self:_rebuild_layout_bounds()
end

function text_component:draw_visual(draw)
	self:resolve_pose()
	if not self:_layout_visible() then return end
	local x<const>, y<const> = self.wox, self.woy
	local glyphs<const> = self.glyph_lines
	local page_height<const> = self._page_height
	local first_line = 1
	local last_line = self.glyph_line_count
	local line_offsets<const> = self.line_offsets
	if self._translation_only and self._uniform_line_cull then
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
	if not self._translation_only then
		local xx<const>, xy<const>, yx<const>, yy<const> = self.wxx, self.wxy, self.wyx, self.wyy
		if background_color ~= nil then
			self:render_affine_backgrounds(draw, xx, xy, yx, yy, x, y, first_line, last_line)
		end
		self:render_affine_glyphs(draw, xx, xy, yx, yy, x, y, first_line, last_line)
		return
	end
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

function text_component:render_affine_backgrounds(draw, xx, xy, yx, yy, ox, oy, first_line, last_line)
	local glyphs<const> = self.glyph_lines
	local line_offsets<const> = self.line_offsets
	local line_widths<const> = self.line_widths or self.layout_line_widths
	local line_x_offsets<const> = self.line_x_offsets
	local center_width<const> = self.center_block_width
	local color<const> = self.background_color
	local cursor_y = (first_line - 1) * self.line_height
	for index = first_line, last_line do
		local line<const> = glyphs[index]
		local count<const> = line.visible_count
		if count > 0 then
			local x = 0
			if line_x_offsets ~= nil then
				x = line_x_offsets[index]
			elseif center_width ~= nil then
				x = (center_width - line_widths[index]) // 2
			end
			local y<const> = line_offsets ~= nil and line_offsets[index] or cursor_y
			affine_batch.glyph_rect_span(draw, line, line.x_offsets, 1, count, xx, xy, yx, yy,
				ox + xx*x + yx*y, oy + xy*x + yy*y, color)
		end
		if line_offsets == nil then cursor_y = cursor_y + self.line_height end
	end
end

function text_component:render_affine_glyphs(draw, xx, xy, yx, yy, ox, oy, first_line, last_line)
	local glyphs<const> = self.glyph_lines
	local line_offsets<const> = self.line_offsets
	local line_widths<const> = self.line_widths or self.layout_line_widths
	local line_x_offsets<const> = self.line_x_offsets
	local center_width<const> = self.center_block_width
	local color<const> = self.color
	local cursor_y = (first_line - 1) * self.line_height
	for index = first_line, last_line do
		local line<const> = glyphs[index]
		local count<const> = line.visible_count
		if count > 0 then
			local x = 0
			if line_x_offsets ~= nil then
				x = line_x_offsets[index]
			elseif center_width ~= nil then
				x = (center_width - line_widths[index]) // 2
			end
			local y<const> = line_offsets ~= nil and line_offsets[index] or cursor_y
			affine_batch.glyph_span(draw, line, line.x_offsets, 1, count, xx, xy, yx, yy,
				ox + xx*x + yx*y, oy + xy*x + yy*y, color)
		end
		if line_offsets == nil then cursor_y = cursor_y + self.line_height end
	end
end

function text_component:render_visible_affine_glyph_rows(draw, xx, xy, yx, yy, ox, oy, first_line, last_line)
	local height<const> = self.glyph_visible_height
	if height == 0 then return end
	local glyphs<const> = self.glyph_lines
	local line_offsets<const> = self.line_offsets
	local line_widths<const> = self.line_widths or self.layout_line_widths
	local line_x_offsets<const> = self.line_x_offsets
	local center_width<const> = self.center_block_width
	local color<const> = self.color
	local cursor_y = (first_line - 1) * self.line_height
	for index = first_line, last_line do
		local line<const> = glyphs[index]
		local count<const> = line.visible_count
		if count > 0 then
			local x = 0
			if line_x_offsets ~= nil then
				x = line_x_offsets[index]
			elseif center_width ~= nil then
				x = (center_width - line_widths[index]) // 2
			end
			local y<const> = line_offsets ~= nil and line_offsets[index] or cursor_y
			affine_batch.glyph_rows(draw, line, line.x_offsets, 1, count, height, xx, xy, yx, yy,
				ox + xx*x + yx*y, oy + xy*x + yy*y, color)
		end
		if line_offsets == nil then cursor_y = cursor_y + self.line_height end
	end
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
		self.render_affine_glyphs = nil
	else
		self.render_glyphs = text_component.render_visible_glyph_rows
		self.render_affine_glyphs = text_component.render_visible_affine_glyph_rows
	end
	self:_update_reveal_bounds()
end

local protected<const> = shallow_copy(visual_2d_component.timeline_channels.protected)
protected.text = true
protected.font = true
protected.wrap_chars = true
protected.line_height = true
protected.center_block_width = true
protected.glyph_visible_height = true
protected.glyph_lines = true
protected.line_offsets = true
protected.line_x_offsets = true
protected.line_widths = true
protected.layout_line_widths = true
local properties<const> = shallow_copy(visual_2d_component.timeline_channels.properties)
properties.text = text_component.set_text
properties.font = text_component.set_font
properties.wrap_chars = text_component.set_wrap_chars
properties.line_height = text_component.set_line_height
properties.center_block_width = text_component.set_center_block_width
properties.glyph_visible_height = text_component.set_glyph_visible_height
text_component.timeline_channels = {
	protected = protected,
	properties = properties,
	groups = visual_2d_component.timeline_channels.groups,
}

return text_component
