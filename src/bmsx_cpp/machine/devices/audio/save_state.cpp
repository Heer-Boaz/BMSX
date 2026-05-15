#include "machine/devices/audio/controller.h"
#include "machine/devices/audio/output.h"
#include "machine/devices/audio/source.h"

#include "machine/bus/io.h"
#include "machine/cpu/cpu.h"

namespace bmsx {

const ApuSlotSourceBytes& ApuSourceDma::captureState() const {
	return m_slotSourceBytes;
}

void ApuSourceDma::restoreState(const ApuSlotSourceBytes& slotSourceBytes) {
	m_slotSourceBytes = slotSourceBytes;
}

ApuOutputVoiceState captureApuOutputVoiceState(const ApuOutputMixer::VoiceRecord& record) {
	ApuOutputVoiceState voice;
	voice.slot = record.slot;
	voice.position = record.position;
	voice.step = record.step;
	voice.gain = record.gain;
	voice.targetGain = record.targetGain;
	voice.gainRampRemaining = record.gainRampRemaining;
	voice.stopAfter = record.stopAfter;
	voice.filterSampleRate = record.filterSampleRate;
	voice.filter.enabled = record.filter.enabled;
	voice.filter.b0 = record.filter.b0;
	voice.filter.b1 = record.filter.b1;
	voice.filter.b2 = record.filter.b2;
	voice.filter.a1 = record.filter.a1;
	voice.filter.a2 = record.filter.a2;
	voice.filter.l1 = record.filter.l1;
	voice.filter.l2 = record.filter.l2;
	voice.filter.r1 = record.filter.r1;
	voice.filter.r2 = record.filter.r2;
	voice.badp.predictors[0] = record.badp.predictors[0];
	voice.badp.predictors[1] = record.badp.predictors[1];
	voice.badp.stepIndices[0] = record.badp.stepIndices[0];
	voice.badp.stepIndices[1] = record.badp.stepIndices[1];
	voice.badp.nextFrame = static_cast<u32>(record.badp.nextFrame);
	voice.badp.blockEnd = static_cast<u32>(record.badp.blockEnd);
	voice.badp.blockFrames = static_cast<u32>(record.badp.blockFrames);
	voice.badp.blockFrameIndex = static_cast<u32>(record.badp.blockFrameIndex);
	voice.badp.payloadOffset = static_cast<u32>(record.badp.payloadOffset);
	voice.badp.nibbleCursor = static_cast<u32>(record.badp.nibbleCursor);
	voice.badp.decodedFrame = record.badp.decodedFrame;
	voice.badp.decodedLeft = record.badp.decodedLeft;
	voice.badp.decodedRight = record.badp.decodedRight;
	return voice;
}

void restoreApuOutputVoiceState(ApuOutputMixer::VoiceRecord& record, const ApuOutputVoiceState& state) {
	record.position = state.position;
	record.step = state.step;
	record.gain = state.gain;
	record.targetGain = state.targetGain;
	record.gainRampRemaining = state.gainRampRemaining;
	record.stopAfter = state.stopAfter;
	record.filterSampleRate = state.filterSampleRate;
	record.filter.enabled = state.filter.enabled;
	record.filter.b0 = state.filter.b0;
	record.filter.b1 = state.filter.b1;
	record.filter.b2 = state.filter.b2;
	record.filter.a1 = state.filter.a1;
	record.filter.a2 = state.filter.a2;
	record.filter.l1 = state.filter.l1;
	record.filter.l2 = state.filter.l2;
	record.filter.r1 = state.filter.r1;
	record.filter.r2 = state.filter.r2;
	record.badp.predictors[0] = state.badp.predictors[0];
	record.badp.predictors[1] = state.badp.predictors[1];
	record.badp.stepIndices[0] = state.badp.stepIndices[0];
	record.badp.stepIndices[1] = state.badp.stepIndices[1];
	record.badp.nextFrame = state.badp.nextFrame;
	record.badp.blockEnd = state.badp.blockEnd;
	record.badp.blockFrames = state.badp.blockFrames;
	record.badp.blockFrameIndex = state.badp.blockFrameIndex;
	record.badp.payloadOffset = state.badp.payloadOffset;
	record.badp.nibbleCursor = state.badp.nibbleCursor;
	record.badp.decodedFrame = state.badp.decodedFrame;
	record.badp.decodedLeft = static_cast<i16>(state.badp.decodedLeft);
	record.badp.decodedRight = static_cast<i16>(state.badp.decodedRight);
}

AudioControllerState AudioController::captureState() const {
	AudioControllerState state;
	for (size_t index = 0; index < APU_PARAMETER_REGISTER_COUNT; index += 1u) {
		state.registerWords[index] = m_memory.readIoU32(IO_APU_PARAMETER_REGISTER_ADDRS[index]);
	}
	state.commandFifo = m_commandFifo.captureState();
	const ApuEventLatchState event = m_eventLatch.captureState();
	state.eventSequence = event.eventSequence;
	state.eventKind = event.eventKind;
	state.eventSlot = event.eventSlot;
	state.eventSourceAddr = event.eventSourceAddr;
	state.slotPhases = m_slots.slotPhases();
	state.slotRegisterWords = m_slots.slotRegisterWords();
	state.slotSourceBytes = m_sourceDma.captureState();
	state.slotPlaybackCursorQ16 = m_slots.slotPlaybackCursorQ16();
	state.slotFadeSamplesRemaining = m_slots.slotFadeSamplesRemaining();
	state.slotFadeSamplesTotal = m_slots.slotFadeSamplesTotal();
	state.output = m_audioOutput.captureState();
	state.sampleCarry = m_serviceClock.captureSampleCarry();
	state.availableSamples = m_serviceClock.captureAvailableSamples();
	state.apuStatus = m_fault.status;
	state.apuFaultCode = m_fault.code;
	state.apuFaultDetail = m_fault.detail;
	return state;
}

void AudioController::restoreState(const AudioControllerState& state, int64_t nowCycles) {
	m_slots.resetVoiceIds();
	m_audioOutput.resetPlaybackState();
	for (size_t index = 0; index < APU_PARAMETER_REGISTER_COUNT; index += 1u) {
		m_memory.writeIoValue(IO_APU_PARAMETER_REGISTER_ADDRS[index], valueNumber(static_cast<double>(state.registerWords[index])));
	}
	m_commandFifo.restoreState(state.commandFifo);
	m_eventLatch.restoreState({state.eventSequence, state.eventKind, state.eventSlot, state.eventSourceAddr});
	m_slots.restore(
		state.slotPhases,
		state.slotRegisterWords,
		state.slotPlaybackCursorQ16,
		state.slotFadeSamplesRemaining,
		state.slotFadeSamplesTotal
	);
	m_sourceDma.restoreState(state.slotSourceBytes);
	m_serviceClock.restore(state.sampleCarry, state.availableSamples);
	m_fault.restore(state.apuStatus, state.apuFaultCode, state.apuFaultDetail);
	m_activeSlots.writeActiveMask();
	for (const ApuOutputVoiceState& voiceState : state.output.voices) {
		const ApuAudioSlot slot = voiceState.slot;
		const ApuVoiceId voiceId = m_slots.allocateVoiceId();
		m_slots.assignVoiceId(slot, voiceId);
		if (!replayHostOutput(slot, voiceId)) {
			throw BMSX_RUNTIME_ERROR("[APU] Cannot restore saved AOUT voice.");
		}
		m_audioOutput.restoreVoiceState(voiceState);
	}
	m_serviceClock.scheduleNext(nowCycles);
}

ApuOutputState ApuOutputMixer::captureState() const {
	ApuOutputState state;
	state.voices.reserve(m_voices.size());
	for (const VoiceRecord& record : m_voices) {
		state.voices.push_back(captureApuOutputVoiceState(record));
	}
	return state;
}

void ApuOutputMixer::restoreVoiceState(const ApuOutputVoiceState& state) {
	for (auto it = m_voices.rbegin(); it != m_voices.rend(); ++it) {
		VoiceRecord& record = *it;
		if (record.slot != state.slot) {
			continue;
		}
		restoreApuOutputVoiceState(record, state);
		return;
	}
	throw BMSX_RUNTIME_ERROR("[AOUT] Restored voice state has no active AOUT record.");
}

} // namespace bmsx
