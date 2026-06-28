const CHINA_BOUNDS = [[97, 20.5], [123, 45]];
const HOME_PADDING = { top: 96, bottom: 96, left: 42, right: 42 };
const DEM_TILES = "https://agentsfeed.org/app-demo/gaokao/tiles/terrarium/{z}/{x}/{y}.webp";
const DEM_BOUNDS = [73, 17, 135, 54];

const TYPE_LABEL = {
  origin: "故乡",
  office: "仕宦",
  exile: "贬谪",
  final: "归途"
};

const TYPE_COLOR = {
  origin: "#296c67",
  office: "#8f5d14",
  exile: "#9c2f1b",
  final: "#5f4d86"
};

let points = [];
let markers = [];
let activeIndex = 0;
let currentFilter = "all";
let globeOn = true;
let terrainOn = false;
let tourTimer = 0;

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
  map.fitBounds(CHINA_BOUNDS, {
    padding: HOME_PADDING,
    pitch: globeOn ? 0 : 36,
    bearing: 0,
    duration
  });
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

function addReliefImage() {
  map.addSource("relief-cn", {
    type: "image",
    url: "assets/relief-cn2.webp",
    coordinates: [[67.5, 55.77657], [140.625, 55.77657], [140.625, 16.63619], [67.5, 16.63619]]
  });
  map.addLayer({
    id: "relief-cn-img",
    type: "raster",
    source: "relief-cn",
    paint: { "raster-fade-duration": 0 }
  });
}

function addChinaLayers(china) {
  map.addSource("china", { type: "geojson", data: china });
  map.addLayer({
    id: "relief-base",
    type: "fill",
    source: "china",
    paint: { "fill-color": "#aebd8a", "fill-opacity": 1 }
  }, "relief-cn-img");
  map.addLayer({
    id: "prov-fill",
    type: "fill",
    source: "china",
    paint: {
      "fill-color": "#e8d2a8",
      "fill-opacity": 0.14
    }
  });
  map.addLayer({
    id: "prov-line",
    type: "line",
    source: "china",
    paint: { "line-color": "#a98e5f", "line-width": 0.75, "line-opacity": 0.72 }
  });
  map.addLayer({
    id: "country-line",
    type: "line",
    source: "china",
    paint: { "line-color": "#7c5b31", "line-width": 1.9, "line-opacity": 0.66 }
  });

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

function addMask(outline) {
  const holes = [];
  outline.features.forEach((feature) => {
    const geometry = feature.geometry;
    if (!geometry) return;
    const polygons = geometry.type === "MultiPolygon" ? geometry.coordinates : [geometry.coordinates];
    polygons.forEach((polygon) => {
      if (polygon && polygon[0]) holes.push(polygon[0]);
    });
  });
  map.addSource("mask", {
    type: "geojson",
    data: {
      type: "Feature",
      geometry: {
        type: "Polygon",
        coordinates: [[[-180, -85], [180, -85], [180, 85], [-180, 85], [-180, -85]], ...holes]
      }
    }
  });
  map.addLayer({
    id: "mask",
    type: "fill",
    source: "mask",
    paint: { "fill-color": "#ece1c6", "fill-opacity": 0.5 }
  }, "prov-line");
}

function addWater(rivers, lakes) {
  map.addSource("rivers", { type: "geojson", data: rivers });
  map.addSource("lakes", { type: "geojson", data: lakes });
  const before = map.getLayer("mask") ? "mask" : "prov-line";
  map.addLayer({
    id: "lakes",
    type: "fill",
    source: "lakes",
    paint: { "fill-color": "#8cb8bf", "fill-opacity": 0.78 }
  }, before);
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
  }, before);
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
  }, before);
}

function addTerrainSources() {
  const dem = {
    type: "raster-dem",
    encoding: "terrarium",
    tiles: [DEM_TILES],
    tileSize: 256,
    maxzoom: 8,
    bounds: DEM_BOUNDS
  };
  map.addSource("dem", dem);
  map.addSource("dem-hs", { ...dem });
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
  }, "prov-line");
}

