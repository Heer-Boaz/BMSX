import { BStopwatch } from "./btimer"
import { waitDuration } from "./common"

export interface AniData<T extends any | null | {}> {
    time: number;
    data: T;
}

export class Animation<T extends any | null | undefined | {}> {
    doAnimation(timer: BStopwatch, imageId: number): any {
        throw new Error("Method not implemented.");
    }
    public animationDataAndTime: Array<AniData<T>>;
    public stepCounter: number;
    public constantStepTime!: number;
    protected currentStepTime: number;
    public repeat!: boolean;

    constructor(dataAndTime: Array<AniData<T>>, constantStepTime?: number | null, repeat?: boolean | null) {
        this.animationDataAndTime = dataAndTime;
        if (constantStepTime != null)
            this.constantStepTime = constantStepTime;
        this.currentStepTime = 0;
        if (repeat != null)
            this.repeat = repeat;
        this.stepCounter = 0;
    }

    // constructor(data: Array<T>, time?: Array<number>, constantStepTime?: number, repeat?: boolean) {
    //     this.animationData = data;
    //     if (time != null)
    //         this.animationTime = time;
    //     if (constantStepTime != null)
    //         this.constantStepTime = constantStepTime;
    //     this.currentStepTime = 0;
    //     if (repeat != null)
    //         this.repeat = repeat;
    //     this.stepCounter = 0;
    // }

    public stepValue(): T {
        return this.animationDataAndTime[this.stepCounter].data;
    }

    public stepTime(): number {
        if (this.constantStepTime != null)
            return this.constantStepTime;

        return this.animationDataAndTime[this.stepCounter].time;
    }

    public hasNext(): boolean {
        return this.stepCounter < this.animationDataAndTime.length - 1;
    }

    public finished(): boolean {
        return this.stepCounter >= this.animationDataAndTime.length;
    }

    public nextStep(): T | null {
        ++this.stepCounter;
        if (!this.finished())
            return this.stepValue();
        else {
            if (this.repeat) {
                this.stepCounter = 0;
                return this.stepValue();
            }
            else return null; // default(T)
        }
    }

    public doAnimationTimer(timer: BStopwatch) {
        let nextStep: T | null = null;
        if (this.waitForNextStep(timer)) {
            nextStep = this.nextStep();
            return { value: nextStep, next: true };
        }
        return { value: null, next: false };
    }

    public doAnimationStep(step: number) {
        let nextStep: T | null = null;
        this.currentStepTime += step;
        if (this.currentStepTime >= this.stepTime()) {
            this.currentStepTime = 0;
            nextStep = this.nextStep();
            return { value: nextStep, next: true };
        }
        nextStep = this.stepValue();
        return { value: nextStep, next: false };
    }

    public waitForNextStep(timer: BStopwatch): boolean {
        return waitDuration(timer, this.stepTime());
    }

    public restart(): void {
        this.stepCounter = 0;
    }
}