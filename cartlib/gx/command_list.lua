local dma<const> = require('cartlib/dma')
local gp0<const> = require('cartlib/gx/gp0')
local gx_gpu<const> = require('cartlib/gx/gpu')
local irq<const> = require('cartlib/irq')

local gpu_completion_sequence = 0

local on_gpu_irq<const> = function()
	gpu_completion_sequence = gpu_completion_sequence + 1
	gx_gpu.ack_irq()
end

local function init_gpu_irq<init>()
	irq.register(gx_gpu.irq_mask, on_gpu_irq)
end
init_gpu_irq()

local draw_list<const> = {}
draw_list.__index = draw_list

local command_list<const> = {}

function command_list.submit(draw)
	dma.wait0_idle()
	dma.wait1_idle()
	dma.copy_to_gp0(draw.words, draw.word_count)
	dma.wait0_idle()
	draw.word_count = 0
end

local reserve_atomic<const> = function(draw, command_words)
	local word_count = draw.word_count
	local block_words_remaining<const> = dma.block_words - (word_count & (dma.block_words - 1))
	if command_words <= block_words_remaining then
		return word_count
	end
	local padding<const> = block_words_remaining
	local words<const>: *word = draw.words
	for index = word_count, word_count + padding - 1 do
		words[index] = gp0.nop
	end
	word_count = word_count + padding
	return word_count
end

function command_list.new(words)
	return setmetatable({
		words = words,
		word_count = 0,
		draw_mode = gp0.draw_mode_blend_half,
	}, draw_list)
end

function command_list.begin(draw, draw_mode)
	local words<const>: *word = draw.words
	words[0] = gp0.draw_mode | draw_mode
	draw.word_count = 1
	draw.draw_mode = draw_mode
end

function command_list.submit_fenced(draw)
	local index<const> = draw.word_count
	local words<const>: *word = draw.words
	words[index] = gp0.irq_request
	draw.word_count = index + 1
	local completion_sequence<const> = gpu_completion_sequence
	command_list.submit(draw)
	while gpu_completion_sequence == completion_sequence do
		halt_until_irq
	end
end

function draw_list:clear(origin_word, size_word, color)
	local index<const> = self.word_count
	local words<const>: *word = self.words
	words[index] = gp0.fill_rectangle | gp0.argb_to_rgb(color)
	words[index + 1] = origin_word
	words[index + 2] = size_word
	self.word_count = index + 3
end

function draw_list:mode(draw_mode)
	if draw_mode == self.draw_mode then
		return
	end
	local index<const> = self.word_count
	local words<const>: *word = self.words
	words[index] = gp0.draw_mode | draw_mode
	self.word_count = index + 1
	self.draw_mode = draw_mode
end

function draw_list:mask(mode_word)
	local index<const> = self.word_count
	local words<const>: *word = self.words
	words[index] = gp0.mask_bit_mode | mode_word
	self.word_count = index + 1
end

local emit_rect_color<const> = function(self, opcode, x0, y0, x1, y1, color)
	local index<const> = self.word_count
	local words<const>: *word = self.words
	words[index] = opcode | gp0.argb_to_rgb(color)
	words[index + 1] = gp0.pair16(x0, y0)
	words[index + 2] = gp0.pair16(x1 - x0, y1 - y0)
	self.word_count = index + 3
end

function draw_list:rect(x0, y0, x1, y1, color)
	emit_rect_color(self, gp0.draw_rectangle, x0, y0, x1, y1, color)
end

function draw_list:semitransparent_rect(x0, y0, x1, y1, color)
	emit_rect_color(self, gp0.draw_semitransparent_rectangle, x0, y0, x1, y1, color)
end

function draw_list:line(x0, y0, x1, y1, color)
	local index<const> = reserve_atomic(self, 3)
	local words<const>: *word = self.words
	words[index] = gp0.draw_line | gp0.argb_to_rgb(color)
	words[index + 1] = gp0.pair16(x0, y0)
	words[index + 2] = gp0.pair16(x1, y1)
	self.word_count = index + 3
end

