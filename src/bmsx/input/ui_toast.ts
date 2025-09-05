import { insavegame } from '../serializer/gameserializer';
import { WorldObject } from '../core/object/worldobject';
import { $, } from '../core/game';
import { ZCOORD_MAX } from '../render/backend/webgl.constants';
import { TextWriter } from '../render/textwriter';

@insavegame
class Toast extends WorldObject {
    private createdAt: number = 0;
    constructor(public text: string, public ms: number = 1800) {
        super(`toast_${Math.floor(Math.random() * 1e9)}`, 'toast');
        this.z = ZCOORD_MAX; // draw on top
    }
    override onspawn(): void {
        super.onspawn();
        this.createdAt = performance.now();
    }
    override paint(): void {
        const now = performance.now();
        const t = now - this.createdAt;
        if (t >= this.ms) { this.markForDisposal(); return; }
        const vp = $.view.viewportSize;
        const centerX = vp.x / 2;
        const topY = 12;
        const alpha = t < 200 ? t / 200 : (t > this.ms - 300 ? (this.ms - t) / 300 : 1);
        const padX = 8, padY = 4;
        // Approx text width: 6.5 px per char fallback; adjust as you wish
        const approxW = Math.min(vp.x - 16, Math.max(80, this.text.length * 6.5));
        const rect = { area: { start: { x: centerX - approxW / 2 - padX, y: topY - padY, z: this.z }, end: { x: centerX + approxW / 2 + padX, y: topY + 10 + padY, z: this.z } }, color: { r: 0, g: 0, b: 0, a: 0.55 * alpha } };
        $.view.drawRectangle(rect);
        TextWriter.drawText(centerX - approxW / 2, topY, this.text, this.z, undefined, { r: 255, g: 255, b: 255, a: Math.max(0, Math.min(1, alpha)) });
    }
}

export function spawnToast(text: string, ms = 1800): void {
    const o = new Toast(text, ms);
    $.world.get_space('ui').spawn(o);
}

export function controllerUnassignedToast(): void {
    spawnToast('Controller unassigned', 1600);
}
