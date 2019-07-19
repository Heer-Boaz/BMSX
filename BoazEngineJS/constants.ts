/// <reference path="model.ts" />
import { Model, GameState, GameSubstate } from "./model"

export namespace Constants {
    export const INITIAL_GAMESTATE: GameState = GameState.None;
    export const INITIAL_GAMESUBSTATE: GameSubstate = GameSubstate.Default;
    export const IMAGE_PATH: string = 'img/';
    export const AUDIO_PATH: string = 'snd/';
    export const IMAGE_SOURCES: string[] | null = [
        'id:<bestand>.png',
    ];
    export const AUDIO_SOURCES: string[] | null = null;
    export const GAMESCREEN_WIDTH: number = 1000;
    export const GAMESCREEN_HEIGHT: number = 600;
}