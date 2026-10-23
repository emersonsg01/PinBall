'use strict';

/* =================================================================
   NEON ORBIT — pinball em canvas com física própria.
   Coordenadas lógicas da mesa: 600 x 1000, y crescendo para baixo.
   A física roda em passo fixo (STEP); o desenho roda a cada frame.
   ================================================================= */

// ---------- Constantes ----------
const W = 600, H = 1000;
const BALL_R = 11;
const GRAVITY = 1500;             // inclinação da mesa (unidades/s²)
const STEP = 1 / 600;             // passo fixo da física
const MAX_SPEED = 3800;
const LANE_X = 540;               // divisória da canaleta do lançador
const LANE_CX = 562.5;            // centro da canaleta
const PLUNGER_REST = 958;
const PLUNGER_TRAVEL = 36;
const MIRROR = 555;               // eixo de simetria do campo: x' = 555 - x
const CENTER_X = MIRROR / 2;
const BALLS_PER_GAME = 3;
const BALL_SAVE_TIME = 10;

const C = {
    cyan: '#22e8ff', magenta: '#ff2fd6', purple: '#8a5cff', yellow: '#ffd23f',
    orange: '#ff8a1f', green: '#39ff88', red: '#ff3b5c', white: '#ffffff',
};

// ---------- Utilidades ----------
const $ = (s) => document.querySelector(s);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const rand = (a, b) => a + Math.random() * (b - a);
const fmt = (n) => Math.round(n).toLocaleString('pt-BR');

function hexA(hex, a) {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

// ---------- Áudio sintetizado (sem arquivos) ----------
const Sound = {
    ctx: null, master: null, noiseBuf: null, muted: false, last: {},

    init() {
        if (this.ctx) {
            if (this.ctx.state === 'suspended') this.ctx.resume();
            return;
        }
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        this.master.gain.value = this.muted ? 0 : 0.4;
        const comp = this.ctx.createDynamicsCompressor();
        this.master.connect(comp);
        comp.connect(this.ctx.destination);
        const len = this.ctx.sampleRate;
        this.noiseBuf = this.ctx.createBuffer(1, len, len);
        const data = this.noiseBuf.getChannelData(0);
        for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    },

    setMuted(m) {
        this.muted = m;
        if (this.master) this.master.gain.value = m ? 0 : 0.4;
    },

    tone(freq, dur, { type = 'square', vol = 0.2, to = null, delay = 0 } = {}) {
        const t = this.ctx.currentTime + delay;
        const o = this.ctx.createOscillator();
        const g = this.ctx.createGain();
        o.type = type;
        o.frequency.setValueAtTime(freq, t);
        if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(vol, t + 0.005);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        o.connect(g);
        g.connect(this.master);
        o.start(t);
        o.stop(t + dur + 0.02);
    },

    noise(dur, { vol = 0.2, freq = 1500, q = 1, delay = 0 } = {}) {
        const t = this.ctx.currentTime + delay;
        const src = this.ctx.createBufferSource();
        src.buffer = this.noiseBuf;
        const f = this.ctx.createBiquadFilter();
        f.type = 'bandpass';
        f.frequency.value = freq;
        f.Q.value = q;
        const g = this.ctx.createGain();
        g.gain.setValueAtTime(vol, t);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        src.connect(f);
        f.connect(g);
        g.connect(this.master);
        src.start(t, Math.random() * 0.5);
        src.stop(t + dur + 0.02);
    },

    arp(notes, step, type = 'square', vol = 0.12) {
        notes.forEach((f, i) => this.tone(f, step * 1.8, { type, vol, delay: i * step }));
    },

    play(name) {
        if (!this.ctx || this.muted) return;
        // O modo demonstração fica em silêncio; só os sons de interface tocam.
        if (G.mode !== 'playing' && name !== 'start' && name !== 'gameover') return;
        const now = performance.now();
        if (this.last[name] && now - this.last[name] < 35) return;
        this.last[name] = now;
        switch (name) {
            case 'flipper':
                this.noise(0.06, { vol: 0.22, freq: 900, q: 0.7 });
                this.tone(140, 0.05, { type: 'triangle', vol: 0.2, to: 70 });
                break;
            case 'bumper':
                this.tone(rand(470, 560), 0.12, { vol: 0.15, to: 170 });
                this.noise(0.05, { vol: 0.2, freq: 3000 });
                break;
            case 'sling':
                this.tone(320, 0.09, { type: 'sawtooth', vol: 0.12, to: 120 });
                this.noise(0.04, { vol: 0.18, freq: 2000 });
                break;
            case 'target':
                this.tone(880, 0.07, { vol: 0.1 });
                this.tone(1320, 0.09, { vol: 0.09, delay: 0.06 });
                break;
            case 'drop':
                this.tone(240, 0.12, { type: 'sawtooth', vol: 0.13, to: 60 });
                this.noise(0.08, { vol: 0.2, freq: 600 });
                break;
            case 'lane':
                this.tone(660, 0.06, { type: 'triangle', vol: 0.18 });
                this.tone(990, 0.08, { type: 'triangle', vol: 0.15, delay: 0.05 });
                break;
            case 'launch':
                this.noise(0.25, { vol: 0.25, freq: 500, q: 0.5 });
                this.tone(90, 0.25, { type: 'sine', vol: 0.3, to: 320 });
                break;
            case 'drain':
                this.tone(392, 0.25, { type: 'sawtooth', vol: 0.12, to: 98 });
                this.tone(196, 0.5, { type: 'sawtooth', vol: 0.11, to: 49, delay: 0.22 });
                break;
            case 'saucer':
                this.tone(150, 0.3, { type: 'sine', vol: 0.3, to: 55 });
                this.noise(0.15, { vol: 0.2, freq: 400 });
                break;
            case 'eject':
                this.noise(0.1, { vol: 0.28, freq: 800 });
                this.tone(200, 0.1, { vol: 0.1, to: 420 });
                break;
            case 'complete':
                this.arp([523, 659, 784, 1047], 0.07);
                break;
            case 'jackpot':
                this.arp([523, 659, 784, 1047, 1319, 1568, 2093], 0.06, 'square', 0.11);
                this.arp([262, 330, 392, 523], 0.1, 'sawtooth', 0.08);
                break;
            case 'multiball':
                this.arp([392, 392, 523, 659, 784, 659, 784, 1047], 0.1, 'square', 0.12);
                break;
            case 'extra':
                this.arp([784, 988, 1175, 1568, 1175, 1568], 0.08, 'triangle', 0.2);
                break;
            case 'tilt':
                this.tone(110, 0.7, { type: 'sawtooth', vol: 0.2 });
                this.tone(117, 0.7, { type: 'sawtooth', vol: 0.2 });
                break;
            case 'warn':
                this.tone(220, 0.15, { vol: 0.14 });
                break;
            case 'nudge':
                this.noise(0.09, { vol: 0.32, freq: 180 });
                break;
            case 'start':
                this.arp([392, 523, 659, 784, 1047], 0.08, 'triangle', 0.2);
                break;
            case 'gameover':
                this.arp([523, 392, 330, 262, 196], 0.17, 'triangle', 0.2);
                break;
        }
    },
};

// ---------- Geometria da mesa ----------
const T = {
    walls: [], tubes: [], bumpers: [], slings: [], drops: [], standups: [],
    sensors: [], saucer: null, outer: null, animated: [], orbitFlash: 0,
};

function addSeg(x1, y1, x2, y2, o = {}) {
    const s = { x1, y1, x2, y2, e: o.e ?? 0.4, kind: o.kind || 'wall', owner: o.owner || null, oneWay: o.oneWay || null };
    T.walls.push(s);
    return s;
}

// Polilinha de colisão; com `tube`, também é desenhada como tubo neon.
function addPoly(pts, o, tube) {
    for (let i = 0; i < pts.length - 1; i++) addSeg(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], o);
    if (tube) T.tubes.push({ pts, ...tube });
}

function arcPts(cx, cy, r, a0, a1, n) {
    const pts = [];
    for (let i = 0; i <= n; i++) {
        const a = a0 + (a1 - a0) * (i / n);
        pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
    }
    return pts;
}

const mirror = (pts) => pts.map(([x, y]) => [MIRROR - x, y]);

