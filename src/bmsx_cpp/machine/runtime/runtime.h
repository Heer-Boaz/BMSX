#pragma once

#include "machine/cpu/cpu.h"
#include "machine/devices/dma/dma_controller.h"
#include "machine/devices/geometry/geometry_controller.h"
#include "machine/devices/imgdec/imgdec_controller.h"
#include "machine/devices/input/input_controller.h"
#include "machine/devices/audio/audio_controller.h"
#include "machine/devices/irq/irq_controller.h"
#include "machine/bus/io.h"
#include "machine/machine.h"
#include "machine/runtime/runtime_screen.h"
#include "machine/scheduler/device_scheduler.h"
#include "machine/runtime/runtime_timing.h"
#include "machine/memory/memory.h"
#include "machine/runtime/runtime_frame_loop.h"
#include "machine/runtime/runtime_machine_scheduler.h"
#include "machine/devices/vdp/vdp.h"
#include "render/gameview.h"
#include "render/shared/render_types.h"
#include "core/types.h"
#include <array>
#include <chrono>
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
 * Runtime frame state for coordinating update execution.
 */
struct FrameState {
	bool haltGame = false;
	bool updateExecuted = false;
	bool luaFaulted = false;
	int cycleBudgetRemaining = 0;
	int cycleBudgetGranted = 0;
	int cycleCarryGranted = 0;
	int activeCpuUsedCycles = 0;
};

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
	std::vector<Value> ioMemory;
	std::vector<std::pair<Value, Value>> globals; // key-value pairs
	std::string cartDataNamespace;
	std::vector<double> persistentData;
	uint32_t randomSeed = 0;
	bool pendingEntryCall = false;
	std::vector<u8> assetMemory;
	std::array<i32, 2> atlasSlots{{-1, -1}};
	std::optional<SkyboxImageIds> skyboxFaceIds;
	i32 vdpDitherType = 0;
	int cyclesIntoFrame = 0;
	bool inputSampleArmed = false;
};

/**
 * Runtime - the main Lua runtime coordinator.
 *
 * Manages:
 * - CPU bytecode execution
 * - API bindings
 * - I/O command processing
 * - Editor/terminal mode coordination
 * - State save/restore
 */
class Runtime {
public:
	friend class RuntimeFrameLoopState;
	friend class RuntimeMachineSchedulerState;

	enum class ProgramSource {
		Engine,
		Cart,
	};
	enum class AssetBuildMode {
		Full,
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
	 * Tick the runtime update phase (called by BmsxCartUpdateSystem).
	 */
	bool tickUpdate();

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
	void raiseEngineIrq(uint32_t mask);
	void resetCartBootState();

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
	void setSkyboxImages(const SkyboxImageIds& ids);
	void clearSkybox();

	f64 frameDeltaMs() const { return m_frameDeltaMs; }

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
	std::vector<Value> callLuaFunction(Closure* fn, const std::vector<Value>& args);
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
	void setCpuHz(i64 hz);
	void applyActiveMachineTiming(i64 cpuHz);
	void setTransferRates(i64 imgDecBytesPerSec, i64 dmaBytesPerSecIso, i64 dmaBytesPerSecBulk, int vdpWorkUnitsPerSec, int geoWorkUnitsPerSec);
	i64 cpuHz() const { return m_cpuHz; }
	void setVblankCycles(int cycles);
	void setVdpWorkUnitsPerSec(int workUnitsPerSec);
	void setGeoWorkUnitsPerSec(int workUnitsPerSec);
	void resetHardwareState();
	void resetRenderBuffers();
	void resetRuntimeForProgramReload();
	i64 updateCountTotal() const { return m_debugUpdateCountTotal; }
	void setCycleBudgetPerFrame(int budget);
	bool hasActiveTick() const;
	i64 lastTickSequence() const { return m_lastTickSequence; }
	int lastTickBudgetRemaining() const { return m_lastTickBudgetRemaining; }
	int lastTickBudgetGranted() const { return m_lastTickSequence == 0 ? m_cycleBudgetPerFrame : m_lastTickBudgetGranted; }
	int cpuUsedCyclesLastTick() const { return m_lastTickSequence == 0 ? 0 : m_lastTickCpuUsedCycles; }
	int activeCpuCyclesGrantedLastTick() const { return lastTickBudgetGranted(); }
	int activeCpuUsedCyclesLastTick() const { return cpuUsedCyclesLastTick(); }
	int vdpWorkUnitsPerSec() const { return m_vdpWorkUnitsPerSec; }
	bool lastTickVisualFrameCommitted() const { return m_lastTickVisualFrameCommitted; }
	int lastTickVdpFrameCost() const { return m_lastTickVdpFrameCost; }
	bool lastTickVdpFrameHeld() const { return m_lastTickVdpFrameHeld; }
	uint32_t trackedRamUsedBytes() const;
	uint32_t trackedVramUsedBytes() const;
	uint32_t trackedVramTotalBytes() const { return m_machine.vdp().trackedTotalVramBytes(); }
	bool isDrawPending() const;
	Value canonicalizeIdentifier(std::string_view value);
	void refreshMemoryMap();
	void buildAssetMemory(RuntimeAssets& assets, bool keepDecodedData, AssetBuildMode mode = AssetBuildMode::Full);
	void restoreVramSlotTextures();
	void captureVramTextureSnapshots();
	RuntimeScreenState screen;
	RuntimeTimingState timing;
	RuntimeMachineSchedulerState machineScheduler;
	RuntimeFrameLoopState frameLoop;

private:
	enum class PendingCall {
		None,
		Entry,
	};
	explicit Runtime(const RuntimeOptions& options);
	~Runtime();

