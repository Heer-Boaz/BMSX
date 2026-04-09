#include "runtime.h"
#include "firmware_api.h"
#include "io.h"
#include "lua_heap_usage.h"
#include "program_loader.h"
#include "resource_usage_detector.h"
#include "vdp_packet_schema.h"
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

inline std::runtime_error runtimeFault(const std::string& message) {
	return BMSX_RUNTIME_ERROR("Runtime fault: " + message);
}

inline std::runtime_error vdpFault(const std::string& message) {
	return BMSX_RUNTIME_ERROR("VDP fault: " + message);
}

inline std::runtime_error vdpStreamFault(const std::string& message) {
	return BMSX_RUNTIME_ERROR("VDP stream fault: " + message);
}

constexpr size_t CART_ROM_HEADER_SIZE = 72;
constexpr std::array<u8, CART_ROM_HEADER_SIZE> CART_ROM_EMPTY_HEADER = {};

struct MemoryPacketWordReader {
	static constexpr bool kMemoryBacked = true;
	const Runtime* runtime = nullptr;
	uint32_t base = 0u;

	inline uint32_t readU32(int index) const {
		return runtime->memory().readU32(base + static_cast<uint32_t>(index) * IO_ARG_STRIDE);
	}
};

struct BufferPacketWordReader {
	static constexpr bool kMemoryBacked = false;
	const u32* words = nullptr;
	uint32_t wordOffset = 0u;

	inline uint32_t readU32(int index) const {
		return words[wordOffset + static_cast<uint32_t>(index)];
	}
};

template<typename Reader>
inline uint32_t readPacketU32(const Reader& reader, int index) {
	return reader.readU32(index);
}

template<typename Reader>
inline int32_t readPacketI32(const Reader& reader, int index) {
	return static_cast<int32_t>(reader.readU32(index));
}

template<typename Reader>
inline float readPacketF32(const Reader& reader, int index) {
	const uint32_t bits = reader.readU32(index);
	float value = 0.0f;
	std::memcpy(&value, &bits, sizeof(value));
	return value;
}

template<typename Reader>
inline uint32_t readPacketArgU32(const Reader& reader, uint32_t cmd, int index) {
	if (getVdpPacketArgKind(cmd, static_cast<uint32_t>(index)) != VdpPacketWordKind::U32) {
		throw vdpFault("packet arg " + std::to_string(index) + " is not encoded as u32.");
	}
	return readPacketU32(reader, index);
}

template<typename Reader>
inline int32_t readPacketArgI32(const Reader& reader, uint32_t cmd, int index) {
	if (getVdpPacketArgKind(cmd, static_cast<uint32_t>(index)) != VdpPacketWordKind::U32) {
		throw vdpFault("packet arg " + std::to_string(index) + " is not encoded as u32.");
	}
	return readPacketI32(reader, index);
}

template<typename Reader>
inline float readPacketArgF32(const Reader& reader, uint32_t cmd, int index) {
	if (getVdpPacketArgKind(cmd, static_cast<uint32_t>(index)) != VdpPacketWordKind::F32) {
		throw vdpFault("packet arg " + std::to_string(index) + " is not encoded as f32.");
	}
	return readPacketF32(reader, index);
}

template<typename Reader>
inline Color readPacketColor(const Reader& reader, uint32_t cmd, int offset) {
	return Color{
		readPacketArgF32(reader, cmd, offset + 0),
		readPacketArgF32(reader, cmd, offset + 1),
		readPacketArgF32(reader, cmd, offset + 2),
		readPacketArgF32(reader, cmd, offset + 3),
	};
}

std::string dumpStreamWords(const Memory& memory, uint32_t baseAddr, uint32_t wordCount) {
	std::ostringstream out;
	for (uint32_t index = 0; index < wordCount; ++index) {
		if (index != 0u) {
			out << ' ';
		}
		out << memory.readU32(baseAddr + index * IO_WORD_SIZE);
	}
	return out.str();
}

