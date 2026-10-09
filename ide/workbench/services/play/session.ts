import type { HostAudioOutput } from '../../../../hosts/common/audio_output';
import type { HostExecutionControl } from '../../../../hosts/common/execution_control';
import type { HostRewind } from '../../../../hosts/common/rewind';
import type { RuntimeTaskQueue } from '../../../../hosts/common/runtime_task_queue';
import type { FrameBitmap } from '../../../../hosts/common/frame_bitmap';
import type { MachineModelSpec } from '../../../../machine/ts/spec/bmsx/model';
import type { BuiltTestCartridge } from '../../../../toolchain/ts/rompack/test_cartridge';
import type { ResourceDomain } from '../../../common/resource';
import type { SuspendedGuestSession } from '../../../runtime/suspended_guest';
import type { SourceExecutionState } from '../../../runtime/debugger_state';
import type { RuntimeFrameNavigation } from '../../../runtime/frame_navigation';
import type { TestDebuggerSources } from '../../../testing/debugger_sources';
import type { RuntimeTransport } from '../../../runtime/transport';
import type { RuntimeDebuggerExecution } from '../../../runtime/debugger_execution';
import type { PlayEvidence } from './evidence';
import type { PlayFixture, PlayFixtureState } from '../../../testing/play_fixture';
import type { FixtureTarget } from '../../../testing/target';
import type { PlayInput } from './input';
import type { RuntimeInstalledSourceState } from '../../../runtime/sources';
import type { ActorExecutionService } from '../../contrib/actor_lab/execution';

export type PlaySessionFailure = { readonly kind: 'host'; readonly error: unknown }
	| { readonly kind: 'machine'; readonly message: string; readonly cycles: number; readonly videoTick: number };
export type PlaySessionState = PlayFixtureState | 'faulted' | 'closing';

/** A concrete physical session admitted by composition, never a TestRun or a mutable editor world. */
export interface PlaySession extends RuntimeInstalledSourceState {
	readonly target: FixtureTarget;
	readonly input: PlayInput;
	readonly program: BuiltTestCartridge;
	readonly sourceDomain: ResourceDomain;
	readonly fixture: PlayFixture;
	readonly evidence: PlayEvidence;
	readonly guest: SuspendedGuestSession;
	readonly debugger: SourceExecutionState;
	readonly debugSources: TestDebuggerSources;
	readonly navigation: RuntimeFrameNavigation;
	readonly transport: RuntimeTransport;
	readonly debuggerExecution: RuntimeDebuggerExecution<SourceExecutionState>;
	readonly actorExecution: ActorExecutionService;
	readonly audio: HostAudioOutput;
	readonly execution: HostExecutionControl;
	readonly rewind: HostRewind;
	readonly tasks: RuntimeTaskQueue;
	readonly frames: FrameBitmap;
	readonly state: PlaySessionState;
	readonly ready: boolean;
	readonly failure: PlaySessionFailure | undefined;
	advance(hostDeltaMs: number): void;
	stop(): void;
	dispose(): Promise<void>;
}

export type PlaySessionFactory = (systemRom: Uint8Array, cartridgeSlots: readonly [Uint8Array | null, Uint8Array | null],
	machineModel: MachineModelSpec, input: PlayInput, program: BuiltTestCartridge, sourceDomain: ResourceDomain) => PlaySession;
