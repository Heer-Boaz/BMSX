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
        this.canvas = <HTMLCanvasElement>$('#gamescreen')[0];
        this.context = this.canvas.getContext('2d');
        this.context.imageSmoothingEnabled = false;
        this.viewportSize = viewportsize;
    }

    public init(): void {
        this.handleResize();
    }

    public setRelativeToScreenSize(element: HTMLElement, size: Point): void {
        // element.style.width = [size.x * this.dx, 'px'].join('');
        // element.style.height = [size.y * this.dy, 'px'].join('');
        // element.style.transform = 'translate(' + ~~(pos.x * this.dx) + 'px,' + ~~(pos.y * this.dy) + 'px) scale(' + this.dx + ',' + this.dy + ')';
    }

    public calculateSize(): void {
        let w = Math.max(document.documentElement.clientWidth, window.innerWidth || 0);
        let h = Math.max(document.documentElement.clientHeight, window.innerHeight || 0);
        this.windowSize = <Size>{ x: w, y: h };
        this.dx = this.windowSize.x / this.viewportSize.x;
        this.dy = this.windowSize.y / this.viewportSize.y;
        this.scale = Math.min(this.dx, this.dy);
    }

    public handleResize(): void {
        if (document.getElementById('gamescreen').style.visibility == 'hidden') return;
        view.calculateSize();
        this.canvas.width = this.viewportSize.x * this.scale; //this.windowSize.x;
        this.canvas.height = this.viewportSize.y * this.scale; //this.windowSize.y;

        this.canvas.style.left = (this.windowSize.x - this.canvas.width) / 2 + "px";
        this.canvas.style.top = (this.windowSize.y - this.canvas.height) / 2 + "px";
        // document.getElementById('gamescreen').style.transform = ['scale(', view.dx, ',', view.dy, ')'].join('');
        // document.getElementById('gamescreen').style.transformOrigin = '0 0';
        // document.getElementById('gamescreen').style.width = (view.windowSize.x * (1 + view.dx)) + 'px';
        // document.getElementById('gamescreen').style.height = (view.windowSize.y * (1 + view.dy)) + 'px';

        // model.objects.forEach((x) => { x.handleResizeEvent(); });
    }

    public clear(): void {
        // Clear the canvas
        this.context.clearRect(0, 0, this.canvas.width, this.canvas.height);
    }

    public drawLoading(): void {
        this.clear();

        this.context.font = '18pt Calibri';
        this.context.fillStyle = 'white';
        this.context.fillText('Loading...', 10, 25);
    }

    public drawImg(imgid: number, x: number, y: number, options?: number): void {
        let img = View.images.get(imgid);
        if (!img) throw new Error("Cannot find image with id '" + imgid + "'");

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
