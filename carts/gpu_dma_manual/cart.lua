module<entry>

local storage<const> = require('storage')
local upload<const>: *word[44] = storage.upload
local returned<const>: *word[41] = storage.returned
local result<const>: *gpu_dma_status = storage.status
local irq_ack<const>: *word = 0x08000004
local irq_mask<const>: *word = 0x08000008
local dma_read<const>: *word = 0x0800000c
local dma_write<const>: *word = 0x08000010
local dma_count<const>: *word = 0x08000014
local dma_control<const>: *word = 0x08000018
local dma_status<const>: *word = 0x0800001c
local dma_trigger<const>: *word = 0x08000020
local gp0<const>: *word = 0x0801023c
local gp1<const>: *word = 0x08010240

function irq(flags)
	*irq_ack = flags & 0x00000041
end

-- Sole ownership of DMA0 and the GPU ports. Polling, not an IRQ wait.
*irq_mask = 0
while (*gp1 & 0x04000000) == 0 do
end
*gp1 = 0x00000000
*irq_ack = 0x00000041
*gp1 = 0x09000000
*gp0 = 0xe6000000

-- RAM -> fixed GP0, GX_WRITE, blocks of up to sixteen words.
*gp1 = 0x04000002
*dma_read = upload
*dma_write = 0x0801023c
*dma_count = #storage.upload
*dma_control = 0x00003c41
*dma_trigger = 1
while (*dma_status & 2) == 0 do
end
result.upload_gpu_status = *gp1
result.upload_status = *dma_status
result.upload_count = *dma_count
result.upload_source_end = *dma_read
result.upload_destination = *dma_write
result.phase = 1

-- DONE releases DMA's write ownership. Finish the GPU stream separately.
*gp0 = 0x1f000000
while (*gp1 & 0x01000000) == 0 do
end
while (*gp1 & 0x04000000) == 0 do
end
*gp1 = 0x02000000
*irq_ack = 0x00000040
result.read_latch_before = *gp0

-- Three C0 header words; the following marker is NOT readback payload.
*gp0 = 0xc0000000
*gp0 = 96 | (64 << 16)
*gp0 = 9 | (9 << 16)
*gp0 = 0x1f000000
while (*gp1 & 0x08000000) == 0 do
end
result.read_ready_status = *gp1

-- Fixed GPUREAD -> RAM, GX_READ, forty-one packed words, not 81 reads.
*gp1 = 0x04000003
*dma_read = 0x0801023c
*dma_write = returned
*dma_count = #storage.returned
*dma_control = 0x00003c0a
*dma_trigger = 1
result.read_busy_status = *dma_status
result.read_owned_latch = *gp0
while (*dma_status & 2) == 0 do
end
result.read_gpu_status = *gp1
result.read_status = *dma_status
result.read_count = *dma_count
result.read_source = *dma_read
result.read_destination_end = *dma_write
result.phase = 2

-- Final read releases the barrier; marker and idle remain separate conditions.
while (*gp1 & 0x01000000) == 0 do
end
result.marker_status = *gp1
while (*gp1 & 0x04000000) == 0 do
end
result.idle_status = *gp1
result.final_latch = *gp0
*gp1 = 0x02000000
*irq_ack = 0x00000041
*gp1 = 0x04000000
result.phase = 3
while true do
	halt_until_irq
end
