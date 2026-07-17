#pragma once

#include "common/types.h"
#include "machine/devices/audio/contracts.h"

#include <array>
#include <cstddef>

namespace bmsx {

constexpr size_t APU_OUTPUT_RING_CAPACITY_FRAMES = 3072u;
constexpr size_t APU_OUTPUT_RING_CAPACITY_SAMPLES = APU_OUTPUT_RING_CAPACITY_FRAMES * 2u;

class ApuOutputRing final {
public:
	void clear();
	size_t queuedFrames() const;
	i64 firstFrameSequence() const;
	void write(const i16* samples, size_t frameCount, i64 startSequence);
	u32 readFramePacked();

private:
	std::array<i16, APU_OUTPUT_RING_CAPACITY_SAMPLES> m_queue{};
	size_t m_readFrame = 0;
	size_t m_queuedFrames = 0;
	i64 m_firstFrameSequence = 0;
};

} // namespace bmsx
