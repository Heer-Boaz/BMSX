import { Model, MainWeaponType } from "./gamemodel";
import { TriRoe } from "./triroe";
import { SM } from "./bmsx/soundmaster";
import { AudioId } from "./bmsx/resourceids";
import { waitDuration, copyPoint, Direction, Point } from "./bmsx/common";
import { Cross } from "./cross";
import { model } from './bmsx/engine';

export class WeaponFireHandler {
    private static msCrossCooldown: number = 20;
    private static msTriRoeCooldown: number = 1000;
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
        let roe = new TriRoe((model as Model).Belmont.pos, (model as Model).Belmont.direction);
        (model as Model).spawn(roe);
        (model as Model).Belmont.UseRoe();
        SM.play(AudioId.Whip);
    }

    private static handleFireCross(): void {
        WeaponFireHandler.setSecWeaponCooldown(WeaponFireHandler.msCrossCooldown);
        let cross: Cross;
        let p: Point;
        switch ((model as Model).Belmont.direction) {
            case Direction.Left:
                p = copyPoint((model as Model).Belmont.pos);
                p.x -= 26;
                cross = new Cross(p, Direction.Left);
                break;
            case Direction.Right:
                p = copyPoint((model as Model).Belmont.pos);
                p.x += (model as Model).Belmont.size.x;
                cross = new Cross(p, Direction.Right);
                break;
        }
        (model as Model).spawn(cross);
        SM.play(AudioId.Cross);
        --(model as Model).Hearts;
    }

    public static HandleFireSecondaryWeapon(): void {
        if (WeaponFireHandler.SecWeaponOnCooldown)
            return;
        if ((model as Model).Hearts <= 0)
            return;
        // switch ((model as Model).SelectedSecondaryWeapon) {
        // case SecWeaponType.Cross:
        WeaponFireHandler.handleFireCross();
        // break;
        // }
    }
}