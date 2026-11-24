#pragma once

#include "machine/cpu/value_slots.h"
#include "sljitLir.h"

namespace bmsx {

struct NativeBlockExitSite;
struct NativeBlockRunState;

// Shared frame entries live here. Cold semantic work returns through this
// stable allocation. A C++ helper may
// retire the region it came from; no return address points into that region.
class NativeBlockGate {
public:
	using Entry = const NativeBlockExitSite* (SLJIT_FUNC *)(NativeBlockRunState*, void*, const ValueSpan*);
	NativeBlockGate();
	~NativeBlockGate();
	NativeBlockGate(const NativeBlockGate&) = delete;
	NativeBlockGate& operator=(const NativeBlockGate&) = delete;
	void* entry;
	void* exit;
	void* dispatch;
	void* publishSegment;
	void* leaveSegment;
	void* stringReadProbe;
	void* ownStringSlotProbe;
	void* indexReadProbe;
	void* tableIteratorScan;
};
sljit_label* emitPendingReturn(sljit_compiler*, sljit_label* bindWindow, sljit_label* semanticReturn);
sljit_label* emitFixedResidentCall(sljit_compiler*, sljit_label* bindWindow, sljit_label* semanticCall);
const NativeBlockGate& nativeBlockGate();

} // namespace bmsx
