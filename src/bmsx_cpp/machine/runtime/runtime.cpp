#include "machine/runtime/runtime.h"
#include "machine/firmware/api.h"
#include "machine/firmware/devtools.h"
#include "machine/bus/io.h"
#include "machine/memory/lua_heap_usage.h"
#include "machine/program/loader.h"
#include "machine/runtime/resource_usage_detector.h"
#include "machine/runtime/system_irq.h"
#include "render/runtime/state.h"
#include "render/shared/queues.h"
#include "machine/runtime/timing/config.h"
#include "rompack/format.h"
#include "input/manager.h"
#include "platform.h"
#include <array>
#include <stdexcept>

namespace bmsx {
namespace {
constexpr size_t CART_ROM_HEADER_SIZE = 72;
constexpr std::array<u8, CART_ROM_HEADER_SIZE> CART_ROM_EMPTY_HEADER = {};

}

Runtime::Runtime(
	const RuntimeOptions& options,
	Clock& clock,
	SoundMaster& soundMaster,
	MicrotaskQueue& microtasks,
	GameView& view,
	RomBootManager& romBootManager
)
	: timing(options.ufpsScaled, options.cpuHz, options.cycleBudgetPerFrame)
	, cartBoot(*this, romBootManager)
	, m_systemRom(options.systemRom)
	, m_activeRom(options.activeRom)
	, m_cartRom(options.cartRom)
	, m_systemRomBytes(options.systemRomBytes)
	, m_cartRomBytes(options.cartRomBytes)
	, m_machineManifest(options.machineManifest)
	, m_clock(clock)
	, m_view(view)
	, m_api(std::make_unique<Api>(*this))
	, m_machine(*m_api, soundMaster, microtasks, VdpFrameBufferSize{
		static_cast<uint32_t>(options.viewport.x),
		static_cast<uint32_t>(options.viewport.y)
	})
{
	configureLuaHeapUsage({});
	resetTrackedLuaHeapBytes();
	Input::instance().setFrameDurationMs(timing.frameDurationMs);
	m_api->initializeRuntimeKeys();
	m_machine.memory().clearIoSlots();
	m_machine.initializeSystemIo();
	m_machine.resetDevices();
	vblank.setVblankCycles(*this, options.vblankCycles);
	setRenderWorkUnitsPerSec(*this, options.vdpWorkUnitsPerSec, options.geoWorkUnitsPerSec);
	m_randomSeedValue = static_cast<uint32_t>(m_clock.now());
	refreshMemoryMap();
	m_machine.cpu().setExternalRootMarker([this](GcHeap& heap) {
		for (const auto& entry : m_moduleCache) {
			heap.markValue(entry.second);
		}
		heap.markValue(m_pairsIterator);
		heap.markValue(m_ipairsIterator);
		m_api->markRoots(heap);
	});

	configureLuaHeapUsage({
		.collect = [this]() {
			m_machine.cpu().collectHeap();
		},
		.getBaseRamUsedBytes = [this]() {
			const auto& usage = m_machine.resourceUsageDetector();
			return static_cast<size_t>(
				IO_REGION_SIZE
					+ (STRING_HANDLE_COUNT * STRING_HANDLE_ENTRY_SIZE)
					+ usage.m_stringHandles.usedHeapBytes()
			);
		},
	});

}

Runtime::~Runtime() {
	configureLuaHeapUsage({});
	resetTrackedLuaHeapBytes();
}

Api& Runtime::api() {
	return *m_api;
}

const CartManifest* Runtime::cartManifest() const {
	if (!m_cartRom || !m_cartRom->cartManifest) {
		return nullptr;
	}
	return &*m_cartRom->cartManifest;
}

const std::string* Runtime::cartEntryPath() const {
	if (!m_cartRom) {
		return nullptr;
	}
	return &m_cartRom->entryPoint;
}

const std::string* Runtime::cartProjectRootPath() const {
	if (!m_cartRom) {
		return nullptr;
	}
	return &m_cartRom->projectRootPath;
}

void Runtime::setRuntimeEnvironment(
	RuntimeRomPackage& systemRom,
	RuntimeRomPackage& activeRom,
	const MachineManifest& machineManifest,
	RuntimeRomPackage* cartRom,
	RuntimeOptions::RomSpan systemRomBytes,
	RuntimeOptions::RomSpan cartRomBytes
) {
	m_systemRom = &systemRom;
	m_activeRom = &activeRom;
	m_machineManifest = &machineManifest;
	m_cartRom = cartRom;
	m_systemRomBytes = systemRomBytes;
	m_cartRomBytes = cartRomBytes;
}

void Runtime::boot(const ProgramImage& image, ProgramMetadata* metadata) {
	m_moduleProtos.clear();
	for (const auto& [path, protoIndex] : image.moduleProtos) {
		m_moduleProtos[path] = protoIndex;
	}
	m_moduleCache.clear();
	boot(image.program.get(), metadata, image.entryProtoIndex, &image.staticModulePaths);
}

void Runtime::resetRuntimeForProgramReload() {
	frameLoop.resetFrameState(*this);
	m_runtimeFailed = false;
	m_luaInitialized = false;
	m_pendingCall = PendingCall::None;
	cartBoot.reset();
	m_hostFaultMessage.reset();
	m_moduleCache.clear();
	m_machine.cpu().clearGlobalSlots();
	m_machine.cpu().globals->clear();
	m_machine.memory().clearIoSlots();
	m_machine.initializeSystemIo();
	resetHardwareState();
	m_randomSeedValue = static_cast<uint32_t>(m_clock.now());
}

void Runtime::boot(Program* program, ProgramMetadata* metadata, int entryProtoIndex, const std::vector<std::string>* staticModulePaths) {
	try {
		setupBuiltins();
		m_api->registerAllFunctions();
		registerRuntimeDevtoolsTable(*this);
		enforceLuaHeapBudget();
		m_program = program;
		m_programMetadata = metadata;
		m_machine.cpu().setProgram(program, metadata);
		runSystemBuiltinPrelude();
		if (staticModulePaths) {
			runStaticModuleInitializers(*staticModulePaths);
		}
		enforceLuaHeapBudget();

		m_machine.cpu().start(entryProtoIndex);
		enforceLuaHeapBudget();
		m_pendingCall = PendingCall::Entry;
		queueLifecycleHandlers(true, true);
		m_luaInitialized = true;
	} catch (const std::exception& e) {
		handleLuaError(e.what());
	}
}

void Runtime::queueLifecycleHandlers(bool runInit, bool runNewGame) {
	const uint32_t mask = (runInit ? IRQ_REINIT : 0u) | (runNewGame ? IRQ_NEWGAME : 0u);
	if (mask != 0) {
		raiseSystemIrq(*this, mask);
	}
}

void Runtime::requestProgramReload() {
	// Reboot is executed on the next update boundary so the active Lua call can unwind first.
	m_rebootRequested = true;
	m_luaInitialized = false;
	frameLoop.resetFrameState(*this);
}

// disable-next-line single_line_method_pattern -- runtime global writes keep CPU string-key encoding inside Runtime.
void Runtime::setGlobal(std::string_view name, const Value& value) {
	m_machine.cpu().setGlobalByKey(valueString(m_machine.cpu().internString(name)), value);
}

void Runtime::registerNativeFunction(std::string_view name, NativeFunctionInvoke fn, std::optional<NativeFnCost> cost) {
	const auto nativeFn = m_machine.cpu().createNativeFunction(name, std::move(fn), cost);
	m_machine.cpu().setGlobalByKey(valueString(m_machine.cpu().internString(name)), nativeFn);
}

void Runtime::resetHardwareState() {
	m_machine.resetDevices();
	vblank.reset(*this);
	resetRuntimeRenderState();
	RenderQueues::clearBackQueues();
}

void Runtime::refreshMemoryMap() {
	if (m_systemRomBytes.size > 0) {
		m_machine.memory().setSystemRom(m_systemRomBytes.data, m_systemRomBytes.size);
	}
	if (m_cartRomBytes.size > 0) {
		m_machine.memory().setCartRom(m_cartRomBytes.data, m_cartRomBytes.size);
	} else {
		m_machine.memory().setCartRom(CART_ROM_EMPTY_HEADER.data(), CART_ROM_EMPTY_HEADER.size());
		InputMap emptyMapping;
		Input::instance().getPlayerInput(DEFAULT_KEYBOARD_PLAYER_INDEX)->setInputMap(emptyMapping);
	}
	refreshMemoryMapGlobals();
}

void Runtime::refreshMemoryMapGlobals() {
	setGlobal("sys_vram_system_slot_base", valueNumber(static_cast<double>(VRAM_SYSTEM_SLOT_BASE)));
	setGlobal("sys_vram_primary_slot_base", valueNumber(static_cast<double>(VRAM_PRIMARY_SLOT_BASE)));
	setGlobal("sys_vram_secondary_slot_base", valueNumber(static_cast<double>(VRAM_SECONDARY_SLOT_BASE)));
	setGlobal("sys_vram_framebuffer_base", valueNumber(static_cast<double>(VRAM_FRAMEBUFFER_BASE)));
	setGlobal("sys_vram_staging_base", valueNumber(static_cast<double>(VRAM_STAGING_BASE)));
	setGlobal("sys_vram_system_slot_size", valueNumber(static_cast<double>(VRAM_SYSTEM_SLOT_SIZE)));
	setGlobal("sys_vram_primary_slot_size", valueNumber(static_cast<double>(VRAM_PRIMARY_SLOT_SIZE)));
	setGlobal("sys_vram_secondary_slot_size", valueNumber(static_cast<double>(VRAM_SECONDARY_SLOT_SIZE)));
	setGlobal("sys_vram_framebuffer_size", valueNumber(static_cast<double>(VRAM_FRAMEBUFFER_SIZE)));
	setGlobal("sys_vram_staging_size", valueNumber(static_cast<double>(VRAM_STAGING_SIZE)));
	setGlobal("sys_vram_size", valueNumber(static_cast<double>(m_machine.vdp().trackedTotalVramBytes())));
}

} // namespace bmsx
