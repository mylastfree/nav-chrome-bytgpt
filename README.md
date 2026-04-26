# Nav ByGPT

Nav ByGPT 是一个本地优先的 Chrome 新标签页网址导航插件。它适合个人把常用网站整理成分组卡片，设置成 Chrome 新标签页使用。

这个项目的目标是简单、免费、稳定、容易备份。它不是公开注册平台，不提供账号系统，不依赖服务器，也不做云端同步。

## 适合谁

- 想把 Chrome 新标签页变成个人网址导航页的人
- 想从 iTab 或 JSON 备份迁移网址的人
- 想要本地保存数据、不想依赖第三方导航服务的人
- 想自己改代码、自己打包 Chrome 插件的人

## 不适合谁

- 需要多人账号和权限管理
- 需要云同步或团队协作
- 需要公开 SaaS 服务
- 需要跨浏览器自动同步所有数据

## 功能

- 替换 Chrome 新标签页为网址导航
- 左侧显示分组，点击分组后只显示该分组的网站
- 网站卡片显示图标、名称、网址和点击次数
- 鼠标悬停卡片时显示编辑、删除小图标
- 支持搜索当前分组或全部分组
- 支持新增、修改、删除、排序分组
- 支持新增、修改、删除、拖拽排序网站
- 支持深色、浅色主题切换
- 支持卡片布局、背景和分组颜色设置
- 支持导入 JSON 和 iTab `.itabdata` 备份
- 支持导出 JSON 备份
- 保存和导入前自动保留本地备份
- 支持重复网址高亮和整理
- 支持批量检测网址是否疑似失效
- 数据保存在本机 Chrome 的 `chrome.storage.local`

## 技术路线

- React + TypeScript + Vite
- Chrome Extension Manifest V3
- 新标签页入口：`chrome_url_overrides.newtab`
- 本地数据：`chrome.storage.local`
- 开发环境兜底：`localStorage`

## 本地开发

安装依赖：

```powershell
npm install
```

启动开发服务：

```powershell
npm run dev
```

普通 Vite 开发服务没有 Chrome 扩展 API，程序会自动使用 `localStorage`，方便先调 UI。

## 构建

```powershell
npm run build
```

构建产物在 `dist/`。`public/manifest.json`、`public/background.js` 和图标文件会被复制到 `dist/`，用于加载 Chrome 插件。

## 打包 Chrome 插件

```powershell
npm run package:extension
```

打包结果输出到 `release/`：

```text
release/nav-bygpt-chrome-extension-unpacked/
release/nav-bygpt-chrome-extension-YYYYMMDD_HHMMSS.zip
release/nav-bygpt-chrome-extension-YYYYMMDD_HHMMSS.zip.sha256
```

日常本机使用推荐加载：

```text
release/nav-bygpt-chrome-extension-unpacked/
```

zip 主要用于备份、发 GitHub Release，或拷贝到另一台电脑。

## 安装到 Chrome

1. 运行 `npm run package:extension`。
2. 打开 Chrome 地址栏：`chrome://extensions/`。
3. 打开右上角“开发者模式”。
4. 点击“加载已解压的扩展程序”。
5. 选择 `D:\mycodex\cf-startpage\release\nav-bygpt-chrome-extension-unpacked`。
6. 打开一个新标签页，应该会显示 Nav ByGPT 导航页。

如果想让打开 Chrome 时也进入这个页面，把 Chrome 启动设置改成“打开新标签页”。

## 更新插件

更新代码后重新打包：

```powershell
npm run package:extension
```

然后在 `chrome://extensions/` 点击本插件卡片上的刷新按钮，或重新加载已解压目录。

正常更新不会清空 `chrome.storage.local` 里的数据。为了安全，更新前建议先在插件里点击“导出”，保存一份 JSON 备份。

注意：每次提交新版本前，需要同步升级 `package.json` 和 `public/manifest.json` 的小版本号。

## 数据备份和恢复

编辑模式里点击“导出”可以下载完整 JSON 备份。换电脑或重装浏览器后，进入编辑模式点击“导入”，选择之前导出的 JSON，再点击“保存”即可写入本机 Chrome。

导入也支持 iTab 的 `.itabdata` 文件。程序会把 iTab 分组转换成本程序分组，把 iTab 文件夹展开成“父分组 / 文件夹名”的独立分组，只保留 `http` / `https` 网址，`chrome://`、`itab://` 这类内部地址会在导入预览里列出并跳过。

每次保存或确认导入前，程序会在本地保留上一版数据。导入错了或误改了，可以在编辑模式里点击“恢复上次备份”，恢复后再点击“保存”。

卸载插件、清理浏览器配置、重装系统之前，请先手动导出 JSON 备份。自动备份也保存在本机 Chrome 里，不能替代离线备份文件。

## 权限说明

`storage`：保存分组、网址、主题、点击次数和本地备份。

`host_permissions`：只在用户手动点击“批量检测网址”时，用于检测已保存网址是否还能访问。

`connect-src http/https`：用于加载 favicon、用户自定义图标，以及批量检测网址状态。

插件不注入网页脚本，不读取网页正文，不收集浏览历史，不上传导航数据到作者服务器。

## 常见问题

### 新标签页没有变成导航页

先确认插件已经启用，并且没有另一个扩展也在接管 Chrome 新标签页。Chrome 只允许一个扩展覆盖新标签页。

### 导入失败

只支持本项目导出的 JSON，或 iTab `.itabdata` 备份。文件超过 10MB 或网址数量过多时会被拒绝，请先拆分或精简。

### 批量检测显示失效，但网站能打开

这是可能的。有些网站会拒绝 `HEAD` 请求、限制跨域请求，或返回 `403` / `429`。这种情况可以点击“确认正常”，把它从问题清单中移出。

### favicon 没显示

默认 favicon 来自第三方图标服务。某些网站没有公开图标，或网络暂时无法访问图标服务时，图标可能为空。可以手动填写图标地址。

## 验证

每次改动后至少运行：

```powershell
npm test
npm run build
npm run package:extension
```

打包后确认 zip 里只有插件运行需要的文件，不要包含 `node_modules/`、`src/`、`release/`、`.git/` 或 `.superpowers/`。
