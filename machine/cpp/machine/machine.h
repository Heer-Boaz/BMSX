#pragma once

#include "machine/bus/io.h"
#include "machine/cpu/cpu.h"
#include "machine/devices/audio/controller.h"
#include "machine/devices/dma/controller.h"
#include "machine/devices/geometry/controller.h"
#include "machine/devices/imgdec/controller.h"
#include "machine/devices/input/controller.h"
#include "machine/devices/irq/controller.h"
#include "machine/devices/vdp/vdp.h"
#include "machine/memory/memory.h"
#include "machine/scheduler/device.h"

namespace bmsx {

class MicrotaskQueue;
class Input;

struct MachineTiming {
	i64 cpuHz = 0;
	i64 dmaBytesPerSecIso = 0;
	i64 dmaBytesPerSecBulk = 0;
	i64 imgDecBytesPerSec = 0;
	int geoWorkUnitsPerSec = 0;
	int vdpWorkUnitsPerSec = 0;
};

class Machine {
public:
	Machine(Memory& memoryRef, VdpFrameBufferSize frameBufferSizeValue, Input& input, MicrotaskQueue& microtasks);

	Memory& memory;
	VdpFrameBufferSize frameBufferSize;
	CPU cpu;
	DeviceScheduler scheduler;
	IrqController irqController;
	VDP vdp;
	ApuOutputMixer audioOutput;
	AudioController audioController;
	DmaController dmaController;
	ImgDecController imgDecController;
	GeometryController geometryController;
	InputController inputController;

	void initializeSystemIo();
	void resetDevices();
	void refreshDeviceTimings(const MachineTiming& timing, i64 nowCycles);
	void advanceDevices(int cycles);
	void runDeviceService(uint8_t deviceKind);
};

} // namespace bmsx