local emit_quad_color<const> = function(self, opcode, x0, y0, x1, y1, x2, y2, x3, y3, color)
	local index<const> = reserve_atomic(self, 5)
	local words<const>: *word = self.words
	words[index] = opcode | gp0.argb_to_rgb(color)
	words[index + 1] = gp0.pair16(x0, y0)
	words[index + 2] = gp0.pair16(x1, y1)
	words[index + 3] = gp0.pair16(x2, y2)
	words[index + 4] = gp0.pair16(x3, y3)
	self.word_count = index + 5
end

function draw_list:quad(x0, y0, x1, y1, x2, y2, x3, y3, color)
	emit_quad_color(self, gp0.draw_quad, x0, y0, x1, y1, x2, y2, x3, y3, color)
end

function draw_list:semitransparent_quad(x0, y0, x1, y1, x2, y2, x3, y3, color)
	emit_quad_color(self, gp0.draw_semitransparent_quad, x0, y0, x1, y1, x2, y2, x3, y3, color)
end

function draw_list:triangle(x0, y0, x1, y1, x2, y2, color)
	local index<const> = reserve_atomic(self, 4)
	local words<const>: *word = self.words
	words[index] = gp0.draw_triangle | gp0.argb_to_rgb(color)
	words[index + 1] = gp0.pair16(x0, y0)
	words[index + 2] = gp0.pair16(x1, y1)
	words[index + 3] = gp0.pair16(x2, y2)
	self.word_count = index + 4
end

function draw_list:gouraud_triangle(x0, y0, color0, x1, y1, color1, x2, y2, color2)
	local index<const> = reserve_atomic(self, 6)
	local words<const>: *word = self.words
	words[index] = gp0.draw_gouraud_triangle | gp0.argb_to_rgb(color0)
	words[index + 1] = gp0.pair16(x0, y0)
	words[index + 2] = gp0.argb_to_rgb(color1)
	words[index + 3] = gp0.pair16(x1, y1)
	words[index + 4] = gp0.argb_to_rgb(color2)
	words[index + 5] = gp0.pair16(x2, y2)
	self.word_count = index + 6
end

function draw_list:direct16_rect(source_x, source_y, x, y, width, height, color, rectangle_flip_mode, blend_mode)
	local texture_x<const> = (rectangle_flip_mode & gp0.draw_mode_texture_rectangle_x_flip) ~= 0 and source_x + width - 1 or source_x
	local texture_y<const> = (rectangle_flip_mode & gp0.draw_mode_texture_rectangle_y_flip) ~= 0 and source_y + height - 1 or source_y
	local draw_mode<const> = gp0.direct16_draw_mode(texture_x, texture_y, blend_mode) | rectangle_flip_mode
	self:mode(draw_mode)
	local index<const> = self.word_count
	local words<const>: *word = self.words
	if (color & 0x00ffffff) == 0x00ffffff then
		words[index] = gp0.draw_raw_textured_rectangle | 0x00808080
	else
		words[index] = gp0.draw_textured_rectangle | gp0.argb_to_texture_rgb(color)
	end
	words[index + 1] = gp0.pair16(x, y)
	words[index + 2] = gp0.uv(texture_x, texture_y)
	words[index + 3] = gp0.pair16(width, height)
	self.word_count = index + 4
end

-- The ordinary image path admits an unflipped rectangle with its packed size
-- already retained by the image source. Keep that path separate from the
-- transformed rectangle encoder: it must not redo flip selection or repack an
-- immutable image size for every submission.
function draw_list:direct16_blit(source_x, source_y, x, y, size_word, color)
	self:mode(gp0.direct16_draw_mode(source_x, source_y, gp0.draw_mode_blend_half))
	local index<const> = self.word_count
	local words<const>: *word = self.words
	if (color & 0x00ffffff) == 0x00ffffff then
		words[index] = gp0.draw_raw_textured_rectangle | 0x00808080
	else
		words[index] = gp0.draw_textured_rectangle | gp0.argb_to_texture_rgb(color)
	end
	words[index + 1] = gp0.pair16(x, y)
	words[index + 2] = gp0.uv(source_x, source_y)
	words[index + 3] = size_word
	self.word_count = index + 4
