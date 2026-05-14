#pragma once

#include "machine/cpu/string_pool.h"
#include "machine/devices/audio/save_state.h"
#include "machine/devices/geometry/state.h"
#include "machine/devices/input/save_state.h"
#include "machine/devices/irq/save_state.h"
#include "machine/devices/vdp/save_state.h"
#include "machine/memory/memory.h"

namespace bmsx {

class Machine;

struct MachineState {
	GeometryControllerState geometry;
	IrqControllerState irq;
	AudioControllerState audio;
	InputControllerState input;
	VdpState vdp;
};

struct MachineSaveState {
	MemorySaveState memory;
	GeometryControllerState geometry;
	IrqControllerState irq;
	AudioControllerState audio;
	StringPoolState stringPool;
	InputControllerState input;
	VdpSaveState vdp;
};

MachineState captureMachineState(const Machine& machine);
void restoreMachineState(Machine& machine, const MachineState& state);
MachineSaveState captureMachineSaveState(const Machine& machine);
void restoreMachineSaveState(Machine& machine, const MachineSaveState& state);

} // namespace bmsx
