import {
	VDP_FAULT_MDU_BAD_JOINT_RANGE,
	VDP_FAULT_MDU_BAD_MATRIX,
	VDP_FAULT_MDU_BAD_MORPH_RANGE,
	VDP_FAULT_MDU_BAD_TEXTURE_SLOT,
	VDP_FAULT_MDU_OVERFLOW,
	VDP_FAULT_NONE,
	VDP_JTU_MATRIX_COUNT,
	VDP_MDU_CONTROL_TEXTURE_ENABLE,
	VDP_MDU_CONTROL_TEXTURE_SLOT_MASK,
	VDP_MDU_CONTROL_TEXTURE_SLOT_SHIFT,
	VDP_MDU_MESH_LIMIT,
	VDP_MDU_MORPH_WEIGHT_LIMIT,
	VDP_MFU_WEIGHT_COUNT,
	VDP_SLOT_SYSTEM,
} from './contracts';
import { VDP_XF_MATRIX_COUNT } from './xf';
import { packedHigh16, packedLow16 } from '../../common/word';

export const VDP_MDU_PACKET_KIND = 0x16000000;
export const VDP_MDU_PACKET_PAYLOAD_WORDS = 10;
export const VDP_MDU_STATE_IDLE = 0;
export const VDP_MDU_STATE_PACKET_DECODE = 1;
export const VDP_MDU_STATE_INSTANCE_EMIT = 2;
export const VDP_MDU_STATE_LIMIT_REACHED = 3;
export const VDP_MDU_STATE_PACKET_REJECTED = 4;

export type VdpMduPacketState =
	| typeof VDP_MDU_STATE_IDLE
	| typeof VDP_MDU_STATE_PACKET_DECODE
	| typeof VDP_MDU_STATE_INSTANCE_EMIT
	| typeof VDP_MDU_STATE_LIMIT_REACHED
	| typeof VDP_MDU_STATE_PACKET_REJECTED;

export type VdpMduPacket = {
	modelTokenLo: number;
	modelTokenHi: number;
	meshIndex: number;
	materialIndex: number;
	modelMatrixIndex: number;
	control: number;
	color: number;
	morphBase: number;
	morphCount: number;
	jointBase: number;
	jointCount: number;
};

export type VdpMduPacketDecision = {
	state: VdpMduPacketState;
	faultCode: number;
	faultDetail: number;
};

export class VdpMduFrameBuffer {
	public length = 0;
	public readonly seq = new Uint32Array(VDP_MDU_MESH_LIMIT);
	public readonly modelTokenLo = new Uint32Array(VDP_MDU_MESH_LIMIT);
	public readonly modelTokenHi = new Uint32Array(VDP_MDU_MESH_LIMIT);
	public readonly meshIndex = new Uint32Array(VDP_MDU_MESH_LIMIT);
	public readonly materialIndex = new Uint32Array(VDP_MDU_MESH_LIMIT);
	public readonly modelMatrixIndex = new Uint32Array(VDP_MDU_MESH_LIMIT);
	public readonly control = new Uint32Array(VDP_MDU_MESH_LIMIT);
	public readonly color = new Uint32Array(VDP_MDU_MESH_LIMIT);
	public readonly morphBase = new Uint32Array(VDP_MDU_MESH_LIMIT);
	public readonly morphCount = new Uint32Array(VDP_MDU_MESH_LIMIT);
	public readonly jointBase = new Uint32Array(VDP_MDU_MESH_LIMIT);
	public readonly jointCount = new Uint32Array(VDP_MDU_MESH_LIMIT);

	public reset(): void {
		this.length = 0;
	}
}

export class VdpMduUnit {
	private readonly packetScratch: VdpMduPacket = {
		modelTokenLo: 0,
		modelTokenHi: 0,
		meshIndex: 0,
		materialIndex: 0,
		modelMatrixIndex: 0,
		control: 0,
		color: 0,
		morphBase: 0,
		morphCount: 0,
		jointBase: 0,
		jointCount: 0,
	};
	private readonly packetDecision: VdpMduPacketDecision = {
		state: VDP_MDU_STATE_IDLE,
		faultCode: VDP_FAULT_NONE,
		faultDetail: 0,
	};

	public reset(): void {
		const decision = this.packetDecision;
		decision.state = VDP_MDU_STATE_IDLE;
		decision.faultCode = VDP_FAULT_NONE;
		decision.faultDetail = 0;
	}

