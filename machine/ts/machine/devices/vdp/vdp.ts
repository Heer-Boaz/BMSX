import {
	VDP_RD_SURFACE_FRAMEBUFFER,
	VDP_FIFO_CTRL_SEAL,
	VDP_FAULT_NONE,
	VDP_FAULT_STREAM_BAD_PACKET,
	VDP_FAULT_MODE_UNSUPPORTED,
	VDP_FAULT_SUBMIT_STATE,
	VDP_FAULT_CMD_BAD_DOORBELL,
	VDP_FAULT_SUBMIT_BUSY,
	VDP_FAULT_VRAM_WRITE_OOB,
	VDP_FAULT_VRAM_WRITE_UNALIGNED,
	VDP_FAULT_VRAM_WRITE_UNINITIALIZED,
	VDP_FAULT_VRAM_WRITE_UNMAPPED,
	VDP_RD_MODE_RGBA8888,
	VDP_STATUS_SUBMIT_BUSY,
	VDP_STATUS_SUBMIT_REJECTED,
	VDP_STATUS_FAULT,
	VDP_STATUS_VBLANK,
} from './contracts';
import {
	IO_VDP_DITHER,
	IO_VDP_FAULT_CODE,
	IO_VDP_FAULT_DETAIL,
	IO_VDP_FAULT_ACK,
	IO_VDP_CMD,
	IO_VDP_FIFO,
	IO_VDP_FIFO_CTRL,
	IO_VDP_MODE,
	IO_VDP_REG0,
	IO_VDP_SCREEN_WH,
	IO_VDP_RD_DATA,
	IO_VDP_RD_MODE,
	IO_VDP_RD_STATUS,
	IO_VDP_RD_SURFACE,
	IO_VDP_RD_X,
	IO_VDP_RD_Y,
	IO_VDP_STATUS,
} from '../../bus/io';
import type { Value } from '../../cpu/cpu';
import type { VramWriteSink } from '../../memory/memory';
import { Memory } from '../../memory/memory';
import { DeviceStatusLatch, type DeviceStatusRegisters } from '../device_status';
import { accrueBudgetUnits, cyclesUntilBudgetUnits, type BudgetAccrual } from '../../scheduler/budget';
import { DEVICE_SERVICE_VDP, type DeviceScheduler } from '../../scheduler/device';
import {
	VDP_STREAM_BUFFER_SIZE,
	VRAM_FRAMEBUFFER_BASE,
	IO_WORD_SIZE,
} from '../../memory/map';
import {
	VdpJtuUnit,
	VDP_JTU_PACKET_KIND,
} from './jtu';
import {
	VdpLpuUnit,
	VDP_LPU_PACKET_KIND,
} from './lpu';
import {
	VdpMfuUnit,
	VDP_MFU_PACKET_KIND,
} from './mfu';
import {
	VDP_XF_PACKET_KIND,
	VdpXfUnit,
} from './xf';
import { createVdpRpuFrameOutput, VDP_RPU_PACKET_KIND, VdpRpuUnit } from './rpu';
import { VdpVoutUnit } from './vout';
import { vdpUnitPacketHasFlags, vdpUnitPacketPayloadWords } from './packet';
import { packLowHigh16, packedLow16 } from '../../common/word';
import {
	getMachineVdpModeProfile,
	PSX_MODEL_PROFILE,
	VDP_MODE_MSX1_PROFILE,
	VDP_MODE_MSX1_WORD,
	VDP_MODE_MSX2_PROFILE,
	VDP_MODE_MSX2_WORD,
	VDP_MODE_PSX_PROFILE,
	VDP_MODE_PSX_WORD,
	type MachineVdpModeProfile,
} from '../../model_registry';
import {
	VDP_DEX_FRAME_DIRECT_OPEN,
	VDP_DEX_FRAME_IDLE,
	VDP_DEX_FRAME_STREAM_OPEN,
	VDP_SUBMITTED_FRAME_EMPTY,
	VDP_SUBMITTED_FRAME_EXECUTING,
	VDP_SUBMITTED_FRAME_QUEUED,
	VDP_SUBMITTED_FRAME_READY,
	type VdpBuildingFrameState,
	type VdpDexFrameState,
	type VdpSubmittedFrame,
	allocateSubmittedFrameSlot,
	resetBuildingFrame,
	resetSubmittedFrameSlot,
	captureBuildingFrameState,
	captureSubmittedFrameState,
	restoreBuildingFrameState,
	restoreSubmittedFrameState,
} from './frame';
import {
	VDP_CMD_BEGIN_FRAME,
	VDP_CMD_END_FRAME,
	VDP_CMD_NOP,
	VDP_PKT_CMD,
	VDP_PKT_END,
	VDP_PKT_KIND_MASK,
	VDP_PKT_REG1,
	VDP_PKT_REGN,
	VDP_Q16_ONE,
	VDP_REG_BG_COLOR,
	VDP_REG_DRAW_COLOR,
	VDP_REG_DRAW_SCALE_X,
	VDP_REG_DRAW_SCALE_Y,
	VDP_REG_LINE_WIDTH,
	VDP_REG_SLOT_DIM,
	VDP_REGISTER_COUNT,
} from './registers';
import {
	type VdpDeviceOutput,
} from './device_output';
import { VdpFbmUnit } from './fbm';
import { VdpStreamIngressUnit } from './ingress';
import { VdpUnitRegisterPort } from './unit_register_port';
import { VdpReadbackUnit } from './readback';
import {
	DEFAULT_VDP_ENTROPY_SEEDS,
	type VdpEntropySeeds,
	type VdpFrameBufferSize,
	VdpVramUnit,
} from './vram';
import type { VdpSaveState, VdpState } from './save_state';


export type { VdpEntropySeeds, VdpFrameBufferSize } from './vram';

export const VDP_DEVICE_STATUS_REGISTERS: DeviceStatusRegisters = {
	statusAddr: IO_VDP_STATUS,
	codeAddr: IO_VDP_FAULT_CODE,
	detailAddr: IO_VDP_FAULT_DETAIL,
	ackAddr: IO_VDP_FAULT_ACK,
	faultMask: VDP_STATUS_FAULT,
	noneCode: VDP_FAULT_NONE,
};
export const VDP_SERVICE_BATCH_WORK_UNITS = 128;
export const VDP_REPLAY_PACKET_FAULT = 0xffffffff;

