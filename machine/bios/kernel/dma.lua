local interrupts<const> = require('kernel/interrupts')

local dma_transfer<const> = {}
local dma0_read_addr<const>: *word = 0x0800000c
local dma0_transfer_count<const>: *word = 0x08000014
local dma0_control<const>: *word = 0x08000018
local dma0_trigger<const>: *word = 0x08000020
local route_to_gpu<const> = 0x00000001
local trigger_start<const> = 0x00000001
local bios_dma_completion_sequence<const>: *word = interrupts.dma_completion_sequence

local wait_for_completion<const> = function(sequence)
	while *bios_dma_completion_sequence == sequence do
		halt_until_irq
	end
end

function dma_transfer.copy_to_gp0(source, word_count)
	local sequence<const> = *bios_dma_completion_sequence
	*dma0_read_addr = source
	*dma0_transfer_count = word_count
	*dma0_control = route_to_gpu
	*dma0_trigger = trigger_start
	wait_for_completion(sequence)
end

return dma_transfer
