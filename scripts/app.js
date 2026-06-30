const DEFAULT_BOUNDS = [[97, 20.5], [123, 45]];
const HOME_PADDING = { top: 96, bottom: 96, left: 42, right: 42 };
const REGIONAL_RELIEF_TILE_BOUNDS = [56.25, 16.63619, 140.625, 55.77657];
const RELIEF_VERSION = "20260630-world";
const RELIEF_TILES = `tiles/relief/{z}/{x}/{y}.webp?v=${RELIEF_VERSION}`;
const DEM_TILES = "https://elevation-tiles-prod.s3.dualstack.us-east-1.amazonaws.com/terrarium/{z}/{x}/{y}.png";

let points = [];
let markers = [];
let journeys = {};
let peopleCatalog = [];
let poems = {};
let activeJourney = null;
let activeIndex = 0;
let loadingJourneyId = "";

const map = new maplibregl.Map({
  container: "map",
  style: {
    version: 8,
    projection: { type: "globe" },
    sources: {},
    layers: [
      { id: "bg", type: "background", paint: { "background-color": "#c3d3cf" } }
    ]
  },
  center: [105, 34],
  zoom: 2.7,
  pitch: 0,
  bearing: 0,
  minZoom: 2.4,
  maxZoom: 12.5,
  maxPitch: 75,
  renderWorldCopies: false,
  attributionControl: false
});

map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "top-right");

function fitHome(duration = 700) {
  map.fitBounds(homeBounds(), {
    padding: HOME_PADDING,
    pitch: 0,
    bearing: 0,
    duration
  });
}

function homeBounds() {
  if (activeJourney?.bounds) return activeJourney.bounds;
  const routePoints = activeJourney?.points || points;
  if (!routePoints.length) return DEFAULT_BOUNDS;

  const lngs = routePoints.map((point) => point.lnglat[0]);
  const lats = routePoints.map((point) => point.lnglat[1]);
  let west = Math.min(...lngs);
  let east = Math.max(...lngs);
  let south = Math.min(...lats);
  let north = Math.max(...lats);

  if (west === east) {
    west -= 1;
    east += 1;
  }
  if (south === north) {
    south -= 1;
    north += 1;
  }

  const lngPad = Math.max((east - west) * 0.14, 1.2);
  const latPad = Math.max((north - south) * 0.14, 1.2);
  return [
    [Math.max(-180, west - lngPad), Math.max(-85, south - latPad)],
    [Math.min(180, east + lngPad), Math.min(85, north + latPad)]
  ];
}

function setLoaderHidden() {
  const loader = document.getElementById("loader");
  loader.classList.add("hide");
  window.setTimeout(() => loader.remove(), 420);
}

async function getJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`无法载入 ${url}`);
  return response.json();
}

// 深链接：从 URL ?p=<人物id>&i=<第几站> 读取初始状态
function initialState() {
  const params = new URLSearchParams(location.search);
  const id = params.get("p") || "";
  const i = parseInt(params.get("i"), 10);
  return {
    id: peopleCatalog.some((person) => person.id === id) ? id : "",
    index: Number.isFinite(i) ? i - 1 : 0
  };
}

function clampIndex(index) {
  if (!points.length) return 0;
  return Math.min(Math.max(0, index || 0), points.length - 1);
}

// 切换人物/节点时把状态写回 URL，便于分享「直接打开某人的某一站」
function updateUrl() {
  if (!activeJourney) return;
  const params = new URLSearchParams();
  params.set("p", activeJourney.id);
  params.set("i", String(activeIndex + 1));
  history.replaceState(null, "", `?${params.toString()}`);
}

function addReliefTiles() {
  map.addSource("relief-global", {
    type: "raster",
    tiles: [RELIEF_TILES],
    tileSize: 256,
    minzoom: 0,
    maxzoom: 5
  });
  map.addSource("relief-cn", {
    type: "raster",
    tiles: [RELIEF_TILES],
    tileSize: 256,
    minzoom: 6,
    maxzoom: 6,
    bounds: REGIONAL_RELIEF_TILE_BOUNDS
  });
  map.addLayer({
    id: "relief-global-img",
    type: "raster",
    source: "relief-global",
    paint: {
      "raster-fade-duration": 0,
      "raster-opacity": ["interpolate", ["linear"], ["zoom"], 1.8, .95, 6.8, .46, 10, .28, 12, .2]
    }
  });
  map.addLayer({
    id: "relief-cn-img",
    type: "raster",
    source: "relief-cn",
    paint: {
      "raster-fade-duration": 0,
      "raster-opacity": ["interpolate", ["linear"], ["zoom"], 3.8, 0, 4.6, .92, 7.2, .58, 9.5, .36, 12, .24]
    }
  });
}

