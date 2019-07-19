/// <reference path="./interfaces.ts"/>

export class BStopwatch {
    public pauseDuringMenu: boolean = true;
    public pauseAtFocusLoss: boolean = true;
    public running: boolean = false;
    public elapsedMilliseconds: number = 0;

    /// <summary>
    /// This list is used to pause all running timers for when the game is paused, or the game loses focus, etc.
    /// </summary>
    public static Watches: Array<BStopwatch> = [];

    public static createWatch(): BStopwatch {
        let result = new BStopwatch();
        BStopwatch.Watches.push(result);
        return result;
    }

    public static addWatch(watch: BStopwatch): void {
        if (BStopwatch.Watches.indexOf(watch) > -1)
            BStopwatch.Watches.push(watch);
    }

    public static removeWatch(watch: BStopwatch): void {
        let index = BStopwatch.Watches.indexOf(watch);
        if (index > -1) {
            delete BStopwatch.Watches[index];
            BStopwatch.Watches.splice(index, 1);
        }
    }

    public static updateTimers(elapsedMs: number): void {
        BStopwatch.Watches.forEach(s => { s.updateTime(elapsedMs); });
    }

    public start = (): void => {
        this.running = true;
    }

    public stop = (): void => {
        this.running = false;
    }

    public restart = (): void => {
        this.running = true;
        this.elapsedMilliseconds = 0;
    }

    public reset = (): void => {
        this.elapsedMilliseconds = 0;
    }

    public updateTime = (elapsedMs: number): void => {
        if (!this.running) return;
        this.elapsedMilliseconds += elapsedMs;
    }
}