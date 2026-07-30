local dma_transfer<const> = require('kernel/dma')
local interrupts<const> = require('kernel/interrupts')
local gx_gpu<const> = require('gpu/gpu')

local gx_command_list<const> = {}
local irq_gpu<const> = 0x0040

bss bios_gx_completion_sequence: word

interrupts.on(irq_gpu, function()
	gx_gpu.ack_irq()
	*bios_gx_completion_sequence = *bios_gx_completion_sequence + 1
end)

function gx_command_list.submit(words, word_count)
	local sequence<const> = *bios_gx_completion_sequence
	word_count = gx_gpu.encode_irq_request(words, word_count)
	dma_transfer.copy_to_gp0(words, word_count)
	while *bios_gx_completion_sequence == sequence do
		halt_until_irq
	end
end

return gx_command_list
