#pragma once

#include "machine/devices/gx/gpu_command_timing.h"
#include "spec/gx/gp0.h"

#include <array>
#include <cstddef>

namespace bmsx {

// A decoded prefix of the physical FIFO. Preparation consumes no FIFO credits.
struct GxGpuPreparedCommands {
	std::array<GxGpuPacket, GX_GPU_COMMAND_FIFO_WORD_CAPACITY> packets{};
	std::array<i64, GX_GPU_COMMAND_FIFO_WORD_CAPACITY> startCycles{};
	std::array<i64, GX_GPU_COMMAND_FIFO_WORD_CAPACITY> completionCycles{};
	size_t head = 0u;
	size_t count = 0u;
	size_t wordCount = 0u;

	void clear() { head = count = wordCount = 0u; }
	size_t index(size_t offset) const { return (head + offset) & (GX_GPU_COMMAND_FIFO_WORD_CAPACITY - 1u); }
	GxGpuPacket& pop() {
		auto& packet = packets[head];
		wordCount -= packet.wordCount;
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
