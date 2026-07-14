local romdir<const> = require('system/romdir')
local gx_gpu<const> = require('system/gx_gpu')
local gx_texture<const> = require('cartlib/gx/texture')

local gx_image<const> = {}
local image_by_id<const> = {}
local palette4_mode<const> = gx_gpu.texture_mode_palette4
local fixed_direct16_texture<const> = {
	mode = gx_gpu.texture_mode_direct16,
	x = 0,
	y = 0,
}

function gx_image.rect(imgid)
	local cached<const> = image_by_id[imgid]
	if cached then
		return cached
	end
	local image<const> = romdir.image(imgid)
	local meta<const> = image.imgmeta
	local texture
	local u
	local v
	if meta.gx_source_x then
		texture = fixed_direct16_texture
		u = meta.gx_source_x
		v = meta.gx_source_y
	else
		texture = gx_texture.from_image(image)
		u = meta.texture_u
		v = meta.texture_v
	end
	local rect<const> = {
		texture = texture,
		u = u,
		v = v,
		w = meta.width,
		h = meta.height,
	}
	image_by_id[imgid] = rect
	return rect
end

function gx_image.blit_rect_color(rect, x, y, color)
	local texture<const> = rect.texture
	if texture.mode == palette4_mode then
		gx_gpu.draw_palette4_textured_rect_color(
			texture.x, texture.clut_x, texture.clut_y,
			rect.u, texture.y + rect.v,
			x, y, rect.w, rect.h, color)
		return
	end
	gx_gpu.draw_direct16_textured_rect_color(
		texture.x + rect.u, texture.y + rect.v,
		x, y, rect.w, rect.h, color)
end

function gx_image.blit_img_color(imgid, x, y, color)
	gx_image.blit_rect_color(gx_image.rect(imgid), x, y, color)
end

function gx_image.tile_run_sources(sources, tile_count, columns, tile_size, origin_x, origin_y)
	local column = 0
	local target_x = origin_x
	local target_y = origin_y
	for index = 1, tile_count do
		local rect<const> = sources[index]
		if rect then
			gx_image.blit_rect_color(rect, target_x, target_y, 0xffffffff)
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

function gx_image.blit_rect_affine_color(
	rect,
	origin_x, origin_y,
	axis_xx, axis_xy,
	axis_yx, axis_yy,
	flip_flags,
	color)
	local texture<const> = rect.texture
	local source_x
	if texture.mode == palette4_mode then
		source_x = rect.u
	else
		source_x = texture.x + rect.u
	end
	local source_y<const> = texture.y + rect.v
	local u0 = source_x
	local u1 = source_x + rect.w - 1
	local v0 = source_y
	local v1 = source_y + rect.h - 1
	if (flip_flags & 1) ~= 0 then
		u0 = source_x + rect.w - 1
		u1 = source_x
	end
	if (flip_flags & 2) ~= 0 then
		v0 = source_y + rect.h - 1
		v1 = source_y
	end
	if texture.mode == palette4_mode then
		gx_gpu.draw_palette4_textured_quad_color(
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
			color)
		return
	end
	gx_gpu.draw_direct16_textured_quad_color(
		source_x, source_y,
		u0, v0,
		u1, v0,
		u0, v1,
		u1, v1,
		origin_x, origin_y,
		origin_x + axis_xx, origin_y + axis_xy,
		origin_x + axis_yx, origin_y + axis_yy,
		origin_x + axis_xx + axis_yx, origin_y + axis_xy + axis_yy,
		color)
end

function gx_image.blit_img_affine_color(
	imgid,
	origin_x, origin_y,
	axis_xx, axis_xy,
	axis_yx, axis_yy,
	flip_flags,
	color)
	gx_image.blit_rect_affine_color(
		gx_image.rect(imgid),
		origin_x, origin_y,
		axis_xx, axis_xy,
		axis_yx, axis_yy,
		flip_flags,
		color)
end

return gx_image
