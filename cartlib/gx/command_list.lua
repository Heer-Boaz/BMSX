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

-- GP0 textured-rectangle packets are written through a forward cursor. The
-- named layout keeps packet structure explicit while constant field offsets
-- lower to displaced stores; dynamic words[index + n] addressing would repeat
-- index scaling for every operand in the packet.
struct gp0_textured_rectangle_packet
	command: word
	position: word
	uv: word
	size: word
end

local textured_rectangle_packet_size<const> = sizeof(gp0_textured_rectangle_packet)

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

function command_list.begin(draw, draw_mode, target_origin)
	local words<const>: *word = draw.words
	words[0] = gp0.draw_mode | draw_mode
	draw.word_count = 1
	draw.draw_mode = draw_mode
	local target_x<const> = target_origin & 0x0000ffff
	local target_y<const> = target_origin >> 16
	draw.target_x = target_x
	draw.target_y = target_y
	local drawing_offset<const> = gp0.drawing_offset_word(target_x, target_y)
	draw.base_drawing_offset = drawing_offset
	draw.drawing_offset = drawing_offset
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

-- An admitted image source is itself the ordinary unflipped raw packet
-- binding. Modulated draws use the source's draw datapath instead; raw blits
-- never decode a color merely to rediscover the GP0 raw-texture opcode.
function command_list.blit(source, draw, x, y)
	local words<const>: *word = draw.words
	local target: *word = words + draw.word_count * sizeof(word)
	local draw_mode<const> = source._blit_draw_mode
	if draw_mode ~= draw.draw_mode then
		*target = gp0.draw_mode | draw_mode
		target = target + sizeof(word)
		draw.draw_mode = draw_mode
	end
	local packet<const>: *gp0_textured_rectangle_packet = target
	packet.command = gp0.draw_raw_textured_rectangle | 0x00808080
	packet.position = gp0.pair16(x, y)
	packet.uv = source._blit_uv_word
	packet.size = source._size_word
	target = target + textured_rectangle_packet_size
	draw.word_count = (target - words) >> 2
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

-- Resolved image sources carry placement-dependent draw-mode and UV words.
-- Text layout retains their dense source view and integral x offsets. Round the
-- translated span origin once; adding an integral glyph offset preserves the
-- exact GP0 coordinate word without repeating coordinate conversion per glyph.
function command_list.blit_span(draw, glyphs, x_offsets, first_index, last_index, x, y, color)
	local words<const>: *word = draw.words
	local target: *word = words + draw.word_count * sizeof(word)
	local draw_mode = draw.draw_mode
	local base_position<const> = gp0.pair16(x, y)
	local base_x<const> = base_position & 0x0000ffff
	local position_y<const> = base_position & 0xffff0000
	local command
	if (color & 0x00ffffff) == 0x00ffffff then
		command = gp0.draw_raw_textured_rectangle | 0x00808080
	else
		command = gp0.draw_textured_rectangle | gp0.argb_to_texture_rgb(color)
	end
	for glyph_index = first_index, last_index do
		local source<const> = glyphs[glyph_index].source
		local next_draw_mode<const> = source._blit_draw_mode
		if next_draw_mode ~= draw_mode then
			*target = gp0.draw_mode | next_draw_mode
			target = target + sizeof(word)
			draw_mode = next_draw_mode
		end
		local packet<const>: *gp0_textured_rectangle_packet = target
		packet.command = command
		packet.position = position_y | ((base_x + x_offsets[glyph_index]) & 0x0000ffff)
		packet.uv = source._blit_uv_word
		packet.size = source._size_word
		target = target + textured_rectangle_packet_size
	end
	draw.word_count = (target - words) >> 2
	draw.draw_mode = draw_mode
end

-- Retained tile rows preserve authored row-major order. The common single
-- coordinate-domain path never reads a per-tile domain selector; maps crossing
-- the GP0 signed-coordinate boundary use the separate stateful path below.
local emit_single_domain_tile_rows<const> = function(
	target,
	rows,
	row_count,
	draw_mode
)
	local cursor: *word = target
	local command<const> = gp0.draw_raw_textured_rectangle | 0x00808080
	for row_index = 1, row_count do
		local row<const> = rows[row_index]
		local sources<const> = row.sources
		local position_words<const> = row.position_words
		for source_index = row.first_visible_source, row.last_visible_source do
			local source<const> = sources[source_index]
			local next_draw_mode<const> = source._blit_draw_mode
			if next_draw_mode ~= draw_mode then
				*cursor = gp0.draw_mode | next_draw_mode
				cursor = cursor + sizeof(word)
				draw_mode = next_draw_mode
			end
			local packet<const>: *gp0_textured_rectangle_packet = cursor
			packet.command = command
			packet.position = position_words[source_index]
			packet.uv = source._blit_uv_word
			packet.size = source._size_word
			cursor = cursor + textured_rectangle_packet_size
		end
	end
	return cursor, draw_mode
