# Painted fruit for Fruit Slice (ChatGPT prompt)

The game normally draws its 19 fruit itself. If you put a sprite sheet at `src/game/art/fruits.png`
it draws those instead (nothing else changes: cutting still uses the invisible outline of each fruit,
which is why the guide sheet shows those outlines).

## 1. Generate the sheet

1. Open ChatGPT (image generation on).
2. Attach **`art/fruit-guide.png`** (5 x 4 grid: each cell has a grey outline, the fruit's name in the
   top-left corner, and a magenta background).
3. Optional but helpful: also attach **`art/fruit-reference.png`** (the game's current placeholder drawings of the same 19 fruit, same order). Then add this sentence at the start of the prompt: *"A second image shows my current rough placeholder drawings of the same 19 fruit in the same order. Use it only to know which fruit is which and roughly what colours I want; the new paintings must look far better."*
4. Paste the prompt below, then send.

### The prompt

```
I am attaching a layout sheet for a mobile game. It is a grid of 5 columns x 4 rows (19 used cells,
the last one is empty). Each cell contains a grey silhouette on a magenta background, and a small
label in the top-left corner naming the fruit (1. ORANGE ... 19. PERSIMMON).

Create a new image with EXACTLY the same layout (same 5 x 4 grid, same size and proportions, same
order), where each grey silhouette is replaced by a painted illustration of the fruit named in its
label.

Style: polished casual mobile game art, like Fruit Ninja or a modern match-3. Clean, bold, slightly
glossy cartoon rendering, soft cel shading with one simple highlight, a darker outline around the
whole fruit in a deeper shade of its own colour, rich saturated colours. Every fruit is shown WHOLE
and uncut, seen from the side or slightly from above, lit from the top left. All 19 fruit must look
like one family: same line weight, same shading, same level of detail.

Hard rules:
- The fruit must fill its grey silhouette: same shape, same size, same position. Do not make it
  smaller or larger, and do not rotate it.
- Nothing may stick out of the silhouette. Stems, leaves and crowns (apple stem, pineapple crown,
  strawberry leaves, dragonfruit scales...) must be painted INSIDE the silhouette on the fruit, not
  poking out of it.
- The background of every cell stays flat pure magenta (#FF00FF), with no shadows, glow, gradient,
  texture or ground. Do not use magenta or pink-magenta anywhere on the fruit itself.
- No text, no labels, no numbers, no borders, no grid lines, no frame. Leave the 20th cell completely
  magenta.
- Do not add any extra objects (no knives, no leaves lying around, no bubbles, no splashes).
- Keep the fruits in the exact cell order shown by the labels.

Fruit to paint (in order): 1 orange, 2 apple (red), 3 watermelon (green stripes), 4 lemon (a soft
mustard yellow, not bright or neon), 5 pear, 6 banana, 7 kiwi (brown fuzzy skin), 8 dragonfruit
(pink skin with green-tipped scales), 9 pineapple, 10 mango, 11 starfruit (carambola, yellow-green,
five ridges), 12 pomegranate, 13 passionfruit (purple), 14 avocado (dark green, bumpy skin),
15 papaya, 16 lychee (rough pink-red skin), 17 coconut (brown, hairy, three dark spots), 18 strawberry
(with tiny seeds), 19 persimmon (orange).
```

### If the result is not good

- **Cells drift or the grid is off:** the converter re-centres and rescales every fruit inside its
  own cell, so small drift is fine. If whole fruit are missing or merged, ask for one row at a time:
  *"Same style and rules. Redo only row 2 (6. BANANA to 10. MANGO) as a 5 x 1 strip, with each fruit
  filling its grey silhouette on magenta."*, then paste the rows together (any image editor) or run
  the converter on a sheet you assembled.
- **Fruit does not fill the silhouette:** say *"Each fruit must touch all the edges of its grey
  silhouette: stretch it to fill it"*. The converter fits by the fruit's visible bounding box, so a
  fruit that is too small just gets scaled up.
- **Pink/magenta fringe around fruit:** ask for "hard clean edges, no anti-aliased pink halo, flat #FF00FF background".
- **Style differs between fruits:** regenerate and say which numbers to match to which.

## 2. Put the sheet in the game

Save ChatGPT's picture somewhere (for example `art/chatgpt-sheet.png`), then:

```bash
node scripts/fruit-art.mjs prepare art/chatgpt-sheet.png
```

(Set `CHROMIUM_PATH` to Chrome's `chrome.exe` if the script cannot find a browser.) It removes the
magenta, finds each fruit in its cell, fits it onto the game's outline, prints what it found per fruit
(`NOTHING FOUND` means that cell was empty), and writes `src/game/art/fruits.png`.

Check it with `npm run dev` and open `http://localhost:5173/?gallery=1` to see all 19, then play.
To go back to the drawn fruit, delete `src/game/art/fruits.png`.

## 3. How it works (so you can change it)

- `scripts/fruit-art.mjs guide` regenerates `art/fruit-guide.png` from the game's real fruit outlines
  (do this if you change a shape in `src/game/sim/fruit.ts`).
- The sheet in the game is 1280 x 1024: 5 columns x 4 rows of 256 px cells, in the order of
  `FRUIT_KINDS`. Each fruit is centred on its cell and its outline reaches 112 px from the centre.
- `src/game/view/fruitSprites.ts` loads it and draws each fruit as a sprite scaled to the fruit's
  radius. Cut halves are the same sprite hidden by a half-plane mask.
- Adding a 20th fruit: add the kind in `sim/fruit.ts` (it takes the last free cell), regenerate the
  guide, repaint.
