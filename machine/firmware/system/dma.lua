local dma<const> = {}

local read_addr<const>: *word = 0x08000014
local write_addr<const>: *word = 0x08000018
local transfer_count<const>: *word = 0x0800001c
local control<const>: *word = 0x08000020
local status<const>: *word = 0x08000024
local trigger<const>: *word = 0x08000028
local gx_gp0_addr<const> = 0x08010240
local control_read_increment_gx_write<const> = 0x00000005
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

function dma.abort()
	local busy<const> = (*status & status_busy) ~= 0
	-- Count and request mode are live channel registers. A forced request makes
	-- the controller observe the zero remaining count and retire the transfer.
	*transfer_count = 0
	*control = control_request_force
	return busy
end

return dma
