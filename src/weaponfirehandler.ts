module Sintervania.Controller {
    export class WeaponFireHandler {
        private static msCrossCooldown: number = 500;
        private static msTriRoeCooldown: number = 1000;
        private static _mainWeaponCurrentCooldown: number;
        private static get mainWeaponCurrentCooldown(): number {
            return WeaponFireHandler._mainWeaponCurrentCooldown;
        }
        private static set mainWeaponCurrentCooldown(value: number) {
            if (value > WeaponFireHandler._mainWeaponCurrentCooldown || !M._.MainWeaponCooldownTimer.IsRunning)
                WeaponFireHandler._mainWeaponCurrentCooldown = value;
        }
        public static get MainWeaponOnCooldown(): boolean {
            if (M._.MainWeaponCooldownTimer.IsRunning) {
                if (Helpers.WaitDuration(M._.MainWeaponCooldownTimer, WeaponFireHandler.mainWeaponCurrentCooldown)) {
                    M._.MainWeaponCooldownTimer.Stop();
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
            if (value > WeaponFireHandler._secWeaponCurrentCooldown || !M._.SecWeaponCooldownTimer.IsRunning)
                WeaponFireHandler._secWeaponCurrentCooldown = value;
        }
        public static get SecWeaponOnCooldown(): boolean {
            if (M._.SecWeaponCooldownTimer.IsRunning) {
                if (Helpers.WaitDuration(M._.SecWeaponCooldownTimer, WeaponFireHandler.secWeaponCurrentCooldown)) {
                    M._.SecWeaponCooldownTimer.Stop();
                    return false;
                }
                return true;
            }
            return false;
        }
        public static HandleFireMainWeapon(): void {
            if (WeaponFireHandler.MainWeaponOnCooldown)
                return
            switch (M._.SelectedMainWeapon) {
                case MainWeaponType.TriRoe:
                    WeaponFireHandler.handleTriRoe();
                    break;
            }
        }
        private static setMainWeaponCooldown(cooldown: number): void {
            M._.MainWeaponCooldownTimer.restart();
            WeaponFireHandler.mainWeaponCurrentCooldown = cooldown;
        }
        private static setSecWeaponCooldown(cooldown: number): void {
            M._.SecWeaponCooldownTimer.restart();
            WeaponFireHandler.secWeaponCurrentCooldown = cooldown;
        }
        private static handleTriRoe(): void {
            if (M._.Belmont.Roeing || M._.Belmont.RecoveringFromHit)
                return
            WeaponFireHandler.setMainWeaponCooldown(0);
            let roe = new TriRoe(M._.Belmont.pos, M._.Belmont.Direction);
            M._.Spawn(roe);
            M._.Belmont.UseRoe();
            S.PlayEffect(RM.Sound[AudioId.Whip]);
        }
        private static handleFireCross(): void {
            WeaponFireHandler.setSecWeaponCooldown(WeaponFireHandler.msCrossCooldown);
        }
        public static HandleFireSecondaryWeapon(): void {
            if (WeaponFireHandler.SecWeaponOnCooldown)
                return
            if (M._.Hearts > 0) {
                return
            }
            switch (M._.SelectedSecondaryWeapon) {
                case SecWeaponType.Cross:
                    WeaponFireHandler.handleFireCross();
                    break;
            }
        }
    }
}