import {
	SKYBOX_FACE_WORD_COUNT,
	SKYBOX_FACE_WORD_STRIDE,
	VDP_SBX_CONTROL_ENABLE,
} from './contracts';

export const VDP_SBX_PACKET_KIND = 0x12000000;
export const VDP_SBX_PACKET_PAYLOAD_WORDS = 1 + SKYBOX_FACE_WORD_COUNT;

export class VdpSbxUnit {
	private readonly liveFaceWords = new Uint32Array(SKYBOX_FACE_WORD_COUNT);
	private liveControl = 0;
	private readonly visibleFaceWords = new Uint32Array(SKYBOX_FACE_WORD_COUNT);
	private visibleControl = 0;

	public reset(): void {
		this.liveFaceWords.fill(0);
		this.visibleFaceWords.fill(0);
		this.liveControl = 0;
		this.visibleControl = 0;
	}

	public writePacket(control: number, faceWords: ArrayLike<number>): void {
		this.liveControl = control >>> 0;
		this.liveFaceWords.set(faceWords);
	}

	public latchFrame(targetFaceWords: Uint32Array): number {
		targetFaceWords.set(this.liveFaceWords);
		return this.liveControl >>> 0;
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
}

export function readSkyboxFaceSource(words: Uint32Array, faceIndex: number, field: number): number {
	return words[faceIndex * SKYBOX_FACE_WORD_STRIDE + field] >>> 0;
}
