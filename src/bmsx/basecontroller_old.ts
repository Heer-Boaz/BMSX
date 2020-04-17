import { BStopwatch, model } from './engine';
import { BaseModelOld } from './basemodel_old';

export abstract class BaseControllerOld {
    protected timer: BStopwatch;

    constructor() {
        this.timer = BStopwatch.createWatch();
        this.timer.restart();
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
        model.objects.filter(o => o.disposeFlag).forEach(o => model.exile(o));
    }


    protected doPausedState() {
    }


    protected doStartAfterLoadState() {
    }


    public switchState(newstate: number): void {
        this.disposeOldState(newstate);
        this.initNewState(newstate);

        (model as BaseModelOld).gameOldState = (model as BaseModelOld).gameState;
        (model as BaseModelOld).gameState = newstate;
    }


    public switchSubstate(newsubstate: number): void {
        this.disposeOldSubstate(newsubstate);
        this.initNewSubstate(newsubstate);

        (model as BaseModelOld).gameOldSubstate = (model as BaseModelOld).gameSubstate;
        (model as BaseModelOld).gameSubstate = newsubstate;
    }


    protected abstract disposeOldState(newState: number): void;


    protected abstract disposeOldSubstate(newsubstate: number): void;


    protected abstract initNewSubstate(newsubstate: number): void;


    protected abstract initNewState(newstate: number): void;
}
