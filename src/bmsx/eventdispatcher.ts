export class EventDispatcher<T> {
    private listeners: ((data: T) => void)[] = [];

    public addListener(listener: (data: T) => void): void {
        this.listeners.push(listener);
    }

    public removeListener(listener: (data: T) => void): void {
        const index = this.listeners.indexOf(listener);
        if (index >= 0) {
            this.listeners.splice(index, 1);
        }
    }

    public dispatch(data: T): void {
        this.listeners.forEach((listener) => {
            listener(data);
        });
    }
}
