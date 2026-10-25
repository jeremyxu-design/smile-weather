# Smile Weather · v0.5

[Live Demo](https://jeremyxu-design.github.io/smile-weather/) · [备用演示](https://smile-weather-studio.xjylance.chatgpt.site/) · [实现与验收](https://smile-weather-studio.xjylance.chatgpt.site/about.html) · [真机验收表](https://smile-weather-studio.xjylance.chatgpt.site/acceptance.md)

微笑下雨，张嘴大笑释放三波星星，移动头部让主要星星反弹。手机全屏、电脑竖屏预览。独立概念原型，非TikTok官方产品；评论与主播信息为示例，不进行真实直播。应用不上传/录制画面，不请求麦克风。

## 30秒体验

1. 点击“开启摄像头”，保持脸在画面中间。
2. 微笑→放松→张嘴大笑→左右移动头部。
3. 右上工具→调试与性能→显示头部边界与碰撞点，可观察真实接触；底部“特效”打开玩法。

“试试模拟效果”只用于预览，不作为真人验收。主链接使用固定公共CDN，备用Sites使用同源模型；两条资源加载路径需分别检查。首次摄像头需要联网加载模型。

## 定义与边界

| 规则 | 当前实现 |
| --- | --- |
| 微笑 | smile均值≥.40进入、≤.25退出，各持续300ms |
| 大笑 | smile≥.50且jawOpen≥.50；任一≤.35持续300ms退出；大笑优先 |
| 一次笑一次烟花 | 进入时释放，1.5s冷却；保持不连发、冷却不补发 |
| 大笑转微笑 | 确认退出大笑后，重新确认微笑300ms，无需先回到平静 |
| 短暂丢脸 | 450ms内保留已确认状态，立即停雨/移除碰撞，缺失不计入确认时间 |
| 头部碰撞 | 旋转椭圆近似，顶部扩展15%；连续轨迹检测、法线反射、头部速度传递 |

“大笑”是张嘴微笑的代理，不识别情绪或笑声。输入平滑75ms、状态确认及采样均带来延迟；300ms不是端到端响应承诺。8颗大星及中层粒子参与物理，前后层为装饰；椭圆不等于真实头发分割或3D头部。

## 性能ROI：已实现的控制与未测的收益

| 选择 | 已实现 | 取舍 / 待测 |
| --- | --- | --- |
| 单Canvas 2D | 无Three/Matter，无服务端推理 | 2.5D外观，二维碰撞近似 |
| 分频调度 | 绘制最高60Hz、主线程识别目标15Hz；后台暂停 | 限频不消除单次推理阻塞，Worker待测后决定 |
| 预绘与复用 | 启动时预绘贴图，无逐粒子渐变/filter/shadowBlur；粒子槽复用 | 不声称整个应用零分配 |
| 标准 / 轻量 | DPR上限1.5 / 1，活动预算800 / 400 | 统一预分配800槽，两档每簇均最多104颗；不是内存或粒子减半 |

零服务端推理不等于零总体成本：模型下载、托管和终端计算仍有成本。实际耗电/内存、标准轻量收益尚未测量，不宣称性能翻倍。先用同设备、同光照、同动作的60秒记录决定是否继续优化。

诊断FPS/Hz为最近约1秒窗口；推理/帧间隔P95为最近最多450样本，不是60秒全程统计。initMs包含开始到模型就绪的流程，不能当纯下载耗时。导出含浏览器和配置，不含图像或landmarks；原始设备日志不提交公开仓库。

## 当前验收状态

**v0.5核心测试29项通过**，模块与公开单文件版执行相同的29项，不计为58项独立测试。Chrome模拟交互、320/390px布局和公开发布已检查；这些不证明真人模型准确率。

历史：v0.1 Sites的iPhone核心流程用户反馈成功；v0.4用户反馈遮脸恢复未重复烟花。两者不外推为v0.5全项验收。

2026-10-25，用户在v0.5验收请求下反馈“目前没有发现问题”。这是定性体验反馈；设备、次数、时长及量化日志未提供，不记为逐项或全量通过。

**待补充：** v0.5电脑/iPhone各10次微笑与大笑、误触发、标准/轻量各60秒、真实碰撞短片、iPhone安全区和两条资源加载路径。结果按[验收表](https://smile-weather-studio.xjylance.chatgpt.site/acceptance.md)填写，不填虚构数字。

## Vibecoding复盘（不超过200字）

初版把requestAnimationFrame当成固定60FPS，高刷屏模拟预览实测120.2FPS，重复消耗绘制预算。我要求：“按单调时间将实际绘制限为60Hz，识别独立限15Hz；分别记录频率，模拟数据不得冒充摄像头性能。”随后改为到期才更新物理和绘制，并记录实际绘制频率。

120.2FPS为历史模拟观察，与历史真实摄像头59.99FPS不是同条件前后对照；不据此宣称性能提升比例。

## 资源与许可

固定MediaPipe Tasks Vision 0.10.35、float16/1模型、VIDEO模式、单脸并开启blendshapes。

[官方文档](https://ai.google.dev/edge/mediapipe/solutions/vision/face_landmarker/web_js) · [Apache-2.0许可](https://github.com/google-ai-edge/mediapipe/blob/master/LICENSE) · [资源说明](https://smile-weather-studio.xjylance.chatgpt.site/THIRD_PARTY.md)

模型SHA256：`64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff`

## 运行与修改

`index.html`为完整单文件分发版；`core-tests.mjs`直接提取其中的核心实现。无npm依赖、无需构建。

```sh
python3 -m http.server 4176 --bind 127.0.0.1
node --test core-tests.mjs
```

电脑打开 <http://127.0.0.1:4176>；手机使用HTTPS链接。Pages使用main分支根目录。版本过程不作为当前验收结论，当前规则以上文为准。
