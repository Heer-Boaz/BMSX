import { BFont, GLView, Game, MSX1ScreenHeight, MSX1ScreenWidth, RomPack, new_vec2, type vec2 } from '../bmsx/bmsx';
import { gamemodel } from './gamemodel';
import { BitmapId } from './resourceids';

let _game: Game;
let _model: gamemodel;
let _view: gameview;

const _global = window || globalThis;

_global['h406A'] = (rom: RomPack, sndcontext: AudioContext, gainnode: GainNode, debug: boolean = false): void => {
	_model = new gamemodel();
	_view = new gameview(new_vec2(MSX1ScreenWidth, MSX1ScreenHeight));
	_game = new Game(rom, _model, _view, sndcontext, gainnode, debug);
	_game.hideOnscreenGamepadButtons(['ls', 'rs', 'select', 'y']);
	_view.dynamicAtlas = null; // Must set this after creating the Game, otherwise GameView.images will not be initialized properly.
	_game.start();
};

export class gameview extends GLView {
	constructor(size: vec2) {
		super(size);
		this.default_font = new BFont(BitmapId);
	}
}
