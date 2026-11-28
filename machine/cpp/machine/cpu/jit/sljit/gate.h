#pragma once

#include <array>

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
	void* registerJump;
	void* enterWindow;
	void* leaveWindow;
	void* stringReadProbe;
	void* ownStringSlotProbe;
	void* indexReadProbe;
	void* tableLengthProbe;
	void* tableIteratorScan;
};
sljit_label* emitNativeReturn(sljit_compiler*, sljit_label* bindWindow, sljit_label* semanticReturn);
sljit_label* emitFixedResidentCall(sljit_compiler*, sljit_label* bindWindow, sljit_label* semanticCall);
sljit_label* emitWindowEnter(sljit_compiler*, sljit_label* bindWindow, sljit_label* cold);
sljit_label* emitWindowLeave(sljit_compiler*, sljit_label* bindWindow, sljit_label* cold);
// R2 is the aligned-PC candidate; R3 receives its resident code entry.
std::array<sljit_jump*, 5> emitResidentCodeAtPc(sljit_compiler*);
const NativeBlockGate& nativeBlockGate();

} // namespace bmsx
