/*[Serializable]*/
export interface ISong {
    Loop?: boolean;
    Music?: number;
    NextSong?: ISong;
    PlayMusicToNext?: boolean;
}

export class Song implements ISong {
    public get PlayMusicToNext(): boolean {
        return this.NextSong != null;
    }

    public Music: number;
    public NextSong: ISong;
    public Loop: boolean;
}