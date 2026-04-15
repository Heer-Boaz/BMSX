import { IO_INP_ACTION, IO_INP_BIND, IO_INP_CONSUME, IO_INP_QUERY } from './io';

export type MmioWriteRequirement = 'any' | 'string_ref';

export type MmioRegisterSpec = {
	readonly name: string;
	readonly address: number;
	readonly writeRequirement: MmioWriteRequirement;
};

export const MMIO_REGISTER_SPECS: ReadonlyArray<MmioRegisterSpec> = [
	{ name: 'sys_inp_action', address: IO_INP_ACTION, writeRequirement: 'any' },
	{ name: 'sys_inp_bind', address: IO_INP_BIND, writeRequirement: 'any' },
	{ name: 'sys_inp_query', address: IO_INP_QUERY, writeRequirement: 'any' },
	{ name: 'sys_inp_consume', address: IO_INP_CONSUME, writeRequirement: 'any' },
];

const mmioRegisterSpecByAddress = new Map(
	MMIO_REGISTER_SPECS.map((spec) => [spec.address, spec]),
);

const mmioRegisterSpecByName = new Map(
	MMIO_REGISTER_SPECS.map((spec) => [spec.name, spec]),
);

export const MMIO_REGISTER_SPEC_BY_ADDRESS: ReadonlyMap<number, MmioRegisterSpec> = mmioRegisterSpecByAddress;

export const MMIO_REGISTER_SPEC_BY_NAME: ReadonlyMap<string, MmioRegisterSpec> = mmioRegisterSpecByName;

export function withTemporaryMmioRegisterSpec<T>(spec: MmioRegisterSpec, run: () => T): T {
	const previousByAddress = mmioRegisterSpecByAddress.get(spec.address);
	const previousByName = mmioRegisterSpecByName.get(spec.name);
	mmioRegisterSpecByAddress.set(spec.address, spec);
	mmioRegisterSpecByName.set(spec.name, spec);
	try {
		return run();
	} finally {
		if (previousByAddress === undefined) {
			mmioRegisterSpecByAddress.delete(spec.address);
		} else {
			mmioRegisterSpecByAddress.set(spec.address, previousByAddress);
		}
		if (previousByName === undefined) {
			mmioRegisterSpecByName.delete(spec.name);
		} else {
			mmioRegisterSpecByName.set(spec.name, previousByName);
		}
	}
}
