import {
	SKYBOX_FACE_WORD_COUNT,
	SKYBOX_FACE_WORD_STRIDE,
	VDP_SBX_CONTROL_ENABLE,
} from './contracts';
import { VDP_FAULT_NONE } from '../../bus/io';

export const VDP_SBX_PACKET_KIND = 0x12000000;
export const VDP_SBX_PACKET_PAYLOAD_WORDS = 1 + SKYBOX_FACE_WORD_COUNT;
export const VDP_SBX_STATE_IDLE = 0;
export const VDP_SBX_STATE_PACKET_OPEN = 1;
export const VDP_SBX_STATE_FRAME_SEALED = 2;
export const VDP_SBX_STATE_FRAME_REJECTED = 3;

export type VdpSbxFrameState =
	| typeof VDP_SBX_STATE_IDLE
	| typeof VDP_SBX_STATE_PACKET_OPEN
	| typeof VDP_SBX_STATE_FRAME_SEALED
	| typeof VDP_SBX_STATE_FRAME_REJECTED;

export type VdpSbxFrameDecision = {
	state: VdpSbxFrameState;
	control: number;
	faultCode: number;
	faultDetail: number;
};

export type VdpSbxFrameResolution = {
	faultCode: number;
	faultDetail: number;
};

export class VdpSbxUnit {
	private readonly liveFaceWords = new Uint32Array(SKYBOX_FACE_WORD_COUNT);
	private liveControl = 0;
	private readonly faceWindowWords = new Uint32Array(SKYBOX_FACE_WORD_COUNT);
	private faceWindowControl = 0;
	private readonly packetFaceWords = new Uint32Array(SKYBOX_FACE_WORD_COUNT);
	private packetControl = 0;
	private readonly sealFaceWords = new Uint32Array(SKYBOX_FACE_WORD_COUNT);
	private readonly visibleFaceWords = new Uint32Array(SKYBOX_FACE_WORD_COUNT);
	private visibleControl = 0;
	private readonly frameDecision: VdpSbxFrameDecision = {
		state: VDP_SBX_STATE_IDLE,
		control: 0,
		faultCode: VDP_FAULT_NONE,
		faultDetail: 0,
	};

	public reset(): void {
		this.liveFaceWords.fill(0);
		this.faceWindowWords.fill(0);
		this.packetFaceWords.fill(0);
		this.sealFaceWords.fill(0);
		this.visibleFaceWords.fill(0);
		this.liveControl = 0;
		this.faceWindowControl = 0;
		this.packetControl = 0;
		this.visibleControl = 0;
		this.frameDecision.state = VDP_SBX_STATE_IDLE;
		this.frameDecision.control = 0;
		this.frameDecision.faultCode = VDP_FAULT_NONE;
		this.frameDecision.faultDetail = 0;
	}

	public writeFaceWindowControl(control: number): void {
		this.faceWindowControl = control >>> 0;
	}

	public writeFaceWindowWord(index: number, word: number): void {
		this.faceWindowWords[index] = word >>> 0;
	}

	public commitFaceWindow(): void {
		this.liveControl = this.faceWindowControl >>> 0;
		this.liveFaceWords.set(this.faceWindowWords);
	}

	public beginPacket(control: number): Uint32Array {
		this.packetControl = control >>> 0;
		return this.packetFaceWords;
	}

	public commitPacket(): void {
		this.liveControl = this.packetControl >>> 0;
		this.liveFaceWords.set(this.packetFaceWords);
	}

	public beginFrameSeal(): VdpSbxFrameDecision {
		const decision = this.frameDecision;
		decision.state = VDP_SBX_STATE_PACKET_OPEN;
		this.sealFaceWords.set(this.liveFaceWords);
		decision.control = this.liveControl >>> 0;
		decision.faultCode = VDP_FAULT_NONE;
		decision.faultDetail = 0;
		return decision;
	}

	public completeFrameSeal(resolution: VdpSbxFrameResolution): VdpSbxFrameDecision {
		const decision = this.frameDecision;
		if (resolution.faultCode !== VDP_FAULT_NONE) {
			decision.state = VDP_SBX_STATE_FRAME_REJECTED;
			decision.faultCode = resolution.faultCode;
			decision.faultDetail = resolution.faultDetail;
			return decision;
		}
		decision.state = VDP_SBX_STATE_FRAME_SEALED;
		decision.faultCode = VDP_FAULT_NONE;
		decision.faultDetail = 0;
		return decision;
	}

	public presentFrame(control: number, faceWords: Uint32Array): void {
		this.visibleControl = control >>> 0;
		this.visibleFaceWords.set(faceWords);
	}

	public presentLiveState(): void {
		this.visibleControl = this.liveControl >>> 0;
		this.visibleFaceWords.set(this.liveFaceWords);
	}

	public captureLiveFaceWords(): number[] {
		const words = new Array<number>(SKYBOX_FACE_WORD_COUNT);
		for (let index = 0; index < SKYBOX_FACE_WORD_COUNT; index += 1) {
			words[index] = this.liveFaceWords[index] >>> 0;
		}
		return words;
	}

	public restoreLiveState(control: number, faceWords: ArrayLike<number>): void {
		this.liveControl = control >>> 0;
		this.liveFaceWords.set(faceWords);
		this.faceWindowControl = this.liveControl >>> 0;
		this.faceWindowWords.set(this.liveFaceWords);
	}

	public get visibleEnabled(): boolean {
		return (this.visibleControl & VDP_SBX_CONTROL_ENABLE) !== 0;
	}

	public get liveControlWord(): number {
		return this.liveControl >>> 0;
	}

	public get visibleFaceState(): Uint32Array {
		return this.visibleFaceWords;
	}

	public get liveFaceState(): Uint32Array {
		return this.liveFaceWords;
	}

	public get sealFaceState(): Uint32Array {
		return this.sealFaceWords;
	}
}

export function readSkyboxFaceSource(words: Uint32Array, faceIndex: number, field: number): number {
	return words[faceIndex * SKYBOX_FACE_WORD_STRIDE + field] >>> 0;
}
