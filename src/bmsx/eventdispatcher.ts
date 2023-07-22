/**
 * A generic event dispatcher that can be used to manage listeners and dispatch events.
 *
 * @template T The type of data that will be dispatched to listeners.
 */
export class EventDispatcher<T> {
    private listeners: ((data: T) => void)[] = [];

    /**
     * Adds a listener function to the event dispatcher.
     *
     * @param listener The listener function to be added.
     */
    public addListener(listener: (data: T) => void): void {
        this.listeners.push(listener);
    }

    /**
     * Removes a listener function from the event dispatcher.
     *
     * @param listener The listener function to be removed.
     */
    public removeListener(listener: (data: T) => void): void {
        const index = this.listeners.indexOf(listener);
        if (index >= 0) {
            this.listeners.splice(index, 1);
        }
    }

    /**
     * Dispatches an event to all registered listeners.
     *
     * @param data The data to be dispatched to listeners.
     */
    public dispatch(data: T): void {
        this.listeners.forEach((listener) => {
            listener(data);
        });
    }
}