function addWorldBase(land) {
  map.addSource("world-land", { type: "geojson", data: land });
  // 全球陆地纸质底色，垫在 relief 栅格之下
  map.addLayer({
    id: "relief-base",
    type: "fill",
    source: "world-land",
    paint: { "fill-color": "#aebd8a", "fill-opacity": 1 }
  }, "relief-global-img");
}

function addChinaProvinces(china) {
  map.addSource("china", { type: "geojson", data: china });
  map.addLayer({
    id: "prov-fill",
    type: "fill",
    source: "china",
    paint: {
      "fill-color": "#e8d2a8",
      "fill-opacity": 0.14
    }
  }, "journey-route");

  // 省名标注只对中国有意义；查看其他地区时它们随地图移出视野，互不干扰
  china.features.forEach((feature) => {
    const center = feature.properties && (feature.properties.center || feature.properties.centroid);
    if (!center) return;
    const el = document.createElement("div");
    el.className = "province-label";
    el.textContent = feature.properties.name.replace(/(维吾尔|壮族|回族)?自治区|特别行政区|省|市/g, "");
    Object.assign(el.style, {
      color: "#7d6536",
      font: "600 12px Kaiti SC, STKaiti, KaiTi, serif",
      letterSpacing: "2px",
      pointerEvents: "none",
      opacity: ".72"
    });
    new maplibregl.Marker({ element: el }).setLngLat(center).addTo(map);
  });
}

function addBorders(countries) {
  map.addSource("world-countries", { type: "geojson", data: countries });
  // 世界各国国界
  map.addLayer({
    id: "country-line",
    type: "line",
    source: "world-countries",
    paint: { "line-color": "#7c5b31", "line-width": 1.1, "line-opacity": 0.5 }
  }, "journey-route");
  // 中国省界（叠在国界之上，给中国人物更细的脉络）
  map.addLayer({
    id: "prov-line",
    type: "line",
    source: "china",
    paint: { "line-color": "#a98e5f", "line-width": 0.75, "line-opacity": 0.66 }
  }, "journey-route");
}

function addWater(rivers, lakes) {
  map.addSource("rivers", { type: "geojson", data: rivers });
  map.addSource("lakes", { type: "geojson", data: lakes });
  // 水系叠在 relief 之上、国界/省界之下（addBorders 在此之后调用）
  map.addLayer({
    id: "lakes",
    type: "fill",
    source: "lakes",
    paint: { "fill-color": "#8cb8bf", "fill-opacity": 0.78 }
  }, "journey-route");
  map.addLayer({
    id: "rivers-under",
    type: "line",
    source: "rivers",
    layout: { "line-cap": "round", "line-join": "round" },
    paint: {
      "line-color": "#4f7d8c",
      "line-opacity": 0.42,
      "line-width": ["interpolate", ["linear"], ["zoom"], 3, 1.6, 7, 4.4]
    }
  }, "journey-route");
  map.addLayer({
    id: "rivers",
    type: "line",
    source: "rivers",
    layout: { "line-cap": "round", "line-join": "round" },
    paint: {
      "line-color": "#8fc0c6",
      "line-opacity": 0.95,
      "line-width": ["interpolate", ["linear"], ["zoom"], 3, .75, 7, 2.1]
    }
  }, "journey-route");
}

function addTerrainSources() {
  // 全球地形阴影：去掉区域 bounds，按视野从 AWS Terrarium 懒加载
  const dem = {
    type: "raster-dem",
    encoding: "terrarium",
    tiles: [DEM_TILES],
    tileSize: 256,
    maxzoom: 8
  };
  map.addSource("dem-hs", dem);
  map.addLayer({
    id: "hillshade",
    type: "hillshade",
    source: "dem-hs",
    minzoom: 4.8,
    paint: {
      "hillshade-shadow-color": "#6e4f2c",
      "hillshade-highlight-color": "#fff6dd",
      "hillshade-accent-color": "#8a6a3f",
      "hillshade-exaggeration": 0.18
    }
  }, "journey-route");
}

