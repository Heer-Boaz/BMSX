var FieldHockeyDrill = (function () {
    function FieldHockeyDrill(fieldSize) {
        this.field = [];
        for (var i = 0; i < fieldSize; i++) {
            this.field[i] = [];
            for (var j = 0; j < fieldSize; j++) {
                this.field[i][j] = ".";
            }
        }
        this.players = [];
        this.center = [Math.floor(fieldSize / 2), Math.floor(fieldSize / 2)];
        this.attackers = [];
        this.defenders = [];
    }
    FieldHockeyDrill.prototype.setPlayerPositions = function (attackers, defenders) {
        for (var i = 0; i < attackers; i++) {
            this.players.push("a");
            this.attackers.push([this.center[0] - (i + 1), this.center[1]]);
        }
        for (var i = 0; i < defenders; i++) {
            this.players.push("d");
            this.defenders.push([this.center[0] + (i + 1), this.center[1]]);
        }
    };
    FieldHockeyDrill.prototype.displayField = function () {
        for (var _i = 0, _a = this.field; _i < _a.length; _i++) {
            var row = _a[_i];
            console.log(row.join(" "));
        }
        console.log("\n");
    };
    FieldHockeyDrill.prototype.runDrill = function () {
        console.log("Starting drill with attackers and defenders on the field\n");
        for (var _i = 0, _a = this.attackers; _i < _a.length; _i++) {
            var attacker = _a[_i];
            this.field[attacker[0]][attacker[1]] = "a";
        }
        for (var _b = 0, _c = this.defenders; _b < _c.length; _b++) {
            var defender = _c[_b];
            this.field[defender[0]][defender[1]] = "d";
        }
        this.displayField();
        console.log("Attackers are trying to build up an attack while defenders are trying to pressure them and clear the ball from their defensive end\n");
    };
    return FieldHockeyDrill;
}());
var drill = new FieldHockeyDrill(10);
drill.setPlayerPositions(4, 6);
drill.runDrill();
