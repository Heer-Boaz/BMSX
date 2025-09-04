import { World, BFont, BootArgs, Game, GameView, MSX1ScreenHeight, MSX1ScreenWidth, new_vec2 } from '../bmsx';
import { EILA_PLUGIN } from './modelplugin';
import { BitmapId } from './resourceids';
// Ensure FSM blueprint is registered
import './gamemodel';

let _game: Game;
let _model: World;
let _view: GameView;

const _global = (window || globalThis) as unknown as { h406A: (args: BootArgs) => Promise<void> };

_global['h406A'] = (args: BootArgs): Promise<void> => {
	_model = new World({ size: { width: MSX1ScreenWidth, height: MSX1ScreenHeight }, fsmId: 'model', plugins: [EILA_PLUGIN] });
	_view = new GameView(new_vec2(MSX1ScreenWidth, MSX1ScreenHeight));
	_game = new Game();
	return _game.init({
		rompack: args.rompack,
		world: _model,
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
