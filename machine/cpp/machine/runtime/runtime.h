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
#include "machine/runtime/lua_scratch.h"
#include "machine/memory/memory.h"
#include "machine/runtime/frame/loop.h"
#include "machine/runtime/input.h"
#include "machine/scheduler/frame.h"
#include "common/primitives.h"
#include <cstddef>
#include <memory>
#include <span>
#include <string>
#include <string_view>
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
	friend auto captureRuntimeSaveState(Runtime& runtime) -> RuntimeSaveState;
	friend void applyRuntimeSaveState(Runtime& runtime, const RuntimeSaveState& state);

	Runtime(
		const RuntimeOptions& options,
		RuntimeInputSource& input
	);
	~Runtime();

	// Non-copyable
	Runtime(const Runtime&) = delete;
	auto operator=(const Runtime&) -> Runtime& = delete;

	void boot();
	void enterFaultState();

	/**
	 * Check if the runtime is initialized.
	 */
	auto isInitialized() const -> bool { return m_luaInitialized; }

	/**
	 * Check if the runtime has failed.
	 */
	auto hasRuntimeFailed() const -> bool { return m_runtimeFailed; }

	void rebootSystem();

	void applyPublishedGxGpuPcrtcTiming(const GxGpuPcrtcTiming& pcrtcTiming);
	auto baseRamUsedBytes() const -> uint32_t;
	auto ramUsedBytes() const -> uint32_t;
	auto ramTotalBytes() const -> uint32_t;
	auto vramUsedBytes() const -> uint32_t;
	auto vramTotalBytes() const -> uint32_t;

	/**
	 * Call a CPU closure from native code. The returned span is invalidated by
	 * subsequent CPU execution, call entry, reset, or state restore.
	 */
	auto callClosure(Closure& fn, BuiltinArgsView args = {}) -> std::span<const Value>;

	/**
	 * Set a global variable.
	 */
	void setGlobal(std::string_view name, const Value& value);

	auto internString(std::string_view name) -> Value { return valueString(machine.cpu.stringPool().intern(name)); }

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
	auto isDrawPending() const -> bool { return m_runtimeFailed || m_pendingCall == PendingCall::Entry; }
	TimingState timing;
	FrameSchedulerState frameScheduler;
	CpuExecutionState cpuExecution;
	FrameLoopState frameLoop;
	VblankState vblank;
	LuaScratchState luaScratch;
private:
	enum class PendingCall {
		None,
		Entry,
	};
	void setupBuiltins();
	void finishSystemBoot();

	RuntimeInputSource& m_input;

	// Runtime core
	Memory m_memory;

public:
	Machine machine;

private:
	// State flags
	bool m_luaInitialized = false;
	bool m_runtimeFailed = false;
	PendingCall m_pendingCall = PendingCall::None;
};

} // namespace bmsx
