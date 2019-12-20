import { view, model } from "./engine";
import { Size, Point } from "./common";

export interface Color {
    r: number;
    g: number;
    b: number;
    a?: number;
}

export class PixelData {
    public B: number;
    public G: number;
    public R: number;
}

export const enum DrawImgFlags {
    None = 0,
    HFLIP = 1 << 0,
    VFLIP = 1 << 1,
}

export abstract class BaseView {
    public canvas: HTMLCanvasElement;
    public context: CanvasRenderingContext2D;
    public static images: { [key: number]: HTMLImageElement; };

    public windowSize: Size;
    public viewportSize: Size;
    public dx: number;
    public dy: number;
    public scale: number;

    constructor(viewportsize: Size) {
        this.canvas = <HTMLCanvasElement>document.getElementById('gamescreen');
        // this.context = this.canvas.getContext('2d');
        // this.context.imageSmoothingEnabled = false;
        this.viewportSize = viewportsize;
        this.calculateSize();
        this.canvas.width = this.viewportSize.x;
        this.canvas.height = this.viewportSize.y;
    }

    public init(): void {
        this.handleResize();
    }

    public drawgame(gamescreenOffset?: Point, clearCanvas: boolean = true): void {
        if (clearCanvas) view.clear();
        model.objects.forEach(o => !o.disposeFlag && o.paint && o.paint(gamescreenOffset));
    }

    public calculateSize(): void {
        let self = view || this;

        // var width = gl.canvas.clientWidth;
        // var height = gl.canvas.clientHeight;
        // if (gl.canvas.width != width ||
        //     gl.canvas.height != height) {
        //     gl.canvas.width = width;
        //     gl.canvas.height = height;
        // }

        let w = Math.max(document.documentElement.clientWidth, window.innerWidth || screen.width);
        let h = Math.max(document.documentElement.clientHeight, window.innerHeight || screen.height);
        // let w = self.canvas.clientWidth;
        // let h = self.canvas.clientHeight;
        self.windowSize = { x: w, y: h };
        self.dx = self.windowSize.x / self.viewportSize.x;
        self.dy = self.windowSize.y / self.viewportSize.y;
        self.scale = Math.min(self.dx, self.dy);
    }

    public handleResize(): void {
        if (document.getElementById('gamescreen').style.visibility === 'hidden') return;
        let self = view || this;
        self.calculateSize();
        self.canvas.style.width = `${self.viewportSize.x * self.scale}px`;
        self.canvas.style.height = `${self.viewportSize.y * self.scale}px`;
        // self.canvas.style.transform = `scale(${self.scale})`;
        self.canvas.style.left = (self.windowSize.x - self.canvas.width * self.scale) / 2 + "px";
        self.canvas.style.top = (self.windowSize.y - self.canvas.height * self.scale) / 2 + "px";
    }

    public DetermineMaxScaleForFullscreen(clientWidth: number, clientHeight: number, originalBufferWidth: number, originalBufferHeight: number): number {
        if (clientWidth >= clientHeight) {
            return clientHeight / originalBufferHeight;
        }
        else {
            return clientWidth / originalBufferWidth;
        }
    }

    public ToFullscreen(): void {
        // https://zinoui.com/blog/javascript-fullscreen-api
        window.addEventListener('keyup', BaseView.triggerFullScreenOnFakeUserEvent);
    }

    public static triggerFullScreenOnFakeUserEvent(): void {
        if (document.fullscreenEnabled) document.documentElement.requestFullscreen();
        window.removeEventListener('keyup', BaseView.triggerFullScreenOnFakeUserEvent);
    }

    public ToWindowed(): void {
        window.addEventListener('keyup', BaseView.triggerWindowedOnFakeUserEvent);
    }

    public static triggerWindowedOnFakeUserEvent(): void {
        document.exitFullscreen();
        window.removeEventListener('keyup', BaseView.triggerWindowedOnFakeUserEvent);
    }


    public clear(): void {
        view.context.translate(0.5, 0.5);
        view.context.clearRect(0, 0, this.canvas.width, this.canvas.height);
        view.context.translate(-0.5, -0.5);
    }

    public drawPressKey(): void {
        view.context.fillRect(0, 0, this.canvas.width, this.canvas.height);

        view.context.font = '12pt Monaco';
        view.context.fillStyle = 'white';
        view.context.save();
        view.context.fillText('Press any key to start', 56, 80);
        view.context.restore();
    }

    public drawImg(imgid: number, x: number, y: number, options?: number): void {
        let img = BaseView.images[imgid];
        // if (!img) {
        //     console.error(`Cannot find image with id '${imgid}'`);
        //     return;
        // }

        view.context.save();
        view.context.translate(~~x, ~~y);
        if (options & DrawImgFlags.HFLIP) {
            view.context.scale(-1, 1);
            view.context.translate(-img.width, 0);
        }
        if (options & DrawImgFlags.VFLIP) {
            view.context.scale(1, -1);
            view.context.translate(0, -img.height);
        }
        view.context.drawImage(img, 0, 0);
        view.context.restore();
    }

    public drawColoredBitmap(imgid: number, x: number, y: number, options: number, r: boolean = true, g: boolean = true, b: boolean = true, a: boolean = true) {
        // TODO: IMPLEMENTEER!!
        view.drawImg(imgid, x, y, options);
    }

    public drawRectangle(x: number, y: number, ex: number, ey: number, c: Color): void {
        view.context.save();
        view.context.translate(0.5, 0.5);
        view.context.beginPath();
        view.context.strokeStyle = this.toRgb(c);
        view.context.rect(~~x, ~~y, ~~(ex - x), ~~(ey - y));
        view.context.stroke();
        view.context.restore();
    }

    public fillRectangle(x: number, y: number, ex: number, ey: number, c: Color): void {
        view.context.save();
        view.context.translate(0.5, 0.5);
        view.context.beginPath();
        let colorRgb = view.toRgb(c);
        view.context.fillStyle = colorRgb;
        view.context.strokeStyle = colorRgb;
        view.context.fillRect(~~x, ~~y, ~~(ex - x), ~~(ey - y));
        view.context.stroke();
        view.context.restore();
    }

    private toRgb(c: Color): string {
        return `rgb(${c.r},${c.g},${c.b},${c.a || 1})`;
    }
}
