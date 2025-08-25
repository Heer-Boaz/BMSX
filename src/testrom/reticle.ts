import { $, SpriteObject, new_area } from '../bmsx';
import { BitmapId } from './resourceids';

export class Reticle extends SpriteObject {
    ox = 0; oy = 0; private smooth = 0.18; private maxRadius = 0.4;
    constructor() { super('reticle'); this.imgid = BitmapId.b; this._hitarea = new_area(0, 0, 14, 14); this.visible = true; }
    updateFromInput() {
        const input = $.input.getPlayerInput(1);
        let dx = 0, dy = 0;
        if (input.getActionState('left').pressed) dx -= 1; if (input.getActionState('right').pressed) dx += 1; if (input.getActionState('up').pressed) dy += 1; if (input.getActionState('down').pressed) dy -= 1;
        const targetOx = this.ox + dx * 0.03; const targetOy = this.oy + dy * 0.03;
        const r = Math.hypot(targetOx, targetOy); if (r > this.maxRadius) { this.ox = targetOx / r * this.maxRadius; this.oy = targetOy / r * this.maxRadius; } else { this.ox = this.ox + (targetOx - this.ox) * this.smooth; this.oy = this.oy + (targetOy - this.oy) * this.smooth; }
    }
}
