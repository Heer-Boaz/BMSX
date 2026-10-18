local state<const> = require('results')
local result<const>: *imgdec_manual_result = state.result
local irq_flags<const>: *word = 0x08000000
local irq_mask<const>: *word = 0x08000008
local gp0<const>: *word = 0x0801023c
local gp1<const>: *word = 0x08010240

rodata expected_output: word[26] = {
	0xa0000000, 0x00400040, 0x00060004,
	0x11112222, 0x33334444, 0x55556666, 0x55556666,
	0x11112222, 0x33334444, 0x55556666, 0x55556666,
	0x00000000, 0x00000000, 0x00000000, 0x00000000,
	0xa0000000, 0x00800040, 0x00010010,
	0x00000000, 0x03e0001f, 0x7fff7c00, 0x42104210,
	0x001f001f, 0x03e003e0, 0x7c007c00, 0x7fff7fff,
}

-- Source rows 64..69, using the independently derived affine UV runs.
rodata picture_probe_rows: word[6][2] = {
	{ 72, 0 }, { 76, 1 }, { 84, 0 },
	{ 92, 1 }, { 100, 2 }, { 108, 2 },
}
-- Four horizontal runs: 28, 32, 32 and 28 pixels, all even lengths.
rodata expected_picture: word[3][4] = {
	{ 0x001f001f, 0x30883088, 0x7c007c00, 0x03e003e0 },
	{ 0x42104210, 0x7fff7fff, 0x42104210, 0x7fff7fff },
	{ 0x30883088, 0x30883088, 0x30883088, 0x30883088 },
}

return {
	kind = 'integration',
	tests = {
		ram_gp0_fault_and_recovery = function(t)
			t:wait_until('four IMGDEC phases completed', function()
				return result.completed_phase == 4
			end, 8)
			assert(result.dma0_sequence == 3)
			assert(result.dma1_sequence == 3)
			assert(result.decoder_sequence == 4)
			for index = 0, #expected_output - 1 do
				assert(result.ram_output[index] == expected_output[index])
			end
			for phase = 0, 3 do
				local observed<const>: *imgdec_manual_phase_result = &result.phases[phase]
				for channel = 0, 1 do
					assert(observed->dma_count[channel] == 0)
					assert(observed->dma_status[channel] == 2)
					if phase == 2 then
						assert(observed->armed_status[channel] == 0)
					else
						assert(observed->armed_status[channel] == 1)
					end
				end
				assert(observed->sequences[2] == phase + 1)
				if phase < 2 then
					assert(observed->status == 2)
					assert(observed->received == 19)
					assert(observed->decoded == 20)
					assert(observed->sequences[0] == phase + 1)
					assert(observed->sequences[1] == phase + 1)
				elseif phase == 2 then
					assert(observed->status == 0x00000010)
					assert(observed->received == 4)
					assert(observed->decoded == 0)
					assert(observed->sequences[0] == 2)
					assert(observed->sequences[1] == 2)
				else
					assert(observed->status == 2)
					assert(observed->received == 3)
					assert(observed->decoded == 0)
					assert(observed->sequences[0] == 3)
					assert(observed->sequences[1] == 3)
				end
			end
			assert((result.gpu_initial_status & 0x6c000000) == 0x44000000)
			assert((result.gpu_idle_status & 0x6c000000) == 0x44000000)
			assert(result.fault_header[0] == 0xa0000000)
			assert(result.fault_header[1] == 0x00400040)
			assert(result.fault_header[2] == 0x00060004)
			assert(result.fault_retained_read == 0x00060004)
			assert(result.recovery_output[0] == 0xa0000000)
			assert(result.recovery_output[1] == 0x00200020)
			assert(result.recovery_output[2] == 0)
			assert((result.final_irq_flags & 0x00000181) == 0)
			assert((*irq_flags & 0x00000181) == 0)
			assert(*irq_mask == 0)
			assert((result.final_irq_flags & 0x00000040) == 0)
			assert((*irq_flags & 0x00000040) == 0)
			assert((*gp1 & 0x0d000000) == 0x04000000)
			-- Allow presentation latching; this is a fixture wait, not a latency.
			t:wait_ticks(2)
			t:capture('imgdec-manual-decoded-indexed-patch')

			-- Completion is not pixel proof. Read all twelve texture words and
			-- all eight CLUT words through actual C0/GPUREAD transactions.
			*gp0 = 0xc0000000
			*gp0 = 0x00400040
			*gp0 = 0x00060004
			t:wait_until('texture readback ready', function()
				return (*gp1 & 0x08000000) ~= 0
			end, 3)
			for index = 0, 11 do
				assert(*gp0 == expected_output[index + 3])
			end
			assert((*gp1 & 0x08000000) == 0)
			*gp0 = 0xc0000000
			*gp0 = 0x00800040
			*gp0 = 0x00010010
			t:wait_until('CLUT readback ready', function()
				return (*gp1 & 0x08000000) ~= 0
			end, 3)
			for index = 0, 7 do
				assert(*gp0 == expected_output[index + 18])
			end
			assert((*gp1 & 0x08000000) == 0)
			-- Probe one complete displayed row for each of the six source rows.
			for row = 0, #picture_probe_rows - 1 do
				*gp0 = 0xc0000000
				*gp0 = 320 | (picture_probe_rows[row][0] << 16)
				*gp0 = 120 | (1 << 16)
				t:wait_until('displayed patch row ready', function()
					return (*gp1 & 0x08000000) ~= 0
				end, 3)
				for pair = 0, 59 do
					local band = 0
					if pair >= 46 then
						band = 3
					elseif pair >= 30 then
						band = 2
					elseif pair >= 14 then
						band = 1
					end
					assert(*gp0 == expected_picture[picture_probe_rows[row][1]][band])
				end
				assert((*gp1 & 0x08000000) == 0)
			end
			*gp0 = 0xc0000000
			*gp0 = 256
			*gp0 = 2 | (1 << 16)
			t:wait_until('outside background ready', function()
				return (*gp1 & 0x08000000) ~= 0
			end, 3)
			assert(*gp0 == 0x0c410c41)
			assert((*gp1 & 0x08000000) == 0)
			t:log('26 RAM output words; 12 texture and 8 CLUT words read back; DMA0/DMA1/IMGDEC IRQ sequences 3/3/4; fault 10H received4 decoded0; retained header and START recovery; 360 displayed-row words plus outside background matched')
		end,
	},
}
