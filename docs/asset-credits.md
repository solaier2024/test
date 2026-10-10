# 资源来源

| 当前资源                     | 来源与处理                                                                                                                                                                                         |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 写实开场、海报、动态比赛待机 | OpenArt / Seedance 2.0，本项目提示词生成，不标为 CC0。待机任务 `9ciw7vp5wSS10woOxFKX` 已完成并接入，8.04 秒按时间顺序循环；手机保全球门并使用同源模糊填充。任务与参数见 `seedance-jobs.json`。 |
| 十种进球／扑救结果视频 | OpenArt / Seedance 2.0 / image2video；八种标准结果和两种独立吊射结果逐条审看后接入，详见 `video-integration-review.md`。左路扑救截掉重复球尾段；原中路片按实际画面改作右路抽射。三条已批准补片的任务及资源见 `gameplay-video-jobs.json`，本次接入未追加任务。旧静态观众样片已被替换。 |
| 男性呼吸                     | [Male breathing — zogmachine](https://freesound.org/people/zogmachine/sounds/202606/)，CC0 1.0。取得该页公开的高清 MP3 预览，滤波、归一化、淡化首尾后本地打包。                                    |
| 看台呼喝和鼓掌               | [Crowd Cheer — FoolBoyMedia](https://freesound.org/people/FoolBoyMedia/sounds/397434/)，CC0 1.0。来源说明为体育比赛后人群欢呼。公开高清预览经滤波、淡化处理，混音时远景铺底并加入早期反射。        |
| 结果欢呼                     | [Crowd Cheering — SoundsExciting](https://freesound.org/people/SoundsExciting/sounds/365132/)，CC0 1.0。公开高清预览经滤波、归一化及淡化处理。它是人群录音，不宣称来自本项目中的虚构足球场。       |
| 罚球开始哨声                 | [Referee whistle sound — Rosa-Orenes256](https://freesound.org/people/Rosa-Orenes256/sounds/538422/)，CC0 1.0；取得页面公开的高清预览，滤波、峰值归一至 -8 dBFS 及首尾淡化后打包，混入球场短反射。 |
| 心跳、鼓点、分散拍手、触球   | 项目自编 Web Audio 声音；没有使用商业音乐录音、旋律或歌词。试听由相同引擎离线渲染。                                                                                                                |
| Barlow / Barlow Condensed    | [Barlow Project](https://github.com/jpt/barlow)，SIL Open Font License 1.1，经 Fontsource 获取并本地托管，用于英西双语界面。 |
| 图标和控制界面               | 项目代码生成，PixiJS / SVG / CSS。                                                                                                                                                                 |

录音许可：[CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/)。公开预览地址由来源页面读取，授权信息已核对；未下载需要登录的原始文件。记录仅用于游戏声场混音，不用于模型训练。作者与许可也记录在媒体清单中。

旧 Kenney GLB、程序球场及卡通庆祝保留为历史实验，主入口不播放。Kenney 来源为 [Animated Characters Protagonists](https://kenney.nl/assets/animated-characters-protagonists)，CC0，授权位于 `public/assets/models/Kenney-LICENSE.txt`。字体授权位于 `public/assets/fonts/Barlow-OFL.txt`。旧合成鼓点／低吟试听为历史版本，当前试听是 `previews/stadium-live.mp3`。

参考游戏仅用于构图和交互观察，未复制其资源。
