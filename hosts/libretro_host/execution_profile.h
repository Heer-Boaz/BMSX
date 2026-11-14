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
} BmsxExecutionProfileInterval;

// Only lifetime counters are differenced. Keep both raw scheduler positions;
// their difference is not elapsed emulation time across reset or restore.
BmsxExecutionProfileInterval bmsx_execution_profile_delta(
	const BmsxExecutionProfileV1* before, const BmsxExecutionProfileV1* after);
void bmsx_execution_profile_print(FILE* stream, const BmsxExecutionProfileInterval* interval);
