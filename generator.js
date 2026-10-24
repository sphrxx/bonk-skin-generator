// Otimizador que aproxima uma imagem com camadas de formas do bonk.io.
// Geometria igual à do AvatarRenderer: bola de raio 15 unidades, layers[0] é a camada de cima.

const SKIN_RADIUS = 15;
const MASK_RES = 128;

// Rasteriza as SVGs de BONK_SHAPES em máscaras binárias (alfa > 50%).
async function loadShapeMasks(svgStrings) {
	const shapes = [];
	await Promise.all(svgStrings.map((src, id) => {
		if (!src) {
			return null;
		}
		return new Promise(resolve => {
			const img = new Image();
			img.onload = () => {
				const w = img.naturalWidth;
				const h = img.naturalHeight;
				if (!w || !h) {
					return resolve();
				}
				const k = MASK_RES / Math.max(w, h);
				const mw = Math.max(1, Math.round(w * k));
				const mh = Math.max(1, Math.round(h * k));
				const canvas = document.createElement("canvas");
				canvas.width = mw;
				canvas.height = mh;
				const ctx = canvas.getContext("2d");
				ctx.drawImage(img, 0, 0, mw, mh);
				const data = ctx.getImageData(0, 0, mw, mh).data;
				const mask = new Uint8Array(mw * mh);
				let area = 0;
				for (let i = 0; i < mask.length; i++) {
					mask[i] = data[i * 4 + 3] > 127 ? 1 : 0;
					area += mask[i];
				}
				if (area > 0) {
					shapes[id] = { id, img, w, h, mw, mh, mk: mw / w, mask, fill: area / mask.length };
				}
				resolve();
			};
			img.onerror = () => resolve();
			img.src = src;
		});
	}));
	return shapes;
}

// Percorre os pixels (dentro do círculo) cobertos por uma camada, numa grade N×N.
function forEachCovered(layer, shape, N, inCircle, cb) {
	const R = N / 2;
	const u = R / SKIN_RADIUS;
	const rad = layer.angle * Math.PI / 180;
	const cos = Math.cos(rad);
	const sin = Math.sin(rad);
	const fx = (layer.flipX ? -1 : 1) / layer.scale;
	const fy = (layer.flipY ? -1 : 1) / layer.scale;
	const cx = R + layer.x * u;
	const cy = R + layer.y * u;
	const half = layer.scale * Math.hypot(shape.w, shape.h) / 2 * u;
	const x0 = Math.max(0, Math.floor(cx - half));
	const x1 = Math.min(N - 1, Math.ceil(cx + half));
	const y0 = Math.max(0, Math.floor(cy - half));
	const y1 = Math.min(N - 1, Math.ceil(cy + half));
	const { mask, mw, mh, mk, w, h } = shape;
	for (let py = y0; py <= y1; py++) {
		const sy = (py + .5 - cy) / u;
		for (let px = x0; px <= x1; px++) {
			const p = py * N + px;
			if (!inCircle[p]) {
				continue;
			}
			const sx = (px + .5 - cx) / u;
			const nx = ((cos * sx + sin * sy) * fx + w / 2) * mk;
			const ny = ((-sin * sx + cos * sy) * fy + h / 2) * mk;
			if (nx < 0 || ny < 0 || nx >= mw || ny >= mh) {
				continue;
			}
			if (mask[(ny | 0) * mw + (nx | 0)]) {
				cb(p);
			}
		}
	}
}

