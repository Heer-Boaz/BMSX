import { GameConstants as CS } from "./gameconstants"
import { GameState, GameSubstate, Model } from "./gamemodel";
import { Point } from "./bmsx/common";
import { view } from "./bmsx/engine";
import { BaseView } from './bmsx/view';

export class GameView extends BaseView {
    private static _instance: GameView;

    public static get _(): GameView {
        return GameView._instance;
    }

    constructor(viewportSize: Point) {
        super(viewportSize);
        GameView._instance = this;
    }

    public drawgame(): void {
        view.clear();
        if (Model._.startAfterLoad)
            return;

        switch (Model._.gameState) {
            case GameState.LoadTheGame:
                break;
            case GameState.TitleScreen:
                Model._.Title.Paint();
                break;

            case GameState.EndDemo:
                Model._.EndDemo.Paint();
                break;

            case GameState.Game:
            case GameState.Event:
                let gamescreenOffset = <Point>{ x: CS.GameScreenStartX, y: CS.GameScreenStartY };
                if (Model._.gameSubstate != GameSubstate.SwitchRoom) {
                    Model._.currentRoom.Paint();
                    super.drawgame(gamescreenOffset, false);
                }
                Model._.Hud.Paint();

                switch (Model._.gameSubstate) {
                    case GameSubstate.SwitchRoom:
                    case GameSubstate.BelmontDies:
                    case GameSubstate.ItsCurtainsForYou:
                    case GameSubstate.ToEndDemo:
                    case GameSubstate.GameOver:
                        break;
                    default:
                        break;
                }

                if (Model._.gameSubstate == GameSubstate.ItsCurtainsForYou || Model._.gameSubstate == GameSubstate.ToEndDemo) {
                    Model._.ItsCurtains.Paint();
                }
                else if (Model._.gameSubstate == GameSubstate.GameOver) {
                    Model._.ItsCurtains.Paint();
                    Model._.GameOverScreen.Paint();
                }

                Model._.GameMenu.Paint();
                if (Model._.paused) {
                    Model._.PauseObject.paint();
                }
                break;
        }
    }
}