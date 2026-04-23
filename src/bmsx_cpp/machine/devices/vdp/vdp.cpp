#include "machine/devices/vdp/vdp.h"
#include "machine/devices/vdp/command_processor.h"
#include "machine/devices/vdp/fault.h"
#include "machine/devices/vdp/packet_schema.h"
#include "machine/memory/map.h"
#include "core/font.h"
#include "core/utf8.h"
#include "render/vdp/blitter/execute.h"
#include "render/vdp/framebuffer.h"
#include "render/vdp/texture_transfer.h"
#include "machine/devices/imgdec/controller.h"
#include "machine/scheduler/budget.h"
#include <algorithm>
#include <array>
#include <chrono>
#include <cmath>
#include <cstring>
#include <limits>
#include <sstream>
#include <string>

namespace bmsx {
namespace {

constexpr uint32_t VDP_RD_BUDGET_BYTES = 4096u;
constexpr uint32_t VDP_RD_MAX_CHUNK_PIXELS = 256u;
constexpr int VDP_SERVICE_BATCH_WORK_UNITS = 128;
constexpr size_t BLITTER_FIFO_CAPACITY = 4096u;
constexpr size_t VRAM_GARBAGE_CHUNK_BYTES = 64u * 1024u;
constexpr uint32_t VRAM_GARBAGE_SPACE_SALT = 0x5652414dU;
constexpr int VRAM_GARBAGE_WEIGHT_BLOCK = 1;
constexpr int VRAM_GARBAGE_WEIGHT_ROW = 2;
constexpr int VRAM_GARBAGE_WEIGHT_PAGE = 4;
constexpr int VRAM_GARBAGE_FORCE_T0 = 120;
constexpr int VRAM_GARBAGE_FORCE_T1 = 280;
constexpr int VRAM_GARBAGE_FORCE_T2 = 480;
constexpr int VRAM_GARBAGE_FORCE_T_DEN = 1000;
template <typename T>
std::vector<T> acquireVectorFromPool(std::vector<std::vector<T>>& pool) {
	if (pool.empty()) {
		return {};
	}
	std::vector<T> values = std::move(pool.back());
	pool.pop_back();
	return values;
}

u8 frameBufferColorByte(f32 value) {
	return static_cast<u8>(std::round(value * 255.0f));
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

} // namespace


namespace {

struct OctaveSpec {
	uint32_t shift;
	int weight;
	uint32_t mul;
	uint32_t mix;
};

constexpr OctaveSpec VRAM_GARBAGE_OCTAVES[] = {
	{11u, 8, 0x165667b1U, 0xd3a2646cU},
	{15u, 12, 0x27d4eb2fU, 0x6c8e9cf5U},
	{17u, 16, 0x7f4a7c15U, 0x31415926U},
	{19u, 20, 0xa24baed5U, 0x9e3779b9U},
	{21u, 24, 0x6a09e667U, 0xbb67ae85U},
};

uint32_t fmix32(uint32_t h) {
	h ^= h >> 16u;
	h *= 0x85ebca6bU;
	h ^= h >> 13u;
	h *= 0xc2b2ae35U;
	h ^= h >> 16u;
	return h;
}

uint32_t xorshift32(uint32_t x) {
	x ^= x << 13u;
	x ^= x >> 17u;
	x ^= x << 5u;
	return x;
}

uint32_t scramble32(uint32_t x) {
	return x * 0x9e3779bbU;
}

int signed8FromHash(uint32_t h) {
	return static_cast<int>((h >> 24u) & 0xFFu) - 128;
}

struct BlockGen {
	uint32_t forceMask = 0;
	uint32_t prefWord = 0;
	uint32_t weakMask = 0;
	uint32_t baseState = 0;
	uint32_t bootState = 0;
	uint32_t genWordPos = 0;
};

struct BiasConfig {
	uint32_t activeOctaves = 0;
	int threshold0 = 0;
	int threshold1 = 0;
	int threshold2 = 0;
};

BiasConfig makeBiasConfig(uint32_t vramBytes) {
	const uint32_t maxOctaveBytes = vramBytes >> 1u;
	int weightSum = VRAM_GARBAGE_WEIGHT_BLOCK + VRAM_GARBAGE_WEIGHT_ROW + VRAM_GARBAGE_WEIGHT_PAGE;
	uint32_t activeOctaves = 0;
	for (uint32_t i = 0; i < (sizeof(VRAM_GARBAGE_OCTAVES) / sizeof(VRAM_GARBAGE_OCTAVES[0])); ++i) {
		const uint32_t octaveBytes = 1u << (VRAM_GARBAGE_OCTAVES[i].shift + 5u);
		if (octaveBytes > maxOctaveBytes) {
			break;
		}
		weightSum += VRAM_GARBAGE_OCTAVES[i].weight;
		activeOctaves = i + 1u;
	}
	const int maxBias = weightSum * 127;
	BiasConfig config;
	config.activeOctaves = activeOctaves;
	config.threshold0 = (maxBias * VRAM_GARBAGE_FORCE_T0) / VRAM_GARBAGE_FORCE_T_DEN;
	config.threshold1 = (maxBias * VRAM_GARBAGE_FORCE_T1) / VRAM_GARBAGE_FORCE_T_DEN;
	config.threshold2 = (maxBias * VRAM_GARBAGE_FORCE_T2) / VRAM_GARBAGE_FORCE_T_DEN;
	return config;
}

BlockGen initBlockGen(uint32_t biasSeed, uint32_t bootSeedMix, uint32_t blockIndex, const BiasConfig& biasConfig) {
	const uint32_t pageIndex = blockIndex >> 7u;
	const uint32_t rowIndex = blockIndex >> 3u;

	const uint32_t pageH = fmix32((biasSeed ^ (pageIndex * 0xc2b2ae35U) ^ 0xa5a5a5a5U));
	const uint32_t rowH = fmix32((biasSeed ^ (rowIndex * 0x85ebca6bU) ^ 0x1b873593U));
	const uint32_t blkH = fmix32((biasSeed ^ (blockIndex * 0x9e3779b9U) ^ 0x85ebca77U));

	int bias =
		signed8FromHash(pageH) * VRAM_GARBAGE_WEIGHT_PAGE +
		signed8FromHash(rowH) * VRAM_GARBAGE_WEIGHT_ROW +
		signed8FromHash(blkH) * VRAM_GARBAGE_WEIGHT_BLOCK;

	uint32_t macroH = pageH;
	for (uint32_t i = 0; i < biasConfig.activeOctaves; ++i) {
		const OctaveSpec& octave = VRAM_GARBAGE_OCTAVES[i];
		const uint32_t octaveIndex = blockIndex >> octave.shift;
		const uint32_t octaveH = fmix32((biasSeed ^ (octaveIndex * octave.mul) ^ octave.mix));
		bias += signed8FromHash(octaveH) * octave.weight;
		macroH = octaveH;
	}

	const int absBias = bias < 0 ? -bias : bias;

	const int forceLevel =
		(absBias < biasConfig.threshold0) ? 0 :
		(absBias < biasConfig.threshold1) ? 1 :
		(absBias < biasConfig.threshold2) ? 2 : 3;

	const int jitterLevel = 3 - forceLevel;

	uint32_t ps = (blkH ^ rowH ^ 0xdeadbeefU) | 1u;
	ps = xorshift32(ps); const uint32_t m1 = scramble32(ps);
	ps = xorshift32(ps); const uint32_t m2 = scramble32(ps);
	ps = xorshift32(ps);
	const uint32_t prefWord = scramble32(macroH);
	ps = xorshift32(ps); const uint32_t w1 = scramble32(ps);
	ps = xorshift32(ps); const uint32_t w2 = scramble32(ps);
	ps = xorshift32(ps); const uint32_t w3 = scramble32(ps);
	ps = xorshift32(ps); const uint32_t w4 = scramble32(ps);

	uint32_t forceMask = 0;
	switch (forceLevel) {
		case 0: forceMask = 0; break;
		case 1: forceMask = (m1 & m2); break;
		case 2: forceMask = m1; break;
		default: forceMask = (m1 | m2); break;
	}

	uint32_t weak = (w1 & w2 & w3);
	if (jitterLevel <= 2) weak &= w4;
	if (jitterLevel <= 1) weak &= (weak >> 1);
	if (jitterLevel <= 0) weak = 0;
	weak &= ~forceMask;

	const uint32_t baseState = (blkH ^ 0xa1b2c3d4U) | 1u;
	const uint32_t bootState = (fmix32((bootSeedMix ^ (blockIndex * 0x7f4a7c15U) ^ 0x31415926U)) | 1u);

	BlockGen gen;
	gen.forceMask = forceMask;
	gen.prefWord = prefWord;
	gen.weakMask = weak;
	gen.baseState = baseState;
	gen.bootState = bootState;
	gen.genWordPos = 0;
	return gen;
}

uint32_t nextWord(BlockGen& gen) {
	gen.baseState = xorshift32(gen.baseState);
	gen.bootState = xorshift32(gen.bootState);
	gen.genWordPos += 1;

	const uint32_t baseWord = scramble32(gen.baseState);
	const uint32_t bootWord = scramble32(gen.bootState);

	uint32_t word = (baseWord & ~gen.forceMask) | (gen.prefWord & gen.forceMask);
	word ^= (bootWord & gen.weakMask);
	return word;
}

}

VDP::VDP(
	Memory& memory,
	CPU& cpu,
	Api& api,
	DeviceScheduler& scheduler,
	VdpFrameBufferSize frameBufferSize
)
	: m_memory(memory)
	, m_cpu(cpu)
	, m_api(api)
	, m_vramStaging(VRAM_STAGING_SIZE)
	, m_vramGarbageScratch(VRAM_GARBAGE_CHUNK_BYTES)
	, m_configuredFrameBufferSize(frameBufferSize)
	, m_scheduler(scheduler) {
	m_memory.setVramWriter(this);
	m_memory.mapIoRead(IO_VDP_RD_STATUS, this, &VDP::readVdpStatusThunk);
	m_memory.mapIoRead(IO_VDP_RD_DATA, this, &VDP::readVdpDataThunk);
	m_memory.mapIoWrite(IO_VDP_FIFO, this, &VDP::onFifoWriteThunk);
	m_memory.mapIoWrite(IO_VDP_FIFO_CTRL, this, &VDP::onFifoCtrlWriteThunk);
	m_memory.mapIoWrite(IO_PAYLOAD_ALLOC_ADDR, this, &VDP::onObsoletePayloadWriteThunk);
	m_memory.mapIoWrite(IO_PAYLOAD_DATA_ADDR, this, &VDP::onObsoletePayloadWriteThunk);
	m_memory.mapIoWrite(IO_VDP_CMD, this, &VDP::onCommandWriteThunk);
	m_buildBlitterQueue.reserve(BLITTER_FIFO_CAPACITY);
	m_activeFrame.queue.reserve(BLITTER_FIFO_CAPACITY);
	m_pendingFrame.queue.reserve(BLITTER_FIFO_CAPACITY);
	m_executingBlitterQueue.reserve(BLITTER_FIFO_CAPACITY);
	m_vramMachineSeed = nextVramMachineSeed();
	m_vramBootSeed = nextVramBootSeed();
	m_readBudgetBytes = VDP_RD_BUDGET_BYTES;
}

void VDP::resetIngressState() {
	m_vdpFifoWordByteCount = 0;
	m_vdpFifoStreamWordCount = 0u;
	m_dmaSubmitActive = false;
	refreshSubmitBusyStatus();
}

void VDP::resetStatus() {
	m_vdpStatus = 0u;
	m_memory.writeValue(IO_VDP_STATUS, valueNumber(static_cast<double>(m_vdpStatus)));
	refreshSubmitBusyStatus();
}

// start hot-path -- VDP status, command ingress, scheduler service, and VRAM row access run on frame-critical paths.
void VDP::setVblankStatus(bool active) {
	setStatusFlag(VDP_STATUS_VBLANK, active);
}

void VDP::setStatusFlag(uint32_t mask, bool active) {
	const uint32_t nextStatus = active ? (m_vdpStatus | mask) : (m_vdpStatus & ~mask);
	if (nextStatus == m_vdpStatus) {
		return;
	}
	m_vdpStatus = nextStatus;
	m_memory.writeValue(IO_VDP_STATUS, valueNumber(static_cast<double>(m_vdpStatus)));
}

bool VDP::canAcceptVdpSubmit() const {
	return !hasBlockedSubmitPath();
}

void VDP::acceptSubmitAttempt() {
	setSubmitRejectedStatus(false);
	refreshSubmitBusyStatus();
}

void VDP::rejectSubmitAttempt() {
	setSubmitRejectedStatus(true);
	refreshSubmitBusyStatus();
}

void VDP::beginDmaSubmit() {
	m_dmaSubmitActive = true;
	acceptSubmitAttempt();
}

void VDP::endDmaSubmit() {
	m_dmaSubmitActive = false;
	refreshSubmitBusyStatus();
}

void VDP::sealDmaTransfer(uint32_t src, size_t byteLength) {
	try {
		consumeSealedVdpStream(src, byteLength);
	} catch (...) {
		endDmaSubmit();
		throw;
	}
	endDmaSubmit();
}

void VDP::writeVdpFifoBytes(const u8* data, size_t length) {
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
	refreshSubmitBusyStatus();
}

bool VDP::hasOpenDirectVdpFifoIngress() const {
	return m_vdpFifoWordByteCount != 0 || m_vdpFifoStreamWordCount != 0u;
}

bool VDP::hasBlockedSubmitPath() const {
	return hasOpenDirectVdpFifoIngress() || m_dmaSubmitActive || !canAcceptSubmittedFrame();
}

void VDP::setSubmitBusyStatus(bool active) {
	setStatusFlag(VDP_STATUS_SUBMIT_BUSY, active);
}

void VDP::refreshSubmitBusyStatus() {
	setSubmitBusyStatus(hasBlockedSubmitPath());
}

void VDP::setSubmitRejectedStatus(bool active) {
	setStatusFlag(VDP_STATUS_SUBMIT_REJECTED, active);
}

void VDP::pushVdpFifoWord(u32 word) {
	if (m_vdpFifoStreamWordCount >= VDP_STREAM_CAPACITY_WORDS) {
		throw vdpStreamFault("stream overflow (" + std::to_string(m_vdpFifoStreamWordCount + 1u) + " > " + std::to_string(VDP_STREAM_CAPACITY_WORDS) + ").");
	}
	m_vdpFifoStreamWords[static_cast<size_t>(m_vdpFifoStreamWordCount)] = word;
	m_vdpFifoStreamWordCount += 1u;
	refreshSubmitBusyStatus();
}

void VDP::consumeSealedVdpStream(uint32_t baseAddr, size_t byteLength) {
	if ((byteLength & 3u) != 0u) {
		throw vdpStreamFault("sealed stream length must be word-aligned.");
	}
	if (byteLength > VDP_STREAM_BUFFER_SIZE) {
		throw vdpStreamFault("sealed stream overflow (" + std::to_string(byteLength) + " > " + std::to_string(VDP_STREAM_BUFFER_SIZE) + ").");
	}
	uint32_t cursor = baseAddr;
	const uint32_t end = baseAddr + static_cast<uint32_t>(byteLength);
	uint32_t packetIndex = 0u;
	beginSubmittedFrame();
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
			syncRegisters();
			processVdpCommand(
				*this,
				m_cpu,
				m_api,
				m_memory,
				cmd,
				argWords,
				cursor + VDP_STREAM_PACKET_HEADER_WORDS * IO_WORD_SIZE,
				cursor + (VDP_STREAM_PACKET_HEADER_WORDS + argWords) * IO_WORD_SIZE,
				payloadWords
			);
			cursor += packetByteCount;
			packetIndex += 1u;
		}
		sealSubmittedFrame();
	} catch (...) {
		cancelSubmittedFrame();
		throw;
	}
	refreshSubmitBusyStatus();
}

