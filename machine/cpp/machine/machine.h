#pragma once

#include "machine/bus/io.h"
#include "machine/cpu/cpu.h"
#include "machine/devices/audio/controller.h"
#include "machine/devices/dma/controller.h"
#include "machine/devices/geometry/controller.h"
#include "machine/devices/gx/gpu.h"
#include "machine/devices/gx/gte.h"
#include "machine/devices/input/controller.h"
#include "machine/devices/irq/controller.h"
#include "machine/memory/memory.h"
#include "machine/scheduler/device.h"

namespace bmsx {

class InputControllerInputSource;

struct MachineTiming {
	i64 cpuHz;
	i64 dmaWordsPerSec;
	int geoWorkUnitsPerSec;
};

class Machine {
public:
	Machine(Memory& memoryRef, InputControllerInputSource& input);

	Memory& memory;
	IrqController irqController;
	CPU cpu;
	DeviceScheduler scheduler;
	ApuOutputMixer audioOutput;
	AudioController audioController;
	DmaController dmaController;
	GeometryController geometryController;
	GxGpu gxGpu;
	GxGte gxGte;
	InputController inputController;

	void initializeSystemIo();
	void resetDevices();
	void refreshDeviceTimings(const MachineTiming& timing, i64 nowCycles);
	void advanceDevices(int cycles);
	void runDeviceService(uint8_t deviceKind);
};

} // namespace bmsx
