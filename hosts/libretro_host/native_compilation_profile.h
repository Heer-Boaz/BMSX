#pragma once

#include <stdio.h>
#include "bmsx_libretro.h"

// Additive counters become interval deltas; live gauges and lifetime maxima
// remain absolute. CPU reset/restore does not restart this profile lifetime.
BmsxNativeCompilationProfile bmsx_native_compilation_profile_delta(
	const BmsxNativeCompilationProfile* before, const BmsxNativeCompilationProfile* after);
void bmsx_native_compilation_profile_accumulate(BmsxNativeCompilationProfile* total,
	const BmsxNativeCompilationProfile* interval);
void bmsx_native_compilation_profile_print(FILE* stream, uint64_t frames,
	const BmsxNativeCompilationProfile* profile);
