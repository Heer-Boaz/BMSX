import { Constants } from "./constants";
import { images, audio, game } from "./engine";

let imagesLoadedCount: number;
let totalImages: number;
let imagesLoaded: boolean;
let audioLoadedCount: number;
let totalAudio: number;
let audioLoaded: boolean;

export function loadgame(): void {
    imagesLoaded = false;
    audioLoaded = false;

    preloadImages(Constants.IMAGE_SOURCES);
    preloadAudio(Constants.AUDIO_SOURCES);
    if (totalImages == 0) handleImagesLoaded();
    if (totalAudio == 0) handleAudioLoaded();
}

function preloadImages(imagesList: string[] | null): void {
    if (document.images) {
        let i = 0;
        if (imagesList == null) {
            totalImages = 0;
            return;
        }
        // Init load state
        totalImages = imagesList.length;
        imagesLoadedCount = 0;

        for (i = 0; i < imagesList.length; i++) {
            let name_url = imagesList[i].split(':');
            let name = name_url[0];
            let url = Constants.IMAGE_PATH + name_url[1];
            images[name] = new Image();

            images[name].src = '';
            images[name].onload = (evt) => {
                imagesLoadedCount++;
                // console.info('Resource loaded: ' + name);
                if (imagesLoadedCount >= totalImages)
                    handleImagesLoaded();
                (<HTMLElement>(evt.srcElement)).onload = null;
            };
            images[name].onerror = (evt) => {
                console.error('Could not load resource: "' + name + '" at "' + url + '"');
            }
            console.info('Loading resource: ' + url);
            images[name].src = url;
        }
    }
}

function preloadAudio(audioList: string[] | null): void {
    let i = 0;
    if (audioList == null) {
        totalAudio = 0;
        return;
    }

    // Init load state
    totalAudio = audioList.length;
    audioLoadedCount = 0;

    for (i = 0; i < audioList.length; i++) {
        let name_url = audioList[i].split(':');
        let name = name_url[0];
        let url = Constants.AUDIO_PATH + name_url[1];
        audio[name] = new Audio();
        audio[name].preload = 'auto';
        audio[name].controls = false;
        audio[name].loop = false;
        audio[name].src = url;
        audio[name].onloadeddata = () => {
            audioLoadedCount++;
            if (audioLoadedCount >= totalAudio)
                handleAudioLoaded();
            audio[name].onload = null;
        };
        audio[name].onerror = (evt) => {
            console.error('Could not load resource: "' + name + '" at "' + url + '"');
        }
    }
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