local system<const> = require('bios/system')
local dma<const> = require('system/dma')

local dma_transfer<const> = {}
local irq_dma_done<const> = 0x0001

bss bios_dma_completion_sequence: word

system.on_irq(irq_dma_done, function()
	*bios_dma_completion_sequence = *bios_dma_completion_sequence + 1
end)

local wait_for_completion<const> = function(sequence)
	while *bios_dma_completion_sequence == sequence do
		halt_until_irq
	end
end

function dma_transfer.copy_to_gp0(source, word_count)
	local sequence<const> = *bios_dma_completion_sequence
	dma.copy_to_gp0(source, word_count)
	wait_for_completion(sequence)
end

function dma_transfer.abort()
	local sequence<const> = *bios_dma_completion_sequence
	if dma.abort() then
		wait_for_completion(sequence)
	end
end

return dma_transfer
