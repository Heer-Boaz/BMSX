#include "machine/devices/vdp/vdp.h"
#include "machine/common/word.h"
#include "machine/devices/vdp/fixed_point.h"
#include "machine/devices/vdp/packet.h"
#include "machine/memory/map.h"
#include "machine/devices/imgdec/controller.h"
#include "machine/scheduler/budget.h"
#include <cstring>
#include <string>
#include <utility>

namespace bmsx {
namespace {

constexpr int VDP_SERVICE_BATCH_WORK_UNITS = 128;
constexpr u32 VDP_REPLAY_PACKET_FAULT = 0xffffffffu;
constexpr DeviceStatusRegisters VDP_DEVICE_STATUS_REGISTERS{
	IO_VDP_STATUS,
	IO_VDP_FAULT_CODE,
	IO_VDP_FAULT_DETAIL,
	IO_VDP_FAULT_ACK,
	VDP_STATUS_FAULT,
	VDP_FAULT_NONE,
};

} // namespace

VDP::VDP(
	Memory& memory,
	DeviceScheduler& scheduler,
	VdpFrameBufferSize frameBufferSize,
	VdpEntropySeeds entropySeeds
)
	: m_memory(memory)
	, m_fault(memory, VDP_DEVICE_STATUS_REGISTERS)
	, m_vram(entropySeeds)
	, m_blitterSourcePort(m_fault, m_vram)
	, m_configuredFrameBufferSize(frameBufferSize)
	, m_scheduler(scheduler)
	, m_unitRegisterPort(m_fault, m_xf, m_lpu, m_mfu, m_jtu) {
	m_memory.setVramWriter(this);
	m_memory.mapIoRead(IO_VDP_RD_STATUS, this, &VDP::readVdpStatusThunk);
	m_memory.mapIoRead(IO_VDP_RD_DATA, this, &VDP::readVdpDataThunk);
	m_memory.mapIoWrite(IO_VDP_DITHER, this, &VDP::onDitherWriteThunk);
	m_memory.mapIoWrite(IO_VDP_FIFO, this, &VDP::onFifoWriteThunk);
	m_memory.mapIoWrite(IO_VDP_FIFO_CTRL, this, &VDP::onFifoCtrlWriteThunk);
	m_memory.mapIoWrite(IO_VDP_CMD, this, &VDP::onCommandWriteThunk);
	m_memory.mapIoWrite(IO_VDP_FAULT_ACK, &m_fault, &DeviceStatusLatch::acknowledgeWriteThunk);
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
}

void VDP::resetIngressState() {
	m_streamIngress.reset();
	refreshSubmitBusyStatus();
}

void VDP::resetStatus() {
	m_fault.resetStatus();
	refreshSubmitBusyStatus();
}

void VDP::resetVdpRegisters() {
	uint32_t slotDim = 1u | (1u << 16u);
	if (auto* primary = m_vram.findSurface(VDP_RD_SURFACE_PRIMARY)) {
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
	VdpSurfaceUploadSlot* slot = m_blitterSourcePort.resolveSlotSurface(m_vdpRegisters[VDP_REG_SLOT_INDEX], VDP_FAULT_VRAM_SLOT_DIM);
	if (slot == nullptr) {
		return;
	}
	const uint64_t byteLength = static_cast<uint64_t>(width) * static_cast<uint64_t>(height) * 4u;
	if (byteLength > slot->capacity) {
		m_fault.raise(VDP_FAULT_VRAM_SLOT_DIM, word);
		return;
	}
	resizeVramSlot(*slot, width, height, word);
}

VdpLatchedGeometry VDP::readLatchedGeometry() const {
	VdpLatchedGeometry geometry;
	geometry.x0 = static_cast<i32>(m_vdpRegisters[VDP_REG_GEOM_X0]) >> 16;
	geometry.y0 = static_cast<i32>(m_vdpRegisters[VDP_REG_GEOM_Y0]) >> 16;
	geometry.x1 = static_cast<i32>(m_vdpRegisters[VDP_REG_GEOM_X1]) >> 16;
	geometry.y1 = static_cast<i32>(m_vdpRegisters[VDP_REG_GEOM_Y1]) >> 16;
	return geometry;
}

// start hot-path -- VDP status, command ingress, scheduler service, and VRAM row access run on frame-critical paths.
void VDP::setScanoutTiming(bool vblankActive, int cyclesIntoFrame, int cyclesPerFrame, int vblankStartCycle) {
	m_vout.setScanoutTiming(cyclesIntoFrame, cyclesPerFrame, vblankStartCycle, m_scheduler.currentNowCycles());
	m_fault.setStatusFlag(VDP_STATUS_VBLANK, vblankActive);
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
	m_streamIngress.beginDmaSubmit();
	acceptSubmitAttempt();
}

void VDP::endDmaSubmit() {
	m_streamIngress.endDmaSubmit();
	refreshSubmitBusyStatus();
}

bool VDP::sealDmaTransfer(uint32_t src, size_t byteLength) {
	const bool accepted = consumeSealedVdpStream(src, byteLength);
	endDmaSubmit();
	return accepted;
}

void VDP::writeVdpFifoBytes(const u8* data, size_t length) {
	const u32 overflowDetail = m_streamIngress.writeBytes(data, length);
	if (overflowDetail != 0u) {
		m_fault.raise(VDP_FAULT_STREAM_BAD_PACKET, overflowDetail);
		resetIngressState();
		return;
	}
	refreshSubmitBusyStatus();
}

bool VDP::hasBlockedSubmitPath() const {
	return m_streamIngress.hasOpenDirectFifoIngress() || m_streamIngress.dmaSubmitActive || m_buildFrame.state != VdpDexFrameState::Idle || !canAcceptSubmittedFrame();
}

// disable-next-line single_line_method_pattern -- submit-busy refresh owns the status-bit projection from current VDP ingress state.
void VDP::refreshSubmitBusyStatus() {
	m_fault.setStatusFlag(VDP_STATUS_SUBMIT_BUSY, hasBlockedSubmitPath());
}

void VDP::pushVdpFifoWord(u32 word) {
	const u32 overflowDetail = m_streamIngress.pushWord(word);
	if (overflowDetail != 0u) {
		m_fault.raise(VDP_FAULT_STREAM_BAD_PACKET, overflowDetail);
		resetIngressState();
		return;
	}
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

void VDP::consumeSealedVdpWordStream(const u32* words, u32 wordCount) {
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
		const u32 word = words[cursor];
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
		cursor = consumeReplayPacketFromWords(words, word, cursor, wordCount);
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
	if (m_streamIngress.fifoWordByteCount != 0) {
		m_fault.raise(VDP_FAULT_STREAM_BAD_PACKET, static_cast<uint32_t>(m_streamIngress.fifoWordByteCount));
		resetIngressState();
		return;
	}
	if (m_streamIngress.fifoStreamWordCount == 0u) {
		return;
	}
	consumeSealedVdpWordStream(m_streamIngress.fifoStreamWords.data(), m_streamIngress.fifoStreamWordCount);
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
		case VDP_XF_PACKET_KIND:
		case VDP_LPU_PACKET_KIND:
		case VDP_MFU_PACKET_KIND:
		case VDP_JTU_PACKET_KIND:
			return consumeUnitRegisterPacketFromMemory(word, cursor, end);
		case VDP_MDU_PACKET_KIND: {
			if (!isVdpUnitPacketHeaderValid(word, VDP_MDU_PACKET_PAYLOAD_WORDS)) {
				m_fault.raise(VDP_FAULT_STREAM_BAD_PACKET, word);
				return VDP_REPLAY_PACKET_FAULT;
			}
			const u32 byteCount = VDP_MDU_PACKET_PAYLOAD_WORDS * IO_WORD_SIZE;
			const u32 payloadEnd = cursor + byteCount;
			if (payloadEnd > end) {
				m_fault.raise(VDP_FAULT_STREAM_BAD_PACKET, word);
				return VDP_REPLAY_PACKET_FAULT;
			}
			const u32 reserved = m_memory.readU32(cursor + IO_WORD_SIZE * 9u);
			if (reserved != 0u) {
				m_fault.raise(VDP_FAULT_STREAM_BAD_PACKET, reserved);
				return VDP_REPLAY_PACKET_FAULT;
			}
			return latchMeshPacket(m_mdu.decodePacket(
				m_memory.readU32(cursor),
				m_memory.readU32(cursor + IO_WORD_SIZE),
				m_memory.readU32(cursor + IO_WORD_SIZE * 2u),
				m_memory.readU32(cursor + IO_WORD_SIZE * 3u),
				m_memory.readU32(cursor + IO_WORD_SIZE * 4u),
				m_memory.readU32(cursor + IO_WORD_SIZE * 5u),
				m_memory.readU32(cursor + IO_WORD_SIZE * 6u),
				m_memory.readU32(cursor + IO_WORD_SIZE * 7u),
				m_memory.readU32(cursor + IO_WORD_SIZE * 8u))) ? payloadEnd : VDP_REPLAY_PACKET_FAULT;
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

u32 VDP::consumeUnitRegisterPacketFromMemory(u32 word, u32 cursor, u32 end) {
	if (vdpUnitPacketHasFlags(word)) {
		m_fault.raise(VDP_FAULT_STREAM_BAD_PACKET, word);
		return VDP_REPLAY_PACKET_FAULT;
	}
	const u32 payloadWords = vdpUnitPacketPayloadWords(word);
	if (payloadWords < 2u) {
		m_fault.raise(VDP_FAULT_STREAM_BAD_PACKET, word);
		return VDP_REPLAY_PACKET_FAULT;
	}
	const u32 payloadEnd = cursor + payloadWords * IO_WORD_SIZE;
	if (payloadEnd > end) {
		m_fault.raise(VDP_FAULT_STREAM_BAD_PACKET, word);
		return VDP_REPLAY_PACKET_FAULT;
	}
	const u32 packetKind = word & VDP_PKT_KIND_MASK;
	const u32 firstRegister = m_memory.readU32(cursor);
	const u32 registerCount = payloadWords - 1u;
	if (!m_unitRegisterPort.acceptRange(packetKind, firstRegister, registerCount)) {
		return VDP_REPLAY_PACKET_FAULT;
	}
	for (u32 offset = 0u; offset < registerCount; ++offset) {
		if (!m_unitRegisterPort.writeWord(packetKind, firstRegister + offset, m_memory.readU32(cursor + (offset + 1u) * IO_WORD_SIZE))) {
			return VDP_REPLAY_PACKET_FAULT;
		}
	}
	return payloadEnd;
}

u32 VDP::consumeReplayPacketFromWords(const u32* words, u32 word, u32 cursor, u32 wordCount) {
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
			return writeVdpRegister(reg, words[cursor]) ? cursor + 1u : VDP_REPLAY_PACKET_FAULT;
		}
		case VDP_PKT_REGN: {
			RegnPacket packet;
			if (!decodeRegnPacket(word, packet) || cursor + packet.count > wordCount) {
				m_fault.raise(VDP_FAULT_STREAM_BAD_PACKET, word);
				return VDP_REPLAY_PACKET_FAULT;
			}
			for (uint32_t offset = 0; offset < packet.count; ++offset) {
				if (!writeVdpRegister(packet.firstRegister + offset, words[cursor + offset])) {
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
			if (words[cursor + 10u] != 0u) {
				m_fault.raise(VDP_FAULT_STREAM_BAD_PACKET, words[cursor + 10u]);
				return VDP_REPLAY_PACKET_FAULT;
			}
			return latchBillboardPacket(m_bbu.decodePacket(
				words[cursor],
				words[cursor + 1u],
				words[cursor + 2u],
				words[cursor + 3u],
				words[cursor + 4u],
				words[cursor + 5u],
				words[cursor + 6u],
				words[cursor + 7u],
				words[cursor + 8u],
				words[cursor + 9u])) ? cursor + VDP_BBU_PACKET_PAYLOAD_WORDS : VDP_REPLAY_PACKET_FAULT;
		case VDP_XF_PACKET_KIND:
		case VDP_LPU_PACKET_KIND:
		case VDP_MFU_PACKET_KIND:
		case VDP_JTU_PACKET_KIND:
			return consumeUnitRegisterPacketFromWords(words, word, cursor, wordCount);
		case VDP_MDU_PACKET_KIND:
			if (!isVdpUnitPacketHeaderValid(word, VDP_MDU_PACKET_PAYLOAD_WORDS) || cursor + VDP_MDU_PACKET_PAYLOAD_WORDS > wordCount) {
				m_fault.raise(VDP_FAULT_STREAM_BAD_PACKET, word);
				return VDP_REPLAY_PACKET_FAULT;
			}
			if (words[cursor + 9u] != 0u) {
				m_fault.raise(VDP_FAULT_STREAM_BAD_PACKET, words[cursor + 9u]);
				return VDP_REPLAY_PACKET_FAULT;
			}
			return latchMeshPacket(m_mdu.decodePacket(
				words[cursor],
				words[cursor + 1u],
				words[cursor + 2u],
				words[cursor + 3u],
				words[cursor + 4u],
				words[cursor + 5u],
				words[cursor + 6u],
				words[cursor + 7u],
				words[cursor + 8u])) ? cursor + VDP_MDU_PACKET_PAYLOAD_WORDS : VDP_REPLAY_PACKET_FAULT;
		case VDP_SBX_PACKET_KIND: {
			if (!isVdpUnitPacketHeaderValid(word, VDP_SBX_PACKET_PAYLOAD_WORDS) || cursor + VDP_SBX_PACKET_PAYLOAD_WORDS > wordCount) {
				m_fault.raise(VDP_FAULT_STREAM_BAD_PACKET, word);
				return VDP_REPLAY_PACKET_FAULT;
			}
			VdpSbxUnit::FaceWords& faceWords = m_sbx.beginPacket(words[cursor]);
			for (size_t index = 0; index < SKYBOX_FACE_WORD_COUNT; ++index) {
				faceWords[index] = words[cursor + static_cast<u32>(index + 1u)];
			}
			m_sbx.commitPacket();
			return cursor + VDP_SBX_PACKET_PAYLOAD_WORDS;
		}
		default:
			m_fault.raise(VDP_FAULT_STREAM_BAD_PACKET, word);
			return VDP_REPLAY_PACKET_FAULT;
	}
}

u32 VDP::consumeUnitRegisterPacketFromWords(const u32* words, u32 word, u32 cursor, u32 wordCount) {
	if (vdpUnitPacketHasFlags(word)) {
		m_fault.raise(VDP_FAULT_STREAM_BAD_PACKET, word);
		return VDP_REPLAY_PACKET_FAULT;
	}
	const u32 payloadWords = vdpUnitPacketPayloadWords(word);
	if (payloadWords < 2u || cursor + payloadWords > wordCount) {
		m_fault.raise(VDP_FAULT_STREAM_BAD_PACKET, word);
		return VDP_REPLAY_PACKET_FAULT;
	}
	const u32 packetKind = word & VDP_PKT_KIND_MASK;
	const u32 firstRegister = words[cursor];
	const u32 registerCount = payloadWords - 1u;
	if (!m_unitRegisterPort.acceptRange(packetKind, firstRegister, registerCount)) {
		return VDP_REPLAY_PACKET_FAULT;
	}
	for (u32 offset = 0u; offset < registerCount; ++offset) {
		if (!m_unitRegisterPort.writeWord(packetKind, firstRegister + offset, words[cursor + offset + 1u])) {
			return VDP_REPLAY_PACKET_FAULT;
		}
	}
	return cursor + payloadWords;
}

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
		case VDP_CMD_BATCH_BLIT_BEGIN:
			return enqueueLatchedBatchBlitBegin();
		case VDP_CMD_BATCH_BLIT_ITEM:
			return enqueueLatchedBatchBlitItem();
		default:
			m_fault.raise(VDP_FAULT_CMD_BAD_DOORBELL, command);
			return false;
	}
}

void VDP::onVdpFifoWrite() {
	if (m_streamIngress.dmaSubmitActive || m_buildFrame.state != VdpDexFrameState::Idle || (!m_streamIngress.hasOpenDirectFifoIngress() && !canAcceptSubmittedFrame())) {
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
	if (m_streamIngress.dmaSubmitActive) {
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

void VDP::writeVram(uint32_t addr, const u8* data, size_t length) {
	if (m_vram.writeStaging(addr, data, length)) {
		return;
	}
	VdpSurfaceUploadSlot* mappedSlot = m_vram.findMappedSlot(addr, length);
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
	m_vram.writeSurfaceBytes(slot, offset, data, length);
	m_readback.invalidateSurface(slot.surfaceId);
}

void VDP::readVram(uint32_t addr, u8* out, size_t length) const {
	if (m_vram.readStaging(addr, out, length)) {
		return;
	}
	const VdpSurfaceUploadSlot* mappedSlot = m_vram.findMappedSlot(addr, length);
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
	m_vram.readSurfaceBytes(slot, offset, out, length);
}
// end hot-path

// start hot-path -- frame scheduling and submitted-frame promotion run every visible frame.
void VDP::beginFrame() {
	m_readback.beginFrame();
	scheduleNextService(m_scheduler.currentNowCycles());
}

bool VDP::enqueueLatchedClear() {
	size_t index = 0u;
	if (!reserveBlitterCommand(BlitterCommandType::Clear, VDP_RENDER_CLEAR_COST, index)) {
		return false;
	}
	m_buildFrame.queue->writeClear(index, m_vdpRegisters[VDP_REG_BG_COLOR]);
	return true;
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
	size_t index = 0u;
	if (!reserveBlitterCommand(BlitterCommandType::FillRect, blitAreaBucket(clipped.area) * (color.a < 255u ? VDP_RENDER_ALPHA_COST_MULTIPLIER : 1), index)) {
		return false;
	}
	m_buildFrame.queue->writeGeometryColor(index, layer, priority, geometry.x0, geometry.y0, geometry.x1, geometry.y1, m_vdpRegisters[VDP_REG_DRAW_COLOR]);
	return true;
}

bool VDP::enqueueLatchedDrawLine() {
	const Layer2D layer = static_cast<Layer2D>(m_vdpRegisters[VDP_REG_DRAW_LAYER]);
	const f32 priority = static_cast<f32>(m_vdpRegisters[VDP_REG_DRAW_PRIORITY]);
	const i32 thickness = static_cast<i32>(m_vdpRegisters[VDP_REG_LINE_WIDTH]) >> 16;
	if (thickness <= 0) {
		m_fault.raise(VDP_FAULT_DEX_INVALID_LINE_WIDTH, m_vdpRegisters[VDP_REG_LINE_WIDTH]);
		return false;
	}
	const VdpLatchedGeometry geometry = readLatchedGeometry();
	const double span = computeClippedLineSpan(geometry.x0, geometry.y0, geometry.x1, geometry.y1, m_fbm.width(), m_fbm.height());
	if (span == 0.0) {
		return true;
	}
	const FrameBufferColor color = unpackArgbColor(m_vdpRegisters[VDP_REG_DRAW_COLOR]);
	const int thicknessMultiplier = thickness > 1 ? 2 : 1;
	const int alphaCost = color.a < 255u ? VDP_RENDER_ALPHA_COST_MULTIPLIER : 1;
	size_t index = 0u;
	if (!reserveBlitterCommand(BlitterCommandType::DrawLine, blitSpanBucket(span) * thicknessMultiplier * alphaCost, index)) {
		return false;
	}
	m_buildFrame.queue->writeGeometryColorThickness(index, layer, priority, geometry.x0, geometry.y0, geometry.x1, geometry.y1, m_vdpRegisters[VDP_REG_DRAW_COLOR], thickness);
	return true;
}

bool VDP::enqueueLatchedBlit() {
	VdpLatchedDrawSetup& drawSetup = m_latchedDrawSetupScratch;
	if (!readLatchedDrawSetup(drawSetup)) {
		return false;
	}
	BlitterSource& source = m_latchedSourceScratch;
	if (!readLatchedBlitterSource(source)) {
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
	const f32 dstX = static_cast<f32>(static_cast<i32>(m_vdpRegisters[VDP_REG_DST_X]) >> 16);
	const f32 dstY = static_cast<f32>(static_cast<i32>(m_vdpRegisters[VDP_REG_DST_Y]) >> 16);
	const VdpResolvedBlitPmu resolved = m_pmu.resolveBlit(dstX, dstY, scaleX, scaleY, drawSetup.drawCtrl.pmuBank, drawSetup.drawCtrl.parallaxWeight);
	const double dstWidth = static_cast<double>(source.width) * static_cast<double>(resolved.scaleX);
	const double dstHeight = static_cast<double>(source.height) * static_cast<double>(resolved.scaleY);
	const VdpClippedRect clipped = computeClippedRect(resolved.dstX, resolved.dstY, resolved.dstX + dstWidth, resolved.dstY + dstHeight, m_fbm.width(), m_fbm.height());
	if (clipped.area == 0.0) {
		return true;
	}
	const FrameBufferColor color = unpackArgbColor(m_vdpRegisters[VDP_REG_DRAW_COLOR]);
	size_t index = 0u;
	if (!reserveBlitterCommand(BlitterCommandType::Blit, blitAreaBucket(clipped.area) * (color.a < 255u ? VDP_RENDER_ALPHA_COST_MULTIPLIER : 1), index)) {
		return false;
	}
	m_buildFrame.queue->writeBlit(index, drawSetup.layer, drawSetup.priority, source, static_cast<i32>(resolved.dstX), static_cast<i32>(resolved.dstY), static_cast<i32>(dstWidth), static_cast<i32>(dstHeight), resolved.scaleX, resolved.scaleY, drawSetup.drawCtrl.flipH, drawSetup.drawCtrl.flipV, m_vdpRegisters[VDP_REG_DRAW_COLOR], drawSetup.drawCtrl.parallaxWeight);
	return true;
}

bool VDP::readLatchedDrawSetup(VdpLatchedDrawSetup& target) {
	target.layer = static_cast<Layer2D>(m_vdpRegisters[VDP_REG_DRAW_LAYER]);
	target.priority = static_cast<f32>(m_vdpRegisters[VDP_REG_DRAW_PRIORITY]);
	target.drawCtrl = decodeVdpDrawCtrl(m_vdpRegisters[VDP_REG_DRAW_CTRL]);
	if (target.drawCtrl.blendMode != 0u) {
		m_fault.raise(VDP_FAULT_DEX_UNSUPPORTED_DRAW_CTRL, m_vdpRegisters[VDP_REG_DRAW_CTRL]);
		return false;
	}
	return true;
}

bool VDP::readLatchedBlitterSource(BlitterSource& target) {
	const u32 slot = m_vdpRegisters[VDP_REG_SRC_SLOT];
	const u32 u = packedLow16(m_vdpRegisters[VDP_REG_SRC_UV]);
	const u32 v = packedHigh16(m_vdpRegisters[VDP_REG_SRC_UV]);
	const u32 w = packedLow16(m_vdpRegisters[VDP_REG_SRC_WH]);
	const u32 h = packedHigh16(m_vdpRegisters[VDP_REG_SRC_WH]);
	if (!m_blitterSourcePort.resolveWordsInto(slot, u, v, w, h, target, VDP_FAULT_DEX_SOURCE_SLOT)) {
		return false;
	}
	return m_blitterSourcePort.validateSurface(target, VDP_FAULT_DEX_SOURCE_OOB, VDP_FAULT_DEX_SOURCE_OOB);
}

u32 VDP::nextBlitterSequence() {
	return m_blitterSequence++;
}

bool VDP::reserveBlitterCommand(BlitterCommandType opcode, int renderCost, size_t& index) {
	if (m_buildFrame.state == VdpDexFrameState::Idle) {
		m_fault.raise(VDP_FAULT_SUBMIT_STATE, static_cast<uint32_t>(opcode));
		return false;
	}
	if (!m_buildFrame.queue->reserve(opcode, m_blitterSequence, renderCost, index)) {
		m_fault.raise(VDP_FAULT_DEX_OVERFLOW, static_cast<uint32_t>(m_buildFrame.queue->length));
		return false;
	}
	m_blitterSequence += 1u;
	m_buildFrame.cost += renderCost;
	return true;
}

void VDP::resetQueuedFrameState() {
	resetBuildingFrame(m_buildFrame);
	clearActiveFrame();
	resetSubmittedFrameSlot(m_pendingFrame);
}

void VDP::presentFrameBufferPageOnVblankEdge() {
	VdpSurfaceUploadSlot* slot = findVramSlotOrFault(VDP_RD_SURFACE_FRAMEBUFFER, VDP_FAULT_RD_SURFACE);
	if (slot == nullptr) {
		return;
	}
	if (!m_activeFrame.frameBufferReadbackValid) {
		m_fbm.presentTexturePage();
		return;
	}
	m_fbm.presentPage(*slot);
	m_vram.clearSurfaceUploadDirty(VDP_RD_SURFACE_FRAMEBUFFER);
	m_readback.invalidateSurface(VDP_RD_SURFACE_FRAMEBUFFER);
}

void VDP::drainFrameBufferPresentation(VdpFrameBufferPresentationSink& sink) {
	if (!m_fbm.hasPendingPresentation()) {
		return;
	}
	const VdpSurfaceUploadSlot* slot = findVramSlotOrFault(VDP_RD_SURFACE_FRAMEBUFFER, VDP_FAULT_RD_SURFACE);
	if (slot == nullptr) {
		m_fault.raise(VDP_FAULT_RD_SURFACE, VDP_RD_SURFACE_FRAMEBUFFER);
		return;
	}
	m_fbm.drainPresentation(sink, slot->cpuReadback);
}

void VDP::syncFrameBufferPresentation(VdpFrameBufferPresentationSink& sink) {
	VdpSurfaceUploadSlot* slot = findVramSlotOrFault(VDP_RD_SURFACE_FRAMEBUFFER, VDP_FAULT_RD_SURFACE);
	if (slot == nullptr) {
		return;
	}
	m_fbm.syncPresentation(sink, slot->cpuReadback);
	m_vram.clearSurfaceUploadDirty(VDP_RD_SURFACE_FRAMEBUFFER);
}

bool VDP::beginSubmittedFrame(VdpDexFrameState state) {
	if (m_buildFrame.state != VdpDexFrameState::Idle) {
		m_fault.raise(VDP_FAULT_SUBMIT_STATE, VDP_CMD_BEGIN_FRAME);
		return false;
	}
	resetBuildingFrame(m_buildFrame);
	m_blitterSequence = 0u;
	m_buildFrame.state = state;
	return true;
}

void VDP::cancelSubmittedFrame() {
	resetBuildingFrame(m_buildFrame);
	scheduleNextService(m_scheduler.currentNowCycles());
	refreshSubmitBusyStatus();
}

bool VDP::sealSubmittedFrame() {
	if (m_buildFrame.state == VdpDexFrameState::Idle) {
		m_fault.raise(VDP_FAULT_SUBMIT_STATE, VDP_CMD_END_FRAME);
		return false;
	}
	const bool activeFrameEmpty = m_activeFrame.state == VdpSubmittedFrameState::Empty;
	VdpSubmittedFrame* frame = &m_activeFrame;
	if (!activeFrameEmpty) {
		if (m_pendingFrame.state != VdpSubmittedFrameState::Empty) {
			m_fault.raise(VDP_FAULT_SUBMIT_BUSY, VDP_CMD_END_FRAME);
			return false;
		}
		frame = &m_pendingFrame;
	}
	const bool frameHasFrameBufferCommands = m_buildFrame.queue->length != 0u;
	const bool frameHasCommands = frameHasFrameBufferCommands || m_buildFrame.billboards->length != 0u || m_buildFrame.meshes->length != 0u;
	const int frameCost = (m_buildFrame.queue->length != 0u && m_buildFrame.queue->opcode[0] != BlitterCommandType::Clear)
		? (m_buildFrame.cost + VDP_RENDER_CLEAR_COST)
		: m_buildFrame.cost;
	const VdpSbxFrameDecision sbxDecision = m_sbx.beginFrameSeal();
	const VdpSbxUnit::FaceWords& sbxSealFaceWords = m_sbx.sealFaceWords();
	VdpSbxFrameResolution sbxResolution;
	m_sbx.resolveFrameSamplesInto(m_vram, sbxDecision.control, sbxSealFaceWords, m_sbxSealSamples, sbxResolution);
	const VdpSbxFrameDecision completedSbx = m_sbx.completeFrameSeal(sbxResolution);
	if (completedSbx.faultCode != VDP_FAULT_NONE) {
		m_fault.raise(completedSbx.faultCode, completedSbx.faultDetail);
		return false;
	}
	frame->xf.matrixWords = m_xf.matrixWords;
	frame->xf.viewMatrixIndex = m_xf.viewMatrixIndex;
	frame->xf.projectionMatrixIndex = m_xf.projectionMatrixIndex;
	frame->lightRegisterWords = m_lpu.registerWords;
	frame->morphWeightWords = m_mfu.weightWords;
	frame->jointMatrixWords = m_jtu.matrixWords;
	frame->skyboxControl = completedSbx.control;
	frame->skyboxFaceWords = sbxSealFaceWords;
	std::swap(frame->skyboxSamples, m_sbxSealSamples);
	frame->queue.swap(m_buildFrame.queue);
	frame->billboards.swap(m_buildFrame.billboards);
	frame->meshes.swap(m_buildFrame.meshes);
	if (frameCost == 0) {
		frame->state = VdpSubmittedFrameState::Ready;
	} else if (activeFrameEmpty) {
		frame->state = VdpSubmittedFrameState::Executing;
	} else {
		frame->state = VdpSubmittedFrameState::Queued;
	}
	frame->hasCommands = frameHasCommands;
	frame->hasFrameBufferCommands = frameHasFrameBufferCommands;
	frame->frameBufferReadbackValid = false;
	frame->cost = frameCost;
	frame->workRemaining = frameCost;
	const VdpVoutFrameOutput& voutFrame = m_vout.sealFrame();
	frame->ditherType = voutFrame.ditherType;
	frame->frameBufferWidth = voutFrame.frameBufferWidth;
	frame->frameBufferHeight = voutFrame.frameBufferHeight;
	resetBuildingFrame(m_buildFrame);
	scheduleNextService(m_scheduler.currentNowCycles());
	refreshSubmitBusyStatus();
	return true;
}

void VDP::promotePendingFrame() {
	if (m_activeFrame.state != VdpSubmittedFrameState::Empty || m_pendingFrame.state == VdpSubmittedFrameState::Empty) {
		return;
	}
	std::swap(m_activeFrame, m_pendingFrame);
	if (m_activeFrame.state == VdpSubmittedFrameState::Queued) {
		m_activeFrame.state = VdpSubmittedFrameState::Executing;
	}
	resetSubmittedFrameSlot(m_pendingFrame);
	scheduleNextService(m_scheduler.currentNowCycles());
	refreshSubmitBusyStatus();
}

void VDP::advanceWork(int workUnits) {
	if (m_activeFrame.state == VdpSubmittedFrameState::Empty) {
		promotePendingFrame();
	}
	if (m_activeFrame.state != VdpSubmittedFrameState::Executing || workUnits <= 0) {
		return;
	}
	if (workUnits >= m_activeFrame.workRemaining) {
		m_activeFrame.workRemaining = 0;
		if (m_activeFrame.hasFrameBufferCommands) {
			m_activeFrame.state = VdpSubmittedFrameState::ExecutionPending;
		} else {
			m_activeFrame.queue->reset();
			m_activeFrame.state = VdpSubmittedFrameState::Ready;
		}
		refreshSubmitBusyStatus();
		scheduleNextService(m_scheduler.currentNowCycles());
		return;
	}
	m_activeFrame.workRemaining -= workUnits;
}

int VDP::getPendingRenderWorkUnits() const {
	if (m_activeFrame.state == VdpSubmittedFrameState::Empty) {
		return m_pendingFrame.cost;
	}
	return (m_activeFrame.state == VdpSubmittedFrameState::Ready || m_activeFrame.state == VdpSubmittedFrameState::ExecutionPending) ? 0 : m_activeFrame.workRemaining;
}

VdpBlitterCommandBuffer* VDP::readyFrameBufferCommands() {
	if (m_activeFrame.state != VdpSubmittedFrameState::ExecutionPending) {
		return nullptr;
	}
	return m_activeFrame.queue.get();
}

VdpSurfaceUploadSlot* VDP::resolveFrameBufferExecutionSource(uint32_t surfaceId) {
	VdpSurfaceUploadSlot* slot = m_vram.findSurface(surfaceId);
	if (slot == nullptr) {
		m_fault.raise(VDP_FAULT_DEX_SOURCE_SLOT, surfaceId);
	}
	return slot;
}

VdpSurfaceUploadSlot& VDP::frameBufferExecutionTarget() {
	VdpSurfaceUploadSlot* slot = m_vram.findSurface(VDP_RD_SURFACE_FRAMEBUFFER);
	if (slot == nullptr) {
		throw BMSX_RUNTIME_ERROR("[VDP] framebuffer execution target has no backing VRAM slot.");
	}
	return *slot;
}

void VDP::completeReadyFrameBufferExecution(VdpSurfaceUploadSlot* frameBufferSlot) {
	if (m_activeFrame.state != VdpSubmittedFrameState::ExecutionPending) {
		throw BMSX_RUNTIME_ERROR("VDP framebuffer execution completed without an execution-pending frame.");
	}
	if (frameBufferSlot != nullptr) {
		m_vram.markSlotDirty(*frameBufferSlot, 0u, frameBufferSlot->surfaceHeight);
		m_readback.invalidateSurface(VDP_RD_SURFACE_FRAMEBUFFER);
	}
	m_activeFrame.frameBufferReadbackValid = frameBufferSlot != nullptr;
	m_activeFrame.queue->reset();
	m_activeFrame.state = VdpSubmittedFrameState::Ready;
	refreshSubmitBusyStatus();
	scheduleNextService(m_scheduler.currentNowCycles());
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
	m_activeFrame.queue->reset();
	resetSubmittedFrameSlot(m_activeFrame);
}

const VdpDeviceOutput& VDP::readDeviceOutput() {
	return m_vout.readDeviceOutput(m_scheduler.currentNowCycles());
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
	if (m_activeFrame.state == VdpSubmittedFrameState::Empty) {
		m_lastFrameCommitted = false;
		m_lastFrameCost = 0;
		m_lastFrameHeld = false;
		promotePendingFrame();
		scheduleNextService(m_scheduler.currentNowCycles());
		refreshSubmitBusyStatus();
		return false;
	}
	m_lastFrameCost = m_activeFrame.cost;
	if (m_activeFrame.state != VdpSubmittedFrameState::Ready) {
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

bool VDP::latchBillboardPacket(const VdpBbuPacket& packet) {
	const VdpBbuPacketDecision decision = m_bbu.beginPacket(packet, m_buildFrame.billboards->length);
	if (decision.faultCode != VDP_FAULT_NONE) {
		m_fault.raise(decision.faultCode, decision.faultDetail);
		return false;
	}
	VdpBbuSourceResolution resolution;
	m_bbu.resolveSourceInto(m_vram, packet, resolution);
	const VdpBbuPacketDecision completed = m_bbu.completePacket(
		*m_buildFrame.billboards,
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

bool VDP::latchMeshPacket(const VdpMduPacket& packet) {
	const VdpMduPacketDecision decision = m_mdu.beginPacket(packet, m_buildFrame.meshes->length);
	if (decision.faultCode != VDP_FAULT_NONE) {
		m_fault.raise(decision.faultCode, decision.faultDetail);
		return false;
	}
	m_mdu.completePacket(*m_buildFrame.meshes, packet, nextBlitterSequence());
	return true;
}

void VDP::commitLiveVisualState() {
	m_sbx.presentLiveState();
	m_vout.presentLiveState(m_xf, m_sbx.visibleEnabled(), m_lpu, m_mfu, m_jtu);
	VdpSbxFrameResolution resolution;
	if (!m_sbx.resolveFrameSamplesInto(m_vram, m_sbx.visibleControl(), m_sbx.visibleFaceWords(), m_vout.visibleSkyboxSampleBuffer(), resolution)) {
		m_fault.raise(resolution.faultCode, resolution.faultDetail);
	}
}

// start hot-path -- VDP readback registers are polled by the emulated CPU.
Value VDP::readVdpStatusThunk(void* context, uint32_t) { return valueNumber(static_cast<double>(static_cast<VDP*>(context)->m_readback.status())); }

uint32_t VDP::readVdpData() {
	const uint32_t surfaceId = m_memory.readIoU32(IO_VDP_RD_SURFACE);
	const uint32_t x = m_memory.readIoU32(IO_VDP_RD_X);
	const uint32_t y = m_memory.readIoU32(IO_VDP_RD_Y);
	const uint32_t mode = m_memory.readIoU32(IO_VDP_RD_MODE);
	if (!m_readback.resolveSurface(surfaceId, mode)) {
		m_fault.raise(m_readback.faultCode, m_readback.faultDetail);
		return 0u;
	}
	const VdpSurfaceUploadSlot* surface = m_vram.findSurface(m_readback.resolvedSurfaceId);
	if (surface == nullptr) {
		throw BMSX_RUNTIME_ERROR("[VDP] registered readback surface has no backing VRAM slot.");
	}
	if (!m_readback.readPixel(*surface, x, y)) {
		m_fault.raise(m_readback.faultCode, m_readback.faultDetail);
		return 0u;
	}
	if (m_readback.advanceReadPosition) {
		m_memory.writeValue(IO_VDP_RD_X, valueNumber(static_cast<double>(m_readback.nextX)));
		m_memory.writeValue(IO_VDP_RD_Y, valueNumber(static_cast<double>(m_readback.nextY)));
	}
	return m_readback.word;
}

Value VDP::readVdpDataThunk(void* context, uint32_t) { return valueNumber(static_cast<double>(static_cast<VDP*>(context)->readVdpData())); }

// end hot-path

void VDP::initializeRegisters() {
	const i32 dither = 0;
	const VdpSurfaceUploadSlot* frameBufferSlot = m_vram.findSurface(VDP_RD_SURFACE_FRAMEBUFFER);
	if (frameBufferSlot != nullptr) {
		m_fbm.configure(frameBufferSlot->surfaceWidth, frameBufferSlot->surfaceHeight);
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
	m_lpu.reset();
	m_mfu.reset();
	m_jtu.reset();
	m_vout.reset(dither, m_fbm.width(), m_fbm.height());
	m_bbu.reset();
	m_mdu.reset();
	m_sbx.reset();
	syncSbxRegisterWindow();
	m_lastFrameCommitted = true;
	m_lastFrameCost = 0;
	m_lastFrameHeld = false;
}

void VDP::initializeVramSurfaces() {
	resetQueuedFrameState();
	m_vram.initializeSurfaces(defaultVdpVramSurfaces(m_configuredFrameBufferSize));
	bindVramSurfaces(true);
	m_memory.writeIoValue(IO_VDP_SLOT_PRIMARY_ATLAS, valueNumber(static_cast<double>(VDP_SLOT_ATLAS_NONE)));
	m_memory.writeIoValue(IO_VDP_SLOT_SECONDARY_ATLAS, valueNumber(static_cast<double>(VDP_SLOT_ATLAS_NONE)));
}

uint32_t VDP::trackedUsedVramBytes() const {
	return m_vram.trackedUsedBytes();
}

uint32_t VDP::trackedTotalVramBytes() const {
	return m_vram.trackedTotalBytes();
}

void VDP::attachImgDecController(ImgDecController& controller) {
	m_imgDecController = &controller;
}

void VDP::setDecodedVramSurfaceDimensions(uint32_t baseAddr, uint32_t width, uint32_t height) {
	VdpSurfaceUploadSlot* slot = m_vram.findMappedSlot(baseAddr, 1u);
	if (slot == nullptr) {
		m_fault.raise(VDP_FAULT_VRAM_WRITE_UNMAPPED, baseAddr);
		return;
	}
	resizeVramSlot(*slot, width, height, width | (height << 16u));
}

void VDP::configureVramSlotSurface(uint32_t slotId, uint32_t width, uint32_t height) {
	VdpSurfaceUploadSlot* slot = m_blitterSourcePort.resolveSlotSurface(slotId, VDP_FAULT_VRAM_SLOT_DIM);
	if (slot == nullptr) {
		return;
	}
	resizeVramSlot(*slot, width, height, width | (height << 16u));
}

VdpSurfaceUploadSlot* VDP::findVramSlotOrFault(uint32_t surfaceId, uint32_t faultCode) {
	VdpSurfaceUploadSlot* slot = m_vram.findSurface(surfaceId);
	if (slot == nullptr) {
		m_fault.raise(faultCode, surfaceId);
	}
	return slot;
}

const VdpSurfaceUploadSlot* VDP::findVramSlotOrFault(uint32_t surfaceId, uint32_t faultCode) const {
	const VdpSurfaceUploadSlot* slot = m_vram.findSurface(surfaceId);
	if (slot == nullptr) {
		m_fault.raise(faultCode, surfaceId);
	}
	return slot;
}

void VDP::bindVramSurfaces(bool resetSkybox) {
	m_readback.resetSurfaceRegistry();
	m_fbm.configure(0u, 0u);
	m_vout.configureScanout(0u, 0u);
	for (const VdpSurfaceUploadSlot& slot : m_vram.slots()) {
		m_readback.registerSurface(slot.surfaceId);
		if (slot.surfaceId == VDP_RD_SURFACE_FRAMEBUFFER) {
			m_fbm.configure(slot.surfaceWidth, slot.surfaceHeight);
			m_vout.configureScanout(slot.surfaceWidth, slot.surfaceHeight);
		}
	}
	if (resetSkybox) {
		m_sbx.reset();
		syncSbxRegisterWindow();
	}
	commitLiveVisualState();
}

bool VDP::resizeVramSlot(VdpSurfaceUploadSlot& slot, uint32_t width, uint32_t height, uint32_t faultDetail) {
	if (!m_vram.setSlotLogicalDimensions(slot, width, height)) {
		m_fault.raise(VDP_FAULT_VRAM_SLOT_DIM, faultDetail);
		return false;
	}
	m_readback.invalidateSurface(slot.surfaceId);
	if (slot.surfaceId == VDP_RD_SURFACE_FRAMEBUFFER) {
		m_fbm.configure(width, height);
		m_vout.configureScanout(width, height);
	}
	return true;
}

// disable-next-line single_line_method_pattern -- VDP exposes the host surface-upload boundary; VRAM owns the retained upload payload and dirty spans.
void VDP::drainSurfaceUploads(VdpSurfaceUploadSink& sink) {
	m_vram.drainSurfaceUploads(sink);
}

// disable-next-line single_line_method_pattern -- VDP exposes the host surface-upload boundary; VRAM owns the retained upload payload and dirty spans.
void VDP::syncSurfaceUploads(VdpSurfaceUploadSink& sink) {
	m_vram.syncSurfaceUploads(sink);
}

bool VDP::readFrameBufferPixels(VdpFrameBufferPage page, uint32_t x, uint32_t y, uint32_t width, uint32_t height, u8* out, size_t outBytes) {
	const std::vector<u8>* source = &m_fbm.displayReadback();
	if (page == VdpFrameBufferPage::Render) {
		const VdpSurfaceUploadSlot* slot = findVramSlotOrFault(VDP_RD_SURFACE_FRAMEBUFFER, VDP_FAULT_RD_SURFACE);
		if (slot == nullptr) {
			m_fault.raise(VDP_FAULT_RD_SURFACE, VDP_RD_SURFACE_FRAMEBUFFER);
			return false;
		}
		source = &slot->cpuReadback;
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

bool VDP::enqueueLatchedBatchBlitBegin() {
	size_t index = 0;
	if (!reserveBlitterCommand(BlitterCommandType::BatchBlit, VDP_RENDER_BATCH_BLIT_SETUP_COST, index)) {
		return false;
	}
	VdpLatchedDrawSetup& drawSetup = m_latchedDrawSetupScratch;
	if (!readLatchedDrawSetup(drawSetup)) {
		return false;
	}
	const u32 color = m_vdpRegisters[VDP_REG_DRAW_COLOR];
	m_buildFrame.queue->writeBatchBlitBegin(index, color, drawSetup.drawCtrl.blendMode, drawSetup.layer, drawSetup.priority, drawSetup.drawCtrl.pmuBank, drawSetup.drawCtrl.parallaxWeight);
	m_activeBatchBlitIndex = static_cast<int>(index);
	return true;
}

bool VDP::enqueueLatchedBatchBlitItem() {
	if (m_activeBatchBlitIndex < 0) {
		m_fault.raise(VDP_FAULT_DEX_CMD_NO_BATCH, 0);
		return false;
	}
	const i32 dstX = static_cast<i32>(m_vdpRegisters[VDP_REG_DST_X]) >> 16;
	const i32 dstY = static_cast<i32>(m_vdpRegisters[VDP_REG_DST_Y]) >> 16;
	const u32 advanceX = static_cast<u32>(static_cast<i32>(m_vdpRegisters[VDP_REG_GEOM_X0]) >> 16);

	BlitterSource& source = m_latchedSourceScratch;
	if (!readLatchedBlitterSource(source)) {
		return false;
	}
	if (!m_buildFrame.queue->writeBatchBlitItem(static_cast<size_t>(m_activeBatchBlitIndex), source.surfaceId, source.srcX, source.srcY, source.width, source.height, dstX, dstY, advanceX)) {
		m_fault.raise(VDP_FAULT_BLITTER_OOM_BATCH, 0);
		return false;
	}
	const size_t batchIndex = static_cast<size_t>(m_activeBatchBlitIndex);
	const int alphaCost = ((m_buildFrame.queue->color[batchIndex] >> 24u) < 255u) ? VDP_RENDER_ALPHA_COST_MULTIPLIER : 1;
	const u32 itemCount = m_buildFrame.queue->batchBlitItemCount[batchIndex];
	if ((itemCount - 1u) % static_cast<u32>(VDP_RENDER_BATCH_BLIT_ITEM_DENSITY_DIVISOR) == 0u) {
		m_buildFrame.cost += alphaCost;
	}
	return true;
}
} // namespace bmsx
