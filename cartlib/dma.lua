local dma<const> = {}
local irq<const> = require('cartlib/irq')
local irq_source<const> = require('cartlib/irq/source')

dma.block_words = 16

local dma0_read_addr<const>: *word = 0x0800000c
local dma0_write_addr<const>: *word = 0x08000010
local dma0_transfer_count<const>: *word = 0x08000014
local dma0_control<const>: *word = 0x08000018
local dma0_status<const>: *word = 0x0800001c
local dma0_trigger<const>: *word = 0x08000020
local dma1_read_addr<const>: *word = 0x080103e4
local dma1_write_addr<const>: *word = 0x080103e8
local dma1_transfer_count<const>: *word = 0x080103ec
local dma1_control<const>: *word = 0x080103f0
local dma1_status<const>: *word = 0x080103f4
local dma1_trigger<const>: *word = 0x080103f8
local gx_gp0_addr<const> = 0x0801023c
local apu_transfer_data_addr<const> = 0x080001ec
local imgdec_data_addr<const> = 0x08010414
local control_read_increment_gx_write<const> = 0x00003c41
local control_read_increment_apu_write<const> = 0x00003cc1
local control_write_increment_apu_read<const> = 0x00003c12
local control_read_increment_imgdec_write<const> = 0x00003d41
local control_imgdec_read_gx_write<const> = 0x00003c58
local control_read_increment_write_increment_cart0_write<const> = 0x00003dc3
local control_read_increment_write_increment_cart1_write<const> = 0x00003e43
local control_cart0_read_increment_write_increment<const> = 0x00003c23
local control_cart1_read_increment_write_increment<const> = 0x00003c2b
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
	*dma0_write_addr = gx_gp0_addr
	*dma0_transfer_count = word_count
	*dma0_control = control_read_increment_gx_write
	*dma0_trigger = trigger_start
end

function dma.copy_to_apu(source, word_count)
	*dma0_read_addr = source
	*dma0_write_addr = apu_transfer_data_addr
	*dma0_transfer_count = word_count
	*dma0_control = control_read_increment_apu_write
	*dma0_trigger = trigger_start
end

function dma.copy_from_apu(target, word_count)
	*dma0_read_addr = apu_transfer_data_addr
	*dma0_write_addr = target
	*dma0_transfer_count = word_count
	*dma0_control = control_write_increment_apu_read
	*dma0_trigger = trigger_start
end

function dma.copy_to_imgdec(source, word_count)
	*dma0_read_addr = source
	*dma0_write_addr = imgdec_data_addr
	*dma0_transfer_count = word_count
	*dma0_control = control_read_increment_imgdec_write
	*dma0_trigger = trigger_start
end

function dma.copy_from_imgdec_to_gp0(word_count)
	*dma1_read_addr = imgdec_data_addr
	*dma1_write_addr = gx_gp0_addr
	*dma1_transfer_count = word_count
	*dma1_control = control_imgdec_read_gx_write
	*dma1_trigger = trigger_start
end

-- Cartridge DMA carries the socket selection in the request word. These
-- transfers never disturb CART_SELECT or the CPU instruction-image latch.
function dma.copy_to_cartridge0(source, target, word_count)
	*dma0_read_addr = source
	*dma0_write_addr = target
	*dma0_transfer_count = word_count
	*dma0_control = control_read_increment_write_increment_cart0_write
	*dma0_trigger = trigger_start
end

function dma.copy_to_cartridge1(source, target, word_count)
	*dma0_read_addr = source
	*dma0_write_addr = target
	*dma0_transfer_count = word_count
	*dma0_control = control_read_increment_write_increment_cart1_write
	*dma0_trigger = trigger_start
end

function dma.copy_from_cartridge0(source, target, word_count)
	*dma0_read_addr = source
	*dma0_write_addr = target
	*dma0_transfer_count = word_count
	*dma0_control = control_cart0_read_increment_write_increment
	*dma0_trigger = trigger_start
end

function dma.copy_from_cartridge1(source, target, word_count)
	*dma0_read_addr = source
	*dma0_write_addr = target
	*dma0_transfer_count = word_count
	*dma0_control = control_cart1_read_increment_write_increment
	*dma0_trigger = trigger_start
end

return dma
