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
	scale: INITIAL_SCALE,

	/**
	 * The current fullscreen mode of the game.
	 */
	fullscreen: INITIAL_FULLSCREEN,

	/**
	 * The volume percentage of the game.
	 */
	volumePercentage: INITIAL_VOLUME,
};
