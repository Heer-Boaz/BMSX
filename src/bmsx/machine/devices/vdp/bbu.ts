import { VDP_BBU_BILLBOARD_LIMIT, type Layer2D, type VdpSlotSource } from './contracts';
import { vdpFault } from './fault';
import { decodeSignedQ16_16, decodeUnsignedQ16_16 } from './fixed_point';
import { packedHigh16, packedLow16 } from '../../common/word';

export const VDP_BBU_PACKET_KIND = 0x11000000;
export const VDP_BBU_PACKET_PAYLOAD_WORDS = 11;

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
		controlWord: number,
	): VdpBbuPacket {
		if (controlWord !== 0) {
			throw vdpFault(`VDP BBU control reserved bits are set (${controlWord}).`);
		}
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

	public latchBillboard(
		target: VdpBbuFrameBuffer,
		packet: VdpBbuPacket,
		seq: number,
		surfaceId: number,
		srcX: number,
		srcY: number,
		width: number,
		height: number,
		surfaceWidth: number,
		surfaceHeight: number,
		slot: number,
	): void {
		const index = target.length;
		if (index >= VDP_BBU_BILLBOARD_LIMIT) {
			throw vdpFault(`VDP billboard FIFO overflow (${VDP_BBU_BILLBOARD_LIMIT} entries).`);
		}
		const size = decodeUnsignedQ16_16(packet.sizeWord);
		if (size <= 0) {
			throw vdpFault('VDP billboard size must be positive.');
		}
		target.seq[index] = seq;
		target.layer[index] = packet.layer;
		target.priority[index] = packet.priority;
		target.positionX[index] = decodeSignedQ16_16(packet.xWord);
		target.positionY[index] = decodeSignedQ16_16(packet.yWord);
		target.positionZ[index] = decodeSignedQ16_16(packet.zWord);
		target.size[index] = size;
		target.color[index] = packet.color;
		target.sourceSurfaceId[index] = surfaceId;
		target.sourceSrcX[index] = srcX;
		target.sourceSrcY[index] = srcY;
		target.sourceWidth[index] = width;
		target.sourceHeight[index] = height;
		target.surfaceWidth[index] = surfaceWidth;
		target.surfaceHeight[index] = surfaceHeight;
		target.slot[index] = slot;
		target.length = index + 1;
	}
}
