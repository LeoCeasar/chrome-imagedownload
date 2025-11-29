# Image Downloader & Converter (Chrome Extension)

扫描当前网页上的图片，将其列出以供选择下载。支持保留原格式下载，或转换为 JPEG（可调画质）后下载。

## 功能特性
- 扫描图片：自动识别 `<img>` 的 `src`、`srcset`、常见懒加载属性以及 CSS `background-image` 的图片链接。
- 批量选择：在弹窗中勾选要下载的图片。
- 下载格式：
  - 保留原格式：直接使用图片原始链接下载。
  - 转换为 JPEG：在扩展弹窗中使用 Canvas 转换并以指定画质导出为 `.jpg` 下载。
- 文件名处理：自动从 URL 推断文件名，避免非法文件名字符。

## 新增：侧边栏 + 实时更新
- 侧边栏展示：通过 Chrome Side Panel 在浏览页面时常驻显示媒体列表（图片/视频）。
- 实时更新：内容脚本使用 `MutationObserver` 监听 DOM 变化，侧边栏通过长连接自动接收最新媒体列表。
- 操作一致：侧边栏同样支持选择、全选/清空、原格式或 JPEG 下载。

## 缩略图与预览增强
- 缩略图适配：默认“完整显示（contain）”，可切换为“裁剪填充（cover）”。
- 悬浮预览：鼠标悬浮缩略图显示更大预览（侧边栏支持图片与视频）。
- 预览大小：小/中/大 三档可选。
- 尺寸角标：在缩略图右下角显示原始宽×高。
- 预览元信息：尝试通过 `HEAD` 请求显示 `Content-Type` 与大小（若服务器允许）。
 - 预览延迟：可设置显示延迟，减少快速滑动时的频繁弹出。
 - 点击固定：可勾选“点击固定预览”，点击缩略图可固定/取消固定预览。

## 偏好设置持久化
- 使用 `chrome.storage.local` 记忆以下设置：
  - 缩略图适配模式（contain/cover）
  - 悬浮预览开关
  - 预览大小（小/中/大）
  - 预览延迟（ms）
  - 是否启用“点击固定预览”

## 过滤与搜索
- 侧边栏：
  - 类型：全部 / 仅图片 / 仅视频。
  - 域筛选：按域或 URL 子串过滤。
  - 搜索：按文件名或 URL 关键字过滤。
- 弹窗：
  - 域筛选 + 搜索（仅图片）。

## 安装与使用
1. 克隆或下载本项目代码到本地。
2. 打开 Chrome，访问 `chrome://extensions/`。
3. 右上角打开“开发者模式”。
4. 点击“加载已解压的扩展程序”，选择本项目根目录（包含 `manifest.json` 的文件夹）。
5. 打开任意网页，点击工具栏中的扩展图标，打开“Image Downloader”弹窗：
   - 点击“扫描”获取当前页面图片。
   - 勾选要下载的图片。
   - 在“保留原格式 / 转换为 JPEG”中选择需要的格式；如果选择 JPEG，可在右侧调节画质（默认 0.92）。
   - 点击“下载所选”。
   - 点击“打开侧边栏”可在浏览该标签页时，侧边栏实时展示图片/视频并可直接下载。

## 权限说明
- `downloads`：用于触发浏览器下载并设置文件名。
- `activeTab`：用于与当前激活标签页进行通信（向内容脚本请求图片列表）。
- `storage`：预留位，将来可以用于保存用户偏好（比如默认画质）。
- `host_permissions: <all_urls>`：允许扩展从任意域跨源获取图片数据（在 JPEG 转换时通过 `fetch` 拉取原图）。
- `sidePanel`：用于打开和控制 Chrome 侧边栏。

## 实现说明
- Manifest V3：
  - `content_scripts`（`src/content-script.js`）负责在页面中扫描图片/视频链接；同时使用 `MutationObserver` + Port 长连接向侧边栏实时推送。
  - 弹窗（`src/popup.html / .js / .css`）负责展示、选择与下载逻辑。JPEG 转换在弹窗中通过 Canvas 完成。
  - 侧边栏（`src/sidepanel.html / .js`）与内容脚本通过 `chrome.tabs.connect` 建立长连接，实时渲染媒体列表并支持下载。
- JPEG 转换：
  - 弹窗中通过 `fetch(url)` 拉取图片为 `Blob`，再用 `Image + Canvas` 绘制并导出 `image/jpeg`。
  - 使用 `chrome.downloads.download` 下载 `Blob URL`（或原图 URL）。

## 已知限制
- 极个别站点可能有防盗链或严格的 CORS/Referrer 策略，导致图片无法被成功拉取以做 JPEG 转换；此时可选择“保留原格式”下载。
- 页面图片数量非常多时，首次渲染可能较慢。
- 通过复杂脚本动态生成的图片、有些 `canvas` 动态绘制的图像无法直接被扫描到。

## 目录结构
```
manifest.json
src/
  content-script.js
  popup.html
  popup.js
  popup.css
  sidepanel.html
  sidepanel.js
README.md
plan.md
```

## 开发与调试
- 修改代码后，到 `chrome://extensions/` 中点击扩展卡片的“刷新”按钮重新加载。
- 使用 DevTools：
  - 弹窗页面可右键 -> 审查元素，查看控制台日志。
  - 内容脚本日志可在目标页面的 DevTools 控制台查看。

## 许可证
本项目仅用于演示用途，未附带明确许可证。如需在项目中使用，请与作者确认或补充许可证条款。
