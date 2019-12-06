import { Model } from "./model"
import { Controller } from "./controller"
import { View } from "./view"
import { SM } from "./soundmaster";
import { IGameView, Size } from './interfaces';
import { BStopwatch } from './btimer';
import { Input } from "./input";

export type id2res = { [key: number]: RomResource; };
export interface RomLoadResult {
    rom: ArrayBuffer,
    images: Map<number, HTMLImageElement>;
    resources: id2res
    source: any
}

export interface RomResource {
    resid: number;
    resname: string;
    type: string;
    start: number;
    end: number;
}

export let game: Game;
export let model: Model;
export let controller: Controller;
export let sound: SM;
export let view: View;
export let gameview: IGameView;

const fps: number = 50;
const fpstime: number = 1000 / fps;

export class Game {
    lastUpdate: number;
    turnCounter: number;
    intervalid: number;
    public running: boolean;
    wasupdated: boolean;
    public rom: RomLoadResult;

    constructor(_rom: RomLoadResult, viewportsize: Size) {
        game = this;
        sound = new SM();
        view = new View(viewportsize);
        this.rom = _rom;
        Input.init();
        this.lastUpdate = 0;
        this.running = false;
        this.wasupdated = true;
    }

    public setModel(m: Model): void {
        model = m;
    }

    public setController(c: Controller): void {
        controller = c;
    }

    public setGameView(v: IGameView): void {
        gameview = v;
    }

    public get TurnCounter(): number {
        return this.turnCounter;
    }

    public GameOptionsChanged(): void {
        console.warn("Not implemented yet :-(");
        // GameOptionsPersistor.SaveOptions(GO._);
    }

    private loadGameOptions(): void {
        console.warn("Not implemented yet :-(");
        // let result = GameOptionsPersistor.LoadOptions();
        // if (result != null)
        //     GO._ = result;
    }

    // public async waitForUserToStart(): Promise<void> {
    //     // Nodig want anders gaat Chrome zeuren over geluid dat afgespeeld wordt zonder user input
    //     window.addEventListener('keydown', game.handleKeypressAfterWaitForUserStart, false);
    //     $(window).on('resize', function () {
    //         view.handleResize();
    //         Promise.resolve();
    //     });
    //     window.addEventListener('orientationchange', view.handleResize, false);
    //     view.handleResize();

    //     ResourceMaster._.PrepareGameResources();
    //     requestAnimationFrame(() => game.drawPressKey());
    // }

    // public handleKeypressAfterWaitForUserStart(e: KeyboardEvent): void {
    //     window.removeEventListener('keydown', game.handleKeypressAfterWaitForUserStart, false);
    //     game.start();
    // }

    public start(): void {
        window.addEventListener('resize', view.handleResize, false);
        window.addEventListener('orientationchange', view.handleResize, false);
        view.handleResize();

        this.running = true;
        this.lastUpdate = performance.now();
        this.draw(0);
        this.intervalid = <number><unknown>setInterval(this.run, fpstime);
    }

    public update(elapsedMs: number): void {
        BStopwatch.updateTimers(elapsedMs);
        controller.takeTurn(elapsedMs);
    }

    public draw(elapsedMs: number): void {
        if (!game.wasupdated) return;
        gameview.drawGame(elapsedMs);
        if (game.running) requestAnimationFrame(timestamp => game.draw(timestamp));
    }

    public run(): void {
        // https://jsfiddle.net/jonataswalker/q8xnbwev/
        // request another frame
        // if (game.running) setTimeout(() => requestAnimationFrame(timestamp => game.run(timestamp)), fpstime);
        // if (game.running) requestAnimationFrame(timestamp => game.run(timestamp));

        // calc elapsed time since last loop
        // var elapsed = now - game.lastUpdate;

        // if enough time has elapsed, draw the next frame
        // if (elapsed > fpstime) {
        // Get ready for next frame by setting lastDrawTime=now, but...
        // Also, adjust for fpsInterval not being multiple of 16.67
        // game.lastUpdate = now - (elapsed % fpstime);

        game.update(fpstime);
        game.wasupdated = true;
        // game.draw(elapsed);

        ++game.turnCounter;
        // }

        // let elapsedMs = timestamp - this.lastUpdate;
        // this.lastUpdate = timestamp;
        // this.update(elapsedMs);
        // this.draw(elapsedMs);

        // let t = this;
        // if (!t.running) return;

        // requestAnimationFrame(timestamp => game.run(timestamp));
        // ++t.turnCounter;
    }

    public stop(): void {
        game.running = false;
        clearInterval(game.intervalid);

        requestAnimationFrame(() => {
            view.clear();
            view.handleResize();
            SM.StopEffect();
            SM.stopMusic();
        });
    }

    // public drawPressKey(): void {
    //     view.drawPressKey();
    //     if (!game.running) {
    //         requestAnimationFrame(() => game.drawPressKey());
    //     }
    // }
}