export class VDP implements VramWriteSink {
	private readonly vram: VdpVramUnit;
	private readonly readback: VdpReadbackUnit;
	private readonly fbm: VdpFbmUnit;
	private readonly xf = new VdpXfUnit();
	private readonly lpu = new VdpLpuUnit();
	private readonly mfu = new VdpMfuUnit();
	private readonly jtu = new VdpJtuUnit();
	private readonly rpu: VdpRpuUnit;
	private readonly vout: VdpVoutUnit;
	private readonly buildFrame: VdpBuildingFrameState;
	private activeFrame: VdpSubmittedFrame;
	private pendingFrame: VdpSubmittedFrame;
	private readonly regnPacketScratch = { firstRegister: 0, count: 0 };
	private cpuHz = 1;
	private workUnitsPerSec = 1;
	private workCarry = 0;
	private availableWorkUnits = 0;
	private readonly budgetAccrual: BudgetAccrual = { wholeUnits: 0, carry: 0 };
	private readonly fault: DeviceStatusLatch;
	private readonly vdpRegisters = new Uint32Array(VDP_REGISTER_COUNT);
	private readonly streamIngress = new VdpStreamIngressUnit();
	private readonly unitRegisterPort: VdpUnitRegisterPort;
	private vdpModeWord = PSX_MODEL_PROFILE.biosVdpMode;
	private m_lastFrameCommitted = true;
	private m_lastFrameCost = 0;
	private m_lastFrameHeld = false;
	public constructor(
		private readonly memory: Memory,
		private readonly scheduler: DeviceScheduler,
		frameBufferSize: VdpFrameBufferSize,
		entropySeeds: VdpEntropySeeds = DEFAULT_VDP_ENTROPY_SEEDS,
	) {
		this.fault = new DeviceStatusLatch(memory, VDP_DEVICE_STATUS_REGISTERS);
		this.readback = new VdpReadbackUnit(memory, this.fault);
		this.vram = new VdpVramUnit(frameBufferSize, entropySeeds);
		this.fbm = new VdpFbmUnit(frameBufferSize.width, frameBufferSize.height);
		this.rpu = new VdpRpuUnit(
			this.memory,
			this.fault,
			this.vram.rpuVram,
		);
		this.vout = new VdpVoutUnit(this.vram.rpuVram, this.vram.rpuVramPageRevisions);
		this.buildFrame = {
			rpu: createVdpRpuFrameOutput(this.vram.rpuVram, this.vram.rpuVramPageRevisions),
			state: VDP_DEX_FRAME_IDLE,
			cost: 0,
		};
		this.activeFrame = allocateSubmittedFrameSlot(this.vram.rpuVram, this.vram.rpuVramPageRevisions);
		this.pendingFrame = allocateSubmittedFrameSlot(this.vram.rpuVram, this.vram.rpuVramPageRevisions);
		this.unitRegisterPort = new VdpUnitRegisterPort(this.fault, this.xf, this.lpu, this.mfu, this.jtu);
		this.memory.setVramWriter(this);
		this.memory.mapIoRead(IO_VDP_RD_STATUS, this, this.readVdpStatusThunk);
		this.memory.mapIoRead(IO_VDP_RD_DATA, this, this.readVdpDataThunk);
		this.memory.mapIoWrite(IO_VDP_DITHER, this, this.onDitherWriteThunk);
		this.memory.mapIoWrite(IO_VDP_FIFO, this, this.onFifoWriteThunk);
		this.memory.mapIoWrite(IO_VDP_FIFO_CTRL, this, this.onFifoCtrlWriteThunk);
		this.memory.mapIoWrite(IO_VDP_CMD, this, this.onCommandWriteThunk);
		this.memory.mapIoWrite(IO_VDP_FAULT_ACK, this.fault, DeviceStatusLatch.acknowledgeWriteThunk);
		for (let index = 0; index < VDP_REGISTER_COUNT; index += 1) {
			this.memory.mapIoWrite(IO_VDP_REG0 + index * IO_WORD_SIZE, this, this.onRegisterWriteThunk);
		}
	}

	public initializeVramSurfaces(): void {
		this.resetQueuedFrameState();
		this.vram.initializeFrameBuffer();
		this.bindVramSurfaces();
	}

	public resetIngressState(): void {
		this.streamIngress.reset();
		this.refreshSubmitBusyStatus();
	}

	public resetStatus(): void {
		this.fault.resetStatus();
		this.refreshSubmitBusyStatus();
	}

	public writeModeWord(word: number): void {
		switch (word >>> 0) {
			case VDP_MODE_MSX1_WORD:
				this.applyVdpModeProfile(VDP_MODE_MSX1_PROFILE);
				break;
			case VDP_MODE_MSX2_WORD:
				this.applyVdpModeProfile(VDP_MODE_MSX2_PROFILE);
				break;
			case VDP_MODE_PSX_WORD:
				this.applyVdpModeProfile(VDP_MODE_PSX_PROFILE);
				break;
			default:
				this.fault.raise(VDP_FAULT_MODE_UNSUPPORTED, word >>> 0);
				this.memory.writeIoValue(IO_VDP_MODE, this.vdpModeWord);
		}
	}

	private applyVdpModeProfile(profile: MachineVdpModeProfile): void {
		this.vdpModeWord = profile.mode;
		const screenWh = packLowHigh16(profile.renderWidth, profile.renderHeight);
		this.memory.writeIoValue(IO_VDP_MODE, profile.mode);
		this.memory.writeIoValue(IO_VDP_SCREEN_WH, screenWh);
		this.resizeFrameBufferSurface(profile.renderWidth, profile.renderHeight);
	}

	private resetVdpRegisters(): void {
		this.vdpRegisters.fill(0);
		this.vdpRegisters[VDP_REG_LINE_WIDTH] = VDP_Q16_ONE;
		this.vdpRegisters[VDP_REG_DRAW_SCALE_X] = VDP_Q16_ONE;
		this.vdpRegisters[VDP_REG_DRAW_SCALE_Y] = VDP_Q16_ONE;
		this.vdpRegisters[VDP_REG_DRAW_COLOR] = 0xffffffff;
		this.vdpRegisters[VDP_REG_BG_COLOR] = 0xff000000;
		this.vdpRegisters[VDP_REG_SLOT_DIM] = 1 | (1 << 16);
		for (let index = 0; index < VDP_REGISTER_COUNT; index += 1) {
			this.memory.writeIoValue(IO_VDP_REG0 + index * IO_WORD_SIZE, this.vdpRegisters[index]);
		}
	}

	private writeVdpRegister(index: number, value: number): void {
		const register = index % VDP_REGISTER_COUNT;
		const word = value >>> 0;
		this.vdpRegisters[register] = word;
		this.memory.writeIoValue(IO_VDP_REG0 + register * IO_WORD_SIZE, word);
	}

	private onVdpRegisterWrite(addr: number): void {
		const index = ((addr - IO_VDP_REG0) / IO_WORD_SIZE) >>> 0;
		this.writeVdpRegister(index, this.memory.readIoU32(addr));
	}

