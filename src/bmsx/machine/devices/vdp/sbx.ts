import {
	type SkyboxFaceSources,
	SKYBOX_FACE_H_WORD,
	SKYBOX_FACE_KEYS,
	SKYBOX_FACE_SLOT_WORD,
	SKYBOX_FACE_U_WORD,
	SKYBOX_FACE_V_WORD,
	SKYBOX_FACE_W_WORD,
	SKYBOX_FACE_WORD_COUNT,
	SKYBOX_FACE_WORD_STRIDE,
	VDP_SBX_CONTROL_ENABLE,
} from './contracts';

function writeFaceWords(target: Uint32Array, faceIndex: number, slot: number, u: number, v: number, w: number, h: number): void {
	const base = faceIndex * SKYBOX_FACE_WORD_STRIDE;
	target[base + SKYBOX_FACE_SLOT_WORD] = slot >>> 0;
	target[base + SKYBOX_FACE_U_WORD] = u >>> 0;
	target[base + SKYBOX_FACE_V_WORD] = v >>> 0;
	target[base + SKYBOX_FACE_W_WORD] = w >>> 0;
	target[base + SKYBOX_FACE_H_WORD] = h >>> 0;
}

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

	public setSources(sources: SkyboxFaceSources): void {
		for (let index = 0; index < SKYBOX_FACE_KEYS.length; index += 1) {
			const source = sources[SKYBOX_FACE_KEYS[index]];
			writeFaceWords(this.liveFaceWords, index, source.slot, source.u, source.v, source.w, source.h);
		}
		this.liveControl |= VDP_SBX_CONTROL_ENABLE;
	}

	public clear(): void {
		this.liveControl &= ~VDP_SBX_CONTROL_ENABLE;
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
