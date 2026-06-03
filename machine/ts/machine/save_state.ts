import type { AudioControllerState } from './devices/audio/save_state';
import type { GeometryControllerState } from './devices/geometry/save_state';
import type { InputControllerState } from './devices/input/save_state';
import type { IrqControllerState } from './devices/irq/save_state';
import type { VdpSaveState, VdpState } from './devices/vdp/save_state';
import type { MemorySaveState } from './memory/memory';
import type { StringPoolState } from './cpu/string_pool';
import type { Machine } from './machine';

export type MachineState = {
	geometry: GeometryControllerState;
	irq: IrqControllerState;
	audio: AudioControllerState;
	input: InputControllerState;
	vdp: VdpState;
};

export type MachineSaveState = {
	memory: MemorySaveState;
	geometry: GeometryControllerState;
	irq: IrqControllerState;
	audio: AudioControllerState;
	stringPool: StringPoolState;
	input: InputControllerState;
	vdp: VdpSaveState;
};

export function captureMachineState(machine: Machine): MachineState {
	return {
		geometry: machine.geometryController.captureState(),
		irq: machine.irqController.captureState(),
		audio: machine.audioController.captureState(),
		input: machine.inputController.captureState(),
		vdp: machine.vdp.captureState(),
	};
}

export function restoreMachineState(machine: Machine, state: MachineState): void {
	restoreSharedDeviceState(machine, state);
	machine.vdp.restoreState(state.vdp);
}

export function captureMachineSaveState(machine: Machine): MachineSaveState {
	return {
		memory: machine.memory.captureSaveState(),
		geometry: machine.geometryController.captureState(),
		irq: machine.irqController.captureState(),
		audio: machine.audioController.captureState(),
		stringPool: machine.cpu.stringPool.captureState(),
		input: machine.inputController.captureState(),
		vdp: machine.vdp.captureSaveState(),
	};
}

export function restoreMachineSaveState(machine: Machine, state: MachineSaveState): void {
	machine.memory.restoreSaveState(state.memory);
	machine.cpu.stringPool.restoreState(state.stringPool);
	restoreSharedDeviceState(machine, state);
	machine.vdp.restoreSaveState(state.vdp);
}

function restoreSharedDeviceState(machine: Machine, state: Pick<MachineState, 'geometry' | 'irq' | 'audio' | 'input'>): void {
	machine.geometryController.restoreState(state.geometry, machine.scheduler.nowCycles);
	machine.irqController.restoreState(state.irq);
	machine.audioController.restoreState(state.audio, machine.scheduler.nowCycles);
	machine.inputController.restoreState(state.input);
}
