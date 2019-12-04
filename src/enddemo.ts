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
        this.state = this.ani.stepValue;
    }

    public TakeTurn(): void {
        let newState: { nextStepValue: State.None };
        switch (this.state) {
            case State.Sint:
            case State.WaitForBoaz:
                let step = this.ani.doAnimation(this.timer);
                if (step.next) {
                    this.state = step.stepValue;
                }
                break;
            default:
                break;
        }
    }

    public Paint(): void {
        switch (this.state) {
            case State.Sint:
                TextWriter.drawText(20, 192, "Redelijk gedaan, Belmont!");
                break;
            case State.Boaz:
                TextWriter.drawText(<number>Tile.ToCoord(1), <number>Tile.ToCoord(9), "Zo, dat was het weer!");
                TextWriter.drawText(<number>Tile.ToCoord(1), <number>Tile.ToCoord(11), "ervan hebben genoten");
                TextWriter.drawText(<number>Tile.ToCoord(1), <number>Tile.ToCoord(12), "en dat is ook terecht.");
                TextWriter.drawText(<number>Tile.ToCoord(1), <number>Tile.ToCoord(14), "Dit verhaal is nog niet");
                TextWriter.drawText(<number>Tile.ToCoord(1), <number>Tile.ToCoord(15), "afgelopen,dus bij");
                TextWriter.drawText(<number>Tile.ToCoord(1), <number>Tile.ToCoord(16), "belangstelling komt er");
                TextWriter.drawText(<number>Tile.ToCoord(1), <number>Tile.ToCoord(17), "wellicht een nieuw");
                TextWriter.drawText(<number>Tile.ToCoord(1), <number>Tile.ToCoord(18), "hoofdstuk in dit");
                TextWriter.drawText(<number>Tile.ToCoord(1), <number>Tile.ToCoord(19), "spannende en meeslepende");
                TextWriter.drawText(<number>Tile.ToCoord(1), <number>Tile.ToCoord(20), "verhaal!");
                break;
        }
    }
}
