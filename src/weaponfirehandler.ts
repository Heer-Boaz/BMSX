import { GameModel as M, MainWeaponType, SecWeaponType } from "./sintervaniamodel";
import { TriRoe } from "./triroe";
import { SoundMaster as S } from "../BoazEngineJS/soundmaster";
import { ResourceMaster as RM } from './resourcemaster';
import { AudioId } from "./resourceids";
import { waitDuration } from '../BoazEngineJS/common';

export class WeaponFireHandler {
    private static msCrossCooldown: number = 500;
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
        S.PlayEffect(RM.Sound.get(AudioId.Whip));
    }

    private static handleFireCross(): void {
        WeaponFireHandler.setSecWeaponCooldown(WeaponFireHandler.msCrossCooldown);
    }

    public static HandleFireSecondaryWeapon(): void {
        if (WeaponFireHandler.SecWeaponOnCooldown)
            return;
        if (M._.Hearts > 0) {
            return;
        }
        switch (M._.SelectedSecondaryWeapon) {
            case SecWeaponType.Cross:
                WeaponFireHandler.handleFireCross();
                break;
        }
    }
}