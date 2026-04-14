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

export const MMIO_REGISTER_SPEC_BY_ADDRESS: ReadonlyMap<number, MmioRegisterSpec> = new Map(
	MMIO_REGISTER_SPECS.map((spec) => [spec.address, spec]),
);

export const MMIO_REGISTER_SPEC_BY_NAME: ReadonlyMap<string, MmioRegisterSpec> = new Map(
	MMIO_REGISTER_SPECS.map((spec) => [spec.name, spec]),
);
