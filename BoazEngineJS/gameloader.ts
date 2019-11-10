import { Constants } from "./constants";
import { images, audio, game } from "./engine";
import { BitmapId, AudioId } from "resourceids";

let imagesLoadedCount: number;
let totalImages: number;
let imagesLoaded: boolean;
let audioLoadedCount: number;
let totalAudio: number;
let audioLoaded: boolean;

export function loadgame(img2src: Map<BitmapId, string> | null, snd2src: Map<AudioId, string> | null): void {
    imagesLoaded = false;
    audioLoaded = false;

    preloadImages(img2src);
    preloadAudio(snd2src);
    if (totalImages == 0) handleImagesLoaded();
    if (totalAudio == 0) handleAudioLoaded();
}

function preloadImages(imagesList: Map<BitmapId, string> | null): void {
    if (!document.images) return;
    if (!imagesList) {
        totalImages = 0;
        return;
    }

    // Init load state
    totalImages = imagesList.size;
    imagesLoadedCount = 0;

    imagesList.forEach((value, key) => {
        let url = `${Constants.IMAGE_PATH}${value}`;
        images[key] = new Image();
        images[key].src = '';
        images[key].onload = (evt) => {
            imagesLoadedCount++;
            // console.info('Resource loaded: ' + name);
            if (imagesLoadedCount >= totalImages)
                handleImagesLoaded();
            (<HTMLElement>(evt.srcElement)).onload = null;
        };
        images[key].onerror = (evt) => {
            throw Error(`Could not load resource: "${name}" at "${url}"`);
        }
        console.info('Loading resource: ' + url);
        images[key].src = url;
    });
}

function preloadAudio(audioList: Map<AudioId, string> | null): void {
    let i = 0;
    if (!audioList) {
        totalAudio = 0;
        return;
    }

    // Init load state
    totalAudio = audioList.size;
    audioLoadedCount = 0;

    audioList.forEach((value, key) => {
        let url = `${Constants.AUDIO_PATH}${value}`;
        audio[key] = new Audio();
        audio[key].preload = 'auto';
        audio[key].controls = false;
        audio[key].loop = false;
        audio[key].src = url;
        audio[key].onloadeddata = () => {
            audioLoadedCount++;
            if (audioLoadedCount >= totalAudio)
                handleAudioLoaded();
            audio[key].onload = null;
        };
        audio[key].onerror = (evt) => {
            throw Error(`Could not load resource: "${name}" at "${url}"`);
        }
    });
}

// TODO: HANDLE POSSIBLE BEIDE BIJ FINISH-LIJN-BUG
function handleImagesLoaded(): void {
    imagesLoaded = true;
    console.info("All images loaded.");
    if (checkLoadingComplete()) handleLoadingComplete();
}

function handleAudioLoaded(): void {
    audioLoaded = true;
    console.info("All audio loaded.");
    if (checkLoadingComplete()) handleLoadingComplete();
}

function checkLoadingComplete(): boolean {
    return imagesLoaded && audioLoaded;
}

function handleLoadingComplete(): void {
    game.startAfterLoad();
}