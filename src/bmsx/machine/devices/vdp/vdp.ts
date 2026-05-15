import {
	type Layer2D,
	SKYBOX_FACE_WORD_COUNT,
	VDP_RD_SURFACE_SYSTEM,
	VDP_RD_SURFACE_FRAMEBUFFER,
	VDP_RD_SURFACE_PRIMARY,
	VDP_FRAMEBUFFER_PAGE_RENDER,
	VDP_RD_SURFACE_SECONDARY,
	VDP_FIFO_CTRL_SEAL,
	VDP_FAULT_NONE,
	VDP_FAULT_RD_OOB,
	VDP_FAULT_RD_SURFACE,
	VDP_FAULT_STREAM_BAD_PACKET,
	VDP_FAULT_SUBMIT_STATE,
	VDP_FAULT_CMD_BAD_DOORBELL,
	VDP_FAULT_SUBMIT_BUSY,
	VDP_FAULT_DEX_INVALID_LINE_WIDTH,
	VDP_FAULT_DEX_INVALID_SCALE,
	VDP_FAULT_DEX_OVERFLOW,
	VDP_FAULT_DEX_SOURCE_OOB,
	VDP_FAULT_DEX_SOURCE_SLOT,
	VDP_FAULT_DEX_UNSUPPORTED_DRAW_CTRL,
	VDP_FAULT_BBU_SOURCE_OOB,
	VDP_FAULT_BBU_ZERO_SIZE,
	VDP_FAULT_MDU_BAD_JOINT_RANGE,
	VDP_FAULT_MDU_BAD_MORPH_RANGE,
	VDP_FAULT_VRAM_WRITE_OOB,
	VDP_FAULT_VRAM_SLOT_DIM,
	VDP_FAULT_VRAM_WRITE_UNALIGNED,
	VDP_FAULT_VRAM_WRITE_UNINITIALIZED,
	VDP_FAULT_VRAM_WRITE_UNMAPPED,
	VDP_RD_MODE_RGBA8888,
	VDP_SLOT_ATLAS_NONE,
	VDP_SLOT_PRIMARY,
	VDP_SLOT_SECONDARY,
	VDP_SLOT_SYSTEM,
	VDP_STATUS_SUBMIT_BUSY,
	VDP_STATUS_SUBMIT_REJECTED,
	VDP_STATUS_FAULT,
	VDP_STATUS_VBLANK,
	VDP_SBX_COMMIT_WRITE,
	type VdpFrameBufferPage,
} from './contracts';
import {
	VDP_RENDER_ALPHA_COST_MULTIPLIER,
	VDP_RENDER_CLEAR_COST,
	VDP_RENDER_BILLBOARD_COST,
	blitAreaBucket,
	blitSpanBucket,
	computeClippedLineSpan,
	computeClippedRect,
} from './budget';
import {
	IO_VDP_DITHER,
	IO_VDP_FAULT_CODE,
	IO_VDP_FAULT_DETAIL,
	IO_VDP_FAULT_ACK,
	IO_VDP_CMD,
	IO_VDP_FIFO,
	IO_VDP_FIFO_CTRL,
	IO_VDP_PMU_BANK,
	IO_VDP_PMU_CTRL,
	IO_VDP_PMU_SCALE_X,
	IO_VDP_PMU_SCALE_Y,
	IO_VDP_PMU_X,
	IO_VDP_PMU_Y,
	IO_VDP_REG0,
	IO_VDP_SLOT_PRIMARY_ATLAS,
	IO_VDP_SLOT_SECONDARY_ATLAS,
	IO_VDP_SBX_COMMIT,
	IO_VDP_SBX_CONTROL,
	IO_VDP_SBX_FACE0,
	IO_VDP_RD_DATA,
	IO_VDP_RD_MODE,
	IO_VDP_RD_STATUS,
	IO_VDP_RD_SURFACE,
	IO_VDP_RD_X,
	IO_VDP_RD_Y,
	IO_VDP_STATUS,
} from '../../bus/io';
import type { VramWriteSink } from '../../memory/memory';
import { Memory } from '../../memory/memory';
import { DeviceStatusLatch, type DeviceStatusRegisters } from '../device_status';
import type { Value } from '../../cpu/cpu';
import { accrueBudgetUnits, cyclesUntilBudgetUnits, type BudgetAccrual } from '../../scheduler/budget';
import { DEVICE_SERVICE_VDP, type DeviceScheduler } from '../../scheduler/device';
import {
	VDP_STREAM_BUFFER_SIZE,
	IO_WORD_SIZE,
} from '../../memory/map';
import {
	VdpPmuRegister,
	VdpPmuUnit,
} from './pmu';
import {
	type VdpSbxFrameResolution,
	VdpSbxUnit,
	VDP_SBX_PACKET_KIND,
	VDP_SBX_PACKET_PAYLOAD_WORDS,
} from './sbx';
import {
	type VdpBbuPacket,
	type VdpBbuSourceResolution,
	VdpBbuFrameBuffer,
	VdpBbuUnit,
	VDP_BBU_STATE_SOURCE_RESOLVE,
	VDP_BBU_PACKET_KIND,
	VDP_BBU_PACKET_PAYLOAD_WORDS,
} from './bbu';
import {
	VdpJtuUnit,
	VDP_JTU_PACKET_KIND,
} from './jtu';
import {
	VdpLpuUnit,
	VDP_LPU_PACKET_KIND,
	VDP_LPU_REGISTER_WORDS,
} from './lpu';
import {
	type VdpMduPacket,
	VdpMduFrameBuffer,
	VdpMduUnit,
	VDP_MDU_PACKET_KIND,
	VDP_MDU_PACKET_PAYLOAD_WORDS,
} from './mdu';
import {
	VdpMfuUnit,
	VDP_MFU_PACKET_KIND,
} from './mfu';
import {
	VDP_XF_REGISTER_WORDS,
	VDP_XF_PACKET_KIND,
	VdpXfUnit,
} from './xf';
import { VdpVoutUnit } from './vout';
import { decodeSignedQ16_16 } from './fixed_point';
import { isVdpUnitPacketHeaderValid, vdpUnitPacketHasFlags, vdpUnitPacketPayloadWords } from './packet';
import { packedHigh16, packedLow16 } from '../../common/word';
import {
	VdpBlitterCommandBuffer,
	type VdpBlitterSource,
	VDP_BLITTER_FIFO_CAPACITY,
	VDP_BLITTER_IMPLICIT_CLEAR,
	VDP_BLITTER_OPCODE_BLIT,
	VDP_BLITTER_OPCODE_CLEAR,
	VDP_BLITTER_OPCODE_COPY_RECT,
	VDP_BLITTER_OPCODE_DRAW_LINE,
	VDP_BLITTER_OPCODE_FILL_RECT,
	VDP_BLITTER_OPCODE_GLYPH_RUN,
	VDP_BLITTER_OPCODE_TILE_RUN,
	VDP_BLITTER_WHITE,
	vdpColorAlphaByte,
} from './blitter';
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
	captureBuildingFrameState,
	createResolvedBlitterSamples,
	captureSubmittedFrameState,
	restoreBuildingFrameState,
	restoreSubmittedFrameState,
} from './frame';
import {
	VDP_CMD_BEGIN_FRAME,
	VDP_CMD_BLIT,
	VDP_CMD_CLEAR,
	VDP_CMD_COPY_RECT,
	VDP_CMD_DRAW_LINE,
	VDP_CMD_END_FRAME,
	VDP_CMD_FILL_RECT,
	VDP_CMD_NOP,
	VDP_PKT_CMD,
	VDP_PKT_END,
	VDP_PKT_KIND_MASK,
	VDP_PKT_REG1,
	VDP_PKT_REGN,
	VDP_PKT_RESERVED_MASK,
	VDP_Q16_ONE,
	VDP_REG_BG_COLOR,
	VDP_REG_DRAW_COLOR,
	VDP_REG_DRAW_CTRL,
	VDP_REG_DRAW_LAYER,
	VDP_REG_DRAW_PRIORITY,
	VDP_REG_DRAW_SCALE_X,
	VDP_REG_DRAW_SCALE_Y,
	VDP_REG_DST_X,
	VDP_REG_DST_Y,
	VDP_REG_GEOM_X0,
	VDP_REG_GEOM_X1,
	VDP_REG_GEOM_Y0,
	VDP_REG_GEOM_Y1,
	VDP_REG_LINE_WIDTH,
	VDP_REG_SLOT_DIM,
	VDP_REG_SLOT_INDEX,
	VDP_REG_SRC_SLOT,
	VDP_REG_SRC_UV,
	VDP_REG_SRC_WH,
	VDP_REGISTER_COUNT,
	decodeVdpDrawCtrl,
	type VdpDrawCtrl,
	type VdpLatchedGeometry,
} from './registers';
import {
	type VdpDeviceOutput,
	type VdpFrameBufferPresentationSink,
	type VdpSurfaceUploadSink,
	type VdpSurfaceUploadSlot,
} from './device_output';
import { VdpFbmUnit } from './fbm';
import { VdpStreamIngressUnit } from './ingress';
import { VdpReadbackUnit } from './readback';
import {
	DEFAULT_VDP_ENTROPY_SEEDS,
	defaultVdpVramSurfaces,
	type VdpEntropySeeds,
	type VdpFrameBufferSize,
	VdpVramUnit,
} from './vram';
import type { VdpSaveState, VdpState } from './save_state';

export type {
	VdpBlitterCommandBuffer as VdpBlitterCommand,
	VdpBlitterSource,
	VdpResolvedBlitterSample,
} from './blitter';

export type { VdpEntropySeeds, VdpFrameBufferSize, VdpVramSurface } from './vram';
const VDP_DEVICE_STATUS_REGISTERS: DeviceStatusRegisters = {
	statusAddr: IO_VDP_STATUS,
	codeAddr: IO_VDP_FAULT_CODE,
	detailAddr: IO_VDP_FAULT_DETAIL,
	ackAddr: IO_VDP_FAULT_ACK,
	faultMask: VDP_STATUS_FAULT,
	noneCode: VDP_FAULT_NONE,
};
const VDP_OPEN_BUS_WORD = 0;
const VDP_SERVICE_BATCH_WORK_UNITS = 128;
const VDP_SLOT_SURFACE_BINDINGS = [
	{ slot: VDP_SLOT_SYSTEM, surfaceId: VDP_RD_SURFACE_SYSTEM },
	{ slot: VDP_SLOT_PRIMARY, surfaceId: VDP_RD_SURFACE_PRIMARY },
	{ slot: VDP_SLOT_SECONDARY, surfaceId: VDP_RD_SURFACE_SECONDARY },
] as const;

