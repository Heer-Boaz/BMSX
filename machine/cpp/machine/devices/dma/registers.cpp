#include "machine/devices/dma/registers.h"

#include "machine/memory/memory.h"

namespace bmsx {

void DmaRegisterFile::clear() {
	channels = {};
}

void DmaRegisterFile::mirror(Memory& memory) const {
	for (u32 channel = 0u; channel < IO_DMA_CHANNEL_COUNT; channel += 1u) {
		const DmaChannelState& state = channels[channel];
		memory.writeIoU32(IO_DMA_READ_ADDRS[channel], state.readAddressWord);
		memory.writeIoU32(IO_DMA_WRITE_ADDRS[channel], state.writeAddressWord);
		memory.writeIoU32(IO_DMA_TRANSFER_COUNTS[channel], state.transferCountWord);
		memory.writeIoU32(IO_DMA_CONTROLS[channel], state.controlWord);
		memory.writeIoU32(IO_DMA_STATUSES[channel], state.statusWord);
		memory.writeIoU32(IO_DMA_TRIGGERS[channel], 0u);
	}
}

} // namespace bmsx
