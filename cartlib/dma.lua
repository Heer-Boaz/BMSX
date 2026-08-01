local dma<const> = {}

dma.block_words = 16

local dma0_read_addr<const>: *word = 0x0800000c
local dma0_write_addr<const>: *word = 0x08000010
local dma0_transfer_count<const>: *word = 0x08000014
local dma0_control<const>: *word = 0x08000018
local dma0_status<const>: *word = 0x0800001c
local dma0_trigger<const>: *word = 0x08000020
local dma1_read_addr<const>: *word = 0x080103e0
local dma1_write_addr<const>: *word = 0x080103e4
local dma1_transfer_count<const>: *word = 0x080103e8
local dma1_control<const>: *word = 0x080103ec
local dma1_status<const>: *word = 0x080103f0
local dma1_trigger<const>: *word = 0x080103f4
local gx_gp0_addr<const> = 0x08010238
local apu_transfer_data_addr<const> = 0x080001ec
local imgdec_data_addr<const> = 0x08010410
local control_read_increment_gx_write<const> = 0x00003c41
local control_read_increment_apu_write<const> = 0x00003cc1
local control_write_increment_apu_read<const> = 0x00003c12
local control_read_increment_imgdec_write<const> = 0x00003d41
local control_imgdec_read_gx_write<const> = 0x00003c58
local trigger_start<const> = 0x00000001
local status_busy<const> = 0x00000001

function dma.wait0_idle()
	while (*dma0_status & status_busy) ~= 0 do
	end
end

function dma.wait1_idle()
	while (*dma1_status & status_busy) ~= 0 do
	end
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

return dma
