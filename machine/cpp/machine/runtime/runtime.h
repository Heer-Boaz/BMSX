#pragma once

#include "machine/cpu/cpu.h"
#include "machine/devices/dma/controller.h"
#include "machine/devices/geometry/controller.h"
#include "machine/devices/input/controller.h"
#include "machine/devices/audio/controller.h"
#include "machine/devices/irq/controller.h"
#include "machine/bus/io.h"
#include "machine/machine.h"
#include "machine/scheduler/device.h"
#include "machine/runtime/timing/index.h"
#include "machine/runtime/timing/state.h"
#include "machine/runtime/vblank.h"
#include "machine/runtime/cpu_executor.h"
#include "machine/runtime/cpu_state.h"
#include "machine/runtime/options.h"
#include "machine/runtime/save_state.h"
#include "machine/program/loader.h"
#include "machine/program/scratch.h"
#include "machine/memory/bus_signals.h"
#include "machine/memory/memory.h"
#include "machine/runtime/frame/loop.h"
#include "machine/runtime/host_fault.h"
#include "machine/runtime/input.h"
#include "machine/scheduler/frame.h"
#include "machine/memory/map.h"
#include "common/primitives.h"
#include <cstddef>
#include <memory>
#include <span>
#include <string>
#include <string_view>
#include <unordered_map>
#include <utility>
#include <vector>

namespace bmsx {

// Forward declarations
struct ProgramImage;
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
	friend auto captureRuntimeCpuState(const Runtime& runtime) -> CpuRuntimeState;
	friend void applyRuntimeCpuState(Runtime& runtime, const CpuRuntimeState& state);

	Runtime(
		const RuntimeOptions& options,
		RuntimeInputSource& input
	);
	~Runtime();

	// Non-copyable
	Runtime(const Runtime&) = delete;
	auto operator=(const Runtime&) -> Runtime& = delete;

	/**
	 * Boot the runtime with a compiled program.
	 */
	void boot(
		const ProgramImage& systemImage,
		std::unique_ptr<ProgramMetadata> systemMetadata,
		const ProgramImage* cartImage,
		std::unique_ptr<ProgramMetadata> cartMetadata,
		ProgramBootTarget bootTarget
	);
	void handleLuaError(const std::string& message);

	/**
	 * Check if the runtime is initialized.
	 */
	auto isInitialized() const -> bool { return m_luaInitialized; }

	/**
	 * Check if the runtime has failed.
	 */
	auto hasRuntimeFailed() const -> bool { return m_runtimeFailed; }

	void enterSystemFirmware();
	void enterCartProgram();
	void startCartProgram();
	void rebootSystemProgram();

	auto machineTimeMs() const -> uint32_t;
	auto machineElapsedMs() const -> f64;
	void applyUfpsScaled(i64 ufpsScaled);
	void applyPublishedGxGpuPcrtcTiming(const GxGpuPcrtcTiming& pcrtcTiming);
	auto baseRamUsedBytes() const -> uint32_t;
	auto ramUsedBytes() const -> uint32_t;
	auto ramTotalBytes() const -> uint32_t;
	auto vramUsedBytes() const -> uint32_t;
	auto vramTotalBytes() const -> uint32_t;

	/**
	 * Call a CPU closure from native code.
	 */
	void callClosureInto(Closure& fn, NativeArgsView args, NativeResults& out);

	/**
	 * Set a global variable.
	 */
	void setGlobal(std::string_view name, const Value& value);

	auto internString(std::string_view name) -> Value { return valueString(machine.cpu.stringPool().intern(name)); }

	void startLoadedProgram(ProgramVectorTable vectors, std::span<const std::string> systemStaticModulePaths, std::span<const std::string> cartStaticModulePaths);

	void resetHardwareState();
	void resetRuntimeForProgramReload();
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
	void clearLuaBootPrimitives();
	void runStaticModuleInitializers(std::span<const std::string> paths);
	void runSectionInitializer(int protoIndex, u32 statusWord);
	void runStaticModuleInitializer(const std::string& path);
	auto valueToString(const Value& value) const -> std::string;
	void logDebugState() const;
	void logLuaCallStack() const;

	RuntimeInputSource& m_input;

	// Runtime core
	Memory m_memory;

public:
	Machine machine;
	HostFaultState hostFault;
	ProgramVectorTable* programVectors = nullptr;
	bool cartEntryAvailable = false;
	bool cartProgramStarted = false;

private:
	std::unique_ptr<Program> m_programStorage;
	Program* m_program = nullptr;
	ProgramRuntimeSymbols m_programRuntimeSymbols;
	std::unique_ptr<ProgramMetadata> m_programMetadataStorage;
	ProgramMetadata* m_programMetadata = nullptr;

	ProgramVectorTable m_systemVectors;
	ProgramVectorTable m_cartVectors;
	std::vector<std::string> m_systemStaticModulePaths;
	ProgramVectorTable m_programVectorsStorage;
	std::vector<std::string> m_cartStaticModulePaths;

	// State flags
	bool m_luaInitialized = false;
	bool m_runtimeFailed = false;
	static size_t getBaseRamUsedBytesThunk(void* context);
	static size_t collectTrackedHeapBytesThunk(void* context);
	static Value onTimeMsReadThunk(void* context, uint32_t addr, MappedBusSignals busSignals);
	Value onTimeMsRead(uint32_t addr) const;
	static Value onFrameMsReadThunk(void* context, uint32_t addr, MappedBusSignals busSignals);
	Value onFrameMsRead(uint32_t addr) const;
	static Value onCyclesPerFrameReadThunk(void* context, uint32_t addr, MappedBusSignals busSignals);
	Value onCyclesPerFrameRead(uint32_t addr) const;
	static void onGxGpuGp1WriteThunk(void* context, uint32_t addr, Value value, MappedBusSignals busSignals);
	PendingCall m_pendingCall = PendingCall::None;

	std::unordered_map<std::string, Value> m_moduleCache;
	i64 m_debugUpdateCountTotal = 0;
};

} // namespace bmsx
