local romdir<const> = require('system/romdir')
local gx_gpu<const> = require('system/gx_gpu')

local gx_image<const> = {}
local cache<const> = {}
local packed_texture_by_atlas<const> = {}

local gpu_texture_page_span<const> = gx_gpu.texture_page_span
local gx_texture_mode_palette4<const> = gx_gpu.texture_mode_palette4
local direct16_texture_x_by_atlas<const> = {}
local direct16_texture_y_by_atlas<const> = {}

function gx_image.packed_texture(atlas_id)
	local texture<const> = packed_texture_by_atlas[atlas_id]
	if texture ~= nil then
		return texture
	end
	local loaded<const> = romdir.resource(string.format('_atlas_%02d', atlas_id))
	packed_texture_by_atlas[atlas_id] = loaded
	return loaded
end

local direct16_gpu_span<const> = function(rect, source_x, source_y)
	local gpu_x<const> = (rect.gx_texture_x + source_x) & 0x000003ff
	local gpu_y<const> = (rect.gx_texture_y + source_y) & 0x000001ff
	local source_page_x<const> = source_x - (gpu_x & 0x000000ff)
	local source_page_y<const> = source_y - (gpu_y & 0x000000ff)
	return gpu_x, gpu_y,
		source_page_x, source_page_x + gpu_texture_page_span,
		source_page_y, source_page_y + gpu_texture_page_span
end

local palette4_gpu_span<const> = function(rect, source_x, source_y)
	local gpu_y<const> = rect.gx_texture_y + source_y
	local source_page_x<const> = source_x - (source_x & 0x000000ff)
	local source_page_y<const> = source_y - (gpu_y & 0x000000ff)
	return source_x, gpu_y,
		source_page_x, source_page_x + gpu_texture_page_span,
		source_page_y, source_page_y + gpu_texture_page_span
end

local atlas_gpu_span<const> = function(rect, source_x, source_y)
	if rect.gx_texture_mode == gx_texture_mode_palette4 then
		return palette4_gpu_span(rect, source_x, source_y)
	end
	return direct16_gpu_span(rect, source_x, source_y)
end

local resolve_rect_residency<const> = function(rect)
	local gpu_x<const>, gpu_y<const>, _<const>, source_x_end<const>, _<const>, source_y_end<const> = atlas_gpu_span(rect, rect.u, rect.v)
	rect.gpu_x = gpu_x
	rect.gpu_y = gpu_y
	rect.gpu_single_span = rect.u + rect.w <= source_x_end and rect.v + rect.h <= source_y_end
end

function gx_image.bind_direct16_residency(atlas_id, texture_x, texture_y)
	direct16_texture_x_by_atlas[atlas_id] = texture_x
	direct16_texture_y_by_atlas[atlas_id] = texture_y
	for _, rect in pairs(cache) do
		if rect.atlas_id == atlas_id then
			rect.gx_texture_x = texture_x
			rect.gx_texture_y = texture_y
			resolve_rect_residency(rect)
		end
	end
end

function gx_image.rect(imgid)
	local cached<const> = cache[imgid]
	if cached ~= nil then
		return cached
	end
	local meta<const> = romdir.image(imgid).imgmeta
	local atlas_meta<const> = gx_image.packed_texture(meta.atlasid).meta
	local u<const> = meta.atlas_x
	local v<const> = meta.atlas_y
	local texture_mode<const> = atlas_meta.gx_texture_mode
	local texture_placement<const> = atlas_meta.gx_texture_placement
	local texture_x
	local texture_y
	if texture_placement == 'fixed' then
		texture_x = atlas_meta.gx_texture_x
		texture_y = atlas_meta.gx_texture_y
	else
		texture_x = direct16_texture_x_by_atlas[meta.atlasid]
		texture_y = direct16_texture_y_by_atlas[meta.atlasid]
	end
	local rect<const> = {
		atlas_id = meta.atlasid,
		gx_texture_mode = texture_mode,
		gx_texture_placement = texture_placement,
		gx_texture_x = texture_x,
		gx_texture_y = texture_y,
		gx_clut_x = atlas_meta.gx_clut_x,
		gx_clut_y = atlas_meta.gx_clut_y,
		u = u,
		v = v,
		w = meta.width,
		h = meta.height,
	}
	if texture_placement == 'fixed' or texture_x ~= nil then
		resolve_rect_residency(rect)
	end
	cache[imgid] = rect
	return rect
end

