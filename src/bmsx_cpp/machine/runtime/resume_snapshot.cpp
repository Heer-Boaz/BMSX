#include "machine/runtime/resume_snapshot.h"

#include "machine/runtime/machine_state.h"
#include "render/runtime/state.h"
#include "render/shared/queues.h"
#include "render/vdp/context_state.h"
#include "machine/runtime/runtime.h"

namespace bmsx {

RuntimeResumeSnapshot captureRuntimeResumeSnapshot(const Runtime& runtime) {
	RuntimeResumeSnapshot snapshot;
	snapshot.machineState = captureRuntimeMachineState(runtime);
	const_cast<CPU&>(runtime.machine.cpu).syncGlobalSlotsToTable();
	runtime.machine.cpu.globals->forEachEntry([&snapshot](Value key, Value value) {
		snapshot.globals.emplace_back(key, value);
	});
	snapshot.renderState = captureRuntimeRenderState();
	snapshot.randomSeed = runtime.m_randomSeedValue;
	snapshot.pendingEntryCall = runtime.m_pendingCall == Runtime::PendingCall::Entry;
	return snapshot;
}

void applyRuntimeResumeSnapshot(Runtime& runtime, const RuntimeResumeSnapshot& snapshot) {
	applyRuntimeMachineState(runtime, snapshot.machineState);
	restoreVdpContextState(runtime.machine.vdp);
	applyRuntimeRenderState(snapshot.renderState);
	runtime.m_randomSeedValue = snapshot.randomSeed;
	runtime.m_pendingCall = snapshot.pendingEntryCall ? Runtime::PendingCall::Entry : Runtime::PendingCall::None;

	runtime.machine.cpu.globals->clear();
	runtime.machine.cpu.clearGlobalSlots();
	runtime.machine.cpu.setProgram(runtime.m_program, runtime.m_programMetadata);
	for (const auto& [key, value] : snapshot.globals) {
		runtime.machine.cpu.setGlobalByKey(key, value);
	}
	RenderQueues::clearBackQueues();
}

} // namespace bmsx