	private readVdpStatusThunk(context: VDP, addr: number): number {
		void addr;
		return context.readback.status();
	}

	private readVdpDataThunk(context: VDP, addr: number): number {
		void addr;
		return context.readVdpData();
	}

	private onFifoWriteThunk(context: VDP, addr: number, value: Value): void {
		void addr;
		void value;
		context.onVdpFifoWrite();
	}

	private onFifoCtrlWriteThunk(context: VDP, addr: number, value: Value): void {
		void addr;
		void value;
		context.onVdpFifoCtrlWrite();
	}

	private onCommandWriteThunk(context: VDP, addr: number, value: Value): void {
		void addr;
		void value;
		context.onVdpCommandWrite();
	}

	private onDitherWriteThunk(context: VDP, addr: number, value: Value): void {
		void addr;
		context.vout.writeDitherType(value as number);
	}

	private onRegisterWriteThunk(context: VDP, addr: number, value: Value): void {
		void value;
		context.onVdpRegisterWrite(addr);
	}


	public setScanoutTiming(vblankActive: boolean, cyclesIntoFrame: number, cyclesPerFrame: number, vblankStartCycle: number): void {
		this.vout.setScanoutTiming(cyclesIntoFrame, cyclesPerFrame, vblankStartCycle, this.scheduler.currentNowCycles());
		this.fault.setStatusFlag(VDP_STATUS_VBLANK, vblankActive);
	}

	public acceptSubmitAttempt(): void {
		this.fault.setStatusFlag(VDP_STATUS_SUBMIT_REJECTED, false);
		this.refreshSubmitBusyStatus();
	}

	public rejectSubmitAttempt(): void {
		this.fault.setStatusFlag(VDP_STATUS_SUBMIT_REJECTED, true);
		this.refreshSubmitBusyStatus();
	}

	private rejectBusySubmitAttempt(detail: number): void {
		this.rejectSubmitAttempt();
		this.fault.raise(VDP_FAULT_SUBMIT_BUSY, detail);
	}

	public beginDmaSubmit(): void {
		this.streamIngress.beginDmaSubmit();
		this.acceptSubmitAttempt();
	}

	public endDmaSubmit(): void {
		this.streamIngress.endDmaSubmit();
		this.refreshSubmitBusyStatus();
	}

	public sealDmaTransfer(src: number, byteLength: number): void {
		this.consumeSealedVdpStream(src, byteLength);
		this.endDmaSubmit();
	}

	public writeVdpFifoBytes(data: Uint8Array, length = data.byteLength): void {
		const overflowDetail = this.streamIngress.writeBytes(data, length);
		if (overflowDetail !== 0) {
			this.fault.raise(VDP_FAULT_STREAM_BAD_PACKET, overflowDetail);
			this.resetIngressState();
			return;
		}
		this.refreshSubmitBusyStatus();
	}

	private hasBlockedSubmitPath(): boolean {
		return this.streamIngress.hasOpenDirectFifoIngress() || this.streamIngress.dmaSubmitActive || this.buildFrame.state !== VDP_DEX_FRAME_IDLE || !this.canAcceptSubmittedFrame();
	}

	private refreshSubmitBusyStatus(): void {
		this.fault.setStatusFlag(VDP_STATUS_SUBMIT_BUSY, this.hasBlockedSubmitPath());
	}

	private pushVdpFifoWord(word: number): void {
		const overflowDetail = this.streamIngress.pushWord(word);
		if (overflowDetail !== 0) {
			this.fault.raise(VDP_FAULT_STREAM_BAD_PACKET, overflowDetail);
			this.resetIngressState();
			return;
		}
		this.refreshSubmitBusyStatus();
	}

	private consumeSealedVdpStream(baseAddr: number, byteLength: number): void {
		if ((byteLength & 3) !== 0) {
			this.fault.raise(VDP_FAULT_STREAM_BAD_PACKET, byteLength);
			return;
		}
		if (byteLength > VDP_STREAM_BUFFER_SIZE) {
			this.fault.raise(VDP_FAULT_STREAM_BAD_PACKET, byteLength);
			return;
		}
		if (this.buildFrame.state !== VDP_DEX_FRAME_IDLE) {
			this.fault.raise(VDP_FAULT_STREAM_BAD_PACKET, VDP_CMD_BEGIN_FRAME);
			this.cancelSubmittedFrame();
			return;
		}
		let cursor = baseAddr;
		const end = baseAddr + byteLength;
		if (!this.beginSubmittedFrame(VDP_DEX_FRAME_STREAM_OPEN)) {
			return;
		}
		let ended = false;
		while (cursor < end) {
			const word = this.memory.readU32(cursor) >>> 0;
			cursor += IO_WORD_SIZE;
			if (word === VDP_PKT_END) {
				if (cursor !== end) {
					this.fault.raise(VDP_FAULT_STREAM_BAD_PACKET, word);
					this.cancelSubmittedFrame();
					return;
				}
				ended = true;
				break;
			}
			cursor = this.consumeReplayPacketFromMemory(word, cursor, end);
			if (cursor === VDP_REPLAY_PACKET_FAULT) {
				this.cancelSubmittedFrame();
				return;
			}
		}
		if (!ended) {
			this.fault.raise(VDP_FAULT_STREAM_BAD_PACKET, byteLength);
			this.cancelSubmittedFrame();
			return;
		}
		if (!this.sealSubmittedFrame()) {
			this.cancelSubmittedFrame();
		}
		this.refreshSubmitBusyStatus();
	}

	private consumeSealedVdpWordStream(words: Uint32Array, wordCount: number): void {
		if (this.buildFrame.state !== VDP_DEX_FRAME_IDLE) {
			this.fault.raise(VDP_FAULT_STREAM_BAD_PACKET, VDP_CMD_BEGIN_FRAME);
			this.cancelSubmittedFrame();
			return;
		}
		let cursor = 0;
		if (!this.beginSubmittedFrame(VDP_DEX_FRAME_STREAM_OPEN)) {
			return;
		}
		let ended = false;
		while (cursor < wordCount) {
			const word = words[cursor] >>> 0;
			cursor += 1;
			if (word === VDP_PKT_END) {
				if (cursor !== wordCount) {
					this.fault.raise(VDP_FAULT_STREAM_BAD_PACKET, word);
					this.cancelSubmittedFrame();
					return;
				}
				ended = true;
				break;
			}
			cursor = this.consumeReplayPacketFromWords(words, word, cursor, wordCount);
			if (cursor === VDP_REPLAY_PACKET_FAULT) {
				this.cancelSubmittedFrame();
				return;
			}
		}
		if (!ended) {
			this.fault.raise(VDP_FAULT_STREAM_BAD_PACKET, wordCount);
			this.cancelSubmittedFrame();
			return;
		}
		if (!this.sealSubmittedFrame()) {
			this.cancelSubmittedFrame();
		}
		this.refreshSubmitBusyStatus();
	}

