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
#include "machine/devices/system/controller.h"
#include "machine/memory/memory.h"
#include "machine/scheduler/device.h"

namespace bmsx {

class InputControllerInputSource;

struct MachineTiming {
	i64 cpuHz;
	i64 dmaWordsPerSec;
	i64 dmaRamRowReopenCycles;
	i64 dmaRomWaitCyclesPerWord;
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
	DmaController dmaController;
	AudioController audioController;
	GeometryController geometryController;
	GxGpu gxGpu;
	GxGte gxGte;
	SystemController systemController;
	InputController inputController;

	void initializeSystemIo();
	void resetDevices();
	void refreshDeviceTimings(const MachineTiming& timing, i64 nowCycles);
	void advanceDevices(int cycles);
	u32 runDeviceService(uint8_t deviceKind);
};

} // namespace bmsx
