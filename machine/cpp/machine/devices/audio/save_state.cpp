#include "machine/devices/audio/controller.h"
#include "machine/devices/audio/output.h"

#include "machine/bus/io.h"
#include "machine/cpu/value.h"
#include "machine/scheduler/device.h"

namespace bmsx {

ApuOutputVoiceState captureApuOutputVoiceState(const ApuOutputMixer::VoiceRecord& record) {
	ApuOutputVoiceState voice;
	voice.slot = record.slot;
	voice.sourceCartridgeSlot = record.sourceCartridgeSlot;
	voice.cursorQ16 = record.cursorQ16;
	voice.phaseRemainder = record.phaseRemainder;
	voice.gainQ12 = record.gainQ12;
	voice.fadeStepQ12 = record.fadeStepQ12;
	voice.fadeStepRemainder = record.fadeStepRemainder;
	voice.fadeError = record.fadeError;
	voice.fadeSamplesRemaining = record.fadeSamplesRemaining;
	voice.fadeSamplesTotal = record.fadeSamplesTotal;
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
	voice.badp.previousDecodedFrame = record.badp.previousDecodedFrame;
	voice.badp.previousDecodedLeft = record.badp.previousDecodedLeft;
	voice.badp.previousDecodedRight = record.badp.previousDecodedRight;
	return voice;
}

void restoreApuOutputVoiceState(ApuOutputMixer::VoiceRecord& record, const ApuOutputVoiceState& state) {
	record.sourceCartridgeSlot = state.sourceCartridgeSlot;
	record.cursorQ16 = state.cursorQ16;
	record.phaseRemainder = state.phaseRemainder;
	record.gainQ12 = state.gainQ12;
	record.fadeStepQ12 = state.fadeStepQ12;
	record.fadeStepRemainder = state.fadeStepRemainder;
	record.fadeError = state.fadeError;
	record.fadeSamplesRemaining = state.fadeSamplesRemaining;
	record.fadeSamplesTotal = state.fadeSamplesTotal;
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
	record.badp.decodedLeft = state.badp.decodedLeft;
	record.badp.decodedRight = state.badp.decodedRight;
	record.badp.previousDecodedFrame = state.badp.previousDecodedFrame;
	record.badp.previousDecodedLeft = state.badp.previousDecodedLeft;
	record.badp.previousDecodedRight = state.badp.previousDecodedRight;
}

AudioControllerState AudioController::captureState() {
	const i64 nowCycles = m_scheduler.currentNowCycles();
	m_serviceClock.synchronize(nowCycles);
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
	state.sampleRam = m_sampleMemory.captureState();
	state.sampleTransfer = m_serviceClock.captureSampleTransferState(nowCycles);
	state.output = m_audioOutput.captureState();
	state.sampleCarry = m_serviceClock.captureSampleCarry();
	state.sampleSequence = m_serviceClock.captureSampleSequence();
	state.apuStatus = m_fault.status;
	state.apuFaultCode = m_fault.code;
	state.apuFaultDetail = m_fault.detail;
	return state;
}

void AudioController::restoreState(const AudioControllerState& state, int64_t nowCycles) {
	m_audioOutput.resetPlaybackState();
	for (size_t index = 0; index < APU_PARAMETER_REGISTER_COUNT; index += 1u) {
		m_memory.writeIoValue(IO_APU_PARAMETER_REGISTER_ADDRS[index], valueNumber(static_cast<double>(state.registerWords[index])));
	}
	m_commandFifo.restoreState(state.commandFifo);
	m_eventLatch.restoreState({state.eventSequence, state.eventKind, state.eventSlot, state.eventSourceAddr});
	m_slots.restore(state.slotPhases, state.slotRegisterWords);
	m_sampleMemory.restoreState(state.sampleRam);
	m_serviceClock.restore(state.sampleCarry, state.sampleSequence, state.sampleTransfer, nowCycles);
	m_fault.restore(state.apuStatus, state.apuFaultCode, state.apuFaultDetail);
	m_activeSlots.writeActiveMask();
	for (const ApuOutputVoiceState& voiceState : state.output.voices) {
		m_commandExecutor.restoreOutputVoice(voiceState);
	}
	m_serviceClock.scheduleNext(nowCycles);
}

ApuOutputState ApuOutputMixer::captureState() const {
	ApuOutputState state;
	state.voices.reserve(APU_SLOT_COUNT);
	for (const VoiceRecord& record : m_voices) {
		if (record.active) {
			state.voices.push_back(captureApuOutputVoiceState(record));
		}
	}
	return state;
}

} // namespace bmsx