function makeRoute() {
  // route:false 的人物（如以作品而非行程为主的文学家）不画连接线
  const coordinates = activeJourney?.route === false ? [] : points.map((point) => point.lnglat);
  return {
    type: "Feature",
    properties: {},
    geometry: {
      type: "LineString",
      coordinates
    }
  };
}

function typeLabel(type) {
  return activeJourney.types[type]?.label || type;
}

function typeColor(type) {
  return activeJourney.types[type]?.color || "#9c2f1b";
}

function clearMarkers() {
  markers.forEach(({ marker }) => marker.remove());
  markers = [];
}

function addRouteLayer() {
  map.addSource("journey-route", { type: "geojson", data: makeRoute() });
  map.addLayer({
    id: "journey-route",
    type: "line",
    source: "journey-route",
    layout: { "line-cap": "round", "line-join": "round" },
    paint: {
      "line-color": "#9c2f1b",
      "line-opacity": ["interpolate", ["linear"], ["zoom"], 3, .38, 6, .18],
      "line-width": ["interpolate", ["linear"], ["zoom"], 3, .9, 7, 2],
      "line-dasharray": [2, 2]
    }
  });
}

function renderMarkers() {
  clearMarkers();
  points.forEach((point, index) => {
    const el = document.createElement("button");
    el.className = `journey-marker type-${point.type}`;
    el.type = "button";
    el.setAttribute("aria-label", `查看${point.name}`);
    el.dataset.type = point.type;
    el.innerHTML = `<span class="flag" style="background:${typeColor(point.type)}"><span class="seal">${activeJourney.seal}</span><span class="name">${point.short}</span></span><span class="pole" style="background:${typeColor(point.type)}"></span><span class="dot" style="background:${typeColor(point.type)}"></span>`;
    el.addEventListener("click", () => selectPoint(index, true));
    const marker = new maplibregl.Marker({ element: el, anchor: "bottom" }).setLngLat(point.lnglat).addTo(map);
    markers.push({ point, marker, el });
  });
}

function renderTitle() {
  document.title = `${activeJourney.heading} | 山河列传`;
  document.getElementById("titleKicker").textContent = activeJourney.kicker;
  document.getElementById("titleHeading").textContent = activeJourney.heading;
  document.getElementById("titleSubtitle").textContent = activeJourney.subtitle;
  document.getElementById("searchInput").placeholder = activeJourney.searchPlaceholder;
}

function renderTimeline() {
  const timeline = document.getElementById("timeline");
  timeline.innerHTML = points.map((point, index) => `
    <li data-index="${index}">
      <time>${point.years.split("-")[0]}</time>
      <div>
        <b>${point.name}</b>
        <span>${typeLabel(point.type)} · ${point.works[0] || "生平节点"}</span>
      </div>
    </li>
  `).join("");
  timeline.querySelectorAll("li").forEach((item) => {
    item.addEventListener("click", () => selectPoint(Number(item.dataset.index), true));
  });
}

function selectPoint(index, fly) {
  activeIndex = (index + points.length) % points.length;
  const point = points[activeIndex];
  const poem = poemForPoint(point);
  document.getElementById("storyYears").textContent = point.years;
  document.getElementById("storyTitle").textContent = `${point.name} · ${typeLabel(point.type)}`;
  document.getElementById("storyText").textContent = point.summary;
  document.getElementById("storyWorks").innerHTML = point.works.map((work) => `<span>${work}</span>`).join("");
  document.getElementById("storyQuote").textContent = point.quote;
  document.getElementById("poemOpen").hidden = !poem;
  document.getElementById("progressText").textContent = `第 ${activeIndex + 1} / ${points.length} ${activeJourney.unit || "站"}`;
  document.getElementById("progressBar").style.transform = `scaleX(${(activeIndex + 1) / points.length})`;
  markers.forEach((marker, i) => marker.el.classList.toggle("active", i === activeIndex));
  document.querySelectorAll(".timeline li").forEach((item) => {
    item.classList.toggle("on", Number(item.dataset.index) === activeIndex);
  });
  updateUrl();
  if (fly) {
    map.flyTo({
      center: point.lnglat,
      zoom: Math.max(map.getZoom(), 5.7),
      pitch: 0,
      bearing: 0,
      duration: 1500,
      curve: 1.42,
      essential: true
    });
  }
}