template<typename ArgReader, typename PayloadReader>
void processVdpCommand(Runtime& runtime, uint32_t cmd, uint32_t argWords, const ArgReader& argReader, const PayloadReader& payloadReader, uint32_t payloadWords) {
	switch (cmd) {
		case IO_CMD_VDP_CLEAR: {
			assertVdpPacketArgWords(cmd, argWords);
			runtime.vdp().enqueueClear(readPacketColor(argReader, cmd, 0));
			break;
		}
		case IO_CMD_VDP_FILL_RECT: {
			assertVdpPacketArgWords(cmd, argWords);
			runtime.vdp().enqueueFillRect(
				readPacketArgF32(argReader, cmd, 0),
				readPacketArgF32(argReader, cmd, 1),
				readPacketArgF32(argReader, cmd, 2),
				readPacketArgF32(argReader, cmd, 3),
				readPacketArgF32(argReader, cmd, 4),
				static_cast<Layer2D>(readPacketArgU32(argReader, cmd, 5)),
				readPacketColor(argReader, cmd, 6)
			);
			break;
		}
		case IO_CMD_VDP_DRAW_LINE: {
			assertVdpPacketArgWords(cmd, argWords);
			runtime.vdp().enqueueDrawLine(
				readPacketArgF32(argReader, cmd, 0),
				readPacketArgF32(argReader, cmd, 1),
				readPacketArgF32(argReader, cmd, 2),
				readPacketArgF32(argReader, cmd, 3),
				readPacketArgF32(argReader, cmd, 4),
				static_cast<Layer2D>(readPacketArgU32(argReader, cmd, 5)),
				readPacketColor(argReader, cmd, 6),
				readPacketArgF32(argReader, cmd, 10)
			);
			break;
		}
		case IO_CMD_VDP_BLIT: {
			assertVdpPacketArgWords(cmd, argWords);
			const uint32_t flipFlags = readPacketArgU32(argReader, cmd, 7);
			const u32 handle = readPacketArgU32(argReader, cmd, 0);
			const f32 x = readPacketArgF32(argReader, cmd, 1);
			const f32 y = readPacketArgF32(argReader, cmd, 2);
			const f32 z = readPacketArgF32(argReader, cmd, 3);
			const Layer2D layer = static_cast<Layer2D>(readPacketArgU32(argReader, cmd, 4));
			const f32 scaleX = readPacketArgF32(argReader, cmd, 5);
			const f32 scaleY = readPacketArgF32(argReader, cmd, 6);
			const Color color = readPacketColor(argReader, cmd, 8);
			const f32 parallaxWeight = readPacketArgF32(argReader, cmd, 12);
			runtime.vdp().enqueueBlit(
				handle,
				x,
				y,
				z,
				layer,
				scaleX,
				scaleY,
				(flipFlags & 1u) != 0u,
				(flipFlags & 2u) != 0u,
				color,
				parallaxWeight
			);
			break;
		}
		case IO_CMD_VDP_GLYPH_RUN: {
			assertVdpPacketArgWords(cmd, argWords);
			const std::string& text = runtime.cpu().stringPool().toString(readPacketArgU32(argReader, cmd, 0));
			const bool backgroundEnabled = readPacketArgU32(argReader, cmd, 12) != 0u;
			const std::optional<Color> backgroundColor = backgroundEnabled
				? std::optional<Color>(readPacketColor(argReader, cmd, 13))
				: std::nullopt;
			runtime.vdp().enqueueGlyphRun(
				text,
				readPacketArgF32(argReader, cmd, 1),
				readPacketArgF32(argReader, cmd, 2),
				readPacketArgF32(argReader, cmd, 3),
				runtime.api().resolveFontId(readPacketArgU32(argReader, cmd, 4)),
				readPacketColor(argReader, cmd, 8),
				backgroundColor,
				readPacketArgI32(argReader, cmd, 5),
				readPacketArgI32(argReader, cmd, 6),
				static_cast<Layer2D>(readPacketArgU32(argReader, cmd, 7))
			);
			break;
		}
		case IO_CMD_VDP_TILE_RUN: {
			assertVdpPacketArgWords(cmd, argWords);
			const uint32_t tileCount = readPacketArgU32(argReader, cmd, 0);
			if (tileCount > payloadWords) {
				throw vdpFault("tile payload underrun (" + std::to_string(tileCount) + " > " + std::to_string(payloadWords) + ").");
			}
			const i32 cols = readPacketArgI32(argReader, cmd, 1);
			const i32 rows = readPacketArgI32(argReader, cmd, 2);
			if (tileCount != static_cast<uint32_t>(cols * rows)) {
				throw vdpFault("tile payload size mismatch (" + std::to_string(tileCount) + " != " + std::to_string(cols * rows) + ").");
			}
			if constexpr (PayloadReader::kMemoryBacked) {
				runtime.vdp().enqueuePayloadTileRun(
					payloadReader.base,
					tileCount,
					cols,
					rows,
					readPacketArgI32(argReader, cmd, 3),
					readPacketArgI32(argReader, cmd, 4),
					readPacketArgI32(argReader, cmd, 5),
					readPacketArgI32(argReader, cmd, 6),
					readPacketArgI32(argReader, cmd, 7),
					readPacketArgI32(argReader, cmd, 8),
					readPacketArgF32(argReader, cmd, 9),
					static_cast<Layer2D>(readPacketArgU32(argReader, cmd, 10))
				);
			} else {
				runtime.vdp().enqueuePayloadTileRunWords(
					payloadReader.words + payloadReader.wordOffset,
					tileCount,
					cols,
					rows,
					readPacketArgI32(argReader, cmd, 3),
					readPacketArgI32(argReader, cmd, 4),
					readPacketArgI32(argReader, cmd, 5),
					readPacketArgI32(argReader, cmd, 6),
					readPacketArgI32(argReader, cmd, 7),
					readPacketArgI32(argReader, cmd, 8),
					readPacketArgF32(argReader, cmd, 9),
					static_cast<Layer2D>(readPacketArgU32(argReader, cmd, 10))
				);
			}
			break;
		}
		default:
			throw vdpFault("unknown I/O command " + std::to_string(cmd) + ".");
	}
}
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
		throw runtimeFault("instance already exists.");
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
	, m_vdp(
			m_memory,
			[this]() { return currentSchedulerNowCycles(); },
			[this](int64_t deadlineCycles) { scheduleDeviceService(DeviceServiceVdp, deadlineCycles); },
			[this]() { cancelDeviceService(DeviceServiceVdp); }
		)
	, m_stringHandles(m_memory)
	, m_cpu(m_memory, &m_stringHandles)
	, m_dmaController(
			m_memory,
			[this](uint32_t mask) { raiseIrqFlags(mask); },
			[this](uint32_t src, size_t byteLength) { sealVdpDmaTransfer(src, byteLength); },
			[this]() { return currentSchedulerNowCycles(); },
			[this](int64_t deadlineCycles) { scheduleDeviceService(DeviceServiceDma, deadlineCycles); },
			[this]() { cancelDeviceService(DeviceServiceDma); }
		)
	, m_geometryController(
			m_memory,
			[this](uint32_t mask) { raiseIrqFlags(mask); },
			[this](int64_t deadlineCycles) { scheduleDeviceService(DeviceServiceGeo, deadlineCycles); },
			[this]() { cancelDeviceService(DeviceServiceGeo); }
		)
	, m_imgDecController(
			m_memory,
			m_dmaController,
			[this](uint32_t mask) { raiseIrqFlags(mask); },
			[this]() { return currentSchedulerNowCycles(); },
			[this](int64_t deadlineCycles) { scheduleDeviceService(DeviceServiceImg, deadlineCycles); },
			[this]() { cancelDeviceService(DeviceServiceImg); }
		)
	, m_viewport(options.viewport)
	, m_canonicalization(options.canonicalization)
	, m_cpuHz(options.cpuHz)
	, m_vdpWorkUnitsPerSec(options.vdpWorkUnitsPerSec)
	, m_geoWorkUnitsPerSec(options.geoWorkUnitsPerSec)
	, m_cycleBudgetPerFrame(options.cycleBudgetPerFrame)
{
	// Initialize I/O memory region
	m_memory.clearIoSlots();
	resetVdpIngressState();
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
	m_memory.writeValue(IO_GEO_SRC0, valueNumber(0.0));
	m_memory.writeValue(IO_GEO_SRC1, valueNumber(0.0));
	m_memory.writeValue(IO_GEO_SRC2, valueNumber(0.0));
	m_memory.writeValue(IO_GEO_DST0, valueNumber(0.0));
	m_memory.writeValue(IO_GEO_DST1, valueNumber(0.0));
	m_memory.writeValue(IO_GEO_COUNT, valueNumber(0.0));
	m_memory.writeValue(IO_GEO_CMD, valueNumber(0.0));
	m_memory.writeValue(IO_GEO_CTRL, valueNumber(0.0));
	m_memory.writeValue(IO_GEO_STATUS, valueNumber(0.0));
	m_memory.writeValue(IO_GEO_PARAM0, valueNumber(0.0));
	m_memory.writeValue(IO_GEO_PARAM1, valueNumber(0.0));
	m_memory.writeValue(IO_GEO_STRIDE0, valueNumber(0.0));
	m_memory.writeValue(IO_GEO_STRIDE1, valueNumber(0.0));
	m_memory.writeValue(IO_GEO_STRIDE2, valueNumber(0.0));
	m_memory.writeValue(IO_GEO_PROCESSED, valueNumber(0.0));
	m_memory.writeValue(IO_GEO_FAULT, valueNumber(0.0));
	m_memory.writeValue(IO_IMG_SRC, valueNumber(0.0));
	m_memory.writeValue(IO_IMG_LEN, valueNumber(0.0));
	m_memory.writeValue(IO_IMG_DST, valueNumber(0.0));
	m_memory.writeValue(IO_IMG_CAP, valueNumber(0.0));
	m_memory.writeValue(IO_IMG_CTRL, valueNumber(0.0));
	m_memory.writeValue(IO_IMG_STATUS, valueNumber(0.0));
	m_memory.writeValue(IO_IMG_WRITTEN, valueNumber(0.0));
	m_dmaController.reset();
	m_geometryController.reset();
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
	setVdpWorkUnitsPerSec(options.vdpWorkUnitsPerSec);
	setGeoWorkUnitsPerSec(options.geoWorkUnitsPerSec);
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

void Runtime::resetVdpIngressState() {
	m_vdpFifoWordByteCount = 0;
	m_vdpFifoStreamWordCount = 0;
}

bool Runtime::hasOpenDirectVdpFifoIngress() const {
	return m_vdpFifoWordByteCount != 0 || m_vdpFifoStreamWordCount != 0u;
}

bool Runtime::hasBlockedVdpSubmitPath() const {
	return hasOpenDirectVdpFifoIngress() || m_dmaController.hasPendingVdpSubmit() || !m_vdp.canAcceptSubmittedFrame();
}

void Runtime::pushVdpFifoWord(u32 word) {
	if (m_vdpFifoStreamWordCount >= VDP_STREAM_CAPACITY_WORDS) {
		throw vdpStreamFault("stream overflow (" + std::to_string(m_vdpFifoStreamWordCount + 1u) + " > " + std::to_string(VDP_STREAM_CAPACITY_WORDS) + ").");
	}
	m_vdpFifoStreamWords[static_cast<size_t>(m_vdpFifoStreamWordCount)] = word;
	m_vdpFifoStreamWordCount += 1u;
}

void Runtime::writeVdpFifoBytes(const u8* data, size_t length) {
	for (size_t index = 0; index < length; index += 1u) {
		m_vdpFifoWordScratch[static_cast<size_t>(m_vdpFifoWordByteCount)] = data[index];
		m_vdpFifoWordByteCount += 1;
		if (m_vdpFifoWordByteCount != 4) {
			continue;
		}
		const u32 word = static_cast<u32>(m_vdpFifoWordScratch[0])
			| (static_cast<u32>(m_vdpFifoWordScratch[1]) << 8)
			| (static_cast<u32>(m_vdpFifoWordScratch[2]) << 16)
			| (static_cast<u32>(m_vdpFifoWordScratch[3]) << 24);
		m_vdpFifoWordByteCount = 0;
		pushVdpFifoWord(word);
	}
}

void Runtime::consumeSealedVdpStream(uint32_t baseAddr, size_t byteLength) {
	if ((byteLength & 3u) != 0u) {
		throw vdpStreamFault("sealed stream length must be word-aligned.");
	}
	if (byteLength > VDP_STREAM_BUFFER_SIZE) {
		throw vdpStreamFault("sealed stream overflow (" + std::to_string(byteLength) + " > " + std::to_string(VDP_STREAM_BUFFER_SIZE) + ").");
	}
	uint32_t cursor = baseAddr;
	const uint32_t end = baseAddr + static_cast<uint32_t>(byteLength);
	uint32_t packetIndex = 0u;
	m_vdp.beginSubmittedFrame();
	try {
		while (cursor < end) {
			if (cursor + VDP_STREAM_PACKET_HEADER_WORDS * IO_WORD_SIZE > end) {
				throw vdpStreamFault("stream ended mid-packet header.");
			}
			const u32 cmd = m_memory.readU32(cursor);
			const u32 argWords = m_memory.readU32(cursor + IO_WORD_SIZE);
			const u32 payloadWords = m_memory.readU32(cursor + IO_WORD_SIZE * 2u);
			if (payloadWords > VDP_STREAM_PAYLOAD_CAPACITY_WORDS) {
				const uint32_t dumpBase = cursor >= (IO_WORD_SIZE * 6u) ? (cursor - IO_WORD_SIZE * 6u) : baseAddr;
				const uint32_t dumpWords = ((cursor + IO_WORD_SIZE * 6u) <= end) ? 12u : ((end - dumpBase) / IO_WORD_SIZE);
				throw vdpStreamFault(
					"submit payload overflow at addr="
					+ std::to_string(cursor)
					+ " cmd=" + std::to_string(cmd)
					+ " argWords=" + std::to_string(argWords)
					+ " payloadWords=" + std::to_string(payloadWords)
					+ " dump=[" + dumpStreamWords(m_memory, dumpBase, dumpWords) + "]"
					+ " (" + std::to_string(payloadWords)
					+ " > " + std::to_string(VDP_STREAM_PAYLOAD_CAPACITY_WORDS) + ")."
				);
			}
			const u32 packetWordCount = VDP_STREAM_PACKET_HEADER_WORDS + argWords + payloadWords;
			const u32 packetByteCount = packetWordCount * IO_WORD_SIZE;
			if (cursor + packetByteCount > end) {
				const uint32_t dumpBase = cursor >= (IO_WORD_SIZE * 6u) ? (cursor - IO_WORD_SIZE * 6u) : baseAddr;
				const uint32_t dumpWords = ((cursor + IO_WORD_SIZE * 6u) <= end) ? 12u : ((end - dumpBase) / IO_WORD_SIZE);
				throw vdpStreamFault(
					"stream ended mid-packet payload at addr="
					+ std::to_string(cursor)
					+ " packet=" + std::to_string(packetIndex)
					+ " cmd=" + std::to_string(cmd)
					+ " argWords=" + std::to_string(argWords)
					+ " payloadWords=" + std::to_string(payloadWords)
					+ " packetWords=" + std::to_string(packetWordCount)
					+ " remainingWords=" + std::to_string((end - cursor) / IO_WORD_SIZE)
					+ " dump=[" + dumpStreamWords(m_memory, dumpBase, dumpWords) + "]"
				);
			}
			m_vdp.syncRegisters();
			const MemoryPacketWordReader argReader{this, cursor + VDP_STREAM_PACKET_HEADER_WORDS * IO_WORD_SIZE};
			const MemoryPacketWordReader payloadReader{this, cursor + (VDP_STREAM_PACKET_HEADER_WORDS + argWords) * IO_WORD_SIZE};
			processVdpCommand(
				*this,
				cmd,
				argWords,
				argReader,
				payloadReader,
				payloadWords
			);
			cursor += packetByteCount;
			packetIndex += 1u;
		}
		m_vdp.sealSubmittedFrame();
	} catch (...) {
		m_vdp.cancelSubmittedFrame();
		throw;
	}
	refreshVdpSubmitBusyStatus();
}

void Runtime::sealVdpFifoTransfer() {
	if (m_vdpFifoWordByteCount != 0) {
		throw vdpStreamFault("FIFO transfer ended on a partial word.");
	}
	if (m_vdpFifoStreamWordCount == 0u) {
		return;
	}
	u32 cursor = 0u;
	m_vdp.beginSubmittedFrame();
	try {
		while (cursor < m_vdpFifoStreamWordCount) {
			if (cursor + VDP_STREAM_PACKET_HEADER_WORDS > m_vdpFifoStreamWordCount) {
				throw vdpStreamFault("stream ended mid-packet header.");
			}
			const u32 cmd = m_vdpFifoStreamWords[static_cast<size_t>(cursor)];
			const u32 argWords = m_vdpFifoStreamWords[static_cast<size_t>(cursor + 1u)];
			const u32 payloadWords = m_vdpFifoStreamWords[static_cast<size_t>(cursor + 2u)];
			if (payloadWords > VDP_STREAM_PAYLOAD_CAPACITY_WORDS) {
				throw vdpStreamFault(
					"submit payload overflow at word="
					+ std::to_string(cursor)
					+ " cmd=" + std::to_string(cmd)
					+ " argWords=" + std::to_string(argWords)
					+ " payloadWords=" + std::to_string(payloadWords)
					+ " (" + std::to_string(payloadWords)
					+ " > " + std::to_string(VDP_STREAM_PAYLOAD_CAPACITY_WORDS) + ")."
				);
			}
			const u32 packetWordCount = VDP_STREAM_PACKET_HEADER_WORDS + argWords + payloadWords;
			if (cursor + packetWordCount > m_vdpFifoStreamWordCount) {
				throw vdpStreamFault("stream ended mid-packet payload.");
			}
			m_vdp.syncRegisters();
			const BufferPacketWordReader argReader{m_vdpFifoStreamWords.data(), cursor + VDP_STREAM_PACKET_HEADER_WORDS};
			const BufferPacketWordReader payloadReader{m_vdpFifoStreamWords.data(), cursor + VDP_STREAM_PACKET_HEADER_WORDS + argWords};
			processVdpCommand(
				*this,
				cmd,
				argWords,
				argReader,
				payloadReader,
				payloadWords
			);
			cursor += packetWordCount;
		}
		m_vdp.sealSubmittedFrame();
	} catch (...) {
		m_vdp.cancelSubmittedFrame();
		throw;
	}
	refreshVdpSubmitBusyStatus();
	resetVdpIngressState();
}

void Runtime::sealVdpDmaTransfer(uint32_t src, size_t byteLength) {
	consumeSealedVdpStream(src, byteLength);
}

void Runtime::consumeDirectVdpCommand(u32 cmd) {
	const VdpPacketSchema& schema = getVdpPacketSchema(cmd);
	m_vdp.beginSubmittedFrame();
	try {
		m_vdp.syncRegisters();
		const MemoryPacketWordReader argReader{this, IO_VDP_CMD_ARG0};
		const MemoryPacketWordReader payloadReader{this, 0u};
		processVdpCommand(
			*this,
			cmd,
			schema.argWords,
			argReader,
			payloadReader,
			0u
		);
		m_vdp.sealSubmittedFrame();
	} catch (...) {
		m_vdp.cancelSubmittedFrame();
		throw;
	}
	refreshVdpSubmitBusyStatus();
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
	resetFrameState();
	m_runtimeFailed = false;
	m_luaInitialized = false;
	m_pendingCall = PendingCall::None;
	// The globals table alone is not enough to reset the Lua environment here.
	// CPU::setProgram() rebuilds the slot-backed globals from the cached slot arrays,
	// so stale values would otherwise get written straight back into the new globals table.
	// That specifically resurrected the previous bootrom/cart `update` closure across cart boot,
	// and the runtime later called a dead closure whose captured upvalues pointed at freed state.
	m_cpu.clearGlobalSlots();
	m_cpu.globals->clear();
	m_memory.clearIoSlots();
	resetVdpIngressState();
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

	m_cpu.start(entryProtoIndex);
	enforceLuaHeapBudget();
	m_pendingCall = PendingCall::Entry;
	queueLifecycleHandlers(true, true);
	m_luaInitialized = true;
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
				"Runtime fault: cart boot request failed while leaving system boot screen active.\n");
		}
	} catch (const std::exception& error) {
		setCartBootReadyFlag(false);
		EngineCore::instance().log(LogLevel::Error,
			"Runtime fault: cart boot request failed while leaving system boot screen active: %s\n",
			error.what());
	}
	return true;
}

