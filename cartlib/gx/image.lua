local romdir<const> = require('cartlib/romdir')
local gp0<const> = require('cartlib/gx/gp0')
local gx_texture<const> = require('cartlib/gx/texture')

local image<const> = {}
local image_by_id<const> = {}
local fixed_direct16_texture<const> = {
	mode = gp0.texture_mode_direct16,
	x = 0,
	y = 0,
}

function image.load(id)
	local cached<const> = image_by_id[id]
	if cached then
		return cached
	end
	local resource<const> = romdir.image(id)
	local meta<const> = resource.imgmeta
	local texture
	local u
	local v
	if meta.gx_source_x then
		texture = fixed_direct16_texture
		u = meta.gx_source_x
		v = meta.gx_source_y
	else
		texture = gx_texture.from_image(resource)
		u = meta.texture_u
		v = meta.texture_v
	end
	local rect<const> = {
		texture = texture,
		u = u,
		v = v,
		w = meta.width,
		h = meta.height,
		tiles = meta.gx_page_tiles,
	}
	local tiles<const> = rect.tiles
	if tiles then
		for index = 1, #tiles do
			tiles[index].texture = texture
		end
	end
	image_by_id[id] = rect
	return rect
end

function image.draw(draw, source, x, y, color, flip_flags, blend_mode)
	local texture<const> = source.texture
	local rectangle_flip_mode<const> = flip_flags << 12
	if texture.mode == gp0.texture_mode_palette4 then
		draw:palette4_rect(
			texture.x, texture.clut_x, texture.clut_y,
			source.u, texture.y + source.v,
			x, y, source.w, source.h, color, rectangle_flip_mode, blend_mode)
		return
	end
	draw:direct16_rect(
		texture.x + source.u, texture.y + source.v,
		x, y, source.w, source.h, color, rectangle_flip_mode, blend_mode)
end

function image.draw_tiles(draw, sources, tile_count, columns, tile_size, origin_x, origin_y, blend_mode)
	local column = 0
	local target_x = origin_x
	local target_y = origin_y
	for index = 1, tile_count do
		local source<const> = sources[index]
		if source then
			image.draw(draw, source, target_x, target_y, 0xffffffff, 0, blend_mode)
		end
		column = column + 1
		if column == columns then
			column = 0
			target_x = origin_x
			target_y = target_y + tile_size
		else
			target_x = target_x + tile_size
		end
	end
end

function image.draw_affine(
	draw,
	source,
	origin_x, origin_y,
	axis_xx, axis_xy,
	axis_yx, axis_yy,
	flip_flags,
	color,
	blend_mode)
	local texture<const> = source.texture
	local source_x
	if texture.mode == gp0.texture_mode_palette4 then
		source_x = source.u
	else
		source_x = texture.x + source.u
	end
	local source_y<const> = texture.y + source.v
	local u0 = source_x
	local u1 = source_x + source.w - 1
	local v0 = source_y
	local v1 = source_y + source.h - 1
	if (flip_flags & 1) ~= 0 then
		u0 = source_x + source.w - 1
		u1 = source_x
	end
	if (flip_flags & 2) ~= 0 then
		v0 = source_y + source.h - 1
		v1 = source_y
	end
	if texture.mode == gp0.texture_mode_palette4 then
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
		return
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

return image