	private sealVdpFifoTransfer(): void {
		if (this.streamIngress.fifoWordByteCount !== 0) {
			this.fault.raise(VDP_FAULT_STREAM_BAD_PACKET, this.streamIngress.fifoWordByteCount);
			this.resetIngressState();
			return;
		}
		if (this.streamIngress.fifoStreamWordCount === 0) {
			return;
		}
		this.consumeSealedVdpWordStream(this.streamIngress.fifoStreamWords, this.streamIngress.fifoStreamWordCount);
		this.resetIngressState();
	}

	private consumeReplayPacketFromMemory(word: number, cursor: number, end: number): number {
		const kind = word & VDP_PKT_KIND_MASK;
		switch (kind) {
			case VDP_PKT_CMD:
				return this.consumeReplayCommandPacket(word) ? cursor : VDP_REPLAY_PACKET_FAULT;
			case VDP_PKT_REG1: {
				if (cursor + IO_WORD_SIZE > end) {
					this.fault.raise(VDP_FAULT_STREAM_BAD_PACKET, word);
					return VDP_REPLAY_PACKET_FAULT;
				}
				this.writeVdpRegister(packedLow16(word), this.memory.readU32(cursor));
				return cursor + IO_WORD_SIZE;
			}
			case VDP_PKT_REGN: {
				const packet = this.regnPacketScratch;
				this.decodeRegnPacket(word, packet);
				const byteCount = packet.count * IO_WORD_SIZE;
				const payloadEnd = cursor + byteCount;
				if (payloadEnd > end) {
					this.fault.raise(VDP_FAULT_STREAM_BAD_PACKET, word);
					return VDP_REPLAY_PACKET_FAULT;
				}
				for (let offset = 0; offset < packet.count; offset += 1) {
					this.writeVdpRegister(packet.firstRegister + offset, this.memory.readU32(cursor + offset * IO_WORD_SIZE));
				}
				return payloadEnd;
			}
			case VDP_XF_PACKET_KIND:
			case VDP_LPU_PACKET_KIND:
			case VDP_MFU_PACKET_KIND:
			case VDP_JTU_PACKET_KIND:
				return this.consumeUnitRegisterPacketFromMemory(word, cursor, end);
			case VDP_RPU_PACKET_KIND: {
				const nextCursor = this.rpu.consumePacketFromMemory(this.buildFrame.rpu, word, cursor, end);
				if (nextCursor !== VDP_REPLAY_PACKET_FAULT) {
					this.buildFrame.cost += this.rpu.lastPacketCost;
				}
				return nextCursor;
			}
		}
		return cursor;
	}

	private consumeUnitRegisterPacketFromMemory(word: number, cursor: number, end: number): number {
		if (vdpUnitPacketHasFlags(word)) {
			this.fault.raise(VDP_FAULT_STREAM_BAD_PACKET, word);
			return VDP_REPLAY_PACKET_FAULT;
		}
		const payloadWords = vdpUnitPacketPayloadWords(word);
		if (payloadWords < 2) {
			this.fault.raise(VDP_FAULT_STREAM_BAD_PACKET, word);
			return VDP_REPLAY_PACKET_FAULT;
		}
		const payloadEnd = cursor + payloadWords * IO_WORD_SIZE;
		if (payloadEnd > end) {
			this.fault.raise(VDP_FAULT_STREAM_BAD_PACKET, word);
			return VDP_REPLAY_PACKET_FAULT;
		}
		const packetKind = word & VDP_PKT_KIND_MASK;
		const firstRegister = this.memory.readU32(cursor);
		const registerCount = payloadWords - 1;
		if (!this.unitRegisterPort.acceptRange(packetKind, firstRegister, registerCount)) {
			return VDP_REPLAY_PACKET_FAULT;
		}
		for (let offset = 0; offset < registerCount; offset += 1) {
			if (!this.unitRegisterPort.writeWord(packetKind, firstRegister + offset, this.memory.readU32(cursor + (offset + 1) * IO_WORD_SIZE))) {
				return VDP_REPLAY_PACKET_FAULT;
			}
		}
		return payloadEnd;
	}

	private consumeReplayPacketFromWords(words: Uint32Array, word: number, cursor: number, wordCount: number): number {
		const kind = word & VDP_PKT_KIND_MASK;
		switch (kind) {
			case VDP_PKT_CMD:
				return this.consumeReplayCommandPacket(word) ? cursor : VDP_REPLAY_PACKET_FAULT;
			case VDP_PKT_REG1: {
				if (cursor >= wordCount) {
					this.fault.raise(VDP_FAULT_STREAM_BAD_PACKET, word);
					return VDP_REPLAY_PACKET_FAULT;
				}
				this.writeVdpRegister(packedLow16(word), words[cursor]);
				return cursor + 1;
			}
			case VDP_PKT_REGN: {
				const packet = this.regnPacketScratch;
				this.decodeRegnPacket(word, packet);
				if (cursor + packet.count > wordCount) {
					this.fault.raise(VDP_FAULT_STREAM_BAD_PACKET, word);
					return VDP_REPLAY_PACKET_FAULT;
				}
				for (let offset = 0; offset < packet.count; offset += 1) {
					this.writeVdpRegister(packet.firstRegister + offset, words[cursor + offset]);
				}
				return cursor + packet.count;
			}
			case VDP_XF_PACKET_KIND:
			case VDP_LPU_PACKET_KIND:
			case VDP_MFU_PACKET_KIND:
			case VDP_JTU_PACKET_KIND:
				return this.consumeUnitRegisterPacketFromWords(words, word, cursor, wordCount);
			case VDP_RPU_PACKET_KIND: {
				const nextCursor = this.rpu.consumePacketFromWords(this.buildFrame.rpu, words, word, cursor, wordCount);
				if (nextCursor !== VDP_REPLAY_PACKET_FAULT) {
					this.buildFrame.cost += this.rpu.lastPacketCost;
				}
				return nextCursor;
			}
		}
		return cursor;
	}

