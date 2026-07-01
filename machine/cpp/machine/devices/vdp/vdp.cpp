#include "machine/devices/vdp/vdp.h"
#include "machine/common/word.h"
#include "common/fixed_point.h"
#include "machine/devices/vdp/packet.h"
#include "machine/memory/map.h"
#include "machine/scheduler/budget.h"
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
	, m_slotSurfacePort(m_fault, m_vram)
	, m_rpu(m_memory, m_fault)
	, m_configuredFrameBufferSize(frameBufferSize)
	, m_scheduler(scheduler)
	, m_unitRegisterPort(m_fault, m_xf, m_lpu, m_mfu, m_jtu) {
	bindStagingMemory();
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
}

void VDP::resetIngressState() {
	m_streamIngress.reset();
	refreshSubmitBusyStatus();
}

void VDP::resetStatus() {
	m_fault.resetStatus();
	refreshSubmitBusyStatus();
}

void VDP::writeModeWord(uint32_t word) {
	switch (word) {
	case VDP_MODE_MSX1_WORD:
		applyVdpModeProfile(VDP_MODE_MSX1_PROFILE);
		break;
	case VDP_MODE_MSX2_WORD:
		applyVdpModeProfile(VDP_MODE_MSX2_PROFILE);
		break;
	case VDP_MODE_PSX_WORD:
		applyVdpModeProfile(VDP_MODE_PSX_PROFILE);
		break;
	default:
		m_fault.raise(VDP_FAULT_MODE_UNSUPPORTED, word);
		m_memory.writeIoValue(IO_VDP_MODE, valueNumber(static_cast<double>(m_vdpModeWord)));
	}
}