void Runtime::refreshDeviceTimings(i64 nowCycles) {
	m_dmaController.setTiming(m_cpuHz, m_dmaBytesPerSecIso, m_dmaBytesPerSecBulk, nowCycles);
	m_imgDecController.setTiming(m_cpuHz, m_imgDecBytesPerSec, nowCycles);
	m_geometryController.setTiming(m_cpuHz, m_geoWorkUnitsPerSec, nowCycles);
	m_vdp.setTiming(m_cpuHz, m_vdpWorkUnitsPerSec, nowCycles);
}

void Runtime::advanceTime(int cycles) {
	if (cycles <= 0) {
		return;
	}
	const i64 nextNow = m_schedulerNowCycles + cycles;
	m_dmaController.accrueCycles(cycles, nextNow);
	m_imgDecController.accrueCycles(cycles, nextNow);
	m_geometryController.accrueCycles(cycles, nextNow);
	m_vdp.accrueCycles(cycles, nextNow);
	m_schedulerNowCycles = nextNow;
	runDueTimers();
	refreshVdpSubmitBusyStatus();
}

i64 Runtime::currentSchedulerNowCycles() const {
	if (!m_schedulerSliceActive) {
		return m_schedulerNowCycles;
	}
	const int consumed = m_activeSliceBudgetCycles - m_cpu.instructionBudgetRemaining;
	return m_activeSliceBaseCycle + consumed;
}