	private consumeUnitRegisterPacketFromWords(words: Uint32Array, word: number, cursor: number, wordCount: number): number {
		if (vdpUnitPacketHasFlags(word)) {
			this.fault.raise(VDP_FAULT_STREAM_BAD_PACKET, word);
			return VDP_REPLAY_PACKET_FAULT;
		}
		const payloadWords = vdpUnitPacketPayloadWords(word);
		if (payloadWords < 2 || cursor + payloadWords > wordCount) {
			this.fault.raise(VDP_FAULT_STREAM_BAD_PACKET, word);
			return VDP_REPLAY_PACKET_FAULT;
		}
		const packetKind = word & VDP_PKT_KIND_MASK;
		const firstRegister = words[cursor];
		const registerCount = payloadWords - 1;
		if (!this.unitRegisterPort.acceptRange(packetKind, firstRegister, registerCount)) {
			return VDP_REPLAY_PACKET_FAULT;
		}
		for (let offset = 0; offset < registerCount; offset += 1) {
			if (!this.unitRegisterPort.writeWord(packetKind, firstRegister + offset, words[cursor + offset + 1])) {
				return VDP_REPLAY_PACKET_FAULT;
			}
		}
		return cursor + payloadWords;
	}

	private decodeRegnPacket(word: number, packet: { firstRegister: number; count: number }): void {
		packet.firstRegister = packedLow16(word);
		packet.count = (word >>> 16) & 0xff;
	}

	private consumeReplayCommandPacket(word: number): boolean {
		const command = packedLow16(word);
		if (command === VDP_CMD_BEGIN_FRAME || command === VDP_CMD_END_FRAME) {
			this.fault.raise(VDP_FAULT_STREAM_BAD_PACKET, command);
			return false;
		}
		if (command === VDP_CMD_NOP) {
			return true;
		}
		this.fault.raise(VDP_FAULT_CMD_BAD_DOORBELL, command);
		return false;
	}

	private consumeDirectVdpCommand(command: number): void {
		if (command === VDP_CMD_NOP) {
			return;
		}
		if (command === VDP_CMD_BEGIN_FRAME) {
			if (this.buildFrame.state !== VDP_DEX_FRAME_IDLE) {
				this.fault.raise(VDP_FAULT_SUBMIT_STATE, command);
				this.cancelSubmittedFrame();
				return;
			}
			if (!this.beginSubmittedFrame(VDP_DEX_FRAME_DIRECT_OPEN)) {
				return;
			}
			this.refreshSubmitBusyStatus();
			return;
		}
		if (command === VDP_CMD_END_FRAME) {
			if (this.buildFrame.state === VDP_DEX_FRAME_IDLE) {
				this.rejectSubmitAttempt();
				this.fault.raise(VDP_FAULT_SUBMIT_STATE, command);
				return;
			}
			if (!this.sealSubmittedFrame()) {
				this.cancelSubmittedFrame();
			}
			this.refreshSubmitBusyStatus();
			return;
		}
		if (this.buildFrame.state === VDP_DEX_FRAME_IDLE) {
			this.rejectSubmitAttempt();
			this.fault.raise(VDP_FAULT_SUBMIT_STATE, command);
			return;
		}
		this.fault.raise(VDP_FAULT_CMD_BAD_DOORBELL, command);
		this.refreshSubmitBusyStatus();
	}

	private onVdpFifoWrite(): void {
		if (this.streamIngress.dmaSubmitActive || this.buildFrame.state !== VDP_DEX_FRAME_IDLE || (!this.streamIngress.hasOpenDirectFifoIngress() && !this.canAcceptSubmittedFrame())) {
			this.rejectBusySubmitAttempt(this.memory.readIoU32(IO_VDP_FIFO));
			return;
		}
		this.acceptSubmitAttempt();
		this.pushVdpFifoWord(this.memory.readIoU32(IO_VDP_FIFO));
	}

	private onVdpFifoCtrlWrite(): void {
		if ((this.memory.readIoU32(IO_VDP_FIFO_CTRL) & VDP_FIFO_CTRL_SEAL) === 0) {
			return;
		}
		if (this.streamIngress.dmaSubmitActive) {
			this.rejectBusySubmitAttempt(VDP_FIFO_CTRL_SEAL);
			return;
		}
		this.sealVdpFifoTransfer();
		this.refreshSubmitBusyStatus();
	}

	private onVdpCommandWrite(): void {
		const command = this.memory.readIoU32(IO_VDP_CMD);
		if (command === VDP_CMD_NOP) {
			return;
		}
		const directFrameCommand = command === VDP_CMD_BEGIN_FRAME || command === VDP_CMD_END_FRAME || this.buildFrame.state === VDP_DEX_FRAME_DIRECT_OPEN;
		if (!directFrameCommand && this.hasBlockedSubmitPath()) {
			this.rejectBusySubmitAttempt(command);
			return;
		}
		if (command === VDP_CMD_BEGIN_FRAME && this.buildFrame.state === VDP_DEX_FRAME_IDLE && this.hasBlockedSubmitPath()) {
			this.rejectBusySubmitAttempt(command);
			return;
		}
		if (command !== VDP_CMD_BEGIN_FRAME && command !== VDP_CMD_END_FRAME && this.buildFrame.state === VDP_DEX_FRAME_IDLE) {
			this.rejectSubmitAttempt();
		} else {
			this.acceptSubmitAttempt();
		}
		this.consumeDirectVdpCommand(command);
	}

	public setTiming(cpuHz: number, workUnitsPerSec: number, nowCycles: number): void {
		this.cpuHz = cpuHz;
		this.workUnitsPerSec = workUnitsPerSec;
		this.workCarry = 0;
		this.availableWorkUnits = 0;
		this.scheduleNextService(nowCycles);
	}

	public accrueCycles(cycles: number, nowCycles: number): void {
		if (!this.hasPendingRenderWork() || cycles <= 0) {
			return;
		}
		accrueBudgetUnits(this.budgetAccrual, this.cpuHz, this.workUnitsPerSec, this.workCarry, cycles);
		const wholeUnits = this.budgetAccrual.wholeUnits;
		this.workCarry = this.budgetAccrual.carry;
		if (wholeUnits > 0) {
			const remainingWork = this.getPendingRenderWorkUnits() - this.availableWorkUnits;
			const maxGrant = remainingWork <= 0 ? 0 : remainingWork;
			this.availableWorkUnits += wholeUnits > maxGrant ? maxGrant : wholeUnits;
		}
		this.scheduleNextService(nowCycles);
	}

	public onService(nowCycles: number): void {
		if (this.needsImmediateSchedulerService()) {
			this.promotePendingFrame();
		}
		if (this.hasPendingRenderWork() && this.availableWorkUnits > 0) {
			const pendingBefore = this.getPendingRenderWorkUnits();
			this.advanceWork(this.availableWorkUnits);
			const pendingAfter = this.getPendingRenderWorkUnits();
			const consumed = pendingBefore - pendingAfter;
			if (consumed > 0) {
				this.availableWorkUnits -= consumed;
			}
		}
		this.scheduleNextService(nowCycles);
		this.refreshSubmitBusyStatus();
	}


