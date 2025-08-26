import { model, view } from "../bmsx/bmsx";
import { Point } from "../bmsx/common";
import { RenderView } from '../bmsx/glview';
import { GameConstants as CS } from "./gameconstants";
import { GameState, GameSubstate, Model } from "./gamemodel";

export class GameView extends RenderView {
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
        if ((model as Model).startAfterLoad)
            return;

        switch ((model as Model).gameState) {
            case GameState.LoadTheGame:
                break;
            case GameState.TitleScreen:
                (model as Model).Title.paint();
                super.drawSprites();
                break;

            case GameState.EndDemo:
                (model as Model).EndDemo.Paint();
                super.drawSprites();
                break;

            case GameState.Game:
            case GameState.Event:
                let gamescreenOffset = <Point>{ x: CS.GameScreenStartX, y: CS.GameScreenStartY };

                if ((model as Model).gameSubstate == GameSubstate.ItsCurtainsForYou || (model as Model).gameSubstate == GameSubstate.ToEndDemo) {
                    (model as Model).ItsCurtains.paint();
                }
                else if ((model as Model).gameSubstate == GameSubstate.GameOver) {
                    (model as Model).ItsCurtains.paint();
                    (model as Model).GameOverScreen.paint();
                }

                if ((model as Model).gameSubstate != GameSubstate.SwitchRoom) {
                    super.drawgame(gamescreenOffset, false);
                }
                (model as Model).Hud.paint();

                switch ((model as Model).gameSubstate) {
                    case GameSubstate.SwitchRoom:
                    case GameSubstate.BelmontDies:
                    case GameSubstate.ItsCurtainsForYou:
                    case GameSubstate.ToEndDemo:
                    case GameSubstate.GameOver:
                        break;
                    default:
                        break;
                }

                super.drawSprites();
                break;
        }
    }
}