# 山河列传 · Atlas of Lives

一部画在真实山河上的「列传」——把古今中外人物的一生，落回全球真实地形的叙事地图。底图为**全球**真实地形，既支持中国人物（苏轼、李白、杜甫……，附省界与省名细节），也支持横跨欧亚、地中海与美洲的世界人物（成吉思汗、拿破仑、恺撒、莎士比亚、玻利瓦尔……）。每位人物的生平节点、代表作品/事件和引文都落在真实经纬度上。

## 运行

```bash
python3 -m http.server 8080
```

打开 `http://localhost:8080`。

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

人物索引在 `data/people/index.json`，首页启动时只加载索引和默认人物。点击人物切换后，前端会按 `path` 懒加载对应的 journey JSON。索引条目含两个归类字段：`region` 是细分地理（如 `地中海`/`印度洋`/`北美`），`group` 是粗分大类（如 `中国`/`欧洲`/`美洲`），人物下拉框按 `group` 用 `<optgroup>` 分组显示。新增一个新大类时，给人物写上新的 `group` 值即可，前端自动生成分组。

每位人物一份 journey JSON（如 `data/sushi-journey.json`、`data/napoleon-journey.json`、`data/caesar-journey.json`）。新增人物 = 加一份 journey JSON + 在索引里登记，前端代码无需改动：

- `id`：人物数据集 ID
- `heading`：地图标题
- `types`：当前人物的分类标签与颜色
- `name`：地点名
- `short`：竖牌短名
- `years`：时间段
- `type`：分类，对应当前人物 `types` 中的键
- `lnglat`：真实经纬度
- `summary`：地点事件说明
- `quote`：代表诗句
- `works`：相关作品
- `poem`：全文诗词库中的作品标题
- `importance`：全国视角显示优先级
- `bounds`：可选，人物首页视野；缺省时前端会根据 `points` 自动计算

诗词全文集中在 `data/poems.json`。新增人物时，增加一份 journey JSON，并把人物元信息与文件路径写入 `data/people/index.json` 即可。

## 图层结构

- MapLibre GL JS 负责地图渲染和交互（globe 投影）
- `tiles/relief/{z}/{x}/{y}.webp` 是用公开 Terrarium DEM 瓦片烘焙的全球 relief raster tiles
- `geo/world-land.json` 提供全球陆地底色，`geo/world-countries.json` 提供世界国界
- `geo/world-rivers.json`、`geo/world-lakes.json` 提供全球水系
- `geo/100000_full.json` 额外提供中国省界与省名标注（仅在视野含中国时可见）
- 实时 Terrarium DEM hillshade 在 z4.8+ 全球懒加载，补足高 zoom 地形细节
- DOM Marker 负责竖牌地点标注
- GeoJSON LineString 负责生平路线和当前进度路线

## 烘焙 relief 瓦片

```bash
# 可选：先并发预热 DEM 缓存（比烘焙脚本内串行下载快很多）
python3 scripts/prefetch_dem.py
# 再烘焙
npm run bake:relief
```

脚本会下载 AWS Open Data 的 Terrarium DEM 瓦片到 `.cache/terrarium/`，输出 `tiles/relief/{z}/{x}/{y}.webp`。瓦片策略：

- 全球 relief：`z0-z5`（`z0-z3` 整图渲染，`z4-z5` 整行条带渲染以控内存，上下补 1 瓦片保证山体阴影无缝）
- 东亚额外细节：`z6`
- 其余地区 `z6+` 由 `z5` overzoom + 实时 hillshade 承担

MapLibre 会按当前视野懒加载可见瓦片。

> 若 Python 报 `CERTIFICATE_VERIFY_FAILED`（python.org 版常见），用 certifi 提供根证书：
> `SSL_CERT_FILE=$(python3 -c 'import certifi;print(certifi.where())') python3 scripts/bake_relief.py`

数据来源：

- AWS Open Data Terrain Tiles: https://registry.opendata.aws/terrain-tiles/
- Natural Earth land polygons: https://www.naturalearthdata.com/
- Mapzen Terrarium format: https://www.mapzen.com/blog/terrain-tile-service/
