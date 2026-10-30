-- Affine geometry consumes the same admitted image/row/glyph records as the
-- rectangle datapaths. Resolve a pose at the batch owner, not per vertex.
local command_list<const> = require('cartlib/gx/command_list')
local gp0<const> = require('cartlib/gx/gp0')
local affine_batch<const> = {}
local reserve_atomic<const> = command_list.reserve_atomic

struct affine_textured_quad_packet
	command: word
	position0: word
	uv0: word
	position1: word
	uv1: word
	position2: word
	uv2: word
	position3: word
	uv3: word
end

-- One native primitive, including DMA block alignment and the central GP0
-- coordinate conversion. UV/page/CLUT words are published by atlas admission.
local emit_quad<const> = function(draw, source, x, y, ax, ay, bx, by, command)
	local draw_mode<const> = source._blit_draw_mode
	if draw_mode ~= draw.draw_mode then draw:mode(draw_mode) end
	local index<const> = reserve_atomic(draw, 9)
	local packet<const>: *affine_textured_quad_packet = draw.words + index * sizeof(word)
	packet.command = command
	packet.position0 = gp0.pair16(x, y)
	packet.uv0 = source._quad_uv0
	packet.position1 = gp0.pair16(x + ax, y + ay)
	packet.uv1 = source._quad_uv1
	packet.position2 = gp0.pair16(x + bx, y + by)
	packet.uv2 = source._quad_uv2
	packet.position3 = gp0.pair16(x + ax + bx, y + ay + by)
	packet.uv3 = source._quad_uv3
	draw.word_count = index + 9
end

local emit_color_quad<const> = function(draw, command, x, y, ax, ay, bx, by)
	draw:quad_words(command, gp0.pair16(x,y), gp0.pair16(x+ax,y+ay),
		gp0.pair16(x+bx,y+by), gp0.pair16(x+ax+bx,y+ay+by))
end

local texture_command<const> = function(color)
	if (color & 0x00ffffff) == 0x00ffffff then
		return gp0.draw_raw_textured_quad | 0x00808080
	end
	return gp0.draw_textured_quad | gp0.argb_to_texture_rgb(color)
end

function affine_batch.offset_span(draw, sources, xx, xy, yx, yy, ox, oy, color)
	local command<const> = texture_command(color)
	for index = 1, #sources do
		local source<const> = sources[index]
		local x<const>, y<const> = source.offset_x, source.offset_y
		emit_quad(draw, source, ox + xx*x + yx*y, oy + xy*x + yy*y,
			xx*source.width, xy*source.width, yx*source.height, yy*source.height, command)
	end
end

function affine_batch.glyph_span(draw, glyphs, x_offsets, first, last, xx, xy, yx, yy, ox, oy, color)
	local command<const> = texture_command(color)
	for index = first, last do
		local source<const> = glyphs[index]
		local x<const> = x_offsets[index]
		emit_quad(draw, source, ox + xx*x, oy + xy*x,
			xx*source.width, xy*source.width, yx*source.height, yy*source.height, command)
	end
end

-- Source-row cropping has its own packet loop. Ordinary text pays no reveal
-- branch and cropped glyphs retain their admitted page/CLUT representation.
function affine_batch.glyph_rows(draw, glyphs, x_offsets, first, last, visible_height, xx, xy, yx, yy, ox, oy, color)
	local command<const> = texture_command(color)
	local bx<const>, by<const> = yx*visible_height, yy*visible_height
	for glyph_index = first, last do
		local source<const> = glyphs[glyph_index]
		local draw_mode<const> = source._blit_draw_mode
		if draw_mode ~= draw.draw_mode then draw:mode(draw_mode) end
		local index<const> = reserve_atomic(draw, 9)
		local packet<const>: *affine_textured_quad_packet = draw.words + index * sizeof(word)
		local offset<const> = x_offsets[glyph_index]
		local x<const>, y<const> = ox + xx*offset, oy + xy*offset
		local ax<const>, ay<const> = xx*source.width, xy*source.width
		local bottom_v<const> = (((source._quad_uv0 >> 8) & 0xff) + visible_height - 1) & 0xff
		packet.command = command
		packet.position0 = gp0.pair16(x,y)
		packet.uv0 = source._quad_uv0
		packet.position1 = gp0.pair16(x+ax,y+ay)
		packet.uv1 = source._quad_uv1
		packet.position2 = gp0.pair16(x+bx,y+by)
		packet.uv2 = (source._quad_uv0 & 0xff) | (bottom_v << 8)
		packet.position3 = gp0.pair16(x+ax+bx,y+ay+by)
		packet.uv3 = (source._quad_uv1 & 0xff) | (bottom_v << 8)
		draw.word_count = index + 9
	end
