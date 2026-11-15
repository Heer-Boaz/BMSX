#pragma once

#include "common/primitives.h"

namespace bmsx {

// Host diagnostics for one CPU lifetime, never machine/snapshot state. Enabled
// by CPU-slice or native-gate profiling. Reset and restore do not rewind totals.
struct DiagnosticGcProfile {
	u64 collections = 0;
	// Complete CPU::collectHeap, including final heap accounting and unwinding
	// on an allocation failure. The phase sum excludes this enclosing overhead.
	u64 totalNanoseconds = 0;
	// Reachability epoch/setup, CPU roots and the three allocation-time roots.
	u64 rootsNanoseconds = 0;
	// Graph traversal and the ephemeron fixed point (including its trace work).
	u64 traceNanoseconds = 0;
	// Removing dead weak keys/values, before their objects are reclaimed.
	u64 weakNanoseconds = 0;
	// Object-list scan, live-byte accounting, dead destructors and pool returns.
	u64 sweepNanoseconds = 0;
	// String-index removal, text reclamation, ID recycling and worklist cleanup.
	u64 stringReclaimNanoseconds = 0;
};

} // namespace bmsx
