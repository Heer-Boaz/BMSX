export type RomBuildRecipe = {
	domain: 'system' | 'cart';
	debug: boolean;
	optLevel: 0 | 1 | 2 | 3;
	projectRoot: string;
	toolchain: string;
};
/** file is relative to the receipt's output root, not necessarily a basename. */
export type RomBuildOutput = { file: string; digest: string };
export type RomBuildRecord = { recipe: RomBuildRecipe; inputs: string; outputs: readonly RomBuildOutput[] };

export type RomBuildUnit = RomBuildRecord & { key: string; name: string };
export type RomArtifact = { id: string; target: string; system: RomBuildUnit; cart?: RomBuildUnit };
