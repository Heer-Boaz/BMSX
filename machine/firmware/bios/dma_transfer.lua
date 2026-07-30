local interrupts<const> = require('bios/interrupts')

local dma_transfer<const> = {}
local dma0_read_addr<const>: *word = 0x0800000c
local dma0_write_addr<const>: *word = 0x08000010
local dma0_transfer_count<const>: *word = 0x08000014
local dma0_control<const>: *word = 0x08000018
local dma0_trigger<const>: *word = 0x08000020
local gx_gp0_addr<const> = 0x08010238
local control_read_increment_gx_write<const> = 0x00003c41
local trigger_start<const> = 0x00000001
local irq_dma_done<const> = 0x0001

bss bios_dma_completion_sequence: word

interrupts.on(irq_dma_done, function()
	*bios_dma_completion_sequence = *bios_dma_completion_sequence + 1
end)

local wait_for_completion<const> = function(sequence)
	while *bios_dma_completion_sequence == sequence do
		halt_until_irq
	end
end

function dma_transfer.copy_to_gp0(source, word_count)
	local sequence<const> = *bios_dma_completion_sequence
	*dma0_read_addr = source
	*dma0_write_addr = gx_gp0_addr
	*dma0_transfer_count = word_count
	*dma0_control = control_read_increment_gx_write
	*dma0_trigger = trigger_start
	wait_for_completion(sequence)
end

return dma_transfer