class SkinGenerator {
	// target: Float32Array N×N×3 em Lab (ver preprocess.js)
	// options.weights: peso por pixel (padrão 1); options.palette: cores Lab permitidas (ou null = livres)
	constructor(shapes, target, N, options) {
		this.shapes = shapes;
		this.target = target;
		this.N = N;
		this.opts = Object.assign({ layers: 16, candidates: 690, climb: 150, seeds: 4, refine: 4000, allowFlip: true }, options);
		// options.allowedShapes: ids que o gerador pode usar (padrão: todos)
		const allowed = this.opts.allowedShapes && this.opts.allowedShapes.length ? new Set(this.opts.allowedShapes) : null;
		this.shapeIds = shapes.map((s, id) => s && id).filter(id => id && (!allowed || allowed.has(id)));
		if (!this.shapeIds.length) {
			throw new Error("nenhuma forma permitida");
		}
		this.allowFlip = this.opts.allowFlip;
		this.palette = this.opts.palette && this.opts.palette.length ? this.opts.palette : null;
		this.inCircle = circleMask(N);
		this.weights = this.opts.weights || new Float32Array(N * N).fill(1);
		this.weightSum = 0;
		for (let p = 0; p < N * N; p++) {
			if (this.inCircle[p]) this.weightSum += this.weights[p];
		}
		this.owner = new Int16Array(N * N);
		this.curErr = new Float32Array(N * N);
		this.buckets = new Float64Array((this.opts.layers + 2) * 7);
		this.layers = [];
		this.bc = [0, 0, 0];
		this.phase = "greedy";
		this.refineDone = 0;
		this.refresh(this.layers);
	}

	// Diferença média ponderada (ΔE, distância em Lab) por pixel
	errorDeltaE(err) {
		return Math.sqrt(Math.max(0, err) / this.weightSum);
	}

	// Melhor cor para uma região, dadas as somas ponderadas do alvo nela
	// (n = Σw, s = Σw·T, sq = Σw·|T|²): a média, ou a cor da paleta de menor erro
	bestColor(n, s0, s1, s2, sq) {
		if (!this.palette) {
			return { color: [s0 / n, s1 / n, s2 / n], err: sq - (s0 * s0 + s1 * s1 + s2 * s2) / n };
		}
		let best = null, bestErr = Infinity;
		for (const c of this.palette) {
			const err = sq - 2 * (c[0] * s0 + c[1] * s1 + c[2] * s2) + n * (c[0] * c[0] + c[1] * c[1] + c[2] * c[2]);
			if (err < bestErr) {
				bestErr = err;
				best = c;
			}
		}
		return { color: best, err: bestErr };
	}

	// Desenha o "dono" de cada pixel (-1 = fundo, i = layers[i]) e calcula as cores ótimas
	// de cada camada nos pixels em que ela fica visível
	evaluate(layers) {
		const { N, inCircle, owner, target: T, weights: W } = this;
		owner.fill(-1);
		for (let i = layers.length - 1; i >= 0; i--) {
			forEachCovered(layers[i], this.shapes[layers[i].id], N, inCircle, p => { owner[p] = i; });
		}
		const k = layers.length + 1;
		const sums = new Float64Array(k * 6);
		for (let p = 0; p < N * N; p++) {
			if (!inCircle[p]) {
				continue;
			}
			const o = (owner[p] + 1) * 6;
			const i = p * 3;
			const w = W[p];
			sums[o]++;
			sums[o + 1] += w;
			sums[o + 2] += w * T[i];
			sums[o + 3] += w * T[i + 1];
			sums[o + 4] += w * T[i + 2];
			sums[o + 5] += w * (T[i] * T[i] + T[i + 1] * T[i + 1] + T[i + 2] * T[i + 2]);
		}
		let err = 0;
		const colors = [];
		for (let j = 0; j < k; j++) {
			const o = j * 6;
			const visible = sums[o];
			let color = j == 0 ? this.bc : layers[j - 1].color;
			if (visible) {
				const best = this.bestColor(sums[o + 1], sums[o + 2], sums[o + 3], sums[o + 4], sums[o + 5]);
				color = best.color;
				err += best.err;
			}
			colors.push({ color, visible });
		}
		return { err, colors };
	}

	applyEvaluation(layers, ev) {
		this.layers = layers.map((l, i) => Object.assign({}, l, { color: ev.colors[i + 1].color }));
		this.bc = ev.colors[0].color;
		this.err = ev.err;
	}

