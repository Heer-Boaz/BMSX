#pragma once

#include "machine/cpu/cpu.h"
#include "machine/devices/dma/controller.h"
#include "machine/devices/geometry/controller.h"
#include "machine/devices/input/controller.h"
#include "machine/devices/audio/controller.h"
#include "machine/devices/irq/controller.h"
#include "machine/machine.h"
#include "machine/scheduler/device.h"
#include "machine/runtime/timing/index.h"
#include "machine/runtime/timing/state.h"
#include "machine/runtime/vblank.h"
#include "machine/runtime/cpu_executor.h"
#include "machine/runtime/options.h"
#include "machine/runtime/save_state.h"
#include "machine/runtime/history/history.h"
#include "machine/memory/memory.h"
#include "machine/runtime/frame/loop.h"
#include "machine/scheduler/frame.h"
#include "common/primitives.h"
#include <cstddef>
#include <memory>
#include <span>
#include <utility>

namespace bmsx {

struct GxGpuPcrtcTiming;

/**
 * Runtime owns the live machine and full runtime save-state boundaries.
 * Platform byte serialization is a separate layer above those runtime-owned
 * contracts. Timing, CPU execution, frame scheduling, cart boot, and ROM memory
 * responsibilities live in their runtime submodules.
 */
class Runtime {
public:
	friend class FrameLoopState;
	friend class FrameSchedulerState;
	friend auto captureRuntimeSaveState(Runtime& runtime, CpuSnapshot snapshot) -> RuntimeSaveState;
	friend void applyRuntimeSaveState(Runtime& runtime, const RuntimeSaveState& state, RuntimeRestoreOrigin origin);

	Runtime(
		const RuntimeOptions& options,
		InputControllerInputSource& input
	);
	~Runtime();

	// Non-copyable
	Runtime(const Runtime&) = delete;
	auto operator=(const Runtime&) -> Runtime& = delete;

	void boot();

	void rebootSystem();
	void suspendExecution();

	void applyPublishedGxGpuPcrtcTiming(const GxGpuPcrtcTiming& pcrtcTiming);

	/**
	 * Call a CPU closure from native code. The returned span is invalidated by
	 * subsequent CPU execution, call entry, reset, or state restore.
	 */
	auto callClosure(Closure& fn, BuiltinArgsView args = {}) -> std::span<const Value>;
	auto readCompletionValues() const -> std::span<const Value>;
	bool completionCallPending() const;

	void resetHardwareState();
	void resetForSystemBoot();
	auto cpuUsageCyclesUsed() const -> i64 {
		return frameLoop.frameActive
			? frameLoop.frameState.activeCpuUsedCycles
			: frameScheduler.lastTickCpuUsedCycles;
	}
	auto cpuUsageCyclesGranted() const -> i64 {
		return frameLoop.frameActive
			? frameLoop.frameState.cycleBudgetGranted
			: (frameScheduler.lastTickSequence == 0 ? timing.cycleBudgetPerFrame : frameScheduler.lastTickCpuBudgetGranted);
	}
	auto isDrawPending() const -> bool { return m_pendingCall == PendingCall::Entry; }
	TimingState timing;
	FrameSchedulerState frameScheduler;
	CpuExecutionState cpuExecution;
	FrameLoopState frameLoop;
	VblankState vblank;
	RuntimeHistory history;
private:
	enum class PendingCall {
		None,
		Entry,
	};
	void finishSystemBoot();

	// Runtime core
	Memory m_memory;

public:
	Machine machine;

private:
	PendingCall m_pendingCall = PendingCall::None;
};

} // namespace bmsx
