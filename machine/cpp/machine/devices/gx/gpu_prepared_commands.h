#pragma once

#include "machine/devices/gx/gpu_command_timing.h"

#include <array>
#include <cstddef>

namespace bmsx {

template <size_t Capacity> class WordFifo;

constexpr size_t GX_GPU_PREPARED_COMMAND_CAPACITY = 16u;

// A decoded prefix of accepted FIFO/ingress words. Preparation consumes no credits.
struct GxGpuPreparedCommands {
	std::array<GxGpuPacket, GX_GPU_PREPARED_COMMAND_CAPACITY> packets{};
	// Continuations consume one or two source words but emit a full line packet.
	std::array<u32, GX_GPU_PREPARED_COMMAND_CAPACITY> sourceWordCounts{};
	std::array<i64, GX_GPU_PREPARED_COMMAND_CAPACITY> startCycles{};
	std::array<i64, GX_GPU_PREPARED_COMMAND_CAPACITY> completionCycles{};
	size_t head = 0u;
	size_t count = 0u;
	// Raw prefix across FIFO and ingress, including skipped header NOPs and
	// terminators until they are consumed. Not the physical FIFO credit count.
	size_t sourceWordCount = 0u;
	// Stream state at the end of the prepared prefix, not the execution latch.
	u32 polylineOpcode = 0u;
	u32 polylineColorWord = 0u;
	u32 polylinePositionWord = 0u;
	u32 polylineNextColorWord = 0u;
	u32 polylinePayloadPhase = 0u;

	void prepare(const WordFifo<GX_GPU_COMMAND_FIFO_WORD_CAPACITY>& fifo,
		const WordFifo<GX_GPU_DMA_INGRESS_WORD_CAPACITY>& ingress, i64 startCycle, GxGpuDrawState& state);

	void clear() { head = count = sourceWordCount = 0u; }
	size_t index(size_t offset) const { return (head + offset) & (GX_GPU_PREPARED_COMMAND_CAPACITY - 1u); }
	GxGpuPacket& pop() {
		auto& packet = packets[head];
		sourceWordCount -= sourceWordCounts[head];
		head = index(1u);
		--count;
		return packet;
	}
	void retime(i64 startCycle, GxGpuDrawState& state) {
		for (size_t offset = 0u; offset < count; ++offset) {
			const size_t packetIndex = index(offset);
			auto& packet = packets[packetIndex];
			retimeGpuPacket(packet, state);
			startCycles[packetIndex] = startCycle;
			startCycle += (packet.ticks + 1) >> 1u;
			completionCycles[packetIndex] = startCycle;
		}
	}
};

} // namespace bmsx
