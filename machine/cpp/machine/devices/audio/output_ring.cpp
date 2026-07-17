#include "machine/devices/audio/output_ring.h"

#include <algorithm>

namespace bmsx {

void ApuOutputRing::clear() {
	m_readFrame = 0;
	m_queuedFrames = 0;
}

size_t ApuOutputRing::queuedFrames() const {
	return m_queuedFrames;
}

i16* ApuOutputRing::renderBuffer() {
	return m_renderBuffer.data();
}

void ApuOutputRing::write(const i16* samples, size_t frameCount) {
	const size_t freeFrames = APU_OUTPUT_RING_CAPACITY_FRAMES - m_queuedFrames;
	if (frameCount > freeFrames) {
		const size_t overflowFrames = frameCount - freeFrames;
		m_readFrame = (m_readFrame + overflowFrames) % APU_OUTPUT_RING_CAPACITY_FRAMES;
		m_queuedFrames -= overflowFrames;
	}
	const size_t writeFrame = (m_readFrame + m_queuedFrames) % APU_OUTPUT_RING_CAPACITY_FRAMES;
	size_t firstSpan = APU_OUTPUT_RING_CAPACITY_FRAMES - writeFrame;
	if (firstSpan > frameCount) {
		firstSpan = frameCount;
	}
	const size_t firstSamples = firstSpan * 2u;
	std::copy_n(samples, firstSamples, m_queue.data() + writeFrame * 2u);
	const size_t secondSpan = frameCount - firstSpan;
	if (secondSpan > 0u) {
		std::copy_n(samples + firstSamples, secondSpan * 2u, m_queue.data());
	}
	m_queuedFrames += frameCount;
}

u32 ApuOutputRing::readFramePacked() {
	const size_t sampleIndex = m_readFrame * 2u;
	const u32 packed = static_cast<u32>(static_cast<u16>(m_queue[sampleIndex]))
		| (static_cast<u32>(static_cast<u16>(m_queue[sampleIndex + 1u])) << 16u);
	m_readFrame = (m_readFrame + 1u) % APU_OUTPUT_RING_CAPACITY_FRAMES;
	m_queuedFrames -= 1u;
	if (m_queuedFrames == 0u) {
		m_readFrame = 0;
	}
	return packed;
}

} // namespace bmsx
