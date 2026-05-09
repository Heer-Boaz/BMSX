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
class SoundMaster;
class Input;

struct MachineTiming {
	i64 cpuHz = 0;
	i64 dmaBytesPerSecIso = 0;
	i64 dmaBytesPerSecBulk = 0;
	i64 imgDecBytesPerSec = 0;
	int geoWorkUnitsPerSec = 0;
	int vdpWorkUnitsPerSec = 0;
};

struct MachineState {
	IrqControllerState irq;
	InputControllerState input;
	VdpState vdp;
};

struct MachineSaveState {
	MemorySaveState memory;
	IrqControllerState irq;
	StringPoolState stringPool;
	InputControllerState input;
	VdpSaveState vdp;
};

class Machine {
public:
	Machine(Memory& memoryRef, VdpFrameBufferSize frameBufferSizeValue, Input& input, SoundMaster& soundMaster, MicrotaskQueue& microtasks);

	Memory& memory;
	VdpFrameBufferSize frameBufferSize;
	CPU cpu;
	DeviceScheduler scheduler;
	IrqController irqController;
	VDP vdp;
	AudioController audioController;
	DmaController dmaController;
	ImgDecController imgDecController;
	GeometryController geometryController;
	InputController inputController;

	void initializeSystemIo();
	void resetDevices();
	void refreshDeviceTimings(const MachineTiming& timing, i64 nowCycles);
	void advanceDevices(int cycles);
	VDP* runDeviceService(uint8_t deviceKind);
	MachineState captureState() const;
	void restoreState(const MachineState& state);
	MachineSaveState captureSaveState() const;
	void restoreSaveState(const MachineSaveState& state);
};

} // namespace bmsx
