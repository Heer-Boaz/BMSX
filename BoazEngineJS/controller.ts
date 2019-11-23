import { BStopwatch } from "./btimer";
import { model } from "./engine";
import { GameState, GameSubstate } from "./model";

export abstract class Controller {
    private timer: BStopwatch;

    constructor() {
        this.timer = BStopwatch.createWatch();
        this.timer.restart;
    }

    // Methods
    public takeTurn(elapsedMs: number): void {
        if (model.paused) {
            this.doPausedState();
            return;
        }
        if (model.startAfterLoad) {
            this.doStartAfterLoadState();
        }

        // Update all timers
        BStopwatch.updateTimers(elapsedMs);

        // Remove all objects that are to be disposed
        let toRemove = model.objects.filter(o => o.disposeFlag).forEach(o => { model.remove(o); o.exile() });
    }

    private doPausedState() {
    }

    private doStartAfterLoadState() {
    }

    public switchState(newstate: GameState): void {
        this.disposeOldState(newstate);
        this.initNewState(newstate);

        model.gameOldState = model.gameState;
        model.gameState = newstate;
    }

    public switchSubstate(newsubstate: GameSubstate): void {
        this.disposeOldSubstate(newsubstate);
        this.initNewSubstate(newsubstate);

        model.gameOldSubstate = model.gameSubstate;
        model.gameSubstate = newsubstate;
    }

    private disposeOldState(newstate: GameState): void {
    }

    private disposeOldSubstate(newsubstate: GameSubstate): void {
    }

    private initNewSubstate(newsubstate: GameSubstate): void {
    }

    private initNewState(newstate: GameState): void {
    }
}