function buildTable() {
    // Contorno: parede direita, arco do topo, parede esquerda.
    T.outer = [[585, 1000], ...arcPts(300, 290, 285, 0, -Math.PI, 60), [15, 1000]];
    addPoly(T.outer, { e: 0.35 }, { color: C.cyan, width: 5 });

    // Canaleta do lançador e portão de mão única no topo dela. O portão é
    // inclinado para a bola que cai sobre ele rolar de volta ao campo.
    addPoly([[LANE_X, 1000], [LANE_X, 330]], { e: 0.3 }, { color: C.purple, width: 4 });
    addSeg(LANE_X, 330, 585, 298, { oneWay: [-0.58, -0.81], e: 0.3 });
    T.tubes.push({ pts: [[LANE_X, 330], [585, 298]], color: C.white, width: 1.5 });

    // Defletor da órbita: devolve ao campo a bola que desce pela parede esquerda.
    addPoly([[15, 330], [62, 385]], { e: 0.5 }, { color: C.magenta, width: 5 });

    // Postes das três pistas do topo.
    for (const x of [215, 265, 315, 365]) addPoly([[x, 78], [x, 128]], { e: 0.45 }, { color: C.white, width: 4 });

    // Guias das inlanes (separam inlane e outlane).
    const guide = [[55, 650], [55, 800], [178, 884]];
    addPoly(guide, { e: 0.3 }, { color: C.magenta, width: 4 });
    addPoly(mirror(guide), { e: 0.3 }, { color: C.magenta, width: 4 });

    // Slingshots: só a face interna (hipotenusa) chuta.
    for (const side of [0, 1]) {
        let p = [[100, 672], [100, 782], [163, 826]];
        if (side) p = mirror(p);
        const sl = { pts: p, flash: 0, cool: 0, side };
        addSeg(p[0][0], p[0][1], p[1][0], p[1][1], { e: 0.3 });
        addSeg(p[1][0], p[1][1], p[2][0], p[2][1], { e: 0.3 });
        addSeg(p[0][0], p[0][1], p[2][0], p[2][1], { kind: 'sling', owner: sl, e: 0.5 });
        T.slings.push(sl);
    }

    T.bumpers.push(
        { x: 220, y: 215, r: 27, color: C.magenta, flash: 0, cool: 0 },
        { x: 335, y: 215, r: 27, color: C.cyan, flash: 0, cool: 0 },
        { x: 277, y: 300, r: 27, color: C.yellow, flash: 0, cool: 0 },
    );

    // Banco de drop targets no centro.
    [237, 277, 317].forEach((x, i) => {
        const d = { x, y: 465, w: 34, h: 12, down: false, flash: 0, i };
        const l = x - 17, r = x + 17, t = 459, b = 471;
        addSeg(l, t, r, t, { kind: 'drop', owner: d, e: 0.35 });
        addSeg(r, t, r, b, { kind: 'drop', owner: d, e: 0.35 });
        addSeg(r, b, l, b, { kind: 'drop', owner: d, e: 0.35 });
        addSeg(l, b, l, t, { kind: 'drop', owner: d, e: 0.35 });
        T.drops.push(d);
    });

    // Alvos fixos O·R·B na parede esquerda.
    [445, 490, 535].forEach((y, i) => {
        const s = { x: 24, y, flash: 0, cool: 0, i };
        addSeg(24, y - 15, 24, y + 15, { kind: 'standup', owner: s, e: 0.45 });
        T.standups.push(s);
    });

    T.saucer = { x: 470, y: 400, r: 17, flash: 0 };

    T.sensors.push(
        { x: 240, y: 103, r: 15, type: 'lane', i: 0, flash: 0 },
        { x: 290, y: 103, r: 15, type: 'lane', i: 1, flash: 0 },
        { x: 340, y: 103, r: 15, type: 'lane', i: 2, flash: 0 },
        { x: 77, y: 735, r: 15, type: 'inlane', flash: 0 },
        { x: MIRROR - 77, y: 735, r: 15, type: 'inlane', flash: 0 },
        { x: 35, y: 770, r: 15, type: 'outlane', flash: 0 },
        { x: MIRROR - 35, y: 770, r: 15, type: 'outlane', flash: 0 },
        { x: 300, y: 28, r: 18, type: 'orbit', flash: 0 },
    );

    T.animated = [...T.bumpers, ...T.slings, ...T.drops, ...T.standups, ...T.sensors, T.saucer];
}

// ---------- Flippers ----------
class Flipper {
    constructor(px, py, side) {
        this.px = px;
        this.py = py;
        this.len = 82;
        this.r1 = 13;      // raio na base
        this.r2 = 7;       // raio na ponta
        this.rest = side < 0 ? 0.5 : Math.PI - 0.5;
        this.up = side < 0 ? -0.45 : Math.PI + 0.45;
        this.angle = this.rest;
        this.omega = 0;
        this.pressed = false;
        this.ai = 0;       // temporizador do piloto automático da demonstração
    }

    update(dt) {
        const target = this.pressed ? this.up : this.rest;
        const speed = this.pressed ? 28 : 18;
        const step = clamp(target - this.angle, -speed * dt, speed * dt);
        this.angle += step;
        this.omega = step / dt;
    }

    // Cápsula afunilada girando em torno da base; a velocidade da superfície
    // no ponto de contato entra no impulso, o que dá força às tacadas.
    collide(b) {
        const ca = Math.cos(this.angle), sa = Math.sin(this.angle);
        const t = clamp(((b.x - this.px) * ca + (b.y - this.py) * sa) / this.len, 0, 1);
        const cx = this.px + ca * this.len * t;
        const cy = this.py + sa * this.len * t;
        const rad = this.r1 + (this.r2 - this.r1) * t;
        let nx = b.x - cx, ny = b.y - cy;
        const d = Math.hypot(nx, ny);
        const min = rad + b.r;
        if (d >= min || d === 0) return 0;
        nx /= d;
        ny /= d;
        const rx = cx + nx * rad - this.px;
        const ry = cy + ny * rad - this.py;
        return resolve(b, nx, ny, min - d, 0.25, -this.omega * ry, this.omega * rx);
    }
}

// ---------- Estado ----------
const G = {
    mode: 'attract',     // 'attract' | 'playing' | 'over'
    paused: false,
    score: 0, ballNum: 0, extra: 0, bonus: 0, mult: 1,
    lanes: [false, false, false], targets: [false, false, false],
    dropLevel: 1, dropBanks: 0, extraAwarded: false,
    lockLit: false, locks: 0, multiball: false, jackpot: 50000,
    save: 0, saveArmed: false, tiltMeter: 0, tilted: false,
    skill: { lane: 1, armed: false, t: 0 },
    orbits: 0, pendingAuto: 0, endingBall: false, lastScore: 0,
};

const balls = [];
const flippers = { left: new Flipper(190, 895, -1), right: new Flipper(MIRROR - 190, 895, 1) };
const plunger = { y: PLUNGER_REST, charge: 0, held: false };
const timers = [];
let time = 0;

function later(t, fn) {
    timers.push({ t, fn });
}

function makeBall(x, y) {
    return {
        x, y, vx: 0, vy: 0, r: BALL_R, trail: [], inside: new Set(),
        captured: false, capT: 0, lockRemove: false, saucerIgnore: 0,
        fresh: true, autoT: 0, launchT: 0, stuck: 0, demoWait: 0,
    };
}

function serveBall() {
    const b = makeBall(LANE_CX, plunger.y - BALL_R - 0.5);
    balls.push(b);
    return b;
}

const inLane = (b) => b.x > LANE_X && b.y > 340;
const laneOccupied = () => balls.some((b) => !b.captured && b.x > LANE_X && b.y > 600);

// ---------- Física ----------
function resolve(b, nx, ny, pen, e, svx, svy) {
    b.x += nx * pen;
    b.y += ny * pen;
    const vn = (b.vx - svx) * nx + (b.vy - svy) * ny;
    if (vn >= 0) return 0;
    const ee = -vn < 40 ? 0 : e;   // contato em repouso não quica
    b.vx -= (1 + ee) * vn * nx;
    b.vy -= (1 + ee) * vn * ny;
    return -vn;
}

function collideSeg(b, s) {
    const dx = s.x2 - s.x1, dy = s.y2 - s.y1;
    let t = ((b.x - s.x1) * dx + (b.y - s.y1) * dy) / (dx * dx + dy * dy);
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    let nx = b.x - (s.x1 + dx * t);
    let ny = b.y - (s.y1 + dy * t);
    const d2 = nx * nx + ny * ny;
    if (d2 >= b.r * b.r) return;
    const d = Math.sqrt(d2) || 0.0001;
    nx /= d;
    ny /= d;
    if (s.oneWay) {
        if (nx * s.oneWay[0] + ny * s.oneWay[1] <= 0) return;
        if (b.vx * nx + b.vy * ny >= 0) return;
    }
    const imp = resolve(b, nx, ny, b.r - d, s.e, 0, 0);
    if (s.kind === 'wall') return;

    const o = s.owner;
    if (s.kind === 'sling') {
        if (imp > 120 && o.cool <= 0) {
            const vn = b.vx * nx + b.vy * ny;
            if (vn < 1150) {
                b.vx += (1150 - vn) * nx;
                b.vy += (1150 - vn) * ny;
            }
            o.cool = 0.1;
            slingHit(o, b);
        }
    } else if (s.kind === 'standup') {
        if (imp > 80 && o.cool <= 0) {
            o.cool = 0.15;
            standupHit(o);
        }
    } else if (s.kind === 'drop') {
        if (imp > 60) dropHit(o);
    }
}

function collideBumper(b, bm) {
    const dx = b.x - bm.x, dy = b.y - bm.y;
    const min = bm.r + b.r;
    const d2 = dx * dx + dy * dy;
    if (d2 >= min * min) return;
    const d = Math.sqrt(d2) || 0.001;
    const nx = dx / d, ny = dy / d;
    resolve(b, nx, ny, min - d, 0.5, 0, 0);
    const vn = b.vx * nx + b.vy * ny;
    if (vn < 1050) {
        b.vx += (1050 - vn) * nx;
        b.vy += (1050 - vn) * ny;
    }
    if (bm.cool <= 0) {
        bm.cool = 0.08;
        bumperHit(bm);
    }
}

function collidePlunger(b) {
    if (b.x > LANE_X && b.y + b.r > plunger.y) {
        b.y = plunger.y - b.r;
        if (b.vy > 0) b.vy = b.vy > 120 ? -b.vy * 0.25 : 0;
    }
}

function checkSensors(b) {
    for (const s of T.sensors) {
        const dx = b.x - s.x, dy = b.y - s.y;
        const inside = dx * dx + dy * dy < s.r * s.r;
        if (inside && !b.inside.has(s)) {
            b.inside.add(s);
            sensorHit(s, b);
        } else if (!inside && b.inside.has(s)) {
            b.inside.delete(s);
        }
    }
}

function checkSaucer(b, dt) {
    if (b.saucerIgnore > 0) return;
    const s = T.saucer;
    const dx = s.x - b.x, dy = s.y - b.y;
    const d = Math.hypot(dx, dy);
    if (d > 34) return;
    // leve "funil" puxando a bola para dentro do buraco
    b.vx += (dx / (d || 1)) * 1400 * dt;
    b.vy += (dy / (d || 1)) * 1400 * dt;
    if (d < 10 && Math.hypot(b.vx, b.vy) < 1400) saucerCapture(b);
}

