import { Size, Point } from "./common";
export interface Color {
    r: number;
    g: number;
    b: number;
    a?: number;
}
export declare class PixelData {
    B: number;
    G: number;
    R: number;
}
export declare const enum DrawImgFlags {
    None = 0,
    HFLIP = 1,
    VFLIP = 2
}
export declare abstract class BaseView {
    canvas: HTMLCanvasElement;
    context: CanvasRenderingContext2D;
    static images: Map<number, HTMLImageElement>;
    windowSize: Size;
    viewportSize: Size;
    dx: number;
    dy: number;
    scale: number;
    constructor(viewportsize: Size);
    init(): void;
    drawgame(gamescreenOffset?: Point, clearCanvas?: boolean): void;
    calculateSize(): void;
    handleResize(): void;
    DetermineMaxScaleForFullscreen(clientWidth: number, clientHeight: number, originalBufferWidth: number, originalBufferHeight: number): number;
    ToFullscreen(): void;
    static triggerFullScreenOnFakeUserEvent(): void;
    ToWindowed(): void;
    static triggerWindowedOnFakeUserEvent(): void;
    clear(): void;
    drawPressKey(): void;
    drawImg(imgid: number, x: number, y: number, options?: number): void;
    drawColoredBitmap(imgid: number, x: number, y: number, r: number, g: number, b: number, a?: number): void;
    drawRectangle(x: number, y: number, ex: number, ey: number, c: Color): void;
    fillRectangle(x: number, y: number, ex: number, ey: number, c: Color): void;
    private toRgb;
}
//# sourceMappingURL=view.d.ts.map