	// Aceita uma lista de camadas como estado atual e atualiza owner/curErr.
	// ev pode vir de um evaluate(layers) recém-feito, para não renderizar de novo.
	refresh(layers, ev = this.evaluate(layers)) {
		this.applyEvaluation(layers, ev);
		const { N, inCircle, owner, target: T } = this;
		for (let p = 0; p < N * N; p++) {
			if (!inCircle[p]) {
				this.curErr[p] = 0;
				continue;
			}
			const c = owner[p] < 0 ? this.bc : this.layers[owner[p]].color;
			const i = p * 3;
			const dr = T[i] - c[0], dg = T[i + 1] - c[1], db = T[i + 2] - c[2];
			this.curErr[p] = this.weights[p] * (dr * dr + dg * dg + db * db);
		}
		return ev;
	}

	// Melhor ganho ao inserir a camada em qualquer profundidade do estado atual.
	// Na profundidade d ela fica abaixo de layers[0..d-1] e só aparece nos pixels
	// cujo dono atual é o fundo ou layers[d..]; a cor é a melhor para esses pixels.
	scoreInsert(layer) {
		const k = this.layers.length;
		const B = this.buckets;
		B.fill(0, 0, (k + 1) * 7);
		const { target: T, owner, curErr, weights: W } = this;
		forEachCovered(layer, this.shapes[layer.id], this.N, this.inCircle, p => {
			// bucket 0 = fundo, j+1 = layers[j]
			const o = (owner[p] + 1) * 7;
			const i = p * 3;
			const w = W[p];
			B[o]++;
			B[o + 1] += w;
			B[o + 2] += w * T[i];
			B[o + 3] += w * T[i + 1];
			B[o + 4] += w * T[i + 2];
			B[o + 5] += w * (T[i] * T[i] + T[i + 1] * T[i + 1] + T[i + 2] * T[i + 2]);
			B[o + 6] += curErr[p];
		});
		let count = B[0], n = B[1], s0 = B[2], s1 = B[3], s2 = B[4], sq = B[5], old = B[6];
		let best = { delta: Infinity };
		for (let d = k; d >= 0; d--) {
			if (d < k) {
				const o = (d + 1) * 7;
				count += B[o]; n += B[o + 1]; s0 += B[o + 2]; s1 += B[o + 3]; s2 += B[o + 4]; sq += B[o + 5]; old += B[o + 6];
			}
			if (count < 3) {
				continue;
			}
			const c = this.bestColor(n, s0, s1, s2, sq);
			const delta = c.err - old;
			if (delta < best.delta) {
				best = { delta, color: c.color, depth: d };
			}
		}
		return best;
	}

	randomLayer(id = this.shapeIds[Math.floor(Math.random() * this.shapeIds.length)]) {
		const shape = this.shapes[id];
		// Centro sorteado entre alguns pixels, puxando para onde o erro é maior
		let best = -1, bestErr = -1;
		for (let k = 0; k < 6; k++) {
			const p = Math.floor(Math.random() * this.N * this.N);
			if (this.inCircle[p] && this.curErr[p] > bestErr) {
				best = p;
				bestErr = this.curErr[p];
			}
		}
		const u = this.N / 2 / SKIN_RADIUS;
		const x = best < 0 ? 0 : ((best % this.N) + .5 - this.N / 2) / u;
		const y = best < 0 ? 0 : (Math.floor(best / this.N) + .5 - this.N / 2) / u;
		// Tamanho (maior dimensão, em unidades) uniforme em escala log entre 2 e 45
		const size = 2 * Math.pow(22.5, Math.random());
		return {
			id,
			scale: size / Math.max(shape.w, shape.h),
			angle: Math.random() * 360 - 180,
			x, y,
			flipX: this.allowFlip && Math.random() < .5,
			flipY: this.allowFlip && Math.random() < .5,
			color: [0, 0, 0]
		};
	}