function physicsStep(dt) {
    flippers.left.update(dt);
    flippers.right.update(dt);

    for (const b of balls) {
        if (b.captured) continue;
        b.vy += GRAVITY * dt;
        const sp = Math.hypot(b.vx, b.vy);
        if (sp > MAX_SPEED) {
            b.vx *= MAX_SPEED / sp;
            b.vy *= MAX_SPEED / sp;
        }
        b.x += b.vx * dt;
        b.y += b.vy * dt;

        for (const s of T.walls) {
            if (s.owner && s.owner.down) continue;
            collideSeg(b, s);
        }
        for (const bm of T.bumpers) collideBumper(b, bm);
        flippers.left.collide(b);
        flippers.right.collide(b);
        collidePlunger(b);
        checkSensors(b);
        if (!b.captured) checkSaucer(b, dt);
    }

    // Colisão entre bolas (massas iguais).
    for (let i = 0; i < balls.length; i++) {
        const a = balls[i];
        if (a.captured) continue;
        for (let j = i + 1; j < balls.length; j++) {
            const b = balls[j];
            if (b.captured) continue;
            const dx = b.x - a.x, dy = b.y - a.y;
            const min = a.r + b.r;
            const d2 = dx * dx + dy * dy;
            if (d2 >= min * min || d2 === 0) continue;
            const d = Math.sqrt(d2);
            const nx = dx / d, ny = dy / d;
            const pen = (min - d) / 2;
            a.x -= nx * pen; a.y -= ny * pen;
            b.x += nx * pen; b.y += ny * pen;
            const vn = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
            if (vn < 0) {
                const imp = (-(1 + 0.9) * vn) / 2;
                a.vx -= imp * nx; a.vy -= imp * ny;
                b.vx += imp * nx; b.vy += imp * ny;
            }
        }
    }

    for (let i = balls.length - 1; i >= 0; i--) {
        if (balls[i].y > H + 40) drainBall(balls[i]);
    }
}

// ---------- Regras ----------
function addScore(p) {
    if (G.mode !== 'playing' || G.tilted) return 0;
    const pts = G.multiball ? p * 2 : p;
    G.score += pts;
    return pts;
}

// Mensagens no display só durante a partida (a demonstração tem seu próprio ciclo).
function say(l1, l2 = '', dur = 1.8, opts = {}) {
    if (G.mode === 'playing') DMD.message(l1, l2, dur, opts);
}

function scorePop(x, y, pts, color) {
    if (pts > 0) popText(x, y, fmt(pts), color);
}

function bumperHit(bm) {
    bm.flash = 1;
    scorePop(bm.x, bm.y - 34, addScore(150), bm.color);
    G.bonus += 50;
    Sound.play('bumper');
    burst(bm.x, bm.y, bm.color, 14, 380);
    shake(2.5);
}

function slingHit(sl, b) {
    sl.flash = 1;
    addScore(50);
    G.bonus += 20;
    Sound.play('sling');
    burst(b.x, b.y, C.magenta, 8, 260);
    shake(1.5);
}

function standupHit(t) {
    t.flash = 1;
    Sound.play('target');
    burst(30, t.y, C.cyan, 10, 260);
    if (!G.targets[t.i]) {
        G.targets[t.i] = true;
        scorePop(70, t.y, addScore(1000), C.cyan);
        G.bonus += 500;
    } else {
        addScore(300);
    }
    if (G.targets.every(Boolean)) {
        Sound.play('complete');
        if (G.multiball) {
            G.jackpot += 25000;
            say('JACKPOT', '+25.000', 1.6);
        } else if (!G.lockLit) {
            G.lockLit = true;
            say('TRAVA ACESA', 'ACERTE O BURACO', 2);
        } else {
            scorePop(70, t.y - 20, addScore(10000), C.cyan);
        }
        later(0.6, () => { G.targets = [false, false, false]; });
    }
}

function dropHit(d) {
    if (d.down) return;
    d.down = true;
    d.flash = 1;
    scorePop(d.x, d.y + 26, addScore(1500), C.orange);
    G.bonus += 500;
    Sound.play('drop');
    burst(d.x, d.y, C.orange, 16, 320);
    shake(2);
    if (T.drops.every((x) => x.down)) {
        const pts = addScore(15000 * G.dropLevel);
        say('ALVOS', fmt(pts), 1.8);
        G.dropLevel = Math.min(5, G.dropLevel + 1);
        G.dropBanks++;
        G.jackpot += 20000;
        Sound.play('complete');
        flashScreen(C.orange, 0.25);
        if (G.dropBanks === 3 && !G.extraAwarded) {
            G.extraAwarded = true;
            G.extra++;
            say('BOLA EXTRA', '', 2.5, { sparkle: true });
            Sound.play('extra');
        }
        later(1.5, resetDrops);
    }
}

function resetDrops() {
    for (const d of T.drops) d.down = false;
}

function laneHit(i) {
    const s = T.sensors[i];
    s.flash = 1;
    if (G.skill.t > 0 && G.skill.armed) {
        G.skill.armed = false;
        G.skill.t = 0;
        if (i === G.skill.lane) {
            const pts = addScore(25000);
            say('SKILL SHOT', fmt(pts), 2.2, { sparkle: true, now: true });
            Sound.play('jackpot');
            flashScreen(C.green, 0.35);
            burst(s.x, s.y, C.green, 30, 500);
        }
    }
    if (!G.lanes[i]) {
        G.lanes[i] = true;
        addScore(750);
        G.bonus += 300;
        Sound.play('lane');
    } else {
        addScore(250);
    }
    if (G.lanes.every(Boolean)) {
        if (G.mult < 5) {
            G.mult++;
            say('BONUS', 'X' + G.mult, 1.6);
        } else {
            say('BONUS MAXIMO', fmt(addScore(20000)), 1.6);
        }
        Sound.play('complete');
        later(0.6, () => { G.lanes = [false, false, false]; });
    }
}

function rotateLanes(dir) {
    if (dir < 0) G.lanes.push(G.lanes.shift());
    else G.lanes.unshift(G.lanes.pop());
    if (G.skill.armed) G.skill.lane = (G.skill.lane + (dir < 0 ? 2 : 1)) % 3;
}

function orbitHit() {
    T.orbitFlash = 1;
    G.orbits++;
    const pts = addScore(5000 + 2500 * Math.min(G.orbits - 1, 8));
    say('ORBITA', fmt(pts), 1.6);
    Sound.play('complete');
    burst(300, 30, C.orange, 20, 400);
}

function sensorHit(s, b) {
    switch (s.type) {
        case 'lane':
            laneHit(s.i);
            break;
        case 'inlane':
            s.flash = 1;
            addScore(1000);
            G.bonus += 200;
            Sound.play('lane');
            break;
        case 'outlane':
            s.flash = 1;
            addScore(2500);
            Sound.play('warn');
            break;
        case 'orbit':
            if (b.launchT > 2.5 && b.vx < 0) orbitHit();
            break;
    }
}

const MYSTERY = [
    ['10.000 PONTOS', () => addScore(10000)],
    ['25.000 PONTOS', () => addScore(25000)],
    ['TRAVA ACESA', () => { G.lockLit = true; }],
    ['BONUS +1X', () => { G.mult = Math.min(5, G.mult + 1); }],
    ['BOLA SALVA', () => { G.save = Math.max(G.save, 10); }],
];

function saucerCapture(b) {
    const s = T.saucer;
    b.captured = true;
    b.x = s.x;
    b.y = s.y;
    b.vx = b.vy = 0;
    b.capT = 1.0;
    b.trail.length = 0;
    s.flash = 1;
    Sound.play('saucer');
    shake(4);
    burst(s.x, s.y, C.green, 18, 300);

    if (G.multiball) {
        const pts = addScore(G.jackpot);
        say('JACKPOT', fmt(pts), 2.5, { sparkle: true, now: true });
        Sound.play('jackpot');
        flashScreen(C.yellow, 0.5);
        burst(s.x, s.y, C.yellow, 50, 700);
        shake(10);
        G.jackpot += 25000;
        b.capT = 1.6;
    } else if (G.lockLit) {
        G.lockLit = false;
        G.locks++;
        if (G.locks >= 2) {
            startMultiball(b);
        } else {
            b.lockRemove = true;
            b.capT = 1.2;
            say('BOLA', 'TRAVADA', 2);
            Sound.play('complete');
        }
    } else {
        addScore(2500);
        const [label, fn] = MYSTERY[Math.floor(Math.random() * MYSTERY.length)];
        fn();
        say('MISTERIO', label, 2);
    }
}

function startMultiball(b) {
    G.multiball = true;
    G.locks = 0;
    b.capT = 2.2;
    say('MULTIBOLA', '', 3, { sparkle: true, now: true });
    Sound.play('multiball');
    flashScreen(C.magenta, 0.6);
    shake(8);
    later(1.2, () => {
        G.pendingAuto += 2;
        G.save = Math.max(G.save, 12);
    });
}

function releaseCaptured(b) {
    if (b.lockRemove) {
        balls.splice(balls.indexOf(b), 1);
        serveBall();
        say('LANCE A', 'PROXIMA BOLA', 2);
        return;
    }
    const s = T.saucer;
    b.captured = false;
    const a = Math.atan2(800 - s.y, 230 - s.x) + rand(-0.12, 0.12);
    const sp = rand(850, 1000);
    b.vx = Math.cos(a) * sp;
    b.vy = Math.sin(a) * sp;
    b.saucerIgnore = 0.5;
    Sound.play('eject');
    burst(s.x, s.y, C.green, 12, 300);
}

