#include "machine/machine.h"

#include "rompack/format.h"

#include <stdexcept>

namespace bmsx {
Machine::Machine(Memory& memoryRef, VdpFrameBufferSize frameBufferSizeValue, InputControllerInputSource& input, MicrotaskQueue& microtasks)
	: memory(memoryRef)
	, frameBufferSize(frameBufferSizeValue)
	, cpu(memory)
	, scheduler(cpu)
	, irqController(memory)
	, vdp(memory, scheduler, frameBufferSize)
	, audioOutput()
	, audioController(memory, audioOutput, irqController, scheduler)
	, dmaController(memory, irqController, vdp, scheduler)
	, imgDecController(memory, dmaController, vdp, irqController, scheduler, microtasks)
	, geometryController(memory, irqController, scheduler)
	, gxGpu(memory)
	, gxGte(memory)
	, inputController(memory, input)
{
}

void Machine::initializeSystemIo() {
	memory.clearBusFault();
	memory.writeValue(IO_SYS_HOST_FAULT_FLAGS, valueNumber(0.0));
	memory.writeValue(IO_SYS_HOST_FAULT_STAGE, valueNumber(static_cast<double>(HOST_FAULT_STAGE_NONE)));
}

void Machine::resetDevices() {
	irqController.reset();
	inputController.reset();
	dmaController.reset();
	geometryController.reset();
	gxGpu.reset();
	gxGte.reset();
	imgDecController.reset();
	audioController.reset();
	vdp.initializeVramSurfaces();
	vdp.initializeRegisters();
}

void Machine::refreshDeviceTimings(const MachineTiming& timing, i64 nowCycles) {
	dmaController.setTiming(timing.cpuHz, timing.dmaBytesPerSecIso, timing.dmaBytesPerSecBulk, nowCycles);
	imgDecController.setTiming(timing.cpuHz, timing.imgDecBytesPerSec, nowCycles);
	geometryController.setTiming(timing.cpuHz, timing.geoWorkUnitsPerSec, nowCycles);
	audioController.setTiming(timing.cpuHz, nowCycles);
	vdp.setTiming(timing.cpuHz, timing.vdpWorkUnitsPerSec, nowCycles);
}

void Machine::advanceDevices(int cycles) {
	const i64 nextNow = scheduler.nowCycles() + cycles;
	dmaController.accrueCycles(cycles, nextNow);
	imgDecController.accrueCycles(cycles, nextNow);
	geometryController.accrueCycles(cycles, nextNow);
	audioController.accrueCycles(cycles, nextNow);
	vdp.accrueCycles(cycles, nextNow);
	scheduler.advanceTo(nextNow);
}

void Machine::runDeviceService(uint8_t deviceKind) {
	const i64 nowCycles = scheduler.nowCycles();
	switch (deviceKind) {
		case DEVICE_SERVICE_GEO:
			geometryController.onService(nowCycles);
			return;
		case DEVICE_SERVICE_DMA:
			dmaController.onService(nowCycles);
			return;
		case DEVICE_SERVICE_IMG:
			imgDecController.onService(nowCycles);
			return;
		case DEVICE_SERVICE_APU:
			audioController.onService(nowCycles);
			return;
		case DEVICE_SERVICE_VDP:
			vdp.onService(nowCycles);
			return;
		default:
			throw BMSX_RUNTIME_ERROR("unknown device service kind " + std::to_string(deviceKind) + ".");
	}
}


} // namespace bmsx
