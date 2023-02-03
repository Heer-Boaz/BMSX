class FieldHockeyDrill {
    field: string[][];
    players: string[];
    center: [number, number];
    attackers: Array<[number, number]>;
    defenders: Array<[number, number]>;

    constructor(fieldSize: number) {
        this.field = [];
        for (let i = 0; i < fieldSize; i++) {
            this.field[i] = [];
            for (let jls = 0; j < fieldSize; j++) {
                this.field[i][j] = ".";
            }
        }
        this.players = [];
        this.center = [Math.floor(fieldSize / 2), Math.floor(fieldSize / 2)];
        this.attackers = [];
        this.defenders = [];
    }

    setPlayerPositions(attackers: number, defenders: number) {
        for (let i = 0; i < attackers; i++) {
            this.players.push("a");
            this.attackers.push([this.center[0] - (i + 1), this.center[1]]);
        }
        for (let i = 0; i < defenders; i++) {
            this.players.push("d");
            this.defenders.push([this.center[0] + (i + 1), this.center[1]]);
        }
    }

    displayField() {
        for (const row of this.field) {
            console.log(row.join(" "));
        }
        console.log("\n");
    }

    runDrill() {
        console.log("Starting drill with attackers and defenders on the field\n");
        for (const attacker of this.attackers) {
            this.field[attacker[0]][attacker[1]] = "a";
        }
        for (const defender of this.defenders) {
            this.field[defender[0]][defender[1]] = "d";
        }
        this.displayField();
        console.log("Attackers are trying to build up an attack while defenders are trying to pressure them and clear the ball from their defensive end\n");
    }
}

let drill = new FieldHockeyDrill(10);
drill.setPlayerPositions(4, 6);
drill.runDrill();