import { BStopwatch } from "./engine";
export interface AniData<T extends any | null | {}> {
    time: number;
    data: T;
}
export interface AniStepReturnValue<T> {
    stepValue: T;
    next: boolean;
}
export declare class Animation<T extends any | null | undefined | {}> {
    animationDataAndTime: Array<AniData<T>>;
    stepCounter: number;
    constantStepTime?: number;
    protected currentStepTime: number;
    repeat: boolean;
    constructor(dataAndOrTime: Array<AniData<T>> | Array<T>, timesOrConstantStepTime?: number | number[], repeat?: boolean);
    get stepValue(): T;
    get stepTime(): number;
    get hasNext(): boolean;
    get finished(): boolean;
    doNextStep(): T | null;
    doAnimation(timerOrStepValue: BStopwatch | number, nextStepRef?: T): AniStepReturnValue<T>;
    doAnimationTimer(timer: BStopwatch, nextStepRef?: T): AniStepReturnValue<T>;
    doAnimationStep(step: number, nextStepRef?: T): AniStepReturnValue<T>;
    waitForNextStep(timer: BStopwatch): boolean;
    restart(): void;
}
//# sourceMappingURL=animation.d.ts.map