function launchBall(b, power) {
    b.vy = -(550 + power * 2050);
    b.vx = 0;
    b.launchT = 0;
    b.demoWait = 0;
    if (b.fresh) {
        b.fresh = false;
        if (G.saveArmed) {
            G.save = BALL_SAVE_TIME;
            G.saveArmed = false;
        }
        if (G.skill.armed) G.skill.t = 4;
    }
    Sound.play('launch');
}

function releasePlunger() {
    if (!plunger.held) return;
    plunger.held = false;
    const power = plunger.charge;
    plunger.charge = 0;
    for (const b of balls) {
        if (!b.captured && b.x > LANE_X && b.y > plunger.y - b.r - 12) launchBall(b, power);
    }
}

function drainBall(b) {
    balls.splice(balls.indexOf(b), 1);
    const remaining = balls.filter((x) => !x.lockRemove).length + G.pendingAuto;

    if (G.mode !== 'playing') {
        if (remaining <= 1) G.multiball = false;
        return;
    }
    if (G.save > 0 && !G.tilted) {
        G.pendingAuto++;
        say('BOLA SALVA', '', 1.8, { now: !G.multiball });
        flashScreen(C.green, 0.2);
        return;
    }
    if (remaining > 0) {
        if (G.multiball && remaining === 1) {
            G.multiball = false;
            say('FIM DA', 'MULTIBOLA', 1.8);
        }
        return;
    }
    endOfBall();
}

function endOfBall() {
    G.endingBall = true;
    G.multiball = false;
    G.save = 0;
    G.skill.armed = false;
    flippers.left.pressed = flippers.right.pressed = false;
    Sound.play('drain');
    if (G.tilted) {
        say('TILT', 'SEM BONUS', 2.2, { now: true });
        later(2.4, nextBall);
        return;
    }
    const total = G.bonus * G.mult;
    say('BONUS', `${fmt(G.bonus)} X${G.mult}`, 1.4, { now: true });
    say('TOTAL', fmt(total), 1.4);
    later(1.4, () => {
        G.score += total;
        Sound.play('complete');
    });
    later(3.0, nextBall);
}

function nextBall() {
    G.endingBall = false;
    G.tilted = false;
    G.tiltMeter = 0;
    G.bonus = 0;
    G.mult = 1;
    if (G.extra > 0) {
        G.extra--;
        say('JOGUE', 'DE NOVO', 2, { now: true });
    } else {
        G.ballNum++;
        if (G.ballNum > BALLS_PER_GAME) {
            gameOver();
            return;
        }
        say('BOLA ' + G.ballNum, '', 1.5, { now: true });
    }
    armBall();
    serveBall();
}

function armBall() {
    G.saveArmed = true;
    G.skill.lane = Math.floor(Math.random() * 3);
    G.skill.armed = true;
    G.skill.t = 0;
}

function nudge() {
    if (G.mode !== 'playing' || G.paused || G.tilted || G.endingBall) return;
    for (const b of balls) {
        if (b.captured || inLane(b)) continue;
        b.vx += rand(-140, 140);
        b.vy -= rand(120, 200);
    }
    shake(9);
    Sound.play('nudge');
    G.tiltMeter += 1;
    if (G.tiltMeter >= 3.2) {
        G.tilted = true;
        G.save = 0;
        flippers.left.pressed = flippers.right.pressed = false;
        say('TILT', '', 3, { blink: true, now: true });
        Sound.play('tilt');
        flashScreen(C.red, 0.5);
    } else if (G.tiltMeter >= 2) {
        say('CUIDADO', '', 1, { blink: true, now: true });
        Sound.play('warn');
    }
}

function newGame() {
    Sound.init();
    timers.length = 0;
    balls.length = 0;
    particles.length = 0;
    texts.length = 0;
    Object.assign(G, {
        mode: 'playing', paused: false, score: 0, ballNum: 1, extra: 0, bonus: 0, mult: 1,
        lanes: [false, false, false], targets: [false, false, false],
        dropLevel: 1, dropBanks: 0, extraAwarded: false, lockLit: false, locks: 0,
        multiball: false, jackpot: 50000, save: 0, tiltMeter: 0, tilted: false,
        orbits: 0, pendingAuto: 0, endingBall: false,
    });
    resetDrops();
    flippers.left.pressed = flippers.right.pressed = false;
    plunger.held = false;
    plunger.charge = 0;
    armBall();
    serveBall();
    showScreen(null);
    Sound.play('start');
    DMD.message('BOA SORTE', 'BOLA 1', 2, { now: true });
}

function gameOver() {
    G.mode = 'over';
    G.lastScore = G.score;
    G.multiball = false;
    G.lanes = [false, false, false];
    G.targets = [false, false, false];
    G.lockLit = false;
    flippers.left.pressed = flippers.right.pressed = false;
    plunger.held = false;
    Sound.play('gameover');
    DMD.message('FIM DE JOGO', fmt(G.score), 4, { now: true });
    $('#finalScore').textContent = fmt(G.score);
    const qualifies = G.score > 0 && (highScores.length < 5 || G.score > highScores[highScores.length - 1].s);
    hsForm.hidden = !qualifies;
    showScreen('over');
    if (qualifies) setTimeout(() => hsName.focus(), 50);
}

// ---------- Piloto automático (modo demonstração) ----------
function autopilot(dt) {
    for (const f of [flippers.left, flippers.right]) {
        f.ai -= dt;
        if (f.pressed && f.ai <= 0) {
            f.pressed = false;
            f.ai = 0.12;
        }
    }
    for (const b of balls) {
        if (b.captured) continue;
        if (b.y > 815 && b.y < 925 && b.vy > -150) {
            const f = b.x < CENTER_X ? flippers.left : flippers.right;
            const along = Math.abs(b.x - f.px);
            if (along > 25 && along < 95 && !f.pressed && f.ai <= 0 && Math.random() < 0.3) {
                f.pressed = true;
                f.ai = 0.22;
            }
        }
        if (inLane(b) && b.y > 900 && Math.abs(b.vy) < 30 && !(b.autoT > 0)) {
            b.demoWait += dt;
            if (b.demoWait > 0.9) launchBall(b, rand(0.5, 1));
        }
    }
}

// ---------- Efeitos ----------
const particles = [];
const texts = [];
let shakeAmt = 0, shakeX = 0, shakeY = 0;
let flashA = 0, flashColor = C.white;

function burst(x, y, color, n = 12, speed = 300) {
    for (let i = 0; i < n && particles.length < 500; i++) {
        const a = Math.random() * Math.PI * 2;
        const s = rand(0.3, 1) * speed;
        const life = rand(0.3, 0.75);
        particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life, max: life, color, size: rand(1.5, 3.5) });
    }
}

function popText(x, y, text, color) {
    texts.push({ x, y, text, color, life: 1 });
}

function shake(a) {
    shakeAmt = Math.min(14, shakeAmt + a);
}

function flashScreen(color, a) {
    flashColor = color;
    flashA = Math.max(flashA, a);
}

// ---------- Atualização por frame ----------
function update(dt) {
    time += dt;

    const due = [];
    for (let i = timers.length - 1; i >= 0; i--) {
        timers[i].t -= dt;
        if (timers[i].t <= 0) {
            due.push(timers[i].fn);
            timers.splice(i, 1);
        }
    }
    due.reverse().forEach((fn) => fn());

    const playing = G.mode === 'playing';
    if (!playing) autopilot(dt);

    if (plunger.held) {
        plunger.charge = Math.min(1, plunger.charge + dt);
        plunger.y = PLUNGER_REST + plunger.charge * PLUNGER_TRAVEL;
    } else if (plunger.y > PLUNGER_REST) {
        plunger.y = Math.max(PLUNGER_REST, plunger.y - 2600 * dt);
    }

    // Bolas lançadas automaticamente (multibola, bola salva, demonstração).
    if (!playing && balls.length === 0 && G.pendingAuto === 0) G.pendingAuto = 1;
    if (G.pendingAuto > 0 && !G.endingBall && !laneOccupied()) {
        G.pendingAuto--;
        const b = serveBall();
        b.fresh = false;
        b.autoT = 0.55;
    }

    for (const b of balls.slice()) {
        b.launchT += dt;
        if (b.saucerIgnore > 0) b.saucerIgnore -= dt;
        if (b.autoT > 0) {
            b.autoT -= dt;
            if (b.autoT <= 0) launchBall(b, rand(0.72, 0.95));
        }
        if (b.captured) {
            b.capT -= dt;
            if (b.capT <= 0) releaseCaptured(b);
            continue;
        }
        b.trail.push(b.x, b.y);
        if (b.trail.length > 24) b.trail.splice(0, 2);
        // Bola parada fora do lançador: dá um empurrãozinho.
        if (Math.hypot(b.vx, b.vy) < 12 && !inLane(b) && b.y < 840) {
            b.stuck += dt;
            if (b.stuck > 3) {
                b.vx = rand(-300, 300);
                b.vy = -500;
                b.stuck = 0;
            }
        } else {
            b.stuck = 0;
        }
    }

    if (G.save > 0) G.save = Math.max(0, G.save - dt);
    if (G.skill.t > 0) {
        G.skill.t -= dt;
        if (G.skill.t <= 0) G.skill.armed = false;
    }
    G.tiltMeter = Math.max(0, G.tiltMeter - dt * 0.5);

    for (const o of T.animated) {
        if (o.flash > 0) o.flash = Math.max(0, o.flash - dt * 3);
        if (o.cool > 0) o.cool -= dt;
    }
    if (T.orbitFlash > 0) T.orbitFlash = Math.max(0, T.orbitFlash - dt * 1.5);

    for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.life -= dt;
        if (p.life <= 0) { particles.splice(i, 1); continue; }
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.vx *= 1 - 3 * dt;
        p.vy = p.vy * (1 - 3 * dt) + 400 * dt;
    }
    for (let i = texts.length - 1; i >= 0; i--) {
        const t = texts[i];
        t.life -= dt * 1.1;
        t.y -= 40 * dt;
        if (t.life <= 0) texts.splice(i, 1);
    }

    shakeAmt = Math.max(0, shakeAmt - dt * 40);
    shakeX = (Math.random() * 2 - 1) * shakeAmt;
    shakeY = (Math.random() * 2 - 1) * shakeAmt;
    flashA = Math.max(0, flashA - dt * 1.6);
}

