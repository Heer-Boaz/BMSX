#pragma once

#include "machine/cpu/string_pool.h"
#include "machine/devices/audio/save_state.h"
#include "machine/devices/cartridge/contracts.h"
#include "machine/devices/dma/controller.h"
#include "machine/devices/geometry/save_state.h"
#include "machine/devices/gx/gpu.h"
#include "machine/devices/gx/gte.h"
#include "machine/devices/input/save_state.h"
#include "machine/devices/imgdec/controller.h"
#include "machine/devices/irq/save_state.h"
#include "machine/devices/system/controller.h"
#include "machine/devices/system/debug_transmit.h"
#include "machine/memory/memory.h"

namespace bmsx {

class Machine;

struct MachineState {
	CartridgeControllerState cartridge;
	DmaControllerState dma;
	GeometryControllerState geometry;
	GxGpuState gxGpu;
	GxGteState gxGte;
	IrqControllerState irq;
	AudioControllerState audio;
	InputControllerState input;
	ImgDecControllerState imgDec;
	SystemDebugTransmitState systemDebugTransmit;
	SystemControllerState systemControl;
};

struct MachineSaveState {
	MemorySaveState memory;
	CartridgeControllerState cartridge;
	DmaControllerState dma;
	GeometryControllerState geometry;
	GxGpuSaveState gxGpu;
	GxGteState gxGte;
	IrqControllerState irq;
	AudioControllerState audio;
	StringPoolState stringPool;
	InputControllerState input;
	ImgDecControllerState imgDec;
	SystemDebugTransmitState systemDebugTransmit;
	SystemControllerState systemControl;
};

MachineState captureMachineState(Machine& machine);
void restoreMachineState(Machine& machine, const MachineState& state);
MachineSaveState captureMachineSaveState(Machine& machine, MachineSaveState storage = {});
void restoreMachineSaveState(Machine& machine, const MachineSaveState& state);

} // namespace bmsx