end

function draw_list:palette4_rect(texture_x, clut_x, clut_y, source_x, source_y, x, y, width, height, color, rectangle_flip_mode, blend_mode)
	local texture_source_x<const> = (rectangle_flip_mode & gp0.draw_mode_texture_rectangle_x_flip) ~= 0 and source_x + width - 1 or source_x
	local texture_source_y<const> = (rectangle_flip_mode & gp0.draw_mode_texture_rectangle_y_flip) ~= 0 and source_y + height - 1 or source_y
	local draw_mode<const> = gp0.palette4_draw_mode(texture_x, texture_source_x, texture_source_y, blend_mode) | rectangle_flip_mode
	self:mode(draw_mode)
	local index<const> = self.word_count
	local words<const>: *word = self.words
	if (color & 0x00ffffff) == 0x00ffffff then
		words[index] = gp0.draw_raw_textured_rectangle | 0x00808080
	else
		words[index] = gp0.draw_textured_rectangle | gp0.argb_to_texture_rgb(color)
	end
	words[index + 1] = gp0.pair16(x, y)
	words[index + 2] = gp0.uv_clut(texture_source_x, texture_source_y, clut_x, clut_y)
	words[index + 3] = gp0.pair16(width, height)
	self.word_count = index + 4
end

function draw_list:palette4_blit(texture_x, clut_x, clut_y, source_x, source_y, x, y, size_word, color)
	self:mode(gp0.palette4_draw_mode(texture_x, source_x, source_y, gp0.draw_mode_blend_half))
	local index<const> = self.word_count
	local words<const>: *word = self.words
	if (color & 0x00ffffff) == 0x00ffffff then
		words[index] = gp0.draw_raw_textured_rectangle | 0x00808080
	else
		words[index] = gp0.draw_textured_rectangle | gp0.argb_to_texture_rgb(color)
	end
	words[index + 1] = gp0.pair16(x, y)
	words[index + 2] = gp0.uv_clut(source_x, source_y, clut_x, clut_y)
	words[index + 3] = size_word
	self.word_count = index + 4
end

-- Retained text/image layout submits consecutive blits through these span
-- writers. Texture placement remains live owner state, while packet color,
-- word storage and the current draw mode are resolved once per span instead of
-- redispatched through image and draw-list methods for every rectangle.
function command_list.direct16_blit_span(draw, texture, glyphs, x_offsets, first_index, last_index, x, y, color)
	local words<const>: *word = draw.words
	local index = draw.word_count
	local draw_mode = draw.draw_mode
	local texture_x<const> = texture.x
	local texture_y<const> = texture.y
	local command
	if (color & 0x00ffffff) == 0x00ffffff then
		command = gp0.draw_raw_textured_rectangle | 0x00808080
	else
		command = gp0.draw_textured_rectangle | gp0.argb_to_texture_rgb(color)
	end
	for glyph_index = first_index, last_index do
		local glyph<const> = glyphs[glyph_index]
		local source_x<const> = texture_x + glyph.source_x
		local source_y<const> = texture_y + glyph.source_y
		local next_draw_mode<const> = gp0.direct16_draw_mode(source_x, source_y, gp0.draw_mode_blend_half)
		if next_draw_mode ~= draw_mode then
			words[index] = gp0.draw_mode | next_draw_mode
			index = index + 1
			draw_mode = next_draw_mode
		end
		words[index] = command
		words[index + 1] = gp0.pair16(x + x_offsets[glyph_index], y)
		words[index + 2] = gp0.uv(source_x, source_y)
		words[index + 3] = glyph.size_word
		index = index + 4
	end
	draw.word_count = index
	draw.draw_mode = draw_mode
end

