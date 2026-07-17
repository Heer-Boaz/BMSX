#include "audio/output_resampler.h"

#include "common/clamp.h"
#include "machine/common/numeric.h"
#include "machine/devices/audio/contracts.h"
#include "machine/devices/audio/output_ring.h"

#include <algorithm>

namespace bmsx {

void AudioOutputResampler::reset() {
	m_outputRate = 0;
	m_phase = 0.0;
	m_started = false;
	m_hasCurrent = false;
	m_hasNext = false;
}

void AudioOutputResampler::pull(
	ApuOutputRing& ring,
	i16* output,
	size_t frameCount,
	i32 outputSampleRate,
	f32 outputGain,
	size_t startThresholdFrames
) {
	if (m_outputRate != outputSampleRate) {
		reset();
		m_outputRate = outputSampleRate;
	}
	if (!m_started) {
		if (ring.queuedFrames() < startThresholdFrames) {
			std::fill_n(output, frameCount * 2u, static_cast<i16>(0));
			return;
		}
		m_started = true;
	}
	const f64 sourceStep = static_cast<f64>(APU_SAMPLE_RATE_HZ) / static_cast<f64>(outputSampleRate);
	size_t outputIndex = 0u;
	bool underrun = false;
	for (size_t frame = 0u; frame < frameCount; frame += 1u) {
		if (!prime(ring)) {
			underrun = true;
			break;
		}
		const f64 left = static_cast<f64>(m_currentLeft)
			+ static_cast<f64>(m_nextLeft - m_currentLeft) * m_phase;
		const f64 right = static_cast<f64>(m_currentRight)
			+ static_cast<f64>(m_nextRight - m_currentRight) * m_phase;
		output[outputIndex] = static_cast<i16>(saturateRoundedI32(clamp(left * outputGain, -32768.0, 32767.0)));
		output[outputIndex + 1u] = static_cast<i16>(saturateRoundedI32(clamp(right * outputGain, -32768.0, 32767.0)));
		outputIndex += 2u;
		m_phase += sourceStep;
		while (m_phase >= 1.0) {
			m_phase -= 1.0;
			m_currentLeft = m_nextLeft;
			m_currentRight = m_nextRight;
			m_hasCurrent = true;
			m_hasNext = false;
			if (ring.queuedFrames() == 0u) {
				underrun = true;
				break;
			}
			readNext(ring);
		}
		if (underrun) {
			break;
		}
	}
	if (underrun) {
		m_phase = 0.0;
		m_started = false;
		m_hasCurrent = false;
		m_hasNext = false;
		std::fill(output + outputIndex, output + frameCount * 2u, static_cast<i16>(0));
	}
}

bool AudioOutputResampler::prime(ApuOutputRing& ring) {
	if (!m_hasCurrent) {
		if (ring.queuedFrames() == 0u) {
			return false;
		}
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
	const u32 packed = ring.readFramePacked();
	m_nextLeft = static_cast<i16>(packed & 0xffffu);
	m_nextRight = static_cast<i16>(packed >> 16u);
	m_hasNext = true;
}

} // namespace bmsx
