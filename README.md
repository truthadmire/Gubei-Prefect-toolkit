# SUIS GB — Rota Builder (Offline, Vite + React + TS)

一键导入 Excel，随机/最优排布到教室；支持相邻两间、避免与上一轮重复（排布码）、年级过滤、手动拖拽修改、导出高清 JPG。

## 快速开始（本地）
```bash
npm i
npm run dev
```

## 部署（路线A：网页上传到 GitHub + Vercel）
1. 在 GitHub 新建仓库（Public），把本项目文件上传。
2. 登录 Vercel → New Project → 选择你的仓库。
3. Build Command: `npm run build`；Output: `dist`（Vite 默认）。
4. 部署完成即可得到 `https://<project>.vercel.app` 的网址。

## 使用步骤
1. “导入 Excel” 上传你当前的排布源表（会自动识别 Form/Room/Prefect/Role 与部门颜色）。
2. 修改“标题/日期”；使用“年级过滤”临时取消某年级。
3. 若要避免与上一轮重复，把上一轮的**排布码**粘贴到输入框（只需要 1 条）。
4. 点“生成排布”；不满意可拖拽手动调整。
5. 点“导出 JPG”下载高清图片；点“导出排布码”保存本轮字符串，下次粘贴即可避免重复。

## 说明
- 相邻定义：同栋、同层、房号相差 1（后续可加可视化相邻编辑器）。
- 最优匹配：以匈牙利算法（最小化成本）完成“人↔槽位”分配；成本包含“上一轮同房/同房对禁止（硬约束）+ 软惩罚 + 公平性因子”。
- Excel 颜色：尽量按单元格底色（十六进制）复刻；若缺省可在 UI 里手动覆盖。

## License
MIT
