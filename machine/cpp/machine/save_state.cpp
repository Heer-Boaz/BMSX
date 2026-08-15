#include "machine/save_state.h"

#include "machine/machine.h"

namespace bmsx {
namespace {

void restoreSharedDeviceState(
	Machine& machine,
	const CartridgeControllerState& cartridge,
	const DmaControllerState& dma,
	const GeometryControllerState& geometry,
	const IrqControllerState& irq,
	const AudioControllerState& audio,
	const InputControllerState& input
) {
	machine.dmaController.restoreState(dma, machine.scheduler.nowCycles());
	machine.geometryController.restoreState(geometry, machine.scheduler.nowCycles());
	machine.cartridgeController.restoreState(cartridge);
	machine.irqController.restoreState(irq);
	machine.audioController.restoreState(audio, machine.scheduler.nowCycles());
	machine.inputController.restoreState(input);
}

void finishDeviceRestore(Machine& machine, const SystemControllerState& systemControl) {
	// GPU/APU/IMGDEC restore their request lines while DMA admission is held. Publish
	// those lines once, then restore the system phase that owns their fences.
	machine.dmaController.postLoad();
	machine.systemController.restoreState(systemControl);
	machine.systemController.postLoad();
}

} // namespace

MachineState captureMachineState(Machine& machine) {
	MachineState state;
	// GPU capture first synchronizes overdue command time and publishes its DREQ
	// edges; the dependent DMA block admission must be captured after that
	// transition. APU capture likewise materializes transfer DREQ and
	// sample-accurate END edges before the dependent DMA and IRQ state.
	state.gxGpu = machine.gxGpu.captureState();
	state.audio = machine.audioController.captureState();
	state.cartridge = machine.cartridgeController.captureState();
	state.dma = machine.dmaController.captureState();
	state.geometry = machine.geometryController.captureState();
	state.gxGte = machine.gxGte.captureState();
	state.irq = machine.irqController.captureState();
	state.input = machine.inputController.captureState();
	state.imgDec = machine.imgDecController.captureState();
	state.systemDebugTransmit = machine.systemDebugTransmit.captureState();
	state.systemControl = machine.systemController.captureState();
	return state;
}

void restoreMachineState(Machine& machine, const MachineState& state) {
	restoreSharedDeviceState(machine, state.cartridge, state.dma, state.geometry, state.irq, state.audio, state.input);
	machine.gxGpu.restoreState(state.gxGpu);
	machine.imgDecController.restoreState(state.imgDec);
	machine.gxGte.restoreState(state.gxGte);
	machine.systemDebugTransmit.restoreState(state.systemDebugTransmit);
	finishDeviceRestore(machine, state.systemControl);
}

MachineSaveState captureMachineSaveState(Machine& machine) {
	MachineSaveState state;
	// See captureMachineState: GPU and APU command time own their request-line edges.
	state.gxGpu = machine.gxGpu.captureSaveState();
	state.audio = machine.audioController.captureState();
	state.cartridge = machine.cartridgeController.captureState();
	state.memory = machine.memory.captureSaveState();
	state.dma = machine.dmaController.captureState();
	state.geometry = machine.geometryController.captureState();
	state.gxGte = machine.gxGte.captureState();
	state.irq = machine.irqController.captureState();
	state.stringPool = machine.cpu.stringPool().captureState();
	state.input = machine.inputController.captureState();
	state.imgDec = machine.imgDecController.captureState();
	state.systemDebugTransmit = machine.systemDebugTransmit.captureState();
	state.systemControl = machine.systemController.captureState();
	return state;
}

void restoreMachineSaveState(Machine& machine, const MachineSaveState& state) {
	machine.memory.restoreSaveState(state.memory);
	machine.cpu.stringPool().restoreState(state.stringPool);
	restoreSharedDeviceState(machine, state.cartridge, state.dma, state.geometry, state.irq, state.audio, state.input);
	machine.gxGpu.restoreSaveState(state.gxGpu);
	machine.imgDecController.restoreState(state.imgDec);
	machine.gxGte.restoreState(state.gxGte);
	machine.systemDebugTransmit.restoreState(state.systemDebugTransmit);
	finishDeviceRestore(machine, state.systemControl);
}

} // namespace bmsx
