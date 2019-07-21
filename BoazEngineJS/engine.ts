import { Constants } from "./constants"
import { Model } from "./model"
import { Controller } from "./controller"
import { View } from "./view"
import * as GameLoader from "./gameloader";
import { SoundMaster } from "./soundmaster";

export let game: Game;
export let model: Model;
export let controller: Controller;
export let sound: SoundMaster;
export let view: View;
export let images: Map<string, HTMLImageElement> = new Map<string, HTMLImageElement>();
export let audio: Map<string, HTMLAudioElement> = new Map<string, HTMLAudioElement>();

export class Game {
    fps: number;
    lastUpdate: number;

    constructor() {
        this.fps = 50;
    }

    public startAfterLoad = (): void => {
        controller.switchState(Constants.INITIAL_GAMESTATE);
        controller.switchSubstate(Constants.INITIAL_GAMESUBSTATE);
        requestAnimationFrame(function (timestamp) {
            game.run(timestamp);
        });
        $(window).on('resize', function () {
            view.handleResize();
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
        window.addEventListener('orientationchange', view.handleResize, false);
        view.handleResize();
    }

    update = (elapsedMs: number): void => {
        controller.takeTurn(elapsedMs);
    }

    public run = (timestamp: number): void => {
        let elapsedMs = timestamp - this.lastUpdate;
        this.lastUpdate = timestamp; // || new Date().getTime(); //if browser doesn't support requestAnimationFrame, generate our own timestamp using Date
        this.update(elapsedMs);
        view.draw();

        requestAnimationFrame(function (timestamp) {
            game.run(timestamp);
        });
    }
}

$(function () {
    // Executes when HTML-Document is loaded and DOM is ready
});

// Only implement if no native implementation is available
// https://stackoverflow.com/questions/4775722/how-to-check-if-an-object-is-an-array
if (typeof Array.isArray === 'undefined') {
    Array.isArray = function (obj) {
        return Object.prototype.toString.call(obj) === '[object Array]';
    }
};