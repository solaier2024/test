# Mercado de Oro — v3 图片选型与材质

本次采用内置 image_gen，2026-10-12 制作并接入游戏。食物采用统一的暖侧光近景摄影：手工烤饼的焦斑与粗糙边缘、天然红辣椒、青柠果肉、牛油果、无彩色圆点装饰的陶土玉米杯、带纤维玉米叶的 tamal、烤肉 Taco。Wild 为有雕刻与拉丝细节的实体金属 Taco。保留原有八种 symbolId 与食物含义。

酱料瓶采用厚琥珀玻璃、细纹黄铜瓶盖、暗色颈封和大块哑光黑色空标签，收敛金色卷草装饰。招牌为深森林绿木质底板及立体黄铜字，保持准确的 MERCADO / de ORO 两行品牌名。机台同步采用森林绿漆面、烟色玻璃与哑光黄铜边框，保留红色棚檐和夜市视频。

## 已保存的生产素材

| 文件                                                             | 尺寸      |  编码体积 | 用途                   |
| ---------------------------------------------------------------- | --------- | --------: | ---------------------- |
| [food-atlas-v3.webp](../public/art/food-atlas-v3.webp)           | 1024×512  | 171,218 B | Lite、首屏及教程       |
| [food-atlas-full-v3.webp](../public/art/food-atlas-full-v3.webp) | 2048×1024 | 531,054 B | Full 渐进升级          |
| [salsa-bottle-v3.webp](../public/art/salsa-bottle-v3.webp)       | 292×960   |  94,364 B | 游戏、教程、Extra 开关 |
| [brand-sign-v3.webp](../public/art/brand-sign-v3.webp)           | 768×222   |  69,588 B | 标题与加载入口         |

对应工作区绝对路径：

- D:/work/self-game/github-test/mercado-slot/public/art/food-atlas-v3.webp
- D:/work/self-game/github-test/mercado-slot/public/art/food-atlas-full-v3.webp
- D:/work/self-game/github-test/mercado-slot/public/art/salsa-bottle-v3.webp
- D:/work/self-game/github-test/mercado-slot/public/art/brand-sign-v3.webp

所有素材保留生成的透明通道。prepare-materials-art.mjs 仅做确定性的等格裁切、透明边距整理、等比例尺寸适配、图集打包及 WebP 编码，没有脚本绘制或修补摄影内容。每格最大内容框 432×432，纹理格 512×512；Lite 与 Full 共用准确的 4×2 顺序和中心。生成原图副本留在忽略目录 .asset-work/mercado-materials-v3，原始生成文件也保留。旧版素材作为非关键资源保留，新的初始包只嵌入 v3 与环境海报。

在当前构建中，关键图片为 418,058 B，关键 JS/CSS+图片+字体为 742,227 B，前版为 871,458 B，约下降 14.8%。新版 Full 图集、视频及音乐继续渐进加载。构建报告为此次构建的压缩与资源完整性结果。

视觉调整未修改核心概率、下注、钱包或回合状态机；两档滚动速度沿用上一版。倍率仍由程序绘制在空标签上；英语和西班牙语教程、规则及回单使用同一套新食物图集。金属 Wild 保持软件绘制 WILD/COMODÍN 标签。

## 最终生成提示词

### 食物图集

选用原图：C:/Users/solai/.codex/generated_images/01a11e70-2058-73e1-88eb-cc3c15d2d48e/exec-6553b13f-d014-427b-9c37-aa4f5a847c89.png

```text
Use case: product-mockup. Brand NEW production sprite atlas for a premium Mexican night-market game, made as coherent photorealistic culinary still-life photography.
Canvas: wide 2:1 transparent PNG. EXACTLY eight isolated subjects in a precise FOUR columns by TWO rows of EQUAL SQUARE cells. The empty spacing is crucial: each entire subject occupies only 68-74% of the width and height of its cell, with at least 12% empty transparent margin on all four sides. Objects never touch neighboring cells or the image edges. Transparent whitespace is visible between all objects. No grid, borders, backdrop, labels or text.
Consistent camera: commercial food photography at a low 35-degree elevated frontal three-quarter angle, 85mm lens, ALL details sharp. One large warm softbox from upper left, realistic subdued highlights, soft dark contact shadow directly under each object, modest rim light. Tactile editorial photography, handmade natural imperfections, rich but restrained colors, deep real dimensional modeling. No catalog cut-and-paste look, no smooth plastic rendering.
Top row left to right:
1. Three handmade toasted corn tortillas in a LOW stack seen three-quarter, irregular organic edges and little blistered char spots, detailed yellow masa fibers, subtly curled warm edges.
2. One elegant curved RED CHILI with natural dark green stem and small skin wrinkles, slender diagonal silhouette, controlled reflections, not a huge inflated pepper.
3. One cut LIME half leaning against one whole dark green lime, translucent pale green pulp, distinct visible citrus juice vesicles and textured peel, medium size.
4. One cut AVOCADO half showing textured brown pit, creamy yellow-green flesh and rough dark peel, medium size.
Bottom row left to right:
5. ESQUITES in a small handmade rustic terracotta cup with NO painted polka dots or patterns, glazed rim, golden corn kernels, a little crema, green cilantro and red chile dust.
6. One freshly unwrapped TAMAL in a naturally folded fibrous corn husk, rough soft masa lightly broken at its end to show appetizing filling. Clearly different angular silhouette from tacos.
7. One beautiful AL PASTOR TACO with flame-charred folded tortilla and generous browned grilled meat, diced onion, cilantro and tiny pineapple pieces. Open filling faces camera, clear and appetizing.
8. A tangible sculpted GOLDEN TACO trophy, the same iconic folded taco silhouette rendered as restrained warm satin gold and lightly brushed brass, controlled sharp metal edge reflections and delicate artisan engraving. Golden sculpted filling, no painted real food, no big base, stars, halos or glitter.
Clean genuine alpha background. High-quality anti-aliased cutout silhouettes without yellow or red contour halos, no detached speckles or stray herb leaves outside subjects. Uniform medium visual size with comfortable whitespace. Readable at 96 pixels and suitable for pale or dark reel surfaces. No extra plates, hands, utensils, props, words, symbols, numbers, logos, watermark, fake transparency checkerboard, illustration, cartoon style or exaggerated fantasy gloss.
```

