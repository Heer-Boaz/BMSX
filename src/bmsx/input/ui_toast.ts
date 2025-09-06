import { insavegame } from '../serializer/gameserializer';
import { WorldObject } from '../core/object/worldobject';
import { $, } from '../core/game';
import { ZCOORD_MAX } from '../render/backend/webgl.constants';
import { TextWriter } from '../render/textwriter';
import { BFont } from '../core/font';

const TOAST_DURATION = 1800;

@insavegame
class Toast extends WorldObject {
    private createdAt: number = 0;

    constructor(public text: string, public font?: BFont, public ms: number = TOAST_DURATION) {
        super();
        this.z = ZCOORD_MAX; // draw on top
    }
    
    override onspawn(): void {
        super.onspawn();
        this.createdAt = performance.now();
    }

    override paint(): void {
        const now = performance.now();
        const t = now - this.createdAt;
        // TODO: PRETTY UGLY TO NOT USE A (SIMPLE) STATE MACHINE FOR THIS
        if (t >= this.ms) { this.markForDisposal(); return; } // time's up
        const vp = $.view.viewportSize;
        const centerX = vp.x / 2;
        const topY = 12;
        const alpha = t < 200 ? t / 200 : (t > this.ms - 300 ? (this.ms - t) / 300 : 1);
        const padX = 8, padY = 4;
        const font = this.font ?? $.view.default_font;
        const textWidth = font.textWidth(this.text) + 2 * padX;
        const rect = { area: { start: { x: centerX - textWidth / 2 - padX, y: topY - padY, z: this.z }, end: { x: centerX + textWidth / 2 + padX, y: topY + 10 + padY, z: this.z } }, color: { r: 0, g: 0, b: 0, a: 0.85 * alpha } };
        $.view.fillRectangle(rect);
        TextWriter.drawText(centerX - textWidth / 2, topY, this.text, this.z, undefined, { r: 255, g: 255, b: 255, a: Math.max(0, Math.min(1, alpha)) });
    }
}

export function spawnToast(text: string, font?: BFont, ms?: number): void {
    const o = new Toast(text, font, ms);
    $.world.get_space('ui').spawn(o);
}

export function controllerUnassignedToast(): void {
    spawnToast('Controller unassigned');
}