int Runtime::getCyclesIntoFrame() const {
	return static_cast<int>(m_schedulerNowCycles - m_frameStartCycle);
}

void Runtime::resetSchedulerState() {
	clearTimerHeap();
	m_schedulerNowCycles = 0;
	m_frameStartCycle = 0;
	m_schedulerSliceActive = false;
	m_activeSliceBaseCycle = 0;
	m_activeSliceBudgetCycles = 0;
	m_activeSliceTargetCycle = 0;
	m_vblankEnterTimerGeneration = 0;
	m_frameEndTimerGeneration = 0;
	m_deviceServiceTimerGeneration.fill(0);
}

void Runtime::clearTimerHeap() {
	m_timerCount = 0;
	m_timerDeadlines.clear();
	m_timerKinds.clear();
	m_timerPayloads.clear();
	m_timerGenerations.clear();
}

uint32_t Runtime::nextTimerGeneration(uint32_t value) {
	const uint32_t next = value + 1u;
	return next == 0u ? 1u : next;
}

void Runtime::pushTimer(i64 deadline, uint8_t kind, uint8_t payload, uint32_t generation) {
	size_t index = m_timerCount;
	m_timerCount += 1;
	m_timerDeadlines.push_back(deadline);
	m_timerKinds.push_back(kind);
	m_timerPayloads.push_back(payload);
	m_timerGenerations.push_back(generation);
	while (index > 0) {
		const size_t parent = (index - 1u) >> 1u;
		if (m_timerDeadlines[parent] <= deadline) {
			break;
		}
		m_timerDeadlines[index] = m_timerDeadlines[parent];
		m_timerKinds[index] = m_timerKinds[parent];
		m_timerPayloads[index] = m_timerPayloads[parent];
		m_timerGenerations[index] = m_timerGenerations[parent];
		index = parent;
	}
	m_timerDeadlines[index] = deadline;
	m_timerKinds[index] = kind;
	m_timerPayloads[index] = payload;
	m_timerGenerations[index] = generation;
}