// ---------- Display de matriz de pontos (DMD) ----------
const DMD = {
    canvas: $('#dmd'),
    ctx: null, src: null, sctx: null, grid: null,
    cols: 128, rows: 32, msgs: [], cur: null, t: 0,

    init() {
        this.ctx = this.canvas.getContext('2d');
        this.src = document.createElement('canvas');
        this.src.width = this.cols;
        this.src.height = this.rows;
        this.sctx = this.src.getContext('2d', { willReadFrequently: true });
        this.grid = document.createElement('canvas');
    },

    resize(cssW) {
        const pw = Math.round(cssW * dpr);
        const ph = Math.round(pw / 4);
        this.canvas.style.width = cssW + 'px';
        this.canvas.style.height = cssW / 4 + 'px';
        this.canvas.width = this.grid.width = pw;
        this.canvas.height = this.grid.height = ph;
        const g = this.grid.getContext('2d');
        const cell = pw / this.cols;
        g.fillStyle = '#0b0602';
        g.fillRect(0, 0, pw, ph);
        g.fillStyle = '#2a1406';
        g.beginPath();
        for (let y = 0; y < this.rows; y++) {
            for (let x = 0; x < this.cols; x++) {
                const cx = (x + 0.5) * cell, cy = (y + 0.5) * cell;
                g.moveTo(cx + cell * 0.38, cy);
                g.arc(cx, cy, cell * 0.38, 0, Math.PI * 2);
            }
        }
        g.fill();
    },

    message(l1, l2 = '', dur = 2, opts = {}) {
        const m = { l1, l2, dur, t: 0, ...opts };
        if (opts.now) {
            this.msgs.length = 0;
            this.cur = m;
        } else {
            this.msgs.push(m);
            if (this.msgs.length > 3) this.msgs.shift();
        }
    },

    update(dt) {
        this.t += dt;
        if (this.cur) {
            this.cur.t += dt;
            if (this.cur.t >= this.cur.dur) this.cur = null;
        }
        if (!this.cur && this.msgs.length) this.cur = this.msgs.shift();
    },

    // Escreve centralizado, reduzindo a fonte (16 → 12 → 8) até caber.
    text(str, y, size = 16) {
        const c = this.sctx;
        for (const s of [16, 12, 8]) {
            if (s > size) continue;
            c.font = `${s}px "Press Start 2P"`;
            const w = c.measureText(str).width;
            if (w <= 127 || s === 8) {
                c.fillText(str, Math.floor((128 - w) / 2), y + (size - s) / 2);
                return;
            }
        }
    },

    compose() {
        const c = this.sctx;
        c.fillStyle = '#000';
        c.fillRect(0, 0, 128, 32);
        c.fillStyle = '#ff9a2e';
        c.textBaseline = 'top';
        const m = this.cur;

        if (m) {
            const hidden = m.blink && Math.floor(m.t * 6) % 2 === 1;
            if (!hidden) {
                if (m.l2) {
                    this.text(m.l1, 2, 16);
                    this.text(m.l2, 22, 8);
                } else {
                    this.text(m.l1, 8, 16);
                }
            }
            if (m.sparkle) {
                for (let i = 0; i < 40; i++) c.fillRect(Math.floor(Math.random() * 128), Math.floor(Math.random() * 32), 1, 1);
            }
            return;
        }

        if (G.mode === 'playing') {
            this.text(fmt(G.score), 3, 16);
            c.font = '8px "Press Start 2P"';
            c.fillText('BOLA ' + Math.min(G.ballNum, BALLS_PER_GAME), 1, 24);
            let right = G.multiball ? 'MULTI' : 'X' + G.mult;
            if (G.tilted) right = 'TILT';
            else if (balls.some((b) => b.fresh && inLane(b)) && Math.floor(this.t * 2) % 2 === 0) right = 'LANCE!';
            c.fillText(right, 127 - c.measureText(right).width, 24);
            return;
        }

        // Ciclo de atração
        const phase = Math.floor(this.t / 3) % 4;
        if (phase === 0) {
            this.text('NEON', 0, 16);
            this.text('ORBIT', 16, 16);
        } else if (phase === 1) {
            this.text('APERTE', 0, 16);
            if (Math.floor(this.t * 2.5) % 2 === 0) this.text('START', 16, 16);
        } else if (phase === 2) {
            this.text('RECORDE', 2, 8);
            this.text(highScores.length ? `${highScores[0].n} ${fmt(highScores[0].s)}` : '0', 14, 16);
        } else if (G.lastScore > 0) {
            this.text('ULTIMO JOGO', 2, 8);
            this.text(fmt(G.lastScore), 14, 16);
        } else {
            this.text('PINBALL', 2, 16);
            this.text('SYNTHWAVE', 22, 8);
        }
    },

    render() {
        this.compose();
        const { ctx } = this;
        const pw = this.canvas.width, ph = this.canvas.height;
        const cell = pw / this.cols;
        const data = this.sctx.getImageData(0, 0, this.cols, this.rows).data;
        ctx.drawImage(this.grid, 0, 0);
        const bright = new Path2D(), dim = new Path2D();
        for (let y = 0; y < this.rows; y++) {
            for (let x = 0; x < this.cols; x++) {
                const v = data[(y * this.cols + x) * 4];
                if (v < 90) continue;
                const p = v > 180 ? bright : dim;
                const cx = (x + 0.5) * cell, cy = (y + 0.5) * cell;
                p.moveTo(cx + cell * 0.42, cy);
                p.arc(cx, cy, cell * 0.42, 0, Math.PI * 2);
            }
        }
        ctx.fillStyle = '#9a4a10';
        ctx.fill(dim);
        ctx.fillStyle = '#ffa23a';
        ctx.fill(bright);
        // brilho difuso por cima dos pontos
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = 0.28;
        ctx.imageSmoothingEnabled = true;
        ctx.drawImage(this.src, 0, 0, pw, ph);
        ctx.restore();
    },
};

// ---------- Canvas / layout ----------
const canvas = $('#table');
const ctx = canvas.getContext('2d');
const staticCanvas = document.createElement('canvas');
const sctx = staticCanvas.getContext('2d');
const playfield = $('#playfield');
let scale = 1, dpr = 1;

function layout() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    const vw = window.innerWidth, vh = window.innerHeight;
    const maxW = vw >= 1100 ? vw - 2 * 280 - 2 * 36 - 24 : vw - 16;
    // altura total ≈ mesa + display (largura/4) + molduras
    const tw = Math.floor(Math.min((0.6 * (vh - 52)) / 1.15, maxW));
    const th = Math.round(tw / 0.6);
    playfield.style.width = tw + 'px';
    playfield.style.height = th + 'px';
    canvas.width = staticCanvas.width = Math.round(tw * dpr);
    canvas.height = staticCanvas.height = Math.round(th * dpr);
    scale = canvas.width / W;
    DMD.resize(tw - 16);
    renderStatic();
}

// ---------- Desenho ----------
const glowCache = {};

function glowSprite(color) {
    if (!glowCache[color]) {
        const c = document.createElement('canvas');
        c.width = c.height = 128;
        const g = c.getContext('2d');
        const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
        gr.addColorStop(0, hexA(color, 1));
        gr.addColorStop(0.25, hexA(color, 0.5));
        gr.addColorStop(1, hexA(color, 0));
        g.fillStyle = gr;
        g.fillRect(0, 0, 128, 128);
        glowCache[color] = c;
    }
    return glowCache[color];
}

function glow(c, x, y, r, color, a = 1) {
    c.save();
    c.globalCompositeOperation = 'lighter';
    c.globalAlpha = clamp(a, 0, 1);
    c.drawImage(glowSprite(color), x - r, y - r, r * 2, r * 2);
    c.restore();
}

function circle(c, x, y, r) {
    c.beginPath();
    c.arc(x, y, r, 0, Math.PI * 2);
}

function strokePts(c, pts) {
    c.beginPath();
    pts.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y)));
    c.stroke();
}

function neonTube(c, pts, color, width) {
    c.save();
    c.lineJoin = 'round';
    c.lineCap = 'round';
    c.shadowColor = color;
    c.shadowBlur = 16 * scale;
    c.strokeStyle = hexA(color, 0.5);
    c.lineWidth = width + 5;
    strokePts(c, pts);
    c.shadowBlur = 8 * scale;
    c.strokeStyle = color;
    c.lineWidth = width;
    strokePts(c, pts);
    c.shadowBlur = 0;
    c.strokeStyle = 'rgba(255,255,255,0.85)';
    c.lineWidth = width * 0.35;
    strokePts(c, pts);
    c.restore();
}

