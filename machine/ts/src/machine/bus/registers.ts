import { IO_INP_ACTION, IO_INP_BIND, IO_INP_CONSUME, IO_INP_QUERY } from './io';

export type MmioWriteRequirement = 'any' | 'string_id';

export type MmioRegisterSpec = {
	readonly name: string;
	readonly address: number;
	readonly writeRequirement: MmioWriteRequirement;
};

export const MMIO_REGISTER_SPECS: ReadonlyArray<MmioRegisterSpec> = [
	{ name: 'sys_inp_action', address: IO_INP_ACTION, writeRequirement: 'string_id' },
	{ name: 'sys_inp_bind', address: IO_INP_BIND, writeRequirement: 'string_id' },
	{ name: 'sys_inp_query', address: IO_INP_QUERY, writeRequirement: 'string_id' },
	{ name: 'sys_inp_consume', address: IO_INP_CONSUME, writeRequirement: 'string_id' },
];

export const MMIO_REGISTER_SPEC_BY_ADDRESS: ReadonlyMap<number, MmioRegisterSpec> = new Map(
	MMIO_REGISTER_SPECS.map((spec) => [spec.address, spec]),
);

export const MMIO_REGISTER_SPEC_BY_NAME: ReadonlyMap<string, MmioRegisterSpec> = new Map(
	MMIO_REGISTER_SPECS.map((spec) => [spec.name, spec]),
);