void Runtime::removeTopTimer() {
	if (m_timerCount == 0) {
		return;
	}
	const size_t lastIndex = m_timerCount - 1u;
	const i64 deadline = m_timerDeadlines[lastIndex];
	const uint8_t kind = m_timerKinds[lastIndex];
	const uint8_t payload = m_timerPayloads[lastIndex];
	const uint32_t generation = m_timerGenerations[lastIndex];
	m_timerCount = lastIndex;
	m_timerDeadlines.pop_back();
	m_timerKinds.pop_back();
	m_timerPayloads.pop_back();
	m_timerGenerations.pop_back();
	if (lastIndex == 0u) {
		return;
	}
	size_t index = 0u;
	const size_t half = lastIndex >> 1u;
	while (index < half) {
		size_t child = (index << 1u) + 1u;
		if (child + 1u < lastIndex && m_timerDeadlines[child + 1u] < m_timerDeadlines[child]) {
			child += 1u;
		}
		if (m_timerDeadlines[child] >= deadline) {
			break;
		}
		m_timerDeadlines[index] = m_timerDeadlines[child];
		m_timerKinds[index] = m_timerKinds[child];
		m_timerPayloads[index] = m_timerPayloads[child];
		m_timerGenerations[index] = m_timerGenerations[child];
		index = child;
	}
	m_timerDeadlines[index] = deadline;
	m_timerKinds[index] = kind;
	m_timerPayloads[index] = payload;
	m_timerGenerations[index] = generation;
}

bool Runtime::isTimerCurrent(uint8_t kind, uint8_t payload, uint32_t generation) const {
	switch (kind) {
		case TimerKindVblankEnter:
			return generation == m_vblankEnterTimerGeneration;
		case TimerKindFrameEnd:
			return generation == m_frameEndTimerGeneration;
		case TimerKindDeviceService:
			return generation == m_deviceServiceTimerGeneration[payload];
		default:
			throw runtimeFault("unknown timer kind " + std::to_string(kind) + ".");
	}
}

void Runtime::discardStaleTopTimers() {
	while (m_timerCount > 0u) {
		const uint8_t kind = m_timerKinds[0];
		const uint8_t payload = m_timerPayloads[0];
		const uint32_t generation = m_timerGenerations[0];
		if (isTimerCurrent(kind, payload, generation)) {
			return;
		}
		removeTopTimer();
	}
}

i64 Runtime::nextTimerDeadline() {
	discardStaleTopTimers();
	if (m_timerCount == 0u) {
		return std::numeric_limits<i64>::max();
	}
	return m_timerDeadlines[0];
}

void Runtime::runDueTimers() {
	discardStaleTopTimers();
	while (m_timerCount > 0u && m_timerDeadlines[0] <= m_schedulerNowCycles) {
		const uint8_t kind = m_timerKinds[0];
		const uint8_t payload = m_timerPayloads[0];
		removeTopTimer();
		dispatchTimer(kind, payload);
		discardStaleTopTimers();
	}
}

void Runtime::dispatchTimer(uint8_t kind, uint8_t payload) {
	switch (kind) {
		case TimerKindVblankEnter:
			handleVblankEnterTimer();
			return;
		case TimerKindFrameEnd:
			handleFrameEndTimer();
			return;
		case TimerKindDeviceService:
			runDeviceService(payload);
			return;
		default:
			throw runtimeFault("unknown timer kind " + std::to_string(kind) + ".");
	}
}

void Runtime::scheduleVblankEnterTimer(i64 deadlineCycles) {
	const uint32_t generation = nextTimerGeneration(m_vblankEnterTimerGeneration);
	m_vblankEnterTimerGeneration = generation;
	pushTimer(deadlineCycles, TimerKindVblankEnter, 0u, generation);
	requestYieldForEarlierDeadline(deadlineCycles);
}

void Runtime::scheduleFrameEndTimer(i64 deadlineCycles) {
	const uint32_t generation = nextTimerGeneration(m_frameEndTimerGeneration);
	m_frameEndTimerGeneration = generation;
	pushTimer(deadlineCycles, TimerKindFrameEnd, 0u, generation);
	requestYieldForEarlierDeadline(deadlineCycles);
}

void Runtime::scheduleCurrentFrameTimers() {
	scheduleFrameEndTimer(m_frameStartCycle + m_cycleBudgetPerFrame);
	if (m_vblankStartCycle > 0 && getCyclesIntoFrame() < m_vblankStartCycle) {
		scheduleVblankEnterTimer(m_frameStartCycle + m_vblankStartCycle);
	}
}

void Runtime::handleVblankEnterTimer() {
	if (!m_vblankActive) {
		enterVblank();
	}
}

void Runtime::handleFrameEndTimer() {
	if (m_vblankStartCycle == 0) {
		m_frameStartCycle = m_schedulerNowCycles;
		scheduleCurrentFrameTimers();
		enterVblank();
		return;
	}
	if (m_vblankActive) {
		m_vblankPendingClear = true;
	}
	m_frameStartCycle = m_schedulerNowCycles;
	scheduleCurrentFrameTimers();
}

void Runtime::scheduleDeviceService(uint8_t deviceKind, i64 deadlineCycles) {
	const uint32_t generation = nextTimerGeneration(m_deviceServiceTimerGeneration[deviceKind]);
	m_deviceServiceTimerGeneration[deviceKind] = generation;
	pushTimer(deadlineCycles, TimerKindDeviceService, deviceKind, generation);
	requestYieldForEarlierDeadline(deadlineCycles);
}

void Runtime::cancelDeviceService(uint8_t deviceKind) {
	m_deviceServiceTimerGeneration[deviceKind] = nextTimerGeneration(m_deviceServiceTimerGeneration[deviceKind]);
}

void Runtime::requestYieldForEarlierDeadline(i64 deadlineCycles) {
	if (!m_schedulerSliceActive) {
		return;
	}
	if (deadlineCycles > m_activeSliceTargetCycle) {
		return;
	}
	m_cpu.requestYield();
}

