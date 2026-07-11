#pragma once

#include "machine/cpu/string_pool.h"
#include "machine/devices/audio/save_state.h"
#include "machine/devices/dma/controller.h"
#include "machine/devices/geometry/save_state.h"
#include "machine/devices/gx/gpu.h"
#include "machine/devices/gx/gte.h"
#include "machine/devices/input/save_state.h"
#include "machine/devices/irq/save_state.h"
#include "machine/memory/memory.h"

namespace bmsx {

class Machine;

struct MachineState {
	DmaControllerState dma;
	GeometryControllerState geometry;
	GxGpuState gxGpu;
	GxGteState gxGte;
	IrqControllerState irq;
	AudioControllerState audio;
	InputControllerState input;
};

struct MachineSaveState {
	MemorySaveState memory;
	DmaControllerState dma;
	GeometryControllerState geometry;
	GxGpuSaveState gxGpu;
	GxGteState gxGte;
	IrqControllerState irq;
	AudioControllerState audio;
	StringPoolState stringPool;
	InputControllerState input;
};

MachineState captureMachineState(const Machine& machine);
void restoreMachineState(Machine& machine, const MachineState& state);
MachineSaveState captureMachineSaveState(const Machine& machine);
void restoreMachineSaveState(Machine& machine, const MachineSaveState& state);

} // namespace bmsx
