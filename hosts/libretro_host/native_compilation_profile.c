#include "native_compilation_profile.h"

BmsxNativeCompilationProfileV2 bmsx_native_compilation_profile_delta(
		const BmsxNativeCompilationProfileV2* before, const BmsxNativeCompilationProfileV2* after) {
	BmsxNativeCompilationProfileV2 interval = *after;
	interval.counters.prepare_requests -= before->counters.prepare_requests;
	interval.counters.regions_published -= before->counters.regions_published;
	interval.counters.entries_published -= before->counters.entries_published;
	interval.counters.source_instructions -= before->counters.source_instructions;
	interval.counters.emitted_code_bytes -= before->counters.emitted_code_bytes;
	interval.counters.prepare_nanoseconds -= before->counters.prepare_nanoseconds;
	interval.counters.discovery_nanoseconds -= before->counters.discovery_nanoseconds;
	interval.counters.retirement_nanoseconds -= before->counters.retirement_nanoseconds;
	interval.counters.compilation_nanoseconds -= before->counters.compilation_nanoseconds;
	interval.counters.merged_regions -= before->counters.merged_regions;
	interval.counters.merged_code_bytes -= before->counters.merged_code_bytes;
	interval.counters.capacity_events -= before->counters.capacity_events;
	interval.counters.capacity_retired_code_bytes -= before->counters.capacity_retired_code_bytes;
	interval.background_completed -= before->background_completed;
	interval.background_cancelled -= before->background_cancelled;
	interval.background_nanoseconds -= before->background_nanoseconds;
	return interval;
}

void bmsx_native_compilation_profile_accumulate(BmsxNativeCompilationProfileV2* total,
		const BmsxNativeCompilationProfileV2* interval) {
	total->counters.prepare_requests += interval->counters.prepare_requests;
	total->counters.regions_published += interval->counters.regions_published;
	total->counters.entries_published += interval->counters.entries_published;
	total->counters.source_instructions += interval->counters.source_instructions;
	total->counters.emitted_code_bytes += interval->counters.emitted_code_bytes;
	total->counters.prepare_nanoseconds += interval->counters.prepare_nanoseconds;
	total->counters.discovery_nanoseconds += interval->counters.discovery_nanoseconds;
	total->counters.retirement_nanoseconds += interval->counters.retirement_nanoseconds;
	total->counters.compilation_nanoseconds += interval->counters.compilation_nanoseconds;
	total->counters.merged_regions += interval->counters.merged_regions;
	total->counters.merged_code_bytes += interval->counters.merged_code_bytes;
	total->counters.capacity_events += interval->counters.capacity_events;
	total->counters.capacity_retired_code_bytes += interval->counters.capacity_retired_code_bytes;
	total->background_completed += interval->background_completed;
	total->background_cancelled += interval->background_cancelled;
	total->background_nanoseconds += interval->background_nanoseconds;
	total->counters.code_bytes = interval->counters.code_bytes;
	total->counters.peak_code_bytes = interval->counters.peak_code_bytes;
	total->counters.max_prepare_nanoseconds = interval->counters.max_prepare_nanoseconds;
	total->counters.max_prepare_domain = interval->counters.max_prepare_domain;
	total->counters.max_prepare_cartridge_slot = interval->counters.max_prepare_cartridge_slot;
	total->counters.max_prepare_root_pc = interval->counters.max_prepare_root_pc;
	total->counters.max_prepare_page_pc = interval->counters.max_prepare_page_pc;
}

void bmsx_native_compilation_profile_print(FILE* stream, uint64_t frames, unsigned version,
		const BmsxNativeCompilationProfileV2* profile) {
	const BmsxNativeCompilationProfileV1* p = &profile->counters;
	fprintf(stream,
		"[libretro-host][native-compilation] frames=%llu profile_version=%u prepares=%llu regions=%llu entries=%llu source_instructions=%llu emitted_code_bytes=%llu live_code_bytes=%llu lifetime_peak_code_bytes=%llu total_prepare_ms=%.3f discovery_ms=%.3f retirement_ms=%.3f compilation_ms=%.3f lifetime_max_prepare_ms=%.3f merged_regions=%llu merged_code_bytes=%llu capacity_retired_code_bytes=%llu max_prepare_domain=%d max_prepare_slot=%u max_prepare_root_pc=%08x max_prepare_page_pc=%08x",
		(unsigned long long)frames, version,
		(unsigned long long)p->prepare_requests,
		(unsigned long long)p->regions_published,
		(unsigned long long)p->entries_published,
		(unsigned long long)p->source_instructions,
		(unsigned long long)p->emitted_code_bytes,
		(unsigned long long)p->code_bytes,
		(unsigned long long)p->peak_code_bytes,
		(double)p->prepare_nanoseconds / 1000000.0,
		(double)p->discovery_nanoseconds / 1000000.0,
		(double)p->retirement_nanoseconds / 1000000.0,
		(double)p->compilation_nanoseconds / 1000000.0,
		(double)p->max_prepare_nanoseconds / 1000000.0,
		(unsigned long long)p->merged_regions,
		(unsigned long long)p->merged_code_bytes,
		(unsigned long long)p->capacity_retired_code_bytes,
		p->max_prepare_domain, p->max_prepare_cartridge_slot,
		p->max_prepare_root_pc, p->max_prepare_page_pc);
	bmsx_native_compilation_profile_print_versioned_fields(stream, version, profile);
	fputc('\n', stream);
}

void bmsx_native_compilation_profile_print_versioned_fields(FILE* stream, unsigned version,
		const BmsxNativeCompilationProfileV2* profile) {
	if (version == 2u) {
		fprintf(stream,
			" capacity_evicted_regions=%llu background_completed=%llu background_cancelled=%llu background_ns=%llu",
			(unsigned long long)profile->counters.capacity_events,
			(unsigned long long)profile->background_completed,
			(unsigned long long)profile->background_cancelled,
			(unsigned long long)profile->background_nanoseconds);
	} else {
		fprintf(stream, " capacity_events_v1=%llu", (unsigned long long)profile->counters.capacity_events);
	}
}
