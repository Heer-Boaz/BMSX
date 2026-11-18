local dma<const> = require('cartlib/dma')

local imgdec<const> = {}
local input_word_count<const>: *word = 0x080103fc
local output_word_count<const>: *word = 0x08010400
local control<const>: *word = 0x0801040c
local gp0<const>: *word = 0x0801023c

function imgdec.upload(source, source_word_count, texture_word_count, clut_word_count, destination, size, clut_destination)
	dma.wait0_idle()
	dma.wait1_idle()
	*gp0 = 0xa0000000
	*gp0 = destination
	*gp0 = size
	*input_word_count = source_word_count
	*output_word_count = texture_word_count + clut_word_count
	dma.copy_from_imgdec_to_gp0(texture_word_count)
	dma.copy_to_imgdec(source, source_word_count)
	*control = 1
	if clut_word_count ~= 0 then
		dma.wait1_idle()
		*gp0 = 0xa0000000
		*gp0 = clut_destination
		*gp0 = 0x00010010
		dma.copy_from_imgdec_to_gp0(clut_word_count)
	end
end

return imgdec