local blit_rect_color<const> = function(rect, x, y, color)
	local remaining_w = rect.w
	local source_x = rect.u
	local target_x = x
	while remaining_w > 0 do
		local _<const>, _<const>, _<const>, source_x_end<const> = atlas_gpu_span(rect, source_x, rect.v)
		local chunk_w = source_x_end - source_x
		if chunk_w > remaining_w then
			chunk_w = remaining_w
		end
		local remaining_h = rect.h
		local source_y = rect.v
		local target_y = y
		while remaining_h > 0 do
			local gpu_source_x<const>, gpu_source_y<const>, _<const>, _<const>, _<const>, source_y_end<const> = atlas_gpu_span(rect, source_x, source_y)
			local chunk_h = source_y_end - source_y
			if chunk_h > remaining_h then
				chunk_h = remaining_h
			end
			if rect.gx_texture_mode == gx_texture_mode_palette4 then
				gx_gpu.draw_palette4_textured_rect_color(rect.gx_texture_x, rect.gx_clut_x, rect.gx_clut_y, gpu_source_x, gpu_source_y, target_x, target_y, chunk_w, chunk_h, color)
			else
				gx_gpu.draw_direct16_textured_rect_color(gpu_source_x, gpu_source_y, target_x, target_y, chunk_w, chunk_h, color)
			end
			remaining_h = remaining_h - chunk_h
			source_y = source_y + chunk_h
			target_y = target_y + chunk_h
		end
		remaining_w = remaining_w - chunk_w
		source_x = source_x + chunk_w
		target_x = target_x + chunk_w
	end
end

function gx_image.blit_img_color(imgid, x, y, color)
	local rect<const> = gx_image.rect(imgid)
	if rect.gpu_single_span then
		if rect.gx_texture_mode == gx_texture_mode_palette4 then
			gx_gpu.draw_palette4_textured_rect_color(rect.gx_texture_x, rect.gx_clut_x, rect.gx_clut_y, rect.gpu_x, rect.gpu_y, x, y, rect.w, rect.h, color)
		else
			gx_gpu.draw_direct16_textured_rect_color(rect.gpu_x, rect.gpu_y, x, y, rect.w, rect.h, color)
		end
		return
	end
	blit_rect_color(rect, x, y, color)
end

