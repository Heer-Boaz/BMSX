#include "frame_timing.h"
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
	bmsx_frame_timing_record(&report, 500u, 10000000u, 1000000u, true, 2000000u, true, false, true, &gx_upload);
	bmsx_frame_timing_record(&report, 501u, 5000000000u, 0u, false, 0u, false, true, false, NULL);
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
		bmsx_frame_timing_record(&report, 502u + index, index * 1000000ull, 0u, false, 0u, false, false, true, NULL);
	}
	CHECK(report.slow_frame_count == BMSX_FRAME_TIMING_SLOW_FRAME_COUNT);
	CHECK(report.slow_frames[0].host_frame == 501u);
	CHECK(report.slow_frames[1].host_frame == 601u);
	CHECK(report.slow_frames[BMSX_FRAME_TIMING_SLOW_FRAME_COUNT - 1u].host_frame == 571u);
	CHECK(report.slow_frames[1].gx_upload.render_frame_serial == 0u);

	return 0;
}
