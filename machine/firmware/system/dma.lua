local dma<const> = {}

local read_addr<const>: *word = 0x08000014
local write_addr<const>: *word = 0x08000018
local transfer_count<const>: *word = 0x0800001c
local control<const>: *word = 0x08000020
local trigger<const>: *word = 0x08000028
local gx_gp0_addr<const> = 0x08010240
local control_read_increment_gx_write<const> = 0x00000005
local trigger_start<const> = 0x00000001

function dma.copy_to_gp0(source, word_count)
	*read_addr = source
	*write_addr = gx_gp0_addr
	*transfer_count = word_count
	*control = control_read_increment_gx_write
	*trigger = trigger_start
end

return dma
