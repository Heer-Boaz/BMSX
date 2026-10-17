module<const>

struct apu_manual_event
	kind: word
	slot: word
	source_address: word
	hardware_sequence: word
end

struct apu_manual_result
	completed_phase: word
	service_sequence: word
	initial_event_sequence: word
	events: apu_manual_event[4]
	pcm_address: word
	pcm_selected_source: word
	pcm_active_mask: word
	pcm_status: word
	pcm_gain: word
	paused_sample_start: word
	paused_sample_end: word
	paused_active_mask: word
	paused_source: word
	paused_gain: word
	upload_dma_status: word
	upload_apu_status: word
	upload_committed_status: word
	transfer_address: word
	download_dma_status: word
	download_apu_status: word
	download_stopped_status: word
	transferred: word[16]
	ram_selected_source: word
	ram_active_mask: word
	square_selected_source: word
	square_active_mask: word
	square_rate_hz: word
	square_duty: word
	badp_address: word
	badp_bytes: word
	badp_version: word
	badp_channels: word
	badp_sample_rate_hz: word
	badp_frames: word
	badp_data_offset: word
	badp_seek_count: word
	badp_seek_offset: word
	badp_selected_source: word
	badp_active_mask: word
	final_active_mask: word
	final_status: word
	final_fault_code: word
	final_fault_detail: word
	initial_unrelated_pending: word
	final_irq_flags: word
end

bss result: apu_manual_result

return { result = result }
