import type { MachineModelSpec } from '../../machine/ts/spec/bmsx/model';
import type { ScenarioTestSource } from '../../toolchain/ts/rompack/scenario_test';
import { buildTestCartridge, type BuiltTestCartridge, type TestCartridgeSourceSelection } from '../../toolchain/ts/rompack/test_cartridge';
import { createBlua32SourceImage, type Blua32InstalledMedia } from '../runtime/sources';

/** Source admission of the derived physical system/primary/companion images. */
export type FixtureSourceContexts = readonly [system: string, primary: string, companion: string | null];
export type FixtureMedia = {
	readonly sourceSelection: TestCartridgeSourceSelection;
	readonly systemRom: Uint8Array;
	readonly cartridgeSlots: readonly [Uint8Array, Uint8Array | null];
	readonly sourceContexts: FixtureSourceContexts;
	readonly machineModel: MachineModelSpec;
	readonly optLevel: 0 | 1 | 2 | 3;
};

/** A derived program retains its own source provenance, never authoring-slot aliases. */
export type BuiltFixtureProgram = BuiltTestCartridge & { readonly sourceMedia: Blua32InstalledMedia };

export async function buildFixtureProgram(media: FixtureMedia, test: ScenarioTestSource): Promise<BuiltFixtureProgram> {
	const program = await buildTestCartridge({ ...media, cartridge: media.cartridgeSlots[0], companionCartridge: media.cartridgeSlots[1],
		ramByteCount: media.machineModel.ramBytes, test });
	const [system, primary, companion] = program.debugImages;
	return { ...program, sourceMedia: {
		system: createBlua32SourceImage(system.image.layout, system.image.symbols, system.sources, media.sourceContexts[0]),
		cartridgeSlots: [createBlua32SourceImage(primary.image.layout, primary.image.symbols, primary.sources, media.sourceContexts[1]),
			companion === null ? null : createBlua32SourceImage(companion.image.layout, companion.image.symbols, companion.sources, media.sourceContexts[2]!)],
	} };
}
