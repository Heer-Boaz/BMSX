#pragma once

#include "machine/devices/gx/gpu_command_timing.h"

#include <array>
#include <cstddef>

namespace bmsx {

constexpr size_t GX_GPU_PREPARED_COMMAND_CAPACITY = 16u;

// A decoded prefix of accepted FIFO/ingress words. Preparation consumes no credits.
struct GxGpuPreparedCommands {
	std::array<GxGpuPacket, GX_GPU_PREPARED_COMMAND_CAPACITY> packets{};
	std::array<i64, GX_GPU_PREPARED_COMMAND_CAPACITY> startCycles{};
	std::array<i64, GX_GPU_PREPARED_COMMAND_CAPACITY> completionCycles{};
	size_t head = 0u;
	size_t count = 0u;
	// Raw prefix across FIFO and ingress, including header NOPs until the
	// transport removes them. It is not the number of physical FIFO credits.
	size_t sourceWordCount = 0u;

	void clear() { head = count = sourceWordCount = 0u; }
	size_t index(size_t offset) const { return (head + offset) & (GX_GPU_PREPARED_COMMAND_CAPACITY - 1u); }
	GxGpuPacket& pop() {
		auto& packet = packets[head];
		sourceWordCount -= packet.wordCount;
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
