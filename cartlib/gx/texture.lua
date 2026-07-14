local dma<const> = require('system/dma')
local gx_gpu<const> = require('system/gx_gpu')

local gx_texture<const> = {}
local texture_by_addr<const> = {}
local palette4_mode<const> = gx_gpu.texture_mode_palette4
local palette4_clut_words<const> = 16

function gx_texture.from_image(image)
	local source_addr<const> = image.texture_addr
	local texture<const> = texture_by_addr[source_addr]
	if texture then
		return texture
	end
	local meta<const> = image.imgmeta
	local loaded<const> = {
		source_addr = source_addr,
		word_count = image.texture_len >> 2,
		mode = meta.gx_texture_mode,
		word_width = meta.gx_texture_word_width,
		height = meta.gx_texture_height,
		clut_word_offset = meta.gx_clut_offset >> 2,
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
	gx_gpu.begin_vram_upload(x, y, texture.word_width, texture.height)
	if texture.mode ~= palette4_mode then
		dma.copy_to_gp0(texture.source_addr, texture.word_count)
		return
	end
	local clut_word_offset<const> = texture.clut_word_offset
	dma.copy_to_gp0(texture.source_addr, clut_word_offset)
	local clut_x<const> = clut_destination & 0x0000ffff
	local clut_y<const> = clut_destination >> 16
	texture.clut_x = clut_x
	texture.clut_y = clut_y
	gx_gpu.begin_vram_upload(clut_x, clut_y, palette4_clut_words, 1)
	dma.copy_to_gp0(texture.source_addr + (clut_word_offset << 2), texture.word_count - clut_word_offset)
end

return gx_texture