	private resetQueuedFrameState(): void {
		resetBuildingFrame(this.buildFrame);
		resetSubmittedFrameSlot(this.activeFrame);
		this.workCarry = 0;
		this.availableWorkUnits = 0;
		this.scheduler.cancelDeviceService(DEVICE_SERVICE_VDP);
		resetSubmittedFrameSlot(this.pendingFrame);
	}

	private canAcceptSubmittedFrame(): boolean {
		return this.pendingFrame.state === VDP_SUBMITTED_FRAME_EMPTY;
	}

	private beginSubmittedFrame(state: VdpDexFrameState): boolean {
		if (this.buildFrame.state !== VDP_DEX_FRAME_IDLE) {
			this.fault.raise(VDP_FAULT_SUBMIT_STATE, VDP_CMD_BEGIN_FRAME);
			return false;
		}
		resetBuildingFrame(this.buildFrame);
		if (!this.rpu.beginFrame(this.buildFrame.rpu)) {
			return false;
		}
		this.buildFrame.state = state;
		return true;
	}

	private cancelSubmittedFrame(): void {
		resetBuildingFrame(this.buildFrame);
		this.rpu.cancelFrame(this.buildFrame.rpu);
		this.scheduleNextService(this.scheduler.currentNowCycles());
		this.refreshSubmitBusyStatus();
	}

	private sealSubmittedFrame(): boolean {
		if (this.buildFrame.state === VDP_DEX_FRAME_IDLE) {
			this.fault.raise(VDP_FAULT_SUBMIT_STATE, VDP_CMD_END_FRAME);
			return false;
		}
		const sealedByFifo = this.rpu.lastPacketSealedFrame;
		if (!sealedByFifo && !this.rpu.endFrame(this.buildFrame.rpu)) {
			return false;
		}
		const activeFrameEmpty = this.activeFrame.state === VDP_SUBMITTED_FRAME_EMPTY;
		let frame = this.activeFrame;
		if (!activeFrameEmpty) {
			if (this.pendingFrame.state !== VDP_SUBMITTED_FRAME_EMPTY) {
				this.fault.raise(VDP_FAULT_SUBMIT_BUSY, VDP_CMD_END_FRAME);
				return false;
			}
			frame = this.pendingFrame;
		}
		const buildRpu = this.buildFrame.rpu;
		const frameHasRpuCommands = buildRpu.commands.passCount !== 0 || buildRpu.commands.drawCount !== 0;
		const frameCost = this.buildFrame.cost;
		for (let index = 0; index < this.xf.matrixWords.length; index += 1) {
			frame.xf.matrixWords[index] = this.xf.matrixWords[index]!;
		}
		frame.xf.viewMatrixIndex = this.xf.viewMatrixIndex;
		frame.xf.projectionMatrixIndex = this.xf.projectionMatrixIndex;
		for (let index = 0; index < this.lpu.registerWords.length; index += 1) {
			frame.lightRegisterWords[index] = this.lpu.registerWords[index]!;
		}
		for (let index = 0; index < this.mfu.weightWords.length; index += 1) {
			frame.morphWeightWords[index] = this.mfu.weightWords[index]!;
		}
		for (let index = 0; index < this.jtu.matrixWords.length; index += 1) {
			frame.jointMatrixWords[index] = this.jtu.matrixWords[index]!;
		}
		this.buildFrame.rpu = frame.rpu;
		frame.rpu = buildRpu;
		if (frameCost === 0) {
			frame.state = VDP_SUBMITTED_FRAME_READY;
		} else if (activeFrameEmpty) {
			frame.state = VDP_SUBMITTED_FRAME_EXECUTING;
		} else {
			frame.state = VDP_SUBMITTED_FRAME_QUEUED;
		}
		frame.hasCommands = frameHasRpuCommands;
		frame.cost = frameCost;
		frame.workRemaining = frameCost;
		const voutFrame = this.vout.sealFrame();
		frame.ditherType = voutFrame.ditherType;
		frame.frameBufferWidth = voutFrame.frameBufferWidth;
		frame.frameBufferHeight = voutFrame.frameBufferHeight;
		resetBuildingFrame(this.buildFrame);
		this.scheduleNextService(this.scheduler.currentNowCycles());
		this.refreshSubmitBusyStatus();
		return true;
	}

	private promotePendingFrame(): void {
		if (this.activeFrame.state !== VDP_SUBMITTED_FRAME_EMPTY || this.pendingFrame.state === VDP_SUBMITTED_FRAME_EMPTY) {
			return;
		}
		const emptyFrame = this.activeFrame;
		this.activeFrame = this.pendingFrame;
		this.pendingFrame = emptyFrame;
		if (this.activeFrame.state === VDP_SUBMITTED_FRAME_QUEUED) {
			this.activeFrame.state = VDP_SUBMITTED_FRAME_EXECUTING;
		}
		resetSubmittedFrameSlot(this.pendingFrame);
		this.scheduleNextService(this.scheduler.currentNowCycles());
		this.refreshSubmitBusyStatus();
	}

	public advanceWork(workUnits: number): void {
		if (this.activeFrame.state === VDP_SUBMITTED_FRAME_EMPTY) {
			this.promotePendingFrame();
		}
		if (this.activeFrame.state !== VDP_SUBMITTED_FRAME_EXECUTING || workUnits <= 0) {
			return;
		}
		if (workUnits >= this.activeFrame.workRemaining) {
			this.activeFrame.workRemaining = 0;
			this.activeFrame.state = VDP_SUBMITTED_FRAME_READY;
			this.refreshSubmitBusyStatus();
			this.scheduleNextService(this.scheduler.currentNowCycles());
			return;
		}
		this.activeFrame.workRemaining -= workUnits;
	}

	public needsImmediateSchedulerService(): boolean {
		return this.activeFrame.state === VDP_SUBMITTED_FRAME_EMPTY && this.pendingFrame.state !== VDP_SUBMITTED_FRAME_EMPTY;
	}

	public hasPendingRenderWork(): boolean {
		if (this.activeFrame.state === VDP_SUBMITTED_FRAME_EMPTY) {
			return this.pendingFrame.state === VDP_SUBMITTED_FRAME_QUEUED;
		}
		return this.activeFrame.state === VDP_SUBMITTED_FRAME_EXECUTING;
	}

	public getPendingRenderWorkUnits(): number {
		if (this.activeFrame.state === VDP_SUBMITTED_FRAME_EMPTY) {
			return this.pendingFrame.cost;
		}
		if (this.activeFrame.state === VDP_SUBMITTED_FRAME_READY) {
			return 0;
		}
		return this.activeFrame.workRemaining;
	}

