import { TextWriter } from "./textwriter";
import { BStopwatch } from "../BoazEngineJS/btimer";
import { Animation } from "../BoazEngineJS/animation";
import { Tile } from "../BoazEngineJS/msx";

export enum State {
    Sint,
    WaitForBoaz,
    Boaz,
    None
}

export class EndDemo {
    private static states: State[] = [State.Sint, State.WaitForBoaz, State.Boaz];
    private static waits: number[] = [10000, 1000, 0];
    private ani: Animation<State>;
    private state: State;
    private timer: BStopwatch;

    constructor() {
        this.ani = new Animation<State>(EndDemo.states, EndDemo.waits);
        this.timer = BStopwatch.createWatch();
    }

    public Init(): void {
        this.reset();
    }

    private reset(): void {
        this.ani.restart();
        this.timer.restart();
        this.state = this.ani.stepValue();
    }

    public TakeTurn(): void {
        let newState: { nextStepValue: State.None };
        switch (this.state) {
            case State.Sint:
            case State.WaitForBoaz:
                if (this.ani.doAnimation(this.timer, newState)) {
                    this.state = newState.nextStepValue;
                }
                break;
            default:
                break;
        }
    }

    public Paint(): void {
        switch (this.state) {
            case State.Sint:
                TextWriter.DrawText(20, 192, "Redelijk gedaan, Belmont!");
                break;
            case State.Boaz:
                TextWriter.DrawText(<number>Tile.ToCoord(1), <number>Tile.ToCoord(9), "Zo, dat was het weer!");
                TextWriter.DrawText(<number>Tile.ToCoord(1), <number>Tile.ToCoord(11), "ervan hebben genoten");
                TextWriter.DrawText(<number>Tile.ToCoord(1), <number>Tile.ToCoord(12), "en dat is ook terecht.");
                TextWriter.DrawText(<number>Tile.ToCoord(1), <number>Tile.ToCoord(14), "Dit verhaal is nog niet");
                TextWriter.DrawText(<number>Tile.ToCoord(1), <number>Tile.ToCoord(15), "afgelopen,dus bij");
                TextWriter.DrawText(<number>Tile.ToCoord(1), <number>Tile.ToCoord(16), "belangstelling komt er");
                TextWriter.DrawText(<number>Tile.ToCoord(1), <number>Tile.ToCoord(17), "wellicht een nieuw");
                TextWriter.DrawText(<number>Tile.ToCoord(1), <number>Tile.ToCoord(18), "hoofdstuk in dit");
                TextWriter.DrawText(<number>Tile.ToCoord(1), <number>Tile.ToCoord(19), "spannende en meeslepende");
                TextWriter.DrawText(<number>Tile.ToCoord(1), <number>Tile.ToCoord(20), "verhaal!");
                break;
        }
    }
}
