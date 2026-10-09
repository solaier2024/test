# 资源来源

| 资源 | 来源与授权 | 处理 |
| --- | --- | --- |
| athlete.glb | [Kenney Animated Characters Protagonists](https://kenney.nl/assets/animated-characters-protagonists)，CC0 | characterMedium.fbx 转换为 GLB，保留骨骼；运行时调节体型和动作 |
| kit-source.svg / 球衣贴图 | 同一 Kenney 资源包，CC0 | 修改可编辑 SVG，移除原服饰图案，制作门将 1 号和射手 9 号球衣 |
| Barlow / Barlow Condensed | [Barlow Project](https://github.com/jpt/barlow)，SIL Open Font License 1.1；经 Fontsource 获取 | 本地托管 Latin WOFF2，中文使用系统字体 |
| 球场、球网、看台、足球、天空、LED、粒子 | 项目内程序生成 | PlayCanvas 网格、草叶网格、程序颜色与法线贴图 |
| Seedance 开场 MP4 / 海报 / 大厅背景 | OpenArt / Seedance 2.0，本项目提示词生成 | 原片 1920×1080、24 fps、6.04 秒、静音；压缩横屏和居中裁切竖屏，记录见 `seedance-jobs.json`，不标为 CC0 |
| 庆祝 MP4 与海报 | 项目内实时场景录制 | 静音 H.264 编码，横竖屏各一版；尚未替换为 Seedance |
| 观众氛围、鼓点、哨声、击球与结果音 | 项目内 Web Audio 合成 | 点击开启声音后播放；无外部音频、麦克风权限或音频下载 |

完整资源包授权文本位于 `public/assets/models/Kenney-LICENSE.txt`；字体授权文本位于 `public/assets/fonts/Barlow-OFL.txt`。参考游戏仅用于观察构图与交互节奏，未复制其资源。
