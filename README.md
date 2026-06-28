# 东坡行旅图

一个可复用的山河叙事地图模板。当前示例把苏轼生平节点、代表作品和诗句落到真实中国地图上。

## 运行

```bash
python3 -m http.server 5173
```

打开 `http://localhost:5173`。

也可以使用 npm 脚本：

```bash
npm run preview
```

## Vercel 部署

预览部署：

```bash
npm install
npm run deploy:preview
```

生产部署：

```bash
npm run deploy:prod
```

`vercel.json` 为静态资源设置了缓存策略；`.vercelignore` 会排除本地工作流文件和依赖目录。

## 数据结构

叙事数据在 `data/sushi-journey.json`：

- `name`：地点名
- `short`：竖牌短名
- `years`：时间段
- `type`：分类，当前支持 `origin`、`office`、`exile`、`final`
- `lnglat`：真实经纬度
- `summary`：地点事件说明
- `quote`：代表诗句
- `works`：相关作品
- `importance`：全国视角显示优先级

替换这份 JSON，就可以做李白、杜甫、丝绸之路、茶马古道等其他主题。

## 图层结构

- MapLibre GL JS 负责地图渲染和交互
- `assets/china-relief-baked.webp` 是用公开 Terrarium DEM 瓦片烘焙的经纬度配准中国地形底图
- `geo/100000_full.json` 和 `geo/china-outline.json` 提供真实中国边界
- `geo/ne_50m_rivers_cn.json`、`geo/ne_50m_lakes_cn.json` 提供水系
- DOM Marker 负责竖牌地点标注
- GeoJSON LineString 负责生平路线和当前进度路线

## 烘焙 relief 图

```bash
python3 scripts/bake_relief.py
```

脚本会下载 AWS Open Data 的 Terrarium DEM 瓦片到 `.cache/terrarium/`，输出 `assets/china-relief-baked.webp`。

数据来源：

- AWS Open Data Terrain Tiles: https://registry.opendata.aws/terrain-tiles/
- Mapzen Terrarium format: https://www.mapzen.com/blog/terrain-tile-service/
