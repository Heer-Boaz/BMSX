export interface IMouseStateContainer {
    MC_LEFT?: boolean;
    MC_MIDDLE?: boolean;
    MC_RIGHT?: boolean;
    MD_LEFT?: boolean;
    MD_MIDDLE?: boolean;
    MD_RIGHT?: boolean;
    MD_X?: number;
    MD_Y?: number;
    ResetState?(): void;
}