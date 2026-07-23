import { cartridgeSlots } from './cartridge';
import assert from 'node:assert/strict';
import { encodeCompiledProgramObject, type CompiledProgram } from '../../machine/ts/lua/compiler';
import { CART_ROM_BASE, SYSTEM_ROM_BASE } from '../../machine/ts/machine/memory/map';
import {
	assembleProgramImages,
	encodeProgramImage,
	type ProgramImage,
	type ProgramSymbolsImage,
} from '../../machine/ts/machine/program/loader';
import { linkCartProgramImage, linkSystemProgramImage } from '../../machine/ts/rompack/tooling/program_linker';
import { CPU, RunResult, type Program } from '../../machine/ts/machine/cpu/cpu';
import { IrqController } from '../../machine/ts/machine/devices/irq/controller';
import { Memory } from '../../machine/ts/machine/memory/memory';

export type FinalizedTestProgram = {
	image: ProgramImage;
	metadata: ProgramSymbolsImage | null;
	program: Program;
	romBytes: Uint8Array;
};

export type FinalizedTestProgramPair = {
	systemImage: ProgramImage;
	systemMetadata: ProgramSymbolsImage | null;
	cartImage: ProgramImage;
	cartMetadata: ProgramSymbolsImage | null;
	program: Program;
	systemRomBytes: Uint8Array;
	cartRomBytes: Uint8Array;
};

export function finalizeTestSystemProgram(
	compiled: CompiledProgram,
	programAddress = SYSTEM_ROM_BASE,
): FinalizedTestProgram {
	const linked = linkSystemProgramImage(encodeCompiledProgramObject(compiled), compiled.metadata, programAddress);
	return {
		image: linked.image,
		metadata: linked.metadata,
		program: assembleProgramImages(linked.image, null),
		romBytes: encodeProgramImage(linked.image).sections,
	};
}

export function finalizeTestProgramPair(
	systemCompiled: CompiledProgram,
	cartCompiled: CompiledProgram,
	systemProgramAddress = SYSTEM_ROM_BASE,
	cartProgramAddress = CART_ROM_BASE,
): FinalizedTestProgramPair {
	const system = linkSystemProgramImage(
		encodeCompiledProgramObject(systemCompiled),
		systemCompiled.metadata,
		systemProgramAddress,
	);
	const cart = linkCartProgramImage(
		system.image,
		system.metadata,
		encodeCompiledProgramObject(cartCompiled),
		cartCompiled.metadata,
		cartProgramAddress,
	);
	return {
		systemImage: system.image,
		systemMetadata: system.metadata,
		cartImage: cart.image,
		cartMetadata: cart.metadata,
		program: assembleProgramImages(system.image, cart.image),
		systemRomBytes: encodeProgramImage(system.image).sections,
		cartRomBytes: encodeProgramImage(cart.image).sections,
	};
}

export function createTestSystemCpu(
	finalized: FinalizedTestProgram,
): { cpu: CPU; memory: Memory; irqController: IrqController } {
	const memory = new Memory({ systemRom: finalized.romBytes, cartridgeSlots: cartridgeSlots() });
	const irqController = new IrqController(memory);
	const cpu = new CPU(memory, irqController);
	const vectors = finalized.image.vectors;
	cpu.setProgram(
		finalized.program,
		finalized.image.symbols,
		finalized.metadata,
		vectors.irqProtoIndex,
		vectors.irqProtoIndex,
		vectors.exceptionProtoIndex,
	);
	return { cpu, memory, irqController };
}

export function createInitializedTestSystemCpu(
	finalized: FinalizedTestProgram,
	cycleBudget: number,
): ReturnType<typeof createTestSystemCpu> {
	const fixture = createTestSystemCpu(finalized);
	const cpu = fixture.cpu;
	const image = finalized.image;
	cpu.start(image.vectors.sectionInitProtoIndex);
	assert.equal(cpu.runUntilDepth(0, cycleBudget), RunResult.Halted);
	for (const path of image.sections.rodata.staticModulePaths) {
		const targetDepth = cpu.getFrameDepth();
		cpu.call(cpu.rootClosure(finalized.program.moduleProtoMap.get(path)!));
		assert.equal(cpu.runUntilDepth(targetDepth, cycleBudget), RunResult.Halted);
	}
	cpu.syncGlobalSlotsToTable();
	return fixture;
}

export function runTestSystemProgram(compiled: CompiledProgram, cycleBudget: number): CPU {
	const finalized = finalizeTestSystemProgram(compiled);
	const cpu = createInitializedTestSystemCpu(finalized, cycleBudget).cpu;
	cpu.start(finalized.image.vectors.resetProtoIndex);
	assert.equal(cpu.runUntilDepth(0, cycleBudget), RunResult.Halted);
	return cpu;
}
