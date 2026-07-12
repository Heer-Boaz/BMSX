#include "machine/runtime/runtime.h"
#include "common/utf8.h"
#include "machine/bus/io.h"
#include "machine/devices/gx/gpu_display.h"
#include "machine/memory/lua_heap_usage.h"
#include "machine/memory/map.h"
#include "machine/model_registry.h"
#include "machine/program/linker.h"
#include "machine/runtime/input.h"
#include "machine/runtime/timing/config.h"
#include <iostream>
#include <stdexcept>
#include <utility>

namespace bmsx {

Runtime::Runtime(
	const RuntimeOptions& options,
	RuntimeInputSource& input
	)
	: timing(
		options.ufpsScaled,
		options.cpuHz,
		options.cycleBudgetPerFrame,
		options.psxGpuDisplayModeWord,
		GX_GPU_RESET_VERTICAL_DISPLAY_RANGE_WORD,
		getPsxGpuDisplayModeTimingForWord(options.psxGpuDisplayModeWord).totalScanlines,
		options.dmaBytesPerSec,
		options.geoWorkUnitsPerSec
	)
	, m_input(input)
	, m_memory(MemoryInit{
		{ options.systemRomBytes.data, options.systemRomBytes.size },
		{ options.cartRomBytes.data, options.cartRomBytes.size }
	})
	, machine(m_memory, input)
	, hostFault(*this)
{
	resetLuaHeapUsageHooks();
	resetTrackedLuaHeapBytes();
	input.setRuntimeInputFrameDurationMs(timing.frameDurationMs);
	machine.memory.clearIoSlots();
	machine.memory.mapIoRead(IO_SYS_TIME_MS, this, &Runtime::onTimeMsReadThunk);
	machine.memory.mapIoRead(IO_SYS_FRAME_MS, this, &Runtime::onFrameMsReadThunk);
	machine.memory.mapIoRead(IO_SYS_CYCLES_PER_FRAME, this, &Runtime::onCyclesPerFrameReadThunk);
	machine.memory.mapIoWrite(IO_GX_GPU_GP1, this, &Runtime::onGxGpuGp1WriteThunk);
	machine.memory.mapIoWrite(IO_SYS_PRINT_CHAR, this, &Runtime::onLuaOutputCodepointWriteThunk);
	machine.memory.mapIoWrite(IO_SYS_PRINT_FLUSH, this, &Runtime::onLuaOutputFlushWriteThunk);
	machine.initializeSystemIo();
	machine.resetDevices();
	machine.gxGpu.writeDisplayModeWord(timing.gpuDisplayModeWord);
	vblank.setVblankCycles(*this, options.vblankCycles);
	refreshDeviceTimings(*this, machine.scheduler.currentNowCycles());
	machine.cpu.setExternalRootMarker([this](GcHeap& heap) {
		for (const auto& entry : m_moduleCache) {
			heap.markValue(entry.second);
		}
	});

	configureLuaHeapUsage(this, &Runtime::getBaseRamUsedBytesThunk, &Runtime::collectTrackedHeapBytesThunk);

}

Runtime::~Runtime() {
	resetLuaHeapUsageHooks();
	resetTrackedLuaHeapBytes();
}

auto Runtime::machineTimeMs() const -> uint32_t {
	const uint64_t cycles = static_cast<uint64_t>(machine.scheduler.currentNowCycles());
	const uint64_t cpuHz = static_cast<uint64_t>(timing.cpuHz);
	return static_cast<uint32_t>((cycles / cpuHz) * 1000ULL + ((cycles % cpuHz) * 1000ULL) / cpuHz);
}

auto Runtime::machineElapsedMs() const -> f64 {
	return static_cast<f64>(machine.scheduler.currentNowCycles()) * 1000.0 / static_cast<f64>(timing.cpuHz);
}

Value Runtime::onTimeMsReadThunk(void* context, uint32_t addr) {
	const auto* runtime = static_cast<Runtime*>(context);
	return runtime->onTimeMsRead(addr);
}

Value Runtime::onTimeMsRead([[maybe_unused]] uint32_t addr) const {
	return valueNumber(static_cast<double>(machineTimeMs()));
}

Value Runtime::onFrameMsReadThunk(void* context, uint32_t addr) {
	const auto* runtime = static_cast<Runtime*>(context);
	return runtime->onFrameMsRead(addr);
}

Value Runtime::onFrameMsRead([[maybe_unused]] uint32_t addr) const {
	return valueNumber(timing.frameDurationMs);
}

Value Runtime::onCyclesPerFrameReadThunk(void* context, uint32_t addr) {
	const auto* runtime = static_cast<Runtime*>(context);
	return runtime->onCyclesPerFrameRead(addr);
}

Value Runtime::onCyclesPerFrameRead([[maybe_unused]] uint32_t addr) const {
	return valueNumber(static_cast<double>(timing.cycleBudgetPerFrame));
}

void Runtime::onGxGpuGp1WriteThunk(void* context, uint32_t addr, Value value) {
	auto* runtime = static_cast<Runtime*>(context);
	(void)addr;
	runtime->machine.gxGpu.writeGp1(toU32(value));
}

void Runtime::onLuaOutputCodepointWriteThunk(void* context, uint32_t addr, Value value) {
	auto* runtime = static_cast<Runtime*>(context);
	(void)addr;
	appendUtf8Codepoint(runtime->luaOutputLineBuffer, toU32(value));
}

void Runtime::onLuaOutputFlushWriteThunk(void* context, uint32_t addr, Value value) {
	auto* runtime = static_cast<Runtime*>(context);
	runtime->onLuaOutputFlushWrite(addr, value);
}

void Runtime::onLuaOutputFlushWrite([[maybe_unused]] uint32_t addr, [[maybe_unused]] Value value) {
	luaOutputLines.push_back(luaOutputLineBuffer);
	luaOutputLineBuffer.clear();
}

void Runtime::applyUfpsScaled(i64 ufpsScaled) {
	timing.ufpsScaled = ufpsScaled;
	timing.ufps = static_cast<f64>(ufpsScaled) / static_cast<f64>(HZ_SCALE);
	timing.frameDurationMs = 1000.0 / timing.ufps;
	m_input.setRuntimeInputFrameDurationMs(timing.frameDurationMs);
}

void Runtime::applyPublishedPsxGpuDisplayTiming(u32 displayModeWord, u32 verticalDisplayRangeWord) {
	if (displayModeWord == timing.gpuDisplayModeWord && verticalDisplayRangeWord == timing.gpuVerticalDisplayRangeWord) {
		return;
	}
	const PsxGpuDisplayModeTiming displayModeTiming = getPsxGpuDisplayModeTimingForWord(displayModeWord);
	const int cycleBudgetPerFrame = static_cast<int>(calcCyclesPerFrameScaled(timing.cpuHz, displayModeTiming.refreshUfpsScaled));
	const int vblankCycles = static_cast<int>(resolveVblankCycles(
		timing.cpuHz,
		displayModeTiming.refreshUfpsScaled,
		displayModeTiming.totalScanlines,
		gxGpuVerticalVisibleLines(verticalDisplayRangeWord, displayModeWord)
	));
	timing.gpuDisplayModeWord = displayModeWord;
	timing.gpuVerticalDisplayRangeWord = verticalDisplayRangeWord;
	timing.totalScanlines = displayModeTiming.totalScanlines;
	applyUfpsScaled(displayModeTiming.refreshUfpsScaled);
	timing.cycleBudgetPerFrame = cycleBudgetPerFrame;
	vblank.setNextFrameTiming(cycleBudgetPerFrame, vblankCycles);
}

uint32_t Runtime::baseRamUsedBytes() const {
	return BASE_RAM_USED_SIZE;
}

size_t Runtime::getBaseRamUsedBytesThunk([[maybe_unused]] void* context) {
	return BASE_RAM_USED_SIZE;
}

size_t Runtime::collectTrackedHeapBytesThunk(void* context) {
	auto& runtime = *static_cast<Runtime*>(context);
	runtime.machine.cpu.collectHeap();
	return trackedLuaHeapBytes();
}

uint32_t Runtime::ramUsedBytes() const {
	return baseRamUsedBytes() + static_cast<uint32_t>(trackedLuaHeapBytes());
}

uint32_t Runtime::ramTotalBytes() const {
	return RAM_SIZE;
}

uint32_t Runtime::vramUsedBytes() const {
	return static_cast<uint32_t>(GX_GPU_VRAM_BYTE_COUNT);
}

uint32_t Runtime::vramTotalBytes() const {
	return static_cast<uint32_t>(GX_GPU_VRAM_BYTE_COUNT);
}

void Runtime::setLinkedCartProgram(ProgramVectorTable vectors, uint32_t programDataBaseAddress, uint32_t programBssBaseAddress, uint32_t cartDataBaseAddress, uint32_t cartBssBaseAddress, std::vector<std::string> staticModulePaths) {
	m_cartVectors = vectors;
	m_programDataBaseAddress = programDataBaseAddress;
	m_programBssBaseAddress = programBssBaseAddress;
	m_cartDataBaseAddress = cartDataBaseAddress;
	m_cartBssBaseAddress = cartBssBaseAddress;
	m_cartStaticModulePaths = std::move(staticModulePaths);
	cartEntryAvailable = true;
}

void Runtime::clearLinkedCartProgram(uint32_t dataByteLength) {
	cartEntryAvailable = false;
	m_cartDataBaseAddress = PROGRAM_STATIC_RAM_BASE;
	m_cartBssBaseAddress = PROGRAM_STATIC_RAM_BASE;
	m_programDataBaseAddress = PROGRAM_STATIC_RAM_BASE;
	m_programBssBaseAddress = PROGRAM_STATIC_RAM_BASE + dataByteLength;
	m_cartStaticModulePaths.clear();
}

void Runtime::enterSystemFirmware() {
	cartProgramStarted = false;
}

void Runtime::enterCartProgram() {
	cartProgramStarted = true;
}

void Runtime::startCartProgram() {
	m_programDataBaseAddress = m_cartDataBaseAddress;
	m_programBssBaseAddress = m_cartBssBaseAddress;
	enterCartProgram();
	startLoadedProgram(m_cartVectors, std::span<const std::string>{}, m_cartStaticModulePaths);
}

void Runtime::boot(const ProgramImage& image, std::unique_ptr<ProgramMetadata> metadata, ProgramVectorTable vectors, uint32_t dataBaseAddress, uint32_t bssBaseAddress, std::span<const std::string> systemStaticModulePaths, std::span<const std::string> cartStaticModulePaths) {
	m_moduleCache.clear();
	m_programDataBaseAddress = dataBaseAddress;
	m_programBssBaseAddress = bssBaseAddress;
	m_programStorage = inflateExecutableProgramImage(image, m_programDataBaseAddress, m_programBssBaseAddress);
	try {
		setupBuiltins();
		enforceLuaHeapBudget();
		m_program = m_programStorage.get();
		m_programRuntimeSymbols = image.link.symbols;
		m_programMetadataStorage = std::move(metadata);
		m_programMetadata = m_programMetadataStorage.get();
		machine.cpu.setProgram(m_program, m_programRuntimeSymbols, m_programMetadata);
		startLoadedProgram(vectors, systemStaticModulePaths, cartStaticModulePaths);
	} catch (const std::exception& e) {
		handleLuaError(e.what());
	}
}

void Runtime::bootLinkedProgramImage(LinkedBootProgramImage&& linked) {
	setLinkedCartProgram(linked.cartVectors, linked.dataBaseAddress, linked.bssBaseAddress, linked.cartDataBaseAddress, linked.cartBssBaseAddress, std::move(linked.cartStaticModulePaths));
	std::span<const std::string> cartStaticModulePaths = cartProgramStarted
		? std::span<const std::string>{ m_cartStaticModulePaths }
		: std::span<const std::string>{};
	boot(
		*linked.programImage,
		std::move(linked.metadata),
		linked.vectors,
		linked.dataBaseAddress,
		linked.bssBaseAddress,
		linked.systemStaticModulePaths,
		cartStaticModulePaths
	);
}

void Runtime::startLoadedProgram(ProgramVectorTable vectors, std::span<const std::string> systemStaticModulePaths, std::span<const std::string> cartStaticModulePaths) {
	m_programVectorsStorage = vectors;
	programVectors = &m_programVectorsStorage;
	NativeResults sectionResults;
	callClosureInto(machine.cpu.rootClosure(vectors.sectionInitProtoIndex), NativeArgsView(), sectionResults);
	runStaticModuleInitializers(systemStaticModulePaths);
	clearLuaBootPrimitives();
	runStaticModuleInitializers(cartStaticModulePaths);
	machine.cpu.syncGlobalSlotsToTable();
	enforceLuaHeapBudget();
	machine.cpu.start(vectors.resetProtoIndex);
	enforceLuaHeapBudget();
	m_pendingCall = PendingCall::Entry;
	m_luaInitialized = true;
}

void Runtime::runStaticModuleInitializer(const std::string& path) {
	if (m_moduleCache.find(path) != m_moduleCache.end()) {
		return;
	}
	const auto protoIt = m_program->moduleProtoMap.find(path);
	if (protoIt == m_program->moduleProtoMap.end()) {
		throw BMSX_RUNTIME_ERROR("static module init failed: module '" + path + "' is not compiled.");
	}
	m_moduleCache[path] = valueBool(true);
	Closure& closure = machine.cpu.rootClosure(protoIt->second);
	NativeResults results;
	try {
		callClosureInto(closure, NativeArgsView(), results);
	} catch (...) {
		m_moduleCache.erase(path);
		throw;
	}
	m_moduleCache.erase(path);
}

void Runtime::runStaticModuleInitializers(std::span<const std::string> paths) {
	for (const std::string& path : paths) {
		runStaticModuleInitializer(path);
	}
}

void Runtime::logLuaCallStack() const {
	const ProgramMetadata* metadata = m_programMetadata;
	if (!metadata) {
		return;
	}
	auto stack = machine.cpu.getCallStack();
	if (stack.empty()) {
		auto range = machine.cpu.getDebugRange(machine.cpu.lastPc);
		if (range.has_value()) {
			std::cout << "  at <current> (" << range->path << ":" << range->startLine << ":" << range->startColumn << ")"
						<< std::endl;
		} else {
			std::cout << "  at <current> (pc=" << machine.cpu.lastPc << ")" << std::endl;
		}
		return;
	}
	for (const auto& [protoIndex, pc] : stack) {
		const std::string& protoId = metadata->protoIds[protoIndex];
		auto range = machine.cpu.getDebugRange(pc);
		if (range.has_value()) {
			std::cout << "  at " << protoId << " (" << range->path << ":" << range->startLine << ":" << range->startColumn << ")"
						<< std::endl;
		} else {
			std::cout << "  at " << protoId << " (pc=" << pc << ")" << std::endl;
		}
	}
}

void Runtime::handleLuaError(const std::string& message) {
	hostFault.publishStartup();
	std::cout << "[Runtime] Error: " << message << std::endl;
	logDebugState();
	logLuaCallStack();
	machine.cpu.clearHaltUntilIrq();
	machine.inputController.cancelSampleArm();
	m_pendingCall = PendingCall::None;
	frameLoop.frameActive = false;
	m_runtimeFailed = true;
}


void Runtime::resetRuntimeForProgramReload() {
	frameLoop.resetFrameState(*this);
	m_runtimeFailed = false;
	m_luaInitialized = false;
	m_pendingCall = PendingCall::None;
	programVectors = nullptr;
	clearLinkedCartProgram(0);
	luaOutputLineBuffer.clear();
	hostFault.clear();
	m_moduleCache.clear();
	machine.cpu.clearGlobalSlots();
	machine.cpu.globals->clear();
	machine.memory.clearIoSlots();
	machine.initializeSystemIo();
	resetHardwareState();
}

// disable-next-line single_line_method_pattern -- runtime global writes keep CPU string-key encoding inside Runtime.
void Runtime::setGlobal(std::string_view name, const Value& value) {
	machine.cpu.setGlobalByKey(valueString(machine.cpu.stringPool().intern(name)), value);
}

void Runtime::resetHardwareState() {
	luaOutputLineBuffer.clear();
	machine.resetDevices();
	vblank.reset(*this);
}

} // namespace bmsx
