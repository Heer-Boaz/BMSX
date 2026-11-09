local dma<const> = {}
local irq<const> = require('cartlib/irq')
local irq_source<const> = require('cartlib/irq/source')

local cartridge_select<const>: *word = 0x08010420
local dma0_read_addr<const>: *word = 0x0800000c
local dma0_write_addr<const>: *word = 0x08000010
local dma0_transfer_count<const>: *word = 0x08000014
local dma0_control<const>: *word = 0x08000018
local dma0_status<const>: *word = 0x0800001c
local dma0_trigger<const>: *word = 0x08000020
local dma1_transfer_count<const>: *word = 0x080103ec
local dma1_control<const>: *word = 0x080103f0
local dma1_status<const>: *word = 0x080103f4
local dma1_trigger<const>: *word = 0x080103f8
local route_to_gpu<const> = 0x00000001
local route_to_apu<const> = 0x00000006
local route_from_apu<const> = 0x00000007
local route_to_imgdec<const> = 0x00000003
local route_imgdec_to_gpu<const> = 0x00000005
local trigger_start<const> = 0x00000001
local status_busy<const> = 0x00000001

bss dma0_completion_sequence: word
bss dma1_completion_sequence: word

local on_dma0_done<const> = function()
	*dma0_completion_sequence = *dma0_completion_sequence + 1
end

local on_dma1_done<const> = function()
	*dma1_completion_sequence = *dma1_completion_sequence + 1
end

local function init_dma_irq<init>()
	irq.register(irq_source.dma0_done, on_dma0_done)
	irq.register(irq_source.dma1_done, on_dma1_done)
end
init_dma_irq()

function dma.wait0_idle()
	local sequence<const> = *dma0_completion_sequence
	if (*dma0_status & status_busy) == 0 then
		return
	end
	repeat
		halt_until_irq
	until *dma0_completion_sequence ~= sequence
end

function dma.wait1_idle()
	local sequence<const> = *dma1_completion_sequence
	if (*dma1_status & status_busy) == 0 then
		return
	end
	repeat
		halt_until_irq
	until *dma1_completion_sequence ~= sequence
end

function dma.copy_to_gp0(source, word_count)
	*dma0_read_addr = source
	*dma0_transfer_count = word_count
	*dma0_control = route_to_gpu | ((*cartridge_select & 1) << 3)
	*dma0_trigger = trigger_start
end

function dma.copy_to_apu(source, word_count)
	*dma0_read_addr = source
	*dma0_transfer_count = word_count
	*dma0_control = route_to_apu | ((*cartridge_select & 1) << 3)
	*dma0_trigger = trigger_start
end

function dma.copy_from_apu(target, word_count)
	*dma0_write_addr = target
	*dma0_transfer_count = word_count
	*dma0_control = route_from_apu | ((*cartridge_select & 1) << 4)
	*dma0_trigger = trigger_start
end

function dma.copy_to_imgdec(source, word_count)
	*dma0_read_addr = source
	*dma0_transfer_count = word_count
	*dma0_control = route_to_imgdec | ((*cartridge_select & 1) << 3)
	*dma0_trigger = trigger_start
end

function dma.copy_from_imgdec_to_gp0(word_count)
	*dma1_transfer_count = word_count
	*dma1_control = route_imgdec_to_gpu
	*dma1_trigger = trigger_start
end

return dma
