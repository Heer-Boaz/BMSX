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
#include "render/presentation_state.h"
#include "machine/scheduler/device.h"
#include "machine/runtime/timing.h"
#include "machine/runtime/vblank.h"
#include "machine/runtime/cpu_executor.h"
#include "machine/runtime/cart_boot.h"
#include "machine/program/scratch.h"
#include "machine/memory/memory.h"
#include "machine/runtime/frame_loop.h"
#include "machine/scheduler/frame.h"
#include "machine/devices/vdp/vdp.h"
#include "render/gameview.h"
#include "render/shared/submissions.h"
#include "core/primitives.h"
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
class Api;
struct ProgramAsset;
class RuntimeAssets;
class ResourceUsageDetector;

constexpr int DEFAULT_CYCLE_BUDGET = 1'000'000;

/**
 * Viewport size configuration.
 */
struct Viewport {
	int x = 0;
	int y = 0;
};

/**
 * Runtime options for initialization.
 */
struct RuntimeOptions {
	int playerIndex = 0;
	Viewport viewport{0, 0};
	CanonicalizationType canonicalization = CanonicalizationType::None;
	i64 ufpsScaled = DEFAULT_UFPS_SCALED;
	i64 cpuHz = 0;
	int cycleBudgetPerFrame = DEFAULT_CYCLE_BUDGET;
	int vblankCycles = 0;
	int vdpWorkUnitsPerSec = 25'600;
	int geoWorkUnitsPerSec = 16'384'000;
};

/**
 * Runtime state snapshot for save/load.
 */
struct RuntimeState {
	MachineState machine;
	std::vector<std::pair<Value, Value>> globals; // key-value pairs
	std::string cartDataNamespace;
	std::vector<double> persistentData;
	uint32_t randomSeed = 0;
	bool pendingEntryCall = false;
	int cyclesIntoFrame = 0;
};

/**
 * Runtime owns the live machine, Lua API bindings, and save/load state.
 * Timing, CPU execution, frame scheduling, cart boot, and asset-memory
 * responsibilities live in their runtime submodules.
 */
class Runtime {
public:
	friend class FrameLoopState;
	friend class FrameSchedulerState;
	friend class VblankState;
	friend class CartBootState;

	enum class ProgramSource {
		Engine,
		Cart,
	};
	/**
	 * Create the singleton instance. Throws if already created.
	 */
	static Runtime& createInstance(const RuntimeOptions& options);

	/**
	 * Get the singleton instance. Assumes already created.
	 */
	static Runtime& instance();

	/**
	 * Check if an instance exists.
	 */
	static bool hasInstance();

	/**
	 * Destroy the singleton instance.
	 */
	static void destroy();

	// Non-copyable
	Runtime(const Runtime&) = delete;
	Runtime& operator=(const Runtime&) = delete;

	/**
	 * Boot the runtime with a compiled program.
	 */
	void boot(Program* program, ProgramMetadata* metadata, int entryProtoIndex);
	void boot(const ProgramAsset& asset, ProgramMetadata* metadata);
	void handleLuaError(const std::string& message);

	/**
	 * Tick IDE input handling.
	 */
	void tickIdeInput();

	/**
	 * Tick IDE update phase.
	 */
	void tickIDE();

	/**
	 * Tick IDE draw phase.
	 */
	void tickIDEDraw();

	/**
	 * Tick terminal input handling.
	 */
	void tickTerminalInput();

	/**
	 * Tick terminal mode update.
	 */
	void tickTerminalMode();

	/**
	 * Tick terminal mode draw.
	 */
	void tickTerminalModeDraw();

	/**
	 * Request a program reload.
	 */
	void requestProgramReload();

	/**
	 * Capture current runtime state for save.
	 */
	RuntimeState captureCurrentState() const;

	/**
	 * Restore runtime state from snapshot.
	 */
	void applyState(const RuntimeState& state);

	/**
	 * Check if the runtime is initialized.
	 */
	bool isInitialized() const { return m_luaInitialized; }

	/**
	 * Check if the runtime has failed.
	 */
	bool hasRuntimeFailed() const { return m_runtimeFailed; }

	/**
	 * Enable/disable tick execution.
	 */
	void setTickEnabled(bool enabled) { m_tickEnabled = enabled; }
	bool isTickEnabled() const { return m_tickEnabled; }