function gx_image.tile_run_sources(sources, tile_count, columns, tile_size, origin_x, origin_y, empty_source)
	local column = 0
	local target_x = origin_x
	local target_y = origin_y
	for index = 1, tile_count do
		local rect<const> = sources[index]
		if rect ~= empty_source then
			if rect.gpu_single_span then
				if rect.gx_texture_mode == gx_texture_mode_palette4 then
					gx_gpu.draw_palette4_textured_rect_color(rect.gx_texture_x, rect.gx_clut_x, rect.gx_clut_y, rect.gpu_x, rect.gpu_y, target_x, target_y, rect.w, rect.h, 0xffffffff)
				else
					gx_gpu.draw_direct16_textured_rect_color(rect.gpu_x, rect.gpu_y, target_x, target_y, rect.w, rect.h, 0xffffffff)
				end
			else
				blit_rect_color(rect, target_x, target_y, 0xffffffff)
			end
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
	if rect.gpu_single_span then
		local u0 = rect.gpu_x
		local u1 = rect.gpu_x + rect.w - 1
		local v0 = rect.gpu_y
		local v1 = rect.gpu_y + rect.h - 1
		if (flip_flags & 1) ~= 0 then
			u0 = rect.gpu_x + rect.w - 1
			u1 = rect.gpu_x
		end
		if (flip_flags & 2) ~= 0 then
			v0 = rect.gpu_y + rect.h - 1
			v1 = rect.gpu_y
		end
		if rect.gx_texture_mode == gx_texture_mode_palette4 then
			gx_gpu.draw_palette4_textured_quad_color(
				rect.gx_texture_x, rect.gx_clut_x, rect.gx_clut_y,
				rect.gpu_x, rect.gpu_y,
				u0, v0,
				u1, v0,
				u0, v1,
				u1, v1,
				origin_x, origin_y,
				origin_x + axis_xx, origin_y + axis_xy,
				origin_x + axis_yx, origin_y + axis_yy,
				origin_x + axis_xx + axis_yx, origin_y + axis_xy + axis_yy,
				color)
		else
			gx_gpu.draw_direct16_textured_quad_color(
				rect.gpu_x, rect.gpu_y,
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
		return
	end
	local inv_w<const> = 1.0 / rect.w
	local inv_h<const> = 1.0 / rect.h
	local remaining_w = rect.w
	local source_offset_x = 0
	while remaining_w > 0 do
		local source_x
		local chunk_w
		if (flip_flags & 1) ~= 0 then
			local source_x_end<const> = rect.u + rect.w - source_offset_x
			local source_x_last<const> = source_x_end - 1
			local _<const>, _<const>, source_x_start<const> = atlas_gpu_span(rect, source_x_last, rect.v)
			chunk_w = source_x_end - source_x_start
			if chunk_w > remaining_w then
				chunk_w = remaining_w
			end
			source_x = source_x_end - chunk_w
		else
			source_x = rect.u + source_offset_x
			local _<const>, _<const>, _<const>, source_x_end<const> = atlas_gpu_span(rect, source_x, rect.v)
			chunk_w = source_x_end - source_x
			if chunk_w > remaining_w then
				chunk_w = remaining_w
			end
		end
		local remaining_h = rect.h
		local source_offset_y = 0
		while remaining_h > 0 do
			local source_y
			local chunk_h
			if (flip_flags & 2) ~= 0 then
				local source_y_end<const> = rect.v + rect.h - source_offset_y
				local source_y_last<const> = source_y_end - 1
				local _<const>, _<const>, _<const>, _<const>, source_y_start<const> = atlas_gpu_span(rect, source_x, source_y_last)
				chunk_h = source_y_end - source_y_start
				if chunk_h > remaining_h then
					chunk_h = remaining_h
				end
				source_y = source_y_end - chunk_h
			else
				source_y = rect.v + source_offset_y
				local _<const>, _<const>, _<const>, _<const>, _<const>, source_y_end<const> = atlas_gpu_span(rect, source_x, source_y)
				chunk_h = source_y_end - source_y
				if chunk_h > remaining_h then
					chunk_h = remaining_h
				end
			end
			local gpu_source_x<const>, gpu_source_y<const> = atlas_gpu_span(rect, source_x, source_y)
			local u0 = gpu_source_x
			local u1 = gpu_source_x + chunk_w - 1
			local v0 = gpu_source_y
			local v1 = gpu_source_y + chunk_h - 1
			if (flip_flags & 1) ~= 0 then
				u0 = gpu_source_x + chunk_w - 1
				u1 = gpu_source_x
			end
			if (flip_flags & 2) ~= 0 then
				v0 = gpu_source_y + chunk_h - 1
				v1 = gpu_source_y
			end
			local chunk_x0<const> = source_offset_x * inv_w
			local chunk_y0<const> = source_offset_y * inv_h
			local chunk_x1<const> = (source_offset_x + chunk_w) * inv_w
			local chunk_y1<const> = (source_offset_y + chunk_h) * inv_h
			local x0<const> = origin_x + axis_xx * chunk_x0 + axis_yx * chunk_y0
			local y0<const> = origin_y + axis_xy * chunk_x0 + axis_yy * chunk_y0
			local x1<const> = origin_x + axis_xx * chunk_x1 + axis_yx * chunk_y0
			local y1<const> = origin_y + axis_xy * chunk_x1 + axis_yy * chunk_y0
			local x2<const> = origin_x + axis_xx * chunk_x0 + axis_yx * chunk_y1
			local y2<const> = origin_y + axis_xy * chunk_x0 + axis_yy * chunk_y1
			local x3<const> = origin_x + axis_xx * chunk_x1 + axis_yx * chunk_y1
			local y3<const> = origin_y + axis_xy * chunk_x1 + axis_yy * chunk_y1
			if rect.gx_texture_mode == gx_texture_mode_palette4 then
				gx_gpu.draw_palette4_textured_quad_color(
					rect.gx_texture_x, rect.gx_clut_x, rect.gx_clut_y,
					gpu_source_x, gpu_source_y,
					u0, v0,
					u1, v0,
					u0, v1,
					u1, v1,
					x0, y0,
					x1, y1,
					x2, y2,
					x3, y3,
					color)
			else
				gx_gpu.draw_direct16_textured_quad_color(
					gpu_source_x, gpu_source_y,
					u0, v0,
					u1, v0,
					u0, v1,
					u1, v1,
					x0, y0,
					x1, y1,
					x2, y2,
					x3, y3,
					color)
			end
			remaining_h = remaining_h - chunk_h
			source_offset_y = source_offset_y + chunk_h
		end
		remaining_w = remaining_w - chunk_w
		source_offset_x = source_offset_x + chunk_w
	end
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
