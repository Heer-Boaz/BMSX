#pragma once

#include "cpu.h"
#include "vm_io.h"
#include "../core/types.h"
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
};

/**
 * VM runtime state snapshot for save/load.
 */
struct VMState {
	std::vector<Value> memory;
	std::vector<std::pair<Value, Value>> globals; // key-value pairs
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
	Value canonicalizeIdentifier(std::string_view value);

private:
	enum class PendingCall {
		None,
		Update,
		Draw,
	};

	explicit VMRuntime(const VMRuntimeOptions& options);
	~VMRuntime();

	void setupBuiltins();
	void runEngineBuiltinPrelude();
	void executeUpdateCallback(double deltaSeconds);
	void executeDrawCallback();
	Value requireVmModule(const std::string& moduleName);
	std::vector<Value> callEngineModuleMember(const std::string& name, const std::vector<Value>& args);
	std::regex buildLuaPatternRegex(const std::string& pattern) const;
	std::string translateLuaPatternEscape(char token, bool inClass) const;
	std::string vmToString(const Value& value) const;
	double nextVmRandom();
	std::string formatVmString(const std::string& templateStr, const std::vector<Value>& args, size_t argStart) const;
	void logVmCallStack() const;

	static VMRuntime* s_instance;
	static constexpr int UPDATE_STATEMENT_BUDGET = 1'000'000;

	// VM core
	std::vector<Value> m_memory;
	VMCPU m_cpu;
	Program* m_program = nullptr;
	ProgramMetadata* m_programMetadata = nullptr;

	// API
	std::unique_ptr<VMApi> m_api;

	// Configuration
	int m_playerIndex = 0;
	Viewport m_viewport{0, 0};
	CanonicalizationType m_canonicalization = CanonicalizationType::None;

	// State flags
	bool m_vmInitialized = false;
	bool m_runtimeFailed = false;
	bool m_tickEnabled = true;
	bool m_editorActive = false;
	bool m_terminalActive = false;

	// Frame state
	VMFrameState m_frameState;

	// Cached function references
	Closure* m_updateFn = nullptr;
	Closure* m_drawFn = nullptr;
	Closure* m_initFn = nullptr;
	Closure* m_newGameFn = nullptr;
	Value m_ipairsIterator = valueNil();
	PendingCall m_pendingVmCall = PendingCall::None;
	uint32_t m_vmRandomSeedValue = 0;

	std::unordered_map<std::string, int> m_vmModuleProtos;
	std::unordered_map<std::string, std::string> m_vmModuleAliases;
	std::unordered_map<std::string, Value> m_vmModuleCache;
};

} // namespace bmsx
