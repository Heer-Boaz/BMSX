local round_to_nearest<const> = require('bios/util/round_to_nearest')
local imgdec<const> = require('system/imgdec')
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
local gpu_texture_slice_width<const> = 256
local gpu_texture_page_span<const> = gx_gpu.texture_page_span

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

local texture_page_remaining<const> = function(source_coord)
	return gpu_texture_page_span - (source_coord & 0x000000ff)
end

local upload_atlas_chunk<const> = function(atlas_meta, source_x, source_y, target_x, target_y, width, height)
	gx_gpu.upload_rgba8888_to_direct16_stride(atlas_meta.texture_addr, source_x, source_y, atlas_meta.width, target_x, target_y, width, height)
end

function gx_image.load_atlas(atlas_id)
	local atlas<const> = romdir.atlas(atlas_id)
	local atlas_meta<const> = atlas.imgmeta
	imgdec.start(atlas.addr, atlas.len, atlas_meta.texture_addr, atlas_meta.texture_len)
end

function gx_image.upload_atlas(atlas_id)
	local atlas<const> = romdir.atlas(atlas_id)
	local atlas_meta<const> = atlas.imgmeta
	local source_x = 0
	while source_x < atlas_meta.width do
		local chunk_width = atlas_meta.width - source_x
		if chunk_width > gpu_texture_slice_width then
			chunk_width = gpu_texture_slice_width
		end
		if atlas_id == system_atlas_id then
			upload_atlas_chunk(
				atlas_meta,
				source_x, 0,
				system_texture_base_x + (((source_x >> 8) & 1) << 8),
				(source_x >> 9) * atlas_meta.height,
				chunk_width, atlas_meta.height)
		else
			local chunk_height = atlas_meta.height
			if chunk_height > gpu_texture_page_span then
				chunk_height = gpu_texture_page_span
			end
			upload_atlas_chunk(atlas_meta, source_x, 0, source_x & 0x000003ff, gpu_texture_base_y, chunk_width, chunk_height)
			if atlas_meta.height > gpu_texture_page_span then
				upload_atlas_chunk(
					atlas_meta,
					source_x, gpu_texture_page_span,
					cart_texture_overflow_base_x + (((source_x >> 8) & 1) << 8),
					cart_texture_overflow_base_y + ((source_x >> 9) * (atlas_meta.height - gpu_texture_page_span)),
					chunk_width, atlas_meta.height - gpu_texture_page_span)
			end
		end
		source_x = source_x + gpu_texture_slice_width
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
		u = u,
		v = v,
		w = meta.width,
		h = meta.height,
	}
	cache[imgid] = rect
	return rect
end

function gx_image.blit_img_color(imgid, x, y, color)
	local rect<const> = gx_image.rect(imgid)
	local remaining_w = rect.w
	local source_x = rect.u
	local target_x = x
	while remaining_w > 0 do
		local chunk_w = texture_page_remaining(atlas_gpu_x(rect, source_x, rect.v))
		if chunk_w > remaining_w then
			chunk_w = remaining_w
		end
		local remaining_h = rect.h
		local source_y = rect.v
		local target_y = y
		while remaining_h > 0 do
			local gpu_source_y<const> = atlas_gpu_y(rect, source_x, source_y)
			local chunk_h = texture_page_remaining(gpu_source_y)
			if chunk_h > remaining_h then
				chunk_h = remaining_h
			end
			gx_gpu.draw_direct16_textured_rect_color(atlas_gpu_x(rect, source_x, source_y), gpu_source_y, target_x, target_y, chunk_w, chunk_h, color)
			remaining_h = remaining_h - chunk_h
			source_y = source_y + chunk_h
			target_y = target_y + chunk_h
		end
		remaining_w = remaining_w - chunk_w
		source_x = source_x + chunk_w
		target_x = target_x + chunk_w
	end
end

function gx_image.blit_rect_affine_color(
	rect,
	origin_x, origin_y,
	axis_xx, axis_xy,
	axis_yx, axis_yy,
	flip_flags,
	color)
	local inv_w<const> = 1.0 / rect.w
	local inv_h<const> = 1.0 / rect.h
	local remaining_w = rect.w
	local source_offset_x = 0
	while remaining_w > 0 do
		local source_x
		local chunk_w
		if (flip_flags & 1) ~= 0 then
			local source_x_end<const> = rect.u + rect.w - source_offset_x
			chunk_w = (source_x_end - 1) & 0x000000ff
			chunk_w = chunk_w + 1
			if chunk_w > remaining_w then
				chunk_w = remaining_w
			end
			source_x = source_x_end - chunk_w
		else
			source_x = rect.u + source_offset_x
			chunk_w = texture_page_remaining(atlas_gpu_x(rect, source_x, rect.v))
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
				local gpu_source_y_end<const> = atlas_gpu_y(rect, source_x, source_y_last)
				chunk_h = gpu_source_y_end & 0x000000ff
				chunk_h = chunk_h + 1
				if rect.atlas_id ~= system_atlas_id and source_y_last >= gpu_texture_page_span then
					local overflow_chunk_h<const> = source_y_end - gpu_texture_page_span
					if chunk_h > overflow_chunk_h then
						chunk_h = overflow_chunk_h
					end
				end
				if chunk_h > remaining_h then
					chunk_h = remaining_h
				end
				source_y = source_y_end - chunk_h
			else
				source_y = rect.v + source_offset_y
				chunk_h = texture_page_remaining(atlas_gpu_y(rect, source_x, source_y))
				if chunk_h > remaining_h then
					chunk_h = remaining_h
				end
			end
			local gpu_source_x<const> = atlas_gpu_x(rect, source_x, source_y)
			local gpu_source_y<const> = atlas_gpu_y(rect, source_x, source_y)
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
