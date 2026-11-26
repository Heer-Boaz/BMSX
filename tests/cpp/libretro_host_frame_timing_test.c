#include "frame_timing.h"
#include "native_compilation_profile.h"
#include <string.h>
#include <stddef.h>

#define CHECK(condition) do { if (!(condition)) return __LINE__; } while (0)

int main(void) {
	BmsxFrameTimingOutlier outliers[102];
	BmsxFrameTimingReport report = {.outliers = outliers};
	const BmsxGxUploadProfileFrameV2 gx_upload = {
		.render_frame_serial = 7u,
		.cpu_to_vram_commands = 2u,
		.logical_bytes = 16u,
		.host_calls = 3u,
		.host_bytes = 32u,
		.elapsed_nanoseconds = 400u,
		.max_command_nanoseconds = 300u,
		.software_scanout_pixels = 49152u,
		.software_scanout_nanoseconds = 500u,
		.scanout_upload_calls = 1u,
		.scanout_upload_bytes = 196608u,
		.scanout_upload_nanoseconds = 600u,
	};
	bmsx_frame_timing_record(&report, 500u, UINT64_C(9007199254740997), 10000000u, 20000000u, UINT64_C(9007199264740997), 1000000u, true, 2000000u, true, false, true, &gx_upload, NULL, NULL, UINT64_C(9007199254740993), UINT64_C(18014398509481989), NULL);
	bmsx_frame_timing_record(&report, 501u, 0u, 5000000000u, 16683333u, 16683333u, 0u, false, 0u, false, true, false, NULL, NULL, NULL, 0u, 0u, NULL);
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
	CHECK(report.over_period_runs == 1u && report.paced_runs == 2u && report.missed_deadlines == 1u);
	CHECK(report.gx_profiled_frames == 1u);
	CHECK(report.gx_cpu_to_vram_commands == 2u);
	CHECK(report.gx_logical_bytes == 16u);
	CHECK(report.gx_host_calls == 3u);
	CHECK(report.gx_host_bytes == 32u);
	CHECK(report.gx_elapsed_nanoseconds == 400u);
	CHECK(report.gx_max_frame_nanoseconds == 400u);
	CHECK(report.gx_max_command_nanoseconds == 300u);
	CHECK(report.gx_software_scanout_pixels == 49152u && report.gx_software_scanout_nanoseconds == 500u);
	CHECK(report.gx_scanout_upload_calls == 1u && report.gx_scanout_upload_bytes == 196608u && report.gx_scanout_upload_nanoseconds == 600u);
	CHECK(bmsx_frame_timing_percentile_ms(&report.retro_run, 99u) == BMSX_FRAME_TIMING_BUCKET_COUNT - 1u);
	CHECK(report.slow_frame_count == 2u);
	CHECK(report.slow_frames[0].host_frame == 501u);
	CHECK(report.slow_frames[0].dropped && !report.slow_frames[0].presented);
	CHECK(!report.slow_frames[0].has_gx_upload);
	CHECK(report.slow_frames[0].gx_upload.cpu_to_vram_commands == 0u);
	CHECK(report.slow_frames[1].host_frame == 500u);
	CHECK(report.slow_frames[1].host_run_start_monotonic_ns == UINT64_C(9007199254740997));
	CHECK(report.slow_frames[0].host_run_start_monotonic_ns == 0u);
	CHECK(report.slow_frames[1].host_main_thread_cpu_ns == UINT64_C(9007199254740993));
	CHECK(report.slow_frames[1].host_process_cpu_ns == UINT64_C(18014398509481989));
	CHECK(report.slow_frames[0].host_main_thread_cpu_ns == 0u);
	CHECK(report.slow_frames[0].host_process_cpu_ns == 0u);
	CHECK(report.slow_frames[1].has_gx_upload);
	CHECK(report.slow_frames[1].gx_upload.render_frame_serial == 7u);
	CHECK(report.slow_frames[1].gx_upload.elapsed_nanoseconds == 400u);
	CHECK(report.slow_frames[1].gx_upload.software_scanout_nanoseconds == 500u);
	CHECK(report.slow_frames[1].gx_upload.scanout_upload_nanoseconds == 600u);
	CHECK(report.slow_frames[1].final_blit_ns == 1000000u);
	CHECK(report.slow_frames[1].swap_ns == 2000000u);
	for (unsigned index = 0u; index < 100u; ++index) {
		bmsx_frame_timing_record(&report, 502u + index, UINT64_C(9007199254741000) + index, index * 1000000ull, 20000000u, 0u, 0u, false, 0u, false, false, true, NULL, NULL, NULL, index * 2u, index * 3u, NULL);
	}
	CHECK(report.slow_frame_count == BMSX_FRAME_TIMING_SLOW_FRAME_COUNT);
	CHECK(report.outlier_count == 85u);
	CHECK(outliers[0].host_frame == 501u && outliers[0].run_ns == 5000000000ull);
	CHECK(outliers[0].period_ns == 16683333u && outliers[0].missed_deadline);
	CHECK(outliers[1].host_frame == 518u && outliers[1].run_ns == 16000000u);
	CHECK(outliers[84].host_frame == 601u && outliers[84].core_without_present_ns == 99000000u);
	CHECK(outliers[84].period_ns == 20000000u && !outliers[84].missed_deadline);
	CHECK(report.over_period_runs == 80u && report.paced_runs == 2u && report.missed_deadlines == 1u);
	CHECK(report.slow_frames[0].host_frame == 501u);
	CHECK(report.slow_frames[1].host_frame == 601u);
	CHECK(report.slow_frames[BMSX_FRAME_TIMING_SLOW_FRAME_COUNT - 1u].host_frame == 571u);
	CHECK(report.slow_frames[1].gx_upload.render_frame_serial == 0u);
	CHECK(report.slow_frames[1].host_run_start_monotonic_ns == UINT64_C(9007199254741099));
	CHECK(report.slow_frames[BMSX_FRAME_TIMING_SLOW_FRAME_COUNT - 1u].host_run_start_monotonic_ns == UINT64_C(9007199254741069));
	CHECK(report.slow_frames[1].host_main_thread_cpu_ns == 198u);
	CHECK(report.slow_frames[1].host_process_cpu_ns == 297u);
	CHECK(report.slow_frames[BMSX_FRAME_TIMING_SLOW_FRAME_COUNT - 1u].host_main_thread_cpu_ns == 138u);
	CHECK(report.slow_frames[BMSX_FRAME_TIMING_SLOW_FRAME_COUNT - 1u].host_process_cpu_ns == 207u);

	// Timed-window totals exclude the earlier baseline; live sizes can shrink,
	// while lifetime maxima and their raw guest identity must not be differenced.
	BmsxFrameTimingReport native_report = {0};
	const BmsxNativeCompilationProfileV2 before = {
		.counters = {
			.prepare_requests = 10u, .regions_published = 9u, .entries_published = 30u,
			.source_instructions = 100u, .emitted_code_bytes = 900u,
			.code_bytes = 900u, .peak_code_bytes = 1000u,
			.prepare_nanoseconds = 6000000u, .max_prepare_nanoseconds = 3000000u,
			.discovery_nanoseconds = 2000000u, .compilation_nanoseconds = 4000000u,
			.max_prepare_domain = -1, .max_prepare_cartridge_slot = 1u,
			.max_prepare_root_pc = 0x1234u, .max_prepare_page_pc = 0x1000u,
		},
		.background_completed = 10u, .background_cancelled = 2u, .background_nanoseconds = 4000u,
	};
	BmsxNativeCompilationProfileV2 after = before;
	after.counters.prepare_requests += 2u; after.counters.regions_published += 2u;
	after.counters.entries_published += 5u; after.counters.source_instructions += 20u;
	after.counters.emitted_code_bytes += 120u; after.counters.code_bytes = 120u;
	after.counters.prepare_nanoseconds += 2000000u;
	after.counters.discovery_nanoseconds += 500000u;
	after.counters.retirement_nanoseconds += 250000u;
	after.counters.compilation_nanoseconds += 1250000u;
	after.counters.merged_regions = 1u; after.counters.merged_code_bytes = 100u;
	after.counters.capacity_events = 1u; after.counters.capacity_retired_code_bytes = 800u;
	after.background_completed += 2u;
	after.background_cancelled += 1u;
	after.background_nanoseconds += 1234u;
	const BmsxNativeCompilationProfileV2 interval = bmsx_native_compilation_profile_delta(&before, &after);
	CHECK(interval.background_completed == 2u && interval.background_cancelled == 1u && interval.background_nanoseconds == 1234u);
	CHECK(interval.counters.prepare_requests == 2u && interval.counters.regions_published == 2u);
	CHECK(interval.counters.entries_published == 5u && interval.counters.source_instructions == 20u);
	CHECK(interval.counters.emitted_code_bytes == 120u && interval.counters.code_bytes == 120u);
	CHECK(interval.counters.prepare_nanoseconds == 2000000u && interval.counters.max_prepare_nanoseconds == 3000000u);
	CHECK(interval.counters.peak_code_bytes == 1000u && interval.counters.max_prepare_root_pc == 0x1234u);
	bmsx_frame_timing_record(&native_report, 20u, 0u, 10000000u, 20000000u, 9000000u, 0u, false, 0u, false, false, true, NULL, &interval, NULL, 0u, 0u, NULL);
	const BmsxNativeCompilationProfileV2 idle = bmsx_native_compilation_profile_delta(&after, &after);
	CHECK(idle.background_completed == 0u && idle.background_cancelled == 0u && idle.background_nanoseconds == 0u);
	CHECK(idle.counters.prepare_requests == 0u && idle.counters.prepare_nanoseconds == 0u && idle.counters.emitted_code_bytes == 0u);
	CHECK(idle.counters.code_bytes == 120u && idle.counters.max_prepare_nanoseconds == 3000000u);
	bmsx_frame_timing_record(&native_report, 21u, 0u, 5000000u, 20000000u, 0u, 0u, false, 0u, false, false, true, NULL, &idle, NULL, 0u, 0u, NULL);
	CHECK(native_report.native_compilation.background_completed == 2u);
	CHECK(native_report.native_compilation.background_cancelled == 1u);
	CHECK(native_report.native_compilation.background_nanoseconds == 1234u);
	CHECK(native_report.native_profiled_frames == 2u);
	CHECK(native_report.over_period_runs == 0u && native_report.paced_runs == 1u && native_report.missed_deadlines == 1u);
	CHECK(native_report.native_compilation.counters.prepare_requests == 2u);
	CHECK(native_report.native_compilation.counters.prepare_nanoseconds == 2000000u);
	CHECK(native_report.native_compilation.counters.discovery_nanoseconds == 500000u);
	CHECK(native_report.native_compilation.counters.retirement_nanoseconds == 250000u);
	CHECK(native_report.native_compilation.counters.compilation_nanoseconds == 1250000u);
	CHECK(native_report.native_compilation.counters.max_prepare_nanoseconds == 3000000u);
	CHECK(native_report.native_compilation.counters.peak_code_bytes == 1000u);
	CHECK(native_report.native_compilation.counters.capacity_events == 1u);
	CHECK(native_report.native_compilation.counters.capacity_retired_code_bytes == 800u);
	CHECK(native_report.native_compilation.counters.merged_regions == 1u && native_report.native_compilation.counters.merged_code_bytes == 100u);
	CHECK(native_report.slow_frames[0].has_native_compilation);
	CHECK(native_report.slow_frames[0].native_compilation.counters.prepare_nanoseconds == 2000000u);
	CHECK(native_report.slow_frames[1].native_compilation.counters.prepare_nanoseconds == 0u);
	FILE* output = tmpfile();
	CHECK(output != NULL);
	bmsx_native_compilation_profile_print(output, native_report.native_profiled_frames, 2u, &native_report.native_compilation);
	rewind(output);
	char line[2048];
	CHECK(fgets(line, sizeof(line), output) != NULL);
	CHECK(strstr(line, "frames=2 profile_version=2 prepares=2 regions=2 entries=5") != NULL);
	CHECK(strstr(line, "live_code_bytes=120 lifetime_peak_code_bytes=1000") != NULL);
	CHECK(strstr(line, "total_prepare_ms=2.000") != NULL);
	CHECK(strstr(line, "lifetime_max_prepare_ms=3.000") != NULL);
	CHECK(strstr(line, "max_prepare_domain=-1 max_prepare_slot=1 max_prepare_root_pc=00001234 max_prepare_page_pc=00001000") != NULL);
	CHECK(strstr(line, "capacity_evicted_regions=1 background_completed=2 background_cancelled=1 background_ns=1234") != NULL);
	CHECK(fclose(output) == 0);

	// Scheduler positions can rewind while the diagnostic lifetime counters
	// advance. Preserve the signed raw boundaries, including beyond double's
	// exact integer range; do not manufacture an elapsed/non-CPU cycle count.
	const BmsxExecutionProfile execution_before = {
		.scheduler_now_cycles = INT64_C(9007199254740995),
		.cpu_slice_count = 100u,
		.cpu_slice_consumed_cycles = INT64_C(9007199254740997),
		.gc_collections = 20u, .gc_total_nanoseconds = 3000u,
		.gc_roots_nanoseconds = 100u, .gc_trace_nanoseconds = 200u,
		.gc_weak_nanoseconds = 300u, .gc_sweep_nanoseconds = 400u,
		.gc_string_reclaim_nanoseconds = 500u,
		.gc_steps = 17u, .gc_full_collections = 2u, .gc_max_step_nanoseconds = 9000000u,
		.gc_steps_over_2ms = 5u, .gc_steps_over_8ms = 1u,
		.cpu_native_origin_cycles = INT64_C(9007199254740999),
		.cpu_interpreter_runtime_cycles = INT64_C(9007199254740997),
		.native_bios_call_count = UINT64_C(9007199254740995),
		.interpreter_concatn_count = UINT64_C(9007199254740993),
	};
	BmsxExecutionProfile execution_after = execution_before;
	execution_after.scheduler_now_cycles = -INT64_C(9007199254740993);
	execution_after.cpu_slice_count += 3u;
	execution_after.cpu_slice_consumed_cycles += 172u;
	execution_after.gc_collections += 1u;
	execution_after.gc_total_nanoseconds += 800u;
	execution_after.gc_roots_nanoseconds += 11u;
	execution_after.gc_trace_nanoseconds += 22u;
	execution_after.gc_weak_nanoseconds += 33u;
	execution_after.gc_sweep_nanoseconds += 44u;
	execution_after.gc_string_reclaim_nanoseconds += 55u;
	execution_after.gc_steps += 3u; execution_after.gc_steps_over_2ms += 1u;
	execution_after.gc_mark_again_nanoseconds += 66u; execution_after.gc_atomic_nanoseconds += 77u;
	execution_after.cpu_native_origin_cycles += 120u;
	execution_after.cpu_interpreter_runtime_cycles += 52u;
	execution_after.native_bios_call_count += 1u;
	execution_after.native_call_count += 2u;
	execution_after.native_setfield_count += 3u;
	execution_after.native_concat_count += 4u;
	execution_after.native_concatn_count += 5u;
	execution_after.interpreter_bios_call_count += 1u;
	execution_after.interpreter_call_count += 2u;
	execution_after.interpreter_setfield_count += 3u;
	execution_after.interpreter_concat_count += 4u;
	execution_after.interpreter_concatn_count += 5u;

	const BmsxExecutionProfileInterval execution = bmsx_execution_profile_delta(&execution_before, &execution_after);
	CHECK(execution.scheduler_before_cycles == INT64_C(9007199254740995));
	CHECK(execution.scheduler_after_cycles == -INT64_C(9007199254740993));
	CHECK(execution.cpu_slice_count == 3u && execution.cpu_slice_consumed_cycles == 172);
	CHECK(execution.gc_collections == 1u && execution.gc_total_nanoseconds == 800u);
	CHECK(execution.gc_roots_nanoseconds == 11u && execution.gc_trace_nanoseconds == 22u);
	CHECK(execution.gc_weak_nanoseconds == 33u && execution.gc_sweep_nanoseconds == 44u);
	CHECK(execution.gc_string_reclaim_nanoseconds == 55u);
	CHECK(execution.gc_steps == 3u && execution.gc_full_collections == 0u && execution.gc_steps_over_2ms == 1u);
	CHECK(execution.gc_steps_over_8ms == 0u && execution.gc_max_step_nanoseconds == 9000000u);
	CHECK(execution.gc_mark_again_nanoseconds == 66u && execution.gc_atomic_nanoseconds == 77u);
	CHECK(execution.cpu_native_origin_cycles == 120u);
	CHECK(execution.cpu_interpreter_runtime_cycles == 52u);
	CHECK(execution.native_bios_call_count == 1u);
	CHECK(execution.native_call_count == 2u);
	CHECK(execution.native_setfield_count == 3u);
	CHECK(execution.native_concat_count == 4u);
	CHECK(execution.native_concatn_count == 5u);
	CHECK(execution.interpreter_bios_call_count == 1u);
	CHECK(execution.interpreter_call_count == 2u);
	CHECK(execution.interpreter_setfield_count == 3u);
	CHECK(execution.interpreter_concat_count == 4u);
	CHECK(execution.interpreter_concatn_count == 5u);
	CHECK(execution.cpu_native_origin_cycles + execution.cpu_interpreter_runtime_cycles == execution.cpu_slice_consumed_cycles);
	const BmsxExecutionProfileInterval execution_idle = bmsx_execution_profile_delta(&execution_after, &execution_after);
	CHECK(execution_idle.scheduler_before_cycles == execution_after.scheduler_now_cycles);
	CHECK(execution_idle.scheduler_after_cycles == execution_after.scheduler_now_cycles);
	CHECK(execution_idle.cpu_slice_count == 0u && execution_idle.cpu_slice_consumed_cycles == 0);
	CHECK(execution_idle.gc_collections == 0u && execution_idle.gc_total_nanoseconds == 0u);
	CHECK(execution_idle.gc_roots_nanoseconds == 0u && execution_idle.gc_trace_nanoseconds == 0u);
	CHECK(execution_idle.gc_weak_nanoseconds == 0u && execution_idle.gc_sweep_nanoseconds == 0u);
	CHECK(execution_idle.gc_string_reclaim_nanoseconds == 0u);
	CHECK(execution_idle.gc_steps == 0u && execution_idle.gc_steps_over_2ms == 0u && execution_idle.gc_max_step_nanoseconds == 9000000u);
	CHECK(execution_idle.cpu_native_origin_cycles == 0);
	CHECK(execution_idle.cpu_interpreter_runtime_cycles == 0);
	CHECK(execution_idle.native_bios_call_count == 0);
	CHECK(execution_idle.native_call_count == 0);
	CHECK(execution_idle.native_setfield_count == 0);
	CHECK(execution_idle.native_concat_count == 0);
	CHECK(execution_idle.native_concatn_count == 0);
	CHECK(execution_idle.interpreter_bios_call_count == 0);
	CHECK(execution_idle.interpreter_call_count == 0);
	CHECK(execution_idle.interpreter_setfield_count == 0);
	CHECK(execution_idle.interpreter_concat_count == 0);
	CHECK(execution_idle.interpreter_concatn_count == 0);

	BmsxFrameTimingReport execution_report = {0};
	bmsx_frame_timing_record(&execution_report, 51u, 0u, 100000000u, 20000000u, 0u, 0u, false, 0u, false, true, false, NULL, NULL, &execution, 0u, 0u, NULL);
	bmsx_frame_timing_record(&execution_report, 52u, 0u, 50000000u, 20000000u, 0u, 0u, false, 0u, false, false, true, NULL, NULL, &execution_idle, 0u, 0u, NULL);
	CHECK(execution_report.slow_frames[0].host_frame == 51u && execution_report.slow_frames[0].has_execution);
	CHECK(execution_report.slow_frames[0].execution.scheduler_before_cycles == execution_before.scheduler_now_cycles);
	CHECK(execution_report.slow_frames[0].execution.scheduler_after_cycles == execution_after.scheduler_now_cycles);
	CHECK(execution_report.slow_frames[0].execution.gc_trace_nanoseconds == 22u);
	CHECK(execution_report.slow_frames[1].execution.cpu_slice_count == 0u);
	for (unsigned index = 0u; index < BMSX_FRAME_TIMING_SLOW_FRAME_COUNT; ++index) {
		bmsx_frame_timing_record(&execution_report, 53u + index, 0u, 200000000ull + index, 20000000u, 0u, 0u, false, 0u, false, false, true, NULL, NULL, NULL, 0u, 0u, NULL);
	}
	CHECK(execution_report.slow_frame_count == BMSX_FRAME_TIMING_SLOW_FRAME_COUNT);
	CHECK(execution_report.slow_frames[0].host_frame == 84u);
	CHECK(!execution_report.slow_frames[0].has_execution);
	CHECK(execution_report.slow_frames[0].execution.scheduler_before_cycles == 0);
	CHECK(execution_report.slow_frames[0].execution.cpu_slice_count == 0u);
	output = tmpfile();
	CHECK(output != NULL);
	bmsx_execution_profile_print(output, &execution);
	rewind(output);
	CHECK(fgets(line, sizeof(line), output) != NULL);
	CHECK(strstr(line, "scheduler_before_cycles=9007199254740995 scheduler_after_cycles=-9007199254740993") != NULL);
	CHECK(strstr(line, "cpu_slices=3 cpu_consumed_cycles=172") != NULL);
	CHECK(strstr(line, "gc_collections=1 gc_total_ns=800 gc_roots_ns=11 gc_trace_ns=22 gc_weak_ns=33 gc_sweep_ns=44 gc_string_reclaim_ns=55") != NULL);
	CHECK(strstr(line, "cpu_native_origin_cycles=120 cpu_interpreter_runtime_cycles=52") != NULL);
	CHECK(strstr(line, "native_bios_call_count=1 native_call_count=2 native_setfield_count=3 native_concat_count=4 native_concatn_count=5") != NULL);
	CHECK(strstr(line, "interpreter_bios_call_count=1 interpreter_call_count=2 interpreter_setfield_count=3 interpreter_concat_count=4 interpreter_concatn_count=5") != NULL);
	CHECK(fclose(output) == 0);

	BmsxFrameTimingReport guest_report = {.outliers = outliers};
	const int64_t first_cycle = INT64_C(9007199254740999);
	const BmsxGuestProgressInterval maintenance = {{58, first_cycle}, {58, first_cycle}};
	const BmsxGuestProgressInterval partial = {{58, first_cycle}, {58, first_cycle + 4}};
	const BmsxGuestProgressInterval completed = {{58, first_cycle + 4}, {59, first_cycle + 512}};
	bmsx_frame_timing_record(&guest_report, 500, 20000000, 16000000, 20000000u, 40000000u, 0, false, 0, false, false, false,
		NULL, NULL, NULL, 1000, 5000, &maintenance);
	bmsx_frame_timing_record(&guest_report, 501, 40000000, 10000000, 20000000u, 60000000u, 0, false, 0, false, false, false,
		NULL, NULL, NULL, 2000, 6000, &partial);
	bmsx_frame_timing_record(&guest_report, 502, 60000000, 18000000, 20000000u, 80000000u, 250000, true, 0, false, false, true,
		&gx_upload, NULL, NULL, 3000, 7000, &completed);
	CHECK(guest_report.guest_progress_runs == 3u && guest_report.retro_run.count == 3u);
	CHECK(guest_report.zero_guest_tick_runs == 2u && guest_report.zero_guest_cycle_runs == 1u);
	CHECK(guest_report.guest.before.tick_sequence == 58 && guest_report.guest.after.tick_sequence == 59);
	CHECK(guest_report.guest.before.scheduler_cycles == first_cycle
		&& guest_report.guest.after.scheduler_cycles == first_cycle + 512);
	CHECK(guest_report.retro_run.total_ns == 44000000u && guest_report.guest_process_cpu_ns == 18000u);
	CHECK(guest_report.guest_first_run_start_ns == 20000000u && guest_report.guest_last_run_end_ns == 78000000u);
	CHECK(guest_report.outlier_count == 2u && outliers[0].host_frame == 500u && outliers[1].host_frame == 502u);
	CHECK(outliers[0].guest.before.scheduler_cycles == first_cycle && outliers[0].guest.after.scheduler_cycles == first_cycle);
	CHECK(outliers[1].core_without_present_ns == 17750000u && outliers[1].guest.after.tick_sequence == 59);
	CHECK(outliers[1].final_blit_ns == 250000u && outliers[1].swap_ns == 0u);
	CHECK(!outliers[0].has_gx_upload && outliers[1].has_gx_upload);
	CHECK(outliers[1].gx_upload.logical_bytes == 16u && outliers[1].gx_upload.scanout_upload_bytes == 196608u);

	return 0;
}
