#include "audio_output.h"

#include "machine/devices/audio/controller.h"
#include "machine/model_registry.h"
#include "machine/runtime/timing/constants.h"

namespace bmsx {

LibretroAudioOutput::LibretroAudioOutput()
	: m_frameTimeSec(static_cast<f64>(HZ_SCALE) / static_cast<f64>(PAL_REFRESH_UFPS_SCALED)) {
	resizeFrameBuffer();
}

void LibretroAudioOutput::setSampleRate(f64 sampleRate) {
	m_sampleRate = sampleRate;
	m_sampleAccumulator = 0.0;
	resizeFrameBuffer();
}

void LibretroAudioOutput::setEmulationFrameTimeSec(f64 seconds) {
	m_frameTimeSec = seconds;
	resizeFrameBuffer();
}

void LibretroAudioOutput::resetPlayback() {
	m_sampleAccumulator = 0.0;
	m_frameCount = 0u;
	m_resampler.reset();
}

void LibretroAudioOutput::collectFrame(AudioController& audioController) {
	m_sampleAccumulator += m_sampleRate * m_frameTimeSec;
	const size_t requestedFrames = static_cast<size_t>(m_sampleAccumulator);
	m_sampleAccumulator -= static_cast<f64>(requestedFrames);
	m_frameCount = m_resampler.pull(
		audioController.synchronizeOutput(),
		m_samples.data(),
		requestedFrames,
		static_cast<i32>(m_sampleRate)
	);
}

void LibretroAudioOutput::resizeFrameBuffer() {
	const size_t frameCapacity = static_cast<size_t>(m_sampleRate * m_frameTimeSec) + 1u;
	m_samples.resize(frameCapacity * 2u);
}

} // namespace bmsx
