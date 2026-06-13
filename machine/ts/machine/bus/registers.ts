export type MmioWriteRequirement = 'any' | 'string_id';

export type MmioRegisterSpec = {
	readonly name: string;
	readonly address: number;
	readonly writeRequirement: MmioWriteRequirement;
};

// No MMIO register currently carries a special write requirement; the raw ICU
// snapshot registers are plain words.
export const MMIO_REGISTER_SPECS: ReadonlyArray<MmioRegisterSpec> = [];

export const MMIO_REGISTER_SPEC_BY_ADDRESS: ReadonlyMap<number, MmioRegisterSpec> = new Map(
	MMIO_REGISTER_SPECS.map((spec) => [spec.address, spec]),
);

export const MMIO_REGISTER_SPEC_BY_NAME: ReadonlyMap<string, MmioRegisterSpec> = new Map(
	MMIO_REGISTER_SPECS.map((spec) => [spec.name, spec]),
);