	void setProgramSource(ProgramSource source) { m_programSource = source; }
	bool isEngineProgramActive() const { return m_programSource == ProgramSource::Engine; }

	void setVdpDitherType(i32 type) { m_machine.vdp().setDitherType(type); }

	f64 frameDeltaMs() const { return frameLoop.frameDeltaMs; }

	/**
	 * Get the viewport size.
	 */
	const Viewport& viewport() const { return m_viewport; }

	Machine& machine() { return m_machine; }
	const Machine& machine() const { return m_machine; }

	/**
	 * Get the API instance.
	 */
	Api& api();

	/**
	 * Call a Lua function from native code.
	 */
	void callLuaFunctionInto(Closure* fn, NativeArgsView args, NativeResults& out);

	/**
	 * Get a global variable by name.
	 */
	Value getGlobal(std::string_view name);

	/**
	 * Set a global variable.
	 */
	void setGlobal(std::string_view name, const Value& value);

	/**
	 * Register a native function as a global.
	 */
	void registerNativeFunction(std::string_view name, NativeFunctionInvoke fn, std::optional<NativeFnCost> cost = std::nullopt);

	void setCanonicalization(CanonicalizationType canonicalization);
	void resetHardwareState();
	void resetRuntimeForProgramReload();
	i64 updateCountTotal() const { return m_debugUpdateCountTotal; }
	i64 lastTickSequence() const { return frameScheduler.lastTickSequence; }
	int lastTickBudgetRemaining() const { return frameScheduler.lastTickBudgetRemaining; }
	int lastTickBudgetGranted() const { return frameScheduler.lastTickSequence == 0 ? timing.cycleBudgetPerFrame : frameScheduler.lastTickBudgetGranted; }
	int cpuUsedCyclesLastTick() const { return frameScheduler.lastTickSequence == 0 ? 0 : frameScheduler.lastTickCpuUsedCycles; }
	int activeCpuCyclesGrantedLastTick() const { return lastTickBudgetGranted(); }
	int activeCpuUsedCyclesLastTick() const { return cpuUsedCyclesLastTick(); }
	int vdpWorkUnitsPerSec() const { return timing.vdpWorkUnitsPerSec; }
	bool lastTickVisualFrameCommitted() const { return frameScheduler.lastTickVisualFrameCommitted; }
	int lastTickVdpFrameCost() const { return frameScheduler.lastTickVdpFrameCost; }
	bool lastTickVdpFrameHeld() const { return frameScheduler.lastTickVdpFrameHeld; }
	uint32_t trackedRamUsedBytes() const;
	uint32_t trackedVramUsedBytes() const;
	uint32_t trackedVramTotalBytes() const { return m_machine.vdp().trackedTotalVramBytes(); }
	bool isDrawPending() const;
	Value canonicalizeIdentifier(std::string_view value);
	void refreshMemoryMap();
	void restoreVramSlotTextures();
	void captureVramTextureSnapshots();
	RenderPresentationState screen;
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
	explicit Runtime(const RuntimeOptions& options);
	~Runtime();

	void setupBuiltins();
	void runEngineBuiltinPrelude();
	void queueLifecycleHandlers(bool runInit, bool runNewGame);
	Value requireModule(const std::string& moduleName);
	const std::regex& buildLuaPatternRegex(const std::string& pattern);
	std::string translateLuaPatternEscape(char token, bool inClass) const;
	std::string valueToString(const Value& value) const;
	double nextRandom();
	std::string formatLuaString(const std::string& templateStr, NativeArgsView args, size_t argStart) const;
	void logDebugState() const;
	void logLuaCallStack() const;
	void refreshMemoryMapGlobals();
	bool hasEntryContinuation() const;

	static Runtime* s_instance;

		// Runtime core
		std::unique_ptr<Api> m_api;
		Machine m_machine;
	Program* m_program = nullptr;
	ProgramMetadata* m_programMetadata = nullptr;

		// Configuration
	Viewport m_viewport{0, 0};
	CanonicalizationType m_canonicalization = CanonicalizationType::None;
	ProgramSource m_programSource = ProgramSource::Cart;

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
	std::unordered_map<std::string, std::string> m_moduleAliases;
	std::unordered_map<std::string, Value> m_moduleCache;
	std::unordered_map<std::string, std::unique_ptr<std::regex>> m_luaPatternRegexCache;
	i64 m_debugUpdateCountTotal = 0;
};

} // namespace bmsx
