#pragma once

#include "machine/cpu/cpu.h"
#include "machine/devices/dma/controller.h"
#include "machine/devices/geometry/controller.h"
#include "machine/devices/imgdec/controller.h"
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
#include "machine/runtime/cart_boot.h"
#include "machine/runtime/options.h"
#include "machine/runtime/save_state.h"
#include "machine/runtime/resume_snapshot.h"
#include "machine/program/loader.h"
#include "machine/program/scratch.h"
#include "machine/memory/memory.h"
#include "machine/runtime/frame/loop.h"
#include "machine/runtime/input.h"
#include "machine/scheduler/frame.h"
#include "machine/devices/vdp/vdp.h"
#include "common/primitives.h"
#include <cstddef>
#include <memory>
#include <optional>
#include <regex>
#include <string>
#include <string_view>
#include <unordered_map>
#include <utility>
#include <vector>

namespace bmsx {

// Forward declarations
struct ProgramImage;
class RuntimeRomPackage;
class GameView;
class MicrotaskQueue;

/**
 * Runtime owns the live machine, Lua API bindings, hot-resume snapshot state,
 * and full runtime save-state boundaries. Platform byte serialization is a
 * separate layer above those runtime-owned contracts. Timing, CPU execution,
 * frame scheduling, cart boot, and ROM memory responsibilities live in
 * their runtime submodules.
 */
class Runtime {
public:
	friend class FrameLoopState;
	friend class FrameSchedulerState;
	friend class CartBootState;
	friend auto captureRuntimeSaveState(Runtime& runtime) -> RuntimeSaveState;
	friend void applyRuntimeSaveState(Runtime& runtime, const RuntimeSaveState& state);
	friend auto captureRuntimeResumeSnapshot(const Runtime& runtime) -> RuntimeResumeSnapshot;
	friend void applyRuntimeResumeSnapshot(Runtime& runtime, const RuntimeResumeSnapshot& state);
	friend auto captureRuntimeCpuState(const Runtime& runtime) -> CpuRuntimeState;
	friend void applyRuntimeCpuState(Runtime& runtime, const CpuRuntimeState& state);
	friend void registerMathAndEasingBuiltins(Runtime& runtime);
	friend void seedSystemGlobals(Runtime& runtime);

	Runtime(
		const RuntimeOptions& options,
		RuntimeInputSource& input,
		MicrotaskQueue& microtasks,
		GameView& view
	);
	~Runtime();

	// Non-copyable
	Runtime(const Runtime&) = delete;
	auto operator=(const Runtime&) -> Runtime& = delete;

	/**
	 * Boot the runtime with a compiled program.
	 */
	void boot(const ProgramImage& image, ProgramMetadata* metadata, ProgramVectorTable vectors, uint32_t dataBaseAddress, uint32_t bssBaseAddress, const std::vector<std::string>& staticModulePaths);
	void handleLuaError(const std::string& message);

	/**
	 * Request a program reload.
	 */
	void requestProgramReload();

	/**
	 * Check if the runtime is initialized.
	 */
	auto isInitialized() const -> bool { return m_luaInitialized; }

	/**
	 * Check if the runtime has failed.
	 */
	auto hasRuntimeFailed() const -> bool { return m_runtimeFailed; }

	/**
	 * Enable/disable tick execution.
	 */
	void setTickEnabled(bool enabled) { m_tickEnabled = enabled; }
	auto isTickEnabled() const -> bool { return m_tickEnabled; }

	auto isCartProgramStarted() const -> bool { return m_cartProgramStarted; }
	auto isRebootRequested() const -> bool { return m_rebootRequested; }
	void clearRebootRequest() { m_rebootRequested = false; }
	auto hasCartEntry() const -> bool { return m_cartVectors.has_value(); }
	void setLinkedCartVectors(ProgramVectorTable vectors, uint32_t dataBaseAddress, uint32_t bssBaseAddress, std::vector<std::string> staticModulePaths);
	void enterSystemFirmware();
	void enterCartProgram();
	void startCartProgram();

	auto frameDeltaMs() const -> f64 { return frameLoop.frameDeltaMs; }
	auto machineElapsedMs() const -> f64;
	auto baseRamUsedBytes() const -> uint32_t;
	auto ramUsedBytes() const -> uint32_t;
	auto ramTotalBytes() const -> uint32_t;
	auto vramUsedBytes() const -> uint32_t;
	auto vramTotalBytes() const -> uint32_t;

