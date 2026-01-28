#pragma once

#include "cpu.h"
#include "devices/dma_controller.h"
#include "devices/imgdec_controller.h"
#include "vm_io.h"
#include "vm_memory.h"
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
class VMApi;
class VMStorage;
struct VmProgramAsset;
class RuntimeAssets;

constexpr int DEFAULT_CYCLE_BUDGET = 1'000'000;

/**
 * Standard button actions for gamepad/keyboard input.
 */
extern const std::vector<std::string> VM_BUTTON_ACTIONS;

/**
 * VM frame state for coordinating update/draw phases.
 */
struct VMFrameState {
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
 * VM runtime options for initialization.
 */
struct VMRuntimeOptions {
	int playerIndex = 0;
	Viewport viewport{0, 0};
	CanonicalizationType canonicalization = CanonicalizationType::None;
	i64 cpuHz = 0;
	int cycleBudgetPerFrame = DEFAULT_CYCLE_BUDGET;
};

/**
 * VM runtime state snapshot for save/load.
 */
struct VMState {
	std::vector<Value> ioMemory;
	std::vector<std::pair<Value, Value>> globals; // key-value pairs
	std::vector<u8> assetMemory;
	std::array<i32, 2> atlasSlots{{-1, -1}};
};

/**
 * VMRuntime - the main Lua VM runtime coordinator.
 *
 * Manages:
 * - VMCPU bytecode execution
 * - VM API bindings
 * - I/O command processing
 * - Editor/terminal mode coordination
 * - State save/restore
 */
class VMRuntime {
public:
	enum class VmProgramSource {
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
	static VMRuntime& createInstance(const VMRuntimeOptions& options);

	/**
	 * Get the singleton instance. Assumes already created.
	 */
	static VMRuntime& instance();

	/**
	 * Check if an instance exists.
	 */
	static bool hasInstance();

	/**
	 * Destroy the singleton instance.
	 */
	static void destroy();

	// Non-copyable
	VMRuntime(const VMRuntime&) = delete;
	VMRuntime& operator=(const VMRuntime&) = delete;

	/**
	 * Boot the VM with a compiled program.
	 */
	void boot(Program* program, ProgramMetadata* metadata, int entryProtoIndex);
	void boot(const VmProgramAsset& asset, ProgramMetadata* metadata);
	void handleLuaError(const std::string& message);

	/**
	 * Tick the VM update phase (called by BmsxCartUpdateSystem).
	 */
	void tickUpdate();

	/**
	 * Tick the VM draw phase (called by BmsxCartDrawSystem).
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
	 * Process pending I/O commands from the VM.
	 */
	void processIOCommands();

	/**
	 * Request a program reload.
	 */
	void requestProgramReload();
	void resetCartBootState();

	/**
	 * Capture current VM state for save.
	 */
	VMState captureCurrentState() const;

	/**
	 * Restore VM state from snapshot.
	 */
	void applyState(const VMState& state);

	/**
	 * Check if the VM is initialized.
	 */
	bool isVmInitialized() const { return m_vmInitialized; }

	/**
	 * Check if the runtime has failed.
	 */
	bool hasRuntimeFailed() const { return m_runtimeFailed; }

	/**
	 * Enable/disable tick execution.
	 */
	void setTickEnabled(bool enabled) { m_tickEnabled = enabled; }
	bool isTickEnabled() const { return m_tickEnabled; }

	void setProgramSource(VmProgramSource source) { m_programSource = source; }
	bool isEngineProgramActive() const { return m_programSource == VmProgramSource::Engine; }

	const std::array<i32, 2>& atlasSlots() const { return m_vdp.atlasSlots(); }
	void setVdpDitherType(i32 type) { m_vdp.setDitherType(type); }

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
	VMCPU& cpu() { return m_cpu; }
	const VMCPU& cpu() const { return m_cpu; }
	VmMemory& memory() { return m_memory; }
	const VmMemory& memory() const { return m_memory; }

	/**
	 * Get the API instance.
	 */
	VMApi& api();

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

	explicit VMRuntime(const VMRuntimeOptions& options);
	~VMRuntime();

