#pragma once

#include "common/primitives.h"
#include "spec/bmsx/io.h"

#include <array>

namespace bmsx {

class Memory;

struct DmaChannelState {
	u32 readAddressWord = 0;
	u32 writeAddressWord = 0;
	u32 transferCountWord = 0;
	u32 controlWord = 0;
	u32 statusWord = 0;
};

using DmaChannelStates = std::array<DmaChannelState, IO_DMA_CHANNEL_COUNT>;

class DmaRegisterFile {
public:
	DmaChannelStates channels{};

	void clear();
	void mirror(Memory& memory) const;
};

} // namespace bmsx