### 酱料瓶

选用原图：C:/Users/solai/.codex/generated_images/01a11e70-2058-73e1-88eb-cc3c15d2d48e/exec-b635ce01-04d4-4502-81a9-83a681a69369.png

```text
Use case: product-mockup. Asset type: one transparent production hot-sauce bottle sprite for Mercado de Oro.
Input image: current bottle is an identity/layout reference. Create a more restrained, physically convincing artisanal bottle in its place. Keep a front-facing tall narrow silhouette, whole bottle visible, and a large blank oval label where code overlays a multiplier.
Subject: premium Mexican chile sauce in thick dark AMBER GLASS, realistic red-brown sauce visible through translucent glass, a restrained brushed antique-brass screw cap with fine machining ridges and a subtle dark wax neck seal. Rounded shoulders and heavy glass base, slender proportions about 1:3 width-to-height. Small authentic imperfections in glass, nuanced reflection shapes, tiny scattered condensation droplets, delicate pepper-flake texture behind glass. Crisp material separation between matte label, satin cap and clear glossy glass. Warm upper-left key light plus a subtle edge light, realistic dimensional product photography, dark elegant warm tones.
Composition: centered straight front view, NO perspective tilt, no hands, no extra objects. Generous clear transparent padding. Large charcoal BLACK blank oval medallion with a thin satin-brass border on the lower-middle body; medallion center at about 61% of overall bottle height, covers approximately 72% of bottle width and spans 46% to 76% of its overall height. This blank area must be completely empty for code-drawn ×1 through ×15 and a small caption. All reflections on the glass stay away from the medallion center.
Remove the existing swirling gold decorations and large embossed chili ornaments. At most a tiny simple subtle embossed chili contour near the shoulder, never a decorative scroll. Think artisan culinary product, not ornate fantasy potion.
Genuine TRANSPARENT ALPHA background, soft subtle contact shadow only, no surface or backdrop. Clean cutout edges with no visible colored halo. Premium photographic natural texture, not overly sharpened, not cartoon, toy, painted illustration, plastic, holographic or glittery. NO text, letters, numbers, symbols, brand, logo or watermark anywhere.
```

### 招牌

选用原图：C:/Users/solai/.codex/generated_images/01a11e70-2058-73e1-88eb-cc3c15d2d48e/exec-7e4841a5-d50b-4b06-bb21-e6539b5d6595.png

```text
Use case: product-mockup. Asset type: transparent photographic storefront wordmark sign for an original Mexican night-market game.
Input image is the existing logo identity reference. Redesign it as a restrained physical artisan sign, keeping the exact brand name and its clear two-line hierarchy.
Exact text, and ONLY this text: first line "MERCADO"; second line "de ORO". Spell all letters accurately. MERCADO is the widest line. ORO is strong and readable; "de" is smaller.
A very wide shallow rounded wooden plaque, deep forest-green lacquer with subtle real wood grain and a fine aged satin-brass edge. Dimensional individually mounted brushed warm brass serif letters, slight dark bevels, crisp controlled highlights, soft believable small letter shadows on the green wood. Elegant old Mexican culinary market craftsmanship, premium and warm, refined natural material detail, not fantasy treasure typography. One very small understated chili engraving on the border, no separate floating corn or peppers.
Centered front view, wide approximately 3:1 composition, generous genuinely transparent alpha margins. The plaque and all letters are fully contained. Keep the silhouette compact enough to read in a game header at 240 pixels wide. Warm upper-left light matching food photography, neutral soft fill, rich forest green / muted brass / dark mahogany palette.
Avoid giant curls, sparkling decorations, neon glow, excessive ornaments, light bulbs, extra text, banners, slogans, crowns, cartoon effects, toy-like gold, watermarks, checkerboard or a studio background. Photorealistic material treatment and clean edges. Genuine transparent alpha outside the sign.
```