// Camada fixa: fundo, arte e tubos neon. Redesenhada só ao redimensionar.
function renderStatic() {
    const c = sctx;
    c.setTransform(scale, 0, 0, scale, 0, 0);
    c.fillStyle = '#05030d';
    c.fillRect(0, 0, W, H);

    c.save();
    c.beginPath();
    T.outer.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y)));
    c.closePath();
    c.clip();

    const bg = c.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#140936');
    bg.addColorStop(0.55, '#1c0b44');
    bg.addColorStop(1, '#2a0a3e');
    c.fillStyle = bg;
    c.fillRect(0, 0, W, H);

    // Nebulosas
    for (const [x, y, r, col, a] of [[130, 260, 260, C.magenta, 0.16], [460, 520, 240, C.cyan, 0.1], [280, 120, 200, C.purple, 0.18]]) {
        const g = c.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, hexA(col, a));
        g.addColorStop(1, hexA(col, 0));
        c.fillStyle = g;
        c.fillRect(0, 0, W, H);
    }

    // Estrelas (semente fixa para a arte não mudar)
    let seed = 7;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < 140; i++) {
        c.fillStyle = `rgba(255,255,255,${0.15 + rnd() * 0.5})`;
        const s = rnd() * 1.6 + 0.4;
        c.fillRect(rnd() * W, rnd() * 680, s, s);
    }

    // Sol synthwave se pondo atrás do horizonte
    const sunY = 640, sunR = 82, horizon = 700;
    c.save();
    c.beginPath();
    c.rect(0, 0, W, horizon);
    c.clip();
    const halo = c.createRadialGradient(CENTER_X, sunY, sunR * 0.8, CENTER_X, sunY, sunR * 2.2);
    halo.addColorStop(0, hexA(C.magenta, 0.35));
    halo.addColorStop(1, hexA(C.magenta, 0));
    c.fillStyle = halo;
    c.fillRect(0, 0, W, horizon);
    const sun = c.createLinearGradient(0, sunY - sunR, 0, sunY + sunR);
    sun.addColorStop(0, C.yellow);
    sun.addColorStop(0.5, C.orange);
    sun.addColorStop(1, C.magenta);
    c.fillStyle = sun;
    circle(c, CENTER_X, sunY, sunR);
    c.fill();
    c.fillStyle = bg;   // faixas recortadas com a mesma cor do fundo
    for (let i = 0; i < 6; i++) {
        const y = sunY + 4 + i * 11;
        c.fillRect(CENTER_X - sunR, y, sunR * 2, 2 + i * 1.1);
    }
    c.restore();

    // Grade em perspectiva abaixo do horizonte
    c.save();
    c.beginPath();
    c.rect(15, horizon, LANE_X - 15, H - horizon);
    c.clip();
    c.strokeStyle = hexA(C.magenta, 0.22);
    c.lineWidth = 1.2;
    for (let i = -10; i <= 10; i++) {
        c.beginPath();
        c.moveTo(CENTER_X + i * 9, horizon);
        c.lineTo(CENTER_X + i * 95, H);
        c.stroke();
    }
    for (let k = 1; k <= 11; k++) {
        const y = horizon + (k / 11) ** 2 * (H - horizon);
        c.beginPath();
        c.moveTo(0, y);
        c.lineTo(W, y);
        c.stroke();
    }
    c.strokeStyle = hexA(C.magenta, 0.7);
    c.lineWidth = 2;
    c.beginPath();
    c.moveTo(15, horizon);
    c.lineTo(LANE_X, horizon);
    c.stroke();
    c.restore();

    // Logotipo
    c.save();
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.font = '900 30px Orbitron, sans-serif';
    c.shadowColor = C.magenta;
    c.shadowBlur = 18 * scale;
    c.fillStyle = '#fff';
    c.fillText('NEON ORBIT', CENTER_X, 742);
    c.shadowBlur = 0;
    c.font = '600 9px Orbitron, sans-serif';
    c.fillStyle = hexA(C.cyan, 0.8);
    c.fillText('· P I N B A L L ·', CENTER_X, 766);
    c.restore();

    // Canaleta do lançador
    c.fillStyle = 'rgba(0,0,0,0.38)';
    c.fillRect(LANE_X, 330, 585 - LANE_X, H - 330);
    c.strokeStyle = hexA(C.cyan, 0.25);
    c.lineWidth = 2;
    for (let y = 420; y < 900; y += 60) {
        c.beginPath();
        c.moveTo(LANE_CX - 9, y + 8);
        c.lineTo(LANE_CX, y);
        c.lineTo(LANE_CX + 9, y + 8);
        c.stroke();
    }

    // Rótulos dos alvos O·R·B
    c.font = '700 11px Orbitron, sans-serif';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillStyle = hexA(C.cyan, 0.75);
    ['O', 'R', 'B'].forEach((l, i) => c.fillText(l, 60, T.standups[i].y));

    c.restore();

    for (const t of T.tubes) neonTube(c, t.pts, t.color, t.width);
}

// Em modo demonstração as lâmpadas fazem uma onda; na partida mostram o estado real.
function lampState(on, idx) {
    if (G.mode !== 'playing') return Math.sin(time * 5 - idx * 0.7) > 0.35;
    return on;
}

function lamp(c, x, y, r, color, on) {
    if (on) glow(c, x, y, r * 3.2, color, 0.8);
    c.fillStyle = on ? color : hexA(color, 0.16);
    circle(c, x, y, r);
    c.fill();
    c.lineWidth = 1.5;
    c.strokeStyle = hexA(color, on ? 1 : 0.4);
    c.stroke();
    if (on) {
        c.fillStyle = 'rgba(255,255,255,0.7)';
        circle(c, x - r * 0.3, y - r * 0.3, r * 0.35);
        c.fill();
    }
}

function arrowInsert(c, x, y, angle, size, color, on) {
    c.save();
    c.translate(x, y);
    c.rotate(angle);
    if (on) glow(c, 0, 0, size * 2.4, color, 0.7);
    c.beginPath();
    c.moveTo(size, 0);
    c.lineTo(-size * 0.7, -size * 0.7);
    c.lineTo(-size * 0.35, 0);
    c.lineTo(-size * 0.7, size * 0.7);
    c.closePath();
    c.fillStyle = on ? color : hexA(color, 0.16);
    c.fill();
    c.strokeStyle = hexA(color, on ? 1 : 0.45);
    c.lineWidth = 1.5;
    c.stroke();
    c.restore();
}

function label(c, text, x, y, color, size = 9) {
    c.font = `700 ${size}px Orbitron, sans-serif`;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillStyle = color;
    c.fillText(text, x, y);
}

function drawLamps(c) {
    const blinkFast = Math.floor(time * 8) % 2 === 0;
    const blinkSlow = Math.floor(time * 3) % 2 === 0;

    // Pistas do topo (com skill shot piscando)
    for (let i = 0; i < 3; i++) {
        const s = T.sensors[i];
        let on = lampState(G.lanes[i], i);
        let color = C.yellow;
        if (G.mode === 'playing' && G.skill.armed && G.skill.lane === i) {
            color = C.green;
            on = blinkFast;
        }
        lamp(c, s.x, s.y, 9, color, on || s.flash > 0);
    }

    // Inlanes / outlanes
    for (let i = 3; i < 7; i++) {
        const s = T.sensors[i];
        const color = s.type === 'inlane' ? C.cyan : C.red;
        lamp(c, s.x, s.y, 6, color, s.flash > 0 || lampState(false, i));
    }

    // Alvos O·R·B
    T.standups.forEach((t, i) => lamp(c, 44, t.y, 6, C.cyan, lampState(G.targets[i], i + 3)));

    // Drop targets
    T.drops.forEach((d, i) => {
        const on = lampState(d.down, i + 6);
        if (on) glow(c, d.x, 492, 26, C.orange, 0.6);
        c.fillStyle = on ? C.orange : hexA(C.orange, 0.16);
        c.fillRect(d.x - 12, 489, 24, 6);
    });

    // Seta do saucer (trava / jackpot / mistério) e lâmpadas de trava
    let sLabel = 'MISTÉRIO', sColor = C.green, sOn = false;
    if (G.multiball) { sLabel = 'JACKPOT'; sColor = C.yellow; sOn = blinkFast; }
    else if (G.lockLit) { sLabel = 'TRAVA'; sColor = C.magenta; sOn = blinkSlow; }
    sOn = G.mode === 'playing' ? sOn || T.saucer.flash > 0 : lampState(false, 9);
    arrowInsert(c, 438, 448, -0.95, 13, sColor, sOn);
    label(c, sLabel, 432, 478, hexA(sColor, sOn ? 1 : 0.55));
    for (let i = 0; i < 2; i++) lamp(c, 497 + i * 18, 440, 5, C.magenta, lampState(G.locks > i, 10 + i));

    // Órbita
    const oOn = T.orbitFlash > 0 ? blinkFast : lampState(false, 12);
    arrowInsert(c, 515, 300, -Math.PI / 2, 11, C.orange, oOn);
    label(c, 'ÓRBITA', 515, 324, hexA(C.orange, oOn ? 1 : 0.5), 8);

    // Multiplicadores de bônus
    for (let k = 2; k <= 5; k++) {
        const x = CENTER_X - 60 + (k - 2) * 40;
        const on = lampState(G.mult >= k, 13 + k);
        lamp(c, x, 800, 12, C.purple, on);
        label(c, k + 'x', x, 800, on ? '#fff' : hexA('#ffffff', 0.4), 10);
    }

    // Bola salva
    const saveOn = G.mode === 'playing' ? G.save > 0 && (G.save > 3 || blinkFast) : lampState(false, 19);
    lamp(c, CENTER_X, 962, 9, C.green, saveOn);
    label(c, 'BOLA SALVA', CENTER_X, 984, hexA(C.green, saveOn ? 1 : 0.45), 8);
}

function drawSaucer(c) {
    const s = T.saucer;
    let color = C.green;
    if (G.multiball) color = C.yellow;
    else if (G.lockLit) color = C.magenta;
    glow(c, s.x, s.y, 44, color, 0.35 + s.flash * 0.6);
    const g = c.createRadialGradient(s.x, s.y, 2, s.x, s.y, s.r + 4);
    g.addColorStop(0, '#000');
    g.addColorStop(0.7, '#0a0418');
    g.addColorStop(1, hexA(color, 0.7));
    c.fillStyle = g;
    circle(c, s.x, s.y, s.r + 4);
    c.fill();
    c.strokeStyle = color;
    c.lineWidth = 2.5;
    c.stroke();
    // anel girando
    c.save();
    c.translate(s.x, s.y);
    c.rotate(time * 2);
    c.setLineDash([5, 6]);
    c.strokeStyle = hexA(color, 0.7);
    c.lineWidth = 1.5;
    circle(c, 0, 0, s.r + 9);
    c.stroke();
    c.restore();
}