	void setupBuiltins();
	void runEngineBuiltinPrelude();
	void resetFrameState();
	void executeUpdateCallback();
	void refreshDeviceTimings(i64 nowCycles);
	void advanceTime(int cycles);
	int getCyclesIntoFrame() const;
	void resetSchedulerState();
	void runDueTimers();
	void dispatchTimer(uint8_t kind, uint8_t payload);
	void scheduleCurrentFrameTimers();
	void handleVblankBeginTimer();
	void handleVblankEndTimer();
	void runDeviceService(uint8_t deviceKind);
	void resetVblankState();
	void setVblankStatus(bool active);
	void enterVblank();
	void leaveVblank();
	void commitFrameOnVblankEdge();
	void completeTickIfPending(FrameState& frameState, uint64_t vblankSequence);
	bool tryCompleteTickOnPendingVblankIrq(FrameState& frameState);
	bool runHaltedUntilIrq(FrameState& frameState);
	void beginFrameState();
	void finalizeUpdateSlice();
	void clearHaltUntilIrq();
	void resetHaltIrqWait();
	RunResult runWithBudget();
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
	void setCartBootReadyFlag(bool value);
	void prepareCartBootIfNeeded();
	bool pollSystemBootRequest();
	bool processPendingCartBoot();
	void flushAssetEdits();
	void applyAtlasSlotMapping(const std::array<i32, 2>& slots);
	std::vector<Value> acquireValueScratch();
	void releaseValueScratch(std::vector<Value>&& values);
	bool hasEntryContinuation() const;

	static Runtime* s_instance;
	static constexpr size_t MAX_POOLED_RUNTIME_SCRATCH = 32;

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
	bool m_cartBootPrepared = false;
	bool m_pendingCartBoot = false;
	bool m_rebootRequested = false;
	std::optional<std::string> m_hostFaultMessage;

	// Frame state
	FrameState m_frameState;
	bool m_frameActive = false;
	f64 m_frameDeltaMs = 0.0;

	// Cached function references
	Value m_pairsIterator = valueNil();
	Value m_ipairsIterator = valueNil();
	PendingCall m_pendingCall = PendingCall::None;
	uint32_t m_randomSeedValue = 0;

	std::unordered_map<std::string, int> m_moduleProtos;
	std::unordered_map<std::string, std::string> m_moduleAliases;
	std::unordered_map<std::string, Value> m_moduleCache;
	std::unordered_map<std::string, std::unique_ptr<std::regex>> m_luaPatternRegexCache;
	std::vector<std::vector<Value>> m_valueScratchPool;
	bool m_debugRunReportInitialized = false;
	std::chrono::steady_clock::time_point m_debugRunReportAt;
	i64 m_debugRunCount = 0;
	i64 m_debugRunYields = 0;
	double m_debugRunRemainingAcc = 0.0;
	i64 m_debugRunCountTotal = 0;
	i64 m_debugRunYieldsTotal = 0;
	i64 m_debugUpdateCountTotal = 0;
	i64 m_lastTickSequence = 0;
	int m_lastTickBudgetGranted = 0;
	int m_lastTickCpuBudgetGranted = 0;
	int m_lastTickCpuUsedCycles = 0;
	int m_lastTickBudgetRemaining = 0;
	bool m_lastTickVisualFrameCommitted = true;
	int m_lastTickVdpFrameCost = 0;
	bool m_lastTickVdpFrameHeld = false;
	bool m_lastTickCompleted = false;
	bool m_activeTickCompleted = false;
	i64 m_lastTickConsumedSequence = 0;
	i64 m_cpuHz = 0;
	i64 m_imgDecBytesPerSec = 0;
	i64 m_dmaBytesPerSecIso = 0;
	i64 m_dmaBytesPerSecBulk = 0;
	int m_vdpWorkUnitsPerSec = 25'600;
	int m_geoWorkUnitsPerSec = 16'384'000;
	int m_cycleBudgetPerFrame = DEFAULT_CYCLE_BUDGET;
	int m_vblankCycles = 0;
	int m_vblankStartCycle = 0;
	i64 m_frameStartCycle = 0;
	uint64_t m_haltIrqSignalSequence = 0;
	bool m_haltIrqWaitArmed = false;
	uint64_t m_vblankSequence = 0;
	uint64_t m_lastCompletedVblankSequence = 0;
	bool m_clearBackQueuesAfterIrqWake = false;
	bool m_vblankActive = false;
};

} // namespace bmsx
