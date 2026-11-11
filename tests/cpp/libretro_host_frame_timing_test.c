#include "frame_timing.h"
#include "native_compilation_profile.h"
#include <string.h>
#include <stddef.h>

#define CHECK(condition) do { if (!(condition)) return __LINE__; } while (0)

int main(void) {
	BmsxFrameTimingReport report = {0};
	const BmsxGxUploadProfileFrameV1 gx_upload = {
		.render_frame_serial = 7u,
		.cpu_to_vram_commands = 2u,
		.logical_bytes = 16u,
		.host_calls = 3u,
		.host_bytes = 32u,
		.cpu_nanoseconds = 400u,
		.max_command_nanoseconds = 300u,
	};
	bmsx_frame_timing_record(&report, 500u, 10000000u, 1000000u, true, 2000000u, true, false, true, &gx_upload, NULL);
	bmsx_frame_timing_record(&report, 501u, 5000000000u, 0u, false, 0u, false, true, false, NULL, NULL);
	bmsx_frame_timing_record_gx_upload(&report, &gx_upload);

	CHECK(report.retro_run.count == 2u);
	CHECK(report.retro_run.max_ns == 5000000000u);
	CHECK(report.core_without_present.buckets[7] == 1u);
	CHECK(report.final_blit.count == 1u);
	CHECK(report.final_blit.buckets[1] == 1u);
	CHECK(report.swap.count == 1u);
	CHECK(report.swap.buckets[2] == 1u);
	CHECK(report.presented_frames == 1u);
	CHECK(report.dropped_presentations == 1u);
	CHECK(report.gx_profiled_frames == 1u);
	CHECK(report.gx_cpu_to_vram_commands == 2u);
	CHECK(report.gx_logical_bytes == 16u);
	CHECK(report.gx_host_calls == 3u);
	CHECK(report.gx_host_bytes == 32u);
	CHECK(report.gx_cpu_nanoseconds == 400u);
	CHECK(report.gx_max_frame_nanoseconds == 400u);
	CHECK(report.gx_max_command_nanoseconds == 300u);
	CHECK(bmsx_frame_timing_percentile_ms(&report.retro_run, 99u) == BMSX_FRAME_TIMING_BUCKET_COUNT - 1u);
	CHECK(report.slow_frame_count == 2u);
	CHECK(report.slow_frames[0].host_frame == 501u);
	CHECK(report.slow_frames[0].dropped && !report.slow_frames[0].presented);
	CHECK(!report.slow_frames[0].has_gx_upload);
	CHECK(report.slow_frames[0].gx_upload.cpu_to_vram_commands == 0u);
	CHECK(report.slow_frames[1].host_frame == 500u);
	CHECK(report.slow_frames[1].has_gx_upload);
	CHECK(report.slow_frames[1].gx_upload.render_frame_serial == 7u);
	CHECK(report.slow_frames[1].gx_upload.cpu_nanoseconds == 400u);
	CHECK(report.slow_frames[1].final_blit_ns == 1000000u);
	CHECK(report.slow_frames[1].swap_ns == 2000000u);
	for (unsigned index = 0u; index < 100u; ++index) {
		bmsx_frame_timing_record(&report, 502u + index, index * 1000000ull, 0u, false, 0u, false, false, true, NULL, NULL);
	}
	CHECK(report.slow_frame_count == BMSX_FRAME_TIMING_SLOW_FRAME_COUNT);
	CHECK(report.slow_frames[0].host_frame == 501u);
	CHECK(report.slow_frames[1].host_frame == 601u);
	CHECK(report.slow_frames[BMSX_FRAME_TIMING_SLOW_FRAME_COUNT - 1u].host_frame == 571u);
	CHECK(report.slow_frames[1].gx_upload.render_frame_serial == 0u);

	// Timed-window totals exclude the earlier baseline; live sizes can shrink,
	// while lifetime maxima and their raw guest identity must not be differenced.
	BmsxFrameTimingReport native_report = {0};
	const BmsxNativeCompilationProfile before = {
		.prepare_requests = 10u, .regions_published = 9u, .entries_published = 30u,
		.source_instructions = 100u, .emitted_code_bytes = 900u,
		.code_bytes = 900u, .peak_code_bytes = 1000u,
		.prepare_nanoseconds = 6000000u, .max_prepare_nanoseconds = 3000000u,
		.discovery_nanoseconds = 2000000u, .compilation_nanoseconds = 4000000u,
		.max_prepare_domain = -1, .max_prepare_cartridge_slot = 1u,
		.max_prepare_root_pc = 0x1234u, .max_prepare_page_pc = 0x1000u,
	};
	BmsxNativeCompilationProfile after = before;
	after.prepare_requests += 2u; after.regions_published += 2u;
	after.entries_published += 5u; after.source_instructions += 20u;
	after.emitted_code_bytes += 120u; after.code_bytes = 120u;
	after.prepare_nanoseconds += 2000000u;
	after.discovery_nanoseconds += 500000u;
	after.retirement_nanoseconds += 250000u;
	after.compilation_nanoseconds += 1250000u;
	after.merged_regions = 1u; after.merged_code_bytes = 100u;
	after.capacity_flushes = 1u; after.capacity_retired_code_bytes = 800u;
	const BmsxNativeCompilationProfile interval = bmsx_native_compilation_profile_delta(&before, &after);
	CHECK(interval.prepare_requests == 2u && interval.regions_published == 2u);
	CHECK(interval.entries_published == 5u && interval.source_instructions == 20u);
	CHECK(interval.emitted_code_bytes == 120u && interval.code_bytes == 120u);
	CHECK(interval.prepare_nanoseconds == 2000000u && interval.max_prepare_nanoseconds == 3000000u);
	CHECK(interval.peak_code_bytes == 1000u && interval.max_prepare_root_pc == 0x1234u);
	bmsx_frame_timing_record(&native_report, 20u, 10000000u, 0u, false, 0u, false, false, true, NULL, &interval);
	const BmsxNativeCompilationProfile idle = bmsx_native_compilation_profile_delta(&after, &after);
	CHECK(idle.prepare_requests == 0u && idle.prepare_nanoseconds == 0u && idle.emitted_code_bytes == 0u);
	CHECK(idle.code_bytes == 120u && idle.max_prepare_nanoseconds == 3000000u);
	bmsx_frame_timing_record(&native_report, 21u, 5000000u, 0u, false, 0u, false, false, true, NULL, &idle);
	CHECK(native_report.native_profiled_frames == 2u);
	CHECK(native_report.native_compilation.prepare_requests == 2u);
	CHECK(native_report.native_compilation.prepare_nanoseconds == 2000000u);
	CHECK(native_report.native_compilation.discovery_nanoseconds == 500000u);
	CHECK(native_report.native_compilation.retirement_nanoseconds == 250000u);
	CHECK(native_report.native_compilation.compilation_nanoseconds == 1250000u);
	CHECK(native_report.native_compilation.max_prepare_nanoseconds == 3000000u);
	CHECK(native_report.native_compilation.peak_code_bytes == 1000u);
	CHECK(native_report.native_compilation.capacity_flushes == 1u);
	CHECK(native_report.native_compilation.capacity_retired_code_bytes == 800u);
	CHECK(native_report.native_compilation.merged_regions == 1u && native_report.native_compilation.merged_code_bytes == 100u);
	CHECK(native_report.slow_frames[0].has_native_compilation);
	CHECK(native_report.slow_frames[0].native_compilation.prepare_nanoseconds == 2000000u);
	CHECK(native_report.slow_frames[1].native_compilation.prepare_nanoseconds == 0u);
	FILE* output = tmpfile();
	CHECK(output != NULL);
	bmsx_native_compilation_profile_print(output, native_report.native_profiled_frames, &native_report.native_compilation);
	rewind(output);
	char line[2048];
	CHECK(fgets(line, sizeof(line), output) != NULL);
	CHECK(strstr(line, "frames=2 prepares=2 regions=2 entries=5") != NULL);
	CHECK(strstr(line, "live_code_bytes=120 lifetime_peak_code_bytes=1000") != NULL);
	CHECK(strstr(line, "total_prepare_ms=2.000") != NULL);
	CHECK(strstr(line, "lifetime_max_prepare_ms=3.000") != NULL);
	CHECK(strstr(line, "max_prepare_domain=-1 max_prepare_slot=1 max_prepare_root_pc=00001234 max_prepare_page_pc=00001000") != NULL);
	CHECK(fclose(output) == 0);

	return 0;
}
