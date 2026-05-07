#include "machine/runtime/runtime.h"
#include "machine/firmware/devtools.h"
#include "machine/bus/io.h"
#include "machine/memory/lua_heap_usage.h"
#include "machine/memory/map.h"
#include "machine/program/loader.h"
#include "machine/runtime/system_irq.h"
#include "machine/runtime/timing/config.h"
#include "render/runtime_state.h"
#include "render/shared/queues.h"
#include "rompack/format.h"
#include "rompack/loader.h"
#include "input/manager.h"
#include "input/player.h"
#include "platform/platform.h"
#include <array>
#include <stdexcept>
#include <utility>

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
	GameView& view
)
	: timing(options.ufpsScaled, options.cpuHz, options.cycleBudgetPerFrame)
	, cartBoot(*this)
	, m_systemRomBytes(options.systemRomBytes)
	, m_cartRomBytes(options.cartRomBytes)
	, m_machineManifest(options.machineManifest)
	, m_clock(clock)
	, m_view(view)
	, m_memory(MemoryInit{
		{ options.systemRomBytes.data, options.systemRomBytes.size },
		options.cartRomBytes.size > 0
			? MemoryInit::RomSpan{ options.cartRomBytes.data, options.cartRomBytes.size }
			: MemoryInit::RomSpan{ CART_ROM_EMPTY_HEADER.data(), CART_ROM_EMPTY_HEADER.size() },
		{}
	})
	, machine(
		m_memory,
		VdpFrameBufferSize{ static_cast<uint32_t>(options.viewport.x), static_cast<uint32_t>(options.viewport.y) },
		Input::instance(),
		soundMaster,
		microtasks
	)
{
	configureLuaHeapUsage({});
	resetTrackedLuaHeapBytes();
	Input::instance().setFrameDurationMs(timing.frameDurationMs);
	machine.memory.clearIoSlots();
	machine.initializeSystemIo();
	machine.resetDevices();
	vblank.setVblankCycles(*this, options.vblankCycles);
	setRenderWorkUnitsPerSec(*this, options.vdpWorkUnitsPerSec, options.geoWorkUnitsPerSec);
	m_randomSeedValue = static_cast<uint32_t>(m_clock.now());
	refreshMemoryMap();
	machine.cpu.setExternalRootMarker([this](GcHeap& heap) {
		for (const auto& entry : m_moduleCache) {
			heap.markValue(entry.second);
		}
		heap.markValue(m_pairsIterator);
		heap.markValue(m_ipairsIterator);
	});

	configureLuaHeapUsage({
		.collect = [this]() {
			machine.cpu.collectHeap();
		},
		.getBaseRamUsedBytes = [this]() {
			return static_cast<size_t>(baseRamUsedBytes());
		},
	});

}

Runtime::~Runtime() {
	configureLuaHeapUsage({});
	resetTrackedLuaHeapBytes();
}

uint32_t Runtime::baseRamUsedBytes() const {
	return BASE_RAM_USED_SIZE;
}

uint32_t Runtime::ramUsedBytes() const {
	return baseRamUsedBytes() + static_cast<uint32_t>(trackedLuaHeapBytes());
}

uint32_t Runtime::ramTotalBytes() const {
	return RAM_SIZE;
}

uint32_t Runtime::vramUsedBytes() const {
	return machine.vdp.trackedUsedVramBytes();
}

uint32_t Runtime::vramTotalBytes() const {
	return machine.vdp.trackedTotalVramBytes();
}

const CartManifest* Runtime::cartManifest() const {
	if (!m_cartRomPackage || !m_cartRomPackage->cartManifest) {
		return nullptr;
	}
	return &*m_cartRomPackage->cartManifest;
}

const std::string* Runtime::cartEntryPath() const {
	if (!m_cartRomPackage || m_cartRomBytes.size == 0) {
		return nullptr;
	}
	return &m_cartRomPackage->entryPoint;
}

const std::string* Runtime::cartProjectRootPath() const {
	if (!m_cartRomPackage || m_cartRomBytes.size == 0) {
		return nullptr;
	}
	return &m_cartRomPackage->projectRootPath;
}

RuntimeRomPackage& Runtime::activeRom() {
	return *m_activeRomPackage;
}

const RuntimeRomPackage& Runtime::activeRom() const {
	return *m_activeRomPackage;
}

RuntimeRomPackage& Runtime::systemRom() {
	return *m_systemRomPackage;
}

const RuntimeRomPackage& Runtime::systemRom() const {
	return *m_systemRomPackage;
}

RuntimeRomPackage* Runtime::cartRom() {
	return m_cartRomPackage;
}

