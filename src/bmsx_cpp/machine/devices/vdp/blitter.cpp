#include "machine/devices/vdp/blitter.h"

namespace bmsx {

void VdpBlitterCommandBuffer::reset() {
	length = 0u;
	glyphEntryCount = 0u;
	tileEntryCount = 0u;
}

bool VdpBlitterCommandBuffer::beginCommandSlot(VdpBlitterCommandType commandType, u32 commandSeq, size_t& index) {
	index = length;
	if (index >= VDP_BLITTER_FIFO_CAPACITY) {
		return false;
	}
	opcode[index] = commandType;
	seq[index] = commandSeq;
	renderCost[index] = 0;
	return true;
}

void VdpBlitterCommandBuffer::commitCommandSlot(size_t index, int commandRenderCost) {
	renderCost[index] = commandRenderCost;
	length = index + 1u;
}

bool VdpBlitterCommandBuffer::reserve(VdpBlitterCommandType commandType, u32 commandSeq, int commandRenderCost, size_t& index) {
	if (!beginCommandSlot(commandType, commandSeq, index)) {
		return false;
	}
	commitCommandSlot(index, commandRenderCost);
	return true;
}

u8 frameBufferColorByte(f32 value) {
	return static_cast<u8>(value * 255.0f + 0.5f);
}

u32 packArgbColor(const VdpFrameBufferColor& value) {
	return (static_cast<u32>(value.a) << 24u)
		| (static_cast<u32>(value.r) << 16u)
		| (static_cast<u32>(value.g) << 8u)
		| static_cast<u32>(value.b);
}

VdpFrameBufferColor unpackArgbColor(u32 value) {
	return {
		static_cast<u8>((value >> 16u) & 0xffu),
		static_cast<u8>((value >> 8u) & 0xffu),
		static_cast<u8>(value & 0xffu),
		static_cast<u8>((value >> 24u) & 0xffu),
	};
}

} // namespace bmsx
