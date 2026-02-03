#pragma once

#include "cpu.h"
#include "devices/dma_controller.h"
#include "devices/imgdec_controller.h"
#include "io.h"
#include "memory.h"
#include "vdp.h"
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
#include <vector>

namespace bmsx {

// Forward declarations
class Api;
struct ProgramAsset;
class RuntimeAssets;

constexpr int DEFAULT_CYCLE_BUDGET = 1'000'000;

/**
 * Standard button actions for gamepad/keyboard input.
 */
extern const std::vector<std::string> BUTTON_ACTIONS;

/**
 * Runtime frame state for coordinating update/draw phases.
 */
struct FrameState {
	bool haltGame = false;
	bool updateExecuted = false;
	bool luaFaulted = false;
	float deltaSeconds = 0.0f;
	int cycleBudgetRemaining = 0;
	int cycleBudgetGranted = 0;
	int cycleCarryGranted = 0;
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
	i64 cpuHz = 0;
	int cycleBudgetPerFrame = DEFAULT_CYCLE_BUDGET;
	int vblankCycles = 0;
};

/**
 * Runtime state snapshot for save/load.
 */
struct RuntimeState {
	std::vector<Value> ioMemory;
	std::vector<std::pair<Value, Value>> globals; // key-value pairs
	std::vector<u8> assetMemory;
	std::array<i32, 2> atlasSlots{{-1, -1}};
	std::optional<SkyboxImageIds> skyboxFaceIds;
	int cyclesIntoFrame = 0;
	bool vblankPendingClear = false;
	bool vblankClearOnIrqEnd = false;
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
	void tickUpdate();

	/**
	 * Tick the runtime draw phase (called by BmsxCartDrawSystem).
	 */
	void tickDraw();

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
	 * Process pending I/O commands from the runtime.
	 */
	void processIOCommands();

	/**
	 * Request a program reload.
	 */
	void requestProgramReload();
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

	/**
	 * Get the player index for this runtime.
	 */
	int playerIndex() const { return m_playerIndex; }

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

	/**
	 * Get the API instance.
	 */
	Api& api();

	/**
	 * Call a Lua function from native code.
	 */
	std::vector<Value> callLuaFunction(Closure* fn, const std::vector<Value>& args);

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
	void registerNativeFunction(std::string_view name, NativeFunctionInvoke fn);

	void setCanonicalization(CanonicalizationType canonicalization);
	void setCpuHz(i64 hz);
	void setTransferRates(i64 imgDecBytesPerSec, i64 dmaBytesPerSecIso, i64 dmaBytesPerSecBulk);
	i64 cpuHz() const { return m_cpuHz; }
	void setVblankCycles(int cycles);
	void resetHardwareState();
	i64 updateCountTotal() const { return m_debugUpdateCountTotal; }
	void setCycleBudgetPerFrame(int budget);
	void grantCycleBudget(int baseBudget, int carryBudget);
	bool hasActiveTick() const;
	i64 lastTickSequence() const { return m_lastTickSequence; }
	int lastTickBudgetRemaining() const { return m_lastTickBudgetRemaining; }
	bool didLastTickComplete() const { return m_lastTickCompleted; }
	bool consumeLastTickCompletion(i64& outSequence, int& outRemaining);
	bool isDrawPending() const;
	Value canonicalizeIdentifier(std::string_view value);
	void refreshMemoryMap();
	void buildAssetMemory(RuntimeAssets& assets, bool keepDecodedData, AssetBuildMode mode = AssetBuildMode::Full);
	void uploadAtlasTextures();

private:
	struct RateBudget {
		i64 bytesPerSec = 0;
		i64 carry = 0;

		void setBytesPerSec(i64 value) { bytesPerSec = value; }
		void resetCarry() { carry = 0; }
		uint32_t calcBytesForCycles(i64 cpuHz, i64 cycles);
	};

	enum class PendingCall {
		None,
		Entry,
		Init,
		NewGameReset,
		NewGame,
		Irq,
		Update,
		Draw,
		EngineUpdate,
		EngineDraw,
	};
	struct PendingEntryLifecycle {
		bool runInit;
		bool runNewGame;
	};

	explicit Runtime(const RuntimeOptions& options);
	~Runtime();