end

local emit_multi_domain_tile_rows<const> = function(
	target,
	rows,
	row_count,
	first_visible_column,
	coordinate_domain_columns,
	tile_size,
	offset_origin_x,
	offset_y,
	drawing_offset,
	draw_mode
)
	local cursor: *word = target
	local command<const> = gp0.draw_raw_textured_rectangle | 0x00808080
	local coordinate_domain = 0
	for row_index = 1, row_count do
		local row<const> = rows[row_index]
		local coordinate_domains<const> = row.coordinate_domains
		local sources<const> = row.sources
		local position_words<const> = row.position_words
		for source_index = row.first_visible_source, row.last_visible_source do
			local next_coordinate_domain<const> = coordinate_domains[source_index]
			if next_coordinate_domain ~= coordinate_domain then
				coordinate_domain = next_coordinate_domain
				local domain_first_column<const> = ((coordinate_domain - 1) * coordinate_domain_columns) + 1
				local offset_x<const> = offset_origin_x
					+ ((domain_first_column - first_visible_column) * tile_size)
				local next_drawing_offset<const> = gp0.drawing_offset_word(offset_x, offset_y)
				if next_drawing_offset ~= drawing_offset then
					*cursor = next_drawing_offset
					cursor = cursor + sizeof(word)
					drawing_offset = next_drawing_offset
				end
			end
			local source<const> = sources[source_index]
			local next_draw_mode<const> = source._blit_draw_mode
			if next_draw_mode ~= draw_mode then
				*cursor = gp0.draw_mode | next_draw_mode
				cursor = cursor + sizeof(word)
				draw_mode = next_draw_mode
			end
			local packet<const>: *gp0_textured_rectangle_packet = cursor
			packet.command = command
			packet.position = position_words[source_index]
			packet.uv = source._blit_uv_word
			packet.size = source._size_word
			cursor = cursor + textured_rectangle_packet_size
		end
	end
	return cursor, drawing_offset, draw_mode
end

function command_list.tile_layer(
	draw,
	rows,
	row_count,
	first_visible_column,
	last_visible_column,
	coordinate_domain_columns,
	tile_size,
	origin_x,
	origin_y
)
	local words<const>: *word = draw.words
	local target: *word = words + draw.word_count * sizeof(word)
	local draw_mode = draw.draw_mode
	local drawing_offset = draw.drawing_offset
	local offset_y<const> = draw.target_y + origin_y
	local first_coordinate_domain<const> = ((first_visible_column - 1) // coordinate_domain_columns) + 1
	local last_coordinate_domain<const> = ((last_visible_column - 1) // coordinate_domain_columns) + 1
	if first_coordinate_domain == last_coordinate_domain then
		local domain_first_column<const> = ((first_coordinate_domain - 1) * coordinate_domain_columns) + 1
		local offset_x<const> = draw.target_x + origin_x
			+ ((domain_first_column - first_visible_column) * tile_size)
		local next_drawing_offset<const> = gp0.drawing_offset_word(offset_x, offset_y)
		if next_drawing_offset ~= drawing_offset then
			*target = next_drawing_offset
			target = target + sizeof(word)
			drawing_offset = next_drawing_offset
		end
		target, draw_mode = emit_single_domain_tile_rows(
			target,
			rows,
			row_count,
			draw_mode
		)
	else
		target, drawing_offset, draw_mode = emit_multi_domain_tile_rows(
			target,
			rows,
			row_count,
			first_visible_column,
			coordinate_domain_columns,
			tile_size,
			draw.target_x + origin_x,
			offset_y,
			drawing_offset,
			draw_mode
		)
	end
	local base_drawing_offset<const> = draw.base_drawing_offset
	if drawing_offset ~= base_drawing_offset then
		*target = base_drawing_offset
		target = target + sizeof(word)
	end
	draw.word_count = (target - words) >> 2
	draw.draw_mode = draw_mode
	draw.drawing_offset = base_drawing_offset
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