export class VDP implements VramWriteSink {
	private readonly vram: VdpVramUnit;
	private readonly readback = new VdpReadbackUnit();
	private readonly fbm = new VdpFbmUnit();
	private readonly sbx = new VdpSbxUnit();
	private sbxSealSamples = createResolvedBlitterSamples();
	private readonly sbxFrameResolutionScratch: VdpSbxFrameResolution = {
		faultCode: VDP_FAULT_NONE,
		faultDetail: 0,
	};
	private readonly xf = new VdpXfUnit();
	private readonly lpu = new VdpLpuUnit();
	private readonly mfu = new VdpMfuUnit();
	private readonly jtu = new VdpJtuUnit();
	private readonly pmu = new VdpPmuUnit();
	private readonly bbu = new VdpBbuUnit();
	private readonly mdu = new VdpMduUnit();
	private readonly vout = new VdpVoutUnit();
	private readonly buildFrame: VdpBuildingFrameState = {
		queue: new VdpBlitterCommandBuffer(),
		billboards: new VdpBbuFrameBuffer(),
		meshes: new VdpMduFrameBuffer(),
		state: VDP_DEX_FRAME_IDLE,
		cost: 0,
	};
	private activeFrame: VdpSubmittedFrame = allocateSubmittedFrameSlot();
	private pendingFrame: VdpSubmittedFrame = allocateSubmittedFrameSlot();
	private frameBufferPriorityLayer = new Uint8Array(0);
	private frameBufferPriorityZ = new Float32Array(0);
	private frameBufferPrioritySeq = new Uint32Array(0);
	private readonly clippedRectScratchA = { width: 0, height: 0, area: 0 };
	private readonly latchedSourceScratch: VdpBlitterSource = { surfaceId: 0, srcX: 0, srcY: 0, width: 0, height: 0 };
	private readonly bbuSourceResolutionScratch: VdpBbuSourceResolution = {
		faultCode: VDP_FAULT_NONE,
		faultDetail: 0,
		source: {
			surfaceId: 0,
			srcX: 0,
			srcY: 0,
			width: 0,
			height: 0,
		},
		surfaceWidth: 0,
		surfaceHeight: 0,
		slot: 0,
	};
	private readonly latchedGeometryScratch: VdpLatchedGeometry = { x0: 0, y0: 0, x1: 0, y1: 0 };
	private readonly drawCtrlScratch: VdpDrawCtrl = { flipH: false, flipV: false, blendMode: 0, pmuBank: 0, parallaxWeight: 0 };
	private blitterSequence = 0;
	private cpuHz = 1;
	private workUnitsPerSec = 1;
	private workCarry = 0;
	private availableWorkUnits = 0;
	private readonly budgetAccrual: BudgetAccrual = { wholeUnits: 0, carry: 0 };
	private readonly fault: DeviceStatusLatch;
	private readonly vdpRegisters = new Uint32Array(VDP_REGISTER_COUNT);
	private readonly streamIngress = new VdpStreamIngressUnit();
	public lastFrameCommitted = true;
	public lastFrameCost = 0;
	public lastFrameHeld = false;
	public constructor(
		private readonly memory: Memory,
		private readonly scheduler: DeviceScheduler,
		private readonly configuredFrameBufferSize: VdpFrameBufferSize,
		entropySeeds: VdpEntropySeeds = DEFAULT_VDP_ENTROPY_SEEDS,
	) {
		this.fault = new DeviceStatusLatch(memory, VDP_DEVICE_STATUS_REGISTERS);
		this.vram = new VdpVramUnit(entropySeeds);
		this.memory.setVramWriter(this);
		this.memory.mapIoRead(IO_VDP_RD_STATUS, this.readback.status.bind(this.readback));
		this.memory.mapIoRead(IO_VDP_RD_DATA, this.readVdpData.bind(this));
		this.memory.mapIoWrite(IO_VDP_DITHER, this.onVdpDitherWrite.bind(this));
		this.memory.mapIoWrite(IO_VDP_FIFO, this.onVdpFifoWrite.bind(this));
		this.memory.mapIoWrite(IO_VDP_FIFO_CTRL, this.onVdpFifoCtrlWrite.bind(this));
		this.memory.mapIoWrite(IO_VDP_CMD, this.onVdpCommandWrite.bind(this));
		this.memory.mapIoWrite(IO_VDP_FAULT_ACK, this.fault.acknowledge.bind(this.fault));
		for (let index = 0; index < VDP_REGISTER_COUNT; index += 1) {
			this.memory.mapIoWrite(IO_VDP_REG0 + index * IO_WORD_SIZE, this.onVdpRegisterIoWrite.bind(this));
		}
		const pmuRegisterWindowWrite = this.onVdpPmuRegisterWindowWrite.bind(this);
		this.memory.mapIoWrite(IO_VDP_PMU_BANK, pmuRegisterWindowWrite);
		this.memory.mapIoWrite(IO_VDP_PMU_X, pmuRegisterWindowWrite);
		this.memory.mapIoWrite(IO_VDP_PMU_Y, pmuRegisterWindowWrite);
		this.memory.mapIoWrite(IO_VDP_PMU_SCALE_X, pmuRegisterWindowWrite);
		this.memory.mapIoWrite(IO_VDP_PMU_SCALE_Y, pmuRegisterWindowWrite);
		this.memory.mapIoWrite(IO_VDP_PMU_CTRL, pmuRegisterWindowWrite);
		const sbxRegisterWindowWrite = this.onVdpSbxRegisterWindowWrite.bind(this);
		this.memory.mapIoWrite(IO_VDP_SBX_CONTROL, sbxRegisterWindowWrite);
		for (let index = 0; index < SKYBOX_FACE_WORD_COUNT; index += 1) {
			this.memory.mapIoWrite(IO_VDP_SBX_FACE0 + index * IO_WORD_SIZE, sbxRegisterWindowWrite);
		}
		this.memory.mapIoWrite(IO_VDP_SBX_COMMIT, this.onVdpSbxCommitWrite.bind(this));
	}

	public initializeVramSurfaces(): void {
		this.resetQueuedFrameState();
		this.vram.initializeSurfaces(defaultVdpVramSurfaces(this.configuredFrameBufferSize));
		this.bindVramSurfaces(true);
	}

	public resetIngressState(): void {
		this.streamIngress.reset();
		this.refreshSubmitBusyStatus();
	}

	public resetStatus(): void {
		this.fault.resetStatus();
		this.refreshSubmitBusyStatus();
	}

	private resetVdpRegisters(): void {
		let slotDim = 1 | (1 << 16);
		const primarySlot = this.vram.findSurface(VDP_RD_SURFACE_PRIMARY);
		if (primarySlot !== null) {
			slotDim = (primarySlot.surfaceWidth & 0xffff) | ((primarySlot.surfaceHeight & 0xffff) << 16);
		}
		this.vdpRegisters.fill(0);
		this.vdpRegisters[VDP_REG_SRC_SLOT] = VDP_SLOT_PRIMARY;
		this.vdpRegisters[VDP_REG_LINE_WIDTH] = VDP_Q16_ONE;
		this.vdpRegisters[VDP_REG_DRAW_SCALE_X] = VDP_Q16_ONE;
		this.vdpRegisters[VDP_REG_DRAW_SCALE_Y] = VDP_Q16_ONE;
		this.vdpRegisters[VDP_REG_DRAW_COLOR] = 0xffffffff;
		this.vdpRegisters[VDP_REG_BG_COLOR] = 0xff000000;
		this.vdpRegisters[VDP_REG_SLOT_INDEX] = VDP_SLOT_PRIMARY;
		this.vdpRegisters[VDP_REG_SLOT_DIM] = slotDim >>> 0;
		for (let index = 0; index < VDP_REGISTER_COUNT; index += 1) {
			this.memory.writeIoValue(IO_VDP_REG0 + index * IO_WORD_SIZE, this.vdpRegisters[index]);
		}
	}

	private writeVdpRegister(index: number, value: number): boolean {
		if (index < 0 || index >= VDP_REGISTER_COUNT) {
			this.fault.raise(VDP_FAULT_STREAM_BAD_PACKET, index);
			return false;
		}
		const word = value >>> 0;
		switch (index) {
			case VDP_REG_SLOT_DIM:
				this.configureSelectedSlotDimension(word);
				break;
		}
		this.vdpRegisters[index] = word;
		this.memory.writeIoValue(IO_VDP_REG0 + index * IO_WORD_SIZE, word);
		return true;
	}

	private onVdpRegisterIoWrite(addr: number): void {
		const index = ((addr - IO_VDP_REG0) / IO_WORD_SIZE) >>> 0;
		this.writeVdpRegister(index, this.memory.readIoU32(addr));
	}

	private onVdpDitherWrite(_addr: number, value: Value): void {
		const ditherType = (value as number) | 0;
		this.vout.writeDitherType(ditherType);
	}

	private writePmuBankSelect(value: number): void {
		this.pmu.selectBank(value);
		this.syncPmuRegisterWindow();
	}

	private onVdpPmuRegisterWindowWrite(addr: number): void {
		const word = this.memory.readIoU32(addr) >>> 0;
		switch (addr) {
			case IO_VDP_PMU_BANK:
				this.writePmuBankSelect(word);
				return;
			case IO_VDP_PMU_X:
				this.pmu.writeSelectedBankRegister(VdpPmuRegister.X, word);
				break;
			case IO_VDP_PMU_Y:
				this.pmu.writeSelectedBankRegister(VdpPmuRegister.Y, word);
				break;
			case IO_VDP_PMU_SCALE_X:
				this.pmu.writeSelectedBankRegister(VdpPmuRegister.ScaleX, word);
				break;
			case IO_VDP_PMU_SCALE_Y:
				this.pmu.writeSelectedBankRegister(VdpPmuRegister.ScaleY, word);
				break;
			case IO_VDP_PMU_CTRL:
				this.pmu.writeSelectedBankRegister(VdpPmuRegister.Control, word);
				break;
		}
		this.memory.writeIoValue(addr, word);
	}

	private syncPmuRegisterWindow(): void {
		const window = this.pmu.registerWindow();
		this.memory.writeIoValue(IO_VDP_PMU_BANK, window.bank);
		this.memory.writeIoValue(IO_VDP_PMU_X, window.x);
		this.memory.writeIoValue(IO_VDP_PMU_Y, window.y);
		this.memory.writeIoValue(IO_VDP_PMU_SCALE_X, window.scaleX);
		this.memory.writeIoValue(IO_VDP_PMU_SCALE_Y, window.scaleY);
		this.memory.writeIoValue(IO_VDP_PMU_CTRL, window.control);
	}

	private onVdpSbxRegisterWindowWrite(addr: number, value: Value): void {
		if (addr === IO_VDP_SBX_CONTROL) {
			this.sbx.writeFaceWindowControl(value as number);
			return;
		}
		this.sbx.writeFaceWindowWord((addr - IO_VDP_SBX_FACE0) / IO_WORD_SIZE, value as number);
	}

	private onVdpSbxCommitWrite(): void {
		if ((this.memory.readIoU32(IO_VDP_SBX_COMMIT) & VDP_SBX_COMMIT_WRITE) === 0) {
			return;
		}
		this.sbx.commitFaceWindow();
	}

	private syncSbxRegisterWindow(): void {
		const words = this.sbx.liveFaceState;
		this.memory.writeIoValue(IO_VDP_SBX_CONTROL, this.sbx.liveControlWord);
		for (let index = 0; index < SKYBOX_FACE_WORD_COUNT; index += 1) {
			this.memory.writeIoValue(IO_VDP_SBX_FACE0 + index * IO_WORD_SIZE, words[index]);
		}
		this.memory.writeIoValue(IO_VDP_SBX_COMMIT, 0);
	}

	private configureSelectedSlotDimension(word: number): void {
		const width = packedLow16(word);
		const height = packedHigh16(word);
		if (width === 0 || height === 0) {
			this.fault.raise(VDP_FAULT_VRAM_SLOT_DIM, word);
			return;
		}
		let surfaceId = -1;
		const slotId = this.vdpRegisters[VDP_REG_SLOT_INDEX];
		for (const binding of VDP_SLOT_SURFACE_BINDINGS) {
			if (binding.slot === slotId) {
				surfaceId = binding.surfaceId;
				break;
			}
		}
		if (surfaceId < 0) {
			this.fault.raise(VDP_FAULT_VRAM_SLOT_DIM, slotId);
			return;
		}
			const slot = this.vram.findSurface(surfaceId);
			if (slot === null) {
				this.fault.raise(VDP_FAULT_VRAM_SLOT_DIM, surfaceId);
				return;
			}
		if (width * height * 4 > slot.capacity) {
			this.fault.raise(VDP_FAULT_VRAM_SLOT_DIM, word);
			return;
		}
		this.resizeVramSlot(slot, width, height, word);
	}

	private readLatchedGeometry(target: VdpLatchedGeometry): VdpLatchedGeometry {
		target.x0 = decodeSignedQ16_16(this.vdpRegisters[VDP_REG_GEOM_X0]);
		target.y0 = decodeSignedQ16_16(this.vdpRegisters[VDP_REG_GEOM_Y0]);
		target.x1 = decodeSignedQ16_16(this.vdpRegisters[VDP_REG_GEOM_X1]);
		target.y1 = decodeSignedQ16_16(this.vdpRegisters[VDP_REG_GEOM_Y1]);
		return target;
	}


