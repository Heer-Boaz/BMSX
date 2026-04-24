#include "machine/runtime/save_state.h"

#include "machine/firmware/api.h"
#include "machine/runtime/cpu_state.h"
#include "machine/runtime/game/table.h"
#include "machine/runtime/render/state.h"
#include "machine/runtime/save_machine_state.h"
#include "machine/runtime/runtime.h"
#include "render/shared/queues.h"

namespace bmsx {

RuntimeSaveState captureRuntimeSaveState(const Runtime& runtime) {
	RuntimeSaveState state;
	state.machineState = captureRuntimeSaveMachineState(runtime);
	state.cpuState = captureRuntimeCpuState(runtime);
	state.storageState = runtime.m_api->captureStorageState();
	state.gameViewState = runtime.m_gameViewState;
	state.renderState = captureRuntimeRenderState();
	state.randomSeed = runtime.m_randomSeedValue;
	state.pendingEntryCall = runtime.m_pendingCall == Runtime::PendingCall::Entry;
	state.runtimeFailed = runtime.m_runtimeFailed;
	state.luaInitialized = runtime.m_luaInitialized;
	state.engineProgramActive = runtime.m_programSource == Runtime::ProgramSource::Engine;
	return state;
}

void applyRuntimeSaveState(Runtime& runtime, const RuntimeSaveState& state) {
	runtime.m_programSource = state.engineProgramActive ? Runtime::ProgramSource::Engine : Runtime::ProgramSource::Cart;
	applyRuntimeSaveMachineState(runtime, state.machineState);
	applyRuntimeCpuState(runtime, state.cpuState);
	runtime.m_api->restoreStorageState(state.storageState);
	runtime.m_gameViewState = state.gameViewState;
	applyRuntimeRenderState(state.renderState);
	runtime.m_randomSeedValue = state.randomSeed;
	runtime.m_pendingCall = state.pendingEntryCall ? Runtime::PendingCall::Entry : Runtime::PendingCall::None;
	runtime.m_runtimeFailed = state.runtimeFailed;
	runtime.m_luaInitialized = state.luaInitialized;
	syncRuntimeGameViewStateToTable(runtime);
	RenderQueues::resetTransientState();
}

} // namespace bmsx