function poemForPoint(point) {
  const title = point.poem || point.works.find((work) => poems[work]);
  if (!title || !poems[title]) return null;
  return { title, ...poems[title] };
}

function openPoemModal() {
  const point = points[activeIndex];
  const poem = poemForPoint(point);
  if (!poem) return;
  const modal = document.getElementById("poemModal");
  const body = document.getElementById("poemBody");
  document.getElementById("poemAuthor").textContent = `${poem.author} · ${point.name}`;
  document.getElementById("poemTitle").textContent = poem.title;
  body.replaceChildren();
  poem.body.forEach((line) => {
    const p = document.createElement("p");
    p.textContent = line;
    body.appendChild(p);
  });
  modal.hidden = false;
  document.body.classList.add("modal-open");
  document.getElementById("poemClose").focus();
}

function closePoemModal() {
  document.getElementById("poemModal").hidden = true;
  document.body.classList.remove("modal-open");
  document.getElementById("poemOpen").focus();
}

function selectAdjacent(direction) {
  const next = (activeIndex + direction + points.length) % points.length;
  selectPoint(next, true);
}

function searchableText(point) {
  const poem = poemForPoint(point);
  const poemText = poem ? [poem.title, poem.author, ...poem.body] : [];
  return [point.name, point.short, point.years, typeLabel(point.type), point.summary, point.quote, ...point.works, ...poemText]
    .join(" ")
    .toLowerCase();
}

function renderSearchResults(query) {
  const panel = document.getElementById("searchResults");
  const value = query.trim().toLowerCase();
  if (!value) {
    panel.hidden = true;
    panel.innerHTML = "";
    return;
  }
  const matches = points
    .map((point, index) => ({ point, index, text: searchableText(point) }))
    .filter((item) => item.text.includes(value))
    .slice(0, 8);
  if (!matches.length) {
    panel.hidden = false;
    panel.innerHTML = `<p>没有匹配的地点或作品</p>`;
    return;
  }
  panel.hidden = false;
  panel.innerHTML = matches.map(({ point, index }) => `
    <button type="button" data-index="${index}">
      <b>${point.name}</b>
      <span>${typeLabel(point.type)} · ${point.works.join(" / ")}</span>
    </button>
  `).join("");
  panel.querySelectorAll("button").forEach((button) => {
    button.addEventListener("click", () => {
      const index = Number(button.dataset.index);
      selectPoint(index, true);
      panel.hidden = true;
    });
  });
}

async function loadJourney(journeyId) {
  if (journeys[journeyId]) return journeys[journeyId];
  const person = peopleCatalog.find((item) => item.id === journeyId);
  if (!person) throw new Error(`未知人物：${journeyId}`);
  const journey = await getJson(person.path);
  journeys[journey.id] = journey;
  return journey;
}

function groupedCatalog() {
  // 按 group 字段分组；缺省归入「其他」。分组顺序按首次出现的次序。
  const order = [];
  const byGroup = new Map();
  peopleCatalog.forEach((person) => {
    const key = person.group || person.region || "其他";
    if (!byGroup.has(key)) {
      byGroup.set(key, []);
      order.push(key);
    }
    byGroup.get(key).push(person);
  });
  return order.map((key) => ({ key, people: byGroup.get(key) }));
}

function renderPersonSelect() {
  const panel = document.getElementById("personPanel");
  panel.replaceChildren(...groupedCatalog().map(({ key, people }) => {
    const group = document.createElement("div");
    group.className = "person-group";
    group.dataset.group = key;

    const head = document.createElement("button");
    head.type = "button";
    head.className = "person-group-head";
    head.innerHTML = `<span class="grp-name">${key}</span><span class="grp-count">${people.length}</span><span class="grp-chevron">▾</span>`;
    head.addEventListener("click", () => group.classList.toggle("collapsed"));

    const list = document.createElement("div");
    list.className = "person-group-list";
    list.append(...people.map((person) => {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "person-item";
      item.dataset.id = person.id;
      item.textContent = `${person.name} · ${person.label}`;
      item.addEventListener("click", () => {
        closePersonPanel();
        setJourney(person.id);
      });
      return item;
    }));

    group.append(head, list);
    return group;
  }));
}

