#include "machine/machine.h"

#include "audio/soundmaster.h"
#include "input/manager.h"
#include "rompack/format.h"

#include <stdexcept>

namespace bmsx {
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

VDP* Machine::runDeviceService(uint8_t deviceKind) {
	const i64 nowCycles = scheduler.nowCycles();
	switch (deviceKind) {
		case DeviceServiceGeo:
			geometryController.onService(nowCycles);
			return nullptr;
		case DeviceServiceDma:
			dmaController.onService(nowCycles);
			return nullptr;
		case DeviceServiceImg:
			imgDecController.onService(nowCycles);
			return nullptr;
		case DeviceServiceVdp:
			vdp.onService(nowCycles);
			return &vdp;
		default:
			throw BMSX_RUNTIME_ERROR("unknown device service kind " + std::to_string(deviceKind) + ".");
	}
}

MachineState Machine::captureState() const {
	MachineState state;
	state.memory = memory.captureState();
	state.input = inputController.captureState();
	state.vdp = vdp.captureState();
	return state;
}

void Machine::restoreState(const MachineState& state) {
	memory.restoreState(state.memory);
	geometryController.postLoad();
	irqController.postLoad();
	inputController.restoreState(state.input);
	vdp.restoreState(state.vdp);
}

MachineSaveState Machine::captureSaveState() const {
	MachineSaveState state;
	state.memory = memory.captureSaveState();
	state.stringPool = cpu.stringPool().captureState();
	state.input = inputController.captureState();
	state.vdp = vdp.captureSaveState();
	return state;
}

void Machine::restoreSaveState(const MachineSaveState& state) {
	memory.restoreSaveState(state.memory);
	cpu.stringPool().restoreState(state.stringPool);
	geometryController.postLoad();
	irqController.postLoad();
	inputController.restoreState(state.input);
	vdp.restoreSaveState(state.vdp);
}

} // namespace bmsx
