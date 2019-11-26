/// <reference path="model.ts" />
import { GameState, GameSubstate } from "./model"

export namespace Constants {
    export const IMAGE_PATH: string = 'rom/Graphics/';
    export const AUDIO_PATH: string = 'rom/';
    // export const IMAGE_PATH: string = 'img/';
    // export const AUDIO_PATH: string = 'snd/';
    export const DRAWBITMAP_NO_OPTION = 0;
    export const DRAWBITMAP_HFLIP = 0x1;
    export const DRAWBITMAP_VFLIP = 0x2;

    export const SaveSlotCount: number = 6;
    export const SaveSlotCheckpoint: number = -1;
    export const SaveGamePath: string = "./Saves/sintervania.sa";
    export const CheckpointGamePath: string = "./Saves/sintervania.chk";
    export const OptionsPath: string = "./sintervania.ini";
}