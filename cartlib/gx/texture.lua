local gp0<const> = require('cartlib/gx/gp0')
local imgdec<const> = require('cartlib/gx/imgdec')
local romdir<const> = require('cartlib/romdir')
local texture_bindings<const> = require('bmsx/texture_bindings')

local gx_texture<const> = {}
local texture_by_id<const> = {}
local binding_pools<const> = {}
local placement_pools<const> = texture_bindings.placement_pools
for pool_index = 1, #placement_pools do
	binding_pools[pool_index] = {
		placement_words = placement_pools[pool_index],
		next_index = 1,
	}
end

-- Semantic texture identity survives until residency admission. Admission
-- publishes the selected raw placement before programming IMGDEC; rendering
-- may therefore observe old, partial or uninitialized VRAM while transfer is
-- still in flight.

function gx_texture.resolve(texture_id)
	local texture<const> = texture_by_id[texture_id]
	if texture then
		return texture
	end
	local resource<const> = romdir.texture(texture_id)
	local meta<const> = resource.texturemeta
	local resolved<const> = {
		source_addr = resource.addr,
		stream_word_count = resource.len >> 2,
		texture_word_count = meta.texture_word_count,
		clut_word_count = meta.clut_word_count,
		mode = meta.mode,
		word_width = meta.word_width,
		height = meta.height,
		x = 0,
		y = 0,
		clut_x = 0,
		clut_y = 0,
		binding_pool = binding_pools[texture_bindings.pool_index_by_texture[texture_id]],
	}
	texture_by_id[texture_id] = resolved
	return resolved
end

local resolve_image_texture<const> = function(imgid)
	return gx_texture.resolve(romdir.image(imgid).imgmeta.gx_texture_resid)
end

local upload_texture<const> = function(texture, destination, clut_destination)
	texture.x = destination & 0x0000ffff
	texture.y = destination >> 16
	local clut = 0
	if texture.mode == gp0.texture_mode_palette4 then
		texture.clut_x = clut_destination & 0x0000ffff
		texture.clut_y = clut_destination >> 16
		clut = clut_destination
	end
	imgdec.upload(
		texture.source_addr,
		texture.stream_word_count,
		texture.texture_word_count,
		texture.clut_word_count,
		destination,
		texture.word_width | (texture.height << 16),
		clut)
end

function gx_texture.upload(imgid)
	local texture<const> = resolve_image_texture(imgid)
	local pool<const> = texture.binding_pool
	local placement_words<const> = pool.placement_words
	local placement_index<const> = pool.next_index
	local next_index<const> = placement_index + 2
	pool.next_index = next_index > #placement_words and 1 or next_index
	upload_texture(texture, placement_words[placement_index], placement_words[placement_index + 1])
end

function gx_texture.upload_raw(imgid, destination, clut_destination)
	upload_texture(resolve_image_texture(imgid), destination, clut_destination)
end

return gx_texture
