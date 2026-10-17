module<entry>

local state<const> = require('results')
local result<const>: *dma_manual_result = state.result
local irq_flags<const>: *word = 0x08000000
local irq_ack<const>: *word = 0x08000004
local irq_mask<const>: *word = 0x08000008
local dma0_read<const>: *word = 0x0800000c
local dma0_write<const>: *word = 0x08000010
local dma0_count<const>: *word = 0x08000014
local dma0_control<const>: *word = 0x08000018
local dma0_status<const>: *word = 0x0800001c
local dma0_trigger<const>: *word = 0x08000020
local dma1_read<const>: *word = 0x080103e4
local dma1_write<const>: *word = 0x080103e8
local dma1_count<const>: *word = 0x080103ec
local dma1_control<const>: *word = 0x080103f0
local dma1_status<const>: *word = 0x080103f4
local dma1_trigger<const>: *word = 0x080103f8
local gp1<const>: *word = 0x08010240

rodata seed: word[20] = {
	0x00000000, 0x00000001, 0x00000002, 0x00000003,
	0x12345678, 0x87654321, 0x80000000, 0xffffffff,
	0xaaaaaaaa, 0x55555555, 0x0000ffff, 0xffff0000,
	0x01020304, 0x10203040, 0x11223344, 0x55667788,
	0xdeadbeef, 0xcafebabe, 0x7fffffff, 0x80000001,
}

-- E6, a red 64 x 64 fill at (0,0), then the in-order GPU IRQ marker.
rodata gpu_commands: word[5] = {
	0xe6000000, 0x020000ff, 0x00000000, 0x00400040, 0x1f000000,
}

function irq(flags)
	if (flags & 0x00000001) ~= 0 then
		result.dma0_sequence = result.dma0_sequence + 1
	end
	if (flags & 0x00000100) ~= 0 then
		result.dma1_sequence = result.dma1_sequence + 1
	end
	*irq_ack = flags & 0x00000101
end

-- The cartridge owns both channels and GP0. Preserve disabled VBlank pending.
*irq_mask = 0
while (*gp1 & 0x04000000) == 0 do
end
*gp1 = 0x02000000
*irq_ack = 0x00000141
*irq_mask = 0x00000101

-- 1. Cartridge ROM -> RAM: two incrementing endpoints, block length sixteen.
result.seed_address = seed
local seed_sequence<const> = result.dma0_sequence
*dma0_read = seed
*dma0_write = &result.source[0]
*dma0_count = #seed
*dma0_control = 0x00003c03
*dma0_trigger = 1
while result.dma0_sequence == seed_sequence do
	halt_until_irq
end
result.rom_copy.read_address = *dma0_read
result.rom_copy.write_address = *dma0_write
result.rom_copy.count = *dma0_count
result.rom_copy.control = *dma0_control
result.rom_copy.status = *dma0_status
result.rom_copy.trigger = *dma0_trigger
result.completed_phase = 1

-- 2. Prepare both channels BEFORE either START. RAM -> RAM, different blocks.
local copy0_sequence<const> = result.dma0_sequence
local copy1_sequence<const> = result.dma1_sequence
*dma0_read = &result.source[0]
*dma0_write = &result.copies[0][0]
*dma0_count = 20
*dma0_control = 0x00003c03
*dma1_read = &result.source[0]
*dma1_write = &result.copies[1][0]
*dma1_count = 20
*dma1_control = 0x00000c03
*dma0_trigger = 1
*dma1_trigger = 1
result.parallel_status[0] = *dma0_status
result.parallel_status[1] = *dma1_status
while result.dma0_sequence == copy0_sequence or result.dma1_sequence == copy1_sequence do
	halt_until_irq
end
result.parallel[0].read_address = *dma0_read
result.parallel[0].write_address = *dma0_write
result.parallel[0].count = *dma0_count
result.parallel[0].control = *dma0_control
result.parallel[0].status = *dma0_status
result.parallel[0].trigger = *dma0_trigger
result.parallel[1].read_address = *dma1_read
result.parallel[1].write_address = *dma1_write
result.parallel[1].count = *dma1_count
result.parallel[1].control = *dma1_control
result.parallel[1].status = *dma1_status
result.parallel[1].trigger = *dma1_trigger
result.completed_phase = 2

-- 3. ROM -> fixed GP0. GP1 direction 2 supplies the GX_WRITE request gate.
*gp1 = 0x04000002
result.gpu_stream_address = gpu_commands
local gpu_sequence<const> = result.dma0_sequence
*dma0_read = gpu_commands
*dma0_write = 0x0801023c
*dma0_count = #gpu_commands
*dma0_control = 0x00003c41
*dma0_trigger = 1
while result.dma0_sequence == gpu_sequence do
	halt_until_irq
end
-- DMA submission ends before this fill's marker and GPU-idle edge.
result.gpu_at_dma_done = *gp1
result.gpu_copy.read_address = *dma0_read
result.gpu_copy.write_address = *dma0_write
result.gpu_copy.count = *dma0_count
result.gpu_copy.control = *dma0_control
result.gpu_copy.status = *dma0_status
result.gpu_copy.trigger = *dma0_trigger
while (*gp1 & 0x01000000) == 0 do
end
result.gpu_at_marker = *gp1
result.irq_at_marker = *irq_flags
while (*gp1 & 0x04000000) == 0 do
end
result.gpu_at_idle = *gp1
*gp1 = 0x02000000
*irq_ack = 0x00000040
*irq_mask = 0
result.final_irq_flags = *irq_flags
result.completed_phase = 3
while true do
	halt_until_irq
end
