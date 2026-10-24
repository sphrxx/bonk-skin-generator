// Nomes das formas (iguais aos do editor do bonk, layerNames no alpha2s.js) e grupos
// usados pelo filtro de formas do gerador. O índice é o id da camada.

const SHAPE_NAMES = [, "Alien 1", "Alien 2", "Alien 3", "Alien 4", "Alien 5", "Alien 6", "Barbed wire 1", "Barbed wire 2", "Barbed wire 3", "Barbed wire 4", "Barbed wire 5", "Barbed wire 6", "Circle", "Crescent", "Cross 1", "Cross 2", "Cross 3", "Cross 4", "Cross 5", "Cross 6", "Cross 7", "Face 1", "Face 10", "Face 11", "Face 12", "Face 13", "Face 14", "Face 15", "Face 16", "Face 18", "Face 19", "Face 2", "Face 20", "Face 21", "Face 22", "Face 3", "Face 4", "Face 5", "Face 6", "Face 7", "Face 8", "Face 9", "Flames 1", "Flames 10", "Flames 2", "Flames 3", "Flames 4", "Flames 5", "Flames 6", "Flames 7", "Flames 8", "Flames 9", "Skull 1", "Cross", "Star", "Triangle", "Grunge circle", "Grunge heart 1", "Grunge heart 2", "Grunge leaf 1", "Grunge leaf 2", "Grunge leaf 3", "Skull 2", "Shoe print", "Hand print", "Finger print", "Print 2", "Grunge lines 1", "Grunge lines 2", "Splat", "Pentagon", "Rectangle 1", "Triangle tall 1", "Rectangle 2", "Rectangle 3", "Rectangle fat", "Semi circle", "Rounded rectangle", "Moon", "Triangle even", "Triangle tall 2", "Splat 1", "Splat 2", "Splat 3", "Square", "Star", "Radioactive 1", "World", "Signal", "Skull cross ", "Skull 3", "Exclamation", "Electricity", "Chain", "Scope 1", "Scope 2", "Radioactive 2", "Biohazard", "Fire 1", "Oxidiser", "Hazardous", "Ball", "Atomic", "Freeze", "Whisp 1", "Whisp 2", "Whisp 3", "Whisp 4", "Whisp 5", "Whisp 6", "Whisp 7", "Whisp 8", "Whisp 9", "Whisp 10", "Whisp 11"];

const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);

const SHAPE_GROUPS = [
	{
		key: "basic",
		name: "Formas básicas",
		hint: "círculos, retângulos, triângulos, estrelas…",
		ids: [13, 14, 21, 54, 55, 56, 71, ...range(72, 81), 85, 86, 102],
		on: true
	},
	{
		key: "face",
		name: "Partes de rosto",
		hint: "olhos, bocas, sobrancelhas, elipses",
		ids: range(22, 42),
		on: true
	},
	{
		key: "symbols",
		name: "Símbolos",
		hint: "cruzes, caveiras, alienígenas, ícones",
		ids: [...range(1, 6), ...range(15, 20), 53, 63, 87, 88, 89, 90, 91, ...range(92, 101), 103, 104],
		on: false
	},
	{
		key: "textures",
		name: "Texturas e respingos",
		hint: "chamas, manchas, arame farpado, redemoinhos",
		ids: [...range(7, 12), ...range(43, 52), ...range(57, 62), ...range(64, 70), ...range(82, 84), ...range(105, 115)],
		on: false
	}
];
