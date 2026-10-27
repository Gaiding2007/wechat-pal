# 更新 GitHub 的步骤

仓库：<https://github.com/Gaiding2007/wechat-pal>

## 1. 本地提交

在项目根目录（`wechat-pal`）打开 PowerShell：

```powershell
git status
git add -A
git commit -m "release: 3.3.1 角色形象/图标/视频/双语文档"
git push origin main
```

如果提示 `Permission ... denied` / `403`：

```powershell
cmdkey /delete:git:https://github.com
git push origin main
```

弹出的账号密码框里：

- 用户名：`Gaiding2007`
- 密码：**Personal Access Token**（不是 GitHub 登录密码）
  - GitHub → Settings → Developer settings → Personal access tokens → Tokens (classic) → Generate new token
  - 勾选 `repo`，生成后复制，只显示一次

还不行就检查：邮箱是否验证、账号是否被 flagged、仓库是否确实在你名下。备选：GitHub 网页 → 仓库 → **Add file → Upload files**，把源码目录拖进去提交。

## 2. 上传 Release 附件

GitHub 仓库 → **Releases → Draft a new release**：

| 字段 | 值 |
| --- | --- |
| Tag | `v3.3.1` |
| Target | `main` |
| Title | `wechat-pal 3.3.1 · 鲸鱼娘住进微信` |
| 附件 | `dist/wechat-pal-setup-3.3.1.exe` |
| 附件（可选） | `dist/wechat-pal-intro.mp4`、`dist/bilibili-cover.png` |

Release notes 可以直接用 `迭代日志.md` 里 3.3.1 那一节。

## 3. 仓库首页设置

- About → Description：`可换人格的微信 AI 搭子：真实微信会话 / 朋友圈 / 表情 / 生图 / 自带运行时`
- Website：`https://github.com/Gaiding2007/wechat-pal/releases`
- Topics：`wechat` `ai` `chatbot` `persona` `windows` `python` `nodejs` `llm`
- 确认默认分支是 `main`，README 顶部的中英文切换能正常跳转。
- 如果 Releases 里附件下载慢，可以把安装包同时放到阿里云盘/夸克，README 里补一行备用链接。

## 4. 发布前自检

```powershell
node tests/all.test.js
node --check server.js
& .\runtime\python\python.exe -m py_compile bridge\wechat_bridge.py bridge\pal_rpc.py
```

- 安装包能装、能启动、桌面快捷方式图标正确；
- `启动微信聊天伴侣.bat` 打开网页，设置页能保存 Key；
- `启动微信桥接.bat` 能连上微信并打印账号/数据库目录；
- README 里的截图路径都存在；
- `data/`、`config.json` 没有被打进 git（`.gitignore` 已排除）。

## 5. 更新已有 Release

如果只是改 README/文档，不需要新 Release；直接 commit + push 即可。  
如果换了安装包：编辑对应 Release → 删除旧附件 → 上传新附件 → 更新 Release notes。
