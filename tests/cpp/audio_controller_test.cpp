#include "audio/output_resampler.h"
#include "common/endian.h"
#include "machine/bus/io.h"
#include "machine/cpu/cpu.h"
#include "machine/devices/audio/controller.h"
#include "machine/devices/audio/output.h"
#include "machine/devices/input/contracts.h"
#include "machine/devices/irq/controller.h"
#include "machine/machine.h"
#include "machine/memory/map.h"
#include "machine/memory/memory.h"
#include "machine/model_registry.h"
#include "machine/runtime/boot_timing.h"
#include "machine/runtime/machine_state.h"
#include "machine/runtime/runtime.h"
#include "machine/save_state.h"
#include "machine/scheduler/device.h"

#include <array>
#include <cstdint>
#include <stdexcept>

namespace {

struct AudioHarness {
	std::array<bmsx::u8, 1> emptyRom{{0}};
	bmsx::Memory memory;
	bmsx::IrqController irq;
	bmsx::CPU cpu;
	bmsx::DeviceScheduler scheduler;
	bmsx::ApuOutputMixer output;
	bmsx::AudioController audio;

	AudioHarness()
		: memory(bmsx::MemoryInit{{emptyRom.data(), 0u}, {emptyRom.data(), 0u}})
		, irq(memory)
		, cpu(memory, irq)
		, scheduler(cpu)
		, output()
		, audio(memory, output, irq, scheduler) {
		irq.reset();
		audio.reset();
		audio.setTiming(bmsx::APU_SAMPLE_RATE_HZ, 0);
	}
};

class SilentInputSource final : public bmsx::RuntimeInputSource {
public:
	void setRuntimeInputFrameDurationMs(bmsx::f64) override {
	}

	void sampleInputControllerSnapshot(bmsx::f64, bmsx::InputControllerSnapshot&) override {
	}

	auto supervisorRequestLineHigh() const -> bool override {
		return false;
	}

	void applyInputControllerVibrationEffect(bmsx::i32, bmsx::f64, bmsx::f32) override {
	}
};

struct AudioMachineHarness {
	std::array<bmsx::u8, 1> emptyRom{{0}};
	bmsx::Memory memory;
	SilentInputSource input;
	bmsx::Machine machine;

