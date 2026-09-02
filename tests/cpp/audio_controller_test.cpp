#include "audio/output_resampler.h"
#include "common/endian.h"
#include "spec/bmsx/io.h"
#include "machine/cpu/cpu.h"
#include "machine/devices/audio/controller.h"
#include "machine/devices/audio/biquad_filter.h"
#include "machine/devices/audio/output.h"
#include "machine/devices/audio/pcm_decoder_hot_path.h"
#include "machine/devices/dma/controller.h"
#include "machine/devices/input/contracts.h"
#include "machine/devices/irq/controller.h"
#include "machine/machine.h"
#include "spec/bmsx/memory_map.h"
#include "machine/memory/memory.h"
#include "spec/bmsx/model.h"
#include "machine/runtime/machine_state.h"
#include "machine/runtime/runtime.h"
#include "machine/save_state.h"
#include "machine/scheduler/budget.h"
#include "machine/scheduler/device.h"
#include "support/cartridge_fixture.h"

#include <array>
#include <cstdint>
#include <stdexcept>

namespace {

struct AudioHarness {
	std::array<bmsx::u8, 4> systemRom{{0xc0u, 0x80u, 0x80u, 0x80u}};
	std::array<bmsx::u8, 4> cartRom{{0x40u, 0x80u, 0x80u, 0x80u}};
	std::array<bmsx::u8, 4> auxiliaryCartRom{{0xffu, 0xffu, 0xffu, 0xffu}};
	bmsx::Memory memory;
	bmsx::IrqController irq;
	bmsx::ExecutionAddressSpace executionAddressSpace;
	bmsx::CPU cpu;
	bmsx::DeviceScheduler scheduler;
	bmsx::ApuOutputMixer output;
	bmsx::DmaController dma;
	bmsx::AudioController audio;

