#pragma once

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#include "bmsx_libretro.h"
#include "execution_profile.h"

enum { BMSX_FRAME_TIMING_BUCKET_COUNT = 4097 };
enum { BMSX_FRAME_TIMING_SLOW_FRAME_COUNT = 32 };
enum { BMSX_FRAME_TIMING_OUTLIER_NS = 15000000 };

typedef struct BmsxGuestProgressInterval {
	BmsxGuestProgressV1 before;
	BmsxGuestProgressV1 after;
} BmsxGuestProgressInterval;

typedef struct BmsxFrameTimingOutlier {
	uint64_t host_frame;
	uint64_t run_ns;
	uint64_t core_without_present_ns;
	uint64_t period_ns;
	bool missed_deadline;
	BmsxGuestProgressInterval guest;
} BmsxFrameTimingOutlier;

typedef struct BmsxSlowFrameSample {
	uint64_t host_frame;
	uint64_t host_run_start_monotonic_ns;
	uint64_t retro_run_ns;
	uint64_t host_main_thread_cpu_ns;
	uint64_t host_process_cpu_ns;
	uint64_t final_blit_ns;
	uint64_t swap_ns;
	bool dropped;
	bool presented;
	bool has_gx_upload;
	BmsxGxUploadProfileFrameV1 gx_upload;
	bool has_native_compilation;
	BmsxNativeCompilationProfile native_compilation;
	bool has_execution;
	BmsxExecutionProfileInterval execution;
} BmsxSlowFrameSample;

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
	uint64_t over_period_runs;
	uint64_t paced_runs;
	uint64_t missed_deadlines;
	BmsxGuestProgressInterval guest;
	uint64_t guest_progress_runs;
	uint64_t zero_guest_tick_runs;
	uint64_t zero_guest_cycle_runs;
	uint64_t guest_first_run_start_ns;
	uint64_t guest_last_run_end_ns;
	uint64_t guest_process_cpu_ns;
	uint64_t gx_profiled_frames;
	uint64_t native_profiled_frames;
	BmsxNativeCompilationProfile native_compilation;
	uint64_t gx_cpu_to_vram_commands;
	uint64_t gx_logical_bytes;
	uint64_t gx_host_calls;
	uint64_t gx_host_bytes;
	uint64_t gx_cpu_nanoseconds;
	uint64_t gx_max_frame_nanoseconds;
	uint64_t gx_max_command_nanoseconds;
	BmsxSlowFrameSample slow_frames[BMSX_FRAME_TIMING_SLOW_FRAME_COUNT];
	unsigned slow_frame_count;
	BmsxFrameTimingOutlier* outliers;
	size_t outlier_count;
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
		uint64_t host_frame,
		uint64_t host_run_start_monotonic_ns,
		uint64_t retro_run_ns,
		uint64_t period_ns,
		uint64_t finish_deadline_ns,
		uint64_t final_blit_ns,
		bool final_blit_ran,
		uint64_t swap_ns,
		bool swap_ran,
		bool dropped,
		bool presented,
		const BmsxGxUploadProfileFrameV1* gx_upload,
		const BmsxNativeCompilationProfile* native_compilation,
		const BmsxExecutionProfileInterval* execution,
		uint64_t host_main_thread_cpu_ns,
		uint64_t host_process_cpu_ns,
		const BmsxGuestProgressInterval* guest);
void bmsx_frame_timing_record_gx_upload(
	BmsxFrameTimingReport* report,
	const BmsxGxUploadProfileFrameV1* frame);
uint64_t bmsx_frame_timing_percentile_ms(const BmsxFrameTimingHistogram* histogram, uint64_t numerator);
void bmsx_frame_timing_print(
	const BmsxFrameTimingReport* report,
	uint64_t warmup_frames,
	bool include_gx_upload);