	mutate(layer, strength) {
		const m = Object.assign({}, layer);
		const r = Math.random();
		const gauss = () => (Math.random() + Math.random() + Math.random() - 1.5) * 1.4;
		// Deslocamentos proporcionais ao tamanho da forma
		const size = layer.scale * Math.max(this.shapes[layer.id].w, this.shapes[layer.id].h);
		const step = .3 + size * .12;
		if (r < .3) {
			m.x += gauss() * step * strength;
			m.y += gauss() * step * strength;
		} else if (r < .5) {
			m.scale *= Math.exp(gauss() * .25 * strength);
		} else if (r < .7) {
			m.angle += gauss() * 30 * strength;
		} else if (r < .8 && this.allowFlip) {
			if (Math.random() < .5) m.flipX = !m.flipX;
			else m.flipY = !m.flipY;
		} else if (r < .9) {
			// Troca a forma mantendo o tamanho aproximado
			const oldShape = this.shapes[m.id];
			m.id = this.shapeIds[Math.floor(Math.random() * this.shapeIds.length)];
			m.scale *= Math.max(oldShape.w, oldShape.h) / Math.max(this.shapes[m.id].w, this.shapes[m.id].h);
		} else {
			m.x += gauss() * step * .5 * strength;
			m.y += gauss() * step * .5 * strength;
			m.scale *= Math.exp(gauss() * .1 * strength);
			m.angle += gauss() * 10 * strength;
		}
		m.scale = Math.min(9.5, Math.max(.02, m.scale));
		m.x = Math.max(-25, Math.min(25, m.x));
		m.y = Math.max(-25, Math.min(25, m.y));
		m.angle = ((m.angle + 540) % 360) - 180;
		return m;
	}

	// Busca a melhor camada nova (forma, pose, profundidade): todas as formas em poses
	// aleatórias, depois hill climbing a partir das melhores sementes
	findLayer() {
		const { candidates, climb, seeds } = this.opts;
		const perShape = Math.max(1, Math.round(candidates / this.shapeIds.length));
		const pool = [];
		for (const id of this.shapeIds) {
			for (let i = 0; i < perShape; i++) {
				const layer = this.randomLayer(id);
				const s = this.scoreInsert(layer);
				if (s.color) {
					pool.push(Object.assign(s, { layer }));
				}
			}
		}
		pool.sort((a, b) => a.delta - b.delta);
		let best = null;
		for (let seed of pool.slice(0, seeds)) {
			for (let i = 0; i < climb; i++) {
				const layer = this.mutate(seed.layer, 1 - .8 * i / climb);
				const s = this.scoreInsert(layer);
				if (s.delta < seed.delta) {
					seed = Object.assign(s, { layer });
				}
			}
			if (!best || seed.delta < best.delta) {
				best = seed;
			}
		}
		return best;
	}

	addLayer() {
		const best = this.findLayer();
		if (!best || best.delta >= 0) {
			return false;
		}
		best.layer.color = best.color;
		const layers = this.layers.slice();
		layers.splice(best.depth, 0, best.layer);
		this.refresh(layers);
		return true;
	}

	// Refino global: muta uma camada (ou a ordem) e mantém se o erro cair.
	// De vez em quando remove uma camada e reinsere a melhor encontrada pela busca.
	refineStep() {
		const n = this.layers.length;
		const i = Math.floor(Math.random() * n);
		const r = Math.random();
		const progress = this.refineDone / this.opts.refine;
		if (r < .01 || this.invisible.has(i)) {
			this.reinsert(i);
		} else {
			const layers = this.layers.slice();
			if (r < .08 && n > 1) {
				const j = Math.min(n - 1, i + 1);
				[layers[i], layers[j]] = [layers[j], layers[i]];
			} else {
				layers[i] = this.mutate(layers[i], 1 - .85 * progress);
			}
			// Se rejeitado, owner fica com o teste; tudo bem, pois só reinsert usa owner
			// e ele chama refresh antes
			const ev = this.evaluate(layers);
			if (ev.err < this.err) {
				this.refresh(layers, ev);
				this.invisible = this.findInvisible(ev);
			}
		}
		this.refineDone++;
	}