function drawStandups(c) {
    for (const t of T.standups) {
        const lit = G.mode === 'playing' ? G.targets[t.i] : false;
        const color = t.flash > 0 ? C.white : lit ? C.cyan : C.purple;
        if (lit || t.flash > 0) glow(c, 21, t.y, 30, C.cyan, 0.5 + t.flash * 0.5);
        c.fillStyle = color;
        c.fillRect(16, t.y - 15, 9, 30);
        c.fillStyle = 'rgba(255,255,255,0.5)';
        c.fillRect(22, t.y - 13, 2, 26);
    }
}

function drawDrops(c) {
    for (const d of T.drops) {
        if (d.down) {
            c.fillStyle = 'rgba(0,0,0,0.5)';
            c.fillRect(d.x - 17, d.y - 2, 34, 4);
            c.strokeStyle = hexA(C.orange, 0.35);
            c.lineWidth = 1;
            c.strokeRect(d.x - 17, d.y - 2, 34, 4);
            continue;
        }
        glow(c, d.x, d.y, 34, C.orange, 0.3 + d.flash * 0.6);
        const g = c.createLinearGradient(0, d.y - 6, 0, d.y + 6);
        g.addColorStop(0, d.flash > 0 ? '#fff' : '#ffe08a');
        g.addColorStop(1, C.orange);
        c.fillStyle = g;
        c.beginPath();
        c.roundRect(d.x - 17, d.y - 6, 34, 12, 3);
        c.fill();
        c.strokeStyle = '#fff3';
        c.lineWidth = 1;
        c.stroke();
    }
}

function drawSlings(c) {
    for (const sl of T.slings) {
        const [a, b, d] = sl.pts;
        c.beginPath();
        c.moveTo(a[0], a[1]);
        c.lineTo(b[0], b[1]);
        c.lineTo(d[0], d[1]);
        c.closePath();
        const g = c.createLinearGradient(a[0], a[1], d[0], d[1]);
        g.addColorStop(0, hexA(C.magenta, 0.25 + sl.flash * 0.4));
        g.addColorStop(1, hexA(C.purple, 0.12 + sl.flash * 0.3));
        c.fillStyle = g;
        c.fill();
        c.strokeStyle = hexA(C.purple, 0.8);
        c.lineWidth = 2;
        c.stroke();
        // borracha que chuta
        if (sl.flash > 0) glow(c, (a[0] + d[0]) / 2, (a[1] + d[1]) / 2, 70, C.magenta, sl.flash);
        c.lineCap = 'round';
        c.strokeStyle = sl.flash > 0 ? '#fff' : C.magenta;
        c.lineWidth = 5;
        const off = sl.flash * 3 * (sl.side ? -1 : 1);
        c.beginPath();
        c.moveTo(a[0] + off, a[1]);
        c.lineTo(d[0] + off, d[1]);
        c.stroke();
    }
}

function drawBumpers(c) {
    for (const bm of T.bumpers) {
        const f = bm.flash;
        const r = bm.r * (1 + f * 0.12);
        glow(c, bm.x, bm.y, r * 2.6, bm.color, 0.3 + f * 0.7);
        c.fillStyle = '#100722';
        circle(c, bm.x, bm.y, r + 5);
        c.fill();
        c.strokeStyle = bm.color;
        c.lineWidth = 3;
        circle(c, bm.x, bm.y, r + 3);
        c.stroke();
        const g = c.createRadialGradient(bm.x - r * 0.3, bm.y - r * 0.3, 1, bm.x, bm.y, r);
        g.addColorStop(0, f > 0 ? '#fff' : hexA(bm.color, 0.95));
        g.addColorStop(0.6, hexA(bm.color, 0.55));
        g.addColorStop(1, '#1a0b33');
        c.fillStyle = g;
        circle(c, bm.x, bm.y, r - 2);
        c.fill();
        c.strokeStyle = 'rgba(255,255,255,0.75)';
        c.lineWidth = 1.5;
        circle(c, bm.x, bm.y, r * 0.45);
        c.stroke();
        label(c, '150', bm.x, bm.y + 1, '#fff', 9);
        if (f > 0) {
            c.strokeStyle = hexA(bm.color, f);
            c.lineWidth = 2;
            circle(c, bm.x, bm.y, r + 6 + (1 - f) * 22);
            c.stroke();
        }
    }
}

function drawFlipper(c, f) {
    const ca = Math.cos(f.angle), sa = Math.sin(f.angle);
    const tx = f.px + ca * f.len, ty = f.py + sa * f.len;
    c.beginPath();
    c.arc(f.px, f.py, f.r1, f.angle + Math.PI / 2, f.angle - Math.PI / 2);
    c.lineTo(tx + sa * f.r2, ty - ca * f.r2);
    c.arc(tx, ty, f.r2, f.angle - Math.PI / 2, f.angle + Math.PI / 2);
    c.closePath();
    glow(c, (f.px + tx) / 2, (f.py + ty) / 2, 70, C.cyan, f.pressed ? 0.55 : 0.25);
    const g = c.createLinearGradient(f.px - sa * 12, f.py + ca * 12, f.px + sa * 12, f.py - ca * 12);
    g.addColorStop(0, '#9fefff');
    g.addColorStop(0.5, '#ffffff');
    g.addColorStop(1, '#b9c4ff');
    c.fillStyle = g;
    c.fill();
    c.strokeStyle = C.cyan;
    c.lineWidth = 2.5;
    c.stroke();
    c.fillStyle = '#1a0b33';
    circle(c, f.px, f.py, 5);
    c.fill();
    c.strokeStyle = C.magenta;
    c.lineWidth = 2;
    c.stroke();
}

function drawPlunger(c) {
    const top = plunger.y;
    // mola
    c.strokeStyle = '#b8c0d8';
    c.lineWidth = 2;
    c.beginPath();
    const coils = 9, y0 = top + 10, y1 = 996;
    for (let i = 0; i <= coils * 2; i++) {
        const y = y0 + ((y1 - y0) * i) / (coils * 2);
        const x = LANE_CX + (i % 2 ? 9 : -9);
        if (i === 0) c.moveTo(LANE_CX, y);
        else c.lineTo(x, y);
    }
    c.stroke();
    // cabeça
    const g = c.createLinearGradient(0, top, 0, top + 10);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(1, '#7f88a8');
    c.fillStyle = g;
    c.beginPath();
    c.roundRect(LANE_X + 4, top, 585 - LANE_X - 8, 10, 3);
    c.fill();
    // medidor de força
    if (plunger.charge > 0) {
        const h = plunger.charge * 120;
        const color = plunger.charge > 0.85 ? C.red : plunger.charge > 0.5 ? C.yellow : C.green;
        glow(c, LANE_CX, top - 20 - h / 2, 40, color, 0.5);
        c.fillStyle = color;
        c.fillRect(LANE_X + 6, top - 20 - h, 5, h);
    }
}

function drawBall(c, b) {
    const tr = b.trail;
    for (let i = 0; i < tr.length; i += 2) {
        const k = i / tr.length;
        glow(c, tr[i], tr[i + 1], b.r * (0.6 + k), G.multiball ? C.magenta : C.cyan, k * 0.35);
    }
    c.fillStyle = 'rgba(0,0,0,0.35)';
    c.beginPath();
    c.ellipse(b.x + 4, b.y + 6, b.r, b.r * 0.8, 0, 0, Math.PI * 2);
    c.fill();
    const g = c.createRadialGradient(b.x - 4, b.y - 5, 1, b.x, b.y, b.r);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(0.3, '#dfe6f2');
    g.addColorStop(0.75, '#8a97b3');
    g.addColorStop(1, '#2b3245');
    c.fillStyle = g;
    circle(c, b.x, b.y, b.r);
    c.fill();
    // reflexo do neon na parte de baixo
    c.strokeStyle = hexA(C.magenta, 0.55);
    c.lineWidth = 2;
    c.beginPath();
    c.arc(b.x, b.y, b.r - 1.5, 0.35, Math.PI - 0.35);
    c.stroke();
}

function render() {
    const c = ctx;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, canvas.width, canvas.height);
    c.drawImage(staticCanvas, shakeX * scale, shakeY * scale);
    c.setTransform(scale, 0, 0, scale, shakeX * scale, shakeY * scale);

    drawLamps(c);
    drawSaucer(c);
    drawStandups(c);
    drawDrops(c);
    drawSlings(c);
    drawBumpers(c);
    drawFlipper(c, flippers.left);
    drawFlipper(c, flippers.right);
    drawPlunger(c);
    for (const b of balls) drawBall(c, b);

    c.save();
    c.globalCompositeOperation = 'lighter';
    for (const p of particles) {
        c.globalAlpha = p.life / p.max;
        c.fillStyle = p.color;
        circle(c, p.x, p.y, p.size);
        c.fill();
    }
    c.restore();

    for (const t of texts) {
        c.globalAlpha = clamp(t.life, 0, 1);
        c.font = '900 15px Orbitron, sans-serif';
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        c.lineWidth = 4;
        c.strokeStyle = 'rgba(10,4,30,0.85)';
        c.strokeText(t.text, t.x, t.y);
        c.fillStyle = t.color;
        c.fillText(t.text, t.x, t.y);
    }
    c.globalAlpha = 1;

    if (G.tilted && Math.floor(time * 3) % 2 === 0) {
        c.save();
        c.font = '900 72px Orbitron, sans-serif';
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        c.shadowColor = C.red;
        c.shadowBlur = 30 * scale;
        c.fillStyle = C.red;
        c.fillText('TILT', CENTER_X, 560);
        c.restore();
    }

    if (flashA > 0) {
        c.setTransform(1, 0, 0, 1, 0, 0);
        c.fillStyle = hexA(flashColor, flashA * 0.5);
        c.fillRect(0, 0, canvas.width, canvas.height);
    }
}