function makeRoute() {
  return {
    type: "Feature",
    properties: {},
    geometry: {
      type: "LineString",
      coordinates: points.map((point) => point.lnglat)
    }
  };
}

function makeActiveSegment(index) {
  const start = Math.max(0, index - 1);
  return {
    type: "Feature",
    properties: {},
    geometry: {
      type: "LineString",
      coordinates: points.slice(start, index + 1).map((point) => point.lnglat)
    }
  };
}

function addJourneyLayers() {
  map.addSource("journey-route", { type: "geojson", data: makeRoute() });
  map.addSource("journey-active-segment", { type: "geojson", data: makeActiveSegment(0) });
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
  map.addLayer({
    id: "journey-active-segment",
    type: "line",
    source: "journey-active-segment",
    layout: { "line-cap": "round", "line-join": "round" },
    paint: {
      "line-color": "#6f1f12",
      "line-opacity": .72,
      "line-width": ["interpolate", ["linear"], ["zoom"], 3, 1.8, 7, 3.6],
      "line-blur": .25
    }
  });

  points.forEach((point, index) => {
    const el = document.createElement("button");
    el.className = `journey-marker type-${point.type}`;
    el.type = "button";
    el.setAttribute("aria-label", `查看${point.name}`);
    el.dataset.type = point.type;
    el.innerHTML = `<span class="flag" style="background:${TYPE_COLOR[point.type]}"><span class="seal">苏</span><span class="name">${point.short}</span></span><span class="pole" style="background:${TYPE_COLOR[point.type]}"></span><span class="dot" style="background:${TYPE_COLOR[point.type]}"></span>`;
    el.addEventListener("click", () => selectPoint(index, true));
    const marker = new maplibregl.Marker({ element: el, anchor: "bottom" }).setLngLat(point.lnglat).addTo(map);
    markers.push({ point, marker, el });
  });
}

function renderTimeline() {
  const timeline = document.getElementById("timeline");
  timeline.innerHTML = points.map((point, index) => `
    <li data-index="${index}">
      <time>${point.years.split("-")[0]}</time>
      <div>
        <b>${point.name}</b>
        <span>${TYPE_LABEL[point.type]} · ${point.works[0] || "生平节点"}</span>
      </div>
    </li>
  `).join("");
  timeline.querySelectorAll("li").forEach((item) => {
    item.addEventListener("click", () => selectPoint(Number(item.dataset.index), true));
  });
}

function updateFilter(filter) {
  currentFilter = filter;
  stopTour();
  document.querySelectorAll(".filter").forEach((button) => {
    button.classList.toggle("on", button.dataset.filter === filter);
  });
  markers.forEach(({ point, el }) => {
    const visible = filter === "all" || point.type === filter;
    el.classList.toggle("dim", !visible);
  });
  document.querySelectorAll(".timeline li").forEach((item) => {
    const point = points[Number(item.dataset.index)];
    item.hidden = !(filter === "all" || point.type === filter);
  });
  const visible = visibleIndices();
  if (!visible.includes(activeIndex) && visible.length) selectPoint(visible[0], true);
}

function selectPoint(index, fly) {
  activeIndex = (index + points.length) % points.length;
  const point = points[activeIndex];
  document.getElementById("storyYears").textContent = point.years;
  document.getElementById("storyTitle").textContent = `${point.name} · ${TYPE_LABEL[point.type]}`;
  document.getElementById("storyText").textContent = point.summary;
  document.getElementById("storyWorks").innerHTML = point.works.map((work) => `<span>${work}</span>`).join("");
  document.getElementById("storyQuote").textContent = point.quote;
  document.getElementById("progressText").textContent = `第 ${activeIndex + 1} / ${points.length} 站`;
  document.getElementById("progressBar").style.transform = `scaleX(${(activeIndex + 1) / points.length})`;
  markers.forEach((marker, i) => marker.el.classList.toggle("active", i === activeIndex));
  document.querySelectorAll(".timeline li").forEach((item) => {
    item.classList.toggle("on", Number(item.dataset.index) === activeIndex);
  });
  const activeSegmentSource = map.getSource("journey-active-segment");
  if (activeSegmentSource) activeSegmentSource.setData(makeActiveSegment(activeIndex));
  if (fly) {
    map.flyTo({
      center: point.lnglat,
      zoom: Math.max(map.getZoom(), 5.7),
      pitch: globeOn ? 0 : 46,
      bearing: 0,
      duration: 1500,
      curve: 1.42,
      essential: true
    });
  }
}

