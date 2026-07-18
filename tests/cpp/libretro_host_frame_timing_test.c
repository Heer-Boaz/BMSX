#include "frame_timing.h"

#define CHECK(condition) do { if (!(condition)) return __LINE__; } while (0)

int main(void) {
	BmsxFrameTimingReport report = {0};
	bmsx_frame_timing_record(&report, 10000000u, 1000000u, true, 2000000u, true, false, true);
	bmsx_frame_timing_record(&report, 5000000000u, 0u, false, 0u, false, true, false);
	const BmsxGxUploadProfileFrameV1 gx_upload = {
		.render_frame_serial = 7u,
		.cpu_to_vram_commands = 2u,
		.logical_bytes = 16u,
		.host_calls = 3u,
		.host_bytes = 32u,
		.cpu_nanoseconds = 400u,
		.max_command_nanoseconds = 300u,
	};
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

	return 0;
}
