#pragma once

#include "common/primitives.h"
#include "machine/memory/map.h"
#include <array>
#include <cstddef>
#include <vector>

namespace bmsx {

struct VdpStreamIngressState {
	bool dmaSubmitActive = false;
	std::array<u8, 4> fifoWordScratch{{0, 0, 0, 0}};
	int fifoWordByteCount = 0;
	std::vector<u32> fifoStreamWords;
	u32 fifoStreamWordCount = 0;
};

class VdpStreamIngressUnit {
public:
	bool dmaSubmitActive = false;
	std::array<u8, 4> fifoWordScratch{{0, 0, 0, 0}};
	int fifoWordByteCount = 0;
	std::array<u32, VDP_STREAM_CAPACITY_WORDS> fifoStreamWords{};
	u32 fifoStreamWordCount = 0;

	void reset();
	void beginDmaSubmit();
	void endDmaSubmit();
	bool hasOpenDirectFifoIngress() const;
	u32 pushWord(u32 word);
	u32 writeBytes(const u8* data, size_t length);
	VdpStreamIngressState captureState() const;
	void restoreState(const VdpStreamIngressState& state);
};

} // namespace bmsx
