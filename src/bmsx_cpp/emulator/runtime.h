#pragma once

#include "cpu.h"
#include "devices/dma_controller.h"
#include "devices/geometry_controller.h"
#include "devices/imgdec_controller.h"
#include "io.h"
#include "runtime_screen.h"
#include "runtime_timing.h"
#include "memory.h"
#include "runtime_frame_loop.h"
#include "runtime_machine_scheduler.h"
#include "vdp.h"
#include "../render/gameview.h"
#include "../render/shared/render_types.h"
#include "../core/types.h"
#include <array>
#include <chrono>
#include <functional>
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
 * Standard button actions for gamepad/keyboard input.
 */
extern const std::vector<std::string> BUTTON_ACTIONS;

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
class Runtime : public Memory::IoWriteHandler {
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

	void onIoWrite(uint32_t addr, Value value) override;

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

	const std::array<i32, 2>& atlasSlots() const { return m_vdp.atlasSlots(); }
	void setVdpDitherType(i32 type) { m_vdp.setDitherType(type); }
	void setSkyboxImages(const SkyboxImageIds& ids);
	void clearSkybox();

	f64 frameDeltaMs() const { return m_frameDeltaMs; }

	/**
	 * Get the viewport size.
	 */
	const Viewport& viewport() const { return m_viewport; }

	/**
	 * Get the CPU instance.
	 */
	CPU& cpu() { return m_cpu; }
	const CPU& cpu() const { return m_cpu; }
	Memory& memory() { return m_memory; }
	const Memory& memory() const { return m_memory; }
	VDP& vdp() { return m_vdp; }
	const VDP& vdp() const { return m_vdp; }
	DmaController& dmaController() { return m_dmaController; }
	const DmaController& dmaController() const { return m_dmaController; }

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
	uint32_t trackedVramTotalBytes() const { return m_vdp.trackedTotalVramBytes(); }
	bool didLastTickComplete() const { return m_lastTickCompleted; }
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
	enum TimerKind : uint8_t {
		TimerKindVblankBegin = 1,
		TimerKindVblankEnd = 2,
		TimerKindDeviceService = 3,
	};
	enum DeviceServiceKind : uint8_t {
		DeviceServiceGeo = 1,
		DeviceServiceDma = 2,
		DeviceServiceImg = 3,
		DeviceServiceVdp = 4,
		DeviceServiceKindCount = 5,
	};

	explicit Runtime(const RuntimeOptions& options);
	~Runtime();

	void setupBuiltins();
	void runEngineBuiltinPrelude();
	void resetFrameState();
	void executeUpdateCallback();
	void refreshDeviceTimings(i64 nowCycles);
	void advanceTime(int cycles);
	i64 currentSchedulerNowCycles() const;
	int getCyclesIntoFrame() const;
	void resetSchedulerState();
	void clearTimerHeap();
	static uint32_t nextTimerGeneration(uint32_t value);
	void pushTimer(i64 deadline, uint8_t kind, uint8_t payload, uint32_t generation);
	void removeTopTimer();
	bool isTimerCurrent(uint8_t kind, uint8_t payload, uint32_t generation) const;
	void discardStaleTopTimers();
	i64 nextTimerDeadline();
	void runDueTimers();
	void dispatchTimer(uint8_t kind, uint8_t payload);
	void scheduleVblankBeginTimer(i64 deadlineCycles);
	void scheduleVblankEndTimer(i64 deadlineCycles);
	void scheduleCurrentFrameTimers();
	void handleVblankBeginTimer();
	void handleVblankEndTimer();
	void scheduleDeviceService(uint8_t deviceKind, i64 deadlineCycles);
	void cancelDeviceService(uint8_t deviceKind);
	void requestYieldForEarlierDeadline(i64 deadlineCycles);
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
	void acknowledgeIrq(uint32_t mask);
	void signalIrq(uint32_t mask);
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
	void setVdpSubmitBusyStatus(bool active);
	void refreshVdpSubmitBusyStatus();
	void setVdpSubmitRejectedStatus(bool active);
	void noteRejectedVdpSubmitAttempt();
	void noteAcceptedVdpSubmitAttempt();
	void syncVdpSubmitAttemptStatusFromDma(uint32_t dst);
	void flushAssetEdits();
	void applyAtlasSlotMapping(const std::array<i32, 2>& slots);
	std::vector<Value> acquireValueScratch();
	void releaseValueScratch(std::vector<Value>&& values);
	bool hasEntryContinuation() const;
	void resetVdpIngressState();
	bool hasOpenDirectVdpFifoIngress() const;
	bool hasBlockedVdpSubmitPath() const;
	void consumeSealedVdpStream(uint32_t baseAddr, size_t byteLength);
	void consumeDirectVdpCommand(u32 cmd);
	void writeVdpFifoBytes(const u8* data, size_t length);
	void sealVdpFifoTransfer();
	void sealVdpDmaTransfer(uint32_t src, size_t byteLength);
	void pushVdpFifoWord(u32 word);

	static Runtime* s_instance;
	static constexpr size_t MAX_POOLED_RUNTIME_SCRATCH = 32;

	// Runtime core
	Memory m_memory;
	VDP m_vdp;
	StringHandleTable m_stringHandles;
	CPU m_cpu;
	std::unique_ptr<ResourceUsageDetector> m_resourceUsageDetector;
	DmaController m_dmaController;
	GeometryController m_geometryController;
	ImgDecController m_imgDecController;
	Program* m_program = nullptr;
	ProgramMetadata* m_programMetadata = nullptr;

	// API
	std::unique_ptr<Api> m_api;

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
	i64 m_schedulerNowCycles = 0;
	i64 m_frameStartCycle = 0;
	bool m_schedulerSliceActive = false;
	i64 m_activeSliceBaseCycle = 0;
	int m_activeSliceBudgetCycles = 0;
	i64 m_activeSliceTargetCycle = 0;
	std::vector<i64> m_timerDeadlines;
	std::vector<uint8_t> m_timerKinds;
	std::vector<uint8_t> m_timerPayloads;
	std::vector<uint32_t> m_timerGenerations;
	size_t m_timerCount = 0;
	uint32_t m_vblankEnterTimerGeneration = 0;
	uint32_t m_vblankEndTimerGeneration = 0;
	std::array<uint32_t, static_cast<size_t>(DeviceServiceKindCount)> m_deviceServiceTimerGeneration{};
	bool m_handlingIrqAckWrite = false;
	bool m_handlingVdpCommandWrite = false;
	std::array<u8, 4> m_vdpFifoWordScratch{{0, 0, 0, 0}};
	int m_vdpFifoWordByteCount = 0;
	std::array<u32, VDP_STREAM_CAPACITY_WORDS> m_vdpFifoStreamWords{};
	u32 m_vdpFifoStreamWordCount = 0;
	uint64_t m_irqSignalSequence = 0;
	uint64_t m_haltIrqSignalSequence = 0;
	bool m_haltIrqWaitArmed = false;
	uint64_t m_vblankSequence = 0;
	uint64_t m_lastCompletedVblankSequence = 0;
	bool m_clearBackQueuesAfterIrqWake = false;
	bool m_vblankActive = false;
	u32 m_vdpStatus = 0;
};

} // namespace bmsx
