#include "native_compilation_profile.h"

BmsxNativeCompilationProfile bmsx_native_compilation_profile_delta(
		const BmsxNativeCompilationProfile* before, const BmsxNativeCompilationProfile* after) {
	BmsxNativeCompilationProfile interval = *after;
	interval.prepare_requests -= before->prepare_requests;
	interval.regions_published -= before->regions_published;
	interval.entries_published -= before->entries_published;
	interval.source_instructions -= before->source_instructions;
	interval.emitted_code_bytes -= before->emitted_code_bytes;
	interval.prepare_nanoseconds -= before->prepare_nanoseconds;
	interval.discovery_nanoseconds -= before->discovery_nanoseconds;
	interval.retirement_nanoseconds -= before->retirement_nanoseconds;
	interval.compilation_nanoseconds -= before->compilation_nanoseconds;
	interval.merged_regions -= before->merged_regions;
	interval.merged_code_bytes -= before->merged_code_bytes;
	interval.capacity_flushes -= before->capacity_flushes;
	interval.capacity_retired_code_bytes -= before->capacity_retired_code_bytes;
	return interval;
}

void bmsx_native_compilation_profile_accumulate(BmsxNativeCompilationProfile* total,
		const BmsxNativeCompilationProfile* interval) {
	total->prepare_requests += interval->prepare_requests;
	total->regions_published += interval->regions_published;
	total->entries_published += interval->entries_published;
	total->source_instructions += interval->source_instructions;
	total->emitted_code_bytes += interval->emitted_code_bytes;
	total->prepare_nanoseconds += interval->prepare_nanoseconds;
	total->discovery_nanoseconds += interval->discovery_nanoseconds;
	total->retirement_nanoseconds += interval->retirement_nanoseconds;
	total->compilation_nanoseconds += interval->compilation_nanoseconds;
	total->merged_regions += interval->merged_regions;
	total->merged_code_bytes += interval->merged_code_bytes;
	total->capacity_flushes += interval->capacity_flushes;
	total->capacity_retired_code_bytes += interval->capacity_retired_code_bytes;
	total->code_bytes = interval->code_bytes;
	total->peak_code_bytes = interval->peak_code_bytes;
	total->max_prepare_nanoseconds = interval->max_prepare_nanoseconds;
	total->max_prepare_domain = interval->max_prepare_domain;
	total->max_prepare_cartridge_slot = interval->max_prepare_cartridge_slot;
	total->max_prepare_root_pc = interval->max_prepare_root_pc;
	total->max_prepare_page_pc = interval->max_prepare_page_pc;
}

void bmsx_native_compilation_profile_print(FILE* stream, uint64_t frames,
		const BmsxNativeCompilationProfile* p) {
	fprintf(stream,
		"[libretro-host][native-compilation] frames=%llu prepares=%llu regions=%llu entries=%llu source_instructions=%llu emitted_code_bytes=%llu live_code_bytes=%llu lifetime_peak_code_bytes=%llu total_prepare_ms=%.3f discovery_ms=%.3f retirement_ms=%.3f compilation_ms=%.3f lifetime_max_prepare_ms=%.3f merged_regions=%llu merged_code_bytes=%llu capacity_flushes=%llu capacity_retired_code_bytes=%llu max_prepare_domain=%d max_prepare_slot=%u max_prepare_root_pc=%08x max_prepare_page_pc=%08x\n",
		(unsigned long long)frames,
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
		(unsigned long long)p->capacity_flushes,
		(unsigned long long)p->capacity_retired_code_bytes,
		p->max_prepare_domain, p->max_prepare_cartridge_slot,
		p->max_prepare_root_pc, p->max_prepare_page_pc);
}
