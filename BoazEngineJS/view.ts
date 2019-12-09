import { Constants } from "./constants"
import { view } from "./engine";
import { Size, Point, Color } from "../lib/interfaces";

export const enum DrawImgFlags {
    None = 0,
    HFLIP = 1 << 0,
    VFLIP = 1 << 1,
}

export class View {
    public canvas: HTMLCanvasElement;
    public context: CanvasRenderingContext2D;
    public static images: Map<number, HTMLImageElement>;

    public windowSize: Size;
    public viewportSize: Size;
    public dx: number;
    public dy: number;
    public scale: number;

    constructor(viewportsize: Size) {
        this.canvas = <HTMLCanvasElement>document.getElementById('gamescreen');
        this.context = this.canvas.getContext('2d');
        this.context.imageSmoothingEnabled = false;
        this.viewportSize = viewportsize;
        this.calculateSize();
        this.canvas.width = this.viewportSize.x;
        this.canvas.height = this.viewportSize.y;
    }

    public init(): void {
        this.handleResize();
    }

    public calculateSize(): void {
        let self = view || this;
        let w = Math.max(document.documentElement.clientWidth, window.innerWidth || 0);
        let h = Math.max(document.documentElement.clientHeight, window.innerHeight || 0);
        self.windowSize = <Size>{ x: w, y: h };
        self.dx = self.windowSize.x / self.viewportSize.x;
        self.dy = self.windowSize.y / self.viewportSize.y;
        self.scale = Math.min(self.dx, self.dy);
    }

    public handleResize(): void {
        if (document.getElementById('gamescreen').style.visibility === 'hidden') return;
        let self = view || this;
        self.calculateSize();
        self.canvas.style.width = `${self.viewportSize.x * this.scale}px`;
        self.canvas.style.height = `${self.viewportSize.y * this.scale}px`;
        // self.canvas.style.transform = `scale(${self.scale})`;
        self.canvas.style.left = (self.windowSize.x - self.canvas.width * self.scale) / 2 + "px";
        self.canvas.style.top = (self.windowSize.y - self.canvas.height * self.scale) / 2 + "px";
    }

    public DetermineMaxScaleForFullscreen(clientWidth: number, clientHeight: number, originalBufferWidth: number, originalBufferHeight: number): number {
        if (clientWidth >= clientHeight) {
            return clientHeight / <number>originalBufferHeight;
        }
        else {
            return clientWidth / <number>originalBufferWidth;
        }
    }

    public ToFullscreen(): void {
        // https://zinoui.com/blog/javascript-fullscreen-api
        window.addEventListener('keyup', View.triggerFullScreenOnFakeUserEvent);
    }

    public static triggerFullScreenOnFakeUserEvent(): void {
        if (document.fullscreenEnabled) document.documentElement.requestFullscreen();
        window.removeEventListener('keyup', View.triggerFullScreenOnFakeUserEvent);
    }

    public ToWindowed(): void {
        window.addEventListener('keyup', View.triggerWindowedOnFakeUserEvent);
    }

    public static triggerWindowedOnFakeUserEvent(): void {
        document.exitFullscreen();
        window.removeEventListener('keyup', View.triggerWindowedOnFakeUserEvent);
    }


    public clear(): void {
        view.context.translate(0.5, 0.5);
        view.context.clearRect(0, 0, this.canvas.width, this.canvas.height);
        view.context.translate(-0.5, -0.5);
    }

    public drawPressKey(): void {
        this.context.fillRect(0, 0, this.canvas.width, this.canvas.height);

        this.context.font = '12pt Monaco';
        this.context.fillStyle = 'white';
        this.context.save();
        this.context.fillText('Press any key to start', 56, 80);
        this.context.restore();
    }

    public drawImg(imgid: number, x: number, y: number, options?: number): void {
        let img = View.images.get(imgid);
        if (!img) throw new Error(`Cannot find image with id '${imgid}'`);

        this.context.save();
        this.context.translate(~~x, ~~y);
        if (options & DrawImgFlags.HFLIP) {
            this.context.scale(-1, 1);
            this.context.translate(-img.width, 0);
        }
        if (options & DrawImgFlags.VFLIP) {
            this.context.scale(1, -1);
            this.context.translate(0, -img.height);
        }
        this.context.drawImage(img, 0, 0);
        this.context.restore();
    }

    public drawColoredBitmap(imgid: number, x: number, y: number, r: number, g: number, b: number, a?: number) {
        // TODO: IMPLEMENTEER!!
        this.drawImg(imgid, x, y, 0);
    }

    public drawRectangle(x: number, y: number, ex: number, ey: number, c: Color): void {
        this.context.save();
        this.context.translate(0.5, 0.5);
        this.context.beginPath();
        this.context.strokeStyle = this.toRgb(c);
        this.context.rect(~~x, ~~y, ~~(ex - x), ~~(ey - y));
        this.context.stroke();
        this.context.restore();
    }

    public fillRectangle(x: number, y: number, ex: number, ey: number, c: Color): void {
        this.context.save();
        this.context.translate(0.5, 0.5);
        this.context.beginPath();
        let colorRgb = this.toRgb(c);
        this.context.fillStyle = colorRgb;
        this.context.strokeStyle = colorRgb;
        this.context.fillRect(~~x, ~~y, ~~(ex - x), ~~(ey - y));
        this.context.stroke();
        this.context.restore();
    }

    private toRgb(c: Color): string {
        return `rgb(${c.r},${c.g},${c.b},${c.a || 1})`;
    }
}
