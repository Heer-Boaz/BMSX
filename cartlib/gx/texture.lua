local gx_gpu<const> = require('system/gx_gpu')
local imgdec<const> = require('system/imgdec')
local romdir<const> = require('system/romdir')

local gx_texture<const> = {}
local texture_by_id<const> = {}
local palette4_mode<const> = gx_gpu.texture_mode_palette4

function gx_texture.from_image(image)
	local texture_id<const> = image.imgmeta.gx_texture_resid
	local texture<const> = texture_by_id[texture_id]
	if texture then
		return texture
	end
	local resource<const> = romdir.texture(texture_id)
	local meta<const> = resource.texturemeta
	local loaded<const> = {
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
	}
	texture_by_id[texture_id] = loaded
	return loaded
end

function gx_texture.upload(texture, destination, clut_destination)
	local x<const> = destination & 0x0000ffff
	local y<const> = destination >> 16
	texture.x = x
	texture.y = y
	local clut = 0
	if texture.mode == palette4_mode then
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

return gx_texture