	public decodePacket(
		modelTokenLo: number,
		modelTokenHi: number,
		meshIndex: number,
		materialIndex: number,
		modelMatrixIndex: number,
		control: number,
		color: number,
		morphRange: number,
		jointRange: number,
	): VdpMduPacket {
		const packet = this.packetScratch;
		packet.modelTokenLo = modelTokenLo >>> 0;
		packet.modelTokenHi = modelTokenHi >>> 0;
		packet.meshIndex = meshIndex >>> 0;
		packet.materialIndex = materialIndex >>> 0;
		packet.modelMatrixIndex = modelMatrixIndex >>> 0;
		packet.control = control >>> 0;
		packet.color = color >>> 0;
		packet.morphBase = packedLow16(morphRange);
		packet.morphCount = packedHigh16(morphRange);
		packet.jointBase = packedLow16(jointRange);
		packet.jointCount = packedHigh16(jointRange);
		return packet;
	}

	public beginPacket(packet: VdpMduPacket, targetLength: number): VdpMduPacketDecision {
		const decision = this.packetDecision;
		decision.state = VDP_MDU_STATE_PACKET_DECODE;
		decision.faultCode = VDP_FAULT_NONE;
		decision.faultDetail = 0;
		if (targetLength >= VDP_MDU_MESH_LIMIT) {
			decision.state = VDP_MDU_STATE_LIMIT_REACHED;
			decision.faultCode = VDP_FAULT_MDU_OVERFLOW;
			decision.faultDetail = targetLength >>> 0;
			return decision;
		}
		if (packet.modelMatrixIndex >= VDP_XF_MATRIX_COUNT) {
			decision.state = VDP_MDU_STATE_PACKET_REJECTED;
			decision.faultCode = VDP_FAULT_MDU_BAD_MATRIX;
			decision.faultDetail = packet.modelMatrixIndex;
			return decision;
		}
		if ((packet.control & VDP_MDU_CONTROL_TEXTURE_ENABLE) !== 0) {
			const textureSlot = (packet.control & VDP_MDU_CONTROL_TEXTURE_SLOT_MASK) >>> VDP_MDU_CONTROL_TEXTURE_SLOT_SHIFT;
			if (textureSlot > VDP_SLOT_SYSTEM) {
				decision.state = VDP_MDU_STATE_PACKET_REJECTED;
				decision.faultCode = VDP_FAULT_MDU_BAD_TEXTURE_SLOT;
				decision.faultDetail = textureSlot;
				return decision;
			}
		}
		if (packet.morphCount > VDP_MDU_MORPH_WEIGHT_LIMIT || packet.morphBase + packet.morphCount > VDP_MFU_WEIGHT_COUNT) {
			decision.state = VDP_MDU_STATE_PACKET_REJECTED;
			decision.faultCode = VDP_FAULT_MDU_BAD_MORPH_RANGE;
			decision.faultDetail = (packet.morphBase | (packet.morphCount << 16)) >>> 0;
			return decision;
		}
		if (packet.jointBase + packet.jointCount > VDP_JTU_MATRIX_COUNT) {
			decision.state = VDP_MDU_STATE_PACKET_REJECTED;
			decision.faultCode = VDP_FAULT_MDU_BAD_JOINT_RANGE;
			decision.faultDetail = (packet.jointBase | (packet.jointCount << 16)) >>> 0;
			return decision;
		}
		decision.state = VDP_MDU_STATE_INSTANCE_EMIT;
		return decision;
	}

	public completePacket(target: VdpMduFrameBuffer, packet: VdpMduPacket, seq: number): VdpMduPacketDecision {
		const decision = this.packetDecision;
		this.latchMesh(target, packet, seq);
		decision.state = VDP_MDU_STATE_INSTANCE_EMIT;
		decision.faultCode = VDP_FAULT_NONE;
		decision.faultDetail = 0;
		return decision;
	}

	private latchMesh(target: VdpMduFrameBuffer, packet: VdpMduPacket, seq: number): void {
		const index = target.length;
		target.seq[index] = seq;
		target.modelTokenLo[index] = packet.modelTokenLo;
		target.modelTokenHi[index] = packet.modelTokenHi;
		target.meshIndex[index] = packet.meshIndex;
		target.materialIndex[index] = packet.materialIndex;
		target.modelMatrixIndex[index] = packet.modelMatrixIndex;
		target.control[index] = packet.control;
		target.color[index] = packet.color;
		target.morphBase[index] = packet.morphBase;
		target.morphCount[index] = packet.morphCount;
		target.jointBase[index] = packet.jointBase;
		target.jointCount[index] = packet.jointCount;
		target.length = index + 1;
	}
}
