import { VDP_BBU_BILLBOARD_LIMIT, type Layer2D, type VdpSlotSource } from './contracts';
import { decodeSignedQ16_16, decodeUnsignedQ16_16 } from './fixed_point';
import { packedHigh16, packedLow16 } from '../../common/word';
import {
	VDP_FAULT_BBU_OVERFLOW,
	VDP_FAULT_BBU_ZERO_SIZE,
	VDP_FAULT_NONE,
} from '../../bus/io';

export const VDP_BBU_PACKET_KIND = 0x11000000;
export const VDP_BBU_PACKET_PAYLOAD_WORDS = 11;
export const VDP_BBU_STATE_IDLE = 0;
export const VDP_BBU_STATE_PACKET_DECODE = 1;
export const VDP_BBU_STATE_SOURCE_RESOLVE = 2;
export const VDP_BBU_STATE_INSTANCE_EMIT = 3;
export const VDP_BBU_STATE_LIMIT_REACHED = 4;
export const VDP_BBU_STATE_PACKET_REJECTED = 5;

export type VdpBbuPacketState =
	| typeof VDP_BBU_STATE_IDLE
	| typeof VDP_BBU_STATE_PACKET_DECODE
	| typeof VDP_BBU_STATE_SOURCE_RESOLVE
	| typeof VDP_BBU_STATE_INSTANCE_EMIT
	| typeof VDP_BBU_STATE_LIMIT_REACHED
	| typeof VDP_BBU_STATE_PACKET_REJECTED;

export type VdpBbuPacket = {
	layer: Layer2D;
	priority: number;
	sourceRect: VdpSlotSource;
	xWord: number;
	yWord: number;
	zWord: number;
	sizeWord: number;
	color: number;
};

export type VdpBbuPacketDecision = {
	state: VdpBbuPacketState;
	faultCode: number;
	faultDetail: number;
	size: number;
};

export type VdpBbuSource = {
	surfaceId: number;
	srcX: number;
	srcY: number;
	width: number;
	height: number;
};

export type VdpBbuSourceResolution = {
	faultCode: number;
	faultDetail: number;
	source: VdpBbuSource;
	surfaceWidth: number;
	surfaceHeight: number;
	slot: number;
};

export class VdpBbuFrameBuffer {
	public length = 0;
	public readonly seq = new Uint32Array(VDP_BBU_BILLBOARD_LIMIT);
	public readonly layer = new Uint8Array(VDP_BBU_BILLBOARD_LIMIT);
	public readonly priority = new Uint32Array(VDP_BBU_BILLBOARD_LIMIT);
	public readonly positionX = new Float32Array(VDP_BBU_BILLBOARD_LIMIT);
	public readonly positionY = new Float32Array(VDP_BBU_BILLBOARD_LIMIT);
	public readonly positionZ = new Float32Array(VDP_BBU_BILLBOARD_LIMIT);
	public readonly size = new Float32Array(VDP_BBU_BILLBOARD_LIMIT);
	public readonly color = new Uint32Array(VDP_BBU_BILLBOARD_LIMIT);
	public readonly sourceSurfaceId = new Uint32Array(VDP_BBU_BILLBOARD_LIMIT);
	public readonly sourceSrcX = new Uint32Array(VDP_BBU_BILLBOARD_LIMIT);
	public readonly sourceSrcY = new Uint32Array(VDP_BBU_BILLBOARD_LIMIT);
	public readonly sourceWidth = new Uint32Array(VDP_BBU_BILLBOARD_LIMIT);
	public readonly sourceHeight = new Uint32Array(VDP_BBU_BILLBOARD_LIMIT);
	public readonly surfaceWidth = new Uint32Array(VDP_BBU_BILLBOARD_LIMIT);
	public readonly surfaceHeight = new Uint32Array(VDP_BBU_BILLBOARD_LIMIT);
	public readonly slot = new Uint32Array(VDP_BBU_BILLBOARD_LIMIT);

	public reset(): void {
		this.length = 0;
	}
}

export class VdpBbuUnit {
	private readonly sourceRectScratch: VdpSlotSource = { slot: 0, u: 0, v: 0, w: 0, h: 0 };
	private readonly packetScratch: VdpBbuPacket = {
		layer: 0,
		priority: 0,
		sourceRect: this.sourceRectScratch,
		xWord: 0,
		yWord: 0,
		zWord: 0,
		sizeWord: 0,
		color: 0,
	};
	private readonly packetDecision: VdpBbuPacketDecision = {
		state: VDP_BBU_STATE_IDLE,
		faultCode: VDP_FAULT_NONE,
		faultDetail: 0,
		size: 0,
	};