	void setupBuiltins();
	void runEngineBuiltinPrelude();
	void resetFrameState();
	void executeUpdateCallback(double deltaSeconds);
	void executeDrawCallback();
	void advanceHardware(int cycles);
	void resetTransferCarry();
	void raiseIrqFlags(uint32_t mask);
	bool dispatchIrqFlags();
	RunResult runVmWithBudget();
	void cacheLifecycleHandlers();
	void queueLifecycleHandlers(bool runInit, bool runNewGame);
	void startNextLifecycleCall();
	bool runLifecyclePhase();
	Value requireVmModule(const std::string& moduleName);
	std::vector<Value> callEngineModuleMember(const std::string& name, const std::vector<Value>& args);
	const std::regex& buildLuaPatternRegex(const std::string& pattern);
	std::string translateLuaPatternEscape(char token, bool inClass) const;
	std::string vmToString(const Value& value) const;
	double nextVmRandom();
	std::string formatVmString(const std::string& templateStr, const std::vector<Value>& args, size_t argStart) const;
	void logVmCallStack() const;
	void refreshMemoryMapGlobals();
	void setCartBootReadyFlag(bool value);
	void prepareCartBootIfNeeded();
	bool pollSystemBootRequest();
	void flushAssetEdits();
	void applyAtlasSlotMapping(const std::array<i32, 2>& slots);
	std::vector<Value> acquireValueScratch();
	void releaseValueScratch(std::vector<Value>&& values);

	static VMRuntime* s_instance;
	static constexpr size_t MAX_POOLED_VM_RUNTIME_SCRATCH = 32;

	// VM core
	VmMemory m_memory;
	VDP m_vdp;
	StringHandleTable m_stringHandles;
	VMCPU m_cpu;
	DmaController m_dmaController;
	ImgDecController m_imgDecController;
	Program* m_program = nullptr;
	ProgramMetadata* m_programMetadata = nullptr;

	// API
	std::unique_ptr<VMApi> m_api;

	// Configuration
	int m_playerIndex = 0;
	Viewport m_viewport{0, 0};
	CanonicalizationType m_canonicalization = CanonicalizationType::None;
	VmProgramSource m_programSource = VmProgramSource::Cart;

	// State flags
	bool m_vmInitialized = false;
	bool m_runtimeFailed = false;
	bool m_tickEnabled = true;
	bool m_editorActive = false;
	bool m_terminalActive = false;
	bool m_cartBootPrepared = false;

	// Frame state
	VMFrameState m_frameState;
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
	PendingCall m_pendingVmCall = PendingCall::None;
	std::optional<PendingEntryLifecycle> m_pendingEntryLifecycle;
	std::vector<PendingCall> m_pendingLifecycleQueue;
	size_t m_pendingLifecycleIndex = 0;
	uint32_t m_vmRandomSeedValue = 0;
	std::vector<RenderSubmission> m_preservedRenderQueue;

	std::unordered_map<std::string, int> m_vmModuleProtos;
	std::unordered_map<std::string, std::string> m_vmModuleAliases;
	std::unordered_map<std::string, Value> m_vmModuleCache;
	std::unordered_map<std::string, std::unique_ptr<std::regex>> m_luaPatternRegexCache;
	std::vector<std::vector<Value>> m_valueScratchPool;
	bool m_debugVmReportInitialized = false;
	std::chrono::steady_clock::time_point m_debugVmReportAt;
	i64 m_debugVmRuns = 0;
	i64 m_debugVmYields = 0;
	double m_debugVmRemainingAcc = 0.0;
	i64 m_debugVmRunsTotal = 0;
	i64 m_debugVmYieldsTotal = 0;
	bool m_debugVmFrameReportInitialized = false;
	std::chrono::steady_clock::time_point m_debugVmFrameReportAt;
	i64 m_debugVmFrameCount = 0;
	double m_debugVmFrameCyclesUsedAcc = 0.0;
	double m_debugVmFrameRemainingAcc = 0.0;
	double m_debugVmFrameYieldsAcc = 0.0;
	double m_debugVmFrameGrantedAcc = 0.0;
	double m_debugVmFrameCarryAcc = 0.0;
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
};

} // namespace bmsx
