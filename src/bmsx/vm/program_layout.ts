export type ProgramLayout = {
	engineBasePc: number;
	cartBasePc: number;
};

export const VM_ENGINE_BASE_PC = 0;
export const VM_CART_BASE_PC = 0x80000;

export const resolveProgramLayout = (engineInstructionCount: number, layout?: Partial<ProgramLayout>): ProgramLayout => {
	const engineBasePc = layout?.engineBasePc ?? VM_ENGINE_BASE_PC;
	const cartBasePc = layout?.cartBasePc ?? VM_CART_BASE_PC;
	if (engineBasePc < 0) {
		throw new Error(`[ProgramLayout] Engine base PC must be >= 0 (got ${engineBasePc}).`);
	}
	if (cartBasePc < 0) {
		throw new Error(`[ProgramLayout] Cart base PC must be >= 0 (got ${cartBasePc}).`);
	}
	if (engineBasePc + engineInstructionCount > cartBasePc) {
		throw new Error(`[ProgramLayout] Engine program (${engineInstructionCount} instr) overlaps cart base PC ${cartBasePc}.`);
	}
	return { engineBasePc, cartBasePc };
};