// 打开下拉时只展开当前人物所在的分组，其余折叠，避免一屏看不完
function syncPersonPanel() {
  const activeId = activeJourney?.id;
  const panel = document.getElementById("personPanel");
  panel.querySelectorAll(".person-group").forEach((group) => {
    const hasActive = activeId && group.querySelector(`.person-item[data-id="${activeId}"]`);
    group.classList.toggle("collapsed", !hasActive);
  });
  panel.querySelectorAll(".person-item").forEach((item) => {
    item.classList.toggle("active", item.dataset.id === activeId);
  });
  const activeItem = panel.querySelector(".person-item.active");
  if (activeItem) activeItem.scrollIntoView({ block: "nearest" });
}

function openPersonPanel() {
  document.getElementById("personTrigger").setAttribute("aria-expanded", "true");
  document.getElementById("personPanel").hidden = false;
  syncPersonPanel();
}

function closePersonPanel() {
  document.getElementById("personTrigger").setAttribute("aria-expanded", "false");
  document.getElementById("personPanel").hidden = true;
}

function togglePersonPanel() {
  if (document.getElementById("personPanel").hidden) openPersonPanel();
  else closePersonPanel();
}

function updatePersonSelect(journeyId) {
  const person = peopleCatalog.find((item) => item.id === journeyId);
  document.getElementById("personCurrent").textContent = person ? `${person.name} · ${person.label}` : "—";
  if (!document.getElementById("personPanel").hidden) syncPersonPanel();
}

async function setJourney(journeyId, flyHome = true) {
  if (loadingJourneyId || activeJourney?.id === journeyId) return;
  const search = document.querySelector(".search");
  loadingJourneyId = journeyId;
  search.classList.add("loading");
  try {
    const nextJourney = await loadJourney(journeyId);
    if (!nextJourney) return;
    applyJourney(nextJourney, flyHome);
  } catch (error) {
    console.error(error);
    updatePersonSelect(activeJourney?.id || "");
  } finally {
    loadingJourneyId = "";
    search.classList.remove("loading");
  }
}

function applyJourney(nextJourney, flyHome = true) {
  if (!document.getElementById("poemModal").hidden) closePoemModal();
  activeJourney = nextJourney;
  points = nextJourney.points;
  activeIndex = 0;
  document.getElementById("searchInput").value = "";
  renderSearchResults("");
  renderTitle();
  renderMarkers();
  map.getSource("journey-route").setData(makeRoute());
  renderTimeline();
  updatePersonSelect(nextJourney.id);
  selectPoint(0, false);
  if (flyHome) fitHome();
}

function wireControls() {
  document.getElementById("prevBtn").addEventListener("click", () => selectAdjacent(-1));
  document.getElementById("nextBtn").addEventListener("click", () => selectAdjacent(1));
  document.getElementById("poemOpen").addEventListener("click", openPoemModal);
  document.getElementById("poemClose").addEventListener("click", closePoemModal);
  document.getElementById("poemBackdrop").addEventListener("click", closePoemModal);
  document.getElementById("searchInput").addEventListener("input", (event) => {
    renderSearchResults(event.target.value);
  });
  document.getElementById("searchInput").addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    const first = document.querySelector("#searchResults button");
    if (first) first.click();
  });
  document.getElementById("searchClear").addEventListener("click", () => {
    document.getElementById("searchInput").value = "";
    renderSearchResults("");
    document.getElementById("searchInput").focus();
  });
  document.addEventListener("click", (event) => {
    const search = document.querySelector(".search");
    if (!search.contains(event.target)) document.getElementById("searchResults").hidden = true;
    if (!document.getElementById("personSelect").contains(event.target)) closePersonPanel();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      if (!document.getElementById("poemModal").hidden) closePoemModal();
      closePersonPanel();
      return;
    }
    // 方向键切换前后节点（输入框聚焦或弹窗打开时不拦截）
    const tag = (event.target.tagName || "").toLowerCase();
    if (tag === "input" || tag === "textarea") return;
    if (!document.getElementById("poemModal").hidden) return;
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      selectAdjacent(-1);
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      selectAdjacent(1);
    }
  });
  // 诗词弹窗内简易焦点陷阱：Tab 始终停在关闭按钮，焦点不跑出弹窗
  document.getElementById("poemModal").addEventListener("keydown", (event) => {
    if (event.key === "Tab") {
      event.preventDefault();
      document.getElementById("poemClose").focus();
    }
  });
  document.getElementById("personTrigger").addEventListener("click", togglePersonPanel);
  map.on("zoom", () => {
    const showFlags = map.getZoom() >= 4.4;
    markers.forEach(({ el, point }) => {
      const flag = el.querySelector(".flag");
      flag.style.opacity = showFlags || point.importance >= 5 ? "1" : "0";
    });
  });
}