	private scheduleNextService(nowCycles: number): void {
		if (this.needsImmediateSchedulerService()) {
			this.scheduler.scheduleDeviceService(DEVICE_SERVICE_VDP, nowCycles);
			return;
		}
		if (!this.hasPendingRenderWork()) {
			this.scheduler.cancelDeviceService(DEVICE_SERVICE_VDP);
			return;
		}
		const pendingWork = this.getPendingRenderWorkUnits();
		const targetUnits = pendingWork < VDP_SERVICE_BATCH_WORK_UNITS ? pendingWork : VDP_SERVICE_BATCH_WORK_UNITS;
		if (this.availableWorkUnits >= targetUnits) {
			this.scheduler.scheduleDeviceService(DEVICE_SERVICE_VDP, nowCycles);
			return;
		}
		this.scheduler.scheduleDeviceService(DEVICE_SERVICE_VDP, nowCycles + cyclesUntilBudgetUnits(this.cpuHz, this.workUnitsPerSec, this.workCarry, targetUnits - this.availableWorkUnits));
	}


	private finishCommittedFrameOnVblankEdge(): void {
		this.vout.presentFrame(this.activeFrame);
		this.m_lastFrameCommitted = true;
		this.m_lastFrameHeld = false;
		resetSubmittedFrameSlot(this.activeFrame);
		this.promotePendingFrame();
		this.scheduleNextService(this.scheduler.currentNowCycles());
		this.refreshSubmitBusyStatus();
	}

	public presentReadyFrameOnVblankEdge(): void {
		if (this.activeFrame.state === VDP_SUBMITTED_FRAME_EMPTY) {
			this.m_lastFrameCommitted = false;
			this.m_lastFrameCost = 0;
			this.m_lastFrameHeld = false;
			this.promotePendingFrame();
			this.scheduleNextService(this.scheduler.currentNowCycles());
			this.refreshSubmitBusyStatus();
			return;
		}
		this.m_lastFrameCost = this.activeFrame.cost;
		if (this.activeFrame.state !== VDP_SUBMITTED_FRAME_READY) {
			this.m_lastFrameCommitted = false;
			this.m_lastFrameHeld = true;
			return;
		}
		this.finishCommittedFrameOnVblankEdge();
	}

	public get frameBufferWidth(): number {
		return this.fbm.width;
	}

	public get frameBufferHeight(): number {
		return this.fbm.height;
	}

	public get frameBufferRenderReadback(): Uint8Array {
		return this.vram.frameBufferSurface.cpuReadback;
	}

	public get frameBufferDisplayReadback(): Uint8Array {
		return this.fbm.displayReadback;
	}

	public lastFrameCommitted(): boolean {
		return this.m_lastFrameCommitted;
	}

	public lastFrameCost(): number {
		return this.m_lastFrameCost;
	}

	public lastFrameHeld(): boolean {
		return this.m_lastFrameHeld;
	}

	public writeVram(addr: number, data: Uint8Array, srcOffset = 0, length = data.byteLength - srcOffset): void {
		if (this.vram.writeRpuVram(addr, data, srcOffset, length)) {
			return;
		}
		if (!this.vram.frameBufferContains(addr, length)) {
			this.fault.raise(VDP_FAULT_VRAM_WRITE_UNMAPPED, addr);
			return;
		}
		const surface = this.vram.frameBufferSurface;
		const offset = addr - surface.baseAddr;
		if ((offset & 3) !== 0 || (length & 3) !== 0) {
			this.fault.raise(VDP_FAULT_VRAM_WRITE_UNALIGNED, addr);
			return;
		}
		if (surface.surfaceWidth === 0 || surface.surfaceHeight === 0) {
			this.fault.raise(VDP_FAULT_VRAM_WRITE_UNINITIALIZED, addr);
			return;
		}
		const stride = surface.surfaceWidth * 4;
		const rowCount = surface.surfaceHeight;
		const totalBytes = rowCount * stride;
		if (offset + length > totalBytes) {
			this.fault.raise(VDP_FAULT_VRAM_WRITE_OOB, addr);
			return;
		}
		this.vram.writeSurfaceBytes(surface, offset, data, srcOffset, length);
		this.readback.invalidateFrameBuffer();
	}

	public readVram(addr: number, out: Uint8Array, length = out.byteLength): void {
		if (this.vram.readRpuVram(addr, out, length)) {
			return;
		}
		if (!this.vram.frameBufferContains(addr, length)) {
			this.fault.raise(VDP_FAULT_VRAM_WRITE_UNMAPPED, addr);
			out.fill(0, 0, length);
			return;
		}
		const surface = this.vram.frameBufferSurface;
		if (surface.surfaceWidth === 0 || surface.surfaceHeight === 0) {
			this.fault.raise(VDP_FAULT_VRAM_WRITE_UNINITIALIZED, addr);
			out.fill(0, 0, length);
			return;
		}
		const offset = addr - surface.baseAddr;
		const stride = surface.surfaceWidth * 4;
		const totalBytes = surface.surfaceHeight * stride;
		if (offset + length > totalBytes) {
			this.fault.raise(VDP_FAULT_VRAM_WRITE_OOB, addr);
			out.fill(0, 0, length);
			return;
		}
		this.vram.readSurfaceBytes(surface, offset, out, length);
	}

	public beginFrame(): void {
		this.readback.beginFrame();
		this.scheduleNextService(this.scheduler.currentNowCycles());
	}

	public readVdpData(): number {
		const surfaceId = this.memory.readIoU32(IO_VDP_RD_SURFACE);
		const x = this.memory.readIoU32(IO_VDP_RD_X);
		const y = this.memory.readIoU32(IO_VDP_RD_Y);
		const mode = this.memory.readIoU32(IO_VDP_RD_MODE);
		return this.readback.read(this.vram.frameBufferSurface, surfaceId, mode, x, y);
	}

	public initializeRegisters(): void {
		const dither = 0;
		this.vdpModeWord = PSX_MODEL_PROFILE.biosVdpMode;
		const vdpModeProfile = getMachineVdpModeProfile(this.vdpModeWord);
		const frameBuffer = this.vram.frameBufferSurface;
		this.fbm.configure(frameBuffer.surfaceWidth, frameBuffer.surfaceHeight);
		this.resetQueuedFrameState();
		this.resetIngressState();
		this.resetStatus();
		this.memory.writeIoValue(IO_VDP_RD_SURFACE, VDP_RD_SURFACE_FRAMEBUFFER);
		this.memory.writeIoValue(IO_VDP_RD_X, 0);
		this.memory.writeIoValue(IO_VDP_RD_Y, 0);
		this.memory.writeIoValue(IO_VDP_RD_MODE, VDP_RD_MODE_RGBA8888);
		this.memory.writeIoValue(IO_VDP_DITHER, dither);
		this.memory.writeIoValue(IO_VDP_MODE, this.vdpModeWord);
		this.memory.writeIoValue(IO_VDP_SCREEN_WH, packLowHigh16(vdpModeProfile.renderWidth, vdpModeProfile.renderHeight));
		this.memory.writeIoValue(IO_VDP_CMD, 0);
		this.resetVdpRegisters();
		this.xf.reset();
		this.lpu.reset();
		this.mfu.reset();
		this.jtu.reset();
		this.vout.reset(dither, this.fbm.width, this.fbm.height);
		this.rpu.reset();
		this.m_lastFrameCommitted = true;
		this.m_lastFrameCost = 0;
		this.m_lastFrameHeld = false;
	}

