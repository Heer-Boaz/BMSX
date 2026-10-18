local state<const> = require('results')
local result<const>: *cartridge_manual_result = state.result
local bus_fault<const>: *word = 0x08010208

return {
	kind = 'integration',
	tests = {
		two_sockets_local_edges_and_cross_socket_dma = function(t)
			t:wait_until('two-socket program completed', function()
				return result.completed == 1
			end, 2)
			assert(result.boot_status == 3)
			assert(result.selection_word == 0x80000001)
			assert(result.selected_status == 0x00010003)
			assert(result.data_card_rom == 0)
			assert(result.ram_words[0] == 0x10203040)
			assert(result.ram_words[1] == 0x50607080)
			for slot = 0, 1 do
				local source_bit<const> = 0x00000200 << slot
				assert(result.mail_data[slot] == (0x6d61696c | slot))
				assert(result.mail_control[slot] == 0x80000000)
				assert(result.local_pending[slot] == 1)
				assert(result.first_edge[slot] == source_bit)
				assert(result.coalesced[slot] == 0)
				assert(result.rearmed[slot] == source_bit)
				assert(result.after_ack[slot] == 0)
			end
			assert(result.requests[0] == 2 and result.requests[1] == 4)
			assert(result.dma_selection == 1)
			assert(result.dma_control == 0x00000e63)
			assert(result.dma_status == 2 and result.dma_count == 0)
			assert(result.dma_read_end == result.seed_address + 16)
			assert(result.dma_write_end == 0x30000020)
			assert(result.dma_pending == 1)
			assert(result.received[0] == 0x01234567)
			assert(result.received[1] == 0x89abcdef)
			assert(result.received[2] == 0x55aa33cc)
			assert(result.received[3] == 0xf00dcafe)
			for index = 0, 3 do
				assert(result.untouched[index] == 0)
			end
			assert(*bus_fault == 0)
			t:log('both RAMs, raw selectors, both local IRQ rearms and slot0-ROM to slot1-RAM DMA pass with CPU SELECT1')
		end,
	},
}
