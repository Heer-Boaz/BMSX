import { BStopwatch } from './engine';
import { BaseModelOld } from './basemodel_old';

export abstract class BaseControllerOld {
    protected timer: BStopwatch;

    constructor() {
        this.timer = BStopwatch.createWatch();
        this.timer.restart();
    }

    // Methods

    public takeTurn(elapsedMs: number): void {
        if (global.model.paused) {
            this.doPausedState();
            return;
        }
        if (global.model.startAfterLoad) {
            this.doStartAfterLoadState();
        }

        // Update all timers
        BStopwatch.updateTimers(elapsedMs);

        // Remove all objects that are to be disposed
        global.model.objects.filter(o => o.disposeFlag).forEach(o => global.model.exile(o));
    }


    protected doPausedState() {
    }


    protected doStartAfterLoadState() {
    }


    public switchState(newstate: number): void {
        this.disposeOldState(newstate);
        this.initNewState(newstate);

        (global.model as BaseModelOld).gameOldState = (global.model as BaseModelOld).gameState;
        (global.model as BaseModelOld).gameState = newstate;
    }


    public switchSubstate(newsubstate: number): void {
        this.disposeOldSubstate(newsubstate);
        this.initNewSubstate(newsubstate);

        (global.model as BaseModelOld).gameOldSubstate = (global.model as BaseModelOld).gameSubstate;
        (global.model as BaseModelOld).gameSubstate = newsubstate;
    }


    protected abstract disposeOldState(newState: number): void;


    protected abstract disposeOldSubstate(newsubstate: number): void;


    protected abstract initNewSubstate(newsubstate: number): void;


    protected abstract initNewState(newstate: number): void;
}