	AudioMachineHarness()
		: memory(bmsx::MemoryInit{{emptyRom.data(), 0u}, {emptyRom.data(), 0u}})
		, machine(memory, input) {
		machine.initializeSystemIo();
		machine.resetDevices();
		machine.audioController.setTiming(bmsx::APU_SAMPLE_RATE_HZ, 0);
	}
};

void require(bool condition, const char* message) {
	if (!condition) {
		throw std::runtime_error(message);
	}
}

void testOutputRingExposesUnsignedHardwareWords() {
	bmsx::ApuOutputRing ring;
	const std::array<bmsx::i16, 2> frame{{0x1234, static_cast<bmsx::i16>(-0x8000)}};
	ring.write(frame.data(), 1u);
	require(ring.readFramePacked() == 0x80001234u, "output ring should expose one unsigned packed stereo word");
}

void programEndingPcmVoice(AudioMachineHarness& harness) {
	harness.memory.writeMappedU32LE(bmsx::RAM_BASE, 0x11223344u);
	harness.memory.writeMappedU32LE(bmsx::IO_APU_SOURCE_ADDR, bmsx::RAM_BASE);
	harness.memory.writeMappedU32LE(bmsx::IO_APU_SOURCE_BYTES, 4u);
	harness.memory.writeMappedU32LE(bmsx::IO_APU_SOURCE_SAMPLE_RATE_HZ, bmsx::APU_SAMPLE_RATE_HZ);
	harness.memory.writeMappedU32LE(bmsx::IO_APU_SOURCE_CHANNELS, 1u);
	harness.memory.writeMappedU32LE(bmsx::IO_APU_SOURCE_BITS_PER_SAMPLE, 8u);
	harness.memory.writeMappedU32LE(bmsx::IO_APU_SOURCE_FRAME_COUNT, 4u);
	harness.memory.writeMappedU32LE(bmsx::IO_APU_SOURCE_DATA_OFFSET, 0u);
	harness.memory.writeMappedU32LE(bmsx::IO_APU_SOURCE_DATA_BYTES, 4u);
	harness.memory.writeMappedU32LE(bmsx::IO_APU_RATE_STEP_Q16, bmsx::APU_RATE_STEP_Q16_ONE);
	harness.memory.writeMappedU32LE(bmsx::IO_APU_GAIN_Q12, bmsx::APU_GAIN_Q12_ONE);
	harness.memory.writeMappedU32LE(bmsx::IO_APU_SLOT, 1u);
	harness.memory.writeMappedU32LE(bmsx::IO_APU_CMD, bmsx::APU_CMD_PLAY);
	harness.machine.audioController.onService(0);
	harness.machine.scheduler.advanceTo(4);
}

void testMachineCaptureIncludesMaterializedApuEndIrq() {
	AudioMachineHarness runtimeHarness;
	programEndingPcmVoice(runtimeHarness);
	const bmsx::MachineState runtimeState = bmsx::captureMachineState(runtimeHarness.machine);
	require(runtimeState.audio.output.voices.empty(), "runtime capture should materialize the voice END at its exact sample");
	require((runtimeState.irq.pendingFlags & bmsx::IRQ_APU) != 0u, "runtime capture should include the APU END interrupt raised while synchronizing audio");

	AudioMachineHarness saveHarness;
	programEndingPcmVoice(saveHarness);
	const bmsx::MachineSaveState saveState = bmsx::captureMachineSaveState(saveHarness.machine);
	require(saveState.audio.output.voices.empty(), "save-state capture should materialize the voice END at its exact sample");
	require((saveState.irq.pendingFlags & bmsx::IRQ_APU) != 0u, "save-state capture should include the APU END interrupt raised while synchronizing audio");
}

void programBadpVoice(AudioHarness& harness) {
	std::array<bmsx::u8, 60> bytes{};
	bytes[0] = 0x42u;
	bytes[1] = 0x41u;
	bytes[2] = 0x44u;
	bytes[3] = 0x50u;
	bmsx::writeLE16(bytes.data() + 4u, 1u);
	bmsx::writeLE16(bytes.data() + 6u, 1u);
	bmsx::writeLE32(bytes.data() + 8u, bmsx::APU_SAMPLE_RATE_HZ / 2u);
	bmsx::writeLE32(bytes.data() + 12u, 8u);
	bmsx::writeLE32(bytes.data() + 36u, 48u);
	bmsx::writeLE16(bytes.data() + 48u, 8u);
	bmsx::writeLE16(bytes.data() + 50u, 12u);
	bmsx::writeLE16(bytes.data() + 52u, 0u);
	bytes[56] = 0x11u;
	bytes[57] = 0x11u;
	bytes[58] = 0x11u;
	bytes[59] = 0x11u;
	harness.memory.writeBytes(bmsx::PROGRAM_STATIC_RAM_BASE, bytes.data(), bytes.size());
	harness.memory.writeMappedU32LE(bmsx::IO_APU_SOURCE_ADDR, bmsx::PROGRAM_STATIC_RAM_BASE);
	harness.memory.writeMappedU32LE(bmsx::IO_APU_SOURCE_BYTES, static_cast<bmsx::u32>(bytes.size()));
	harness.memory.writeMappedU32LE(bmsx::IO_APU_SOURCE_SAMPLE_RATE_HZ, bmsx::APU_SAMPLE_RATE_HZ / 2u);
	harness.memory.writeMappedU32LE(bmsx::IO_APU_SOURCE_CHANNELS, 1u);
	harness.memory.writeMappedU32LE(bmsx::IO_APU_SOURCE_BITS_PER_SAMPLE, 4u);
	harness.memory.writeMappedU32LE(bmsx::IO_APU_SOURCE_FRAME_COUNT, 8u);
	harness.memory.writeMappedU32LE(bmsx::IO_APU_SOURCE_DATA_OFFSET, 48u);
	harness.memory.writeMappedU32LE(bmsx::IO_APU_SOURCE_DATA_BYTES, 12u);
	harness.memory.writeMappedU32LE(bmsx::IO_APU_RATE_STEP_Q16, bmsx::APU_RATE_STEP_Q16_ONE);
	harness.memory.writeMappedU32LE(bmsx::IO_APU_GAIN_Q12, bmsx::APU_GAIN_Q12_ONE);
	harness.memory.writeMappedU32LE(bmsx::IO_APU_SLOT, 1u);
	harness.memory.writeMappedU32LE(bmsx::IO_APU_CMD, bmsx::APU_CMD_PLAY);
	harness.audio.onService(0);
}

void testBadpInterpolationWindowAndRestore() {
	AudioHarness live;
	programBadpVoice(live);
	live.scheduler.advanceTo(3);
	live.audio.onService(3);

	const bmsx::AudioControllerState saved = live.audio.captureState();
	const bmsx::ApuBadpDecoderSaveState& savedBadp = saved.output.voices[0].badp;
	require(savedBadp.decodedFrame == 2, "BADP should retain the decoded interpolation end frame");
	require(savedBadp.previousDecodedFrame == 1, "BADP should retain the decoded interpolation start frame");
	require(savedBadp.nextFrame == 3u, "BADP should advance its stream once per new source frame");
	live.output.outputRing.clear();

	AudioHarness restored;
	restored.scheduler.advanceTo(3);
	restored.audio.restoreState(saved, 3);
	live.scheduler.advanceTo(6);
	live.audio.onService(6);
	restored.scheduler.advanceTo(6);
	restored.audio.onService(6);
	const bmsx::AudioControllerState liveFuture = live.audio.captureState();
	const bmsx::AudioControllerState restoredFuture = restored.audio.captureState();
	const bmsx::ApuOutputVoiceState& liveVoice = liveFuture.output.voices[0];
	const bmsx::ApuOutputVoiceState& restoredVoice = restoredFuture.output.voices[0];
	require(restoredVoice.cursorQ16 == liveVoice.cursorQ16, "BADP restore should preserve the exact future cursor");
	require(restoredVoice.badp.decodedFrame == liveVoice.badp.decodedFrame, "BADP restore should preserve the current decode latch");
	require(restoredVoice.badp.previousDecodedFrame == liveVoice.badp.previousDecodedFrame, "BADP restore should preserve the previous decode latch");
	for (int frame = 0; frame < 3; frame += 1) {
		require(restored.output.outputRing.readFramePacked() == live.output.outputRing.readFramePacked(), "BADP restore should emit identical future PCM");
	}

	restored.memory.writeMappedU32LE(bmsx::IO_APU_SLOT, 1u);
	restored.memory.writeMappedU32LE(
		bmsx::IO_APU_SELECTED_SLOT_REG0 + bmsx::APU_PARAMETER_START_SAMPLE_INDEX * bmsx::IO_WORD_SIZE,
		5u
	);
	const bmsx::AudioControllerState seekState = restored.audio.captureState();
	const bmsx::ApuBadpDecoderSaveState& seekBadp = seekState.output.voices[0].badp;
	require(seekBadp.decodedFrame == 5, "selected START_SAMPLE should seek the live BADP decoder");
	require(seekBadp.previousDecodedFrame == 4, "selected START_SAMPLE should rebuild the interpolation window");
	restored.output.outputRing.clear();
	restored.scheduler.advanceTo(7);
	restored.audio.onService(7);
	require(static_cast<bmsx::i16>(restored.output.outputRing.readFramePacked() & 0xffffu) == 6, "BADP seek should resume from the selected source frame");

	restored.memory.writeMappedU32LE(
		bmsx::IO_APU_SELECTED_SLOT_REG0 + bmsx::APU_PARAMETER_START_SAMPLE_INDEX * bmsx::IO_WORD_SIZE,
		20u
	);
	const bmsx::AudioControllerState pastEndState = restored.audio.captureState();
	const bmsx::ApuBadpDecoderSaveState& pastEndBadp = pastEndState.output.voices[0].badp;
	require(pastEndBadp.nextFrame == 8u, "BADP seek past the source should latch the source end");
	require(pastEndBadp.decodedFrame == -1, "BADP seek past the source should clear the current decode latch");
	require(pastEndBadp.previousDecodedFrame == -1, "BADP seek past the source should clear the interpolation start latch");
	restored.scheduler.advanceTo(8);
	restored.audio.onService(8);
	require(restored.audio.captureState().output.voices.empty(), "BADP seek past the source should end on the next DAC sample");
}

void testRuntimeClockResetAndRestorePreserveApuTimebase() {
	std::array<bmsx::u8, 1> emptyRom{{0}};
	const bmsx::ResolvedRuntimeTiming timing = bmsx::resolveRuntimeTiming(5'000'000, bmsx::GX_GPU_RESET_DISPLAY_MODE_WORD);
	SilentInputSource input;
	bmsx::Runtime runtime(
		bmsx::RuntimeOptions{
			{emptyRom.data(), 0u},
			{emptyRom.data(), 0u},
			timing.gpuDisplayModeWord,
			timing.ufpsScaled,
			timing.cpuHz,
			timing.cycleBudgetPerFrame,
			timing.vblankCycles,
			timing.dmaWordsPerSec,
			timing.geoWorkUnitsPerSec,
		},
		input
	);
	auto& machine = runtime.machine;
	machine.memory.writeMappedU32LE(bmsx::IO_APU_SOURCE_SAMPLE_RATE_HZ, static_cast<bmsx::u32>(runtime.timing.cpuHz));
	machine.memory.writeMappedU32LE(bmsx::IO_APU_SOURCE_CHANNELS, 1u);
	machine.memory.writeMappedU32LE(bmsx::IO_APU_SOURCE_FRAME_COUNT, 2u);
	machine.memory.writeMappedU32LE(bmsx::IO_APU_SOURCE_LOOP_END_SAMPLE, 2u);
	machine.memory.writeMappedU32LE(bmsx::IO_APU_RATE_STEP_Q16, bmsx::APU_RATE_STEP_Q16_ONE);
	machine.memory.writeMappedU32LE(bmsx::IO_APU_GAIN_Q12, bmsx::APU_GAIN_Q12_ONE);
	machine.memory.writeMappedU32LE(bmsx::IO_APU_GENERATOR_KIND, bmsx::APU_GENERATOR_SQUARE);
	machine.memory.writeMappedU32LE(bmsx::IO_APU_GENERATOR_DUTY_Q12, 0x0800u);
	machine.memory.writeMappedU32LE(bmsx::IO_APU_SLOT, 1u);
	machine.memory.writeMappedU32LE(bmsx::IO_APU_CMD, bmsx::APU_CMD_PLAY);
	machine.audioController.onService(0);

	machine.scheduler.advanceTo(100'000);
	machine.audioController.onService(100'000);
	machine.audioOutput.outputRing.clear();
	runtime.vblank.reset(runtime);
	require(machine.scheduler.nowCycles() == 100'000, "VBLANK reset should preserve the monotonic device clock");
	machine.scheduler.advanceTo(100'114);
	machine.audioController.onService(100'114);
	require(machine.audioOutput.outputRing.queuedFrames() == 1u, "APU should continue from the retained device clock after VBLANK reset");

	const bmsx::RuntimeMachineState state = bmsx::captureRuntimeMachineState(runtime);
	machine.scheduler.advanceTo(200'000);
	machine.audioController.onService(200'000);
	machine.audioOutput.outputRing.clear();
	bmsx::applyRuntimeMachineState(runtime, state);
	require(machine.scheduler.nowCycles() == 100'114, "runtime restore should restore the captured device clock");
	require(machine.audioOutput.outputRing.queuedFrames() == 0u, "runtime restore should not restore host presentation audio");
	machine.scheduler.advanceTo(100'228);
	machine.audioController.onService(100'228);
	require(machine.audioOutput.outputRing.queuedFrames() == 1u, "restored APU should resume on the captured clock phase");

	runtime.resetHardwareState();
	require(machine.scheduler.nowCycles() == 0, "hardware reset should reset the machine clock");
	require(machine.audioOutput.outputRing.queuedFrames() == 0u, "hardware reset should clear APU presentation audio");
}

void programFilteredSquareVoice(AudioHarness& harness) {
	harness.memory.writeMappedU32LE(bmsx::IO_APU_SOURCE_SAMPLE_RATE_HZ, bmsx::APU_SAMPLE_RATE_HZ / 4u);
	harness.memory.writeMappedU32LE(bmsx::IO_APU_SOURCE_CHANNELS, 1u);
	harness.memory.writeMappedU32LE(bmsx::IO_APU_SOURCE_FRAME_COUNT, 2u);
	harness.memory.writeMappedU32LE(bmsx::IO_APU_SOURCE_LOOP_END_SAMPLE, 2u);
	harness.memory.writeMappedU32LE(bmsx::IO_APU_RATE_STEP_Q16, bmsx::APU_RATE_STEP_Q16_ONE);
	harness.memory.writeMappedU32LE(bmsx::IO_APU_GAIN_Q12, bmsx::APU_GAIN_Q12_ONE);
	harness.memory.writeMappedU32LE(bmsx::IO_APU_FILTER_KIND, bmsx::APU_FILTER_LOWPASS);
	harness.memory.writeMappedU32LE(bmsx::IO_APU_FILTER_FREQ_HZ, 1200u);
	harness.memory.writeMappedU32LE(bmsx::IO_APU_FILTER_Q_MILLI, 700u);
	harness.memory.writeMappedU32LE(bmsx::IO_APU_GENERATOR_KIND, bmsx::APU_GENERATOR_SQUARE);
	harness.memory.writeMappedU32LE(bmsx::IO_APU_GENERATOR_DUTY_Q12, 0x0800u);
	harness.memory.writeMappedU32LE(bmsx::IO_APU_SLOT, 1u);
	harness.memory.writeMappedU32LE(bmsx::IO_APU_CMD, bmsx::APU_CMD_PLAY);
	harness.audio.onService(0);
}

void testFilterAndFadeRestore() {
	AudioHarness live;
	programFilteredSquareVoice(live);
	live.scheduler.advanceTo(3);
	live.audio.onService(3);
	live.memory.writeMappedU32LE(bmsx::IO_APU_SLOT, 1u);
	live.memory.writeMappedU32LE(bmsx::IO_APU_FADE_SAMPLES, 4u);
	live.memory.writeMappedU32LE(bmsx::IO_APU_CMD, bmsx::APU_CMD_STOP_SLOT);
	live.audio.onService(3);
	live.scheduler.advanceTo(5);
	live.audio.onService(5);
	const bmsx::AudioControllerState saved = live.audio.captureState();
	require(saved.output.voices[0].fadeSamplesRemaining == 2u, "STOP fade should retain its remaining hardware samples");
	require(saved.output.voices[0].filter.enabled, "active filter state should be saved");
	require(saved.output.voices[0].filter.l1 != 0.0, "active filter history should be saved");
	live.output.outputRing.clear();

	AudioHarness restored;
	restored.scheduler.advanceTo(5);
	restored.audio.restoreState(saved, 5);
	live.scheduler.advanceTo(7);
	live.audio.onService(7);
	restored.scheduler.advanceTo(7);
	restored.audio.onService(7);
	const bmsx::AudioControllerState liveEnd = live.audio.captureState();
	const bmsx::AudioControllerState restoredEnd = restored.audio.captureState();
	require(restoredEnd.output.voices.empty() && liveEnd.output.voices.empty(), "restored fade should end on the same hardware sample");
	require(restoredEnd.eventSequence == liveEnd.eventSequence, "restored fade should emit the same END event");
	for (int frame = 0; frame < 2; frame += 1) {
		require(restored.output.outputRing.readFramePacked() == live.output.outputRing.readFramePacked(), "restored filter and fade should emit identical future PCM");
	}
}

void testResamplerChunkContinuityAndUnderrun() {
	std::array<bmsx::i16, 128> source{};
	for (size_t frame = 0u; frame < source.size() / 2u; frame += 1u) {
		source[frame * 2u] = static_cast<bmsx::i16>(static_cast<int>(frame) * 13 - 12000);
		source[frame * 2u + 1u] = static_cast<bmsx::i16>(12000 - static_cast<int>(frame) * 7);
	}
	bmsx::ApuOutputRing splitRing;
	bmsx::ApuOutputRing batchRing;
	splitRing.write(source.data(), source.size() / 2u);
	batchRing.write(source.data(), source.size() / 2u);
	bmsx::AudioOutputResampler split;
	bmsx::AudioOutputResampler batch;
	std::array<bmsx::i16, 34> splitFirst{};
	std::array<bmsx::i16, 86> splitSecond{};
	std::array<bmsx::i16, 120> batched{};
	split.pull(splitRing, splitFirst.data(), splitFirst.size() / 2u, 48000, 0.75F, 16u);
	split.pull(splitRing, splitSecond.data(), splitSecond.size() / 2u, 48000, 0.75F, 16u);
	batch.pull(batchRing, batched.data(), batched.size() / 2u, 48000, 0.75F, 16u);
	for (size_t index = 0u; index < splitFirst.size(); index += 1u) {
		require(splitFirst[index] == batched[index], "resampler chunks should retain the same interpolation phase");
	}
	for (size_t index = 0u; index < splitSecond.size(); index += 1u) {
		require(splitSecond[index] == batched[splitFirst.size() + index], "resampler chunks should match one batched pull");
	}

	std::array<bmsx::i16, 4> initial{{-9000, 9000, -8000, 8000}};
	std::array<bmsx::i16, 32> refill{};
	for (size_t index = 0u; index < refill.size(); index += 1u) {
		refill[index] = static_cast<bmsx::i16>(1000 + static_cast<int>(index) * 37);
	}
	bmsx::ApuOutputRing starvedRing;
	starvedRing.write(initial.data(), initial.size() / 2u);
	bmsx::AudioOutputResampler recovered;
	std::array<bmsx::i16, 4> starvedOutput{};
	recovered.pull(starvedRing, starvedOutput.data(), starvedOutput.size() / 2u, 11025, 1.0F, 2u);
	require(starvedOutput[2] == 0 && starvedOutput[3] == 0, "resampler underrun should silence the remaining host frames");

	bmsx::ApuOutputRing freshRing;
	starvedRing.write(refill.data(), refill.size() / 2u);
	freshRing.write(refill.data(), refill.size() / 2u);
	std::array<bmsx::i16, 4> recoveredOutput{};
	std::array<bmsx::i16, 4> freshOutput{};
	recovered.pull(starvedRing, recoveredOutput.data(), recoveredOutput.size() / 2u, 11025, 1.0F, 2u);
	bmsx::AudioOutputResampler fresh;
	fresh.pull(freshRing, freshOutput.data(), freshOutput.size() / 2u, 11025, 1.0F, 2u);
	require(recoveredOutput == freshOutput, "resampler recovery should start from a fresh interpolation window");
}

} // namespace

int main() {
	testOutputRingExposesUnsignedHardwareWords();
	testMachineCaptureIncludesMaterializedApuEndIrq();
	testBadpInterpolationWindowAndRestore();
	testRuntimeClockResetAndRestorePreserveApuTimebase();
	testFilterAndFadeRestore();
	testResamplerChunkContinuityAndUnderrun();
	return 0;
}