	explicit AudioHarness(bool auxiliaryCartridge = false)
		: memory(bmsx::MemoryInit{
			{systemRom.data(), systemRom.size()},
			auxiliaryCartridge
				? bmsx::test::cartridgeSlots(cartRom, auxiliaryCartRom)
				: bmsx::test::cartridgeSlots(cartRom)},
			bmsx::PSX_MACHINE_SPEC.ramBytes)
		, irq(memory)
		, executionAddressSpace(memory)
		, cpu(memory, irq, executionAddressSpace)
		, scheduler(cpu)
		, output()
		, dma(memory, cpu, irq, scheduler)
		, audio(memory, output, dma, irq, scheduler) {
		memory.cartridgeController().connect(memory, irq, dma);
		irq.reset();
		dma.reset();
		memory.cartridgeController().reset();
		audio.reset();
		dma.setTiming(1, 0, 1, 0, 0, 0);
		audio.setTiming(bmsx::APU_SAMPLE_RATE_HZ, 0);
	}
};

class SilentInputSource final : public bmsx::InputControllerInputSource {
public:
	void sampleInputControllerSnapshot(bmsx::InputControllerSnapshot&) override {
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

	explicit AudioMachineHarness(bmsx::i64 cpuHz = bmsx::APU_SAMPLE_RATE_HZ)
		: memory(
			bmsx::MemoryInit{{emptyRom.data(), 0u}, bmsx::test::cartridgeSlots()},
			bmsx::PSX_MACHINE_SPEC.ramBytes)
		, machine(memory, input, bmsx::PSX_MACHINE_SPEC) {
		machine.resetDevices();
		const bmsx::u32 smode1Address = bmsx::gxGpuPcrtcRegisterAddress(bmsx::GX_GPU_PCRTC_SMODE1_LOW);
		memory.writeMappedU32LE(smode1Address, memory.readMappedU32LE(smode1Address) | bmsx::GX_GPU_PCRTC_SMODE1_SINT);
		machine.gxGpu.onService(0);
		machine.audioController.setTiming(cpuHz, 0);
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
	ring.write(frame.data(), 1u, 0);
	require(ring.readFramePacked() == 0x80001234u, "output ring should expose one unsigned packed stereo word");
}

void programEndingPcmVoice(AudioMachineHarness& harness) {
	harness.memory.writeMappedU32LE(bmsx::IO_APU_TRANSFER_ADDRESS, 0u);
	harness.memory.writeMappedU32LE(bmsx::IO_APU_TRANSFER_CONTROL, bmsx::APU_TRANSFER_MODE_MANUAL_WRITE);
	harness.memory.writeMappedU32LE(bmsx::IO_APU_TRANSFER_DATA, 0x11223344u);
	harness.memory.writeMappedU32LE(bmsx::IO_APU_SOURCE_ADDR, bmsx::APU_SAMPLE_RAM_BASE);
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

void advanceScheduledApuTo(AudioMachineHarness& harness, bmsx::i64 targetCycle) {
	while (harness.machine.scheduler.nextDeadline() <= targetCycle) {
		const bmsx::i64 deadline = harness.machine.scheduler.nextDeadline();
		harness.machine.scheduler.advanceTo(deadline);
		harness.machine.audioController.onService(deadline);
	}
	harness.machine.scheduler.advanceTo(targetCycle);
}

void testHostSynchronizationExposesEveryElapsedPalSample() {
	AudioMachineHarness scheduledOnly;
	AudioMachineHarness hostSynchronized;
	programEndingPcmVoice(scheduledOnly);
	programEndingPcmVoice(hostSynchronized);
	constexpr bmsx::i64 samplesPerPalFrame = bmsx::APU_SAMPLE_RATE_HZ / 50;

	advanceScheduledApuTo(scheduledOnly, samplesPerPalFrame * 2);
	bmsx::ApuOutputRing& scheduledOutputRing = scheduledOnly.machine.audioController.synchronizeOutput();

	advanceScheduledApuTo(hostSynchronized, samplesPerPalFrame);
	require(hostSynchronized.memory.readIoU32(bmsx::IO_APU_SAMPLE_SEQUENCE) == static_cast<bmsx::u32>(samplesPerPalFrame), "APU sample sequence register should expose the synchronized hardware clock");
	bmsx::ApuOutputRing& synchronizedOutputRing = hostSynchronized.machine.audioController.synchronizeOutput();
	require(synchronizedOutputRing.queuedFrames() == static_cast<size_t>(samplesPerPalFrame), "one PAL host boundary should expose every elapsed APU sample");
	advanceScheduledApuTo(hostSynchronized, samplesPerPalFrame * 2);
	require(hostSynchronized.machine.audioController.synchronizeOutput().queuedFrames() == static_cast<size_t>(samplesPerPalFrame * 2), "two synchronized PAL frames should expose the full machine timeline");

	const bmsx::AudioControllerState scheduledState = scheduledOnly.machine.audioController.captureState();
	const bmsx::AudioControllerState synchronizedState = hostSynchronized.machine.audioController.captureState();
	require(synchronizedState.output.voices.empty() && scheduledState.output.voices.empty(), "host synchronization must preserve voice END timing");
	require(synchronizedState.sampleCarry == scheduledState.sampleCarry, "host synchronization must preserve the APU clock carry");
	require(synchronizedState.eventSequence == scheduledState.eventSequence, "host synchronization must preserve APU event cadence");
	require(hostSynchronized.memory.readIoU32(bmsx::IO_IRQ_FLAGS) == scheduledOnly.memory.readIoU32(bmsx::IO_IRQ_FLAGS), "host synchronization must preserve IRQ state");
	require(scheduledOutputRing.queuedFrames() == static_cast<size_t>(samplesPerPalFrame * 2), "scheduled APU service plus final synchronization should expose the same timeline");
	while (scheduledOutputRing.queuedFrames() != 0u) {
		require(synchronizedOutputRing.readFramePacked() == scheduledOutputRing.readFramePacked(), "host synchronization must preserve exact output PCM");
	}
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
	harness.memory.writeMappedU32LE(bmsx::IO_APU_TRANSFER_ADDRESS, 0u);
	harness.memory.writeMappedU32LE(bmsx::IO_APU_TRANSFER_CONTROL, bmsx::APU_TRANSFER_MODE_MANUAL_WRITE);
	for (size_t offset = 0u; offset < bytes.size(); offset += bmsx::IO_WORD_SIZE) {
		harness.memory.writeMappedU32LE(bmsx::IO_APU_TRANSFER_DATA, bmsx::readLE32(bytes.data() + offset));
	}
	harness.memory.writeMappedU32LE(bmsx::IO_APU_SOURCE_ADDR, bmsx::APU_SAMPLE_RAM_BASE);
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

void testSampleTransferEdgeOrdering() {
	auto programVoice = [](AudioHarness& harness) {
		harness.audio.setTiming(bmsx::APU_TRANSFER_WORDS_PER_SECOND, 0);
		harness.memory.writeMappedU32LE(bmsx::IO_APU_TRANSFER_ADDRESS, 0u);
		harness.memory.writeMappedU32LE(bmsx::IO_APU_TRANSFER_CONTROL, bmsx::APU_TRANSFER_MODE_MANUAL_WRITE);
		harness.memory.writeMappedU32LE(bmsx::IO_APU_TRANSFER_DATA, 0x40404040u);
		harness.memory.writeMappedU32LE(bmsx::IO_APU_SOURCE_ADDR, bmsx::APU_SAMPLE_RAM_BASE);
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
		harness.audio.onService(0);
	};

	auto programTransferEdge = [&programVoice](AudioHarness& harness) {
		programVoice(harness);
		const bmsx::u32 dmaSource = bmsx::DYNAMIC_RAM_BASE + 0x300u;
		harness.memory.writeMappedU32LE(dmaSource, 0xc0c0c0c0u);
		harness.scheduler.advanceTo(46);
		harness.memory.writeMappedU32LE(bmsx::IO_APU_TRANSFER_ADDRESS, 0u);
		harness.memory.writeMappedU32LE(bmsx::IO_APU_TRANSFER_CONTROL, bmsx::APU_TRANSFER_MODE_DMA_WRITE);
		harness.memory.writeMappedU32LE(bmsx::IO_DMA0_READ_ADDR, dmaSource);
		harness.memory.writeMappedU32LE(bmsx::IO_DMA0_WRITE_ADDR, bmsx::IO_APU_TRANSFER_DATA);
		harness.memory.writeMappedU32LE(bmsx::IO_DMA0_TRANSFER_COUNT, 1u);
		harness.memory.writeMappedU32LE(bmsx::IO_DMA0_CONTROL, 0x000000c0u);
		harness.memory.writeMappedU32LE(bmsx::IO_DMA0_TRIGGER, bmsx::DMA_TRIGGER_START);
		const bmsx::i64 dmaDeadline = harness.scheduler.nextDeadline();
		require(dmaDeadline == 47, "single-word APU DMA block should reach its deadline on cycle 47");
		harness.scheduler.advanceTo(dmaDeadline);
		harness.dma.onService(dmaDeadline);
	};

	AudioHarness scheduled;
	AudioHarness status;
	AudioHarness captured;
	programTransferEdge(scheduled);
	programTransferEdge(status);
	programTransferEdge(captured);

	scheduled.scheduler.advanceTo(48);
	scheduled.audio.onTransferService(48);
	status.scheduler.advanceTo(48);
	status.memory.readIoU32(bmsx::IO_APU_STATUS);
	captured.scheduler.advanceTo(48);
	const bmsx::AudioControllerState capturedState = captured.audio.captureState();

	bmsx::ApuOutputRing& scheduledRing = scheduled.audio.synchronizeOutput();
	bmsx::ApuOutputRing& statusRing = status.audio.synchronizeOutput();
	bmsx::ApuOutputRing& capturedRing = captured.audio.synchronizeOutput();
	require(scheduledRing.queuedFrames() == 2u, "transfer service should expose both DAC edges through cycle 48");
	require(statusRing.queuedFrames() == 2u, "APU status should synchronize both DAC edges through cycle 48");
	require(capturedRing.queuedFrames() == 2u, "APU capture should synchronize both DAC edges through cycle 48");
	const bmsx::u32 beforeTransfer = scheduledRing.readFramePacked();
	const bmsx::u32 atTransfer = scheduledRing.readFramePacked();
	require(static_cast<bmsx::i16>(beforeTransfer & 0xffffu) < 0, "the DAC edge before the transfer deadline should read old sample RAM");
	require(static_cast<bmsx::i16>(atTransfer & 0xffffu) > 0, "the DAC edge on the transfer deadline should read newly written sample RAM");
	require(statusRing.readFramePacked() == beforeTransfer && statusRing.readFramePacked() == atTransfer, "status synchronization should preserve transfer-edge PCM ordering");
	require(capturedRing.readFramePacked() == beforeTransfer && capturedRing.readFramePacked() == atTransfer, "capture synchronization should preserve transfer-edge PCM ordering");
	require(bmsx::readLE32(capturedState.sampleRam.data()) == 0xc0c0c0c0u, "capture on the transfer deadline should include the completed sample-RAM write");

	AudioHarness manual;
	programVoice(manual);
	manual.memory.writeMappedU32LE(bmsx::IO_APU_TRANSFER_ADDRESS, 0u);
	manual.scheduler.advanceTo(24);
	manual.memory.writeMappedU32LE(bmsx::IO_APU_TRANSFER_DATA, 0xc0c0c0c0u);
	bmsx::ApuOutputRing& manualRing = manual.audio.synchronizeOutput();
	require(manualRing.queuedFrames() == 1u, "same-cycle manual RAM write should produce exactly one elapsed DAC sample");
	require(static_cast<bmsx::i16>(manualRing.readFramePacked() & 0xffffu) > 0, "manual RAM write should precede a DAC sample on the same cycle");
}

void programPcmVoice(AudioHarness& harness, bmsx::u32 sourceAddress) {
	harness.memory.writeMappedU32LE(bmsx::IO_APU_SOURCE_ADDR, sourceAddress);
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
	harness.audio.onService(harness.scheduler.nowCycles());
}

void testApuVoiceLatchesCartridgeSocketAcrossRestore() {
	AudioHarness harness(true);
	harness.memory.writeMappedU32LE(bmsx::IO_CART_SELECT, 1u);
	programPcmVoice(harness, bmsx::CART_ROM_BASE);
	const bmsx::AudioControllerState saved = harness.audio.captureState();
	require(saved.output.voices[0].sourceCartridgeSlot == 1u, "PLAY should latch the selected cartridge socket into the voice");

	harness.memory.writeMappedU32LE(bmsx::IO_CART_SELECT, 0u);
	harness.audio.restoreState(saved, 0);
	harness.scheduler.advanceTo(1);
	harness.audio.onService(1);
	require(harness.output.outputRing.readFramePacked() == 0x7f007f00u, "restored playback should remain bound to the latched cartridge socket");
}

void testSampleBusDmaAndMidTransferRestore() {
	{
		AudioHarness harness;
		programPcmVoice(harness, bmsx::SYSTEM_ROM_BASE);
		harness.scheduler.advanceTo(1);
		harness.audio.onService(1);
		const auto systemSample = static_cast<bmsx::i16>(harness.output.outputRing.readFramePacked() & 0xffffu);
		require(systemSample > 0, "APU should fetch PCM from the system ROM chip select");

		programPcmVoice(harness, bmsx::CART_ROM_BASE);
		harness.scheduler.advanceTo(2);
		harness.audio.onService(2);
		const auto cartSample = static_cast<bmsx::i16>(harness.output.outputRing.readFramePacked() & 0xffffu);
		require(cartSample < 0, "APU should fetch PCM from the cart ROM chip select");

		harness.memory.writeMappedU32LE(bmsx::DYNAMIC_RAM_BASE, 0x11223344u);
		programPcmVoice(harness, bmsx::DYNAMIC_RAM_BASE);
		const bmsx::AudioControllerState rejected = harness.audio.captureState();
		require(harness.memory.readIoU32(bmsx::IO_APU_FAULT_CODE) == bmsx::APU_FAULT_SOURCE_RANGE, "CPU RAM should fault on the APU sample bus");
		require(harness.memory.readIoU32(bmsx::IO_APU_FAULT_DETAIL) == bmsx::DYNAMIC_RAM_BASE, "source-range fault should latch the rejected CPU address");
		require(rejected.output.voices.size() == 1u, "a rejected PLAY must retain the active ROM voice");
		require(rejected.output.voices[0].cursorQ16 == static_cast<bmsx::i64>(bmsx::APU_RATE_STEP_Q16_ONE), "a rejected PLAY must not restart the active voice");
		require(rejected.slotRegisterWords[bmsx::apuSlotRegisterWordIndex(1u, bmsx::APU_PARAMETER_SOURCE_ADDR_INDEX)] == bmsx::CART_ROM_BASE, "a rejected PLAY must not replace active slot state");
		require(bmsx::readLE32(rejected.sampleRam.data()) == 0u, "direct ROM playback must not stage samples in APU RAM");

		harness.memory.writeMappedU32LE(bmsx::IO_APU_TRANSFER_ADDRESS, 0u);
		harness.memory.writeMappedU32LE(bmsx::IO_APU_TRANSFER_CONTROL, bmsx::APU_TRANSFER_MODE_MANUAL_WRITE);
		harness.memory.writeMappedU32LE(bmsx::IO_APU_TRANSFER_DATA, 0x808080c0u);
		programPcmVoice(harness, bmsx::APU_SAMPLE_RAM_BASE);
		harness.memory.writeMappedU32LE(bmsx::IO_APU_TRANSFER_ADDRESS, 0u);
		harness.memory.writeMappedU32LE(bmsx::IO_APU_TRANSFER_DATA, 0x80808040u);
		harness.scheduler.advanceTo(3);
		harness.audio.onService(3);
		const auto mutatedSample = static_cast<bmsx::i16>(harness.output.outputRing.readFramePacked() & 0xffffu);
		require(mutatedSample < 0, "an active voice should observe writes through its retained APU sample-RAM view");
	}

	AudioHarness live;
	live.audio.setTiming(bmsx::APU_TRANSFER_WORDS_PER_SECOND, 0);
	const bmsx::u32 source = bmsx::DYNAMIC_RAM_BASE + 0x100u;
	const bmsx::u32 target = bmsx::DYNAMIC_RAM_BASE + 0x200u;
	const bmsx::u32 transferAddress = bmsx::APU_SAMPLE_RAM_BYTES - 8u;
	for (bmsx::u32 index = 0u; index < 32u; index += 1u) {
		live.memory.writeMappedU32LE(source + index * bmsx::IO_WORD_SIZE, 0x5a000000u | index);
	}
	auto serviceDma = [](AudioHarness& harness) {
		const bmsx::i64 deadline = harness.scheduler.nextDeadline();
		require(deadline > harness.scheduler.nowCycles(), "APU DMA block should have a future deadline");
		harness.scheduler.advanceTo(deadline);
		harness.dma.onService(deadline);
	};
	auto serviceTransfer = [](AudioHarness& harness) {
		const bmsx::i64 deadline = harness.scheduler.nextDeadline();
		require(deadline > harness.scheduler.nowCycles(), "APU sample transfer should have a future deadline");
		harness.scheduler.advanceTo(deadline);
		harness.audio.onTransferService(deadline);
	};

	live.memory.writeMappedU32LE(bmsx::IO_APU_TRANSFER_ADDRESS, transferAddress);
	live.memory.writeMappedU32LE(bmsx::IO_APU_TRANSFER_CONTROL, bmsx::APU_TRANSFER_MODE_DMA_WRITE);
	live.memory.writeMappedU32LE(bmsx::IO_DMA0_READ_ADDR, source);
	live.memory.writeMappedU32LE(bmsx::IO_DMA0_WRITE_ADDR, bmsx::IO_APU_TRANSFER_DATA);
	live.memory.writeMappedU32LE(bmsx::IO_DMA0_TRANSFER_COUNT, 32u);
	live.memory.writeMappedU32LE(bmsx::IO_DMA0_CONTROL, 0x00003cc1u);
	live.memory.writeMappedU32LE(bmsx::IO_DMA0_TRIGGER, bmsx::DMA_TRIGGER_START);
	require(!live.memory.mappedWriteReady(bmsx::IO_APU_TRANSFER_DATA), "BUSY DMA should own the shared APU data port");
	serviceDma(live);

	const bmsx::i64 savedNow = live.scheduler.nowCycles();
	const bmsx::MemorySaveState savedMemory = live.memory.captureSaveState();
	const bmsx::AudioControllerState savedAudio = live.audio.captureState();
	const bmsx::DmaControllerState savedDma = live.dma.captureState();
	require(bmsx::readLE32(savedAudio.sampleRam.data() + transferAddress) == 0u, "DMA FIFO words should not reach sample RAM before transfer time elapses");
	require(savedAudio.sampleTransfer.fifoCount == bmsx::APU_TRANSFER_FIFO_WORD_CAPACITY, "one DMA block should fill the APU transfer FIFO");
	require(savedAudio.sampleTransfer.scheduledWords == bmsx::APU_TRANSFER_FIFO_WORD_CAPACITY, "the admitted DMA block should establish one complete FIFO transfer batch");

	AudioHarness restored;
	restored.audio.setTiming(bmsx::APU_TRANSFER_WORDS_PER_SECOND, 0);
	restored.scheduler.advanceTo(savedNow);
	restored.memory.restoreSaveState(savedMemory);
	restored.dma.restoreState(savedDma, savedNow);
	restored.audio.restoreState(savedAudio, savedNow);
	restored.dma.postLoad();

	serviceTransfer(live);
	serviceDma(live);
	serviceTransfer(live);
	serviceTransfer(restored);
	serviceDma(restored);
	serviceTransfer(restored);

	const bmsx::AudioControllerState liveCompleted = live.audio.captureState();
	const bmsx::AudioControllerState restoredCompleted = restored.audio.captureState();
	require(live.memory.readIoU32(bmsx::IO_DMA0_STATUS) == bmsx::DMA_STATUS_DONE, "APU DMA write should complete");
	require(restored.memory.readIoU32(bmsx::IO_DMA0_STATUS) == bmsx::DMA_STATUS_DONE, "restored APU DMA write should complete");
	require(restoredCompleted.sampleRam == liveCompleted.sampleRam, "mid-transfer restore should produce identical APU sample RAM");
	require(restoredCompleted.sampleTransfer.currentAddress == liveCompleted.sampleTransfer.currentAddress, "mid-transfer restore should preserve the transfer address phase");
	require(restoredCompleted.sampleTransfer.fifoCount == 0u && restoredCompleted.sampleTransfer.scheduledWords == 0u, "completed DMA write should leave the transfer datapath idle");
	for (bmsx::u32 index = 0u; index < 32u; index += 1u) {
		const bmsx::u32 sampleAddress = (transferAddress + index * bmsx::IO_WORD_SIZE) & bmsx::APU_SAMPLE_RAM_ADDRESS_MASK;
		require(bmsx::readLE32(liveCompleted.sampleRam.data() + sampleAddress) == (0x5a000000u | index), "APU sample RAM writes should wrap at 512 KiB");
	}

	live.memory.writeMappedU32LE(bmsx::IO_APU_TRANSFER_ADDRESS, transferAddress);
	live.memory.writeMappedU32LE(bmsx::IO_APU_TRANSFER_CONTROL, bmsx::APU_TRANSFER_MODE_DMA_READ);
	live.memory.writeMappedU32LE(bmsx::IO_DMA0_READ_ADDR, bmsx::IO_APU_TRANSFER_DATA);
	live.memory.writeMappedU32LE(bmsx::IO_DMA0_WRITE_ADDR, target);
	live.memory.writeMappedU32LE(bmsx::IO_DMA0_TRANSFER_COUNT, 32u);
	live.memory.writeMappedU32LE(bmsx::IO_DMA0_CONTROL, 0x00003c12u);
	live.memory.writeMappedU32LE(bmsx::IO_DMA0_TRIGGER, bmsx::DMA_TRIGGER_START);
	serviceTransfer(live);
	const bmsx::AudioControllerState beforeCpuRead = live.audio.captureState();
	const bmsx::u32 cpuReadLatch = live.memory.readMappedU32LE(bmsx::IO_APU_TRANSFER_DATA);
	const bmsx::AudioControllerState afterCpuRead = live.audio.captureState();
	require(cpuReadLatch == beforeCpuRead.sampleTransfer.transferDataWord, "CPU APU-data reads should return the retained transfer latch");
	require(beforeCpuRead.sampleTransfer.fifoCount == bmsx::APU_TRANSFER_FIFO_WORD_CAPACITY
		&& afterCpuRead.sampleTransfer.fifoCount == bmsx::APU_TRANSFER_FIFO_WORD_CAPACITY,
		"CPU APU-data reads must not consume a DMA-read FIFO word");
	serviceDma(live);
	serviceTransfer(live);
	serviceDma(live);
	live.memory.writeMappedU32LE(bmsx::IO_APU_TRANSFER_CONTROL, bmsx::APU_TRANSFER_MODE_STOP);
	require(live.memory.readIoU32(bmsx::IO_DMA0_STATUS) == bmsx::DMA_STATUS_DONE, "APU DMA read should complete");
	for (bmsx::u32 index = 0u; index < 32u; index += 1u) {
		require(live.memory.readMappedU32LE(target + index * bmsx::IO_WORD_SIZE) == (0x5a000000u | index), "APU DMA read should round-trip wrapped sample RAM words");
	}
	require(live.memory.mappedWriteReady(bmsx::IO_APU_TRANSFER_DATA), "DMA completion should release the shared APU data port");

	live.memory.writeMappedU32LE(bmsx::IO_DMA0_READ_ADDR, bmsx::IO_APU_TRANSFER_DATA);
	live.memory.writeMappedU32LE(bmsx::IO_DMA0_WRITE_ADDR, target);
	live.memory.writeMappedU32LE(bmsx::IO_DMA0_TRANSFER_COUNT, 1u);
	live.memory.writeMappedU32LE(bmsx::IO_DMA0_CONTROL, 0x000003fcu);
	live.memory.writeMappedU32LE(bmsx::IO_DMA0_TRIGGER, bmsx::DMA_TRIGGER_START);
	require(!live.memory.mappedWriteReady(bmsx::IO_APU_TRANSFER_DATA),
		"a busy DMA channel must reserve its mapped APU data port while waiting for DREQ");
}

void testSampleTransferWrongDirectionBlock() {
	AudioHarness harness;
	harness.dma.setTiming(0, 8, 0, 0, 0, 0);
	harness.audio.setTiming(bmsx::APU_TRANSFER_WORDS_PER_SECOND, 0);
	const bmsx::u32 source = bmsx::DYNAMIC_RAM_BASE + 0x500u;
	const bmsx::u32 target = bmsx::DYNAMIC_RAM_BASE + 0x600u;
	for (bmsx::u32 index = 0u; index < 32u; index += 1u) {
		harness.memory.writeMappedU32LE(source + index * bmsx::IO_WORD_SIZE, 0x66000000u | index);
	}

	harness.memory.writeMappedU32LE(bmsx::IO_APU_TRANSFER_CONTROL, bmsx::APU_TRANSFER_MODE_DMA_WRITE);
	harness.memory.writeMappedU32LE(bmsx::IO_DMA0_READ_ADDR, source);
	harness.memory.writeMappedU32LE(bmsx::IO_DMA0_WRITE_ADDR, bmsx::IO_APU_TRANSFER_DATA);
	harness.memory.writeMappedU32LE(bmsx::IO_DMA0_TRANSFER_COUNT, 32u);
	harness.memory.writeMappedU32LE(bmsx::IO_DMA0_CONTROL, 0x00003cc1u);
	harness.memory.writeMappedU32LE(bmsx::IO_DMA0_TRIGGER, bmsx::DMA_TRIGGER_START);
	auto serviceDma = [](AudioHarness& fixture) {
		const bmsx::i64 deadline = fixture.scheduler.nextDeadline();
		fixture.scheduler.advanceTo(deadline);
		fixture.dma.onService(deadline);
	};
	serviceDma(harness);
	const bmsx::ApuSampleTransferState before = harness.audio.captureState().sampleTransfer;
	require(before.fifoCount == bmsx::APU_TRANSFER_FIFO_WORD_CAPACITY, "one APU-write block should fill the transfer FIFO");
	require(before.scheduledWords == bmsx::APU_TRANSFER_FIFO_WORD_CAPACITY, "one APU-write block should schedule one FIFO batch");

	harness.memory.writeMappedU32LE(bmsx::IO_DMA0_READ_ADDR, bmsx::IO_APU_TRANSFER_DATA);
	harness.memory.writeMappedU32LE(bmsx::IO_DMA0_WRITE_ADDR, target);
	harness.memory.writeMappedU32LE(bmsx::IO_DMA0_CONTROL, 0x00003c02u);
	serviceDma(harness);
	const bmsx::ApuSampleTransferState afterReverseBlock = harness.audio.captureState().sampleTransfer;
	require(afterReverseBlock.fifoCount == bmsx::APU_TRANSFER_FIFO_WORD_CAPACITY, "wrong-direction DMA reads must not consume the APU-write FIFO");
	require(afterReverseBlock.scheduledWords == bmsx::APU_TRANSFER_FIFO_WORD_CAPACITY, "wrong-direction DMA reads must not alter the scheduled APU-write batch");

	const bmsx::i64 transferDeadline = harness.scheduler.nextDeadline();
	harness.scheduler.advanceTo(transferDeadline);
	harness.audio.onTransferService(transferDeadline);
	const bmsx::AudioControllerState completed = harness.audio.captureState();
	require(completed.sampleTransfer.fifoCount == 0u && completed.sampleTransfer.scheduledWords == 0u, "the retained write FIFO should drain exactly once");
	require(bmsx::readLE32(completed.sampleRam.data()) == 0x66000000u, "the retained write FIFO should reach sample RAM without underflow");
}

void testRuntimeClockResetAndRestorePreserveApuTimebase() {
	std::array<bmsx::u8, 1> emptyRom{{0}};
	bmsx::MachineModelSpec machineModel = bmsx::PSX_MACHINE_SPEC;
	machineModel.cpuFreqHz = 5'000'000;
	SilentInputSource input;
	bmsx::Runtime runtime(
		bmsx::RuntimeOptions{
			{emptyRom.data(), 0u},
			bmsx::test::cartridgeSlots(),
			machineModel,
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

void writeSquareGeneratorRegisters(AudioHarness& harness) {
	harness.memory.writeMappedU32LE(bmsx::IO_APU_SOURCE_SAMPLE_RATE_HZ, bmsx::APU_SAMPLE_RATE_HZ / 4u);
	harness.memory.writeMappedU32LE(bmsx::IO_APU_SOURCE_CHANNELS, 1u);
	harness.memory.writeMappedU32LE(bmsx::IO_APU_SOURCE_FRAME_COUNT, 2u);
	harness.memory.writeMappedU32LE(bmsx::IO_APU_SOURCE_LOOP_END_SAMPLE, 2u);
	harness.memory.writeMappedU32LE(bmsx::IO_APU_GENERATOR_KIND, bmsx::APU_GENERATOR_SQUARE);
	harness.memory.writeMappedU32LE(bmsx::IO_APU_GENERATOR_DUTY_Q12, 0x0800u);
}

void programFilteredSquareVoice(AudioHarness& harness) {
	writeSquareGeneratorRegisters(harness);
	harness.memory.writeMappedU32LE(bmsx::IO_APU_RATE_STEP_Q16, bmsx::APU_RATE_STEP_Q16_ONE);
	harness.memory.writeMappedU32LE(bmsx::IO_APU_GAIN_Q12, bmsx::APU_GAIN_Q12_ONE);
	harness.memory.writeMappedU32LE(bmsx::IO_APU_FILTER_CONTROL, bmsx::APU_FILTER_CONTROL_ENABLE);
	harness.memory.writeMappedU32LE(bmsx::IO_APU_FILTER_B0_B1, 0x10002000u);
	harness.memory.writeMappedU32LE(bmsx::IO_APU_FILTER_B2_A1, 0xe000f000u);
	harness.memory.writeMappedU32LE(bmsx::IO_APU_FILTER_A2, 0x0800u);
	harness.memory.writeMappedU32LE(bmsx::IO_APU_SLOT, 1u);
	harness.memory.writeMappedU32LE(bmsx::IO_APU_CMD, bmsx::APU_CMD_PLAY);
	harness.audio.onService(0);
}

void testPauseResumeRetainsVoiceTransportAcrossRestore() {
	AudioHarness live;
	auto& liveMemory = live.memory;
	auto& liveAudio = live.audio;
	auto& liveScheduler = live.scheduler;
	writeSquareGeneratorRegisters(live);
	liveMemory.writeMappedU32LE(bmsx::IO_APU_RATE_STEP_Q16, bmsx::APU_RATE_STEP_Q16_ONE);
	liveMemory.writeMappedU32LE(bmsx::IO_APU_GAIN_Q12, bmsx::APU_GAIN_Q12_ONE);
	liveMemory.writeMappedU32LE(bmsx::IO_APU_SLOT, 1u);
	liveMemory.writeMappedU32LE(bmsx::IO_APU_CMD, bmsx::APU_CMD_PLAY);
	liveAudio.onService(0);
	liveScheduler.advanceTo(3);
	liveAudio.onService(3);
	const bmsx::i64 cursor = liveAudio.captureState().output.voices[0].cursorQ16;

	liveMemory.writeMappedU32LE(bmsx::IO_APU_SLOT, 1u);
	liveMemory.writeMappedU32LE(bmsx::IO_APU_CMD, bmsx::APU_CMD_PAUSE_SLOT);
	liveAudio.onService(3);
	const bmsx::AudioControllerState paused = liveAudio.captureState();
	require(paused.slotPhases[1] == (bmsx::APU_SLOT_PHASE_PLAYING | bmsx::APU_SLOT_PHASE_PAUSED),
		"PAUSE should retain the playing phase and latch the paused phase bit");
	require(paused.output.voices[0].cursorQ16 == cursor,
		"PAUSE should retain the exact voice cursor");
	require(liveMemory.readIoU32(bmsx::IO_APU_ACTIVE_MASK) == 2u,
		"a paused voice should remain resident in the active-slot mask");

	live.output.outputRing.clear();
	liveScheduler.advanceTo(11);
	liveAudio.onService(11);
	const bmsx::AudioControllerState saved = liveAudio.captureState();
	require(saved.output.voices[0].cursorQ16 == cursor,
		"the paused voice cursor must not advance with the APU sample clock");
	require(saved.sampleSequence == 11,
		"the APU sample clock should continue while a voice is paused");
	for (int frame = 0; frame < 8; frame += 1) {
		require(live.output.outputRing.readFramePacked() == 0u,
			"a paused resident voice should leave the DAC output silent");
	}

	AudioHarness restored;
	restored.scheduler.advanceTo(11);
	restored.audio.restoreState(saved, 11);
	liveScheduler.advanceTo(15);
	liveAudio.onService(15);
	restored.scheduler.advanceTo(15);
	restored.audio.onService(15);
	const bmsx::AudioControllerState livePaused = liveAudio.captureState();
	const bmsx::AudioControllerState restoredPaused = restored.audio.captureState();
	require(livePaused.output.voices[0].cursorQ16 == cursor
		&& restoredPaused.output.voices[0].cursorQ16 == cursor,
		"live and restored paused voices should retain the same cursor");
	require(restoredPaused.slotPhases == livePaused.slotPhases
		&& restoredPaused.sampleSequence == livePaused.sampleSequence,
		"save restore should retain paused slot and sample-clock state");

	liveMemory.writeMappedU32LE(bmsx::IO_APU_SLOT, 1u);
	liveMemory.writeMappedU32LE(bmsx::IO_APU_CMD, bmsx::APU_CMD_RESUME_SLOT);
	liveAudio.onService(15);
	restored.memory.writeMappedU32LE(bmsx::IO_APU_SLOT, 1u);
	restored.memory.writeMappedU32LE(bmsx::IO_APU_CMD, bmsx::APU_CMD_RESUME_SLOT);
	restored.audio.onService(15);
	liveScheduler.advanceTo(19);
	liveAudio.onService(19);
	restored.scheduler.advanceTo(19);
	restored.audio.onService(19);
	const bmsx::AudioControllerState resumed = liveAudio.captureState();
	const bmsx::AudioControllerState restoredResumed = restored.audio.captureState();
	require(resumed.slotPhases[1] == bmsx::APU_SLOT_PHASE_PLAYING,
		"RESUME should clear only the paused phase bit");
	require(resumed.output.voices[0].cursorQ16 == cursor + bmsx::APU_RATE_STEP_Q16_ONE,
		"RESUME should continue from the retained source cursor");
	require(restoredResumed.output.voices[0].cursorQ16 == resumed.output.voices[0].cursorQ16
		&& restoredResumed.sampleSequence == resumed.sampleSequence
		&& restoredResumed.slotPhases == resumed.slotPhases,
		"restored voice transport should remain exact after RESUME");
}

void programConstantSquareVoice(AudioHarness& harness, bmsx::ApuAudioSlot slot, bmsx::u32 gainQ12Word) {
	writeSquareGeneratorRegisters(harness);
	harness.memory.writeMappedU32LE(bmsx::IO_APU_RATE_STEP_Q16, 0u);
	harness.memory.writeMappedU32LE(bmsx::IO_APU_GAIN_Q12, gainQ12Word);
	harness.memory.writeMappedU32LE(bmsx::IO_APU_SLOT, slot);
	harness.memory.writeMappedU32LE(bmsx::IO_APU_CMD, bmsx::APU_CMD_PLAY);
	harness.audio.onService(0);
}

void testRawBiquadDatapath() {
	bmsx::BiquadFilterState filter;
	filter.configure(0xffff0001u, 0x10002000u, 0xe000f000u, 0xdead0800u);
	require(filter.enabled, "raw biquad control bit should enable the datapath");
	require(filter.b0 == 8192 && filter.b1 == 4096 && filter.b2 == -4096 && filter.a1 == -8192 && filter.a2 == 2048,
		"raw biquad coefficient halfwords should decode as signed Q14");
	filter.processStereo(16384, -16384);
	require(filter.outputLeft == 8192 && filter.outputRight == -8192, "raw biquad should produce the exact first Q14 output");
	require(filter.l1 == 134217728 && filter.l2 == -83886080 && filter.r1 == -134217728 && filter.r2 == 83886080,
		"raw biquad should retain exact transposed delay words");

	filter.configure(0u, 0x80008000u, 0x80008000u, 0xbeef8000u);
	require(!filter.enabled, "cleared control bit should bypass the datapath");
	require(filter.l1 == 134217728 && filter.l2 == -83886080 && filter.r1 == -134217728 && filter.r2 == 83886080,
		"raw coefficient writes should preserve delay words");
	filter.l1 = 0;
	filter.l2 = 0x7fffffff;
	filter.r1 = 0;
	filter.r2 = 0x7fffffff;
	filter.processStereo(-0x8000, -0x8000);
	require(filter.outputLeft == 0x7fff && filter.outputRight == 0x7fff, "raw biquad output should saturate to signed 16-bit");
	require(filter.l1 == 0x3fffffff && filter.l2 == -0x40000000 && filter.r1 == 0x3fffffff && filter.r2 == -0x40000000,
		"raw biquad delay writes should wrap to signed 32-bit");
	require(bmsx::interpolateApuPcmSample(0x7fff, -0x8000, 0u) == 0x7fff,
		"zero APU interpolation phase should retain the first sample");
	require(bmsx::interpolateApuPcmSample(0, -1, 1u) == -1,
		"negative APU interpolation should use arithmetic Q16 extraction");
	require(bmsx::interpolateApuPcmSample(-0x8000, 0x7fff, 0xffffu) == 0x7ffe,
		"positive APU interpolation should preserve the full signed sample range");
	require(bmsx::interpolateApuPcmSample(0x7fff, -0x8000, 0xffffu) == -0x8000,
		"negative APU interpolation should preserve the full signed sample range");
	require(bmsx::interpolateApuPcmSample(0x7fff, -0x8000, 0x8000u) == -1,
		"half-phase APU interpolation should use exact signed Q16 arithmetic");
}

void testFixedPointMixerVectors() {
	require(bmsx::APU_GAIN_Q12_FRACTION_BITS == 12u, "APU gain should retain twelve fractional bits");

	AudioHarness negative;
	programConstantSquareVoice(negative, 1u, 0xfffff000u);
	negative.scheduler.advanceTo(1);
	negative.audio.onService(1);
	require(negative.audio.captureState().output.voices[0].gainQ12 == -static_cast<bmsx::i32>(bmsx::APU_GAIN_Q12_ONE),
		"negative gain should remain a signed Q12 latch");
	require(negative.output.outputRing.readFramePacked() == 0x80018001u,
		"negative gain should invert the raw square sample");

	AudioHarness overrange;
	programConstantSquareVoice(overrange, 1u, 0x00002000u);
	overrange.scheduler.advanceTo(1);
	overrange.audio.onService(1);
	require(overrange.audio.captureState().output.voices[0].gainQ12 == 2 * static_cast<bmsx::i32>(bmsx::APU_GAIN_Q12_ONE),
		"overrange gain should remain in the signed Q12 latch");
	require(overrange.output.outputRing.readFramePacked() == 0x7fff7fffu,
		"overrange gain should saturate only at the DAC output");

	AudioHarness cancellation;
	programConstantSquareVoice(cancellation, 1u, 0x00002000u);
	programConstantSquareVoice(cancellation, 2u, 0xffffe000u);
	cancellation.scheduler.advanceTo(1);
	cancellation.audio.onService(1);
	require(cancellation.output.outputRing.readFramePacked() == 0u,
		"opposite overrange voices should cancel in the wide Q12 accumulator");

	AudioHarness saturatedMix;
	programConstantSquareVoice(saturatedMix, 1u, bmsx::APU_GAIN_Q12_ONE);
	programConstantSquareVoice(saturatedMix, 2u, bmsx::APU_GAIN_Q12_ONE);
	saturatedMix.scheduler.advanceTo(1);
	saturatedMix.audio.onService(1);
	require(saturatedMix.output.outputRing.readFramePacked() == 0x7fff7fffu,
		"the final sum of multiple voices should saturate to signed 16-bit");

	AudioHarness wrappedFadeSource;
	programConstantSquareVoice(wrappedFadeSource, 1u, bmsx::APU_GAIN_Q12_ONE);
	bmsx::AudioControllerState wrappedFadeState = wrappedFadeSource.audio.captureState();
	bmsx::ApuOutputVoiceState& wrappedFadeVoice = wrappedFadeState.output.voices[0];
	wrappedFadeVoice.gainQ12 = 0x7fffffff;
	wrappedFadeVoice.fadeStepQ12 = bmsx::toSignedWord(0x80000000u);
	wrappedFadeVoice.fadeStepRemainder = bmsx::toSignedWord(0x80000000u);
	wrappedFadeVoice.fadeError = 0xffffffffu;
	wrappedFadeVoice.fadeSamplesRemaining = 3u;
	wrappedFadeVoice.fadeSamplesTotal = 1u;
	AudioHarness wrappedFade;
	wrappedFade.audio.restoreState(wrappedFadeState, 0);
	wrappedFade.scheduler.advanceTo(2);
	wrappedFade.audio.onService(2);
	require(wrappedFade.output.outputRing.readFramePacked() == 0x7fff7fffu,
		"a full-range retained gain should saturate only at the DAC boundary");
	require(wrappedFade.output.outputRing.readFramePacked() == 0u,
		"the signed gain latch should wrap on each fade edge");
	const bmsx::AudioControllerState wrappedFadeResultState = wrappedFade.audio.captureState();
	const bmsx::ApuOutputVoiceState& wrappedFadeResult = wrappedFadeResultState.output.voices[0];
	require(wrappedFadeResult.gainQ12 == -0x7fffffff
		&& wrappedFadeResult.fadeError == 0xfffffffdu
		&& wrappedFadeResult.fadeSamplesRemaining == 1u,
		"non-canonical retained fade bits should follow the i32/u32 latch datapath");

	AudioHarness live;
	programConstantSquareVoice(live, 1u, 0xffffefffu);
	live.memory.writeMappedU32LE(bmsx::IO_APU_SLOT, 1u);
	live.memory.writeMappedU32LE(bmsx::IO_APU_FADE_SAMPLES, 4u);
	live.memory.writeMappedU32LE(bmsx::IO_APU_CMD, bmsx::APU_CMD_STOP_SLOT);
	live.audio.onService(0);
	live.scheduler.advanceTo(2);
	live.audio.onService(2);
	bmsx::ApuOutputRing& liveOutputRing = live.output.outputRing;
	require(liveOutputRing.readFramePacked() == 0x80008000u,
		"the first negative fade sample should saturate at the DAC boundary");
	require(liveOutputRing.readFramePacked() == 0xa000a000u,
		"negative fade interpolation should use the exact second Q12 level");
	const bmsx::AudioControllerState saved = live.audio.captureState();
	const bmsx::ApuOutputVoiceState& savedVoice = saved.output.voices[0];
	require(savedVoice.gainQ12 == -0x0800
		&& savedVoice.fadeStepQ12 == -0x0400
		&& savedVoice.fadeStepRemainder == -1
		&& savedVoice.fadeError == 1u
		&& savedVoice.fadeSamplesRemaining == 2u
		&& savedVoice.fadeSamplesTotal == 4u,
		"save-state should retain the exact signed Q12 fade datapath");
	liveOutputRing.clear();

	AudioHarness restored;
	restored.scheduler.advanceTo(2);
	restored.audio.restoreState(saved, 2);
	live.scheduler.advanceTo(4);
	live.audio.onService(4);
	restored.scheduler.advanceTo(4);
	restored.audio.onService(4);
	bmsx::ApuOutputRing& restoredOutputRing = restored.output.outputRing;
	for (const bmsx::u32 expected : {0xc000c000u, 0xe000e000u}) {
		require(liveOutputRing.readFramePacked() == expected,
			"the uninterrupted fade should emit the exact future Q12 sample");
		require(restoredOutputRing.readFramePacked() == expected,
			"the restored fade should emit the exact same future Q12 sample");
	}
	const bmsx::AudioControllerState liveEnd = live.audio.captureState();
	const bmsx::AudioControllerState restoredEnd = restored.audio.captureState();
	require(liveEnd.output.voices.empty() && restoredEnd.output.voices.empty(),
		"the live and restored fixed-point fade should end on the same DAC edge");
	require(liveEnd.sampleSequence == restoredEnd.sampleSequence,
		"the restored fixed-point fade should preserve sample continuity");
	require(liveEnd.eventSequence == restoredEnd.eventSequence,
		"the restored fixed-point fade should preserve sample and event continuity");
}

void testFilterAndFadeRestore() {
	AudioHarness live;
	programFilteredSquareVoice(live);
	live.scheduler.advanceTo(3);
	live.audio.onService(3);
	live.memory.writeMappedU32LE(bmsx::IO_APU_SLOT, 1u);
	const bmsx::ApuBiquadFilterState history = live.audio.captureState().output.voices[0].filter;
	live.memory.writeMappedU32LE(
		bmsx::IO_APU_SELECTED_SLOT_REG0 + bmsx::APU_PARAMETER_FILTER_B0_B1_INDEX * bmsx::IO_WORD_SIZE,
		0x10002000u
	);
	require(live.audio.captureState().output.voices[0].filter.l1 == history.l1,
		"live coefficient writes should preserve filter history");
	live.memory.writeMappedU32LE(
		bmsx::IO_APU_SELECTED_SLOT_REG0 + bmsx::APU_PARAMETER_SOURCE_SAMPLE_RATE_HZ_INDEX * bmsx::IO_WORD_SIZE,
		bmsx::APU_SAMPLE_RATE_HZ / 4u
	);
	require(live.audio.captureState().output.voices[0].filter.l1 == history.l1,
		"live source replacement should preserve filter history");
	live.memory.writeMappedU32LE(
		bmsx::IO_APU_SELECTED_SLOT_REG0 + bmsx::APU_PARAMETER_FILTER_CONTROL_INDEX * bmsx::IO_WORD_SIZE,
		0u
	);
	live.scheduler.advanceTo(4);
	live.audio.onService(4);
	const bmsx::ApuBiquadFilterState bypassed = live.audio.captureState().output.voices[0].filter;
	require(bypassed.l1 == history.l1 && bypassed.l2 == history.l2 && bypassed.r1 == history.r1 && bypassed.r2 == history.r2,
		"disabled filter should bypass samples without advancing delay words");
	live.memory.writeMappedU32LE(
		bmsx::IO_APU_SELECTED_SLOT_REG0 + bmsx::APU_PARAMETER_FILTER_CONTROL_INDEX * bmsx::IO_WORD_SIZE,
		bmsx::APU_FILTER_CONTROL_ENABLE
	);
	live.memory.writeMappedU32LE(bmsx::IO_APU_FADE_SAMPLES, 4u);
	live.memory.writeMappedU32LE(bmsx::IO_APU_CMD, bmsx::APU_CMD_STOP_SLOT);
	live.audio.onService(4);
	live.scheduler.advanceTo(6);
	live.audio.onService(6);
	const bmsx::AudioControllerState saved = live.audio.captureState();
	require(saved.output.voices[0].fadeSamplesRemaining == 2u, "STOP fade should retain its remaining hardware samples");
	require(saved.output.voices[0].filter.l1 != 0, "active filter history should be saved");
	live.output.outputRing.clear();

	AudioHarness restored;
	restored.scheduler.advanceTo(6);
	restored.audio.restoreState(saved, 6);
	live.scheduler.advanceTo(8);
	live.audio.onService(8);
	restored.scheduler.advanceTo(8);
	restored.audio.onService(8);
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
	splitRing.write(source.data(), source.size() / 2u, 0);
	batchRing.write(source.data(), source.size() / 2u, 0);
	bmsx::AudioOutputResampler split;
	bmsx::AudioOutputResampler batch;
	std::array<bmsx::i16, 34> splitFirst{};
	std::array<bmsx::i16, 86> splitSecond{};
	std::array<bmsx::i16, 120> batched{};
	require(split.pull(splitRing, splitFirst.data(), splitFirst.size() / 2u, 48000) == splitFirst.size() / 2u, "first resampler chunk should be produced immediately");
	require(split.pull(splitRing, splitSecond.data(), splitSecond.size() / 2u, 48000) == splitSecond.size() / 2u, "second resampler chunk should be complete");
	require(batch.pull(batchRing, batched.data(), batched.size() / 2u, 48000) == batched.size() / 2u, "batched resampler pull should be complete");
	for (size_t index = 0u; index < splitFirst.size(); index += 1u) {
		require(splitFirst[index] == batched[index], "resampler chunks should retain the same interpolation phase");
	}
	for (size_t index = 0u; index < splitSecond.size(); index += 1u) {
		require(splitSecond[index] == batched[splitFirst.size() + index], "resampler chunks should match one batched pull");
	}

	constexpr size_t sourceFramesPerPalFrame = static_cast<size_t>(bmsx::APU_SAMPLE_RATE_HZ / 50);
	constexpr size_t outputFramesPerPalFrame = 48000u / 50u;
	std::array<bmsx::i16, sourceFramesPerPalFrame * 4u> palSource{};
	for (size_t frame = 0u; frame < palSource.size() / 2u; frame += 1u) {
		palSource[frame * 2u] = static_cast<bmsx::i16>(static_cast<int>(frame) * 13 - 12000);
		palSource[frame * 2u + 1u] = static_cast<bmsx::i16>(12000 - static_cast<int>(frame) * 7);
	}
	bmsx::ApuOutputRing referenceRing;
	referenceRing.write(palSource.data(), palSource.size() / 2u, 0);
	bmsx::AudioOutputResampler reference;
	std::array<bmsx::i16, (outputFramesPerPalFrame - 1u) * 2u> referenceFirst{};
	std::array<bmsx::i16, outputFramesPerPalFrame * 2u> referenceSecond{};
	require(reference.pull(referenceRing, referenceFirst.data(), referenceFirst.size() / 2u, 48000) == referenceFirst.size() / 2u, "reference PAL prefix should be complete");
	require(reference.pull(referenceRing, referenceSecond.data(), referenceSecond.size() / 2u, 48000) == referenceSecond.size() / 2u, "reference second PAL frame should be complete");

	bmsx::ApuOutputRing starvedRing;
	starvedRing.write(palSource.data(), sourceFramesPerPalFrame, 0);
	bmsx::AudioOutputResampler starved;
	std::array<bmsx::i16, outputFramesPerPalFrame * 2u> starvedFirst{};
	starvedFirst.fill(12345);
	const size_t producedFirst = starved.pull(starvedRing, starvedFirst.data(), starvedFirst.size() / 2u, 48000);
	require(producedFirst == outputFramesPerPalFrame - 1u, "one PAL hardware frame should publish only its interpolable host frames");
	for (size_t index = 0u; index < referenceFirst.size(); index += 1u) {
		require(starvedFirst[index] == referenceFirst[index], "starved PAL output should match the uninterrupted prefix");
	}
	require(starvedFirst[producedFirst * 2u] == 12345 && starvedFirst[producedFirst * 2u + 1u] == 12345, "resampler must not write unpublished silence");

	starvedRing.write(palSource.data() + sourceFramesPerPalFrame * 2u, sourceFramesPerPalFrame, static_cast<bmsx::i64>(sourceFramesPerPalFrame));
	std::array<bmsx::i16, outputFramesPerPalFrame * 2u> recoveredSecond{};
	require(starved.pull(starvedRing, recoveredSecond.data(), recoveredSecond.size() / 2u, 48000) == recoveredSecond.size() / 2u, "resampler should resume with a complete second PAL frame");
	require(recoveredSecond == referenceSecond, "resampler should preserve interpolation phase across source starvation");
}

void testResamplerDropsOverwrittenInterpolationEndpoints() {
	bmsx::ApuOutputRing ring;
	const std::array<bmsx::i16, 6> initial{{100, 100, 200, 200, 300, 300}};
	ring.write(initial.data(), initial.size() / 2u, 0);
	bmsx::AudioOutputResampler resampler;
	std::array<bmsx::i16, 4> first{};
	require(resampler.pull(ring, first.data(), 2u, 48000) == 2u, "initial output frames should be available");
	require(first[0] == 100 && first[1] == 100 && first[2] == 192 && first[3] == 192, "initial output should establish a non-zero fractional source phase");

	std::array<bmsx::i16, bmsx::APU_OUTPUT_RING_CAPACITY_SAMPLES> retained{};
	retained[0] = 1000;
	retained[1] = 1000;
	for (size_t frame = 1u; frame < bmsx::APU_OUTPUT_RING_CAPACITY_FRAMES; frame += 1u) {
		retained[frame * 2u] = 2000;
		retained[frame * 2u + 1u] = 2000;
	}
	ring.write(retained.data(), bmsx::APU_OUTPUT_RING_CAPACITY_FRAMES, 3);
	std::array<bmsx::i16, 2> afterOverwrite{};
	require(resampler.pull(ring, afterOverwrite.data(), 1u, 48000) == 1u, "retained output frame should be available after overwrite");
	require(afterOverwrite[0] == 1838 && afterOverwrite[1] == 1838, "resampler must discard stale endpoints while retaining only fractional output phase");
}

void testOutputPresentationReachesPalHostAfterOneIdleSecond() {
	constexpr bmsx::i64 cpuHz = 33'868'800;
	constexpr bmsx::i32 hostSampleRate = 48000;
	constexpr size_t hostFramesPerPalFrame = 960u;
	AudioMachineHarness harness(cpuHz);
	const bmsx::i64 primeCycle = bmsx::cyclesUntilBudgetUnits(cpuHz, bmsx::APU_SAMPLE_RATE_HZ, 0, 2);
	harness.machine.scheduler.advanceTo(primeCycle);
	harness.machine.audioController.onService(primeCycle);
	bmsx::AudioOutputResampler hostOutput;
	std::array<bmsx::i16, 2> primedOutput{};
	require(hostOutput.pull(harness.machine.audioOutput.outputRing, primedOutput.data(), 1u, hostSampleRate) == 1u, "host resampler should prime from the initial silent DAC window");
	require(primedOutput[0] == 0 && primedOutput[1] == 0, "initial DAC window should be silent");

	const bmsx::i64 playCycle = primeCycle + cpuHz;
	harness.machine.scheduler.advanceTo(playCycle);
	harness.machine.audioController.onService(playCycle);
	require(harness.machine.audioController.captureState().sampleSequence == bmsx::APU_SAMPLE_RATE_HZ + 2, "33.8688 MHz APU clock should produce exactly one idle second after resampler priming");
	require(harness.machine.audioOutput.outputRing.queuedFrames() == bmsx::APU_OUTPUT_RING_CAPACITY_FRAMES, "presentation history should remain bounded during idle output");

	harness.memory.writeMappedU32LE(bmsx::IO_APU_SOURCE_SAMPLE_RATE_HZ, bmsx::APU_SAMPLE_RATE_HZ / 4u);
	harness.memory.writeMappedU32LE(bmsx::IO_APU_SOURCE_CHANNELS, 1u);
	harness.memory.writeMappedU32LE(bmsx::IO_APU_SOURCE_FRAME_COUNT, 2u);
	harness.memory.writeMappedU32LE(bmsx::IO_APU_SOURCE_LOOP_END_SAMPLE, 2u);
	harness.memory.writeMappedU32LE(bmsx::IO_APU_RATE_STEP_Q16, bmsx::APU_RATE_STEP_Q16_ONE);
	harness.memory.writeMappedU32LE(bmsx::IO_APU_GAIN_Q12, bmsx::APU_GAIN_Q12_ONE);
	harness.memory.writeMappedU32LE(bmsx::IO_APU_GENERATOR_KIND, bmsx::APU_GENERATOR_SQUARE);
	harness.memory.writeMappedU32LE(bmsx::IO_APU_GENERATOR_DUTY_Q12, 0x0800u);
	harness.memory.writeMappedU32LE(bmsx::IO_APU_SLOT, 1u);
	harness.memory.writeMappedU32LE(bmsx::IO_APU_CMD, bmsx::APU_CMD_PLAY);
	harness.machine.audioController.onService(playCycle);
	const bmsx::i64 carry = harness.machine.audioController.captureState().sampleCarry;
	const bmsx::i64 firstAudioCycle = playCycle + bmsx::cyclesUntilBudgetUnits(cpuHz, bmsx::APU_SAMPLE_RATE_HZ, carry, 2);
	harness.machine.scheduler.advanceTo(firstAudioCycle);
	harness.machine.audioController.onService(firstAudioCycle);

	std::array<bmsx::i16, hostFramesPerPalFrame * 2u> output{};
	constexpr size_t historyAtHostRate = (bmsx::APU_OUTPUT_RING_CAPACITY_FRAMES * static_cast<size_t>(hostSampleRate)
		+ static_cast<size_t>(bmsx::APU_SAMPLE_RATE_HZ) - 1u) / static_cast<size_t>(bmsx::APU_SAMPLE_RATE_HZ);
	constexpr size_t publicationBound = historyAtHostRate + hostFramesPerPalFrame;
	size_t publishedFrames = 0u;
	size_t firstAudibleFrame = publicationBound;
	while (publishedFrames < publicationBound && firstAudibleFrame == publicationBound) {
		const size_t produced = hostOutput.pull(harness.machine.audioOutput.outputRing, output.data(), hostFramesPerPalFrame, hostSampleRate);
		require(produced != 0u, "host drain should keep making progress through retained presentation");
		for (size_t frame = 0u; frame < produced; frame += 1u) {
			if (output[frame * 2u] != 0 || output[frame * 2u + 1u] != 0) {
				firstAudibleFrame = publishedFrames + frame;
				break;
			}
		}
		publishedFrames += produced;
	}
	require(firstAudibleFrame < publicationBound, "post-command audio should reach the host within AOUT history plus one publication quantum");
}

} // namespace

int main() {
	testOutputRingExposesUnsignedHardwareWords();
	testMachineCaptureIncludesMaterializedApuEndIrq();
	testHostSynchronizationExposesEveryElapsedPalSample();
	testBadpInterpolationWindowAndRestore();
	testSampleTransferEdgeOrdering();
	testApuVoiceLatchesCartridgeSocketAcrossRestore();
	testSampleBusDmaAndMidTransferRestore();
	testSampleTransferWrongDirectionBlock();
	testRuntimeClockResetAndRestorePreserveApuTimebase();
	testRawBiquadDatapath();
	testPauseResumeRetainsVoiceTransportAcrossRestore();
	testFixedPointMixerVectors();
	testFilterAndFadeRestore();
	testResamplerChunkContinuityAndUnderrun();
	testResamplerDropsOverwrittenInterpolationEndpoints();
	testOutputPresentationReachesPalHostAfterOneIdleSecond();
	return 0;
}
