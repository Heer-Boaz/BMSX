#pragma once

#include "spec/bmsx/io.h"
#include "machine/cpu/cpu.h"
#include "machine/execution_address_space.h"
#include "machine/devices/audio/controller.h"
#include "machine/devices/cartridge/controller.h"
#include "machine/devices/dma/controller.h"
#include "machine/devices/geometry/controller.h"
#include "machine/devices/gx/gpu.h"
#include "machine/devices/gx/gte.h"
#include "machine/devices/input/controller.h"
#include "machine/devices/imgdec/controller.h"
#include "machine/devices/irq/controller.h"
#include "machine/devices/system/controller.h"
#include "machine/memory/memory.h"
#include "machine/scheduler/device.h"

namespace bmsx {

class InputControllerInputSource;

struct MachineTiming {
	i64 cpuHz;
	int geoWorkUnitsPerSec;
};

class Machine {
public:
	Machine(Memory& memoryRef, InputControllerInputSource& input);

	Memory& memory;
	CartridgeController& cartridgeController;
	IrqController irqController;
	ExecutionAddressSpace executionAddressSpace;
	CPU cpu;
	DeviceScheduler scheduler;
	ApuOutputMixer audioOutput;
	DmaController dmaController;
	AudioController audioController;
	GeometryController geometryController;
	GxGpu gxGpu;
	ImgDecController imgDecController;
	GxGte gxGte;
	SystemController systemController;
	InputController inputController;

	void resetDevices();
	void refreshDeviceTimings(const MachineTiming& timing, i64 nowCycles);
	void advanceDevices(int cycles);
	u32 runDeviceService(uint8_t deviceKind);
};

} // namespace bmsx
