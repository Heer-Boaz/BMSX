import type { Runtime } from '../../machine/ts/machine/runtime/runtime';
import type { MachineModelSpec } from '../../machine/ts/spec/bmsx/model';
import type { HeadlessGPUBackend } from '../../machine/ts/render/headless/backend';
import type { VideoPresenter } from '../../machine/ts/render/video_presenter';
import type { TestInput } from './input';

/** Compiled fixture operations use a physical machine, not an authoring runtime or an input facade. */
export interface FixtureTarget {
	readonly runtime: Runtime;
	readonly backend: HeadlessGPUBackend;
	readonly presenter: VideoPresenter;
	serviceBackend(): void;
	advanceGame(cycles: number): boolean;
	present(): boolean;
	dispose(): void;
}

/** An automatic case owns only scripted input. Play admits the same fixture with a separate input port. */
export interface TestTarget extends FixtureTarget {
	readonly input: TestInput;
}

/** Construction is outside testing; input injection and case policy remain here. */
export type TestTargetFactory = (
	systemRom: Uint8Array,
	cartridgeSlots: readonly [Uint8Array | null, Uint8Array | null],
	machineModel: MachineModelSpec,
	input: TestInput,
) => TestTarget;
