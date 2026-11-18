#pragma once

#include <stdio.h>
#include "bmsx_libretro.h"

typedef struct BmsxExecutionProfileInterval {
	int64_t scheduler_before_cycles;
	int64_t scheduler_after_cycles;
	uint64_t cpu_slice_count;
	int64_t cpu_slice_consumed_cycles;
	uint64_t gc_collections;
	uint64_t gc_total_nanoseconds;
	uint64_t gc_roots_nanoseconds;
	uint64_t gc_trace_nanoseconds;
	uint64_t gc_weak_nanoseconds;
	uint64_t gc_sweep_nanoseconds;
	uint64_t gc_string_reclaim_nanoseconds;
	uint64_t gc_full_collections;
	uint64_t gc_steps;
	uint64_t gc_max_step_nanoseconds;
	uint64_t gc_steps_over_2ms;
	uint64_t gc_steps_over_8ms;
	uint64_t gc_mark_again_nanoseconds;
	uint64_t gc_atomic_nanoseconds;
	int64_t cpu_native_origin_cycles;
	int64_t cpu_interpreter_runtime_cycles;
	uint64_t native_newt_count;
	uint64_t native_call_count;
	uint64_t native_setfield_count;
	uint64_t native_concat_count;
	uint64_t native_concatn_count;
	uint64_t interpreter_newt_count;
	uint64_t interpreter_call_count;
	uint64_t interpreter_setfield_count;
	uint64_t interpreter_concat_count;
	uint64_t interpreter_concatn_count;
} BmsxExecutionProfileInterval;

// Only lifetime counters are differenced; the maximum step remains a gauge.
// Keep both raw scheduler positions;
// their difference is not elapsed emulation time across reset or restore.
BmsxExecutionProfileInterval bmsx_execution_profile_delta(
	const BmsxExecutionProfile* before, const BmsxExecutionProfile* after);
void bmsx_execution_profile_print(FILE* stream, const BmsxExecutionProfileInterval* interval);
