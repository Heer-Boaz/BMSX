import { Constants } from "./constants"
import { Model } from "./model"
import { Controller } from "./controller"
import { View } from "./view"
import { SoundMaster } from "./soundmaster";
import { IGameView, Size } from './interfaces';
import { BStopwatch } from './btimer';
import { ResourceMaster, img2src, snd2src } from '../src/resourcemaster';
// import { GameLoader } from "./gameloader";
import { Input } from "./input";

export let game: Game;
export let model: Model;
export let controller: Controller;
export let sound: SoundMaster;
export let view: View;
export let gameview: IGameView;
// declare var images: Map<number, HTMLImageElement>;
// declare var audio: Map<number, HTMLAudioElement>;

export class Game {
    fps: number;
    lastUpdate: number;
    turnCounter: number;
    public running: boolean;

    constructor(viewportsize: Size) {
        game = this;
        sound = new SoundMaster();
        view = new View(viewportsize);
        Input.init();
        this.fps = 50;
        this.lastUpdate = 0;
        this.running = false;
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
        throw Error("Not implemented yet :-(");
        // GameOptionsPersistor.SaveOptions(GO._);
    }

    private loadGameOptions(): void {
        throw Error("Not implemented yet :-(");
        // let result = GameOptionsPersistor.LoadOptions();
        // if (result != null)
        //     GO._ = result;
    }

    public async waitForUserToStart(): Promise<void> {
        // Nodig want anders gaat Chrome zeuren over geluid dat afgespeeld wordt zonder user input
        window.addEventListener('keydown', game.handleKeypressAfterWaitForUserStart, false);
        $(window).on('resize', function () {
            view.handleResize();
            Promise.resolve();
        });
        window.addEventListener('orientationchange', view.handleResize, false);
        view.handleResize();

        ResourceMaster._.PrepareGameResources();
        requestAnimationFrame(() => game.drawPressKey());
    }

    public handleKeypressAfterWaitForUserStart(e: KeyboardEvent): void {
        window.removeEventListener('keydown', game.handleKeypressAfterWaitForUserStart, false);
        game.start();
    }

    public start(): void {
        this.running = true;
        requestAnimationFrame(function (timestamp) {
            game.run(timestamp);
        });

        // Make sure that iOS doesn't scroll, even if overflow = hidden!
        // Maar ontouchend eruit halen zorgt ervoor dat niets meer reageert :(
        // Touch move vind ik te eng om erin te zetten
        // https://medium.com/jsdownunder/locking-body-scroll-for-all-devices-22def9615177
        // document.ontouchmove = (e) => {
        //     e.preventDefault();
        // };
        // document.ontouchend = (e) => {
        //     e.preventDefault();
        // };
        // document.body.ontouchmove = (e) => {
        //     e.preventDefault();
        // };
        // document.body.ontouchend = (e) => {
        //     e.preventDefault();
        // };
    }

    public update(elapsedMs: number): void {
        BStopwatch.updateTimers(elapsedMs);
        controller.takeTurn(elapsedMs);
    }

    public draw(elapsedMs: number): void {
        gameview.drawGame(elapsedMs);
    }

    public run(timestamp: number): void {
        let elapsedMs = timestamp - this.lastUpdate;
        this.lastUpdate = timestamp; // || new Date().getTime(); //if browser doesn't support requestAnimationFrame, generate our own timestamp using Date
        this.update(elapsedMs);
        this.draw(elapsedMs);

        let t = this;
        if (t.running) {
            requestAnimationFrame(function (timestamp) {
                game.run(timestamp);
            });
            ++t.turnCounter;
        }
    }

    public stop(): void {
        this.running = false;
        requestAnimationFrame(() => view.clear());
    }

    public drawPressKey(): void {
        view.drawPressKey();
        if (!game.running) {
            requestAnimationFrame(() => game.drawPressKey());
        }
    }
}

$(function () {
    // Executes when HTML-Document is loaded and DOM is ready
});

// Only implement if no native implementation is available
// https://stackoverflow.com/questions/4775722/how-to-check-if-an-object-is-an-array
if (typeof Array.isArray === 'undefined') {
    Array.isArray = function (obj): obj is Array<any> {
        return Object.prototype.toString.call(obj) === '[object Array]';
    }
};