local dma<const> = {}

local read_addr<const>: *word = 0x08000014
local write_addr<const>: *word = 0x08000018
local transfer_count<const>: *word = 0x0800001c
local control<const>: *word = 0x08000020
local status<const>: *word = 0x08000024
local trigger<const>: *word = 0x08000028
local gx_gp0_addr<const> = 0x08010240
local apu_transfer_data_addr<const> = 0x080001f4
local control_read_increment_gx_write<const> = 0x00000005
local control_read_increment_apu_write<const> = 0x00000011
local control_write_increment_apu_read<const> = 0x00000016
local control_request_force<const> = 0x00000000
local status_busy<const> = 0x00000001
local trigger_start<const> = 0x00000001

function dma.copy_to_gp0(source, word_count)
	*read_addr = source
	*write_addr = gx_gp0_addr
	*transfer_count = word_count
	*control = control_read_increment_gx_write
	*trigger = trigger_start
end

function dma.copy_to_apu(source, word_count)
	*read_addr = source
	*write_addr = apu_transfer_data_addr
	*transfer_count = word_count
	*control = control_read_increment_apu_write
	*trigger = trigger_start
end

function dma.copy_from_apu(target, word_count)
	*read_addr = apu_transfer_data_addr
	*write_addr = target
	*transfer_count = word_count
	*control = control_write_increment_apu_read
	*trigger = trigger_start
end

function dma.abort()
	local busy<const> = (*status & status_busy) ~= 0
	-- Count and request mode are live channel registers. A forced request makes
	-- the controller observe the zero remaining count and retire the transfer.
	*transfer_count = 0
	*control = control_request_force
	return busy
end

return dma
