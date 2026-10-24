// Pré-processamento da referência: espaço de cor perceptual (CIELAB), simplificação
// (suavização que preserva bordas + redução de cores por k-means) e pesos de borda.

function srgbToLinear(c) {
	c /= 255;
	return c <= .04045 ? c / 12.92 : Math.pow((c + .055) / 1.055, 2.4);
}

function linearToSrgb(c) {
	const v = c <= .0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - .055;
	return Math.max(0, Math.min(255, Math.round(v * 255)));
}

function rgbToLab(r, g, b) {
	r = srgbToLinear(r);
	g = srgbToLinear(g);
	b = srgbToLinear(b);
	const f = t => t > .008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116;
	const fx = f((.4124564 * r + .3575761 * g + .1804375 * b) / .95047);
	const fy = f(.2126729 * r + .7151522 * g + .072175 * b);
	const fz = f((.0193339 * r + .119192 * g + .9503041 * b) / 1.08883);
	return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

function labToRgb(L, a, b) {
	const fy = (L + 16) / 116;
	const fx = fy + a / 500;
	const fz = fy - b / 200;
	const finv = t => t * t * t > .008856 ? t * t * t : (t - 16 / 116) / 7.787;
	const x = .95047 * finv(fx);
	const y = finv(fy);
	const z = 1.08883 * finv(fz);
	return [
		linearToSrgb(3.2404542 * x - 1.5371385 * y - .4985314 * z),
		linearToSrgb(-.969266 * x + 1.8760108 * y + .041556 * z),
		linearToSrgb(.0556434 * x - .2040259 * y + 1.0572252 * z)
	];
}

function labToRgbInt(lab) {
	const [r, g, b] = labToRgb(lab[0], lab[1], lab[2]);
	return (r << 16) | (g << 8) | b;
}

function circleMask(N) {
	const mask = new Uint8Array(N * N);
	const R = N / 2;
	for (let py = 0; py < N; py++) {
		for (let px = 0; px < N; px++) {
			mask[py * N + px] = Math.hypot(px + .5 - R, py + .5 - R) <= R ? 1 : 0;
		}
	}
	return mask;
}

// Filtro bilateral: suaviza texturas e ruído mantendo as bordas fortes
function bilateral(lab, N, sigmaColor) {
	const out = new Float32Array(lab.length);
	const radius = 2;
	const sigmaSpace = 2;
	const inv2c = 1 / (2 * sigmaColor * sigmaColor);
	for (let py = 0; py < N; py++) {
		for (let px = 0; px < N; px++) {
			const i = (py * N + px) * 3;
			let wsum = 0, l = 0, a = 0, b = 0;
			for (let dy = -radius; dy <= radius; dy++) {
				const y = py + dy;
				if (y < 0 || y >= N) continue;
				for (let dx = -radius; dx <= radius; dx++) {
					const x = px + dx;
					if (x < 0 || x >= N) continue;
					const j = (y * N + x) * 3;
					const d0 = lab[i] - lab[j], d1 = lab[i + 1] - lab[j + 1], d2 = lab[i + 2] - lab[j + 2];
					const w = Math.exp(-(dx * dx + dy * dy) / (2 * sigmaSpace * sigmaSpace) - (d0 * d0 + d1 * d1 + d2 * d2) * inv2c);
					wsum += w;
					l += w * lab[j];
					a += w * lab[j + 1];
					b += w * lab[j + 2];
				}
			}
			out[i] = l / wsum;
			out[i + 1] = a / wsum;
			out[i + 2] = b / wsum;
		}
	}
	return out;
}

// k-means em Lab (inicialização k-means++ com semente fixa, para ser reprodutível)
function kmeans(lab, mask, K, pointWeights) {
	let seed = 12345;
	const rand = () => (seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296;
	const points = [];
	for (let p = 0; p < mask.length; p++) {
		if (mask[p]) points.push(p * 3);
	}
	const dist2 = (i, c) => {
		const d0 = lab[i] - c[0], d1 = lab[i + 1] - c[1], d2 = lab[i + 2] - c[2];
		return d0 * d0 + d1 * d1 + d2 * d2;
	};
	// Peso de cada ponto (importância pintada pelo usuário; padrão 1)
	const pw = points.map(i => pointWeights ? pointWeights[i / 3] : 1);
	const first = points[Math.floor(rand() * points.length)];
	const centers = [[lab[first], lab[first + 1], lab[first + 2]]];
	const best = new Float64Array(points.length).fill(Infinity);
	while (centers.length < K) {
		let total = 0;
		const c = centers[centers.length - 1];
		for (let k = 0; k < points.length; k++) {
			best[k] = Math.min(best[k], dist2(points[k], c));
			total += best[k] * pw[k];
		}
		if (total == 0) break;
		let r = rand() * total;
		let pick = points.length - 1;
		for (let k = 0; k < points.length; k++) {
			r -= best[k] * pw[k];
			if (r <= 0) { pick = k; break; }
		}
		const i = points[pick];
		centers.push([lab[i], lab[i + 1], lab[i + 2]]);
	}
	const assign = new Int32Array(points.length);
	let sums = [];
	for (let iter = 0; iter < 20; iter++) {
		sums = centers.map(() => [0, 0, 0, 0, 0]);
		let changed = 0;
		for (let k = 0; k < points.length; k++) {
			let bi = 0, bd = Infinity;
			for (let c = 0; c < centers.length; c++) {
				const d = dist2(points[k], centers[c]);
				if (d < bd) { bd = d; bi = c; }
			}
			if (assign[k] != bi) changed++;
			assign[k] = bi;
			const i = points[k];
			const w = pw[k];
			sums[bi][0] += w * lab[i];
			sums[bi][1] += w * lab[i + 1];
			sums[bi][2] += w * lab[i + 2];
			sums[bi][3] += w;
			sums[bi][4]++;
		}
		sums.forEach((s, c) => {
			if (s[3]) centers[c] = [s[0] / s[3], s[1] / s[3], s[2] / s[3]];
		});
		if (iter > 0 && changed == 0) break;
	}
	// size = peso total; count = nº de pixels
	return centers.map((c, i) => ({ color: c, size: sums[i][3], count: sums[i][4] })).filter(c => c.count > 0);
}

// Paleta de cores perceptivelmente distintas: k-means com grupos de sobra e depois
// funde os dois centros mais parecidos (menor ΔE) até sobrarem K. Degradês (tons de
// pele, céu) viram uma cor só, e cores pequenas mas diferentes (boca, olhos) sobrevivem.
// Grupos com importância média alta (pintados) resistem mais à fusão.
function distinctPalette(lab, mask, K, pointWeights) {
	const groups = kmeans(lab, mask, Math.max(2 * K, 16), pointWeights);
	while (groups.length > K) {
		let bi = 0, bj = 1, bd = Infinity;
		for (let i = 0; i < groups.length; i++) {
			for (let j = i + 1; j < groups.length; j++) {
				const a = groups[i], b = groups[j];
				const importance = Math.max(a.size / a.count, b.size / b.count);
				const d = Math.hypot(a.color[0] - b.color[0], a.color[1] - b.color[1], a.color[2] - b.color[2]) * Math.sqrt(importance);
				if (d < bd) { bd = d; bi = i; bj = j; }
			}
		}
		const a = groups[bi], b = groups[bj];
		const n = a.size + b.size;
		a.color = a.color.map((v, c) => (v * a.size + b.color[c] * b.size) / n);
		a.size = n;
		a.count += b.count;
		groups.splice(bj, 1);
	}
	return groups.map(g => g.color);
}

// Peso extra para regiões pequenas do mapa de cores (traços como olhos e boca):
// uma região com área A recebe sqrt(Aref / A), limitado a 1 + strength.
// Regiões que encostam na borda do círculo (pedaços de fundo) não ganham reforço.
function regionWeights(labels, mask, N, strength) {
	const comp = new Int32Array(N * N).fill(-1);
	const areas = [];
	const touchesBorder = [];
	const stack = [];
	let total = 0;
	for (let p = 0; p < N * N; p++) {
		if (mask[p]) total++;
	}
	for (let p = 0; p < N * N; p++) {
		if (!mask[p] || comp[p] >= 0) continue;
		const id = areas.length;
		let area = 0;
		let border = false;
		comp[p] = id;
		stack.push(p);
		while (stack.length) {
			const q = stack.pop();
			area++;
			const x = q % N, y = (q / N) | 0;
			for (const r of [x > 0 ? q - 1 : -1, x < N - 1 ? q + 1 : -1, y > 0 ? q - N : -1, y < N - 1 ? q + N : -1]) {
				if (r < 0 || !mask[r]) {
					border = true;
				} else if (comp[r] < 0 && labels[r] == labels[p]) {
					comp[r] = id;
					stack.push(r);
				}
			}
		}
		areas.push(area);
		touchesBorder.push(border);
	}
	const aref = total * .04;
	const out = new Float32Array(N * N);
	for (let p = 0; p < N * N; p++) {
		if (mask[p]) {
			const c = comp[p];
			out[p] = touchesBorder[c] ? 1 : Math.min(1 + strength, Math.max(1, Math.sqrt(aref / areas[c])));
		}
	}
	return out;
}

function nearestIndex(lab, i, palette) {
	let bi = 0, bd = Infinity;
	for (let c = 0; c < palette.length; c++) {
		const d0 = lab[i] - palette[c][0], d1 = lab[i + 1] - palette[c][1], d2 = lab[i + 2] - palette[c][2];
		const d = d0 * d0 + d1 * d1 + d2 * d2;
		if (d < bd) { bd = d; bi = c; }
	}
	return bi;
}

// Filtro de moda 3×3 sobre o mapa de cores: remove pontinhos isolados.
// Pixels com frozen[p] > 1 (marcados como importantes) ficam como estão.
function modeFilter(labels, mask, N, K, frozen) {
	const out = labels.slice();
	const count = new Int32Array(K);
	for (let py = 0; py < N; py++) {
		for (let px = 0; px < N; px++) {
			const p = py * N + px;
			if (!mask[p] || (frozen && frozen[p] > 1)) continue;
			count.fill(0);
			for (let dy = -1; dy <= 1; dy++) {
				for (let dx = -1; dx <= 1; dx++) {
					const x = px + dx, y = py + dy;
					if (x < 0 || y < 0 || x >= N || y >= N || !mask[y * N + x]) continue;
					count[labels[y * N + x]]++;
				}
			}
			let best = labels[p];
			for (let c = 0; c < K; c++) {
				if (count[c] > count[best]) best = c;
			}
			out[p] = best;
		}
	}
	return out;
}

// Peso por pixel: 1 nas áreas lisas, até 1+strength nas bordas (dilatado em 1 px)
function edgeWeights(lab, mask, N, strength) {
	const mag = new Float32Array(N * N);
	const at = (x, y, c) => lab[(Math.min(N - 1, Math.max(0, y)) * N + Math.min(N - 1, Math.max(0, x))) * 3 + c];
	for (let py = 0; py < N; py++) {
		for (let px = 0; px < N; px++) {
			let m = 0;
			for (let c = 0; c < 3; c++) {
				const gx = at(px + 1, py - 1, c) + 2 * at(px + 1, py, c) + at(px + 1, py + 1, c)
					- at(px - 1, py - 1, c) - 2 * at(px - 1, py, c) - at(px - 1, py + 1, c);
				const gy = at(px - 1, py + 1, c) + 2 * at(px, py + 1, c) + at(px + 1, py + 1, c)
					- at(px - 1, py - 1, c) - 2 * at(px, py - 1, c) - at(px + 1, py - 1, c);
				m += gx * gx + gy * gy;
			}
			// Sobel ~ 4× a diferença; ΔE ≈ 30 entre vizinhos já conta como borda forte
			mag[py * N + px] = Math.min(1, Math.sqrt(m) / 4 / 30);
		}
	}
	const weights = new Float32Array(N * N);
	for (let py = 0; py < N; py++) {
		for (let px = 0; px < N; px++) {
			const p = py * N + px;
			if (!mask[p]) continue;
			let g = 0;
			for (let dy = -1; dy <= 1; dy++) {
				for (let dx = -1; dx <= 1; dx++) {
					const x = px + dx, y = py + dy;
					if (x >= 0 && y >= 0 && x < N && y < N) g = Math.max(g, mag[y * N + x]);
				}
			}
			weights[p] = 1 + strength * g;
		}
	}
	return weights;
}

// rgba: pixels N×N da referência. Devolve o alvo em Lab, pesos, paleta (Lab) e prévia RGBA.
function prepareTarget(rgba, N, options) {
	const { simplify, colors, edgeEmphasis, usePalette } = options;
	// importance: multiplicador por pixel vindo do pincel (>1 importante, <1 ignorar)
	const importance = options.importance || null;
	const mask = circleMask(N);
	let lab = new Float32Array(N * N * 3);
	for (let p = 0; p < N * N; p++) {
		const c = rgbToLab(rgba[p * 4], rgba[p * 4 + 1], rgba[p * 4 + 2]);
		lab[p * 3] = c[0];
		lab[p * 3 + 1] = c[1];
		lab[p * 3 + 2] = c[2];
	}
	let palette = null;
	let labels = null;
	if (simplify > 0) {
		for (let i = 1; i < simplify; i++) {
			lab = bilateral(lab, N, 8 + 4 * simplify);
		}
		palette = distinctPalette(lab, mask, colors, importance);
		labels = new Int32Array(N * N);
		for (let p = 0; p < N * N; p++) {
			labels[p] = nearestIndex(lab, p * 3, palette);
		}
		for (let i = 0; i < simplify; i++) {
			labels = modeFilter(labels, mask, N, palette.length, importance);
		}
		for (let p = 0; p < N * N; p++) {
			const c = palette[labels[p]];
			lab[p * 3] = c[0];
			lab[p * 3 + 1] = c[1];
			lab[p * 3 + 2] = c[2];
		}
		// Descarta cores que sumiram depois da filtragem
		const used = new Set(labels.filter((_, p) => mask[p]));
		palette = palette.filter((_, c) => used.has(c));
	} else if (usePalette) {
		palette = distinctPalette(lab, mask, colors, importance);
	}
	// Peso final: o maior entre ênfase de borda e ênfase de região pequena
	const weights = edgeWeights(lab, mask, N, edgeEmphasis);
	if (labels && edgeEmphasis > 0) {
		const region = regionWeights(labels, mask, N, edgeEmphasis);
		for (let p = 0; p < N * N; p++) {
			weights[p] = Math.max(weights[p], region[p]);
		}
	}
	if (importance) {
		for (let p = 0; p < N * N; p++) {
			weights[p] *= importance[p];
		}
	}
	const preview = new Uint8ClampedArray(N * N * 4);
	for (let p = 0; p < N * N; p++) {
		const [r, g, b] = labToRgb(lab[p * 3], lab[p * 3 + 1], lab[p * 3 + 2]);
		preview[p * 4] = r;
		preview[p * 4 + 1] = g;
		preview[p * 4 + 2] = b;
		preview[p * 4 + 3] = mask[p] ? 255 : 0;
	}
	return {
		lab,
		weights,
		palette: usePalette ? palette : null,
		displayPalette: palette,
		preview
	};
}
