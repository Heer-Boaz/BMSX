import { Constants } from "./constants"
import { view } from "./engine";
import { Size, Point, Color } from "./interfaces";

export class View {
    public windowSize: Size;
    public dx: number;
    public dy: number;
    public dxy: number;

    constructor() {
    }

    public init(): void {
        this.handleResize();
    }

    public setRelativeToScreenSize(element: HTMLElement, size: Point): void {
        element.style.width = [size.x * this.dx, 'px'].join('');
        element.style.height = [size.y * this.dy, 'px'].join('');
        // element.style.transform = 'translate(' + ~~(pos.x * this.dx) + 'px,' + ~~(pos.y * this.dy) + 'px) scale(' + this.dx + ',' + this.dy + ')';
    }

    public calculateSize(): void {
        let w = Math.max(document.documentElement.clientWidth, window.innerWidth || 0);
        let h = Math.max(document.documentElement.clientHeight, window.innerHeight || 0);
        this.windowSize = <Size>{ x: w, y: h };
        this.dx = this.windowSize.x / Constants.GAMESCREEN_WIDTH;
        this.dy = this.windowSize.y / Constants.GAMESCREEN_HEIGHT;
        this.dxy = Math.min(this.dx, this.dy);
    }

    public handleResize(): void {
        if (document.getElementById('gamescreen').style.visibility == 'hidden') return;
        view.calculateSize();

        document.getElementById('gamescreen').style.transform = ['scale(', view.dx, ',', view.dy, ')'].join('');
        document.getElementById('gamescreen').style.transformOrigin = '0 0';
        document.getElementById('gamescreen').style.width = (view.windowSize.x * (1 + view.dx)) + 'px';
        document.getElementById('gamescreen').style.height = (view.windowSize.y * (1 + view.dy)) + 'px';
        // model.objects.forEach((x) => { x.handleResizeEvent(); });
    }

    public draw(): void {
        // TODO: IMPLEMENTEER!
        throw ("Niet geïmplementeerd :(");
    }

    public drawLoading(): void {
        // TODO: IMPLEMENTEER!
        throw ("Niet geïmplementeerd :(");
    }

    public DrawBitmap(imgId: number, x: number, y: number, options?: number): void {
        this.drawImg(imgId, <Point>{ x: x, y: y }, options || undefined);
    }

    public DrawColoredBitmap(imgId: number, x: number, y: number, r: number, g: number, b: number, a?: number) {
        // TODO: IMPLEMENTEER!!
        throw ("Niet geïmplementeerd :(");
    }

    public drawImg(imgId: string | number, pos: Point, options?: number): void {
        // TODO: IMPLEMENTEER!
        throw ("Niet geïmplementeerd :(");
    }

    public DrawRectangle(x: number, y: number, ex: number, ey: number, c: Color): void {
        // TODO: IMPLEMENTEER!
        throw ("Niet geïmplementeerd :(");
    }

    public FillRectangle(x: number, y: number, ex: number, ey: number, c: Color): void {
        // TODO: IMPLEMENTEER!
        throw ("Niet geïmplementeerd :(");
    }
}