void Runtime::runDeviceService(uint8_t deviceKind) {
	const i64 nowCycles = m_schedulerNowCycles;
	switch (deviceKind) {
		case DeviceServiceGeo:
			m_geometryController.onService(nowCycles);
			return;
		case DeviceServiceDma:
			m_dmaController.onService(nowCycles);
			refreshVdpSubmitBusyStatus();
			return;
		case DeviceServiceImg:
			m_imgDecController.onService(nowCycles);
			return;
		case DeviceServiceVdp:
			m_vdp.onService(nowCycles);
			refreshVdpSubmitBusyStatus();
			return;
		default:
			throw runtimeFault("unknown device service kind " + std::to_string(deviceKind) + ".");
	}
}

void Runtime::resetVblankState() {
	resetSchedulerState();
	m_vblankActive = false;
	m_vblankPendingClear = false;
	m_vblankClearOnIrqEnd = false;
	m_vblankSequence = 0;
	m_lastCompletedVblankSequence = 0;
	m_vdpStatus = 0;
	m_memory.writeValue(IO_VDP_STATUS, valueNumber(static_cast<double>(m_vdpStatus)));
	if (m_vblankStartCycle == 0) {
		setVblankStatus(true);
	}
	scheduleCurrentFrameTimers();
	refreshDeviceTimings(m_schedulerNowCycles);
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

void Runtime::setVdpSubmitBusyStatus(bool active) {
	const uint32_t mask = VDP_STATUS_SUBMIT_BUSY;
	const uint32_t nextStatus = active ? (m_vdpStatus | mask) : (m_vdpStatus & ~mask);
	if (nextStatus == m_vdpStatus) {
		return;
	}
	m_vdpStatus = nextStatus;
	m_memory.writeValue(IO_VDP_STATUS, valueNumber(static_cast<double>(m_vdpStatus)));
}

void Runtime::refreshVdpSubmitBusyStatus() {
	setVdpSubmitBusyStatus(hasBlockedVdpSubmitPath());
}

void Runtime::setVdpSubmitRejectedStatus(bool active) {
	const uint32_t mask = VDP_STATUS_SUBMIT_REJECTED;
	const uint32_t nextStatus = active ? (m_vdpStatus | mask) : (m_vdpStatus & ~mask);
	if (nextStatus == m_vdpStatus) {
		return;
	}
	m_vdpStatus = nextStatus;
	m_memory.writeValue(IO_VDP_STATUS, valueNumber(static_cast<double>(m_vdpStatus)));
}

void Runtime::noteRejectedVdpSubmitAttempt() {
	setVdpSubmitRejectedStatus(true);
	refreshVdpSubmitBusyStatus();
}

void Runtime::noteAcceptedVdpSubmitAttempt() {
	setVdpSubmitRejectedStatus(false);
	refreshVdpSubmitBusyStatus();
}

void Runtime::syncVdpSubmitAttemptStatusFromDma(uint32_t dst) {
	if (dst != IO_VDP_FIFO) {
		return;
	}
	const uint32_t dmaStatus = static_cast<uint32_t>(asNumber(m_memory.readValue(IO_DMA_STATUS)));
	if ((dmaStatus & DMA_STATUS_REJECTED) != 0u) {
		noteRejectedVdpSubmitAttempt();
		return;
	}
	if ((dmaStatus & DMA_STATUS_ERROR) != 0u) {
		return;
	}
	if ((dmaStatus & (DMA_STATUS_BUSY | DMA_STATUS_DONE)) != 0u) {
		noteAcceptedVdpSubmitAttempt();
	}
}

void Runtime::enterVblank() {
	m_vblankSequence += 1;
	commitFrameOnVblankEdge();
	setVblankStatus(true);
	raiseIrqFlags(IRQ_VBLANK);
}

void Runtime::commitFrameOnVblankEdge() {
	m_vdp.syncRegisters();
	m_vdp.presentReadyFrameOnVblankEdge();
	m_vdp.commitViewSnapshot(*EngineCore::instance().view());
	refreshVdpSubmitBusyStatus();
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
	m_lastTickVisualFrameCommitted = m_vdp.lastFrameCommitted();
	m_lastTickVdpFrameCost = m_vdp.lastFrameCost();
	m_lastTickVdpFrameHeld = m_vdp.lastFrameHeld();
	m_lastTickCompleted = true;
	m_lastTickSequence += 1;
}

void Runtime::reconcileCycleBudgetAfterSignal(FrameState& frameState) {
	const int remaining = m_cpu.instructionBudgetRemaining;
	const int consumed = frameState.cycleBudgetRemaining - remaining;
	if (consumed < 0) {
		throw runtimeFault("negative cycle reconciliation.");
	}
	frameState.cycleBudgetRemaining = remaining;
	if (consumed > 0) {
		advanceTime(consumed);
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
	m_waitForVblankTargetSequence = resumeOnCurrentEdge ? m_vblankSequence : nextVblankSequence;
	if (resumeOnCurrentEdge) {
		if (!m_frameActive) {
			throw runtimeFault("wait_vblank resumed without an active frame state.");
		}
		reconcileCycleBudgetAfterSignal(m_frameState);
		freezeTickCpuStats(m_frameState);
		completeTickIfPending(m_frameState, m_vblankSequence);
	}
	m_cpu.requestYield();
}

void Runtime::raiseIrqFlags(uint32_t mask) {
	const uint32_t current = static_cast<uint32_t>(asNumber(m_memory.readValue(IO_IRQ_FLAGS)));
	m_memory.writeValue(IO_IRQ_FLAGS, valueNumber(static_cast<double>(current | mask)));
}

void Runtime::processIrqAck() {
	const uint32_t ack = static_cast<uint32_t>(asNumber(m_memory.readValue(IO_IRQ_ACK)));
	if (ack == 0u) {
		return;
	}
	uint32_t flags = static_cast<uint32_t>(asNumber(m_memory.readValue(IO_IRQ_FLAGS)));
	flags &= ~ack;
	m_memory.writeValue(IO_IRQ_FLAGS, valueNumber(static_cast<double>(flags)));
	m_memory.writeValue(IO_IRQ_ACK, valueNumber(0.0));
	if ((ack & IRQ_VBLANK) != 0u && m_vblankPendingClear) {
		setVblankStatus(false);
		m_vblankPendingClear = false;
		m_vblankClearOnIrqEnd = false;
	}
}

void Runtime::raiseEngineIrq(uint32_t mask) {
	constexpr uint32_t kAllowedMask = IRQ_REINIT | IRQ_NEWGAME;
	if (mask == 0) {
		throw runtimeFault("engine IRQ mask must be non-zero.");
	}
	const uint32_t unsupported = mask & ~kAllowedMask;
	if (unsupported != 0u) {
		throw runtimeFault("unsupported engine IRQ mask " + std::to_string(unsupported) + ".");
	}
	raiseIrqFlags(mask);
}

RunResult Runtime::runWithBudget() {
	int remaining = m_frameState.cycleBudgetRemaining;
	RunResult result = RunResult::Yielded;
	runDueTimers();
	while (remaining > 0) {
		int sliceBudget = remaining;
		const i64 nextDeadline = nextTimerDeadline();
		if (nextDeadline != std::numeric_limits<i64>::max()) {
			const i64 deadlineBudget = nextDeadline - m_schedulerNowCycles;
			if (deadlineBudget <= 0) {
				runDueTimers();
				continue;
			}
			if (deadlineBudget < sliceBudget) {
				sliceBudget = static_cast<int>(deadlineBudget);
			}
		}
		m_schedulerSliceActive = true;
		m_activeSliceBaseCycle = m_schedulerNowCycles;
		m_activeSliceBudgetCycles = sliceBudget;
		m_activeSliceTargetCycle = m_schedulerNowCycles + sliceBudget;
		result = m_cpu.run(sliceBudget);
		m_schedulerSliceActive = false;
		const int sliceRemaining = m_cpu.instructionBudgetRemaining;
		const int consumed = sliceBudget - sliceRemaining;
		if (consumed > 0) {
			remaining -= consumed;
			advanceTime(consumed);
		}
		if (m_waitingForVblank || result == RunResult::Halted) {
			break;
		}
		if (consumed <= 0) {
			throw runtimeFault("CPU yielded without consuming cycles.");
		}
	}
	m_frameState.cycleBudgetRemaining = remaining;
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
			EngineCore::instance().log(LogLevel::Error, "Runtime fault: reboot to bootrom failed.\n");
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
	auto* gameTable = asTable(m_cpu.getGlobalByKey(canonicalizeIdentifier("game")));
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
	if (addr == IO_DMA_CTRL) {
		if ((static_cast<uint32_t>(asNumber(value)) & DMA_CTRL_START) != 0u) {
			const uint32_t dst = static_cast<uint32_t>(asNumber(m_memory.readValue(IO_DMA_DST)));
			if (dst == IO_VDP_FIFO && hasBlockedVdpSubmitPath()) {
				m_memory.writeValue(IO_DMA_CTRL, valueNumber(static_cast<double>(static_cast<uint32_t>(asNumber(value)) & ~DMA_CTRL_START)));
				m_memory.writeValue(IO_DMA_WRITTEN, valueNumber(0.0));
				m_memory.writeValue(IO_DMA_STATUS, valueNumber(static_cast<double>(DMA_STATUS_REJECTED)));
				noteRejectedVdpSubmitAttempt();
				return;
			}
			m_dmaController.tryStartIo();
			syncVdpSubmitAttemptStatusFromDma(dst);
		}
		return;
	}
	if (addr == IO_GEO_CTRL) {
		if ((static_cast<uint32_t>(asNumber(value)) & (GEO_CTRL_START | GEO_CTRL_ABORT)) != 0u) {
			m_geometryController.onCtrlWrite(currentSchedulerNowCycles());
		}
		return;
	}
	if (addr == IO_IMG_CTRL) {
		if ((static_cast<uint32_t>(asNumber(value)) & IMG_CTRL_START) != 0u) {
			m_imgDecController.onCtrlWrite(currentSchedulerNowCycles());
		}
		return;
	}
	if (addr == IO_VDP_FIFO) {
		if (m_dmaController.hasPendingVdpSubmit() || (!hasOpenDirectVdpFifoIngress() && !m_vdp.canAcceptSubmittedFrame())) {
			noteRejectedVdpSubmitAttempt();
			return;
		}
		noteAcceptedVdpSubmitAttempt();
		pushVdpFifoWord(static_cast<uint32_t>(asNumber(value)));
		return;
	}
	if (addr == IO_VDP_FIFO_CTRL) {
		if ((static_cast<uint32_t>(asNumber(value)) & VDP_FIFO_CTRL_SEAL) == 0u) {
			return;
		}
		if (m_dmaController.hasPendingVdpSubmit()) {
			noteRejectedVdpSubmitAttempt();
			return;
		}
		sealVdpFifoTransfer();
		refreshVdpSubmitBusyStatus();
		return;
	}
	if (addr == IO_PAYLOAD_ALLOC_ADDR || addr == IO_PAYLOAD_DATA_ADDR) {
		throw vdpFault("payload staging I/O is obsolete. Write payload words directly into the claimed VDP stream packet in RAM.");
	}
	if (addr == IO_VDP_CMD) {
		if (asNumber(value) == 0.0) {
			return;
		}
		if (hasBlockedVdpSubmitPath()) {
			noteRejectedVdpSubmitAttempt();
			return;
		}
		noteAcceptedVdpSubmitAttempt();
		m_handlingVdpCommandWrite = true;
		try {
			consumeDirectVdpCommand(static_cast<uint32_t>(asNumber(value)));
		} catch (...) {
			m_handlingVdpCommandWrite = false;
			throw;
		}
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
	m_cpu.clearYieldRequest();
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
	const_cast<CPU&>(m_cpu).syncGlobalSlotsToTable();
	state.globals = m_cpu.globals->entries();
	state.cartDataNamespace = m_api->cartDataNamespace();
	state.persistentData = m_api->persistentData();
	state.randomSeed = m_randomSeedValue;
	state.pendingEntryCall = m_pendingCall == PendingCall::Entry;
	state.assetMemory = m_memory.dumpAssetMemory();
	state.atlasSlots = m_vdp.atlasSlots();
	state.skyboxFaceIds = m_vdp.skyboxFaceIds();
	state.vdpDitherType = m_vdp.getDitherType();
	state.cyclesIntoFrame = getCyclesIntoFrame();
	state.vblankPendingClear = m_vblankPendingClear;
	state.vblankClearOnIrqEnd = m_vblankClearOnIrqEnd;
	return state;
}

void Runtime::applyState(const RuntimeState& state) {
	// Restore memory
	m_memory.loadIoSlots(state.ioMemory);
	m_geometryController.normalizeAfterStateRestore();
	m_vdp.syncRegisters();
	resetSchedulerState();
	m_schedulerNowCycles = state.cyclesIntoFrame;
	m_frameStartCycle = 0;
	m_vdpStatus = static_cast<uint32_t>(asNumber(m_memory.readValue(IO_VDP_STATUS)));
	m_vdpStatus &= ~VDP_STATUS_VBLANK;
	m_vblankActive = false;
	m_vblankPendingClear = state.vblankPendingClear;
	m_vblankClearOnIrqEnd = state.vblankClearOnIrqEnd;
	const bool vblankActive = (m_vblankStartCycle == 0)
		|| m_vblankPendingClear
		|| (getCyclesIntoFrame() >= m_vblankStartCycle);
	setVblankStatus(vblankActive);
	scheduleCurrentFrameTimers();
	refreshDeviceTimings(m_schedulerNowCycles);
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
	m_vdp.commitLiveVisualState();
	m_vdp.commitViewSnapshot(*EngineCore::instance().view());

	// Restore globals
	m_cpu.globals->clear();
	m_cpu.clearGlobalSlots();
	m_cpu.setProgram(m_program, m_programMetadata);
	for (const auto& [key, value] : state.globals) {
		m_cpu.setGlobalByKey(key, value);
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
	return m_cpu.getGlobalByKey(canonicalizeIdentifier(name));
}

void Runtime::setGlobal(std::string_view name, const Value& value) {
	m_cpu.setGlobalByKey(canonicalizeIdentifier(name), value);
}

void Runtime::registerNativeFunction(std::string_view name, NativeFunctionInvoke fn, std::optional<NativeFnCost> cost) {
	auto nativeFn = m_cpu.createNativeFunction(name, std::move(fn), cost);
	m_cpu.setGlobalByKey(canonicalizeIdentifier(name), nativeFn);
}

void Runtime::setCanonicalization(CanonicalizationType canonicalization) {
	m_canonicalization = canonicalization;
}

void Runtime::setCpuHz(i64 hz) {
	m_cpuHz = hz;
	refreshDeviceTimings(currentSchedulerNowCycles());
}

void Runtime::applyActiveMachineTiming(i64 cpuHz) {
	const MachineManifest& manifest = EngineCore::instance().machineManifest();
	const int cycleBudget = calcCyclesPerFrame(cpuHz, EngineCore::instance().ufpsScaled());
	const i64 vblankCycles = resolveVblankCycles(cpuHz, EngineCore::instance().ufpsScaled(), manifest.viewportHeight);
	setCpuHz(cpuHz);
	setCycleBudgetPerFrame(cycleBudget);
	setVblankCycles(static_cast<int>(vblankCycles));
	setVdpWorkUnitsPerSec(static_cast<int>(manifest.vdpWorkUnitsPerSec.value_or(DEFAULT_VDP_WORK_UNITS_PER_SEC)));
	setGeoWorkUnitsPerSec(static_cast<int>(manifest.geoWorkUnitsPerSec.value_or(DEFAULT_GEO_WORK_UNITS_PER_SEC)));
}

void Runtime::setVblankCycles(int cycles) {
	if (cycles <= 0) {
		throw runtimeFault("vblank_cycles must be greater than 0.");
	}
	if (cycles > m_cycleBudgetPerFrame) {
		throw runtimeFault("vblank_cycles must be less than or equal to cycles_per_frame.");
	}
	m_vblankCycles = cycles;
	m_vblankStartCycle = m_cycleBudgetPerFrame - m_vblankCycles;
	resetVblankState();
}

void Runtime::resetHardwareState() {
	m_memory.writeValue(IO_IRQ_FLAGS, valueNumber(0.0));
	m_memory.writeValue(IO_IRQ_ACK, valueNumber(0.0));
	m_dmaController.reset();
	m_geometryController.reset();
	m_imgDecController.reset();
	resetVblankState();
	resetRenderBuffers();
}

void Runtime::resetRenderBuffers() {
	RenderQueues::clearBackQueues();
}

void Runtime::setVdpWorkUnitsPerSec(int workUnitsPerSec) {
	if (workUnitsPerSec <= 0) {
		throw runtimeFault("work_units_per_sec must be greater than 0.");
	}
	m_vdpWorkUnitsPerSec = workUnitsPerSec;
	m_vdp.setTiming(m_cpuHz, m_vdpWorkUnitsPerSec, currentSchedulerNowCycles());
}

void Runtime::setGeoWorkUnitsPerSec(int workUnitsPerSec) {
	if (workUnitsPerSec <= 0) {
		throw runtimeFault("geo_work_units_per_sec must be greater than 0.");
	}
	m_geoWorkUnitsPerSec = workUnitsPerSec;
	m_geometryController.setTiming(m_cpuHz, m_geoWorkUnitsPerSec, currentSchedulerNowCycles());
}

void Runtime::setTransferRates(i64 imgDecBytesPerSec, i64 dmaBytesPerSecIso, i64 dmaBytesPerSecBulk, int vdpWorkUnitsPerSec, int geoWorkUnitsPerSec) {
	m_imgDecBytesPerSec = imgDecBytesPerSec;
	m_dmaBytesPerSecIso = dmaBytesPerSecIso;
	m_dmaBytesPerSecBulk = dmaBytesPerSecBulk;
	setVdpWorkUnitsPerSec(vdpWorkUnitsPerSec);
	setGeoWorkUnitsPerSec(geoWorkUnitsPerSec);
	refreshDeviceTimings(currentSchedulerNowCycles());
}

void Runtime::setCycleBudgetPerFrame(int budget) {
	if (budget == m_cycleBudgetPerFrame) {
		return;
	}
	m_cycleBudgetPerFrame = budget;
	setGlobal("sys_max_cycles_per_frame", valueNumber(static_cast<double>(budget)));
	refreshDeviceTimings(currentSchedulerNowCycles());
	if (m_vblankCycles > 0) {
		if (m_vblankCycles > m_cycleBudgetPerFrame) {
			throw runtimeFault("vblank_cycles must be less than or equal to cycles_per_frame.");
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

bool Runtime::consumeLastTickCompletion(TickCompletion& outCompletion) {
	if (!m_lastTickCompleted) {
		return false;
	}
	if (m_lastTickSequence == m_lastTickConsumedSequence) {
		return false;
	}
	m_lastTickConsumedSequence = m_lastTickSequence;
	outCompletion.sequence = m_lastTickSequence;
	outCompletion.remaining = m_lastTickBudgetRemaining;
	outCompletion.visualCommitted = m_lastTickVisualFrameCommitted;
	outCompletion.vdpFrameCost = m_lastTickVdpFrameCost;
	outCompletion.vdpFrameHeld = m_lastTickVdpFrameHeld;
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
			runDueTimers();
			processIrqAck();
			if (m_waitForVblankTargetSequence == 0) {
				m_cpu.clearYieldRequest();
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
						const i64 cyclesToTarget = nextTimerDeadline() - m_schedulerNowCycles;
						const int idleCycles = static_cast<int>(std::min<i64>(m_frameState.cycleBudgetRemaining, cyclesToTarget));
						m_frameState.cycleBudgetRemaining -= idleCycles;
						advanceTime(idleCycles);
						runDueTimers();
						processIrqAck();
					}
					if (m_vblankSequence < m_waitForVblankTargetSequence) {
						return;
					}
				}
				m_cpu.clearYieldRequest();
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
		if (m_waitingForVblank) {
			reconcileCycleBudgetAfterSignal(m_frameState);
			freezeTickCpuStats(m_frameState);
			processIrqAck();
			return;
		}
		processIrqAck();
		if (result == RunResult::Halted) {
			m_pendingCall = PendingCall::None;
		}
	} catch (const std::exception& e) {
		std::cerr << "Runtime fault: " << e.what() << std::endl;
		logDebugState();
		logLuaCallStack();
		m_cpu.clearYieldRequest();
		m_waitingForVblank = false;
		m_waitForVblankTargetSequence = 0;
		m_clearBackQueuesAfterWaitResume = false;
		m_pendingCall = PendingCall::None;
		m_frameActive = false;
		m_runtimeFailed = true;
	}
}

} // namespace bmsx
