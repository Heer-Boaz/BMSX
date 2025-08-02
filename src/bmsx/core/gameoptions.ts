import { MSX2ScreenHeight, MSX2ScreenWidth } from '..';

/**
 * The initial scale of the game.
 */
const INITIAL_SCALE = 1;

/**
 * The initial fullscreen mode of the game.
 */
const INITIAL_FULLSCREEN = false;
const INITIAL_VOLUME = 1;
const DEFAULT_CANVAS_OR_ONSCREENGAMEPAD_MUST_RESPECT_LEBENSRAUM: 'canvas' | 'gamepad' = 'canvas';

/**
 * Represents the game options.
 */
export const GameOptions = {
    canvas_or_onscreengamepad_must_respect_lebensraum: DEFAULT_CANVAS_OR_ONSCREENGAMEPAD_MUST_RESPECT_LEBENSRAUM as 'canvas' | 'gamepad',

    /**
     * The current scale of the game.
     */
    Scale: INITIAL_SCALE,

    /**
     * The current fullscreen mode of the game.
     */
    Fullscreen: INITIAL_FULLSCREEN,

    /**
     * The volume percentage of the game.
     */
    VolumePercentage: INITIAL_VOLUME,

    /**
     * Gets the width of the game window.
     */
    get WindowWidth(): number {
        return (MSX2ScreenWidth * GameOptions.Scale);
    },

    /**
     * Gets the height of the game window.
     */
    get WindowHeight(): number {
        return (MSX2ScreenHeight * GameOptions.Scale);
    },

    /**
     * Gets the width of the game buffer.
     */
    get BufferWidth(): number {
        return (MSX2ScreenWidth * GameOptions.Scale);
    },

    /**
     * Gets the height of the game buffer.
     */
    get BufferHeight(): number {
        return (MSX2ScreenHeight * GameOptions.Scale);
    }
};
/**
 * Module containing constants used in the Sintervania application.
 */

export module Constants {
    /**
     * The path to the directory containing the images.
     */
    export const IMAGE_PATH: string = 'rom/Graphics/';

    /**
     * The path to the directory containing the audio files.
     */
    export const AUDIO_PATH: string = 'rom/';

    /**
     * The number of save slots available.
     */
    export const SaveSlotCount: number = 6;

    /**
     * The value representing a checkpoint save slot.
     */
    export const SaveSlotCheckpoint: number = -1;

    /**
     * The path to the save game file.
     */
    export const SaveGamePath: string = "./Saves/sintervania.sa";

    /**
     * The path to the checkpoint game file.
     */
    export const CheckpointGamePath: string = "./Saves/sintervania.chk";

    /**
     * The path to the options file.
     */
    export const OptionsPath: string = "./sintervania.ini";
}
