# Gerador de Skins para bonk.io

Gera automaticamente uma **skin do [bonk.io](https://bonk.io) a partir de uma imagem de referência**
e permite importá-la direto no editor de skins do jogo.

Uma skin do bonk é uma bola com uma cor de fundo e **no máximo 16 camadas**, cada uma usando uma
das **115 formas** do jogo (círculos, retângulos, olhos, bocas, estrelas, chamas…) com posição,
tamanho, rotação, espelhamento e uma cor sólida. Montar algo parecido com uma imagem à mão leva
horas; este projeto procura sozinho a combinação de formas que mais se parece com a imagem.

- Roda inteiro no navegador (HTML + JavaScript puro, sem dependências nem build).
- Gera a string de skin **no formato binário exato do jogo**: idêntica byte a byte à que o
  próprio bonk.io produz.
- Inclui um **userscript** que adiciona um botão **Importar** ao Skin Manager do jogo.

---

## Sumário

- [Como começar](#como-começar)
- [Usando o gerador](#usando-o-gerador)
- [Importando a skin no jogo](#importando-a-skin-no-jogo)
- [Dicas para melhores resultados](#dicas-para-melhores-resultados)
- [Como funciona](#como-funciona)
- [Formato da skin](#formato-da-skin)
- [Estrutura do projeto](#estrutura-do-projeto)
- [Limitações](#limitações)
- [Aviso](#aviso)

---

## Como começar

### Requisitos

- Um navegador moderno (Chrome, Edge, Firefox).
- [Node.js 18+](https://nodejs.org) — só para gerar o arquivo de formas (passo 2).
- Qualquer servidor HTTP estático: o exemplo usa Python, mas `npx serve` e similares também servem.

### Passo a passo

**1. Clone o repositório**

```bash
git clone https://github.com/sphrxx/bonk-skin-generator.git
cd bonk-skin-generator
```

**2. Gere o arquivo de formas (`shapes.js`)**

As 115 formas são arte do bonk.io e **não estão incluídas neste repositório**. O script abaixo
baixa o `GameResources.js` público do jogo e extrai as SVGs para um `shapes.js` local:

```bash
node tools/extract-shapes.js
```

Se preferir usar um arquivo já salvo (por exemplo, salvo pelo navegador a partir de
`https://bonk.io/GameResources.js`):

```bash
node tools/extract-shapes.js caminho/para/GameResources.js
```

O script lê o arquivo **como texto** e extrai as SVGs com uma expressão regular, sem executar
nenhum código do jogo.

**3. Sirva a pasta e abra no navegador**

```bash
python -m http.server 8765
```

Depois acesse <http://localhost:8765>.

> Abrir o `index.html` direto do disco (`file://`) também funciona, mas o navegador bloqueia os
> Web Workers nesse modo: as tentativas passam a rodar uma depois da outra, mais devagar.

---

## Usando o gerador

1. **Carregue uma imagem**: arraste para a área indicada, clique para escolher um arquivo ou cole
   com <kbd>Ctrl</kbd>+<kbd>V</kbd>. Há também dois exemplos prontos (bandeira e rosto).
2. **Confira o "Alvo do gerador"**: é a versão simplificada da imagem que o algoritmo vai tentar
   copiar, com a paleta de cores logo abaixo.
3. *(Opcional)* **Pinte a referência** com o pincel de importância (veja abaixo).
4. Clique em **Gerar**. A prévia mostra a melhor skin encontrada até o momento.
5. Copie a **string da skin** e importe no jogo, ou baixe o JSON.

Também dá para colar uma string de skin existente e clicar em **Visualizar string colada** para
ver como ela fica.

### Controles

| Controle | O que faz |
|---|---|
| **Camadas** | Quantas camadas usar (1–16). |
| **Qualidade** | Quanto o algoritmo procura por camada e quanto refina no final. Mais alto = melhor e mais lento. |
| **Tentativas** | Quantas execuções independentes rodar em paralelo (Web Workers). No fim fica a melhor. |
| **Zoom da imagem** | Aproxima a imagem dentro do círculo da bola. |
| **Simplificação** | Desligada → Forte. Suaviza texturas e ruído preservando as bordas e reduz a imagem a poucas cores, o que dá um visual "cartoon" que 16 formas conseguem representar. |
| **Cores** | Tamanho da paleta usada na simplificação (2–16). |
| **Ênfase em bordas** | Dá mais peso a contornos e a regiões pequenas no interior da imagem (olhos, boca). |
| **Usar só cores da paleta** | Cada forma recebe uma das cores da paleta, em vez de um tom intermediário "lamacento". |
| **Fundo p/ transparência** | Cor usada atrás de imagens com transparência. |
| **Permitir espelhar formas** | Libera o flip horizontal e vertical das formas. |
| **Formas permitidas** | Grupos de formas (básicas, partes de rosto, símbolos, texturas) ou escolha individual numa grade. |

### Pincel de importância

Embaixo da referência há um pincel para marcar o que importa:

- **Importante** (amarelo): olhos, boca, logo… O erro nessas áreas passa a custar mais, a cor
  delas ganha prioridade na paleta e a simplificação não as apaga.
- **Ignorar** (escuro): áreas que podem ser sacrificadas, como fundo e texturas (peso de 5%).
- **Apagar**, **tamanho do pincel**, **força** (×2 a ×12) e **Limpar pincel**.

No exemplo do rosto, pintar olhos e boca reduziu o erro nessas regiões em cerca de 34%, quase sem
custo no resto da imagem.

---

## Importando a skin no jogo

O arquivo [`bonk-skin-import.user.js`](bonk-skin-import.user.js) é um userscript que adiciona um
botão **Importar** ao Skin Manager do bonk.io.

### Instalação

1. Instale uma extensão de userscripts: [Tampermonkey](https://www.tampermonkey.net/) ou
   [Violentmonkey](https://violentmonkey.github.io/).
2. Crie um script novo, cole o conteúdo de `bonk-skin-import.user.js` e salve.
   Ele roda em `bonk.io/gameframe-release.html` e `bonkisback.io/gameframe-release.html`.

### Uso

1. No gerador, clique em **Copiar** na string da skin.
2. No bonk.io, entre na sua conta e abra o **Skin Manager**.
3. Selecione o slot que quer substituir e clique em **Importar**.
4. Cole a string. O editor do jogo abre com a skin carregada e você pode ajustá-la.
5. Clique em **Save**. Quem salva é o próprio jogo.

### Como o userscript funciona

Ao abrir o editor, o jogo carrega a skin do slot com `editSkin.fromString(skin.toString())`, e
`fromString` passa a string por `decodeURIComponent`. O script intercepta **uma única** dessas
chamadas, logo depois de você colar a string, e devolve a skin importada no lugar. Todas as outras
chamadas passam normalmente, e o gancho se desarma sozinho depois de 3 segundos se o editor não
abrir. O script nunca lê nem envia o seu token: o salvamento é o do próprio jogo.

Antes de importar, o script valida a string (cabeçalho, número de camadas e tamanho) e mostra um
erro se ela for inválida.

---

## Dicas para melhores resultados

- **Prefira imagens simples**: logos, bandeiras, emojis, personagens em estilo cartoon e rostos
  estilizados. Fotos viram uma versão estilizada.
- **Enquadre o assunto** com o zoom; o que fica fora do círculo é descartado.
- **Logos e bandeiras**: experimente deixar só as *Formas básicas*.
- **Personagens**: use o padrão (*Formas básicas* + *Partes de rosto*) e pinte olhos e boca como
  *Importante*.
- **Detalhes sumindo**: aumente **Cores** para 7–8 e **Ênfase em bordas** para ×4–×5.
- **Resultado muito variável**: aumente **Tentativas**.
- Pinte **depois** de ajustar o zoom: a marcação fica presa ao quadro da referência.

---

## Como funciona

```
imagem ─► pré-processamento ─► alvo (Lab) + pesos + paleta ─► otimizador (N tentativas) ─► melhor skin ─► string do jogo
          (simplificação,                                      em Web Workers
           paleta, pesos)
```

### 1. Pré-processamento ([`preprocess.js`](preprocess.js))

- A imagem é reduzida para 96×96 e recortada no círculo da bola.
- As cores são convertidas para **CIELAB**, um espaço de cor em que a distância (ΔE) se aproxima
  da diferença que o olho percebe.
- **Simplificação**: um filtro bilateral suaviza texturas sem borrar bordas. Depois a imagem é
  quantizada numa paleta e um filtro de moda remove pontinhos soltos.
- **Paleta de cores distintas**: o k-means roda com mais grupos do que o pedido e depois funde os
  centros mais parecidos. Assim degradês (tons de pele, céu) viram uma cor só, e cores pequenas mas
  diferentes (o vermelho de uma boca) sobrevivem.
- **Pesos por pixel**: mais peso em bordas (gradiente de Sobel) e em regiões pequenas no interior
  da imagem. Regiões que tocam a borda da bola (pedaços de fundo) não ganham reforço. O pincel de
  importância multiplica esses pesos.

### 2. Otimizador ([`generator.js`](generator.js))

O modelo de desenho reproduz o `AvatarRenderer` do jogo: bola de raio 15 unidades, cada forma
centralizada em `(x, y)`, girada, espelhada, escalada e pintada com cor sólida, e tudo recortado
no círculo. `layers[0]` é a camada de cima.

- **Construção gulosa**: a cada passo, testa todas as formas permitidas em poses aleatórias e refina
  as melhores sementes por *hill climbing*. Cada candidata pode ser **inserida em qualquer
  profundidade da pilha**, não só no topo. Isso foi decisivo: sem essa liberdade, um círculo
  colocado cedo impedia que um losango maior ficasse por baixo dele.
- **Avaliação rápida**: um mapa de "dono" de cada pixel permite avaliar todas as profundidades numa
  única passada. Com somas ponderadas, a melhor cor (média em Lab ou a cor da paleta de menor erro)
  sai em tempo constante.
- **Refino**: muta posição, tamanho, ângulo, espelhamento, forma e ordem das camadas, e de vez em
  quando remove uma camada e reinsere a melhor alternativa. Só aceita mudanças que reduzem o erro.
- **Várias tentativas** ([`worker.js`](worker.js)): cada tentativa roda num Web Worker com sua
  própria sorte, e a página fica com a de menor erro.

### 3. Codificação ([`bonkSkinCodec.js`](bonkSkinCodec.js))

`encodeSkin` reproduz `Skin.toString()` do jogo, e `decodeSkin` reproduz `Skin.fromString()`.
O codec foi verificado executando lado a lado com a classe original do jogo.

---

## Formato da skin

Resumo: binário big-endian com um cabeçalho fixo estilo AMF, seguido de cada camada
(`id`, `scale`, `angle`, `x`, `y`, `flipX`, `flipY`, `color`) e da cor de fundo, convertido para
base64 e depois para `encodeURIComponent`.

- Na conta, a skin é salva por `POST https://bonk2.io/scripts/avatar_update.php`, em 5 slots.
- Dentro da sala, ela viaja como objeto JSON `{ layers, bc }`. Quem recebe descarta as camadas se
  houver mais de 16, e por isso o limite de 16 é real.

Detalhes completos, com tabela de bytes e geometria: **[FORMATO_SKIN.md](FORMATO_SKIN.md)**.

---

## Estrutura do projeto

| Arquivo | Conteúdo |
|---|---|
| [`index.html`](index.html) | Interface do gerador. |
| [`preprocess.js`](preprocess.js) | Conversão para Lab, simplificação, paleta e pesos. |
| [`generator.js`](generator.js) | Otimizador e desenho da skin igual ao do jogo. |
| [`worker.js`](worker.js) | Executa uma tentativa num Web Worker. |
| [`shapeCategories.js`](shapeCategories.js) | Nomes das 115 formas (os mesmos do editor do jogo) e grupos do filtro. |
| [`bonkSkinCodec.js`](bonkSkinCodec.js) | Codificação e decodificação da string de skin. |
| [`bonk-skin-import.user.js`](bonk-skin-import.user.js) | Userscript que importa a skin no jogo. |
| [`tools/extract-shapes.js`](tools/extract-shapes.js) | Gera o `shapes.js` a partir do `GameResources.js` do jogo. |
| [`FORMATO_SKIN.md`](FORMATO_SKIN.md) | Documentação do formato da skin. |
| `shapes.js` | *(gerado localmente, não versionado)* As 115 SVGs das formas. |

---

## Limitações

- **16 formas sólidas são pouco para imagens detalhadas**: fotos e ilustrações complexas viram uma
  versão estilizada, reconhecível mas não fiel.
- O processo é aleatório: execuções diferentes dão resultados diferentes. Mais tentativas
  reduzem essa variação.
- O pincel não acompanha mudanças de zoom feitas depois de pintar.
- O userscript depende de detalhes internos do jogo (o uso de `decodeURIComponent` em
  `Skin.fromString` e os IDs dos botões do Skin Manager) e pode parar de funcionar se o bonk.io
  mudar esse código.

---

## Aviso

Projeto de fã, **sem afiliação** com o bonk.io ou com seus autores. As formas (SVGs) e o jogo
pertencem aos seus respectivos donos. Por isso o `shapes.js` não é distribuído aqui e é gerado
localmente a partir dos arquivos públicos do jogo. Use o userscript por sua conta e risco.
