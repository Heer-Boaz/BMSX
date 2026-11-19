#pragma once

#include "common/primitives.h"

namespace bmsx {

// Host diagnostics for one CPU lifetime, never machine/snapshot state. Enabled
// by CPU-slice, CPU-timing or native-gate profiling. Reset and restore do not rewind totals.
struct DiagnosticGcProfile {
	// Cycles started, not assist calls. A continuation can report time with zero starts.
	u64 collections = 0;
	u64 fullCollections = 0;
	u64 minorCollections = 0;
	u64 minorNanoseconds = 0;
	u64 steps = 0;
	// Lifetime gauge, never subtracted as a counter. The two tail counters can
	// be differenced to identify long individual steps in a measured interval.
	u64 maxStepNanoseconds = 0;
	u64 stepsOver2ms = 0;
	u64 stepsOver8ms = 0;
	// Small collections and full-collection steps, including heap accounting and unwinding
	// on an allocation failure. The phase sum excludes this enclosing overhead.
	u64 totalNanoseconds = 0;
	// Reachability epoch/setup, CPU roots and the three allocation-time roots.
	u64 rootsNanoseconds = 0;
	// Graph traversal and the ephemeron fixed point (including its trace work).
	u64 traceNanoseconds = 0;
	u64 markAgainNanoseconds = 0;
	// Enclosing atomic interval; overlaps its roots, trace and weak measurements.
	u64 atomicNanoseconds = 0;
	// Removing dead weak keys/values, before their objects are reclaimed.
	u64 weakNanoseconds = 0;
	// Object-list scan, live-byte accounting, dead destructors and pool returns.
	u64 sweepNanoseconds = 0;
	// String-index removal, text reclamation, ID recycling and worklist cleanup.
	u64 stringReclaimNanoseconds = 0;
};

} // namespace bmsx
