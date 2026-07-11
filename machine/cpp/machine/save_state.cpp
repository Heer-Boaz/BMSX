#include "machine/save_state.h"

#include "machine/machine.h"

namespace bmsx {
namespace {

void restoreSharedDeviceState(
	Machine& machine,
	const DmaControllerState& dma,
	const GeometryControllerState& geometry,
	const IrqControllerState& irq,
	const AudioControllerState& audio,
	const InputControllerState& input
) {
	machine.dmaController.restoreState(dma, machine.scheduler.nowCycles());
	machine.geometryController.restoreState(geometry, machine.scheduler.nowCycles());
	machine.irqController.restoreState(irq);
	machine.audioController.restoreState(audio, machine.scheduler.nowCycles());
	machine.inputController.restoreState(input);
}

} // namespace

MachineState captureMachineState(const Machine& machine) {
	MachineState state;
	state.dma = machine.dmaController.captureState();
	state.geometry = machine.geometryController.captureState();
	state.gxGpu = machine.gxGpu.captureState();
	state.gxGte = machine.gxGte.captureState();
	state.irq = machine.irqController.captureState();
	state.audio = machine.audioController.captureState();
	state.input = machine.inputController.captureState();
	return state;
}

void restoreMachineState(Machine& machine, const MachineState& state) {
	restoreSharedDeviceState(machine, state.dma, state.geometry, state.irq, state.audio, state.input);
	machine.gxGpu.restoreState(state.gxGpu);
	machine.gxGte.restoreState(state.gxGte);
}

MachineSaveState captureMachineSaveState(const Machine& machine) {
	MachineSaveState state;
	state.memory = machine.memory.captureSaveState();
	state.dma = machine.dmaController.captureState();
	state.geometry = machine.geometryController.captureState();
	state.gxGpu = machine.gxGpu.captureSaveState();
	state.gxGte = machine.gxGte.captureState();
	state.irq = machine.irqController.captureState();
	state.audio = machine.audioController.captureState();
	state.stringPool = machine.cpu.stringPool().captureState();
	state.input = machine.inputController.captureState();
	return state;
}

void restoreMachineSaveState(Machine& machine, const MachineSaveState& state) {
	machine.memory.restoreSaveState(state.memory);
	machine.cpu.stringPool().restoreState(state.stringPool);
	restoreSharedDeviceState(machine, state.dma, state.geometry, state.irq, state.audio, state.input);
	machine.gxGpu.restoreSaveState(state.gxGpu);
	machine.gxGte.restoreState(state.gxGte);
}

} // namespace bmsx