	public captureVisualStateFields(state: VdpState): void {
		state.vdpModeWord = this.vdpModeWord;
		state.xf = this.xf.captureState();
		const vdpRegisterWords = state.vdpRegisterWords;
		for (let index = 0; index < VDP_REGISTER_COUNT; index += 1) {
			vdpRegisterWords[index] = this.vdpRegisters[index]!;
		}
		state.buildFrame = captureBuildingFrameState(this.buildFrame);
		state.activeFrame = captureSubmittedFrameState(this.activeFrame);
		state.pendingFrame = captureSubmittedFrameState(this.pendingFrame);
		state.rpu = this.rpu.captureState();
		state.vram = this.vram.captureState();
		state.workCarry = this.workCarry;
		state.availableWorkUnits = this.availableWorkUnits;
		state.streamIngress = this.streamIngress.captureState();
		state.readback = this.readback.captureState();
		const lightRegisterWords = state.lightRegisterWords;
		for (let index = 0; index < this.lpu.registerWords.length; index += 1) {
			lightRegisterWords[index] = this.lpu.registerWords[index]!;
		}
		const morphWeightWords = state.morphWeightWords;
		for (let index = 0; index < this.mfu.weightWords.length; index += 1) {
			morphWeightWords[index] = this.mfu.weightWords[index]!;
		}
		const jointMatrixWords = state.jointMatrixWords;
		for (let index = 0; index < this.jtu.matrixWords.length; index += 1) {
			jointMatrixWords[index] = this.jtu.matrixWords[index]!;
		}
		state.ditherType = this.vout.liveDitherType;
		state.vdpFaultCode = this.fault.code;
		state.vdpFaultDetail = this.fault.detail;
	}

	public captureState(): VdpState {
		const state = {
			vdpRegisterWords: [],
			lightRegisterWords: [],
			morphWeightWords: [],
			jointMatrixWords: [],
		} as VdpState;
		this.captureVisualStateFields(state);
		return state;
	}

	public captureSaveState(): VdpSaveState {
		const state = this.captureState() as VdpSaveState;
		state.displayFrameBufferPixels = this.fbm.captureDisplayReadback();
		return state;
	}

	public restoreState(state: VdpState): void {
		this.writeModeWord(state.vdpModeWord);
		this.xf.restoreState(state.xf);
		for (let index = 0; index < VDP_REGISTER_COUNT; index += 1) {
			this.vdpRegisters[index] = state.vdpRegisterWords[index]!;
		}
		restoreBuildingFrameState(this.buildFrame, state.buildFrame);
		restoreSubmittedFrameState(this.activeFrame, state.activeFrame);
		restoreSubmittedFrameState(this.pendingFrame, state.pendingFrame);
		this.rpu.restoreState(state.rpu);
		this.vram.restoreState(state.vram);
		this.workCarry = state.workCarry;
		this.availableWorkUnits = state.availableWorkUnits;
		this.streamIngress.restoreState(state.streamIngress);
		this.readback.restoreState(state.readback);
		for (let index = 0; index < VDP_REGISTER_COUNT; index += 1) {
			this.memory.writeIoValue(IO_VDP_REG0 + index * IO_WORD_SIZE, this.vdpRegisters[index]);
		}
		for (let index = 0; index < this.lpu.registerWords.length; index += 1) {
			this.lpu.registerWords[index] = state.lightRegisterWords[index]!;
		}
		for (let index = 0; index < this.mfu.weightWords.length; index += 1) {
			this.mfu.weightWords[index] = state.morphWeightWords[index]!;
		}
		for (let index = 0; index < this.jtu.matrixWords.length; index += 1) {
			this.jtu.matrixWords[index] = state.jointMatrixWords[index]!;
		}
		this.memory.writeValue(IO_VDP_DITHER, state.ditherType);
		this.fault.restore(0, state.vdpFaultCode, state.vdpFaultDetail);
		this.fault.setStatusFlag(VDP_STATUS_FAULT, this.fault.code !== VDP_FAULT_NONE);
		this.refreshSubmitBusyStatus();
		this.scheduler.cancelDeviceService(DEVICE_SERVICE_VDP);
		if (this.needsImmediateSchedulerService() || this.hasPendingRenderWork()) {
			this.scheduleNextService(this.scheduler.currentNowCycles());
		}
		this.vout.presentLiveState();
	}

	public restoreSaveState(state: VdpSaveState): void {
		this.restoreState(state);
		this.bindVramSurfaces();
		this.fbm.restoreDisplayReadback(state.displayFrameBufferPixels);
		this.vout.presentLiveState();
	}

	// disable-next-line single_line_method_pattern -- VDP host-output transaction is the public device boundary; VOUT owns the retained payload.
	public readDeviceOutput(): VdpDeviceOutput {
		return this.vout.readDeviceOutput(this.scheduler.currentNowCycles());
	}


	private bindVramSurfaces(): void {
		const frameBuffer = this.vram.frameBufferSurface;
		this.readback.invalidateFrameBuffer();
		this.fbm.configure(frameBuffer.surfaceWidth, frameBuffer.surfaceHeight);
		this.vout.configureScanout(frameBuffer.surfaceWidth, frameBuffer.surfaceHeight);
		this.vout.presentLiveState();
	}

	private resizeFrameBufferSurface(width: number, height: number): void {
		this.vram.setSurfaceLogicalDimensions(this.vram.frameBufferSurface, width, height);
		this.readback.invalidateFrameBuffer();
		this.fbm.configure(width, height);
		this.vout.configureScanout(width, height);
	}

	public setDecodedVramSurfaceDimensions(baseAddr: number, width: number, height: number): void {
		if (baseAddr !== VRAM_FRAMEBUFFER_BASE) {
			this.fault.raise(VDP_FAULT_VRAM_WRITE_UNMAPPED, baseAddr);
			return;
		}
		this.resizeFrameBufferSurface(width, height);
	}

	public get trackedUsedVramBytes(): number {
		return this.vram.trackedUsedBytes;
	}

	public get trackedTotalVramBytes(): number {
		return this.vram.trackedTotalBytes;
	}

}
