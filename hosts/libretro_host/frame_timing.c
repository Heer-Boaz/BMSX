#include "frame_timing.h"

#include <stddef.h>
#include <stdio.h>

static void record_histogram(BmsxFrameTimingHistogram* histogram, uint64_t elapsed_ns) {
	uint64_t bucket = elapsed_ns / 1000000ull;
	if (bucket >= BMSX_FRAME_TIMING_BUCKET_COUNT) {
		bucket = BMSX_FRAME_TIMING_BUCKET_COUNT - 1u;
	}
	histogram->buckets[bucket] += 1u;
	histogram->count += 1u;
	histogram->total_ns += elapsed_ns;
	if (histogram->max_ns < elapsed_ns) {
		histogram->max_ns = elapsed_ns;
	}
}

uint64_t bmsx_frame_timing_percentile_ms(const BmsxFrameTimingHistogram* histogram, uint64_t numerator) {
	const uint64_t target = (histogram->count * numerator + 99u) / 100u;
	uint64_t accumulated = 0u;
	for (uint64_t bucket = 0u; bucket < BMSX_FRAME_TIMING_BUCKET_COUNT; bucket += 1u) {
		accumulated += histogram->buckets[bucket];
		if (accumulated >= target) {
			return bucket;
		}
	}
	return 0u;
}

static void print_histogram(const char* label, const BmsxFrameTimingHistogram* histogram) {
	const double average_ms = histogram->count == 0u
		? 0.0
		: (double)histogram->total_ns / (double)histogram->count / 1000000.0;
	const uint64_t p95_ms = bmsx_frame_timing_percentile_ms(histogram, 95u);
	const uint64_t p99_ms = bmsx_frame_timing_percentile_ms(histogram, 99u);
	fprintf(stderr,
			"[libretro-host][timing] %s count=%llu avg_ms=%.3f p95_ms=%llu%s p99_ms=%llu%s max_ms=%.3f buckets_ms=",
			label,
			(unsigned long long)histogram->count,
			average_ms,
			(unsigned long long)p95_ms,
			p95_ms == BMSX_FRAME_TIMING_BUCKET_COUNT - 1u ? "+" : "",
			(unsigned long long)p99_ms,
			p99_ms == BMSX_FRAME_TIMING_BUCKET_COUNT - 1u ? "+" : "",
			(double)histogram->max_ns / 1000000.0);
	const char* separator = "";
	for (size_t bucket = 0u; bucket < BMSX_FRAME_TIMING_BUCKET_COUNT; bucket += 1u) {
		if (histogram->buckets[bucket] == 0u) {
			continue;
		}
		fprintf(stderr,
				"%s%zu:%llu",
				separator,
				bucket,
				(unsigned long long)histogram->buckets[bucket]);
		separator = ",";
	}
	fputc('\n', stderr);
}

void bmsx_frame_timing_record(BmsxFrameTimingReport* report,
		uint64_t retro_run_ns,
		uint64_t final_blit_ns,
		bool final_blit_ran,
		uint64_t swap_ns,
		bool swap_ran,
		bool dropped,
		bool presented) {
	record_histogram(&report->retro_run, retro_run_ns);
	record_histogram(&report->core_without_present, retro_run_ns - final_blit_ns - swap_ns);
	if (final_blit_ran) {
		record_histogram(&report->final_blit, final_blit_ns);
	}
	if (swap_ran) {
		record_histogram(&report->swap, swap_ns);
	}
	if (dropped) {
		report->dropped_presentations += 1u;
	}
	if (presented) {
		report->presented_frames += 1u;
	}
}

void bmsx_frame_timing_record_gx_upload(
		BmsxFrameTimingReport* report,
		const BmsxGxUploadProfileFrameV1* frame) {
	report->gx_profiled_frames += 1u;
	report->gx_cpu_to_vram_commands += frame->cpu_to_vram_commands;
	report->gx_logical_bytes += frame->logical_bytes;
	report->gx_host_calls += frame->host_calls;
	report->gx_host_bytes += frame->host_bytes;
	report->gx_cpu_nanoseconds += frame->cpu_nanoseconds;
	if (report->gx_max_frame_nanoseconds < frame->cpu_nanoseconds) {
		report->gx_max_frame_nanoseconds = frame->cpu_nanoseconds;
	}
	if (report->gx_max_command_nanoseconds < frame->max_command_nanoseconds) {
		report->gx_max_command_nanoseconds = frame->max_command_nanoseconds;
	}
}

void bmsx_frame_timing_print(
		const BmsxFrameTimingReport* report,
		uint64_t warmup_frames,
		bool include_gx_upload) {
	print_histogram("retro_run", &report->retro_run);
	print_histogram("core_without_present", &report->core_without_present);
	print_histogram("final_blit", &report->final_blit);
	print_histogram("swap", &report->swap);
	fprintf(stderr,
			"[libretro-host][timing] presented=%llu dropped=%llu warmup_frames=%llu\n",
			(unsigned long long)report->presented_frames,
			(unsigned long long)report->dropped_presentations,
			(unsigned long long)warmup_frames);
	if (!include_gx_upload) {
		return;
	}
	const double gx_average_frame_ms = report->gx_profiled_frames == 0u
		? 0.0
		: (double)report->gx_cpu_nanoseconds / (double)report->gx_profiled_frames / 1000000.0;
	const double gx_average_command_ms = report->gx_cpu_to_vram_commands == 0u
		? 0.0
		: (double)report->gx_cpu_nanoseconds / (double)report->gx_cpu_to_vram_commands / 1000000.0;
	fprintf(stderr,
			"[libretro-host][gx-upload] frames=%llu commands=%llu logical_bytes=%llu host_calls=%llu host_bytes=%llu total_cpu_ms=%.3f avg_frame_ms=%.3f avg_command_ms=%.3f max_frame_ms=%.3f max_command_ms=%.3f\n",
			(unsigned long long)report->gx_profiled_frames,
			(unsigned long long)report->gx_cpu_to_vram_commands,
			(unsigned long long)report->gx_logical_bytes,
			(unsigned long long)report->gx_host_calls,
			(unsigned long long)report->gx_host_bytes,
			(double)report->gx_cpu_nanoseconds / 1000000.0,
			gx_average_frame_ms,
			gx_average_command_ms,
			(double)report->gx_max_frame_nanoseconds / 1000000.0,
			(double)report->gx_max_command_nanoseconds / 1000000.0);
}