	reinsert(i) {
		const before = this.layers;
		const beforeErr = this.err;
		this.refresh(before.filter((_, j) => j != i));
		if (!this.addLayer() || this.err >= beforeErr) {
			this.refresh(before);
		}
		this.invisible = this.findInvisible(this.evaluate(this.layers));
	}

	findInvisible(ev) {
		return new Set(ev.colors.slice(1).map((c, j) => c.visible ? -1 : j).filter(j => j >= 0));
	}

	// Executa trabalho por até budgetMs; devolve o progresso (0..1)
	step(budgetMs) {
		const end = performance.now() + budgetMs;
		while (performance.now() < end) {
			if (this.phase == "greedy") {
				if (this.layers.length >= this.opts.layers || !this.addLayer()) {
					this.invisible = this.findInvisible(this.evaluate(this.layers));
					this.phase = this.layers.length ? "refine" : "done";
				}
			} else if (this.phase == "refine") {
				if (this.refineDone >= this.opts.refine) {
					this.phase = "done";
				} else {
					this.refineStep();
				}
			} else {
				break;
			}
		}
		const greedyPart = .4;
		if (this.phase == "greedy") {
			return greedyPart * this.layers.length / this.opts.layers;
		}
		return this.phase == "done" ? 1 : greedyPart + (1 - greedyPart) * this.refineDone / this.opts.refine;
	}

	currentError() {
		return this.err;
	}

	toSkin() {
		const toInt = labToRgbInt;
		return {
			bc: toInt(this.bc),
			layers: this.layers.map(l => ({
				id: l.id,
				scale: l.scale,
				angle: l.angle,
				x: l.x,
				y: l.y,
				flipX: l.flipX,
				flipY: l.flipY,
				color: toInt(l.color)
			}))
		};
	}
}

// Desenho fiel ao jogo (fundo bc, camadas tingidas, recorte circular)
function drawSkin(ctx, skin, shapes, size) {
	const R = size / 2;
	const u = R / SKIN_RADIUS;
	const hex = c => "#" + c.toString(16).padStart(6, "0");
	ctx.clearRect(0, 0, size, size);
	ctx.save();
	ctx.beginPath();
	ctx.arc(R, R, R, 0, Math.PI * 2);
	ctx.clip();
	ctx.fillStyle = hex(skin.bc);
	ctx.fillRect(0, 0, size, size);
	const tmp = document.createElement("canvas");
	const tctx = tmp.getContext("2d");
	for (let i = skin.layers.length - 1; i >= 0; i--) {
		const l = skin.layers[i];
		const shape = shapes[l.id];
		if (!shape) {
			continue;
		}
		const s = Math.abs(l.scale) * u;
		tmp.width = Math.max(1, Math.ceil(shape.w * s));
		tmp.height = Math.max(1, Math.ceil(shape.h * s));
		tctx.globalCompositeOperation = "source-over";
		tctx.drawImage(shape.img, 0, 0, tmp.width, tmp.height);
		tctx.globalCompositeOperation = "source-in";
		tctx.fillStyle = hex(l.color);
		tctx.fillRect(0, 0, tmp.width, tmp.height);
		ctx.save();
		ctx.translate(R + l.x * u, R + l.y * u);
		ctx.rotate(l.angle * Math.PI / 180);
		ctx.scale(l.flipX ? -1 : 1, l.flipY ? -1 : 1);
		ctx.drawImage(tmp, -tmp.width / 2, -tmp.height / 2);
		ctx.restore();
	}
	ctx.restore();
}
