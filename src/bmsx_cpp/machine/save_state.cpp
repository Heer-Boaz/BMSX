#include "machine/save_state.h"

#include "machine/machine.h"

namespace bmsx {
namespace {

void restoreSharedDeviceState(
	Machine& machine,
	const GeometryControllerState& geometry,
	const IrqControllerState& irq,
	const AudioControllerState& audio,
	const InputControllerState& input
) {
	machine.geometryController.restoreState(geometry, machine.scheduler.nowCycles());
	machine.irqController.restoreState(irq);
	machine.audioController.restoreState(audio, machine.scheduler.nowCycles());
	machine.inputController.restoreState(input);
}

} // namespace

MachineState captureMachineState(const Machine& machine) {
	MachineState state;
	state.geometry = machine.geometryController.captureState();
	state.irq = machine.irqController.captureState();
	state.audio = machine.audioController.captureState();
	state.input = machine.inputController.captureState();
	state.vdp = machine.vdp.captureState();
	return state;
}

void restoreMachineState(Machine& machine, const MachineState& state) {
	restoreSharedDeviceState(machine, state.geometry, state.irq, state.audio, state.input);
	machine.vdp.restoreState(state.vdp);
}

MachineSaveState captureMachineSaveState(const Machine& machine) {
	MachineSaveState state;
	state.memory = machine.memory.captureSaveState();
	state.geometry = machine.geometryController.captureState();
	state.irq = machine.irqController.captureState();
	state.audio = machine.audioController.captureState();
	state.stringPool = machine.cpu.stringPool().captureState();
	state.input = machine.inputController.captureState();
	state.vdp = machine.vdp.captureSaveState();
	return state;
}

void restoreMachineSaveState(Machine& machine, const MachineSaveState& state) {
	machine.memory.restoreSaveState(state.memory);
	machine.cpu.stringPool().restoreState(state.stringPool);
	restoreSharedDeviceState(machine, state.geometry, state.irq, state.audio, state.input);
	machine.vdp.restoreSaveState(state.vdp);
}

} // namespace bmsx
