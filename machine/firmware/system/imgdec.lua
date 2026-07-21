local dma<const> = require('system/dma')

local imgdec<const> = {}
local input_word_count<const>: *word = 0x080103e8
local texture_destination<const>: *word = 0x080103ec
local texture_size<const>: *word = 0x080103f0
local clut_destination<const>: *word = 0x080103f4
local control<const>: *word = 0x080103f8
local control_start<const> = 0x00000001

function imgdec.upload(source, source_word_count, destination, size, clut)
	*input_word_count = source_word_count
	*texture_destination = destination
	*texture_size = size
	*clut_destination = clut
	*control = control_start
	dma.copy_to_imgdec(source, source_word_count)
end

return imgdec