void VDP::consumeSealedVdpWordStream(u32 wordCount) {
	u32 cursor = 0u;
	beginSubmittedFrame();
	try {
		while (cursor < wordCount) {
			if (cursor + VDP_STREAM_PACKET_HEADER_WORDS > wordCount) {
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
			if (cursor + packetWordCount > wordCount) {
				throw vdpStreamFault("stream ended mid-packet payload.");
			}
			syncRegisters();
			processVdpBufferedCommand(
				*this,
				m_cpu,
				m_api,
				m_vdpFifoStreamWords.data(),
				cmd,
				argWords,
				cursor + VDP_STREAM_PACKET_HEADER_WORDS,
				cursor + VDP_STREAM_PACKET_HEADER_WORDS + argWords,
				payloadWords
			);
			cursor += packetWordCount;
		}
		sealSubmittedFrame();
	} catch (...) {
		cancelSubmittedFrame();
		throw;
	}
	refreshSubmitBusyStatus();
}

void VDP::sealVdpFifoTransfer() {
	if (m_vdpFifoWordByteCount != 0) {
		throw vdpStreamFault("FIFO transfer ended on a partial word.");
	}
	if (m_vdpFifoStreamWordCount == 0u) {
		return;
	}
	consumeSealedVdpWordStream(m_vdpFifoStreamWordCount);
	resetIngressState();
}

void VDP::consumeDirectVdpCommand(u32 cmd) {
	const VdpPacketSchema& schema = getVdpPacketSchema(cmd);
	beginSubmittedFrame();
	try {
		syncRegisters();
		processVdpCommand(*this, m_cpu, m_api, m_memory, cmd, schema.argWords, IO_VDP_CMD_ARG0, 0u, 0u);
		sealSubmittedFrame();
	} catch (...) {
		cancelSubmittedFrame();
		throw;
	}
	refreshSubmitBusyStatus();
}

void VDP::onVdpFifoWrite() {
	if (m_dmaSubmitActive || (!hasOpenDirectVdpFifoIngress() && !canAcceptSubmittedFrame())) {
		rejectSubmitAttempt();
		return;
	}
	acceptSubmitAttempt();
	pushVdpFifoWord(m_memory.readIoU32(IO_VDP_FIFO));
}

void VDP::onVdpFifoCtrlWrite() {
	if ((m_memory.readIoU32(IO_VDP_FIFO_CTRL) & VDP_FIFO_CTRL_SEAL) == 0u) {
		return;
	}
	if (m_dmaSubmitActive) {
		rejectSubmitAttempt();
		return;
	}
	sealVdpFifoTransfer();
	refreshSubmitBusyStatus();
}

void VDP::onObsoletePayloadIoWrite() {
	throw vdpFault("payload staging I/O is obsolete. Write payload words directly into the claimed VDP stream packet in RAM.");
}

void VDP::onVdpCommandWrite() {
	const uint32_t command = m_memory.readIoU32(IO_VDP_CMD);
	if (command == 0u) {
		return;
	}
	if (hasBlockedSubmitPath()) {
		rejectSubmitAttempt();
		return;
	}
	acceptSubmitAttempt();
	consumeDirectVdpCommand(command);
}

void VDP::onFifoWriteThunk(void* context, uint32_t, Value) {
	static_cast<VDP*>(context)->onVdpFifoWrite();
}

void VDP::onFifoCtrlWriteThunk(void* context, uint32_t, Value) {
	static_cast<VDP*>(context)->onVdpFifoCtrlWrite();
}

void VDP::onObsoletePayloadWriteThunk(void* context, uint32_t, Value) {
	static_cast<VDP*>(context)->onObsoletePayloadIoWrite();
}

void VDP::onCommandWriteThunk(void* context, uint32_t, Value) {
	static_cast<VDP*>(context)->onVdpCommandWrite();
}

void VDP::setTiming(int64_t cpuHz, int64_t workUnitsPerSec, int64_t nowCycles) {
	m_cpuHz = cpuHz;
	m_workUnitsPerSec = workUnitsPerSec;
	m_workCarry = 0;
	m_availableWorkUnits = 0;
	scheduleNextService(nowCycles);
}

void VDP::accrueCycles(int cycles, int64_t nowCycles) {
	if (!hasPendingRenderWork() || cycles <= 0) {
		return;
	}
	const int64_t wholeUnits = accrueBudgetUnits(m_cpuHz, m_workUnitsPerSec, m_workCarry, cycles);
	if (wholeUnits > 0) {
		const int remainingWork = getPendingRenderWorkUnits() - m_availableWorkUnits;
		const int64_t maxGrant = remainingWork <= 0 ? 0 : remainingWork;
		const int64_t granted = wholeUnits > maxGrant ? maxGrant : wholeUnits;
		m_availableWorkUnits += static_cast<int>(granted);
	}
	scheduleNextService(nowCycles);
	refreshSubmitBusyStatus();
}

void VDP::onService(int64_t nowCycles) {
	if (needsImmediateSchedulerService()) {
		promotePendingFrame();
	}
	if (hasPendingRenderWork() && m_availableWorkUnits > 0) {
		const int pendingBefore = getPendingRenderWorkUnits();
		advanceWork(m_availableWorkUnits);
		const int pendingAfter = getPendingRenderWorkUnits();
		const int consumed = pendingBefore - pendingAfter;
		if (consumed > 0) {
			m_availableWorkUnits -= consumed;
		}
	}
	scheduleNextService(nowCycles);
}

// start repeated-sequence-acceptable -- VRAM row streaming keeps read/write loops direct; callback helpers would add hot-path overhead.
void VDP::writeVram(uint32_t addr, const u8* data, size_t length) {
	if (addr >= VRAM_STAGING_BASE && addr + length <= VRAM_STAGING_BASE + VRAM_STAGING_SIZE) {
		const uint32_t offset = addr - VRAM_STAGING_BASE;
		std::memcpy(m_vramStaging.data() + offset, data, length);
		return;
	}
	auto& slot = findVramSlot(addr, length);
	const uint32_t offset = addr - slot.baseAddr;
	if ((offset & 3u) != 0u || (length & 3u) != 0u) {
		throw vdpFault("VRAM writes must be 32-bit aligned.");
	}
	auto& entry = m_memory.getAssetEntry(slot.assetId);
	if (entry.baseStride == 0 || entry.regionW == 0 || entry.regionH == 0) {
		throw vdpFault("VRAM slot not initialized for writes.");
	}
	syncVramSlotTextureSize(slot);
	const uint32_t stride = entry.baseStride;
	const uint32_t totalBytes = entry.regionH * stride;
	if (offset + length > totalBytes) {
		throw vdpFault("VRAM write exceeds slot bounds.");
	}
	size_t remaining = length;
	size_t cursor = 0;
	uint32_t row = offset / stride;
	uint32_t rowOffset = offset - row * stride;
	while (remaining > 0) {
		const uint32_t rowAvailable = stride - rowOffset;
		const uint32_t rowBytes = static_cast<uint32_t>(std::min<size_t>(remaining, rowAvailable));
		const i32 x = static_cast<i32>(rowOffset / 4u);
		const i32 width = static_cast<i32>(rowBytes / 4u);
		if (slot.textureKey == FRAMEBUFFER_RENDER_TEXTURE_KEY) {
			updateVdpTextureRegion(
				slot.textureKey,
				data + cursor,
				width,
				1,
				x,
				static_cast<i32>(row)
			);
		} else {
			markVramSlotDirty(slot, row, 1u);
		}
		const size_t cpuOffset = static_cast<size_t>(row) * static_cast<size_t>(stride) + static_cast<size_t>(rowOffset);
		std::memcpy(slot.cpuReadback.data() + cpuOffset, data + cursor, rowBytes);
		invalidateReadCache(slot.surfaceId);
		remaining -= rowBytes;
		cursor += rowBytes;
		row += 1;
		rowOffset = 0;
	}
}

void VDP::readVram(uint32_t addr, u8* out, size_t length) const {
	if (addr >= VRAM_STAGING_BASE && addr + length <= VRAM_STAGING_BASE + VRAM_STAGING_SIZE) {
		const uint32_t offset = addr - VRAM_STAGING_BASE;
		std::memcpy(out, m_vramStaging.data() + offset, length);
		return;
	}
	const auto& slot = findVramSlot(addr, length);
	const auto& entry = m_memory.getAssetEntry(slot.assetId);
	if (entry.baseStride == 0 || entry.regionW == 0 || entry.regionH == 0) {
		std::memset(out, 0, length);
		return;
	}
	const uint32_t offset = addr - slot.baseAddr;
	const uint32_t stride = entry.baseStride;
	const uint32_t totalBytes = entry.regionH * stride;
	if (offset + length > totalBytes) {
		throw vdpFault("VRAM read exceeds slot bounds.");
	}
	size_t remaining = length;
	size_t cursor = 0;
	uint32_t row = offset / stride;
	uint32_t rowOffset = offset - row * stride;
	while (remaining > 0) {
		const uint32_t rowAvailable = stride - rowOffset;
		const uint32_t rowBytes = static_cast<uint32_t>(std::min<size_t>(remaining, rowAvailable));
		const size_t cpuOffset = static_cast<size_t>(row) * static_cast<size_t>(stride) + static_cast<size_t>(rowOffset);
		std::memcpy(out + cursor, slot.cpuReadback.data() + cpuOffset, rowBytes);
		remaining -= rowBytes;
		cursor += rowBytes;
		row += 1;
		rowOffset = 0;
	}
}
// end repeated-sequence-acceptable
// end hot-path

// start hot-path -- frame scheduling and submitted-frame promotion run every visible frame.
void VDP::beginFrame() {
	m_readBudgetBytes = VDP_RD_BUDGET_BYTES;
	m_readOverflow = false;
}

VDP::FrameBufferColor VDP::packFrameBufferColor(const Color& color) const {
	return FrameBufferColor{
		frameBufferColorByte(color.r),
		frameBufferColorByte(color.g),
		frameBufferColorByte(color.b),
		frameBufferColorByte(color.a),
	};
}

u32 VDP::nextBlitterSequence() {
	return m_blitterSequence++;
}

std::vector<VDP::GlyphRunGlyph> VDP::acquireGlyphBuffer() {
	return acquireVectorFromPool(m_glyphBufferPool);
}

std::vector<VDP::TileRunBlit> VDP::acquireTileBuffer() {
	return acquireVectorFromPool(m_tileBufferPool);
}

void VDP::recycleBlitterBuffers(std::vector<BlitterCommand>& queue) {
	for (auto& command : queue) {
		if (command.type == BlitterCommandType::GlyphRun) {
			command.glyphs.clear();
			m_glyphBufferPool.push_back(std::move(command.glyphs));
		} else if (command.type == BlitterCommandType::TileRun) {
			command.tiles.clear();
			m_tileBufferPool.push_back(std::move(command.tiles));
		}
	}
}

void VDP::resetBuildFrameState() {
	recycleBlitterBuffers(m_buildBlitterQueue);
	m_buildBlitterQueue.clear();
	m_buildFrameCost = 0;
	m_buildFrameOpen = false;
}

void VDP::resetQueuedFrameState() {
	resetBuildFrameState();
	clearActiveFrame();
	recycleBlitterBuffers(m_pendingFrame.queue);
	m_pendingFrame.queue.clear();
	m_pendingFrame.occupied = false;
	m_pendingFrame.hasCommands = false;
	m_pendingFrame.ready = false;
	m_pendingFrame.executionPending = false;
	m_pendingFrame.executionTaken = false;
	m_pendingFrame.cost = 0;
	m_pendingFrame.workRemaining = 0;
	m_pendingFrame.ditherType = 0;
	m_pendingFrame.slotAtlasIds = {{-1, -1}};
	m_pendingFrame.skyboxFaceIds = {};
	m_pendingFrame.hasSkybox = false;
	m_slotAtlasIds = {{-1, -1}};
}

void VDP::enqueueBlitterCommand(BlitterCommand&& command) {
	if (!m_buildFrameOpen) {
		throw vdpFault("no submitted frame is open.");
	}
	if (m_buildBlitterQueue.size() >= BLITTER_FIFO_CAPACITY) {
		throw vdpFault("blitter FIFO overflow (4096 commands).");
	}
	m_buildFrameCost += command.renderCost;
	m_buildBlitterQueue.push_back(std::move(command));
}

int VDP::calculateVisibleRectCost(double width, double height) const {
	return blitAreaBucket(width * height);
}

int VDP::calculateAlphaMultiplier(const FrameBufferColor& color) const {
	return color.a < 255u ? VDP_RENDER_ALPHA_COST_MULTIPLIER : 1;
}

void VDP::ensureDisplayFrameBufferTexture() {
	ensureVdpDisplayFrameBufferTexture(m_vramSeedPixel.data(), m_frameBufferWidth, m_frameBufferHeight);
}

void VDP::swapFrameBufferPages() {
	swapVdpFrameBufferTexturePages();
	auto& renderSlot = getVramSlotByTextureKey(FRAMEBUFFER_RENDER_TEXTURE_KEY);
	std::swap(renderSlot.cpuReadback, m_displayFrameBufferCpuReadback);
	invalidateReadCache(VDP_RD_SURFACE_FRAMEBUFFER);
}

void VDP::syncRenderFrameBufferToDisplayPage() {
	auto& renderSlot = getVramSlotByTextureKey(FRAMEBUFFER_RENDER_TEXTURE_KEY);
	auto& renderReadback = renderSlot.cpuReadback;
	const size_t renderReadbackSize = renderReadback.size();
	if (m_displayFrameBufferCpuReadback.size() != renderReadbackSize) {
		m_displayFrameBufferCpuReadback.resize(renderReadbackSize);
	}
	std::memcpy(m_displayFrameBufferCpuReadback.data(), renderReadback.data(), renderReadbackSize);
	copyVdpRenderFrameBufferToDisplay(m_frameBufferWidth, m_frameBufferHeight);
}

void VDP::beginSubmittedFrame() {
	if (m_buildFrameOpen) {
		throw vdpFault("submitted frame already open.");
	}
	resetBuildFrameState();
	m_blitterSequence = 0u;
	m_buildFrameOpen = true;
}

void VDP::cancelSubmittedFrame() {
	resetBuildFrameState();
	scheduleNextService(m_scheduler.currentNowCycles());
	refreshSubmitBusyStatus();
}

void VDP::assignBuildToSlot(bool active) {
	if (!m_buildFrameOpen) {
		throw vdpFault("no submitted frame is open.");
	}
	auto& frame = active ? m_activeFrame : m_pendingFrame;
	if (!frame.queue.empty()) {
		throw vdpFault(active
			? "active frame queue is not empty."
			: "pending frame queue is not empty.");
	}
	frame.queue.swap(m_buildBlitterQueue);
	const bool frameHasCommands = !frame.queue.empty();
	const int frameCost = (!frame.queue.empty() && frame.queue.front().type != BlitterCommandType::Clear)
		? (m_buildFrameCost + VDP_RENDER_CLEAR_COST)
		: m_buildFrameCost;
	frame.occupied = true;
	frame.hasCommands = frameHasCommands;
	frame.ready = frameCost == 0;
	frame.executionPending = false;
	frame.executionTaken = false;
	frame.cost = frameCost;
	frame.workRemaining = frameCost;
	frame.ditherType = m_lastDitherType;
	frame.slotAtlasIds = m_slotAtlasIds;
	frame.skyboxFaceIds = m_skyboxFaceIds;
	frame.hasSkybox = m_hasSkybox;
	m_buildFrameCost = 0;
	m_buildFrameOpen = false;
	scheduleNextService(m_scheduler.currentNowCycles());
	refreshSubmitBusyStatus();
}

void VDP::sealSubmittedFrame() {
	if (!m_buildFrameOpen) {
		throw vdpFault("no submitted frame is open.");
	}
	if (!m_activeFrame.occupied) {
		assignBuildToSlot(true);
		return;
	}
	if (!m_pendingFrame.occupied) {
		assignBuildToSlot(false);
		return;
	}
	throw vdpFault("submit slot busy.");
}

void VDP::promotePendingFrame() {
	if (m_activeFrame.occupied || !m_pendingFrame.occupied) {
		return;
	}
	auto& activeFrame = m_activeFrame;
	auto& pendingFrame = m_pendingFrame;
	activeFrame.queue.swap(pendingFrame.queue);
	pendingFrame.queue.clear();
	activeFrame.occupied = true;
	activeFrame.hasCommands = pendingFrame.hasCommands;
	activeFrame.ready = pendingFrame.cost == 0;
	activeFrame.executionPending = false;
	activeFrame.executionTaken = false;
	activeFrame.cost = pendingFrame.cost;
	activeFrame.workRemaining = pendingFrame.cost;
	activeFrame.ditherType = pendingFrame.ditherType;
	activeFrame.slotAtlasIds = pendingFrame.slotAtlasIds;
	activeFrame.skyboxFaceIds = pendingFrame.skyboxFaceIds;
	activeFrame.hasSkybox = pendingFrame.hasSkybox;
	pendingFrame.occupied = false;
	pendingFrame.hasCommands = false;
	pendingFrame.ready = false;
	pendingFrame.executionPending = false;
	pendingFrame.executionTaken = false;
	pendingFrame.cost = 0;
	pendingFrame.workRemaining = 0;
	pendingFrame.ditherType = 0;
	pendingFrame.slotAtlasIds = {{-1, -1}};
	pendingFrame.skyboxFaceIds = {};
	pendingFrame.hasSkybox = false;
	scheduleNextService(m_scheduler.currentNowCycles());
	refreshSubmitBusyStatus();
}

void VDP::advanceWork(int workUnits) {
	if (!m_activeFrame.occupied) {
		promotePendingFrame();
	}
	if (!m_activeFrame.occupied || m_activeFrame.ready || workUnits <= 0) {
		return;
	}
	if (workUnits >= m_activeFrame.workRemaining) {
		m_activeFrame.workRemaining = 0;
		m_activeFrame.executionPending = true;
		scheduleNextService(m_scheduler.currentNowCycles());
		return;
	}
	m_activeFrame.workRemaining -= workUnits;
}

int VDP::getPendingRenderWorkUnits() const {
	if (!m_activeFrame.occupied) {
		return m_pendingFrame.cost;
	}
	return (m_activeFrame.ready || m_activeFrame.executionPending) ? 0 : m_activeFrame.workRemaining;
}

void VDP::scheduleNextService(int64_t nowCycles) {
	if (needsImmediateSchedulerService()) {
		m_scheduler.scheduleDeviceService(DeviceServiceVdp, nowCycles);
		return;
	}
	if (!hasPendingRenderWork()) {
		m_scheduler.cancelDeviceService(DeviceServiceVdp);
		return;
	}
	const int pendingWork = getPendingRenderWorkUnits();
	const int targetUnits = pendingWork < VDP_SERVICE_BATCH_WORK_UNITS ? pendingWork : VDP_SERVICE_BATCH_WORK_UNITS;
	if (m_availableWorkUnits >= targetUnits) {
		m_scheduler.scheduleDeviceService(DeviceServiceVdp, nowCycles);
		return;
	}
	m_scheduler.scheduleDeviceService(DeviceServiceVdp, nowCycles + cyclesUntilBudgetUnits(m_cpuHz, m_workUnitsPerSec, m_workCarry, targetUnits - m_availableWorkUnits));
}

void VDP::clearActiveFrame() {
	recycleBlitterBuffers(m_activeFrame.queue);
	recycleBlitterBuffers(m_executingBlitterQueue);
	m_activeFrame.queue.clear();
	m_executingBlitterQueue.clear();
	m_activeFrame.occupied = false;
	m_activeFrame.hasCommands = false;
	m_activeFrame.ready = false;
	m_activeFrame.executionPending = false;
	m_activeFrame.executionTaken = false;
	m_activeFrame.cost = 0;
	m_activeFrame.workRemaining = 0;
	m_activeFrame.ditherType = 0;
	m_activeFrame.slotAtlasIds = {{-1, -1}};
	m_activeFrame.skyboxFaceIds = {};
	m_activeFrame.hasSkybox = false;
}

const std::vector<VDP::BlitterCommand>* VDP::takeReadyExecutionQueue() {
	if (!m_activeFrame.executionPending) {
		return nullptr;
	}
	if (!m_activeFrame.executionTaken) {
		m_executingBlitterQueue.swap(m_activeFrame.queue);
		m_activeFrame.executionTaken = true;
	}
	return &m_executingBlitterQueue;
}

void VDP::completeReadyExecution() {
	if (!m_activeFrame.executionPending || !m_activeFrame.executionTaken) {
		throw vdpFault("no active frame execution pending.");
	}
	m_activeFrame.executionPending = false;
	m_activeFrame.executionTaken = false;
	m_activeFrame.ready = true;
	recycleBlitterBuffers(m_executingBlitterQueue);
	m_executingBlitterQueue.clear();
}

void VDP::commitActiveVisualState() {
	m_committedDitherType = m_activeFrame.ditherType;
	m_committedSlotAtlasIds = m_activeFrame.slotAtlasIds;
	if (!m_activeFrame.hasSkybox) {
		m_committedHasSkybox = false;
		commitSkyboxRenderState(nullptr);
	} else {
		m_committedSkyboxFaceIds = m_activeFrame.skyboxFaceIds;
		commitSkyboxRenderState(&m_committedSkyboxFaceIds);
		m_committedHasSkybox = true;
	}
}

void VDP::presentReadyFrameOnVblankEdge() {
	if (!m_activeFrame.occupied) {
		m_lastFrameCommitted = false;
		m_lastFrameCost = 0;
		m_lastFrameHeld = false;
		promotePendingFrame();
		scheduleNextService(m_scheduler.currentNowCycles());
		refreshSubmitBusyStatus();
		return;
	}
	m_lastFrameCost = m_activeFrame.cost;
	if (!m_activeFrame.ready) {
		m_lastFrameCommitted = false;
		m_lastFrameHeld = true;
		return;
	}
	if (m_activeFrame.hasCommands) {
		swapFrameBufferPages();
	}
	commitActiveVisualState();
	m_lastFrameCommitted = true;
	m_lastFrameHeld = false;
	clearActiveFrame();
	promotePendingFrame();
	scheduleNextService(m_scheduler.currentNowCycles());
	refreshSubmitBusyStatus();
}
// end hot-path

void VDP::initializeFrameBufferSurface() {
	const uint32_t width = m_configuredFrameBufferSize.width;
	const uint32_t height = m_configuredFrameBufferSize.height;
	auto& entry = m_memory.hasAsset(FRAMEBUFFER_RENDER_TEXTURE_KEY)
		? m_memory.getAssetEntry(FRAMEBUFFER_RENDER_TEXTURE_KEY)
		: m_memory.registerImageSlotAt(
			FRAMEBUFFER_RENDER_TEXTURE_KEY,
			VRAM_FRAMEBUFFER_BASE,
			VRAM_FRAMEBUFFER_SIZE,
			0,
			false
		);
	const uint32_t size = width * height * 4u;
	if (size > entry.capacity) {
		throw vdpFault("framebuffer surface exceeds VRAM capacity.");
	}
	entry.baseSize = size;
	entry.baseStride = width * 4u;
	entry.regionX = 0;
	entry.regionY = 0;
	entry.regionW = width;
	entry.regionH = height;
	m_frameBufferWidth = width;
	m_frameBufferHeight = height;
	const size_t pixelCount = static_cast<size_t>(width) * static_cast<size_t>(height);
	m_frameBufferPriorityLayer.resize(pixelCount);
	m_frameBufferPriorityZ.resize(pixelCount);
	m_frameBufferPrioritySeq.resize(pixelCount);
	std::fill(m_frameBufferPriorityLayer.begin(), m_frameBufferPriorityLayer.end(), static_cast<u8>(Layer2D::World));
	std::fill(m_frameBufferPriorityZ.begin(), m_frameBufferPriorityZ.end(), -std::numeric_limits<f32>::infinity());
	std::fill(m_frameBufferPrioritySeq.begin(), m_frameBufferPrioritySeq.end(), 0u);
	m_displayFrameBufferCpuReadback.resize(static_cast<size_t>(width) * static_cast<size_t>(height) * 4u);
	registerVramSlot(entry, FRAMEBUFFER_RENDER_TEXTURE_KEY, VDP_RD_SURFACE_FRAMEBUFFER);
	if (!vdpTextureUploadReady()) {
		return;
	}
	ensureDisplayFrameBufferTexture();
	syncRenderFrameBufferToDisplayPage();
}

VDP::BlitterSource VDP::resolveBlitterSource(u32 handle) const {
	const auto& entry = m_memory.getAssetEntryByHandle(handle);
	if (entry.type != Memory::AssetType::Image) {
		throw vdpFault("asset handle is not an image.");
	}
	size_t ownerIndex = entry.ownerIndex;
	u32 srcX = 0u;
	u32 srcY = 0u;
	u32 width = entry.regionW;
	u32 height = entry.regionH;
	const bool viewAsset = (entry.flags & ASSET_FLAG_VIEW) != 0u;
	if ((entry.flags & ASSET_FLAG_VIEW) != 0u) {
		const auto& base = m_memory.getAssetEntryByHandle(entry.ownerIndex);
		ownerIndex = base.ownerIndex;
		srcX = entry.regionX;
		srcY = entry.regionY;
		width = entry.regionW;
		height = entry.regionH;
	}
	for (const auto& slot : m_vramSlots) {
		if (m_memory.getAssetEntry(slot.assetId).ownerIndex == ownerIndex) {
			return BlitterSource{
				slot.surfaceId,
				srcX,
				srcY,
				width,
				height,
			};
		}
	}
	throw vdpFault(viewAsset ? "VIEW asset handle not found in VRAM slots." : "asset handle not found in VRAM slots.");
}

i32 VDP::getBlitterAtlasId(uint32_t surfaceId) const {
	switch (surfaceId) {
		case VDP_RD_SURFACE_PRIMARY: return 0;
		case VDP_RD_SURFACE_SECONDARY: return 1;
		case VDP_RD_SURFACE_ENGINE: return ENGINE_ATLAS_INDEX;
		default: break;
	}
	throw vdpFault("surface " + std::to_string(surfaceId) + " cannot be sampled by the GLES2 blitter.");
}

VDP::ResolvedBlitterSample VDP::resolveBlitterSample(u32 handle) const {
	const BlitterSource source = resolveBlitterSource(handle);
	const auto& surface = getReadSurface(source.surfaceId);
	const auto& entry = m_memory.getAssetEntry(surface.assetId);
	return ResolvedBlitterSample{
		source,
		entry.regionW,
		entry.regionH,
		getBlitterAtlasId(source.surfaceId),
	};
}

void VDP::commitSkyboxRenderState(const SkyboxImageIds* ids) {
	if (!ids) {
		m_committedSkyboxRenderReady = false;
		return;
	}
	const std::array<const std::string*, SKYBOX_FACE_COUNT> faces = {{&ids->posx, &ids->negx, &ids->posy, &ids->negy, &ids->posz, &ids->negz}};
	for (size_t index = 0; index < faces.size(); ++index) {
		const std::string& assetId = *faces[index];
		const ResolvedBlitterSample sample = resolveBlitterSample(m_memory.resolveAssetHandle(assetId));
		if (sample.atlasId == ENGINE_ATLAS_INDEX) {
			throw vdpFault("skybox image '" + assetId + "' must live in primary/secondary atlas space, not the engine atlas.");
		}
		const size_t uvBase = index * 4u;
		m_committedSkyboxFaceUvRects[uvBase + 0u] = static_cast<f32>(sample.source.srcX) / static_cast<f32>(sample.surfaceWidth);
		m_committedSkyboxFaceUvRects[uvBase + 1u] = static_cast<f32>(sample.source.srcY) / static_cast<f32>(sample.surfaceHeight);
		m_committedSkyboxFaceUvRects[uvBase + 2u] = static_cast<f32>(sample.source.width) / static_cast<f32>(sample.surfaceWidth);
		m_committedSkyboxFaceUvRects[uvBase + 3u] = static_cast<f32>(sample.source.height) / static_cast<f32>(sample.surfaceHeight);
		m_committedSkyboxFaceAtlasBindings[index] = sample.atlasId;
		const size_t sizeBase = index * 2u;
		m_committedSkyboxFaceSizes[sizeBase + 0u] = static_cast<i32>(sample.source.width);
		m_committedSkyboxFaceSizes[sizeBase + 1u] = static_cast<i32>(sample.source.height);
	}
	m_committedSkyboxRenderReady = true;
}

void VDP::enqueueClear(const Color& color) {
	BlitterCommand command;
	command.type = BlitterCommandType::Clear;
	command.seq = nextBlitterSequence();
	command.renderCost = VDP_RENDER_CLEAR_COST;
	command.color = packFrameBufferColor(color);
	enqueueBlitterCommand(std::move(command));
}

void VDP::enqueueBlit(u32 handle, f32 x, f32 y, f32 z, Layer2D layer, f32 scaleX, f32 scaleY, bool flipH, bool flipV, const Color& color, f32 parallaxWeight) {
	const BlitterSource source = resolveBlitterSource(handle);
	const auto clipped = computeClippedRect(
		static_cast<double>(x),
		static_cast<double>(y),
		static_cast<double>(x) + static_cast<double>(source.width) * std::abs(static_cast<double>(scaleX)),
		static_cast<double>(y) + static_cast<double>(source.height) * std::abs(static_cast<double>(scaleY)),
		static_cast<double>(m_frameBufferWidth),
		static_cast<double>(m_frameBufferHeight)
	);
	if (clipped.area == 0.0) {
		return;
	}
	BlitterCommand command;
	command.type = BlitterCommandType::Blit;
	command.seq = nextBlitterSequence();
	command.renderCost = calculateVisibleRectCost(clipped.width, clipped.height);
	command.z = z;
	command.layer = layer;
	command.source = source;
	command.dstX = x;
	command.dstY = y;
	command.scaleX = scaleX;
	command.scaleY = scaleY;
	command.parallaxWeight = parallaxWeight;
	command.flipH = flipH;
	command.flipV = flipV;
	command.color = packFrameBufferColor(color);
	command.renderCost *= calculateAlphaMultiplier(command.color);
	enqueueBlitterCommand(std::move(command));
}

void VDP::enqueueCopyRect(i32 srcX, i32 srcY, i32 width, i32 height, i32 dstX, i32 dstY, f32 z, Layer2D layer) {
	const auto clipped = computeClippedRect(
		static_cast<double>(dstX),
		static_cast<double>(dstY),
		static_cast<double>(dstX + width),
		static_cast<double>(dstY + height),
		static_cast<double>(m_frameBufferWidth),
		static_cast<double>(m_frameBufferHeight)
	);
	if (clipped.area == 0.0) {
		return;
	}
	BlitterCommand command;
	command.type = BlitterCommandType::CopyRect;
	command.seq = nextBlitterSequence();
	command.renderCost = calculateVisibleRectCost(clipped.width, clipped.height);
	command.z = z;
	command.layer = layer;
	command.srcX = srcX;
	command.srcY = srcY;
	command.width = width;
	command.height = height;
	command.dstX = static_cast<f32>(dstX);
	command.dstY = static_cast<f32>(dstY);
	enqueueBlitterCommand(std::move(command));
}

void VDP::enqueueFillRect(f32 x0, f32 y0, f32 x1, f32 y1, f32 z, Layer2D layer, const Color& color) {
	const auto clipped = computeClippedRect(
		static_cast<double>(x0),
		static_cast<double>(y0),
		static_cast<double>(x1),
		static_cast<double>(y1),
		static_cast<double>(m_frameBufferWidth),
		static_cast<double>(m_frameBufferHeight)
	);
	if (clipped.area == 0.0) {
		return;
	}
	BlitterCommand command;
	command.type = BlitterCommandType::FillRect;
	command.seq = nextBlitterSequence();
	command.renderCost = calculateVisibleRectCost(clipped.width, clipped.height);
	command.x0 = x0;
	command.y0 = y0;
	command.x1 = x1;
	command.y1 = y1;
	command.z = z;
	command.layer = layer;
	command.color = packFrameBufferColor(color);
	command.renderCost *= calculateAlphaMultiplier(command.color);
	enqueueBlitterCommand(std::move(command));
}

void VDP::enqueueDrawLine(f32 x0, f32 y0, f32 x1, f32 y1, f32 z, Layer2D layer, const Color& color, f32 thickness) {
	const double span = computeClippedLineSpan(
		static_cast<double>(x0),
		static_cast<double>(y0),
		static_cast<double>(x1),
		static_cast<double>(y1),
		static_cast<double>(m_frameBufferWidth),
		static_cast<double>(m_frameBufferHeight)
	);
	if (span == 0.0) {
		return;
	}
	BlitterCommand command;
	command.type = BlitterCommandType::DrawLine;
	command.seq = nextBlitterSequence();
	command.renderCost = blitSpanBucket(span) * (thickness > 1.0f ? 2 : 1);
	command.x0 = x0;
	command.y0 = y0;
	command.x1 = x1;
	command.y1 = y1;
	command.z = z;
	command.layer = layer;
	command.thickness = thickness;
	command.color = packFrameBufferColor(color);
	command.renderCost *= calculateAlphaMultiplier(command.color);
	enqueueBlitterCommand(std::move(command));
}

void VDP::enqueueDrawRect(f32 x0, f32 y0, f32 x1, f32 y1, f32 z, Layer2D layer, const Color& color) {
	enqueueDrawLine(x0, y0, x1, y0, z, layer, color, 1.0f);
	enqueueDrawLine(x0, y1, x1, y1, z, layer, color, 1.0f);
	enqueueDrawLine(x0, y0, x0, y1, z, layer, color, 1.0f);
	enqueueDrawLine(x1, y0, x1, y1, z, layer, color, 1.0f);
}

void VDP::enqueueDrawPoly(const std::vector<f32>& points, f32 z, const Color& color, f32 thickness, Layer2D layer) {
	if (points.size() < 4u) {
		return;
	}
	for (size_t index = 0; index < points.size(); index += 2u) {
		const size_t next = (index + 2u) % points.size();
		enqueueDrawLine(points[index], points[index + 1u], points[next], points[next + 1u], z, layer, color, thickness);
	}
}

// start repeated-sequence-acceptable -- VDP enqueue paths duplicate direct command filling to avoid indirect tile/glyph readers in frame code.
void VDP::enqueueGlyphRun(const std::string& text, f32 x, f32 y, f32 z, BFont* font, const Color& color, const std::optional<Color>& backgroundColor, i32 start, i32 end, Layer2D layer) {
	if (!font) {
		throw vdpFault("no font available for glyph rendering.");
	}
	BlitterCommand command;
	command.type = BlitterCommandType::GlyphRun;
	command.seq = nextBlitterSequence();
	command.glyphs = acquireGlyphBuffer();
	command.z = z;
	command.layer = layer;
	command.lineHeight = static_cast<u32>(font->lineHeight());
	command.color = packFrameBufferColor(color);
	command.backgroundColor = backgroundColor.has_value()
		? std::optional<FrameBufferColor>(packFrameBufferColor(*backgroundColor))
		: std::nullopt;
	f32 cursorY = y;
	int renderCost = 0;
	const auto enqueueGlyphLine = [&](const std::string& source, size_t byteStart, size_t byteEnd) {
		if (byteStart == byteEnd) {
			cursorY += static_cast<f32>(font->lineHeight());
			return;
		}
		f32 cursorX = x;
		size_t byteIndex = byteStart;
		i32 glyphIndex = 0;
		while (byteIndex < byteEnd) {
			const u32 codepoint = readUtf8Codepoint(source, byteIndex);
			if (glyphIndex >= end) {
				break;
			}
			if (glyphIndex < start) {
				glyphIndex += 1;
				continue;
			}
			const FontGlyph& glyph = font->getGlyph(codepoint);
			const BlitterSource sourceBlit = resolveBlitterSource(m_memory.resolveAssetHandle(glyph.imgid));
			const auto clipped = computeClippedRect(
				static_cast<double>(cursorX),
				static_cast<double>(cursorY),
				static_cast<double>(cursorX) + static_cast<double>(sourceBlit.width),
				static_cast<double>(cursorY) + static_cast<double>(sourceBlit.height),
				static_cast<double>(m_frameBufferWidth),
				static_cast<double>(m_frameBufferHeight)
			);
			if (clipped.area > 0.0) {
				renderCost += calculateVisibleRectCost(clipped.width, clipped.height);
				if (command.backgroundColor.has_value()) {
					const auto backgroundRect = computeClippedRect(
						static_cast<double>(cursorX),
						static_cast<double>(cursorY),
						static_cast<double>(cursorX) + static_cast<double>(glyph.advance),
						static_cast<double>(cursorY) + static_cast<double>(font->lineHeight()),
						static_cast<double>(m_frameBufferWidth),
						static_cast<double>(m_frameBufferHeight)
					);
					if (backgroundRect.area > 0.0) {
						renderCost += calculateVisibleRectCost(backgroundRect.width, backgroundRect.height) * calculateAlphaMultiplier(*command.backgroundColor);
					}
				}
				command.glyphs.emplace_back();
				auto& blit = command.glyphs.back();
				blit.surfaceId = sourceBlit.surfaceId;
				blit.srcX = sourceBlit.srcX;
				blit.srcY = sourceBlit.srcY;
				blit.width = sourceBlit.width;
				blit.height = sourceBlit.height;
				blit.dstX = cursorX;
				blit.dstY = cursorY;
				blit.advance = static_cast<u32>(glyph.advance);
			}
			cursorX += static_cast<f32>(glyph.advance);
			glyphIndex += 1;
		}
		cursorY += static_cast<f32>(font->lineHeight());
	};
	size_t lineStart = 0u;
	while (lineStart <= text.size()) {
		const size_t lineEnd = text.find('\n', lineStart);
		if (lineEnd == std::string::npos) {
			enqueueGlyphLine(text, lineStart, text.size());
			break;
		}
		enqueueGlyphLine(text, lineStart, lineEnd);
		lineStart = lineEnd + 1u;
	}
	if (command.glyphs.empty()) {
		command.glyphs.clear();
		m_glyphBufferPool.push_back(std::move(command.glyphs));
		return;
	}
	command.renderCost = renderCost;
	enqueueBlitterCommand(std::move(command));
}

void VDP::enqueueGlyphRun(const std::vector<std::string>& lines, f32 x, f32 y, f32 z, BFont* font, const Color& color, const std::optional<Color>& backgroundColor, i32 start, i32 end, Layer2D layer) {
	if (!font) {
		throw vdpFault("no font available for glyph rendering.");
	}
	BlitterCommand command;
	command.type = BlitterCommandType::GlyphRun;
	command.seq = nextBlitterSequence();
	command.glyphs = acquireGlyphBuffer();
	command.z = z;
	command.layer = layer;
	command.lineHeight = static_cast<u32>(font->lineHeight());
	command.color = packFrameBufferColor(color);
	command.backgroundColor = backgroundColor.has_value()
		? std::optional<FrameBufferColor>(packFrameBufferColor(*backgroundColor))
		: std::nullopt;
	f32 cursorY = y;
	int renderCost = 0;
	for (const auto& line : lines) {
		if (line.empty()) {
			cursorY += static_cast<f32>(font->lineHeight());
			continue;
		}
		f32 cursorX = x;
		size_t byteIndex = 0u;
		i32 glyphIndex = 0;
		while (byteIndex < line.size()) {
			const u32 codepoint = readUtf8Codepoint(line, byteIndex);
			if (glyphIndex >= end) {
				break;
			}
			if (glyphIndex < start) {
				glyphIndex += 1;
				continue;
			}
			const FontGlyph& glyph = font->getGlyph(codepoint);
			const BlitterSource source = resolveBlitterSource(m_memory.resolveAssetHandle(glyph.imgid));
			const auto clipped = computeClippedRect(
				static_cast<double>(cursorX),
				static_cast<double>(cursorY),
				static_cast<double>(cursorX) + static_cast<double>(source.width),
				static_cast<double>(cursorY) + static_cast<double>(source.height),
				static_cast<double>(m_frameBufferWidth),
				static_cast<double>(m_frameBufferHeight)
			);
			if (clipped.area > 0.0) {
				renderCost += calculateVisibleRectCost(clipped.width, clipped.height);
				if (command.backgroundColor.has_value()) {
					const auto backgroundRect = computeClippedRect(
						static_cast<double>(cursorX),
						static_cast<double>(cursorY),
						static_cast<double>(cursorX) + static_cast<double>(glyph.advance),
						static_cast<double>(cursorY) + static_cast<double>(font->lineHeight()),
						static_cast<double>(m_frameBufferWidth),
						static_cast<double>(m_frameBufferHeight)
					);
					if (backgroundRect.area > 0.0) {
						renderCost += calculateVisibleRectCost(backgroundRect.width, backgroundRect.height) * calculateAlphaMultiplier(*command.backgroundColor);
					}
				}
				command.glyphs.emplace_back();
				auto& blit = command.glyphs.back();
				blit.surfaceId = source.surfaceId;
				blit.srcX = source.srcX;
				blit.srcY = source.srcY;
				blit.width = source.width;
				blit.height = source.height;
				blit.dstX = cursorX;
				blit.dstY = cursorY;
				blit.advance = static_cast<u32>(glyph.advance);
			}
			cursorX += static_cast<f32>(glyph.advance);
			glyphIndex += 1;
		}
		cursorY += static_cast<f32>(font->lineHeight());
	}
	if (command.glyphs.empty()) {
		command.glyphs.clear();
		m_glyphBufferPool.push_back(std::move(command.glyphs));
		return;
	}
	command.renderCost = renderCost;
	enqueueBlitterCommand(std::move(command));
}

void VDP::enqueueTileRun(const std::vector<u32>& handles, i32 cols, i32 rows, i32 tileW, i32 tileH, i32 originX, i32 originY, i32 scrollX, i32 scrollY, f32 z, Layer2D layer) {
	const i32 frameWidth = static_cast<i32>(m_frameBufferWidth);
	const i32 frameHeight = static_cast<i32>(m_frameBufferHeight);
	const i32 totalWidth = cols * tileW;
	const i32 totalHeight = rows * tileH;
	i32 dstX = originX - scrollX;
	i32 dstY = originY - scrollY;
	i32 srcClipX = 0;
	i32 srcClipY = 0;
	i32 writeWidth = totalWidth;
	i32 writeHeight = totalHeight;
	if (dstX < 0) {
		srcClipX = -dstX;
		writeWidth += dstX;
		dstX = 0;
	}
	if (dstY < 0) {
		srcClipY = -dstY;
		writeHeight += dstY;
		dstY = 0;
	}
	const i32 overflowX = (dstX + writeWidth) - frameWidth;
	if (overflowX > 0) {
		writeWidth -= overflowX;
	}
	const i32 overflowY = (dstY + writeHeight) - frameHeight;
	if (overflowY > 0) {
		writeHeight -= overflowY;
	}
	if (writeWidth <= 0 || writeHeight <= 0) {
		return;
	}
	BlitterCommand command;
	command.type = BlitterCommandType::TileRun;
	command.seq = nextBlitterSequence();
	command.tiles = acquireTileBuffer();
	command.z = z;
	command.layer = layer;
	int visibleRowCount = 0;
	int visibleNonEmptyTileCount = 0;
	for (i32 row = 0; row < rows; row += 1) {
		const i32 base = row * cols;
		bool rowHasVisibleTile = false;
		for (i32 col = 0; col < cols; col += 1) {
			const u32 handle = handles[static_cast<size_t>(base + col)];
			if (handle == IO_VDP_TILE_HANDLE_NONE) {
				continue;
			}
			const BlitterSource source = resolveBlitterSource(handle);
			if (source.width != static_cast<u32>(tileW) || source.height != static_cast<u32>(tileH)) {
				throw vdpFault("enqueueTileRun tile size mismatch.");
			}
			const i32 tileX = dstX + (col * tileW) - srcClipX;
			const i32 tileY = dstY + (row * tileH) - srcClipY;
			const auto clipped = computeClippedRect(
				static_cast<double>(tileX),
				static_cast<double>(tileY),
				static_cast<double>(tileX + tileW),
				static_cast<double>(tileY + tileH),
				static_cast<double>(frameWidth),
				static_cast<double>(frameHeight)
			);
			if (clipped.area == 0.0) {
				continue;
			}
			visibleNonEmptyTileCount += 1;
			if (!rowHasVisibleTile) {
				rowHasVisibleTile = true;
				visibleRowCount += 1;
			}
			command.tiles.emplace_back();
			auto& blit = command.tiles.back();
			blit.surfaceId = source.surfaceId;
			blit.srcX = source.srcX;
			blit.srcY = source.srcY;
			blit.width = source.width;
			blit.height = source.height;
			blit.dstX = static_cast<f32>(tileX);
			blit.dstY = static_cast<f32>(tileY);
		}
	}
	if (command.tiles.empty()) {
		command.tiles.clear();
		m_tileBufferPool.push_back(std::move(command.tiles));
		return;
	}
	command.renderCost = tileRunCost(visibleRowCount, visibleNonEmptyTileCount);
	enqueueBlitterCommand(std::move(command));
}

void VDP::enqueuePayloadTileRun(uint32_t payloadBase, uint32_t tileCount, i32 cols, i32 rows, i32 tileW, i32 tileH, i32 originX, i32 originY, i32 scrollX, i32 scrollY, f32 z, Layer2D layer) {
	if (tileCount != static_cast<uint32_t>(cols * rows)) {
		throw vdpFault("enqueuePayloadTileRun size mismatch.");
	}
	const i32 frameWidth = static_cast<i32>(m_frameBufferWidth);
	const i32 frameHeight = static_cast<i32>(m_frameBufferHeight);
	const i32 totalWidth = cols * tileW;
	const i32 totalHeight = rows * tileH;
	i32 dstX = originX - scrollX;
	i32 dstY = originY - scrollY;
	i32 srcClipX = 0;
	i32 srcClipY = 0;
	i32 writeWidth = totalWidth;
	i32 writeHeight = totalHeight;
	if (dstX < 0) {
		srcClipX = -dstX;
		writeWidth += dstX;
		dstX = 0;
	}
	if (dstY < 0) {
		srcClipY = -dstY;
		writeHeight += dstY;
		dstY = 0;
	}
	const i32 overflowX = (dstX + writeWidth) - frameWidth;
	if (overflowX > 0) {
		writeWidth -= overflowX;
	}
	const i32 overflowY = (dstY + writeHeight) - frameHeight;
	if (overflowY > 0) {
		writeHeight -= overflowY;
	}
	if (writeWidth <= 0 || writeHeight <= 0) {
		return;
	}
	BlitterCommand command;
	command.type = BlitterCommandType::TileRun;
	command.seq = nextBlitterSequence();
	command.tiles = acquireTileBuffer();
	command.z = z;
	command.layer = layer;
	int visibleRowCount = 0;
	int visibleNonEmptyTileCount = 0;
	for (i32 row = 0; row < rows; row += 1) {
		const i32 base = row * cols;
		bool rowHasVisibleTile = false;
		for (i32 col = 0; col < cols; col += 1) {
			const u32 handle = m_memory.readU32(payloadBase + static_cast<uint32_t>(base + col) * IO_WORD_SIZE);
			if (handle == IO_VDP_TILE_HANDLE_NONE) {
				continue;
			}
			const BlitterSource source = resolveBlitterSource(handle);
			if (source.width != static_cast<u32>(tileW) || source.height != static_cast<u32>(tileH)) {
				throw vdpFault("enqueuePayloadTileRun tile size mismatch.");
			}
			const i32 tileX = dstX + (col * tileW) - srcClipX;
			const i32 tileY = dstY + (row * tileH) - srcClipY;
			const auto clipped = computeClippedRect(
				static_cast<double>(tileX),
				static_cast<double>(tileY),
				static_cast<double>(tileX + tileW),
				static_cast<double>(tileY + tileH),
				static_cast<double>(frameWidth),
				static_cast<double>(frameHeight)
			);
			if (clipped.area == 0.0) {
				continue;
			}
			visibleNonEmptyTileCount += 1;
			if (!rowHasVisibleTile) {
				rowHasVisibleTile = true;
				visibleRowCount += 1;
			}
			command.tiles.emplace_back();
			auto& blit = command.tiles.back();
			blit.surfaceId = source.surfaceId;
			blit.srcX = source.srcX;
			blit.srcY = source.srcY;
			blit.width = source.width;
			blit.height = source.height;
			blit.dstX = static_cast<f32>(tileX);
			blit.dstY = static_cast<f32>(tileY);
		}
	}
	if (command.tiles.empty()) {
		command.tiles.clear();
		m_tileBufferPool.push_back(std::move(command.tiles));
		return;
	}
	command.renderCost = tileRunCost(visibleRowCount, visibleNonEmptyTileCount);
	enqueueBlitterCommand(std::move(command));
}

void VDP::enqueuePayloadTileRunWords(const u32* payloadWords, uint32_t tileCount, i32 cols, i32 rows, i32 tileW, i32 tileH, i32 originX, i32 originY, i32 scrollX, i32 scrollY, f32 z, Layer2D layer) {
	if (tileCount != static_cast<uint32_t>(cols * rows)) {
		throw vdpFault("enqueuePayloadTileRunWords size mismatch.");
	}
	const i32 frameWidth = static_cast<i32>(m_frameBufferWidth);
	const i32 frameHeight = static_cast<i32>(m_frameBufferHeight);
	const i32 totalWidth = cols * tileW;
	const i32 totalHeight = rows * tileH;
	i32 dstX = originX - scrollX;
	i32 dstY = originY - scrollY;
	i32 srcClipX = 0;
	i32 srcClipY = 0;
	i32 writeWidth = totalWidth;
	i32 writeHeight = totalHeight;
	if (dstX < 0) {
		srcClipX = -dstX;
		writeWidth += dstX;
		dstX = 0;
	}
	if (dstY < 0) {
		srcClipY = -dstY;
		writeHeight += dstY;
		dstY = 0;
	}
	const i32 overflowX = (dstX + writeWidth) - frameWidth;
	if (overflowX > 0) {
		writeWidth -= overflowX;
	}
	const i32 overflowY = (dstY + writeHeight) - frameHeight;
	if (overflowY > 0) {
		writeHeight -= overflowY;
	}
	if (writeWidth <= 0 || writeHeight <= 0) {
		return;
	}
	BlitterCommand command;
	command.type = BlitterCommandType::TileRun;
	command.seq = nextBlitterSequence();
	command.tiles = acquireTileBuffer();
	command.z = z;
	command.layer = layer;
	int visibleRowCount = 0;
	int visibleNonEmptyTileCount = 0;
	for (i32 row = 0; row < rows; row += 1) {
		const i32 base = row * cols;
		bool rowHasVisibleTile = false;
		for (i32 col = 0; col < cols; col += 1) {
			const u32 handle = payloadWords[static_cast<size_t>(base + col)];
			if (handle == IO_VDP_TILE_HANDLE_NONE) {
				continue;
			}
			const BlitterSource source = resolveBlitterSource(handle);
			if (source.width != static_cast<u32>(tileW) || source.height != static_cast<u32>(tileH)) {
				throw vdpFault("enqueuePayloadTileRunWords tile size mismatch.");
			}
			const i32 tileX = dstX + (col * tileW) - srcClipX;
			const i32 tileY = dstY + (row * tileH) - srcClipY;
			const auto clipped = computeClippedRect(
				static_cast<double>(tileX),
				static_cast<double>(tileY),
				static_cast<double>(tileX + tileW),
				static_cast<double>(tileY + tileH),
				static_cast<double>(frameWidth),
				static_cast<double>(frameHeight)
			);
			if (clipped.area == 0.0) {
				continue;
			}
			visibleNonEmptyTileCount += 1;
			if (!rowHasVisibleTile) {
				rowHasVisibleTile = true;
				visibleRowCount += 1;
			}
			command.tiles.emplace_back();
			auto& blit = command.tiles.back();
			blit.surfaceId = source.surfaceId;
			blit.srcX = source.srcX;
			blit.srcY = source.srcY;
			blit.width = source.width;
			blit.height = source.height;
			blit.dstX = static_cast<f32>(tileX);
			blit.dstY = static_cast<f32>(tileY);
		}
	}
	if (command.tiles.empty()) {
		command.tiles.clear();
		m_tileBufferPool.push_back(std::move(command.tiles));
		return;
	}
	command.renderCost = tileRunCost(visibleRowCount, visibleNonEmptyTileCount);
	enqueueBlitterCommand(std::move(command));
}
// end repeated-sequence-acceptable

void VDP::commitLiveVisualState() {
	m_committedDitherType = m_lastDitherType;
	m_committedSlotAtlasIds = m_slotAtlasIds;
	if (!m_hasSkybox) {
		m_committedHasSkybox = false;
		commitSkyboxRenderState(nullptr);
		return;
	}
	m_committedSkyboxFaceIds = m_skyboxFaceIds;
	commitSkyboxRenderState(&m_committedSkyboxFaceIds);
	m_committedHasSkybox = true;
}

// start hot-path -- VDP readback registers are polled by the emulated CPU.
uint32_t VDP::readVdpStatus() {
	uint32_t status = 0;
	if (m_readBudgetBytes >= 4u) {
		status |= VDP_RD_STATUS_READY;
	}
	if (m_readOverflow) {
		status |= VDP_RD_STATUS_OVERFLOW;
	}
	return status;
}

Value VDP::readVdpStatusThunk(void* context, uint32_t) {
	return valueNumber(static_cast<double>(static_cast<VDP*>(context)->readVdpStatus()));
}

uint32_t VDP::readVdpData() {
	const uint32_t surfaceId = m_memory.readIoU32(IO_VDP_RD_SURFACE);
	const uint32_t x = m_memory.readIoU32(IO_VDP_RD_X);
	const uint32_t y = m_memory.readIoU32(IO_VDP_RD_Y);
	const uint32_t mode = m_memory.readIoU32(IO_VDP_RD_MODE);
	if (mode != VDP_RD_MODE_RGBA8888) {
		throw vdpFault("unsupported VDP read mode.");
	}
	const auto& surface = getReadSurface(surfaceId);
	auto& entry = m_memory.getAssetEntry(surface.assetId);
	const uint32_t width = entry.regionW;
	const uint32_t height = entry.regionH;
	if (x >= width || y >= height) {
		throw vdpFault("VDP read out of bounds.");
	}
	if (m_readBudgetBytes < 4u) {
		m_readOverflow = true;
		return 0u;
	}
	auto& cache = getReadCache(surfaceId, surface, x, y);
	const uint32_t localX = x - cache.x0;
	const size_t byteIndex = static_cast<size_t>(localX) * 4u;
	const u32 r = cache.data[byteIndex + 0];
	const u32 g = cache.data[byteIndex + 1];
	const u32 b = cache.data[byteIndex + 2];
	const u32 a = cache.data[byteIndex + 3];
	m_readBudgetBytes -= 4u;
	uint32_t nextX = x + 1u;
	uint32_t nextY = y;
	if (nextX >= width) {
		nextX = 0u;
		nextY = y + 1u;
	}
	m_memory.writeValue(IO_VDP_RD_X, valueNumber(static_cast<double>(nextX)));
	m_memory.writeValue(IO_VDP_RD_Y, valueNumber(static_cast<double>(nextY)));
	return (r | (g << 8u) | (b << 16u) | (a << 24u));
}

Value VDP::readVdpDataThunk(void* context, uint32_t) {
	return valueNumber(static_cast<double>(static_cast<VDP*>(context)->readVdpData()));
}
// end hot-path

void VDP::initializeRegisters() {
	const i32 dither = 0;
	const auto& frameBufferSurface = m_readSurfaces[VDP_RD_SURFACE_FRAMEBUFFER];
	if (!frameBufferSurface.assetId.empty()) {
		const auto& entry = m_memory.getAssetEntry(frameBufferSurface.assetId);
		m_frameBufferWidth = entry.regionW;
		m_frameBufferHeight = entry.regionH;
	} else {
		m_frameBufferWidth = m_configuredFrameBufferSize.width;
		m_frameBufferHeight = m_configuredFrameBufferSize.height;
	}
	resetQueuedFrameState();
	resetIngressState();
	resetStatus();
	m_memory.writeIoValue(IO_VDP_PRIMARY_ATLAS_ID, valueNumber(static_cast<double>(VDP_ATLAS_ID_NONE)));
	m_memory.writeIoValue(IO_VDP_SECONDARY_ATLAS_ID, valueNumber(static_cast<double>(VDP_ATLAS_ID_NONE)));
	m_memory.writeIoValue(IO_VDP_RD_SURFACE, valueNumber(static_cast<double>(VDP_RD_SURFACE_ENGINE)));
	m_memory.writeIoValue(IO_VDP_RD_X, valueNumber(0.0));
	m_memory.writeIoValue(IO_VDP_RD_Y, valueNumber(0.0));
	m_memory.writeIoValue(IO_VDP_RD_MODE, valueNumber(static_cast<double>(VDP_RD_MODE_RGBA8888)));
	m_memory.writeIoValue(IO_VDP_DITHER, valueNumber(static_cast<double>(dither)));
	m_memory.writeIoValue(IO_VDP_CMD, valueNumber(0.0));
	for (int index = 0; index < IO_VDP_CMD_ARG_COUNT; ++index) {
		m_memory.writeIoValue(IO_VDP_CMD_ARG0 + static_cast<uint32_t>(index) * IO_WORD_SIZE, valueNumber(0.0));
	}
	m_lastDitherType = dither;
	m_committedDitherType = dither;
	m_skyboxFaceIds = {};
	m_hasSkybox = false;
	m_committedSkyboxFaceIds = {};
	m_committedHasSkybox = false;
	m_committedSkyboxRenderReady = false;
	m_committedSlotAtlasIds = m_slotAtlasIds;
	m_lastFrameCommitted = true;
	m_lastFrameCost = 0;
	m_lastFrameHeld = false;
	if (vdpRenderFrameBufferTextureExists()) {
		syncRenderFrameBufferToDisplayPage();
	}
}

void VDP::syncRegisters() {
	const i32 dither = m_memory.readIoI32(IO_VDP_DITHER);
	if (dither != m_lastDitherType) {
		m_lastDitherType = dither;
	}
	const uint32_t primaryRaw = m_memory.readIoU32(IO_VDP_PRIMARY_ATLAS_ID);
	const uint32_t secondaryRaw = m_memory.readIoU32(IO_VDP_SECONDARY_ATLAS_ID);
	const i32 primary = primaryRaw == VDP_ATLAS_ID_NONE ? -1 : static_cast<i32>(primaryRaw);
	const i32 secondary = secondaryRaw == VDP_ATLAS_ID_NONE ? -1 : static_cast<i32>(secondaryRaw);
	if (primary != m_slotAtlasIds[0] || secondary != m_slotAtlasIds[1]) {
		applyAtlasSlotMapping(primary, secondary);
	}
}

void VDP::setDitherType(i32 type) {
	m_memory.writeValue(IO_VDP_DITHER, valueNumber(static_cast<double>(type)));
	syncRegisters();
}

void VDP::registerVramAssets(VdpAtlasMemory atlasMemory) {
	m_atlasSizesById = std::move(atlasMemory.atlasSizesById);
	m_atlasViewIdsById = std::move(atlasMemory.atlasViewIdsById);
	m_atlasSlotById.clear();
	m_vramSlots.clear();
	m_imgDecController->clearExternalSlots();
	m_readSurfaces = {};
	for (auto& cache : m_readCaches) {
		cache.width = 0;
		cache.data.clear();
	}
	resetQueuedFrameState();
	m_skyboxFaceIds = {};
	m_hasSkybox = false;
	m_committedSkyboxFaceIds = {};
	m_committedHasSkybox = false;
	m_committedSkyboxRenderReady = false;
	m_committedSlotAtlasIds = {{-1, -1}};
	m_committedDitherType = m_lastDitherType;
	m_vramBootSeed = nextVramBootSeed();
	seedVramStaging();
	initializeFrameBufferSurface();

	const std::string engineAtlasName = generateAtlasName(ENGINE_ATLAS_INDEX);
	auto& engineEntry = m_memory.getAssetEntry(engineAtlasName);
	auto& primarySlotEntry = m_memory.getAssetEntry(ATLAS_PRIMARY_SLOT_ID);
	auto& secondarySlotEntry = m_memory.getAssetEntry(ATLAS_SECONDARY_SLOT_ID);
	registerVramSlot(engineEntry, ENGINE_ATLAS_TEXTURE_KEY, VDP_RD_SURFACE_ENGINE);
	registerVramSlot(primarySlotEntry, ATLAS_PRIMARY_SLOT_ID, VDP_RD_SURFACE_PRIMARY);
	registerVramSlot(secondarySlotEntry, ATLAS_SECONDARY_SLOT_ID, VDP_RD_SURFACE_SECONDARY);
	syncRegisters();
}

uint32_t VDP::trackedUsedVramBytes() const {
	uint32_t usedBytes = 0;
	for (const auto& slot : m_vramSlots) {
		const auto& entry = m_memory.getAssetEntry(slot.assetId);
		usedBytes += entry.baseSize;
	}
	return usedBytes;
}

uint32_t VDP::trackedTotalVramBytes() const {
	return VRAM_SYSTEM_ATLAS_SIZE + VRAM_PRIMARY_ATLAS_SIZE + VRAM_SECONDARY_ATLAS_SIZE + VRAM_FRAMEBUFFER_SIZE + VRAM_STAGING_SIZE;
}

void VDP::applyAtlasSlotMapping(i32 primaryAtlasId, i32 secondaryAtlasId) {
	auto configureSlotEntry = [this](Memory::AssetEntry& slotEntry, i32 atlasId) {
		if (atlasId < 0) {
			const uint32_t maxPixels = slotEntry.capacity / 4u;
			const uint32_t side = static_cast<uint32_t>(std::floor(std::sqrt(static_cast<double>(maxPixels))));
			slotEntry.baseSize = side * side * 4u;
			slotEntry.baseStride = side * 4u;
			slotEntry.regionX = 0u;
			slotEntry.regionY = 0u;
			slotEntry.regionW = side;
			slotEntry.regionH = side;
			return;
		}
		const auto atlasIt = m_atlasSizesById.find(atlasId);
		if (atlasIt == m_atlasSizesById.end()) {
			throw vdpFault("atlas " + std::to_string(atlasId) + " not registered.");
		}
		const uint32_t width = atlasIt->second.width;
		const uint32_t height = atlasIt->second.height;
		const uint32_t size = width * height * 4u;
		if (size > slotEntry.capacity) {
			throw vdpFault("atlas " + std::to_string(atlasId) + " exceeds slot capacity.");
		}
		slotEntry.baseSize = size;
		slotEntry.baseStride = width * 4u;
		slotEntry.regionX = 0u;
		slotEntry.regionY = 0u;
		slotEntry.regionW = width;
		slotEntry.regionH = height;
	};
	auto& primaryEntryForMetrics = m_memory.getAssetEntry(ATLAS_PRIMARY_SLOT_ID);
	auto& secondaryEntryForMetrics = m_memory.getAssetEntry(ATLAS_SECONDARY_SLOT_ID);
	configureSlotEntry(primaryEntryForMetrics, primaryAtlasId);
	configureSlotEntry(secondaryEntryForMetrics, secondaryAtlasId);
	m_atlasSlotById.clear();
	m_slotAtlasIds[0] = primaryAtlasId;
	m_slotAtlasIds[1] = secondaryAtlasId;
	if (primaryAtlasId >= 0) {
		m_atlasSlotById[primaryAtlasId] = 0;
	}
	if (secondaryAtlasId >= 0) {
		m_atlasSlotById[secondaryAtlasId] = 1;
	}
	auto& primaryEntry = m_memory.getAssetEntry(ATLAS_PRIMARY_SLOT_ID);
	auto& secondaryEntry = m_memory.getAssetEntry(ATLAS_SECONDARY_SLOT_ID);
	if (primaryAtlasId >= 0) {
		const auto viewIt = m_atlasViewIdsById.find(primaryAtlasId);
		if (viewIt != m_atlasViewIdsById.end()) {
			for (const auto& viewId : viewIt->second) {
				auto& viewEntry = m_memory.getAssetEntry(viewId);
				m_memory.updateImageViewBase(viewEntry, primaryEntry);
			}
		}
	}
	if (secondaryAtlasId >= 0) {
		const auto viewIt = m_atlasViewIdsById.find(secondaryAtlasId);
		if (viewIt != m_atlasViewIdsById.end()) {
			for (const auto& viewId : viewIt->second) {
				auto& viewEntry = m_memory.getAssetEntry(viewId);
				m_memory.updateImageViewBase(viewEntry, secondaryEntry);
			}
		}
	}
	if (vdpTextureUploadReady()) {
		syncVramSlotTextureSize(getVramSlotByTextureKey(ATLAS_PRIMARY_SLOT_ID));
		syncVramSlotTextureSize(getVramSlotByTextureKey(ATLAS_SECONDARY_SLOT_ID));
	}
}

void VDP::attachImgDecController(ImgDecController& controller) {
	m_imgDecController = &controller;
}

void VDP::setSkyboxImages(const SkyboxImageIds& ids) {
	const std::array<const std::string*, SKYBOX_FACE_COUNT> faces = {{&ids.posx, &ids.negx, &ids.posy, &ids.negy, &ids.posz, &ids.negz}};
	for (size_t index = 0; index < faces.size(); ++index) {
		resolveBlitterSample(m_memory.resolveAssetHandle(*faces[index]));
	}
	m_skyboxFaceIds = ids;
	m_hasSkybox = true;
}

void VDP::clearSkybox() {
	m_skyboxFaceIds = {};
	m_hasSkybox = false;
}

VdpState VDP::captureState() const {
	VdpState state;
	state.atlasSlots = m_slotAtlasIds;
	if (m_hasSkybox) {
		state.skyboxFaceIds = m_skyboxFaceIds;
	}
	state.ditherType = m_lastDitherType;
	return state;
}

void VDP::restoreState(const VdpState& state) {
	m_memory.writeValue(IO_VDP_PRIMARY_ATLAS_ID, valueNumber(static_cast<double>(state.atlasSlots[0] < 0 ? VDP_ATLAS_ID_NONE : state.atlasSlots[0])));
	m_memory.writeValue(IO_VDP_SECONDARY_ATLAS_ID, valueNumber(static_cast<double>(state.atlasSlots[1] < 0 ? VDP_ATLAS_ID_NONE : state.atlasSlots[1])));
	applyAtlasSlotMapping(state.atlasSlots[0], state.atlasSlots[1]);
	if (state.skyboxFaceIds.has_value()) {
		setSkyboxImages(*state.skyboxFaceIds);
	} else {
		clearSkybox();
	}
	setDitherType(state.ditherType);
	commitLiveVisualState();
}

void VDP::registerVramSlot(const Memory::AssetEntry& entry, const std::string& textureKey, uint32_t surfaceId) {
	const bool frameBufferSlot = textureKey == FRAMEBUFFER_RENDER_TEXTURE_KEY;
	VramGarbageStream stream{m_vramMachineSeed, m_vramBootSeed, VRAM_GARBAGE_SPACE_SALT, entry.baseAddr};
	fillVramGarbageScratch(m_vramSeedPixel.data(), m_vramSeedPixel.size(), stream);
	if (frameBufferSlot) {
		ensureVdpTextureFromSeed(textureKey, m_vramSeedPixel.data(), entry.regionW, entry.regionH);
	}
	VramSlot slot;
	slot.baseAddr = entry.baseAddr;
	slot.capacity = entry.capacity;
	slot.assetId = entry.id;
	slot.textureKey = textureKey;
	slot.surfaceId = surfaceId;
	slot.textureWidth = entry.regionW;
	slot.textureHeight = entry.regionH;
	slot.cpuReadback.resize(static_cast<size_t>(entry.regionW) * static_cast<size_t>(entry.regionH) * 4u);
	m_vramSlots.push_back(std::move(slot));
	registerReadSurface(surfaceId, entry.id, textureKey);
	auto& slotRef = m_vramSlots.back();
	if (textureKey == ENGINE_ATLAS_TEXTURE_KEY) {
		invalidateReadCache(surfaceId);
		return;
	}
	seedVramSlotTexture(slotRef);
}

VDP::VramSlot& VDP::findVramSlot(uint32_t addr, size_t length) {
	for (auto& slot : m_vramSlots) {
		const uint32_t end = slot.baseAddr + slot.capacity;
		if (addr >= slot.baseAddr && addr + length <= end) {
			return slot;
		}
	}
	throw vdpFault("VRAM write has no mapped slot.");
}

const VDP::VramSlot& VDP::findVramSlot(uint32_t addr, size_t length) const {
	for (const auto& slot : m_vramSlots) {
		const uint32_t end = slot.baseAddr + slot.capacity;
		if (addr >= slot.baseAddr && addr + length <= end) {
			return slot;
		}
	}
	throw vdpFault("VRAM write has no mapped slot.");
}

void VDP::syncVramSlotTextureSize(VramSlot& slot) {
	auto& entry = m_memory.getAssetEntry(slot.assetId);
	const uint32_t width = entry.regionW;
	const uint32_t height = entry.regionH;
	if (slot.textureWidth == width && slot.textureHeight == height) {
		return;
	}
	slot.textureWidth = width;
	slot.textureHeight = height;
	slot.cpuReadback.resize(static_cast<size_t>(width) * static_cast<size_t>(height) * 4u);
	if (slot.textureKey == FRAMEBUFFER_RENDER_TEXTURE_KEY) {
		resizeVdpTextureForKey(slot.textureKey, width, height);
	}
	invalidateReadCache(slot.surfaceId);
	if (slot.textureKey == ENGINE_ATLAS_TEXTURE_KEY) {
		slot.dirtyRowStart = 0;
		slot.dirtyRowEnd = 0;
		return;
	}
	seedVramSlotTexture(slot);
}

void VDP::markVramSlotDirty(VramSlot& slot, uint32_t startRow, uint32_t rowCount) {
	const uint32_t endRow = startRow + rowCount;
	if (slot.dirtyRowStart >= slot.dirtyRowEnd) {
		slot.dirtyRowStart = startRow;
		slot.dirtyRowEnd = endRow;
		return;
	}
	if (startRow < slot.dirtyRowStart) {
		slot.dirtyRowStart = startRow;
	}
	if (endRow > slot.dirtyRowEnd) {
		slot.dirtyRowEnd = endRow;
	}
}

VDP::VramSlot& VDP::getVramSlotByTextureKey(const std::string& textureKey) {
	for (auto& slot : m_vramSlots) {
		if (slot.textureKey == textureKey) {
			return slot;
		}
	}
	throw vdpFault("VRAM slot not registered for texture '" + textureKey + "'.");
}

const VDP::VramSlot& VDP::getVramSlotByTextureKey(const std::string& textureKey) const {
	for (const auto& slot : m_vramSlots) {
		if (slot.textureKey == textureKey) {
			return slot;
		}
	}
	throw vdpFault("VRAM slot not registered for texture '" + textureKey + "'.");
}

uint32_t VDP::nextVramMachineSeed() const {
	const auto now = std::chrono::high_resolution_clock::now().time_since_epoch().count();
	const uint64_t mixed = static_cast<uint64_t>(now) ^ static_cast<uint64_t>(reinterpret_cast<uintptr_t>(this));
	return static_cast<uint32_t>(mixed ^ (mixed >> 32));
}

uint32_t VDP::nextVramBootSeed() const {
	static uint32_t counter = 0;
	counter += 1;
	const auto now = std::chrono::high_resolution_clock::now().time_since_epoch().count();
	const uint64_t mixed = static_cast<uint64_t>(now)
		^ static_cast<uint64_t>(reinterpret_cast<uintptr_t>(this))
		^ (static_cast<uint64_t>(counter) << 1u);
	return static_cast<uint32_t>(mixed ^ (mixed >> 32) ^ (mixed >> 17));
}

void VDP::fillVramGarbageScratch(u8* buffer, size_t length, VramGarbageStream& s) const {
	const size_t total = length;
	const uint32_t startAddr = s.addr;

	const uint32_t biasSeed = s.machineSeed ^ s.slotSalt;
	const uint32_t bootSeedMix = s.bootSeed ^ s.slotSalt;
	const uint32_t vramBytes = (VRAM_SECONDARY_ATLAS_BASE + VRAM_SECONDARY_ATLAS_SIZE) - VRAM_STAGING_BASE;
	const BiasConfig biasConfig = makeBiasConfig(vramBytes);

	const size_t BLOCK_BYTES = 32u;
	const uint32_t BLOCK_SHIFT = 5u;

	size_t out = 0;
	const bool aligned4 = (((startAddr | static_cast<uint32_t>(total)) & 3u) == 0u);

	while (out < total) {
		const uint32_t addr = startAddr + static_cast<uint32_t>(out);
		const uint32_t blockIndex = addr >> BLOCK_SHIFT;
		const uint32_t blockBase = blockIndex << BLOCK_SHIFT;

		const uint32_t startOff = addr - blockBase;
		const size_t maxBytesThisBlock = std::min<size_t>(BLOCK_BYTES - startOff, total - out);

		BlockGen gen = initBlockGen(biasSeed, bootSeedMix, blockIndex, biasConfig);

		if (aligned4 && startOff == 0u && maxBytesThisBlock == BLOCK_BYTES) {
			for (uint32_t w = 0; w < 8u; ++w) {
				const uint32_t word = nextWord(gen);
				const size_t p = out + (static_cast<size_t>(w) << 2u);
				buffer[p] = static_cast<u8>(word & 0xFFu);
				buffer[p + 1] = static_cast<u8>((word >> 8u) & 0xFFu);
				buffer[p + 2] = static_cast<u8>((word >> 16u) & 0xFFu);
				buffer[p + 3] = static_cast<u8>((word >> 24u) & 0xFFu);
			}
		} else {
			const uint32_t rangeStart = startOff;
			const uint32_t rangeEnd = startOff + static_cast<uint32_t>(maxBytesThisBlock);

			for (uint32_t w = 0; w < 8u; ++w) {
				const uint32_t word = nextWord(gen);
				const uint32_t wordByteStart = w << 2u;
				const uint32_t wordByteEnd = wordByteStart + 4u;
				const uint32_t a0 = std::max<uint32_t>(wordByteStart, rangeStart);
				const uint32_t a1 = std::min<uint32_t>(wordByteEnd, rangeEnd);
				if (a0 >= a1) {
					continue;
				}
				uint32_t tmp = word >> ((a0 - wordByteStart) << 3u);
				for (uint32_t k = a0; k < a1; ++k) {
					buffer[out + static_cast<size_t>(k - rangeStart)] = static_cast<u8>(tmp & 0xFFu);
					tmp >>= 8u;
				}
			}
		}

		out += maxBytesThisBlock;
	}

	s.addr = startAddr + static_cast<uint32_t>(total);
}

void VDP::seedVramStaging() {
	VramGarbageStream stream{m_vramMachineSeed, m_vramBootSeed, VRAM_GARBAGE_SPACE_SALT, VRAM_STAGING_BASE};
	fillVramGarbageScratch(m_vramStaging.data(), m_vramStaging.size(), stream);
}

void VDP::seedVramSlotTexture(VramSlot& slot) {
	auto& entry = m_memory.getAssetEntry(slot.assetId);
	const size_t rowPixels = static_cast<size_t>(entry.regionW);
	const size_t maxPixels = m_vramGarbageScratch.size() / 4u;
	slot.cpuReadback.resize(static_cast<size_t>(entry.regionW) * static_cast<size_t>(entry.regionH) * 4u);
	VramGarbageStream stream{m_vramMachineSeed, m_vramBootSeed, VRAM_GARBAGE_SPACE_SALT, entry.baseAddr};
	const size_t rowBytes = rowPixels * 4u;
	const uint32_t height = entry.regionH;
	const bool frameBufferSlot = slot.textureKey == FRAMEBUFFER_RENDER_TEXTURE_KEY
		&& vdpTextureByUri(slot.textureKey) != nullptr;
	if (rowBytes <= m_vramGarbageScratch.size()) {
		const size_t rowsPerChunk = std::max<size_t>(1u, m_vramGarbageScratch.size() / rowBytes);
		for (uint32_t y = 0; y < height; ) {
			const size_t rows = std::min<size_t>(rowsPerChunk, height - y);
			const size_t chunkBytes = rowBytes * rows;
			fillVramGarbageScratch(m_vramGarbageScratch.data(), chunkBytes, stream);
			if (frameBufferSlot) {
				updateVdpTextureRegion(
					slot.textureKey,
					m_vramGarbageScratch.data(),
					static_cast<i32>(rowPixels),
					static_cast<i32>(rows),
					0,
					static_cast<i32>(y)
				);
			} else {
				markVramSlotDirty(slot, y, static_cast<uint32_t>(rows));
			}
			std::memcpy(slot.cpuReadback.data() + static_cast<size_t>(y) * rowBytes, m_vramGarbageScratch.data(), chunkBytes);
			y += static_cast<uint32_t>(rows);
		}
	} else {
		for (uint32_t y = 0; y < height; ++y) {
			for (uint32_t x = 0; x < entry.regionW; ) {
				const size_t segmentWidth = std::min<size_t>(maxPixels, entry.regionW - x);
				const size_t segmentBytes = segmentWidth * 4u;
				fillVramGarbageScratch(m_vramGarbageScratch.data(), segmentBytes, stream);
				if (frameBufferSlot) {
					updateVdpTextureRegion(
						slot.textureKey,
						m_vramGarbageScratch.data(),
						static_cast<i32>(segmentWidth),
						1,
						static_cast<i32>(x),
						static_cast<i32>(y)
					);
				} else {
					markVramSlotDirty(slot, y, 1u);
				}
				std::memcpy(
					slot.cpuReadback.data() + static_cast<size_t>(y) * rowBytes + static_cast<size_t>(x) * 4u,
					m_vramGarbageScratch.data(),
					segmentBytes
				);
				x += static_cast<uint32_t>(segmentWidth);
			}
		}
	}
	invalidateReadCache(slot.surfaceId);
}

void VDP::restoreVramSlotTexture(const Memory::AssetEntry& entry, const std::string& textureKey) {
	const bool isEngineAtlas = textureKey == ENGINE_ATLAS_TEXTURE_KEY;
	auto& slot = getVramSlotByTextureKey(textureKey);
	const size_t snapshotBytes = static_cast<size_t>(entry.regionW) * static_cast<size_t>(entry.regionH) * 4u;
	const bool restoreSnapshot = slot.contextSnapshot.size() == snapshotBytes;
	VramGarbageStream stream{m_vramMachineSeed, m_vramBootSeed, VRAM_GARBAGE_SPACE_SALT, entry.baseAddr};
	fillVramGarbageScratch(m_vramSeedPixel.data(), m_vramSeedPixel.size(), stream);
	ensureVdpTextureFromSeed(
		textureKey,
		m_vramSeedPixel.data(),
		entry.regionW,
		entry.regionH
	);
	setSlotTextureSize(textureKey, entry.regionW, entry.regionH);
	if (restoreSnapshot) {
		updateVdpTexture(
			textureKey,
			slot.contextSnapshot.data(),
			static_cast<i32>(entry.regionW),
			static_cast<i32>(entry.regionH)
		);
		slot.cpuReadback = slot.contextSnapshot;
		slot.contextSnapshot.clear();
		invalidateReadCache(slot.surfaceId);
		return;
	}
	if (isEngineAtlas) {
		updateVdpTexture(
			textureKey,
			slot.cpuReadback.data(),
			static_cast<i32>(entry.regionW),
			static_cast<i32>(entry.regionH)
		);
		invalidateReadCache(slot.surfaceId);
		return;
	}
	if (!isEngineAtlas) {
		seedVramSlotTexture(slot);
	}
}

void VDP::setSlotTextureSize(const std::string& textureKey, uint32_t width, uint32_t height) {
	for (auto& slot : m_vramSlots) {
		if (slot.textureKey == textureKey) {
			slot.textureWidth = width;
			slot.textureHeight = height;
			return;
		}
	}
}

void VDP::registerReadSurface(uint32_t surfaceId, const std::string& assetId, const std::string& textureKey) {
	m_readSurfaces[surfaceId].assetId = assetId;
	m_readSurfaces[surfaceId].textureKey = textureKey;
	invalidateReadCache(surfaceId);
}

const VDP::ReadSurface& VDP::getReadSurface(uint32_t surfaceId) const {
	return m_readSurfaces[surfaceId];
}

void VDP::invalidateReadCache(uint32_t surfaceId) {
	m_readCaches[surfaceId].width = 0;
}

// start hot-path -- VDP read cache feeds CPU-side MMIO readback one pixel at a time.
VDP::ReadCache& VDP::getReadCache(uint32_t surfaceId, const ReadSurface& surface, uint32_t x, uint32_t y) {
	auto& cache = m_readCaches[surfaceId];
	if (cache.width == 0 || cache.y != y || x < cache.x0 || x >= cache.x0 + cache.width) {
		prefetchReadCache(surfaceId, surface, x, y);
	}
	return cache;
}

// start numeric-sanitization-acceptable -- readback chunk width is the minimum of hardware cap, remaining surface span, and per-frame read budget.
void VDP::prefetchReadCache(uint32_t surfaceId, const ReadSurface& surface, uint32_t x, uint32_t y) {
	auto& entry = m_memory.getAssetEntry(surface.assetId);
	const uint32_t maxPixelsByBudget = m_readBudgetBytes / 4u;
	if (maxPixelsByBudget == 0) {
		m_readOverflow = true;
		m_readCaches[surfaceId].width = 0;
		return;
	}
	const uint32_t chunkW = std::min(VDP_RD_MAX_CHUNK_PIXELS, std::min(entry.regionW - x, maxPixelsByBudget));
	auto& cache = m_readCaches[surfaceId];
	readSurfacePixels(surface, x, y, chunkW, 1, cache.data);
	cache.x0 = x;
	cache.y = y;
	cache.width = chunkW;
}
// end numeric-sanitization-acceptable

void VDP::readSurfacePixels(const ReadSurface& surface, uint32_t x, uint32_t y, uint32_t width, uint32_t height, std::vector<u8>& out) {
	out.resize(static_cast<size_t>(width) * static_cast<size_t>(height) * 4u);
	if (surface.textureKey == FRAMEBUFFER_RENDER_TEXTURE_KEY) {
		readVdpRenderFrameBufferTextureRegion(out.data(), static_cast<i32>(width), static_cast<i32>(height),
			static_cast<i32>(x), static_cast<i32>(y));
		return;
	}
	const auto& slot = getVramSlotByTextureKey(surface.textureKey);
	const auto& entry = m_memory.getAssetEntry(surface.assetId);
	const uint32_t stride = entry.regionW * 4u;
	const uint32_t rowBytes = width * 4u;
	for (uint32_t row = 0; row < height; ++row) {
		const size_t srcOffset = static_cast<size_t>(y + row) * static_cast<size_t>(stride) + static_cast<size_t>(x) * 4u;
		const size_t dstOffset = static_cast<size_t>(row) * static_cast<size_t>(rowBytes);
		std::memcpy(out.data() + dstOffset, slot.cpuReadback.data() + srcOffset, rowBytes);
	}
}
// end hot-path

} // namespace bmsx
