import { INSTRUCTION_BYTES } from '../cpu/instruction_format';
import {
	CART_PROGRAM_START_ADDR,
	CART_PROGRAM_START_OFFSET,
	CART_PROGRAM_VECTOR_OFFSET,
} from '../memory/map';

export type ProgramLayout = {
	systemBasePc: number;
	cartBasePc: number;
};

export const SYSTEM_BASE_PC = 0;
export const CART_BASE_PC = CART_PROGRAM_START_OFFSET;
export const CART_PROGRAM_VECTOR_PC = CART_PROGRAM_VECTOR_OFFSET;
export const CART_PROGRAM_VECTOR_VALUE = CART_PROGRAM_START_ADDR;

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
	if (cartBasePc <= CART_PROGRAM_VECTOR_PC) {
		throw new Error(`[ProgramLayout] Cart base PC must leave room for the cart program vector at PC ${CART_PROGRAM_VECTOR_PC}.`);
	}
	if (systemBasePc + systemCodeBytes > cartBasePc) {
		throw new Error(`[ProgramLayout] System program (${systemCodeBytes} bytes) overlaps cart base PC ${cartBasePc}.`);
	}
	return { systemBasePc, cartBasePc };
};
