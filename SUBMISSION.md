# Part 2 · Smile Weather v0.5.2

## 1. Live Demo

[打开演示](https://jeremyxu-design.github.io/smile-weather/) · [备用演示](https://smile-weather-studio.xjylance.chatgpt.site/)

点击开启摄像头，微笑下雨、张嘴大笑释放三波星星，移动头部让主要星星反弹。天气跟随主播，头部上方留出粒子落下与碰撞的空间。

## 2. Public Source

[公开源码与运行说明](https://github.com/jeremyxu-design/smile-weather)

单Canvas 2D、预绘贴图与预分配粒子池；实际绘制最高60Hz、识别目标15Hz，模型在开启摄像头后加载。仓库包含模块源码、生成脚本与33项核心回归测试。

## 3. Vibecoding复盘

初版把requestAnimationFrame当成固定60FPS，高刷屏模拟预览测得120.2FPS。我要求：“按单调时间将实际绘制限为60Hz，识别独立限15Hz；分别记录频率，模拟数据不得冒充摄像头性能。”改为到期才更新物理与绘制。同机同场景仅切换限频，模拟面板读数为120.0与60.1FPS，验证了绘制频率控制。

## 验证

33项核心测试在模块与生成单文件上通过。v0.5体验反馈“目前没有发现问题”。真机测试方法见[验收表](https://github.com/jeremyxu-design/smile-weather/blob/main/ACCEPTANCE.md)，测试范围和测量口径见[QA](https://github.com/jeremyxu-design/smile-weather/blob/main/QA.md)。

## 结构化提交文档

[下载4页PDF](https://jeremyxu-design.github.io/smile-weather/Part2_Smile_Weather.pdf) · [需求决策、边缘情况与成本取舍](https://github.com/jeremyxu-design/smile-weather/blob/main/DECISIONS.md)

2026-10-27，MacBook Pro单人自测：微笑10/10、大笑8/10；讲话时微笑误触发1次；张嘴大笑前先出现雨2次。后者为表情过渡现象，尚无逐帧记录证明原因；两次大笑未命中仍待定位。

本轮来自v0.5.2 Sites验收请求下的用户反馈；系统、浏览器版本、光照、讲话试验总数及60秒性能日志未提供，不计算讲话误触发率。iPhone本轮数据待补。
