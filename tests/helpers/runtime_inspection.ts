import type { HostAudioOutput } from '../../hosts/common/audio_output';
import { HostExecutionControl } from '../../hosts/common/execution_control';
import { RenderPresentationState } from '../../hosts/common/presentation_state';
import { HostRewind } from '../../hosts/common/rewind';
import { RuntimeTaskQueue } from '../../hosts/common/runtime_task_queue';
import type { VideoPresenter } from '../../machine/ts/render/video_presenter';
import type { Runtime } from '../../machine/ts/machine/runtime/runtime';
import { createRuntimeDebuggerState } from '../../ide/runtime/debugger_state';
import { createRuntimeFaultState } from '../../ide/runtime/fault_state';
import { RuntimeInspectionService } from '../../ide/runtime/inspection';
import type { RuntimeSourceState } from '../../ide/runtime/sources';
import { SuspendedGuestSession } from '../../ide/runtime/suspended_guest';

/** Real control/inspection owners; presentation/audio are not exercised by read-only tests. */
export function createRuntimeInspectionFixture(runtime: Runtime, sources: RuntimeSourceState, guest = new SuspendedGuestSession(runtime)) {
	const audio = { mutePause() {}, muteRuntimeTask() {} } as unknown as HostAudioOutput;
	const presenter = { backend: { finishGxGpuReadbacks() {} } } as VideoPresenter;
	const execution = new HostExecutionControl(audio);
	const tasks = new RuntimeTaskQueue(audio, presenter);
	const debuggerState = createRuntimeDebuggerState(runtime, sources);
	const fault = createRuntimeFaultState();
	const rewind = new HostRewind(runtime, presenter, new RenderPresentationState(), tasks, audio, { log() {} });
	const inspection = new RuntimeInspectionService(runtime, sources, guest, debuggerState, execution, tasks, rewind, fault);
	return { inspection, runtime, sources, guest, debuggerState, execution, tasks, rewind, fault };
}
