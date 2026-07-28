#include "audio/output_resampler.h"

#include "machine/common/numeric.h"
#include "spec/audio/apu.h"
#include "machine/devices/audio/output_ring.h"

namespace bmsx {

void AudioOutputResampler::reset() {
	m_outputRate = 0;
	m_phase = 0.0;
	m_hasCurrent = false;
	m_hasNext = false;
}

auto AudioOutputResampler::pull(
	ApuOutputRing& ring,
	i16* output,
	size_t frameCount,
	i32 outputSampleRate
) -> size_t {
	if (m_outputRate != outputSampleRate) {
		reset();
		m_outputRate = outputSampleRate;
	}
	if (m_hasCurrent && ring.queuedFrames() != 0u && ring.firstFrameSequence() != m_lastSourceSequence + 1) {
		m_phase -= static_cast<i64>(m_phase);
		m_hasCurrent = false;
		m_hasNext = false;
	}
	const f64 sourceStep = static_cast<f64>(APU_SAMPLE_RATE_HZ) / static_cast<f64>(outputSampleRate);
	size_t outputIndex = 0u;
	size_t producedFrames = 0u;
	while (producedFrames < frameCount) {
		if (!prime(ring)) {
			break;
		}
		while (m_phase >= 1.0) {
			if (ring.queuedFrames() == 0u) {
				return producedFrames;
			}
			m_phase -= 1.0;
			m_currentLeft = m_nextLeft;
			m_currentRight = m_nextRight;
			readNext(ring);
		}
		const f64 left = static_cast<f64>(m_currentLeft)
			+ static_cast<f64>(m_nextLeft - m_currentLeft) * m_phase;
		const f64 right = static_cast<f64>(m_currentRight)
			+ static_cast<f64>(m_nextRight - m_currentRight) * m_phase;
		output[outputIndex] = static_cast<i16>(roundI32(left));
		output[outputIndex + 1u] = static_cast<i16>(roundI32(right));
		outputIndex += 2u;
		producedFrames += 1u;
		m_phase += sourceStep;
	}
	return producedFrames;
}

bool AudioOutputResampler::prime(ApuOutputRing& ring) {
	if (!m_hasCurrent) {
		if (ring.queuedFrames() == 0u) {
			return false;
		}
		m_lastSourceSequence = ring.firstFrameSequence();
		const u32 packed = ring.readFramePacked();
		m_currentLeft = static_cast<i16>(packed & 0xffffu);
		m_currentRight = static_cast<i16>(packed >> 16u);
		m_hasCurrent = true;
	}
	if (!m_hasNext) {
		if (ring.queuedFrames() == 0u) {
			return false;
		}
		readNext(ring);
	}
	return true;
}

void AudioOutputResampler::readNext(ApuOutputRing& ring) {
	m_lastSourceSequence = ring.firstFrameSequence();
	const u32 packed = ring.readFramePacked();
	m_nextLeft = static_cast<i16>(packed & 0xffffu);
	m_nextRight = static_cast<i16>(packed >> 16u);
	m_hasNext = true;
}

} // namespace bmsx
