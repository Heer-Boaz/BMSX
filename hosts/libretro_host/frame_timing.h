#pragma once

#include <stdbool.h>
#include <stdint.h>

#include "bmsx_libretro.h"

enum { BMSX_FRAME_TIMING_BUCKET_COUNT = 4097 };

typedef struct BmsxFrameTimingHistogram {
	uint64_t buckets[BMSX_FRAME_TIMING_BUCKET_COUNT];
	uint64_t count;
	uint64_t total_ns;
	uint64_t max_ns;
} BmsxFrameTimingHistogram;

typedef struct BmsxFrameTimingReport {
	BmsxFrameTimingHistogram retro_run;
	BmsxFrameTimingHistogram core_without_present;
	BmsxFrameTimingHistogram final_blit;
	BmsxFrameTimingHistogram swap;
	uint64_t presented_frames;
	uint64_t dropped_presentations;
	uint64_t gx_profiled_frames;
	uint64_t gx_cpu_to_vram_commands;
	uint64_t gx_logical_bytes;
	uint64_t gx_host_calls;
	uint64_t gx_host_bytes;
	uint64_t gx_cpu_nanoseconds;
	uint64_t gx_max_frame_nanoseconds;
	uint64_t gx_max_command_nanoseconds;
} BmsxFrameTimingReport;

typedef struct BmsxFrameTimingState {
	bool enabled;
	bool record_frame;
	uint64_t warmup_frames;
	uint64_t current_blit_ns;
	uint64_t current_swap_ns;
	bool current_blit_ran;
	bool current_swap_ran;
	bool current_video_frame_received;
	uint64_t gx_render_frame_serial;
	BmsxFrameTimingReport report;
} BmsxFrameTimingState;

void bmsx_frame_timing_record(BmsxFrameTimingReport* report,
		uint64_t retro_run_ns,
		uint64_t final_blit_ns,
		bool final_blit_ran,
		uint64_t swap_ns,
		bool swap_ran,
		bool dropped,
		bool presented);
void bmsx_frame_timing_record_gx_upload(
	BmsxFrameTimingReport* report,
	const BmsxGxUploadProfileFrameV1* frame);
uint64_t bmsx_frame_timing_percentile_ms(const BmsxFrameTimingHistogram* histogram, uint64_t numerator);
void bmsx_frame_timing_print(
	const BmsxFrameTimingReport* report,
	uint64_t warmup_frames,
	bool include_gx_upload);