// ---------- Recordes ----------
const HS_KEY = 'neonOrbit.highscores';
const DEFAULT_SCORES = [
    { n: 'NEO', s: 400000 }, { n: 'SYN', s: 250000 }, { n: 'ORB', s: 150000 },
    { n: 'ZAP', s: 80000 }, { n: 'ARC', s: 40000 },
];
let highScores = loadScores();

function loadScores() {
    try {
        const a = JSON.parse(localStorage.getItem(HS_KEY));
        if (Array.isArray(a) && a.length) return a;
    } catch { /* armazenamento indisponível */ }
    return DEFAULT_SCORES.slice();
}

function saveScores() {
    try {
        localStorage.setItem(HS_KEY, JSON.stringify(highScores));
    } catch { /* armazenamento indisponível */ }
}

function renderScores(highlight = -1) {
    const ol = $('#uiScores');
    ol.innerHTML = '';
    highScores.forEach((h, i) => {
        const li = document.createElement('li');
        if (i === highlight) li.className = 'new';
        const n = document.createElement('span');
        n.className = 'n';
        n.textContent = h.n;
        const s = document.createElement('span');
        s.className = 's';
        s.textContent = fmt(h.s);
        li.append(n, s);
        ol.append(li);
    });
}

// ---------- Interface (DOM) ----------
const overlay = $('#overlay');
const hsForm = $('#hsForm');
const hsName = $('#hsName');
const ui = {
    score: $('#uiScore'), ball: $('#uiBall'), mult: $('#uiMult'), jackpot: $('#uiJackpot'),
    status: $('#uiStatus'),
    lanes: [...document.querySelectorAll('#uiLanes i')],
    targets: [...document.querySelectorAll('#uiTargets i')],
    drops: [...document.querySelectorAll('#uiDrops i')],
    locks: [...document.querySelectorAll('#uiLocks i')],
};
let uiTimer = 0;

function setText(el, v) {
    if (el.textContent !== v) el.textContent = v;
}

function updateUI(dt) {
    uiTimer -= dt;
    if (uiTimer > 0) return;
    uiTimer = 0.1;
    const playing = G.mode === 'playing';
    setText(ui.score, fmt(playing ? G.score : G.lastScore));
    setText(ui.ball, playing ? `${Math.min(G.ballNum, BALLS_PER_GAME)}/${BALLS_PER_GAME}` : '–');
    setText(ui.mult, G.mult + 'x');
    setText(ui.jackpot, fmt(G.jackpot));
    ui.lanes.forEach((el, i) => el.classList.toggle('on', playing && G.lanes[i]));
    ui.targets.forEach((el, i) => el.classList.toggle('on', playing && G.targets[i]));
    ui.drops.forEach((el, i) => el.classList.toggle('on', playing && T.drops[i].down));
    ui.locks.forEach((el, i) => el.classList.toggle('on', playing && G.locks > i));

    let status = 'Modo demonstração';
    if (playing) {
        if (G.tilted) status = 'TILT!';
        else if (G.multiball) status = 'Multibola: acerte o buraco!';
        else if (G.lockLit) status = 'Trava acesa: acerte o buraco';
        else if (G.save > 0) status = `Bola salva · ${Math.ceil(G.save)}s`;
        else if (G.extra > 0) status = 'Bola extra garantida';
        else status = 'Boa sorte!';
    } else if (G.paused) {
        status = 'Pausado';
    }
    setText(ui.status, status);
}

function showScreen(name) {
    overlay.classList.toggle('hidden', !name);
    for (const s of overlay.querySelectorAll('.screen')) s.classList.toggle('active', s.dataset.screen === name);
}

function togglePause() {
    if (G.mode !== 'playing') return;
    G.paused = !G.paused;
    flippers.left.pressed = flippers.right.pressed = false;
    plunger.held = false;
    plunger.charge = 0;
    showScreen(G.paused ? 'pause' : null);
}

function toggleMute() {
    Sound.init();
    Sound.setMuted(!Sound.muted);
    $('#btnSound').classList.toggle('muted', Sound.muted);
}

// ---------- Entrada ----------
const KEYS = {
    left: ['KeyZ', 'ArrowLeft', 'ShiftLeft'],
    right: ['Slash', 'IntlRo', 'NumpadDivide', 'ArrowRight', 'ShiftRight'],
    plunger: ['Space', 'ArrowDown', 'Enter'],
    nudge: ['ArrowUp', 'KeyN'],
};

function setFlipper(f, down, dir) {
    if (G.mode !== 'playing' || G.paused || G.tilted) {
        if (G.mode === 'playing') f.pressed = false;
        return;
    }
    if (down && !f.pressed) {
        Sound.play('flipper');
        rotateLanes(dir);
    }
    f.pressed = down;
}

function holdPlunger() {
    if (G.mode !== 'playing' || G.paused || plunger.held) return;
    plunger.held = true;
    plunger.charge = 0;
}

function isRightKey(e) {
    return KEYS.right.includes(e.code) || e.key === '/';
}

document.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLInputElement) return;
    const code = e.code;
    const handled = KEYS.left.includes(code) || isRightKey(e) || KEYS.plunger.includes(code) || KEYS.nudge.includes(code);
    if (handled) e.preventDefault();
    Sound.init();

    if (G.mode !== 'playing') {
        if ((code === 'Enter' || code === 'Space') && !e.repeat && hsForm.hidden) newGame();
        return;
    }
    if (code === 'KeyP' || code === 'Escape') {
        togglePause();
        return;
    }
    if (code === 'KeyM') {
        toggleMute();
        return;
    }
    if (G.paused) return;
    if (KEYS.left.includes(code)) setFlipper(flippers.left, true, -1);
    else if (isRightKey(e)) setFlipper(flippers.right, true, 1);
    else if (KEYS.plunger.includes(code)) holdPlunger();
    else if (KEYS.nudge.includes(code) && !e.repeat) nudge();
});

document.addEventListener('keyup', (e) => {
    if (KEYS.left.includes(e.code)) setFlipper(flippers.left, false, -1);
    else if (isRightKey(e)) setFlipper(flippers.right, false, 1);
    else if (KEYS.plunger.includes(e.code)) releasePlunger();
});

// Toque: metade esquerda/direita = flippers; embaixo à direita com bola no lançador = lançar.
const pointers = new Map();

playfield.addEventListener('pointerdown', (e) => {
    if (G.mode !== 'playing' || G.paused || e.target.closest('button')) return;
    Sound.init();
    const r = playfield.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width;
    const y = (e.clientY - r.top) / r.height;
    let kind;
    if (x < 0.5) kind = 'left';
    else if (y > 0.6 && balls.some((b) => !b.captured && inLane(b) && b.y > 880)) kind = 'plunger';
    else kind = 'right';
    pointers.set(e.pointerId, kind);
    if (kind === 'left') setFlipper(flippers.left, true, -1);
    else if (kind === 'right') setFlipper(flippers.right, true, 1);
    else holdPlunger();
    e.preventDefault();
});

function pointerEnd(e) {
    const kind = pointers.get(e.pointerId);
    if (!kind) return;
    pointers.delete(e.pointerId);
    const still = [...pointers.values()];
    if (kind === 'left' && !still.includes('left')) setFlipper(flippers.left, false, -1);
    else if (kind === 'right' && !still.includes('right')) setFlipper(flippers.right, false, 1);
    else if (kind === 'plunger') releasePlunger();
}

playfield.addEventListener('pointerup', pointerEnd);
playfield.addEventListener('pointercancel', pointerEnd);
playfield.addEventListener('contextmenu', (e) => e.preventDefault());

$('#btnStart').addEventListener('click', newGame);
$('#btnAgain').addEventListener('click', newGame);
$('#btnResume').addEventListener('click', togglePause);
$('#btnPause').addEventListener('click', togglePause);
$('#btnSound').addEventListener('click', toggleMute);

hsForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const name = (hsName.value.trim().toUpperCase().replace(/[^A-Z0-9]/g, '') || 'YOU').slice(0, 3);
    highScores.push({ n: name, s: G.lastScore });
    highScores.sort((a, b) => b.s - a.s);
    highScores = highScores.slice(0, 5);
    saveScores();
    renderScores(highScores.findIndex((h) => h.n === name && h.s === G.lastScore));
    hsForm.hidden = true;
    hsName.value = '';
    $('#btnAgain').focus();
});

window.addEventListener('blur', () => {
    flippers.left.pressed = flippers.right.pressed = false;
    releasePlunger();
});

document.addEventListener('visibilitychange', () => {
    if (document.hidden && G.mode === 'playing' && !G.paused) togglePause();
});

window.addEventListener('resize', layout);

// ---------- Laço principal ----------
let lastFrame = performance.now();
let acc = 0;

function frame(now) {
    const dt = Math.min(0.05, (now - lastFrame) / 1000);
    lastFrame = now;
    if (!G.paused) {
        update(dt);
        acc += dt;
        while (acc >= STEP) {
            physicsStep(STEP);
            acc -= STEP;
        }
        DMD.update(dt);
    }
    render();
    DMD.render();
    updateUI(dt);
    requestAnimationFrame(frame);
}

buildTable();
DMD.init();
layout();
renderScores();
if (document.fonts) {
    document.fonts.load('16px "Press Start 2P"');
    document.fonts.ready.then(renderStatic);
}
requestAnimationFrame(frame);
