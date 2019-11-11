define("BoazEngineJS/keystatecontainer", ["require", "exports"], function (require, exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
});
define("BoazEngineJS/interfaces", ["require", "exports"], function (require, exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
});
define("BoazEngineJS/msx", ["require", "exports"], function (require, exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.TileSize = 8;
    class Tile {
        get toCoord() {
            return this.t * exports.TileSize;
        }
        static conversionMethod(v) {
            return { t: v };
        }
        static ToCoord(x, y) {
            if (!y)
                return x * exports.TileSize;
            return { x: x * exports.TileSize, y: y * exports.TileSize };
        }
    }
    exports.Tile = Tile;
    var MSXConstants;
    (function (MSXConstants) {
        MSXConstants.MSX1ScreenWidth = 256;
        MSXConstants.MSX1ScreenHeight = 192;
        MSXConstants.MSX2ScreenWidth = 256;
        MSXConstants.MSX2ScreenHeight = 212;
        MSXConstants.Msx1Colors = [
            { r: 0, g: 0, b: 0 },
            { r: 0, g: 241, b: 20 },
            { r: 68, g: 249, b: 86 },
            { r: 85, g: 79, b: 255 },
            { r: 128, g: 111, b: 2550 },
            { r: 250, g: 80, b: 51 },
            { r: 12, g: 255, b: 255 },
            { r: 255, g: 81, b: 52 },
            { r: 255, g: 115, b: 86 },
            { r: 226, g: 210, b: 4 },
            { r: 242, g: 217, b: 71 },
            { r: 4, g: 212, b: 19 },
            { r: 231, g: 80, b: 229 },
            { r: 208, g: 208, b: 208 },
            { r: 255, g: 255, b: 255 },
        ];
        MSXConstants.Msx1ExtColors = [{ r: 104, g: 104, b: 104 }];
    })(MSXConstants = exports.MSXConstants || (exports.MSXConstants = {}));
});
define("BoazEngineJS/direction", ["require", "exports"], function (require, exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    var Direction;
    (function (Direction) {
        Direction[Direction["Up"] = 0] = "Up";
        Direction[Direction["Right"] = 1] = "Right";
        Direction[Direction["Down"] = 2] = "Down";
        Direction[Direction["Left"] = 3] = "Left";
        Direction[Direction["None"] = 4] = "None";
    })(Direction = exports.Direction || (exports.Direction = {}));
});
define("src/gameconstants", ["require", "exports", "BoazEngineJS/msx"], function (require, exports, msx_1) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    var GameConstants;
    (function (GameConstants) {
        GameConstants.SoundEnabled = false;
        GameConstants.InitialFullscreen = false;
        GameConstants.InitialScale = 1;
        GameConstants.PauseGameOnKillFocus = false;
        GameConstants.AnimateFoeHealthLevel = false;
        GameConstants.EnemiesAfootAsProperty = false;
        GameConstants.Belmont_MaxHealth_AtStart = 48;
        GameConstants.Belmont_MaxHealth_Increase = 2;
        GameConstants.Belmont_MaxHearts = 99;
        GameConstants.CheckpointAtRoomEntry = false;
        GameConstants.ManualCheckpoints = !GameConstants.CheckpointAtRoomEntry;
        GameConstants.WindowTitle = "";
        GameConstants.HUDHeight = 36;
        GameConstants.GameScreenWidth = msx_1.MSXConstants.MSX2ScreenWidth;
        GameConstants.GameScreenHeight = msx_1.MSXConstants.MSX2ScreenHeight - GameConstants.HUDHeight;
        GameConstants.StageScreenWidthTiles = (GameConstants.GameScreenWidth / msx_1.TileSize);
        GameConstants.StageScreenHeightTiles = (GameConstants.GameScreenHeight / msx_1.TileSize);
        GameConstants.GameScreenStartX = 0;
        GameConstants.GameScreenStartY = 36;
        GameConstants.ImageBasePath = "./Content/Images/";
        GameConstants.Extension_PNG = ".png";
        GameConstants.WaitAfterLoadGame = 1000;
        GameConstants.WaitAfterRoomSwitch = 500;
        GameConstants.WaitAfterGameStart1 = 2;
        GameConstants.WaitAfterGameStart2 = 4;
    })(GameConstants = exports.GameConstants || (exports.GameConstants = {}));
});
define("BoazEngineJS/model", ["require", "exports"], function (require, exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    var GameState;
    (function (GameState) {
        GameState[GameState["None"] = 0] = "None";
    })(GameState = exports.GameState || (exports.GameState = {}));
    var GameSubstate;
    (function (GameSubstate) {
        GameSubstate[GameSubstate["Default"] = 0] = "Default";
    })(GameSubstate = exports.GameSubstate || (exports.GameSubstate = {}));
    class Model {
        constructor() {
            this.initModelForGameStart();
        }
        get OldState() {
            return this.gameOldState;
        }
        set OldState(value) {
            this.gameOldState = value;
        }
        get State() {
            return this.gameState;
        }
        set State(value) {
            this.gameState = value;
        }
        get OldSubstate() {
            return this.gameOldSubstate;
        }
        set OldSubstate(value) {
            this.gameOldSubstate = value;
        }
        get Substate() {
            return this.gameSubstate;
        }
        set Substate(value) {
            this.gameSubstate = value;
        }
        initModelForGameStart() {
            this.objects = [];
            this.id2object = new Map();
            this.gameState = GameState.None;
            this.gameSubstate = GameSubstate.Default;
            this.paused = false;
        }
        clearModel() {
            this.objects.forEach(x => {
                x.exile();
            });
            this.objects.length = 0;
            this.id2object.clear();
            this.paused = false;
        }
        spawn(o, pos) {
            if (o == null)
                throw ("Cannot spawn object of type null.");
            if (this.objects.indexOf(o) > -1)
                throw ("GameObject already exists in the game model!");
            this.objects.push(o);
            if (o.id != null)
                this.id2object[o.id] = o;
            if (pos)
                o.spawn(pos);
            else
                o.spawn(null);
        }
        remove(o) {
            if (o == null)
                throw new Error("Cannot remove object of type null.");
            let index = this.objects.indexOf(o);
            if (index > -1) {
                delete this.objects[index];
                this.objects.splice(index, 1);
            }
            else
                throw new Error("Could not find object to remove.");
            if (o.id != null && this.id2object.has(o.id))
                this.id2object.delete(o.id);
        }
    }
    exports.Model = Model;
});
define("BoazEngineJS/constants", ["require", "exports", "BoazEngineJS/model"], function (require, exports, model_1) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    var Constants;
    (function (Constants) {
        Constants.INITIAL_GAMESTATE = model_1.GameState.None;
        Constants.INITIAL_GAMESUBSTATE = model_1.GameSubstate.Default;
        Constants.IMAGE_PATH = 'img/';
        Constants.AUDIO_PATH = 'snd/';
        Constants.GAMESCREEN_WIDTH = 1000;
        Constants.GAMESCREEN_HEIGHT = 600;
        Constants.DRAWBITMAP_NO_OPTION = 0;
        Constants.DRAWBITMAP_HFLIP = 0x1;
        Constants.DRAWBITMAP_VFLIP = 0x2;
        Constants.SaveSlotCount = 6;
        Constants.SaveSlotCheckpoint = -1;
        Constants.SaveGamePath = "./Saves/sintervania.sa";
        Constants.CheckpointGamePath = "./Saves/sintervania.chk";
        Constants.OptionsPath = "./sintervania.ini";
    })(Constants = exports.Constants || (exports.Constants = {}));
});
define("BoazEngineJS/btimer", ["require", "exports"], function (require, exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    class BStopwatch {
        constructor() {
            this.pauseDuringMenu = true;
            this.pauseAtFocusLoss = true;
            this.running = false;
            this.elapsedMilliseconds = 0;
            this.start = () => {
                this.running = true;
            };
            this.stop = () => {
                this.running = false;
            };
            this.restart = () => {
                this.running = true;
                this.elapsedMilliseconds = 0;
            };
            this.reset = () => {
                this.elapsedMilliseconds = 0;
            };
            this.updateTime = (elapsedMs) => {
                if (!this.running)
                    return;
                this.elapsedMilliseconds += elapsedMs;
            };
        }
        static createWatch() {
            let result = new BStopwatch();
            BStopwatch.Watches.push(result);
            return result;
        }
        static addWatch(watch) {
            if (BStopwatch.Watches.indexOf(watch) > -1)
                BStopwatch.Watches.push(watch);
        }
        static removeWatch(watch) {
            let index = BStopwatch.Watches.indexOf(watch);
            if (index > -1) {
                delete BStopwatch.Watches[index];
                BStopwatch.Watches.splice(index, 1);
            }
        }
        static updateTimers(elapsedMs) {
            BStopwatch.Watches.forEach(s => { s.updateTime(elapsedMs); });
        }
        static pauseAllRunningWatches(pauseCausedByMenu) {
            BStopwatch.Watches.filter(s => !s.running).forEach(s => { s.running = false; });
            BStopwatch.Watches.forEach(w => {
                if (w.running && (!pauseCausedByMenu || w.pauseDuringMenu)) {
                    w.stop();
                    BStopwatch.watchesThatHaveBeenStopped.push(w);
                }
            });
        }
        static resumeAllPausedWatches() {
            BStopwatch.watchesThatHaveBeenStopped.filter(s => !s.running).forEach(s => { s.running = false; });
        }
        static pauseWatchesOnFocusLoss() {
            BStopwatch.Watches.forEach(w => {
                if (w.running && w.pauseAtFocusLoss) {
                    w.stop();
                    this.watchesThatHaveBeenStoppedAtFocusLoss.push(w);
                }
            });
        }
        static resumeAllPausedWatchesOnFocus() {
            this.watchesThatHaveBeenStoppedAtFocusLoss.forEach(w => w.start());
            this.watchesThatHaveBeenStoppedAtFocusLoss.length = 0;
        }
    }
    exports.BStopwatch = BStopwatch;
    BStopwatch.watchesThatHaveBeenStopped = [];
    BStopwatch.watchesThatHaveBeenStoppedAtFocusLoss = [];
    BStopwatch.Watches = [];
});
define("BoazEngineJS/controller", ["require", "exports", "BoazEngineJS/btimer", "BoazEngineJS/engine"], function (require, exports, btimer_1, engine_1) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    class Controller {
        constructor() {
            this.timer = btimer_1.BStopwatch.createWatch();
            this.timer.restart;
        }
        takeTurn(elapsedMs) {
            if (engine_1.model.paused) {
                this.doPausedState();
                return;
            }
            if (engine_1.model.startAfterLoad) {
                this.doStartAfterLoadState();
            }
            btimer_1.BStopwatch.updateTimers(elapsedMs);
            let toRemove = engine_1.model.objects.filter(o => o.disposeFlag).forEach(o => { engine_1.model.remove(o); o.exile(); });
        }
        doPausedState() {
        }
        doStartAfterLoadState() {
        }
        switchState(newstate) {
            this.disposeOldState(newstate);
            this.initNewState(newstate);
            engine_1.model.gameOldState = engine_1.model.gameState;
            engine_1.model.gameState = newstate;
        }
        switchSubstate(newsubstate) {
            this.disposeOldSubstate(newsubstate);
            this.initNewSubstate(newsubstate);
            engine_1.model.gameOldSubstate = engine_1.model.gameSubstate;
            engine_1.model.gameSubstate = newsubstate;
        }
        disposeOldState(newstate) {
        }
        disposeOldSubstate(newsubstate) {
        }
        initNewSubstate(newsubstate) {
        }
        initNewState(newstate) {
        }
    }
    exports.Controller = Controller;
});
define("BoazEngineJS/view", ["require", "exports", "BoazEngineJS/constants", "BoazEngineJS/engine"], function (require, exports, constants_1, engine_2) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    var DrawBitmap;
    (function (DrawBitmap) {
        DrawBitmap[DrawBitmap["HFLIP"] = 1] = "HFLIP";
        DrawBitmap[DrawBitmap["VFLIP"] = 2] = "VFLIP";
    })(DrawBitmap = exports.DrawBitmap || (exports.DrawBitmap = {}));
    class View {
        constructor() {
        }
        init() {
            this.handleResize();
        }
        setRelativeToScreenSize(element, size) {
            element.style.width = [size.x * this.dx, 'px'].join('');
            element.style.height = [size.y * this.dy, 'px'].join('');
        }
        calculateSize() {
            let w = Math.max(document.documentElement.clientWidth, window.innerWidth || 0);
            let h = Math.max(document.documentElement.clientHeight, window.innerHeight || 0);
            this.windowSize = { x: w, y: h };
            this.dx = this.windowSize.x / constants_1.Constants.GAMESCREEN_WIDTH;
            this.dy = this.windowSize.y / constants_1.Constants.GAMESCREEN_HEIGHT;
            this.dxy = Math.min(this.dx, this.dy);
        }
        handleResize() {
            if (document.getElementById('gamescreen').style.visibility == 'hidden')
                return;
            engine_2.view.calculateSize();
            document.getElementById('gamescreen').style.transform = ['scale(', engine_2.view.dx, ',', engine_2.view.dy, ')'].join('');
            document.getElementById('gamescreen').style.transformOrigin = '0 0';
            document.getElementById('gamescreen').style.width = (engine_2.view.windowSize.x * (1 + engine_2.view.dx)) + 'px';
            document.getElementById('gamescreen').style.height = (engine_2.view.windowSize.y * (1 + engine_2.view.dy)) + 'px';
        }
        draw() {
            throw ("Niet geïmplementeerd :(");
        }
        drawLoading() {
            throw ("Niet geïmplementeerd :(");
        }
        DrawBitmap(imgId, x, y, options) {
            this.drawImg(imgId, { x: x, y: y }, options || undefined);
        }
        DrawColoredBitmap(imgId, x, y, r, g, b, a) {
            throw ("Niet geïmplementeerd :(");
        }
        drawImg(imgId, pos, options) {
            throw ("Niet geïmplementeerd :(");
        }
        DrawRectangle(x, y, ex, ey, c) {
            throw ("Niet geïmplementeerd :(");
        }
        FillRectangle(x, y, ex, ey, c) {
            throw ("Niet geïmplementeerd :(");
        }
    }
    exports.View = View;
});
define("BoazEngineJS/song", ["require", "exports"], function (require, exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
});
define("BoazEngineJS/effect", ["require", "exports"], function (require, exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
});
define("BoazEngineJS/soundmaster", ["require", "exports", "BoazEngineJS/engine"], function (require, exports, engine_3) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    class SoundMaster {
        static OnMusicBufferEnd() {
            if (this.MusicBeingPlayed && this.MusicBeingPlayed.NextSong) {
                let nextSong = this.MusicBeingPlayed.NextSong;
                this.MusicBeingPlayed = nextSong;
                this.PlayMusic(nextSong);
            }
            else
                this.MusicBeingPlayed = null;
        }
        static OnEffectBufferEnd() {
            this.EffectBeingPlayed = null;
        }
        static StopEffect() {
            if (!this.EffectBeingPlayed.AudioId)
                return;
            engine_3.audio[`${this.EffectBeingPlayed.AudioId}`].pause();
            engine_3.audio[`${this.EffectBeingPlayed.AudioId}`].currentTime = 0;
            this.EffectBeingPlayed = null;
        }
        static playEffect(audioId) {
            engine_3.audio[`${audioId}`].pause();
            engine_3.audio[`${audioId}`].currentTime = 0;
            engine_3.audio[`${audioId}`].play();
        }
        static PlayEffect(effect) {
            if (this.EffectBeingPlayed) {
                if (SoundMaster.LimitToOneEffect) {
                    if (effect.Priority >= this.EffectBeingPlayed.Priority) {
                        this.StopEffect();
                        this.playEffect(effect.AudioId);
                        this.EffectBeingPlayed = effect;
                        return;
                    }
                }
            }
            else {
                this.playEffect(effect.AudioId);
                this.EffectBeingPlayed = effect;
            }
        }
        static StopMusic() {
            if (!this.MusicBeingPlayed.Music)
                return;
            engine_3.audio[`${this.MusicBeingPlayed.Music}`].pause();
            engine_3.audio[`${this.MusicBeingPlayed.Music}`].currentTime = 0;
            this.MusicBeingPlayed = null;
        }
        static PlayMusic(song, stopCurrent = true) {
            if (stopCurrent)
                this.StopMusic();
            this.MusicBeingPlayed = song;
            engine_3.audio[`${song.Music}`].pause();
            engine_3.audio[`${song.Music}`].currentTime = 0;
            engine_3.audio[`${song.Music}`].Loop = song.Loop || false;
            engine_3.audio[`${song.Music}`].play();
        }
        static ResumeEffect() {
            engine_3.audio[`${this.EffectBeingPlayed.AudioId}`].play();
        }
        static ResumeMusic() {
            engine_3.audio[`${this.MusicBeingPlayed.Music}`].play();
        }
        static SetEffectsVolume(volume) {
            throw Error("Implementeer deze meuk!");
        }
        static SetMusicVolume(volume) {
            throw Error("Implementeer deze meuk!");
        }
    }
    exports.SoundMaster = SoundMaster;
    SoundMaster.LimitToOneEffect = true;
});
define("BoazEngineJS/engine", ["require", "exports", "BoazEngineJS/constants"], function (require, exports, constants_2) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.images = new Map();
    exports.audio = new Map();
    class Game {
        constructor() {
            this.startAfterLoad = () => {
                exports.controller.switchState(constants_2.Constants.INITIAL_GAMESTATE);
                exports.controller.switchSubstate(constants_2.Constants.INITIAL_GAMESUBSTATE);
                requestAnimationFrame(function (timestamp) {
                    exports.game.run(timestamp);
                });
                $(window).on('resize', function () {
                    exports.view.handleResize();
                });
                window.addEventListener('orientationchange', exports.view.handleResize, false);
                exports.view.handleResize();
            };
            this.update = (elapsedMs) => {
                exports.controller.takeTurn(elapsedMs);
            };
            this.run = (timestamp) => {
                let elapsedMs = timestamp - this.lastUpdate;
                this.lastUpdate = timestamp;
                this.update(elapsedMs);
                exports.view.draw();
                requestAnimationFrame(function (timestamp) {
                    exports.game.run(timestamp);
                    ++this.turnCounter;
                });
            };
            this.fps = 50;
        }
        static get _() {
            return exports.game;
        }
        get TurnCounter() {
            return this.turnCounter;
        }
        GameOptionsChanged() {
            throw Error("Not implemented yet :-(");
        }
        loadGameOptions() {
            throw Error("Not implemented yet :-(");
        }
    }
    exports.Game = Game;
    $(function () {
    });
    if (typeof Array.isArray === 'undefined') {
        Array.isArray = function (obj) {
            return Object.prototype.toString.call(obj) === '[object Array]';
        };
    }
    ;
});
define("src/resourcemaster", ["require", "exports", "resourceids"], function (require, exports, resourceids_1) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.img2src = new Map();
    exports.snd2src = new Map();
    class ResourceMaster {
        constructor() {
            this.SoundEffectList = new Map();
            this.MusicList = new Map();
        }
        static get _() {
            return ResourceMaster._instance != null ? ResourceMaster._instance : (ResourceMaster._instance = new ResourceMaster());
        }
        static get Sound() {
            return ResourceMaster._.SoundEffectList;
        }
        static get Music() {
            return ResourceMaster._.MusicList;
        }
        static AddImg(key, src) {
            exports.img2src.set(key, src);
        }
        static AddSnd(key, src) {
            exports.snd2src.set(key, src);
        }
        static reloadImg(key, src) {
            exports.img2src.set(key, src);
            throw new Error("Reloading nodig!");
        }
        LoadGameResources() {
            this.loadViewResources();
            this.loadAudioResources();
        }
        loadViewResources() {
            ResourceMaster.AddImg(resourceids_1.BitmapId.Titel, "./Resources/Graphics/Belmont/Belmont_l1.png");
            this.loadBelmontResources();
            this.loadFXResources();
            this.loadMiscResources();
            this.loadFontResources();
            this.loadItemResources();
            this.loadFoeResources();
            this.loadNPCResources();
            this.loadDecorResources();
        }
        loadFXResources() {
            ResourceMaster.AddImg(resourceids_1.BitmapId.FoeKill_1, "./Resources/Graphics/FX/Foekill_1.png");
            ResourceMaster.AddImg(resourceids_1.BitmapId.FoeKill_2, "./Resources/Graphics/FX/Foekill_2.png");
        }
        loadDecorResources() {
            ResourceMaster.AddImg(resourceids_1.BitmapId.Candle_1, "./Resources/Graphics/Decor/Candle_1.png");
            ResourceMaster.AddImg(resourceids_1.BitmapId.Candle_2, "./Resources/Graphics/Decor/Candle_2.png");
            ResourceMaster.AddImg(resourceids_1.BitmapId.GCandle_1, "./Resources/Graphics/Decor/GCandle_1.png");
            ResourceMaster.AddImg(resourceids_1.BitmapId.GCandle_2, "./Resources/Graphics/Decor/GCandle_2.png");
            ResourceMaster.AddImg(resourceids_1.BitmapId.Door, "./Resources/Graphics/Decor/Door.png");
        }
        loadBelmontResources() {
            ResourceMaster.AddImg(resourceids_1.BitmapId.Belmont_l1, "./Resources/Graphics/Belmont/Belmont_l1.png");
            ResourceMaster.AddImg(resourceids_1.BitmapId.Belmont_l2, "./Resources/Graphics/Belmont/Belmont_l2.png");
            ResourceMaster.AddImg(resourceids_1.BitmapId.Belmont_l3, "./Resources/Graphics/Belmont/Belmont_l3.png");
            ResourceMaster.AddImg(resourceids_1.BitmapId.Belmont_ld, "./Resources/Graphics/Belmont/Belmont_ld.png");
            ResourceMaster.AddImg(resourceids_1.BitmapId.Belmont_lw1, "./Resources/Graphics/Belmont/Belmont_lw1.png");
            ResourceMaster.AddImg(resourceids_1.BitmapId.Belmont_lw2, "./Resources/Graphics/Belmont/Belmont_lw2.png");
            ResourceMaster.AddImg(resourceids_1.BitmapId.Belmont_lw3, "./Resources/Graphics/Belmont/Belmont_lw3.png");
            ResourceMaster.AddImg(resourceids_1.BitmapId.Belmont_lwd1, "./Resources/Graphics/Belmont/Belmont_lwd1.png");
            ResourceMaster.AddImg(resourceids_1.BitmapId.Belmont_lwd2, "./Resources/Graphics/Belmont/Belmont_lwd2.png");
            ResourceMaster.AddImg(resourceids_1.BitmapId.Belmont_lwd3, "./Resources/Graphics/Belmont/Belmont_lwd3.png");
            ResourceMaster.AddImg(resourceids_1.BitmapId.Belmont_ldead, "./Resources/Graphics/Belmont/Belmont_ldead.png");
            ResourceMaster.AddImg(resourceids_1.BitmapId.Belmont_lhitdown, "./Resources/Graphics/Belmont/Belmont_lhitdown.png");
            ResourceMaster.AddImg(resourceids_1.BitmapId.Belmont_lhitfly, "./Resources/Graphics/Belmont/Belmont_lhitfly.png");
            ResourceMaster.AddImg(resourceids_1.BitmapId.Belmont_r1, "./Resources/Graphics/Belmont/Belmont_r1.png");
            ResourceMaster.AddImg(resourceids_1.BitmapId.Belmont_r2, "./Resources/Graphics/Belmont/Belmont_r2.png");
            ResourceMaster.AddImg(resourceids_1.BitmapId.Belmont_r3, "./Resources/Graphics/Belmont/Belmont_r3.png");
            ResourceMaster.AddImg(resourceids_1.BitmapId.Belmont_rd, "./Resources/Graphics/Belmont/Belmont_rd.png");
            ResourceMaster.AddImg(resourceids_1.BitmapId.Belmont_rw1, "./Resources/Graphics/Belmont/Belmont_rw1.png");
            ResourceMaster.AddImg(resourceids_1.BitmapId.Belmont_rw2, "./Resources/Graphics/Belmont/Belmont_rw2.png");
            ResourceMaster.AddImg(resourceids_1.BitmapId.Belmont_rw3, "./Resources/Graphics/Belmont/Belmont_rw3.png");
            ResourceMaster.AddImg(resourceids_1.BitmapId.Belmont_rwd1, "./Resources/Graphics/Belmont/Belmont_rwd1.png");
            ResourceMaster.AddImg(resourceids_1.BitmapId.Belmont_rwd2, "./Resources/Graphics/Belmont/Belmont_rwd2.png");
            ResourceMaster.AddImg(resourceids_1.BitmapId.Belmont_rwd3, "./Resources/Graphics/Belmont/Belmont_rwd3.png");
            ResourceMaster.AddImg(resourceids_1.BitmapId.Belmont_rdead, "./Resources/Graphics/Belmont/Belmont_rdead.png");
            ResourceMaster.AddImg(resourceids_1.BitmapId.Belmont_rhitdown, "./Resources/Graphics/Belmont/Belmont_rhitdown.png");
            ResourceMaster.AddImg(resourceids_1.BitmapId.Belmont_rhitfly, "./Resources/Graphics/Belmont/Belmont_rhitfly.png");
        }
        loadMiscResources() {
            ResourceMaster.AddImg(resourceids_1.BitmapId.HUD, "./Resources/Graphics/HUD/HUD.png");
            ResourceMaster.AddImg(resourceids_1.BitmapId.HUD_EnergyStripe_belmont, "./Resources/Graphics/HUD/Energybarstripe_Belmont.png");
            ResourceMaster.AddImg(resourceids_1.BitmapId.HUD_EnergyStripe_boss, "./Resources/Graphics/HUD/EnergybarStripe_Boss.png");
            ResourceMaster.AddImg(resourceids_1.BitmapId.CurtainPart, "./Resources/Graphics/Misc/CurtainPart.png");
            ResourceMaster.AddImg(resourceids_1.BitmapId.MenuCursor, "./Resources/Graphics/Menu/MenuCursor.png");
        }
        loadFontResources() {
            ResourceMaster.AddImg(resourceids_1.BitmapId.Font_A, "./Resources/Graphics/Font/Letter_A.png");
            ResourceMaster.AddImg(resourceids_1.BitmapId.Font_B, "./Resources/Graphics/Font/Letter_B.png");
            ResourceMaster.AddImg(resourceids_1.BitmapId.Font_C, "./Resources/Graphics/Font/Letter_C.png");
            ResourceMaster.AddImg(resourceids_1.BitmapId.Font_D, "./Resources/Graphics/Font/Letter_D.png");
            ResourceMaster.AddImg(resourceids_1.BitmapId.Font_E, "./Resources/Graphics/Font/Letter_E.png");
            ResourceMaster.AddImg(resourceids_1.BitmapId.Font_F, "./Resources/Graphics/Font/Letter_F.png");
            ResourceMaster.AddImg(resourceids_1.BitmapId.Font_G, "./Resources/Graphics/Font/Letter_G.png");
            ResourceMaster.AddImg(resourceids_1.BitmapId.Font_H, "./Resources/Graphics/Font/Letter_H.png");
            ResourceMaster.AddImg(resourceids_1.BitmapId.Font_I, "./Resources/Graphics/Font/Letter_I.png");
            ResourceMaster.AddImg(resourceids_1.BitmapId.Font_J, "./Resources/Graphics/Font/Letter_J.png");
            ResourceMaster.AddImg(resourceids_1.BitmapId.Font_K, "./Resources/Graphics/Font/Letter_K.png");
            ResourceMaster.AddImg(resourceids_1.BitmapId.Font_L, "./Resources/Graphics/Font/Letter_L.png");
            ResourceMaster.AddImg(resourceids_1.BitmapId.Font_M, "./Resources/Graphics/Font/Letter_M.png");
            ResourceMaster.AddImg(resourceids_1.BitmapId.Font_N, "./Resources/Graphics/Font/Letter_N.png");
            ResourceMaster.AddImg(resourceids_1.BitmapId.Font_O, "./Resources/Graphics/Font/Letter_O.png");
            ResourceMaster.AddImg(resourceids_1.BitmapId.Font_P, "./Resources/Graphics/Font/Letter_P.png");
            ResourceMaster.AddImg(resourceids_1.BitmapId.Font_Q, "./Resources/Graphics/Font/Letter_Q.png");
            ResourceMaster.AddImg(resourceids_1.BitmapId.Font_R, "./Resources/Graphics/Font/Letter_R.png");
            ResourceMaster.AddImg(resourceids_1.BitmapId.Font_S, "./Resources/Graphics/Font/Letter_S.png");
            ResourceMaster.AddImg(resourceids_1.BitmapId.Font_T, "./Resources/Graphics/Font/Letter_T.png");
            ResourceMaster.AddImg(resourceids_1.BitmapId.Font_U, "./Resources/Graphics/Font/Letter_U.png");
            ResourceMaster.AddImg(resourceids_1.BitmapId.Font_V, "./Resources/Graphics/Font/Letter_V.png");
            ResourceMaster.AddImg(resourceids_1.BitmapId.Font_W, "./Resources/Graphics/Font/Letter_W.png");
            ResourceMaster.AddImg(resourceids_1.BitmapId.Font_X, "./Resources/Graphics/Font/Letter_X.png");
            ResourceMaster.AddImg(resourceids_1.BitmapId.Font_IJ, "./Resources/Graphics/Font/Letter_IJ.png");
            ResourceMaster.AddImg(resourceids_1.BitmapId.Font_Y, "./Resources/Graphics/Font/Letter_Y.png");
            ResourceMaster.AddImg(resourceids_1.BitmapId.Font_Z, "./Resources/Graphics/Font/Letter_Z.png");
            ResourceMaster.AddImg(resourceids_1.BitmapId.Font_0, "./Resources/Graphics/Font/Letter_0.png");
            ResourceMaster.AddImg(resourceids_1.BitmapId.Font_1, "./Resources/Graphics/Font/Letter_1.png");
            ResourceMaster.AddImg(resourceids_1.BitmapId.Font_2, "./Resources/Graphics/Font/Letter_2.png");
            ResourceMaster.AddImg(resourceids_1.BitmapId.Font_3, "./Resources/Graphics/Font/Letter_3.png");
            ResourceMaster.AddImg(resourceids_1.BitmapId.Font_4, "./Resources/Graphics/Font/Letter_4.png");
            ResourceMaster.AddImg(resourceids_1.BitmapId.Font_5, "./Resources/Graphics/Font/Letter_5.png");
            ResourceMaster.AddImg(resourceids_1.BitmapId.Font_6, "./Resources/Graphics/Font/Letter_6.png");
            ResourceMaster.AddImg(resourceids_1.BitmapId.Font_7, "./Resources/Graphics/Font/Letter_7.png");
            ResourceMaster.AddImg(resourceids_1.BitmapId.Font_8, "./Resources/Graphics/Font/Letter_8.png");
            ResourceMaster.AddImg(resourceids_1.BitmapId.Font_9, "./Resources/Graphics/Font/Letter_9.png");
            ResourceMaster.AddImg(resourceids_1.BitmapId.Font_Comma, "./Resources/Graphics/Font/Letter_Comma.png");
            ResourceMaster.AddImg(resourceids_1.BitmapId.Font_Dot, "./Resources/Graphics/Font/Letter_Dot.png");
            ResourceMaster.AddImg(resourceids_1.BitmapId.Font_Exclamation, "./Resources/Graphics/Font/Letter_Exclamation.png");
            ResourceMaster.AddImg(resourceids_1.BitmapId.Font_QuestionMark, "./Resources/Graphics/Font/Letter_Question.png");
            ResourceMaster.AddImg(resourceids_1.BitmapId.Font_Line, "./Resources/Graphics/Font/Letter_Line.png");
            ResourceMaster.AddImg(resourceids_1.BitmapId.Font_Apostroph, "./Resources/Graphics/Font/Letter_Apostroph.png");
            ResourceMaster.AddImg(resourceids_1.BitmapId.Font_Space, "./Resources/Graphics/Font/Letter_Space.png");
            ResourceMaster.AddImg(resourceids_1.BitmapId.Font_Continue, "./Resources/Graphics/Font/Letter_Continue.png");
            ResourceMaster.AddImg(resourceids_1.BitmapId.Font_Colon, "./Resources/Graphics/Font/Letter_Colon.png");
            ResourceMaster.AddImg(resourceids_1.BitmapId.Font_Streep, "./Resources/Graphics/Font/Letter_Streep.png");
            ResourceMaster.AddImg(resourceids_1.BitmapId.Font_Slash, "./Resources/Graphics/Font/Letter_Slash.png");
            ResourceMaster.AddImg(resourceids_1.BitmapId.Font_Percent, "./Resources/Graphics/Font/Letter_Percent.png");
            ResourceMaster.AddImg(resourceids_1.BitmapId.Font_SpeakStart, "./Resources/Graphics/Font/Letter_SpeakStart.png");
            ResourceMaster.AddImg(resourceids_1.BitmapId.Font_SpeakEnd, "./Resources/Graphics/Font/Letter_SpeakEnd.png");
        }
        loadItemResources() {
            ResourceMaster.AddImg(resourceids_1.BitmapId.Chest, "./Resources/Graphics/Item/Chest.png");
            ResourceMaster.AddImg(resourceids_1.BitmapId.Heart_big, "./Resources/Graphics/Item/Heart_big.png");
            ResourceMaster.AddImg(resourceids_1.BitmapId.Heart_small, "./Resources/Graphics/Item/Heart_small.png");
            ResourceMaster.AddImg(resourceids_1.BitmapId.Heart_fly, "./Resources/Graphics/Item/Heart_fly.png");
            ResourceMaster.AddImg(resourceids_1.BitmapId.Key_big, "./Resources/Graphics/Item/Key_big.png");
            ResourceMaster.AddImg(resourceids_1.BitmapId.Key_small, "./Resources/Graphics/Item/Key_small.png");
        }
        loadFoeResources() {
            ResourceMaster.AddImg(resourceids_1.BitmapId.ZakFoe_1, "./Resources/Graphics/Foe/ZakFoe1.png");
            ResourceMaster.AddImg(resourceids_1.BitmapId.ZakFoe_2, "./Resources/Graphics/Foe/ZakFoe2.png");
            ResourceMaster.AddImg(resourceids_1.BitmapId.ZakFoe_3, "./Resources/Graphics/Foe/ZakFoe3.png");
            ResourceMaster.AddImg(resourceids_1.BitmapId.Chandelier_1, "./Resources/Graphics/Foe/chandelier.png");
            ResourceMaster.AddImg(resourceids_1.BitmapId.Hag_1, "./Resources/Graphics/Foe/Hag_1.png");
            ResourceMaster.AddImg(resourceids_1.BitmapId.Hag_2, "./Resources/Graphics/Foe/Hag_2.png");
        }
        loadNPCResources() {
        }
        loadAudioResources() {
            ResourceMaster.AddSnd(resourceids_1.AudioId.Init, "./Resources/Sound/Init.wav");
            ResourceMaster.AddSnd(resourceids_1.AudioId.Fout, "./Resources/Sound/Fout.wav");
            ResourceMaster.AddSnd(resourceids_1.AudioId.Selectie, "./Resources/Sound/Selectie.wav");
            this.SoundEffectList.set(resourceids_1.AudioId.Init, { AudioId: resourceids_1.AudioId.Init, Priority: -1 });
            this.SoundEffectList.set(resourceids_1.AudioId.Fout, { AudioId: resourceids_1.AudioId.Fout, Priority: 0 });
            this.SoundEffectList.set(resourceids_1.AudioId.Selectie, { AudioId: resourceids_1.AudioId.Selectie, Priority: 0 });
            ResourceMaster.AddSnd(resourceids_1.AudioId.Heart, "./Resources/Sound/Heart.wav");
            this.SoundEffectList.set(resourceids_1.AudioId.Heart, { AudioId: resourceids_1.AudioId.Heart, Priority: 0 });
            ResourceMaster.AddSnd(resourceids_1.AudioId.Hit, "./Resources/Sound/Hit.wav");
            this.SoundEffectList.set(resourceids_1.AudioId.Hit, { AudioId: resourceids_1.AudioId.Hit, Priority: 0 });
            ResourceMaster.AddSnd(resourceids_1.AudioId.ItemDrop, "./Resources/Sound/Item_drop.wav");
            this.SoundEffectList.set(resourceids_1.AudioId.ItemDrop, { AudioId: resourceids_1.AudioId.ItemDrop, Priority: 0 });
            ResourceMaster.AddSnd(resourceids_1.AudioId.ItemPickup, "./Resources/Sound/Item_pickup.wav");
            this.SoundEffectList.set(resourceids_1.AudioId.ItemPickup, { AudioId: resourceids_1.AudioId.ItemPickup, Priority: 0 });
            ResourceMaster.AddSnd(resourceids_1.AudioId.KeyGrab, "./Resources/Sound/Key_grab.wav");
            this.SoundEffectList.set(resourceids_1.AudioId.KeyGrab, { AudioId: resourceids_1.AudioId.KeyGrab, Priority: 0 });
            ResourceMaster.AddSnd(resourceids_1.AudioId.Knife, "./Resources/Sound/Knife.wav");
            this.SoundEffectList.set(resourceids_1.AudioId.Knife, { AudioId: resourceids_1.AudioId.Knife, Priority: 0 });
            ResourceMaster.AddSnd(resourceids_1.AudioId.Land, "./Resources/Sound/Land.wav");
            this.SoundEffectList.set(resourceids_1.AudioId.Land, { AudioId: resourceids_1.AudioId.Land, Priority: 0 });
            ResourceMaster.AddSnd(resourceids_1.AudioId.Lightning, "./Resources/Sound/Lightning.wav");
            this.SoundEffectList.set(resourceids_1.AudioId.Lightning, { AudioId: resourceids_1.AudioId.Lightning, Priority: 0 });
            ResourceMaster.AddSnd(resourceids_1.AudioId.Munnies, "./Resources/Sound/Munnies.wav");
            this.SoundEffectList.set(resourceids_1.AudioId.Munnies, { AudioId: resourceids_1.AudioId.Munnies, Priority: 0 });
            ResourceMaster.AddSnd(resourceids_1.AudioId.PlayerDamage, "./Resources/Sound/Player_damage.wav");
            this.SoundEffectList.set(resourceids_1.AudioId.PlayerDamage, { AudioId: resourceids_1.AudioId.PlayerDamage, Priority: 0 });
            ResourceMaster.AddSnd(resourceids_1.AudioId.Portal, "./Resources/Sound/Portal.wav");
            this.SoundEffectList.set(resourceids_1.AudioId.Portal, { AudioId: resourceids_1.AudioId.Portal, Priority: 0 });
            ResourceMaster.AddSnd(resourceids_1.AudioId.Wall_break, "./Resources/Sound/Wall_break.wav");
            this.SoundEffectList.set(resourceids_1.AudioId.Wall_break, { AudioId: resourceids_1.AudioId.Wall_break, Priority: 0 });
            ResourceMaster.AddSnd(resourceids_1.AudioId.Whip, "./Resources/Sound/Whip.wav");
            this.SoundEffectList.set(resourceids_1.AudioId.Whip, { AudioId: resourceids_1.AudioId.Whip, Priority: 0 });
            ResourceMaster.AddSnd(resourceids_1.AudioId.Boss, "./Resources/Music/Boss.wav");
            this.MusicList.set(resourceids_1.AudioId.Boss, { Music: resourceids_1.AudioId.Boss, Loop: true, NextSong: null });
            ResourceMaster.AddSnd(resourceids_1.AudioId.Ending, "./Resources/Music/Ending.wav");
            this.MusicList.set(resourceids_1.AudioId.Ending, { Music: resourceids_1.AudioId.Ending, Loop: true, NextSong: null });
            ResourceMaster.AddSnd(resourceids_1.AudioId.Humiliation, "./Resources/Music/Humiliation.wav");
            this.MusicList.set(resourceids_1.AudioId.Humiliation, { Music: resourceids_1.AudioId.Humiliation, Loop: false, NextSong: null });
            ResourceMaster.AddSnd(resourceids_1.AudioId.Huray, "./Resources/Music/Huray.wav");
            this.MusicList.set(resourceids_1.AudioId.Huray, { Music: resourceids_1.AudioId.Huray, Loop: false, NextSong: null });
            ResourceMaster.AddSnd(resourceids_1.AudioId.Ohnoes, "./Resources/Music/Ohnoes.wav");
            this.MusicList.set(resourceids_1.AudioId.Ohnoes, { Music: resourceids_1.AudioId.Ohnoes, Loop: false, NextSong: null });
            ResourceMaster.AddSnd(resourceids_1.AudioId.Prologue, "./Resources/Music/Prologue.wav");
            this.MusicList.set(resourceids_1.AudioId.Prologue, { Music: resourceids_1.AudioId.Prologue, Loop: false, NextSong: null });
            ResourceMaster.AddSnd(resourceids_1.AudioId.Stage, "./Resources/Music/Stage.wav");
            this.MusicList.set(resourceids_1.AudioId.Stage, { Music: resourceids_1.AudioId.Stage, Loop: true, NextSong: null });
        }
    }
    exports.ResourceMaster = ResourceMaster;
});
define("src/room", ["require", "exports", "BoazEngineJS/msx", "BoazEngineJS/direction", "src/gameconstants", "BoazEngineJS/engine", "resourceids", "src/resourcemaster"], function (require, exports, msx_2, direction_1, gameconstants_1, engine_4, resourceids_2, resourcemaster_1) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    class Room {
        static LoadRoom(data) {
            var result = new Room();
            result.Id = data.Id;
            result.CollisionData = data.CollisionMap;
            result.Exits = data.Exits;
            result.initFunction = data.InitFunction;
            result.BitmapPath = data.BitmapPath;
            resourcemaster_1.ResourceMaster.reloadImg(resourceids_2.BitmapId.Room, data.BitmapPath);
            return result;
        }
        InitRoom() {
            if (this.initFunction)
                this.initFunction(this);
        }
        TakeTurn() {
        }
        AnyCollisionsTiles(takeWallFoesIntoAccount, ...coordinatesToCheck) {
            return coordinatesToCheck.some(x => this.IsCollisionTile(x.x, x.y, takeWallFoesIntoAccount));
        }
        NearingRoomExit(x, y) {
            let _x = x / msx_2.TileSize;
            let _y = y / msx_2.TileSize;
            let result = { destRoom: Room.NO_ROOM_EXIT, direction: direction_1.Direction.None };
            if ((x < 0)) {
                let dest = this.RoomExit(direction_1.Direction.Left);
                result = { destRoom: dest, direction: direction_1.Direction.Left };
            }
            else if ((_x >= gameconstants_1.GameConstants.StageScreenWidthTiles)) {
                let dest = this.RoomExit(direction_1.Direction.Right);
                result = { destRoom: dest, direction: direction_1.Direction.Right };
            }
            else if ((_y < 2)) {
                let dest = this.RoomExit(direction_1.Direction.Up);
                result = { destRoom: dest, direction: direction_1.Direction.Up };
            }
            else if ((_y >= gameconstants_1.GameConstants.StageScreenHeightTiles)) {
                let dest = this.RoomExit(direction_1.Direction.Down);
                result = { destRoom: dest, direction: direction_1.Direction.Down };
            }
            return result;
        }
        IsCollisionTile(x, y, takeWallFoesIntoAccount) {
            let TileSize = 0;
            let DirectionDown = 0;
            let DirectionLeft = 0;
            let DirectionRight = 0;
            let DirectionUp = 0;
            let CSStageScreenWidthTiles = 0;
            let CSStageScreenHeightTiles = 0;
            let _x = (x / TileSize);
            let _y = (y / TileSize);
            if ((x < 0)) {
                if (this.CanLeaveRoom(DirectionLeft)) {
                    _x = 0;
                }
                else {
                    return true;
                }
            }
            else if ((_x >= CSStageScreenWidthTiles)) {
                if (this.CanLeaveRoom(DirectionRight)) {
                    _x = (CSStageScreenWidthTiles - 1);
                }
                else {
                    return true;
                }
            }
            if (((_y < 1)
                && (_y >= -1))) {
                if (this.CanLeaveRoom(DirectionUp)) {
                    _y = 0;
                }
                else {
                    return true;
                }
            }
            else if ((_y >= CSStageScreenHeightTiles)) {
                if (this.CanLeaveRoom(DirectionDown)) {
                    _y = (CSStageScreenHeightTiles - 1);
                }
                else {
                    return true;
                }
            }
            if ((this.CollisionData[_y][_x] != '.')) {
                return true;
            }
            return false;
        }
        RoomExit(dir) {
            let RoomExitsLocked = true;
            if (RoomExitsLocked) {
                return Room.NO_ROOM_EXIT;
            }
            return this.Exits[(dir)];
        }
        CanLeaveRoom(dir) {
            let RoomExitsLocked = true;
            if (RoomExitsLocked) {
                return false;
            }
            return (this.RoomExit(dir) != Room.NO_ROOM_EXIT);
        }
        Paint() {
            engine_4.view.DrawBitmap(this.ImageID, gameconstants_1.GameConstants.GameScreenStartX, gameconstants_1.GameConstants.GameScreenStartY);
        }
    }
    exports.Room = Room;
    Room.RoomWidth = 0;
    Room.RoomHeight = 0;
    Room.NO_ROOM_EXIT = 0;
});
define("BoazEngineJS/common", ["require", "exports", "BoazEngineJS/direction"], function (require, exports, direction_2) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    function moveArea(a, p) {
        return {
            start: { x: a.start.x + p.x, y: a.start.y + p.y },
            end: { x: a.end.x + p.x, y: a.end.y + p.y },
        };
    }
    exports.moveArea = moveArea;
    function addPoints(a, b) {
        return { x: a.x + b.x, y: a.y + b.y };
    }
    exports.addPoints = addPoints;
    function randomInt(min, max) {
        return Math.floor(Math.random() * (max - min + 1) + min);
    }
    exports.randomInt = randomInt;
    function newPoint(x, y) {
        return { x: x, y: y };
    }
    exports.newPoint = newPoint;
    function copyPoint(toCopy) {
        return { x: toCopy.x, y: toCopy.y };
    }
    exports.copyPoint = copyPoint;
    function newArea(sx, sy, ex, ey) {
        return { start: { x: sx, y: sy }, end: { x: ex, y: ey } };
    }
    exports.newArea = newArea;
    function newSize(x, y) {
        return { x: x, y: y };
    }
    exports.newSize = newSize;
    function setPoint(p, new_x, new_y) {
        p.x = new_x;
        p.y = new_y;
    }
    exports.setPoint = setPoint;
    function setSize(s, new_x, new_y) {
        s.x = new_x;
        s.y = new_y;
    }
    exports.setSize = setSize;
    function area2size(a) {
        return { x: a.end.x - a.start.x, y: a.end.y - a.start.y };
    }
    exports.area2size = area2size;
    function waitDuration(timer, duration) {
        if (!timer.running)
            timer.restart();
        if (timer.elapsedMilliseconds >= duration) {
            timer.restart();
            return true;
        }
        return false;
    }
    exports.waitDuration = waitDuration;
    function addToScreen(element) {
        let gamescreen = document.getElementById('gamescreen');
        gamescreen.appendChild(element);
    }
    exports.addToScreen = addToScreen;
    function removeFromScreen(element) {
        let gamescreen = document.getElementById('gamescreen');
        gamescreen.removeChild(element);
    }
    exports.removeFromScreen = removeFromScreen;
    function createDivSprite(img, imgsrc, classnames) {
        let result = document.createElement('div');
        if (classnames) {
            classnames.forEach(x => {
                result.classList.add(x);
            });
        }
        let rimg = document.createElement('img');
        if (imgsrc)
            rimg.src = imgsrc;
        else if (img)
            rimg.src = img.src;
        else
            throw ('Cannot create sprite without an image or image source!');
        result.appendChild(rimg);
        return result;
    }
    exports.createDivSprite = createDivSprite;
    function GetDeltaFromSourceToTarget(source, target) {
        let delta = { x: 0, y: 0 };
        if (Math.abs(target.x - source.x - 0) < 0.01) {
            delta.x = 0;
            delta.y = (target.y - source.y) > 0 ? 1 : -1;
        }
        else if (Math.abs(target.y - source.y - 0) < 0.01) {
            delta.x = (target.x - source.x) > 0 ? 1 : -1;
            delta.y = 0;
        }
        else if (Math.abs((target.x - source.x)) > Math.abs((target.y - source.y))) {
            delta.x = (target.x - source.x) > 0 ? 1 : -1;
            delta.y = (target.y - source.y) / (Math.abs(target.x - source.x));
        }
        else {
            delta.x = (target.x - source.x) / (Math.abs(target.y - source.y));
            delta.y = (target.y - source.y) > 0 ? 1 : -1;
        }
        return delta;
    }
    exports.GetDeltaFromSourceToTarget = GetDeltaFromSourceToTarget;
    function LineLength(p1, p2) {
        return Math.sqrt(Math.pow(p2.x - p1.x, 2) + Math.pow(p2.y - p1.y, 2)) - 1;
    }
    exports.LineLength = LineLength;
    function storageAvailable(type) {
        try {
            var storage = window[type], x = '__storage_test__';
            storage.setItem(x, x);
            storage.removeItem(x);
            return true;
        }
        catch (e) {
            return e instanceof DOMException && (e.code === 22 ||
                e.code === 1014 ||
                e.name === 'QuotaExceededError' ||
                e.name === 'NS_ERROR_DOM_QUOTA_REACHED') &&
                storage.length !== 0;
        }
    }
    exports.storageAvailable = storageAvailable;
    function localStorageAvailable() {
        return storageAvailable('localStorage');
    }
    exports.localStorageAvailable = localStorageAvailable;
    function sessionStorageAvailable() {
        return storageAvailable('sessionStorage');
    }
    exports.sessionStorageAvailable = sessionStorageAvailable;
    function LookAt(subjectpos, targetpos) {
        let delta = { x: subjectpos.x - targetpos.x, y: subjectpos.x - targetpos.y };
        if (Math.abs(delta.x) >= Math.abs(delta.y)) {
            if (delta.x < 0)
                return direction_2.Direction.Right;
            else
                return direction_2.Direction.Left;
        }
        else {
            if (delta.y < 0)
                return direction_2.Direction.Down;
            else
                return direction_2.Direction.Up;
        }
    }
    exports.LookAt = LookAt;
    function Opposite(dir) {
        switch (dir) {
            case direction_2.Direction.Up:
                return direction_2.Direction.Down;
            case direction_2.Direction.Right:
                return direction_2.Direction.Left;
            case direction_2.Direction.Down:
                return direction_2.Direction.Up;
            case direction_2.Direction.Left:
                return direction_2.Direction.Right;
            default:
                return direction_2.Direction.None;
        }
    }
    exports.Opposite = Opposite;
});
define("BoazEngineJS/sprite", ["require", "exports", "BoazEngineJS/engine", "BoazEngineJS/common"], function (require, exports, engine_5, common_1) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    class Sprite {
        constructor(initialPos, imageId) {
            this.postpaint = (offset) => {
            };
            this.objectCollide = (o) => {
                return this.areaCollide(common_1.moveArea(o.hitarea, o.pos));
            };
            this.areaCollide = (a) => {
                let o1 = this;
                let o1p = o1.pos;
                let o1a = o1.hitarea;
                let o2a = a;
                return o1p.x + o1a.end.x >= o2a.start.x && o1p.x + o1a.start.x <= o2a.end.x &&
                    o1p.y + o1a.end.y >= o2a.start.y && o1p.y + o1a.start.y <= o2a.end.y;
            };
            this.id = null;
            this.pos = initialPos || { x: 0, y: 0 };
            this.size = { x: 0, y: 0 };
            this.hitarea = {
                start: { x: 0, y: 0 },
                end: { x: 0, y: 0 }
            };
            this.visible = true;
            this.hittable = true;
            this.flippedH = false;
            this.flippedV = false;
            this.priority = 0;
            this.rawAscii = false;
            this.disposeFlag = false;
            this.imgid = null;
            this.extendedProperties = new Map();
            if (imageId)
                this.imgid = imageId;
        }
        spawn(spawningPos) {
            if (spawningPos)
                this.pos = spawningPos;
        }
        exile() {
            throw new Error("Method not implemented.");
        }
        takeTurn() {
        }
        paint(offset) {
            engine_5.view.drawImg(this.imgid, offset ? common_1.addPoints(this.pos, offset) : this.pos);
        }
        collide(o) {
            if (o.id)
                return this.objectCollide(o);
            else
                return this.areaCollide(o);
        }
        inside(p) {
            let o1 = this;
            let o1p = o1.pos;
            let o1a = o1.hitarea;
            return o1p.x + o1a.end.x >= p.x && o1p.x + o1a.start.x <= p.x &&
                o1p.y + o1a.end.y >= p.y && o1p.y + o1a.start.y <= p.y;
        }
        handleResizeEvent() {
            throw new Error("Method not implemented.");
        }
        setExtendedProperty(key, value) {
            this.extendedProperties.set(key, value);
        }
    }
    exports.Sprite = Sprite;
    Sprite.objectCollide = (o1, o2) => {
        return o1.objectCollide(o2);
    };
});
define("src/creature", ["require", "exports", "BoazEngineJS/sprite", "BoazEngineJS/common", "BoazEngineJS/direction", "src/sintervaniamodel", "BoazEngineJS/msx", "BoazEngineJS/engine", "BoazEngineJS/constants"], function (require, exports, sprite_1, common_2, direction_3, sintervaniamodel_1, msx_3, engine_6, constants_3) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    class Creature extends sprite_1.Sprite {
        constructor(p) {
            super(p);
            this.currentWalkAnimationFrame = 0;
            this.customId = null;
            this.originPos = { x: this.pos.x, y: this.pos.y };
        }
        get WallHitArea() {
            return this.hitarea;
        }
        set WallHitArea(value) {
        }
        get Direction() {
            return this._direction;
        }
        set Direction(value) {
            this.OldDirection = this._direction;
            this._direction = value;
        }
        Paint(offset = null) {
            if (this.disposeFlag || !this.visible)
                return;
            let options = this.flippedH ? constants_3.Constants.DRAWBITMAP_HFLIP : 0;
            if (offset == null)
                engine_6.view.DrawBitmap(this.imgid, this.pos.x, this.pos.y, options);
            else
                engine_6.view.DrawBitmap(this.imgid, this.pos.x + offset.x, this.pos.y + offset.y, options);
        }
        get id() {
            return this.customId != null ? this.customId : `${this.constructor.name}:${sintervaniamodel_1.GameModel._.CurrentRoom.Id}:${this.originPos.x},${this.originPos.y}`;
        }
        set id(value) {
            this.customId = value;
        }
        DetermineFrame() {
            this.imgid = this.movementSprites[this.Direction][this.currentWalkAnimationFrame];
            this.flippedH = this.Direction == direction_3.Direction.Right;
        }
        AnimateMovement(movedDistance) {
            if (movedDistance > 0) {
                this.moveLeftBeforeFrameChange -= movedDistance;
                if (this.moveLeftBeforeFrameChange < 0) {
                    this.moveLeftBeforeFrameChange = this.moveBeforeFrameChange;
                    if (++this.currentWalkAnimationFrame >= this.movementSprites[this.Direction].Length) {
                        this.currentWalkAnimationFrame = 1;
                    }
                }
            }
            else {
                this.currentWalkAnimationFrame = 0;
                this.DetermineFrame();
            }
        }
        checkWallSpriteCollisions() {
            return sintervaniamodel_1.GameModel._.objects.filter(o => o != this && o.extendedProperties[sintervaniamodel_1.GameModel.PROPERTY_ACT_AS_WALL] && o.hittable).some(o => o.areaCollide(common_2.moveArea(this.WallHitArea, this.pos)));
        }
        checkWallCollision() {
            let startx = this.pos.x + this.WallHitArea.start.x;
            let starty = this.pos.y + this.WallHitArea.start.y;
            let endx = this.pos.x + this.WallHitArea.end.x;
            let endy = this.pos.y + this.WallHitArea.end.y;
            switch (this.Direction) {
                case direction_3.Direction.Up:
                    return sintervaniamodel_1.GameModel._.CurrentRoom.IsCollisionTile(startx, starty, true) || sintervaniamodel_1.GameModel._.CurrentRoom.IsCollisionTile(endx, starty, true);
                case direction_3.Direction.Right:
                    return sintervaniamodel_1.GameModel._.CurrentRoom.IsCollisionTile(endx, starty, true) || sintervaniamodel_1.GameModel._.CurrentRoom.IsCollisionTile(endx, endy, true);
                case direction_3.Direction.Down:
                    return sintervaniamodel_1.GameModel._.CurrentRoom.IsCollisionTile(startx, endy, true) || sintervaniamodel_1.GameModel._.CurrentRoom.IsCollisionTile(endx, endy, true);
                case direction_3.Direction.Left:
                    return sintervaniamodel_1.GameModel._.CurrentRoom.IsCollisionTile(startx, starty, true) || sintervaniamodel_1.GameModel._.CurrentRoom.IsCollisionTile(startx, endy, true);
                case direction_3.Direction.None:
                    return sintervaniamodel_1.GameModel._.CurrentRoom.IsCollisionTile(startx, starty, true) || sintervaniamodel_1.GameModel._.CurrentRoom.IsCollisionTile(endx, endy, true);
                default:
                    return false;
            }
        }
        handleWallCollision() {
            switch (this.Direction) {
                case direction_3.Direction.Up:
                    if (this.pos.y >= 0)
                        this.pos.y = (this.pos.y / msx_3.TileSize + 1) * msx_3.TileSize;
                    this.pos.y = this.pos.y / msx_3.TileSize * msx_3.TileSize;
                    break;
                case direction_3.Direction.Right:
                    this.pos.x = this.pos.x / msx_3.TileSize * msx_3.TileSize;
                    break;
                case direction_3.Direction.Down:
                    this.pos.y = this.pos.y / msx_3.TileSize * msx_3.TileSize;
                    break;
                case direction_3.Direction.Left:
                    if (this.pos.x >= 0)
                        this.pos.x = (this.pos.x / msx_3.TileSize + 1) * msx_3.TileSize;
                    this.pos.x = this.pos.x / msx_3.TileSize * msx_3.TileSize;
                    break;
            }
        }
    }
    exports.Creature = Creature;
});
define("src/projectile", ["require", "exports", "BoazEngineJS/sprite", "BoazEngineJS/direction", "BoazEngineJS/common", "BoazEngineJS/constants", "src/sintervaniamodel", "BoazEngineJS/engine"], function (require, exports, sprite_2, direction_4, common_3, constants_4, sintervaniamodel_2, engine_7) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    class Projectile extends sprite_2.Sprite {
        constructor(pos, speed) {
            super({ x: pos.x, y: pos.y });
            this.speed = speed;
        }
        Paint(offset = null) {
            if (this.disposeFlag || !this.visible)
                return;
            let options = this.flippedH ? constants_4.Constants.DRAWBITMAP_HFLIP : 0;
            options = options || this.flippedV ? constants_4.Constants.DRAWBITMAP_VFLIP : 0;
            engine_7.view.DrawBitmap(this.imgid, this.pos.x, this.pos.y, options);
        }
        checkWallSpriteCollisions() {
            return sintervaniamodel_2.GameModel._.objects.filter(o => o.extendedProperties[sintervaniamodel_2.GameModel.PROPERTY_ACT_AS_WALL]).some(o => o.areaCollide(common_3.moveArea(this.hitarea, this.pos)));
        }
        checkWallCollision() {
            let startx = this.pos.x + this.hitarea.start.x;
            let starty = this.pos.y + this.hitarea.start.y;
            let endx = this.pos.x + this.hitarea.end.x;
            let endy = this.pos.y + this.hitarea.end.y;
            switch (this.Direction) {
                case direction_4.Direction.Up:
                    return sintervaniamodel_2.GameModel._.CurrentRoom.IsCollisionTile(startx, starty, true) || sintervaniamodel_2.GameModel._.CurrentRoom.IsCollisionTile(endx, starty, true);
                case direction_4.Direction.Right:
                    return sintervaniamodel_2.GameModel._.CurrentRoom.IsCollisionTile(endx, starty, true) || sintervaniamodel_2.GameModel._.CurrentRoom.IsCollisionTile(endx, endy, true);
                case direction_4.Direction.Down:
                    return sintervaniamodel_2.GameModel._.CurrentRoom.IsCollisionTile(startx, endy, true) || sintervaniamodel_2.GameModel._.CurrentRoom.IsCollisionTile(endx, endy, true);
                case direction_4.Direction.Left:
                    return sintervaniamodel_2.GameModel._.CurrentRoom.IsCollisionTile(startx, starty, true) || sintervaniamodel_2.GameModel._.CurrentRoom.IsCollisionTile(startx, endy, true);
                default:
                    return false;
            }
        }
    }
    exports.Projectile = Projectile;
});
define("src/pprojectile", ["require", "exports", "src/projectile", "src/sintervaniamodel"], function (require, exports, projectile_1, sintervaniamodel_3) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    class PlayerProjectile extends projectile_1.Projectile {
        constructor(fpos, speed) {
            super(fpos, speed);
            this.foesThatWereHit = new Array();
        }
        CheckAndInvokeHit() {
            let enemyWasHit = false;
            sintervaniamodel_3.GameModel._.Foes.filter(f => f.hittable && this.objectCollide(f)).filter((f) => !this.foesThatWereHit.includes(f)).forEach((f) => {
                this.foesThatWereHit.push(f);
                f.HandleHit(this);
                enemyWasHit = true;
            });
            return enemyWasHit;
        }
    }
    exports.PlayerProjectile = PlayerProjectile;
});
define("src/bootstrapper", ["require", "exports", "src/sintervaniamodel", "BoazEngineJS/common", "BoazEngineJS/msx"], function (require, exports, sintervaniamodel_4, common_4, msx_4) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    class Bootstrapper {
        static BootstrapGame(chapter) {
            switch (chapter) {
                case sintervaniamodel_4.Chapter.Debug:
                    Bootstrapper.bootstrapGameForDebug();
                    break;
                case sintervaniamodel_4.Chapter.GameStart:
                    Bootstrapper.bootstrapGameForGameStart();
                    break;
            }
        }
        static bootstrapGameForGameStart() {
            sintervaniamodel_4.GameModel._.LoadRoom(1);
            common_4.setPoint(sintervaniamodel_4.GameModel._.Belmont.pos, msx_4.Tile.ToCoord(15), msx_4.Tile.ToCoord(10));
        }
        static bootstrapGameForDebug() {
            sintervaniamodel_4.GameModel._.LoadRoom(100);
            common_4.setPoint(sintervaniamodel_4.GameModel._.Belmont.pos, msx_4.Tile.ToCoord(15), msx_4.Tile.ToCoord(10));
        }
    }
    exports.Bootstrapper = Bootstrapper;
});
define("BoazEngineJS/savegame", ["require", "exports"], function (require, exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    class Savegame {
    }
    exports.Savegame = Savegame;
});
define("src/weaponitem", ["require", "exports", "BoazEngineJS/sprite", "src/sintervaniamodel", "src/item", "resourceids", "BoazEngineJS/common", "src/gamecontroller"], function (require, exports, sprite_3, sintervaniamodel_5, item_1, resourceids_3, common_5, gamecontroller_1) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    class WeaponItem extends sprite_3.Sprite {
        constructor(type, pos) {
            super(pos);
            this.ItsType = type;
            this.hitarea = item_1.Item.ItemHitArea;
            this.size = common_5.area2size(item_1.Item.ItemHitArea);
            this.imgid = WeaponItem.Type2Image(type);
        }
        static WeaponItem2SecWeaponType(weaponItem) {
            if (weaponItem == null)
                return sintervaniamodel_5.SecWeaponType.None;
            switch (weaponItem.Type) {
                case WeaponType.None:
                default:
                    return sintervaniamodel_5.SecWeaponType.None;
                case WeaponType.Cross:
                    return sintervaniamodel_5.SecWeaponType.Cross;
            }
        }
        static SecWeaponType2WeaponItemType(secWeapontype) {
            switch (secWeapontype) {
                case sintervaniamodel_5.SecWeaponType.None:
                default:
                    return WeaponType.None;
                case sintervaniamodel_5.SecWeaponType.Cross:
                    return WeaponType.Cross;
            }
        }
        TakeTurn() {
            if (this.areaCollide(common_5.moveArea(sintervaniamodel_5.GameModel._.Belmont.RoomCollisionArea, sintervaniamodel_5.GameModel._.Belmont.pos))) {
                gamecontroller_1.GameController._.PickupWeaponItem(this);
                this.disposeFlag = true;
            }
        }
        static Type2Image(type) {
            switch (type) {
                default:
                    return resourceids_3.BitmapId.None;
            }
        }
        Dispose() {
        }
    }
    exports.WeaponItem = WeaponItem;
    WeaponItem.ItemHitArea = {
        start: { x: 0, y: 0 }, end: { x: 16, y: 16 }
    };
    WeaponItem.Descriptions = new Map();
    var WeaponType;
    (function (WeaponType) {
        WeaponType[WeaponType["None"] = -1] = "None";
        WeaponType[WeaponType["Cross"] = 0] = "Cross";
    })(WeaponType = exports.WeaponType || (exports.WeaponType = {}));
});
define("BoazEngineJS/event", ["require", "exports"], function (require, exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    class InputEvent {
        constructor() {
            this.fire = (source, ...args) => {
                for (let i = 0; i < this.subscribers.length; i++) {
                    this.subscribers[i](source, args);
                }
            };
            this.subscribe = (subscriber) => {
                this.subscribers.push(subscriber);
            };
            this.subscribers = [];
        }
    }
    exports.InputEvent = InputEvent;
    class ClickEvent extends InputEvent {
        constructor() {
            super();
            this.fire = (source, x, y) => {
                for (let i = 0; i < this.subscribers.length; i++) {
                    this.subscribers[i](source, x, y);
                }
            };
        }
    }
    exports.ClickEvent = ClickEvent;
    class MoveEvent extends InputEvent {
        constructor() {
            super();
            this.fire = (source, x, y) => {
                for (let i = 0; i < this.subscribers.length; i++) {
                    this.subscribers[i](source, x, y);
                }
            };
        }
    }
    exports.MoveEvent = MoveEvent;
    class KeydownEvent extends InputEvent {
        constructor() {
            super();
            this.fire = (source, keycode) => {
                for (let i = 0; i < this.subscribers.length; i++) {
                    this.subscribers[i](source, keycode);
                }
            };
        }
    }
    exports.KeydownEvent = KeydownEvent;
    class KeyupEvent extends InputEvent {
        constructor() {
            super();
            this.fire = (source, keycode) => {
                for (let i = 0; i < this.subscribers.length; i++) {
                    this.subscribers[i](source, keycode);
                }
            };
        }
    }
    exports.KeyupEvent = KeyupEvent;
    class BlurEvent extends InputEvent {
        constructor() {
            super();
            this.fire = (source) => {
                for (let i = 0; i < this.subscribers.length; i++) {
                    this.subscribers[i](source);
                }
            };
        }
    }
    exports.BlurEvent = BlurEvent;
    class TouchStartEvent extends InputEvent {
        constructor() {
            super();
            this.fire = (source, event) => {
                for (let i = 0; i < this.subscribers.length; i++) {
                    this.subscribers[i](source, event);
                }
            };
        }
    }
    exports.TouchStartEvent = TouchStartEvent;
    class TouchMoveEvent extends InputEvent {
        constructor() {
            super();
            this.fire = (source, event) => {
                for (let i = 0; i < this.subscribers.length; i++) {
                    this.subscribers[i](source, event);
                }
            };
        }
    }
    exports.TouchMoveEvent = TouchMoveEvent;
    class TouchEndEvent extends InputEvent {
        constructor() {
            super();
            this.fire = (source, event) => {
                for (let i = 0; i < this.subscribers.length; i++) {
                    this.subscribers[i](source, event);
                }
            };
        }
    }
    exports.TouchEndEvent = TouchEndEvent;
});
define("BoazEngineJS/input", ["require", "exports", "tslib", "BoazEngineJS/event"], function (require, exports, tslib_1, Event) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    Event = tslib_1.__importStar(Event);
    exports.mouseMoved = new Event.MoveEvent();
    exports.mouseClicked = new Event.ClickEvent();
    exports.keydowned = new Event.KeydownEvent();
    exports.keyupped = new Event.KeyupEvent();
    exports.blurred = new Event.BlurEvent();
    exports.touchStarted = new Event.TouchStartEvent();
    exports.touchMoved = new Event.TouchMoveEvent();
    exports.touchEnded = new Event.TouchEndEvent();
    function mouseMove(source, x, y) {
        exports.mouseMoved.fire(source, x, y);
    }
    exports.mouseMove = mouseMove;
    function mouseClick(source, x, y) {
        exports.mouseClicked.fire(source, x, y);
    }
    exports.mouseClick = mouseClick;
    function keydown(source, keycode) {
        exports.keydowned.fire(source, keycode);
    }
    exports.keydown = keydown;
    function keyup(source, keycode) {
        exports.keyupped.fire(source, keycode);
    }
    exports.keyup = keyup;
    function blur(source) {
        exports.blurred.fire(source);
    }
    exports.blur = blur;
    function touchStart(source, evt) {
        exports.touchStarted.fire(source, evt);
    }
    exports.touchStart = touchStart;
    function touchMove(source, evt) {
        exports.touchMoved.fire(source, evt);
    }
    exports.touchMove = touchMove;
    function touchEnd(source, evt) {
        exports.touchEnded.fire(source, evt);
    }
    exports.touchEnd = touchEnd;
    function getMousePos(evt) {
        return { x: 0, y: 0 };
    }
    exports.getMousePos = getMousePos;
    function init() {
        exports.KeyState = {
            KC_UP: false,
            KC_RIGHT: false,
            KC_DOWN: false,
            KC_LEFT: false,
            KC_SPACE: false,
            KC_M: false,
            KU_UP: false,
            KU_RIGHT: false,
            KU_DOWN: false,
            KU_LEFT: false,
            KU_SPACE: false,
            KU_M: false,
            KD_UP: false,
            KD_RIGHT: false,
            KD_DOWN: false,
            KD_LEFT: false,
            KD_SPACE: false,
            KD_M: false
        };
    }
    exports.init = init;
});
define("BoazEngineJS/animation", ["require", "exports", "BoazEngineJS/btimer", "BoazEngineJS/common"], function (require, exports, btimer_2, common_6) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    function createAniData(data, times, constantStepTime) {
        if (!times && !constantStepTime)
            throw ("Either [times] or [constantStepTime] must be given when creating a new animation!");
        let result = new Array();
        let i = 0;
        for (let d of data) {
            result.push({ time: times ? times[i] : constantStepTime, data: d });
            ++i;
        }
        return result;
    }
    function wrapInAniCompound(scalarStepValue) {
        return { nextStepValue: scalarStepValue };
    }
    class Animation {
        constructor(dataAndOrTime, timesOrConstantStepTime, repeat) {
            if (timesOrConstantStepTime) {
                if (Array.isArray(timesOrConstantStepTime)) {
                    let aniData = createAniData(dataAndOrTime, timesOrConstantStepTime, undefined);
                    this.animationDataAndTime = aniData;
                }
                else {
                    this.constantStepTime = timesOrConstantStepTime;
                    let aniData = createAniData(dataAndOrTime, undefined, timesOrConstantStepTime);
                    this.animationDataAndTime = aniData;
                }
            }
            else {
                this.animationDataAndTime = dataAndOrTime;
            }
            this.currentStepTime = 0;
            this.repeat = repeat || false;
            this.stepCounter = 0;
        }
        stepValue() {
            return this.animationDataAndTime[this.stepCounter].data;
        }
        stepTime() {
            if (this.constantStepTime != null)
                return this.constantStepTime;
            return this.animationDataAndTime[this.stepCounter].time;
        }
        hasNext() {
            return this.stepCounter < this.animationDataAndTime.length - 1;
        }
        finished() {
            return this.stepCounter >= this.animationDataAndTime.length;
        }
        nextStep() {
            ++this.stepCounter;
            if (!this.finished())
                return this.stepValue();
            else {
                if (this.repeat) {
                    this.stepCounter = 0;
                    return this.stepValue();
                }
                else
                    return null;
            }
        }
        doAnimation(timer, nextStepRef) {
            if (!nextStepRef) {
                if (timer instanceof btimer_2.BStopwatch)
                    return this.doAnimationTimer(timer);
                return this.doAnimationStep(timer);
            }
            else {
                let nextStepReturned = null;
                if (this.waitForNextStep(timer)) {
                    nextStepReturned = this.nextStep();
                    nextStepRef.nextStepValue = nextStepReturned;
                    return { value: nextStepReturned, next: true };
                }
                return { value: null, next: false };
            }
        }
        doAnimationTimer(timer) {
            let nextStep = null;
            if (this.waitForNextStep(timer)) {
                nextStep = this.nextStep();
                return { value: nextStep, next: true };
            }
            return { value: null, next: false };
        }
        doAnimationStep(step) {
            let nextStep = null;
            this.currentStepTime += step;
            if (this.currentStepTime >= this.stepTime()) {
                this.currentStepTime = 0;
                nextStep = this.nextStep();
                return { value: nextStep, next: true };
            }
            nextStep = this.stepValue();
            return { value: nextStep, next: false };
        }
        waitForNextStep(timer) {
            return common_6.waitDuration(timer, this.stepTime());
        }
        restart() {
            this.stepCounter = 0;
        }
    }
    exports.Animation = Animation;
});
define("src/belmont", ["require", "exports", "BoazEngineJS/direction", "src/creature", "BoazEngineJS/btimer", "src/gameconstants", "BoazEngineJS/common", "BoazEngineJS/animation", "BoazEngineJS/msx", "resourceids", "BoazEngineJS/input", "src/room", "BoazEngineJS/common", "BoazEngineJS/soundmaster", "src/resourcemaster", "src/gamecontroller", "src/sintervaniamodel", "BoazEngineJS/engine", "BoazEngineJS/view"], function (require, exports, direction_5, creature_1, btimer_3, gameconstants_2, common_7, animation_1, msx_5, resourceids_4, input_1, room_1, common_8, soundmaster_1, resourcemaster_2, gamecontroller_2, sintervaniamodel_6, engine_8, view_1) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    class RoeState {
        constructor() {
            this.aniTimer = new btimer_3.BStopwatch();
            this.Roeing = false;
            this.CurrentFrame = 0;
        }
        Start() {
            this.aniTimer.restart();
            this.Roeing = true;
            this.CurrentFrame = 0;
        }
        Stop() {
            this.aniTimer.stop();
            this.Roeing = false;
            this.CurrentFrame = 0;
        }
    }
    exports.RoeState = RoeState;
    RoeState.msPerFrame = [50, 25, 100];
    RoeState.RoeSprites = new Map([
        [direction_5.Direction.Right, [resourceids_4.BitmapId.Belmont_rw1, resourceids_4.BitmapId.Belmont_rw2, resourceids_4.BitmapId.Belmont_rw3]],
        [direction_5.Direction.Left, [resourceids_4.BitmapId.Belmont_lw1, resourceids_4.BitmapId.Belmont_lw2, resourceids_4.BitmapId.Belmont_lw3]],
    ]);
    RoeState.RoeSpritesCrouching = new Map([
        [direction_5.Direction.Right, [resourceids_4.BitmapId.Belmont_rwd1, resourceids_4.BitmapId.Belmont_rwd2, resourceids_4.BitmapId.Belmont_rwd3]],
        [direction_5.Direction.Left, [resourceids_4.BitmapId.Belmont_lwd1, resourceids_4.BitmapId.Belmont_lwd2, resourceids_4.BitmapId.Belmont_lwd3]],
    ]);
    RoeState.RoeSpritePosOffset = new Map([
        [direction_5.Direction.Right, [common_8.newPoint(-16, 0), common_8.newPoint(-16, 0), common_8.newPoint(0, 0)]],
        [direction_5.Direction.Left, [common_8.newPoint(0, 0), common_8.newPoint(0, 0), common_8.newPoint(-25, 0)]],
    ]);
    RoeState.RoeSpritePosOffsetCrouching = new Map([
        [direction_5.Direction.Right, [common_8.newPoint(-16, 0), common_8.newPoint(-16, 0), common_8.newPoint(0, 0)]],
    ]);
    class Belmont extends creature_1.Creature {
        constructor() {
            super(null);
            this.EventTouchHitArea = common_7.newArea(0, 24, 16, 32);
            this.imgid = resourceids_4.BitmapId.Belmont_r1;
            this.flippedH = false;
            this.CarryingShield = false;
            this.Direction = direction_5.Direction.Right;
            this.id = "Belmont";
            this.state = State.Normal;
            common_7.setSize(this.size, 16, 32);
            this.Health = gameconstants_2.GameConstants.Belmont_MaxHealth_AtStart;
            this.MaxHealth = gameconstants_2.GameConstants.Belmont_MaxHealth_AtStart;
            this.Crouching = false;
            this.hitState = new HitState();
            this.dyingState = new DyingState();
            this.roeState = new RoeState();
            this.jumpState = new JumpState();
            this.hitState.BlinkTimer = btimer_3.BStopwatch.createWatch();
            this.hitState.RecoveryTimer = btimer_3.BStopwatch.createWatch();
            this.hitState.CrouchTimer = btimer_3.BStopwatch.createWatch();
            this.dyingState.aniTimer = btimer_3.BStopwatch.createWatch();
            this.roeState.aniTimer = btimer_3.BStopwatch.createWatch();
            this.setExtendedProperty(sintervaniamodel_6.GameModel.PROPERTY_KEEP_AT_ROOMSWITCH, true);
        }
        get HealthPercentage() {
            return Math.min((Math.round(this.Health / this.MaxHealth * 100)), 100);
        }
        get RecoveringFromHit() {
            return this.hitState.CurrentStep != HitStateStep.None;
        }
        get movementSpeed() {
            return 2;
        }
        get Blink() {
            return this.hitState.Blink;
        }
        get Dying() {
            return this.state == State.Dying || this.state == State.Dead;
        }
        get Roeing() {
            return this.roeState.Roeing;
        }
        get Jumping() {
            return this.jumpState.Jumping;
        }
        get moveBeforeFrameChange() {
            return Belmont.MoveBeforeFrameChange;
        }
        get movementSprites() {
            if (this.CarryingShield)
                return Belmont.MovementSpritesWShield;
            return Belmont.MovementSpritesNoShield;
        }
        get WallHitArea() {
            return this.EventTouchHitArea;
        }
        set WallHitArea(value) {
        }
        get EventButtonHitArea() {
            switch (this.Direction) {
                case direction_5.Direction.Up:
                    return Belmont.buttonPressEventHitAreaUp;
                case direction_5.Direction.Right:
                    return Belmont.buttonPressEventHitAreaRight;
                case direction_5.Direction.Down:
                    return Belmont.buttonPressEventHitAreaDown;
                case direction_5.Direction.Left:
                    return Belmont.buttonPressEventHitAreaLeft;
                default:
                    return null;
            }
        }
        get RoomCollisionArea() {
            return this.EventTouchHitArea;
        }
        get hitarea() {
            return Belmont._hitarea;
        }
        set hitarea(value) {
        }
        get Vulnerable() {
            return !this.hitState.BlinkingAndInvulnerable && !this.Dying;
        }
        ResetToDefaultFrame() {
            this.currentWalkAnimationFrame = 0;
            this.moveLeftBeforeFrameChange = Belmont.MoveBeforeFrameChange;
            this.roeState.Stop();
            this.DetermineFrame();
            this.state = State.Normal;
        }
        GetProjectileOrigin() {
            let result = common_7.copyPoint(this.pos);
            switch (this.Direction) {
                case direction_5.Direction.Right:
                    result.x += 8;
                    result.y += 12;
                    break;
                case direction_5.Direction.Left:
                    result.y += 12;
                    break;
            }
            return result;
        }
        TakeTurn() {
            if (this.state == State.Dying) {
                this.doDeath();
                return;
            }
            if (this.state == State.Dead)
                return;
            if (this.hitState.BlinkingAndInvulnerable) {
                if (common_7.waitDuration(this.hitState.BlinkTimer, HitState.BlinkTimePerSwitch))
                    this.hitState.Blink = !this.hitState.Blink;
                if (common_7.waitDuration(this.hitState.RecoveryTimer, HitState.TotalBlinkTime)) {
                    this.hitState.BlinkingAndInvulnerable = false;
                    this.hitState.Blink = false;
                    this.hitState.BlinkTimer.stop();
                    this.hitState.RecoveryTimer.stop();
                    this.state = State.Normal;
                }
            }
            if (this.hitState.CurrentStep == HitStateStep.Flying) {
                this.doHitFlying();
            }
            else if (this.hitState.CurrentStep == HitStateStep.Falling) {
                this.doHitFall();
            }
            else if (this.hitState.CurrentStep == HitStateStep.Crouching) {
                this.doHitCrouching();
            }
            else if (this.roeState.Roeing) {
                if (common_7.waitDuration(this.roeState.aniTimer, RoeState.msPerFrame[this.roeState.CurrentFrame])) {
                    if (++this.roeState.CurrentFrame >= RoeState.msPerFrame.length) {
                        this.roeState.Stop();
                    }
                    else {
                        this.roeState.aniTimer.restart();
                    }
                }
            }
            else {
                let walked = false;
                if (!this.FloorCollision || this.Jumping || this.hitState.CurrentStep != HitStateStep.None) {
                    this.Crouching = false;
                    walked = false;
                    this.AnimateMovement(0);
                }
                else {
                    this.handleInput(walked);
                    if (walked) {
                        this.doWalk();
                    }
                    else {
                        this.AnimateMovement(0);
                        this.firstPressedButton = direction_5.Direction.None;
                    }
                }
            }
            if (!this.FloorCollision && (!this.Jumping || !this.jumpState.GoingUp) && this.hitState.CurrentStep != HitStateStep.Flying && this.hitState.CurrentStep != HitStateStep.Falling) {
                let originalPos = { x: this.pos.x, y: this.pos.y };
                this.checkAndHandleCollisions(originalPos);
                if (!this.FloorCollision)
                    this.pos.y += 4;
                this.checkAndHandleCollisions(originalPos);
                if (this.FloorCollision)
                    soundmaster_1.SoundMaster.PlayEffect(resourcemaster_2.ResourceMaster.Sound[resourceids_4.AudioId.Land]);
            }
            if (this.Jumping) {
                this.doJump();
            }
            this.DetermineFrame();
        }
        doHitFlying() {
            let delta = { nextStepValue: { x: 0, y: 0 } };
            this.hitState.HitAni.doAnimation(1, delta);
            let originalPos = common_7.copyPoint(this.pos);
            this.pos.x += this.Direction == direction_5.Direction.Right ? delta.nextStepValue.x : -delta.nextStepValue.x;
            let dir = this.Direction;
            this.Direction = this.Direction == direction_5.Direction.Left ? direction_5.Direction.Right : direction_5.Direction.Left;
            this.checkAndHandleWallAndCeilingCollisions(originalPos);
            this.Direction = dir;
            this.pos.y += delta.nextStepValue.y;
            if (!this.hitState.HitAni.hasNext) {
                this.hitState.CurrentStep = HitStateStep.Falling;
            }
        }
        doHitFall() {
            let originalPos = common_7.copyPoint(this.pos);
            this.pos.x += this.Direction == direction_5.Direction.Right ? -2 : 2;
            let dir = this.Direction;
            this.Direction = this.Direction == direction_5.Direction.Left ? direction_5.Direction.Right : direction_5.Direction.Left;
            this.checkAndHandleWallAndCeilingCollisions(originalPos);
            this.Direction = dir;
            if (!this.FloorCollision) {
                this.pos.y += 4;
                if (this.FloorCollision) {
                    this.handleFloorCollision();
                }
            }
        }
        doHitCrouching() {
            if (common_7.waitDuration(this.hitState.CrouchTimer, HitState.CrouchTime)) {
                this.hitState.CurrentStep = HitStateStep.None;
                if (this.Health <= 0) {
                    this.initDyingState();
                    gamecontroller_2.GameController._.BelmontDied();
                }
            }
        }
        doJump() {
            let originalPos = common_7.copyPoint(this.pos);
            this.pos.y += this.jumpState.JumpAni.stepValue();
            let dummy = { nextStepValue: 0 };
            this.jumpState.JumpAni.doAnimation(1, dummy);
            if (!this.jumpState.JumpAni.hasNext) {
                this.jumpState.Stop();
            }
            this.checkAndHandleWallAndCeilingCollisions(originalPos);
            originalPos = common_7.copyPoint(this.pos);
            if (this.jumpState.JumpDirection == direction_5.Direction.Right)
                this.pos.x += this.movementSpeed;
            if (this.jumpState.JumpDirection == direction_5.Direction.Left)
                this.pos.x -= this.movementSpeed;
            if (this.jumpState.GoingUp) {
                this.checkAndHandleWallAndCeilingCollisions(originalPos);
            }
            else {
                this.checkAndHandleCollisions(originalPos);
            }
        }
        doWalk() {
            if (this.currentWalkAnimationFrame == 0)
                this.currentWalkAnimationFrame = 1;
            this.AnimateMovement(1);
            if (!this.multipleDirButtonsPressed())
                this.firstPressedButton = this.Direction;
        }
        DetermineFrame() {
            switch (this.state) {
                case State.Normal:
                case State.HitRecovery:
                    if (this.hitState.CurrentStep != HitStateStep.None) {
                        if (this.hitState.CurrentStep == HitStateStep.Falling || this.hitState.CurrentStep == HitStateStep.Flying)
                            this.imgid = this.Direction == direction_5.Direction.Right ? resourceids_4.BitmapId.Belmont_rhitfly : resourceids_4.BitmapId.Belmont_lhitfly;
                        else
                            this.imgid = this.Direction == direction_5.Direction.Right ? resourceids_4.BitmapId.Belmont_rhitdown : resourceids_4.BitmapId.Belmont_lhitdown;
                    }
                    else if (!this.roeState.Roeing) {
                        if (!this.Crouching && !this.Jumping) {
                            this.imgid = this.CarryingShield ? Belmont.MovementSpritesWShield[this.Direction][this.currentWalkAnimationFrame] : Belmont.MovementSpritesNoShield[this.Direction][this.currentWalkAnimationFrame];
                        }
                        else {
                            this.imgid = this.CarryingShield ? Belmont.MovementSpritesWShieldCrouching[this.Direction][this.currentWalkAnimationFrame] : Belmont.MovementSpritesNoShieldCrouching[this.Direction][this.currentWalkAnimationFrame];
                        }
                    }
                    else {
                        if (!this.Crouching && !this.Jumping) {
                            this.imgid = RoeState.RoeSprites[this.Direction][this.roeState.CurrentFrame];
                        }
                        else {
                            this.imgid = RoeState.RoeSpritesCrouching[this.Direction][this.roeState.CurrentFrame];
                        }
                    }
                    break;
                case State.Dying:
                case State.Dead:
                    break;
            }
        }
        TakeDamage(amount) {
            if (!this.hittable)
                return;
            if (this.state != State.HitRecovery && this.state != State.Dying) {
                this.Health -= amount;
                this.initHitRecoveryState();
                if (this.jumpState.Jumping)
                    this.jumpState.Stop();
                if (this.Roeing) {
                    this.roeState.Stop();
                }
                soundmaster_1.SoundMaster.PlayEffect(resourcemaster_2.ResourceMaster.Sound[resourceids_4.AudioId.PlayerDamage]);
            }
        }
        doDeath() {
            let stepValue;
            if (this.dyingState.DeathAni.doAnimation(this.dyingState.aniTimer, stepValue)) {
                if (this.dyingState.DeathAni.finished()) {
                    gamecontroller_2.GameController._.BelmontDeathAniFinished();
                    this.dyingState.Stop();
                    this.state = State.Dead;
                }
                else {
                    this.imgid = stepValue.nextStepValue.image;
                }
            }
        }
        UseRoe() {
            if (!this.Roeing && this.state != State.Dying) {
                this.initRoeState();
            }
        }
        initHitRecoveryState() {
            this.state = State.HitRecovery;
            this.hitState.Start();
        }
        initDyingState() {
            this.dyingState.Start();
            this.state = State.Dying;
        }
        initRoeState() {
            this.roeState.Start();
            this.DetermineFrame();
        }
        handleInput(moved) {
            if (input_1.KeyState.KD_DOWN && !this.ignoreDirButtonPress(direction_5.Direction.Down)) {
                this.Crouching = true;
                if (input_1.KeyState.KD_RIGHT && !this.ignoreDirButtonPress(direction_5.Direction.Right))
                    this.Direction = direction_5.Direction.Right;
                if (input_1.KeyState.KD_LEFT && !this.ignoreDirButtonPress(direction_5.Direction.Left))
                    this.Direction = direction_5.Direction.Left;
            }
            else if (input_1.KeyState.KC_UP && !this.ignoreDirButtonPress(direction_5.Direction.Up)) {
                this.Crouching = false;
                let jumpDir = direction_5.Direction.Up;
                if (input_1.KeyState.KD_RIGHT) {
                    jumpDir = direction_5.Direction.Right;
                    this.Direction = direction_5.Direction.Right;
                }
                else if (input_1.KeyState.KD_LEFT) {
                    jumpDir = direction_5.Direction.Left;
                    this.Direction = direction_5.Direction.Left;
                }
                this.jumpState.Start(jumpDir);
            }
            else if (input_1.KeyState.KD_RIGHT && !this.ignoreDirButtonPress(direction_5.Direction.Right)) {
                this.Crouching = false;
                this.doMovement(direction_5.Direction.Right, moved);
            }
            else if (input_1.KeyState.KD_LEFT && !this.ignoreDirButtonPress(direction_5.Direction.Left)) {
                this.Crouching = false;
                this.doMovement(direction_5.Direction.Left, moved);
            }
            else {
                this.Crouching = false;
                this.firstPressedButton = direction_5.Direction.None;
            }
        }
        doMovement(dir, moved) {
            let speed = this.movementSpeed;
            let originalPos = common_7.copyPoint(this.pos);
            switch (dir) {
                case direction_5.Direction.Right:
                    this.pos.x += speed;
                    this.Direction = direction_5.Direction.Right;
                    break;
                case direction_5.Direction.Left:
                    this.pos.x -= speed;
                    this.Direction = direction_5.Direction.Left;
                    break;
            }
            this.checkAndHandleCollisions(originalPos);
            moved = true;
        }
        checkAndHandleWallAndCeilingCollisions(originalPos) {
            if (this.checkWallSpriteCollisions())
                common_7.setPoint(this.pos, originalPos.x, originalPos.y);
            if (this.checkWallCollision())
                this.handleWallCollision();
            if (this.CeilingCollision) {
                this.handleCeilingCollision();
            }
            let possibleRoomExit = this.nearRoomExit();
            if (possibleRoomExit && possibleRoomExit.destRoom != room_1.Room.NO_ROOM_EXIT) {
                gamecontroller_2.GameController._.HandleRoomExitViaMovement(possibleRoomExit.destRoom, possibleRoomExit.direction);
            }
        }
        checkAndHandleFloorCollisions(originalPos) {
            if (this.FloorCollision) {
                this.handleFloorCollision();
            }
            else
                this.checkAndHandleRoomExit();
        }
        checkAndHandleCollisions(originalPos) {
            this.checkAndHandleWallAndCeilingCollisions(originalPos);
            this.checkAndHandleFloorCollisions(originalPos);
        }
        checkAndHandleRoomExit() {
            let possibleRoomExit = this.nearRoomExit();
            if (possibleRoomExit && possibleRoomExit.destRoom != room_1.Room.NO_ROOM_EXIT) {
                gamecontroller_2.GameController._.HandleRoomExitViaMovement(possibleRoomExit.destRoom, possibleRoomExit.direction);
            }
        }
        checkWallCollision() {
            switch (this.Direction) {
                case direction_5.Direction.Right:
                    return sintervaniamodel_6.GameModel._.CurrentRoom.IsCollisionTile(this.pos.x + 16, this.pos.y + 25, true) || sintervaniamodel_6.GameModel._.CurrentRoom.IsCollisionTile(this.pos.x + 16, this.pos.y + 31, true);
                case direction_5.Direction.Left:
                    return sintervaniamodel_6.GameModel._.CurrentRoom.IsCollisionTile(this.pos.x, this.pos.y + 25, true) || sintervaniamodel_6.GameModel._.CurrentRoom.IsCollisionTile(this.pos.x, this.pos.y + 31, true);
                default:
                    return false;
            }
        }
        handleWallCollision() {
            switch (this.Direction) {
                case direction_5.Direction.Right:
                    this.pos.x = (this.pos.x / msx_5.TileSize) * msx_5.TileSize;
                    break;
                case direction_5.Direction.Down:
                    this.pos.y = (this.pos.y / msx_5.TileSize) * msx_5.TileSize;
                    break;
                case direction_5.Direction.Left:
                    if (this.pos.x >= 0)
                        this.pos.x = (this.pos.x / msx_5.TileSize + 1) * msx_5.TileSize;
                    this.pos.x = this.pos.x / msx_5.TileSize * msx_5.TileSize;
                    break;
            }
        }
        get CeilingCollision() {
            return sintervaniamodel_6.GameModel._.CurrentRoom.IsCollisionTile(this.pos.x + 1, this.pos.y + 8, true) || sintervaniamodel_6.GameModel._.CurrentRoom.IsCollisionTile(this.pos.x + 15, this.pos.y + 8, true);
        }
        get FloorCollision() {
            return sintervaniamodel_6.GameModel._.CurrentRoom.IsCollisionTile(this.pos.x + 1, this.pos.y + 32, true) || sintervaniamodel_6.GameModel._.CurrentRoom.IsCollisionTile(this.pos.x + 15, this.pos.y + 32, true);
        }
        handleFloorCollision() {
            this.pos.y = (this.pos.y / msx_5.TileSize) * msx_5.TileSize;
            if (this.Jumping) {
                this.jumpState.Stop();
            }
            if (this.hitState.CurrentStep == HitStateStep.Falling) {
                this.hitState.CurrentStep = HitStateStep.Crouching;
                this.hitState.CrouchTimer.restart();
            }
        }
        handleCeilingCollision() {
            if (this.pos.y >= 0)
                this.pos.y = (this.pos.y / msx_5.TileSize + 1) * msx_5.TileSize;
            else
                this.pos.y = (this.pos.y / msx_5.TileSize) * msx_5.TileSize;
            this.jumpState.GoingUp = false;
        }
        nearRoomExit() {
            let exitUp = sintervaniamodel_6.GameModel._.CurrentRoom.NearingRoomExit(this.pos.x + 1, this.pos.y + 8);
            if (exitUp != null)
                return exitUp;
            let exitRight = sintervaniamodel_6.GameModel._.CurrentRoom.NearingRoomExit(this.pos.x + 16, this.pos.y + 25);
            if (exitRight != null)
                return exitRight;
            let exitDown = sintervaniamodel_6.GameModel._.CurrentRoom.NearingRoomExit(this.pos.x + 1, this.pos.y + 32);
            if (exitDown != null)
                return exitDown;
            let exitLeft = sintervaniamodel_6.GameModel._.CurrentRoom.NearingRoomExit(this.pos.x, this.pos.y + 25);
            if (exitLeft != null)
                return exitLeft;
            return null;
        }
        ignoreDirButtonPress(dir) {
            return this.multipleDirButtonsPressed() && dir == this.firstPressedButton;
        }
        multipleDirButtonsPressed() {
            let u = input_1.KeyState.KD_UP ? 1 : 0;
            let r = input_1.KeyState.KD_RIGHT ? 1 : 0;
            let d = input_1.KeyState.KD_DOWN ? 1 : 0;
            let l = input_1.KeyState.KD_LEFT ? 1 : 0;
            return u + r + d + l > 1;
        }
        Paint(offset = null) {
            let roeOffset = { x: 0, y: 0 };
            if (this.Roeing) {
                if (!this.Crouching) {
                    roeOffset.x += RoeState.RoeSpritePosOffset[this.Direction][this.roeState.CurrentFrame].x;
                    roeOffset.y += RoeState.RoeSpritePosOffset[this.Direction][this.roeState.CurrentFrame].y;
                }
                else {
                    roeOffset.x += RoeState.RoeSpritePosOffsetCrouching[this.Direction][this.roeState.CurrentFrame].x;
                    roeOffset.y += RoeState.RoeSpritePosOffsetCrouching[this.Direction][this.roeState.CurrentFrame].y;
                }
            }
            if (!this.hitState.Blink || gamecontroller_2.GameController._.InEventState) {
                let options = this.flippedH ? view_1.DrawBitmap.HFLIP : 0;
                if (offset == null)
                    engine_8.view.DrawBitmap(this.imgid, this.pos.x + roeOffset.x, this.pos.y + roeOffset.y, options);
                else
                    engine_8.view.DrawBitmap(this.imgid, this.pos.x + roeOffset.x + offset.x, this.pos.y + roeOffset.y + offset.y, options);
            }
            else {
                if (this.disposeFlag || !this.visible)
                    return;
                let options = this.flippedH ? view_1.DrawBitmap.HFLIP : 0;
                if (offset == null)
                    engine_8.view.DrawColoredBitmap(this.imgid, this.pos.x + roeOffset.x, this.pos.y + roeOffset.y, options, 50.0, .0, .0);
                else
                    engine_8.view.DrawColoredBitmap(this.imgid, this.pos.x + roeOffset.x + offset.x, this.pos.y + roeOffset.y + offset.y, options, 50.0, .0, .0);
            }
        }
        Dispose() {
            btimer_3.BStopwatch.removeWatch(this.hitState.BlinkTimer);
            btimer_3.BStopwatch.removeWatch(this.hitState.RecoveryTimer);
            btimer_3.BStopwatch.removeWatch(this.dyingState.aniTimer);
            btimer_3.BStopwatch.removeWatch(this.roeState.aniTimer);
        }
    }
    exports.Belmont = Belmont;
    Belmont.MoveBeforeFrameChange = 4;
    Belmont.MovementSpritesNoShield = new Map([
        [direction_5.Direction.Right, [resourceids_4.BitmapId.Belmont_r1, resourceids_4.BitmapId.Belmont_r3, resourceids_4.BitmapId.Belmont_r2, resourceids_4.BitmapId.Belmont_r3, resourceids_4.BitmapId.Belmont_r1]],
        [direction_5.Direction.Left, [resourceids_4.BitmapId.Belmont_l1, resourceids_4.BitmapId.Belmont_l3, resourceids_4.BitmapId.Belmont_l2, resourceids_4.BitmapId.Belmont_l3, resourceids_4.BitmapId.Belmont_l1]],
    ]);
    Belmont.MovementSpritesNoShieldCrouching = new Map([
        [direction_5.Direction.Right, [resourceids_4.BitmapId.Belmont_rd, resourceids_4.BitmapId.Belmont_rd, resourceids_4.BitmapId.Belmont_rd]],
        [direction_5.Direction.Left, [resourceids_4.BitmapId.Belmont_ld, resourceids_4.BitmapId.Belmont_ld, resourceids_4.BitmapId.Belmont_ld]]
    ]);
    Belmont.MovementSpritesWShieldCrouching = new Map([
        [direction_5.Direction.Right, [resourceids_4.BitmapId.Belmont_rd, resourceids_4.BitmapId.Belmont_rd, resourceids_4.BitmapId.Belmont_rd]],
        [direction_5.Direction.Left, [resourceids_4.BitmapId.Belmont_ld, resourceids_4.BitmapId.Belmont_ld, resourceids_4.BitmapId.Belmont_ld]],
    ]);
    Belmont.MovementSpritesHit = new Map([
        [direction_5.Direction.Right, [resourceids_4.BitmapId.Belmont_rhitfly, resourceids_4.BitmapId.Belmont_rhitdown]],
        [direction_5.Direction.Left, [resourceids_4.BitmapId.Belmont_lhitfly, resourceids_4.BitmapId.Belmont_lhitdown]],
    ]);
    Belmont.MovementSpritesWShield = new Map([]);
    Belmont.buttonPressEventHitAreaUp = common_7.newArea(0, 20, 16, 28);
    Belmont.buttonPressEventHitAreaRight = common_7.newArea(4, 24, 20, 32);
    Belmont.buttonPressEventHitAreaDown = common_7.newArea(0, 28, 16, 36);
    Belmont.buttonPressEventHitAreaLeft = common_7.newArea(-4, 24, 12, 32);
    Belmont._hitarea = common_7.newArea(2, 8, 14, 30);
    var State;
    (function (State) {
        State[State["Normal"] = 0] = "Normal";
        State[State["HitRecovery"] = 1] = "HitRecovery";
        State[State["Dying"] = 2] = "Dying";
        State[State["Dead"] = 3] = "Dead";
    })(State = exports.State || (exports.State = {}));
    class JumpState {
        constructor() {
            this.JumpTimer = new btimer_3.BStopwatch();
            this.Jumping = false;
            this.GoingUp = false;
            this.JumpAni = new animation_1.Animation(JumpState.jumpYDelta, 1, false);
        }
        get JumpHeightReached() {
            return this.JumpAni.stepValue() >= 0;
        }
        Stop() {
            this.JumpTimer.stop();
            this.Jumping = false;
            this.GoingUp = false;
        }
        Start(jumpDir) {
            this.JumpTimer.restart();
            this.Jumping = true;
            this.GoingUp = true;
            this.JumpDirection = jumpDir;
            this.JumpAni.restart();
        }
    }
    exports.JumpState = JumpState;
    JumpState.jumpYDelta = [0, -8, -4, -4, -4, -4, -4, -4, -4, -2, -2, -1, -1, 0, 0, 0, 0, 1, 1, 2, 2, 4, 4, 4, 4, 4, 4, 4, 8, 0];
    class HitState {
        constructor() {
            this.Blink = false;
            this.BlinkingAndInvulnerable = false;
            this.CurrentStep = HitStateStep.None;
            this.HitAni = new animation_1.Animation(HitState.hitDelta, 1);
        }
        Stop() {
            this.BlinkTimer.stop();
            this.RecoveryTimer.stop();
            this.CrouchTimer.stop();
            this.Blink = false;
            this.BlinkingAndInvulnerable = false;
            this.CurrentStep = HitStateStep.None;
        }
        Start() {
            this.Blink = true;
            this.BlinkingAndInvulnerable = true;
            this.CurrentStep = HitStateStep.Flying;
            this.BlinkTimer.restart();
            this.RecoveryTimer.restart();
            this.CrouchTimer.reset();
            this.HitAni.restart();
        }
    }
    exports.HitState = HitState;
    HitState.TotalBlinkTime = 2000;
    HitState.BlinkTimePerSwitch = 20;
    HitState.CrouchTime = 500;
    HitState.hitDelta = new Array(common_8.newPoint(-2, -2), common_8.newPoint(-2, -2), common_8.newPoint(-2, -2), common_8.newPoint(-2, -2), common_8.newPoint(-2, -2), common_8.newPoint(-2, -2), common_8.newPoint(-1, -1), common_8.newPoint(-1, -1), common_8.newPoint(-1, -1), common_8.newPoint(-1, -1), common_8.newPoint(-1, 0), common_8.newPoint(-1, 0), common_8.newPoint(-1, 0), common_8.newPoint(-1, 0), common_8.newPoint(-2, 1), common_8.newPoint(-2, 1), common_8.newPoint(-2, 1), common_8.newPoint(-2, 1));
    var HitStateStep;
    (function (HitStateStep) {
        HitStateStep[HitStateStep["None"] = 0] = "None";
        HitStateStep[HitStateStep["Flying"] = 1] = "Flying";
        HitStateStep[HitStateStep["Falling"] = 2] = "Falling";
        HitStateStep[HitStateStep["Crouching"] = 3] = "Crouching";
    })(HitStateStep = exports.HitStateStep || (exports.HitStateStep = {}));
    class DyingState {
        constructor() {
            this.DeathAni = new animation_1.Animation(DyingState.dyingFrames, DyingState.dyingFrameTimes);
        }
        Start() {
            this.aniTimer.restart();
            this.DeathAni.restart();
        }
        Stop() {
            this.aniTimer.stop();
        }
    }
    exports.DyingState = DyingState;
    DyingState.MsPerFrame = 300;
    DyingState.dyingFrames = new Array({ image: resourceids_4.BitmapId.Belmont_rhitdown, dir: direction_5.Direction.Right }, { image: resourceids_4.BitmapId.Belmont_rdead, dir: direction_5.Direction.Right });
    DyingState.dyingFrameTimes = [100, 2000];
});
define("src/triroe", ["require", "exports", "src/pprojectile", "src/belmont", "src/sintervaniamodel", "resourceids", "BoazEngineJS/common"], function (require, exports, pprojectile_1, belmont_1, sintervaniamodel_7, resourceids_5, common_9) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    class TriRoe extends pprojectile_1.PlayerProjectile {
        constructor(pos, dir) {
            super({ x: pos.x, y: pos.y }, { x: 0, y: 0 });
            this.Direction = dir;
            this.pos = sintervaniamodel_7.GameModel._.Belmont.pos;
        }
        get hitarea() {
            if (!sintervaniamodel_7.GameModel._.Belmont.roeState.Roeing || sintervaniamodel_7.GameModel._.Belmont.RecoveringFromHit)
                return null;
            if (!sintervaniamodel_7.GameModel._.Belmont.Crouching)
                return TriRoe.hitareas[sintervaniamodel_7.GameModel._.Belmont.imgid] + belmont_1.RoeState.RoeSpritePosOffset[sintervaniamodel_7.GameModel._.Belmont.Direction][sintervaniamodel_7.GameModel._.Belmont.roeState.CurrentFrame];
            return TriRoe.hitareas[sintervaniamodel_7.GameModel._.Belmont.imgid] + belmont_1.RoeState.RoeSpritePosOffsetCrouching[sintervaniamodel_7.GameModel._.Belmont.Direction][sintervaniamodel_7.GameModel._.Belmont.roeState.CurrentFrame];
        }
        set hitarea(value) {
        }
        get DamageDealt() {
            return 1;
        }
        TakeTurn() {
            if (sintervaniamodel_7.GameModel._.Belmont.Dying || !sintervaniamodel_7.GameModel._.Belmont.roeState.Roeing) {
                this.disposeFlag = true;
                return;
            }
            this.pos = sintervaniamodel_7.GameModel._.Belmont.pos;
            this.CheckAndInvokeHit();
        }
        Paint(offset = null) {
        }
        Dispose() {
        }
    }
    exports.TriRoe = TriRoe;
    TriRoe.hitareas = new Map([
        [resourceids_5.BitmapId.Belmont_rw1, common_9.newArea(0, 9, 7, 26)],
        [resourceids_5.BitmapId.Belmont_rw2, common_9.newArea(0, 6, 15, 16)],
        [resourceids_5.BitmapId.Belmont_rw3, common_9.newArea(20, 8, 41, 16)],
        [resourceids_5.BitmapId.Belmont_rwd1, common_9.newArea(0, 15, 7, 32)],
        [resourceids_5.BitmapId.Belmont_rwd2, common_9.newArea(0, 12, 15, 22)],
        [resourceids_5.BitmapId.Belmont_rwd3, common_9.newArea(20, 14, 41, 22)],
        [resourceids_5.BitmapId.Belmont_lw1, common_9.newArea(24, 9, 31, 26)],
        [resourceids_5.BitmapId.Belmont_lw2, common_9.newArea(17, 6, 31, 16)],
        [resourceids_5.BitmapId.Belmont_lw3, common_9.newArea(0, 8, 19, 16)],
        [resourceids_5.BitmapId.Belmont_lwd1, common_9.newArea(24, 15, 31, 32)],
        [resourceids_5.BitmapId.Belmont_lwd2, common_9.newArea(17, 12, 31, 22)],
        [resourceids_5.BitmapId.Belmont_lwd3, common_9.newArea(0, 14, 19, 22)],
    ]);
});
define("src/weaponfirehandler", ["require", "exports", "src/sintervaniamodel", "src/triroe", "BoazEngineJS/soundmaster", "src/resourcemaster", "resourceids", "BoazEngineJS/common"], function (require, exports, sintervaniamodel_8, triroe_1, soundmaster_2, resourcemaster_3, resourceids_6, common_10) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    class WeaponFireHandler {
        static get mainWeaponCurrentCooldown() {
            return WeaponFireHandler._mainWeaponCurrentCooldown;
        }
        static set mainWeaponCurrentCooldown(value) {
            if (value > WeaponFireHandler._mainWeaponCurrentCooldown || !sintervaniamodel_8.GameModel._.MainWeaponCooldownTimer.running)
                WeaponFireHandler._mainWeaponCurrentCooldown = value;
        }
        static get MainWeaponOnCooldown() {
            if (sintervaniamodel_8.GameModel._.MainWeaponCooldownTimer.running) {
                if (common_10.waitDuration(sintervaniamodel_8.GameModel._.MainWeaponCooldownTimer, WeaponFireHandler.mainWeaponCurrentCooldown)) {
                    sintervaniamodel_8.GameModel._.MainWeaponCooldownTimer.stop();
                    return false;
                }
                return true;
            }
            return false;
        }
        static get secWeaponCurrentCooldown() {
            return WeaponFireHandler._secWeaponCurrentCooldown;
        }
        static set secWeaponCurrentCooldown(value) {
            if (value > WeaponFireHandler._secWeaponCurrentCooldown || !sintervaniamodel_8.GameModel._.SecWeaponCooldownTimer.running)
                WeaponFireHandler._secWeaponCurrentCooldown = value;
        }
        static get SecWeaponOnCooldown() {
            if (sintervaniamodel_8.GameModel._.SecWeaponCooldownTimer.running) {
                if (common_10.waitDuration(sintervaniamodel_8.GameModel._.SecWeaponCooldownTimer, WeaponFireHandler.secWeaponCurrentCooldown)) {
                    sintervaniamodel_8.GameModel._.SecWeaponCooldownTimer.stop();
                    return false;
                }
                return true;
            }
            return false;
        }
        static HandleFireMainWeapon() {
            if (WeaponFireHandler.MainWeaponOnCooldown)
                return;
            switch (sintervaniamodel_8.GameModel._.SelectedMainWeapon) {
                case sintervaniamodel_8.MainWeaponType.TriRoe:
                    WeaponFireHandler.handleTriRoe();
                    break;
            }
        }
        static setMainWeaponCooldown(cooldown) {
            sintervaniamodel_8.GameModel._.MainWeaponCooldownTimer.restart();
            WeaponFireHandler.mainWeaponCurrentCooldown = cooldown;
        }
        static setSecWeaponCooldown(cooldown) {
            sintervaniamodel_8.GameModel._.SecWeaponCooldownTimer.restart();
            WeaponFireHandler.secWeaponCurrentCooldown = cooldown;
        }
        static handleTriRoe() {
            if (sintervaniamodel_8.GameModel._.Belmont.Roeing || sintervaniamodel_8.GameModel._.Belmont.RecoveringFromHit)
                return;
            WeaponFireHandler.setMainWeaponCooldown(0);
            let roe = new triroe_1.TriRoe(sintervaniamodel_8.GameModel._.Belmont.pos, sintervaniamodel_8.GameModel._.Belmont.Direction);
            sintervaniamodel_8.GameModel._.spawn(roe);
            sintervaniamodel_8.GameModel._.Belmont.UseRoe();
            soundmaster_2.SoundMaster.PlayEffect(resourcemaster_3.ResourceMaster.Sound[resourceids_6.AudioId.Whip]);
        }
        static handleFireCross() {
            WeaponFireHandler.setSecWeaponCooldown(WeaponFireHandler.msCrossCooldown);
        }
        static HandleFireSecondaryWeapon() {
            if (WeaponFireHandler.SecWeaponOnCooldown)
                return;
            if (sintervaniamodel_8.GameModel._.Hearts > 0) {
                return;
            }
            switch (sintervaniamodel_8.GameModel._.SelectedSecondaryWeapon) {
                case sintervaniamodel_8.SecWeaponType.Cross:
                    WeaponFireHandler.handleFireCross();
                    break;
            }
        }
    }
    exports.WeaponFireHandler = WeaponFireHandler;
    WeaponFireHandler.msCrossCooldown = 500;
    WeaponFireHandler.msTriRoeCooldown = 1000;
});
define("src/gameoptions", ["require", "exports", "src/gameconstants", "BoazEngineJS/msx"], function (require, exports, gameconstants_3, msx_6) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    class GameOptions {
        constructor() {
            this.Scale = gameconstants_3.GameConstants.InitialScale;
            this.Fullscreen = gameconstants_3.GameConstants.InitialFullscreen;
            this.EffectsVolumePercentage = 100;
            this.MusicVolumePercentage = 100;
        }
        static get _() {
            return GameOptions._instance != null ? GameOptions._instance : (GameOptions._instance = new GameOptions());
        }
        static set _(value) {
            GameOptions._instance = value;
        }
        get WindowWidth() {
            return (msx_6.MSXConstants.MSX2ScreenWidth * GameOptions._.Scale);
        }
        get WindowHeight() {
            return (msx_6.MSXConstants.MSX2ScreenHeight * GameOptions._.Scale);
        }
        get BufferWidth() {
            return (msx_6.MSXConstants.MSX2ScreenWidth * GameOptions._.Scale);
        }
        get BufferHeight() {
            return (msx_6.MSXConstants.MSX2ScreenHeight * GameOptions._.Scale);
        }
    }
    exports.GameOptions = GameOptions;
});
define("src/textwriter", ["require", "exports", "BoazEngineJS/engine", "resourceids", "src/gameoptions"], function (require, exports, engine_9, resourceids_7, gameoptions_1) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    var TextWriterType;
    (function (TextWriterType) {
        TextWriterType[TextWriterType["Billboard"] = 0] = "Billboard";
        TextWriterType[TextWriterType["Story"] = 1] = "Story";
    })(TextWriterType = exports.TextWriterType || (exports.TextWriterType = {}));
    class TextWriter {
        constructor(pos, end, type) {
            this.Type = type;
            this.Pos = pos;
            this.End = end;
            this.Text = new Array();
            this.visible = false;
        }
        SetText(text) {
            this.Text.length = 0;
            this.Text.push(text);
        }
        AddText(text) {
            this.Text.push(...text);
        }
        TakeTurn() {
            switch (this.Type) {
                case TextWriterType.Billboard:
                    break;
                case TextWriterType.Story:
                    {
                    }
                    break;
            }
        }
        static DrawText(x, y, textToWrite, color = null) {
            let startPos = { x: x, y: y };
            let stepX = TextWriter.FontWidth;
            let stepY = TextWriter.FontHeight;
            let pos = { x: startPos.x, y: startPos.y };
            let letter;
            for (let text of textToWrite) {
                for (let i = 0; i < text.length; i++) {
                    let c = text[i];
                    letter = TextWriter.getBitmapForLetter(c);
                    if (!color)
                        engine_9.view.DrawBitmap(letter, pos.x, pos.y);
                    else
                        engine_9.view.DrawColoredBitmap(letter, pos.x, pos.y, color.r / 255.0, color.g / 255.0, color.b / 255.0);
                    pos.x += stepX;
                }
                pos.x = startPos.x;
                pos.y += stepY;
                if (pos.y >= gameoptions_1.GameOptions._.BufferHeight)
                    break;
            }
            ;
        }
        Paint() {
            if (!this.visible)
                return;
            if (this.Text.length == 0)
                return;
            let startPos = { x: this.Pos.x, y: this.Pos.y };
            let stepX = TextWriter.FontWidth;
            let stepY = TextWriter.FontHeight;
            let pos = { x: startPos.x, y: startPos.y };
            let letter;
            for (let text of this.Text) {
                for (let c of text) {
                    if (pos.y < -TextWriter.FontHeight)
                        break;
                    letter = TextWriter.getBitmapForLetter(c);
                    engine_9.view.DrawBitmap(letter, pos.x, pos.y);
                    pos.x += stepX;
                }
                ;
                pos.x = startPos.x;
                pos.y += stepY;
                if (pos.y >= gameoptions_1.GameOptions._.BufferHeight)
                    break;
            }
            ;
        }
        static getBitmapForLetter(c) {
            let letter;
            switch (c) {
                case '0':
                    letter = resourceids_7.BitmapId.Font_0;
                    break;
                case '1':
                    letter = resourceids_7.BitmapId.Font_1;
                    break;
                case '2':
                    letter = resourceids_7.BitmapId.Font_2;
                    break;
                case '3':
                    letter = resourceids_7.BitmapId.Font_3;
                    break;
                case '4':
                    letter = resourceids_7.BitmapId.Font_4;
                    break;
                case '5':
                    letter = resourceids_7.BitmapId.Font_5;
                    break;
                case '6':
                    letter = resourceids_7.BitmapId.Font_6;
                    break;
                case '7':
                    letter = resourceids_7.BitmapId.Font_7;
                    break;
                case '8':
                    letter = resourceids_7.BitmapId.Font_8;
                    break;
                case '9':
                    letter = resourceids_7.BitmapId.Font_9;
                    break;
                case 'a':
                    letter = resourceids_7.BitmapId.Font_A;
                    break;
                case 'b':
                    letter = resourceids_7.BitmapId.Font_B;
                    break;
                case 'c':
                    letter = resourceids_7.BitmapId.Font_C;
                    break;
                case 'd':
                    letter = resourceids_7.BitmapId.Font_D;
                    break;
                case 'e':
                    letter = resourceids_7.BitmapId.Font_E;
                    break;
                case 'f':
                    letter = resourceids_7.BitmapId.Font_F;
                    break;
                case 'g':
                    letter = resourceids_7.BitmapId.Font_G;
                    break;
                case 'h':
                    letter = resourceids_7.BitmapId.Font_H;
                    break;
                case 'i':
                    letter = resourceids_7.BitmapId.Font_I;
                    break;
                case 'j':
                    letter = resourceids_7.BitmapId.Font_J;
                    break;
                case 'k':
                    letter = resourceids_7.BitmapId.Font_K;
                    break;
                case 'l':
                    letter = resourceids_7.BitmapId.Font_L;
                    break;
                case 'm':
                    letter = resourceids_7.BitmapId.Font_M;
                    break;
                case 'n':
                    letter = resourceids_7.BitmapId.Font_N;
                    break;
                case 'o':
                    letter = resourceids_7.BitmapId.Font_O;
                    break;
                case 'p':
                    letter = resourceids_7.BitmapId.Font_P;
                    break;
                case 'q':
                    letter = resourceids_7.BitmapId.Font_Q;
                    break;
                case 'r':
                    letter = resourceids_7.BitmapId.Font_R;
                    break;
                case 's':
                    letter = resourceids_7.BitmapId.Font_S;
                    break;
                case 't':
                    letter = resourceids_7.BitmapId.Font_T;
                    break;
                case 'u':
                    letter = resourceids_7.BitmapId.Font_U;
                    break;
                case 'v':
                    letter = resourceids_7.BitmapId.Font_V;
                    break;
                case 'w':
                    letter = resourceids_7.BitmapId.Font_W;
                    break;
                case 'x':
                    letter = resourceids_7.BitmapId.Font_X;
                    break;
                case 'y':
                    letter = resourceids_7.BitmapId.Font_Y;
                    break;
                case 'z':
                    letter = resourceids_7.BitmapId.Font_Z;
                    break;
                case 'A':
                    letter = resourceids_7.BitmapId.Font_A;
                    break;
                case 'B':
                    letter = resourceids_7.BitmapId.Font_B;
                    break;
                case 'C':
                    letter = resourceids_7.BitmapId.Font_C;
                    break;
                case 'D':
                    letter = resourceids_7.BitmapId.Font_D;
                    break;
                case 'E':
                    letter = resourceids_7.BitmapId.Font_E;
                    break;
                case 'F':
                    letter = resourceids_7.BitmapId.Font_F;
                    break;
                case 'G':
                    letter = resourceids_7.BitmapId.Font_G;
                    break;
                case 'H':
                    letter = resourceids_7.BitmapId.Font_H;
                    break;
                case 'I':
                    letter = resourceids_7.BitmapId.Font_I;
                    break;
                case 'J':
                    letter = resourceids_7.BitmapId.Font_J;
                    break;
                case 'K':
                    letter = resourceids_7.BitmapId.Font_K;
                    break;
                case 'L':
                    letter = resourceids_7.BitmapId.Font_L;
                    break;
                case 'M':
                    letter = resourceids_7.BitmapId.Font_M;
                    break;
                case 'N':
                    letter = resourceids_7.BitmapId.Font_N;
                    break;
                case 'O':
                    letter = resourceids_7.BitmapId.Font_O;
                    break;
                case 'P':
                    letter = resourceids_7.BitmapId.Font_P;
                    break;
                case 'Q':
                    letter = resourceids_7.BitmapId.Font_Q;
                    break;
                case 'R':
                    letter = resourceids_7.BitmapId.Font_R;
                    break;
                case 'S':
                    letter = resourceids_7.BitmapId.Font_S;
                    break;
                case 'T':
                    letter = resourceids_7.BitmapId.Font_T;
                    break;
                case 'U':
                    letter = resourceids_7.BitmapId.Font_U;
                    break;
                case 'V':
                    letter = resourceids_7.BitmapId.Font_V;
                    break;
                case 'W':
                    letter = resourceids_7.BitmapId.Font_W;
                    break;
                case 'X':
                    letter = resourceids_7.BitmapId.Font_X;
                    break;
                case '¡':
                    letter = resourceids_7.BitmapId.Font_IJ;
                    break;
                case 'Y':
                    letter = resourceids_7.BitmapId.Font_Y;
                    break;
                case 'Z':
                    letter = resourceids_7.BitmapId.Font_Z;
                    break;
                case ',':
                    letter = resourceids_7.BitmapId.Font_Comma;
                    break;
                case '.':
                    letter = resourceids_7.BitmapId.Font_Dot;
                    break;
                case '!':
                    letter = resourceids_7.BitmapId.Font_Exclamation;
                    break;
                case '?':
                    letter = resourceids_7.BitmapId.Font_QuestionMark;
                    break;
                case '\'':
                    letter = resourceids_7.BitmapId.Font_Apostroph;
                    break;
                case ' ':
                    letter = resourceids_7.BitmapId.Font_Space;
                    break;
                case ':':
                    letter = resourceids_7.BitmapId.Font_Colon;
                    break;
                case '-':
                    letter = resourceids_7.BitmapId.Font_Streep;
                    break;
                case '/':
                    letter = resourceids_7.BitmapId.Font_Slash;
                    break;
                case '%':
                    letter = resourceids_7.BitmapId.Font_Percent;
                    break;
                case '[':
                    letter = resourceids_7.BitmapId.Font_SpeakStart;
                    break;
                case ']':
                    letter = resourceids_7.BitmapId.Font_SpeakEnd;
                    break;
                default:
                    letter = resourceids_7.BitmapId.Font_QuestionMark;
                    break;
            }
            return letter;
        }
    }
    exports.TextWriter = TextWriter;
    TextWriter.FontWidth = 8;
    TextWriter.FontHeight = 8;
});
define("BoazEngineJS/gamesaver", ["require", "exports", "BoazEngineJS/constants", "BoazEngineJS/gamestateloader"], function (require, exports, constants_5, gamestateloader_1) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    var GameSaver;
    (function (GameSaver) {
        function saveGame(m, slot) {
            throw "Not implemented yet :(";
        }
        GameSaver.saveGame = saveGame;
        function GetCheckpoint(m) {
            saveGame(m, constants_5.Constants.SaveSlotCheckpoint);
            return gamestateloader_1.LoadGame(constants_5.Constants.SaveSlotCheckpoint);
        }
        GameSaver.GetCheckpoint = GetCheckpoint;
    })(GameSaver = exports.GameSaver || (exports.GameSaver = {}));
});
define("BoazEngineJS/gamestateloader", ["require", "exports", "BoazEngineJS/constants", "BoazEngineJS/gamesaver"], function (require, exports, constants_6, gamesaver_1) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    function LoadGame(slot) {
        throw "Not implemented yet :(";
    }
    exports.LoadGame = LoadGame;
    function SlotExists(slot) {
        let file = GetSavepath(slot);
        throw "Not implemented yet :(";
    }
    exports.SlotExists = SlotExists;
    function GetCheckpoint(m) {
        gamesaver_1.GameSaver.saveGame(m, constants_6.Constants.SaveSlotCheckpoint);
        return LoadGame(constants_6.Constants.SaveSlotCheckpoint);
    }
    exports.GetCheckpoint = GetCheckpoint;
    function GetSavepath(slot) {
        return slot !== constants_6.Constants.SaveSlotCheckpoint ? `${constants_6.Constants.SaveGamePath}${slot}` : constants_6.Constants.CheckpointGamePath;
    }
    exports.GetSavepath = GetSavepath;
});
define("src/mainmenu", ["require", "exports", "src/sintervaniamodel", "src/resourcemaster", "BoazEngineJS/soundmaster", "BoazEngineJS/direction", "src/sintervaniamodel", "src/gamecontroller", "src/textwriter", "BoazEngineJS/engine", "BoazEngineJS/msx", "BoazEngineJS/constants", "BoazEngineJS/input", "BoazEngineJS/gamestateloader", "BoazEngineJS/model", "resourceids"], function (require, exports, sintervaniamodel_9, resourcemaster_4, soundmaster_3, direction_6, sintervaniamodel_10, gamecontroller_3, textwriter_1, engine_10, msx_7, constants_7, input_2, gamestateloader_2, model_2, resourceids_8) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    var State;
    (function (State) {
        State[State["SelectMain"] = 0] = "SelectMain";
        State[State["SubMenu"] = 1] = "SubMenu";
        State[State["SelectChapter"] = 2] = "SelectChapter";
    })(State = exports.State || (exports.State = {}));
    var MenuItem;
    (function (MenuItem) {
        MenuItem[MenuItem["NewGame"] = 0] = "NewGame";
        MenuItem[MenuItem["Continue"] = 1] = "Continue";
        MenuItem[MenuItem["LoadGame"] = 2] = "LoadGame";
        MenuItem[MenuItem["Options"] = 3] = "Options";
        MenuItem[MenuItem["ToMainMenu"] = 4] = "ToMainMenu";
        MenuItem[MenuItem["Prologue"] = 5] = "Prologue";
        MenuItem[MenuItem["Chapter0"] = 6] = "Chapter0";
        MenuItem[MenuItem["Chapter1"] = 7] = "Chapter1";
        MenuItem[MenuItem["Debug"] = 8] = "Debug";
    })(MenuItem = exports.MenuItem || (exports.MenuItem = {}));
    class MainMenu {
        constructor() {
        }
        get cursorX() {
            return MainMenu.cursorPosX;
        }
        get cursorY() {
            return MainMenu.itemYs[this.selectedIndex];
        }
        get selectedItem() {
            switch (this.state) {
                case State.SelectMain:
                    return MainMenu.menuOptions[this.selectedIndex];
                case State.SelectChapter:
                    return MainMenu.chapterOptions[this.selectedIndex];
                default:
                    return MenuItem.ToMainMenu;
            }
        }
        Init() {
            this.reset();
        }
        reset() {
            this.selectedIndex = 0;
            this.state = State.SelectMain;
        }
        HandleInput() {
            let selectionChanged = false;
            if (input_2.KeyState.KC_UP)
                this.changeSelection(direction_6.Direction.Up, selectionChanged);
            else if (input_2.KeyState.KC_RIGHT)
                this.changeSelection(direction_6.Direction.Right, selectionChanged);
            else if (input_2.KeyState.KC_DOWN)
                this.changeSelection(direction_6.Direction.Down, selectionChanged);
            else if (input_2.KeyState.KC_LEFT)
                this.changeSelection(direction_6.Direction.Left, selectionChanged);
            if (selectionChanged)
                soundmaster_3.SoundMaster.PlayEffect(resourcemaster_4.ResourceMaster.Sound[resourceids_8.AudioId.Selectie]);
            if (input_2.KeyState.KC_SPACE) {
                switch (this.state) {
                    case State.SelectMain:
                        soundmaster_3.SoundMaster.PlayEffect(resourcemaster_4.ResourceMaster.Sound[resourceids_8.AudioId.Selectie]);
                        switch (this.selectedItem) {
                            case MenuItem.NewGame:
                                this.state = State.SelectChapter;
                                this.selectedIndex = 0;
                                break;
                            case MenuItem.Continue:
                                if (gamestateloader_2.SlotExists(constants_7.Constants.SaveSlotCheckpoint))
                                    gamecontroller_3.GameController._.LoadCheckpoint();
                                else
                                    soundmaster_3.SoundMaster.PlayEffect(resourcemaster_4.ResourceMaster.Sound[resourceids_8.AudioId.Fout]);
                                break;
                            case MenuItem.LoadGame:
                                input_2.KeyState.KC_SPACE = false;
                                sintervaniamodel_10.GameModel._.GameMenu.Open(MenuItem.LoadFromMainMenu);
                                this.state = State.SubMenu;
                                break;
                            case MenuItem.Options:
                                input_2.KeyState.KC_SPACE = false;
                                sintervaniamodel_10.GameModel._.GameMenu.Open(MenuItem.OptionsFromMainMenu);
                                this.state = State.SubMenu;
                                break;
                        }
                        break;
                    case State.SelectChapter:
                        soundmaster_3.SoundMaster.PlayEffect(resourcemaster_4.ResourceMaster.Sound[resourceids_8.AudioId.Selectie]);
                        switch (this.selectedItem) {
                            case MenuItem.Debug:
                                sintervaniamodel_10.GameModel._.SelectedChapterToPlay = sintervaniamodel_9.Chapter.Debug;
                                gamecontroller_3.GameController._.SwitchToState(model_2.GameState.Game);
                                break;
                            case MenuItem.Prologue:
                                sintervaniamodel_10.GameModel._.SelectedChapterToPlay = sintervaniamodel_9.Chapter.Prologue;
                                gamecontroller_3.GameController._.SwitchToState(model_2.GameState.GameStart1);
                                break;
                            case MenuItem.Chapter0:
                                sintervaniamodel_10.GameModel._.SelectedChapterToPlay = sintervaniamodel_9.Chapter.Chapter_0;
                                gamecontroller_3.GameController._.SwitchToState(model_2.GameState.GameStart1);
                                break;
                            case MenuItem.Chapter1:
                                sintervaniamodel_10.GameModel._.SelectedChapterToPlay = sintervaniamodel_9.Chapter.GameStart;
                                gamecontroller_3.GameController._.SwitchToState(model_2.GameState.GameStart1);
                                break;
                            case MenuItem.ToMainMenu:
                                this.state = State.SelectMain;
                                this.selectedIndex = 0;
                                break;
                        }
                        break;
                    case State.SubMenu:
                        break;
                }
            }
        }
        changeSelection(dir, selectionChanged) {
            if (this.state == State.SubMenu)
                return;
            let currentItems;
            switch (this.state) {
                case State.SelectMain:
                default:
                    currentItems = MainMenu.items;
                    break;
                case State.SelectChapter:
                    currentItems = MainMenu.chapterItems;
                    break;
            }
            switch (dir) {
                case direction_6.Direction.Up:
                    if (this.selectedIndex > 0)
                        this.selectedIndex--;
                    else
                        this.selectedIndex = currentItems.length - 1;
                    selectionChanged = true;
                    break;
                case direction_6.Direction.Down:
                    if (this.selectedIndex < currentItems.length - 1)
                        this.selectedIndex++;
                    else
                        this.selectedIndex = 0;
                    selectionChanged = true;
                    break;
            }
        }
        TakeTurn() {
        }
        Paint() {
            engine_10.view.DrawBitmap(resourceids_8.BitmapId.Titel, 0, 0);
            engine_10.view.FillRectangle(MainMenu.boxX, MainMenu.boxY, MainMenu.boxEndX, MainMenu.boxEndY, msx_7.MSXConstants.Msx1Colors[4]);
            engine_10.view.DrawRectangle(MainMenu.boxX, MainMenu.boxY, MainMenu.boxEndX, MainMenu.boxEndY, msx_7.MSXConstants.Msx1Colors[15]);
            switch (this.state) {
                case State.SubMenu:
                case State.SelectMain:
                    for (let i = 0; i < MainMenu.items.length; i++) {
                        switch (MainMenu.menuOptions[i]) {
                            case MenuItem.Continue:
                                if (gamestateloader_2.SlotExists(constants_7.Constants.SaveSlotCheckpoint))
                                    textwriter_1.TextWriter.DrawText(MainMenu.itemsX, MainMenu.itemYs[i], MainMenu.items[i]);
                                else
                                    textwriter_1.TextWriter.DrawText(MainMenu.itemsX, MainMenu.itemYs[i], MainMenu.items[i], msx_7.MSXConstants.Msx1Colors[0]);
                                break;
                            default:
                                textwriter_1.TextWriter.DrawText(MainMenu.itemsX, MainMenu.itemYs[i], MainMenu.items[i]);
                                break;
                        }
                    }
                    break;
                case State.SelectChapter:
                    for (let i = 0; i < MainMenu.chapterItems.length; i++) {
                        textwriter_1.TextWriter.DrawText(MainMenu.itemsX, MainMenu.itemYs[i], MainMenu.chapterItems[i]);
                    }
                    break;
            }
            engine_10.view.DrawBitmap(resourceids_8.BitmapId.MenuCursor, this.cursorX, this.cursorY);
        }
        GameMenuClosed() {
            this.reset();
        }
    }
    exports.MainMenu = MainMenu;
    MainMenu.items = new Array("New game", "Continue game", "Load game", "Options");
    MainMenu.menuOptions = new Array(MenuItem.NewGame, MenuItem.Continue, MenuItem.LoadGame, MenuItem.Options);
    MainMenu.chapterItems = new Array("Debug", "Prologue", "Chapter 0", "Chapter 1", "Back");
    MainMenu.chapterOptions = new Array(MenuItem.Debug, MenuItem.Prologue, MenuItem.Chapter0, MenuItem.Chapter1, MenuItem.ToMainMenu);
    MainMenu.itemYs = new Array(140, 156, 172, 188, 196, 204);
    MainMenu.itemsX = 48;
    MainMenu.cursorPosX = 36;
    MainMenu.boxX = MainMenu.cursorPosX - 8;
    MainMenu.boxY = 132;
    MainMenu.boxEndX = MainMenu.boxX + 176 + 32;
    MainMenu.boxEndY = MainMenu.boxY + 24 + 48;
});
define("src/hud", ["require", "exports", "BoazEngineJS/btimer", "src/item", "resourceids", "src/sintervaniamodel", "src/gameconstants", "BoazEngineJS/engine", "src/gameview", "BoazEngineJS/common", "src/textwriter"], function (require, exports, btimer_4, item_2, resourceids_9, sintervaniamodel_11, gameconstants_4, engine_11, gameview_1, common_11, textwriter_2) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    class HUD {
        constructor() {
            this.barTimer = btimer_4.BStopwatch.createWatch();
            this.barTimer.pauseDuringMenu = false;
            this.barTimer.restart();
            this.foebarTimer = btimer_4.BStopwatch.createWatch();
            this.foebarTimer.pauseDuringMenu = false;
            this.foebarTimer.restart();
            this.SetShownLevelsToProperValues();
        }
        SetShownLevelsToProperValues() {
            if (sintervaniamodel_11.GameModel._ != null) {
                if (sintervaniamodel_11.GameModel._.Belmont != null)
                    this.shownHealthLevel = sintervaniamodel_11.GameModel._.Belmont.HealthPercentage;
                this.shownFoeHealthLevel = gameview_1.GameView._.FoeHealthPercentage;
                this.foeForWhichHealthLevelIsShown = gameview_1.GameView._.FoeForWhichHealthPercentageIsGiven;
            }
        }
        TakeTurn() {
            if (sintervaniamodel_11.GameModel._.Belmont.Dying)
                this.shownHealthLevel = sintervaniamodel_11.GameModel._.Belmont.HealthPercentage;
            if (sintervaniamodel_11.GameModel._.LastFoeThatWasHit != null && sintervaniamodel_11.GameModel._.LastFoeThatWasHit.disposeFlag)
                this.shownFoeHealthLevel = 0;
            if (common_11.waitDuration(this.barTimer, HUD.MsDurationBarChange)) {
                if (this.shownHealthLevel > sintervaniamodel_11.GameModel._.Belmont.HealthPercentage)
                    this.shownHealthLevel--;
                else if (this.shownHealthLevel < sintervaniamodel_11.GameModel._.Belmont.HealthPercentage)
                    this.shownHealthLevel++;
            }
            if (gameconstants_4.GameConstants.AnimateFoeHealthLevel) {
                if (common_11.waitDuration(this.foebarTimer, HUD.MsDurationFoeBarChange)) {
                    if (this.shownFoeHealthLevel > gameview_1.GameView._.FoeHealthPercentage)
                        this.shownFoeHealthLevel--;
                    else if (this.shownFoeHealthLevel < gameview_1.GameView._.FoeHealthPercentage)
                        this.shownFoeHealthLevel++;
                }
            }
            else
                this.shownFoeHealthLevel = gameview_1.GameView._.FoeHealthPercentage;
        }
        percentageToBarLength(percentage) {
            return percentage == 0 ? 0 : (HUD.HealthBarSizeX / 100 * percentage) + 1;
        }
        Paint() {
            engine_11.view.DrawBitmap(resourceids_9.BitmapId.HUD, HUD.Pos_X, HUD.Pos_Y);
            let pos = { x: HUD.HealthBarPosX, y: HUD.HealthBarPosY };
            for (let i = 0; i < this.percentageToBarLength(this.shownHealthLevel); i++) {
                engine_11.view.DrawBitmap(resourceids_9.BitmapId.HUD_EnergyStripe_belmont, pos.x, pos.y);
                pos.x += 1;
            }
            textwriter_2.TextWriter.DrawText(HUD.HeartsPosX, HUD.HeartsPosY, `${sintervaniamodel_11.GameModel._.Hearts.toPrecision(2)}`);
            if (sintervaniamodel_11.GameModel._.ItemsInInventory.find(x => x.Type == item_2.ItemType.KeyBig)) {
                engine_11.view.DrawBitmap(item_2.Item.Type2Image(item_2.ItemType.KeyBig), HUD.KeyPos.x, HUD.KeyPos.y);
            }
            common_11.setPoint(pos, HUD.FoeBarStripePosX, HUD.FoeBarStripePosY);
            let lengthShown, lengthBefore;
            if (sintervaniamodel_11.GameModel._.BossBattle) {
                if (gameview_1.GameView._.FoeForWhichHealthPercentageIsGiven != this.foeForWhichHealthLevelIsShown) {
                    this.foeForWhichHealthLevelIsShown = gameview_1.GameView._.FoeForWhichHealthPercentageIsGiven;
                    this.shownFoeHealthLevel = gameview_1.GameView._.FoeHealthPercentage;
                }
                lengthShown = this.percentageToBarLength(this.shownFoeHealthLevel);
                lengthBefore = this.percentageToBarLength(gameview_1.GameView._.FoeHealthPercentage);
            }
            else {
                lengthShown = this.percentageToBarLength(100);
                lengthBefore = this.percentageToBarLength(100);
            }
            if (lengthBefore != -1) {
                if (lengthBefore > 0) {
                    for (let i = 0; i <= lengthBefore; i++) {
                        engine_11.view.DrawBitmap(resourceids_9.BitmapId.HUD_EnergyStripe_boss, pos.x, pos.y);
                        pos.x += 1;
                    }
                }
                if (lengthBefore != lengthShown) {
                    for (let i = lengthBefore; i <= lengthShown; i++) {
                        engine_11.view.DrawBitmap(resourceids_9.BitmapId.HUD_EnergyStripe_boss, pos.x, pos.y);
                        pos.x += 1;
                    }
                }
            }
        }
    }
    exports.HUD = HUD;
    HUD.Pos_X = 0;
    HUD.Pos_Y = 0;
    HUD.MsDurationBarChange = 100;
    HUD.MsDurationFoeBarChange = 10;
    HUD.HealthBarPosX = HUD.Pos_X + 60;
    HUD.HealthBarPosY = HUD.Pos_Y + 18;
    HUD.HeartsPosX = HUD.Pos_X + 193;
    HUD.HeartsPosY = HUD.Pos_Y + 5;
    HUD.WeaponPosX = HUD.Pos_X + 214 - (24 + 24);
    HUD.WeaponPosY = HUD.Pos_Y + 3;
    HUD.AmmoPosX = HUD.Pos_X + 214 - 24;
    HUD.AmmoPosY = HUD.Pos_Y + 6;
    HUD.ItemPosX = HUD.Pos_X + 227;
    HUD.ItemPosY = HUD.Pos_Y + 3;
    HUD.KeyPos = { x: HUD.Pos_X + 168, y: HUD.Pos_Y + 18 };
    HUD.FoeBarStripePosX = HUD.Pos_X + 60;
    HUD.FoeBarStripePosY = HUD.Pos_Y + 27;
    HUD.HealthBarSizeX = 63;
});
define("src/itscurtainsforyou", ["require", "exports", "BoazEngineJS/btimer", "BoazEngineJS/msx", "BoazEngineJS/constants", "BoazEngineJS/common", "BoazEngineJS/engine", "src/gamecontroller", "resourceids"], function (require, exports, btimer_5, msx_8, constants_8, common_12, engine_12, gamecontroller_4, resourceids_10) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    class ItsCurtainsForYou {
        constructor() {
            this.msCurtainPartWait = 18;
            this.maxCurtainParts = constants_8.Constants.GAMESCREEN_WIDTH / msx_8.TileSize;
        }
        Init() {
            this.curtainPartCount = 0;
            if (this.timer == null) {
                this.timer = btimer_5.BStopwatch.createWatch();
            }
            this.timer.restart();
        }
        Stop() {
            this.curtainPartCount = 0;
            btimer_5.BStopwatch.removeWatch(this.timer);
        }
        TakeTurn() {
            if (common_12.waitDuration(this.timer, this.msCurtainPartWait)) {
                this.curtainPartCount++;
                if (this.curtainPartCount >= this.maxCurtainParts)
                    gamecontroller_4.GameController._.ItsCurtainsAniFinished();
            }
        }
        Paint() {
            let pos = { x: 0, y: 0 };
            for (let i = 0; i < this.curtainPartCount; i++) {
                engine_12.view.DrawBitmap(resourceids_10.BitmapId.CurtainPart, pos.x, pos.y);
                pos.x += msx_8.TileSize;
            }
        }
    }
    exports.ItsCurtainsForYou = ItsCurtainsForYou;
});
define("src/gameover", ["require", "exports", "src/sintervaniamodel", "BoazEngineJS/direction", "src/textwriter", "BoazEngineJS/msx", "BoazEngineJS/engine", "resourceids", "BoazEngineJS/input", "BoazEngineJS/soundmaster", "src/resourcemaster", "src/gamecontroller", "src/mainmenu"], function (require, exports, sintervaniamodel_12, direction_7, textwriter_3, msx_9, engine_13, resourceids_11, input_3, soundmaster_4, resourcemaster_5, gamecontroller_5, mainmenu_1) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    var State;
    (function (State) {
        State[State["SelectContOrLoad"] = 0] = "SelectContOrLoad";
        State[State["SelectFile"] = 1] = "SelectFile";
    })(State = exports.State || (exports.State = {}));
    class GameOver {
        constructor() {
        }
        get cursorX() {
            return GameOver.cursorPosX;
        }
        get cursorY() {
            return GameOver.itemYs[this.selectedIndex];
        }
        Init() {
            this.reset();
        }
        reset() {
            this.selectedIndex = 0;
            this.state = State.SelectContOrLoad;
        }
        HandleInput() {
            let selectionChanged = false;
            if (input_3.KeyState.KC_UP)
                this.changeSelection(direction_7.Direction.Up, selectionChanged);
            else if (input_3.KeyState.KC_RIGHT)
                this.changeSelection(direction_7.Direction.Right, selectionChanged);
            else if (input_3.KeyState.KC_DOWN)
                this.changeSelection(direction_7.Direction.Down, selectionChanged);
            else if (input_3.KeyState.KC_LEFT)
                this.changeSelection(direction_7.Direction.Left, selectionChanged);
            if (input_3.KeyState.KC_SPACE) {
                switch (this.state) {
                    case State.SelectContOrLoad:
                        switch (this.selectedIndex) {
                            case 0:
                                gamecontroller_5.GameController._.LoadCheckpoint();
                                break;
                            case 1:
                                soundmaster_4.SoundMaster.PlayEffect(resourcemaster_5.ResourceMaster.Sound[resourceids_11.AudioId.Selectie]);
                                input_3.KeyState.KC_SPACE = false;
                                sintervaniamodel_12.GameModel._.GameMenu.Open(mainmenu_1.MenuItem.LoadFromGameOver);
                                this.state = State.SelectFile;
                                break;
                        }
                        break;
                    case State.SelectFile:
                        break;
                }
            }
            if (selectionChanged) {
                soundmaster_4.SoundMaster.PlayEffect(resourcemaster_5.ResourceMaster.Sound[resourceids_11.AudioId.Selectie]);
            }
        }
        changeSelection(dir, selectionChanged) {
            if (this.state == State.SelectFile)
                return;
            switch (dir) {
                case direction_7.Direction.Up:
                    if (this.selectedIndex > 0) {
                        this.selectedIndex = 0;
                        selectionChanged = true;
                    }
                    break;
                case direction_7.Direction.Down:
                    if (this.selectedIndex < 1) {
                        this.selectedIndex = 1;
                        selectionChanged = true;
                    }
                    break;
            }
        }
        TakeTurn() {
        }
        Paint() {
            textwriter_3.TextWriter.DrawText(60, 56, ["Je bent vernederd!"]);
            textwriter_3.TextWriter.DrawText(32, 80, ["Wat ga je doen,Belmont?"]);
            engine_13.view.DrawRectangle(GameOver.boxX, GameOver.boxY, GameOver.boxEndX, GameOver.boxEndY, msx_9.MSXConstants.Msx1Colors[15]);
            for (let i = 0; i < GameOver.items.length; i++)
                textwriter_3.TextWriter.DrawText(GameOver.itemsX, GameOver.itemYs[i], [GameOver.items[i]]);
            engine_13.view.DrawBitmap(resourceids_11.BitmapId.MenuCursor, this.cursorX, this.cursorY);
        }
        GameMenuClosed() {
            this.reset();
        }
    }
    exports.GameOver = GameOver;
    GameOver.items = new Array("Start bij controlepunt", "Laad spel");
    GameOver.itemYs = new Array(112, 128);
    GameOver.itemsX = 48;
    GameOver.cursorPosX = 36;
    GameOver.boxX = GameOver.cursorPosX - 8;
    GameOver.boxY = 104;
    GameOver.boxEndX = GameOver.boxX + 176 + 32;
    GameOver.boxEndY = GameOver.boxY + 24 + 16;
});
define("src/title", ["require", "exports", "BoazEngineJS/animation", "BoazEngineJS/common", "resourceids", "src/gamecontroller", "BoazEngineJS/input", "BoazEngineJS/engine"], function (require, exports, animation_2, common_13, resourceids_12, gamecontroller_6, input_4, engine_14) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    var State;
    (function (State) {
        State[State["WaitForIt"] = 0] = "WaitForIt";
        State[State["Konami"] = 1] = "Konami";
        State[State["TitleTop"] = 2] = "TitleTop";
        State[State["TitleBottom"] = 3] = "TitleBottom";
        State[State["WaitForItAgain"] = 4] = "WaitForItAgain";
        State[State["Other"] = 5] = "Other";
    })(State = exports.State || (exports.State = {}));
    class Title {
        constructor() {
            this.titleAni = new animation_2.Animation(Title.titleStates, Title.titleMoves);
            this.titleTopPos = { x: 0, y: 0 };
            this.titleBottomPos = { x: 0, y: 0 };
        }
        Init() {
            this.reset();
        }
        reset() {
            common_13.setPoint(this.titleTopPos, Title.titleTopStartX, Title.titleTopY);
            common_13.setPoint(this.titleBottomPos, Title.titleBottomStartX, Title.titleBottomY);
            this.titleAni.restart();
            this.state = this.titleAni.stepValue();
        }
        TakeTurn() {
            let newState = { nextStepValue: this.state };
            if (input_4.KeyState.KC_SPACE) {
                gamecontroller_6.GameController._.PreludeFinished();
                input_4.KeyState.KC_SPACE = false;
                return;
            }
            switch (this.state) {
                case State.WaitForIt:
                case State.WaitForItAgain:
                    if (this.titleAni.doAnimation(1, newState)) {
                        this.state = newState.nextStepValue;
                    }
                    break;
                case State.Konami:
                    if (this.titleAni.doAnimation(1, newState)) {
                        this.state = newState.nextStepValue;
                    }
                    break;
                case State.TitleTop:
                    if ((engine_14.game.TurnCounter & 1) == 0) {
                        this.titleTopPos.x += Title.deltaX;
                        if (this.titleAni.doAnimation(Title.deltaX, newState)) {
                            this.state = newState.nextStepValue;
                        }
                    }
                    break;
                case State.TitleBottom:
                    if ((engine_14.game.TurnCounter & 1) == 0) {
                        this.titleBottomPos.x -= Title.deltaX;
                        if (this.titleAni.doAnimation(Title.deltaX, newState)) {
                            this.state = newState.nextStepValue;
                        }
                    }
                    break;
                case State.Other:
                    gamecontroller_6.GameController._.PreludeFinished();
                    break;
            }
        }
        Paint() {
            engine_14.view.DrawBitmap(resourceids_12.BitmapId.TitelBoven, this.titleTopPos.x, this.titleTopPos.y);
            engine_14.view.DrawBitmap(resourceids_12.BitmapId.TitelOnder, this.titleBottomPos.x, this.titleBottomPos.y);
            if (this.state != State.WaitForIt)
                engine_14.view.DrawBitmap(resourceids_12.BitmapId.TitelKonami, Title.konamiX, Title.konamiY);
        }
    }
    exports.Title = Title;
    Title.titleTopY = 16;
    Title.titleBottomY = 41;
    Title.titleTopStartX = -216;
    Title.titleBottomStartX = 256;
    Title.titleTopEndX = 24;
    Title.titleBottomEndX = 64;
    Title.deltaX = 8;
    Title.waitFrames = 50;
    Title.waitKonamiFrames = 100;
    Title.konamiX = 76;
    Title.konamiY = 103;
    Title.titleStates = new Array(State.WaitForIt, State.Konami, State.TitleTop, State.TitleBottom, State.WaitForItAgain, State.Other);
    Title.titleMoves = new Array(Title.waitFrames, Title.waitKonamiFrames, -Title.titleTopStartX + Title.titleTopEndX, Title.titleBottomStartX - Title.titleBottomEndX, Title.waitFrames, 0);
});
define("src/enddemo", ["require", "exports", "src/textwriter", "BoazEngineJS/btimer", "BoazEngineJS/animation", "BoazEngineJS/msx"], function (require, exports, textwriter_4, btimer_6, animation_3, msx_10) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    var State;
    (function (State) {
        State[State["Sint"] = 0] = "Sint";
        State[State["WaitForBoaz"] = 1] = "WaitForBoaz";
        State[State["Boaz"] = 2] = "Boaz";
        State[State["None"] = 3] = "None";
    })(State = exports.State || (exports.State = {}));
    class EndDemo {
        constructor() {
            this.ani = new animation_3.Animation(EndDemo.states, EndDemo.waits);
            this.timer = btimer_6.BStopwatch.createWatch();
        }
        Init() {
            this.reset();
        }
        reset() {
            this.ani.restart();
            this.timer.restart();
            this.state = this.ani.stepValue();
        }
        TakeTurn() {
            let newState;
            switch (this.state) {
                case State.Sint:
                case State.WaitForBoaz:
                    if (this.ani.doAnimation(this.timer, newState)) {
                        this.state = newState.nextStepValue;
                    }
                    break;
                default:
                    break;
            }
        }
        Paint() {
            switch (this.state) {
                case State.Sint:
                    textwriter_4.TextWriter.DrawText(20, 192, "Redelijk gedaan, Belmont!");
                    break;
                case State.Boaz:
                    textwriter_4.TextWriter.DrawText(msx_10.Tile.ToCoord(1), msx_10.Tile.ToCoord(9), "Zo, dat was het weer!");
                    textwriter_4.TextWriter.DrawText(msx_10.Tile.ToCoord(1), msx_10.Tile.ToCoord(11), "ervan hebben genoten");
                    textwriter_4.TextWriter.DrawText(msx_10.Tile.ToCoord(1), msx_10.Tile.ToCoord(12), "en dat is ook terecht.");
                    textwriter_4.TextWriter.DrawText(msx_10.Tile.ToCoord(1), msx_10.Tile.ToCoord(14), "Dit verhaal is nog niet");
                    textwriter_4.TextWriter.DrawText(msx_10.Tile.ToCoord(1), msx_10.Tile.ToCoord(15), "afgelopen,dus bij");
                    textwriter_4.TextWriter.DrawText(msx_10.Tile.ToCoord(1), msx_10.Tile.ToCoord(16), "belangstelling komt er");
                    textwriter_4.TextWriter.DrawText(msx_10.Tile.ToCoord(1), msx_10.Tile.ToCoord(17), "wellicht een nieuw");
                    textwriter_4.TextWriter.DrawText(msx_10.Tile.ToCoord(1), msx_10.Tile.ToCoord(18), "hoofdstuk in dit");
                    textwriter_4.TextWriter.DrawText(msx_10.Tile.ToCoord(1), msx_10.Tile.ToCoord(19), "spannende en meeslepende");
                    textwriter_4.TextWriter.DrawText(msx_10.Tile.ToCoord(1), msx_10.Tile.ToCoord(20), "verhaal!");
                    break;
            }
        }
    }
    exports.EndDemo = EndDemo;
    EndDemo.states = [State.Sint, State.WaitForBoaz, State.Boaz];
    EndDemo.waits = [10000, 1000, 0];
});
define("BoazEngineJS/gameoptions", ["require", "exports", "BoazEngineJS/msx"], function (require, exports, msx_11) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    class GameOptions {
        static get WindowWidth() {
            return (msx_11.MSXConstants.MSX2ScreenWidth * GameOptions.Scale);
        }
        static get WindowHeight() {
            return (msx_11.MSXConstants.MSX2ScreenHeight * GameOptions.Scale);
        }
        static get BufferWidth() {
            return (msx_11.MSXConstants.MSX2ScreenWidth * GameOptions.Scale);
        }
        static get BufferHeight() {
            return (msx_11.MSXConstants.MSX2ScreenHeight * GameOptions.Scale);
        }
    }
    exports.GameOptions = GameOptions;
    GameOptions.INITIAL_SCALE = 1;
    GameOptions.INITIAL_FULLSCREEN = false;
    GameOptions.Scale = GameOptions.INITIAL_SCALE;
    GameOptions.Fullscreen = GameOptions.INITIAL_FULLSCREEN;
    GameOptions.EffectsVolumePercentage = 100;
    GameOptions.MusicVolumePercentage = 100;
});
define("src/gameview", ["require", "exports", "src/hud", "src/itscurtainsforyou", "src/gameover", "src/mainmenu", "src/title", "BoazEngineJS/model", "src/gameconstants", "src/sintervaniamodel", "src/textwriter", "BoazEngineJS/engine", "BoazEngineJS/msx", "src/enddemo", "BoazEngineJS/gameoptions"], function (require, exports, hud_1, itscurtainsforyou_1, gameover_1, mainmenu_2, title_1, model_3, gameconstants_5, sintervaniamodel_13, textwriter_5, engine_15, msx_12, enddemo_1, gameoptions_2) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    class GameView {
        constructor() {
            this.Init();
        }
        static get _() {
            return GameView._instance != null ? GameView._instance : (GameView._instance = new GameView());
        }
        get ShowFoeBar() {
            return sintervaniamodel_13.GameModel._.BossBattle;
        }
        get FoeHealthPercentage() {
            let foe = sintervaniamodel_13.GameModel._.LastFoeThatWasHit;
            if (foe == null) {
                if (!sintervaniamodel_13.GameModel._.BossBattle)
                    return -1;
                else
                    foe = sintervaniamodel_13.GameModel._.Boss;
            }
            if (foe.disposeFlag)
                return 0;
            return foe.HealthPercentage;
        }
        get FoeForWhichHealthPercentageIsGiven() {
            return sintervaniamodel_13.GameModel._.LastFoeThatWasHit != null ? sintervaniamodel_13.GameModel._.LastFoeThatWasHit : sintervaniamodel_13.GameModel._.Boss;
        }
        static DetermineMaxScaleForFullscreen(clientWidth, clientHeight, originalBufferWidth, originalBufferHeight) {
            if (clientWidth >= clientHeight) {
                return clientHeight / originalBufferHeight;
            }
            else {
                return clientWidth / originalBufferWidth;
            }
        }
        ChangeScale(newScale) {
            gameoptions_2.GameOptions.Scale = newScale;
            this.scaleChanged();
        }
        scaleChanged() {
            throw Error("Not implemented!");
        }
        ToFullscreen() {
            throw Error("Not implemented!");
        }
        ToWindowed() {
            throw Error("Not implemented!");
        }
        Init() {
            this.Hud = new hud_1.HUD();
            this.ItsCurtains = new itscurtainsforyou_1.ItsCurtainsForYou();
            this.GameOverScreen = new gameover_1.GameOver();
            this.MainMenu = new mainmenu_2.MainMenu();
            this.Title = new title_1.Title();
            this.EndDemo = new enddemo_1.EndDemo();
        }
        Paint() {
            if (sintervaniamodel_13.GameModel._.startAfterLoad)
                return;
            switch (sintervaniamodel_13.GameModel._.gameState) {
                case model_3.GameState.Prelude:
                    this.Title.Paint();
                    break;
                case model_3.GameState.TitleScreen:
                    this.MainMenu.Paint();
                    sintervaniamodel_13.GameModel._.GameMenu.Paint();
                    break;
                case model_3.GameState.EndDemo:
                    this.EndDemo.Paint();
                    break;
                case model_3.GameState.Game:
                case model_3.GameState.Event:
                    let gamescreenOffset = { x: gameconstants_5.GameConstants.GameScreenStartX, y: gameconstants_5.GameConstants.GameScreenStartY };
                    if (sintervaniamodel_13.GameModel._.gameSubstate != model_3.GameSubstate.SwitchRoom) {
                        sintervaniamodel_13.GameModel._.CurrentRoom.Paint();
                        sintervaniamodel_13.GameModel._.objects.sort(o => o.priority).sort(o => o.pos.y + o.size.y).forEach(o => o.paint(gamescreenOffset));
                    }
                    this.Hud.Paint();
                    switch (sintervaniamodel_13.GameModel._.gameSubstate) {
                        case model_3.GameSubstate.SwitchRoom:
                        case model_3.GameSubstate.BelmontDies:
                        case model_3.GameSubstate.ItsCurtainsForYou:
                        case model_3.GameSubstate.ToEndDemo:
                        case model_3.GameSubstate.GameOver:
                            break;
                        default:
                            break;
                    }
                    if (sintervaniamodel_13.GameModel._.gameSubstate != model_3.GameSubstate.SwitchRoom) {
                    }
                    if (sintervaniamodel_13.GameModel._.gameSubstate == model_3.GameSubstate.ItsCurtainsForYou || sintervaniamodel_13.GameModel._.gameSubstate == model_3.GameSubstate.ToEndDemo) {
                        this.ItsCurtains.Paint();
                    }
                    else if (sintervaniamodel_13.GameModel._.gameSubstate == model_3.GameSubstate.GameOver) {
                        this.ItsCurtains.Paint();
                        this.GameOverScreen.Paint();
                    }
                    sintervaniamodel_13.GameModel._.GameMenu.Paint();
                    if (sintervaniamodel_13.GameModel._.paused) {
                        engine_15.view.FillRectangle(GameView.pausePosX, GameView.pausePosY, GameView.pauseEndX, GameView.pauseEndY, msx_12.MSXConstants.Msx1Colors[1]);
                        engine_15.view.DrawRectangle(GameView.pausePosX, GameView.pausePosY, GameView.pauseEndX, GameView.pauseEndY, msx_12.MSXConstants.Msx1Colors[15]);
                        textwriter_5.TextWriter.DrawText(GameView.pauseTextPosX, GameView.pauseTextPosY, GameView.pauseText);
                    }
                    break;
            }
        }
    }
    exports.GameView = GameView;
    GameView.pausePosX = 80;
    GameView.pausePosY = 80;
    GameView.pauseTextPosX = 104;
    GameView.pauseTextPosY = 96;
    GameView.pauseEndX = 176;
    GameView.pauseEndY = 120;
    GameView.pauseText = "Paused";
});
define("src/gamemenu", ["require", "exports", "src/mainmenu", "src/gameview", "resourceids", "BoazEngineJS/direction", "src/textwriter", "BoazEngineJS/input", "BoazEngineJS/soundmaster", "src/resourcemaster", "src/gamecontroller", "src/sintervaniamodel", "BoazEngineJS/gamestateloader", "BoazEngineJS/gameoptions", "BoazEngineJS/msx", "BoazEngineJS/constants", "BoazEngineJS/common", "BoazEngineJS/engine", "BoazEngineJS/model"], function (require, exports, mainmenu_3, gameview_2, resourceids_13, direction_8, textwriter_6, input_5, soundmaster_5, resourcemaster_6, gamecontroller_7, sintervaniamodel_14, gamestateloader_3, gameoptions_3, msx_13, constants_9, common_14, engine_16, model_4) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    class GameMenu {
        constructor() {
            this.visible = false;
            this.cursorPos = { x: 0, y: 0 };
            this.selectedItemIndex = 0;
            this.CurrentScreen = mainmenu_3.MenuItem.Main;
        }
        Open(currentscreen = mainmenu_3.MenuItem.Main) {
            this.selectedItemIndex = 0;
            this.visible = true;
            this.CurrentScreen = currentscreen;
            if (this.CurrentScreen == mainmenu_3.MenuItem.Main)
                soundmaster_5.SoundMaster.PlayEffect(resourcemaster_6.ResourceMaster.Sound[resourceids_13.AudioId.Selectie]);
        }
        Close() {
            this.visible = false;
            this.selectedItemIndex = 0;
            switch (this.CurrentScreen) {
                case mainmenu_3.MenuItem.LoadFromGameOver:
                    gameview_2.GameView._.MainMenu.GameMenuClosed();
                    break;
                case mainmenu_3.MenuItem.LoadFromMainMenu:
                case mainmenu_3.MenuItem.OptionsFromMainMenu:
                    gameview_2.GameView._.MainMenu.GameMenuClosed();
                    break;
                default:
                    sintervaniamodel_14.GameModel._.ItemsInInventory.filter(i => i.Amount != 0);
                    break;
            }
        }
        TakeTurn() {
            if (!this.visible)
                return;
            common_14.setPoint(this.cursorPos, this.calculateCursorX(), this.calculateCursorY());
        }
        HandleInput() {
            let selectionChanged = false;
            switch (this.CurrentScreen) {
                case mainmenu_3.MenuItem.Main:
                case mainmenu_3.MenuItem.Load:
                case mainmenu_3.MenuItem.LoadFromMainMenu:
                case mainmenu_3.MenuItem.Options:
                case mainmenu_3.MenuItem.OptionsFromMainMenu:
                case mainmenu_3.MenuItem.Save:
                case mainmenu_3.MenuItem.LoadFromGameOver:
                    if (input_5.KeyState.KC_UP)
                        this.changeSelection(direction_8.Direction.Up, selectionChanged);
                    else if (input_5.KeyState.KC_RIGHT)
                        this.changeSelection(direction_8.Direction.Right, selectionChanged);
                    else if (input_5.KeyState.KC_DOWN)
                        this.changeSelection(direction_8.Direction.Down, selectionChanged);
                    else if (input_5.KeyState.KC_LEFT)
                        this.changeSelection(direction_8.Direction.Left, selectionChanged);
                    break;
            }
            if (input_5.KeyState.KC_SPACE) {
                switch (this.CurrentScreen) {
                    case mainmenu_3.MenuItem.Main:
                        soundmaster_5.SoundMaster.PlayEffect(resourcemaster_6.ResourceMaster.Sound[resourceids_13.AudioId.Selectie]);
                        switch (this.selectedItem) {
                            case mainmenu_3.MenuItem.ReturnToGame:
                                gamecontroller_7.GameController._.CloseGameMenu();
                                break;
                            case mainmenu_3.MenuItem.ChangeOptions:
                                this.CurrentScreen = mainmenu_3.MenuItem.Options;
                                this.selectedItemIndex = 0;
                                break;
                            case mainmenu_3.MenuItem.LoadGame:
                                this.CurrentScreen = mainmenu_3.MenuItem.Load;
                                this.selectedItemIndex = 0;
                                break;
                            case mainmenu_3.MenuItem.SaveGame:
                                if (sintervaniamodel_14.GameModel._.State != model_4.GameState.Event) {
                                    this.CurrentScreen = mainmenu_3.MenuItem.Save;
                                    this.selectedItemIndex = 0;
                                }
                                else
                                    soundmaster_5.SoundMaster.PlayEffect(resourcemaster_6.ResourceMaster.Sound[resourceids_13.AudioId.Fout]);
                                break;
                            case mainmenu_3.MenuItem.ExitGame:
                                throw Error("Game afluiten is niet geimplementeerd :-o");
                                break;
                        }
                        break;
                    case mainmenu_3.MenuItem.Load:
                    case mainmenu_3.MenuItem.LoadFromGameOver:
                    case mainmenu_3.MenuItem.LoadFromMainMenu:
                        switch (this.selectedItem) {
                            case mainmenu_3.MenuItem.ReturnToMain:
                                soundmaster_5.SoundMaster.PlayEffect(resourcemaster_6.ResourceMaster.Sound[resourceids_13.AudioId.Selectie]);
                                switch (this.CurrentScreen) {
                                    case mainmenu_3.MenuItem.LoadFromGameOver:
                                    case mainmenu_3.MenuItem.LoadFromMainMenu:
                                        this.Close();
                                        break;
                                    default:
                                        this.CurrentScreen = mainmenu_3.MenuItem.Main;
                                        this.selectedItemIndex = 0;
                                        break;
                                }
                                break;
                            case mainmenu_3.MenuItem.SaveSlot:
                                {
                                    let slot = this.selectedItemIndex - 1;
                                    if (gamestateloader_3.SlotExists(slot)) {
                                        let sg = gamestateloader_3.LoadGame(slot);
                                        gamecontroller_7.GameController._.LoadGame(sg);
                                    }
                                    else
                                        soundmaster_5.SoundMaster.PlayEffect(resourcemaster_6.ResourceMaster.Sound[resourceids_13.AudioId.Fout]);
                                }
                                break;
                        }
                        break;
                    case mainmenu_3.MenuItem.Save:
                        soundmaster_5.SoundMaster.PlayEffect(resourcemaster_6.ResourceMaster.Sound[resourceids_13.AudioId.Selectie]);
                        switch (this.selectedItem) {
                            case mainmenu_3.MenuItem.ReturnToMain:
                                this.CurrentScreen = mainmenu_3.MenuItem.Main;
                                this.selectedItemIndex = 0;
                                break;
                            case mainmenu_3.MenuItem.SaveSlot:
                                {
                                    let slot = this.selectedItemIndex - 1;
                                    gamecontroller_7.GameController._.SaveGame(slot);
                                }
                                break;
                        }
                        break;
                    case mainmenu_3.MenuItem.Options:
                    case mainmenu_3.MenuItem.OptionsFromMainMenu:
                        switch (this.selectedItem) {
                            case mainmenu_3.MenuItem.ReturnToMain:
                                soundmaster_5.SoundMaster.PlayEffect(resourcemaster_6.ResourceMaster.Sound[resourceids_13.AudioId.Selectie]);
                                switch (this.CurrentScreen) {
                                    case mainmenu_3.MenuItem.OptionsFromMainMenu:
                                        this.Close();
                                        break;
                                    default:
                                        this.CurrentScreen = mainmenu_3.MenuItem.Main;
                                        this.selectedItemIndex = 0;
                                        break;
                                }
                                break;
                            default:
                                soundmaster_5.SoundMaster.PlayEffect(resourcemaster_6.ResourceMaster.Sound[resourceids_13.AudioId.Fout]);
                                break;
                        }
                        break;
                }
            }
            if (input_5.KeyState.KC_RIGHT) {
                switch (this.CurrentScreen) {
                    case mainmenu_3.MenuItem.Options:
                    case mainmenu_3.MenuItem.OptionsFromMainMenu:
                        switch (this.selectedItem) {
                            case mainmenu_3.MenuItem.Scale:
                                if (!gameoptions_3.GameOptions.Fullscreen) {
                                    gameview_2.GameView._.ChangeScale(gameoptions_3.GameOptions.Scale + 1);
                                    engine_16.game.GameOptionsChanged();
                                }
                                break;
                            case mainmenu_3.MenuItem.Fullscreen:
                                if (gameoptions_3.GameOptions.Fullscreen) {
                                    gameoptions_3.GameOptions.Fullscreen = false;
                                    gameview_2.GameView._.ToWindowed();
                                    engine_16.game.GameOptionsChanged();
                                }
                                break;
                            case mainmenu_3.MenuItem.EffectVolume:
                                if (gameoptions_3.GameOptions.EffectsVolumePercentage < 100) {
                                    gameoptions_3.GameOptions.EffectsVolumePercentage += 10;
                                    if (gameoptions_3.GameOptions.EffectsVolumePercentage > 100)
                                        gameoptions_3.GameOptions.EffectsVolumePercentage = 100;
                                    soundmaster_5.SoundMaster.SetEffectsVolume(gameoptions_3.GameOptions.EffectsVolumePercentage / 100);
                                    engine_16.game.GameOptionsChanged();
                                }
                                break;
                            case mainmenu_3.MenuItem.MusicVolume:
                                if (gameoptions_3.GameOptions.MusicVolumePercentage < 100) {
                                    gameoptions_3.GameOptions.MusicVolumePercentage += 10;
                                    if (gameoptions_3.GameOptions.MusicVolumePercentage > 100)
                                        gameoptions_3.GameOptions.MusicVolumePercentage = 100;
                                    soundmaster_5.SoundMaster.SetMusicVolume(gameoptions_3.GameOptions.MusicVolumePercentage / 100);
                                    engine_16.game.GameOptionsChanged();
                                }
                                break;
                        }
                        break;
                }
            }
            if (input_5.KeyState.KC_LEFT) {
                switch (this.CurrentScreen) {
                    case mainmenu_3.MenuItem.Options:
                    case mainmenu_3.MenuItem.OptionsFromMainMenu:
                        switch (this.selectedItem) {
                            case mainmenu_3.MenuItem.Scale:
                                if (!gameoptions_3.GameOptions.Fullscreen && gameoptions_3.GameOptions.Scale > 1) {
                                    gameview_2.GameView._.ChangeScale(gameoptions_3.GameOptions.Scale - 1);
                                    engine_16.game.GameOptionsChanged();
                                }
                                break;
                            case mainmenu_3.MenuItem.Fullscreen:
                                if (!gameoptions_3.GameOptions.Fullscreen) {
                                    gameoptions_3.GameOptions.Fullscreen = true;
                                    gameview_2.GameView._.ToFullscreen();
                                    engine_16.game.GameOptionsChanged();
                                }
                                break;
                            case mainmenu_3.MenuItem.EffectVolume:
                                if (gameoptions_3.GameOptions.EffectsVolumePercentage > 0) {
                                    gameoptions_3.GameOptions.EffectsVolumePercentage -= 10;
                                    if (gameoptions_3.GameOptions.EffectsVolumePercentage < 0)
                                        gameoptions_3.GameOptions.EffectsVolumePercentage = 0;
                                    soundmaster_5.SoundMaster.SetEffectsVolume(gameoptions_3.GameOptions.EffectsVolumePercentage / 100);
                                    engine_16.game.GameOptionsChanged();
                                }
                                break;
                            case mainmenu_3.MenuItem.MusicVolume:
                                if (gameoptions_3.GameOptions.MusicVolumePercentage > 0) {
                                    gameoptions_3.GameOptions.MusicVolumePercentage -= 10;
                                    if (gameoptions_3.GameOptions.MusicVolumePercentage < 0)
                                        gameoptions_3.GameOptions.MusicVolumePercentage = 0;
                                    soundmaster_5.SoundMaster.SetMusicVolume(gameoptions_3.GameOptions.MusicVolumePercentage / 100);
                                    engine_16.game.GameOptionsChanged();
                                }
                                break;
                        }
                        break;
                }
            }
            if (selectionChanged) {
                soundmaster_5.SoundMaster.PlayEffect(resourcemaster_6.ResourceMaster.Sound[resourceids_13.AudioId.Selectie]);
            }
        }
        calculateCursorX() {
            switch (this.CurrentScreen) {
                case mainmenu_3.MenuItem.Options:
                case mainmenu_3.MenuItem.OptionsFromMainMenu:
                case mainmenu_3.MenuItem.Main:
                    return GameMenu.menuPosX + GameMenu.mainItemsOffsetX + GameMenu.cursorOffsetX;
                case mainmenu_3.MenuItem.Load:
                case mainmenu_3.MenuItem.LoadFromGameOver:
                case mainmenu_3.MenuItem.LoadFromMainMenu:
                case mainmenu_3.MenuItem.Save:
                    return GameMenu.menuPosX + GameMenu.loadsaveItemOffsetX + GameMenu.cursorOffsetX;
            }
            return 0;
        }
        calculateCursorY() {
            switch (this.CurrentScreen) {
                default:
                    return GameMenu.cursorOffsetY + GameMenu.cursorVerticalSkipPerEntry * this.selectedItemIndex;
            }
        }
        changeSelection(direction, selectionChanged) {
            let maxX, maxY, x, y;
            switch (this.CurrentScreen) {
                case mainmenu_3.MenuItem.Main:
                    x = 0;
                    y = this.selectedItemIndex;
                    maxX = 0;
                    maxY = GameMenu.mainItems.length - 1;
                    break;
                case mainmenu_3.MenuItem.Options:
                case mainmenu_3.MenuItem.OptionsFromMainMenu:
                    x = 0;
                    y = this.selectedItemIndex;
                    maxX = 0;
                    maxY = GameMenu.optionsItems.length - 1;
                    break;
                case mainmenu_3.MenuItem.Load:
                case mainmenu_3.MenuItem.Save:
                case mainmenu_3.MenuItem.LoadFromGameOver:
                case mainmenu_3.MenuItem.LoadFromMainMenu:
                    x = 0;
                    y = this.selectedItemIndex;
                    maxX = 0;
                    maxY = constants_9.Constants.SaveSlotCount;
                    break;
                default:
                    maxX = maxY = x = y = 0;
                    break;
            }
            switch (direction) {
                case direction_8.Direction.Up:
                    if (y > 0)
                        y--;
                    else
                        y = maxY;
                    selectionChanged = true;
                    break;
                case direction_8.Direction.Right:
                    if (x < maxX) {
                        x++;
                        selectionChanged = true;
                    }
                    break;
                case direction_8.Direction.Down:
                    if (y < maxY)
                        y++;
                    else
                        y = 0;
                    selectionChanged = true;
                    break;
                case direction_8.Direction.Left:
                    if (x > 0) {
                        x--;
                        selectionChanged = true;
                    }
                    break;
            }
            this.selectedItemIndex = y;
        }
        get selectedItem() {
            switch (this.CurrentScreen) {
                case mainmenu_3.MenuItem.Main:
                default:
                    return GameMenu.mainItems[this.selectedItemIndex].type;
                case mainmenu_3.MenuItem.Load:
                case mainmenu_3.MenuItem.Save:
                case mainmenu_3.MenuItem.LoadFromGameOver:
                case mainmenu_3.MenuItem.LoadFromMainMenu:
                    return this.selectedItemIndex > 0 ? mainmenu_3.MenuItem.SaveSlot : mainmenu_3.MenuItem.ReturnToMain;
                case mainmenu_3.MenuItem.Options:
                case mainmenu_3.MenuItem.OptionsFromMainMenu:
                    return GameMenu.optionsItems[this.selectedItemIndex].type;
            }
        }
        Paint() {
            if (!this.visible)
                return;
            engine_16.view.FillRectangle(GameMenu.menuPosX, GameMenu.menuPosY, GameMenu.menuEndX, GameMenu.menuEndY, msx_13.MSXConstants.Msx1Colors[1]);
            engine_16.view.DrawRectangle(GameMenu.menuPosX, GameMenu.menuPosY, GameMenu.menuEndX, GameMenu.menuEndY, msx_13.MSXConstants.Msx1Colors[15]);
            let titleToDraw;
            let titleX, titleY;
            switch (this.CurrentScreen) {
                case mainmenu_3.MenuItem.Main:
                    titleToDraw = GameMenu.menuText;
                    titleX = GameMenu.mainMenuTextX;
                    titleY = GameMenu.mainMenuTextY;
                    break;
                case mainmenu_3.MenuItem.Options:
                case mainmenu_3.MenuItem.OptionsFromMainMenu:
                    titleToDraw = GameMenu.optionMenuText;
                    titleX = GameMenu.mainMenuTextX;
                    titleY = GameMenu.mainMenuTextY;
                    break;
                case mainmenu_3.MenuItem.Load:
                case mainmenu_3.MenuItem.LoadFromGameOver:
                case mainmenu_3.MenuItem.LoadFromMainMenu:
                    titleToDraw = GameMenu.loadMenuText;
                    titleX = GameMenu.mainMenuTextX;
                    titleY = GameMenu.mainMenuTextY;
                    break;
                case mainmenu_3.MenuItem.Save:
                    titleToDraw = GameMenu.saveMenuText;
                    titleX = GameMenu.mainMenuTextX;
                    titleY = GameMenu.mainMenuTextY;
                    break;
                default:
                    titleToDraw = "No title to draw!";
                    titleX = GameMenu.mainMenuTextX;
                    titleY = GameMenu.mainMenuTextY;
                    break;
            }
            textwriter_6.TextWriter.DrawText(titleX, titleY, titleToDraw);
            let y = GameMenu.mainMenuTextY + GameMenu.itemOffsetY;
            switch (this.CurrentScreen) {
                case mainmenu_3.MenuItem.Main:
                default:
                    {
                        GameMenu.mainItems.forEach(function (item) {
                            switch (item.type) {
                                case mainmenu_3.MenuItem.SaveGame:
                                    if (sintervaniamodel_14.GameModel._.State != model_4.GameState.Event)
                                        textwriter_6.TextWriter.DrawText(GameMenu.menuPosX + GameMenu.mainItemsOffsetX, y, item.label);
                                    else
                                        textwriter_6.TextWriter.DrawText(GameMenu.menuPosX + GameMenu.mainItemsOffsetX, y, item.label, msx_13.MSXConstants.Msx1ExtColors[0]);
                                    break;
                                default:
                                    textwriter_6.TextWriter.DrawText(GameMenu.menuPosX + GameMenu.mainItemsOffsetX, y, item.label);
                                    break;
                            }
                            y += GameMenu.itemOffsetY;
                        });
                        break;
                    }
                case mainmenu_3.MenuItem.Options:
                case mainmenu_3.MenuItem.OptionsFromMainMenu:
                    {
                        GameMenu.optionsItems.forEach(function (item) {
                            let offsetX = GameMenu.menuPosX + GameMenu.mainItemsOffsetX;
                            switch (item.type) {
                                case mainmenu_3.MenuItem.Scale:
                                    let textToDisplay;
                                    if (!gameoptions_3.GameOptions.Fullscreen) {
                                        textwriter_6.TextWriter.DrawText(GameMenu.menuPosX + GameMenu.mainItemsOffsetX, y, item.label);
                                        offsetX += GameMenu.scaleText.length * textwriter_6.TextWriter.FontWidth;
                                        textwriter_6.TextWriter.DrawText(offsetX, y, `${gameoptions_3.GameOptions.Scale}X`);
                                    }
                                    else {
                                        textwriter_6.TextWriter.DrawText(GameMenu.menuPosX + GameMenu.mainItemsOffsetX, y, item.label, msx_13.MSXConstants.Msx1ExtColors[0]);
                                        offsetX += GameMenu.scaleText.length * textwriter_6.TextWriter.FontWidth;
                                        textwriter_6.TextWriter.DrawText(offsetX, y, `${gameoptions_3.GameOptions.Scale}X`);
                                    }
                                    break;
                                case mainmenu_3.MenuItem.Fullscreen:
                                    textwriter_6.TextWriter.DrawText(GameMenu.menuPosX + GameMenu.mainItemsOffsetX, y, item.label);
                                    this.printFullscreenOptionRectangle(y);
                                    break;
                                case mainmenu_3.MenuItem.EffectVolume:
                                    {
                                        textwriter_6.TextWriter.DrawText(GameMenu.menuPosX + GameMenu.mainItemsOffsetX, y, item.label);
                                        offsetX += GameMenu.effectVolumeText.length * textwriter_6.TextWriter.FontWidth;
                                        let text = gameoptions_3.GameOptions.EffectsVolumePercentage > 0 ? gameoptions_3.GameOptions.EffectsVolumePercentage + "%" : "Off";
                                        textwriter_6.TextWriter.DrawText(offsetX, y, text);
                                    }
                                    break;
                                case mainmenu_3.MenuItem.MusicVolume:
                                    {
                                        textwriter_6.TextWriter.DrawText(GameMenu.menuPosX + GameMenu.mainItemsOffsetX, y, item.label);
                                        offsetX += GameMenu.musicVolumeText.length * textwriter_6.TextWriter.FontWidth;
                                        let text = gameoptions_3.GameOptions.MusicVolumePercentage > 0 ? gameoptions_3.GameOptions.MusicVolumePercentage + "%" : "Off";
                                        textwriter_6.TextWriter.DrawText(offsetX, y, text);
                                    }
                                    break;
                                default:
                                    textwriter_6.TextWriter.DrawText(GameMenu.menuPosX + GameMenu.mainItemsOffsetX, y, item.label);
                                    break;
                            }
                            y += GameMenu.itemOffsetY;
                        });
                        break;
                    }
                case mainmenu_3.MenuItem.Load:
                case mainmenu_3.MenuItem.LoadFromGameOver:
                case mainmenu_3.MenuItem.LoadFromMainMenu:
                    {
                        textwriter_6.TextWriter.DrawText(GameMenu.menuPosX + GameMenu.loadsaveItemOffsetX, y, GameMenu.backText);
                        y += GameMenu.itemOffsetY;
                        for (let i = 0; i < constants_9.Constants.SaveSlotCount; i++) {
                            this.printSaveSlot(GameMenu.menuPosX + GameMenu.loadsaveItemOffsetX, y, i);
                            y += GameMenu.itemOffsetY;
                        }
                        break;
                    }
                case mainmenu_3.MenuItem.Save:
                    {
                        textwriter_6.TextWriter.DrawText(GameMenu.menuPosX + GameMenu.loadsaveItemOffsetX, y, GameMenu.backText);
                        y += GameMenu.itemOffsetY;
                        for (let i = 0; i < constants_9.Constants.SaveSlotCount; i++) {
                            this.printSaveSlot(GameMenu.menuPosX + GameMenu.loadsaveItemOffsetX, y, i);
                            y += GameMenu.itemOffsetY;
                        }
                        break;
                    }
            }
            engine_16.view.DrawBitmap(resourceids_13.BitmapId.MenuCursor, this.cursorPos.x, this.cursorPos.y);
        }
        printFullscreenOptionRectangle(y) {
            let selectedIndex = gameoptions_3.GameOptions.Fullscreen ? 0 : 1;
            engine_16.view.DrawRectangle(GameMenu.fullscreenOptionsOffsets[selectedIndex] + GameMenu.menuPosX + GameMenu.optionItemsOffsetX, y + GameMenu.fullscreenOptionsOffsetY, GameMenu.fullscreenOptionsOffsets[selectedIndex] + GameMenu.fullscreenOptionsRectangleSize.x + GameMenu.menuPosX + GameMenu.optionItemsOffsetX, y + GameMenu.fullscreenOptionsOffsetY + GameMenu.fullscreenOptionsRectangleSize.y, msx_13.MSXConstants.Msx1Colors[6]);
        }
        printSaveSlot(x, y, slotIndex) {
            let exists = gamestateloader_3.SlotExists(slotIndex);
            if (!exists) {
                textwriter_6.TextWriter.DrawText(GameMenu.menuPosX + GameMenu.loadsaveItemOffsetX, y, `${slotIndex} + 1: ${GameMenu.emptySlot}`);
                return;
            }
            let savegame = gamestateloader_3.LoadGame(slotIndex);
            let time = savegame.Timestamp;
            textwriter_6.TextWriter.DrawText(GameMenu.menuPosX + GameMenu.loadsaveItemOffsetX, y, `${slotIndex + 1}: ${time.getDay().toFixed(2)}/${time.getMonth().toFixed(2)}/${time.getFullYear().toFixed(2)} - ${time.getHours().toFixed(2)}:${time.getMinutes().toFixed(2)}`);
        }
    }
    exports.GameMenu = GameMenu;
    GameMenu.menuPosX = 24;
    GameMenu.menuPosY = 24;
    GameMenu.menuEndX = 240;
    GameMenu.menuEndY = 176;
    GameMenu.cursorVerticalSkipPerEntry = 16;
    GameMenu.mainItemsOffsetX = 56;
    GameMenu.loadsaveItemOffsetX = 24;
    GameMenu.optionItemsOffsetX = 56;
    GameMenu.itemOffsetY = 16;
    GameMenu.itemVerticalSkipPerEntry = GameMenu.cursorVerticalSkipPerEntry;
    GameMenu.menuText = "- Game Menu -";
    GameMenu.loadMenuText = "- Load game -";
    GameMenu.saveMenuText = "- Save game -";
    GameMenu.optionMenuText = "- Options -";
    GameMenu.backText = "Back";
    GameMenu.emptySlot = "----";
    GameMenu.scaleText = "Scale: ";
    GameMenu.effectVolumeText = "Effects: ";
    GameMenu.musicVolumeText = "Music: ";
    GameMenu.mainMenuTextX = GameMenu.menuPosX + 56;
    GameMenu.mainMenuTextY = GameMenu.menuPosY + 16;
    GameMenu.cursorOffsetX = -16;
    GameMenu.cursorOffsetY = GameMenu.mainMenuTextY + GameMenu.itemOffsetY;
    GameMenu.mainItems = [
        { type: mainmenu_3.MenuItem.ChangeOptions, label: "Options" },
        { type: mainmenu_3.MenuItem.LoadGame, label: "Load game" },
        { type: mainmenu_3.MenuItem.SaveGame, label: "Save game" },
        { type: mainmenu_3.MenuItem.ExitGame, label: "Exit game" },
        { type: mainmenu_3.MenuItem.ReturnToGame, label: "Return to game" },
    ];
    GameMenu.optionsItems = [
        { type: mainmenu_3.MenuItem.ReturnToMain, label: GameMenu.backText },
        { type: mainmenu_3.MenuItem.Scale, label: GameMenu.scaleText },
        { type: mainmenu_3.MenuItem.Fullscreen, label: "Fullscreen: y n" },
        { type: mainmenu_3.MenuItem.MusicVolume, label: GameMenu.musicVolumeText },
        { type: mainmenu_3.MenuItem.EffectVolume, label: GameMenu.effectVolumeText }
    ];
    GameMenu.fullscreenOptionsOffsets = [textwriter_6.TextWriter.FontWidth * 12 - 1, textwriter_6.TextWriter.FontWidth * 14 - 1];
    GameMenu.fullscreenOptionsOffsetY = -1;
    GameMenu.fullscreenOptionsRectangleSize = common_14.newSize(textwriter_6.TextWriter.FontWidth + 2, textwriter_6.TextWriter.FontHeight + 2);
});
define("src/gamecontroller", ["require", "exports", "BoazEngineJS/btimer", "src/item", "resourceids", "BoazEngineJS/direction", "src/bootstrapper", "src/sintervaniamodel", "BoazEngineJS/model", "BoazEngineJS/input", "src/weaponfirehandler", "src/room", "src/gamemenu", "BoazEngineJS/common", "BoazEngineJS/soundmaster", "src/resourcemaster", "BoazEngineJS/constants", "src/gameview", "src/gameconstants", "BoazEngineJS/gamestateloader", "BoazEngineJS/gamesaver"], function (require, exports, btimer_7, item_3, resourceids_14, direction_9, bootstrapper_1, sintervaniamodel_15, model_5, input_6, weaponfirehandler_1, room_2, gamemenu_1, common_15, soundmaster_6, resourcemaster_7, constants_10, gameview_3, gameconstants_6, gamestateloader_4, gamesaver_2) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    class GameController {
        static get _() {
            return GameController._instance != null ? GameController._instance : (GameController._instance = new GameController());
        }
        Initialize() {
            sintervaniamodel_15.GameModel._.OldState = model_5.GameState.None;
            this.timer = btimer_7.BStopwatch.createWatch();
            this.startAfterLoadTimer = btimer_7.BStopwatch.createWatch();
        }
        SwitchToState(newState) {
            sintervaniamodel_15.GameModel._.OldState = sintervaniamodel_15.GameModel._.State;
            if (this.DisposeOldState(sintervaniamodel_15.GameModel._.State, newState)) {
                this.InitNewState(newState);
            }
            sintervaniamodel_15.GameModel._.State = newState;
        }
        DisposeOldState(oldState, newState) {
            switch (oldState) {
                case model_5.GameState.TitleScreen:
                    soundmaster_6.SoundMaster.StopMusic();
                    if (newState == model_5.GameState.Game)
                        this.setupGameStart(newState);
                    break;
                case model_5.GameState.GameStart2:
                    this.setupGameStart(newState);
                    break;
                case model_5.GameState.Game:
                    break;
                default:
                    break;
            }
            return true;
        }
        SwitchToOldState() {
            this.SwitchToState(sintervaniamodel_15.GameModel._.OldState);
        }
        SwitchToOldSubstate() {
            this.switchToSubstate(sintervaniamodel_15.GameModel._.OldSubstate);
        }
        InitNewState(newState) {
            switch (newState) {
                case model_5.GameState.Prelude:
                    gameview_3.GameView._.Title.Init();
                    break;
                case model_5.GameState.TitleScreen:
                    gameview_3.GameView._.MainMenu.Init();
                    break;
                case model_5.GameState.EndDemo:
                    gameview_3.GameView._.EndDemo.Init();
                    break;
                case model_5.GameState.GameStart1:
                    this.timer.restart();
                    break;
                case model_5.GameState.GameStart2:
                    this.timer.restart();
                    soundmaster_6.SoundMaster.PlayMusic(resourcemaster_7.ResourceMaster.Music[resourceids_14.AudioId.Stage]);
                    break;
                case model_5.GameState.Game:
                    break;
                default:
                    break;
            }
        }
        switchToSubstate(newSubstate) {
            sintervaniamodel_15.GameModel._.OldSubstate = sintervaniamodel_15.GameModel._.Substate;
            switch (newSubstate) {
                case sintervaniamodel_15.GameModel.GameSubstate.Conversation:
                    break;
                case sintervaniamodel_15.GameModel.GameSubstate.BelmontDies:
                    soundmaster_6.SoundMaster.PlayMusic(resourcemaster_7.ResourceMaster.Music[resourceids_14.AudioId.Ohnoes]);
                    break;
                case sintervaniamodel_15.GameModel.GameSubstate.ItsCurtainsForYou:
                case sintervaniamodel_15.GameModel.GameSubstate.ToEndDemo:
                    gameview_3.GameView._.ItsCurtains.Init();
                    break;
                case sintervaniamodel_15.GameModel.GameSubstate.GameOver:
                    soundmaster_6.SoundMaster.PlayMusic(resourcemaster_7.ResourceMaster.Music[resourceids_14.AudioId.Humiliation]);
                    gameview_3.GameView._.GameOverScreen.Init();
                    break;
                case sintervaniamodel_15.GameModel.GameSubstate.IngameMenu:
                    btimer_7.BStopwatch.pauseAllRunningWatches(true);
                    break;
                case sintervaniamodel_15.GameModel.GameSubstate.GameMenu:
                    btimer_7.BStopwatch.pauseAllRunningWatches(true);
                    break;
                case sintervaniamodel_15.GameModel.GameSubstate.SwitchRoom:
                    this.timer.restart();
                    break;
                case sintervaniamodel_15.GameModel.GameSubstate.Default:
                    if (sintervaniamodel_15.GameModel._.OldSubstate == sintervaniamodel_15.GameModel.GameSubstate.IngameMenu || sintervaniamodel_15.GameModel._.OldSubstate == sintervaniamodel_15.GameModel.GameSubstate.GameMenu)
                        btimer_7.BStopwatch.resumeAllPausedWatches();
                    break;
            }
            sintervaniamodel_15.GameModel._.Substate = newSubstate;
        }
        TakeTurn(elapsedMs) {
            if (sintervaniamodel_15.GameModel._.paused) {
                this.handlePausedState();
                return;
            }
            if (sintervaniamodel_15.GameModel._.startAfterLoad) {
                this.handleStartAfterLoadState();
                return;
            }
            this.ElapsedMsDelta = elapsedMs;
            switch (sintervaniamodel_15.GameModel._.State) {
                case model_5.GameState.Prelude:
                    gameview_3.GameView._.Title.TakeTurn();
                    break;
                case model_5.GameState.TitleScreen:
                    gameview_3.GameView._.MainMenu.HandleInput();
                    gameview_3.GameView._.MainMenu.TakeTurn();
                    if (sintervaniamodel_15.GameModel._.GameMenu.visible) {
                        sintervaniamodel_15.GameModel._.GameMenu.HandleInput();
                        sintervaniamodel_15.GameModel._.GameMenu.TakeTurn();
                    }
                    break;
                case model_5.GameState.EndDemo:
                    gameview_3.GameView._.EndDemo.TakeTurn();
                    break;
                case model_5.GameState.GameStart1:
                    if (common_15.waitDuration(this.timer, gameconstants_6.GameConstants.WaitAfterGameStart1)) {
                        this.SwitchToState(model_5.GameState.GameStart2);
                    }
                    break;
                case model_5.GameState.GameStart2:
                    if (common_15.waitDuration(this.timer, gameconstants_6.GameConstants.WaitAfterGameStart2)) {
                        this.SwitchToState(model_5.GameState.Game);
                    }
                    break;
                case model_5.GameState.Game:
                    switch (sintervaniamodel_15.GameModel._.Substate) {
                        case sintervaniamodel_15.GameModel.GameSubstate.GameMenu:
                            this.handleInputDuringGame();
                            sintervaniamodel_15.GameModel._.GameMenu.TakeTurn();
                            break;
                        case sintervaniamodel_15.GameModel.GameSubstate.BelmontDies:
                            this.handleInputDuringGame();
                            sintervaniamodel_15.GameModel._.Belmont.TakeTurn();
                            gameview_3.GameView._.Hud.TakeTurn();
                            break;
                        case sintervaniamodel_15.GameModel.GameSubstate.ItsCurtainsForYou:
                        case sintervaniamodel_15.GameModel.GameSubstate.ToEndDemo:
                            this.handleInputDuringGame();
                            sintervaniamodel_15.GameModel._.Belmont.TakeTurn();
                            gameview_3.GameView._.Hud.TakeTurn();
                            gameview_3.GameView._.ItsCurtains.TakeTurn();
                            break;
                        case sintervaniamodel_15.GameModel.GameSubstate.GameOver:
                            this.handleInputDuringGame();
                            gameview_3.GameView._.GameOverScreen.TakeTurn();
                            sintervaniamodel_15.GameModel._.GameMenu.TakeTurn();
                            break;
                        case sintervaniamodel_15.GameModel.GameSubstate.SwitchRoom:
                            if (common_15.waitDuration(this.timer, gameconstants_6.GameConstants.WaitAfterRoomSwitch)) {
                                this.SwitchToOldSubstate();
                                if (gameconstants_6.GameConstants.CheckpointAtRoomEntry)
                                    this.StoreCheckpoint();
                            }
                            break;
                        case sintervaniamodel_15.GameModel.GameSubstate.Default:
                            this.handleInputDuringGame();
                            sintervaniamodel_15.GameModel._.objects.forEach(o => o.takeTurn());
                            sintervaniamodel_15.GameModel._.objects.filter(o => o.disposeFlag).forEach(o => sintervaniamodel_15.GameModel._.remove(o));
                            sintervaniamodel_15.GameModel._.CurrentRoom.TakeTurn();
                            gameview_3.GameView._.Hud.TakeTurn();
                            break;
                    }
                    break;
                case model_5.GameState.Event:
                    if (sintervaniamodel_15.GameModel._.Belmont.Dying)
                        this.SwitchToOldState();
                    switch (sintervaniamodel_15.GameModel._.Substate) {
                        case sintervaniamodel_15.GameModel.GameSubstate.SwitchRoom:
                            if (common_15.waitDuration(this.timer, gameconstants_6.GameConstants.WaitAfterRoomSwitch)) {
                                this.SwitchToOldSubstate();
                            }
                            break;
                        case sintervaniamodel_15.GameModel.GameSubstate.GameMenu:
                            this.handleInputDuringGame();
                            sintervaniamodel_15.GameModel._.GameMenu.TakeTurn();
                            break;
                        default:
                            sintervaniamodel_15.GameModel._.objects.forEach(o => o.takeTurn());
                            sintervaniamodel_15.GameModel._.objects.filter(o => o.disposeFlag).forEach(o => sintervaniamodel_15.GameModel._.remove(o));
                            sintervaniamodel_15.GameModel._.CurrentRoom.TakeTurn();
                            gameview_3.GameView._.Hud.TakeTurn();
                            if (input_6.KeyState.KC_F5 && !sintervaniamodel_15.GameModel._.GameMenu.visible)
                                this.OpenGameMenu();
                            break;
                    }
                    break;
                default:
                    break;
            }
        }
        handleInputDuringGame() {
            if (input_6.KeyState.KC_F1)
                this.PauseGame();
            switch (sintervaniamodel_15.GameModel._.Substate) {
                case sintervaniamodel_15.GameModel.GameSubstate.BelmontDies:
                case sintervaniamodel_15.GameModel.GameSubstate.ItsCurtainsForYou:
                case sintervaniamodel_15.GameModel.GameSubstate.ToEndDemo:
                    break;
                case sintervaniamodel_15.GameModel.GameSubstate.GameOver:
                    gameview_3.GameView._.GameOverScreen.HandleInput();
                    if (sintervaniamodel_15.GameModel._.GameMenu.visible)
                        this.handleInputDuringGameMenu();
                    break;
                case sintervaniamodel_15.GameModel.GameSubstate.GameMenu:
                    this.handleInputDuringGameMenu();
                    break;
                case sintervaniamodel_15.GameModel.GameSubstate.Default:
                default:
                    if (input_6.KeyState.KC_SPACE) {
                        weaponfirehandler_1.WeaponFireHandler.HandleFireMainWeapon();
                    }
                    if (input_6.KeyState.KC_M) {
                        weaponfirehandler_1.WeaponFireHandler.HandleFireSecondaryWeapon();
                    }
                    else if (input_6.KeyState.KC_F5 && !sintervaniamodel_15.GameModel._.GameMenu.visible)
                        this.OpenGameMenu();
                    break;
            }
        }
        handleInputDuringPause() {
            if (input_6.KeyState.KC_F1)
                this.UnpauseGame();
        }
        handleInputDuringGameMenu() {
            sintervaniamodel_15.GameModel._.GameMenu.HandleInput();
            if (input_6.KeyState.KC_F5) {
                this.CloseGameMenu();
            }
        }
        KillFocus() {
            if (!sintervaniamodel_15.GameModel._.paused && sintervaniamodel_15.GameModel._.State == model_5.GameState.Game && sintervaniamodel_15.GameModel._.Substate == sintervaniamodel_15.GameModel.GameSubstate.Default && gameconstants_6.GameConstants.PauseGameOnKillFocus)
                this.PauseGame();
        }
        SetFocus() {
        }
        handlePausedState() {
            this.handleInputDuringPause();
        }
        handleStartAfterLoadState() {
            if (common_15.waitDuration(this.startAfterLoadTimer, gameconstants_6.GameConstants.WaitAfterLoadGame)) {
                sintervaniamodel_15.GameModel._.startAfterLoad = false;
                btimer_7.BStopwatch.removeWatch(this.startAfterLoadTimer);
                if (soundmaster_6.SoundMaster.MusicBeingPlayed != null)
                    soundmaster_6.SoundMaster.PlayMusic(soundmaster_6.SoundMaster.MusicBeingPlayed);
            }
        }
        BelmontDied() {
            this.switchToSubstate(sintervaniamodel_15.GameModel.GameSubstate.BelmontDies);
        }
        BelmontDeathAniFinished() {
            this.switchToSubstate(sintervaniamodel_15.GameModel.GameSubstate.ItsCurtainsForYou);
        }
        ItsCurtainsAniFinished() {
            if (sintervaniamodel_15.GameModel._.Substate == sintervaniamodel_15.GameModel.GameSubstate.ItsCurtainsForYou)
                this.switchToSubstate(sintervaniamodel_15.GameModel.GameSubstate.GameOver);
            else
                this.SwitchToState(model_5.GameState.EndDemo);
        }
        PreludeFinished() {
            this.SwitchToState(model_5.GameState.TitleScreen);
        }
        BossDefeated() {
            this.switchToSubstate(sintervaniamodel_15.GameModel.GameSubstate.ToEndDemo);
        }
        HandleRoomExitViaMovement(targetRoom, dir) {
            let Belmont = sintervaniamodel_15.GameModel._.Belmont;
            switch (dir) {
                case direction_9.Direction.Up:
                    common_15.setPoint(Belmont.pos, Belmont.pos.x, room_2.Room.RoomHeight - (Belmont.size.y + 1));
                    break;
                case direction_9.Direction.Right:
                    common_15.setPoint(Belmont.pos, 0, Belmont.pos.y);
                    break;
                case direction_9.Direction.Down:
                    common_15.setPoint(Belmont.pos, Belmont.pos.x, 0);
                    break;
                case direction_9.Direction.Left:
                    common_15.setPoint(Belmont.pos, room_2.Room.RoomWidth - (Belmont.size.x + 1), Belmont.pos.y);
                    break;
            }
            this.DoRoomExit(targetRoom);
        }
        DoRoomExit(targetRoom) {
            sintervaniamodel_15.GameModel._.LastFoeThatWasHit = null;
            sintervaniamodel_15.GameModel._.LoadRoom(targetRoom);
            this.switchToSubstate(sintervaniamodel_15.GameModel.GameSubstate.SwitchRoom);
        }
        setupGameStart(newState) {
            sintervaniamodel_15.GameModel._.InitModelForGameStart();
            bootstrapper_1.Bootstrapper.BootstrapGame(sintervaniamodel_15.GameModel._.SelectedChapterToPlay);
            gameview_3.GameView._.Hud.SetShownLevelsToProperValues();
            sintervaniamodel_15.GameModel._.State = newState;
            this.StoreCheckpoint();
        }
        PauseGame() {
            sintervaniamodel_15.GameModel._.paused = true;
            btimer_7.BStopwatch.pauseAllRunningWatches();
            soundmaster_6.SoundMaster.StopEffect();
            soundmaster_6.SoundMaster.StopMusic();
        }
        UnpauseGame() {
            sintervaniamodel_15.GameModel._.paused = false;
            btimer_7.BStopwatch.resumeAllPausedWatches();
            soundmaster_6.SoundMaster.ResumeEffect();
            soundmaster_6.SoundMaster.ResumeMusic();
        }
        OpenGameMenu() {
            sintervaniamodel_15.GameModel._.GameMenu.Open();
            this.switchToSubstate(sintervaniamodel_15.GameModel.GameSubstate.GameMenu);
        }
        CloseGameMenu() {
            sintervaniamodel_15.GameModel._.GameMenu.Close();
            this.SwitchToOldSubstate();
        }
        LoadGame(sg) {
            soundmaster_6.SoundMaster.StopEffect();
            soundmaster_6.SoundMaster.StopMusic();
            let oldcheckpoint = sintervaniamodel_15.GameModel._.Checkpoint;
            sintervaniamodel_15.GameModel._ = sg.Model;
            sintervaniamodel_15.GameModel._.Checkpoint = gamestateloader_4.LoadGame(constants_10.Constants.SaveSlotCheckpoint);
            btimer_7.BStopwatch.Watches = sg.RegisteredWatches;
            sintervaniamodel_15.GameModel._.InitAfterGameLoad();
            sintervaniamodel_15.GameModel._.GameMenu = new gamemenu_1.GameMenu();
            gameview_3.GameView._.Init();
            sintervaniamodel_15.GameModel._.startAfterLoad = true;
            this.startAfterLoadTimer.pauseDuringMenu = false;
            this.startAfterLoadTimer.restart();
            btimer_7.BStopwatch.addWatch(this.startAfterLoadTimer);
            btimer_7.BStopwatch.addWatch(this.timer);
            soundmaster_6.SoundMaster.MusicBeingPlayed = sg.MusicBeingPlayed;
            resourcemaster_7.ResourceMaster.reloadImg(resourceids_14.BitmapId.Room, sintervaniamodel_15.GameModel._.CurrentRoom.BitmapPath);
        }
        SaveGame(slot) {
            if (sintervaniamodel_15.GameModel._.Substate == sintervaniamodel_15.GameModel.GameSubstate.GameMenu)
                this.CloseGameMenu();
            btimer_7.BStopwatch.removeWatch(this.timer);
            gamesaver_2.GameSaver.saveGame(sintervaniamodel_15.GameModel._, slot);
            btimer_7.BStopwatch.addWatch(this.timer);
        }
        StoreCheckpoint() {
            btimer_7.BStopwatch.removeWatch(this.timer);
            sintervaniamodel_15.GameModel._.Checkpoint = gamesaver_2.GameSaver.GetCheckpoint(sintervaniamodel_15.GameModel._);
            btimer_7.BStopwatch.addWatch(this.timer);
        }
        LoadCheckpoint() {
            if (sintervaniamodel_15.GameModel._.Checkpoint == null)
                sintervaniamodel_15.GameModel._.Checkpoint = gamestateloader_4.LoadGame(constants_10.Constants.SaveSlotCheckpoint);
            this.LoadGame(sintervaniamodel_15.GameModel._.Checkpoint);
        }
        PickupItem(source) {
            if (source.id != null)
                sintervaniamodel_15.GameModel._.ItemsPickedUp[source.id] = true;
            sintervaniamodel_15.GameModel._.AddItemToInventory(source.ItsType);
        }
        UseItem(itemType) {
            let bagitem = sintervaniamodel_15.GameModel._.ItemsInInventory.find(i => i.Type == itemType);
            if (bagitem.Amount > 0) {
                if (item_3.Item.ItemUsable(itemType) != item_3.Item.Usable.Infinite)
                    --bagitem.Amount;
                this.HandleUseItem(itemType);
            }
        }
        HandleUseItem(itemType) {
            switch (itemType) {
                case item_3.Item.Type.None:
                    sintervaniamodel_15.GameModel._.Belmont.Health = sintervaniamodel_15.GameModel._.Belmont.MaxHealth;
                    break;
            }
        }
        PickupWeaponItem(source) {
            sintervaniamodel_15.GameModel._.AddWeaponToInventory(source.ItsType);
            if (source.id != null)
                sintervaniamodel_15.GameModel._.ItemsPickedUp[source.id] = true;
        }
    }
    exports.GameController = GameController;
});
define("src/item", ["require", "exports", "BoazEngineJS/sprite", "BoazEngineJS/common", "src/sintervaniamodel", "BoazEngineJS/soundmaster", "src/resourcemaster", "src/gamecontroller", "resourceids"], function (require, exports, sprite_4, common_16, sintervaniamodel_16, soundmaster_7, resourcemaster_8, gamecontroller_8, resourceids_15) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    var ItemType;
    (function (ItemType) {
        ItemType[ItemType["None"] = 0] = "None";
        ItemType[ItemType["HeartSmall"] = 1] = "HeartSmall";
        ItemType[ItemType["HeartBig"] = 2] = "HeartBig";
        ItemType[ItemType["KeySmall"] = 3] = "KeySmall";
        ItemType[ItemType["KeyBig"] = 4] = "KeyBig";
    })(ItemType = exports.ItemType || (exports.ItemType = {}));
    var Usable;
    (function (Usable) {
        Usable[Usable["No"] = 0] = "No";
        Usable[Usable["Yes"] = 1] = "Yes";
        Usable[Usable["Infinite"] = 2] = "Infinite";
    })(Usable = exports.Usable || (exports.Usable = {}));
    class Item extends sprite_4.Sprite {
        constructor(type, pos) {
            super(pos);
            this.ItsType = type;
            this.hitarea = Item.ItemHitArea;
            this.size = common_16.area2size(Item.ItemHitArea);
            this.imgid = Item.Type2Image(type);
        }
        TakeTurn() {
            if (this.areaCollide(common_16.moveArea(sintervaniamodel_16.GameModel._.Belmont.EventTouchHitArea, sintervaniamodel_16.GameModel._.Belmont.pos))) {
                gamecontroller_8.GameController._.PickupItem(this);
                switch (this.ItsType) {
                    case ItemType.HeartSmall:
                    case ItemType.HeartBig:
                        soundmaster_7.SoundMaster.PlayEffect(resourcemaster_8.ResourceMaster.Sound[resourceids_15.AudioId.Heart]);
                        break;
                    case ItemType.KeySmall:
                    case ItemType.KeyBig:
                        soundmaster_7.SoundMaster.PlayEffect(resourcemaster_8.ResourceMaster.Sound[resourceids_15.AudioId.KeyGrab]);
                        break;
                    default:
                        soundmaster_7.SoundMaster.PlayEffect(resourcemaster_8.ResourceMaster.Sound[resourceids_15.AudioId.ItemPickup]);
                        break;
                }
                this.disposeFlag = true;
            }
        }
        static Type2Image(type) {
            switch (type) {
                case ItemType.KeyBig:
                    return resourceids_15.BitmapId.Key_big;
                default:
                    return resourceids_15.BitmapId.None;
            }
        }
        static ItemUsable(type) {
            switch (type) {
                default:
                    return Usable.No;
            }
        }
        Dispose() {
        }
    }
    exports.Item = Item;
    Item.ItemHitArea = common_16.newArea(0, 0, 16, 16);
});
define("src/fx", ["require", "exports", "BoazEngineJS/sprite", "BoazEngineJS/btimer"], function (require, exports, sprite_5, btimer_8) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    class FX extends sprite_5.Sprite {
        constructor(pos) {
            super(pos);
            this.timer = btimer_8.BStopwatch.createWatch();
        }
        init() {
            this.imgid = this.animation.stepValue();
            this.timer.restart();
        }
        TakeTurn() {
            this.doAnimation();
        }
        doAnimation() {
            let aniresult = this.animation.doAnimationTimer(this.timer);
            if (aniresult.next) {
                if (this.animation.finished())
                    this.disposeFlag = true;
                this.imgid = aniresult.value;
            }
        }
        Dispose() {
            btimer_8.BStopwatch.removeWatch(this.timer);
        }
    }
    exports.FX = FX;
});
define("src/heartsmall", ["require", "exports", "BoazEngineJS/sprite", "BoazEngineJS/animation", "resourceids", "src/gameconstants", "src/resourcemaster", "BoazEngineJS/common", "src/sintervaniamodel", "BoazEngineJS/soundmaster"], function (require, exports, sprite_6, animation_4, resourceids_16, gameconstants_7, resourcemaster_9, common_17, sintervaniamodel_17, soundmaster_8) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    var HeartSmallState;
    (function (HeartSmallState) {
        HeartSmallState[HeartSmallState["Flying"] = 0] = "Flying";
        HeartSmallState[HeartSmallState["Standing"] = 1] = "Standing";
    })(HeartSmallState = exports.HeartSmallState || (exports.HeartSmallState = {}));
    class HeartSmall extends sprite_6.Sprite {
        constructor(pos) {
            super(pos, resourceids_16.BitmapId.Heart_fly);
            this.animationData = [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1];
            this.State = HeartSmallState.Flying;
            this.animation = new animation_4.Animation(this.animationData, 1, true);
            this.uglyBitThing = false;
        }
        get hitarea() {
            return this.State == HeartSmallState.Flying ? HeartSmall.HitAreaFly : HeartSmall.HitAreaStand;
        }
        set hitarea(value) {
        }
        get floorCollision() {
            return sintervaniamodel_17.GameModel._.CurrentRoom.IsCollisionTile(this.pos.x + 5, this.pos.y + 8, false);
        }
        Dispose() {
        }
        TakeTurn() {
            if (this.State == HeartSmallState.Flying) {
                let delta = 0;
                delta = this.animation.doAnimation(1).value;
                this.pos.x += delta;
                if (this.uglyBitThing)
                    ++this.pos.y;
                this.uglyBitThing = !this.uglyBitThing;
                if (this.pos.y > gameconstants_7.GameConstants.GameScreenHeight) {
                    this.disposeFlag = true;
                    return;
                }
                if (this.floorCollision) {
                    this.State = HeartSmallState.Standing;
                    this.pos.y -= 3;
                    this.imgid = resourceids_16.BitmapId.Heart_small;
                }
            }
            if (this.objectCollide(sintervaniamodel_17.GameModel._.Belmont)) {
                ++sintervaniamodel_17.GameModel._.Hearts;
                this.disposeFlag = true;
                soundmaster_8.SoundMaster.PlayEffect(resourcemaster_9.ResourceMaster.Sound[resourceids_16.AudioId.Heart]);
            }
        }
        Paint(offset = null) {
            super.paint(offset);
        }
    }
    exports.HeartSmall = HeartSmall;
    HeartSmall.HitAreaFly = common_17.newArea(0, 0, 9, 8);
    HeartSmall.HitAreaStand = common_17.newArea(0, 0, 12, 11);
});
define("src/foeexplosion", ["require", "exports", "src/item", "BoazEngineJS/animation", "src/fx", "src/heartsmall", "resourceids", "src/sintervaniamodel", "BoazEngineJS/common"], function (require, exports, item_4, animation_5, fx_1, heartsmall_1, resourceids_17, sintervaniamodel_18, common_18) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    class FoeExplosion extends fx_1.FX {
        constructor(pos, itemSpawned = item_4.ItemType.None) {
            super(pos);
            this.animation = new animation_5.Animation(FoeExplosion.AnimationFrames, null, false);
            this.init();
            this.itemSpawnedAfterKill = itemSpawned;
        }
        TakeTurn() {
            let nextStep = this.animation.doAnimation(this.timer);
            if (nextStep.next) {
                this.imgid = nextStep.value;
                if (this.animation.finished()) {
                    this.disposeFlag = true;
                    if (this.itemSpawnedAfterKill == item_4.ItemType.HeartSmall) {
                        sintervaniamodel_18.GameModel._.spawn(new heartsmall_1.HeartSmall(common_18.addPoints({ x: this.pos.x, y: this.pos.y }, { x: 4, y: 8 })));
                    }
                }
            }
        }
    }
    exports.FoeExplosion = FoeExplosion;
    FoeExplosion.AnimationFrames = new Array({ time: 100, data: resourceids_17.BitmapId.FoeKill_1 }, { time: 100, data: resourceids_17.BitmapId.FoeKill_2 }, { time: 100, data: resourceids_17.BitmapId.FoeKill_1 }, { time: 100, data: resourceids_17.BitmapId.FoeKill_2 });
});
define("src/foe", ["require", "exports", "src/creature", "src/item", "src/sintervaniamodel", "BoazEngineJS/soundmaster", "src/foeexplosion", "resourceids", "src/resourcemaster"], function (require, exports, creature_2, item_5, sintervaniamodel_19, soundmaster_9, foeexplosion_1, resourceids_18, resourcemaster_10) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    class Foe extends creature_2.Creature {
        constructor(pos) {
            super(pos);
        }
        Paint(offset) {
            throw new Error("Method not implemented.");
        }
        get HealthPercentage() {
            return Math.min((Math.round(this.Health / this.MaxHealth * 100)), 100);
        }
        get RespawnAtRoomEntry() {
            return false;
        }
        get IsAfoot() {
            return this.CanHurtPlayer;
        }
        TakeTurn() {
            if (this.CanHurtPlayer && this.objectCollide(sintervaniamodel_19.GameModel._.Belmont)) {
                sintervaniamodel_19.GameModel._.Belmont.TakeDamage(this.DamageToPlayer);
            }
        }
        HandleHit(source) {
            sintervaniamodel_19.GameModel._.LastFoeThatWasHit = this;
            soundmaster_9.SoundMaster.PlayEffect(resourcemaster_10.ResourceMaster.Sound[resourceids_18.AudioId.Hit]);
        }
        loseHealth(source) {
            this.Health -= source.DamageDealt;
            if (this.Health <= 0)
                this.Die();
        }
        handleDie() {
            this.disposeFlag = true;
            sintervaniamodel_19.GameModel._.FoeDefeated(this);
        }
        Die() {
            if (this.itemSpawnedAfterKill == item_5.ItemType.HeartSmall) {
                this.dieWithItem(this.itemSpawnedAfterKill);
            }
            else
                this.dieWithoutItem();
        }
        dieWithoutItem() {
            this.handleDie();
            sintervaniamodel_19.GameModel._.spawn(new foeexplosion_1.FoeExplosion(this.pos));
        }
        dieWithItem(itemToSpawn = item_5.ItemType.None) {
            this.handleDie();
            if (itemToSpawn != item_5.ItemType.None) {
                sintervaniamodel_19.GameModel._.spawn(new foeexplosion_1.FoeExplosion(this.pos, itemToSpawn));
            }
        }
    }
    exports.Foe = Foe;
});
define("src/bossfoe", ["require", "exports", "src/foe", "src/sintervaniamodel"], function (require, exports, foe_1, sintervaniamodel_20) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    class BossFoe extends foe_1.Foe {
        constructor(pos) {
            super(pos);
            this.extendedProperties.set(sintervaniamodel_20.GameModel.PROPERTY_KEEP_AT_ROOMSWITCH, true);
        }
        StartBossfight() {
            throw new Error('not implemented');
        }
    }
    exports.BossFoe = BossFoe;
});
define("src/sintervaniamodel", ["require", "exports", "src/belmont", "BoazEngineJS/model", "BoazEngineJS/btimer", "src/weaponitem", "src/gameconstants", "src/gamemenu", "src/RoomFactory"], function (require, exports, belmont_2, model_6, btimer_9, weaponitem_1, gameconstants_8, gamemenu_2, RoomFactory_1) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    var Chapter;
    (function (Chapter) {
        Chapter[Chapter["Debug"] = 0] = "Debug";
        Chapter[Chapter["Prologue"] = 1] = "Prologue";
        Chapter[Chapter["Chapter_0"] = 2] = "Chapter_0";
        Chapter[Chapter["GameStart"] = 3] = "GameStart";
    })(Chapter = exports.Chapter || (exports.Chapter = {}));
    class BagItem {
    }
    exports.BagItem = BagItem;
    class BagWeapon {
    }
    exports.BagWeapon = BagWeapon;
    class Location {
    }
    exports.Location = Location;
    var Switch;
    (function (Switch) {
        Switch[Switch["None"] = 0] = "None";
        Switch[Switch["Dummy"] = 1] = "Dummy";
        Switch[Switch["GameStart"] = 2] = "GameStart";
        Switch[Switch["Room1Aanloop"] = 3] = "Room1Aanloop";
        Switch[Switch["Room1GebouwUitleg"] = 4] = "Room1GebouwUitleg";
        Switch[Switch["VijandenUitRaam"] = 5] = "VijandenUitRaam";
        Switch[Switch["SchuurSleutelGevonden"] = 6] = "SchuurSleutelGevonden";
        Switch[Switch["PraatOverTroep"] = 7] = "PraatOverTroep";
        Switch[Switch["NaarEindbaas"] = 8] = "NaarEindbaas";
        Switch[Switch["WaterEnBroodGevonden"] = 9] = "WaterEnBroodGevonden";
        Switch[Switch["WaterEnBroodGegeven"] = 10] = "WaterEnBroodGegeven";
        Switch[Switch["VillaSleutelGevonden"] = 11] = "VillaSleutelGevonden";
        Switch[Switch["Ch0_Chapter0Intro"] = 12] = "Ch0_Chapter0Intro";
        Switch[Switch["Ch0_LigpietOnderzocht"] = 13] = "Ch0_LigpietOnderzocht";
        Switch[Switch["Ch0_SpeelgoedOntdekt"] = 14] = "Ch0_SpeelgoedOntdekt";
        Switch[Switch["Ch0_KruidnootschieterGevonden"] = 15] = "Ch0_KruidnootschieterGevonden";
        Switch[Switch["Ch0_SleutelGevonden"] = 16] = "Ch0_SleutelGevonden";
        Switch[Switch["Ch0_SpeelgoedOntdekt2"] = 17] = "Ch0_SpeelgoedOntdekt2";
        Switch[Switch["Ch0_BossIntro"] = 18] = "Ch0_BossIntro";
        Switch[Switch["Ch0_LangVerhaal"] = 19] = "Ch0_LangVerhaal";
    })(Switch = exports.Switch || (exports.Switch = {}));
    var CombatType;
    (function (CombatType) {
        CombatType[CombatType["Encounter"] = 0] = "Encounter";
        CombatType[CombatType["Boss"] = 1] = "Boss";
    })(CombatType = exports.CombatType || (exports.CombatType = {}));
    var MainWeaponType;
    (function (MainWeaponType) {
        MainWeaponType[MainWeaponType["None"] = 0] = "None";
        MainWeaponType[MainWeaponType["TriRoe"] = 1] = "TriRoe";
    })(MainWeaponType = exports.MainWeaponType || (exports.MainWeaponType = {}));
    var SecWeaponType;
    (function (SecWeaponType) {
        SecWeaponType[SecWeaponType["None"] = 0] = "None";
        SecWeaponType[SecWeaponType["Cross"] = 1] = "Cross";
    })(SecWeaponType = exports.SecWeaponType || (exports.SecWeaponType = {}));
    class GameModel extends model_6.Model {
        static get _() {
            return GameModel._instance;
        }
        static set _(value) {
            GameModel._instance = value;
        }
        get Hearts() {
            return this._hearts;
        }
        set Hearts(value) {
            if (value > gameconstants_8.GameConstants.Belmont_MaxHearts)
                this._hearts = gameconstants_8.GameConstants.Belmont_MaxHearts;
            else if (value < 0)
                this._hearts = 0;
            else
                this._hearts = value;
        }
        get SelectedMainWeapon() {
            return MainWeaponType.TriRoe;
        }
        get SelectedSecondaryWeapon() {
            return this._selectedSecondaryWeapon;
        }
        set SelectedSecondaryWeapon(value) {
            this._selectedSecondaryWeapon = value;
        }
        get SelectedSecBagWeapon() {
            let weaponItemInBagType = weaponitem_1.WeaponItem.SecWeaponType2WeaponItemType(this.SelectedSecondaryWeapon);
            let index = this.WeaponsInInventory.findIndex(bw => bw.Type == weaponItemInBagType);
            if (index == -1)
                return null;
            return GameModel._.WeaponsInInventory[index];
        }
        get LastFoeThatWasHit() {
            if (this._lastFoeThatWasHit == null)
                return null;
            if (this._lastFoeThatWasHit.disposeFlag)
                return null;
            return this._lastFoeThatWasHit;
        }
        set LastFoeThatWasHit(value) {
            this._lastFoeThatWasHit = value;
        }
        get SelectedItem() {
            return this._selectedItem;
        }
        set SelectedItem(value) {
            this._selectedItem = value;
        }
        Initialize() {
            this.objects = new Array();
            this.Foes = new Array();
            this.ItemsInInventory = new Array();
            this.WeaponsInInventory = new Array();
            this.Switches = new Map();
            this.GameMenu = new gamemenu_2.GameMenu();
            this.id2object = new Map();
            this.FoesDefeated = new Map();
            this.ItemsPickedUp = new Map();
            this.WeaponItemsPickedUp = new Map();
            this.DoorsOpened = new Map();
            this.MainWeaponCooldownTimer = btimer_9.BStopwatch.createWatch();
            this.SecWeaponCooldownTimer = btimer_9.BStopwatch.createWatch();
            RoomFactory_1.RoomFactory.PrepareData();
        }
        InitModelForGameStart() {
            GameModel._.BossBattle = false;
            GameModel._.RoomExitsLocked = false;
            GameModel._.Switches.clear();
            Object.keys(Switch).forEach(t => GameModel._.Switches[t] = false);
            GameModel._.ItemsInInventory.length = 0;
            GameModel._.WeaponsInInventory.length = 0;
            GameModel._.FoesDefeated.clear();
            GameModel._.ItemsPickedUp.clear();
            GameModel._.WeaponItemsPickedUp.clear();
            GameModel._.spawn(new belmont_2.Belmont());
        }
        InitAfterGameLoad() {
        }
        spawn(o) {
            if (o instanceof belmont_2.Belmont) {
                if (this.objects.findIndex(ob => ob instanceof belmont_2.Belmont) > -1)
                    throw ("There is already a Belmont in the game! \"There can be only one!\"");
                else
                    GameModel._.Belmont = o;
            }
            let f = o;
            if (f) {
                if (!f.RespawnAtRoomEntry) {
                    let wasDefeated;
                    let exists = this.FoesDefeated.has(f.id) && this.FoesDefeated[f.id] == true;
                    if (!exists) {
                        this.FoesDefeated.set(f.id, false);
                        wasDefeated = false;
                    }
                    if (!wasDefeated)
                        this.Foes.push(f);
                    else
                        return;
                }
                else
                    this.Foes.push(f);
            }
            super.spawn(o);
        }
        FoeDefeated(f) {
            if (f.RespawnAtRoomEntry)
                return;
            if (this.FoesDefeated.has(f.id) && this.FoesDefeated[f.id].defeated)
                this.FoesDefeated[f.id] = true;
            else
                this.FoesDefeated.set(f.id, true);
        }
        GetFoeDefeated(id) {
            return this.FoesDefeated.has(id) ? this.FoesDefeated[id] : false;
        }
        get FoesPresentInCurrentRoom() {
            return this.Foes.length > 0;
        }
        GetSwitchState(s) {
            return this.Switches.has(s) ? this.Switches[s] : false;
        }
        GetItemPickedUp(id) {
            return this.ItemsPickedUp.has(id);
        }
        DoorOpened(id) {
            return this.DoorsOpened.has(id) ? true : false;
        }
        AddItemToInventory(itemType) {
            let itemInInventory = this.ItemsInInventory.find(i => i.Type == itemType);
            if (!itemInInventory) {
                let newBagItem = new BagItem();
                newBagItem.Amount = 1;
                newBagItem.Type = itemType;
                this.ItemsInInventory.push(newBagItem);
            }
        }
        AddWeaponToInventory(itemType) {
            let itemInInventory = this.WeaponsInInventory.find(i => i.Type == itemType);
            if (!itemInInventory == null) {
                let newWeapon = new BagWeapon();
                newWeapon.Type = itemType;
                this.WeaponsInInventory.push(newWeapon);
            }
        }
        RemoveItemFromInventory(itemType, removeAll = false) {
            let itemInInventory = this.ItemsInInventory.find(i => i.Type == itemType);
            if (!itemInInventory)
                throw `Item is not in inventory while trying to remove an item: ${itemType}`;
            if (itemInInventory.Amount > 1 && !removeAll)
                itemInInventory.Amount--;
            else {
                if (this.SelectedItem.Type == itemType)
                    this.SelectedItem = null;
                let index = this.ItemsInInventory.indexOf(itemInInventory);
                if (index > -1) {
                    delete this.ItemsInInventory[index];
                    this.ItemsInInventory.splice(index, 1);
                }
            }
        }
        LoadRoom(id) {
            let objectsToRemove = this.objects.filter(o => {
                return !o.extendedProperties[GameModel.PROPERTY_KEEP_AT_ROOMSWITCH];
            });
            objectsToRemove.forEach(o => this.remove(o));
            this.CurrentRoom = RoomFactory_1.RoomFactory.LoadRoom(id);
            this.CurrentRoom.InitRoom();
        }
    }
    exports.GameModel = GameModel;
    GameModel.PROPERTY_KEEP_AT_ROOMSWITCH = "p_rs";
    GameModel.PROPERTY_ACT_AS_WALL = "p_wall";
});
define("src/candle", ["require", "exports", "src/foe", "BoazEngineJS/btimer", "src/item", "BoazEngineJS/animation", "BoazEngineJS/direction", "resourceids", "BoazEngineJS/common"], function (require, exports, foe_2, btimer_10, item_6, animation_6, direction_10, resourceids_19, common_19) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    class Candle extends foe_2.Foe {
        constructor(pos, itemSpawned = item_6.ItemType.HeartSmall) {
            super(pos);
            this.CanHurtPlayer = false;
            this.animation = new animation_6.Animation(Candle.AnimationFrames, Candle.ElapsedMsPerFrame);
            this.animation.repeat = true;
            this.timer = btimer_10.BStopwatch.createWatch();
            this.imgid = this.animation.stepValue();
            this.timer.restart();
            this.hitarea = Candle.CandleHitArea;
            this.itemSpawnedAfterKill = itemSpawned;
        }
        get DamageToPlayer() {
            return 0;
        }
        get moveBeforeFrameChange() {
            return 0;
        }
        get RespawnAtRoomEntry() {
            return true;
        }
        get movementSprites() {
            return Candle.candleSprites;
        }
        TakeTurn() {
            let imageId = { nextStepValue: this.imgid };
            this.animation.doAnimation(this.timer, imageId);
            this.imgid = imageId.nextStepValue;
        }
        Dispose() {
            btimer_10.BStopwatch.removeWatch(this.timer);
        }
        HandleHit(source) {
            super.HandleHit(source);
            this.loseHealth(source);
        }
        Paint(offset = null) {
            super.Paint(offset);
        }
    }
    exports.Candle = Candle;
    Candle.CandleHitArea = common_19.newArea(0, 0, 10, 16);
    Candle.candleSprites = new Map([[direction_10.Direction.None, [resourceids_19.BitmapId.Candle_1]]]);
    Candle.AnimationFrames = [resourceids_19.BitmapId.Candle_1, resourceids_19.BitmapId.Candle_2];
    Candle.ElapsedMsPerFrame = [200, 200];
});
define("src/gardencandle", ["require", "exports", "BoazEngineJS/animation", "src/candle", "BoazEngineJS/direction", "resourceids", "src/item", "BoazEngineJS/common"], function (require, exports, animation_7, candle_1, direction_11, resourceids_20, item_7, common_20) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    class GardenCandle extends candle_1.Candle {
        constructor(pos, itemSpawned = item_7.ItemType.HeartSmall) {
            super(pos, itemSpawned);
            this.animation = new animation_7.Animation(GardenCandle.AnimationFrames, candle_1.Candle.ElapsedMsPerFrame, true);
            this.imgid = this.animation.stepValue();
            this.hitarea = GardenCandle.CandleHitArea;
            this.itemSpawnedAfterKill = itemSpawned;
        }
    }
    exports.GardenCandle = GardenCandle;
    GardenCandle.candleSprites = new Map([[direction_11.Direction.None, [resourceids_20.BitmapId.GCandle_1]]]);
    GardenCandle.CandleHitArea = common_20.newArea(0, 0, 16, 16);
    GardenCandle.AnimationFrames = new Array(resourceids_20.BitmapId.GCandle_1, resourceids_20.BitmapId.GCandle_2);
});
define("src/RoomFactory", ["require", "exports", "src/room", "BoazEngineJS/common", "BoazEngineJS/msx", "src/sintervaniamodel", "src/gardencandle"], function (require, exports, room_3, common_21, msx_14, sintervaniamodel_21, gardencandle_1) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    class RoomDataContainer {
        constructor(id, cmap, exits, bitmapPath, map, initFunction) {
            this.Id = id;
            this.CollisionMap = cmap;
            this.Exits = exits;
            this.BitmapPath = bitmapPath;
            this.Map = map;
            this.InitFunction = initFunction;
        }
    }
    exports.RoomDataContainer = RoomDataContainer;
    var RoomMap;
    (function (RoomMap) {
        RoomMap[RoomMap["Debug"] = 0] = "Debug";
        RoomMap[RoomMap["Dungeon1"] = 1] = "Dungeon1";
        RoomMap[RoomMap["Dungeon2"] = 2] = "Dungeon2";
        RoomMap[RoomMap["Town1"] = 3] = "Town1";
    })(RoomMap = exports.RoomMap || (exports.RoomMap = {}));
    class RoomFactory {
        static RoomExists(id) {
            return RoomFactory.rooms.has(id);
        }
        static LoadRoom(id) {
            if (!RoomFactory.rooms.has(id)) {
                throw Error("Room " + id + " could not be found in dictionary!");
            }
            return room_3.Room.LoadRoom(RoomFactory.rooms[id]);
        }
        static posOnMap(map, id) {
            for (let y = 0; (y < map.length); y++) {
                for (let x = 0; (x < map[y].length); x++) {
                    if ((map[y][x] == id)) {
                        return common_21.newPoint(x, y);
                    }
                }
            }
            throw new Error("Could not find room with Id {0} on the map:" + id);
        }
        static roomExits(map, id) {
            let result = new Array(4);
            let pos = RoomFactory.posOnMap(map, id);
            for (let i = 0; (i < RoomFactory.dirOffsets.length); i++) {
                let x = (pos.x + RoomFactory.dirOffsets[i][0]);
                let y = (pos.y + RoomFactory.dirOffsets[i][1]);
                if (((x < 0)
                    || ((x >= map[y].length)
                        || ((y < 0)
                            || (y >= map.length))))) {
                    result[i] = room_3.Room.NO_ROOM_EXIT;
                }
                else {
                    result[i] = map[y][x];
                }
            }
            return result;
        }
        static PrepareData() {
            RoomFactory.rooms = new Map();
        }
        static PrepareDummyData() {
            RoomFactory.rooms = new Map();
            let collisionData;
            let id;
            let bitmapPath;
            let map;
            id = 1;
            map = RoomFactory.RoomMap_debug;
            bitmapPath = "./Resources/Graphics/Stage/Dummy/DummyRoom.png";
            collisionData = [
                "................................",
                "................................",
                "................................",
                "................................",
                "................................",
                "................................",
                ".......................##.......",
                ".......................##.......",
                "......................###.......",
                "......................#######...",
                "......................#######...",
                ".......................#######..",
                ".......................#######..",
                ".......................#######..",
                ".......................########.",
                ".......................########.",
                ".......................########.",
                ".......................########.",
                ".........#.............########.",
                "......######............########",
                "...#########............########",
                "...########.............########",
                "...########.....................",
                "...########.....................",
            ];
            RoomFactory.rooms.set(id, new RoomDataContainer(id, collisionData, RoomFactory.roomExits(map, id), bitmapPath, map, null));
            RoomFactory.rooms.set(2, new RoomDataContainer(2, collisionData, RoomFactory.roomExits(map, 2), bitmapPath, map, null));
            RoomFactory.rooms.set(3, new RoomDataContainer(3, collisionData, RoomFactory.roomExits(map, 3), bitmapPath, map, null));
            RoomFactory.rooms.set(4, new RoomDataContainer(4, collisionData, RoomFactory.roomExits(map, 4), bitmapPath, map, null));
        }
        static PrepareStage0Data() {
            let collisionData;
            let id;
            let bitmapPath;
            let map;
            let initFunction;
            id = 100;
            map = RoomFactory.RoomMap_stage0;
            bitmapPath = "./Resources/Graphics/Stage/castle_entrance_3.png";
            collisionData = [
                "################################",
                "#..............................#",
                "#..............................#",
                "#..............................#",
                "#..............................#",
                "#..............................#",
                "#..............................#",
                "#..............................#",
                "#..............................#",
                "#..............................#",
                "#...............................",
                "#...............................",
                "#...............................",
                "#...............................",
                "#...............................",
                "#...............................",
                "#...............................",
                "#...............................",
                "################################",
                "################################",
                "################################",
                "################################"
            ];
            initFunction = (r) => {
                let candle = new gardencandle_1.GardenCandle(msx_14.Tile.ToCoord(8, 14));
                sintervaniamodel_21.GameModel._.spawn(candle);
                let candle2 = new gardencandle_1.GardenCandle(msx_14.Tile.ToCoord(24, 14));
                sintervaniamodel_21.GameModel._.spawn(candle2);
            };
            RoomFactory.rooms.set(id, new RoomDataContainer(id, collisionData, RoomFactory.roomExits(map, id), bitmapPath, map, initFunction));
        }
    }
    exports.RoomFactory = RoomFactory;
    RoomFactory.dirOffsets = [
        { x: 0, y: -1 },
        { x: 1, y: 0 },
        { x: 0, y: 1 },
        { x: -1, y: 0 },
    ];
    RoomFactory.RoomMap_debug = [
        [0, 3, 0,],
        [2, 1, 4,],
        [0, 0, 0,],
        [0, 0, 0,],
    ];
    RoomFactory.RoomMap_stage0 = [
        [0, 0, 0, 0, 0,],
        [0, 0, 100, 0, 0,],
        [0, 0, 0, 0, 0,],
        [0, 0, 0, 0, 0,],
    ];
});
define("src/chandelier", ["require", "exports", "BoazEngineJS/btimer", "BoazEngineJS/direction", "BoazEngineJS/animation", "src/foe", "src/item", "resourceids", "BoazEngineJS/common", "src/sintervaniamodel"], function (require, exports, btimer_11, direction_12, animation_8, foe_3, item_8, resourceids_21, common_22, sintervaniamodel_22) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    class Chandelier extends foe_3.Foe {
        constructor(pos, itemSpawned = item_8.ItemType.HeartSmall) {
            super(pos);
            this.animation = new animation_8.Animation(Chandelier.AnimationFrames);
            this.animation.repeat = true;
            this.timer = btimer_11.BStopwatch.createWatch();
            this.imgid = resourceids_21.BitmapId.Chandelier_1;
            this.hitarea = Chandelier.ChandelierHitArea;
            this.size = common_22.newSize(50, 64);
            this.itemSpawnedAfterKill = item_8.ItemType.None;
            this.Health = 0;
            this.state = ChandelierState.None;
        }
        get DamageToPlayer() {
            return 3;
        }
        get moveBeforeFrameChange() {
            return 0;
        }
        get RespawnAtRoomEntry() {
            return true;
        }
        get movementSprites() {
            return Chandelier.chandelierSprites;
        }
        get CanHurtPlayer() {
            return this.state == ChandelierState.Crashing ? true : false;
        }
        set CanHurtPlayer(value) {
        }
        TakeTurn() {
            switch (this.state) {
                case ChandelierState.None:
                    if (sintervaniamodel_22.GameModel._.Belmont.x_plus_width >= this.pos.x && sintervaniamodel_22.GameModel._.Belmont.pos.x <= this.x_plus_width) {
                        this.state = ChandelierState.Falling;
                    }
                    break;
                case ChandelierState.Falling:
                    this.pos.y += 8;
                    break;
                case ChandelierState.Crashing:
                    if (this.animation.doAnimation(this.timer))
                        this.imgid = this.animation.stepValue();
                    if (this.animation.finished()) {
                        this.timer.stop();
                        this.state = ChandelierState.Crashed;
                    }
                    break;
            }
        }
        Dispose() {
            btimer_11.BStopwatch.removeWatch(this.timer);
        }
        HandleHit(source) {
            super.HandleHit(source);
            this.loseHealth(source);
        }
        Paint(offset = null) {
            super.Paint(offset);
        }
    }
    exports.Chandelier = Chandelier;
    Chandelier.ChandelierHitArea = common_22.newArea(14, 0, 35, 64);
    Chandelier.chandelierSprites = new Map([
        [direction_12.Direction.None, [resourceids_21.BitmapId.Chandelier_1]]
    ]);
    Chandelier.AnimationFrames = [
        { time: 125, data: resourceids_21.BitmapId.Chandelier_2 },
        { time: 125, data: resourceids_21.BitmapId.Chandelier_3 },
        { time: 125, data: resourceids_21.BitmapId.Chandelier_4 },
        { time: 125, data: resourceids_21.BitmapId.Chandelier_5 },
    ];
    var ChandelierState;
    (function (ChandelierState) {
        ChandelierState[ChandelierState["None"] = 0] = "None";
        ChandelierState[ChandelierState["Falling"] = 1] = "Falling";
        ChandelierState[ChandelierState["Crashing"] = 2] = "Crashing";
        ChandelierState[ChandelierState["Crashed"] = 3] = "Crashed";
    })(ChandelierState = exports.ChandelierState || (exports.ChandelierState = {}));
});
define("src/fprojectile", ["require", "exports", "src/gameconstants", "src/projectile", "BoazEngineJS/common", "src/sintervaniamodel"], function (require, exports, gameconstants_9, projectile_2, common_23, sintervaniamodel_23) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    class FProjectile extends projectile_2.Projectile {
        get CanHurtPlayer() {
            return true;
        }
        constructor(pos, speed) {
            super(pos, speed);
            this.speed = speed;
        }
        TakeTurn() {
            this.pos = common_23.addPoints(this.pos, this.speed);
            if (this.CanHurtPlayer && this.objectCollide(sintervaniamodel_23.GameModel._.Belmont))
                sintervaniamodel_23.GameModel._.Belmont.TakeDamage(this.DamageDealt);
            if (this.checkWallSpriteCollisions() || this.checkWallCollision())
                this.disposeFlag = true;
            if (this.pos.x < 0 || this.pos.x + this.size.x >= gameconstants_9.GameConstants.GameScreenWidth || this.pos.y < 0 || this.pos.y + this.size.y >= gameconstants_9.GameConstants.GameScreenHeight)
                this.disposeFlag = true;
        }
    }
    exports.FProjectile = FProjectile;
});
define("src/hag", ["require", "exports", "BoazEngineJS/btimer", "BoazEngineJS/animation", "BoazEngineJS/direction", "resourceids", "src/item", "src/foe", "src/gameconstants"], function (require, exports, btimer_12, animation_9, direction_13, resourceids_22, item_9, foe_4, gameconstants_10) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    class Hag extends foe_4.Foe {
        constructor({ pos, dir, itemSpawned = item_9.ItemType.HeartSmall }) {
            super(pos);
            this.CanHurtPlayer = true;
            this.animation = new animation_9.Animation(Hag.AnimationFrames, null, true);
            this.timer = btimer_12.BStopwatch.createWatch();
            this.imgid = this.animation.stepValue();
            this.timer.restart();
            this.size = Hag.HagSize;
            this.hitarea = Hag.HagHitArea;
            this.itemSpawnedAfterKill = itemSpawned;
            this.Health = 1;
            this.Direction = dir;
        }
        get DamageToPlayer() {
            return 1;
        }
        get moveBeforeFrameChange() {
            return 0;
        }
        get RespawnAtRoomEntry() {
            return true;
        }
        TakeTurn() {
            let stepValue = { nextStepValue: this.imgid };
            this.animation.doAnimation(this.timer, stepValue);
            this.imgid = stepValue.nextStepValue;
            this.flippedH = this.Direction == direction_13.Direction.Left;
            this.pos.x += this.Direction == direction_13.Direction.Left ? -2 : 2;
            if (this.pos.x >= gameconstants_10.GameConstants.GameScreenWidth || (0 > this.pos.x + this.size.x)) {
                this.disposeFlag = true;
            }
        }
        Dispose() {
            btimer_12.BStopwatch.removeWatch(this.timer);
        }
        HandleHit(source) {
            super.HandleHit(source);
            this.loseHealth(source);
        }
        Paint(offset = null) {
            super.Paint(offset);
        }
    }
    exports.Hag = Hag;
    Hag.HagSize = { x: 16, y: 32 };
    Hag.HagHitArea = { start: { x: 2, y: 2 }, end: { x: 14, y: 32 } };
    Hag.hagSprites = new Map([[direction_13.Direction.None, [resourceids_22.BitmapId.Hag_1, resourceids_22.BitmapId.Hag_2]]]);
    Hag.movementSprites = Hag.hagSprites;
    Hag.AnimationFrames = new Array({ time: 250, data: resourceids_22.BitmapId.Hag_1 }, { time: 250, data: resourceids_22.BitmapId.Hag_2 });
});
define("src/haggenerator", ["require", "exports", "BoazEngineJS/btimer", "src/sintervaniamodel", "BoazEngineJS/animation", "src/hag"], function (require, exports, btimer_13, sintervaniamodel_24, animation_10, hag_1) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    class HagGenerator {
        constructor(pos, directionOfHags) {
            this.spawnAnimation = new animation_10.Animation([true], [2000], true);
            this.timer = btimer_13.BStopwatch.createWatch();
            this.timer.restart();
            this.directionOfHags = directionOfHags;
        }
        get hitbox_sx() {
            return this.pos.x + this.hitarea.start.x;
        }
        get hitbox_sy() {
            return this.pos.y + this.hitarea.start.y;
        }
        get hitbox_ex() {
            return this.pos.x + this.hitarea.end.x;
        }
        get hitbox_ey() {
            return this.pos.y + this.hitarea.end.y;
        }
        get x_plus_width() {
            return 0;
        }
        get y_plus_height() {
            return 0;
        }
        get z_plus_depth() {
            return 0;
        }
        takeTurn() {
            let stepValue = { nextStepValue: false };
            if (this.spawnAnimation.doAnimation(this.timer, stepValue))
                sintervaniamodel_24.GameModel._.spawn(new hag_1.Hag({ pos: { x: this.pos.x, y: this.pos.y }, dir: this.directionOfHags }));
        }
        Dispose() {
            btimer_13.BStopwatch.removeWatch(this.timer);
        }
        spawn(spawningPos) {
            if (spawningPos != null)
                this.pos = spawningPos;
        }
        objectCollide(o) {
            return false;
        }
        areaCollide(a) {
            return false;
        }
        handleResizeEvent() {
        }
        exile() {
            btimer_13.BStopwatch.removeWatch(this.timer);
        }
    }
    exports.HagGenerator = HagGenerator;
});
define("src/pietula", ["require", "exports", "BoazEngineJS/animation", "BoazEngineJS/btimer", "src/bossfoe", "BoazEngineJS/direction", "resourceids", "BoazEngineJS/common"], function (require, exports, animation_11, btimer_14, bossfoe_1, direction_14, resourceids_23, common_24) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    var PietulaState;
    (function (PietulaState) {
        PietulaState[PietulaState["None"] = 0] = "None";
        PietulaState[PietulaState["ThrowingZakFoes"] = 1] = "ThrowingZakFoes";
        PietulaState[PietulaState["Bla"] = 2] = "Bla";
    })(PietulaState || (PietulaState = {}));
    class Pietula extends bossfoe_1.BossFoe {
        constructor(pos) {
            super(pos);
            this.CanHurtPlayer = true;
            this.animation = new animation_11.Animation(Pietula.AnimationFrames, null, true);
            this.timer = btimer_14.BStopwatch.createWatch();
            this.imgid = this.animation.stepValue().img;
            this.timer.restart();
            this.hitarea = Pietula.PietulaHitArea;
            this.size = common_24.newSize(this.hitarea.end.x, this.hitarea.end.y);
            this.Health = 20;
        }
        get DamageToPlayer() {
            return 5;
        }
        get moveBeforeFrameChange() {
            return 0;
        }
        get RespawnAtRoomEntry() {
            return true;
        }
        get movementSprites() {
            return Pietula.pietulaSprites;
        }
        StartBossfight() {
            throw "Not implemented!";
        }
        TakeTurn() {
            let stepValue = { nextStepValue: { img: this.imgid, dy: 0 } };
            this.animation.doAnimation(this.timer, stepValue);
            this.imgid = stepValue.nextStepValue.img;
            this.pos.y += stepValue.nextStepValue.dy;
        }
        Dispose() {
            btimer_14.BStopwatch.removeWatch(this.timer);
        }
        HandleHit(source) {
            super.HandleHit(source);
            this.loseHealth(source);
        }
        Paint(offset = null) {
            super.Paint(offset);
        }
        Die() {
            super.Die();
        }
    }
    exports.Pietula = Pietula;
    Pietula.PietulaHitArea = common_24.newArea(0, 0, 10, 16);
    Pietula.pietulaSprites = new Map([[direction_14.Direction.None, [resourceids_23.BitmapId.Pietula_1]]]);
    Pietula.AnimationFrames = new Array({ time: 250, data: { img: resourceids_23.BitmapId.Pietula_1, dy: -1 } }, { time: 250, data: { img: resourceids_23.BitmapId.Pietula_2, dy: 1 } });
});
define("src/story", ["require", "exports"], function (require, exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    class Story {
    }
    exports.Story = Story;
});
define("src/zakfoe", ["require", "exports", "src/foe", "BoazEngineJS/btimer", "src/item", "BoazEngineJS/direction", "BoazEngineJS/common", "resourceids", "src/sintervaniamodel", "src/gameconstants", "BoazEngineJS/msx"], function (require, exports, foe_5, btimer_15, item_10, direction_15, common_25, resourceids_24, sintervaniamodel_25, gameconstants_11, msx_15) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    class ZakFoe extends foe_5.Foe {
        constructor(pos, itemSpawned = item_10.Item.Type.HeartSmall) {
            super(pos);
            this.CanHurtPlayer = true;
            throw new Error("ZakFoe compileert nog niet omdat er gewoon nog wat zaken missen.");
            this.timer = btimer_15.BStopwatch.createWatch();
            this.imgid = this.animation.stepValue().img;
            this.timer.restart();
            this.hitarea = ZakFoe.ZakFoeHitArea;
            this.size = common_25.newSize(16, 16);
            this.itemSpawnedAfterKill = itemSpawned;
            this.Direction = direction_15.Direction.Left;
            this.Health = 1;
        }
        get DamageToPlayer() {
            return 1;
        }
        get moveBeforeFrameChange() {
            return 0;
        }
        get RespawnAtRoomEntry() {
            return true;
        }
        get movementSprites() {
            return ZakFoe.zakFoeSprites;
        }
        TakeTurn() {
            let stepValue = { nextStepValue: { img: this.imgid, dy: 0 } };
            this.animation.doAnimation(this.timer, stepValue);
            this.imgid = stepValue.nextStepValue.img;
            this.pos.y += stepValue.nextStepValue.dy;
            if (this.imgid == resourceids_24.BitmapId.ZakFoe_2) {
                switch (this.Direction) {
                    case direction_15.Direction.Left:
                        this.pos.x -= 1;
                        if (this.pos.x <= 0)
                            this.Direction = direction_15.Direction.Right;
                        if (sintervaniamodel_25.GameModel._.CurrentRoom.AnyCollisionsTiles(true, { x: this.hitbox_sx, y: this.hitbox_sy }, { x: this.hitbox_sx, y: this.hitbox_ey }))
                            this.Direction = direction_15.Direction.Right;
                        if (!sintervaniamodel_25.GameModel._.CurrentRoom.AnyCollisionsTiles(true, { x: this.hitbox_sx, y: this.hitbox_ey + msx_15.TileSize + 4 }))
                            this.Direction = direction_15.Direction.Right;
                        break;
                    case direction_15.Direction.Right:
                        this.pos.x += 1;
                        if (this.pos.x >= gameconstants_11.GameConstants.GameScreenWidth)
                            this.Direction = direction_15.Direction.Left;
                        if (sintervaniamodel_25.GameModel._.CurrentRoom.AnyCollisionsTiles(true, { x: this.hitbox_ex, y: this.hitbox_sy }, { x: this.hitbox_ex, y: this.hitbox_ey }))
                            this.Direction = direction_15.Direction.Left;
                        if (!sintervaniamodel_25.GameModel._.CurrentRoom.AnyCollisionsTiles(true, { x: this.hitbox_ex, y: this.hitbox_ey + msx_15.TileSize + 4 }))
                            this.Direction = direction_15.Direction.Left;
                        break;
                }
            }
            super.TakeTurn();
        }
        Dispose() {
            btimer_15.BStopwatch.removeWatch(this.timer);
        }
        HandleHit(source) {
            super.HandleHit(source);
            this.loseHealth(source);
        }
        Paint(offset = null) {
            this.flippedH = this.Direction == direction_15.Direction.Left ? true : false;
            super.Paint(offset);
        }
    }
    exports.ZakFoe = ZakFoe;
    ZakFoe.ZakFoeHitArea = common_25.newArea(2, 2, 14, 14);
    ZakFoe.zakFoeSprites = new Map([
        [direction_15.Direction.Right, [resourceids_24.BitmapId.ZakFoe_1, resourceids_24.BitmapId.ZakFoe_2, resourceids_24.BitmapId.ZakFoe_3]],
        [direction_15.Direction.Left, [resourceids_24.BitmapId.ZakFoe_1, resourceids_24.BitmapId.ZakFoe_2, resourceids_24.BitmapId.ZakFoe_3]],
    ]);
});
