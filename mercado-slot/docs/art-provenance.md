# 原创美术来源

本轮新增资产：`brand-sign-v2.webp`（768×294、透明立体标牌）、`salsa-bottle-v2.webp`（287×960、透明酱料瓶）。`food-atlas-full.webp` 为原图 1776×888 的高分辨率编码，与 Lite 共用八格布局；`market-landscape-v2.webp` 和 `market-portrait-v2.webp` 为审批视频的海报帧。尺寸、透明度、字节和校验和见资源 manifest。确定性整理工具为 prepare-polish-art.mjs 和 import-media.py；未用脚本重绘生成图。

## brand-sign-v2

透明背景：是。

```text
Use case: logo-brand. Production game art asset, transparent background, landscape 2:1 composition, 1536x768. Create a highly polished ORIGINAL dimensional shop-sign logo for a premium Mexican street food game. Exact text: "MERCADO" as a large gently arched top word, "de ORO" as an even larger bottom line. The word "de" smaller than "ORO". All spelling exact, no other words. Beautiful traditional engraved serif lettering, raised antique golden brass with bright honey gold edge light, rich warm ivory highlights, deep dimensional brown extrusion and subtle crimson enamel accents. A small natural red chili and a subtle golden corn flourish at the outer lower sides, simple harmonious ornament, not busy. Strong readable silhouette and crisp letterforms at 260 pixels wide. A small warm light bulb at each outer edge is acceptable. Front-on, straight composition, fully contained, modest transparent padding. Photorealistic premium game logo materials with real gold texture, sculpted depth, joyful Mexican night-market character. Genuine transparent alpha around letters and ornament. No opaque plaque, background, green rectangle, cartoon mascot, eyes, candy, casino chips, jackpot amount, slogan, watermark or existing logo.
```

## salsa-bottle-v2

透明背景：是。

```text
Use case: product-mockup. Production transparent game sprite. One premium artisanal Mexican hot sauce bottle seen straight from the front, centered, tall 1:2 silhouette, genuine transparent background. A hand-crafted dark amber glass bottle with warm red-orange sauce inside, antique golden brass screw cap, realistic highlights, curved thick glass, tiny condensation droplets and elegant subtle embossed pepper motifs. At the exact center of the bottle body, a large blank dark oval medallion bordered with polished gold, leaving a completely clear empty area where software will overlay a changing multiplier number. The medallion takes about 75 percent of bottle width and 30 percent of its height. Rich high-contrast warm cinematic lighting, gold edge light, subtle natural base shadow, near-photographic PBR game-asset quality, elegant and exciting instead of toy-like. Whole bottle fully visible with generous transparent margins; readable at 150 pixels wide. NO written words, symbols, letters, numbers, brand, watermark, cartoon face, extra objects or background. This is a single original bottle sprite with clean alpha edges.
```

位图素材由内置 `image_gen` 生成，采用 imagegen 技能；本轮视频由用户单独批准的 OpenArt Seedance 2.0 制作，完整视频提示词与 1,760 积分配置见 [visual-upgrade-video-plan.md](visual-upgrade-video-plan.md)。没有使用 TaDa 的原图、商标或游戏界面。

最终工作区素材：`mercado-slot/public/art/food-atlas.webp`（1024×512、透明八格图集），`mercado-slot/public/art/market.webp`（1600×900 夜市背景）。完整尺寸、SHA-256 与文件大小见 [manifest.json](../public/art/manifest.json)。生成结果仅做确定性的图集缩放和 WebP 编码，透明通道保留；工具为 [prepare-assets.mjs](../tools/prepare-assets.mjs)。

源图保存在生成工具的默认目录，仓库运行仅依赖导出的最终素材。旧 market.webp 作为首版存档保留，当前首屏海报来自新视频，横／竖屏夜市循环与开场 CG 已进入 public/media/。

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
