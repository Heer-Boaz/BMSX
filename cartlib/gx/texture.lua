local gx_gpu<const> = require('system/gx_gpu')
local imgdec<const> = require('system/imgdec')

local gx_texture<const> = {}
local texture_by_addr<const> = {}
local palette4_mode<const> = gx_gpu.texture_mode_palette4

function gx_texture.from_image(image)
	local source_addr<const> = image.texture_addr
	local texture<const> = texture_by_addr[source_addr]
	if texture then
		return texture
	end
	local meta<const> = image.imgmeta
	local loaded<const> = {
		source_addr = source_addr,
		stream_word_count = image.texture_len >> 2,
		mode = meta.gx_texture_mode,
		word_width = meta.gx_texture_word_width,
		height = meta.gx_texture_height,
		x = 0,
		y = 0,
		clut_x = 0,
		clut_y = 0,
	}
	texture_by_addr[source_addr] = loaded
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
	imgdec.upload(texture.source_addr, texture.stream_word_count, destination, texture.word_width | (texture.height << 16), clut)
end

return gx_texture
