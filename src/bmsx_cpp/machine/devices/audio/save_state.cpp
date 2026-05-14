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
	state.commandFifoCommands = m_commandFifoCommands;
	state.commandFifoRegisterWords = m_commandFifoRegisterWords;
	state.commandFifoReadIndex = m_commandFifoReadIndex;
	state.commandFifoWriteIndex = m_commandFifoWriteIndex;
	state.commandFifoCount = m_commandFifoCount;
	state.eventSequence = m_eventSequence;
	state.eventKind = m_memory.readIoU32(IO_APU_EVENT_KIND);
	state.eventSlot = m_memory.readIoU32(IO_APU_EVENT_SLOT);
	state.eventSourceAddr = m_memory.readIoU32(IO_APU_EVENT_SOURCE_ADDR);
	state.slotPhases = m_slotPhases;
	state.slotRegisterWords = m_slotRegisterWords;
	state.slotSourceBytes = m_sourceDma.captureState();
	state.slotPlaybackCursorQ16 = m_slotPlaybackCursorQ16;
	state.slotFadeSamplesRemaining = m_slotFadeSamplesRemaining;
	state.slotFadeSamplesTotal = m_slotFadeSamplesTotal;
	state.output = m_audioOutput.captureState();
	state.sampleCarry = m_sampleCarry;
	state.availableSamples = m_availableSamples;
	state.apuStatus = m_fault.status;
	state.apuFaultCode = m_fault.code;
	state.apuFaultDetail = m_fault.detail;
	return state;
}

void AudioController::restoreState(const AudioControllerState& state, int64_t nowCycles) {
	m_slotVoiceIds.fill(0);
	m_audioOutput.resetPlaybackState();
	m_nextVoiceId = 1u;
	for (size_t index = 0; index < APU_PARAMETER_REGISTER_COUNT; index += 1u) {
		m_memory.writeIoValue(IO_APU_PARAMETER_REGISTER_ADDRS[index], valueNumber(static_cast<double>(state.registerWords[index])));
	}
	m_commandFifoCommands = state.commandFifoCommands;
	m_commandFifoRegisterWords = state.commandFifoRegisterWords;
	m_commandFifoReadIndex = state.commandFifoReadIndex;
	m_commandFifoWriteIndex = state.commandFifoWriteIndex;
	m_commandFifoCount = state.commandFifoCount;
	m_eventSequence = state.eventSequence;
	m_memory.writeValue(IO_APU_EVENT_KIND, valueNumber(static_cast<double>(state.eventKind)));
	m_memory.writeValue(IO_APU_EVENT_SLOT, valueNumber(static_cast<double>(state.eventSlot)));
	m_memory.writeValue(IO_APU_EVENT_SOURCE_ADDR, valueNumber(static_cast<double>(state.eventSourceAddr)));
	m_memory.writeValue(IO_APU_EVENT_SEQ, valueNumber(static_cast<double>(m_eventSequence)));
	m_slotPhases = state.slotPhases;
	m_activeSlotMask = 0u;
	for (ApuAudioSlot slot = 0; slot < APU_SLOT_COUNT; slot += 1u) {
		if (m_slotPhases[slot] != APU_SLOT_PHASE_IDLE) {
			m_activeSlotMask |= 1u << slot;
		}
	}
	m_memory.writeIoValue(IO_APU_ACTIVE_MASK, valueNumber(static_cast<double>(m_activeSlotMask)));
	m_slotRegisterWords = state.slotRegisterWords;
	m_sourceDma.restoreState(state.slotSourceBytes);
	m_slotPlaybackCursorQ16 = state.slotPlaybackCursorQ16;
	m_slotFadeSamplesRemaining = state.slotFadeSamplesRemaining;
	m_slotFadeSamplesTotal = state.slotFadeSamplesTotal;
	m_sampleCarry = state.sampleCarry;
	m_availableSamples = state.availableSamples;
	m_fault.restore(state.apuStatus, state.apuFaultCode, state.apuFaultDetail);
	for (const ApuOutputVoiceState& voiceState : state.output.voices) {
		const ApuAudioSlot slot = voiceState.slot;
		const ApuVoiceId voiceId = m_nextVoiceId;
		m_nextVoiceId += 1u;
		m_slotVoiceIds[slot] = voiceId;
		if (!replayHostOutput(slot, voiceId)) {
			throw BMSX_RUNTIME_ERROR("[APU] Cannot restore saved AOUT voice.");
		}
		m_audioOutput.restoreVoiceState(voiceState);
	}
	updateSelectedSlotActiveStatus();
	scheduleNextService(nowCycles);
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
