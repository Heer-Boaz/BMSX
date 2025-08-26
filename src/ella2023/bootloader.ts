import { BFont, BootArgs, Game, MSX1ScreenHeight, MSX1ScreenWidth, new_vec2, RenderView } from '../bmsx';
import { gamemodel } from './gamemodel';
import { BitmapId } from './resourceids';

let _game: Game;
let _model: gamemodel;
let _view: RenderView;

const _global = window || globalThis;

_global['h406A'] = (args: BootArgs): Promise<void> => {
	_model = new gamemodel();
	_view = new RenderView(new_vec2(MSX1ScreenWidth, MSX1ScreenHeight));
	_game = new Game();
	return _game.init({
		rom: args.rom,
		model: _model,
		view: _view,
		sndcontext: args.sndcontext,
		gainnode: args.gainnode,
		debug: args.debug ?? false,
		startingGamepadIndex: args.startingGamepadIndex ?? null
	}).then(() => {
		_game.hideOnscreenGamepadButtons(['ls', 'rs', 'select', 'y']);
		_view.dynamicAtlas = null; // Must set this after creating the Game, otherwise GameView.images will not be initialized properly.
		_view.default_font = new BFont(BitmapId);
		_game.start();
	}).catch((err) => {
		console.error('Error initializing game:', err);
	});
};
