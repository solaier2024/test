# 街头食物完整视觉升级：视频制作方案

本轮目标：完成视觉、交互、开场、环境和性能验收后再提供新试玩，不交付中间样片。

## 已批准并完成的 OpenArt 支出

用户已明确批准本批 **1,760 积分**。Seedance 2.0、text2video、normal、每项一条，报价和执行配置相同；点球 3,000 积分的授权不被复用。任务、完整提示词及输出来源见 [video-generation-journal.json](video-generation-journal.json)。

| 素材         | 时长 | 尺寸         | 音轨               | 报价 |
| ------------ | ---- | ------------ | ------------------ | ---: |
| 横屏夜市环境 | 6 秒 | 720p / 16:9  | 无                 |  480 |
| 竖屏夜市环境 | 6 秒 | 720p / 9:16  | 无                 |  480 |
| 食物开场 CG  | 4 秒 | 1080p / 16:9 | 原创短音乐与现场声 |  800 |

环境固定镜位，用于食物转轴背后的远景动态；主盘、倍率和金额由 Pixi 实时呈现。CG 不含烧录文案、数字或倒计时，由玩家进入后播放，支持跳过。手机使用独立竖屏环境构图，横屏开场 CG 居中完整显示。成片已抽帧检查构图、人体、灯光和无文字；环境以首尾 0.5 秒溶解输出 5.5 秒正向循环，避免倒放人物。压缩结果、尺寸、校验和及音轨见 public/media/manifest.json 和验收记录。

同时完成：原创立体标牌／酱料瓶、铜木材质机框、连续转轴减速与落定、逐线点亮、金额滚动、净盈利分级庆祝、紧凑下注与操作、分步教学、背景与音轨暂停、单解码器、Lite／Full 素材、无视频及减少动态模式、手机和账本回归检查。

## landscape-environment

```json
{
  "duration": 6,
  "aspectRatio": "16:9",
  "resolution": "720p",
  "generateAudio": false,
  "mode": "normal",
  "videoCount": 1
}
```

```text
Premium cinematic photorealistic Mexican street food night market, fixed tripod landscape wide shot. Warm tungsten bulbs and red canvas awnings on two street stalls at the LEFT and RIGHT edges, weathered brass and wood, deep teal blue hour sky, a softly lit distant plaza. Leave the central 60 percent and central foreground calm, dark, low detail so a separate game interface can cover it. Small distant adult patrons walk naturally only along the far left and right edges. Thin cooking steam gently rises at both sides, warm bulbs shimmer subtly, an occasional natural cooking movement by a vendor. Stable architecture, consistent plausible light, no camera motion, no cuts, no changing exposure, no zoom. Smooth modest repeating environmental motion, forward-playing loop with start and finish composition closely matching. No game machine, food icons, labels, numbers, logos, countdown, subtitles, watermarks, music or dialogue.
```

## portrait-environment

```json
{
  "duration": 6,
  "aspectRatio": "9:16",
  "resolution": "720p",
  "generateAudio": false,
  "mode": "normal",
  "videoCount": 1
}
```

```text
Premium cinematic photorealistic Mexican street food night market, vertical 9:16 fixed tripod composition. Warm amber hanging bulbs across the top third, authentic red canvas awnings framing the upper left and right edges, deep teal blue hour sky, weathered brass and wood food stalls at both far side edges. Keep the CENTRAL 75 percent visually quiet, dark and unobstructed for a separately rendered game interface. Small adult patrons and vendor motions only far in the background at the extreme lower side edges; gentle cooking steam rises at left and right. Stable architecture, no close faces, no figures crossing center. Fixed camera, no pan, no zoom, no cuts or exposure changes. Subtle natural repeatable forward-moving atmosphere with matching first and last composition. No text, signs, labels, numbers, game objects, watermark, music or dialogue.
```

## opening-cinematic

```json
{
  "duration": 4,
  "aspectRatio": "16:9",
  "resolution": "1080p",
  "generateAudio": true,
  "mode": "normal",
  "videoCount": 1
}
```

```text
A polished four-second photorealistic cinematic commercial for an ORIGINAL Mexican street food game. Warm amber and deep teal nighttime palette, appetizing natural food texture, realistic cinematic depth of field, joyful energetic street market atmosphere. 0-1.2 seconds: extreme close-up of a corn tortilla and grilled al pastor meat sizzling on a black iron griddle, a brief natural flare of heat, rising steam. 1.2-2.7 seconds: crisp hero close-up of a freshly prepared taco with onion, cilantro and pineapple, chili and fresh lime beside it, gold warm rim light, a restrained push in. 2.7-4 seconds: smooth transition to a real warmly lit Mexican night-market stall under a red awning, dark teal evening behind it, inviting people in the distant sides, finish on a calm composition suitable for a UI transition. Synchronized original short musical sting with claves, conga and warm marimba, lively cooking sizzle, distant market ambience; no speech or singing and no recognisable existing song. NO rendered titles, brands, letters, numbers, countdown, subtitles, game machine, slots, invented payout or watermark. Photorealistic surfaces and motion, no cartoon characters or candy aesthetic.
```
