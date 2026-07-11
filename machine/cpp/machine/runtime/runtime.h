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
struct LinkedBootProgramImage;

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
	void boot(const ProgramImage& image, std::unique_ptr<ProgramMetadata> metadata, ProgramVectorTable vectors, uint32_t dataBaseAddress, uint32_t bssBaseAddress, std::span<const std::string> systemStaticModulePaths, std::span<const std::string> cartStaticModulePaths);
	void bootLinkedProgramImage(LinkedBootProgramImage&& linked);
	void handleLuaError(const std::string& message);

	/**
	 * Check if the runtime is initialized.
	 */
	auto isInitialized() const -> bool { return m_luaInitialized; }

	/**
	 * Check if the runtime has failed.
	 */
	auto hasRuntimeFailed() const -> bool { return m_runtimeFailed; }

	void clearLinkedCartProgram(uint32_t dataByteLength);
	void enterSystemFirmware();
	void enterCartProgram();
	void startCartProgram();

	auto machineTimeMs() const -> uint32_t;
	auto machineElapsedMs() const -> f64;
	void applyUfpsScaled(i64 ufpsScaled);
	void applyPsxGpuDisplayModeWord(uint32_t gpuDisplayModeWord);
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
	auto cpuUsageCyclesUsed() const -> int {
		return frameLoop.frameActive
			? frameLoop.frameState.activeCpuUsedCycles
			: frameScheduler.lastTickCpuUsedCycles;
	}
	auto cpuUsageCyclesGranted() const -> int {
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
	std::vector<std::string> luaOutputLines;
	std::string luaOutputLineBuffer;

private:
	enum class PendingCall {
		None,
		Entry,
	};
	void setupBuiltins();
	void clearLuaBootPrimitives();
	void setLinkedCartProgram(ProgramVectorTable vectors, uint32_t programDataBaseAddress, uint32_t programBssBaseAddress, uint32_t cartDataBaseAddress, uint32_t cartBssBaseAddress, std::vector<std::string> staticModulePaths);
	void runStaticModuleInitializers(std::span<const std::string> paths);
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

	ProgramVectorTable m_cartVectors;
	uint32_t m_programDataBaseAddress = PROGRAM_STATIC_RAM_BASE;
	uint32_t m_programBssBaseAddress = PROGRAM_STATIC_RAM_BASE;
	uint32_t m_cartDataBaseAddress = PROGRAM_STATIC_RAM_BASE;
	uint32_t m_cartBssBaseAddress = PROGRAM_STATIC_RAM_BASE;
	ProgramVectorTable m_programVectorsStorage;
	std::vector<std::string> m_cartStaticModulePaths;

	// State flags
	bool m_luaInitialized = false;
	bool m_runtimeFailed = false;
	static size_t getBaseRamUsedBytesThunk(void* context);
	static size_t collectTrackedHeapBytesThunk(void* context);
	static Value onTimeMsReadThunk(void* context, uint32_t addr);
	Value onTimeMsRead(uint32_t addr) const;
	static Value onFrameMsReadThunk(void* context, uint32_t addr);
	Value onFrameMsRead(uint32_t addr) const;
	static Value onCyclesPerFrameReadThunk(void* context, uint32_t addr);
	Value onCyclesPerFrameRead(uint32_t addr) const;
	static void onGxGpuGp1WriteThunk(void* context, uint32_t addr, Value value);
	void applyPsxGpuDisplayTimingWord(uint32_t gpuDisplayModeWord);
	static void onLuaOutputCodepointWriteThunk(void* context, uint32_t addr, Value value);
	static void onLuaOutputFlushWriteThunk(void* context, uint32_t addr, Value value);
	void onLuaOutputFlushWrite(uint32_t addr, Value value);

	PendingCall m_pendingCall = PendingCall::None;

	std::unordered_map<std::string, Value> m_moduleCache;
	i64 m_debugUpdateCountTotal = 0;
};

} // namespace bmsx
