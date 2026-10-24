// Executa uma tentativa do SkinGenerator fora da thread da página.
// Recebe { shapes, target, N, options } e envia "progress" periodicamente e "done" no fim.
importScripts("preprocess.js", "generator.js");

onmessage = async e => {
	const { shapes, target, N, options } = e.data;
	const gen = new SkinGenerator(shapes, target, N, options);
	const report = (type, progress) => postMessage({
		type,
		progress,
		phase: gen.phase,
		layers: gen.layers.length,
		deltaE: gen.errorDeltaE(gen.currentError()),
		skin: gen.toSkin()
	});
	let lastReport = 0;
	while (gen.phase != "done") {
		const progress = gen.step(40);
		if (performance.now() - lastReport > 250) {
			lastReport = performance.now();
			report("progress", progress);
		}
		// Cede a vez para o navegador entregar um terminate() da página
		await new Promise(r => setTimeout(r, 0));
	}
	report("done", 1);
};
