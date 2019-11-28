export function bla(): void { }

// import { Constants } from "./constants";
// // import { images, audio, game } from "./engine";
// // import { BitmapId, AudioId } from "../src/resourceids";

// let imagesLoadedCount: number;
// let totalImages: number;
// let imagesLoaded: boolean;
// let audioLoadedCount: number;
// let totalAudio: number;
// let audioLoaded: boolean;

// export const enum ResourceType {
//     Image,
//     Audio
// }

// export namespace GameLoader {
//     export function loadresource(src: string, type: ResourceType): HTMLImageElement {
//         let url: string;
//         switch (type) {
//             case ResourceType.Image:
//                 url = `${Constants.IMAGE_PATH}${src}`;
//                 break;
//             case ResourceType.Audio:
//                 url = `${Constants.AUDIO_PATH}${src}`;
//                 break;
//         }

//         let result = new Image();
//         result.src = '';
//         result.onload = (evt: Event) => {
//             (<HTMLElement>(evt.srcElement)).onload = null;
//         };
//         result.onerror = () => {
//             throw Error(`Could not load resource: "${name}" at "${url}"`);
//         }
//         console.info('Loading resource: ' + url);
//         result.src = url;

//         return result;
//     }

//     export function loadgame(img2src: Map<number, string> | null, snd2src: Map<number, string> | null): void {
//         imagesLoaded = false;
//         audioLoaded = false;

//         preloadImages(img2src);
//         preloadAudio(snd2src);
//         if (totalImages == 0) handleImagesLoaded();
//         if (totalAudio == 0) handleAudioLoaded();
//     }

//     export function preloadImages(imagesList: Map<number, string> | null): void {
//         if (!document.images) return;
//         if (!imagesList) {
//             totalImages = 0;
//             return;
//         }

//         // Init load state
//         totalImages = imagesList.size;
//         imagesLoadedCount = 0;

//         imagesList.forEach((value, key) => {
//             let url = `${Constants.IMAGE_PATH}${value}`;
//             images[key] = new Image();
//             // images[key].src = '';
//             images[key].onload = (evt: Event) => {
//                 imagesLoadedCount++;
//                 // console.info('Resource loaded: ' + name);
//                 if (imagesLoadedCount >= totalImages)
//                     handleImagesLoaded();
//                 (<HTMLElement>(evt.srcElement)).onload = null;
//             };
//             images[key].onerror = () => {
//                 throw Error(`Could not load image: "${key}" at "${url}"`);
//             }
//             console.info('Loading resource: ' + url);
//             images[key].src = url;
//         });
//     }

//     export function preloadAudio(audioList: Map<number, string> | null): void {
//         let i = 0;
//         if (!audioList) {
//             totalAudio = 0;
//             return;
//         }

//         // Init load state
//         totalAudio = audioList.size;
//         audioLoadedCount = 0;

//         audioList.forEach((value, key) => {
//             let url = `${Constants.AUDIO_PATH}${value}`;
//             audio[key] = new Audio();
//             audio[key].preload = 'auto';
//             audio[key].controls = false;
//             audio[key].loop = false;
//             audio[key].onloadeddata = () => {
//                 audioLoadedCount++;
//                 if (audioLoadedCount >= totalAudio)
//                     handleAudioLoaded();
//                 audio[key].onload = null;
//             };
//             audio[key].onerror = () => {
//                 throw Error(`Could not load audio: "${key}" at "${url}"`);
//             }
//             audio[key].src = url;
//         });
//     }

//     // TODO: HANDLE POSSIBLE BEIDE BIJ FINISH-LIJN-BUG
//     export function handleImagesLoaded(): void {
//         imagesLoaded = true;
//         console.info("All images loaded.");
//         if (checkLoadingComplete()) handleLoadingComplete();
//     }

//     export function handleAudioLoaded(): void {
//         audioLoaded = true;
//         console.info("All audio loaded.");
//         if (checkLoadingComplete()) handleLoadingComplete();
//     }

//     export function checkLoadingComplete(): boolean {
//         return imagesLoaded && audioLoaded;
//     }

//     export function handleLoadingComplete(): void {
//         // game.startAfterGameLoad();
//     }
// }