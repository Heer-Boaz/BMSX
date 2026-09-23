import type { Runtime } from '../../machine/ts/machine/runtime/runtime';
import type { MachineModelSpec } from '../../machine/ts/spec/bmsx/model';
import type { HeadlessGPUBackend } from '../../machine/ts/render/headless/backend';
import type { VideoPresenter } from '../../machine/ts/render/video_presenter';
import type { TestInput } from './input';

/** A case leases one physical machine from product composition, not the author's runtime. */
export interface TestTarget {
	readonly runtime: Runtime;
	readonly input: TestInput;
	readonly backend: HeadlessGPUBackend;
	readonly presenter: VideoPresenter;
	serviceBackend(): void;
	advanceGame(cycles: number): boolean;
	present(): boolean;
	dispose(): void;
}

/** Construction is outside testing; input injection and case policy remain here. */
export type TestTargetFactory = (
	systemRom: Uint8Array,
	cartridgeSlots: readonly [Uint8Array | null, Uint8Array | null],
	machineModel: MachineModelSpec,
	input: TestInput,
) => TestTarget;
