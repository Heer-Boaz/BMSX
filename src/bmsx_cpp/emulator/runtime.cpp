#include "runtime.h"
#include "firmware_api.h"
#include "io.h"
#include "lua_heap_usage.h"
#include "program_loader.h"
#include "resource_usage_detector.h"
#include "../core/engine_core.h"
#include "../rompack/rompack.h"
#include "../input/input.h"
#include "../render/shared/render_queues.h"
#include "../render/texturemanager.h"
#include "../utils/clamp.h"
#include <array>
#include <algorithm>
#include <chrono>
#include <cmath>
#include <cctype>
#include <cstdint>
#include <ctime>
#include <cstdlib>
#include <cstdio>
#include <cstring>
#include <iomanip>
#include <iostream>
#include <limits>
#include <sstream>
#include <stdexcept>
#include <unordered_set>
#include <vector>

namespace bmsx {
namespace {
inline double to_ms(std::chrono::steady_clock::duration duration) {
	return std::chrono::duration<double, std::milli>(duration).count();
}

class WaitForVblankSignal : public std::exception {
public:
	const char* what() const noexcept override {
		return "wait_vblank";
	}
};

constexpr size_t CART_ROM_HEADER_SIZE = 64;
constexpr std::array<u8, CART_ROM_HEADER_SIZE> CART_ROM_EMPTY_HEADER = {};

inline double readIoArg(const Runtime& runtime, uint32_t base, int index) {
	return asNumber(runtime.memory().readValue(base + static_cast<uint32_t>(index) * IO_ARG_STRIDE));
}

inline Color readIoColor(const Runtime& runtime, uint32_t base, int offset) {
	return Color{
		static_cast<f32>(readIoArg(runtime, base, offset + 0)),
		static_cast<f32>(readIoArg(runtime, base, offset + 1)),
		static_cast<f32>(readIoArg(runtime, base, offset + 2)),
		static_cast<f32>(readIoArg(runtime, base, offset + 3)),
	};
}

void processVdpCommand(Runtime& runtime, uint32_t cmdBase, uint32_t cmd) {
	auto& memory = runtime.memory();
	switch (cmd) {
		case IO_CMD_VDP_CLEAR: {
			runtime.vdp().enqueueClear(readIoColor(runtime, cmdBase, 1));
			break;
		}
		case IO_CMD_VDP_FILL_RECT: {
			runtime.vdp().enqueueFillRect(
				static_cast<f32>(readIoArg(runtime, cmdBase, 1)),
				static_cast<f32>(readIoArg(runtime, cmdBase, 2)),
				static_cast<f32>(readIoArg(runtime, cmdBase, 3)),
				static_cast<f32>(readIoArg(runtime, cmdBase, 4)),
				static_cast<f32>(readIoArg(runtime, cmdBase, 5)),
				static_cast<Layer2D>(static_cast<int>(readIoArg(runtime, cmdBase, 6))),
				readIoColor(runtime, cmdBase, 7)
			);
			break;
		}
		case IO_CMD_VDP_DRAW_LINE: {
			runtime.vdp().enqueueDrawLine(
				static_cast<f32>(readIoArg(runtime, cmdBase, 1)),
				static_cast<f32>(readIoArg(runtime, cmdBase, 2)),
				static_cast<f32>(readIoArg(runtime, cmdBase, 3)),
				static_cast<f32>(readIoArg(runtime, cmdBase, 4)),
				static_cast<f32>(readIoArg(runtime, cmdBase, 5)),
				static_cast<Layer2D>(static_cast<int>(readIoArg(runtime, cmdBase, 6))),
				readIoColor(runtime, cmdBase, 7),
				static_cast<f32>(readIoArg(runtime, cmdBase, 11))
			);
			break;
		}
		case IO_CMD_VDP_BLIT: {
			const uint32_t flipFlags = static_cast<uint32_t>(readIoArg(runtime, cmdBase, 8));
			runtime.vdp().enqueueBlit(
				static_cast<u32>(readIoArg(runtime, cmdBase, 1)),
				static_cast<f32>(readIoArg(runtime, cmdBase, 2)),
				static_cast<f32>(readIoArg(runtime, cmdBase, 3)),
				static_cast<f32>(readIoArg(runtime, cmdBase, 4)),
				static_cast<Layer2D>(static_cast<int>(readIoArg(runtime, cmdBase, 5))),
				static_cast<f32>(readIoArg(runtime, cmdBase, 6)),
				static_cast<f32>(readIoArg(runtime, cmdBase, 7)),
				(flipFlags & 1u) != 0u,
				(flipFlags & 2u) != 0u,
				readIoColor(runtime, cmdBase, 9),
				static_cast<f32>(readIoArg(runtime, cmdBase, 13))
			);
			break;
		}
		case IO_CMD_VDP_GLYPH_RUN: {
			const uint32_t payloadOffset = static_cast<uint32_t>(readIoArg(runtime, cmdBase, 1));
			const uint32_t textByteLength = static_cast<uint32_t>(readIoArg(runtime, cmdBase, 2));
			const bool backgroundEnabled = static_cast<uint32_t>(readIoArg(runtime, cmdBase, 14)) != 0u;
			std::string text;
			text.resize(textByteLength);
			const uint32_t payloadWords = (textByteLength + 3u) / 4u;
			uint32_t byteIndex = 0u;
			for (uint32_t wordIndex = 0; wordIndex < payloadWords; wordIndex += 1u) {
				const uint32_t word = static_cast<uint32_t>(asNumber(memory.readValue(IO_PAYLOAD_BUFFER_BASE + (payloadOffset + wordIndex) * IO_ARG_STRIDE)));
				text[byteIndex] = static_cast<char>(word & 0xffu);
				byteIndex += 1u;
				if (byteIndex >= textByteLength) {
					break;
				}
				text[byteIndex] = static_cast<char>((word >> 8u) & 0xffu);
				byteIndex += 1u;
				if (byteIndex >= textByteLength) {
					break;
				}
				text[byteIndex] = static_cast<char>((word >> 16u) & 0xffu);
				byteIndex += 1u;
				if (byteIndex >= textByteLength) {
					break;
				}
				text[byteIndex] = static_cast<char>((word >> 24u) & 0xffu);
				byteIndex += 1u;
			}
			const std::optional<Color> backgroundColor = backgroundEnabled
				? std::optional<Color>(readIoColor(runtime, cmdBase, 15))
				: std::nullopt;
			runtime.vdp().enqueueGlyphRun(
				std::vector<std::string>{ text },
				static_cast<f32>(readIoArg(runtime, cmdBase, 3)),
				static_cast<f32>(readIoArg(runtime, cmdBase, 4)),
				static_cast<f32>(readIoArg(runtime, cmdBase, 5)),
				runtime.api().resolveFontId(static_cast<uint32_t>(readIoArg(runtime, cmdBase, 6))),
				readIoColor(runtime, cmdBase, 10),
				backgroundColor,
				static_cast<i32>(readIoArg(runtime, cmdBase, 7)),
				static_cast<i32>(readIoArg(runtime, cmdBase, 8)),
				static_cast<Layer2D>(static_cast<int>(readIoArg(runtime, cmdBase, 9)))
			);
			break;
		}
		case IO_CMD_VDP_TILE_RUN: {
			const uint32_t payloadOffset = static_cast<uint32_t>(readIoArg(runtime, cmdBase, 1));
			const uint32_t tileCount = static_cast<uint32_t>(readIoArg(runtime, cmdBase, 2));
			std::vector<u32> handles(tileCount, IO_VDP_TILE_HANDLE_NONE);
			for (uint32_t tileIndex = 0; tileIndex < tileCount; tileIndex += 1u) {
				handles[tileIndex] = static_cast<u32>(asNumber(memory.readValue(IO_PAYLOAD_BUFFER_BASE + (payloadOffset + tileIndex) * IO_ARG_STRIDE)));
			}
			runtime.vdp().enqueueTileRun(
				handles,
				static_cast<i32>(readIoArg(runtime, cmdBase, 3)),
				static_cast<i32>(readIoArg(runtime, cmdBase, 4)),
				static_cast<i32>(readIoArg(runtime, cmdBase, 5)),
				static_cast<i32>(readIoArg(runtime, cmdBase, 6)),
				static_cast<i32>(readIoArg(runtime, cmdBase, 7)),
				static_cast<i32>(readIoArg(runtime, cmdBase, 8)),
				static_cast<i32>(readIoArg(runtime, cmdBase, 9)),
				static_cast<i32>(readIoArg(runtime, cmdBase, 10)),
				static_cast<f32>(readIoArg(runtime, cmdBase, 11)),
				static_cast<Layer2D>(static_cast<int>(readIoArg(runtime, cmdBase, 12)))
			);
			break;
		}
		default:
			throw BMSX_RUNTIME_ERROR("Unknown IO command: " + std::to_string(cmd) + ".");
	}
}
}

uint32_t Runtime::RateBudget::calcBytesForCycles(i64 cpuHz, i64 cycles) {
	const i64 wholeBytesPerCycle = bytesPerSec / cpuHz;
	const i64 remainderBytesPerCycle = bytesPerSec % cpuHz;
	const i64 baseOut = wholeBytesPerCycle * cycles;
	const i64 remainderNumerator = remainderBytesPerCycle * cycles + carry;
	const i64 out = baseOut + (remainderNumerator / cpuHz);
	carry = remainderNumerator % cpuHz;
	const i64 maxValue = static_cast<i64>(std::numeric_limits<uint32_t>::max());
	const i64 clamped = out > maxValue ? maxValue : out;
	return static_cast<uint32_t>(clamped);
}

// Button actions for standard gamepad/keyboard mapping
const std::vector<std::string> BUTTON_ACTIONS = {
	"left",
	"right",
	"up",
	"down",
	"b",
	"a",
	"x",
	"y",
	"start",
	"select",
	"rt",
	"lt",
	"rb",
	"lb",
};

// Static instance pointer
Runtime* Runtime::s_instance = nullptr;

Runtime& Runtime::createInstance(const RuntimeOptions& options) {
	if (s_instance) {
		throw BMSX_RUNTIME_ERROR("[Runtime] Instance already exists.");
	}
	configureLuaHeapUsage({});
	resetTrackedLuaHeapBytes();
	s_instance = new Runtime(options);
	return *s_instance;
}

Runtime& Runtime::instance() {
	return *s_instance;
}

bool Runtime::hasInstance() {
	return s_instance != nullptr;
}

void Runtime::destroy() {
	delete s_instance;
	s_instance = nullptr;
}

Runtime::Runtime(const RuntimeOptions& options)
	: m_memory()
	, m_vdp(m_memory)
	, m_stringHandles(m_memory)
	, m_cpu(m_memory, &m_stringHandles)
	, m_dmaController(m_memory, [this](uint32_t mask) { raiseIrqFlags(mask); })
	, m_imgDecController(m_memory, m_dmaController, [this](uint32_t mask) { raiseIrqFlags(mask); })
	, m_viewport(options.viewport)
	, m_canonicalization(options.canonicalization)
	, m_cpuHz(options.cpuHz)
	, m_cycleBudgetPerFrame(options.cycleBudgetPerFrame)
{
	// Initialize I/O memory region
	m_memory.clearIoSlots();
	m_memory.writeValue(IO_PAYLOAD_WRITE_PTR_ADDR, valueNumber(0.0));
	// System flags
	m_memory.writeValue(IO_SYS_BOOT_CART, valueNumber(0.0));
	m_memory.writeValue(IO_SYS_CART_BOOTREADY, valueNumber(0.0));
	m_memory.writeValue(IO_IRQ_FLAGS, valueNumber(0.0));
	m_memory.writeValue(IO_IRQ_ACK, valueNumber(0.0));
	m_memory.writeValue(IO_DMA_SRC, valueNumber(0.0));
	m_memory.writeValue(IO_DMA_DST, valueNumber(0.0));
	m_memory.writeValue(IO_DMA_LEN, valueNumber(0.0));
	m_memory.writeValue(IO_DMA_CTRL, valueNumber(0.0));
	m_memory.writeValue(IO_DMA_STATUS, valueNumber(0.0));
	m_memory.writeValue(IO_DMA_WRITTEN, valueNumber(0.0));
	m_memory.writeValue(IO_IMG_SRC, valueNumber(0.0));
	m_memory.writeValue(IO_IMG_LEN, valueNumber(0.0));
	m_memory.writeValue(IO_IMG_DST, valueNumber(0.0));
	m_memory.writeValue(IO_IMG_CAP, valueNumber(0.0));
	m_memory.writeValue(IO_IMG_CTRL, valueNumber(0.0));
	m_memory.writeValue(IO_IMG_STATUS, valueNumber(0.0));
	m_memory.writeValue(IO_IMG_WRITTEN, valueNumber(0.0));
	m_dmaController.reset();
	m_imgDecController.reset();
	m_vdp.attachImgDecController(m_imgDecController);
	m_memory.writeValue(IO_VDP_PRIMARY_ATLAS_ID, valueNumber(static_cast<double>(VDP_ATLAS_ID_NONE)));
	m_memory.writeValue(IO_VDP_SECONDARY_ATLAS_ID, valueNumber(static_cast<double>(VDP_ATLAS_ID_NONE)));
	m_memory.writeValue(IO_VDP_RD_SURFACE, valueNumber(0.0));
	m_memory.writeValue(IO_VDP_RD_X, valueNumber(0.0));
	m_memory.writeValue(IO_VDP_RD_Y, valueNumber(0.0));
	m_memory.writeValue(IO_VDP_RD_MODE, valueNumber(static_cast<double>(VDP_RD_MODE_RGBA8888)));
	m_memory.writeValue(IO_VDP_STATUS, valueNumber(0.0));
	m_vdp.initializeRegisters();
	m_memory.setIoWriteHandler(this);
	setVblankCycles(options.vblankCycles);
	m_randomSeedValue = static_cast<uint32_t>(EngineCore::instance().clock()->now());
	refreshMemoryMap();
	m_cpu.setExternalRootMarker([this](GcHeap& heap) {
		for (const auto& entry : m_moduleCache) {
			heap.markValue(entry.second);
		}
		heap.markValue(m_pairsIterator);
		heap.markValue(m_ipairsIterator);
		if (m_api) {
			m_api->markRoots(heap);
		}
	});

	// Create API instance
	m_api = std::make_unique<Api>(*this);
	m_resourceUsageDetector = std::make_unique<ResourceUsageDetector>(
		m_memory,
		m_stringHandles,
		m_vdp
	);
	configureLuaHeapUsage({
		.collect = [this]() {
			m_cpu.collectHeap();
		},
		.getBaseRamUsedBytes = [this]() {
			return static_cast<size_t>(m_resourceUsageDetector->baseRamUsedBytes());
		},
	});

}

Runtime::~Runtime() {
	configureLuaHeapUsage({});
	resetTrackedLuaHeapBytes();
	m_api.reset();
}

Api& Runtime::api() {
	return *m_api;
}

void Runtime::boot(const ProgramAsset& asset, ProgramMetadata* metadata) {
	m_moduleProtos.clear();
	for (const auto& [path, protoIndex] : asset.moduleProtos) {
		m_moduleProtos[path] = protoIndex;
	}
	m_moduleAliases.clear();
	for (const auto& [alias, path] : asset.moduleAliases) {
		m_moduleAliases[alias] = path;
	}
	m_moduleCache.clear();
	boot(asset.program.get(), metadata, asset.entryProtoIndex);
}

void Runtime::boot(Program* program, ProgramMetadata* metadata, int entryProtoIndex) {
	std::cout << "[Runtime] boot: program=" << program << " entryProtoIndex=" << entryProtoIndex << std::endl;
	std::cout << "[Runtime] boot: module protos=" << m_moduleProtos.size()
				<< " aliases=" << m_moduleAliases.size() << std::endl;
	resetFrameState();
	m_runtimeFailed = false;
	m_luaInitialized = false;
	m_pendingCall = PendingCall::None;
	m_cpu.globals->clear();
	m_memory.clearIoSlots();
	m_memory.writeValue(IO_PAYLOAD_WRITE_PTR_ADDR, valueNumber(0.0));
	m_memory.writeValue(IO_SYS_BOOT_CART, valueNumber(0.0));
	m_memory.writeValue(IO_SYS_CART_BOOTREADY, valueNumber(0.0));
	m_memory.writeValue(IO_IRQ_FLAGS, valueNumber(0.0));
	m_memory.writeValue(IO_IRQ_ACK, valueNumber(0.0));
	m_memory.writeValue(IO_DMA_SRC, valueNumber(0.0));
	m_memory.writeValue(IO_DMA_DST, valueNumber(0.0));
	m_memory.writeValue(IO_DMA_LEN, valueNumber(0.0));
	m_memory.writeValue(IO_DMA_CTRL, valueNumber(0.0));
	m_memory.writeValue(IO_DMA_STATUS, valueNumber(0.0));
	m_memory.writeValue(IO_DMA_WRITTEN, valueNumber(0.0));
	m_memory.writeValue(IO_IMG_SRC, valueNumber(0.0));
	m_memory.writeValue(IO_IMG_LEN, valueNumber(0.0));
	m_memory.writeValue(IO_IMG_DST, valueNumber(0.0));
	m_memory.writeValue(IO_IMG_CAP, valueNumber(0.0));
	m_memory.writeValue(IO_IMG_CTRL, valueNumber(0.0));
	m_memory.writeValue(IO_IMG_STATUS, valueNumber(0.0));
	m_memory.writeValue(IO_IMG_WRITTEN, valueNumber(0.0));
	m_dmaController.reset();
	m_imgDecController.reset();
	m_memory.writeValue(IO_VDP_PRIMARY_ATLAS_ID, valueNumber(static_cast<double>(VDP_ATLAS_ID_NONE)));
	m_memory.writeValue(IO_VDP_SECONDARY_ATLAS_ID, valueNumber(static_cast<double>(VDP_ATLAS_ID_NONE)));
	m_vdp.initializeRegisters();
	m_memory.writeValue(IO_VDP_STATUS, valueNumber(0.0));
	resetVblankState();
	m_randomSeedValue = static_cast<uint32_t>(EngineCore::instance().clock()->now());
	setupBuiltins();
	m_api->registerAllFunctions();
	enforceLuaHeapBudget();
	m_program = program;
	m_programMetadata = metadata;
	m_cpu.setProgram(program, metadata);
	runEngineBuiltinPrelude();
	enforceLuaHeapBudget();

	// Start execution at entry point
	std::cout << "[Runtime] boot: starting CPU at entry point..." << std::endl;
	m_cpu.start(entryProtoIndex);
	enforceLuaHeapBudget();
	m_pendingCall = PendingCall::Entry;
	queueLifecycleHandlers(true, true);
	m_luaInitialized = true;
	std::cout << "[Runtime] boot: runtime initialized!" << std::endl;
}

void Runtime::setCartBootReadyFlag(bool value) {
	m_memory.writeValue(IO_SYS_CART_BOOTREADY, valueNumber(value ? 1.0 : 0.0));
}

void Runtime::prepareCartBootIfNeeded() {
	if (!isEngineProgramActive()) {
		return;
	}
	if (!EngineCore::instance().hasLoadedCartProgram()) {
		return;
	}
	if (m_cartBootPrepared) {
		return;
	}
	m_cartBootPrepared = true;
	setCartBootReadyFlag(true);
}

bool Runtime::pollSystemBootRequest() {
	if (!isEngineProgramActive()) {
		return false;
	}
	if (asNumber(m_memory.readValue(IO_SYS_BOOT_CART)) == 0.0) {
		return false;
	}
	m_memory.writeValue(IO_SYS_BOOT_CART, valueNumber(0.0));
	try {
		if (!EngineCore::instance().bootLoadedCart()) {
			setCartBootReadyFlag(false);
			EngineCore::instance().log(LogLevel::Error,
				"[Runtime] Cart boot request failed while leaving system boot screen active.\n");
		}
	} catch (const std::exception& error) {
		setCartBootReadyFlag(false);
		EngineCore::instance().log(LogLevel::Error,
			"[Runtime] Cart boot request failed while leaving system boot screen active: %s\n",
			error.what());
	}
	return true;
}

void Runtime::advanceHardware(int cycles) {
	if (cycles <= 0) {
		return;
	}
	// Hardware advances in discrete steps; interrupt sources raised in the same step are observed together.
	const i64 cycleCount = static_cast<i64>(cycles);
	const uint32_t imgBudget = m_imgRate.calcBytesForCycles(m_cpuHz, cycleCount);
	const uint32_t isoBudget = m_dmaIsoRate.calcBytesForCycles(m_cpuHz, cycleCount);
	const uint32_t bulkBudget = m_dmaBulkRate.calcBytesForCycles(m_cpuHz, cycleCount);
	m_imgDecController.setDecodeBudget(imgBudget);
	m_dmaController.setChannelBudgets(isoBudget, bulkBudget);
	m_dmaController.tick();
	m_imgDecController.tick();
	m_vdp.advanceBlitter(cycles);
	advanceVblank(cycles);
}

void Runtime::advanceVblank(int cycles) {
	int remaining = cycles;
	while (remaining > 0) {
		const int frameRemaining = m_cycleBudgetPerFrame - m_cyclesIntoFrame;
		const int step = remaining < frameRemaining ? remaining : frameRemaining;
		const int previous = m_cyclesIntoFrame;
		m_cyclesIntoFrame += step;
		if (!m_vblankActive && previous < m_vblankStartCycle && m_cyclesIntoFrame >= m_vblankStartCycle) {
			enterVblank();
		}
		remaining -= step;
		if (m_cyclesIntoFrame >= m_cycleBudgetPerFrame) {
			m_cyclesIntoFrame = 0;
			if (m_vblankStartCycle == 0) {
				raiseIrqFlags(IRQ_VBLANK);
			} else if (m_vblankActive) {
				// Defer clear until the VBLANK IRQ handler has a chance to observe the status.
				m_vblankPendingClear = true;
			}
		}
	}
}

int Runtime::cyclesUntilNextVblankEdge() const {
	if (m_vblankStartCycle == 0) {
		return m_cycleBudgetPerFrame - m_cyclesIntoFrame;
	}
	if (!m_vblankActive && m_cyclesIntoFrame < m_vblankStartCycle) {
		return m_vblankStartCycle - m_cyclesIntoFrame;
	}
	return (m_cycleBudgetPerFrame - m_cyclesIntoFrame) + m_vblankStartCycle;
}

void Runtime::resetVblankState() {
	m_cyclesIntoFrame = 0;
	m_vblankSequence = 0;
	m_lastCompletedVblankSequence = 0;
	m_vblankActive = false;
	m_vblankPendingClear = false;
	m_vblankClearOnIrqEnd = false;
	m_vdpStatus = 0;
	m_memory.writeValue(IO_VDP_STATUS, valueNumber(static_cast<double>(m_vdpStatus)));
	if (m_vblankStartCycle == 0) {
		setVblankStatus(true);
	}
}

void Runtime::setVblankStatus(bool active) {
	if (m_vblankActive == active) {
		return;
	}
	m_vblankActive = active;
	if (active) {
		m_vdpStatus |= VDP_STATUS_VBLANK;
	} else {
		m_vdpStatus &= ~VDP_STATUS_VBLANK;
	}
	m_memory.writeValue(IO_VDP_STATUS, valueNumber(static_cast<double>(m_vdpStatus)));
}

void Runtime::enterVblank() {
	// IRQ flags are level/pending; multiple VBLANK edges while pending coalesce.
	m_vblankSequence += 1;
	commitFrameOnVblankEdge();
	setVblankStatus(true);
	raiseIrqFlags(IRQ_VBLANK);
}

void Runtime::commitFrameOnVblankEdge() {
	// Flush latest VDP register writes before snapshotting atlas/skybox bindings.
	m_vdp.syncRegisters();
	m_vdp.commitViewSnapshot(*EngineCore::instance().view());
	if (!m_frameActive) {
		return;
	}
	if (!m_waitingForVblank) {
		return;
	}
	if (m_waitForVblankTargetSequence != 0 && m_vblankSequence < m_waitForVblankTargetSequence) {
		return;
	}
	completeTickIfPending(m_frameState, m_vblankSequence);
}

void Runtime::completeTickIfPending(FrameState& frameState, uint64_t vblankSequence) {
	if (m_lastCompletedVblankSequence == vblankSequence) {
		return;
	}
	frameState.tickCompleted = true;
	m_lastCompletedVblankSequence = vblankSequence;
	m_lastTickBudgetGranted = frameState.cycleBudgetGranted;
	if (frameState.cpuStatsFrozen) {
		m_lastTickCpuBudgetGranted = frameState.cpuStatsGrantedCycles;
		m_lastTickCpuUsedCycles = frameState.cpuStatsUsedCycles;
	} else {
		m_lastTickCpuBudgetGranted = frameState.cycleBudgetGranted;
		m_lastTickCpuUsedCycles = frameState.cycleBudgetGranted - frameState.cycleBudgetRemaining;
	}
	m_lastTickBudgetRemaining = frameState.cycleBudgetRemaining;
	m_lastTickCompleted = true;
	m_lastTickSequence += 1;
}

void Runtime::reconcileCycleBudgetAfterSignal(FrameState& frameState) {
	const int remaining = m_cpu.instructionBudgetRemaining;
	const int consumed = frameState.cycleBudgetRemaining - remaining;
	if (consumed < 0) {
		throw BMSX_RUNTIME_ERROR("[Runtime] Negative cycle reconciliation.");
	}
	frameState.cycleBudgetRemaining = remaining;
	if (consumed > 0) {
		advanceHardware(consumed);
	}
}

void Runtime::freezeTickCpuStats(FrameState& frameState) {
	if (frameState.cpuStatsFrozen) {
		return;
	}
	frameState.cpuStatsFrozen = true;
	frameState.cpuStatsGrantedCycles = frameState.cycleBudgetGranted;
	frameState.cpuStatsUsedCycles = frameState.cycleBudgetGranted - frameState.cycleBudgetRemaining;
}

void Runtime::requestWaitForVblank() {
	processIrqAck();
	const bool resumeOnCurrentEdge =
		m_vblankActive
		&& !m_vblankPendingClear
		&& m_vblankSequence > 0
		&& m_lastCompletedVblankSequence != m_vblankSequence;
	m_waitingForVblank = true;
	const uint64_t nextVblankSequence = m_vblankSequence + 1;
	// Only reuse the current VBLANK edge when this tick has not already completed
	// on that same edge. Otherwise fast carts can "re-wait" the current VBLANK and
	// effectively skip the next frame boundary.
	m_waitForVblankTargetSequence = resumeOnCurrentEdge
		? m_vblankSequence
		: nextVblankSequence;
	if (resumeOnCurrentEdge) {
		if (!m_frameActive) {
			throw BMSX_RUNTIME_ERROR("[Runtime] wait_vblank resumed without an active frame state.");
		}
		reconcileCycleBudgetAfterSignal(m_frameState);
		freezeTickCpuStats(m_frameState);
		completeTickIfPending(m_frameState, m_vblankSequence);
	}
	throw WaitForVblankSignal{};
}

void Runtime::resetTransferCarry() {
	m_imgRate.resetCarry();
	m_dmaIsoRate.resetCarry();
	m_dmaBulkRate.resetCarry();
}

void Runtime::raiseIrqFlags(uint32_t mask) {
	const uint32_t current = static_cast<uint32_t>(asNumber(m_memory.readValue(IO_IRQ_FLAGS)));
	m_memory.writeValue(IO_IRQ_FLAGS, valueNumber(static_cast<double>(current | mask)));
}

void Runtime::processIrqAck() {
	const uint32_t ack = static_cast<uint32_t>(asNumber(m_memory.readValue(IO_IRQ_ACK)));
	if (ack == 0) {
		return;
	}
	uint32_t flags = static_cast<uint32_t>(asNumber(m_memory.readValue(IO_IRQ_FLAGS)));
	flags &= ~ack;
	m_memory.writeValue(IO_IRQ_FLAGS, valueNumber(static_cast<double>(flags)));
	m_memory.writeValue(IO_IRQ_ACK, valueNumber(0.0));
	if ((ack & IRQ_VBLANK) != 0 && m_vblankPendingClear) {
		setVblankStatus(false);
		m_vblankPendingClear = false;
		m_vblankClearOnIrqEnd = false;
	}
}

void Runtime::raiseEngineIrq(uint32_t mask) {
	constexpr uint32_t kAllowedMask = IRQ_REINIT | IRQ_NEWGAME;
	if (mask == 0) {
		throw BMSX_RUNTIME_ERROR("[Runtime] Engine IRQ mask must be non-zero.");
	}
	const uint32_t unsupported = mask & ~kAllowedMask;
	if (unsupported != 0) {
		throw BMSX_RUNTIME_ERROR("[Runtime] Unsupported engine IRQ mask: " + std::to_string(unsupported) + ".");
	}
	raiseIrqFlags(mask);
}

RunResult Runtime::runWithBudget() {
	const int budgetBefore = m_frameState.cycleBudgetRemaining;
	RunResult result = m_cpu.run(budgetBefore);
	const int remaining = m_cpu.instructionBudgetRemaining;
	const int consumed = budgetBefore - remaining;
	m_frameState.cycleBudgetRemaining = remaining;
	if (consumed > 0) {
		advanceHardware(consumed);
	}
	return result;
}

void Runtime::queueLifecycleHandlers(bool runInit, bool runNewGame) {
	uint32_t mask = 0;
	if (runInit) {
		mask |= IRQ_REINIT;
	}
	if (runNewGame) {
		mask |= IRQ_NEWGAME;
	}
	if (mask != 0) {
		raiseEngineIrq(mask);
	}
}

void Runtime::tickUpdate() {
	if (m_rebootRequested) {
		m_rebootRequested = false;
		if (!EngineCore::instance().rebootLoadedRom()) {
			EngineCore::instance().log(LogLevel::Error, "[Runtime] Reboot to bootrom failed.\n");
		}
		return;
	}
	if (!m_luaInitialized || !m_tickEnabled || m_runtimeFailed) {
		return;
	}

	prepareCartBootIfNeeded();
	if (pollSystemBootRequest()) {
		return;
	}

	const auto finalizeUpdateSlice = [this]() {
		if (hasEntryContinuation() && !m_frameState.tickCompleted) {
			return;
		}
		m_frameActive = false;
	};

	if (m_frameActive) {
		if (hasEntryContinuation()) {
			executeUpdateCallback();
			flushAssetEdits();
			m_frameState.updateExecuted = !hasEntryContinuation();
		}
		finalizeUpdateSlice();
		return;
	}

	const auto frameNow = std::chrono::steady_clock::now();
	if (!m_debugFrameReportInitialized) {
		m_debugFrameReportInitialized = true;
		m_debugFrameReportAt = frameNow;
	}
	m_debugTickYieldsBefore = m_debugRunYieldsTotal;

	m_frameActive = true;
	m_lastTickCompleted = false;

	const int carryBudget = m_pendingCarryBudget;
	m_pendingCarryBudget = 0;
	m_frameState = FrameState{};
	m_frameState.cycleBudgetRemaining = m_cycleBudgetPerFrame + carryBudget;
	m_frameState.cycleBudgetGranted = m_cycleBudgetPerFrame + carryBudget;
	m_frameState.cycleCarryGranted = carryBudget;
	m_frameDeltaMs = static_cast<f64>(EngineCore::instance().deltaTime()) * 1000.0;
	m_vdp.beginFrame();
	auto* gameTable = asTable(m_cpu.globals->get(canonicalizeIdentifier("game")));
	auto* viewportTable = asTable(gameTable->get(canonicalizeIdentifier("viewportsize")));
	auto viewSize = EngineCore::instance().view()->viewportSize;
	viewportTable->set(canonicalizeIdentifier("x"), valueNumber(static_cast<double>(viewSize.x)));
	viewportTable->set(canonicalizeIdentifier("y"), valueNumber(static_cast<double>(viewSize.y)));
	auto* viewTable = asTable(gameTable->get(canonicalizeIdentifier("view")));
	auto* view = EngineCore::instance().view();
	const Value viewCrtKey = canonicalizeIdentifier("crt_postprocessing_enabled");
	const Value viewNoiseKey = canonicalizeIdentifier("enable_noise");
	const Value viewColorBleedKey = canonicalizeIdentifier("enable_colorbleed");
	const Value viewScanlinesKey = canonicalizeIdentifier("enable_scanlines");
	const Value viewBlurKey = canonicalizeIdentifier("enable_blur");
	const Value viewGlowKey = canonicalizeIdentifier("enable_glow");
	const Value viewFringingKey = canonicalizeIdentifier("enable_fringing");
	const Value viewApertureKey = canonicalizeIdentifier("enable_aperture");
	viewTable->set(viewCrtKey, valueBool(view->crt_postprocessing_enabled));
	viewTable->set(viewNoiseKey, valueBool(view->applyNoise));
	viewTable->set(viewColorBleedKey, valueBool(view->applyColorBleed));
	viewTable->set(viewScanlinesKey, valueBool(view->applyScanlines));
	viewTable->set(viewBlurKey, valueBool(view->applyBlur));
	viewTable->set(viewGlowKey, valueBool(view->applyGlow));
	viewTable->set(viewFringingKey, valueBool(view->applyFringing));
	viewTable->set(viewApertureKey, valueBool(view->applyAperture));

	// Call _update if present
	executeUpdateCallback();

	auto readViewBool = [](Value value, const char* field) -> bool {
		if (!valueIsBool(value)) {
			throw BMSX_RUNTIME_ERROR(std::string("game.view.") + field + " must be boolean.");
		}
		return valueToBool(value);
	};
	view->crt_postprocessing_enabled = readViewBool(viewTable->get(viewCrtKey), "crt_postprocessing_enabled");
	view->applyNoise = readViewBool(viewTable->get(viewNoiseKey), "enable_noise");
	view->applyColorBleed = readViewBool(viewTable->get(viewColorBleedKey), "enable_colorbleed");
	view->applyScanlines = readViewBool(viewTable->get(viewScanlinesKey), "enable_scanlines");
	view->applyBlur = readViewBool(viewTable->get(viewBlurKey), "enable_blur");
	view->applyGlow = readViewBool(viewTable->get(viewGlowKey), "enable_glow");
	view->applyFringing = readViewBool(viewTable->get(viewFringingKey), "enable_fringing");
	view->applyAperture = readViewBool(viewTable->get(viewApertureKey), "enable_aperture");

	m_debugUpdateCountTotal += 1;
	m_frameState.updateExecuted = !hasEntryContinuation();
	flushAssetEdits();
	finalizeUpdateSlice();
}

void Runtime::tickDraw() {
	// Runtime rendering is update-driven; draw phase is intentionally unused.
}

void Runtime::tickIdeInput() {
}

void Runtime::tickIDE() {
}

void Runtime::tickIDEDraw() {
}

void Runtime::tickTerminalInput() {
	// Terminal input handling - stub for now
}

void Runtime::tickTerminalMode() {
	// Terminal mode update - stub for now
	flushAssetEdits();
}

void Runtime::tickTerminalModeDraw() {
	// Terminal mode draw - stub for now
}

void Runtime::onIoWrite(uint32_t addr, Value value) {
	if (m_handlingVdpCommandWrite || !valueIsNumber(value)) {
		return;
	}
	if (addr == IO_VDP_CMD) {
		if (asNumber(value) == 0.0) {
			return;
		}
		m_handlingVdpCommandWrite = true;
		try {
			m_vdp.syncRegisters();
			processVdpCommand(*this, IO_VDP_CMD, static_cast<uint32_t>(asNumber(value)));
		} catch (...) {
			m_memory.writeValue(IO_PAYLOAD_WRITE_PTR_ADDR, valueNumber(0.0));
			m_handlingVdpCommandWrite = false;
			throw;
		}
		m_memory.writeValue(IO_PAYLOAD_WRITE_PTR_ADDR, valueNumber(0.0));
		m_handlingVdpCommandWrite = false;
		return;
	}
}

void Runtime::requestProgramReload() {
	// Reboot is executed on the next update boundary so the active Lua call can unwind first.
	m_rebootRequested = true;
	m_luaInitialized = false;
	resetFrameState();
}

void Runtime::resetFrameState() {
	m_frameActive = false;
	m_frameState = FrameState{};
	m_waitingForVblank = false;
	m_waitForVblankTargetSequence = 0;
	m_clearBackQueuesAfterWaitResume = false;
	m_pendingCarryBudget = 0;
	m_lastTickBudgetGranted = 0;
	m_lastTickCpuBudgetGranted = 0;
	m_lastTickCpuUsedCycles = 0;
	m_lastTickCompleted = false;
	m_lastTickBudgetRemaining = 0;
	m_lastTickSequence = 0;
	m_lastTickConsumedSequence = 0;
	resetVblankState();
}

void Runtime::resetCartBootState() {
	m_cartBootPrepared = false;
	setCartBootReadyFlag(false);
}

RuntimeState Runtime::captureCurrentState() const {
	RuntimeState state;
	state.ioMemory = m_memory.ioSlots();
	state.globals = m_cpu.globals->entries();
	state.cartDataNamespace = m_api->cartDataNamespace();
	state.persistentData = m_api->persistentData();
	state.randomSeed = m_randomSeedValue;
	state.pendingEntryCall = m_pendingCall == PendingCall::Entry;
	state.assetMemory = m_memory.dumpAssetMemory();
	state.atlasSlots = m_vdp.atlasSlots();
	state.skyboxFaceIds = m_vdp.skyboxFaceIds();
	state.vdpDitherType = m_vdp.getDitherType();
	state.cyclesIntoFrame = m_cyclesIntoFrame;
	state.vblankPendingClear = m_vblankPendingClear;
	state.vblankClearOnIrqEnd = m_vblankClearOnIrqEnd;
	return state;
}

void Runtime::applyState(const RuntimeState& state) {
	// Restore memory
	m_memory.loadIoSlots(state.ioMemory);
	m_vdp.syncRegisters();
	m_cyclesIntoFrame = state.cyclesIntoFrame;
	m_vblankPendingClear = state.vblankPendingClear;
	m_vblankClearOnIrqEnd = state.vblankClearOnIrqEnd;
	const bool vblankActive = (m_vblankStartCycle == 0)
		|| m_vblankPendingClear
		|| (m_cyclesIntoFrame >= m_vblankStartCycle);
	setVblankStatus(vblankActive);
	if (!state.assetMemory.empty()) {
		m_memory.restoreAssetMemory(state.assetMemory.data(), state.assetMemory.size());
	}
	m_api->restorePersistentData(state.cartDataNamespace, state.persistentData);
	m_randomSeedValue = state.randomSeed;
	m_pendingCall = state.pendingEntryCall ? PendingCall::Entry : PendingCall::None;
	applyAtlasSlotMapping(state.atlasSlots);
	if (state.skyboxFaceIds.has_value()) {
		m_vdp.setSkyboxImages(*state.skyboxFaceIds);
	} else {
		m_vdp.clearSkybox();
	}
	m_vdp.setDitherType(state.vdpDitherType);

	// Restore globals
	m_cpu.globals->clear();
	for (const auto& [key, value] : state.globals) {
		m_cpu.globals->set(key, value);
	}
	flushAssetEdits();
	resetRenderBuffers();
}

void Runtime::applyAtlasSlotMapping(const std::array<i32, 2>& slots) {
	m_vdp.applyAtlasSlotMapping(slots);
}

void Runtime::setSkyboxImages(const SkyboxImageIds& ids) {
	m_vdp.setSkyboxImages(ids);
}

void Runtime::clearSkybox() {
	m_vdp.clearSkybox();
}

Value Runtime::getGlobal(std::string_view name) {
	return m_cpu.globals->get(canonicalizeIdentifier(name));
}

void Runtime::setGlobal(std::string_view name, const Value& value) {
	m_cpu.globals->set(canonicalizeIdentifier(name), value);
}

void Runtime::registerNativeFunction(std::string_view name, NativeFunctionInvoke fn, NativeFnCost cost) {
	auto nativeFn = m_cpu.createNativeFunction(name, std::move(fn), cost);
	m_cpu.globals->set(canonicalizeIdentifier(name), nativeFn);
}

void Runtime::setCanonicalization(CanonicalizationType canonicalization) {
	m_canonicalization = canonicalization;
}

void Runtime::setCpuHz(i64 hz) {
	m_cpuHz = hz;
	resetTransferCarry();
}

void Runtime::applyActiveMachineTiming(i64 cpuHz) {
	const MachineManifest& manifest = EngineCore::instance().machineManifest();
	const int cycleBudget = calcCyclesPerFrame(cpuHz, EngineCore::instance().ufpsScaled());
	const i64 vblankCycles = resolveVblankCycles(cpuHz, EngineCore::instance().ufpsScaled(), manifest.viewportHeight);
	setCpuHz(cpuHz);
	setCycleBudgetPerFrame(cycleBudget);
	setVblankCycles(static_cast<int>(vblankCycles));
}

void Runtime::setVblankCycles(int cycles) {
	if (cycles <= 0) {
		throw BMSX_RUNTIME_ERROR("[Runtime] vblank_cycles must be greater than 0.");
	}
	if (cycles > m_cycleBudgetPerFrame) {
		throw BMSX_RUNTIME_ERROR("[Runtime] vblank_cycles must be less than or equal to cycles_per_frame.");
	}
	m_vblankCycles = cycles;
	m_vblankStartCycle = m_cycleBudgetPerFrame - m_vblankCycles;
	resetVblankState();
}

void Runtime::resetHardwareState() {
	m_memory.writeValue(IO_IRQ_FLAGS, valueNumber(0.0));
	m_memory.writeValue(IO_IRQ_ACK, valueNumber(0.0));
	m_dmaController.reset();
	m_imgDecController.reset();
	resetVblankState();
	resetRenderBuffers();
}

void Runtime::resetRenderBuffers() {
	RenderQueues::clearAllQueues();
}

void Runtime::setTransferRates(i64 imgDecBytesPerSec, i64 dmaBytesPerSecIso, i64 dmaBytesPerSecBulk) {
	m_imgDecBytesPerSec = imgDecBytesPerSec;
	m_dmaBytesPerSecIso = dmaBytesPerSecIso;
	m_dmaBytesPerSecBulk = dmaBytesPerSecBulk;
	m_imgRate.setBytesPerSec(imgDecBytesPerSec);
	m_dmaIsoRate.setBytesPerSec(dmaBytesPerSecIso);
	m_dmaBulkRate.setBytesPerSec(dmaBytesPerSecBulk);
	resetTransferCarry();
}

void Runtime::setCycleBudgetPerFrame(int budget) {
	if (budget == m_cycleBudgetPerFrame) {
		return;
	}
	m_cycleBudgetPerFrame = budget;
	setGlobal("sys_max_cycles_per_frame", valueNumber(static_cast<double>(budget)));
	resetTransferCarry();
	if (m_vblankCycles > 0) {
		if (m_vblankCycles > m_cycleBudgetPerFrame) {
			throw BMSX_RUNTIME_ERROR("[Runtime] vblank_cycles must be less than or equal to cycles_per_frame.");
		}
		m_vblankStartCycle = m_cycleBudgetPerFrame - m_vblankCycles;
		resetVblankState();
	}
}

void Runtime::grantCycleBudget(int baseBudget, int carryBudget) {
	setCycleBudgetPerFrame(baseBudget);
	const int totalBudget = baseBudget + carryBudget;
	if (hasActiveTick()) {
		m_frameState.cycleBudgetRemaining += totalBudget;
		m_frameState.cycleBudgetGranted += totalBudget;
		return;
	}
	if (carryBudget != 0) {
		m_pendingCarryBudget = carryBudget;
	}
}

bool Runtime::hasActiveTick() const {
	return m_frameActive && m_luaInitialized && m_tickEnabled && !m_runtimeFailed;
}

uint32_t Runtime::trackedRamUsedBytes() const {
	return m_resourceUsageDetector->ramUsedBytes();
}

uint32_t Runtime::trackedVramUsedBytes() const {
	return m_resourceUsageDetector->vramUsedBytes();
}

bool Runtime::consumeLastTickCompletion(i64& outSequence, int& outRemaining) {
	if (!m_lastTickCompleted) {
		return false;
	}
	if (m_lastTickSequence == m_lastTickConsumedSequence) {
		return false;
	}
	m_lastTickConsumedSequence = m_lastTickSequence;
	outSequence = m_lastTickSequence;
	outRemaining = m_lastTickBudgetRemaining;
	return true;
}

bool Runtime::isDrawPending() const {
	return hasEntryContinuation()
		|| m_runtimeFailed;
}

bool Runtime::hasEntryContinuation() const {
	return m_pendingCall == PendingCall::Entry;
}

void Runtime::refreshMemoryMap() {
	const auto engineRom = EngineCore::instance().engineRomView();
	if (engineRom.size > 0) {
		m_memory.setEngineRom(engineRom.data, engineRom.size);
	}
	const auto cartRom = EngineCore::instance().cartRomView();
	if (cartRom.size > 0) {
		m_memory.setCartRom(cartRom.data, cartRom.size);
	} else {
		m_memory.setCartRom(CART_ROM_EMPTY_HEADER.data(), CART_ROM_EMPTY_HEADER.size());
		InputMap emptyMapping;
		Input::instance().getPlayerInput(DEFAULT_KEYBOARD_PLAYER_INDEX)->setInputMap(emptyMapping);
	}
	refreshMemoryMapGlobals();
}

void Runtime::refreshMemoryMapGlobals() {
	setGlobal("sys_vram_system_atlas_base", valueNumber(static_cast<double>(VRAM_SYSTEM_ATLAS_BASE)));
	setGlobal("sys_vram_primary_atlas_base", valueNumber(static_cast<double>(VRAM_PRIMARY_ATLAS_BASE)));
	setGlobal("sys_vram_secondary_atlas_base", valueNumber(static_cast<double>(VRAM_SECONDARY_ATLAS_BASE)));
	setGlobal("sys_vram_framebuffer_base", valueNumber(static_cast<double>(VRAM_FRAMEBUFFER_BASE)));
	setGlobal("sys_vram_staging_base", valueNumber(static_cast<double>(VRAM_STAGING_BASE)));
	setGlobal("sys_vram_system_atlas_size", valueNumber(static_cast<double>(VRAM_SYSTEM_ATLAS_SIZE)));
	setGlobal("sys_vram_primary_atlas_size", valueNumber(static_cast<double>(VRAM_PRIMARY_ATLAS_SIZE)));
	setGlobal("sys_vram_secondary_atlas_size", valueNumber(static_cast<double>(VRAM_SECONDARY_ATLAS_SIZE)));
	setGlobal("sys_vram_framebuffer_size", valueNumber(static_cast<double>(VRAM_FRAMEBUFFER_SIZE)));
	setGlobal("sys_vram_staging_size", valueNumber(static_cast<double>(VRAM_STAGING_SIZE)));
	setGlobal("sys_vram_size", valueNumber(static_cast<double>(trackedVramTotalBytes())));
}

void Runtime::buildAssetMemory(RuntimeAssets& assets, bool keepDecodedData, AssetBuildMode mode) {
	if (mode == AssetBuildMode::Cart) {
		m_memory.resetCartAssets();
	} else {
		m_memory.resetAssetMemory();
	}
	m_vdp.registerImageAssets(assets, keepDecodedData);
	std::vector<const AudioAsset*> audioAssets;
	audioAssets.reserve(assets.audio.size());
	std::unordered_set<std::string> audioIdSet;
	audioIdSet.reserve(assets.audio.size());
	for (const auto& entry : assets.audio) {
		const auto& audioAsset = entry.second;
		audioAssets.push_back(&audioAsset);
		audioIdSet.insert(audioAsset.id);
	}
	std::sort(audioAssets.begin(), audioAssets.end(), [](const AudioAsset* lhs, const AudioAsset* rhs) {
		return lhs->id < rhs->id;
	});
	for (const auto* audioAsset : audioAssets) {
		const std::string& id = audioAsset->id;
		if (m_memory.hasAsset(id)) {
			continue;
		}
		m_memory.registerAudioMeta(
			id,
			static_cast<uint32_t>(audioAsset->sampleRate),
			static_cast<uint32_t>(audioAsset->channels),
			static_cast<uint32_t>(audioAsset->bitsPerSample),
			static_cast<uint32_t>(audioAsset->frames),
			static_cast<uint32_t>(audioAsset->dataOffset),
			static_cast<uint32_t>(audioAsset->dataSize)
		);
	}

	m_memory.finalizeAssetTable();
	m_memory.markAllAssetsDirty();
}

void Runtime::restoreVramSlotTextures() {
	m_vdp.restoreVramSlotTextures();
}

void Runtime::captureVramTextureSnapshots() {
	m_vdp.captureVramTextureSnapshots();
}

void Runtime::flushAssetEdits() {
	m_vdp.flushAssetEdits();
}

Value Runtime::canonicalizeIdentifier(std::string_view value) {
	if (m_canonicalization == CanonicalizationType::None) {
		return valueString(m_cpu.internString(value));
	}
	std::string result(value);
	if (m_canonicalization == CanonicalizationType::Upper) {
		for (char& ch : result) {
			ch = static_cast<char>(std::toupper(static_cast<unsigned char>(ch)));
		}
		return valueString(m_cpu.internString(result));
	}
	for (char& ch : result) {
		ch = static_cast<char>(std::tolower(static_cast<unsigned char>(ch)));
	}
	return valueString(m_cpu.internString(result));
}

std::vector<Value> Runtime::acquireValueScratch() {
	if (!m_valueScratchPool.empty()) {
		auto scratch = std::move(m_valueScratchPool.back());
		m_valueScratchPool.pop_back();
		scratch.clear();
		return scratch;
	}
	return {};
}

void Runtime::releaseValueScratch(std::vector<Value>&& values) {
	values.clear();
	if (m_valueScratchPool.size() < MAX_POOLED_RUNTIME_SCRATCH) {
		m_valueScratchPool.push_back(std::move(values));
	}
}



void Runtime::executeUpdateCallback() {
	try {
		if (m_waitingForVblank) {
			processIrqAck();
			if (m_waitForVblankTargetSequence == 0) {
				m_waitingForVblank = false;
				m_clearBackQueuesAfterWaitResume = false;
			} else {
				if (m_vblankPendingClear && m_vblankActive && m_vblankSequence < m_waitForVblankTargetSequence) {
					setVblankStatus(false);
					m_vblankPendingClear = false;
					m_vblankClearOnIrqEnd = false;
				}
				if (m_vblankSequence < m_waitForVblankTargetSequence) {
					if (m_frameState.cycleBudgetRemaining > 0) {
						const int cyclesToTarget = cyclesUntilNextVblankEdge();
						const int idleCycles = std::min(m_frameState.cycleBudgetRemaining, cyclesToTarget);
						m_frameState.cycleBudgetRemaining -= idleCycles;
						advanceHardware(idleCycles);
						processIrqAck();
					}
					if (m_vblankSequence < m_waitForVblankTargetSequence) {
						return;
					}
				}
				m_waitingForVblank = false;
				m_waitForVblankTargetSequence = 0;
				// Clear queues on the next runnable slice after the completed frame was presented.
				m_clearBackQueuesAfterWaitResume = true;
				if (m_frameState.tickCompleted) {
					return;
				}
			}
		}
		if (m_clearBackQueuesAfterWaitResume) {
			RenderQueues::clearBackQueues();
			m_clearBackQueuesAfterWaitResume = false;
		}
		processIrqAck();
		if (!hasEntryContinuation()) {
			return;
		}
		RunResult result = runWithBudget();
		processIrqAck();
		if (result == RunResult::Halted) {
			m_pendingCall = PendingCall::None;
		}
	} catch (const WaitForVblankSignal&) {
		reconcileCycleBudgetAfterSignal(m_frameState);
		freezeTickCpuStats(m_frameState);
		processIrqAck();
		return;
	} catch (const std::exception& e) {
		std::cerr << "[Runtime] Error in update: " << e.what() << std::endl;
		logDebugState();
		logLuaCallStack();
		m_waitingForVblank = false;
		m_waitForVblankTargetSequence = 0;
		m_clearBackQueuesAfterWaitResume = false;
		m_pendingCall = PendingCall::None;
		m_frameActive = false;
		m_runtimeFailed = true;
	}
}

} // namespace bmsx
