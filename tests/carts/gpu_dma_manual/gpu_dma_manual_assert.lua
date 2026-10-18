local storage<const> = require('storage')
local upload<const>: *word[44] = storage.upload
local returned<const>: *word[41] = storage.returned
local result<const>: *gpu_dma_status = storage.status
local gp1<const>: *word = 0x08010240

return {
	kind = 'integration',
	tests = {
		raw_image_roundtrip = function(t)
			t:wait_until('image DMA roundtrip completed', function()
				return result.phase == 3
			end, 8)
			for index = 0, 39 do
				assert(returned[index] == upload[index + 3])
			end
			assert(upload[43] == 0xffff0051)
			assert(returned[40] == 0x00000051)
			assert(result.upload_status == 2)
			assert(result.upload_count == 0)
			assert(result.upload_source_end == upload + sizeof(word[44]))
			assert(result.upload_destination == 0x0801023c)
			assert((result.read_ready_status & 0x0d000000) == 0x08000000)
			assert(result.read_busy_status == 1)
			assert(result.read_owned_latch == result.read_latch_before)
			assert(result.read_status == 2)
			assert(result.read_count == 0)
			assert(result.read_source == 0x0801023c)
			assert(result.read_destination_end == returned + sizeof(word[41]))
			assert((result.read_gpu_status & 0x08000000) == 0)
			assert((result.marker_status & 0x01000000) ~= 0)
			assert((result.idle_status & 0x05000000) == 0x05000000)
			assert(result.final_latch == 0x00000051)
			assert((*gp1 & 0x6d000000) == 0x04000000)
			t:log('44 RAM words uploaded; all 41 returned words match; odd tail FFFF0051 -> 00000051; fixed GP0 endpoints; BUSY CPU read retained latch; READY drained; marker and idle observed separately')
		end,
	},
}
