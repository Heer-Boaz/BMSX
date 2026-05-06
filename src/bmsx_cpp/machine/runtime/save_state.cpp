#include "machine/runtime/save_state.h"

#include "machine/runtime/cpu_state.h"
#include "render/runtime_state.h"
#include "render/shared/queues.h"
#include "machine/runtime/save_machine_state.h"
#include "machine/runtime/runtime.h"
#include "render/vdp/context_state.h"

namespace bmsx {

RuntimeSaveState captureRuntimeSaveState(Runtime& runtime) {
	captureVdpContextState(runtime.machine.vdp);
	RuntimeSaveState state;
	state.machineState = captureRuntimeSaveMachineState(runtime);
	state.cpuState = captureRuntimeCpuState(runtime);
	state.renderState = captureRuntimeRenderState();
	state.systemProgramActive = !runtime.m_cartProgramStarted;
	state.luaInitialized = runtime.m_luaInitialized;
	state.runtimeFailed = runtime.m_runtimeFailed;
	state.randomSeed = runtime.m_randomSeedValue;
	state.pendingEntryCall = runtime.m_pendingCall == Runtime::PendingCall::Entry;
	return state;
}

void applyRuntimeSaveState(Runtime& runtime, const RuntimeSaveState& state) {
	if (state.systemProgramActive) {
		runtime.enterSystemFirmware();
	} else {
		runtime.enterCartProgram();
	}
	applyRuntimeSaveMachineState(runtime, state.machineState);
	restoreVdpContextState(runtime.machine.vdp);
	applyRuntimeCpuState(runtime, state.cpuState);
	applyRuntimeRenderState(state.renderState);
	runtime.m_luaInitialized = state.luaInitialized;
	runtime.m_runtimeFailed = state.runtimeFailed;
	runtime.m_randomSeedValue = state.randomSeed;
	runtime.m_pendingCall = state.pendingEntryCall ? Runtime::PendingCall::Entry : Runtime::PendingCall::None;
	RenderQueues::clearBackQueues();
}

} // namespace bmsx
