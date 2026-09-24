import { ActorExecutionService } from '../../ide/workbench/contrib/actor_lab/execution';
import { RuntimeDebuggerExecution } from '../../ide/runtime/debugger_execution';
import { LuaTerminalSession } from '../../ide/workbench/services/terminal/session';
import { RuntimeFrameNavigation } from '../../ide/runtime/frame_navigation';
import type { HostAudioOutput } from '../../hosts/common/audio_output';
import { HostExecutionControl } from '../../hosts/common/execution_control';
import { RenderPresentationState } from '../../hosts/common/presentation_state';
import { HostRewind } from '../../hosts/common/rewind';
import { RuntimeTaskQueue } from '../../hosts/common/runtime_task_queue';
import { createHostOverlayFixture } from './host_overlay';
import { RenderPassLibrary } from '../../machine/ts/render/backend/pass/library';
import { GameCaptureService } from '../../hosts/common/game_capture';
import { encodePngImage } from '../../hosts/node/headless/screenshot';
import type { Runtime } from '../../machine/ts/machine/runtime/runtime';
import { createRuntimeDebuggerState } from '../../ide/runtime/debugger_state';
import { createRuntimeFaultState } from '../../ide/runtime/fault_state';
import { RuntimeInspectionService } from '../../ide/runtime/inspection';
import type { RuntimeSourceState } from '../../ide/runtime/sources';
import { SuspendedGuestSession } from '../../ide/runtime/suspended_guest';
import { BootService } from '../../ide/workbench/services/execution/boot';
import { EditorTextModelService } from '../../ide/editor/model/model_service';
import { RuntimeLuaTooling } from '../../ide/runtime/lua_tooling';
import { MemoryStorage } from '../../ide/workspace/memory_storage';
import type { KeyValueStorage } from '../../ide/workspace/key_value_storage';

/** Real control/inspection/render owners; no audio device is needed for read-only tests. */
export function createRuntimeInspectionFixture(runtime: Runtime, sources: RuntimeSourceState, guest = new SuspendedGuestSession(runtime),
	models = new EditorTextModelService(), storage: KeyValueStorage = new MemoryStorage()) {
	const audio = { mutePause() {}, muteRuntimeTask() {}, muteRewind() {}, muteSystem() {}, syncTiming() {}, restart() {} } as unknown as HostAudioOutput;
	const { presenter, backend } = createHostOverlayFixture(4, 3);
	presenter.initialize(new RenderPassLibrary(backend, presenter));
	presenter.crt_postprocessing_enabled = false;
	const presentation = new RenderPresentationState();
	const execution = new HostExecutionControl(audio);
	const tasks = new RuntimeTaskQueue(audio, presenter);
	const debuggerState = createRuntimeDebuggerState(runtime, sources);
	const fault = createRuntimeFaultState();
	const rewind = new HostRewind(runtime, presenter, presentation, tasks, audio, { log() {} });
	const frameNavigation = new RuntimeFrameNavigation(runtime, execution, rewind, tasks, debuggerState, fault, guest);
	const debuggerExecution = new RuntimeDebuggerExecution(runtime, debuggerState, execution, rewind, tasks, fault, guest, frameNavigation);
	const inspection = new RuntimeInspectionService(runtime, sources, guest, debuggerState, execution, tasks, rewind, fault, frameNavigation, debuggerExecution);
	const gameCapture = new GameCaptureService(presenter, presentation, tasks, encodePngImage);
	const terminal = new LuaTerminalSession(runtime, sources, guest, debuggerState, fault, tasks, execution, rewind);
	const actorExecution = new ActorExecutionService(runtime, sources, guest, debuggerState, fault, tasks, execution, rewind);
	const tooling = new RuntimeLuaTooling(sources, guest);
	const boots = new BootService(models, sources, tooling, fault, runtime, tasks, execution, audio, storage, new Map());
	return { boots, tooling, models, storage, actorExecution, debuggerExecution, terminal, audio, frameNavigation, gameCapture, presenter, presentation, backend, inspection, runtime, sources, guest, debuggerState, execution, tasks, rewind, fault };
}