void VDP::applyVdpModeProfile(const MachineVdpModeProfile& profile) {
	m_vdpModeWord = static_cast<u32>(profile.mode);
	const u32 screenWh = packLowHigh16(static_cast<u32>(profile.renderWidth), static_cast<u32>(profile.renderHeight));
	m_memory.writeIoValue(IO_VDP_MODE, valueNumber(static_cast<double>(m_vdpModeWord)));
	m_memory.writeIoValue(IO_VDP_SCREEN_WH, valueNumber(static_cast<double>(screenWh)));
	VdpSurfaceUploadSlot& frameBufferSlot = *m_vram.findSurface(VDP_RD_SURFACE_FRAMEBUFFER);
	resizeVramSlot(frameBufferSlot, static_cast<uint32_t>(profile.renderWidth), static_cast<uint32_t>(profile.renderHeight), screenWh);
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

void VDP::configureSelectedSlotDimension(u32 word) {
	const uint32_t width = packedLow16(word);
	const uint32_t height = packedHigh16(word);
	if (width == 0u || height == 0u) {
		m_fault.raise(VDP_FAULT_VRAM_SLOT_DIM, word);
		return;
	}
	VdpSurfaceUploadSlot* slot = m_slotSurfacePort.resolveSlotSurface(m_vdpRegisters[VDP_REG_SLOT_INDEX], VDP_FAULT_VRAM_SLOT_DIM);
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
		case VDP_XF_PACKET_KIND:
		case VDP_LPU_PACKET_KIND:
		case VDP_MFU_PACKET_KIND:
		case VDP_JTU_PACKET_KIND:
			return consumeUnitRegisterPacketFromMemory(word, cursor, end);
		case VDP_RPU_PACKET_KIND: {
			const u32 nextCursor = m_rpu.consumePacketFromMemory(*m_buildFrame.rpu, word, cursor, end);
			if (nextCursor != VDP_REPLAY_PACKET_FAULT) {
				m_buildFrame.cost += m_rpu.lastPacketCost;
			}
			return nextCursor;
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
		case VDP_XF_PACKET_KIND:
		case VDP_LPU_PACKET_KIND:
		case VDP_MFU_PACKET_KIND:
		case VDP_JTU_PACKET_KIND:
			return consumeUnitRegisterPacketFromWords(words, word, cursor, wordCount);
		case VDP_RPU_PACKET_KIND: {
			const u32 nextCursor = m_rpu.consumePacketFromWords(*m_buildFrame.rpu, words, word, cursor, wordCount);
			if (nextCursor != VDP_REPLAY_PACKET_FAULT) {
				m_buildFrame.cost += m_rpu.lastPacketCost;
			}
			return nextCursor;
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
	m_fault.raise(VDP_FAULT_CMD_BAD_DOORBELL, command);
	return false;
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

void VDP::onFifoWriteThunk(void* context, uint32_t addr, Value value) {
	(void)addr;
	(void)value;
	auto& vdp = *static_cast<VDP*>(context);
	vdp.onVdpFifoWrite();
}

void VDP::onFifoCtrlWriteThunk(void* context, uint32_t addr, Value value) {
	(void)addr;
	(void)value;
	auto& vdp = *static_cast<VDP*>(context);
	vdp.onVdpFifoCtrlWrite();
}

void VDP::onCommandWriteThunk(void* context, uint32_t addr, Value value) {
	(void)addr;
	(void)value;
	auto& vdp = *static_cast<VDP*>(context);
	vdp.onVdpCommandWrite();
}

void VDP::onDitherWriteThunk(void* context, uint32_t addr, Value value) {
	(void)addr;
	auto& vdp = *static_cast<VDP*>(context);
	vdp.onDitherWrite(value);
}

void VDP::onRegisterWriteThunk(void* context, uint32_t addr, Value value) {
	(void)value;
	auto& vdp = *static_cast<VDP*>(context);
	vdp.onVdpRegisterWrite(addr);
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
	BudgetAccrual accrual;
	accrueBudgetUnits(accrual, m_cpuHz, m_workUnitsPerSec, m_workCarry, cycles);
	m_workCarry = accrual.carry;
	if (accrual.wholeUnits > 0) {
		const int remainingWork = getPendingRenderWorkUnits() - m_availableWorkUnits;
		const int64_t maxGrant = remainingWork <= 0 ? 0 : remainingWork;
		const int64_t granted = accrual.wholeUnits > maxGrant ? maxGrant : accrual.wholeUnits;
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

void VDP::writeVram(uint32_t addr, const u8* data, size_t srcOffset, size_t length) {
	if (m_vram.writeStaging(addr, data, srcOffset, length)) {
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
	m_vram.writeSurfaceBytes(slot, offset, data, srcOffset, length);
	m_readback.invalidateSurface(slot.surfaceId);
}

void VDP::readVram(uint32_t addr, u8* out, size_t length) const {
	if (m_vram.readStaging(addr, out, length)) {
		return;
	}
	const VdpSurfaceUploadSlot* mappedSlot = m_vram.findMappedSlot(addr, length);
	if (mappedSlot == nullptr) {
		m_fault.raise(VDP_FAULT_VRAM_WRITE_UNMAPPED, addr);
		for (size_t index = 0u; index < length; ++index) {
			out[index] = 0u;
		}
		return;
	}
	const auto& slot = *mappedSlot;
	if (slot.surfaceWidth == 0 || slot.surfaceHeight == 0) {
		m_fault.raise(VDP_FAULT_VRAM_WRITE_UNINITIALIZED, addr);
		for (size_t index = 0u; index < length; ++index) {
			out[index] = 0u;
		}
		return;
	}
	const uint32_t offset = addr - slot.baseAddr;
	const uint32_t stride = slot.surfaceWidth * 4u;
	const uint32_t totalBytes = slot.surfaceHeight * stride;
	if (offset + length > totalBytes) {
		m_fault.raise(VDP_FAULT_VRAM_WRITE_OOB, addr);
		for (size_t index = 0u; index < length; ++index) {
			out[index] = 0u;
		}
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

void VDP::resetQueuedFrameState() {
	resetBuildingFrame(m_buildFrame);
	resetSubmittedFrameSlot(m_activeFrame);
	resetSubmittedFrameSlot(m_pendingFrame);
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
	if (!m_rpu.beginFrame(*m_buildFrame.rpu)) {
		return false;
	}
	m_buildFrame.state = state;
	return true;
}

void VDP::cancelSubmittedFrame() {
	resetBuildingFrame(m_buildFrame);
	m_rpu.cancelFrame(*m_buildFrame.rpu);
	scheduleNextService(m_scheduler.currentNowCycles());
	refreshSubmitBusyStatus();
}

bool VDP::sealSubmittedFrame() {
	if (m_buildFrame.state == VdpDexFrameState::Idle) {
		m_fault.raise(VDP_FAULT_SUBMIT_STATE, VDP_CMD_END_FRAME);
		return false;
	}
	const bool sealedByFifo = m_rpu.lastPacketSealedFrame;
	if (!sealedByFifo && !m_rpu.endFrame(*m_buildFrame.rpu)) {
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
	const bool frameHasRpuCommands = m_buildFrame.rpu->commands.passCount != 0u || m_buildFrame.rpu->commands.drawCount != 0u;
	const int frameCost = m_buildFrame.cost;
	for (size_t index = 0u; index < frame->xf.matrixWords.size(); ++index) {
		frame->xf.matrixWords[index] = m_xf.matrixWords[index];
	}
	frame->xf.viewMatrixIndex = m_xf.viewMatrixIndex;
	frame->xf.projectionMatrixIndex = m_xf.projectionMatrixIndex;
	for (size_t index = 0u; index < frame->lightRegisterWords.size(); ++index) {
		frame->lightRegisterWords[index] = m_lpu.registerWords[index];
	}
	for (size_t index = 0u; index < frame->morphWeightWords.size(); ++index) {
		frame->morphWeightWords[index] = m_mfu.weightWords[index];
	}
	for (size_t index = 0u; index < frame->jointMatrixWords.size(); ++index) {
		frame->jointMatrixWords[index] = m_jtu.matrixWords[index];
	}
	frame->rpu.swap(m_buildFrame.rpu);
	if (frameCost == 0) {
		frame->state = VdpSubmittedFrameState::Ready;
	} else if (activeFrameEmpty) {
		frame->state = VdpSubmittedFrameState::Executing;
	} else {
		frame->state = VdpSubmittedFrameState::Queued;
	}
	frame->hasCommands = frameHasRpuCommands;
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
		m_activeFrame.state = VdpSubmittedFrameState::Ready;
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
	return m_activeFrame.state == VdpSubmittedFrameState::Ready ? 0 : m_activeFrame.workRemaining;
}

void VDP::scheduleNextService(int64_t nowCycles) {
	if (needsImmediateSchedulerService()) {
		m_scheduler.scheduleDeviceService(DEVICE_SERVICE_VDP, nowCycles);
		return;
	}
	if (!hasPendingRenderWork()) {
		m_scheduler.cancelDeviceService(DEVICE_SERVICE_VDP);
		return;
	}
	const int pendingWork = getPendingRenderWorkUnits();
	const int targetUnits = pendingWork < VDP_SERVICE_BATCH_WORK_UNITS ? pendingWork : VDP_SERVICE_BATCH_WORK_UNITS;
	if (m_availableWorkUnits >= targetUnits) {
		m_scheduler.scheduleDeviceService(DEVICE_SERVICE_VDP, nowCycles);
		return;
	}
	m_scheduler.scheduleDeviceService(DEVICE_SERVICE_VDP, nowCycles + cyclesUntilBudgetUnits(m_cpuHz, m_workUnitsPerSec, m_workCarry, targetUnits - m_availableWorkUnits));
}


const VdpDeviceOutput& VDP::readDeviceOutput() {
	return m_vout.readDeviceOutput(m_scheduler.currentNowCycles());
}

void VDP::finishCommittedFrameOnVblankEdge() {
	m_vout.presentFrame(m_activeFrame);
	m_lastFrameCommitted = true;
	m_lastFrameHeld = false;
	resetSubmittedFrameSlot(m_activeFrame);
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
	finishCommittedFrameOnVblankEdge();
	return false;
}
// end hot-path


// start hot-path -- VDP readback registers are polled by the emulated CPU.
Value VDP::readVdpStatusThunk(void* context, uint32_t addr) {
	(void)addr;
	return valueNumber(static_cast<double>(static_cast<VDP*>(context)->m_readback.status()));
}

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

Value VDP::readVdpDataThunk(void* context, uint32_t addr) {
	(void)addr;
	return valueNumber(static_cast<double>(static_cast<VDP*>(context)->readVdpData()));
}

// end hot-path

void VDP::initializeRegisters() {
	const i32 dither = 0;
	m_vdpModeWord = static_cast<u32>(PSX_MODEL_PROFILE.biosVdpMode);
	const MachineVdpModeProfile& vdpMode = getMachineVdpModeProfile(PSX_MODEL_PROFILE.biosVdpMode);
	const VdpSurfaceUploadSlot& frameBufferSlot = *m_vram.findSurface(VDP_RD_SURFACE_FRAMEBUFFER);
	m_fbm.configure(frameBufferSlot.surfaceWidth, frameBufferSlot.surfaceHeight);
	resetQueuedFrameState();
	resetIngressState();
	resetStatus();
	m_memory.writeIoValue(IO_VDP_RD_SURFACE, valueNumber(static_cast<double>(VDP_RD_SURFACE_SYSTEM)));
	m_memory.writeIoValue(IO_VDP_RD_X, valueNumber(0.0));
	m_memory.writeIoValue(IO_VDP_RD_Y, valueNumber(0.0));
	m_memory.writeIoValue(IO_VDP_RD_MODE, valueNumber(static_cast<double>(VDP_RD_MODE_RGBA8888)));
	m_memory.writeIoValue(IO_VDP_DITHER, valueNumber(static_cast<double>(dither)));
	m_memory.writeIoValue(IO_VDP_SLOT_PRIMARY, valueNumber(static_cast<double>(VDP_SLOT_NONE)));
	m_memory.writeIoValue(IO_VDP_SLOT_SECONDARY, valueNumber(static_cast<double>(VDP_SLOT_NONE)));
	m_memory.writeIoValue(IO_VDP_MODE, valueNumber(static_cast<double>(m_vdpModeWord)));
	m_memory.writeIoValue(IO_VDP_SCREEN_WH, valueNumber(static_cast<double>(packLowHigh16(static_cast<u32>(vdpMode.renderWidth), static_cast<u32>(vdpMode.renderHeight)))));
	m_memory.writeIoValue(IO_VDP_CMD, valueNumber(0.0));
	resetVdpRegisters();
	m_xf.reset();
	m_lpu.reset();
	m_mfu.reset();
	m_jtu.reset();
	m_vout.reset(dither, m_fbm.width(), m_fbm.height());
	m_rpu.reset();
	m_lastFrameCommitted = true;
	m_lastFrameCost = 0;
	m_lastFrameHeld = false;
}

void VDP::initializeVramSurfaces() {
	bindStagingMemory();
	resetQueuedFrameState();
	m_vram.initializeSurfaces(defaultVdpVramSurfaces(m_configuredFrameBufferSize));
	bindVramSurfaces();
	m_memory.writeIoValue(IO_VDP_SLOT_PRIMARY, valueNumber(static_cast<double>(VDP_SLOT_NONE)));
	m_memory.writeIoValue(IO_VDP_SLOT_SECONDARY, valueNumber(static_cast<double>(VDP_SLOT_NONE)));
}

uint32_t VDP::trackedUsedVramBytes() const {
	return m_vram.trackedUsedBytes();
}

uint32_t VDP::trackedTotalVramBytes() const {
	return m_vram.trackedTotalBytes();
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
	VdpSurfaceUploadSlot* slot = m_slotSurfacePort.resolveSlotSurface(slotId, VDP_FAULT_VRAM_SLOT_DIM);
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

void VDP::bindStagingMemory() {
	m_rpu.configureVramStorage(VRAM_STAGING_SIZE);
	m_vram.setExternalStaging(m_rpu.vdpVram.data(), m_rpu.vdpVram.size(), m_rpu.vdpVramPageRevisions.data());
	m_rpu.rebindFrameResources(*m_buildFrame.rpu);
	m_rpu.rebindFrameResources(*m_activeFrame.rpu);
	m_rpu.rebindFrameResources(*m_pendingFrame.rpu);
}

void VDP::bindVramSurfaces() {
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
	m_vout.presentLiveState();
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

void VDP::captureVisualStateFields(VdpState& state) const {
	state.vdpModeWord = m_vdpModeWord;
	state.xf = m_xf.captureState();
	for (size_t index = 0u; index < state.vdpRegisterWords.size(); ++index) {
		state.vdpRegisterWords[index] = m_vdpRegisters[index];
	}
	state.buildFrame = captureBuildingFrameState(m_buildFrame);
	state.activeFrame = captureSubmittedFrameState(m_activeFrame);
	state.pendingFrame = captureSubmittedFrameState(m_pendingFrame);
	state.rpu = m_rpu.captureState();
	state.workCarry = m_workCarry;
	state.availableWorkUnits = m_availableWorkUnits;
	state.streamIngress = m_streamIngress.captureState();
	state.readback = m_readback.captureState();
	for (size_t index = 0u; index < state.lightRegisterWords.size(); ++index) {
		state.lightRegisterWords[index] = m_lpu.registerWords[index];
	}
	for (size_t index = 0u; index < state.morphWeightWords.size(); ++index) {
		state.morphWeightWords[index] = m_mfu.weightWords[index];
	}
	for (size_t index = 0u; index < state.jointMatrixWords.size(); ++index) {
		state.jointMatrixWords[index] = m_jtu.matrixWords[index];
	}
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
	writeModeWord(state.vdpModeWord);
	m_xf.restoreState(state.xf);
	for (size_t index = 0u; index < m_vdpRegisters.size(); ++index) {
		m_vdpRegisters[index] = state.vdpRegisterWords[index];
	}
	restoreBuildingFrameState(m_buildFrame, state.buildFrame);
	restoreSubmittedFrameState(m_activeFrame, state.activeFrame);
	restoreSubmittedFrameState(m_pendingFrame, state.pendingFrame);
	m_rpu.restoreState(state.rpu);
	m_rpu.rebindFrameResources(*m_buildFrame.rpu);
	m_rpu.rebindFrameResources(*m_activeFrame.rpu);
	m_rpu.rebindFrameResources(*m_pendingFrame.rpu);
	m_workCarry = state.workCarry;
	m_availableWorkUnits = state.availableWorkUnits;
	m_streamIngress.restoreState(state.streamIngress);
	m_readback.restoreState(state.readback);
	for (uint32_t index = 0; index < VDP_REGISTER_COUNT; ++index) {
		m_memory.writeIoValue(IO_VDP_REG0 + index * IO_WORD_SIZE, valueNumber(static_cast<double>(m_vdpRegisters[index])));
	}
	m_memory.writeValue(IO_VDP_DITHER, valueNumber(static_cast<double>(state.ditherType)));
	for (size_t index = 0u; index < m_lpu.registerWords.size(); ++index) {
		m_lpu.registerWords[index] = state.lightRegisterWords[index];
	}
	for (size_t index = 0u; index < m_mfu.weightWords.size(); ++index) {
		m_mfu.weightWords[index] = state.morphWeightWords[index];
	}
	for (size_t index = 0u; index < m_jtu.matrixWords.size(); ++index) {
		m_jtu.matrixWords[index] = state.jointMatrixWords[index];
	}
	m_fault.restore(0u, state.vdpFaultCode, state.vdpFaultDetail);
	m_fault.setStatusFlag(VDP_STATUS_FAULT, m_fault.code != VDP_FAULT_NONE);
	refreshSubmitBusyStatus();
	m_scheduler.cancelDeviceService(DEVICE_SERVICE_VDP);
	if (needsImmediateSchedulerService() || hasPendingRenderWork()) {
		scheduleNextService(m_scheduler.currentNowCycles());
	}
	m_vout.presentLiveState();
}

VdpSaveState VDP::captureSaveState() const {
	VdpSaveState state;
	captureVisualStateFields(state);
	state.vram = m_vram.captureState();
	state.displayFrameBufferPixels = m_fbm.captureDisplayReadback();
	return state;
}

void VDP::restoreSaveState(const VdpSaveState& state) {
	restoreState(state);
	m_vram.restoreState(state.vram);
	bindVramSurfaces();
	m_fbm.restoreDisplayReadback(state.displayFrameBufferPixels);
	m_vout.presentLiveState();
}


} // namespace bmsx
