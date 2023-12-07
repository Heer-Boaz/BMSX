import { id2htmlimg } from './rompack.d';
import { Size, vec3 } from "./bmsx";
import { BFont } from "./bmsx";
import { update_tagged_components } from './component';

export interface DrawImgOptions {
    imgid: string;
    x: number;
    y: number;
    z: number;
    sx?: number;
    sy?: number;
    flip_h?: boolean;
    flip_v?: boolean;
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
export abstract class BaseView {
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
        this.listenToMediaEvents();
    }

    /**
     * Draws the game on the canvas. If `clearCanvas` is set to `true`, the canvas will be cleared before drawing.
     * The method sorts the objects in the current space by depth and then iterates over them, calling their `paint` method if they are visible and not flagged for disposal.
     */
    public drawgame(clearCanvas: boolean = true): void {
        if (clearCanvas) global.view.clear();
        global.model.currentSpace.sort_by_depth(); // Required for each frame as objects can change depth during the flow of the game
        global.model.currentSpace.objects.forEach(o => !o.disposeFlag && o.visible && (o.updateComponentsWithTag('render'), o.paint?.()));
    }

    /**
     * Calculates the size of the canvas and the scale factor based on the current viewport size and window size.
     * The `dx` and `dy` properties represent the ratio of the window size to the viewport size in the x and y directions, respectively.
     * The `scale` property represents the minimum of `dx` and `dy`.
     */
    public calculateSize(): void {
        let self = global.view || this;

        let w = Math.max(document.documentElement.clientWidth, window.innerWidth || screen.width);
        let h = Math.max(document.documentElement.clientHeight, window.innerHeight || screen.height);
        self.windowSize = { x: w, y: h };
        self.dx = self.windowSize.x / self.viewportSize.x;
        self.dy = self.windowSize.y / self.viewportSize.y;
        self.scale = Math.min(self.dx, self.dy);
    }

    public handleResize(): void {
        if (document.getElementById('gamescreen')!.style.visibility === 'hidden') return;
        let self = global.view || this;
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
        const view = global.view;

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
        global.view.context.translate(0.5, 0.5);
        global.view.context.clearRect(0, 0, this.canvas.width, this.canvas.height);
        global.view.context.translate(-0.5, -0.5);
    }

    /**
     * Draws the "Press any key to start" message on the canvas.
     */
    public drawPressKey(): void {
        global.view.context.fillRect(0, 0, this.canvas.width, this.canvas.height);

        global.view.context.font = '12pt Monaco';
        global.view.context.fillStyle = 'white';
        global.view.context.save();
        global.view.context.fillText('Press any key to start', 56, 80);
        global.view.context.restore();
    }

    public drawImg(options: DrawImgOptions): void {
        let { x, y, imgid, flip_h = false, flip_v = false, sx = 1, sy = 1 } = options;

        let img = BaseView.images[imgid];
        global.view.context.save();
        global.view.context.translate(~~x, ~~y);
        if (flip_h) {
            global.view.context.scale(-1 * sx, 1 * sy);
            global.view.context.translate(-img.width, 0);
        }
        if (flip_v) {
            global.view.context.scale(1 * sx, -1 * sy);
            global.view.context.translate(0, -img.height);
        }
        global.view.context.drawImage(img, 0, 0);
        global.view.context.restore();
    }

    public drawRectangle(x: number, y: number, ex: number, ey: number, c: Color): void {
        global.view.context.save();
        global.view.context.translate(0.5, 0.5);
        global.view.context.beginPath();
        global.view.context.strokeStyle = this.toRgb(c);
        global.view.context.rect(~~x, ~~y, ~~(ex - x), ~~(ey - y));
        global.view.context.stroke();
        global.view.context.restore();
    }

    public fillRectangle(x: number, y: number, ex: number, ey: number, c: Color): void {
        global.view.context.save();
        global.view.context.translate(0.5, 0.5);
        global.view.context.beginPath();
        let colorRgb = global.view.toRgb(c);
        global.view.context.fillStyle = colorRgb;
        global.view.context.strokeStyle = colorRgb;
        global.view.context.fillRect(~~x, ~~y, ~~(ex - x), ~~(ey - y));
        global.view.context.stroke();
        global.view.context.restore();
    }

    private toRgb(c: Color): string {
        return `rgb(${c.r},${c.g},${c.b},${c.a || 1})`;
    }
}

export function paintImage(options: DrawImgOptions): void {
    if (!options.imgid || options.imgid === 'None') return; // Don't draw anything when imgid = BitmapId.None. For animations, we don't always want to use visible = false

    global.view.drawImg(options);
}
