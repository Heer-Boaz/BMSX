import { id2res, AudioMeta } from "./rompack";
export declare class SM {
    private static limitToOneEffect;
    private static tracks;
    private static sndContext;
    private static currentMusicNode;
    private static currentEffectNode;
    static currentEffectAudio: AudioMeta;
    static currentMusicAudio: AudioMeta;
    private static gainNode;
    static init(_audioResources: id2res): void;
    private static createNode;
    private static playNode;
    static play(id: number): void;
    private static stop;
    static stopEffect(): void;
    static stopMusic(): void;
    static resumeEffect(): void;
    static resumeMusic(): void;
    static setEffectsVolume(volume: number): void;
    static setMusicVolume(volume: number): void;
}
//# sourceMappingURL=soundmaster.d.ts.map