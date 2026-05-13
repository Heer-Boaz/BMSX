#include "machine/machine.h"

#include "audio/soundmaster.h"
#include "input/manager.h"
#include "rompack/format.h"

#include <stdexcept>

namespace bmsx {
namespace {

void restoreSharedDeviceState(
	Machine& machine,
	const GeometryControllerState& geometry,
	const IrqControllerState& irq,
	const AudioControllerState& audio,
	const InputControllerState& input
) {
	machine.geometryController.restoreState(geometry, machine.scheduler.nowCycles());
	machine.irqController.restoreState(irq);
	machine.audioController.restoreState(audio);
	machine.inputController.restoreState(input);
}

} // namespace

Machine::Machine(Memory& memoryRef, VdpFrameBufferSize frameBufferSizeValue, Input& input, SoundMaster& soundMaster, MicrotaskQueue& microtasks)
	: memory(memoryRef)
	, frameBufferSize(frameBufferSizeValue)
	, cpu(memory)
	, scheduler(cpu)
	, irqController(memory)
	, vdp(memory, scheduler, frameBufferSize)
	, audioController(memory, soundMaster, irqController)
	, dmaController(memory, irqController, vdp, scheduler)
	, imgDecController(memory, dmaController, vdp, irqController, scheduler, microtasks)
	, geometryController(memory, irqController, scheduler)
	, inputController(memory, input, cpu.stringPool())
{
	vdp.attachImgDecController(imgDecController);
}

void Machine::initializeSystemIo() {
	memory.clearBusFault();
	memory.writeValue(IO_SYS_BOOT_CART, valueNumber(0.0));
	memory.writeValue(IO_SYS_HOST_FAULT_FLAGS, valueNumber(0.0));
	memory.writeValue(IO_SYS_HOST_FAULT_STAGE, valueNumber(static_cast<double>(HOST_FAULT_STAGE_NONE)));
}

void Machine::resetDevices() {
	irqController.reset();
	inputController.reset();
	dmaController.reset();
	geometryController.reset();
	imgDecController.reset();
	audioController.reset();
	vdp.initializeRegisters();
}

void Machine::refreshDeviceTimings(const MachineTiming& timing, i64 nowCycles) {
	dmaController.setTiming(timing.cpuHz, timing.dmaBytesPerSecIso, timing.dmaBytesPerSecBulk, nowCycles);
	imgDecController.setTiming(timing.cpuHz, timing.imgDecBytesPerSec, nowCycles);
	geometryController.setTiming(timing.cpuHz, timing.geoWorkUnitsPerSec, nowCycles);
	vdp.setTiming(timing.cpuHz, timing.vdpWorkUnitsPerSec, nowCycles);
}

void Machine::advanceDevices(int cycles) {
	const i64 nextNow = scheduler.nowCycles() + cycles;
	dmaController.accrueCycles(cycles, nextNow);
	imgDecController.accrueCycles(cycles, nextNow);
	geometryController.accrueCycles(cycles, nextNow);
	vdp.accrueCycles(cycles, nextNow);
	scheduler.advanceTo(nextNow);
}

void Machine::runDeviceService(uint8_t deviceKind) {
	const i64 nowCycles = scheduler.nowCycles();
	switch (deviceKind) {
		case DeviceServiceGeo:
			geometryController.onService(nowCycles);
			return;
		case DeviceServiceDma:
			dmaController.onService(nowCycles);
			return;
		case DeviceServiceImg:
			imgDecController.onService(nowCycles);
			return;
		case DeviceServiceVdp:
			vdp.onService(nowCycles);
			return;
		default:
			throw BMSX_RUNTIME_ERROR("unknown device service kind " + std::to_string(deviceKind) + ".");
	}
}

MachineState Machine::captureState() const {
	MachineState state;
	state.geometry = geometryController.captureState();
	state.irq = irqController.captureState();
	state.audio = audioController.captureState();
	state.input = inputController.captureState();
	state.vdp = vdp.captureState();
	return state;
}

void Machine::restoreState(const MachineState& state) {
	restoreSharedDeviceState(*this, state.geometry, state.irq, state.audio, state.input);
	vdp.restoreState(state.vdp);
}

MachineSaveState Machine::captureSaveState() const {
	MachineSaveState state;
	state.memory = memory.captureSaveState();
	state.geometry = geometryController.captureState();
	state.irq = irqController.captureState();
	state.audio = audioController.captureState();
	state.stringPool = cpu.stringPool().captureState();
	state.input = inputController.captureState();
	state.vdp = vdp.captureSaveState();
	return state;
}

void Machine::restoreSaveState(const MachineSaveState& state) {
	memory.restoreSaveState(state.memory);
	cpu.stringPool().restoreState(state.stringPool);
	restoreSharedDeviceState(*this, state.geometry, state.irq, state.audio, state.input);
	vdp.restoreSaveState(state.vdp);
}

} // namespace bmsx
