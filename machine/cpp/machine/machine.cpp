#include "machine/machine.h"

#include "rompack/format.h"

#include <stdexcept>

namespace bmsx {
Machine::Machine(Memory& memoryRef, InputControllerInputSource& input)
	: memory(memoryRef)
	, irqController(memory)
	, cpu(memory, irqController)
	, scheduler(cpu)
	, audioOutput()
	, dmaController(memory, cpu, irqController, scheduler)
	, audioController(memory, audioOutput, dmaController, irqController, scheduler)
	, geometryController(memory, irqController, scheduler)
	, gxGpu(memory, irqController, scheduler, dmaController)
	, gxGte(memory, cpu, scheduler)
	, systemController(memory, cpu, scheduler, irqController, dmaController, geometryController, gxGpu)
	, inputController(memory, input, systemController)
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
	audioController.reset();
	systemController.reset();
}

void Machine::refreshDeviceTimings(const MachineTiming& timing, i64 nowCycles) {
	dmaController.setTiming(timing.cpuHz, timing.dmaWordsPerSec, timing.dmaRamRowReopenCycles, timing.dmaRomWaitCyclesPerWord, nowCycles);
	geometryController.setTiming(timing.cpuHz, timing.geoWorkUnitsPerSec, nowCycles);
	audioController.setTiming(timing.cpuHz, nowCycles);
	gxGpu.setTiming(timing.cpuHz, nowCycles);
}

void Machine::advanceDevices(int cycles) {
	const i64 nextNow = scheduler.nowCycles() + cycles;
	geometryController.accrueCycles(cycles, nextNow);
	scheduler.advanceTo(nextNow);
}

u32 Machine::runDeviceService(uint8_t deviceKind) {
	const i64 nowCycles = scheduler.nowCycles();
	switch (deviceKind) {
		case DEVICE_SERVICE_GEO:
		geometryController.onService(nowCycles);
			return 0u;
		case DEVICE_SERVICE_DMA:
			dmaController.onService(nowCycles);
			return 0u;
		case DEVICE_SERVICE_APU:
			audioController.onService(nowCycles);
			return 0u;
		case DEVICE_SERVICE_APU_TRANSFER:
			audioController.onTransferService(nowCycles);
			return 0u;
		case DEVICE_SERVICE_GPU:
			return gxGpu.onService(nowCycles);
		case DEVICE_SERVICE_GTE:
			gxGte.onService();
			return 0u;
		case DEVICE_SERVICE_SYSTEM:
			systemController.onService();
			return 0u;
		default:
			throw BMSX_RUNTIME_ERROR("unknown device service kind " + std::to_string(deviceKind) + ".");
	}
}


} // namespace bmsx
