#pragma once

#include <stdbool.h>
#include <stdint.h>

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
uint64_t bmsx_frame_timing_percentile_ms(const BmsxFrameTimingHistogram* histogram, uint64_t numerator);
void bmsx_frame_timing_print(const BmsxFrameTimingReport* report, uint64_t warmup_frames);
