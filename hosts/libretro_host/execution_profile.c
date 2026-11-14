#include "execution_profile.h"

BmsxExecutionProfileInterval bmsx_execution_profile_delta(
		const BmsxExecutionProfile* before, const BmsxExecutionProfile* after) {
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
		.cpu_native_origin_cycles = after->cpu_native_origin_cycles - before->cpu_native_origin_cycles,
		.cpu_interpreter_runtime_cycles = after->cpu_interpreter_runtime_cycles - before->cpu_interpreter_runtime_cycles,
		.native_newt_count = after->native_newt_count - before->native_newt_count,
		.native_call_count = after->native_call_count - before->native_call_count,
		.native_setfield_count = after->native_setfield_count - before->native_setfield_count,
		.native_concat_count = after->native_concat_count - before->native_concat_count,
		.native_concatn_count = after->native_concatn_count - before->native_concatn_count,
		.interpreter_newt_count = after->interpreter_newt_count - before->interpreter_newt_count,
		.interpreter_call_count = after->interpreter_call_count - before->interpreter_call_count,
		.interpreter_setfield_count = after->interpreter_setfield_count - before->interpreter_setfield_count,
		.interpreter_concat_count = after->interpreter_concat_count - before->interpreter_concat_count,
		.interpreter_concatn_count = after->interpreter_concatn_count - before->interpreter_concatn_count,
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
	fprintf(stream,
		" cpu_native_origin_cycles=%lld cpu_interpreter_runtime_cycles=%lld native_newt_count=%llu native_call_count=%llu native_setfield_count=%llu native_concat_count=%llu native_concatn_count=%llu interpreter_newt_count=%llu interpreter_call_count=%llu interpreter_setfield_count=%llu interpreter_concat_count=%llu interpreter_concatn_count=%llu",
		(long long)p->cpu_native_origin_cycles,
		(long long)p->cpu_interpreter_runtime_cycles,
		(unsigned long long)p->native_newt_count,
		(unsigned long long)p->native_call_count,
		(unsigned long long)p->native_setfield_count,
		(unsigned long long)p->native_concat_count,
		(unsigned long long)p->native_concatn_count,
		(unsigned long long)p->interpreter_newt_count,
		(unsigned long long)p->interpreter_call_count,
		(unsigned long long)p->interpreter_setfield_count,
		(unsigned long long)p->interpreter_concat_count,
		(unsigned long long)p->interpreter_concatn_count);
}
