local state<const> = require('results')
local result<const>: *dma_manual_result = state.result
local irq_flags<const>: *word = 0x08000000
local irq_mask<const>: *word = 0x08000008
local gp0<const>: *word = 0x0801023c
local gp1<const>: *word = 0x08010240

rodata expected: word[20] = {
	0x00000000, 0x00000001, 0x00000002, 0x00000003,
	0x12345678, 0x87654321, 0x80000000, 0xffffffff,
	0xaaaaaaaa, 0x55555555, 0x0000ffff, 0xffff0000,
	0x01020304, 0x10203040, 0x11223344, 0x55667788,
	0xdeadbeef, 0xcafebabe, 0x7fffffff, 0x80000001,
}

return {
	kind = 'integration',
	tests = {
		copies_and_separate_gpu_completion = function(t)
			t:wait_until('three DMA phases completed', function()
				return result.completed_phase == 3
			end, 8)
			assert(result.dma0_sequence == 3)
			assert(result.dma1_sequence == 1)
			for index = 0, #expected - 1 do
				assert(result.source[index] == expected[index])
				assert(result.copies[0][index] == expected[index])
				assert(result.copies[1][index] == expected[index])
			end
			assert(result.rom_copy.read_address == result.seed_address + sizeof(word[20]))
			assert(result.rom_copy.write_address == &result.source[0] + sizeof(word[20]))
			assert(result.rom_copy.count == 0)
			assert(result.rom_copy.control == 0x00003c03)
			assert(result.rom_copy.status == 2)
			assert(result.rom_copy.trigger == 0)
			assert(result.parallel_status[0] == 1)
			assert(result.parallel_status[1] == 1)
			for channel = 0, 1 do
				assert(result.parallel[channel].read_address == &result.source[0] + sizeof(word[20]))
				assert(result.parallel[channel].write_address == &result.copies[channel][0] + sizeof(word[20]))
				assert(result.parallel[channel].count == 0)
				assert(result.parallel[channel].status == 2)
				assert(result.parallel[channel].trigger == 0)
			end
			assert(result.parallel[0].control == 0x00003c03)
			assert(result.parallel[1].control == 0x00000c03)
			assert(result.gpu_copy.read_address == result.gpu_stream_address + sizeof(word[5]))
			assert(result.gpu_copy.write_address == 0x0801023c)
			assert(result.gpu_copy.count == 0)
			assert(result.gpu_copy.control == 0x00003c41)
			assert(result.gpu_copy.status == 2)
			assert(result.gpu_copy.trigger == 0)
			assert((result.gpu_at_dma_done & 0x05000000) == 0)
			assert((result.gpu_at_marker & 0x01000000) ~= 0)
			assert((result.irq_at_marker & 0x00000040) ~= 0)
			assert((result.gpu_at_idle & 0x05000000) == 0x05000000)
			assert((result.final_irq_flags & 0x00000141) == 0)
			assert((*irq_flags & 0x00000141) == 0)
			assert(*irq_mask == 0)
			assert((*gp1 & 0x05000000) == 0x04000000)

			-- The marker/idle observations are not pixel proof. Read back a pixel.
			*gp0 = 0xc0000000
			*gp0 = 0x00000000
			*gp0 = 0x00010001
			t:wait_until('red pixel readback ready', function()
				return (*gp1 & 0x08000000) ~= 0
			end, 3)
			assert(*gp0 == 0x0000001f)
			assert((*gp1 & 0x08000000) == 0)
			t:log('60 RAM words match; both channels observed BUSY; DMA IRQ sequences 3/1; all counts zero and DONE; fixed GP0; DMA ended before GPU marker/idle; red pixel 0000001f')
		end,
	},
}
