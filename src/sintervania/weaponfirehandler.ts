import { Model, MainWeaponType } from "./gamemodel";
import { TriRoe } from "./triroe";
import { SM } from "bmsx/soundmaster";
import { AudioId } from "./resourceids";
import { waitDuration, copyPoint, Direction, Point } from "bmsx/common";
import { Cross } from "./cross";
import { model } from 'bmsx';

export class WeaponFireHandler {
    private static readonly msCrossCooldown: number = 20;
    private static readonly msTriRoeCooldown: number = 1000;
    private static _mainWeaponCurrentCooldown: number;
    private static get mainWeaponCurrentCooldown(): number {
        return WeaponFireHandler._mainWeaponCurrentCooldown;
    }

    private static set mainWeaponCurrentCooldown(value: number) {
        if (value > WeaponFireHandler._mainWeaponCurrentCooldown || !(model as Model).MainWeaponCooldownTimer.running)
            WeaponFireHandler._mainWeaponCurrentCooldown = value;
    }

    public static get MainWeaponOnCooldown(): boolean {
        if ((model as Model).MainWeaponCooldownTimer.running) {
            if (waitDuration((model as Model).MainWeaponCooldownTimer, WeaponFireHandler.mainWeaponCurrentCooldown)) {
                (model as Model).MainWeaponCooldownTimer.stop();
                return false;
            }
            return true;
        }
        return false;
    }

    private static _secWeaponCurrentCooldown: number;
    private static get secWeaponCurrentCooldown(): number {
        return WeaponFireHandler._secWeaponCurrentCooldown;
    }

    private static set secWeaponCurrentCooldown(value: number) {
        if (value > WeaponFireHandler._secWeaponCurrentCooldown || !(model as Model).SecWeaponCooldownTimer.running)
            WeaponFireHandler._secWeaponCurrentCooldown = value;
    }

    public static get SecWeaponOnCooldown(): boolean {
        if ((model as Model).SecWeaponCooldownTimer.running) {
            if (waitDuration((model as Model).SecWeaponCooldownTimer, WeaponFireHandler.secWeaponCurrentCooldown)) {
                (model as Model).SecWeaponCooldownTimer.stop();
                return false;
            }
            return true;
        }
        return false;
    }

    public static HandleFireMainWeapon(): void {
        if (WeaponFireHandler.MainWeaponOnCooldown)
            return;
        switch ((model as Model).SelectedMainWeapon) {
            case MainWeaponType.TriRoe:
                WeaponFireHandler.handleTriRoe();
                break;
        }
    }

    private static setMainWeaponCooldown(cooldown: number): void {
        WeaponFireHandler.mainWeaponCurrentCooldown = cooldown;
        (model as Model).MainWeaponCooldownTimer.restart();
    }

    private static setSecWeaponCooldown(cooldown: number): void {
        WeaponFireHandler.secWeaponCurrentCooldown = cooldown;
        (model as Model).SecWeaponCooldownTimer.restart();
    }

    private static handleTriRoe(): void {
        if ((model as Model).Belmont.Roeing || (model as Model).Belmont.RecoveringFromHit)
            return;
        WeaponFireHandler.setMainWeaponCooldown(0);
        let roe = new TriRoe((model as Model).Belmont.direction);
        roe.spawn((model as Model).Belmont.pos);
        (model as Model).Belmont.UseRoe();
        SM.play(AudioId.Whip);
    }

    private static handleFireCross(): void {
        WeaponFireHandler.setSecWeaponCooldown(WeaponFireHandler.msCrossCooldown);
        let cross: Cross;
        let p: Point;
        switch ((model as Model).Belmont.direction) {
            case 'left':
                p = copyPoint((model as Model).Belmont.pos);
                p.x -= 26;
                cross = new Cross('left').spawn(p) as Cross;
                break;
            case 'right':
                p = copyPoint((model as Model).Belmont.pos);
                p.x += (model as Model).Belmont.size.x;
                cross = new Cross('right').spawn(p) as Cross;
                break;
        }
        (model as Model).spawn(cross);
        SM.play(AudioId.Cross);
        --(model as Model).hearts;
    }

    public static HandleFireSecondaryWeapon(): void {
        if (WeaponFireHandler.SecWeaponOnCooldown)
            return;
        if ((model as Model).hearts <= 0)
            return;
        // switch ((model as Model).SelectedSecondaryWeapon) {
        // case SecWeaponType.Cross:
        WeaponFireHandler.handleFireCross();
        // break;
        // }
    }
}
