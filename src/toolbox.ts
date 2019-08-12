import { SoundMaster } from "../BoazEngineJS/soundmaster";

export class Toolbox {
    public static Init(): void {
        Toolbox.S = new SoundMaster();
        Toolbox.T = new TimeMaster();
        Toolbox.I = new InputMaster();
        Toolbox.BXLib = new BXLib(Toolbox.I, Toolbox.S, Toolbox.T);
    }
    public static I: InputMaster;
    public static S: SoundMaster;
    public static T: TimeMaster;
    public static BXLib: BXLib;
}