#pragma once

#include <stdio.h>
#include "bmsx_libretro.h"

// Additive counters become interval deltas; live gauges and lifetime maxima
// remain absolute. CPU reset/restore does not restart this profile lifetime.
BmsxNativeCompilationProfileV2 bmsx_native_compilation_profile_delta(
	const BmsxNativeCompilationProfileV2* before, const BmsxNativeCompilationProfileV2* after);
void bmsx_native_compilation_profile_accumulate(BmsxNativeCompilationProfileV2* total,
	const BmsxNativeCompilationProfileV2* interval);
void bmsx_native_compilation_profile_print(FILE* stream, uint64_t frames, unsigned version,
	const BmsxNativeCompilationProfileV2* profile);
void bmsx_native_compilation_profile_print_versioned_fields(FILE* stream, unsigned version,
	const BmsxNativeCompilationProfileV2* profile);