	public setScanoutTiming(vblankActive: boolean, cyclesIntoFrame: number, cyclesPerFrame: number, vblankStartCycle: number): void {
		this.vout.setScanoutTiming(cyclesIntoFrame, cyclesPerFrame, vblankStartCycle, this.scheduler.currentNowCycles());
		this.fault.setStatusFlag(VDP_STATUS_VBLANK, vblankActive);
	}

	public canAcceptVdpSubmit(): boolean {
		return !this.hasBlockedSubmitPath();
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

	public sealDmaTransfer(src: number, byteLength: number): boolean {
		const accepted = this.consumeSealedVdpStream(src, byteLength);
		this.endDmaSubmit();
		return accepted;
	}

	public writeVdpFifoBytes(bytes: Uint8Array): void {
		const overflowDetail = this.streamIngress.writeBytes(bytes);
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

	private consumeSealedVdpStream(baseAddr: number, byteLength: number): boolean {
		if ((byteLength & 3) !== 0) {
			this.fault.raise(VDP_FAULT_STREAM_BAD_PACKET, byteLength);
			return false;
		}
		if (byteLength > VDP_STREAM_BUFFER_SIZE) {
			this.fault.raise(VDP_FAULT_STREAM_BAD_PACKET, byteLength);
			return false;
		}
		if (this.buildFrame.state !== VDP_DEX_FRAME_IDLE) {
			this.fault.raise(VDP_FAULT_STREAM_BAD_PACKET, VDP_CMD_BEGIN_FRAME);
			this.cancelSubmittedFrame();
			return false;
		}
		let cursor = baseAddr;
		const end = baseAddr + byteLength;
		if (!this.beginSubmittedFrame(VDP_DEX_FRAME_STREAM_OPEN)) {
			return false;
		}
		let ended = false;
		while (cursor < end) {
			const word = this.memory.readU32(cursor) >>> 0;
			cursor += IO_WORD_SIZE;
			if (word === VDP_PKT_END) {
				if (cursor !== end) {
					this.fault.raise(VDP_FAULT_STREAM_BAD_PACKET, word);
					this.cancelSubmittedFrame();
					return false;
				}
				ended = true;
				break;
			}
			const next = this.consumeReplayPacketFromMemory(word, cursor, end);
			if (next < 0) {
				this.cancelSubmittedFrame();
				return false;
			}
			cursor = next;
		}
		if (!ended) {
			this.fault.raise(VDP_FAULT_STREAM_BAD_PACKET, byteLength);
			this.cancelSubmittedFrame();
			return false;
		}
		const accepted = this.sealSubmittedFrame();
		if (!accepted) {
			this.cancelSubmittedFrame();
		}
		this.refreshSubmitBusyStatus();
		return accepted;
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
			const next = this.consumeReplayPacketFromWords(words, word, cursor, wordCount);
			if (next < 0) {
				this.cancelSubmittedFrame();
				return;
			}
			cursor = next;
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
				return this.consumeReplayCommandPacket(word) ? cursor : -1;
			case VDP_PKT_REG1: {
				const register = this.decodeReg1Packet(word);
				if (register < 0 || cursor + IO_WORD_SIZE > end) {
					this.fault.raise(VDP_FAULT_STREAM_BAD_PACKET, word);
					return -1;
				}
				return this.writeVdpRegister(register, this.memory.readU32(cursor)) ? cursor + IO_WORD_SIZE : -1;
			}
			case VDP_PKT_REGN: {
				const packet = this.decodeRegnPacket(word);
				if (packet === null) {
					this.fault.raise(VDP_FAULT_STREAM_BAD_PACKET, word);
					return -1;
				}
				const byteCount = packet.count * IO_WORD_SIZE;
				const payloadEnd = cursor + byteCount;
				if (payloadEnd > end) {
					this.fault.raise(VDP_FAULT_STREAM_BAD_PACKET, word);
					return -1;
				}
				for (let offset = 0; offset < packet.count; offset += 1) {
					if (!this.writeVdpRegister(packet.firstRegister + offset, this.memory.readU32(cursor + offset * IO_WORD_SIZE))) {
						return -1;
					}
				}
				return payloadEnd;
			}
			case VDP_BBU_PACKET_KIND: {
				if (!isVdpUnitPacketHeaderValid(word, VDP_BBU_PACKET_PAYLOAD_WORDS)) {
					this.fault.raise(VDP_FAULT_STREAM_BAD_PACKET, word);
					return -1;
				}
				const byteCount = VDP_BBU_PACKET_PAYLOAD_WORDS * IO_WORD_SIZE;
				const payloadEnd = cursor + byteCount;
				if (payloadEnd > end) {
					this.fault.raise(VDP_FAULT_STREAM_BAD_PACKET, word);
					return -1;
				}
				const controlWord = this.memory.readU32(cursor + IO_WORD_SIZE * 10);
				if (controlWord !== 0) {
					this.fault.raise(VDP_FAULT_STREAM_BAD_PACKET, controlWord);
					return -1;
				}
				return this.latchBillboardPacket(this.bbu.decodePacket(
					this.memory.readU32(cursor),
					this.memory.readU32(cursor + IO_WORD_SIZE),
					this.memory.readU32(cursor + IO_WORD_SIZE * 2),
					this.memory.readU32(cursor + IO_WORD_SIZE * 3),
					this.memory.readU32(cursor + IO_WORD_SIZE * 4),
					this.memory.readU32(cursor + IO_WORD_SIZE * 5),
					this.memory.readU32(cursor + IO_WORD_SIZE * 6),
					this.memory.readU32(cursor + IO_WORD_SIZE * 7),
					this.memory.readU32(cursor + IO_WORD_SIZE * 8),
					this.memory.readU32(cursor + IO_WORD_SIZE * 9),
				)) ? payloadEnd : -1;
			}
			case VDP_XF_PACKET_KIND:
			case VDP_LPU_PACKET_KIND:
			case VDP_MFU_PACKET_KIND:
			case VDP_JTU_PACKET_KIND:
				return this.consumeUnitRegisterPacketFromMemory(word, cursor, end);
			case VDP_MDU_PACKET_KIND: {
				if (!isVdpUnitPacketHeaderValid(word, VDP_MDU_PACKET_PAYLOAD_WORDS)) {
					this.fault.raise(VDP_FAULT_STREAM_BAD_PACKET, word);
					return -1;
				}
				const byteCount = VDP_MDU_PACKET_PAYLOAD_WORDS * IO_WORD_SIZE;
				const payloadEnd = cursor + byteCount;
				if (payloadEnd > end) {
					this.fault.raise(VDP_FAULT_STREAM_BAD_PACKET, word);
					return -1;
				}
				const reserved = this.memory.readU32(cursor + IO_WORD_SIZE * 9);
				if (reserved !== 0) {
					this.fault.raise(VDP_FAULT_STREAM_BAD_PACKET, reserved);
					return -1;
				}
				return this.latchMeshPacket(this.mdu.decodePacket(
					this.memory.readU32(cursor),
					this.memory.readU32(cursor + IO_WORD_SIZE),
					this.memory.readU32(cursor + IO_WORD_SIZE * 2),
					this.memory.readU32(cursor + IO_WORD_SIZE * 3),
					this.memory.readU32(cursor + IO_WORD_SIZE * 4),
					this.memory.readU32(cursor + IO_WORD_SIZE * 5),
					this.memory.readU32(cursor + IO_WORD_SIZE * 6),
					this.memory.readU32(cursor + IO_WORD_SIZE * 7),
					this.memory.readU32(cursor + IO_WORD_SIZE * 8),
				)) ? payloadEnd : -1;
			}
			case VDP_SBX_PACKET_KIND: {
				if (!isVdpUnitPacketHeaderValid(word, VDP_SBX_PACKET_PAYLOAD_WORDS)) {
					this.fault.raise(VDP_FAULT_STREAM_BAD_PACKET, word);
					return -1;
				}
				const byteCount = VDP_SBX_PACKET_PAYLOAD_WORDS * IO_WORD_SIZE;
				const payloadEnd = cursor + byteCount;
				if (payloadEnd > end) {
					this.fault.raise(VDP_FAULT_STREAM_BAD_PACKET, word);
					return -1;
				}
				const control = this.memory.readU32(cursor);
				const faceWords = this.sbx.beginPacket(control);
				for (let index = 0; index < SKYBOX_FACE_WORD_COUNT; index += 1) {
					faceWords[index] = this.memory.readU32(cursor + IO_WORD_SIZE * (index + 1));
				}
				this.sbx.commitPacket();
				return payloadEnd;
			}
			default:
				this.fault.raise(VDP_FAULT_STREAM_BAD_PACKET, word);
				return -1;
		}
	}

	private consumeUnitRegisterPacketFromMemory(word: number, cursor: number, end: number): number {
		if (vdpUnitPacketHasFlags(word)) {
			this.fault.raise(VDP_FAULT_STREAM_BAD_PACKET, word);
			return -1;
		}
		const payloadWords = vdpUnitPacketPayloadWords(word);
		if (payloadWords < 2) {
			this.fault.raise(VDP_FAULT_STREAM_BAD_PACKET, word);
			return -1;
		}
		const payloadEnd = cursor + payloadWords * IO_WORD_SIZE;
		if (payloadEnd > end) {
			this.fault.raise(VDP_FAULT_STREAM_BAD_PACKET, word);
			return -1;
		}
		const packetKind = word & VDP_PKT_KIND_MASK;
		const firstRegister = this.memory.readU32(cursor);
		const registerCount = payloadWords - 1;
		if (!this.acceptUnitRegisterRange(packetKind, firstRegister, registerCount)) {
			return -1;
		}
		for (let offset = 0; offset < registerCount; offset += 1) {
			if (!this.writeUnitRegisterWord(packetKind, firstRegister + offset, this.memory.readU32(cursor + (offset + 1) * IO_WORD_SIZE))) {
				return -1;
			}
		}
		return payloadEnd;
	}

	private consumeReplayPacketFromWords(words: Uint32Array, word: number, cursor: number, wordCount: number): number {
		const kind = word & VDP_PKT_KIND_MASK;
		switch (kind) {
			case VDP_PKT_CMD:
				return this.consumeReplayCommandPacket(word) ? cursor : -1;
			case VDP_PKT_REG1: {
				const register = this.decodeReg1Packet(word);
				if (register < 0 || cursor >= wordCount) {
					this.fault.raise(VDP_FAULT_STREAM_BAD_PACKET, word);
					return -1;
				}
				return this.writeVdpRegister(register, words[cursor]) ? cursor + 1 : -1;
			}
			case VDP_PKT_REGN: {
				const packet = this.decodeRegnPacket(word);
				if (packet === null || cursor + packet.count > wordCount) {
					this.fault.raise(VDP_FAULT_STREAM_BAD_PACKET, word);
					return -1;
				}
				for (let offset = 0; offset < packet.count; offset += 1) {
					if (!this.writeVdpRegister(packet.firstRegister + offset, words[cursor + offset])) {
						return -1;
					}
				}
				return cursor + packet.count;
			}
			case VDP_BBU_PACKET_KIND:
				if (!isVdpUnitPacketHeaderValid(word, VDP_BBU_PACKET_PAYLOAD_WORDS) || cursor + VDP_BBU_PACKET_PAYLOAD_WORDS > wordCount) {
					this.fault.raise(VDP_FAULT_STREAM_BAD_PACKET, word);
					return -1;
				}
				if (words[cursor + 10] !== 0) {
					this.fault.raise(VDP_FAULT_STREAM_BAD_PACKET, words[cursor + 10]);
					return -1;
				}
				return this.latchBillboardPacket(this.bbu.decodePacket(
					words[cursor],
					words[cursor + 1],
					words[cursor + 2],
					words[cursor + 3],
					words[cursor + 4],
					words[cursor + 5],
					words[cursor + 6],
					words[cursor + 7],
					words[cursor + 8],
					words[cursor + 9],
				)) ? cursor + VDP_BBU_PACKET_PAYLOAD_WORDS : -1;
			case VDP_XF_PACKET_KIND:
			case VDP_LPU_PACKET_KIND:
			case VDP_MFU_PACKET_KIND:
			case VDP_JTU_PACKET_KIND:
				return this.consumeUnitRegisterPacketFromWords(words, word, cursor, wordCount);
			case VDP_MDU_PACKET_KIND:
				if (!isVdpUnitPacketHeaderValid(word, VDP_MDU_PACKET_PAYLOAD_WORDS) || cursor + VDP_MDU_PACKET_PAYLOAD_WORDS > wordCount) {
					this.fault.raise(VDP_FAULT_STREAM_BAD_PACKET, word);
					return -1;
				}
				if (words[cursor + 9] !== 0) {
					this.fault.raise(VDP_FAULT_STREAM_BAD_PACKET, words[cursor + 9]);
					return -1;
				}
				return this.latchMeshPacket(this.mdu.decodePacket(
					words[cursor],
					words[cursor + 1],
					words[cursor + 2],
					words[cursor + 3],
					words[cursor + 4],
					words[cursor + 5],
					words[cursor + 6],
					words[cursor + 7],
					words[cursor + 8],
				)) ? cursor + VDP_MDU_PACKET_PAYLOAD_WORDS : -1;
			case VDP_SBX_PACKET_KIND:
				if (!isVdpUnitPacketHeaderValid(word, VDP_SBX_PACKET_PAYLOAD_WORDS) || cursor + VDP_SBX_PACKET_PAYLOAD_WORDS > wordCount) {
					this.fault.raise(VDP_FAULT_STREAM_BAD_PACKET, word);
					return -1;
				}
				const faceWords = this.sbx.beginPacket(words[cursor]);
				for (let index = 0; index < SKYBOX_FACE_WORD_COUNT; index += 1) {
					faceWords[index] = words[cursor + index + 1];
				}
				this.sbx.commitPacket();
				return cursor + VDP_SBX_PACKET_PAYLOAD_WORDS;
			default:
				this.fault.raise(VDP_FAULT_STREAM_BAD_PACKET, word);
				return -1;
		}
	}

	private consumeUnitRegisterPacketFromWords(words: Uint32Array, word: number, cursor: number, wordCount: number): number {
		if (vdpUnitPacketHasFlags(word)) {
			this.fault.raise(VDP_FAULT_STREAM_BAD_PACKET, word);
			return -1;
		}
		const payloadWords = vdpUnitPacketPayloadWords(word);
		if (payloadWords < 2 || cursor + payloadWords > wordCount) {
			this.fault.raise(VDP_FAULT_STREAM_BAD_PACKET, word);
			return -1;
		}
		const packetKind = word & VDP_PKT_KIND_MASK;
		const firstRegister = words[cursor];
		const registerCount = payloadWords - 1;
		if (!this.acceptUnitRegisterRange(packetKind, firstRegister, registerCount)) {
			return -1;
		}
		for (let offset = 0; offset < registerCount; offset += 1) {
			if (!this.writeUnitRegisterWord(packetKind, firstRegister + offset, words[cursor + offset + 1])) {
				return -1;
			}
		}
		return cursor + payloadWords;
	}

	private acceptUnitRegisterRange(packetKind: number, firstRegister: number, registerCount: number): boolean {
		switch (packetKind) {
			case VDP_XF_PACKET_KIND:
				if (firstRegister >= VDP_XF_REGISTER_WORDS || registerCount > VDP_XF_REGISTER_WORDS - firstRegister) {
					this.fault.raise(VDP_FAULT_STREAM_BAD_PACKET, firstRegister);
					return false;
				}
				return true;
			case VDP_LPU_PACKET_KIND:
				if (firstRegister >= VDP_LPU_REGISTER_WORDS || registerCount > VDP_LPU_REGISTER_WORDS - firstRegister) {
					this.fault.raise(VDP_FAULT_STREAM_BAD_PACKET, firstRegister);
					return false;
				}
				return true;
			case VDP_MFU_PACKET_KIND:
				if (firstRegister >= this.mfu.weightWords.length || registerCount > this.mfu.weightWords.length - firstRegister) {
					this.fault.raise(VDP_FAULT_MDU_BAD_MORPH_RANGE, firstRegister);
					return false;
				}
				return true;
			case VDP_JTU_PACKET_KIND:
				if (firstRegister >= this.jtu.matrixWords.length || registerCount > this.jtu.matrixWords.length - firstRegister) {
					this.fault.raise(VDP_FAULT_MDU_BAD_JOINT_RANGE, firstRegister);
					return false;
				}
				return true;
		}
		this.fault.raise(VDP_FAULT_STREAM_BAD_PACKET, packetKind);
		return false;
	}

	private writeUnitRegisterWord(packetKind: number, registerIndex: number, value: number): boolean {
		switch (packetKind) {
			case VDP_XF_PACKET_KIND:
				if (!this.xf.writeRegister(registerIndex, value)) {
					this.fault.raise(VDP_FAULT_STREAM_BAD_PACKET, value);
					return false;
				}
				return true;
			case VDP_LPU_PACKET_KIND:
				this.lpu.registerWords[registerIndex] = value >>> 0;
				return true;
			case VDP_MFU_PACKET_KIND:
				this.mfu.weightWords[registerIndex] = value >>> 0;
				return true;
			case VDP_JTU_PACKET_KIND:
				this.jtu.matrixWords[registerIndex] = value >>> 0;
				return true;
		}
		this.fault.raise(VDP_FAULT_STREAM_BAD_PACKET, packetKind);
		return false;
	}

	private decodeReg1Packet(word: number): number {
		if ((word & VDP_PKT_RESERVED_MASK) !== 0) {
			return -1;
		}
		return packedLow16(word);
	}

	private decodeRegnPacket(word: number): { firstRegister: number; count: number } | null {
		const firstRegister = packedLow16(word);
		const count = (word >>> 16) & 0xff;
		if (count === 0 || count > VDP_REGISTER_COUNT) {
			return null;
		}
		if (firstRegister >= VDP_REGISTER_COUNT || firstRegister + count > VDP_REGISTER_COUNT) {
			return null;
		}
		return { firstRegister, count };
	}

	private consumeReplayCommandPacket(word: number): boolean {
		if ((word & VDP_PKT_RESERVED_MASK) !== 0) {
			this.fault.raise(VDP_FAULT_STREAM_BAD_PACKET, word);
			return false;
		}
		const command = packedLow16(word);
		if (command === VDP_CMD_BEGIN_FRAME || command === VDP_CMD_END_FRAME) {
			this.fault.raise(VDP_FAULT_STREAM_BAD_PACKET, command);
			return false;
		}
		if (command === VDP_CMD_NOP) {
			return true;
		}
		return this.executeVdpDrawDoorbell(command);
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
		this.executeVdpDrawDoorbell(command);
		this.refreshSubmitBusyStatus();
	}

	private executeVdpDrawDoorbell(command: number): boolean {
		switch (command) {
			case VDP_CMD_CLEAR:
				return this.enqueueLatchedClear();
			case VDP_CMD_FILL_RECT:
				return this.enqueueLatchedFillRect();
			case VDP_CMD_DRAW_LINE:
				return this.enqueueLatchedDrawLine();
			case VDP_CMD_BLIT:
				return this.enqueueLatchedBlit();
			case VDP_CMD_COPY_RECT:
				return this.enqueueLatchedCopyRect();
			default:
				this.fault.raise(VDP_FAULT_CMD_BAD_DOORBELL, command);
				return false;
		}
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


	private enqueueLatchedClear(): boolean {
		const index = this.reserveBlitterCommand(VDP_BLITTER_OPCODE_CLEAR, VDP_RENDER_CLEAR_COST);
		if (index < 0) {
			return false;
		}
		this.buildFrame.queue.color[index] = this.vdpRegisters[VDP_REG_BG_COLOR] >>> 0;
		return true;
	}

	private enqueueLatchedFillRect(): boolean {
		const layer = this.vdpRegisters[VDP_REG_DRAW_LAYER] as Layer2D;
		const priority = this.vdpRegisters[VDP_REG_DRAW_PRIORITY];
		const geometry = this.readLatchedGeometry(this.latchedGeometryScratch);
		const clipped = computeClippedRect(geometry.x0, geometry.y0, geometry.x1, geometry.y1, this.fbm.width, this.fbm.height, this.clippedRectScratchA);
		if (clipped.area === 0) {
			return true;
		}
		const color = this.vdpRegisters[VDP_REG_DRAW_COLOR] >>> 0;
		const alphaCost = vdpColorAlphaByte(color) < 255 ? VDP_RENDER_ALPHA_COST_MULTIPLIER : 1;
		const index = this.reserveBlitterCommand(VDP_BLITTER_OPCODE_FILL_RECT, blitAreaBucket(clipped.area) * alphaCost);
		if (index < 0) {
			return false;
		}
		const queue = this.buildFrame.queue;
		this.writeGeometryColorCommand(queue, index, layer, priority, geometry, color);
		return true;
	}

	private enqueueLatchedDrawLine(): boolean {
		const layer = this.vdpRegisters[VDP_REG_DRAW_LAYER] as Layer2D;
		const priority = this.vdpRegisters[VDP_REG_DRAW_PRIORITY];
		const thickness = decodeSignedQ16_16(this.vdpRegisters[VDP_REG_LINE_WIDTH]);
		if (thickness <= 0) {
			this.fault.raise(VDP_FAULT_DEX_INVALID_LINE_WIDTH, this.vdpRegisters[VDP_REG_LINE_WIDTH]);
			return false;
		}
		const geometry = this.readLatchedGeometry(this.latchedGeometryScratch);
		const span = computeClippedLineSpan(geometry.x0, geometry.y0, geometry.x1, geometry.y1, this.fbm.width, this.fbm.height);
		if (span === 0) {
			return true;
		}
		const color = this.vdpRegisters[VDP_REG_DRAW_COLOR] >>> 0;
		const thicknessMultiplier = thickness > 1 ? 2 : 1;
		const alphaCost = vdpColorAlphaByte(color) < 255 ? VDP_RENDER_ALPHA_COST_MULTIPLIER : 1;
		const index = this.reserveBlitterCommand(VDP_BLITTER_OPCODE_DRAW_LINE, blitSpanBucket(span) * thicknessMultiplier * alphaCost);
		if (index < 0) {
			return false;
		}
		const queue = this.buildFrame.queue;
		this.writeGeometryColorCommand(queue, index, layer, priority, geometry, color);
		queue.thickness[index] = thickness;
		return true;
	}

	private enqueueLatchedBlit(): boolean {
		const layer = this.vdpRegisters[VDP_REG_DRAW_LAYER] as Layer2D;
		const priority = this.vdpRegisters[VDP_REG_DRAW_PRIORITY];
		const drawCtrl = this.drawCtrlScratch;
		decodeVdpDrawCtrl(this.vdpRegisters[VDP_REG_DRAW_CTRL], drawCtrl);
		if (drawCtrl.blendMode !== 0) {
			this.fault.raise(VDP_FAULT_DEX_UNSUPPORTED_DRAW_CTRL, this.vdpRegisters[VDP_REG_DRAW_CTRL]);
			return false;
		}
		const slot = this.vdpRegisters[VDP_REG_SRC_SLOT];
		const u = packedLow16(this.vdpRegisters[VDP_REG_SRC_UV]);
		const v = packedHigh16(this.vdpRegisters[VDP_REG_SRC_UV]);
		const w = packedLow16(this.vdpRegisters[VDP_REG_SRC_WH]);
		const h = packedHigh16(this.vdpRegisters[VDP_REG_SRC_WH]);
		const source = this.latchedSourceScratch;
		if (!this.tryResolveBlitterSourceWordsInto(slot, u, v, w, h, source, VDP_FAULT_DEX_SOURCE_SLOT)) {
			return false;
		}
		if (this.tryResolveBlitterSurfaceForSource(source, VDP_FAULT_DEX_SOURCE_OOB, VDP_FAULT_DEX_SOURCE_OOB) === null) {
			return false;
		}
		const scaleX = decodeSignedQ16_16(this.vdpRegisters[VDP_REG_DRAW_SCALE_X]);
		const scaleY = decodeSignedQ16_16(this.vdpRegisters[VDP_REG_DRAW_SCALE_Y]);
		if (scaleX <= 0) {
			this.fault.raise(VDP_FAULT_DEX_INVALID_SCALE, this.vdpRegisters[VDP_REG_DRAW_SCALE_X]);
			return false;
		}
		if (scaleY <= 0) {
			this.fault.raise(VDP_FAULT_DEX_INVALID_SCALE, this.vdpRegisters[VDP_REG_DRAW_SCALE_Y]);
			return false;
		}
		const dstX = decodeSignedQ16_16(this.vdpRegisters[VDP_REG_DST_X]);
		const dstY = decodeSignedQ16_16(this.vdpRegisters[VDP_REG_DST_Y]);
		const resolved = this.pmu.resolveBlit(dstX, dstY, scaleX, scaleY, drawCtrl.pmuBank, drawCtrl.parallaxWeight);
		const dstWidth = source.width * resolved.scaleX;
		const dstHeight = source.height * resolved.scaleY;
		const clipped = computeClippedRect(resolved.dstX, resolved.dstY, resolved.dstX + dstWidth, resolved.dstY + dstHeight, this.fbm.width, this.fbm.height, this.clippedRectScratchA);
		if (clipped.area === 0) {
			return true;
		}
		const color = this.vdpRegisters[VDP_REG_DRAW_COLOR] >>> 0;
		const alphaCost = vdpColorAlphaByte(color) < 255 ? VDP_RENDER_ALPHA_COST_MULTIPLIER : 1;
		const index = this.reserveBlitterCommand(VDP_BLITTER_OPCODE_BLIT, blitAreaBucket(clipped.area) * alphaCost);
		if (index < 0) {
			return false;
		}
		const queue = this.buildFrame.queue;
		queue.layer[index] = layer;
		queue.priority[index] = priority;
		queue.sourceSurfaceId[index] = source.surfaceId;
		queue.sourceSrcX[index] = source.srcX;
		queue.sourceSrcY[index] = source.srcY;
		queue.sourceWidth[index] = source.width;
		queue.sourceHeight[index] = source.height;
		queue.dstX[index] = resolved.dstX;
		queue.dstY[index] = resolved.dstY;
		queue.scaleX[index] = resolved.scaleX;
		queue.scaleY[index] = resolved.scaleY;
		queue.flipH[index] = drawCtrl.flipH ? 1 : 0;
		queue.flipV[index] = drawCtrl.flipV ? 1 : 0;
		queue.color[index] = color;
		queue.parallaxWeight[index] = drawCtrl.parallaxWeight;
		return true;
	}

	private enqueueLatchedCopyRect(): boolean {
		const layer = this.vdpRegisters[VDP_REG_DRAW_LAYER] as Layer2D;
		const priority = this.vdpRegisters[VDP_REG_DRAW_PRIORITY];
		const srcX = packedLow16(this.vdpRegisters[VDP_REG_SRC_UV]);
		const srcY = packedHigh16(this.vdpRegisters[VDP_REG_SRC_UV]);
		const width = packedLow16(this.vdpRegisters[VDP_REG_SRC_WH]);
		const height = packedHigh16(this.vdpRegisters[VDP_REG_SRC_WH]);
		const dstX = (this.vdpRegisters[VDP_REG_DST_X] | 0) >> 16;
		const dstY = (this.vdpRegisters[VDP_REG_DST_Y] | 0) >> 16;
		return this.enqueueCopyRectWords(srcX, srcY, width, height, dstX, dstY, priority, layer);
	}

	private nextBlitterSequence(): number {
		return this.blitterSequence++;
	}

	private resetBuildFrameState(): void {
		this.buildFrame.queue.reset();
		this.buildFrame.billboards.reset();
		this.buildFrame.meshes.reset();
		this.buildFrame.cost = 0;
		this.buildFrame.state = VDP_DEX_FRAME_IDLE;
	}

	private resetSubmittedFrameSlot(frame: VdpSubmittedFrame): void {
		frame.queue.reset();
		frame.state = VDP_SUBMITTED_FRAME_EMPTY;
		frame.hasCommands = false;
		frame.hasFrameBufferCommands = false;
		frame.cost = 0;
		frame.workRemaining = 0;
		frame.ditherType = 0;
		frame.frameBufferWidth = 0;
		frame.frameBufferHeight = 0;
		frame.xf.reset();
		frame.skyboxControl = 0;
		frame.skyboxFaceWords.fill(0);
		frame.billboards.reset();
		frame.meshes.reset();
		frame.lightRegisterWords.fill(0);
		frame.morphWeightWords.fill(0);
		frame.jointMatrixWords.fill(0);
	}

	private resetQueuedFrameState(): void {
		this.resetBuildFrameState();
		this.clearActiveFrame();
		this.pendingFrame.queue.reset();
		this.pendingFrame.billboards.reset();
		this.pendingFrame.meshes.reset();
		this.workCarry = 0;
		this.availableWorkUnits = 0;
		this.scheduler.cancelDeviceService(DEVICE_SERVICE_VDP);
		this.resetSubmittedFrameSlot(this.pendingFrame);
	}

	private reserveBlitterCommand(opcode: number, renderCost: number): number {
		if (this.buildFrame.state === VDP_DEX_FRAME_IDLE) {
			this.fault.raise(VDP_FAULT_SUBMIT_STATE, opcode);
			return -1;
		}
		const queue = this.buildFrame.queue;
		const index = queue.length;
		if (index >= VDP_BLITTER_FIFO_CAPACITY) {
			this.fault.raise(VDP_FAULT_DEX_OVERFLOW, index);
			return -1;
		}
		queue.opcode[index] = opcode;
		queue.seq[index] = this.nextBlitterSequence();
		queue.renderCost[index] = renderCost;
		queue.length = index + 1;
		this.buildFrame.cost += renderCost;
		return index;
	}

	private writeGeometryColorCommand(queue: VdpBlitterCommandBuffer, index: number, layer: Layer2D, priority: number, geometry: VdpLatchedGeometry, color: number): void {
		queue.layer[index] = layer;
		queue.priority[index] = priority;
		queue.x0[index] = geometry.x0;
		queue.y0[index] = geometry.y0;
		queue.x1[index] = geometry.x1;
		queue.y1[index] = geometry.y1;
		queue.color[index] = color;
	}

	private presentFrameBufferPageOnVblankEdge(): void {
		const slot = this.vram.findSurface(VDP_RD_SURFACE_FRAMEBUFFER);
		if (slot === null) {
			this.fault.raise(VDP_FAULT_RD_SURFACE, VDP_RD_SURFACE_FRAMEBUFFER);
			return;
		}
		this.fbm.presentPage(slot);
		this.vram.clearSurfaceUploadDirty(VDP_RD_SURFACE_FRAMEBUFFER);
		this.readback.invalidateSurface(VDP_RD_SURFACE_FRAMEBUFFER);
	}

	private canAcceptSubmittedFrame(): boolean {
		return this.pendingFrame.state === VDP_SUBMITTED_FRAME_EMPTY;
	}

	private beginSubmittedFrame(state: VdpDexFrameState): boolean {
		if (this.buildFrame.state !== VDP_DEX_FRAME_IDLE) {
			this.fault.raise(VDP_FAULT_SUBMIT_STATE, VDP_CMD_BEGIN_FRAME);
			return false;
		}
		this.resetBuildFrameState();
		this.blitterSequence = 0;
		this.buildFrame.state = state;
		return true;
	}

	private cancelSubmittedFrame(): void {
		this.resetBuildFrameState();
		this.scheduleNextService(this.scheduler.currentNowCycles());
		this.refreshSubmitBusyStatus();
	}

	private sealSubmittedFrame(): boolean {
		if (this.buildFrame.state === VDP_DEX_FRAME_IDLE) {
			this.fault.raise(VDP_FAULT_SUBMIT_STATE, VDP_CMD_END_FRAME);
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
		const buildQueue = this.buildFrame.queue;
		const buildBillboards = this.buildFrame.billboards;
		const buildMeshes = this.buildFrame.meshes;
		const frameHasFrameBufferCommands = buildQueue.length !== 0;
		const frameHasCommands = frameHasFrameBufferCommands || buildBillboards.length !== 0 || buildMeshes.length !== 0;
		const frameCost = buildQueue.length !== 0 && buildQueue.opcode[0] !== VDP_BLITTER_OPCODE_CLEAR
			? this.buildFrame.cost + VDP_RENDER_CLEAR_COST
			: this.buildFrame.cost;
		const sbxDecision = this.sbx.beginFrameSeal();
		const sbxSealFaceWords = this.sbx.sealFaceState;
		this.sbx.resolveFrameSamplesInto(this.vram, sbxDecision.control, sbxSealFaceWords, this.sbxSealSamples, this.sbxFrameResolutionScratch);
		const completedSbx = this.sbx.completeFrameSeal(this.sbxFrameResolutionScratch);
		if (completedSbx.faultCode !== VDP_FAULT_NONE) {
			this.fault.raise(completedSbx.faultCode, completedSbx.faultDetail);
			return false;
		}
		frame.xf.matrixWords.set(this.xf.matrixWords);
		frame.xf.viewMatrixIndex = this.xf.viewMatrixIndex;
		frame.xf.projectionMatrixIndex = this.xf.projectionMatrixIndex;
		frame.lightRegisterWords.set(this.lpu.registerWords);
		frame.morphWeightWords.set(this.mfu.weightWords);
		frame.jointMatrixWords.set(this.jtu.matrixWords);
		frame.skyboxControl = completedSbx.control;
		frame.skyboxFaceWords.set(sbxSealFaceWords);
		const frameSkyboxSamples = frame.skyboxSamples;
		frame.skyboxSamples = this.sbxSealSamples;
		this.sbxSealSamples = frameSkyboxSamples;
		this.buildFrame.queue = frame.queue;
		frame.queue = buildQueue;
		this.buildFrame.billboards = frame.billboards;
		frame.billboards = buildBillboards;
		this.buildFrame.meshes = frame.meshes;
		frame.meshes = buildMeshes;
		if (frameCost === 0) {
			frame.state = VDP_SUBMITTED_FRAME_READY;
		} else if (activeFrameEmpty) {
			frame.state = VDP_SUBMITTED_FRAME_EXECUTING;
		} else {
			frame.state = VDP_SUBMITTED_FRAME_QUEUED;
		}
		frame.hasCommands = frameHasCommands;
		frame.hasFrameBufferCommands = frameHasFrameBufferCommands;
		frame.cost = frameCost;
		frame.workRemaining = frameCost;
		const voutFrame = this.vout.sealFrame();
		frame.ditherType = voutFrame.ditherType;
		frame.frameBufferWidth = voutFrame.frameBufferWidth;
		frame.frameBufferHeight = voutFrame.frameBufferHeight;
		this.buildFrame.queue.reset();
		this.buildFrame.billboards.reset();
		this.buildFrame.meshes.reset();
		this.buildFrame.cost = 0;
		this.buildFrame.state = VDP_DEX_FRAME_IDLE;
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
		this.resetSubmittedFrameSlot(this.pendingFrame);
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
			if (this.activeFrame.hasFrameBufferCommands) {
				this.executeFrameBufferCommands(this.activeFrame.queue);
			}
			this.activeFrame.queue.reset();
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

	private executeFrameBufferCommands(commands: VdpBlitterCommandBuffer): void {
		if (commands.length === 0) {
			return;
		}
		const frameWidth = this.fbm.width;
		const frameHeight = this.fbm.height;
			const frameBufferSlot = this.vram.findSurface(VDP_RD_SURFACE_FRAMEBUFFER);
			if (frameBufferSlot === null) {
				this.fault.raise(VDP_FAULT_RD_SURFACE, VDP_RD_SURFACE_FRAMEBUFFER);
				return;
			}
		const pixels = frameBufferSlot.cpuReadback;
		this.ensureFrameBufferPriorityCapacity(frameWidth * frameHeight);
		if (commands.opcode[0] !== VDP_BLITTER_OPCODE_CLEAR) {
			this.fillFrameBuffer(pixels, VDP_BLITTER_IMPLICIT_CLEAR);
		}
		this.resetFrameBufferPriority();
		for (let index = 0; index < commands.length; index += 1) {
			const opcode = commands.opcode[index];
			if (opcode === VDP_BLITTER_OPCODE_CLEAR) {
				this.fillFrameBuffer(pixels, commands.color[index]);
				this.resetFrameBufferPriority();
				continue;
			}
			const layer = commands.layer[index] as Layer2D;
			const priority = commands.priority[index];
			const sequence = commands.seq[index];
			const color = commands.color[index];
			if (opcode === VDP_BLITTER_OPCODE_FILL_RECT) {
				this.rasterizeFrameBufferFill(pixels, frameWidth, frameHeight, commands.x0[index], commands.y0[index], commands.x1[index], commands.y1[index], color, layer, priority, sequence);
				continue;
			}
			if (opcode === VDP_BLITTER_OPCODE_DRAW_LINE) {
				this.rasterizeFrameBufferLine(pixels, frameWidth, frameHeight, commands.x0[index], commands.y0[index], commands.x1[index], commands.y1[index], commands.thickness[index], color, layer, priority, sequence);
				continue;
			}
			if (opcode === VDP_BLITTER_OPCODE_BLIT) {
				const source = this.latchedSourceScratch;
				source.surfaceId = commands.sourceSurfaceId[index];
				source.srcX = commands.sourceSrcX[index];
				source.srcY = commands.sourceSrcY[index];
				source.width = commands.sourceWidth[index];
				source.height = commands.sourceHeight[index];
				this.rasterizeFrameBufferBlit(pixels, frameWidth, frameHeight, source, commands.dstX[index], commands.dstY[index], commands.scaleX[index], commands.scaleY[index], commands.flipH[index] !== 0, commands.flipV[index] !== 0, color, layer, priority, sequence);
				continue;
			}
			if (opcode === VDP_BLITTER_OPCODE_COPY_RECT) {
				this.copyFrameBufferRect(pixels, frameWidth, commands.srcX[index], commands.srcY[index], commands.width[index], commands.height[index], commands.dstX[index], commands.dstY[index], layer, priority, sequence);
				continue;
			}
			if (opcode === VDP_BLITTER_OPCODE_GLYPH_RUN) {
				const firstGlyph = commands.glyphRunFirstEntry[index];
				const glyphEnd = firstGlyph + commands.glyphRunEntryCount[index];
				if (commands.hasBackgroundColor[index] !== 0) {
					for (let glyphIndex = firstGlyph; glyphIndex < glyphEnd; glyphIndex += 1) {
						this.rasterizeFrameBufferFill(pixels, frameWidth, frameHeight, commands.glyphDstX[glyphIndex], commands.glyphDstY[glyphIndex], commands.glyphDstX[glyphIndex] + commands.glyphAdvance[glyphIndex], commands.glyphDstY[glyphIndex] + commands.lineHeight[index], commands.backgroundColor[index], layer, priority, sequence);
					}
				}
				for (let glyphIndex = firstGlyph; glyphIndex < glyphEnd; glyphIndex += 1) {
					const source = this.latchedSourceScratch;
					source.surfaceId = commands.glyphSurfaceId[glyphIndex];
					source.srcX = commands.glyphSrcX[glyphIndex];
					source.srcY = commands.glyphSrcY[glyphIndex];
					source.width = commands.glyphWidth[glyphIndex];
					source.height = commands.glyphHeight[glyphIndex];
					this.rasterizeFrameBufferBlit(pixels, frameWidth, frameHeight, source, commands.glyphDstX[glyphIndex], commands.glyphDstY[glyphIndex], 1, 1, false, false, color, layer, priority, sequence);
				}
				continue;
			}
			if (opcode === VDP_BLITTER_OPCODE_TILE_RUN) {
				const firstTile = commands.tileRunFirstEntry[index];
				const tileEnd = firstTile + commands.tileRunEntryCount[index];
				for (let tileIndex = firstTile; tileIndex < tileEnd; tileIndex += 1) {
					const source = this.latchedSourceScratch;
					source.surfaceId = commands.tileSurfaceId[tileIndex];
					source.srcX = commands.tileSrcX[tileIndex];
					source.srcY = commands.tileSrcY[tileIndex];
					source.width = commands.tileWidth[tileIndex];
					source.height = commands.tileHeight[tileIndex];
					this.rasterizeFrameBufferBlit(pixels, frameWidth, frameHeight, source, commands.tileDstX[tileIndex], commands.tileDstY[tileIndex], 1, 1, false, false, VDP_BLITTER_WHITE, layer, priority, sequence);
				}
			}
		}
		this.vram.markSlotDirty(frameBufferSlot, 0, frameBufferSlot.surfaceHeight);
		this.readback.invalidateSurface(VDP_RD_SURFACE_FRAMEBUFFER);
	}

	private ensureFrameBufferPriorityCapacity(pixelCount: number): void {
		if (this.frameBufferPriorityLayer.length === pixelCount) {
			return;
		}
		this.frameBufferPriorityLayer = new Uint8Array(pixelCount);
		this.frameBufferPriorityZ = new Float32Array(pixelCount);
		this.frameBufferPrioritySeq = new Uint32Array(pixelCount);
	}

	private resetFrameBufferPriority(): void {
		this.frameBufferPriorityLayer.fill(0);
		this.frameBufferPriorityZ.fill(Number.NEGATIVE_INFINITY);
		this.frameBufferPrioritySeq.fill(0);
	}

	private fillFrameBuffer(pixels: Uint8Array, color: number): void {
		const r = (color >>> 16) & 0xff;
		const g = (color >>> 8) & 0xff;
		const b = color & 0xff;
		const a = (color >>> 24) & 0xff;
		for (let pixelIndex = 0; pixelIndex < pixels.length; pixelIndex += 4) {
			pixels[pixelIndex + 0] = r;
			pixels[pixelIndex + 1] = g;
			pixels[pixelIndex + 2] = b;
			pixels[pixelIndex + 3] = a;
		}
	}

	private blendFrameBufferPixel(pixels: Uint8Array, index: number, r: number, g: number, b: number, a: number, layer: Layer2D, priority: number, seq: number): void {
		if (a <= 0) {
			return;
		}
		const pixelIndex = index >>> 2;
		const currentLayer = this.frameBufferPriorityLayer[pixelIndex] as Layer2D;
		if (layer < currentLayer) {
			return;
		}
		if (layer === currentLayer) {
			const currentPriority = this.frameBufferPriorityZ[pixelIndex];
			if (priority < currentPriority) {
				return;
			}
			if (priority === currentPriority && seq < this.frameBufferPrioritySeq[pixelIndex]) {
				return;
			}
		}
		if (a >= 255) {
			pixels[index + 0] = r;
			pixels[index + 1] = g;
			pixels[index + 2] = b;
			pixels[index + 3] = 255;
			this.frameBufferPriorityLayer[pixelIndex] = layer;
			this.frameBufferPriorityZ[pixelIndex] = priority;
			this.frameBufferPrioritySeq[pixelIndex] = seq;
			return;
		}
		const inverse = 255 - a;
		pixels[index + 0] = ((r * a) + (pixels[index + 0] * inverse) + 127) / 255;
		pixels[index + 1] = ((g * a) + (pixels[index + 1] * inverse) + 127) / 255;
		pixels[index + 2] = ((b * a) + (pixels[index + 2] * inverse) + 127) / 255;
		pixels[index + 3] = a + ((pixels[index + 3] * inverse) + 127) / 255;
		this.frameBufferPriorityLayer[pixelIndex] = layer;
		this.frameBufferPriorityZ[pixelIndex] = priority;
		this.frameBufferPrioritySeq[pixelIndex] = seq;
	}

	private rasterizeFrameBufferFill(pixels: Uint8Array, frameWidth: number, frameHeight: number, x0: number, y0: number, x1: number, y1: number, color: number, layer: Layer2D, priority: number, seq: number): void {
		const r = (color >>> 16) & 0xff;
		const g = (color >>> 8) & 0xff;
		const b = color & 0xff;
		const a = (color >>> 24) & 0xff;
		let left = Math.round(x0);
		let top = Math.round(y0);
		let right = Math.round(x1);
		let bottom = Math.round(y1);
		if (right < left) {
			const swap = left;
			left = right;
			right = swap;
		}
		if (bottom < top) {
			const swap = top;
			top = bottom;
			bottom = swap;
		}
		if (left < 0) left = 0;
		if (top < 0) top = 0;
		if (right > frameWidth) right = frameWidth;
		if (bottom > frameHeight) bottom = frameHeight;
		for (let y = top; y < bottom; y += 1) {
			let index = (y * frameWidth + left) * 4;
			for (let x = left; x < right; x += 1) {
				this.blendFrameBufferPixel(pixels, index, r, g, b, a, layer, priority, seq);
				index += 4;
			}
		}
	}

	private rasterizeFrameBufferLine(pixels: Uint8Array, frameWidth: number, frameHeight: number, x0: number, y0: number, x1: number, y1: number, thicknessValue: number, color: number, layer: Layer2D, priority: number, seq: number): void {
		const r = (color >>> 16) & 0xff;
		const g = (color >>> 8) & 0xff;
		const b = color & 0xff;
		const a = (color >>> 24) & 0xff;
		let currentX = Math.round(x0);
		let currentY = Math.round(y0);
		const targetX = Math.round(x1);
		const targetY = Math.round(y1);
		const dx = Math.abs(targetX - currentX);
		const dy = Math.abs(targetY - currentY);
		const sx = currentX < targetX ? 1 : -1;
		const sy = currentY < targetY ? 1 : -1;
		let err = dx - dy;
		let thickness = Math.round(thicknessValue);
		if (thickness === 0) {
			thickness = 1;
		}
		while (true) {
			const half = thickness >> 1;
			for (let yy = currentY - half; yy < currentY - half + thickness; yy += 1) {
				if (yy < 0 || yy >= frameHeight) {
					continue;
				}
				for (let xx = currentX - half; xx < currentX - half + thickness; xx += 1) {
					if (xx < 0 || xx >= frameWidth) {
						continue;
					}
					this.blendFrameBufferPixel(pixels, (yy * frameWidth + xx) * 4, r, g, b, a, layer, priority, seq);
				}
			}
			if (currentX === targetX && currentY === targetY) {
				return;
			}
			const e2 = err << 1;
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

	private rasterizeFrameBufferBlit(pixels: Uint8Array, frameWidth: number, frameHeight: number, source: VdpBlitterSource, dstXValue: number, dstYValue: number, scaleX: number, scaleY: number, flipH: boolean, flipV: boolean, color: number, layer: Layer2D, priority: number, seq: number): void {
		const colorR = (color >>> 16) & 0xff;
		const colorG = (color >>> 8) & 0xff;
		const colorB = color & 0xff;
		const colorA = (color >>> 24) & 0xff;
			const sourceSlot = this.vram.findSurface(source.surfaceId);
			if (sourceSlot === null) {
				this.fault.raise(VDP_FAULT_DEX_SOURCE_SLOT, source.surfaceId);
				return;
			}
		const sourcePixels = sourceSlot.cpuReadback;
		const sourceStride = sourceSlot.surfaceWidth * 4;
		let dstW = Math.round(source.width * scaleX);
		let dstH = Math.round(source.height * scaleY);
		if (dstW === 0) {
			dstW = 1;
		}
		if (dstH === 0) {
			dstH = 1;
		}
		const dstX = Math.round(dstXValue);
		const dstY = Math.round(dstYValue);
		for (let y = 0; y < dstH; y += 1) {
			const targetY = dstY + y;
			if (targetY < 0 || targetY >= frameHeight) {
				continue;
			}
			const srcY = flipV
				? source.height - 1 - Math.floor((y * source.height) / dstH)
				: Math.floor((y * source.height) / dstH);
			for (let x = 0; x < dstW; x += 1) {
				const targetX = dstX + x;
				if (targetX < 0 || targetX >= frameWidth) {
					continue;
				}
				const srcX = flipH
					? source.width - 1 - Math.floor((x * source.width) / dstW)
					: Math.floor((x * source.width) / dstW);
				const sampleX = source.srcX + srcX;
				const sampleY = source.srcY + srcY;
				if (sampleX < 0 || sampleX >= sourceSlot.surfaceWidth || sampleY < 0 || sampleY >= sourceSlot.surfaceHeight) {
					continue;
				}
				const srcIndex = sampleY * sourceStride + sampleX * 4;
				const srcA = sourcePixels[srcIndex + 3];
				if (srcA === 0) {
					continue;
				}
				const outA = (srcA * colorA + 127) / 255;
				const outR = (sourcePixels[srcIndex + 0] * colorR + 127) / 255;
				const outG = (sourcePixels[srcIndex + 1] * colorG + 127) / 255;
				const outB = (sourcePixels[srcIndex + 2] * colorB + 127) / 255;
				this.blendFrameBufferPixel(pixels, (targetY * frameWidth + targetX) * 4, outR, outG, outB, outA, layer, priority, seq);
			}
		}
	}

	private copyFrameBufferRect(pixels: Uint8Array, frameWidth: number, srcX: number, srcY: number, width: number, height: number, dstXValue: number, dstYValue: number, layer: Layer2D, priority: number, seq: number): void {
		const dstX = Math.round(dstXValue);
		const dstY = Math.round(dstYValue);
		const rowBytes = width * 4;
		const overlapping =
			dstX < srcX + width
			&& dstX + width > srcX
			&& dstY < srcY + height
			&& dstY + height > srcY;
		const copyBackward = overlapping && dstY > srcY;
		const startRow = copyBackward ? height - 1 : 0;
		const endRow = copyBackward ? -1 : height;
		const step = copyBackward ? -1 : 1;
		for (let row = startRow; row !== endRow; row += step) {
			const sourceIndex = ((srcY + row) * frameWidth + srcX) * 4;
			const targetIndex = ((dstY + row) * frameWidth + dstX) * 4;
			pixels.copyWithin(targetIndex, sourceIndex, sourceIndex + rowBytes);
			const targetPixel = ((dstY + row) * frameWidth) + dstX;
			for (let col = 0; col < width; col += 1) {
				const pixelIndex = targetPixel + col;
				this.frameBufferPriorityLayer[pixelIndex] = layer;
				this.frameBufferPriorityZ[pixelIndex] = priority;
				this.frameBufferPrioritySeq[pixelIndex] = seq;
			}
		}
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

	private clearActiveFrame(): void {
		this.activeFrame.queue.reset();
		this.resetSubmittedFrameSlot(this.activeFrame);
	}

	private commitActiveVisualState(): void {
		this.sbx.presentFrame(this.activeFrame.skyboxControl, this.activeFrame.skyboxFaceWords);
		this.vout.presentFrame(this.activeFrame, this.sbx.visibleEnabled);
	}

	public presentReadyFrameOnVblankEdge(): boolean {
		if (this.activeFrame.state === VDP_SUBMITTED_FRAME_EMPTY) {
			this.lastFrameCommitted = false;
			this.lastFrameCost = 0;
			this.lastFrameHeld = false;
			this.promotePendingFrame();
			this.scheduleNextService(this.scheduler.currentNowCycles());
			this.refreshSubmitBusyStatus();
			return false;
		}
		this.lastFrameCost = this.activeFrame.cost;
		if (this.activeFrame.state !== VDP_SUBMITTED_FRAME_READY) {
			this.lastFrameCommitted = false;
			this.lastFrameHeld = true;
			return false;
		}
		const presentFrameBuffer = this.activeFrame.hasFrameBufferCommands;
		this.commitActiveVisualState();
		if (presentFrameBuffer) {
			this.presentFrameBufferPageOnVblankEdge();
		}
		this.lastFrameCommitted = true;
		this.lastFrameHeld = false;
		this.clearActiveFrame();
		this.promotePendingFrame();
		this.scheduleNextService(this.scheduler.currentNowCycles());
		this.refreshSubmitBusyStatus();
		return presentFrameBuffer;
	}

	private tryResolveBlitterSourceWordsInto(slot: number, u: number, v: number, w: number, h: number, target: VdpBlitterSource, faultCode: number): boolean {
		for (const binding of VDP_SLOT_SURFACE_BINDINGS) {
			if (binding.slot === slot) {
				target.surfaceId = binding.surfaceId;
				target.srcX = u;
				target.srcY = v;
				target.width = w;
				target.height = h;
				return true;
			}
		}
		this.fault.raise(faultCode, slot);
		return false;
	}

	private tryResolveBlitterSurfaceForSource(source: VdpBlitterSource, faultCode: number, zeroSizeFaultCode: number): VdpSurfaceUploadSlot | null {
		if (source.width === 0 || source.height === 0) {
			this.fault.raise(zeroSizeFaultCode, (source.width | (source.height << 16)) >>> 0);
			return null;
		}
		const surface = this.vram.findSurface(source.surfaceId);
		if (surface === null) {
			this.fault.raise(faultCode, source.surfaceId);
			return null;
		}
		if (source.srcX + source.width > surface.surfaceWidth || source.srcY + source.height > surface.surfaceHeight) {
			this.fault.raise(faultCode, (source.srcX | (source.srcY << 16)) >>> 0);
			return null;
		}
		return surface;
	}

	private resolveBbuSourceInto(packet: VdpBbuPacket, target: VdpBbuSourceResolution): void {
		target.faultCode = VDP_FAULT_NONE;
		target.faultDetail = 0;
		const source = target.source;
		const slot = packet.sourceRect.slot;
		if (slot === VDP_SLOT_SYSTEM) {
			source.surfaceId = VDP_RD_SURFACE_SYSTEM;
		} else if (slot === VDP_SLOT_PRIMARY) {
			source.surfaceId = VDP_RD_SURFACE_PRIMARY;
		} else if (slot === VDP_SLOT_SECONDARY) {
			source.surfaceId = VDP_RD_SURFACE_SECONDARY;
		} else {
			target.faultCode = VDP_FAULT_BBU_SOURCE_OOB;
			target.faultDetail = slot;
			return;
		}
		source.srcX = packet.sourceRect.u;
		source.srcY = packet.sourceRect.v;
		source.width = packet.sourceRect.w;
		source.height = packet.sourceRect.h;
		target.slot = slot;
		if (source.width === 0 || source.height === 0) {
			target.faultCode = VDP_FAULT_BBU_ZERO_SIZE;
			target.faultDetail = (source.width | (source.height << 16)) >>> 0;
			return;
		}
		const surface = this.vram.findSurface(source.surfaceId);
		if (surface === null) {
			target.faultCode = VDP_FAULT_BBU_SOURCE_OOB;
			target.faultDetail = source.surfaceId;
			return;
		}
		if (source.srcX + source.width > surface.surfaceWidth || source.srcY + source.height > surface.surfaceHeight) {
			target.faultCode = VDP_FAULT_BBU_SOURCE_OOB;
			target.faultDetail = (source.srcX | (source.srcY << 16)) >>> 0;
			return;
		}
		target.surfaceWidth = surface.surfaceWidth;
		target.surfaceHeight = surface.surfaceHeight;
	}

	private latchBillboardPacket(packet: VdpBbuPacket): boolean {
		const decision = this.bbu.beginPacket(packet, this.buildFrame.billboards.length);
		if (decision.state !== VDP_BBU_STATE_SOURCE_RESOLVE) {
			this.fault.raise(decision.faultCode, decision.faultDetail);
			return false;
		}
		const resolution = this.bbuSourceResolutionScratch;
		this.resolveBbuSourceInto(packet, resolution);
		const completed = this.bbu.completePacket(
			this.buildFrame.billboards,
			packet,
			resolution,
			resolution.faultCode === VDP_FAULT_NONE ? this.nextBlitterSequence() : 0,
		);
		if (completed.faultCode !== VDP_FAULT_NONE) {
			this.fault.raise(completed.faultCode, completed.faultDetail);
			return false;
		}
		this.buildFrame.cost += VDP_RENDER_BILLBOARD_COST;
		return true;
	}

	private latchMeshPacket(packet: VdpMduPacket): boolean {
		const decision = this.mdu.beginPacket(packet, this.buildFrame.meshes.length);
		if (decision.faultCode !== VDP_FAULT_NONE) {
			this.fault.raise(decision.faultCode, decision.faultDetail);
			return false;
		}
		this.mdu.completePacket(this.buildFrame.meshes, packet, this.nextBlitterSequence());
		return true;
	}

	private enqueueCopyRectWords(srcX: number, srcY: number, width: number, height: number, dstX: number, dstY: number, z: number, layer: Layer2D): boolean {
		const clipped = computeClippedRect(dstX, dstY, dstX + width, dstY + height, this.fbm.width, this.fbm.height, this.clippedRectScratchA);
		if (clipped.area === 0) {
			return true;
		}
		const index = this.reserveBlitterCommand(VDP_BLITTER_OPCODE_COPY_RECT, blitAreaBucket(clipped.area));
		if (index < 0) {
			return false;
		}
		const queue = this.buildFrame.queue;
		queue.layer[index] = layer;
		queue.priority[index] = z;
		queue.srcX[index] = srcX;
		queue.srcY[index] = srcY;
		queue.width[index] = width;
		queue.height[index] = height;
		queue.dstX[index] = dstX;
		queue.dstY[index] = dstY;
		return true;
	}

	public get frameBufferWidth(): number {
		return this.fbm.width;
	}

	public get frameBufferHeight(): number {
		return this.fbm.height;
	}

	public drainFrameBufferPresentation(sink: VdpFrameBufferPresentationSink): void {
		if (!this.fbm.hasPendingPresentation) {
			return;
		}
		const slot = this.vram.findSurface(VDP_RD_SURFACE_FRAMEBUFFER);
		if (slot === null) {
			this.fault.raise(VDP_FAULT_RD_SURFACE, VDP_RD_SURFACE_FRAMEBUFFER);
			return;
		}
		sink.consumeVdpFrameBufferPresentation(this.fbm.buildPresentation(slot.cpuReadback));
		this.fbm.clearPresentation();
	}

	public syncFrameBufferPresentation(sink: VdpFrameBufferPresentationSink): void {
		const slot = this.vram.findSurface(VDP_RD_SURFACE_FRAMEBUFFER);
		if (slot === null) {
			this.fault.raise(VDP_FAULT_RD_SURFACE, VDP_RD_SURFACE_FRAMEBUFFER);
			return;
		}
		sink.consumeVdpFrameBufferPresentation(this.fbm.buildPresentation(slot.cpuReadback, true));
		this.vram.clearSurfaceUploadDirty(VDP_RD_SURFACE_FRAMEBUFFER);
		if (this.fbm.hasPendingPresentation) {
			this.fbm.clearPresentation();
		}
	}

	// disable-next-line single_line_method_pattern -- VDP exposes the host surface-upload boundary; VRAM owns the retained upload payload and dirty spans.
	public drainSurfaceUploads(sink: VdpSurfaceUploadSink): void {
		this.vram.drainSurfaceUploads(sink);
	}

	// disable-next-line single_line_method_pattern -- VDP exposes the host surface-upload boundary; VRAM owns the retained upload payload and dirty spans.
	public syncSurfaceUploads(sink: VdpSurfaceUploadSink): void {
		this.vram.syncSurfaceUploads(sink);
	}

	public writeVram(addr: number, bytes: Uint8Array, srcOffset = 0, length = bytes.byteLength - srcOffset): void {
		if (this.vram.writeStaging(addr, bytes, srcOffset, length)) {
			return;
		}
		const slot = this.vram.findMappedSlot(addr, length);
		if (slot === null) {
			this.fault.raise(VDP_FAULT_VRAM_WRITE_UNMAPPED, addr);
			return;
		}
		const offset = addr - slot.baseAddr;
		if ((offset & 3) !== 0 || (length & 3) !== 0) {
			this.fault.raise(VDP_FAULT_VRAM_WRITE_UNALIGNED, addr);
			return;
		}
		if (slot.surfaceWidth === 0 || slot.surfaceHeight === 0) {
			this.fault.raise(VDP_FAULT_VRAM_WRITE_UNINITIALIZED, addr);
			return;
		}
		const stride = slot.surfaceWidth * 4;
		const rowCount = slot.surfaceHeight;
		const totalBytes = rowCount * stride;
		if (offset + length > totalBytes) {
			this.fault.raise(VDP_FAULT_VRAM_WRITE_OOB, addr);
			return;
		}
		this.vram.writeSurfaceBytes(slot, offset, bytes, srcOffset, length);
		this.readback.invalidateSurface(slot.surfaceId);
	}

	public readVram(addr: number, out: Uint8Array): void {
		if (this.vram.readStaging(addr, out)) {
			return;
		}
		const slot = this.vram.findMappedSlot(addr, out.byteLength);
		if (slot === null) {
			this.fault.raise(VDP_FAULT_VRAM_WRITE_UNMAPPED, addr);
			out.fill(0);
			return;
		}
		if (slot.surfaceWidth === 0 || slot.surfaceHeight === 0) {
			this.fault.raise(VDP_FAULT_VRAM_WRITE_UNINITIALIZED, addr);
			out.fill(0);
			return;
		}
		const offset = addr - slot.baseAddr;
		const stride = slot.surfaceWidth * 4;
		const totalBytes = slot.surfaceHeight * stride;
		if (offset + out.byteLength > totalBytes) {
			this.fault.raise(VDP_FAULT_VRAM_WRITE_OOB, addr);
			out.fill(0);
			return;
		}
		this.vram.readSurfaceBytes(slot, offset, out);
	}

	public readFrameBufferPixels(page: VdpFrameBufferPage, x: number, y: number, width: number, height: number, out: Uint8Array): boolean {
		let source = this.fbm.displayReadback;
		if (page === VDP_FRAMEBUFFER_PAGE_RENDER) {
			const slot = this.vram.findSurface(VDP_RD_SURFACE_FRAMEBUFFER);
			if (slot === null) {
				this.fault.raise(VDP_FAULT_RD_SURFACE, VDP_RD_SURFACE_FRAMEBUFFER);
				return false;
			}
			source = slot.cpuReadback;
		}
		const frameBufferWidth = this.fbm.width;
		const frameBufferHeight = this.fbm.height;
		if (x < 0 || y < 0 || width < 0 || height < 0 || x + width > frameBufferWidth || y + height > frameBufferHeight) {
			this.fault.raise(VDP_FAULT_RD_OOB, (x | (y << 16)) >>> 0);
			return false;
		}
		const rowBytes = width * 4;
		const expectedBytes = rowBytes * height;
		if (out.byteLength !== expectedBytes) {
			this.fault.raise(VDP_FAULT_RD_OOB, out.byteLength >>> 0);
			return false;
		}
		this.fbm.copyReadbackPixelsFrom(source, x, y, width, height, out);
		return true;
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
		if (!this.readback.resolveSurface(surfaceId, mode)) {
			this.fault.raise(this.readback.faultCode, this.readback.faultDetail);
			return VDP_OPEN_BUS_WORD;
		}
		const surface = this.vram.findSurface(this.readback.resolvedSurfaceId);
		if (surface === null) {
			throw new Error('[VDP] registered readback surface has no backing VRAM slot.');
		}
		if (!this.readback.readPixel(surface, x, y)) {
			this.fault.raise(this.readback.faultCode, this.readback.faultDetail);
			return VDP_OPEN_BUS_WORD;
		}
		if (this.readback.advanceReadPosition) {
			this.memory.writeValue(IO_VDP_RD_X, this.readback.nextX);
			this.memory.writeValue(IO_VDP_RD_Y, this.readback.nextY);
		}
		return this.readback.word;
	}

	public initializeRegisters(): void {
		const dither = 0;
		const frameBufferSlot = this.vram.findSurface(VDP_RD_SURFACE_FRAMEBUFFER);
		if (frameBufferSlot !== null) {
			this.fbm.configure(frameBufferSlot.surfaceWidth, frameBufferSlot.surfaceHeight);
		} else {
			this.fbm.configure(this.configuredFrameBufferSize.width, this.configuredFrameBufferSize.height);
		}
		this.resetQueuedFrameState();
		this.blitterSequence = 0;
		this.resetIngressState();
		this.resetStatus();
		this.memory.writeIoValue(IO_VDP_RD_SURFACE, VDP_RD_SURFACE_SYSTEM);
		this.memory.writeIoValue(IO_VDP_RD_X, 0);
		this.memory.writeIoValue(IO_VDP_RD_Y, 0);
		this.memory.writeIoValue(IO_VDP_RD_MODE, VDP_RD_MODE_RGBA8888);
		this.memory.writeIoValue(IO_VDP_DITHER, dither);
		this.memory.writeIoValue(IO_VDP_SLOT_PRIMARY_ATLAS, VDP_SLOT_ATLAS_NONE);
		this.memory.writeIoValue(IO_VDP_SLOT_SECONDARY_ATLAS, VDP_SLOT_ATLAS_NONE);
		this.memory.writeIoValue(IO_VDP_CMD, 0);
		this.resetVdpRegisters();
		this.pmu.reset();
		this.syncPmuRegisterWindow();
		this.xf.reset();
		this.lpu.reset();
		this.mfu.reset();
		this.jtu.reset();
		this.vout.reset(dither, this.fbm.width, this.fbm.height);
		this.bbu.reset();
		this.mdu.reset();
		this.sbx.reset();
		this.syncSbxRegisterWindow();
		this.lastFrameCommitted = true;
		this.lastFrameCost = 0;
		this.lastFrameHeld = false;
	}

	public captureState(): VdpState {
		return {
			xf: this.xf.captureState(),
			vdpRegisterWords: Array.from(this.vdpRegisters),
			buildFrame: captureBuildingFrameState(this.buildFrame),
			activeFrame: captureSubmittedFrameState(this.activeFrame),
			pendingFrame: captureSubmittedFrameState(this.pendingFrame),
			workCarry: this.workCarry,
			availableWorkUnits: this.availableWorkUnits,
			streamIngress: this.streamIngress.captureState(),
			readback: this.readback.captureState(),
			blitterSequence: this.blitterSequence,
			skyboxControl: this.sbx.liveControlWord,
			skyboxFaceWords: this.sbx.captureLiveFaceWords(),
			pmuSelectedBank: this.pmu.selectedBankIndex,
			pmuBankWords: this.pmu.captureBankWords(),
			lightRegisterWords: Array.from(this.lpu.registerWords),
			ditherType: this.vout.liveDitherType,
			vdpFaultCode: this.fault.code,
			vdpFaultDetail: this.fault.detail,
		};
	}

	public captureSaveState(): VdpSaveState {
		return {
			...this.captureState(),
			vram: this.vram.captureState(),
			displayFrameBufferPixels: this.fbm.captureDisplayReadback(),
		};
	}

	public restoreState(state: VdpState): void {
		this.xf.restoreState(state.xf);
		this.vdpRegisters.set(state.vdpRegisterWords);
		restoreBuildingFrameState(this.buildFrame, state.buildFrame);
		restoreSubmittedFrameState(this.activeFrame, state.activeFrame);
		restoreSubmittedFrameState(this.pendingFrame, state.pendingFrame);
		this.workCarry = state.workCarry;
		this.availableWorkUnits = state.availableWorkUnits;
		this.streamIngress.restoreState(state.streamIngress);
		this.readback.restoreState(state.readback);
		this.blitterSequence = state.blitterSequence;
		for (let index = 0; index < VDP_REGISTER_COUNT; index += 1) {
			this.memory.writeIoValue(IO_VDP_REG0 + index * IO_WORD_SIZE, this.vdpRegisters[index]);
		}
		this.sbx.restoreLiveState(state.skyboxControl, state.skyboxFaceWords);
		this.pmu.restoreBankWords(state.pmuSelectedBank, state.pmuBankWords);
		this.lpu.registerWords.set(state.lightRegisterWords);
		this.syncPmuRegisterWindow();
		this.syncSbxRegisterWindow();
		this.memory.writeValue(IO_VDP_DITHER, state.ditherType);
		this.fault.restore(0, state.vdpFaultCode, state.vdpFaultDetail);
		this.fault.setStatusFlag(VDP_STATUS_FAULT, this.fault.code !== VDP_FAULT_NONE);
		this.refreshSubmitBusyStatus();
		this.scheduler.cancelDeviceService(DEVICE_SERVICE_VDP);
		if (this.needsImmediateSchedulerService() || this.hasPendingRenderWork()) {
			this.scheduleNextService(this.scheduler.currentNowCycles());
		}
		this.commitLiveVisualState();
	}

	public restoreSaveState(state: VdpSaveState): void {
		this.restoreState(state);
		this.vram.restoreState(state.vram);
		this.bindVramSurfaces(false);
		this.fbm.restoreDisplayReadback(state.displayFrameBufferPixels);
		this.commitLiveVisualState();
	}

	// disable-next-line single_line_method_pattern -- VDP host-output transaction is the public device boundary; VOUT owns the retained payload.
	public readDeviceOutput(): VdpDeviceOutput {
		return this.vout.readDeviceOutput(this.scheduler.currentNowCycles());
	}

	private commitLiveVisualState(): void {
		this.sbx.presentLiveState();
		this.vout.presentLiveState(this.xf, this.sbx.visibleEnabled, this.lpu, this.mfu, this.jtu);
		const resolution = this.sbxFrameResolutionScratch;
		if (!this.sbx.resolveFrameSamplesInto(this.vram, this.sbx.liveControlWord, this.sbx.visibleFaceState, this.vout.visibleSkyboxSampleBuffer, resolution)) {
			this.fault.raise(resolution.faultCode, resolution.faultDetail);
		}
	}

	private bindVramSurfaces(resetSkybox: boolean): void {
		this.readback.resetSurfaceRegistry();
		this.fbm.configure(0, 0);
		this.vout.configureScanout(0, 0);
		for (let index = 0; index < this.vram.slots.length; index += 1) {
			const slot = this.vram.slots[index]!;
			this.readback.registerSurface(slot.surfaceId);
			if (slot.surfaceId === VDP_RD_SURFACE_FRAMEBUFFER) {
				this.fbm.configure(slot.surfaceWidth, slot.surfaceHeight);
				this.vout.configureScanout(slot.surfaceWidth, slot.surfaceHeight);
			}
		}
		if (resetSkybox) {
			this.sbx.reset();
			this.syncSbxRegisterWindow();
		}
		this.commitLiveVisualState();
	}

	private resizeVramSlot(slot: VdpSurfaceUploadSlot, width: number, height: number, faultDetail = (width | (height << 16)) >>> 0): boolean {
		if (!this.vram.setSlotLogicalDimensions(slot, width, height)) {
			this.fault.raise(VDP_FAULT_VRAM_SLOT_DIM, faultDetail);
			return false;
		}
		this.readback.invalidateSurface(slot.surfaceId);
		if (slot.surfaceId === VDP_RD_SURFACE_FRAMEBUFFER) {
			this.fbm.configure(width, height);
			this.vout.configureScanout(width, height);
		}
		return true;
	}

	public setDecodedVramSurfaceDimensions(baseAddr: number, width: number, height: number): void {
		const slot = this.vram.findMappedSlot(baseAddr, 1);
		if (slot === null) {
			this.fault.raise(VDP_FAULT_VRAM_WRITE_UNMAPPED, baseAddr);
			return;
		}
		this.resizeVramSlot(slot, width, height);
	}

	public configureVramSlotSurface(slotId: number, width: number, height: number): void {
		for (const binding of VDP_SLOT_SURFACE_BINDINGS) {
			if (binding.slot === slotId) {
				const slot = this.vram.findSurface(binding.surfaceId);
				if (slot === null) {
					this.fault.raise(VDP_FAULT_VRAM_SLOT_DIM, binding.surfaceId);
					return;
				}
				this.resizeVramSlot(slot, width, height);
				return;
			}
		}
		this.fault.raise(VDP_FAULT_VRAM_SLOT_DIM, slotId);
	}

	public get trackedUsedVramBytes(): number {
		return this.vram.trackedUsedBytes;
	}

	public get trackedTotalVramBytes(): number {
		return this.vram.trackedTotalBytes;
	}

}