	public reset(): void {
		const decision = this.packetDecision;
		decision.state = VDP_BBU_STATE_IDLE;
		decision.faultCode = VDP_FAULT_NONE;
		decision.faultDetail = 0;
		decision.size = 0;
	}

	public decodePacket(
		layerWord: number,
		priority: number,
		slot: number,
		uvWord: number,
		whWord: number,
		xWord: number,
		yWord: number,
		zWord: number,
		sizeWord: number,
		color: number,
	): VdpBbuPacket {
		const sourceRect = this.sourceRectScratch;
		sourceRect.slot = slot;
		sourceRect.u = packedLow16(uvWord);
		sourceRect.v = packedHigh16(uvWord);
		sourceRect.w = packedLow16(whWord);
		sourceRect.h = packedHigh16(whWord);

		const packet = this.packetScratch;
		packet.layer = layerWord as Layer2D;
		packet.priority = priority;
		packet.xWord = xWord >>> 0;
		packet.yWord = yWord >>> 0;
		packet.zWord = zWord >>> 0;
		packet.sizeWord = sizeWord >>> 0;
		packet.color = color >>> 0;
		return packet;
	}

	public beginPacket(packet: VdpBbuPacket, targetLength: number): VdpBbuPacketDecision {
		const decision = this.packetDecision;
		decision.state = VDP_BBU_STATE_PACKET_DECODE;
		decision.faultCode = VDP_FAULT_NONE;
		decision.faultDetail = 0;
		const size = decodeUnsignedQ16_16(packet.sizeWord);
		decision.size = size;
		if (size <= 0) {
			decision.state = VDP_BBU_STATE_PACKET_REJECTED;
			decision.faultCode = VDP_FAULT_BBU_ZERO_SIZE;
			decision.faultDetail = packet.sizeWord >>> 0;
			return decision;
		}
		if (targetLength >= VDP_BBU_BILLBOARD_LIMIT) {
			decision.state = VDP_BBU_STATE_LIMIT_REACHED;
			decision.faultCode = VDP_FAULT_BBU_OVERFLOW;
			decision.faultDetail = targetLength >>> 0;
			return decision;
		}
		decision.state = VDP_BBU_STATE_SOURCE_RESOLVE;
		return decision;
	}

	public completePacket(
		target: VdpBbuFrameBuffer,
		packet: VdpBbuPacket,
		resolution: VdpBbuSourceResolution,
		seq: number,
	): VdpBbuPacketDecision {
		const decision = this.packetDecision;
		if (resolution.faultCode !== VDP_FAULT_NONE) {
			decision.state = VDP_BBU_STATE_PACKET_REJECTED;
			decision.faultCode = resolution.faultCode;
			decision.faultDetail = resolution.faultDetail;
			return decision;
		}
		decision.state = VDP_BBU_STATE_INSTANCE_EMIT;
		this.latchBillboard(
			target,
			packet,
			seq,
			decision.size,
			resolution.source,
			resolution.surfaceWidth,
			resolution.surfaceHeight,
			resolution.slot,
		);
		decision.faultCode = VDP_FAULT_NONE;
		decision.faultDetail = 0;
		return decision;
	}

	private latchBillboard(
		target: VdpBbuFrameBuffer,
		packet: VdpBbuPacket,
		seq: number,
		size: number,
		source: VdpBbuSource,
		surfaceWidth: number,
		surfaceHeight: number,
		slot: number,
	): void {
		const index = target.length;
		target.seq[index] = seq;
		target.layer[index] = packet.layer;
		target.priority[index] = packet.priority;
		target.positionX[index] = decodeSignedQ16_16(packet.xWord);
		target.positionY[index] = decodeSignedQ16_16(packet.yWord);
		target.positionZ[index] = decodeSignedQ16_16(packet.zWord);
		target.size[index] = size;
		target.color[index] = packet.color;
		target.sourceSurfaceId[index] = source.surfaceId;
		target.sourceSrcX[index] = source.srcX;
		target.sourceSrcY[index] = source.srcY;
		target.sourceWidth[index] = source.width;
		target.sourceHeight[index] = source.height;
		target.surfaceWidth[index] = surfaceWidth;
		target.surfaceHeight[index] = surfaceHeight;
		target.slot[index] = slot;
		target.length = index + 1;
	}
}
