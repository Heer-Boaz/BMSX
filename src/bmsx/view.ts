import type { Area, Size, Vector, id2htmlimg, vec2 } from './rompack';
import { BFont, IRegisterable, Identifier } from "./bmsx";
import { Registry } from './registry';

export interface FlipOptions {
    flip_h: boolean;
    flip_v: boolean;
}

export interface DrawRectOptions {
    area: Area;
    color: Color;
}

export interface DrawImgOptions {
    imgid: string;
    pos: Vector;
    scale?: vec2;
    flip?: FlipOptions;
    colorize?: Color;
}

export interface Color {
    r: number;
    g: number;
    b: number;
    a: number;
}

export class PixelData {
    public B: number;
    public G: number;
    public R: number;
}

/**
 * The `BaseView` class is an abstract class that serves as the base for all views in the application.
 * It provides common functionality and properties that are shared across all views.
 */
export abstract class BaseView implements IRegisterable {
    public get id(): Identifier { return 'view'; }
    public dispose(): void {
        // Deregister from registry
        Registry.instance.deregister(this);
    }

    public canvas: HTMLCanvasElement;
    public context: CanvasRenderingContext2D;
    public static images: id2htmlimg;
    public accessor default_font: BFont;

    public windowSize: Size;
    public viewportSize: Size;
    public dx: number;
    public dy: number;
    public scale: number;

    constructor(viewportsize: Size) {
        Registry.instance.register(this);
        this.viewportSize = viewportsize;
        this.canvas = document.getElementById('gamescreen') as HTMLCanvasElement;
    }

    public init(): void {

        this.calculateSize();
        this.canvas.width = this.viewportSize.x;
        this.canvas.height = this.viewportSize.y;
        this.handleResize();
        this.listenToMediaEvents();
    }

    /**
     * Draws the game on the canvas. If `clearCanvas` is set to `true`, the canvas will be cleared before drawing.
     * The method sorts the objects in the current space by depth and then iterates over them, calling their `paint` method if they are visible and not flagged for disposal.
     */
    public drawgame(clearCanvas: boolean = true): void {
        if (clearCanvas) game.view.clear();
        game.model.currentSpace.sort_by_depth(); // Required for each frame as objects can change depth during the flow of the game
        game.model.currentSpace.objects.forEach(o => !o.disposeFlag && o.visible && (o.updateComponentsWithTag('render'), o.paint?.()));
    }

    /**
     * Calculates the size of the canvas and the scale factor based on the current viewport size and window size.
     * The `dx` and `dy` properties represent the ratio of the window size to the viewport size in the x and y directions, respectively.
     * The `scale` property represents the minimum of `dx` and `dy`.
     */
    public calculateSize(): void {
        let self = game.view || this;

        let w = Math.max(document.documentElement.clientWidth, window.innerWidth || screen.width);
        let h = Math.max(document.documentElement.clientHeight, window.innerHeight || screen.height);
        self.windowSize = { x: w, y: h };
        self.dx = self.windowSize.x / self.viewportSize.x;
        self.dy = self.windowSize.y / self.viewportSize.y;
        self.scale = Math.min(self.dx, self.dy);
    }

    public handleResize(): void {
        if (document.getElementById('gamescreen')!.style.visibility === 'hidden') return;
        let self = game.view || this;
        self.calculateSize();
        self.canvas.style.width = `${self.viewportSize.x * self.scale}px`;
        self.canvas.style.height = `${self.viewportSize.y * self.scale}px`;
        self.canvas.style.left = (self.windowSize.x - self.canvas.width * self.scale) / 2 + "px";
        self.canvas.style.top = (self.windowSize.y - self.canvas.height * self.scale) / 2 + "px";
    }

    /**
     * Registers event listeners for window resize, orientation change, and fullscreen mode change.
     * When any of these events occur, the `handleResize` method is called to recalculate the size of the canvas and adjust its position and scale.
     */
    protected listenToMediaEvents(): void {
        const view = game.view;

        function handleResizeHelper() {
            view.handleResize.call(view);
        }

        window.addEventListener('resize', handleResizeHelper, false);
        window.addEventListener('orientationchange', handleResizeHelper, false);
        // https://stackoverflow.com/a/70719693
        window.matchMedia('(display-mode: fullscreen)').addEventListener('change', ({ matches }) => {
            if (matches) {
                window['isFullScreen'] = true;
            } else {
                window['isFullScreen'] = false;
            }
        });
    }

    /**
     * Determines the maximum scale factor that can be applied to the original buffer dimensions to fit the current client dimensions while maintaining aspect ratio.
     * @param clientWidth The current width of the client.
     * @param clientHeight The current height of the client.
     * @param originalBufferWidth The original width of the buffer.
     * @param originalBufferHeight The original height of the buffer.
     * @returns The maximum scale factor that can be applied to the original buffer dimensions.
     */
    public determineMaxScaleForFullscreen(clientWidth: number, clientHeight: number, originalBufferWidth: number, originalBufferHeight: number): number {
        if (clientWidth >= clientHeight) {
            return clientHeight / originalBufferHeight;
        }
        else {
            return clientWidth / originalBufferWidth;
        }
    }

