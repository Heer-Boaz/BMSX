local round_to_nearest<const> = require('bios/util/round_to_nearest')
local romdir<const> = require('system/romdir')
local gx_gpu<const> = require('system/gx_gpu')

local gx_image<const> = {}
local cache<const> = {}

local system_atlas_id<const> = 254
local system_texture_band_width<const> = 512
local system_atlas_meta<const> = romdir.atlas(system_atlas_id).imgmeta
local system_texture_base_x<const> = 512
local cart_texture_overflow_base_x<const> = 512
local cart_texture_overflow_base_y<const> = ((system_atlas_meta.width + system_texture_band_width - 1) // system_texture_band_width) * system_atlas_meta.height
local gpu_texture_base_y<const> = 256
local gpu_texture_page_span<const> = gx_gpu.texture_page_span
local gx_texture_mode_palette4<const> = gx_gpu.texture_mode_palette4
local dma_source_addr<const> = 0x08000014
local dma_target_addr<const> = 0x08000018
local dma_length_addr<const> = 0x0800001c
local dma_control_addr<const> = 0x08000020
local dma_status_addr<const> = 0x08000024
local irq_ack_addr<const> = 0x0800000c
local gx_gp0_addr<const> = 0x08010240
local dma_control_start_strict<const> = 0x00000003
local dma_status_done<const> = 0x00000002
local irq_dma_done_error<const> = 0x00000003

local resident_cart_atlas_id

local atlas_gpu_x<const> = function(rect, source_x, source_y)
	if rect.atlas_id == system_atlas_id then
		return system_texture_base_x + (((source_x >> 8) & 1) << 8) + (source_x & 0x000000ff)
	end
	if source_y >= gpu_texture_page_span then
		return cart_texture_overflow_base_x + (((source_x >> 8) & 1) << 8) + (source_x & 0x000000ff)
	end
	return source_x & 0x000003ff
end

local atlas_gpu_y<const> = function(rect, source_x, source_y)
	if rect.atlas_id == system_atlas_id then
		return ((source_x >> 9) * rect.atlas_height) + source_y
	end
	if source_y >= gpu_texture_page_span then
		return cart_texture_overflow_base_y + (((source_x >> 9) * (rect.atlas_height - gpu_texture_page_span)) + (source_y - gpu_texture_page_span))
	end
	return gpu_texture_base_y + source_y
end

local direct16_gpu_span<const> = function(rect, source_x, source_y)
	local gpu_x<const> = atlas_gpu_x(rect, source_x, source_y)
	local gpu_y<const> = atlas_gpu_y(rect, source_x, source_y)
	local source_page_x<const> = source_x - (gpu_x & 0x000000ff)
	local source_page_y = source_y - (gpu_y & 0x000000ff)
	local source_page_y_end = source_page_y + gpu_texture_page_span
	if rect.atlas_id ~= system_atlas_id then
		if source_y >= gpu_texture_page_span and source_page_y < gpu_texture_page_span then
			source_page_y = gpu_texture_page_span
		elseif source_y < gpu_texture_page_span and source_page_y_end > gpu_texture_page_span then
			source_page_y_end = gpu_texture_page_span
		end
	end
	return gpu_x, gpu_y,
		source_page_x, source_page_x + gpu_texture_page_span,
		source_page_y, source_page_y_end
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

local resolve_cached_atlas_residency<const> = function(atlas_id)
	for _, rect in pairs(cache) do
		if rect.atlas_id == atlas_id then
			resolve_rect_residency(rect)
		end
	end
end

function gx_image.upload_atlas(atlas_id)
	if atlas_id ~= system_atlas_id and resident_cart_atlas_id == atlas_id then
		return
	end
	local atlas<const> = romdir.atlas(atlas_id)
	mem[dma_source_addr] = atlas.texture_addr
	mem[dma_target_addr] = gx_gp0_addr
	mem[dma_length_addr] = atlas.texture_len
	mem[dma_control_addr] = dma_control_start_strict
	repeat
	until (mem[dma_status_addr] & dma_status_done) ~= 0
	mem[irq_ack_addr] = irq_dma_done_error
	if atlas_id ~= system_atlas_id then
		resident_cart_atlas_id = atlas_id
		resolve_cached_atlas_residency(atlas_id)
	end
end

function gx_image.rect(imgid)
	local cached<const> = cache[imgid]
	if cached ~= nil then
		return cached
	end
	local meta<const> = romdir.image(imgid).imgmeta
	local coords<const> = meta.texcoords
	local min_u = coords[1]
	local max_u = coords[1]
	local min_v = coords[2]
	local max_v = coords[2]
	for i = 3, 11, 2 do
		local u<const> = coords[i]
		local v<const> = coords[i + 1]
		if u < min_u then min_u = u end
		if u > max_u then max_u = u end
		if v < min_v then min_v = v end
		if v > max_v then max_v = v end
	end
	local atlas<const> = romdir.atlas(meta.atlasid)
	local atlas_meta<const> = atlas.imgmeta
	local u<const> = round_to_nearest(min_u * atlas_meta.width)
	local v<const> = round_to_nearest(min_v * atlas_meta.height)
	local rect<const> = {
		atlas_id = meta.atlasid,
		atlas_width = atlas_meta.width,
		atlas_height = atlas_meta.height,
		gx_texture_mode = atlas_meta.gx_texture_mode,
		gx_texture_x = atlas_meta.gx_texture_x,
		gx_texture_y = atlas_meta.gx_texture_y,
		gx_clut_x = atlas_meta.gx_clut_x,
		gx_clut_y = atlas_meta.gx_clut_y,
		u = u,
		v = v,
		w = meta.width,
		h = meta.height,
	}
	if meta.atlasid == system_atlas_id or meta.atlasid == resident_cart_atlas_id then
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
