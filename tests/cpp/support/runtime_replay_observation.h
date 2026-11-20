#pragma once

#include "machine/runtime/runtime.h"
#include "spec/bmsx/io.h"
#include "spec/gx/pcrtc.h"

namespace bmsx::test {

struct ReplayObservation {
	i64 cycles;
	i64 tick;
	ExecutionDomainId domain;
	u32 background;
	u32 inputSequence;
	u32 buttons;
	u32 sampleSequence;
	u32 voices;

	bool operator==(const ReplayObservation&) const = default;
};

// Keep this observation in sync with the TS test, not the save-state layout.
inline ReplayObservation observeReplay(const Runtime& runtime) {
	const auto& machine = runtime.machine;
	return {
		machine.scheduler.currentNowCycles(),
		runtime.frameScheduler.lastTickSequence,
		machine.cpu.activeCartridgeSlot(),
		machine.memory.readIoU32(gxGpuPcrtcRegisterAddress(GX_GPU_PCRTC_BGCOLOR_LOW)),
		machine.memory.readIoU32(IO_INP_STATUS),
		machine.memory.readIoU32(IO_INP_PADS),
		machine.memory.readIoU32(IO_APU_SAMPLE_SEQUENCE),
		machine.memory.readIoU32(IO_APU_ACTIVE_MASK),
	};
}

} // namespace bmsx::test
