import type { AudioControllerState } from './devices/audio/save_state';
import type { CartridgeControllerState } from './devices/cartridge/contracts';
import type { DmaControllerState } from './devices/dma/controller';
import type { GeometryControllerState } from './devices/geometry/save_state';
import type { GxGpuSaveState, GxGpuState } from './devices/gx/gpu';
import type { GxGteState } from './devices/gx/gte';
import type { InputControllerState } from './devices/input/save_state';
import type { IrqControllerState } from './devices/irq/save_state';
import type { ImgDecControllerState } from './devices/imgdec/controller';
import type { SystemControllerState } from './devices/system/controller';
import type { MemorySaveState } from './memory/memory';
import type { StringPoolState } from './cpu/string_pool';
import type { Machine } from './machine';

export type MachineState = {
	cartridge: CartridgeControllerState;
	dma: DmaControllerState;
	geometry: GeometryControllerState;
	gxGpu: GxGpuState;
	gxGte: GxGteState;
	irq: IrqControllerState;
	audio: AudioControllerState;
	input: InputControllerState;
	imgDec: ImgDecControllerState;
	systemControl: SystemControllerState;
};

export type MachineSaveState = {
	memory: MemorySaveState;
	cartridge: CartridgeControllerState;
	dma: DmaControllerState;
	geometry: GeometryControllerState;
	gxGpu: GxGpuSaveState;
	gxGte: GxGteState;
	irq: IrqControllerState;
	audio: AudioControllerState;
	stringPool: StringPoolState;
	input: InputControllerState;
	imgDec: ImgDecControllerState;
	systemControl: SystemControllerState;
};

export function captureMachineState(machine: Machine): MachineState {
	// GPU capture first synchronizes overdue command time and publishes its DREQ
	// edges; the dependent DMA block admission must be captured after that
	// transition. APU capture likewise materializes transfer DREQ and
	// sample-accurate END edges before the dependent DMA and IRQ state.
	const gxGpu = machine.gxGpu.captureState();
	const audio = machine.audioController.captureState();
	const cartridge = machine.cartridgeController.captureState();
	return {
		cartridge,
		dma: machine.dmaController.captureState(),
		geometry: machine.geometryController.captureState(),
		gxGpu,
		gxGte: machine.gxGte.captureState(),
		irq: machine.irqController.captureState(),
		audio,
		input: machine.inputController.captureState(),
		imgDec: machine.imgDecController.captureState(),
		systemControl: machine.systemController.captureState(),
	};
}

export function restoreMachineState(machine: Machine, state: MachineState): void {
	restoreSharedDeviceState(machine, state);
	machine.gxGpu.restoreState(state.gxGpu);
	machine.imgDecController.restoreState(state.imgDec);
	machine.gxGte.restoreState(state.gxGte);
	finishDeviceRestore(machine, state.systemControl);
}

export function captureMachineSaveState(machine: Machine): MachineSaveState {
	// See captureMachineState: GPU and APU command time own their request-line edges.
	const gxGpu = machine.gxGpu.captureSaveState();
	const audio = machine.audioController.captureState();
	const cartridge = machine.cartridgeController.captureState();
	return {
		memory: machine.memory.captureSaveState(),
		cartridge,
		dma: machine.dmaController.captureState(),
		geometry: machine.geometryController.captureState(),
		gxGpu,
		gxGte: machine.gxGte.captureState(),
		irq: machine.irqController.captureState(),
		audio,
		stringPool: machine.cpu.stringPool.captureState(),
		input: machine.inputController.captureState(),
		imgDec: machine.imgDecController.captureState(),
		systemControl: machine.systemController.captureState(),
	};
}

export function restoreMachineSaveState(machine: Machine, state: MachineSaveState): void {
	machine.memory.restoreSaveState(state.memory);
	machine.cpu.stringPool.restoreState(state.stringPool);
	restoreSharedDeviceState(machine, state);
	machine.gxGpu.restoreSaveState(state.gxGpu);
	machine.imgDecController.restoreState(state.imgDec);
	machine.gxGte.restoreState(state.gxGte);
	finishDeviceRestore(machine, state.systemControl);
}

function restoreSharedDeviceState(machine: Machine, state: Pick<MachineState, 'cartridge' | 'dma' | 'geometry' | 'irq' | 'audio' | 'input'>): void {
	machine.dmaController.restoreState(state.dma, machine.scheduler.nowCycles);
	machine.geometryController.restoreState(state.geometry, machine.scheduler.nowCycles);
	machine.cartridgeController.restoreState(state.cartridge);
	machine.irqController.restoreState(state.irq);
	machine.audioController.restoreState(state.audio, machine.scheduler.nowCycles);
	machine.inputController.restoreState(state.input);
}

function finishDeviceRestore(machine: Machine, systemControl: SystemControllerState): void {
	// GPU/APU/IMGDEC restore their request lines while DMA admission is held. Publish
	// those lines once, then restore the system phase that owns their fences.
	machine.dmaController.postLoad();
	machine.systemController.restoreState(systemControl);
	machine.systemController.postLoad();
}
