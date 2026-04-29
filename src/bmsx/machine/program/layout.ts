import { INSTRUCTION_BYTES } from '../cpu/instruction_format';
import { CART_PROGRAM_START_OFFSET } from '../memory/map';

export type ProgramLayout = {
	systemBasePc: number;
	cartBasePc: number;
};

export const SYSTEM_BASE_PC = 0;
export const CART_BASE_PC = CART_PROGRAM_START_OFFSET;

export const resolveProgramLayout = (systemCodeBytes: number, layout?: Partial<ProgramLayout>): ProgramLayout => {
	const systemBasePc = layout?.systemBasePc ?? SYSTEM_BASE_PC;
	const cartBasePc = layout?.cartBasePc ?? CART_BASE_PC;
	if (systemBasePc < 0) {
		throw new Error(`[ProgramLayout] System base PC must be >= 0 (got ${systemBasePc}).`);
	}
	if (cartBasePc < 0) {
		throw new Error(`[ProgramLayout] Cart base PC must be >= 0 (got ${cartBasePc}).`);
	}
	if (systemBasePc % INSTRUCTION_BYTES !== 0) {
		throw new Error(`[ProgramLayout] System base PC must align to ${INSTRUCTION_BYTES}-byte words (got ${systemBasePc}).`);
	}
	if (cartBasePc % INSTRUCTION_BYTES !== 0) {
		throw new Error(`[ProgramLayout] Cart base PC must align to ${INSTRUCTION_BYTES}-byte words (got ${cartBasePc}).`);
	}
	if (systemBasePc + systemCodeBytes > cartBasePc) {
		throw new Error(`[ProgramLayout] System program (${systemCodeBytes} bytes) overlaps cart base PC ${cartBasePc}.`);
	}
	return { systemBasePc, cartBasePc };
};
