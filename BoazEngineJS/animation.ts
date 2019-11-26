import { BStopwatch } from "./btimer"
import { waitDuration } from "./common"

export interface AniData<T extends any | null | {}> {
    time: number;
    data: T;
}

// This construction is part of a pass-by-reference emulation, mimicking the original C#-code
export interface AniStepCompoundValue<T> {
    nextStepValue: T;
}

// This function is used to replicate constructor overloading, as it is not supported by JS
function createAniData<T extends any | null | {}>(data: T[], times?: number[], constantStepTime?: number): Array<AniData<T>> {
    if (!times && !constantStepTime) throw ("Either [times] or [constantStepTime] must be given when creating a new animation!");

    let result = new Array<AniData<T>>();
    let i = 0;
    for (let d of data) {
        result.push(<AniData<T>>{ time: times ? times[i] : constantStepTime, data: d });
        ++i;
    }

    return result;
}

function wrapInAniCompound<T>(scalarStepValue: T): AniStepCompoundValue<T> {
    return <AniStepCompoundValue<T>>{ nextStepValue: scalarStepValue };

}

export class Animation<T extends any | null | undefined | {}> {
    public animationDataAndTime: Array<AniData<T>>;
    public stepCounter: number;
    public constantStepTime!: number;
    protected currentStepTime: number;
    public repeat!: boolean;

    constructor(dataAndOrTime: Array<AniData<T>> | Array<T>, timesOrConstantStepTime?: number | number[], repeat?: boolean) {
        // JS does not support constructor overloading. Therefore, I have to implement it myself...
        if (timesOrConstantStepTime) {
            if (Array.isArray(timesOrConstantStepTime)) {
                // Handle a given array of step times
                let aniData = createAniData(<Array<T>>dataAndOrTime, <number[]>timesOrConstantStepTime, undefined);
                this.animationDataAndTime = aniData;
            }
            else {
                // Handle a given constant step time
                this.constantStepTime = timesOrConstantStepTime;
                let aniData = createAniData(<Array<T>>dataAndOrTime, undefined, timesOrConstantStepTime); // TODO: Volgens mij is dit niet nodig door het bestaan van de constantStepTime property van deze class
                this.animationDataAndTime = aniData;
            }
        }
        else {
            this.animationDataAndTime = <Array<AniData<T>>>dataAndOrTime;
        }

        this.currentStepTime = 0;

        this.repeat = repeat || false;
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

    // TODO: Lelijke versie van originele pass-by-ref method die zo mooi werkte, maar niet kan bestaan in JS :(
    public doAnimation(timerOrStepValue: BStopwatch | number, nextStepRef?: AniStepCompoundValue<T>) {
        if (!nextStepRef) {
            if (timerOrStepValue instanceof BStopwatch) return this.doAnimationTimer(timerOrStepValue);
            return this.doAnimationStep(timerOrStepValue);
        }
        else {
            let nextStepReturned: T | null = null;
            if (timerOrStepValue instanceof BStopwatch) {
                if (this.waitForNextStep(timerOrStepValue)) {
                    nextStepReturned = this.nextStep();
                    nextStepRef.nextStepValue = nextStepReturned;
                    return { value: nextStepReturned, next: true };
                }
            }
            else {
                if (this.doAnimationStep(timerOrStepValue)) {
                    nextStepReturned = this.nextStep();
                    nextStepRef.nextStepValue = nextStepReturned;
                    return { value: nextStepReturned, next: true };
                }
            }
            return { value: null, next: false };
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
