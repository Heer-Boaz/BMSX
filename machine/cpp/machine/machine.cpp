#include "machine/machine.h"

#include "machine/model_registry.h"
#include "rompack/format.h"

#include <stdexcept>

namespace bmsx {
Machine::Machine(Memory& memoryRef, InputControllerInputSource& input)
	: memory(memoryRef)
	, cartridgeController(memoryRef.cartridgeController())
	, irqController(memory)
	, executionAddressSpace(memory)
	, cpu(memory, irqController, executionAddressSpace)
	, scheduler(cpu)
	, audioOutput()
	, dmaController(memory, cpu, irqController, scheduler)
	, audioController(memory, audioOutput, dmaController, irqController, scheduler)
	, geometryController(memory, irqController, scheduler)
	, gxGpu(memory, cpu, irqController, scheduler, dmaController)
	, imgDecController(memory, cpu, irqController, scheduler, dmaController, PSX_MACHINE_SPEC.imgDecCyclesPerOutputWord)
	, gxGte(memory, cpu, scheduler)
	, systemController(memory, cpu, scheduler, irqController, dmaController, geometryController, gxGpu, imgDecController)
	, inputController(memory, input, systemController)
{
	cartridgeController.connect(memory, irqController, dmaController);
	dmaController.setTiming(
		PSX_MACHINE_SPEC.dmaRamCyclesPerWord,
		PSX_MACHINE_SPEC.dmaRamBurstSetupCycles,
		PSX_MACHINE_SPEC.dmaSystemRomCyclesPerWord,
		PSX_MACHINE_SPEC.dmaCartRomCyclesPerWord,
		PSX_MACHINE_SPEC.dmaCartRomBurstSetupCycles,
		scheduler.currentNowCycles()
	);
}

void Machine::resetDevices() {
	irqController.reset();
	inputController.reset();
	dmaController.reset();
	cartridgeController.reset();
	geometryController.reset();
	gxGpu.reset();
	imgDecController.reset();
	gxGte.reset();
	audioController.reset();
	systemController.reset();
}

void Machine::refreshDeviceTimings(const MachineTiming& timing, i64 nowCycles) {
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
		case DEVICE_SERVICE_IMGDEC:
			imgDecController.onService(nowCycles);
			return 0u;
		case DEVICE_SERVICE_SYSTEM:
			systemController.onService();
			return 0u;
		default:
			throw BMSX_RUNTIME_ERROR("unknown device service kind " + std::to_string(deviceKind) + ".");
	}
}


} // namespace bmsx
