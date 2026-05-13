#include "machine/devices/vdp/vdp.h"
#include "machine/common/word.h"
#include "machine/devices/vdp/fixed_point.h"
#include "machine/devices/vdp/packet.h"
#include "machine/memory/map.h"
#include "machine/devices/imgdec/controller.h"
#include "machine/scheduler/budget.h"
#include <algorithm>
#include <array>
#include <cmath>
#include <cstring>
#include <limits>
#include <string>
#include <utility>

namespace bmsx {
namespace {

constexpr uint32_t VDP_RD_BUDGET_BYTES = 4096u;
constexpr uint32_t VDP_RD_MAX_CHUNK_PIXELS = 256u;
constexpr int VDP_SERVICE_BATCH_WORK_UNITS = 128;
constexpr size_t BLITTER_FIFO_CAPACITY = 4096u;
constexpr u32 VDP_REPLAY_PACKET_FAULT = 0xffffffffu;
constexpr VDP::FrameBufferColor VDP_BLITTER_IMPLICIT_CLEAR{0u, 0u, 0u, 255u};
constexpr VDP::FrameBufferColor VDP_BLITTER_WHITE{255u, 255u, 255u, 255u};
constexpr DeviceStatusRegisters VDP_DEVICE_STATUS_REGISTERS{
	IO_VDP_STATUS,
	IO_VDP_FAULT_CODE,
	IO_VDP_FAULT_DETAIL,
	IO_VDP_FAULT_ACK,
	VDP_STATUS_FAULT,
	VDP_FAULT_NONE,
};

template <typename T>
std::vector<T> acquireVectorFromPool(std::vector<std::vector<T>>& pool) {
	if (pool.empty()) {
		return {};
	}
	std::vector<T> values = std::move(pool.back());
	pool.pop_back();
	return values;
}

uint64_t vramSurfaceByteSize(uint32_t width, uint32_t height) {
	return static_cast<uint64_t>(width) * static_cast<uint64_t>(height) * 4u;
}

} // namespace

VDP::VDP(
	Memory& memory,
	DeviceScheduler& scheduler,
	VdpFrameBufferSize frameBufferSize,
	VdpEntropySeeds entropySeeds
)
	: m_memory(memory)
	, m_fault(memory, VDP_DEVICE_STATUS_REGISTERS)
	, m_vramStaging(VRAM_STAGING_SIZE)
	, m_vramGarbageScratch(VRAM_GARBAGE_CHUNK_BYTES)
	, m_vramMachineSeed(entropySeeds.machineSeed)
	, m_vramBootSeed(entropySeeds.bootSeed)
	, m_vout(VDP_BBU_BILLBOARD_LIMIT)
	, m_configuredFrameBufferSize(frameBufferSize)
	, m_scheduler(scheduler) {
	m_memory.setVramWriter(this);
	m_memory.mapIoRead(IO_VDP_RD_STATUS, this, &VDP::readVdpStatusThunk);
	m_memory.mapIoRead(IO_VDP_RD_DATA, this, &VDP::readVdpDataThunk);
	m_memory.mapIoWrite(IO_VDP_DITHER, this, &VDP::onDitherWriteThunk);
	m_memory.mapIoWrite(IO_VDP_FIFO, this, &VDP::onFifoWriteThunk);
	m_memory.mapIoWrite(IO_VDP_FIFO_CTRL, this, &VDP::onFifoCtrlWriteThunk);
	m_memory.mapIoWrite(IO_VDP_CMD, this, &VDP::onCommandWriteThunk);
	m_memory.mapIoWrite(IO_VDP_FAULT_ACK, this, &VDP::onFaultAckWriteThunk);
	for (uint32_t index = 0; index < VDP_REGISTER_COUNT; ++index) {
		m_memory.mapIoWrite(IO_VDP_REG0 + index * IO_WORD_SIZE, this, &VDP::onRegisterWriteThunk);
	}
	m_memory.mapIoWrite(IO_VDP_PMU_BANK, this, &VDP::onPmuRegisterWindowWriteThunk);
	m_memory.mapIoWrite(IO_VDP_PMU_X, this, &VDP::onPmuRegisterWindowWriteThunk);
	m_memory.mapIoWrite(IO_VDP_PMU_Y, this, &VDP::onPmuRegisterWindowWriteThunk);
	m_memory.mapIoWrite(IO_VDP_PMU_SCALE_X, this, &VDP::onPmuRegisterWindowWriteThunk);
	m_memory.mapIoWrite(IO_VDP_PMU_SCALE_Y, this, &VDP::onPmuRegisterWindowWriteThunk);
	m_memory.mapIoWrite(IO_VDP_PMU_CTRL, this, &VDP::onPmuRegisterWindowWriteThunk);
	m_memory.mapIoWrite(IO_VDP_SBX_CONTROL, this, &VDP::onSbxRegisterWindowWriteThunk);
	for (uint32_t index = 0; index < SKYBOX_FACE_WORD_COUNT; ++index) {
		m_memory.mapIoWrite(IO_VDP_SBX_FACE0 + index * IO_WORD_SIZE, this, &VDP::onSbxRegisterWindowWriteThunk);
	}
	m_memory.mapIoWrite(IO_VDP_SBX_COMMIT, this, &VDP::onSbxCommitWriteThunk);
	m_buildFrame.queue.reserve(BLITTER_FIFO_CAPACITY);
	m_buildFrame.billboards.reserve(VDP_BBU_BILLBOARD_LIMIT);
	m_activeFrame.queue.reserve(BLITTER_FIFO_CAPACITY);
	m_activeFrame.billboards.reserve(VDP_BBU_BILLBOARD_LIMIT);
	m_pendingFrame.queue.reserve(BLITTER_FIFO_CAPACITY);
	m_pendingFrame.billboards.reserve(VDP_BBU_BILLBOARD_LIMIT);
	m_readBudgetBytes = VDP_RD_BUDGET_BYTES;
}

void VDP::resetIngressState() {
	m_vdpFifoWordByteCount = 0;
	m_vdpFifoStreamWordCount = 0u;
	m_dmaSubmitActive = false;
	refreshSubmitBusyStatus();
}

void VDP::resetStatus() {
	m_fault.resetStatus();
	refreshSubmitBusyStatus();
}

void VDP::resetVdpRegisters() {
	uint32_t slotDim = 1u | (1u << 16u);
	if (auto* primary = findRegisteredVramSlotBySurfaceId(VDP_RD_SURFACE_PRIMARY)) {
		slotDim = (primary->surfaceWidth & 0xffffu) | ((primary->surfaceHeight & 0xffffu) << 16u);
	}
	m_vdpRegisters.fill(0u);
	m_vdpRegisters[VDP_REG_SRC_SLOT] = VDP_SLOT_PRIMARY;
	m_vdpRegisters[VDP_REG_LINE_WIDTH] = VDP_Q16_ONE;
	m_vdpRegisters[VDP_REG_DRAW_SCALE_X] = VDP_Q16_ONE;
	m_vdpRegisters[VDP_REG_DRAW_SCALE_Y] = VDP_Q16_ONE;
	m_vdpRegisters[VDP_REG_DRAW_COLOR] = 0xffffffffu;
	m_vdpRegisters[VDP_REG_BG_COLOR] = 0xff000000u;
	m_vdpRegisters[VDP_REG_SLOT_INDEX] = VDP_SLOT_PRIMARY;
	m_vdpRegisters[VDP_REG_SLOT_DIM] = slotDim;
	for (uint32_t index = 0; index < VDP_REGISTER_COUNT; ++index) {
		m_memory.writeIoValue(IO_VDP_REG0 + index * IO_WORD_SIZE, valueNumber(static_cast<double>(m_vdpRegisters[index])));
	}
}

bool VDP::writeVdpRegister(uint32_t index, u32 value) {
	if (index >= VDP_REGISTER_COUNT) {
		m_fault.raise(VDP_FAULT_STREAM_BAD_PACKET, index);
		return false;
	}
	switch (index) {
	case VDP_REG_SLOT_DIM:
		configureSelectedSlotDimension(value);
		break;
	default:
		break;
	}
	m_vdpRegisters[index] = value;
	m_memory.writeIoValue(IO_VDP_REG0 + index * IO_WORD_SIZE, valueNumber(static_cast<double>(value)));
	return true;
}

void VDP::onVdpRegisterWrite(uint32_t addr) {
	const uint32_t index = (addr - IO_VDP_REG0) / IO_WORD_SIZE;
	writeVdpRegister(index, m_memory.readIoU32(addr));
}

void VDP::onDitherWrite(Value value) {
	const i32 ditherType = toI32(asNumber(value));
	m_vout.writeDitherType(ditherType);
}

void VDP::writePmuBankSelect(u32 value) {
	m_pmu.selectBank(value);
	syncPmuRegisterWindow();
}

void VDP::onPmuRegisterWindowWrite(uint32_t addr) {
	const u32 value = m_memory.readIoU32(addr);
	switch (addr) {
	case IO_VDP_PMU_BANK:
		writePmuBankSelect(value);
		return;
	case IO_VDP_PMU_X:
		m_pmu.writeSelectedBankRegister(VdpPmuRegister::X, value);
		break;
	case IO_VDP_PMU_Y:
		m_pmu.writeSelectedBankRegister(VdpPmuRegister::Y, value);
		break;
	case IO_VDP_PMU_SCALE_X:
		m_pmu.writeSelectedBankRegister(VdpPmuRegister::ScaleX, value);
		break;
	case IO_VDP_PMU_SCALE_Y:
		m_pmu.writeSelectedBankRegister(VdpPmuRegister::ScaleY, value);
		break;
	case IO_VDP_PMU_CTRL:
		m_pmu.writeSelectedBankRegister(VdpPmuRegister::Control, value);
		break;
	}
	m_memory.writeIoValue(addr, valueNumber(static_cast<double>(value)));
}

void VDP::syncPmuRegisterWindow() {
	const VdpPmuRegisterWindow window = m_pmu.registerWindow();
	m_memory.writeIoValue(IO_VDP_PMU_BANK, valueNumber(static_cast<double>(window.bank)));
	m_memory.writeIoValue(IO_VDP_PMU_X, valueNumber(static_cast<double>(window.x)));
	m_memory.writeIoValue(IO_VDP_PMU_Y, valueNumber(static_cast<double>(window.y)));
	m_memory.writeIoValue(IO_VDP_PMU_SCALE_X, valueNumber(static_cast<double>(window.scaleX)));
	m_memory.writeIoValue(IO_VDP_PMU_SCALE_Y, valueNumber(static_cast<double>(window.scaleY)));
	m_memory.writeIoValue(IO_VDP_PMU_CTRL, valueNumber(static_cast<double>(window.control)));
}

void VDP::onSbxRegisterWindowWrite(uint32_t addr, Value value) {
	const u32 word = toU32(value);
	if (addr == IO_VDP_SBX_CONTROL) {
		m_sbx.writeFaceWindowControl(word);
		return;
	}
	m_sbx.writeFaceWindowWord((addr - IO_VDP_SBX_FACE0) / IO_WORD_SIZE, word);
}

void VDP::onSbxCommitWrite() {
	if ((m_memory.readIoU32(IO_VDP_SBX_COMMIT) & VDP_SBX_COMMIT_WRITE) == 0u) {
		return;
	}
	m_sbx.commitFaceWindow();
}

void VDP::syncSbxRegisterWindow() {
	m_memory.writeIoValue(IO_VDP_SBX_CONTROL, valueNumber(static_cast<double>(m_sbx.liveControl())));
	const VdpSbxUnit::FaceWords& words = m_sbx.liveFaceWords();
	for (size_t index = 0; index < SKYBOX_FACE_WORD_COUNT; ++index) {
		m_memory.writeIoValue(IO_VDP_SBX_FACE0 + static_cast<uint32_t>(index * IO_WORD_SIZE), valueNumber(static_cast<double>(words[index])));
	}
	m_memory.writeIoValue(IO_VDP_SBX_COMMIT, valueNumber(0.0));
}

void VDP::configureSelectedSlotDimension(u32 word) {
	const uint32_t width = packedLow16(word);
	const uint32_t height = packedHigh16(word);
	if (width == 0u || height == 0u) {
		m_fault.raise(VDP_FAULT_VRAM_SLOT_DIM, word);
		return;
	}
	uint32_t surfaceId = 0u;
	if (!tryResolveSurfaceIdForSlot(m_vdpRegisters[VDP_REG_SLOT_INDEX], surfaceId, VDP_FAULT_VRAM_SLOT_DIM)) {
		return;
	}
	VdpSurfaceUploadSlot* slot = findVramSlotOrFault(surfaceId, VDP_FAULT_VRAM_SLOT_DIM);
	if (slot == nullptr) {
		return;
	}
	const uint64_t byteLength = static_cast<uint64_t>(width) * static_cast<uint64_t>(height) * 4u;
	if (byteLength > slot->capacity) {
		m_fault.raise(VDP_FAULT_VRAM_SLOT_DIM, word);
		return;
	}
	setVramSlotLogicalDimensions(*slot, width, height, word);
}

VdpLatchedGeometry VDP::readLatchedGeometry() const {
	VdpLatchedGeometry geometry;
	geometry.x0 = decodeSignedQ16_16(m_vdpRegisters[VDP_REG_GEOM_X0]);
	geometry.y0 = decodeSignedQ16_16(m_vdpRegisters[VDP_REG_GEOM_Y0]);
	geometry.x1 = decodeSignedQ16_16(m_vdpRegisters[VDP_REG_GEOM_X1]);
	geometry.y1 = decodeSignedQ16_16(m_vdpRegisters[VDP_REG_GEOM_Y1]);
	return geometry;
}

// start hot-path -- VDP status, command ingress, scheduler service, and VRAM row access run on frame-critical paths.
void VDP::setVblankStatus(bool active) {
	m_vout.setVblankActive(active);
	m_fault.setStatusFlag(VDP_STATUS_VBLANK, m_vout.vblankActive());
}

bool VDP::canAcceptVdpSubmit() const {
	return !hasBlockedSubmitPath();
}

void VDP::acceptSubmitAttempt() {
	m_fault.setStatusFlag(VDP_STATUS_SUBMIT_REJECTED, false);
	refreshSubmitBusyStatus();
}

void VDP::rejectSubmitAttempt() {
	m_fault.setStatusFlag(VDP_STATUS_SUBMIT_REJECTED, true);
	refreshSubmitBusyStatus();
}

void VDP::rejectBusySubmitAttempt(uint32_t detail) {
	rejectSubmitAttempt();
	m_fault.raise(VDP_FAULT_SUBMIT_BUSY, detail);
}

void VDP::beginDmaSubmit() {
	m_dmaSubmitActive = true;
	acceptSubmitAttempt();
}

void VDP::endDmaSubmit() {
	m_dmaSubmitActive = false;
	refreshSubmitBusyStatus();
}

bool VDP::sealDmaTransfer(uint32_t src, size_t byteLength) {
	const bool accepted = consumeSealedVdpStream(src, byteLength);
	endDmaSubmit();
	return accepted;
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
	return hasOpenDirectVdpFifoIngress() || m_dmaSubmitActive || m_buildFrame.state != VdpDexFrameState::Idle || !canAcceptSubmittedFrame();
}

// disable-next-line single_line_method_pattern -- submit-busy refresh owns the status-bit projection from current VDP ingress state.
void VDP::refreshSubmitBusyStatus() {
	m_fault.setStatusFlag(VDP_STATUS_SUBMIT_BUSY, hasBlockedSubmitPath());
}

void VDP::pushVdpFifoWord(u32 word) {
	if (m_vdpFifoStreamWordCount >= VDP_STREAM_CAPACITY_WORDS) {
		m_fault.raise(VDP_FAULT_STREAM_BAD_PACKET, m_vdpFifoStreamWordCount + 1u);
		resetIngressState();
		return;
	}
	m_vdpFifoStreamWords[static_cast<size_t>(m_vdpFifoStreamWordCount)] = word;
	m_vdpFifoStreamWordCount += 1u;
	refreshSubmitBusyStatus();
}

bool VDP::consumeSealedVdpStream(uint32_t baseAddr, size_t byteLength) {
	if ((byteLength & 3u) != 0u || byteLength > VDP_STREAM_BUFFER_SIZE) {
		m_fault.raise(VDP_FAULT_STREAM_BAD_PACKET, static_cast<uint32_t>(byteLength));
		return false;
	}
	if (m_buildFrame.state != VdpDexFrameState::Idle) {
		m_fault.raise(VDP_FAULT_STREAM_BAD_PACKET, VDP_CMD_BEGIN_FRAME);
		cancelSubmittedFrame();
		return false;
	}
	uint32_t cursor = baseAddr;
	const uint32_t end = baseAddr + static_cast<uint32_t>(byteLength);
	if (!beginSubmittedFrame(VdpDexFrameState::StreamOpen)) {
		return false;
	}
	bool ended = false;
	while (cursor < end) {
		const u32 word = m_memory.readU32(cursor);
		cursor += IO_WORD_SIZE;
		if (word == VDP_PKT_END) {
				if (cursor != end) {
					m_fault.raise(VDP_FAULT_STREAM_BAD_PACKET, word);
					cancelSubmittedFrame();
					return false;
				}
			ended = true;
			break;
		}
		cursor = consumeReplayPacketFromMemory(word, cursor, end);
		if (cursor == VDP_REPLAY_PACKET_FAULT) {
			cancelSubmittedFrame();
			return false;
		}
	}
	if (!ended) {
		m_fault.raise(VDP_FAULT_STREAM_BAD_PACKET, static_cast<uint32_t>(byteLength));
		cancelSubmittedFrame();
		return false;
	}
	const bool accepted = sealSubmittedFrame();
	if (!accepted) {
		cancelSubmittedFrame();
	}
	refreshSubmitBusyStatus();
	return accepted;
}

void VDP::consumeSealedVdpWordStream(u32 wordCount) {
	if (m_buildFrame.state != VdpDexFrameState::Idle) {
		m_fault.raise(VDP_FAULT_STREAM_BAD_PACKET, VDP_CMD_BEGIN_FRAME);
		cancelSubmittedFrame();
		return;
	}
	u32 cursor = 0u;
	if (!beginSubmittedFrame(VdpDexFrameState::StreamOpen)) {
		return;
	}
	bool ended = false;
	while (cursor < wordCount) {
		const u32 word = m_vdpFifoStreamWords[static_cast<size_t>(cursor)];
		cursor += 1u;
		if (word == VDP_PKT_END) {
			if (cursor != wordCount) {
				m_fault.raise(VDP_FAULT_STREAM_BAD_PACKET, word);
				cancelSubmittedFrame();
				return;
			}
			ended = true;
			break;
		}
		cursor = consumeReplayPacketFromWords(word, cursor, wordCount);
		if (cursor == VDP_REPLAY_PACKET_FAULT) {
			cancelSubmittedFrame();
			return;
		}
	}
	if (!ended) {
		m_fault.raise(VDP_FAULT_STREAM_BAD_PACKET, wordCount);
		cancelSubmittedFrame();
		return;
	}
	if (!sealSubmittedFrame()) {
		cancelSubmittedFrame();
	}
	refreshSubmitBusyStatus();
}

void VDP::sealVdpFifoTransfer() {
	if (m_vdpFifoWordByteCount != 0) {
		m_fault.raise(VDP_FAULT_STREAM_BAD_PACKET, static_cast<uint32_t>(m_vdpFifoWordByteCount));
		resetIngressState();
		return;
	}
	if (m_vdpFifoStreamWordCount == 0u) {
		return;
	}
	consumeSealedVdpWordStream(m_vdpFifoStreamWordCount);
	resetIngressState();
}

// start repeated-sequence-acceptable -- memory replay and FIFO replay consume the same packet ABI from different backing stores.
u32 VDP::consumeReplayPacketFromMemory(u32 word, u32 cursor, u32 end) {
	const u32 kind = word & VDP_PKT_KIND_MASK;
	switch (kind) {
		case VDP_PKT_CMD:
			return consumeReplayCommandPacket(word) ? cursor : VDP_REPLAY_PACKET_FAULT;
		case VDP_PKT_REG1: {
			const u32 reg = decodeReg1Packet(word);
			if (reg == VDP_REPLAY_PACKET_FAULT || cursor + IO_WORD_SIZE > end) {
				m_fault.raise(VDP_FAULT_STREAM_BAD_PACKET, word);
				return VDP_REPLAY_PACKET_FAULT;
			}
			return writeVdpRegister(reg, m_memory.readU32(cursor)) ? cursor + IO_WORD_SIZE : VDP_REPLAY_PACKET_FAULT;
		}
		case VDP_PKT_REGN: {
			RegnPacket packet;
			if (!decodeRegnPacket(word, packet)) {
				m_fault.raise(VDP_FAULT_STREAM_BAD_PACKET, word);
				return VDP_REPLAY_PACKET_FAULT;
			}
			const u32 byteCount = packet.count * IO_WORD_SIZE;
			const u32 payloadEnd = cursor + byteCount;
			if (payloadEnd > end) {
				m_fault.raise(VDP_FAULT_STREAM_BAD_PACKET, word);
				return VDP_REPLAY_PACKET_FAULT;
			}
			for (uint32_t offset = 0; offset < packet.count; ++offset) {
				if (!writeVdpRegister(packet.firstRegister + offset, m_memory.readU32(cursor + offset * IO_WORD_SIZE))) {
					return VDP_REPLAY_PACKET_FAULT;
				}
			}
			return payloadEnd;
		}
		case VDP_BBU_PACKET_KIND: {
			if (!isVdpUnitPacketHeaderValid(word, VDP_BBU_PACKET_PAYLOAD_WORDS)) {
				m_fault.raise(VDP_FAULT_STREAM_BAD_PACKET, word);
				return VDP_REPLAY_PACKET_FAULT;
			}
			const u32 byteCount = VDP_BBU_PACKET_PAYLOAD_WORDS * IO_WORD_SIZE;
			const u32 payloadEnd = cursor + byteCount;
			if (payloadEnd > end) {
				m_fault.raise(VDP_FAULT_STREAM_BAD_PACKET, word);
				return VDP_REPLAY_PACKET_FAULT;
			}
			const u32 controlWord = m_memory.readU32(cursor + IO_WORD_SIZE * 10u);
			if (controlWord != 0u) {
				m_fault.raise(VDP_FAULT_STREAM_BAD_PACKET, controlWord);
				return VDP_REPLAY_PACKET_FAULT;
			}
			return latchBillboardPacket(m_bbu.decodePacket(
				m_memory.readU32(cursor),
				m_memory.readU32(cursor + IO_WORD_SIZE),
				m_memory.readU32(cursor + IO_WORD_SIZE * 2u),
				m_memory.readU32(cursor + IO_WORD_SIZE * 3u),
				m_memory.readU32(cursor + IO_WORD_SIZE * 4u),
				m_memory.readU32(cursor + IO_WORD_SIZE * 5u),
				m_memory.readU32(cursor + IO_WORD_SIZE * 6u),
				m_memory.readU32(cursor + IO_WORD_SIZE * 7u),
				m_memory.readU32(cursor + IO_WORD_SIZE * 8u),
				m_memory.readU32(cursor + IO_WORD_SIZE * 9u))) ? payloadEnd : VDP_REPLAY_PACKET_FAULT;
		}
		case VDP_XF_PACKET_KIND: {
			return consumeXfPacketFromMemory(word, cursor, end);
		}
		case VDP_SBX_PACKET_KIND: {
			if (!isVdpUnitPacketHeaderValid(word, VDP_SBX_PACKET_PAYLOAD_WORDS)) {
				m_fault.raise(VDP_FAULT_STREAM_BAD_PACKET, word);
				return VDP_REPLAY_PACKET_FAULT;
			}
			const u32 byteCount = VDP_SBX_PACKET_PAYLOAD_WORDS * IO_WORD_SIZE;
			const u32 payloadEnd = cursor + byteCount;
			if (payloadEnd > end) {
				m_fault.raise(VDP_FAULT_STREAM_BAD_PACKET, word);
				return VDP_REPLAY_PACKET_FAULT;
			}
				VdpSbxUnit::FaceWords& faceWords = m_sbx.beginPacket(m_memory.readU32(cursor));
				for (size_t index = 0; index < SKYBOX_FACE_WORD_COUNT; ++index) {
					faceWords[index] = m_memory.readU32(cursor + IO_WORD_SIZE * static_cast<u32>(index + 1u));
				}
				m_sbx.commitPacket();
				return payloadEnd;
			}
		default:
			m_fault.raise(VDP_FAULT_STREAM_BAD_PACKET, word);
			return VDP_REPLAY_PACKET_FAULT;
	}
}

u32 VDP::consumeXfPacketFromMemory(u32 word, u32 cursor, u32 end) {
	if (vdpUnitPacketHasFlags(word)) {
		m_fault.raise(VDP_FAULT_STREAM_BAD_PACKET, word);
		return VDP_REPLAY_PACKET_FAULT;
	}
	const u32 payloadWords = vdpUnitPacketPayloadWords(word);
	if (payloadWords < 2u) {
		m_fault.raise(VDP_FAULT_STREAM_BAD_PACKET, word);
		return VDP_REPLAY_PACKET_FAULT;
	}
	const u32 byteCount = payloadWords * IO_WORD_SIZE;
	const u32 payloadEnd = cursor + byteCount;
	if (payloadEnd > end) {
		m_fault.raise(VDP_FAULT_STREAM_BAD_PACKET, word);
		return VDP_REPLAY_PACKET_FAULT;
	}
	const u32 firstRegister = m_memory.readU32(cursor);
	const u32 registerCount = payloadWords - 1u;
	if (firstRegister >= VDP_XF_REGISTER_WORDS || registerCount > VDP_XF_REGISTER_WORDS - firstRegister) {
		m_fault.raise(VDP_FAULT_STREAM_BAD_PACKET, firstRegister);
		return VDP_REPLAY_PACKET_FAULT;
	}
	for (u32 offset = 0u; offset < registerCount; ++offset) {
		const u32 value = m_memory.readU32(cursor + (offset + 1u) * IO_WORD_SIZE);
		if (!m_xf.writeRegister(firstRegister + offset, value)) {
			m_fault.raise(VDP_FAULT_STREAM_BAD_PACKET, value);
			return VDP_REPLAY_PACKET_FAULT;
		}
	}
	return payloadEnd;
}

u32 VDP::consumeReplayPacketFromWords(u32 word, u32 cursor, u32 wordCount) {
	const u32 kind = word & VDP_PKT_KIND_MASK;
	switch (kind) {
		case VDP_PKT_CMD:
			return consumeReplayCommandPacket(word) ? cursor : VDP_REPLAY_PACKET_FAULT;
		case VDP_PKT_REG1: {
			const u32 reg = decodeReg1Packet(word);
			if (reg == VDP_REPLAY_PACKET_FAULT || cursor >= wordCount) {
				m_fault.raise(VDP_FAULT_STREAM_BAD_PACKET, word);
				return VDP_REPLAY_PACKET_FAULT;
			}
			return writeVdpRegister(reg, m_vdpFifoStreamWords[static_cast<size_t>(cursor)]) ? cursor + 1u : VDP_REPLAY_PACKET_FAULT;
		}
		case VDP_PKT_REGN: {
			RegnPacket packet;
			if (!decodeRegnPacket(word, packet) || cursor + packet.count > wordCount) {
				m_fault.raise(VDP_FAULT_STREAM_BAD_PACKET, word);
				return VDP_REPLAY_PACKET_FAULT;
			}
			for (uint32_t offset = 0; offset < packet.count; ++offset) {
				if (!writeVdpRegister(packet.firstRegister + offset, m_vdpFifoStreamWords[static_cast<size_t>(cursor + offset)])) {
					return VDP_REPLAY_PACKET_FAULT;
				}
			}
			return cursor + packet.count;
		}
		case VDP_BBU_PACKET_KIND:
			if (!isVdpUnitPacketHeaderValid(word, VDP_BBU_PACKET_PAYLOAD_WORDS) || cursor + VDP_BBU_PACKET_PAYLOAD_WORDS > wordCount) {
				m_fault.raise(VDP_FAULT_STREAM_BAD_PACKET, word);
				return VDP_REPLAY_PACKET_FAULT;
			}
			if (m_vdpFifoStreamWords[static_cast<size_t>(cursor + 10u)] != 0u) {
				m_fault.raise(VDP_FAULT_STREAM_BAD_PACKET, m_vdpFifoStreamWords[static_cast<size_t>(cursor + 10u)]);
				return VDP_REPLAY_PACKET_FAULT;
			}
			return latchBillboardPacket(m_bbu.decodePacket(
				m_vdpFifoStreamWords[static_cast<size_t>(cursor)],
				m_vdpFifoStreamWords[static_cast<size_t>(cursor + 1u)],
				m_vdpFifoStreamWords[static_cast<size_t>(cursor + 2u)],
				m_vdpFifoStreamWords[static_cast<size_t>(cursor + 3u)],
				m_vdpFifoStreamWords[static_cast<size_t>(cursor + 4u)],
				m_vdpFifoStreamWords[static_cast<size_t>(cursor + 5u)],
				m_vdpFifoStreamWords[static_cast<size_t>(cursor + 6u)],
				m_vdpFifoStreamWords[static_cast<size_t>(cursor + 7u)],
				m_vdpFifoStreamWords[static_cast<size_t>(cursor + 8u)],
				m_vdpFifoStreamWords[static_cast<size_t>(cursor + 9u)])) ? cursor + VDP_BBU_PACKET_PAYLOAD_WORDS : VDP_REPLAY_PACKET_FAULT;
		case VDP_XF_PACKET_KIND:
			return consumeXfPacketFromWords(word, cursor, wordCount);
		case VDP_SBX_PACKET_KIND: {
			if (!isVdpUnitPacketHeaderValid(word, VDP_SBX_PACKET_PAYLOAD_WORDS) || cursor + VDP_SBX_PACKET_PAYLOAD_WORDS > wordCount) {
				m_fault.raise(VDP_FAULT_STREAM_BAD_PACKET, word);
				return VDP_REPLAY_PACKET_FAULT;
			}
				VdpSbxUnit::FaceWords& faceWords = m_sbx.beginPacket(m_vdpFifoStreamWords[static_cast<size_t>(cursor)]);
				for (size_t index = 0; index < SKYBOX_FACE_WORD_COUNT; ++index) {
					faceWords[index] = m_vdpFifoStreamWords[static_cast<size_t>(cursor + static_cast<u32>(index + 1u))];
			}
			m_sbx.commitPacket();
			return cursor + VDP_SBX_PACKET_PAYLOAD_WORDS;
		}
		default:
			m_fault.raise(VDP_FAULT_STREAM_BAD_PACKET, word);
			return VDP_REPLAY_PACKET_FAULT;
	}
}

u32 VDP::consumeXfPacketFromWords(u32 word, u32 cursor, u32 wordCount) {
	if (vdpUnitPacketHasFlags(word)) {
		m_fault.raise(VDP_FAULT_STREAM_BAD_PACKET, word);
		return VDP_REPLAY_PACKET_FAULT;
	}
	const u32 payloadWords = vdpUnitPacketPayloadWords(word);
	if (payloadWords < 2u || cursor + payloadWords > wordCount) {
		m_fault.raise(VDP_FAULT_STREAM_BAD_PACKET, word);
		return VDP_REPLAY_PACKET_FAULT;
	}
	const u32 firstRegister = m_vdpFifoStreamWords[static_cast<size_t>(cursor)];
	const u32 registerCount = payloadWords - 1u;
	if (firstRegister >= VDP_XF_REGISTER_WORDS || registerCount > VDP_XF_REGISTER_WORDS - firstRegister) {
		m_fault.raise(VDP_FAULT_STREAM_BAD_PACKET, firstRegister);
		return VDP_REPLAY_PACKET_FAULT;
	}
	for (u32 offset = 0u; offset < registerCount; ++offset) {
		const u32 value = m_vdpFifoStreamWords[static_cast<size_t>(cursor + offset + 1u)];
		if (!m_xf.writeRegister(firstRegister + offset, value)) {
			m_fault.raise(VDP_FAULT_STREAM_BAD_PACKET, value);
			return VDP_REPLAY_PACKET_FAULT;
		}
	}
	return cursor + payloadWords;
}
// end repeated-sequence-acceptable

u32 VDP::decodeReg1Packet(u32 word) const {
	if ((word & VDP_PKT_RESERVED_MASK) != 0u) {
		return VDP_REPLAY_PACKET_FAULT;
	}
	return packedLow16(word);
}


bool VDP::decodeRegnPacket(u32 word, RegnPacket& packet) const {
	const u32 firstRegister = packedLow16(word);
	const u32 count = (word >> 16u) & 0xffu;
	if (count == 0u || count > VDP_REGISTER_COUNT) {
		return false;
	}
	if (firstRegister >= VDP_REGISTER_COUNT || firstRegister + count > VDP_REGISTER_COUNT) {
		return false;
	}
	packet.firstRegister = firstRegister;
	packet.count = count;
	return true;
}

bool VDP::consumeReplayCommandPacket(u32 word) {
	if ((word & VDP_PKT_RESERVED_MASK) != 0u) {
		m_fault.raise(VDP_FAULT_STREAM_BAD_PACKET, word);
		return false;
	}
	const u32 command = packedLow16(word);
	if (command == VDP_CMD_BEGIN_FRAME || command == VDP_CMD_END_FRAME) {
		m_fault.raise(VDP_FAULT_STREAM_BAD_PACKET, command);
		return false;
	}
	if (command == VDP_CMD_NOP) {
		return true;
	}
	return executeVdpDrawDoorbell(command);
}

void VDP::consumeDirectVdpCommand(u32 command) {
	if (command == VDP_CMD_NOP) {
		return;
	}
	if (command == VDP_CMD_BEGIN_FRAME) {
		if (m_buildFrame.state != VdpDexFrameState::Idle) {
			m_fault.raise(VDP_FAULT_SUBMIT_STATE, command);
			cancelSubmittedFrame();
			return;
		}
		if (!beginSubmittedFrame(VdpDexFrameState::DirectOpen)) {
			return;
		}
		refreshSubmitBusyStatus();
		return;
	}
	if (command == VDP_CMD_END_FRAME) {
		if (m_buildFrame.state == VdpDexFrameState::Idle) {
			rejectSubmitAttempt();
			m_fault.raise(VDP_FAULT_SUBMIT_STATE, command);
			return;
		}
		if (!sealSubmittedFrame()) {
			cancelSubmittedFrame();
		}
		refreshSubmitBusyStatus();
		return;
	}
	if (m_buildFrame.state == VdpDexFrameState::Idle) {
		rejectSubmitAttempt();
		m_fault.raise(VDP_FAULT_SUBMIT_STATE, command);
		return;
	}
	executeVdpDrawDoorbell(command);
	refreshSubmitBusyStatus();
}

bool VDP::executeVdpDrawDoorbell(u32 command) {
	switch (command) {
		case VDP_CMD_CLEAR:
			return enqueueLatchedClear();
		case VDP_CMD_FILL_RECT:
			return enqueueLatchedFillRect();
		case VDP_CMD_DRAW_LINE:
			return enqueueLatchedDrawLine();
		case VDP_CMD_BLIT:
			return enqueueLatchedBlit();
		case VDP_CMD_COPY_RECT:
			return enqueueLatchedCopyRect();
		default:
			m_fault.raise(VDP_FAULT_CMD_BAD_DOORBELL, command);
			return false;
	}
}

void VDP::onVdpFifoWrite() {
	if (m_dmaSubmitActive || m_buildFrame.state != VdpDexFrameState::Idle || (!hasOpenDirectVdpFifoIngress() && !canAcceptSubmittedFrame())) {
		rejectBusySubmitAttempt(m_memory.readIoU32(IO_VDP_FIFO));
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
		rejectBusySubmitAttempt(VDP_FIFO_CTRL_SEAL);
		return;
	}
	sealVdpFifoTransfer();
	refreshSubmitBusyStatus();
}

void VDP::onVdpCommandWrite() {
	const uint32_t command = m_memory.readIoU32(IO_VDP_CMD);
	if (command == VDP_CMD_NOP) {
		return;
	}
	const bool directFrameCommand = command == VDP_CMD_BEGIN_FRAME || command == VDP_CMD_END_FRAME || m_buildFrame.state == VdpDexFrameState::DirectOpen;
	if (!directFrameCommand && hasBlockedSubmitPath()) {
		rejectBusySubmitAttempt(command);
		return;
	}
	if (command == VDP_CMD_BEGIN_FRAME && m_buildFrame.state == VdpDexFrameState::Idle && hasBlockedSubmitPath()) {
		rejectBusySubmitAttempt(command);
		return;
	}
	if (command != VDP_CMD_BEGIN_FRAME && command != VDP_CMD_END_FRAME && m_buildFrame.state == VdpDexFrameState::Idle) {
		rejectSubmitAttempt();
	} else {
		acceptSubmitAttempt();
	}
	consumeDirectVdpCommand(command);
}

void VDP::onFifoWriteThunk(void* context, uint32_t, Value) {
	auto& vdp = *static_cast<VDP*>(context);
	vdp.onVdpFifoWrite();
}

void VDP::onFifoCtrlWriteThunk(void* context, uint32_t, Value) {
	auto& vdp = *static_cast<VDP*>(context);
	vdp.onVdpFifoCtrlWrite();
}

void VDP::onCommandWriteThunk(void* context, uint32_t, Value) {
	auto& vdp = *static_cast<VDP*>(context);
	vdp.onVdpCommandWrite();
}

void VDP::onDitherWriteThunk(void* context, uint32_t, Value value) {
	auto& vdp = *static_cast<VDP*>(context);
	vdp.onDitherWrite(value);
}

void VDP::onRegisterWriteThunk(void* context, uint32_t addr, Value) {
	auto& vdp = *static_cast<VDP*>(context);
	vdp.onVdpRegisterWrite(addr);
}

void VDP::onPmuRegisterWindowWriteThunk(void* context, uint32_t addr, Value) {
	auto& vdp = *static_cast<VDP*>(context);
	vdp.onPmuRegisterWindowWrite(addr);
}

void VDP::onSbxRegisterWindowWriteThunk(void* context, uint32_t addr, Value value) {
	auto& vdp = *static_cast<VDP*>(context);
	vdp.onSbxRegisterWindowWrite(addr, value);
}

void VDP::onSbxCommitWriteThunk(void* context, uint32_t, Value) {
	auto& vdp = *static_cast<VDP*>(context);
	vdp.onSbxCommitWrite();
}

void VDP::onFaultAckWriteThunk(void* context, uint32_t, Value) {
	auto& vdp = *static_cast<VDP*>(context);
	vdp.m_fault.acknowledge();
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
	VdpSurfaceUploadSlot* mappedSlot = findMappedVramSlot(addr, length);
	if (mappedSlot == nullptr) {
		m_fault.raise(VDP_FAULT_VRAM_WRITE_UNMAPPED, addr);
		return;
	}
	auto& slot = *mappedSlot;
	const uint32_t offset = addr - slot.baseAddr;
	if ((offset & 3u) != 0u || (length & 3u) != 0u) {
		m_fault.raise(VDP_FAULT_VRAM_WRITE_UNALIGNED, addr);
		return;
	}
	if (slot.surfaceWidth == 0 || slot.surfaceHeight == 0) {
		m_fault.raise(VDP_FAULT_VRAM_WRITE_UNINITIALIZED, addr);
		return;
	}
	const uint32_t stride = slot.surfaceWidth * 4u;
	const uint32_t totalBytes = slot.surfaceHeight * stride;
	if (offset + length > totalBytes) {
		m_fault.raise(VDP_FAULT_VRAM_WRITE_OOB, addr);
		return;
	}
	size_t remaining = length;
	size_t cursor = 0;
	uint32_t row = offset / stride;
	uint32_t rowOffset = offset - row * stride;
	while (remaining > 0) {
		const uint32_t rowAvailable = stride - rowOffset;
		const uint32_t rowBytes = static_cast<uint32_t>(std::min<size_t>(remaining, rowAvailable));
		const uint32_t xStart = rowOffset / 4u;
		const uint32_t xEnd = xStart + rowBytes / 4u;
		markVramSlotDirtySpan(slot, row, xStart, xEnd);
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
	const VdpSurfaceUploadSlot* mappedSlot = findMappedVramSlot(addr, length);
	if (mappedSlot == nullptr) {
		m_fault.raise(VDP_FAULT_VRAM_WRITE_UNMAPPED, addr);
		std::memset(out, 0, length);
		return;
	}
	const auto& slot = *mappedSlot;
	if (slot.surfaceWidth == 0 || slot.surfaceHeight == 0) {
		m_fault.raise(VDP_FAULT_VRAM_WRITE_UNINITIALIZED, addr);
		std::memset(out, 0, length);
		return;
	}
	const uint32_t offset = addr - slot.baseAddr;
	const uint32_t stride = slot.surfaceWidth * 4u;
	const uint32_t totalBytes = slot.surfaceHeight * stride;
	if (offset + length > totalBytes) {
		m_fault.raise(VDP_FAULT_VRAM_WRITE_OOB, addr);
		std::memset(out, 0, length);
		return;
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
	scheduleNextService(m_scheduler.currentNowCycles());
}

bool VDP::enqueueLatchedClear() {
	BlitterCommand command;
	command.type = BlitterCommandType::Clear;
	command.seq = nextBlitterSequence();
	command.renderCost = VDP_RENDER_CLEAR_COST;
	command.color = unpackArgbColor(m_vdpRegisters[VDP_REG_BG_COLOR]);
	return enqueueBlitterCommand(std::move(command));
}

bool VDP::enqueueLatchedFillRect() {
	const Layer2D layer = static_cast<Layer2D>(m_vdpRegisters[VDP_REG_DRAW_LAYER]);
	const f32 priority = static_cast<f32>(m_vdpRegisters[VDP_REG_DRAW_PRIORITY]);
	const VdpLatchedGeometry geometry = readLatchedGeometry();
	const VdpClippedRect clipped = computeClippedRect(geometry.x0, geometry.y0, geometry.x1, geometry.y1, m_fbm.width(), m_fbm.height());
	if (clipped.area == 0.0) {
		return true;
	}
	const FrameBufferColor color = unpackArgbColor(m_vdpRegisters[VDP_REG_DRAW_COLOR]);
	BlitterCommand command;
	assignLayeredBlitterCommand(
		command,
		BlitterCommandType::FillRect,
		blitAreaBucket(clipped.area) * (color.a < 255u ? VDP_RENDER_ALPHA_COST_MULTIPLIER : 1),
		layer,
		priority);
	command.x0 = geometry.x0;
	command.y0 = geometry.y0;
	command.x1 = geometry.x1;
	command.y1 = geometry.y1;
	command.color = color;
	return enqueueBlitterCommand(std::move(command));
}

bool VDP::enqueueLatchedDrawLine() {
	const Layer2D layer = static_cast<Layer2D>(m_vdpRegisters[VDP_REG_DRAW_LAYER]);
	const f32 priority = static_cast<f32>(m_vdpRegisters[VDP_REG_DRAW_PRIORITY]);
	const f32 thickness = decodeSignedQ16_16(m_vdpRegisters[VDP_REG_LINE_WIDTH]);
	if (thickness <= 0.0f) {
		m_fault.raise(VDP_FAULT_DEX_INVALID_LINE_WIDTH, m_vdpRegisters[VDP_REG_LINE_WIDTH]);
		return false;
	}
	const VdpLatchedGeometry geometry = readLatchedGeometry();
	const double span = computeClippedLineSpan(geometry.x0, geometry.y0, geometry.x1, geometry.y1, m_fbm.width(), m_fbm.height());
	if (span == 0.0) {
		return true;
	}
	const FrameBufferColor color = unpackArgbColor(m_vdpRegisters[VDP_REG_DRAW_COLOR]);
	const int thicknessMultiplier = thickness > 1.0f ? 2 : 1;
	BlitterCommand command;
	const int alphaCost = color.a < 255u ? VDP_RENDER_ALPHA_COST_MULTIPLIER : 1;
	assignLayeredBlitterCommand(command, BlitterCommandType::DrawLine, blitSpanBucket(span) * thicknessMultiplier * alphaCost, layer, priority);
	command.x0 = geometry.x0;
	command.y0 = geometry.y0;
	command.x1 = geometry.x1;
	command.y1 = geometry.y1;
	command.thickness = thickness;
	command.color = color;
	return enqueueBlitterCommand(std::move(command));
}

bool VDP::enqueueLatchedBlit() {
	const Layer2D layer = static_cast<Layer2D>(m_vdpRegisters[VDP_REG_DRAW_LAYER]);
	const f32 priority = static_cast<f32>(m_vdpRegisters[VDP_REG_DRAW_PRIORITY]);
	const VdpDrawCtrl drawCtrl = decodeVdpDrawCtrl(m_vdpRegisters[VDP_REG_DRAW_CTRL]);
	if (drawCtrl.blendMode != 0u) {
		m_fault.raise(VDP_FAULT_DEX_UNSUPPORTED_DRAW_CTRL, m_vdpRegisters[VDP_REG_DRAW_CTRL]);
		return false;
	}
	const u32 slot = m_vdpRegisters[VDP_REG_SRC_SLOT];
	const u32 u = packedLow16(m_vdpRegisters[VDP_REG_SRC_UV]);
	const u32 v = packedHigh16(m_vdpRegisters[VDP_REG_SRC_UV]);
	const u32 w = packedLow16(m_vdpRegisters[VDP_REG_SRC_WH]);
	const u32 h = packedHigh16(m_vdpRegisters[VDP_REG_SRC_WH]);
	BlitterSource source;
	if (!tryResolveBlitterSourceWordsInto(slot, u, v, w, h, source, VDP_FAULT_DEX_SOURCE_SLOT)) {
		return false;
	}
	if (tryResolveBlitterSurfaceForSource(source, VDP_FAULT_DEX_SOURCE_OOB, VDP_FAULT_DEX_SOURCE_OOB) == nullptr) {
		return false;
	}
	const f32 scaleX = decodeSignedQ16_16(m_vdpRegisters[VDP_REG_DRAW_SCALE_X]);
	const f32 scaleY = decodeSignedQ16_16(m_vdpRegisters[VDP_REG_DRAW_SCALE_Y]);
	if (scaleX <= 0.0f) {
		m_fault.raise(VDP_FAULT_DEX_INVALID_SCALE, m_vdpRegisters[VDP_REG_DRAW_SCALE_X]);
		return false;
	}
	if (scaleY <= 0.0f) {
		m_fault.raise(VDP_FAULT_DEX_INVALID_SCALE, m_vdpRegisters[VDP_REG_DRAW_SCALE_Y]);
		return false;
	}
	const f32 dstX = decodeSignedQ16_16(m_vdpRegisters[VDP_REG_DST_X]);
	const f32 dstY = decodeSignedQ16_16(m_vdpRegisters[VDP_REG_DST_Y]);
	const VdpResolvedBlitPmu resolved = m_pmu.resolveBlit(dstX, dstY, scaleX, scaleY, drawCtrl.pmuBank, drawCtrl.parallaxWeight);
	const double dstWidth = static_cast<double>(source.width) * static_cast<double>(resolved.scaleX);
	const double dstHeight = static_cast<double>(source.height) * static_cast<double>(resolved.scaleY);
	const VdpClippedRect clipped = computeClippedRect(resolved.dstX, resolved.dstY, resolved.dstX + dstWidth, resolved.dstY + dstHeight, m_fbm.width(), m_fbm.height());
	if (clipped.area == 0.0) {
		return true;
	}
	const FrameBufferColor color = unpackArgbColor(m_vdpRegisters[VDP_REG_DRAW_COLOR]);
	BlitterCommand command;
	assignLayeredBlitterCommand(
		command,
		BlitterCommandType::Blit,
		blitAreaBucket(clipped.area) * (color.a < 255u ? VDP_RENDER_ALPHA_COST_MULTIPLIER : 1),
		layer,
		priority);
	command.source = source;
	command.dstX = resolved.dstX;
	command.dstY = resolved.dstY;
	command.scaleX = resolved.scaleX;
	command.scaleY = resolved.scaleY;
	command.flipH = drawCtrl.flipH;
	command.flipV = drawCtrl.flipV;
	command.color = color;
	command.parallaxWeight = drawCtrl.parallaxWeight;
	return enqueueBlitterCommand(std::move(command));
}

bool VDP::enqueueLatchedCopyRect() {
	const Layer2D layer = static_cast<Layer2D>(m_vdpRegisters[VDP_REG_DRAW_LAYER]);
	const f32 priority = static_cast<f32>(m_vdpRegisters[VDP_REG_DRAW_PRIORITY]);
	const i32 srcX = static_cast<i32>(packedLow16(m_vdpRegisters[VDP_REG_SRC_UV]));
	const i32 srcY = static_cast<i32>(packedHigh16(m_vdpRegisters[VDP_REG_SRC_UV]));
	const i32 width = static_cast<i32>(packedLow16(m_vdpRegisters[VDP_REG_SRC_WH]));
	const i32 height = static_cast<i32>(packedHigh16(m_vdpRegisters[VDP_REG_SRC_WH]));
	const i32 dstX = static_cast<i32>(m_vdpRegisters[VDP_REG_DST_X]) >> 16;
	const i32 dstY = static_cast<i32>(m_vdpRegisters[VDP_REG_DST_Y]) >> 16;
	return enqueueCopyRect(srcX, srcY, width, height, dstX, dstY, priority, layer);
}

u32 VDP::nextBlitterSequence() {
	return m_blitterSequence++;
}

void VDP::assignLayeredBlitterCommand(BlitterCommand& command, BlitterCommandType type, int renderCost, Layer2D layer, f32 priority) {
	command.type = type;
	command.seq = nextBlitterSequence();
	command.renderCost = renderCost;
	command.layer = layer;
	command.priority = priority;
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
	recycleBlitterBuffers(m_buildFrame.queue);
	m_buildFrame.queue.clear();
	m_buildFrame.billboards.clear();
	m_buildFrame.cost = 0;
	m_buildFrame.state = VdpDexFrameState::Idle;
}

void VDP::resetQueuedFrameState() {
	resetBuildFrameState();
	clearActiveFrame();
	recycleBlitterBuffers(m_pendingFrame.queue);
	m_pendingFrame.billboards.clear();
	resetSubmittedFrameSlot(m_pendingFrame);
}

bool VDP::enqueueBlitterCommand(BlitterCommand&& command) {
	if (m_buildFrame.state == VdpDexFrameState::Idle) {
		m_fault.raise(VDP_FAULT_SUBMIT_STATE, static_cast<uint32_t>(command.type));
		return false;
	}
	if (m_buildFrame.queue.size() >= BLITTER_FIFO_CAPACITY) {
		m_fault.raise(VDP_FAULT_DEX_OVERFLOW, static_cast<uint32_t>(m_buildFrame.queue.size()));
		return false;
	}
	m_buildFrame.cost += command.renderCost;
	m_buildFrame.queue.push_back(std::move(command));
	return true;
}

void VDP::presentFrameBufferPageOnVblankEdge() {
	VdpSurfaceUploadSlot* slot = findVramSlotOrFault(VDP_RD_SURFACE_FRAMEBUFFER, VDP_FAULT_RD_SURFACE);
	if (slot == nullptr) {
		return;
	}
	m_fbm.presentPage(*slot);
	clearSurfaceUploadDirty(VDP_RD_SURFACE_FRAMEBUFFER);
	invalidateReadCache(VDP_RD_SURFACE_FRAMEBUFFER);
}

void VDP::clearFrameBufferPresentation() {
	if (m_fbm.hasPendingPresentation()) {
		m_fbm.clearPresentation();
	}
}

const std::vector<u8>* VDP::frameBufferRenderReadback() const {
	const VdpSurfaceUploadSlot* slot = findVramSlotOrFault(VDP_RD_SURFACE_FRAMEBUFFER, VDP_FAULT_RD_SURFACE);
	if (slot == nullptr) {
		return nullptr;
	}
	return &slot->cpuReadback;
}

void VDP::drainFrameBufferPresentation(VdpFrameBufferPresentationSink& sink) {
	if (!m_fbm.hasPendingPresentation()) {
		return;
	}
	const std::vector<u8>* renderReadback = frameBufferRenderReadback();
	if (renderReadback == nullptr) {
		m_fault.raise(VDP_FAULT_RD_SURFACE, VDP_RD_SURFACE_FRAMEBUFFER);
		return;
	}
	sink.consumeVdpFrameBufferPresentation(m_fbm.buildPresentation(*renderReadback));
	m_fbm.clearPresentation();
}

bool VDP::beginSubmittedFrame(VdpDexFrameState state) {
	if (m_buildFrame.state != VdpDexFrameState::Idle) {
		m_fault.raise(VDP_FAULT_SUBMIT_STATE, VDP_CMD_BEGIN_FRAME);
		return false;
	}
	resetBuildFrameState();
	m_blitterSequence = 0u;
	m_buildFrame.state = state;
	return true;
}

void VDP::cancelSubmittedFrame() {
	resetBuildFrameState();
	scheduleNextService(m_scheduler.currentNowCycles());
	refreshSubmitBusyStatus();
}

bool VDP::sealSubmittedFrame() {
	if (m_buildFrame.state == VdpDexFrameState::Idle) {
		m_fault.raise(VDP_FAULT_SUBMIT_STATE, VDP_CMD_END_FRAME);
		return false;
	}
	VdpSubmittedFrame* frame = nullptr;
	if (!m_activeFrame.occupied) {
		frame = &m_activeFrame;
	} else if (!m_pendingFrame.occupied) {
		frame = &m_pendingFrame;
	} else {
		m_fault.raise(VDP_FAULT_SUBMIT_BUSY, VDP_CMD_END_FRAME);
		return false;
	}
	const bool frameHasFrameBufferCommands = !m_buildFrame.queue.empty();
	const bool frameHasCommands = frameHasFrameBufferCommands || !m_buildFrame.billboards.empty();
	const int frameCost = (!m_buildFrame.queue.empty() && m_buildFrame.queue.front().type != BlitterCommandType::Clear)
		? (m_buildFrame.cost + VDP_RENDER_CLEAR_COST)
		: m_buildFrame.cost;
	const VdpSbxFrameDecision sbxDecision = m_sbx.beginFrameSeal();
	const VdpSbxUnit::FaceWords& sbxSealFaceWords = m_sbx.sealFaceWords();
	VdpSbxFrameResolution sbxResolution;
	resolveSkyboxFrameSamplesInto(sbxDecision.control, sbxSealFaceWords, m_sbxSealSamples, sbxResolution);
	const VdpSbxFrameDecision completedSbx = m_sbx.completeFrameSeal(sbxResolution);
	if (completedSbx.faultCode != VDP_FAULT_NONE) {
		m_fault.raise(completedSbx.faultCode, completedSbx.faultDetail);
		return false;
	}
	frame->xf.matrixWords = m_xf.matrixWords;
	frame->xf.viewMatrixIndex = m_xf.viewMatrixIndex;
	frame->xf.projectionMatrixIndex = m_xf.projectionMatrixIndex;
	frame->skyboxControl = completedSbx.control;
	frame->skyboxFaceWords = sbxSealFaceWords;
	std::swap(frame->skyboxSamples, m_sbxSealSamples);
	frame->queue.swap(m_buildFrame.queue);
	frame->billboards.swap(m_buildFrame.billboards);
	frame->occupied = true;
	frame->hasCommands = frameHasCommands;
	frame->hasFrameBufferCommands = frameHasFrameBufferCommands;
	frame->ready = frameCost == 0;
	frame->cost = frameCost;
	frame->workRemaining = frameCost;
	const VdpVoutFrameOutput& voutFrame = m_vout.sealFrame();
	frame->ditherType = voutFrame.ditherType;
	frame->frameBufferWidth = voutFrame.frameBufferWidth;
	frame->frameBufferHeight = voutFrame.frameBufferHeight;
	m_buildFrame.billboards.clear();
	m_buildFrame.cost = 0;
	m_buildFrame.state = VdpDexFrameState::Idle;
	scheduleNextService(m_scheduler.currentNowCycles());
	refreshSubmitBusyStatus();
	return true;
}

void VDP::promotePendingFrame() {
	if (m_activeFrame.occupied || !m_pendingFrame.occupied) {
		return;
	}
	std::swap(m_activeFrame, m_pendingFrame);
	resetSubmittedFrameSlot(m_pendingFrame);
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
		if (m_activeFrame.hasFrameBufferCommands) {
			executeFrameBufferCommands(m_activeFrame.queue);
		}
		recycleBlitterBuffers(m_activeFrame.queue);
		m_activeFrame.queue.clear();
		m_activeFrame.ready = true;
		refreshSubmitBusyStatus();
		scheduleNextService(m_scheduler.currentNowCycles());
		return;
	}
	m_activeFrame.workRemaining -= workUnits;
}

int VDP::getPendingRenderWorkUnits() const {
	if (!m_activeFrame.occupied) {
		return m_pendingFrame.cost;
	}
	return m_activeFrame.ready ? 0 : m_activeFrame.workRemaining;
}

void VDP::executeFrameBufferCommands(const std::vector<BlitterCommand>& commands) {
	if (commands.empty()) {
		return;
	}
	VdpSurfaceUploadSlot* frameBufferSlot = findVramSlotOrFault(VDP_RD_SURFACE_FRAMEBUFFER, VDP_FAULT_RD_SURFACE);
	if (frameBufferSlot == nullptr) {
		return;
	}
	auto& pixels = frameBufferSlot->cpuReadback;
	ensureFrameBufferPriorityCapacity(static_cast<size_t>(m_fbm.width()) * static_cast<size_t>(m_fbm.height()));
	if (commands.front().type != BlitterCommandType::Clear) {
		fillFrameBuffer(pixels, VDP_BLITTER_IMPLICIT_CLEAR);
	}
	resetFrameBufferPriority();
	for (const auto& command : commands) {
		switch (command.type) {
			case BlitterCommandType::Clear:
				fillFrameBuffer(pixels, command.color);
				resetFrameBufferPriority();
				break;
			case BlitterCommandType::FillRect:
				rasterizeFrameBufferFill(pixels, command.x0, command.y0, command.x1, command.y1, command.color, command.layer, command.priority, command.seq);
				break;
			case BlitterCommandType::DrawLine:
				rasterizeFrameBufferLine(pixels, command.x0, command.y0, command.x1, command.y1, command.thickness, command.color, command.layer, command.priority, command.seq);
				break;
			case BlitterCommandType::Blit:
				rasterizeFrameBufferBlit(pixels, command.source, command.dstX, command.dstY, command.scaleX, command.scaleY, command.flipH, command.flipV, command.color, command.layer, command.priority, command.seq);
				break;
			case BlitterCommandType::CopyRect:
				copyFrameBufferRect(
					pixels,
					command.srcX,
					command.srcY,
					command.width,
					command.height,
					static_cast<i32>(std::round(command.dstX)),
					static_cast<i32>(std::round(command.dstY)),
					command.layer,
					command.priority,
					command.seq
				);
				break;
			case BlitterCommandType::GlyphRun:
				if (command.backgroundColor.has_value()) {
					for (const auto& glyph : command.glyphs) {
						rasterizeFrameBufferFill(
							pixels,
							glyph.dstX,
							glyph.dstY,
							glyph.dstX + static_cast<f32>(glyph.advance),
							glyph.dstY + static_cast<f32>(command.lineHeight),
							*command.backgroundColor,
							command.layer,
							command.priority,
							command.seq
						);
					}
				}
				for (const auto& glyph : command.glyphs) {
					rasterizeFrameBufferBlit(pixels, glyph, glyph.dstX, glyph.dstY, 1.0f, 1.0f, false, false, command.color, command.layer, command.priority, command.seq);
				}
				break;
			case BlitterCommandType::TileRun:
				for (const auto& tile : command.tiles) {
					rasterizeFrameBufferBlit(pixels, tile, tile.dstX, tile.dstY, 1.0f, 1.0f, false, false, VDP_BLITTER_WHITE, command.layer, command.priority, command.seq);
				}
				break;
		}
	}
	markVramSlotDirty(*frameBufferSlot, 0u, frameBufferSlot->surfaceHeight);
	invalidateReadCache(VDP_RD_SURFACE_FRAMEBUFFER);
}

void VDP::ensureFrameBufferPriorityCapacity(size_t pixelCount) {
	if (m_frameBufferPriorityLayer.size() == pixelCount) {
		return;
	}
	m_frameBufferPriorityLayer.resize(pixelCount);
	m_frameBufferPriorityValue.resize(pixelCount);
	m_frameBufferPrioritySeq.resize(pixelCount);
}

void VDP::resetFrameBufferPriority() {
	std::fill(m_frameBufferPriorityLayer.begin(), m_frameBufferPriorityLayer.end(), static_cast<u8>(Layer2D::World));
	std::fill(m_frameBufferPriorityValue.begin(), m_frameBufferPriorityValue.end(), -std::numeric_limits<f32>::infinity());
	std::fill(m_frameBufferPrioritySeq.begin(), m_frameBufferPrioritySeq.end(), 0u);
}

void VDP::fillFrameBuffer(std::vector<u8>& pixels, const FrameBufferColor& color) {
	for (size_t index = 0; index < pixels.size(); index += 4u) {
		pixels[index + 0u] = color.r;
		pixels[index + 1u] = color.g;
		pixels[index + 2u] = color.b;
		pixels[index + 3u] = color.a;
	}
}

void VDP::blendFrameBufferPixel(std::vector<u8>& pixels, size_t index, u8 r, u8 g, u8 b, u8 a, Layer2D layer, f32 priority, u32 seq) {
	if (a == 0u) {
		return;
	}
	const size_t pixelIndex = index >> 2u;
	const auto currentLayer = static_cast<Layer2D>(m_frameBufferPriorityLayer[pixelIndex]);
	if (layer < currentLayer) {
		return;
	}
	if (layer == currentLayer) {
		const f32 currentPriority = m_frameBufferPriorityValue[pixelIndex];
		if (priority < currentPriority) {
			return;
		}
		if (priority == currentPriority && seq < m_frameBufferPrioritySeq[pixelIndex]) {
			return;
		}
	}
	if (a == 255u) {
		pixels[index + 0u] = r;
		pixels[index + 1u] = g;
		pixels[index + 2u] = b;
		pixels[index + 3u] = 255u;
		m_frameBufferPriorityLayer[pixelIndex] = static_cast<u8>(layer);
		m_frameBufferPriorityValue[pixelIndex] = priority;
		m_frameBufferPrioritySeq[pixelIndex] = seq;
		return;
	}
	const u32 inverse = 255u - a;
	pixels[index + 0u] = static_cast<u8>(((static_cast<u32>(r) * a) + (static_cast<u32>(pixels[index + 0u]) * inverse) + 127u) / 255u);
	pixels[index + 1u] = static_cast<u8>(((static_cast<u32>(g) * a) + (static_cast<u32>(pixels[index + 1u]) * inverse) + 127u) / 255u);
	pixels[index + 2u] = static_cast<u8>(((static_cast<u32>(b) * a) + (static_cast<u32>(pixels[index + 2u]) * inverse) + 127u) / 255u);
	pixels[index + 3u] = static_cast<u8>(a + ((static_cast<u32>(pixels[index + 3u]) * inverse) + 127u) / 255u);
	m_frameBufferPriorityLayer[pixelIndex] = static_cast<u8>(layer);
	m_frameBufferPriorityValue[pixelIndex] = priority;
	m_frameBufferPrioritySeq[pixelIndex] = seq;
}

void VDP::rasterizeFrameBufferFill(std::vector<u8>& pixels, f32 x0, f32 y0, f32 x1, f32 y1, const FrameBufferColor& color, Layer2D layer, f32 priority, u32 seq) {
	const i32 frameBufferWidth = static_cast<i32>(m_fbm.width());
	const i32 frameBufferHeight = static_cast<i32>(m_fbm.height());
	i32 left = static_cast<i32>(std::round(x0));
	i32 top = static_cast<i32>(std::round(y0));
	i32 right = static_cast<i32>(std::round(x1));
	i32 bottom = static_cast<i32>(std::round(y1));
	if (right < left) {
		std::swap(left, right);
	}
	if (bottom < top) {
		std::swap(top, bottom);
	}
	left = std::max(0, left);
	top = std::max(0, top);
	right = std::min(frameBufferWidth, right);
	bottom = std::min(frameBufferHeight, bottom);
	for (i32 y = top; y < bottom; ++y) {
		size_t index = (static_cast<size_t>(y) * static_cast<size_t>(frameBufferWidth) + static_cast<size_t>(left)) * 4u;
		for (i32 x = left; x < right; ++x) {
			blendFrameBufferPixel(pixels, index, color.r, color.g, color.b, color.a, layer, priority, seq);
			index += 4u;
		}
	}
}

void VDP::rasterizeFrameBufferLine(std::vector<u8>& pixels, f32 x0, f32 y0, f32 x1, f32 y1, f32 thicknessValue, const FrameBufferColor& color, Layer2D layer, f32 priority, u32 seq) {
	const i32 frameBufferWidth = static_cast<i32>(m_fbm.width());
	const i32 frameBufferHeight = static_cast<i32>(m_fbm.height());
	i32 currentX = static_cast<i32>(std::round(x0));
	i32 currentY = static_cast<i32>(std::round(y0));
	const i32 targetX = static_cast<i32>(std::round(x1));
	const i32 targetY = static_cast<i32>(std::round(y1));
	const i32 dx = std::abs(targetX - currentX);
	const i32 dy = std::abs(targetY - currentY);
	const i32 sx = currentX < targetX ? 1 : -1;
	const i32 sy = currentY < targetY ? 1 : -1;
	i32 err = dx - dy;
	i32 thickness = static_cast<i32>(std::round(thicknessValue));
	if (thickness == 0) {
		thickness = 1;
	}
	while (true) {
		const i32 half = thickness >> 1;
		for (i32 yy = currentY - half; yy < currentY - half + thickness; ++yy) {
			if (yy < 0 || yy >= frameBufferHeight) {
				continue;
			}
			for (i32 xx = currentX - half; xx < currentX - half + thickness; ++xx) {
				if (xx < 0 || xx >= frameBufferWidth) {
					continue;
				}
				const size_t index = (static_cast<size_t>(yy) * static_cast<size_t>(frameBufferWidth) + static_cast<size_t>(xx)) * 4u;
				blendFrameBufferPixel(pixels, index, color.r, color.g, color.b, color.a, layer, priority, seq);
			}
		}
		if (currentX == targetX && currentY == targetY) {
			return;
		}
		const i32 e2 = err << 1;
		if (e2 > -dy) {
			err -= dy;
			currentX += sx;
		}
		if (e2 < dx) {
			err += dx;
			currentY += sy;
		}
	}
}

void VDP::rasterizeFrameBufferBlit(std::vector<u8>& pixels, const BlitterSource& source, f32 dstXValue, f32 dstYValue, f32 scaleX, f32 scaleY, bool flipH, bool flipV, const FrameBufferColor& color, Layer2D layer, f32 priority, u32 seq) {
	const i32 frameBufferWidth = static_cast<i32>(m_fbm.width());
	const i32 frameBufferHeight = static_cast<i32>(m_fbm.height());
	const VdpSurfaceUploadSlot* sourceSlot = findVramSlotOrFault(source.surfaceId, VDP_FAULT_DEX_SOURCE_SLOT);
	if (sourceSlot == nullptr) {
		return;
	}
	const auto& sourcePixels = sourceSlot->cpuReadback;
	const size_t sourceStride = static_cast<size_t>(sourceSlot->surfaceWidth) * 4u;
	i32 dstW = static_cast<i32>(std::round(static_cast<f32>(source.width) * scaleX));
	i32 dstH = static_cast<i32>(std::round(static_cast<f32>(source.height) * scaleY));
	if (dstW == 0) {
		dstW = 1;
	}
	if (dstH == 0) {
		dstH = 1;
	}
	const i32 dstX = static_cast<i32>(std::round(dstXValue));
	const i32 dstY = static_cast<i32>(std::round(dstYValue));
	for (i32 y = 0; y < dstH; ++y) {
		const i32 targetY = dstY + y;
		if (targetY < 0 || targetY >= frameBufferHeight) {
			continue;
		}
		const i32 srcY = flipV
			? static_cast<i32>(source.height) - 1 - ((y * static_cast<i32>(source.height)) / dstH)
			: ((y * static_cast<i32>(source.height)) / dstH);
		for (i32 x = 0; x < dstW; ++x) {
			const i32 targetX = dstX + x;
			if (targetX < 0 || targetX >= frameBufferWidth) {
				continue;
			}
			const i32 srcX = flipH
				? static_cast<i32>(source.width) - 1 - ((x * static_cast<i32>(source.width)) / dstW)
				: ((x * static_cast<i32>(source.width)) / dstW);
			const uint32_t sampleX = source.srcX + static_cast<uint32_t>(srcX);
			const uint32_t sampleY = source.srcY + static_cast<uint32_t>(srcY);
				if (sampleX >= sourceSlot->surfaceWidth || sampleY >= sourceSlot->surfaceHeight) {
				continue;
			}
			const size_t srcIndex = (static_cast<size_t>(sampleY) * sourceStride) + (static_cast<size_t>(sampleX) * 4u);
			const u8 srcA = sourcePixels[srcIndex + 3u];
			if (srcA == 0u) {
				continue;
			}
			const u8 outA = static_cast<u8>((static_cast<u32>(srcA) * static_cast<u32>(color.a) + 127u) / 255u);
			const u8 outR = static_cast<u8>((static_cast<u32>(sourcePixels[srcIndex + 0u]) * static_cast<u32>(color.r) + 127u) / 255u);
			const u8 outG = static_cast<u8>((static_cast<u32>(sourcePixels[srcIndex + 1u]) * static_cast<u32>(color.g) + 127u) / 255u);
			const u8 outB = static_cast<u8>((static_cast<u32>(sourcePixels[srcIndex + 2u]) * static_cast<u32>(color.b) + 127u) / 255u);
			const size_t dstIndex = (static_cast<size_t>(targetY) * static_cast<size_t>(frameBufferWidth) + static_cast<size_t>(targetX)) * 4u;
			blendFrameBufferPixel(pixels, dstIndex, outR, outG, outB, outA, layer, priority, seq);
		}
	}
}

void VDP::copyFrameBufferRect(std::vector<u8>& pixels, i32 srcX, i32 srcY, i32 width, i32 height, i32 dstX, i32 dstY, Layer2D layer, f32 priority, u32 seq) {
	const size_t frameBufferWidth = static_cast<size_t>(m_fbm.width());
	const size_t rowBytes = static_cast<size_t>(width) * 4u;
	const bool overlapping =
		dstX < srcX + width
		&& dstX + width > srcX
		&& dstY < srcY + height
		&& dstY + height > srcY;
	const i32 startRow = overlapping && dstY > srcY ? height - 1 : 0;
	const i32 endRow = overlapping && dstY > srcY ? -1 : height;
	const i32 step = overlapping && dstY > srcY ? -1 : 1;
	for (i32 row = startRow; row != endRow; row += step) {
		const size_t sourceIndex = (static_cast<size_t>(srcY + row) * frameBufferWidth + static_cast<size_t>(srcX)) * 4u;
		const size_t targetIndex = (static_cast<size_t>(dstY + row) * frameBufferWidth + static_cast<size_t>(dstX)) * 4u;
		std::memmove(pixels.data() + targetIndex, pixels.data() + sourceIndex, rowBytes);
		const size_t targetPixel = (static_cast<size_t>(dstY + row) * frameBufferWidth) + static_cast<size_t>(dstX);
		for (i32 col = 0; col < width; ++col) {
			const size_t pixelIndex = targetPixel + static_cast<size_t>(col);
			m_frameBufferPriorityLayer[pixelIndex] = static_cast<u8>(layer);
			m_frameBufferPriorityValue[pixelIndex] = priority;
			m_frameBufferPrioritySeq[pixelIndex] = seq;
		}
	}
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
	resetSubmittedFrameSlot(m_activeFrame);
}

const VdpDeviceOutput& VDP::readDeviceOutput() {
	return m_vout.readDeviceOutput();
}

void VDP::commitActiveVisualState() {
	m_sbx.presentFrame(m_activeFrame.skyboxControl, m_activeFrame.skyboxFaceWords);
	m_vout.presentFrame(m_activeFrame, m_sbx.visibleEnabled());
}

void VDP::finishCommittedFrameOnVblankEdge() {
	commitActiveVisualState();
	m_lastFrameCommitted = true;
	m_lastFrameHeld = false;
	clearActiveFrame();
	promotePendingFrame();
	scheduleNextService(m_scheduler.currentNowCycles());
	refreshSubmitBusyStatus();
}

bool VDP::presentReadyFrameOnVblankEdge() {
	if (!m_activeFrame.occupied) {
		m_lastFrameCommitted = false;
		m_lastFrameCost = 0;
		m_lastFrameHeld = false;
		promotePendingFrame();
		scheduleNextService(m_scheduler.currentNowCycles());
		refreshSubmitBusyStatus();
		return false;
	}
	m_lastFrameCost = m_activeFrame.cost;
	if (!m_activeFrame.ready) {
		m_lastFrameCommitted = false;
		m_lastFrameHeld = true;
		return false;
	}
	if (m_activeFrame.hasFrameBufferCommands) {
		presentFrameBufferPageOnVblankEdge();
		finishCommittedFrameOnVblankEdge();
		return true;
	}
	finishCommittedFrameOnVblankEdge();
	return false;
}
// end hot-path

bool VDP::tryResolveSurfaceIdForSlot(u32 slot, uint32_t& surfaceId, uint32_t faultCode) {
	if (slot == VDP_SLOT_SYSTEM) {
		surfaceId = VDP_RD_SURFACE_SYSTEM;
		return true;
	}
	if (slot == VDP_SLOT_PRIMARY) {
		surfaceId = VDP_RD_SURFACE_PRIMARY;
		return true;
	}
	if (slot == VDP_SLOT_SECONDARY) {
		surfaceId = VDP_RD_SURFACE_SECONDARY;
		return true;
	}
	m_fault.raise(faultCode, slot);
	return false;
}

bool VDP::tryResolveBlitterSourceWordsInto(u32 slot, u32 u, u32 v, u32 w, u32 h, BlitterSource& target, uint32_t faultCode) {
	uint32_t surfaceId = 0u;
	if (!tryResolveSurfaceIdForSlot(slot, surfaceId, faultCode)) {
		return false;
	}
	target.surfaceId = surfaceId;
	target.srcX = u;
	target.srcY = v;
	target.width = w;
	target.height = h;
	return true;
}

const VdpSurfaceUploadSlot* VDP::tryResolveBlitterSurfaceForSource(const BlitterSource& source, uint32_t faultCode, uint32_t zeroSizeFaultCode) {
	if (source.width == 0u || source.height == 0u) {
		m_fault.raise(zeroSizeFaultCode, source.width | (source.height << 16u));
		return nullptr;
	}
	const VdpSurfaceUploadSlot* surface = findRegisteredVramSlotBySurfaceId(source.surfaceId);
	if (surface == nullptr) {
		m_fault.raise(faultCode, source.surfaceId);
		return nullptr;
	}
	const uint64_t sourceRight = static_cast<uint64_t>(source.srcX) + static_cast<uint64_t>(source.width);
	const uint64_t sourceBottom = static_cast<uint64_t>(source.srcY) + static_cast<uint64_t>(source.height);
	if (sourceRight > surface->surfaceWidth || sourceBottom > surface->surfaceHeight) {
		m_fault.raise(faultCode, source.srcX | (source.srcY << 16u));
		return nullptr;
	}
	return surface;
}

void VDP::resolveBbuSourceInto(const VdpBbuPacket& packet, VdpBbuSourceResolution& target) const {
	target.faultCode = VDP_FAULT_NONE;
	target.faultDetail = 0u;
	u32 surfaceId = 0u;
	if (packet.sourceRect.slot == VDP_SLOT_SYSTEM) {
		surfaceId = VDP_RD_SURFACE_SYSTEM;
	} else if (packet.sourceRect.slot == VDP_SLOT_PRIMARY) {
		surfaceId = VDP_RD_SURFACE_PRIMARY;
	} else if (packet.sourceRect.slot == VDP_SLOT_SECONDARY) {
		surfaceId = VDP_RD_SURFACE_SECONDARY;
	} else {
		target.faultCode = VDP_FAULT_BBU_SOURCE_OOB;
		target.faultDetail = packet.sourceRect.slot;
		return;
	}
	target.source.surfaceId = surfaceId;
	target.source.srcX = packet.sourceRect.u;
	target.source.srcY = packet.sourceRect.v;
	target.source.width = packet.sourceRect.w;
	target.source.height = packet.sourceRect.h;
	target.slot = packet.sourceRect.slot;
	if (target.source.width == 0u || target.source.height == 0u) {
		target.faultCode = VDP_FAULT_BBU_ZERO_SIZE;
		target.faultDetail = target.source.width | (target.source.height << 16u);
		return;
	}
	const VdpSurfaceUploadSlot* surface = findRegisteredVramSlotBySurfaceId(surfaceId);
	if (surface == nullptr) {
		target.faultCode = VDP_FAULT_BBU_SOURCE_OOB;
		target.faultDetail = surfaceId;
		return;
	}
	const uint64_t sourceRight = static_cast<uint64_t>(target.source.srcX) + static_cast<uint64_t>(target.source.width);
	const uint64_t sourceBottom = static_cast<uint64_t>(target.source.srcY) + static_cast<uint64_t>(target.source.height);
	if (sourceRight > surface->surfaceWidth || sourceBottom > surface->surfaceHeight) {
		target.faultCode = VDP_FAULT_BBU_SOURCE_OOB;
		target.faultDetail = target.source.srcX | (target.source.srcY << 16u);
		return;
	}
	target.surfaceWidth = surface->surfaceWidth;
	target.surfaceHeight = surface->surfaceHeight;
}

bool VDP::latchBillboardPacket(const VdpBbuPacket& packet) {
	const VdpBbuPacketDecision decision = m_bbu.beginPacket(packet, m_buildFrame.billboards.size());
	if (decision.state != VdpBbuPacketState::SourceResolve) {
		m_fault.raise(decision.faultCode, decision.faultDetail);
		return false;
	}
	VdpBbuSourceResolution resolution;
	resolveBbuSourceInto(packet, resolution);
	const VdpBbuPacketDecision completed = m_bbu.completePacket(
		m_buildFrame.billboards,
		packet,
		resolution,
		resolution.faultCode == VDP_FAULT_NONE ? nextBlitterSequence() : 0u);
	if (completed.faultCode != VDP_FAULT_NONE) {
		m_fault.raise(completed.faultCode, completed.faultDetail);
		return false;
	}
	m_buildFrame.cost += VDP_RENDER_BILLBOARD_COST;
	return true;
}

bool VDP::resolveSkyboxSampleInto(
	u32 slot,
	u32 u,
	u32 v,
	u32 w,
	u32 h,
	ResolvedBlitterSample& target,
	VdpSbxFrameResolution& resolution) const {
	resolution.faultCode = VDP_FAULT_NONE;
	resolution.faultDetail = 0u;
	if (slot == VDP_SLOT_SYSTEM) {
		target.source.surfaceId = VDP_RD_SURFACE_SYSTEM;
	} else if (slot == VDP_SLOT_PRIMARY) {
		target.source.surfaceId = VDP_RD_SURFACE_PRIMARY;
	} else if (slot == VDP_SLOT_SECONDARY) {
		target.source.surfaceId = VDP_RD_SURFACE_SECONDARY;
	} else {
		resolution.faultCode = VDP_FAULT_SBX_SOURCE_OOB;
		resolution.faultDetail = slot;
		return false;
	}
	target.source.srcX = u;
	target.source.srcY = v;
	target.source.width = w;
	target.source.height = h;
	if (w == 0u || h == 0u) {
		resolution.faultCode = VDP_FAULT_SBX_SOURCE_OOB;
		resolution.faultDetail = w | (h << 16u);
		return false;
	}
	const VdpSurfaceUploadSlot* surface = findRegisteredVramSlotBySurfaceId(target.source.surfaceId);
	if (surface == nullptr) {
		resolution.faultCode = VDP_FAULT_SBX_SOURCE_OOB;
		resolution.faultDetail = target.source.surfaceId;
		return false;
	}
	const uint64_t sourceRight = static_cast<uint64_t>(u) + static_cast<uint64_t>(w);
	const uint64_t sourceBottom = static_cast<uint64_t>(v) + static_cast<uint64_t>(h);
	if (sourceRight > surface->surfaceWidth || sourceBottom > surface->surfaceHeight) {
		resolution.faultCode = VDP_FAULT_SBX_SOURCE_OOB;
		resolution.faultDetail = u | (v << 16u);
		return false;
	}
	target.surfaceWidth = surface->surfaceWidth;
	target.surfaceHeight = surface->surfaceHeight;
	target.slot = slot;
	return true;
}

bool VDP::resolveSkyboxFrameSamplesInto(u32 control, const VdpSbxUnit::FaceWords& faceWords, SkyboxSamples& samples, VdpSbxFrameResolution& resolution) {
	resolution.faultCode = VDP_FAULT_NONE;
	resolution.faultDetail = 0u;
	if ((control & VDP_SBX_CONTROL_ENABLE) == 0u) {
		return true;
	}
	for (size_t index = 0; index < SKYBOX_FACE_COUNT; ++index) {
		if (!resolveSkyboxSampleInto(
			readSkyboxFaceSourceWord(faceWords, index, SKYBOX_FACE_SLOT_WORD),
			readSkyboxFaceSourceWord(faceWords, index, SKYBOX_FACE_U_WORD),
			readSkyboxFaceSourceWord(faceWords, index, SKYBOX_FACE_V_WORD),
			readSkyboxFaceSourceWord(faceWords, index, SKYBOX_FACE_W_WORD),
			readSkyboxFaceSourceWord(faceWords, index, SKYBOX_FACE_H_WORD),
			samples[index],
			resolution)) {
			return false;
		}
	}
	return true;
}

bool VDP::resolveSkyboxFrameSamples(u32 control, const VdpSbxUnit::FaceWords& faceWords, SkyboxSamples& samples) {
	VdpSbxFrameResolution resolution;
	if (!resolveSkyboxFrameSamplesInto(control, faceWords, samples, resolution)) {
		m_fault.raise(resolution.faultCode, resolution.faultDetail);
		return false;
	}
	return true;
}

bool VDP::enqueueCopyRect(i32 srcX, i32 srcY, i32 width, i32 height, i32 dstX, i32 dstY, f32 priority, Layer2D layer) {
	const VdpClippedRect clipped = computeClippedRect(dstX, dstY, dstX + width, dstY + height, m_fbm.width(), m_fbm.height());
	if (clipped.area == 0.0) {
		return true;
	}
	BlitterCommand command;
	assignLayeredBlitterCommand(command, BlitterCommandType::CopyRect, blitAreaBucket(clipped.area), layer, priority);
	command.srcX = srcX;
	command.srcY = srcY;
	command.width = width;
	command.height = height;
	command.dstX = static_cast<f32>(dstX);
	command.dstY = static_cast<f32>(dstY);
	return enqueueBlitterCommand(std::move(command));
}

VDP::TileRunClipWindow VDP::clipTileRun(i32 cols, i32 rows, i32 tileW, i32 tileH, i32 originX, i32 originY, i32 scrollX, i32 scrollY) const {
	TileRunClipWindow clip;
	clip.frameWidth = static_cast<i32>(m_fbm.width());
	clip.frameHeight = static_cast<i32>(m_fbm.height());
	const i32 totalWidth = cols * tileW;
	const i32 totalHeight = rows * tileH;
	clip.dstX = originX - scrollX;
	clip.dstY = originY - scrollY;
	i32 writeWidth = totalWidth;
	i32 writeHeight = totalHeight;
	if (clip.dstX < 0) {
		clip.srcClipX = -clip.dstX;
		writeWidth += clip.dstX;
		clip.dstX = 0;
	}
	if (clip.dstY < 0) {
		clip.srcClipY = -clip.dstY;
		writeHeight += clip.dstY;
		clip.dstY = 0;
	}
	const i32 overflowX = (clip.dstX + writeWidth) - clip.frameWidth;
	if (overflowX > 0) {
		writeWidth -= overflowX;
	}
	const i32 overflowY = (clip.dstY + writeHeight) - clip.frameHeight;
	if (overflowY > 0) {
		writeHeight -= overflowY;
	}
	clip.visible = writeWidth > 0 && writeHeight > 0;
	return clip;
}

u32 VDP::readTileRunPayloadWord(const TileRunPayload& payload, u32 wordOffset) const {
	if (payload.source == TileRunPayloadSource::Memory) {
		return m_memory.readU32(payload.memoryBase + wordOffset * IO_WORD_SIZE);
	}
	return payload.words[wordOffset];
}

bool VDP::appendTileRunSource(BlitterCommand& command, const BlitterSource& source, const TileRunClipWindow& clip, i32 tileW, i32 tileH, i32 tileX, i32 tileY, i32 row, int& visibleRowCount, int& visibleNonEmptyTileCount, i32& lastVisibleRow) {
	if (source.width != static_cast<u32>(tileW) || source.height != static_cast<u32>(tileH)) {
		m_fault.raise(VDP_FAULT_DEX_SOURCE_OOB, source.width | (source.height << 16u));
		return false;
	}
	const VdpClippedRect clipped = computeClippedRect(
		static_cast<double>(tileX),
		static_cast<double>(tileY),
		static_cast<double>(tileX + tileW),
		static_cast<double>(tileY + tileH),
		static_cast<double>(clip.frameWidth),
		static_cast<double>(clip.frameHeight)
	);
	if (clipped.area == 0.0) {
		return true;
	}
	visibleNonEmptyTileCount += 1;
	if (lastVisibleRow != row) {
		lastVisibleRow = row;
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
	return true;
}

void VDP::latchPayloadTileRunFrom(const TileRunPayload& payload, uint32_t tileCount, i32 cols, i32 rows, i32 tileW, i32 tileH, i32 originX, i32 originY, i32 scrollX, i32 scrollY, f32 priority, Layer2D layer) {
	if (tileCount != static_cast<uint32_t>(cols * rows)) {
		m_fault.raise(VDP_FAULT_STREAM_BAD_PACKET, tileCount);
		return;
	}
	const TileRunClipWindow clip = clipTileRun(cols, rows, tileW, tileH, originX, originY, scrollX, scrollY);
	if (!clip.visible) {
		return;
	}
	BlitterCommand command;
	command.type = BlitterCommandType::TileRun;
	command.seq = nextBlitterSequence();
	command.tiles = acquireTileBuffer();
	command.priority = priority;
	command.layer = layer;
	int visibleRowCount = 0;
	int visibleNonEmptyTileCount = 0;
	i32 lastVisibleRow = -1;
	for (i32 row = 0; row < rows; row += 1) {
		const i32 base = row * cols;
		for (i32 col = 0; col < cols; col += 1) {
			const u32 payloadOffset = static_cast<u32>(base + col) * 5u;
			const u32 slot = readTileRunPayloadWord(payload, payloadOffset);
			if (slot == VDP_SLOT_NONE) {
				continue;
			}
			BlitterSource source;
			if (!tryResolveBlitterSourceWordsInto(
				slot,
				readTileRunPayloadWord(payload, payloadOffset + 1u),
				readTileRunPayloadWord(payload, payloadOffset + 2u),
				readTileRunPayloadWord(payload, payloadOffset + 3u),
				readTileRunPayloadWord(payload, payloadOffset + 4u),
				source,
				VDP_FAULT_DEX_SOURCE_SLOT)) {
				command.tiles.clear();
				m_tileBufferPool.push_back(std::move(command.tiles));
				return;
			}
			const i32 tileX = clip.dstX + (col * tileW) - clip.srcClipX;
			const i32 tileY = clip.dstY + (row * tileH) - clip.srcClipY;
			if (!appendTileRunSource(command, source, clip, tileW, tileH, tileX, tileY, row, visibleRowCount, visibleNonEmptyTileCount, lastVisibleRow)) {
				command.tiles.clear();
				m_tileBufferPool.push_back(std::move(command.tiles));
				return;
			}
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

void VDP::latchPayloadTileRun(uint32_t payloadBase, uint32_t tileCount, i32 cols, i32 rows, i32 tileW, i32 tileH, i32 originX, i32 originY, i32 scrollX, i32 scrollY, f32 priority, Layer2D layer) {
	const TileRunPayload payload{TileRunPayloadSource::Memory, payloadBase, nullptr};
	latchPayloadTileRunFrom(payload, tileCount, cols, rows, tileW, tileH, originX, originY, scrollX, scrollY, priority, layer);
}

void VDP::latchPayloadTileRunWords(const u32* payloadWords, uint32_t tileCount, i32 cols, i32 rows, i32 tileW, i32 tileH, i32 originX, i32 originY, i32 scrollX, i32 scrollY, f32 priority, Layer2D layer) {
	const TileRunPayload payload{TileRunPayloadSource::WordStream, 0u, payloadWords};
	latchPayloadTileRunFrom(payload, tileCount, cols, rows, tileW, tileH, originX, originY, scrollX, scrollY, priority, layer);
}

void VDP::commitLiveVisualState() {
	m_sbx.presentLiveState();
	m_vout.presentLiveState(m_xf, m_sbx.visibleEnabled());
	resolveSkyboxFrameSamples(m_sbx.visibleControl(), m_sbx.visibleFaceWords(), m_vout.visibleSkyboxSampleBuffer());
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

Value VDP::readVdpStatusThunk(void* context, uint32_t) { return valueNumber(static_cast<double>(static_cast<VDP*>(context)->readVdpStatus())); }

uint32_t VDP::readVdpData() {
	const uint32_t surfaceId = m_memory.readIoU32(IO_VDP_RD_SURFACE);
	const uint32_t x = m_memory.readIoU32(IO_VDP_RD_X);
	const uint32_t y = m_memory.readIoU32(IO_VDP_RD_Y);
	const uint32_t mode = m_memory.readIoU32(IO_VDP_RD_MODE);
	if (mode != VDP_RD_MODE_RGBA8888) {
		m_fault.raise(VDP_FAULT_RD_UNSUPPORTED_MODE, mode);
		return 0u;
	}
	if (surfaceId >= VDP_RD_SURFACE_COUNT) {
		m_fault.raise(VDP_FAULT_RD_SURFACE, surfaceId);
		return 0u;
	}
	const ReadSurface& readSurface = m_readSurfaces[surfaceId];
	if (!readSurface.registered) {
		m_fault.raise(VDP_FAULT_RD_SURFACE, surfaceId);
		return 0u;
	}
	const VdpSurfaceUploadSlot* surface = findVramSlotOrFault(readSurface.surfaceId, VDP_FAULT_RD_SURFACE);
	if (surface == nullptr) {
		return 0u;
	}
	const uint32_t width = surface->surfaceWidth;
	const uint32_t height = surface->surfaceHeight;
	if (x >= width || y >= height) {
		m_fault.raise(VDP_FAULT_RD_OOB, x | (y << 16u));
		return 0u;
	}
	if (m_readBudgetBytes < 4u) {
		m_readOverflow = true;
		return 0u;
	}
	auto& cache = getReadCache(surfaceId, *surface, x, y);
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

Value VDP::readVdpDataThunk(void* context, uint32_t) { return valueNumber(static_cast<double>(static_cast<VDP*>(context)->readVdpData())); }

// end hot-path

void VDP::initializeRegisters() {
	const i32 dither = 0;
	const auto& frameBufferSurface = m_readSurfaces[VDP_RD_SURFACE_FRAMEBUFFER];
	if (frameBufferSurface.registered) {
		const VdpSurfaceUploadSlot* slot = findRegisteredVramSlotBySurfaceId(frameBufferSurface.surfaceId);
		if (slot != nullptr) {
			m_fbm.configure(slot->surfaceWidth, slot->surfaceHeight);
		} else {
			m_fbm.configure(m_configuredFrameBufferSize.width, m_configuredFrameBufferSize.height);
		}
	} else {
		m_fbm.configure(m_configuredFrameBufferSize.width, m_configuredFrameBufferSize.height);
	}
	resetQueuedFrameState();
	resetIngressState();
	resetStatus();
	m_memory.writeIoValue(IO_VDP_RD_SURFACE, valueNumber(static_cast<double>(VDP_RD_SURFACE_SYSTEM)));
	m_memory.writeIoValue(IO_VDP_RD_X, valueNumber(0.0));
	m_memory.writeIoValue(IO_VDP_RD_Y, valueNumber(0.0));
	m_memory.writeIoValue(IO_VDP_RD_MODE, valueNumber(static_cast<double>(VDP_RD_MODE_RGBA8888)));
	m_memory.writeIoValue(IO_VDP_DITHER, valueNumber(static_cast<double>(dither)));
	m_memory.writeIoValue(IO_VDP_SLOT_PRIMARY_ATLAS, valueNumber(static_cast<double>(VDP_SLOT_ATLAS_NONE)));
	m_memory.writeIoValue(IO_VDP_SLOT_SECONDARY_ATLAS, valueNumber(static_cast<double>(VDP_SLOT_ATLAS_NONE)));
	m_memory.writeIoValue(IO_VDP_CMD, valueNumber(0.0));
	resetVdpRegisters();
	m_pmu.reset();
	syncPmuRegisterWindow();
	m_xf.reset();
	m_vout.reset(dither, m_fbm.width(), m_fbm.height());
	m_bbu.reset();
	m_sbx.reset();
	syncSbxRegisterWindow();
	m_lastFrameCommitted = true;
	m_lastFrameCost = 0;
	m_lastFrameHeld = false;
}

void VDP::initializeVramSurfaces() {
	const std::array<VdpVramSurface, VDP_RD_SURFACE_COUNT> surfaces = {{
		{VDP_RD_SURFACE_SYSTEM, VRAM_SYSTEM_SLOT_BASE, VRAM_SYSTEM_SLOT_SIZE, 1u, 1u},
		{VDP_RD_SURFACE_PRIMARY, VRAM_PRIMARY_SLOT_BASE, VRAM_PRIMARY_SLOT_SIZE, 1u, 1u},
		{VDP_RD_SURFACE_SECONDARY, VRAM_SECONDARY_SLOT_BASE, VRAM_SECONDARY_SLOT_SIZE, 1u, 1u},
		{VDP_RD_SURFACE_FRAMEBUFFER, VRAM_FRAMEBUFFER_BASE, VRAM_FRAMEBUFFER_SIZE, m_configuredFrameBufferSize.width, m_configuredFrameBufferSize.height},
	}};
	m_vramSlots.clear();
	m_readSurfaces = {};
	for (auto& cache : m_readCaches) {
		cache.width = 0;
		cache.data.clear();
	}
	resetQueuedFrameState();
	m_fbm.configure(0u, 0u);
	m_vout.configureScanout(0u, 0u);
	m_sbx.reset();
	syncSbxRegisterWindow();
	VramGarbageStream stream{m_vramMachineSeed, m_vramBootSeed, VRAM_GARBAGE_SPACE_SALT, VRAM_STAGING_BASE};
	fillVramGarbageScratch(m_vramStaging.data(), m_vramStaging.size(), stream);
	m_vramSlots.reserve(surfaces.size());
	for (const auto& surface : surfaces) {
		registerVramSlot(surface);
	}
	m_vout.presentLiveState(m_xf, m_sbx.visibleEnabled());
	resolveSkyboxFrameSamples(m_sbx.visibleControl(), m_sbx.visibleFaceWords(), m_vout.visibleSkyboxSampleBuffer());
	m_memory.writeIoValue(IO_VDP_SLOT_PRIMARY_ATLAS, valueNumber(static_cast<double>(VDP_SLOT_ATLAS_NONE)));
	m_memory.writeIoValue(IO_VDP_SLOT_SECONDARY_ATLAS, valueNumber(static_cast<double>(VDP_SLOT_ATLAS_NONE)));
}

uint32_t VDP::trackedUsedVramBytes() const {
	uint32_t usedBytes = 0;
	for (const auto& slot : m_vramSlots) {
		usedBytes += slot.surfaceWidth * slot.surfaceHeight * 4u;
	}
	return usedBytes;
}

uint32_t VDP::trackedTotalVramBytes() const {
	return VRAM_SYSTEM_SLOT_SIZE + VRAM_PRIMARY_SLOT_SIZE + VRAM_SECONDARY_SLOT_SIZE + VRAM_FRAMEBUFFER_SIZE + VRAM_STAGING_SIZE;
}

void VDP::attachImgDecController(ImgDecController& controller) {
	m_imgDecController = &controller;
}

void VDP::captureVisualStateFields(VdpState& state) const {
	state.xf = m_xf.captureState();
	state.vdpRegisterWords = m_vdpRegisters;
	state.skyboxControl = m_sbx.liveControl();
	state.skyboxFaceWords = m_sbx.liveFaceWords();
	state.pmuSelectedBank = m_pmu.selectedBank();
	state.pmuBankWords = m_pmu.captureBankWords();
	state.ditherType = m_vout.liveDitherType();
	state.vdpFaultCode = m_fault.code;
	state.vdpFaultDetail = m_fault.detail;
}

VdpState VDP::captureState() const {
	VdpState state;
	captureVisualStateFields(state);
	return state;
}

void VDP::restoreState(const VdpState& state) {
	m_xf.restoreState(state.xf);
	m_vdpRegisters = state.vdpRegisterWords;
	for (uint32_t index = 0; index < VDP_REGISTER_COUNT; ++index) {
		m_memory.writeIoValue(IO_VDP_REG0 + index * IO_WORD_SIZE, valueNumber(static_cast<double>(m_vdpRegisters[index])));
	}
	m_sbx.restoreLiveState(state.skyboxControl, state.skyboxFaceWords);
	m_memory.writeValue(IO_VDP_DITHER, valueNumber(static_cast<double>(state.ditherType)));
	m_pmu.restoreBankWords(state.pmuSelectedBank, state.pmuBankWords);
	syncPmuRegisterWindow();
	syncSbxRegisterWindow();
	m_fault.restore(0u, state.vdpFaultCode, state.vdpFaultDetail);
	m_fault.setStatusFlag(VDP_STATUS_FAULT, m_fault.code != VDP_FAULT_NONE);
	refreshSubmitBusyStatus();
	commitLiveVisualState();
}

VdpSaveState VDP::captureSaveState() const {
	VdpSaveState state;
	captureVisualStateFields(state);
	state.vramStaging = m_vramStaging;
	state.surfacePixels = captureSurfacePixels();
	state.displayFrameBufferPixels = m_fbm.captureDisplayReadback();
	return state;
}

void VDP::restoreSaveState(const VdpSaveState& state) {
	restoreState(state);
	m_vramStaging = state.vramStaging;
	for (const VdpSurfacePixelsState& surface : state.surfacePixels) {
		restoreSurfacePixels(surface);
	}
	m_fbm.restoreDisplayReadback(state.displayFrameBufferPixels);
	commitLiveVisualState();
}

void VDP::registerVramSlot(const VdpVramSurface& surface) {
	const uint64_t size64 = vramSurfaceByteSize(surface.width, surface.height);
	if (surface.width == 0u || surface.height == 0u || size64 > surface.capacity) {
		m_fault.raise(VDP_FAULT_VRAM_SLOT_DIM, surface.surfaceId);
		return;
	}
	const uint32_t size = static_cast<uint32_t>(size64);
	VramGarbageStream stream{m_vramMachineSeed, m_vramBootSeed, VRAM_GARBAGE_SPACE_SALT, surface.baseAddr};
	fillVramGarbageScratch(m_vramSeedPixel.data(), m_vramSeedPixel.size(), stream);
	VdpSurfaceUploadSlot slot;
	slot.baseAddr = surface.baseAddr;
	slot.capacity = surface.capacity;
	slot.surfaceId = surface.surfaceId;
	slot.surfaceWidth = surface.width;
	slot.surfaceHeight = surface.height;
	slot.cpuReadback.resize(static_cast<size_t>(size));
	slot.dirtySpansByRow.resize(surface.height);
	m_vramSlots.push_back(std::move(slot));
	registerReadSurface(surface.surfaceId);
	auto& slotRef = m_vramSlots.back();
	if (surface.surfaceId == VDP_RD_SURFACE_FRAMEBUFFER) {
		m_fbm.configure(surface.width, surface.height);
		m_vout.configureScanout(surface.width, surface.height);
	}
	if (surface.surfaceId == VDP_RD_SURFACE_SYSTEM) {
		invalidateReadCache(surface.surfaceId);
		return;
	}
	seedVramSlotPixels(slotRef);
}

bool VDP::setVramSlotLogicalDimensions(VdpSurfaceUploadSlot& slot, uint32_t width, uint32_t height, uint32_t faultDetail) {
	const uint64_t size64 = vramSurfaceByteSize(width, height);
	if (width == 0u || height == 0u || size64 > slot.capacity) {
		m_fault.raise(VDP_FAULT_VRAM_SLOT_DIM, faultDetail);
		return false;
	}
	const uint32_t size = static_cast<uint32_t>(size64);
	if (slot.surfaceWidth == width && slot.surfaceHeight == height) {
		return true;
	}
	std::vector<u8> previous;
	if (slot.surfaceId != VDP_RD_SURFACE_SYSTEM) {
		previous.swap(slot.cpuReadback);
	}
	slot.surfaceWidth = width;
	slot.surfaceHeight = height;
	slot.cpuReadback.resize(static_cast<size_t>(size));
	slot.dirtySpansByRow.assign(height, VdpDirtySpan{});
	invalidateReadCache(slot.surfaceId);
	if (slot.surfaceId == VDP_RD_SURFACE_FRAMEBUFFER) {
		m_fbm.configure(width, height);
		m_vout.configureScanout(width, height);
	}
	if (slot.surfaceId == VDP_RD_SURFACE_SYSTEM) {
		slot.dirtyRowStart = 0;
		slot.dirtyRowEnd = 0;
		return true;
	}
	seedVramSlotPixels(slot);
	const size_t copyBytes = previous.size() < slot.cpuReadback.size() ? previous.size() : slot.cpuReadback.size();
	if (copyBytes > 0u) {
		std::memcpy(slot.cpuReadback.data(), previous.data(), copyBytes);
	}
	return true;
}

void VDP::setDecodedVramSurfaceDimensions(uint32_t baseAddr, uint32_t width, uint32_t height) {
	VdpSurfaceUploadSlot* slot = findMappedVramSlot(baseAddr, 1u);
	if (slot == nullptr) {
		m_fault.raise(VDP_FAULT_VRAM_WRITE_UNMAPPED, baseAddr);
		return;
	}
	setVramSlotLogicalDimensions(*slot, width, height, width | (height << 16u));
}

void VDP::configureVramSlotSurface(uint32_t slotId, uint32_t width, uint32_t height) {
	uint32_t surfaceId = 0u;
	if (!tryResolveSurfaceIdForSlot(slotId, surfaceId, VDP_FAULT_VRAM_SLOT_DIM)) {
		return;
	}
	VdpSurfaceUploadSlot* slot = findVramSlotOrFault(surfaceId, VDP_FAULT_VRAM_SLOT_DIM);
	if (slot == nullptr) {
		return;
	}
	setVramSlotLogicalDimensions(*slot, width, height, width | (height << 16u));
}

std::vector<VdpSurfacePixelsState> VDP::captureSurfacePixels() const {
	std::vector<VdpSurfacePixelsState> surfaces;
	surfaces.reserve(m_vramSlots.size());
	for (const VdpSurfaceUploadSlot& slot : m_vramSlots) {
		VdpSurfacePixelsState state;
		state.surfaceId = slot.surfaceId;
		state.surfaceWidth = slot.surfaceWidth;
		state.surfaceHeight = slot.surfaceHeight;
		state.pixels = slot.cpuReadback;
		surfaces.push_back(std::move(state));
	}
	return surfaces;
}

void VDP::restoreSurfacePixels(const VdpSurfacePixelsState& state) {
	VdpSurfaceUploadSlot* slot = findVramSlotOrFault(state.surfaceId, VDP_FAULT_RD_SURFACE);
	if (slot == nullptr) {
		return;
	}
	setVramSlotLogicalDimensions(*slot, state.surfaceWidth, state.surfaceHeight, state.surfaceWidth | (state.surfaceHeight << 16u));
	slot->cpuReadback = state.pixels;
	invalidateReadCache(state.surfaceId);
	markVramSlotDirty(*slot, 0, slot->surfaceHeight);
}

VdpSurfaceUploadSlot* VDP::findMappedVramSlot(uint32_t addr, size_t length) {
	for (auto& slot : m_vramSlots) {
		const uint32_t end = slot.baseAddr + slot.capacity;
		if (addr >= slot.baseAddr && addr + length <= end) {
			return &slot;
		}
	}
	return nullptr;
}

const VdpSurfaceUploadSlot* VDP::findMappedVramSlot(uint32_t addr, size_t length) const {
	for (const auto& slot : m_vramSlots) {
		const uint32_t end = slot.baseAddr + slot.capacity;
		if (addr >= slot.baseAddr && addr + length <= end) {
			return &slot;
		}
	}
	return nullptr;
}

void VDP::markVramSlotDirty(VdpSurfaceUploadSlot& slot, uint32_t startRow, uint32_t rowCount) {
	const uint32_t endRow = startRow + rowCount;
	if (slot.dirtyRowStart >= slot.dirtyRowEnd) {
		slot.dirtyRowStart = startRow;
		slot.dirtyRowEnd = endRow;
	} else if (startRow < slot.dirtyRowStart) {
		slot.dirtyRowStart = startRow;
	}
	if (endRow > slot.dirtyRowEnd) {
		slot.dirtyRowEnd = endRow;
	}
	for (uint32_t row = startRow; row < endRow; ++row) {
		slot.dirtySpansByRow[row].xStart = 0;
		slot.dirtySpansByRow[row].xEnd = slot.surfaceWidth;
	}
}

void VDP::markVramSlotDirtySpan(VdpSurfaceUploadSlot& slot, uint32_t row, uint32_t xStart, uint32_t xEnd) {
	const uint32_t endRow = row + 1u;
	if (slot.dirtyRowStart >= slot.dirtyRowEnd) {
		slot.dirtyRowStart = row;
		slot.dirtyRowEnd = endRow;
	} else {
		if (row < slot.dirtyRowStart) {
			slot.dirtyRowStart = row;
		}
		if (endRow > slot.dirtyRowEnd) {
			slot.dirtyRowEnd = endRow;
		}
	}
	auto& span = slot.dirtySpansByRow[row];
	if (span.xStart >= span.xEnd) {
		span.xStart = xStart;
		span.xEnd = xEnd;
		return;
	}
	if (xStart < span.xStart) {
		span.xStart = xStart;
	}
	if (xEnd > span.xEnd) {
		span.xEnd = xEnd;
	}
}

VdpSurfaceUploadSlot* VDP::findRegisteredVramSlotBySurfaceId(uint32_t surfaceId) {
	for (auto& slot : m_vramSlots) {
		if (slot.surfaceId == surfaceId) {
			return &slot;
		}
	}
	return nullptr;
}

const VdpSurfaceUploadSlot* VDP::findRegisteredVramSlotBySurfaceId(uint32_t surfaceId) const {
	for (const auto& slot : m_vramSlots) {
		if (slot.surfaceId == surfaceId) {
			return &slot;
		}
	}
	return nullptr;
}

VdpSurfaceUploadSlot* VDP::findVramSlotOrFault(uint32_t surfaceId, uint32_t faultCode) {
	VdpSurfaceUploadSlot* slot = findRegisteredVramSlotBySurfaceId(surfaceId);
	if (slot == nullptr) {
		m_fault.raise(faultCode, surfaceId);
	}
	return slot;
}

const VdpSurfaceUploadSlot* VDP::findVramSlotOrFault(uint32_t surfaceId, uint32_t faultCode) const {
	const VdpSurfaceUploadSlot* slot = findRegisteredVramSlotBySurfaceId(surfaceId);
	if (slot == nullptr) {
		m_fault.raise(faultCode, surfaceId);
	}
	return slot;
}

void VDP::seedVramSlotPixels(VdpSurfaceUploadSlot& slot) {
	const size_t rowPixels = static_cast<size_t>(slot.surfaceWidth);
	const size_t maxPixels = m_vramGarbageScratch.size() / 4u;
	slot.cpuReadback.resize(static_cast<size_t>(slot.surfaceWidth) * static_cast<size_t>(slot.surfaceHeight) * 4u);
	VramGarbageStream stream{m_vramMachineSeed, m_vramBootSeed, VRAM_GARBAGE_SPACE_SALT, slot.baseAddr};
	const size_t rowBytes = rowPixels * 4u;
	const uint32_t height = slot.surfaceHeight;
	if (rowBytes <= m_vramGarbageScratch.size()) {
		const size_t rowsPerChunk = std::max<size_t>(1u, m_vramGarbageScratch.size() / rowBytes);
		for (uint32_t y = 0; y < height; ) {
			const size_t rows = std::min<size_t>(rowsPerChunk, height - y);
			const size_t chunkBytes = rowBytes * rows;
			fillVramGarbageScratch(m_vramGarbageScratch.data(), chunkBytes, stream);
			if (slot.surfaceId != VDP_RD_SURFACE_SYSTEM) {
				markVramSlotDirty(slot, y, static_cast<uint32_t>(rows));
			}
			std::memcpy(slot.cpuReadback.data() + static_cast<size_t>(y) * rowBytes, m_vramGarbageScratch.data(), chunkBytes);
			y += static_cast<uint32_t>(rows);
		}
	} else {
		for (uint32_t y = 0; y < height; ++y) {
			for (uint32_t x = 0; x < slot.surfaceWidth; ) {
				const size_t segmentWidth = std::min<size_t>(maxPixels, slot.surfaceWidth - x);
				const size_t segmentBytes = segmentWidth * 4u;
				fillVramGarbageScratch(m_vramGarbageScratch.data(), segmentBytes, stream);
				if (slot.surfaceId != VDP_RD_SURFACE_SYSTEM) {
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

void VDP::registerReadSurface(uint32_t surfaceId) {
	m_readSurfaces[surfaceId].surfaceId = surfaceId;
	m_readSurfaces[surfaceId].registered = true;
	invalidateReadCache(surfaceId);
}

void VDP::clearSurfaceUploadDirty(uint32_t surfaceId) {
	VdpSurfaceUploadSlot* slot = findVramSlotOrFault(surfaceId, VDP_FAULT_RD_SURFACE);
	if (slot == nullptr) {
		return;
	}
	for (uint32_t row = slot->dirtyRowStart; row < slot->dirtyRowEnd; ++row) {
		slot->dirtySpansByRow[row] = VdpDirtySpan{};
	}
	slot->dirtyRowStart = 0;
	slot->dirtyRowEnd = 0;
}

void VDP::drainSurfaceUploads(VdpSurfaceUploadSink& sink) {
	for (const VdpSurfaceUploadSlot& slot : m_vramSlots) {
		m_surfaceUploadOutput.surfaceId = slot.surfaceId;
		m_surfaceUploadOutput.surfaceWidth = slot.surfaceWidth;
		m_surfaceUploadOutput.surfaceHeight = slot.surfaceHeight;
		m_surfaceUploadOutput.cpuReadback = &slot.cpuReadback;
		m_surfaceUploadOutput.dirtyRowStart = slot.dirtyRowStart;
		m_surfaceUploadOutput.dirtyRowEnd = slot.dirtyRowEnd;
		m_surfaceUploadOutput.dirtySpansByRow = &slot.dirtySpansByRow;
		if (sink.consumeVdpSurfaceUpload(m_surfaceUploadOutput)) {
			clearSurfaceUploadDirty(slot.surfaceId);
		}
	}
}

void VDP::invalidateReadCache(uint32_t surfaceId) {
	m_readCaches[surfaceId].width = 0;
}

// start hot-path -- VDP read cache feeds CPU-side MMIO readback one pixel at a time.
VDP::ReadCache& VDP::getReadCache(uint32_t surfaceId, const VdpSurfaceUploadSlot& surface, uint32_t x, uint32_t y) {
	auto& cache = m_readCaches[surfaceId];
	if (cache.width == 0 || cache.y != y || x < cache.x0 || x >= cache.x0 + cache.width) {
		prefetchReadCache(surfaceId, surface, x, y);
	}
	return cache;
}

// start numeric-sanitization-acceptable -- readback chunk width is the minimum of hardware cap, remaining surface span, and per-frame read budget.
void VDP::prefetchReadCache(uint32_t surfaceId, const VdpSurfaceUploadSlot& surface, uint32_t x, uint32_t y) {
	const uint32_t maxPixelsByBudget = m_readBudgetBytes / 4u;
	if (maxPixelsByBudget == 0) {
		m_readOverflow = true;
		m_readCaches[surfaceId].width = 0;
		return;
	}
	const uint32_t chunkW = std::min(VDP_RD_MAX_CHUNK_PIXELS, std::min(surface.surfaceWidth - x, maxPixelsByBudget));
	auto& cache = m_readCaches[surfaceId];
		copySurfacePixels(surface, x, y, chunkW, 1, cache.data);
	cache.x0 = x;
	cache.y = y;
	cache.width = chunkW;
}
// end numeric-sanitization-acceptable

void VDP::copySurfacePixels(const VdpSurfaceUploadSlot& surface, uint32_t x, uint32_t y, uint32_t width, uint32_t height, std::vector<u8>& out) {
	out.resize(static_cast<size_t>(width) * static_cast<size_t>(height) * 4u);
	const uint32_t stride = surface.surfaceWidth * 4u;
	const uint32_t rowBytes = width * 4u;
	for (uint32_t row = 0; row < height; ++row) {
		const size_t srcOffset = static_cast<size_t>(y + row) * static_cast<size_t>(stride) + static_cast<size_t>(x) * 4u;
		const size_t dstOffset = static_cast<size_t>(row) * static_cast<size_t>(rowBytes);
		std::memcpy(out.data() + dstOffset, surface.cpuReadback.data() + srcOffset, rowBytes);
	}
}

bool VDP::readFrameBufferPixels(VdpFrameBufferPage page, uint32_t x, uint32_t y, uint32_t width, uint32_t height, u8* out, size_t outBytes) {
	const std::vector<u8>* source = &m_fbm.displayReadback();
	if (page == VdpFrameBufferPage::Render) {
		source = frameBufferRenderReadback();
		if (source == nullptr) {
			m_fault.raise(VDP_FAULT_RD_SURFACE, VDP_RD_SURFACE_FRAMEBUFFER);
			return false;
		}
	}
	const size_t rowBytes = static_cast<size_t>(width) * 4u;
	const size_t expectedBytes = rowBytes * static_cast<size_t>(height);
	if (outBytes != expectedBytes) {
		m_fault.raise(VDP_FAULT_RD_OOB, static_cast<uint32_t>(outBytes));
		return false;
	}
	const u32 frameBufferWidth = m_fbm.width();
	const u32 frameBufferHeight = m_fbm.height();
	if (width > frameBufferWidth || height > frameBufferHeight || x > frameBufferWidth - width || y > frameBufferHeight - height) {
		m_fault.raise(VDP_FAULT_RD_OOB, x | (y << 16u));
		return false;
	}
	m_fbm.copyReadbackPixelsFrom(*source, x, y, width, height, out);
	return true;
}
// end hot-path

} // namespace bmsx