function visibleIndices() {
  return points
    .map((point, index) => ({ point, index }))
    .filter(({ point }) => currentFilter === "all" || point.type === currentFilter)
    .map(({ index }) => index);
}

function selectAdjacent(direction) {
  const list = visibleIndices();
  if (!list.length) return;
  const current = list.indexOf(activeIndex);
  const next = current < 0
    ? list[0]
    : list[(current + direction + list.length) % list.length];
  selectPoint(next, true);
}

function stopTour() {
  window.clearTimeout(tourTimer);
  tourTimer = 0;
  document.getElementById("tourBtn").classList.remove("on");
}

function startTour() {
  stopTour();
  document.getElementById("tourBtn").classList.add("on");
  const sequence = visibleIndices();
  if (!sequence.length) return;
  let cursor = Math.max(0, sequence.indexOf(activeIndex));
  const step = () => {
    selectPoint(sequence[cursor], true);
    cursor += 1;
    if (cursor >= sequence.length) {
      tourTimer = window.setTimeout(() => {
        stopTour();
        fitHome(1400);
      }, 2100);
      return;
    }
    tourTimer = window.setTimeout(step, 2600);
  };
  step();
}

function searchableText(point) {
  return [point.name, point.short, point.years, TYPE_LABEL[point.type], point.summary, point.quote, ...point.works]
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
      <span>${TYPE_LABEL[point.type]} · ${point.works.join(" / ")}</span>
    </button>
  `).join("");
  panel.querySelectorAll("button").forEach((button) => {
    button.addEventListener("click", () => {
      const index = Number(button.dataset.index);
      updateFilter("all");
      selectPoint(index, true);
      panel.hidden = true;
    });
  });
}

function wireControls() {
  document.getElementById("homeBtn").addEventListener("click", () => {
    stopTour();
    fitHome();
  });
  document.getElementById("tourBtn").addEventListener("click", () => {
    if (tourTimer) stopTour();
    else startTour();
  });
  document.getElementById("projectionBtn").addEventListener("click", () => {
    globeOn = !globeOn;
    map.setProjection({ type: globeOn ? "globe" : "mercator" });
    map.setPaintProperty("bg", "background-color", globeOn ? "#c3d3cf" : "#ece2c8");
    document.getElementById("projectionBtn").classList.toggle("on", globeOn);
    fitHome(700);
  });
  document.getElementById("terrainBtn").addEventListener("click", () => {
    terrainOn = !terrainOn;
    document.getElementById("terrainBtn").classList.toggle("on", terrainOn);
    map.setTerrain(terrainOn ? { source: "dem", exaggeration: 3.2 } : null);
  });
  document.getElementById("prevBtn").addEventListener("click", () => selectAdjacent(-1));
  document.getElementById("nextBtn").addEventListener("click", () => selectAdjacent(1));
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
  });
  document.querySelectorAll(".filter").forEach((button) => {
    button.addEventListener("click", () => updateFilter(button.dataset.filter));
  });
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
    addReliefImage();
    const [china, outline, rivers, lakes, journey] = await Promise.all([
      getJson("geo/100000_full.json"),
      getJson("geo/china-outline.json"),
      getJson("geo/ne_50m_rivers_cn.json"),
      getJson("geo/ne_50m_lakes_cn.json"),
      getJson("data/sushi-journey.json")
    ]);
    points = journey.points;
    addChinaLayers(china);
    addMask(outline);
    addWater(rivers, lakes);
    addTerrainSources();
    addJourneyLayers();
    renderTimeline();
    wireControls();
    drawMist();
    fitHome(0);
    selectPoint(0, false);
    updateFilter("all");
    map.once("render", () => window.setTimeout(setLoaderHidden, 180));
  } catch (error) {
    document.querySelector("#loader strong").textContent = "载入失败";
    document.querySelector("#loader span").textContent = error.message;
  }
});
