import { BStopwatch } from "./btimer";
import { model } from "./engine";

export abstract class BaseController {
    protected timer: BStopwatch;

    constructor() {
        this.timer = BStopwatch.createWatch();
        this.timer.restart();
        model.OldState = 0;
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
        model.objects.filter(o => o.disposeFlag).forEach(o => model.remove(o));
    }

    protected doPausedState() {
    }

    protected doStartAfterLoadState() {
    }

    public switchState(newstate: number): void {
        this.disposeOldState(newstate);
        this.initNewState(newstate);

        model.gameOldState = model.gameState;
        model.gameState = newstate;
    }

    public switchSubstate(newsubstate: number): void {
        this.disposeOldSubstate(newsubstate);
        this.initNewSubstate(newsubstate);

        model.gameOldSubstate = model.gameSubstate;
        model.gameSubstate = newsubstate;
    }

    protected abstract disposeOldState(newState: number): void;

    protected abstract disposeOldSubstate(newsubstate: number): void;

    protected abstract initNewSubstate(newsubstate: number): void;

    protected abstract initNewState(newstate: number): void;
}