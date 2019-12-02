import { Constants } from "./constants"
import { view } from "./engine";
import { Size, Point, Color } from "./interfaces";

export enum DrawBitmap {
    HFLIP = 0x1,
    VFLIP = 0x2,
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
        self.canvas.width = self.viewportSize.x * self.scale;
        self.canvas.height = self.viewportSize.y * self.scale;

        self.canvas.style.left = (self.windowSize.x - self.canvas.width) / 2 + "px";
        self.canvas.style.top = (self.windowSize.y - self.canvas.height) / 2 + "px";
    }

    public clear(): void {
        view.context.clearRect(0, 0, this.canvas.width, this.canvas.height);
    }

    public drawPressKey(): void {
        this.context.fillRect(0, 0, this.canvas.width, this.canvas.height);

        this.context.font = '12pt Monaco';
        this.context.fillStyle = 'white';
        this.context.save();
        this.context.scale(this.scale, this.scale);
        this.context.fillText('Press any key to start', 56, 80);
        this.context.restore();
    }

    public drawImg(imgid: number, x: number, y: number, options?: number): void {
        let img = View.images.get(imgid);
        if (!img) throw new Error(`Cannot find image with id '${imgid}'`);

        this.context.save();
        this.context.scale(this.scale, this.scale);
        this.context.imageSmoothingEnabled = false;
        this.context.drawImage(img, x, y);
        this.context.restore();
    }

    public drawColoredBitmap(imgid: number, x: number, y: number, r: number, g: number, b: number, a?: number) {
        // TODO: IMPLEMENTEER!!
        this.drawImg(imgid, x, y, 0);
    }

    public drawDebug(img: HTMLImageElement, pos: Point): void {
        this.context.save();
        this.context.scale(this.scale, this.scale);
        this.context.imageSmoothingEnabled = false;
        this.context.drawImage(img, pos.x, pos.y);
        this.context.restore();
    }

    public drawRectangle(x: number, y: number, ex: number, ey: number, c: Color): void {
        this.context.save();
        this.context.scale(this.scale, this.scale);
        this.context.beginPath();
        this.context.strokeStyle = this.toRgb(c);
        this.context.rect(x, y, ex - x, ey - y);
        this.context.stroke();
        this.context.restore();
    }

    public fillRectangle(x: number, y: number, ex: number, ey: number, c: Color): void {
        this.context.save();
        this.context.scale(this.scale, this.scale);
        this.context.beginPath();
        let colorRgb = this.toRgb(c);
        this.context.fillStyle = colorRgb;
        this.context.strokeStyle = colorRgb;
        this.context.fillRect(x, y, ex - x, ey - y);
        this.context.stroke();
        this.context.restore();
    }

    private toRgb(c: Color): string {
        return `rgb(${c.r},${c.g},${c.b})`;
    }
}
