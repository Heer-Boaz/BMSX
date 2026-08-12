local rom_dir<const> = require('cartlib/rom_dir')
local gp0<const> = require('cartlib/gx/gp0')
local gx_texture<const> = require('cartlib/gx/texture')

local image<const> = {}
local image_by_id<const> = {}
local fixed_direct16_texture<const> = {
	mode = gp0.texture_mode_direct16,
	x = 0,
	y = 0,
}

-- Image resolution selects a texture-mode-specific packet writer once.
-- Ordinary image draws never redispatch on mode or scan page tiles; explicitly
-- producer-split large surfaces are handled by surface_component instead.

local direct16_draw<const> = function(source, draw, x, y, color, flip_flags, blend_mode)
	local texture<const> = source._texture
	draw:direct16_rect(
		texture.x + source.source_x, texture.y + source.source_y,
		x, y, source.width, source.height, color, flip_flags << 12, blend_mode)
end

local direct16_draw_source_rect<const> = function(source, draw, source_x, source_y, width, height, x, y, color, flip_flags, blend_mode)
	local texture<const> = source._texture
	draw:direct16_rect(
		texture.x + source.source_x + source_x, texture.y + source.source_y + source_y,
		x, y, width, height, color, flip_flags << 12, blend_mode)
end

local direct16_draw_affine<const> = function(
	source, draw,
	origin_x, origin_y,
	axis_xx, axis_xy,
	axis_yx, axis_yy,
	flip_flags,
	color,
	blend_mode)
	local texture<const> = source._texture
	local source_x<const> = texture.x + source.source_x
	local source_y<const> = texture.y + source.source_y
	local u0 = source_x
	local u1 = source_x + source.width - 1
	local v0 = source_y
	local v1 = source_y + source.height - 1
	if (flip_flags & 1) ~= 0 then
		u0 = u1
		u1 = source_x
	end
	if (flip_flags & 2) ~= 0 then
		v0 = v1
		v1 = source_y
	end
	draw:direct16_quad(
		source_x, source_y,
		u0, v0,
		u1, v0,
		u0, v1,
		u1, v1,
		origin_x, origin_y,
		origin_x + axis_xx, origin_y + axis_xy,
		origin_x + axis_yx, origin_y + axis_yy,
		origin_x + axis_xx + axis_yx, origin_y + axis_xy + axis_yy,
		color,
		blend_mode)
end

local direct16_draw_quad<const> = function(
	source, draw,
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
	local texture<const> = source._texture
	local source_x<const> = texture.x + source.source_x
	local source_y<const> = texture.y + source.source_y
	draw:direct16_quad(
		source_x, source_y,
		source_x + source_x0, source_y + source_y0,
		source_x + source_x1, source_y + source_y1,
		source_x + source_x2, source_y + source_y2,
		source_x + source_x3, source_y + source_y3,
		x0, y0,
		x1, y1,
		x2, y2,
		x3, y3,
		color,
		blend_mode)
end

local palette4_draw<const> = function(source, draw, x, y, color, flip_flags, blend_mode)
	local texture<const> = source._texture
	draw:palette4_rect(
		texture.x, texture.clut_x, texture.clut_y,
		source.source_x, texture.y + source.source_y,
		x, y, source.width, source.height, color, flip_flags << 12, blend_mode)
end

local palette4_draw_source_rect<const> = function(source, draw, source_x, source_y, width, height, x, y, color, flip_flags, blend_mode)
	local texture<const> = source._texture
	draw:palette4_rect(
		texture.x, texture.clut_x, texture.clut_y,
		source.source_x + source_x, texture.y + source.source_y + source_y,
		x, y, width, height, color, flip_flags << 12, blend_mode)
end

local palette4_draw_affine<const> = function(
	source, draw,
	origin_x, origin_y,
	axis_xx, axis_xy,
	axis_yx, axis_yy,
	flip_flags,
	color,
	blend_mode)
	local texture<const> = source._texture
	local source_x<const> = source.source_x
	local source_y<const> = texture.y + source.source_y
	local u0 = source_x
	local u1 = source_x + source.width - 1
	local v0 = source_y
	local v1 = source_y + source.height - 1
	if (flip_flags & 1) ~= 0 then
		u0 = u1
		u1 = source_x
	end
	if (flip_flags & 2) ~= 0 then
		v0 = v1
		v1 = source_y
	end
	draw:palette4_quad(
		texture.x, texture.clut_x, texture.clut_y,
		source_x, source_y,
		u0, v0,
		u1, v0,
		u0, v1,
		u1, v1,
		origin_x, origin_y,
		origin_x + axis_xx, origin_y + axis_xy,
		origin_x + axis_yx, origin_y + axis_yy,
		origin_x + axis_xx + axis_yx, origin_y + axis_xy + axis_yy,
		color,
		blend_mode)
end

local palette4_draw_quad<const> = function(
	source, draw,
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
	local texture<const> = source._texture
	local source_x<const> = source.source_x
	local source_y<const> = texture.y + source.source_y
	draw:palette4_quad(
		texture.x, texture.clut_x, texture.clut_y,
		source_x, source_y,
		source_x + source_x0, source_y + source_y0,
		source_x + source_x1, source_y + source_y1,
		source_x + source_x2, source_y + source_y2,
		source_x + source_x3, source_y + source_y3,
		x0, y0,
		x1, y1,
		x2, y2,
		x3, y3,
		color,
		blend_mode)
end

function image.resolve(id)
	local cached<const> = image_by_id[id]
	if cached then
		return cached
	end
	local resource<const> = rom_dir.image(id)
	local meta<const> = resource.imgmeta
	local texture
	local source_x
	local source_y
	if meta.gx_source_x then
		texture = fixed_direct16_texture
		source_x = meta.gx_source_x
		source_y = meta.gx_source_y
	else
		texture = gx_texture.resolve(meta.gx_texture_resid)
		source_x = meta.texture_u
		source_y = meta.texture_v
	end
	local draw
	local draw_source_rect
	local draw_affine
	local draw_quad
	if texture.mode == gp0.texture_mode_palette4 then
		draw = palette4_draw
		draw_source_rect = palette4_draw_source_rect
		draw_affine = palette4_draw_affine
		draw_quad = palette4_draw_quad
	else
		draw = direct16_draw
		draw_source_rect = direct16_draw_source_rect
		draw_affine = direct16_draw_affine
		draw_quad = direct16_draw_quad
	end
	local source<const> = {
		_texture = texture,
		source_x = source_x,
		source_y = source_y,
		width = meta.width,
		height = meta.height,
	}
	local page_tiles<const> = meta.gx_page_tiles
	if page_tiles then
		local tiles<const> = {}
		for index = 1, #page_tiles do
			local tile<const> = page_tiles[index]
			tiles[index] = {
				_texture = texture,
				source_x = tile.u,
				source_y = tile.v,
				width = tile.w,
				height = tile.h,
				offset_x = tile.x,
				offset_y = tile.y,
				draw = draw,
			}
		end
		source._tiles = tiles
	else
		source.draw = draw
		source.draw_source_rect = draw_source_rect
		source.draw_affine = draw_affine
		source.draw_quad = draw_quad
	end
	image_by_id[id] = source
	return source
end

return image