function drawMist() {
  const canvas = document.getElementById("mist");
  const context = canvas.getContext("2d");
  const ratio = Math.min(2, window.devicePixelRatio || 1);
  const clouds = [
    { x: .18, y: .18, w: 260, h: 58, r: -.08, a: .095 },
    { x: .72, y: .25, w: 300, h: 64, r: .06, a: .075 },
    { x: .44, y: .72, w: 340, h: 70, r: -.04, a: .06 }
  ];
  const resize = () => {
    canvas.width = Math.floor(window.innerWidth * ratio);
    canvas.height = Math.floor(window.innerHeight * ratio);
    canvas.style.width = `${window.innerWidth}px`;
    canvas.style.height = `${window.innerHeight}px`;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    render();
  };
  const render = () => {
    context.clearRect(0, 0, window.innerWidth, window.innerHeight);
    clouds.forEach((cloud) => {
      const x = window.innerWidth * cloud.x;
      const y = window.innerHeight * cloud.y;
      const gradient = context.createRadialGradient(x, y, 18, x, y, cloud.w * .62);
      gradient.addColorStop(0, `rgba(255,250,235,${cloud.a})`);
      gradient.addColorStop(1, "rgba(255,250,235,0)");
      context.fillStyle = gradient;
      context.beginPath();
      context.ellipse(x, y, cloud.w, cloud.h, cloud.r, 0, Math.PI * 2);
      context.fill();
    });
  };
  resize();
  window.addEventListener("resize", resize);
}

map.on("load", async () => {
  try {
    addReliefTiles();
    // 关键资源：底图陆地 + 人物索引 + 诗词，先行加载并渲染首屏
    const [land, peopleIndex, poemData] = await Promise.all([
      getJson("geo/world-land.json"),
      getJson("data/people/index.json"),
      getJson("data/poems.json")
    ]);
    poems = poemData;
    peopleCatalog = peopleIndex.people || [];
    const initial = initialState();
    const defaultJourneyId = initial.id || peopleIndex.default || peopleCatalog[0]?.id;
    if (!defaultJourneyId) throw new Error("缺少默认人物数据");
    renderPersonSelect();
    activeJourney = await loadJourney(defaultJourneyId);
    points = activeJourney.points;
    addWorldBase(land);
    addRouteLayer();
    renderTitle();
    renderMarkers();
    renderTimeline();
    updatePersonSelect(activeJourney.id);
    wireControls();
    drawMist();
    fitHome(0);
    selectPoint(clampIndex(initial.index), false);
    map.once("render", () => window.setTimeout(setLoaderHidden, 180));

    // 次级图层：国界、省界、水系、地形阴影——延后懒加载，不阻塞首屏
    const [countries, china, rivers, lakes] = await Promise.all([
      getJson("geo/world-countries.json"),
      getJson("geo/100000_full.json"),
      getJson("geo/world-rivers.json"),
      getJson("geo/world-lakes.json")
    ]);
    addChinaProvinces(china);
    addWater(rivers, lakes);
    addTerrainSources();
    addBorders(countries);
  } catch (error) {
    console.error(error);
    const strong = document.querySelector("#loader strong");
    const span = document.querySelector("#loader span");
    if (strong) strong.textContent = "载入失败";
    if (span) span.textContent = error.message;
  }
});
