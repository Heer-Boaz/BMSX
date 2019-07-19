export interface IEffect {
    AudioId?: number;
    Loop?: boolean;
    Priority?: number;
}

/*[Serializable]*/
export class Effect implements IEffect {
    public AudioId: number;
    public Loop: boolean;
    public Priority: number;
}