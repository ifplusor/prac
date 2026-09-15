# prac 自己的活体门

断言 **prac 机制**（frame、目录、放置、持久化）的门住在这里；需要 VS Code 侧的集成门在 `vendor/vscode/scripts/`。
这条归属规则的理由很实在：门最初借用了上游 checkout 的 Playwright，于是 prac 自己的验证反过来依赖 `vscode:build` 跑过——依赖倒置。

```bash
# 需要一页活着的 DSH（profile prac-dev）；URL 带 token，和其它门一样
URL='http://127.0.0.1:3084/?token=…' pnpm verify:stack    # 堆叠：单视图裸渲染、两个叠放、折叠
URL='http://127.0.0.1:3084/?token=…' pnpm verify:bottom   # 底栏：空则不在、填了上屏、折叠还回空间
```

`harness.mjs` 提供启动 chromium、等 frame、控制台噪声过滤与像素质计数；`@playwright/test` 是**根 devDep**（pin 与上游同版本，两边共用浏览器缓存）。
