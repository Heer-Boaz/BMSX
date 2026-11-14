#include "execution_profile.h"

BmsxExecutionProfileInterval bmsx_execution_profile_delta(
		const BmsxExecutionProfileV1* before, const BmsxExecutionProfileV1* after) {
	return (BmsxExecutionProfileInterval){
		.scheduler_before_cycles = before->scheduler_now_cycles,
		.scheduler_after_cycles = after->scheduler_now_cycles,
		.cpu_slice_count = after->cpu_slice_count - before->cpu_slice_count,
		.cpu_slice_consumed_cycles = after->cpu_slice_consumed_cycles - before->cpu_slice_consumed_cycles,
		.gc_collections = after->gc_collections - before->gc_collections,
		.gc_total_nanoseconds = after->gc_total_nanoseconds - before->gc_total_nanoseconds,
		.gc_roots_nanoseconds = after->gc_roots_nanoseconds - before->gc_roots_nanoseconds,
		.gc_trace_nanoseconds = after->gc_trace_nanoseconds - before->gc_trace_nanoseconds,
		.gc_weak_nanoseconds = after->gc_weak_nanoseconds - before->gc_weak_nanoseconds,
		.gc_sweep_nanoseconds = after->gc_sweep_nanoseconds - before->gc_sweep_nanoseconds,
		.gc_string_reclaim_nanoseconds = after->gc_string_reclaim_nanoseconds - before->gc_string_reclaim_nanoseconds,
	};
}

void bmsx_execution_profile_print(FILE* stream, const BmsxExecutionProfileInterval* p) {
	fprintf(stream,
		" scheduler_before_cycles=%lld scheduler_after_cycles=%lld cpu_slices=%llu cpu_consumed_cycles=%lld gc_collections=%llu gc_total_ns=%llu gc_roots_ns=%llu gc_trace_ns=%llu gc_weak_ns=%llu gc_sweep_ns=%llu gc_string_reclaim_ns=%llu",
		(long long)p->scheduler_before_cycles, (long long)p->scheduler_after_cycles,
		(unsigned long long)p->cpu_slice_count, (long long)p->cpu_slice_consumed_cycles,
		(unsigned long long)p->gc_collections, (unsigned long long)p->gc_total_nanoseconds,
		(unsigned long long)p->gc_roots_nanoseconds, (unsigned long long)p->gc_trace_nanoseconds,
		(unsigned long long)p->gc_weak_nanoseconds, (unsigned long long)p->gc_sweep_nanoseconds,
		(unsigned long long)p->gc_string_reclaim_nanoseconds);
}