	auto view() -> GameView& { return m_view; }
	auto view() const -> const GameView& { return m_view; }
	auto machineManifest() const -> const MachineManifest& { return *m_machineManifest; }
	auto cartManifest() const -> const CartManifest*;
	auto cartEntryPath() const -> const std::string*;
	auto cartProjectRootPath() const -> const std::string*;
	auto activeRom() -> RuntimeRomPackage&;
	auto activeRom() const -> const RuntimeRomPackage&;
	auto systemRom() -> RuntimeRomPackage&;
	auto systemRom() const -> const RuntimeRomPackage&;
	auto cartRom() -> RuntimeRomPackage*;
	auto cartRom() const -> const RuntimeRomPackage*;
	auto programVectors() const -> const ProgramVectorTable& { return *m_programVectors; }
	void setRuntimeEnvironment(
		const MachineManifest& machineManifest,
		RuntimeOptions::RomSpan systemRomBytes,
		RuntimeOptions::RomSpan cartRomBytes,
		RuntimeRomPackage& activeRom,
		RuntimeRomPackage& systemRom,
		RuntimeRomPackage* cartRom
	);



	/**
	 * Call a Lua function from native code.
	 */
	void callLuaFunctionInto(Closure* fn, NativeArgsView args, NativeResults& out);

	/**
	 * Set a global variable.
	 */
	void setGlobal(std::string_view name, const Value& value);

	auto internString(std::string_view name) -> Value { return valueString(machine.cpu.stringPool().intern(name)); }

	/**
	 * Register a native function as a global.
	 */
	void registerNativeFunction(std::string_view name, NativeFunctionInvoke fn, std::optional<NativeFnCost> cost = std::nullopt);

	void startLoadedProgram(ProgramVectorTable vectors, const std::vector<std::string>& staticModulePaths);
	auto requireModule(const std::string& moduleName) -> Value;

	void resetHardwareState();
	void resetRuntimeForProgramReload();
	auto updateCountTotal() const -> i64 { return m_debugUpdateCountTotal; }
	auto lastTickSequence() const -> i64 { return frameScheduler.lastTickSequence; }
	auto lastTickBudgetRemaining() const -> int { return frameScheduler.lastTickBudgetRemaining; }
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
	auto vdpWorkUnitsPerSec() const -> int { return timing.vdpWorkUnitsPerSec; }
	auto lastTickVisualFrameCommitted() const -> bool { return frameScheduler.lastTickVisualFrameCommitted; }
	auto vdpUsageWorkUnitsLast() const -> int { return machine.vdp.lastFrameCost(); }
	auto vdpUsageFrameHeld() const -> bool { return machine.vdp.lastFrameHeld(); }
	auto isDrawPending() const -> bool { return m_runtimeFailed || m_pendingCall == PendingCall::Entry; }
	void refreshMemoryMap();
	TimingState timing;
	FrameSchedulerState frameScheduler;
	CpuExecutionState cpuExecution;
	FrameLoopState frameLoop;
	VblankState vblank;
	CartBootState cartBoot;
	LuaScratchState luaScratch;

private:
	enum class PendingCall {
		None,
		Entry,
	};
	void setupBuiltins();
	void runStaticModuleInitializers(const std::vector<std::string>& paths);
	void runStaticModuleInitializer(const std::string& path);
	auto buildLuaPatternRegex(const std::string& pattern) -> const std::regex&;
	auto translateLuaPatternEscape(char token, bool inClass) const -> std::string;
	auto valueToString(const Value& value) const -> std::string;
	auto nextRandom() -> double;
	auto formatLuaString(const std::string& templateStr, NativeArgsView args, size_t argStart) const -> std::string;
	void logDebugState() const;
	void logLuaCallStack() const;
	void refreshMemoryMapGlobals();

	RuntimeOptions::RomSpan m_systemRomBytes;
	RuntimeOptions::RomSpan m_cartRomBytes;
	const MachineManifest* m_machineManifest = nullptr;
	RuntimeRomPackage* m_activeRomPackage = nullptr;
	RuntimeRomPackage* m_systemRomPackage = nullptr;
	RuntimeRomPackage* m_cartRomPackage = nullptr;
	GameView& m_view;

	// Runtime core
	Memory m_memory;

public:
	Machine machine;

private:
	std::unique_ptr<Program> m_programStorage;
	Program* m_program = nullptr;
	ProgramMetadata* m_programMetadata = nullptr;

	std::optional<ProgramVectorTable> m_cartVectors;
	std::optional<ProgramVectorTable> m_programVectors;
	std::optional<uint32_t> m_cartDataBaseAddress;
	std::optional<uint32_t> m_cartBssBaseAddress;
	std::vector<std::string> m_cartStaticModulePaths;
	bool m_cartProgramStarted = false;

	// State flags
	bool m_luaInitialized = false;
	bool m_runtimeFailed = false;
	bool m_tickEnabled = true;
	bool m_rebootRequested = false;
	std::optional<std::string> m_hostFaultMessage;

	// Cached function references
	Value m_pairsIterator = valueNil();
	Value m_ipairsIterator = valueNil();
	PendingCall m_pendingCall = PendingCall::None;
	uint32_t m_randomSeedValue = 0;

	std::unordered_map<std::string, int> m_moduleProtos;
	std::unordered_map<std::string, Value> m_moduleCache;
	std::unordered_map<std::string, std::unique_ptr<std::regex>> m_luaPatternRegexCache;
	i64 m_debugUpdateCountTotal = 0;
};

} // namespace bmsx
