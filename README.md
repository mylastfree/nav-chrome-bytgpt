# CF Startpage

单人自用的网址导航页。前端部署到 Cloudflare Pages，编辑数据保存到 Cloudflare KV。

## 功能

- 首页显示分组和网站卡片
- 搜索网站标题、网址和分组名
- 自动用网站域名显示 favicon
- 手机和电脑自适应布局
- 管理员密码解锁编辑模式
- 新增、修改、删除、排序分组
- 新增、修改、删除、排序网站
- 保存完整 JSON 到 Cloudflare KV
- 导出 JSON 备份
- 导入 JSON 恢复
- 保存前自动生成最近 20 份 KV 备份

## 技术路线

- React + TypeScript + Vite
- Cloudflare Pages 静态托管
- `public/_worker.js` 提供 `/api/dashboard`
- Cloudflare KV 保存单份 `dashboard` JSON
- `STARTPAGE_KV` 作为 KV binding 变量名
- `ADMIN_TOKEN` 环境变量控制写权限

## 本地开发

安装依赖：

```powershell
npm install
```

启动纯前端开发服务器：

```powershell
npm run dev
```

这个模式没有 Cloudflare Worker，页面会退回浏览器 `localStorage`，方便先调 UI。

验证 Cloudflare Worker 和 KV 绑定：

```powershell
npm run cf:dev
```

脚本会用 `dev-secret` 作为本地管理员密码，并创建本地 KV 模拟绑定。

## 打包成 Cloudflare Pages 上传包

```powershell
npm run package:direct
```

打包结果会出现在 `release/` 目录，例如：

```text
release/cf-startpage-direct-upload-20260426_010000.zip
release/cf-startpage-direct-upload-20260426_010000.zip.sha256
```

这个 zip 用于 Cloudflare Pages 的 Direct Upload。zip 根目录里包含 `index.html`、`assets/`、`_headers`、`_worker.js`。

## Cloudflare Pages 上传部署

1. 进入 Cloudflare Dashboard。
2. 打开 `Workers & Pages`。
3. 创建 Pages 项目，选择 Direct Upload / Upload assets。
4. 上传 `release/cf-startpage-direct-upload-*.zip`。
5. 第一次部署后，进入项目设置，添加 KV binding：

```text
Variable name: STARTPAGE_KV
KV namespace: 选择你的 KV namespace
```

6. 添加环境变量：

```text
Variable name: ADMIN_TOKEN
Value: 一串足够长的随机密码
```

7. 重新上传同一个 zip，生成新部署，让 binding 和环境变量在部署里生效。

## API

公开读取：

```http
GET /api/dashboard
```

管理员保存：

```http
PUT /api/dashboard
Authorization: Bearer <ADMIN_TOKEN>
Content-Type: application/json
```

KV key：

```text
dashboard
backup:<timestamp>
```

## Chrome 启动页设置

```text
Chrome 设置 -> 启动时 -> 打开特定网页或一组网页 -> 添加 Cloudflare Pages 网址
```

这样打开 Chrome 时会进入导航站。新建标签页要自动打开这个站点，则后续需要单独做 Chrome 扩展。
