import { Model, MainWeaponType } from "./gamemodel";
import { TriRoe } from "./triroe";
import { SM } from "./bmsx/soundmaster";
import { AudioId } from "./bmsx/resourceids";
import { waitDuration, copyPoint, Direction, Point } from "./bmsx/common";
import { Cross } from "./cross";

export class WeaponFireHandler {
    private static msCrossCooldown: number = 20;
    private static msTriRoeCooldown: number = 1000;
    private static _mainWeaponCurrentCooldown: number;
    private static get mainWeaponCurrentCooldown(): number {
        return WeaponFireHandler._mainWeaponCurrentCooldown;
    }

    private static set mainWeaponCurrentCooldown(value: number) {
        if (value > WeaponFireHandler._mainWeaponCurrentCooldown || !Model._.MainWeaponCooldownTimer.running)
            WeaponFireHandler._mainWeaponCurrentCooldown = value;
    }

    public static get MainWeaponOnCooldown(): boolean {
        if (Model._.MainWeaponCooldownTimer.running) {
            if (waitDuration(Model._.MainWeaponCooldownTimer, WeaponFireHandler.mainWeaponCurrentCooldown)) {
                Model._.MainWeaponCooldownTimer.stop();
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
        if (value > WeaponFireHandler._secWeaponCurrentCooldown || !Model._.SecWeaponCooldownTimer.running)
            WeaponFireHandler._secWeaponCurrentCooldown = value;
    }

    public static get SecWeaponOnCooldown(): boolean {
        if (Model._.SecWeaponCooldownTimer.running) {
            if (waitDuration(Model._.SecWeaponCooldownTimer, WeaponFireHandler.secWeaponCurrentCooldown)) {
                Model._.SecWeaponCooldownTimer.stop();
                return false;
            }
            return true;
        }
        return false;
    }

    public static HandleFireMainWeapon(): void {
        if (WeaponFireHandler.MainWeaponOnCooldown)
            return;
        switch (Model._.SelectedMainWeapon) {
            case MainWeaponType.TriRoe:
                WeaponFireHandler.handleTriRoe();
                break;
        }
    }

    private static setMainWeaponCooldown(cooldown: number): void {
        WeaponFireHandler.mainWeaponCurrentCooldown = cooldown;
        Model._.MainWeaponCooldownTimer.restart();
    }

    private static setSecWeaponCooldown(cooldown: number): void {
        WeaponFireHandler.secWeaponCurrentCooldown = cooldown;
        Model._.SecWeaponCooldownTimer.restart();
    }

    private static handleTriRoe(): void {
        if (Model._.Belmont.Roeing || Model._.Belmont.RecoveringFromHit)
            return;
        WeaponFireHandler.setMainWeaponCooldown(0);
        let roe = new TriRoe(Model._.Belmont.pos, Model._.Belmont.direction);
        Model._.spawn(roe);
        Model._.Belmont.UseRoe();
        SM.play(AudioId.Whip);
    }

    private static handleFireCross(): void {
        WeaponFireHandler.setSecWeaponCooldown(WeaponFireHandler.msCrossCooldown);
        let cross: Cross;
        let p: Point;
        switch (Model._.Belmont.direction) {
            case Direction.Left:
                p = copyPoint(Model._.Belmont.pos);
                p.x -= 26;
                cross = new Cross(p, Direction.Left);
                break;
            case Direction.Right:
                p = copyPoint(Model._.Belmont.pos);
                p.x += Model._.Belmont.size.x;
                cross = new Cross(p, Direction.Right);
                break;
        }
        Model._.spawn(cross);
        SM.play(AudioId.Cross);
        --Model._.Hearts;
    }

    public static HandleFireSecondaryWeapon(): void {
        if (WeaponFireHandler.SecWeaponOnCooldown)
            return;
        if (Model._.Hearts <= 0)
            return;
        // switch (Model._.SelectedSecondaryWeapon) {
        // case SecWeaponType.Cross:
        WeaponFireHandler.handleFireCross();
        // break;
        // }
    }
}