	void setupBuiltins();
	void runEngineBuiltinPrelude();
	void resetFrameState();
	void executeUpdateCallback(double deltaSeconds);
	void executeDrawCallback();
	void advanceHardware(int cycles);
	void advanceVblank(int cycles);
	void resetVblankState();
	void setVblankStatus(bool active);
	void enterVblank();
	void resetTransferCarry();
	void raiseIrqFlags(uint32_t mask);
	bool dispatchIrqFlags();
	RunResult runWithBudget();
	void cacheLifecycleHandlers();
	void queueLifecycleHandlers(bool runInit, bool runNewGame);
	void startNextLifecycleCall();
	bool runLifecyclePhase();
	Value requireModule(const std::string& moduleName);
	std::vector<Value> callEngineModuleMember(const std::string& name, const std::vector<Value>& args);
	const std::regex& buildLuaPatternRegex(const std::string& pattern);
	std::string translateLuaPatternEscape(char token, bool inClass) const;
	std::string valueToString(const Value& value) const;
	double nextRandom();
	std::string formatLuaString(const std::string& templateStr, const std::vector<Value>& args, size_t argStart) const;
	void logLuaCallStack() const;
	void refreshMemoryMapGlobals();
	void setCartBootReadyFlag(bool value);
	void prepareCartBootIfNeeded();
	bool pollSystemBootRequest();
	void flushAssetEdits();
	void applyAtlasSlotMapping(const std::array<i32, 2>& slots);
	std::vector<Value> acquireValueScratch();
	void releaseValueScratch(std::vector<Value>&& values);

	static Runtime* s_instance;
	static constexpr size_t MAX_POOLED_RUNTIME_SCRATCH = 32;

	// Runtime core
	Memory m_memory;
	VDP m_vdp;
	StringHandleTable m_stringHandles;
	CPU m_cpu;
	DmaController m_dmaController;
	ImgDecController m_imgDecController;
	Program* m_program = nullptr;
	ProgramMetadata* m_programMetadata = nullptr;

	// API
	std::unique_ptr<Api> m_api;

	// Configuration
	int m_playerIndex = 0;
	Viewport m_viewport{0, 0};
	CanonicalizationType m_canonicalization = CanonicalizationType::None;
	ProgramSource m_programSource = ProgramSource::Cart;

	// State flags
	bool m_luaInitialized = false;
	bool m_runtimeFailed = false;
	bool m_tickEnabled = true;
	bool m_editorActive = false;
	bool m_terminalActive = false;
	bool m_cartBootPrepared = false;

	// Frame state
	FrameState m_frameState;
	bool m_frameActive = false;

	// Cached function references
	Closure* m_updateFn = nullptr;
	Closure* m_drawFn = nullptr;
	Closure* m_initFn = nullptr;
	Closure* m_newGameFn = nullptr;
	Closure* m_irqFn = nullptr;
	Closure* m_engineUpdateFn = nullptr;
	Closure* m_engineDrawFn = nullptr;
	Closure* m_engineResetFn = nullptr;
	Value m_ipairsIterator = valueNil();
	PendingCall m_pendingCall = PendingCall::None;
	std::optional<PendingEntryLifecycle> m_pendingEntryLifecycle;
	std::vector<PendingCall> m_pendingLifecycleQueue;
	size_t m_pendingLifecycleIndex = 0;
	uint32_t m_randomSeedValue = 0;
	std::vector<RenderSubmission> m_preservedRenderQueue;

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
	bool m_debugFrameReportInitialized = false;
	std::chrono::steady_clock::time_point m_debugFrameReportAt;
	i64 m_debugFrameCount = 0;
	double m_debugFrameCyclesUsedAcc = 0.0;
	double m_debugFrameRemainingAcc = 0.0;
	double m_debugFrameYieldsAcc = 0.0;
	double m_debugFrameGrantedAcc = 0.0;
	double m_debugFrameCarryAcc = 0.0;
		i64 m_debugTickYieldsBefore = 0;
		i64 m_debugUpdateCountTotal = 0;
		i64 m_lastTickSequence = 0;
		int m_lastTickBudgetRemaining = 0;
		bool m_lastTickCompleted = false;
		i64 m_lastTickConsumedSequence = 0;
		int m_pendingCarryBudget = 0;
		i64 m_cpuHz = 0;
		i64 m_imgDecBytesPerSec = 0;
		i64 m_dmaBytesPerSecIso = 0;
		i64 m_dmaBytesPerSecBulk = 0;
		RateBudget m_imgRate;
		RateBudget m_dmaIsoRate;
		RateBudget m_dmaBulkRate;
		int m_cycleBudgetPerFrame = DEFAULT_CYCLE_BUDGET;
		int m_vblankCycles = 0;
		int m_vblankStartCycle = 0;
		int m_cyclesIntoFrame = 0;
		bool m_vblankActive = false;
		bool m_vblankPendingClear = false;
		bool m_vblankClearOnIrqEnd = false;
		u32 m_vdpStatus = 0;
};

} // namespace bmsx
