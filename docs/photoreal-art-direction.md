# LAST KICK 写实视觉升级

更新时间：2026-10-09。

## 当前问题

此前版本已经接入 PlayCanvas、PixiJS、GSAP 和 Vite，但 Kenney 人物轮廓较卡通，草地、看台和灯光过于简化。此前四条开场/庆祝视频均由实时场景录制。此次**已接入实际完成的 OpenArt / Seedance 开场**，同时升级加载、灯光、草地和界面；实时人物仍是原骨骼模型，尚未达到写实影视级质量。

## 新的视觉目标

以真实足球转播和体育广告的摄影质感为准：正常成人比例、球衣织物、草叶与球场磨损、自然皮肤、明确的接触阴影、真实的灯光衰减，以及克制的镜头运动。减少荧光色、夸张粒子和塑料材质；界面保留清晰的比赛信息。

## Seedance 与实时 3D 的分工

- **OpenArt / Seedance：**开场、准备动作、紧张气氛、赛后庆祝等短片。先制作一条风格样片，检查人物、足球、球门、动作和摄影质量，再扩展横竖屏素材。生成结果经过检查后才能写入生产媒体清单。
- **PlayCanvas：**玩家操作后的足球轨迹、门将扑救、球网反馈和可切换机位。升级人体模型与真实动作片段，改善重心、触球、起跳、伸臂与落地；实时模型的授权与资源尺寸需要满足部署要求。
- **PixiJS / GSAP：**比赛控制、报价、比分、信息层，以及动作和镜头之间的衔接。
- **OutcomeProvider：**继续提供权威结果。影片不能决定成功率、比分或返还，回放不能提交第二次请求。

Seedance 输出的是渲染好的视频，不是可直接操控的三维模型或动作捕捉数据。只加入一条视频无法让现有实时人物达到相同的写实质量，模型、材质和动作仍需分别升级。开场样片不出现一次具体的射门结果，避免与玩家后续选择冲突。

## 第一个生成任务

模型：OpenArt 的 `byte-plus-seedance-2`，Seedance 2.0，`text2video`。

配置：1 条，6 秒，16:9，1080p，无音轨，normal 模式。当前报价 1,200 积分；生成前账户余额 16,296 积分。该价格只适用于这个配置，最终费用以 OpenArt 返回值为准。

任务已完成并接入：`KQ9mego53d8bOcrD0Ur8`。原片 1920×1080、24 fps、145 帧、6.041667 秒，无音轨。检查了完整播放、原片 0 / 1.5 / 3 / 4.5 / 5.9 秒代表帧和竖屏 0 / 3 / 5.9 秒代表帧。主体为罚球前准备，足球保持一颗且未被踢出，人物、球门和服装保持连续；未发现明显肢体突变或多球问题。

正式横屏压缩为 1280×720，竖屏 720×1280 是同一原片的居中裁切，保留足球和门将；不是第二条原生竖屏生成。两版 MP4 合计约 2.76 MB，均有首帧 WebP。生成参数、原片来源、处理方法记录于 `docs/seedance-jobs.json`。报价 1,200 积分，接口未返回实际扣费字段，未把报价当成已确认扣费。

大厅采用写实首帧与缓慢推近；开场配字幕、扫光和倒计时，最后一帧保留到倒计时结束。比赛界面改为深色、暖金和少量冷色信息提示。实时球场增加草叶、草地法线、磨损细节与夜场照明，调整球员头部比例和网格法线；击球加入短促镜头冲击。观众氛围、鼓点、哨声与击球声为本地 Web Audio 合成，默认关闭，用户开启后播放。

### 完整提示词

> Create a single continuous six-second photorealistic live-action football broadcast shot for the opening cinematic of a penalty shootout game. An original unbranded modern football stadium at night, densely filled stands, bright neutral-white stadium floodlights, a regulation white goal with fine white netting, carefully maintained natural grass with subtle mowing stripes and worn soil around the penalty spot. Two adult male professional footballers with realistic athletic proportions: the penalty taker wears a deep teal short-sleeved jersey, dark shorts, dark socks and white boots; the goalkeeper wears a muted lime-green long-sleeved kit, dark shorts, gloves and football boots. No recognizable real player, club, sponsor or official competition branding. A single realistically sized white football rests on the penalty spot eleven metres from the goal. Start with a low three-quarter view from behind the penalty taker, showing the ball, boots and grass; slowly dolly forward and slightly rise into a composed view that keeps the goalkeeper and the full goal visible ahead. The taker shifts his weight naturally, adjusts his stance and takes one small preparation step; the goalkeeper bends his knees, adjusts his gloves and makes one small lateral readiness step on the goal line. Keep the football stationary throughout: this is anticipation before a penalty, no kick and no goal or save outcome. Capture subtle breathing, believable muscle tension, realistic skin, cloth creases, glove details, blades of grass and soft contact shadows. Use natural camera optics, restrained depth of field that still leaves the goal readable, balanced exposure, slightly cool shadows and realistic neutral highlights. This must look like actual high-end sports cinematography, not an animated game, cartoon, toy, low-poly scene, illustration or stylized CGI. Maintain consistent anatomy, identities, kits, football count, goal dimensions and spatial positions for the entire shot. No scene cuts, no slow motion, no exaggerated lens flare, no particles, no HUD, no captions, no numbers, no text, no logos, no watermark. Leave some unobstructed grass below the goal for the game's later interface overlay. Silent footage.

## 素材验收与接入

1. 检查开头、中间和结尾的代表帧，以及完整视频；确认足球数量、手脚结构、球门和人物位置稳定。
2. 确认准备动作自然，没有暗含进球或扑救的结果。镜头可剪辑，但不能把不一致的球路包装成玩家操作的反馈。
3. 通过后保存正式 MP4、首帧 WebP、生成参数和来源记录；真实填写时长、分辨率、帧率和音轨信息。
4. 接入现有媒体清单、横竖屏资源选择、跳过按钮、拒播恢复和按需加载。AI 样片完成不等于这些步骤已经完成。
5. 同步升级实时场景后，对比开场到比赛的构图、光照、球衣和色彩，降低切换时的落差。

## 仓库状态

本地已有重构提交保留。2026-10-09 重新连接后，GitHub 接口已确认当前账号为 `solaier2024`，对 `solaier2024/test` 具有写入权限。具体提交与远程验收以本次交付结果为准。
