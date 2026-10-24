# Formato de skin do bonk.io

Fonte: código do jogo (`https://bonk.io/js/alpha2s.js`), lido numa versão desofuscada por uma
ferramenta baseada no [bonk-deobfuscator](https://github.com/kookywarrior/bonk-deobfuscator): classes `Skin` e
`BonkView` e a função `AvatarRenderer.createImage`.
Implementação independente e testada: [bonkSkinCodec.js](bonkSkinCodec.js). A saída do
`encodeSkin` é idêntica byte a byte à de `Skin.toString()` do jogo.

## Modelo de dados

```js
{
  bc: 0x448aff,            // cor de base (int 0..0xFFFFFF)
  layers: [                // no máximo 16 (fromObject rejeita mais)
    { id: 34,              // forma 1..115 = GameResources.svgStrings[id]
      scale: 0.4,          // float, -10..10 (o renderer usa |scale|)
      angle: -90,          // graus
      x: -5, y: 0,         // float, unidades de skin
      flipX: false, flipY: false,
      color: 0x190b0a }    // int 0..0xFFFFFF
  ]
}
```

`layers[0]` é a camada **de cima**: o renderer desenha de `layers.length-1` até `0`.

## Geometria (AvatarRenderer)

- A bola tem **raio 15 unidades**. Seja `u = raioEmPixels / 15`.
- Camada: sprite com âncora no centro, em `(x*u, y*u)`, girada `angle` graus.
- O SVG é rasterizado com escala `scale * u`, ou seja, no tamanho nativo do SVG × `scale * u`.
  Os SVGs têm tamanho próprio (ex.: o id 1 tem 72.95×100 px), centralizados na origem.
- Cor: `sprite.tint = color`. A tinta multiplica o SVG, então a forma sai na cor sólida da camada.
- Tudo é recortado pelo círculo (`mask`), com o fundo `bc` atrás.
- Camadas com `scale*u < 0.08` são ignoradas.
- No jogo com times, `AvatarRenderer.teamify` altera as cores. A prévia "FFA" usa as cores puras.

## Serialização (`Skin.toString`)

Binário big-endian (DataView), com cabeçalho estilo AMF fixo:

| bytes | conteúdo |
|---|---|
| `0A 07 03 61` | cabeçalho de objeto |
| `00 02` (short) | `hasBgColor` (≥2 indica que `bc` está no fim) |
| `09` | array |
| `n*2+1` | número de camadas |
| `01` | fim da parte associativa |
| por camada: `0A` + (`07 05 61 6C` na 1ª, `05` nas demais) | cabeçalho da camada |
| `00 01` short, `id` short | |
| `scale, angle, x, y` | float32 ×4 |
| `flipX, flipY` | 1 byte cada |
| `color` | int32 |
| `bc` | int32 no fim |

Depois vêm `btoa(...)` e `encodeURIComponent(...)`. Uma skin com 16 camadas ocupa ~530 bytes.

## Onde a skin é usada / como importar

1. **Conta logada (persistente):** ao salvar no editor, o jogo envia
   `POST https://bonk2.io/scripts/avatar_update.php` com
   `{ token, task: "updateavatar", newavatarslot: 1..5, newavatar: <string codificada> }`.
   No login, `info.avatar1..avatar5` voltam nesse formato e passam por `Skin.fromString`.
2. **Na sala (rede):** a skin viaja como **objeto JSON** `{layers, bc}`, não como string
   (pacote de criar/entrar na sala e lista de jogadores, ver `DemystifyBonk/Packets.md`).
   Quem recebe chama `Skin.fromObject`, que aplica `makeSafe` e o limite de 16 camadas.
3. **Convidado:** a skin vive só na memória (`game.avatar`), sem armazenamento local.

Caminho mais simples para importar: um userscript que, com o editor de skin aberto, chama a
mesma lógica de `fromString` sobre `editSkin`. Assim o usuário confere e clica em **Save**, e o
próprio jogo faz o POST. Isso evita manusear o token por fora.
