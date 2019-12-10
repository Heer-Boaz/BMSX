import { Model as M, MainWeaponType, SecWeaponType } from "./gamemodel";
import { TriRoe } from "./triroe";
import { SM } from "../BoazEngineJS/soundmaster";
import { AudioId } from "./resourceids";
import { waitDuration, copyPoint } from "../BoazEngineJS/common";
import { Cross } from "./cross";
import { Direction } from "../BoazEngineJS/direction";
import { Belmont } from "./belmont";
import { Point } from "../lib/interfaces";

export class WeaponFireHandler {
    private static msCrossCooldown: number = 20;
    private static msTriRoeCooldown: number = 1000;
    private static _mainWeaponCurrentCooldown: number;
    private static get mainWeaponCurrentCooldown(): number {
        return WeaponFireHandler._mainWeaponCurrentCooldown;
    }

    private static set mainWeaponCurrentCooldown(value: number) {
        if (value > WeaponFireHandler._mainWeaponCurrentCooldown || !M._.MainWeaponCooldownTimer.running)
            WeaponFireHandler._mainWeaponCurrentCooldown = value;
    }

    public static get MainWeaponOnCooldown(): boolean {
        if (M._.MainWeaponCooldownTimer.running) {
            if (waitDuration(M._.MainWeaponCooldownTimer, WeaponFireHandler.mainWeaponCurrentCooldown)) {
                M._.MainWeaponCooldownTimer.stop();
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
        if (value > WeaponFireHandler._secWeaponCurrentCooldown || !M._.SecWeaponCooldownTimer.running)
            WeaponFireHandler._secWeaponCurrentCooldown = value;
    }

    public static get SecWeaponOnCooldown(): boolean {
        if (M._.SecWeaponCooldownTimer.running) {
            if (waitDuration(M._.SecWeaponCooldownTimer, WeaponFireHandler.secWeaponCurrentCooldown)) {
                M._.SecWeaponCooldownTimer.stop();
                return false;
            }
            return true;
        }
        return false;
    }

    public static HandleFireMainWeapon(): void {
        if (WeaponFireHandler.MainWeaponOnCooldown)
            return;
        switch (M._.SelectedMainWeapon) {
            case MainWeaponType.TriRoe:
                WeaponFireHandler.handleTriRoe();
                break;
        }
    }

    private static setMainWeaponCooldown(cooldown: number): void {
        WeaponFireHandler.mainWeaponCurrentCooldown = cooldown;
        M._.MainWeaponCooldownTimer.restart();
    }

    private static setSecWeaponCooldown(cooldown: number): void {
        WeaponFireHandler.secWeaponCurrentCooldown = cooldown;
        M._.SecWeaponCooldownTimer.restart();
    }

    private static handleTriRoe(): void {
        if (M._.Belmont.Roeing || M._.Belmont.RecoveringFromHit)
            return;
        WeaponFireHandler.setMainWeaponCooldown(0);
        let roe = new TriRoe(M._.Belmont.pos, M._.Belmont.direction);
        M._.spawn(roe);
        M._.Belmont.UseRoe();
        SM.play(AudioId.Whip);
    }

    private static handleFireCross(): void {
        WeaponFireHandler.setSecWeaponCooldown(WeaponFireHandler.msCrossCooldown);
        let cross: Cross;
        let p: Point;
        switch (M._.Belmont.direction) {
            case Direction.Left:
                p = copyPoint(M._.Belmont.pos);
                p.x -= 26;
                cross = new Cross(p, Direction.Left);
                break;
            case Direction.Right:
                p = copyPoint(M._.Belmont.pos);
                p.x += M._.Belmont.size.x;
                cross = new Cross(p, Direction.Right);
                break;
        }
        M._.spawn(cross);
        SM.play(AudioId.Cross);
        --M._.Hearts;
    }

    public static HandleFireSecondaryWeapon(): void {
        if (WeaponFireHandler.SecWeaponOnCooldown)
            return;
        if (M._.Hearts <= 0)
            return;
        // switch (M._.SelectedSecondaryWeapon) {
            // case SecWeaponType.Cross:
                WeaponFireHandler.handleFireCross();
                // break;
        // }
    }
}