function command_list.palette4_blit_span(draw, texture, glyphs, x_offsets, first_index, last_index, x, y, color)
	local words<const>: *word = draw.words
	local index = draw.word_count
	local draw_mode = draw.draw_mode
	local texture_x<const> = texture.x
	local texture_y<const> = texture.y
	local clut_x<const> = texture.clut_x
	local clut_y<const> = texture.clut_y
	local command
	if (color & 0x00ffffff) == 0x00ffffff then
		command = gp0.draw_raw_textured_rectangle | 0x00808080
	else
		command = gp0.draw_textured_rectangle | gp0.argb_to_texture_rgb(color)
	end
	for glyph_index = first_index, last_index do
		local glyph<const> = glyphs[glyph_index]
		local source_x<const> = glyph.source_x
		local source_y<const> = texture_y + glyph.source_y
		local next_draw_mode<const> = gp0.palette4_draw_mode(texture_x, source_x, source_y, gp0.draw_mode_blend_half)
		if next_draw_mode ~= draw_mode then
			words[index] = gp0.draw_mode | next_draw_mode
			index = index + 1
			draw_mode = next_draw_mode
		end
		words[index] = command
		words[index + 1] = gp0.pair16(x + x_offsets[glyph_index], y)
		words[index + 2] = gp0.uv_clut(source_x, source_y, clut_x, clut_y)
		words[index + 3] = glyph.size_word
		index = index + 4
	end
	draw.word_count = index
	draw.draw_mode = draw_mode
end

function draw_list:direct16_quad(
	page_source_x, page_source_y,
	source_x0, source_y0,
	source_x1, source_y1,
	source_x2, source_y2,
	source_x3, source_y3,
	x0, y0,
	x1, y1,
	x2, y2,
	x3, y3,
	color,
	blend_mode)
	local draw_mode<const> = gp0.direct16_draw_mode(page_source_x, page_source_y, blend_mode)
	self:mode(draw_mode)
	local index<const> = reserve_atomic(self, 9)
	local words<const>: *word = self.words
	if (color & 0x00ffffff) == 0x00ffffff then
		words[index] = gp0.draw_raw_textured_quad | 0x00808080
	else
		words[index] = gp0.draw_textured_quad | gp0.argb_to_texture_rgb(color)
	end
	words[index + 1] = gp0.pair16(x0, y0)
	words[index + 2] = gp0.uv(source_x0, source_y0)
	words[index + 3] = gp0.pair16(x1, y1)
	words[index + 4] = gp0.uv_texpage(source_x1, source_y1, draw_mode)
	words[index + 5] = gp0.pair16(x2, y2)
	words[index + 6] = gp0.uv(source_x2, source_y2)
	words[index + 7] = gp0.pair16(x3, y3)
	words[index + 8] = gp0.uv(source_x3, source_y3)
	self.word_count = index + 9
end

function draw_list:palette4_quad(
	texture_x, clut_x, clut_y,
	page_source_x, page_source_y,
	source_x0, source_y0,
	source_x1, source_y1,
	source_x2, source_y2,
	source_x3, source_y3,
	x0, y0,
	x1, y1,
	x2, y2,
	x3, y3,
	color,
	blend_mode)
	local draw_mode<const> = gp0.palette4_draw_mode(texture_x, page_source_x, page_source_y, blend_mode)
	self:mode(draw_mode)
	local index<const> = reserve_atomic(self, 9)
	local words<const>: *word = self.words
	if (color & 0x00ffffff) == 0x00ffffff then
		words[index] = gp0.draw_raw_textured_quad | 0x00808080
	else
		words[index] = gp0.draw_textured_quad | gp0.argb_to_texture_rgb(color)
	end
	words[index + 1] = gp0.pair16(x0, y0)
	words[index + 2] = gp0.uv_clut(source_x0, source_y0, clut_x, clut_y)
	words[index + 3] = gp0.pair16(x1, y1)
	words[index + 4] = gp0.uv_texpage(source_x1, source_y1, draw_mode)
	words[index + 5] = gp0.pair16(x2, y2)
	words[index + 6] = gp0.uv(source_x2, source_y2)
	words[index + 7] = gp0.pair16(x3, y3)
	words[index + 8] = gp0.uv(source_x3, source_y3)
	self.word_count = index + 9
end


return command_list
