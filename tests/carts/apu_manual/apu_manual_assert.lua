local state<const> = require('results')
local result<const>: *apu_manual_result = state.result
local irq_flags<const>: *word = 0x08000000
local irq_mask<const>: *word = 0x08000008
local selected<const>: *apu_command_registers = 0x08000194
local commands<const>: *apu_command_registers = 0x08000120
local transfer_control<const>: *word = 0x080001f0

rodata expected_pcm: i16[32] = {
	0, 3135, 5793, 7568, 8192, 7568, 5793, 3135,
	0, -3135, -5793, -7568, -8192, -7568, -5793, -3135,
	0, 3135, 5793, 7568, 8192, 7568, 5793, 3135,
	0, -3135, -5793, -7568, -8192, -7568, -5793, -3135,
}
local expected_words<const>: *word = expected_pcm

return {
	kind = 'integration',
	tests = {
		pcm_transfer_generator_and_badp = function(t)
			t:wait_until('four APU routes completed', function()
				return result.completed_phase == 4
			end, 80)
			assert(result.pcm_address >= 0x10000000)
			assert(result.pcm_address < 0x30000000)
			assert(result.pcm_selected_source == result.pcm_address)
			assert(result.pcm_active_mask == 0x00000004)
			assert((result.pcm_status & 0x00000007) == 6)
			assert(result.pcm_gain == 0xfffff800)
			assert(((result.paused_sample_end - result.paused_sample_start) & 0xffffffff) >= 2205)
			assert(result.paused_active_mask == 0x00000004)
			assert(result.paused_source == result.pcm_address)
			assert(result.paused_gain == 0xfffff800)
			assert(result.upload_dma_status == 2)
			assert((result.upload_apu_status & 0x00000400) ~= 0)
			assert((result.upload_committed_status & 0x00000400) == 0)
			assert(result.transfer_address == 0)
			assert(result.download_dma_status == 2)
			assert((result.download_apu_status & 0x00000400) ~= 0)
			assert((result.download_stopped_status & 0x00000780) == 0)
			for index = 0, 15 do
				assert(result.transferred[index] == expected_words[index])
			end
			assert(result.ram_selected_source == 0x40000000)
			assert(result.ram_active_mask == 0x00000008)
			assert(result.square_selected_source == 0)
			assert(result.square_active_mask == 0x00000010)
			assert(result.square_rate_hz == 440)
			assert(result.square_duty == 0x00000800)
			assert(result.badp_address >= 0x10000000)
			assert(result.badp_address < 0x30000000)
			assert(result.badp_bytes == 2333)
			assert(result.badp_version == 1)
			assert(result.badp_channels == 1)
			assert(result.badp_sample_rate_hz == 44100)
			assert(result.badp_frames == 4410)
			assert(result.badp_data_offset == 56)
			assert(result.badp_seek_count == 1)
			assert(result.badp_seek_offset == 48)
			assert(result.badp_selected_source == result.badp_address)
			assert(result.badp_active_mask == 0x00000020)
			assert(result.service_sequence == 4)
			for index = 0, 3 do
				assert(result.events[index].kind == 1)
				assert(result.events[index].slot == index + 2)
				assert(result.events[index].hardware_sequence == ((result.initial_event_sequence + index + 1) & 0xffffffff))
			end
			assert(result.events[0].source_address == result.pcm_address)
			assert(result.events[1].source_address == 0x40000000)
			assert(result.events[2].source_address == 0)
			assert(result.events[3].source_address == result.badp_address)
			assert(result.final_active_mask == 0)
			assert((result.final_status & 0x00000787) == 0)
			assert(result.final_fault_code == 0)
			assert(result.final_fault_detail == 0)
			assert(result.initial_unrelated_pending == 4)
			assert((result.final_irq_flags & 0x00000125) == 4)
			assert((*irq_flags & 0x00000125) == 4)
			assert(*irq_mask == 0)
			assert(*transfer_control == 0)
			-- Natural/fade ends cleared every selected bank, not only ACTIVE_MASK.
			for slot = 2, 5 do
				commands->slot = slot
				local words<const>: *word = selected
				for index = 0, 20 do
					assert(words[index] == 0)
				end
			end
			t:log('ROM PCM16; live signed gain; paused active slot with advancing sample clock; sixteen-word private-RAM round trip; RAM PCM; 440 Hz square configuration; normal BADP asset; four ordered end events; selected banks cleared; no APU faults; disabled VBlank pending preserved')
			t:log('retained raw words: upload DMA=' .. result.upload_dma_status .. ', APU=' .. result.upload_apu_status .. ', committed APU=' .. result.upload_committed_status .. '; download DMA=' .. result.download_dma_status .. ', APU=' .. result.download_apu_status .. ', STOP APU=' .. result.download_stopped_status .. '; paused sample distance=' .. ((result.paused_sample_end - result.paused_sample_start) & 0xffffffff) .. '; events=' .. result.service_sequence .. ', final active=' .. result.final_active_mask .. ', final status=' .. result.final_status .. ', pending=' .. result.final_irq_flags)
		end,
	},
}
