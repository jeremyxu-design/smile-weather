# Smile Weather · v0.5.1

[打开 Live Demo](https://jeremyxu-design.github.io/smile-weather/) · [备用演示](https://smile-weather-studio.xjylance.chatgpt.site/) · [提交文案](https://github.com/jeremyxu-design/smile-weather/blob/main/SUBMISSION.md) · [验收记录](https://github.com/jeremyxu-design/smile-weather/blob/main/QA.md)

微笑下雨，张嘴大笑释放三波星星，移动头部让星星反弹。单 Canvas 2D 实现的直播 AR 概念原型，手机全屏、电脑竖向舞台。独立作品，非 TikTok 官方产品。

## 30秒体验

点击“开启摄像头” → 微笑 → 放松 → 张嘴大笑 → 左右动头。右上角工具可开启头部边界和碰撞点、切换画质、停止摄像头或导出运行记录。无摄像头时可以试模拟效果。

## 我如何定义这个玩法

我把“屏幕下雨”收敛为跟随主播的天气云，把烟花安排在头部上方或侧方：让表情与效果有明确联系，给雨滴水花和星星反弹留出轨迹，同时尽量为面部和评论留白。

| 行为 | 规则 |
| --- | --- |
| 微笑 | 双侧 smile 均值 ≥ .40 进入、≤ .25 退出，各持续300ms |
| 大笑 | smile ≥ .50 且 jawOpen ≥ .50；任一 ≤ .35 持续300ms退出，大笑优先 |
| 一次笑一次烟花 | 进入时释放、1.5秒冷却，保持大笑不连发 |
| 大笑转微笑 | 确认退出大笑后，重新确认微笑300ms |
| 短暂丢脸 | 450ms内保留已确认表情，立即停雨并移除碰撞体 |
| 物理互动 | 8颗大星及中层粒子碰到头部椭圆会反弹，雨滴碰到头顶溅开 |

v0.5.1 统一了有效/缺失识别样本的计时点；电脑舞台改为3:4以减少横向裁切；大星错开起点，YAY延后出现并短暂保持不透明。

## 性能设计与成本

| 决策 | 当前实现 |
| --- | --- |
| 纯前端 | 无服务端推理、无 Three/Matter，贴图启动时预绘 |
| 控制绘制频率 | 实际绘制最高60Hz，主线程识别目标15Hz；后台暂停 |
| 复用内存 | 预分配800粒子槽，水花32槽、碰撞提示24槽 |
| 标准 / 轻量 | 活动预算800 / 400；画布DPR上限1.5 / 1；单簇均最多104颗 |
| 按需加载 | 点击开启摄像头后加载模型；模拟预览不加载模型 |

模型文件3,758,596字节；随运行环境选择的WASM约10.48–11.15MB（原始文件大小，非网络压缩传输量）。轻量模式降低像素绘制负担；保留池容量余量，后续用连续触发实测决定是否缩减。

## 验证结果

- **30项核心测试通过**：模块版与生成后的单文件版执行同一组测试，覆盖触发、丢脸恢复、连续碰撞、粒子复用及出生位置。
- 同场景模拟对照：只切换绘制限频，面板读数120.0 → 60.1 FPS；测量口径见QA。
- v0.5体验反馈：目前没有发现问题；早期iPhone核心流程及遮脸恢复也收到成功反馈。
- v0.5.1 真机命中次数、60秒运行记录和碰撞短片：填写[验收表](https://github.com/jeremyxu-design/smile-weather/blob/main/ACCEPTANCE.md)。

**边界：** 模拟测试不等于摄像头实测；张嘴微笑是“大笑”的输入代理，头部物理是二维椭圆近似。300ms为状态确认窗口；识别主线程限频仍有单次阻塞。性能面板FPS为约1秒窗口、P95为最近450样本，详细定义和历史证据见[QA](https://github.com/jeremyxu-design/smile-weather/blob/main/QA.md)。

## Vibecoding复盘（不超过200字）

初版把requestAnimationFrame当成固定60FPS，高刷屏模拟预览测得120.2FPS。我要求：“按单调时间将实际绘制限为60Hz，识别独立限15Hz；分别记录频率，模拟数据不得冒充摄像头性能。”改为到期才更新物理与绘制。同机同场景仅切换限频，模拟面板读数为120.0与60.1FPS，验证了绘制频率控制。

## 修改与运行

公开仓库包含可直接编辑的模块和生成脚本，Pages继续使用根目录 `index.html`。

| 文件 | 作用 |
| --- | --- |
| `app.mjs` / `dev.html` / `styles.css` | 生命周期、模块开发入口与界面 |
| `expression.mjs` / `geometry.mjs` | 表情状态机、坐标和连续碰撞 |
| `particles.mjs` / `metrics.mjs` / `config.mjs` | 粒子与渲染、统计、固定配置 |
| `modular-tests.mjs` / `core-tests.mjs` | 模块与生成单文件的同组回归测试 |
| `build.mjs` | 从模块生成 `index.html` 和单文件测试 |

```sh
npm run build
npm test
npm run serve
```

电脑打开 <http://127.0.0.1:4176/dev.html> 调试模块，修改后重新构建，再检查 `/index.html`。手机使用HTTPS。应用不录制或上传画面，不请求麦克风；直播评论为示例。

MediaPipe Tasks Vision固定0.10.35、float16/1模型。主链接使用公共CDN，Sites使用同源资源。[第三方资源与许可](https://github.com/jeremyxu-design/smile-weather/blob/main/THIRD_PARTY.md)。
