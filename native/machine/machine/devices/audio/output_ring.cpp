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

size_t ApuOutputRing::capacityFrames() const {
	return APU_OUTPUT_QUEUE_CAPACITY_FRAMES;
}

size_t ApuOutputRing::freeFrames() const {
	return APU_OUTPUT_QUEUE_CAPACITY_FRAMES - m_queuedFrames;
}

i16* ApuOutputRing::renderBuffer() {
	return m_renderBuffer.data();
}

void ApuOutputRing::write(const i16* samples, size_t frameCount) {
	const size_t writeFrame = (m_readFrame + m_queuedFrames) % APU_OUTPUT_QUEUE_CAPACITY_FRAMES;
	size_t firstSpan = APU_OUTPUT_QUEUE_CAPACITY_FRAMES - writeFrame;
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

void ApuOutputRing::read(i16* output, size_t frameCount) {
	size_t firstSpan = APU_OUTPUT_QUEUE_CAPACITY_FRAMES - m_readFrame;
	if (firstSpan > frameCount) {
		firstSpan = frameCount;
	}
	const size_t firstSamples = firstSpan * 2u;
	std::copy_n(m_queue.data() + m_readFrame * 2u, firstSamples, output);
	const size_t secondSpan = frameCount - firstSpan;
	if (secondSpan > 0u) {
		std::copy_n(m_queue.data(), secondSpan * 2u, output + firstSamples);
	}
	m_readFrame = (m_readFrame + frameCount) % APU_OUTPUT_QUEUE_CAPACITY_FRAMES;
	m_queuedFrames -= frameCount;
	if (m_queuedFrames == 0u) {
		m_readFrame = 0;
	}
}

} // namespace bmsx
