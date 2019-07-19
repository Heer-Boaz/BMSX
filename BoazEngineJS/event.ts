export class InputEvent {
    protected subscribers: Function[];

    constructor() {
        this.subscribers = [];
    }

    // Sure, just use the arguments object (JavaScript variable number of arguments to function - Stack Overflow)
    public fire = (source: any, ...args: any[]) => {
        for (let i = 0; i < this.subscribers.length; i++) {
            this.subscribers[i](source, args);
        }
    }

    public subscribe = (subscriber: any) => {
        this.subscribers.push(subscriber);
    }
}

export class ClickEvent extends InputEvent {
    constructor() {
        super();
    }

    public fire = (source: any, x: number, y: number) => {
        for (let i = 0; i < this.subscribers.length; i++) {
            this.subscribers[i](source, x, y);
        }
    }
}

export class MoveEvent extends InputEvent {
    constructor() {
        super();
    }

    public fire = (source: any, x: number, y: number) => {
        for (let i = 0; i < this.subscribers.length; i++) {
            this.subscribers[i](source, x, y);
        }
    }
}

export class KeydownEvent extends InputEvent {
    constructor() {
        super();
    }

    public fire = (source: any, keycode: number) => {
        for (let i = 0; i < this.subscribers.length; i++) {
            this.subscribers[i](source, keycode);
        }
    }
}

export class KeyupEvent extends InputEvent {
    constructor() {
        super();
    }

    public fire = (source: any, keycode: number) => {
        for (let i = 0; i < this.subscribers.length; i++) {
            this.subscribers[i](source, keycode);
        }
    }
}

export class BlurEvent extends InputEvent {
    constructor() {
        super();
    }

    public fire = (source: any) => {
        for (let i = 0; i < this.subscribers.length; i++) {
            this.subscribers[i](source);
        }
    }
}

export class TouchStartEvent extends InputEvent {
    constructor() {
        super();
    }

    public fire = (source: any, event: Event) => {
        for (let i = 0; i < this.subscribers.length; i++) {
            this.subscribers[i](source, event);
        }
    }
}

export class TouchMoveEvent extends InputEvent {
    constructor() {
        super();
    }

    public fire = (source: any, event: Event) => {
        for (let i = 0; i < this.subscribers.length; i++) {
            this.subscribers[i](source, event);
        }
    }
}

export class TouchEndEvent extends InputEvent {
    constructor() {
        super();
    }

    public fire = (source: any, event: Event) => {
        for (let i = 0; i < this.subscribers.length; i++) {
            this.subscribers[i](source, event);
        }
    }
}