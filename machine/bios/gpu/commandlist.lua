local dma_transfer<const> = require('kernel/dma')
local gx_gpu<const> = require('gpu/gpu')

local gx_commandlist<const> = {}
local irq_flags<const>: *word = 0x08000000
local irq_ack<const>: *word = 0x08000004
local irq_gpu<const> = 0x0040

function gx_commandlist.submit(words, word_count)
	word_count = gx_gpu.encode_irq_request(words, word_count)
	dma_transfer.copy_to_gp0(words, word_count)
	while (*irq_flags & irq_gpu) == 0 do
	end
	*irq_ack = irq_gpu
	gx_gpu.ack_irq()
end

return gx_commandlist