    public toFullscreen(): void {
        // https://zinoui.com/blog/javascript-fullscreen-api
        window.addEventListener('keyup', BaseView.triggerFullScreenOnFakeUserEvent);
    }

    public get isFullscreen() {
        return window['isFullScreen'] ?? false;
    }

    public static get fullscreenEnabled() {
        return document.fullscreenEnabled || document['webkitFullscreenEnabled'] || document['webkitFullScreenEnabled'] || document['mozFullScreenEnabled'];
    }

    public static triggerFullScreenOnFakeUserEvent(): void {
        if (BaseView.fullscreenEnabled) {
            try {
                global.game.paused = true;
                document.documentElement.requestFullscreen?.()
                    .then(() => {
                        global.game.paused = false;
                    })
                    .catch(e => {
                        global.game.paused = false;
                        console.error(e);
                    });

                document.documentElement['mozRequestFullScreen']?.()
                    .then(() => global.game.paused = false)
                    .catch(e => {
                        global.game.paused = false;
                        console.error(e);
                    });
                document.documentElement['webkitRequestFullScreen']?.();
                document.documentElement['webkitRequestFullscreen']?.();
            }
            catch (error) {
                console.error(error);
            }
        }
        window.removeEventListener('keyup', BaseView.triggerFullScreenOnFakeUserEvent);
    }

    public ToWindowed(): void {
        window.addEventListener('keyup', BaseView.triggerWindowedOnFakeUserEvent);
    }

    public static triggerWindowedOnFakeUserEvent(): void {
        if (BaseView.fullscreenEnabled) {
            try {
                global.game.paused = true;
                document.exitFullscreen?.()
                    .then(() => global.game.paused = false)
                    .catch(e => {
                        global.game.paused = false;
                        console.error(e);
                    });
                document['webkitExitFullscreen']?.();
                document['mozExitFullScreen']?.();
            }
            catch (error) {
                // !BUG: Heb een bug gezien waarbij dit voorkomt.
                // Lijkt overeen te komen met het gebruik van de debugger-mogelijkheden van Boaz
                console.error(error);
            }
        }
        window.removeEventListener('keyup', BaseView.triggerWindowedOnFakeUserEvent);
    }


    public clear(): void {
        game.view.context.translate(0.5, 0.5);
        game.view.context.clearRect(0, 0, this.canvas.width, this.canvas.height);
        game.view.context.translate(-0.5, -0.5);
    }

    /**
     * Draws the "Press any key to start" message on the canvas.
     */
    public drawPressKey(): void {
        game.view.context.fillRect(0, 0, this.canvas.width, this.canvas.height);

        game.view.context.font = '12pt Monaco';
        game.view.context.fillStyle = 'white';
        game.view.context.save();
        game.view.context.fillText('Press any key to start', 56, 80);
        game.view.context.restore();
    }

    public drawImg(options: DrawImgOptions): void {
        const { pos, imgid, flip = { flip_h: false, flip_v: false }, scale = { x: 1, y: 1 } } = options;

        let img = BaseView.images[imgid];
        game.view.context.save();
        game.view.context.translate(~~pos.x, ~~pos.y);
        if (flip.flip_h) {
            game.view.context.scale(-1 * scale.x, 1 * scale.y);
            game.view.context.translate(-img.width, 0);
        }
        if (flip.flip_v) {
            game.view.context.scale(1 * scale.x, -1 * scale.y);
            game.view.context.translate(0, -img.height);
        }
        game.view.context.drawImage(img, 0, 0);
        game.view.context.restore();
    }

    public drawRectangle(options: DrawRectOptions): void {
        const { start: { x, y }, end: { x: ex, y: ey } } = options.area;
        const c = options.color;

        game.view.context.save();
        game.view.context.translate(0.5, 0.5);
        game.view.context.beginPath();
        game.view.context.strokeStyle = this.toRgb(c);
        game.view.context.rect(~~x, ~~y, ~~(ex - x), ~~(ey - y));
        game.view.context.stroke();
        game.view.context.restore();
    }

    public fillRectangle(options: DrawRectOptions): void {
        const { start: { x, y }, end: { x: ex, y: ey } } = options.area;
        const c = options.color;

        game.view.context.save();
        game.view.context.translate(0.5, 0.5);
        game.view.context.beginPath();
        let colorRgb = game.view.toRgb(c);
        game.view.context.fillStyle = colorRgb;
        game.view.context.strokeStyle = colorRgb;
        game.view.context.fillRect(~~x, ~~y, ~~(ex - x), ~~(ey - y));
        game.view.context.stroke();
        game.view.context.restore();
    }

    private toRgb(c: Color): string {
        return `rgb(${c.r},${c.g},${c.b},${c.a || 1})`;
    }
}

export function paintImage(options: DrawImgOptions): void {
    if (!options.imgid || options.imgid === 'none') return; // Don't draw anything when imgid = BitmapId.None. For animations, we don't always want to use visible = false

    game.view.drawImg(options);
}
