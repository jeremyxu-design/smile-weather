# Smile Weather · 表情天气台

**[Live Demo](https://smile-weather-studio.xjylance.chatgpt.site)** · **[实现与验收说明](https://smile-weather-studio.xjylance.chatgpt.site/about.html)**

微笑下雨，大笑烟花，移动头部让火花反弹。纯前端原型，不录制或上传摄像头画面，不请求麦克风。

## 源码与运行

`index.html` 包含完整的界面、样式、表情状态机、坐标映射、移动椭圆碰撞、粒子池、诊断和摄像头生命周期代码。无构建步骤、无 npm 依赖。将文件部署到 HTTPS 静态托管即可；电脑本地可执行：

```sh
python3 -m http.server 4176 --bind 127.0.0.1
# 打开 http://127.0.0.1:4176
node --test core-tests.mjs
```

`core-tests.mjs` 直接从 HTML 提取同一份核心实现，包含 14 项时序、迟滞、冷却、丢脸、镜像、连续碰撞、动量、对象池和指标计时测试。合成测试不代表真人模型准确率。

这个 GitHub 版本为完整单文件分发版，模型资源取自固定版本官方包的 CDN；线上 Demo 采用相同业务代码与相同版本的同源资源。两者的资源托管方式不同。第一次开启摄像头需要联网下载模型；效果预览无需模型。iPhone 请用 Safari 打开 HTTPS 链接。

## 产品规则

| 决策 | 实现 | 验证场景 |
| --- | --- | --- |
| 微笑持续下雨 | 双侧 smile 均值 ≥.40 进入、≤.25 退出，各稳定300ms | 阈值附近不闪烁 |
| 大笑优先 | smile≥.50 且 jawOpen≥.50；任一≤.35 稳定300ms退出 | 只张嘴不触发 |
| 一次笑一次烟花 | 进入大笑时触发，1.5s冷却，持有不连发 | 放松再笑；冷却内不补发 |
| 丢脸不留碰撞墙 | 空输出或450ms无有效结果，重置状态并禁用碰撞 | 遮脸、离开、重新进入 |
| 头部物理 | 脸轮廓在眼线局部坐标拟合椭圆，顶部加15%；轨迹相交、法线反射、头部速度传递 | 歪头、镜像、横竖屏、高速火花 |

输入先做75ms时间常数平滑；300ms按时间戳计算。“大笑”以张嘴微笑作为代理，不识别情绪或笑声；默认阈值仍需多人校准。碰撞是2D近似，不是完整头发分割。

## 性能预算与真实边界

- MediaPipe Tasks Vision **0.10.35**，float16/1模型，VIDEO模式、单脸、开启blendshapes；读取真实命名字段。
- 直接传video；推理主线程同步，上限15Hz；GPU初始化失败时尝试CPU。限频不等于消除主线程阻塞，Worker为测量后备选。
- rAF绘制显式限60Hz；800个预分配typed-array粒子，轻量400；预绘光晕，无逐粒子shadowBlur；DPR上限1.5/轻量1。
- 页面隐藏暂停绘制和推理并禁用视频轨道，停止后释放摄像头和模型。
- 诊断分别显示渲染FPS、识别Hz、推理P95、帧间隔P95、粒子和碰撞事件；导出不包含画面或关键点。
- 模拟预览明确标识；它只验证视觉、状态机和碰撞，不能充当摄像头或iPhone验收。

## 已验证与待验证（2026-10-23）

已通过14项核心测试与模块静态检查。Chrome模拟场景已观察到雨、烟花、首簇92次碰撞，持续大笑不重复，放松后重新触发。

本机一次38.57秒真实摄像头记录：640×480/GPU，469次推理、0次推理异常；渲染59.99 FPS、推理P95 16.5ms、帧间隔P95 17.2ms。记录到2次微笑、没有大笑或碰撞事件。出现多次丢脸，因此不能把这组流畅度数字当作准确率。

**iPhone Safari 核心流程：用户自测通过。** 用户在 Sites 演示中按“开启摄像头→微笑→放松→张嘴大笑→左右动头”操作，对摄像头、下雨、烟花和头部反弹的验收请求回复“成功”。这是用户自测反馈，不是仪器测量；型号、系统版本、时长及性能 JSON 未提供。该反馈对应同源资源的 Sites 链接，不自动覆盖 GitHub Pages 的 CDN 加载路径。

**待补充验证：** 不同人脸/光照下命中和误触发、iPhone Safari横竖屏/后台恢复/权限恢复、两端至少60秒混合场景性能。每种表情各重复10次，填写命中/总数与误触发次数。

## Vibecoding复盘（不超过200字）

初版把requestAnimationFrame当作60 FPS，高刷电脑实测模拟预览达120.2 FPS，重复消耗绘制预算。我要求：“按时间戳把绘制限为60 Hz，推理独立限15 Hz；分别记录两者，模拟数据不得冒充摄像头性能。”随后增加绘制节流，电脑真实会话测得59.99 FPS；iPhone核心流程获用户自测通过，量化准确率待测。

## 第三方来源

[MediaPipe官方文档](https://ai.google.dev/edge/mediapipe/solutions/vision/face_landmarker/web_js) · [Tasks Vision 0.10.35](https://www.npmjs.com/package/@mediapipe/tasks-vision/v/0.10.35) · [Apache-2.0许可](https://github.com/google-ai-edge/mediapipe/blob/master/LICENSE) · [资源与许可说明](https://smile-weather-studio.xjylance.chatgpt.site/THIRD_PARTY.md)

模型URL：`https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task`

模型SHA256：`64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff`
