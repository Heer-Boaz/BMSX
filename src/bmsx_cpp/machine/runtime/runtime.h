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
#include "machine/runtime/timing/index.h"
#include "machine/runtime/vblank.h"
#include "machine/runtime/cpu_executor.h"
#include "machine/runtime/cpu_state.h"
#include "machine/runtime/cart_boot.h"
#include "machine/runtime/save_state.h"
#include "machine/runtime/resume_snapshot.h"
#include "machine/program/scratch.h"
#include "machine/memory/memory.h"
#include "machine/runtime/frame/loop.h"
#include "machine/scheduler/frame.h"
#include "machine/devices/vdp/vdp.h"
#include "render/shared/submissions.h"
#include "core/primitives.h"
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
class Api;
struct ProgramImage;
struct MachineManifest;
struct CartManifest;
class RuntimeRomPackage;
class ResourceUsageDetector;
class Clock;
class GameView;
class MicrotaskQueue;
class RomBootManager;
class SoundMaster;

constexpr int DEFAULT_CYCLE_BUDGET = 1'000'000;

/**
 * Runtime options for initialization.
 */
struct RuntimeOptions {
	struct RomSpan {
		const u8* data = nullptr;
		size_t size = 0;
	};

	int playerIndex = 0;
	Vec2 viewport{0.0f, 0.0f};
	RomSpan systemRomBytes;
	RomSpan cartRomBytes;
	const MachineManifest* machineManifest = nullptr;
	i64 ufpsScaled = DEFAULT_UFPS_SCALED;
	i64 cpuHz = 0;
	int cycleBudgetPerFrame = DEFAULT_CYCLE_BUDGET;
	int vblankCycles = 0;
	int vdpWorkUnitsPerSec = 25'600;
	int geoWorkUnitsPerSec = 16'384'000;
};

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
	friend class VblankState;
	friend class CartBootState;
	friend RuntimeSaveState captureRuntimeSaveState(Runtime& runtime);
	friend void applyRuntimeSaveState(Runtime& runtime, const RuntimeSaveState& state);
	friend RuntimeResumeSnapshot captureRuntimeResumeSnapshot(const Runtime& runtime);
	friend void applyRuntimeResumeSnapshot(Runtime& runtime, const RuntimeResumeSnapshot& state);
	friend CpuRuntimeState captureRuntimeCpuState(const Runtime& runtime);
	friend void applyRuntimeCpuState(Runtime& runtime, const CpuRuntimeState& state);

	Runtime(
		const RuntimeOptions& options,
		Clock& clock,
		SoundMaster& soundMaster,
		MicrotaskQueue& microtasks,
		GameView& view,
		RomBootManager& romBootManager
	);
	~Runtime();

	// Non-copyable
	Runtime(const Runtime&) = delete;
	Runtime& operator=(const Runtime&) = delete;

	/**
	 * Boot the runtime with a compiled program.
	 */
	void boot(Program* program, ProgramMetadata* metadata, int entryProtoIndex, const std::vector<std::string>* staticModulePaths = nullptr);
	void boot(const ProgramImage& image, ProgramMetadata* metadata);
	void boot(const ProgramImage& image, ProgramMetadata* metadata, int entryProtoIndex, const std::vector<std::string>& staticModulePaths);
	void handleLuaError(const std::string& message);

	/**
	 * Request a program reload.
	 */
	void requestProgramReload();

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

	bool isCartProgramStarted() const { return m_cartProgramStarted; }
	bool hasCartEntry() const { return m_cartEntryProtoIndex.has_value(); }
	void setCartEntry(int entryProtoIndex, std::vector<std::string> staticModulePaths);
	void enterSystemFirmware();
	void enterCartProgram();
	void startCartProgram();

	void setVdpDitherType(i32 type) { m_machine.vdp().setDitherType(type); }

	f64 frameDeltaMs() const { return frameLoop.frameDeltaMs; }
	Clock& clock() const { return m_clock; }

	GameView& view() { return m_view; }
	const GameView& view() const { return m_view; }
	const MachineManifest& machineManifest() const { return *m_machineManifest; }
	const CartManifest* cartManifest() const;
	const std::string* cartEntryPath() const;
	const std::string* cartProjectRootPath() const;
	RuntimeRomPackage& activeRom();
	const RuntimeRomPackage& activeRom() const;
	RuntimeRomPackage& systemRom();
	const RuntimeRomPackage& systemRom() const;
	RuntimeRomPackage* cartRom();
	const RuntimeRomPackage* cartRom() const;
	void setRuntimeEnvironment(
		const MachineManifest& machineManifest,
		RuntimeOptions::RomSpan systemRomBytes,
		RuntimeOptions::RomSpan cartRomBytes,
		RuntimeRomPackage& activeRom,
		RuntimeRomPackage& systemRom,
		RuntimeRomPackage* cartRom
	);

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
	 * Set a global variable.
	 */
	void setGlobal(std::string_view name, const Value& value);

	Value luaKey(std::string_view name) const { return valueString(const_cast<CPU&>(m_machine.cpu()).internString(name)); }

	/**
	 * Register a native function as a global.
	 */
	void registerNativeFunction(std::string_view name, NativeFunctionInvoke fn, std::optional<NativeFnCost> cost = std::nullopt);

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
	bool isDrawPending() const { return m_runtimeFailed || m_pendingCall == PendingCall::Entry; }
	void refreshMemoryMap();
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
	void setupBuiltins();
	void runSystemBuiltinPrelude();
	void runStaticModuleInitializers(const std::vector<std::string>& paths);
	void runStaticModuleInitializer(const std::string& path);
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

	RuntimeOptions::RomSpan m_systemRomBytes;
	RuntimeOptions::RomSpan m_cartRomBytes;
	const MachineManifest* m_machineManifest = nullptr;
	RuntimeRomPackage* m_activeRomPackage = nullptr;
	RuntimeRomPackage* m_systemRomPackage = nullptr;
	RuntimeRomPackage* m_cartRomPackage = nullptr;
	Clock& m_clock;
	GameView& m_view;

		// Runtime core
		std::unique_ptr<Api> m_api;
		Machine m_machine;
	Program* m_program = nullptr;
	ProgramMetadata* m_programMetadata = nullptr;

	std::optional<int> m_cartEntryProtoIndex;
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
