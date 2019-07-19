module Sintervania.View {
    export class EndDemo {
        private static states: State[] = new Array(State.Sint, State.WaitForBoaz, State.Boaz);
        private static waits: number[] = 10000, 1000, 0;
        private ani: Animation<State>;
        private state: State;
        private timer: BStopwatch;
        constructor() {
            this.ani = new Animation<State>(EndDemo.states, EndDemo.waits);
            this.timer = BStopwatch.CreateWatch();
        }
        public Init(): void {
            this.reset();
        }
        private reset(): void {
            this.ani.restart();
            this.timer.restart();
            this.state = this.ani.stepValue();
        }
        public TakeTurn(): void {
            let newState: State = State.None;
            switch (this.state) {
                case State.Sint:
                case State.WaitForBoaz:
                    if (this.ani.DoAnimation(this.timer, newState)) {
                        this.state = newState;
                    }
                    break;
                default:
                    break;
            }
        }
        public Paint(): void {
            switch (this.state) {
                case State.Sint:
                    TextWriter.DrawText(20, 192, "Redelijk gedaan, Belmont!");
                    break;
                case State.Boaz:
                    TextWriter.DrawText(Tile.ToCoord(1), Tile.ToCoord(9), "Zo, dat was het weer!");
                    TextWriter.DrawText(Tile.ToCoord(1), Tile.ToCoord(10), "Ik ga ervan uit dat jullie");
                    TextWriter.DrawText(Tile.ToCoord(1), Tile.ToCoord(11), "ervan hebben genoten");
                    TextWriter.DrawText(Tile.ToCoord(1), Tile.ToCoord(12), "en dat is ook terecht.");
                    TextWriter.DrawText(Tile.ToCoord(1), Tile.ToCoord(14), "Dit verhaal is nog niet");
                    TextWriter.DrawText(Tile.ToCoord(1), Tile.ToCoord(15), "afgelopen,dus bij");
                    TextWriter.DrawText(Tile.ToCoord(1), Tile.ToCoord(16), "belangstelling komt er");
                    TextWriter.DrawText(Tile.ToCoord(1), Tile.ToCoord(17), "wellicht een nieuw");
                    TextWriter.DrawText(Tile.ToCoord(1), Tile.ToCoord(18), "hoofdstuk in dit");
                    TextWriter.DrawText(Tile.ToCoord(1), Tile.ToCoord(19), "spannende en meeslepende");
                    TextWriter.DrawText(Tile.ToCoord(1), Tile.ToCoord(20), "verhaal!");
                    break;
            }
        }
    }
    export module EndDemo {
        export enum State {
            Sint,
            WaitForBoaz,
            Boaz,
            None
        }
    }
}