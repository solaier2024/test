# 原创美术来源

本次素材由内置 `image_gen` 生成，采用 imagegen 技能；未调用收费 OpenArt 或 Seedance 任务。没有使用 TaDa 的原图、商标或游戏界面。

最终工作区素材：`mercado-slot/public/art/food-atlas.webp`（1024×512、透明八格图集），`mercado-slot/public/art/market.webp`（1600×900 夜市背景）。完整尺寸、SHA-256 与文件大小见 [manifest.json](../public/art/manifest.json)。生成结果仅做确定性的图集缩放和 WebP 编码，透明通道保留；工具为 [prepare-assets.mjs](../tools/prepare-assets.mjs)。

源图保存在生成工具的默认目录，仓库的运行入口仅依赖上述最终素材。首屏使用写实静态环境；动态环境循环与 CG 尚未制作。

## mercado-food-atlas

透明背景：是。

```text
Use case: product-mockup. Asset type: transparent game food sprite atlas. Generate ONE rectangular 2:1 sprite sheet, 2048x1024, exactly FOUR columns by TWO rows, eight equal square 512x512 cells on genuine transparent alpha background, generous transparent padding and no cell borders. Every object completely isolated inside its own cell, not touching neighbours. Consistent close-up commercial food photography, warm side lighting, crisp appetizing natural detail, near overhead three quarter camera, minimal soft shadow. Row one left to right: (1) stack of three toasted corn tortillas; (2) single curved glossy red chili pepper with green stem; (3) halved fresh lime with one whole lime behind it; (4) halved ripe avocado with glossy brown pit. Row two left to right: (5) Mexican esquites corn in a small terracotta cup, cream, chile dust and cilantro; (6) a single opened tamal with natural corn husk and masa showing; (7) one folded al pastor taco with grilled meat, onion, cilantro and pineapple in toasted tortilla; (8) same taco shape but all edible elements rendered as luminous antique metallic gold, premium golden Wild icon, no text. No labels, letters, frames, numbers, cartoon outlines, faces, logos or watermark. These assets must read clearly at 96 pixel display. Transparent background essential.
```

## mercado-market-background

透明背景：否。

```text
Use case: photorealistic-natural. Asset type: wide photographic background for an original premium street food game titled Mercado de Oro, without rendered text. Cinematic editorial photograph of a real Mexican street food night market at blue hour. Rich warm amber light from small food stalls on the left and right edges, subtle red canvas awnings, dark teal evening shadows, hanging warm bulbs, distant softly blurred people, authentic weathered metal and wood, cooking steam rising at sides. Landscape 16:9, 1920x1080 or larger. Leave the CENTRAL 60 percent darker, subdued and low detail, so a separately rendered game cabinet stays readable. No people, plates or decorations overlapping the central foreground. Atmosphere inviting, lively and sophisticated, real surfaces and plausible lighting. No slot machine, no game interface, no lettering, logos, watermark, cartoon, candy or plastic-looking food.
```
