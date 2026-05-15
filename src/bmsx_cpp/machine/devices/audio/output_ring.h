#pragma once

#include "common/types.h"
#include "machine/devices/audio/contracts.h"

#include <array>
#include <cstddef>

namespace bmsx {

class ApuOutputRing final {
public:
	void clear();
	size_t queuedFrames() const;
	size_t capacityFrames() const;
	size_t freeFrames() const;
	i16* renderBuffer();
	void write(const i16* samples, size_t frameCount);
	void read(i16* output, size_t frameCount);

private:
	std::array<i16, APU_OUTPUT_QUEUE_CAPACITY_SAMPLES> m_queue{};
	std::array<i16, APU_OUTPUT_QUEUE_CAPACITY_SAMPLES> m_renderBuffer{};
	size_t m_readFrame = 0;
	size_t m_queuedFrames = 0;
};

} // namespace bmsx
