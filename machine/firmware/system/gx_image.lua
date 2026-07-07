local round_to_nearest<const> = require('bios/util/round_to_nearest')
local imgdec<const> = require('system/imgdec')
local romdir<const> = require('system/romdir')
local gx_gpu<const> = require('system/gx_gpu')

local gx_image<const> = {}
local cache<const> = {}

local gpu_texture_base_y<const> = 256
local gpu_texture_slice_width<const> = 1024

local atlas_gpu_y<const> = function(atlas_meta, source_x, source_y)
	return gpu_texture_base_y + ((source_x // gpu_texture_slice_width) * atlas_meta.height) + source_y
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
	local slice_index = 0
	while source_x < atlas_meta.width do
		local slice_width = atlas_meta.width - source_x
		if slice_width > gpu_texture_slice_width then
			slice_width = gpu_texture_slice_width
		end
		gx_gpu.upload_rgba8888_to_direct16_stride(atlas_meta.texture_addr, source_x, 0, atlas_meta.width, 0, gpu_texture_base_y + slice_index * atlas_meta.height, slice_width, atlas_meta.height)
		source_x = source_x + gpu_texture_slice_width
		slice_index = slice_index + 1
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

function gx_image.blit_rect_color(rect, x, y, color)
	local remaining_w = rect.w
	local source_x = rect.u
	local target_x = x
	while remaining_w > 0 do
		local chunk_w = gpu_texture_slice_width - (source_x & 0x000003ff)
		if chunk_w > remaining_w then
			chunk_w = remaining_w
		end
		gx_gpu.draw_direct16_textured_rect_color(source_x & 0x000003ff, atlas_gpu_y(rect, source_x, rect.v), target_x, y, chunk_w, rect.h, color)
		remaining_w = remaining_w - chunk_w
		source_x = source_x + chunk_w
		target_x = target_x + chunk_w
	end
end

function gx_image.blit_img_color(imgid, x, y, color)
	gx_image.blit_rect_color(gx_image.rect(imgid), x, y, color)
end

return gx_image
