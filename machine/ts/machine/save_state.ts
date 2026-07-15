import type { AudioControllerState } from './devices/audio/save_state';
import type { DmaControllerState } from './devices/dma/controller';
import type { GeometryControllerState } from './devices/geometry/save_state';
import type { GxGpuSaveState, GxGpuState } from './devices/gx/gpu';
import type { GxGteState } from './devices/gx/gte';
import type { InputControllerState } from './devices/input/save_state';
import type { IrqControllerState } from './devices/irq/save_state';
import type { SystemControllerState } from './devices/system/controller';
import type { MemorySaveState } from './memory/memory';
import type { StringPoolState } from './cpu/string_pool';
import type { Machine } from './machine';

export type MachineState = {
	dma: DmaControllerState;
	geometry: GeometryControllerState;
	gxGpu: GxGpuState;
	gxGte: GxGteState;
	irq: IrqControllerState;
	audio: AudioControllerState;
	input: InputControllerState;
	systemControl: SystemControllerState;
};

export type MachineSaveState = {
	memory: MemorySaveState;
	dma: DmaControllerState;
	geometry: GeometryControllerState;
	gxGpu: GxGpuSaveState;
	gxGte: GxGteState;
	irq: IrqControllerState;
	audio: AudioControllerState;
	stringPool: StringPoolState;
	input: InputControllerState;
	systemControl: SystemControllerState;
};

export function captureMachineState(machine: Machine): MachineState {
	// GPU capture first synchronizes overdue command time and publishes its DREQ
	// edges; the dependent DMA grant must be captured after that transition.
	const gxGpu = machine.gxGpu.captureState();
	return {
		dma: machine.dmaController.captureState(),
		geometry: machine.geometryController.captureState(),
		gxGpu,
		gxGte: machine.gxGte.captureState(),
		irq: machine.irqController.captureState(),
		audio: machine.audioController.captureState(),
		input: machine.inputController.captureState(),
		systemControl: machine.systemController.captureState(),
	};
}

export function restoreMachineState(machine: Machine, state: MachineState): void {
	restoreSharedDeviceState(machine, state);
	machine.gxGpu.restoreState(state.gxGpu);
	machine.dmaController.postLoad();
	machine.gxGte.restoreState(state.gxGte);
}

export function captureMachineSaveState(machine: Machine): MachineSaveState {
	// See captureMachineState: GPU command time owns the request-line edge.
	const gxGpu = machine.gxGpu.captureSaveState();
	return {
		memory: machine.memory.captureSaveState(),
		dma: machine.dmaController.captureState(),
		geometry: machine.geometryController.captureState(),
		gxGpu,
		gxGte: machine.gxGte.captureState(),
		irq: machine.irqController.captureState(),
		audio: machine.audioController.captureState(),
		stringPool: machine.cpu.stringPool.captureState(),
		input: machine.inputController.captureState(),
		systemControl: machine.systemController.captureState(),
	};
}

export function restoreMachineSaveState(machine: Machine, state: MachineSaveState): void {
	machine.memory.restoreSaveState(state.memory);
	machine.cpu.stringPool.restoreState(state.stringPool);
	restoreSharedDeviceState(machine, state);
	machine.gxGpu.restoreSaveState(state.gxGpu);
	machine.dmaController.postLoad();
	machine.gxGte.restoreState(state.gxGte);
}

function restoreSharedDeviceState(machine: Machine, state: Pick<MachineState, 'dma' | 'geometry' | 'irq' | 'audio' | 'input' | 'systemControl'>): void {
	machine.systemController.restoreState(state.systemControl);
	machine.dmaController.restoreState(state.dma, machine.scheduler.nowCycles);
	machine.geometryController.restoreState(state.geometry, machine.scheduler.nowCycles);
	machine.irqController.restoreState(state.irq);
	machine.audioController.restoreState(state.audio, machine.scheduler.nowCycles);
	machine.inputController.restoreState(state.input);
}
