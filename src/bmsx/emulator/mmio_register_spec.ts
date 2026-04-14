export type MmioWriteRequirement = 'any' | 'string_ref';

export type MmioRegisterSpec = {
	readonly name: string;
	readonly address: number;
	readonly writeRequirement: MmioWriteRequirement;
};

export const MMIO_REGISTER_SPECS: ReadonlyArray<MmioRegisterSpec> = [
	// Input Controller registers will be added here when the device is implemented.
	// Example:
	// { name: 'sys_input_action_query', address: IO_INPUT_ACTION_QUERY, writeRequirement: 'string_ref' },
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
