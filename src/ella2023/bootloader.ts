import { BFont, BootArgs, GLView, Game, MSX1ScreenHeight, MSX1ScreenWidth, new_vec2, type vec2 } from '../bmsx/bmsx';
import { gamemodel } from './gamemodel';
import { BitmapId } from './resourceids';

let _game: Game;
let _model: gamemodel;
let _view: gameview;

const _global = window || globalThis;

_global['h406A'] = async (args: BootArgs): Promise<void> => {
	_model = new gamemodel();
	_view = new gameview(new_vec2(MSX1ScreenWidth, MSX1ScreenHeight));
	_game = new Game();
	await _game.init({
		rom: args.rom,
		model: _model,
		view: _view,
		sndcontext: args.sndcontext,
		gainnode: args.gainnode,
		debug: args.debug ?? false,
		startingGamepadIndex: args.startingGamepadIndex ?? null
	});
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
