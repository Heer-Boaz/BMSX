local dma<const> = require('cartlib/dma')

local imgdec<const> = {}
local input_word_count<const>: *word = 0x080103f8
local texture_destination<const>: *word = 0x080103fc
local texture_size<const>: *word = 0x08010400
local clut_destination<const>: *word = 0x08010404
local control<const>: *word = 0x08010408
local control_start<const> = 0x00000001

function imgdec.upload(source, source_word_count, texture_word_count, clut_word_count, destination, size, clut_destination_word)
	dma.wait0_idle()
	dma.wait1_idle()
	local output_word_count = texture_word_count + 3
	if clut_word_count ~= 0 then
		output_word_count = output_word_count + clut_word_count + 3
	end
	*input_word_count = source_word_count
	*texture_destination = destination
	*texture_size = size
	*clut_destination = clut_destination_word
	dma.copy_from_imgdec_to_gp0(output_word_count)
	dma.copy_to_imgdec(source, source_word_count)
	*control = control_start
end

return imgdec