end

function affine_batch.glyph_rect_span(draw, glyphs, x_offsets, first, last, xx, xy, yx, yy, ox, oy, color)
	local command<const> = gp0.draw_quad | gp0.argb_to_rgb(color)
	for index = first, last do
		local source<const> = glyphs[index]
		local x<const> = x_offsets[index]
		emit_color_quad(draw,command,ox+xx*x,oy+xy*x,
			xx*source.width,xy*source.width,yx*source.height,yy*source.height)
	end
end

function affine_batch.repeated_image(draw, source, first, last, step_x, step_y, xx, xy, yx, yy, ox, oy, color)
	local command<const> = texture_command(color)
	local dx<const>, dy<const> = xx*step_x + yx*step_y, xy*step_x + yy*step_y
	local ax<const>, ay<const> = xx*source.width, xy*source.width
	local bx<const>, by<const> = yx*source.height, yy*source.height
	local x, y = ox + first*dx, oy + first*dy
	for _ = first, last do
		emit_quad(draw, source, x, y, ax, ay, bx, by, command)
		x, y = x + dx, y + dy
	end
end

function affine_batch.tile_layer(draw, rows, row_count, first_column, tile_size, xx, xy, yx, yy, ox, oy)
	local command<const> = gp0.draw_raw_textured_quad | 0x00808080
	for row_index = 1, row_count do
		local row<const> = rows[row_index]
		local y<const> = (row.row_index - 1) * tile_size
		local base_x<const>, base_y<const> = ox + yx*y, oy + yy*y
		local sources<const>, columns<const> = row.sources, row.columns
		for index = row.first_visible_source, row.last_visible_source do
			local source<const> = sources[index]
			local x<const> = (columns[index] - first_column) * tile_size
			emit_quad(draw, source, base_x + xx*x, base_y + xy*x,
				xx*source.width, xy*source.width, yx*source.height, yy*source.height, command)
		end
	end
end

function affine_batch.rect_span(draw, indices, count, y_offsets, widths, height, xx, xy, yx, yy, ox, oy, color)
	local bx<const>, by<const> = yx*height, yy*height
	local command<const> = gp0.draw_quad | gp0.argb_to_rgb(color)
	for index = 1, count do
		local item<const> = indices[index]
		local y<const>, width<const> = y_offsets[item], widths[item]
		local x0<const>, y0<const> = ox + yx*y, oy + yy*y
		local ax<const>, ay<const> = xx*width, xy*width
		emit_color_quad(draw,command,x0,y0,ax,ay,bx,by)
	end
end

function affine_batch.rect(draw, left, top, right, bottom, xx, xy, yx, yy, ox, oy, color)
	local x0<const>, y0<const> = ox + xx*left + yx*top, oy + xy*left + yy*top
	local width<const>, height<const> = right-left, bottom-top
	local ax<const>, ay<const> = xx*width, xy*width
	local bx<const>, by<const> = yx*height, yy*height
	if xx == 1 and xy == 0 and yx == 0 and yy == 1 then
		draw:rect(x0,y0, x0+width,y0+height, color)
	else
		emit_color_quad(draw,gp0.draw_quad | gp0.argb_to_rgb(color),x0,y0,ax,ay,bx,by)
	end
end

function affine_batch.semitransparent_rect(draw, left, top, right, bottom, xx, xy, yx, yy, ox, oy, color)
	local x<const>, y<const> = ox + xx*left + yx*top, oy + xy*left + yy*top
	local width<const>, height<const> = right-left, bottom-top
	if xx == 1 and xy == 0 and yx == 0 and yy == 1 then
		draw:semitransparent_rect(x,y,x+width,y+height,color)
	else
		emit_color_quad(draw,gp0.draw_semitransparent_quad | gp0.argb_to_rgb(color),x,y,
			xx*width,xy*width,yx*height,yy*height)
	end
end

return affine_batch