const RuntimeRomPackage* Runtime::cartRom() const {
	return m_cartRomPackage;
}

void Runtime::setRuntimeEnvironment(
	const MachineManifest& machineManifest,
	RuntimeOptions::RomSpan systemRomBytes,
	RuntimeOptions::RomSpan cartRomBytes,
	RuntimeRomPackage& activeRom,
	RuntimeRomPackage& systemRom,
	RuntimeRomPackage* cartRom
) {
	m_machineManifest = &machineManifest;
	m_systemRomBytes = systemRomBytes;
	m_cartRomBytes = cartRomBytes;
	m_activeRomPackage = &activeRom;
	m_systemRomPackage = &systemRom;
	m_cartRomPackage = cartRom;
}

void Runtime::setLinkedCartEntry(int entryProtoIndex, std::vector<std::string> staticModulePaths) {
	m_cartEntryProtoIndex = entryProtoIndex;
	m_cartStaticModulePaths = std::move(staticModulePaths);
}

void Runtime::enterSystemFirmware() {
	m_cartProgramStarted = false;
	m_activeRomPackage = m_systemRomPackage;
}

void Runtime::enterCartProgram() {
	if (!m_cartRomPackage) {
		throw std::runtime_error("cannot enter cart program: cart ROM is not installed.");
	}
	m_cartProgramStarted = true;
	m_activeRomPackage = m_cartRomPackage;
}

void Runtime::startCartProgram() {
	if (!m_cartEntryProtoIndex) {
		throw std::runtime_error("cannot start cart: no cart entry point is installed.");
	}
	enterCartProgram();
	runStaticModuleInitializers(m_cartStaticModulePaths);
	machine.cpu.start(*m_cartEntryProtoIndex);
	enforceLuaHeapBudget();
	m_pendingCall = PendingCall::Entry;
	queueLifecycleHandlers(true, true);
	m_luaInitialized = true;
}

void Runtime::boot(const ProgramImage& image, ProgramMetadata* metadata, int entryProtoIndex, const std::vector<std::string>& staticModulePaths) {
	m_moduleProtos.clear();
	for (const auto& [path, protoIndex] : image.moduleProtos) {
		m_moduleProtos[path] = protoIndex;
	}
	m_moduleCache.clear();
	boot(image.program.get(), metadata, entryProtoIndex, &staticModulePaths);
}

// disable-next-line single_line_method_pattern -- ProgramImage default boot keeps entry-proto/static-module ownership at the image boundary.
void Runtime::resetRuntimeForProgramReload() {
	frameLoop.resetFrameState(*this);
	m_runtimeFailed = false;
	m_luaInitialized = false;
	m_pendingCall = PendingCall::None;
	m_cartEntryProtoIndex.reset();
	m_cartStaticModulePaths.clear();
	cartBoot.reset();
	m_hostFaultMessage.reset();
	m_moduleCache.clear();
	machine.cpu.clearGlobalSlots();
	machine.cpu.globals->clear();
	machine.memory.clearIoSlots();
	machine.initializeSystemIo();
	resetHardwareState();
	m_randomSeedValue = static_cast<uint32_t>(m_clock.now());
}

void Runtime::boot(Program* program, ProgramMetadata* metadata, int entryProtoIndex, const std::vector<std::string>* staticModulePaths) {
	try {
		setupBuiltins();
		registerRuntimeDevtoolsTable(*this);
		enforceLuaHeapBudget();
		m_program = program;
		m_programMetadata = metadata;
		machine.cpu.setProgram(program, metadata);
		runSystemBuiltinPrelude();
		if (staticModulePaths) {
			runStaticModuleInitializers(*staticModulePaths);
		}
		enforceLuaHeapBudget();

		machine.cpu.start(entryProtoIndex);
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
	machine.cpu.setGlobalByKey(valueString(machine.cpu.stringPool().intern(name)), value);
}

void Runtime::registerNativeFunction(std::string_view name, NativeFunctionInvoke fn, std::optional<NativeFnCost> cost) {
	const auto nativeFn = machine.cpu.createNativeFunction(name, std::move(fn), cost);
	machine.cpu.setGlobalByKey(valueString(machine.cpu.stringPool().intern(name)), nativeFn);
}

void Runtime::resetHardwareState() {
	machine.resetDevices();
	vblank.reset(*this);
	resetRuntimeRenderState();
	RenderQueues::clearBackQueues();
}

void Runtime::refreshMemoryMap() {
	machine.vdp.initializeVramSurfaces();
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
	setGlobal("sys_vram_size", valueNumber(static_cast<double>(machine.vdp.trackedTotalVramBytes())));
}

} // namespace bmsx
