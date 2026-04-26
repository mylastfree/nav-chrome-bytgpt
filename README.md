# Nav ByGPT

单人自用的本地 Chrome 新标签页网址导航。打开 Chrome 新标签页时直接显示导航页，数据保存在当前 Chrome 用户配置里的 `chrome.storage.local`。

## 功能

- 首页显示网址导航
- 左侧竖列显示分组标签，点击分组后只显示该分组的网站
- 网站卡片显示图标、网站名称和网址
- 点击网站卡片在新标签页打开 URL
- 支持搜索当前分组的网站
- 自动显示 favicon，也可以手动填写图标地址
- 手机和电脑都能看，移动端分组标签横向滚动
- 直接进入编辑模式，不需要管理员密码
- 新增、修改、删除、排序分组
- 新增、修改、删除、排序网站
- 数据保存到本机 Chrome
- 导出 JSON 备份
- 导入 JSON 恢复

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

启动 Vite 开发服务：

```powershell
npm run dev
```

开发服务没有 Chrome 扩展 API 时会自动使用 `localStorage`，方便先调 UI。

## 构建

```powershell
npm run build
```

构建产物在 `dist/`。`public/manifest.json` 会被复制到 `dist/manifest.json`，用于加载 Chrome 插件。

## 安装到 Chrome

1. 运行 `npm run build`。
2. 打开 `chrome://extensions/`。
3. 打开右上角“开发者模式”。
4. 点击“加载已解压的扩展程序”。
5. 选择 `D:\mycodex\cf-startpage\dist`。
6. 打开一个新标签页，应该会显示 Nav ByGPT 导航页。

如果想让打开 Chrome 时也进入这个页面，把 Chrome 启动设置改成“打开新标签页”。

## 打包插件 zip

```powershell
npm run package:extension
```

打包结果会输出到 `release/`：

```text
release/nav-bygpt-chrome-extension-unpacked/
release/nav-bygpt-chrome-extension-YYYYMMDD_HHMMSS.zip
release/nav-bygpt-chrome-extension-YYYYMMDD_HHMMSS.zip.sha256
```

日常本机使用推荐加载 `release/nav-bygpt-chrome-extension-unpacked/` 或 `dist/`。zip 主要用于备份或拷贝到另一台电脑。

## 数据备份

编辑模式里点击“导出”可以下载完整 JSON 备份。换电脑或重装浏览器后，进入编辑模式点击“导入”，选择之前导出的 JSON，再点击“保存”即可写入本机 Chrome。

## 验证

每次改动后至少运行：

```powershell
npm test
npm run build
npm run package:extension
```
