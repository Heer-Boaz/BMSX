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
	const InputControllerState& input,
	const SystemControllerState& systemControl
) {
	machine.systemController.restoreState(systemControl);
	machine.dmaController.restoreState(dma, machine.scheduler.nowCycles());
	machine.geometryController.restoreState(geometry, machine.scheduler.nowCycles());
	machine.irqController.restoreState(irq);
	machine.audioController.restoreState(audio, machine.scheduler.nowCycles());
	machine.inputController.restoreState(input);
}

} // namespace

MachineState captureMachineState(Machine& machine) {
	MachineState state;
	// GPU capture first synchronizes overdue command time and publishes its DREQ
	// edges; the dependent DMA grant must be captured after that transition.
	state.gxGpu = machine.gxGpu.captureState();
	state.dma = machine.dmaController.captureState();
	state.geometry = machine.geometryController.captureState();
	state.gxGte = machine.gxGte.captureState();
	state.irq = machine.irqController.captureState();
	state.audio = machine.audioController.captureState();
	state.input = machine.inputController.captureState();
	state.systemControl = machine.systemController.captureState();
	return state;
}

void restoreMachineState(Machine& machine, const MachineState& state) {
	restoreSharedDeviceState(machine, state.dma, state.geometry, state.irq, state.audio, state.input, state.systemControl);
	machine.gxGpu.restoreState(state.gxGpu);
	machine.dmaController.postLoad();
	machine.gxGte.restoreState(state.gxGte);
}

MachineSaveState captureMachineSaveState(Machine& machine) {
	MachineSaveState state;
	// See captureMachineState: GPU command time owns the request-line edge.
	state.gxGpu = machine.gxGpu.captureSaveState();
	state.memory = machine.memory.captureSaveState();
	state.dma = machine.dmaController.captureState();
	state.geometry = machine.geometryController.captureState();
	state.gxGte = machine.gxGte.captureState();
	state.irq = machine.irqController.captureState();
	state.audio = machine.audioController.captureState();
	state.stringPool = machine.cpu.stringPool().captureState();
	state.input = machine.inputController.captureState();
	state.systemControl = machine.systemController.captureState();
	return state;
}

void restoreMachineSaveState(Machine& machine, const MachineSaveState& state) {
	machine.memory.restoreSaveState(state.memory);
	machine.cpu.stringPool().restoreState(state.stringPool);
	restoreSharedDeviceState(machine, state.dma, state.geometry, state.irq, state.audio, state.input, state.systemControl);
	machine.gxGpu.restoreSaveState(state.gxGpu);
	machine.dmaController.postLoad();
	machine.gxGte.restoreState(state.gxGte);
}

} // namespace bmsx
