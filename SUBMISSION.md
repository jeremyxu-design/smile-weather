# Part 2 · Smile Weather v0.5.1

## 1. Live Demo

[打开演示](https://jeremyxu-design.github.io/smile-weather/) · [备用演示](https://smile-weather-studio.xjylance.chatgpt.site/)

点击开启摄像头，微笑下雨、张嘴大笑释放三波星星，移动头部让主要星星反弹。天气跟随主播，头部上方留出粒子落下与碰撞的空间。

## 2. Public Source

[公开源码与运行说明](https://github.com/jeremyxu-design/smile-weather)

单Canvas 2D、预绘贴图与预分配粒子池；实际绘制最高60Hz、识别目标15Hz，模型在开启摄像头后加载。仓库包含模块源码、生成脚本与30项核心回归测试。

## 3. Vibecoding复盘

初版把requestAnimationFrame当成固定60FPS，高刷屏模拟预览测得120.2FPS。我要求：“按单调时间将实际绘制限为60Hz，识别独立限15Hz；分别记录频率，模拟数据不得冒充摄像头性能。”改为到期才更新物理与绘制。同机同场景仅切换限频，模拟面板读数为120.0与60.1FPS，验证了绘制频率控制。

## 验证

30项核心测试在模块与生成单文件上通过。v0.5体验反馈“目前没有发现问题”。v0.5.1的真机量化与短片记录见[验收表](https://github.com/jeremyxu-design/smile-weather/blob/main/ACCEPTANCE.md)，测试范围和测量口径见[QA](https://github.com/jeremyxu-design/smile-weather/blob/main/QA.md)。
