import { $, $world, WorldObject, Msx1Colors, TextWriter } from '../bmsx';
import { EnemyHealthComponent } from './enemyhealth';

export class RailShooterHUD extends WorldObject {
    score = 0; combo = 1; private lastHitTime = 0; comboWindow = 1.5; bossId: string | null = null;
    private comboFade = 0; // alpha fade for combo text when inactive
    private hitFlash = 0; // brief flash when a hit is registered
    reticle?: { ox: number; oy: number }; // lightweight reference for aiming offset
    registerHit(now: number, damage: number, killed: boolean, scoreValue: number, _comboMultiplier: number) {
        if (now - this.lastHitTime < this.comboWindow) this.combo++; else this.combo = 1;
        this.lastHitTime = now; this.comboFade = 1;
        this.score += killed ? (scoreValue * this.combo) : Math.round(damage * this.combo * 0.5);
        this.hitFlash = 0.12;
    }
    override run(): void { const now = performance.now() / 1000; if (now - this.lastHitTime > this.comboWindow) { this.combo = 1; } if (this.comboFade > 0) this.comboFade -= ($.deltaTime / 1000) * 1.5; if (this.hitFlash > 0) this.hitFlash -= $.deltaTime / 1000; }
    override paint(): void {
        // Score right aligned top-right
        const s = `SCORE ${this.score}`;
        const gw = $world.gamewidth;
        const x = gw - s.length * 8 - 4;
        TextWriter.drawText(x, 4, s);
        if (this.combo > 1 || this.comboFade > 0) {
            const alpha = Math.min(1, Math.max(0, this.comboFade));
            // Simple color pulsing using alpha selecting palette bright color
            TextWriter.drawText(4, 4, `x${this.combo}`, undefined, undefined, Msx1Colors[alpha > 0.5 ? 15 : 11]);
        }
        // Reticle (screen center + offset from aiming)
        const gh = $world.gameheight;
        const cx = Math.floor(gw / 2); const cy = Math.floor(gh / 2);
        const ox = (this.reticle?.ox ?? 0) * 110; // scale normalized offset to pixels
        const oy = -(this.reticle?.oy ?? 0) * 110; // Y inverted for screen space
        const rx = cx + Math.round(ox); const ry = cy + Math.round(oy);
        const flash = this.hitFlash > 0 ? 1 - (this.hitFlash / 0.12) : 0;
        const color = Msx1Colors[flash > 0 ? 9 : 15];
        // Simple crosshair
        TextWriter.drawText(rx - 4, ry, '+', undefined, undefined, color);
        if (this.bossId) {
            const boss = $world.getWorldObject(this.bossId);
            if (boss) {
                const bh = boss.getComponent?.(EnemyHealthComponent) as EnemyHealthComponent | undefined;
                if (bh && !bh.dead) {
                    const pct = Math.round((bh.hp / bh.maxHp) * 100);
                    TextWriter.drawText(4, 14, `BOSS ${pct}%`);
                }
            }
        }
    }
}
