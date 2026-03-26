const numberFormat = new Intl.NumberFormat('pt-BR');
const dateTimeFormat = new Intl.DateTimeFormat('pt-BR', {
  dateStyle: 'short',
  timeStyle: 'short'
});

const stateSelect = document.querySelector('#state-select');
const citySelect = document.querySelector('#city-select');
const refreshSearchButton = document.querySelector('#refresh-search');
const refreshSourcesButton = document.querySelector('#refresh-sources');
const searchFeedback = document.querySelector('#search-feedback');
const searchMeta = document.querySelector('#search-meta');
const geocodeResults = document.querySelector('#geocode-results');
const summaryCards = document.querySelector('#summary-cards');
const coveragePanel = document.querySelector('#coverage-panel');
const coverageMapStatus = document.querySelector('#coverage-map-status');
const timTechGrid = document.querySelector('#tim-tech-grid');
const vivoTechGrid = document.querySelector('#vivo-tech-grid');
const timCoverageEnabledInput = document.querySelector('#tim-coverage-enabled');
const vivoCoverageEnabledInput = document.querySelector('#vivo-coverage-enabled');
const basemapControls = document.querySelector('#basemap-controls');
const nationalLayerEnabledInput = document.querySelector('#national-layer-enabled');
const nationalLayerStatus = document.querySelector('#national-layer-status');
const stationsTable = document.querySelector('#stations-table');
const stationsMeta = document.querySelector('#stations-meta');
const sourcesDetails = document.querySelector('#sources-details');
const sourcesMeta = document.querySelector('#sources-meta');
const sourcesGrid = document.querySelector('#sources-grid');

const SEARCH_STORAGE_KEY = 'mapa-sinal-br:last-search';
const DEFAULT_BOOTSTRAP_SEARCH = {
  kind: 'radius',
  lat: -23.5504,
  lon: -46.6339,
  radiusKm: 3,
  label: 'Centro de Sao Paulo/SP'
};
const DEFAULT_MAP_VIEW = {
  lat: DEFAULT_BOOTSTRAP_SEARCH.lat,
  lon: DEFAULT_BOOTSTRAP_SEARCH.lon,
  zoom: 12
};

function createBaseLayers() {
  return {
    streetBaseLayer: L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap contributors'
    }),
    satelliteBaseLayer: L.tileLayer(
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      {
        maxZoom: 19,
        attribution: 'Tiles &copy; Esri'
      }
    ),
    satelliteLabelsLayer: L.tileLayer(
      'https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
      {
        maxZoom: 19,
        attribution: 'Labels &copy; Esri',
        pane: 'overlayPane'
      }
    )
  };
}

function createMapView(elementId, kind) {
  const mapInstance = L.map(elementId, {
    zoomControl: true,
    preferCanvas: true
  }).setView([DEFAULT_MAP_VIEW.lat, DEFAULT_MAP_VIEW.lon], DEFAULT_MAP_VIEW.zoom);
  const baseLayers = createBaseLayers();
  baseLayers.satelliteBaseLayer.addTo(mapInstance);
  baseLayers.satelliteLabelsLayer.addTo(mapInstance);

  mapInstance.createPane('centerPane');
  mapInstance.getPane('centerPane').style.zIndex = '650';
  mapInstance.getPane('centerPane').classList.add('center-pane');

  const view = {
    key: kind,
    map: mapInstance,
    baseLayers,
    centerLayer: L.layerGroup().addTo(mapInstance),
    stationsLayer: null,
    telecoCareLayer: null,
    coverageLayer: null
  };

  if (kind === 'antennas') {
    mapInstance.createPane('stationsPane');
    mapInstance.getPane('stationsPane').style.zIndex = '640';
    mapInstance.getPane('stationsPane').classList.add('stations-pane');
    mapInstance.createPane('telecoCarePane');
    mapInstance.getPane('telecoCarePane').style.zIndex = '620';
    mapInstance.getPane('telecoCarePane').classList.add('telecocare-pane');
    view.stationsLayer = L.layerGroup().addTo(mapInstance);
    view.telecoCareLayer = L.layerGroup().addTo(mapInstance);
  }

  if (kind === 'vivo' || kind === 'tim') {
    mapInstance.createPane('coveragePane');
    mapInstance.getPane('coveragePane').style.zIndex = '260';
    mapInstance.getPane('coveragePane').classList.add(
      'coverage-pane',
      kind === 'tim' ? 'coverage-pane--tim' : 'coverage-pane--vivo'
    );
  }

  return view;
}

const antennaView = createMapView('map-antennas', 'antennas');
const vivoView = createMapView('map-vivo', 'vivo');
const timView = createMapView('map-tim', 'tim');
const mapViews = [antennaView, vivoView, timView];

const appState = {
  municipiosByUf: new Map(),
  currentRequest: null,
  sourcesLoaded: false,
  basemapMode: 'satellite',
  nationalLayerEnabled: true,
  nationalLayerViewportKey: null,
  nationalLayerRequestId: 0,
  searchMask: null
};
const coverageState = {
  config: null,
  timEnabled: true,
  timKey: '4G',
  vivoEnabled: true,
  vivoKey: '4G',
  layers: {
    tim: null,
    vivo: null
  }
};
let pendingMapRefresh = null;
let pendingNationalLayerRefresh = null;

const ufList = [
  'AC', 'AL', 'AM', 'AP', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MG', 'MS', 'MT',
  'PA', 'PB', 'PE', 'PI', 'PR', 'RJ', 'RN', 'RO', 'RR', 'RS', 'SC', 'SE', 'SP', 'TO'
];

function escapeHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function formatMaybeDate(value) {
  if (!value) {
    return 'N/D';
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : dateTimeFormat.format(date);
}

function formatMaybeNumber(value, suffix = '') {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return 'N/D';
  }

  return `${numberFormat.format(value)}${suffix}`;
}

function buildSignalBars(level = 0, total = 5) {
  return `
    <div class="signal-bars" aria-hidden="true">
      ${Array.from({ length: total }, (_, index) => `
        <span
          class="signal-bars__bar ${index < level ? 'is-on' : ''}"
          style="height:${8 + index * 5}px"
        ></span>
      `).join('')}
    </div>
  `;
}

function getCoverageSignalLevel(item) {
  if (!item?.available) {
    return item?.error ? 1 : 0;
  }

  if (item.indoor) {
    return 5;
  }

  if ((item.features?.length || 0) >= 2) {
    return 4;
  }

  return 3;
}

function buildCoverageMetric(label, value, detail, tone = 'neutral') {
  return `
    <article class="monitor-metric is-${tone}">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(String(value))}</strong>
      <small>${escapeHtml(detail)}</small>
    </article>
  `;
}

function summarizeTechnologies(technologies = []) {
  const generations = new Set();

  technologies.forEach((technology) => {
    const normalized = String(technology || '').toUpperCase();
    if (normalized.includes('GSM')) generations.add('2G');
    else if (normalized.includes('WCDMA') || normalized.includes('UMTS') || normalized.includes('HSPA')) generations.add('3G');
    else if (normalized.includes('LTE')) generations.add('4G');
    else if (normalized.includes('NR') || normalized.includes('5G')) generations.add('5G');
  });

  if (generations.size) {
    return [...generations].join(' - ');
  }

  const cleaned = technologies.filter((item) => item && item !== 'N/D');
  return cleaned.length ? cleaned.join(' - ') : 'N/D';
}

function approximateBandMHz(value) {
  if (!Number.isFinite(value)) {
    return null;
  }

  if (value < 800) return 700;
  if (value < 900) return 850;
  if (value < 1000) return 900;
  if (value < 1900) return 1800;
  if (value < 2300) return 2100;
  if (value < 2800) return 2600;
  if (value < 4000) return 3500;
  return null;
}

function summarizeBands(bands = []) {
  const frequencies = new Set();

  bands.forEach((band) => {
    const matches = String(band).match(/\d+(?:\.\d+)?/g) || [];
    matches.forEach((match) => {
      const value = Number(match);
      if (value >= 650 && value <= 4000) {
        const approx = approximateBandMHz(value);
        if (approx !== null) {
          frequencies.add(approx);
        }
      }
    });
  });

  const ordered = [...frequencies].sort((left, right) => left - right);
  return ordered.length ? ordered.join(' - ') : 'N/D';
}

function formatCoordinates(lat, lon) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return 'N/D';
  }

  return `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
}

function haversineKm(lat1, lon1, lat2, lon2) {
  const toRad = (value) => (value * Math.PI) / 180;
  const earthRadiusKm = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;

  return 2 * earthRadiusKm * Math.asin(Math.sqrt(a));
}

function getStationAsset(operator) {
  if (operator === 'TIM') {
    return '/assets/map/antenna-tim.svg';
  }

  if (operator === 'VIVO') {
    return '/assets/map/antenna-vivo.svg';
  }

  return '/assets/map/antenna-tim.svg';
}

function buildStationIcon(operator, groupedCount = 1, variant = 'search') {
  const operatorClass = operator === 'TIM' ? 'tim' : operator === 'VIVO' ? 'vivo' : 'mix';

  return L.divIcon({
    className: `station-icon-shell station-icon-shell--${variant}`,
    html: `
      <div class="station-icon station-icon--${operatorClass} station-icon--${variant}">
        <img class="station-icon__image" src="${getStationAsset(operator)}" alt="Antena ${escapeHtml(operator)}">
        ${groupedCount > 1 ? `<span class="station-icon__count">${groupedCount}</span>` : ''}
      </div>
    `,
    iconSize: [44, 72],
    iconAnchor: [22, 64],
    popupAnchor: [0, -56],
    tooltipAnchor: [0, -54]
  });
}

function buildClusterIcon(operator, count) {
  const operatorClass = operator === 'TIM' ? 'tim' : operator === 'VIVO' ? 'vivo' : 'mix';
  const compactCount = count > 999 ? `${Math.round(count / 100) / 10}k` : String(count);

  return L.divIcon({
    className: 'cluster-icon-shell',
    html: `
      <div class="cluster-icon cluster-icon--${operatorClass}">
        <span class="cluster-icon__count">${escapeHtml(compactCount)}</span>
      </div>
    `,
    iconSize: [54, 54],
    iconAnchor: [27, 27],
    popupAnchor: [0, -20]
  });
}

function buildStationPopup(station, groupedCount = 1) {
  const operatorClass = station.operator === 'TIM' ? 'tim' : station.operator === 'VIVO' ? 'vivo' : 'mix';
  const technologies = summarizeTechnologies(station.technologies);
  const bands = summarizeBands(station.bands);
  const infraType = station.infraClass || station.stationType || 'N/D';
  const city = [station.municipality, station.uf].filter(Boolean).join(' - ') || 'N/D';
  const address = station.address || 'Endereco nao informado';
  const neighborhood = station.neighborhood || 'N/D';
  const sourceLabel = station.source === 'telecocare' ? 'TelecoCare' : 'Anatel';

  return `
    <article class="tower-popup tower-popup--${operatorClass}">
      <header class="tower-popup__header">
        <div>
          <h3 class="tower-popup__title">${escapeHtml(station.operator)} - ${escapeHtml(station.stationId)}</h3>
          <p class="tower-popup__subhead">${escapeHtml(station.entityName || 'ERB monitorada')}</p>
        </div>
        ${groupedCount > 1 ? `<span class="tower-popup__count">${groupedCount} no ponto</span>` : ''}
      </header>
      <div class="tower-popup__grid">
        <p><strong>Tecnologias:</strong> ${escapeHtml(technologies)}</p>
        <p><strong>Faixas:</strong> ${escapeHtml(bands)}</p>
        <p><strong>Tipo Infraestrutura:</strong> ${escapeHtml(infraType)}</p>
        <p><strong>Logradouro:</strong> ${escapeHtml(address)}</p>
        <p><strong>Bairro:</strong> ${escapeHtml(neighborhood)}</p>
        ${station.complement ? `<p><strong>Complemento:</strong> ${escapeHtml(station.complement)}</p>` : ''}
        <p><strong>Cidade/UF:</strong> ${escapeHtml(city)}</p>
        <p><strong>Coordenadas:</strong> ${escapeHtml(formatCoordinates(station.latitude, station.longitude))}</p>
        ${station.distanceKm !== null && station.distanceKm !== undefined ? `<p><strong>Distancia:</strong> ${escapeHtml(formatMaybeNumber(station.distanceKm, ' km'))}</p>` : ''}
        ${station.maxPowerW ? `<p><strong>Potencia max:</strong> ${escapeHtml(formatMaybeNumber(station.maxPowerW, ' W'))}</p>` : ''}
        ${station.latestValidity ? `<p><strong>Validade:</strong> ${escapeHtml(formatMaybeDate(station.latestValidity))}</p>` : ''}
        <p><strong>Fonte:</strong> ${escapeHtml(sourceLabel)}</p>
      </div>
      ${station.mapUrl ? `<footer class="tower-popup__footer"><a href="${escapeHtml(station.mapUrl)}" target="_blank" rel="noreferrer">Abrir ponto no mapa</a></footer>` : ''}
    </article>
  `;
}

function buildClusterPopup(item) {
  const city = [item.municipality, item.uf].filter(Boolean).join(' - ') || 'Area agregada';
  const timCount = item.operatorSummary?.TIM || 0;
  const vivoCount = item.operatorSummary?.VIVO || 0;

  return `
    <article class="tower-popup tower-popup--${item.topOperator === 'TIM' ? 'tim' : item.topOperator === 'VIVO' ? 'vivo' : 'mix'}">
      <header class="tower-popup__header">
        <div>
          <h3 class="tower-popup__title">Agrupamento Brasil</h3>
          <p class="tower-popup__subhead">${escapeHtml(city)}</p>
        </div>
        <span class="tower-popup__count">${escapeHtml(String(item.count))} torres</span>
      </header>
      <div class="tower-popup__grid">
        <p><strong>TIM:</strong> ${escapeHtml(String(timCount))}</p>
        <p><strong>Vivo:</strong> ${escapeHtml(String(vivoCount))}</p>
        <p><strong>Tecnologias:</strong> ${escapeHtml(summarizeTechnologies(item.technologies || []))}</p>
        <p><strong>Faixas:</strong> ${escapeHtml(summarizeBands(item.bands || []))}</p>
        <p><strong>Coordenadas:</strong> ${escapeHtml(formatCoordinates(item.latitude, item.longitude))}</p>
      </div>
      <footer class="tower-popup__footer">
        Aproxime o mapa para abrir as torres individuais desse agrupamento.
      </footer>
    </article>
  `;
}

function normalizeStoredRequest(raw) {
  if (!raw || typeof raw !== 'object') {
    return null;
  }

  if (raw.kind === 'city') {
    const centerLat = Number(raw.centerLat);
    const centerLon = Number(raw.centerLon);
    if (!raw.uf || !raw.municipioCode || !Number.isFinite(centerLat) || !Number.isFinite(centerLon)) {
      return null;
    }

    return {
      kind: 'city',
      uf: String(raw.uf).toUpperCase(),
      municipioCode: String(raw.municipioCode),
      centerLat,
      centerLon,
      label: raw.label || `${raw.municipioCode}/${String(raw.uf).toUpperCase()}`
    };
  }

  const lat = Number(raw.lat);
  const lon = Number(raw.lon);
  const radiusKm = Number(raw.radiusKm);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || !Number.isFinite(radiusKm)) {
    return null;
  }

  return {
    kind: 'radius',
    lat,
    lon,
    radiusKm,
    label: raw.label || `Coordenadas ${lat}, ${lon}`
  };
}

function readStoredSearch() {
  try {
    const raw = localStorage.getItem(SEARCH_STORAGE_KEY);
    return raw ? normalizeStoredRequest(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

function persistCurrentSearch() {
  if (!appState.currentRequest) {
    return;
  }

  try {
    localStorage.setItem(SEARCH_STORAGE_KEY, JSON.stringify(appState.currentRequest));
  } catch {
    // Falha de storage local nao deve bloquear a experiencia principal.
  }
}

function syncInputsFromRequest(request) {
  if (!request) {
    return;
  }

  const lat = request.kind === 'city' ? request.centerLat : request.lat;
  const lon = request.kind === 'city' ? request.centerLon : request.lon;
  const radiusKm = request.kind === 'radius' ? request.radiusKm : Number(document.querySelector('#city-radius').value || 12);

  document.querySelector('#coords-lat').value = lat;
  document.querySelector('#coords-lon').value = lon;
  document.querySelector('#coords-radius').value = radiusKm;
}

async function getJson(url) {
  const response = await fetch(url);
  const payload = await response.json();

  if (!response.ok) {
    const detail = payload.details ? ` ${payload.details}` : '';
    throw new Error(`${payload.error || 'Falha ao consultar o backend.'}${detail}`);
  }

  return payload;
}

function setFeedback(message, type = 'info') {
  searchFeedback.textContent = message;
  searchFeedback.className = 'feedback';

  if (type === 'loading') {
    searchFeedback.classList.add('is-loading');
  } else if (type === 'error') {
    searchFeedback.classList.add('is-error');
  } else if (type === 'success') {
    searchFeedback.classList.add('is-success');
  }
}

function buildOperatorPill(operator) {
  return `<span class="operator-pill ${operator === 'TIM' ? 'tim' : 'vivo'}">${escapeHtml(operator)}</span>`;
}

function populateStates() {
  ufList.forEach((uf) => {
    const option = document.createElement('option');
    option.value = uf;
    option.textContent = uf;
    stateSelect.appendChild(option);
  });
}

async function loadMunicipios(uf) {
  if (!uf) {
    citySelect.disabled = true;
    citySelect.innerHTML = '<option value="">Selecione primeiro a UF</option>';
    return;
  }

  citySelect.disabled = true;
  citySelect.innerHTML = '<option value="">Carregando municipios...</option>';

  if (!appState.municipiosByUf.has(uf)) {
    const data = await getJson(`/api/municipios?uf=${encodeURIComponent(uf)}`);
    const municipios = data.municipios.filter((item) => item.code !== '3500000');
    appState.municipiosByUf.set(uf, municipios);
  }

  citySelect.innerHTML = '<option value="">Selecione o municipio</option>';
  appState.municipiosByUf.get(uf).forEach((municipio) => {
    const option = document.createElement('option');
    option.value = municipio.code;
    option.textContent = municipio.name;
    option.dataset.lat = municipio.lat;
    option.dataset.lon = municipio.lon;
    citySelect.appendChild(option);
  });
  citySelect.disabled = false;
}

function clearMap() {
  mapViews.forEach((view) => view.centerLayer.clearLayers());
  antennaView.stationsLayer?.clearLayers();
}

function refreshMapLayout(delay = 0) {
  if (pendingMapRefresh) {
    clearTimeout(pendingMapRefresh);
  }

  pendingMapRefresh = setTimeout(() => {
    mapViews.forEach((view) => {
      view.map.invalidateSize({ animate: false, pan: false });
    });
    pendingMapRefresh = null;
  }, delay);
}

function setNationalLayerStatus(message, tone = 'idle') {
  nationalLayerStatus.textContent = message;
  nationalLayerStatus.className = 'map-status-pill';
  nationalLayerStatus.classList.add(`is-${tone}`);
}

function setBasemap(mode) {
  appState.basemapMode = mode;

  mapViews.forEach((view) => {
    const { map, baseLayers } = view;

    if (mode === 'street') {
      if (map.hasLayer(baseLayers.satelliteBaseLayer)) map.removeLayer(baseLayers.satelliteBaseLayer);
      if (map.hasLayer(baseLayers.satelliteLabelsLayer)) map.removeLayer(baseLayers.satelliteLabelsLayer);
      if (!map.hasLayer(baseLayers.streetBaseLayer)) baseLayers.streetBaseLayer.addTo(map);
    } else {
      if (map.hasLayer(baseLayers.streetBaseLayer)) map.removeLayer(baseLayers.streetBaseLayer);
      if (!map.hasLayer(baseLayers.satelliteBaseLayer)) baseLayers.satelliteBaseLayer.addTo(map);
      if (!map.hasLayer(baseLayers.satelliteLabelsLayer)) baseLayers.satelliteLabelsLayer.addTo(map);
    }
  });

  basemapControls?.querySelectorAll('[data-basemap]').forEach((button) => {
    button.classList.toggle('is-active', button.dataset.basemap === mode);
  });
}

function buildViewportKey() {
  const bounds = antennaView.map.getBounds();
  const zoom = antennaView.map.getZoom();

  return [
    zoom,
    bounds.getWest().toFixed(3),
    bounds.getSouth().toFixed(3),
    bounds.getEast().toFixed(3),
    bounds.getNorth().toFixed(3)
  ].join('|');
}

function buildSearchMask(result) {
  if (!result?.center?.lat || !result?.center?.lon) {
    return null;
  }

  if (result.radiusKm) {
    return {
      kind: 'radius',
      lat: result.center.lat,
      lon: result.center.lon,
      radiusKm: result.radiusKm
    };
  }

  return {
    kind: 'point',
    lat: result.center.lat,
    lon: result.center.lon,
    radiusKm: 0.35
  };
}

function isInsideSearchMask(item) {
  const mask = appState.searchMask;
  if (!mask || !Number.isFinite(item.latitude) || !Number.isFinite(item.longitude)) {
    return false;
  }

  return haversineKm(mask.lat, mask.lon, item.latitude, item.longitude) <= mask.radiusKm;
}

function renderNationalLayer(payload) {
  antennaView.telecoCareLayer.clearLayers();

  payload.items
    .filter((item) => !isInsideSearchMask(item))
    .forEach((item) => {
    if (!Number.isFinite(item.latitude) || !Number.isFinite(item.longitude)) {
      return;
    }

    if (item.kind === 'cluster') {
      const marker = L.marker([item.latitude, item.longitude], {
        pane: 'telecoCarePane',
        icon: buildClusterIcon(item.topOperator, item.count),
        title: `${item.count} torres agregadas`
      });

      marker.bindPopup(buildClusterPopup(item), {
        className: 'tower-popup-shell tower-popup-shell--mix',
        maxWidth: 340,
        minWidth: 260,
        autoPanPadding: [24, 24]
      });
      marker.addTo(antennaView.telecoCareLayer);
      return;
    }

    const marker = L.marker([item.latitude, item.longitude], {
      pane: 'telecoCarePane',
      icon: buildStationIcon(item.operator, 1, 'national'),
      title: `${item.operator} ${item.stationId}`
    });

    marker.bindPopup(buildStationPopup(item), {
      className: `tower-popup-shell tower-popup-shell--${item.operator === 'TIM' ? 'tim' : 'vivo'}`,
      maxWidth: 360,
      minWidth: 260,
      autoPanPadding: [24, 24]
    });
    marker.bindTooltip(`${item.operator} ${item.stationId}`, {
      direction: 'top',
      offset: [0, -10],
      opacity: 0.94
    });
    marker.addTo(antennaView.telecoCareLayer);
    });
}

async function refreshNationalLayer(force = false) {
  if (!appState.nationalLayerEnabled) {
    antennaView.telecoCareLayer.clearLayers();
    appState.nationalLayerViewportKey = null;
    setNationalLayerStatus('Camada Brasil desativada', 'idle');
    return;
  }

  const zoom = antennaView.map.getZoom();
  if (zoom < 4) {
    antennaView.telecoCareLayer.clearLayers();
    appState.nationalLayerViewportKey = null;
    setNationalLayerStatus('Aproxime o mapa para carregar o Brasil', 'idle');
    return;
  }

  const viewportKey = buildViewportKey();
  if (!force && viewportKey === appState.nationalLayerViewportKey) {
    return;
  }

  const bounds = antennaView.map.getBounds();
  const requestId = ++appState.nationalLayerRequestId;
  setNationalLayerStatus('Carregando torres do Brasil...', 'loading');

  try {
    const payload = await getJson(
      `/api/telecocare/viewport?west=${encodeURIComponent(bounds.getWest())}&south=${encodeURIComponent(bounds.getSouth())}&east=${encodeURIComponent(bounds.getEast())}&north=${encodeURIComponent(bounds.getNorth())}&zoom=${encodeURIComponent(zoom)}&limit=2500`
    );

    if (requestId !== appState.nationalLayerRequestId) {
      return;
    }

    renderNationalLayer(payload);
    appState.nationalLayerViewportKey = viewportKey;
    const timCount = payload.operatorSummary?.TIM || 0;
    const vivoCount = payload.operatorSummary?.VIVO || 0;
    const itemsLabel = payload.mode === 'clusters' ? 'agrupamentos' : 'torres';
    setNationalLayerStatus(
      `${numberFormat.format(payload.items.length)} ${itemsLabel} | TIM ${numberFormat.format(timCount)} | Vivo ${numberFormat.format(vivoCount)}`,
      'ok'
    );
  } catch (error) {
    if (requestId !== appState.nationalLayerRequestId) {
      return;
    }

    setNationalLayerStatus(error.message, 'error');
  }
}

function scheduleNationalLayerRefresh(force = false, delay = 220) {
  if (pendingNationalLayerRefresh) {
    clearTimeout(pendingNationalLayerRefresh);
  }

  pendingNationalLayerRefresh = setTimeout(() => {
    pendingNationalLayerRefresh = null;
    void refreshNationalLayer(force);
  }, delay);
}

function renderCoverageMapStatus(message = null) {
  if (!coverageState.config) {
    coverageMapStatus.innerHTML = `
      <div class="monitor-status-head">
        <div>
          <span class="eyebrow">Monitor de rede</span>
          <h3>Inicializando camadas oficiais</h3>
        </div>
        <span class="monitor-led is-idle"></span>
      </div>
      <p class="monitor-status-copy">Os controles de cobertura oficial ainda estao sendo carregados.</p>
    `;
    return;
  }

  const activeLayers = [];
  const timOption = coverageState.config.tim.options.find((item) => item.key === coverageState.timKey);
  const vivoOption = coverageState.config.vivo.options.find((item) => item.key === coverageState.vivoKey);

  if (coverageState.timEnabled && timOption) {
    activeLayers.push(`TIM ${timOption.label}`);
  }

  if (coverageState.vivoEnabled && vivoOption) {
    activeLayers.push(`Vivo ${vivoOption.label}`);
  }

  const headline = message
    ? 'Monitor com alerta'
    : activeLayers.length
      ? 'Camadas sincronizadas'
      : 'Monitor em espera';
  const ledClass = message ? 'is-warn' : activeLayers.length ? 'is-ok' : 'is-idle';
  const statusCopy = message ||
    (activeLayers.length
      ? `Camadas oficiais ativas no mapa: ${activeLayers.join(' e ')}.`
      : 'Nenhuma camada oficial ativa no mapa no momento.');

  coverageMapStatus.innerHTML = `
    <div class="monitor-status-head">
      <div>
        <span class="eyebrow">Monitor de rede</span>
        <h3>${escapeHtml(headline)}</h3>
      </div>
      <span class="monitor-led ${ledClass}"></span>
    </div>
    <div class="monitor-status-grid">
      <article class="monitor-state ${coverageState.timEnabled ? 'is-online is-tim' : 'is-offline'}">
        <span class="monitor-state__label">TIM</span>
        <strong>${escapeHtml(coverageState.timEnabled && timOption ? timOption.label : 'Pausada')}</strong>
        <p>${escapeHtml(coverageState.timEnabled ? 'Mapa oficial pronto para renderizar.' : 'Camada desligada no monitor.')}</p>
      </article>
      <article class="monitor-state ${coverageState.vivoEnabled ? 'is-online is-vivo' : 'is-offline'}">
        <span class="monitor-state__label">Vivo</span>
        <strong>${escapeHtml(coverageState.vivoEnabled && vivoOption ? vivoOption.label : 'Pausada')}</strong>
        <p>${escapeHtml(coverageState.vivoEnabled ? 'Mapa oficial e leitura por ponto ativos.' : 'Camada desligada no monitor.')}</p>
      </article>
    </div>
    <p class="monitor-status-copy">${escapeHtml(statusCopy)}</p>
  `;
}

function buildCoverageTileLayer(operator, technologyKey) {
  const isTim = operator === 'tim';
  const opacity = isTim ? 0.88 : 0.92;
  const layer = L.tileLayer(`/api/coverage/${operator}/${technologyKey}/{z}/{x}/{y}.png`, {
    pane: 'coveragePane',
    opacity,
    className: `coverage-layer coverage-layer--${operator}`,
    maxZoom: 19,
    tileSize: 256,
    updateWhenIdle: true,
    keepBuffer: 3
  });

  let hasErrored = false;
  layer.on('tileerror', () => {
    if (!hasErrored) {
      hasErrored = true;
      renderCoverageMapStatus(`Falha ao carregar a camada oficial ${isTim ? 'TIM' : 'Vivo'} ${technologyKey}.`);
    }
  });

  layer.on('load', () => {
    if (hasErrored) {
      hasErrored = false;
      renderCoverageMapStatus();
    }
  });

  return layer;
}

function replaceCoverageLayer(operator, technologyKey, enabled) {
  const targetView = operator === 'tim' ? timView : vivoView;
  const currentLayer = coverageState.layers[operator];
  if (currentLayer) {
    targetView.map.removeLayer(currentLayer);
    coverageState.layers[operator] = null;
  }

  if (!enabled) {
    return;
  }

  const layer = buildCoverageTileLayer(operator, technologyKey);
  layer.addTo(targetView.map);
  coverageState.layers[operator] = layer;
}

function renderTechButtons(container, options, activeKey, onClick) {
  container.innerHTML = options.map((option) => `
    <button class="tech-button ${option.key === activeKey ? 'is-active' : ''}" type="button" data-key="${escapeHtml(option.key)}">
      ${escapeHtml(option.label)}
    </button>
  `).join('');

  container.querySelectorAll('.tech-button').forEach((button) => {
    button.addEventListener('click', () => onClick(button.dataset.key));
  });
}

function refreshCoverageLayers() {
  replaceCoverageLayer('tim', coverageState.timKey, coverageState.timEnabled);
  replaceCoverageLayer('vivo', coverageState.vivoKey, coverageState.vivoEnabled);
  renderCoverageMapStatus();
}

function offsetStationPosition(lat, lon, index, total) {
  if (total <= 1) {
    return [lat, lon];
  }

  const angle = (Math.PI * 2 * index) / total;
  const spreadMeters = Math.min(18 + total * 4, 42);
  const latOffset = (spreadMeters * Math.cos(angle)) / 111320;
  const lonScale = Math.max(Math.cos((lat * Math.PI) / 180), 0.2);
  const lonOffset = (spreadMeters * Math.sin(angle)) / (111320 * lonScale);

  return [lat + latOffset, lon + lonOffset];
}

function renderCoverageControls() {
  if (!coverageState.config) {
    renderCoverageMapStatus();
    return;
  }

  renderTechButtons(timTechGrid, coverageState.config.tim.options, coverageState.timKey, (key) => {
    coverageState.timKey = key;
    renderCoverageControls();
    refreshCoverageLayers();
  });

  renderTechButtons(vivoTechGrid, coverageState.config.vivo.options, coverageState.vivoKey, (key) => {
    coverageState.vivoKey = key;
    renderCoverageControls();
    refreshCoverageLayers();
  });

  timCoverageEnabledInput.checked = coverageState.timEnabled;
  vivoCoverageEnabledInput.checked = coverageState.vivoEnabled;
  renderCoverageMapStatus();
}

async function initializeCoverageControls() {
  coverageState.config = await getJson('/api/coverage-config');
  coverageState.timKey = coverageState.config.tim.defaultKey;
  coverageState.vivoKey = coverageState.config.vivo.defaultKey;
  renderCoverageControls();
  refreshCoverageLayers();
}

function drawSearchCenterOnView(view, lat, lon, radiusKm, label) {
  const centerMarker = L.circleMarker([lat, lon], {
    pane: 'centerPane',
    radius: 9,
    color: '#f8fcff',
    fillColor: '#ffb347',
    fillOpacity: 1,
    weight: 2.4,
    className: 'center-marker'
  })
    .bindPopup(`<strong>${escapeHtml(label)}</strong>`)
    .addTo(view.centerLayer);

  const searchCircle = radiusKm > 0
    ? L.circle([lat, lon], {
      pane: 'centerPane',
      radius: radiusKm * 1000,
      color: '#ffb347',
      weight: 1.6,
      fillOpacity: 0.06,
      className: 'center-radius'
    }).addTo(view.centerLayer)
    : null;

  return {
    centerMarker,
    searchCircle
  };
}

function applyMapTarget(target) {
  requestAnimationFrame(() => {
    refreshMapLayout();
    mapViews.forEach((view) => {
      if (target.bounds) {
        view.map.fitBounds(target.bounds.pad(target.padding ?? 0.12), {
          animate: false,
          padding: [24, 24]
        });
        return;
      }

      if (target.center && Number.isFinite(target.zoom)) {
        view.map.setView([target.center.lat, target.center.lon], target.zoom, {
          animate: false
        });
      }
    });
    refreshMapLayout(180);
  });
}

function renderMap(result, label = 'Centro da busca') {
  clearMap();
  const layers = [];
  const stationGroups = new Map();
  let preferredBounds = null;

  if (result.center?.lat && result.center?.lon) {
    const antennaSearch = drawSearchCenterOnView(
      antennaView,
      result.center.lat,
      result.center.lon,
      result.radiusKm,
      label
    );
    drawSearchCenterOnView(vivoView, result.center.lat, result.center.lon, result.radiusKm, label);
    drawSearchCenterOnView(timView, result.center.lat, result.center.lon, result.radiusKm, label);
    layers.push(antennaSearch.centerMarker);

    if (antennaSearch.searchCircle) {
      preferredBounds = antennaSearch.searchCircle.getBounds();
      layers.push(antennaSearch.searchCircle);
    }
  }

  result.stations.forEach((station) => {
    if (station.latitude === null || station.longitude === null) {
      return;
    }

    const key = `${station.latitude.toFixed(6)}|${station.longitude.toFixed(6)}`;
    if (!stationGroups.has(key)) {
      stationGroups.set(key, []);
    }

    stationGroups.get(key).push(station);
  });

  result.stations.forEach((station) => {
    if (station.latitude === null || station.longitude === null) {
      return;
    }

    const stationKey = `${station.latitude.toFixed(6)}|${station.longitude.toFixed(6)}`;
    const groupedStations = stationGroups.get(stationKey) || [station];
    const stationIndex = groupedStations.indexOf(station);
    const [plotLat, plotLon] = offsetStationPosition(
      station.latitude,
      station.longitude,
      stationIndex,
      groupedStations.length
    );

    const marker = L.marker([plotLat, plotLon], {
      pane: 'stationsPane',
      icon: buildStationIcon(station.operator, groupedStations.length),
      title: `${station.operator} ${station.stationId}`
    });

    marker.bindPopup(buildStationPopup(station, groupedStations.length), {
      className: `tower-popup-shell tower-popup-shell--${station.operator === 'TIM' ? 'tim' : 'vivo'}`,
      maxWidth: 340,
      minWidth: 250,
      autoPanPadding: [24, 24]
    });
    marker.bindTooltip(
      `${escapeHtml(station.operator)} ${escapeHtml(station.stationId)}${groupedStations.length > 1 ? ` (${groupedStations.length} no ponto)` : ''}`,
      {
        direction: 'top',
        offset: [0, -10],
        opacity: 0.94
      }
    );

    marker.addTo(antennaView.stationsLayer);
    layers.push(marker);
  });

  const group = new L.featureGroup(layers);
  refreshMapLayout();

  if (preferredBounds) {
    applyMapTarget({
      bounds: preferredBounds,
      padding: 0.12
    });
  } else if (group.getLayers().length) {
    applyMapTarget({
      bounds: group.getBounds(),
      padding: 0.14
    });
  } else if (result.center?.lat && result.center?.lon) {
    applyMapTarget({
      center: {
        lat: result.center.lat,
        lon: result.center.lon
      },
      zoom: 14
    });
  }
}

function previewGeocodedLocation(lat, lon, radiusKm, label) {
  clearMap();

  const antennaSearch = drawSearchCenterOnView(antennaView, lat, lon, radiusKm, label);
  drawSearchCenterOnView(vivoView, lat, lon, radiusKm, label);
  drawSearchCenterOnView(timView, lat, lon, radiusKm, label);

  if (radiusKm > 0 && antennaSearch.searchCircle) {
    applyMapTarget({
      bounds: antennaSearch.searchCircle.getBounds(),
      padding: 0.12
    });
  } else {
    applyMapTarget({
      center: { lat, lon },
      zoom: 16
    });
  }

  antennaSearch.centerMarker.openPopup();
  searchMeta.textContent = `${label} | localizando...`;
  scheduleNationalLayerRefresh(true, 180);
}

function renderSummary(result) {
  const timCount = result.operatorSummary.TIM || 0;
  const vivoCount = result.operatorSummary.VIVO || 0;

  summaryCards.innerHTML = `
    <div class="summary-box summary-box--neutral">
      <span class="eyebrow">ERBs</span>
      <strong>${formatMaybeNumber(result.stationsCount)}</strong>
      <p>Estacoes agregadas para TIM e Vivo na busca atual.</p>
    </div>
    <div class="summary-box summary-box--neutral">
      <span class="eyebrow">Registros</span>
      <strong>${formatMaybeNumber(result.recordsCount)}</strong>
      <p>Linhas detalhadas de setores, tecnologias e frequencias.</p>
    </div>
    <div class="summary-box summary-box--tim">
      <span class="eyebrow">TIM</span>
      <strong>${formatMaybeNumber(timCount)}</strong>
      <p>Estacoes TIM encontradas na area filtrada.</p>
    </div>
    <div class="summary-box summary-box--vivo">
      <span class="eyebrow">Vivo</span>
      <strong>${formatMaybeNumber(vivoCount)}</strong>
      <p>Estacoes Vivo encontradas na area filtrada.</p>
    </div>
    ${result.truncated ? `
      <div class="summary-box summary-box--warn">
        <span class="eyebrow">Atencao</span>
        <strong>Busca truncada</strong>
        <p>O backend limitou a coleta para manter a resposta rapida. Reduza a area se precisar de mais precisao.</p>
      </div>
    ` : ''}
  `;
}

function renderStations(result, label = 'Busca atual') {
  const stations = [...result.stations].sort((left, right) => {
    const leftDistance = Number.isFinite(left.distanceKm) ? left.distanceKm : Number.POSITIVE_INFINITY;
    const rightDistance = Number.isFinite(right.distanceKm) ? right.distanceKm : Number.POSITIVE_INFINITY;
    return leftDistance - rightDistance;
  });

  stationsMeta.textContent = `${label} | ${formatMaybeNumber(result.stationsCount)} estacoes`;

  if (!stations.length) {
    stationsTable.innerHTML = '<div class="placeholder-box">Nenhuma estacao TIM/Vivo encontrada para o filtro atual.</div>';
    return;
  }

  stationsTable.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>Operadora</th>
          <th>Estacao</th>
          <th>Local</th>
          <th>Tecnologias</th>
          <th>Bandas</th>
          <th>Distancia</th>
          <th>Potencia</th>
          <th>Licenciada</th>
          <th>Validade</th>
          <th>Mapa</th>
        </tr>
      </thead>
      <tbody>
        ${stations.map((station) => `
          <tr>
            <td>${buildOperatorPill(station.operator)}</td>
            <td>
              <strong>${escapeHtml(station.stationId)}</strong><br>
              <span>${escapeHtml(station.entityName)}</span>
            </td>
            <td>
              ${escapeHtml(station.municipality || 'N/D')}/${escapeHtml(station.uf || '')}<br>
              <span>${escapeHtml(station.address || 'Endereco nao informado')}</span>
            </td>
            <td>${escapeHtml(station.technologies.join(', ') || 'N/D')}</td>
            <td>${escapeHtml(station.bands.slice(0, 4).join(' | ') || 'N/D')}</td>
            <td>${formatMaybeNumber(station.distanceKm, ' km')}</td>
            <td>${formatMaybeNumber(station.maxPowerW, ' W')}</td>
            <td>${formatMaybeDate(station.latestLicensedAt)}</td>
            <td>${formatMaybeDate(station.latestValidity)}</td>
            <td>${station.mapUrl ? `<a class="chip" href="${station.mapUrl}" target="_blank" rel="noreferrer">Abrir ponto</a>` : 'N/D'}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}

function renderCoverage(payload) {
  const availableCount = payload.results.filter((item) => item.available).length;
  const indoorCount = payload.results.filter((item) => item.indoor).length;

  coveragePanel.innerHTML = `
    <div class="coverage-card coverage-card--hero">
      <div class="coverage-card__header">
        <div>
          <span class="eyebrow">Ponto central</span>
          <h3>Leitura oficial Vivo</h3>
        </div>
        <span class="coverage-state-pill ${availableCount ? 'is-online' : 'is-offline'}">
          ${availableCount ? `${availableCount}/${payload.results.length} ativas` : 'Sem leitura ativa'}
        </span>
      </div>
      <div class="coverage-telemetry-grid">
        ${buildCoverageMetric('Latitude', payload.lat.toFixed(5), 'Centro usado na busca', 'neutral')}
        ${buildCoverageMetric('Longitude', payload.lon.toFixed(5), 'Coordenada consultada', 'neutral')}
        ${buildCoverageMetric('Tecnologias', `${availableCount}/${payload.results.length}`, 'Camadas com retorno positivo', availableCount ? 'ok' : 'warn')}
        ${buildCoverageMetric('Indoor', indoorCount, 'Sinal com indicacao indoor', indoorCount ? 'ok' : 'neutral')}
      </div>
      <p>${escapeHtml(payload.note)}</p>
      <div class="chip-row">
        <span class="chip">Atualizado ${escapeHtml(formatMaybeDate(payload.checkedAt))}</span>
        <span class="chip">Bundle ${escapeHtml(payload.bundleUrl ? 'publico' : 'N/D')}</span>
      </div>
    </div>
    ${payload.results.map((item) => `
      <div class="coverage-card ${item.available ? 'available' : 'unavailable'}">
        <div class="coverage-card__header">
          <div>
            <span class="eyebrow">${escapeHtml(item.technology)}</span>
            <h3>${item.available ? 'Cobertura detectada' : 'Nao confirmada'}</h3>
          </div>
          <span class="coverage-state-pill ${item.available ? 'is-online' : 'is-offline'}">
            ${item.available ? 'Online' : 'Sem retorno'}
          </span>
        </div>
        <div class="coverage-card__telemetry">
          ${buildSignalBars(getCoverageSignalLevel(item))}
          <div class="coverage-card__meta">
            <strong>${item.available ? 'Camada respondeu para o ponto' : 'Camada nao confirmou o ponto'}</strong>
            <span>${item.indoor ? 'Perfil com indicacao indoor.' : 'Sem confirmacao de indoor.'}</span>
          </div>
        </div>
        <p>
          ${item.available
            ? `Cobertura encontrada${item.indoor ? ' com indicacao indoor' : ''}.`
            : escapeHtml(item.error || 'A camada nao retornou cobertura para esse ponto.')}
        </p>
        <div class="chip-row">
          ${item.layer ? `<span class="chip">${escapeHtml(item.layer)}</span>` : ''}
          ${item.features.length ? `<span class="chip">${escapeHtml(String(item.features.length))} feicoes</span>` : ''}
          <span class="chip">${item.indoor ? 'Indoor' : 'Outdoor/indef.'}</span>
        </div>
      </div>
    `).join('')}
  `;
}

function renderSources(payload) {
  sourcesMeta.textContent = `Checado em ${formatMaybeDate(payload.checkedAt)}`;

  sourcesGrid.innerHTML = payload.sources.map((source) => {
    const tone =
      source.status === 'Erro'
        ? 'error'
        : source.status === 'Manual'
          ? 'warn'
          : 'ok';

    const chips = [];
    if (source.counts?.tim || source.counts?.vivo) chips.push(`TIM ${source.counts.tim || 'N/D'} | Vivo ${source.counts.vivo || 'N/D'}`);
    if (source.zipLastModified) chips.push(`ZIP ${formatMaybeDate(source.zipLastModified)}`);
    if (source.stars !== undefined) chips.push(`${formatMaybeNumber(source.stars)} estrelas`);
    if (source.pushedAt) chips.push(`Push ${formatMaybeDate(source.pushedAt)}`);
    if (source.requiresCaptcha) chips.push('Exige CAPTCHA');

    return `
      <article class="source-item">
        <div class="source-top">
          <div>
            <span class="eyebrow">${escapeHtml(source.kind || 'fonte')}</span>
            <h3>${escapeHtml(source.name)}</h3>
          </div>
          <span class="status-pill ${tone}">${escapeHtml(source.status)}</span>
        </div>
        <p>${escapeHtml(source.note || source.description || 'Sem observacoes adicionais.')}</p>
        ${chips.length ? `<div class="chip-row">${chips.map((chip) => `<span class="chip">${escapeHtml(chip)}</span>`).join('')}</div>` : ''}
        ${source.links?.length ? `<div class="source-links">${source.links.map((link) => `<a href="${escapeHtml(link.url)}" target="_blank" rel="noreferrer">${escapeHtml(link.label)}</a>`).join('')}</div>` : ''}
      </article>
    `;
  }).join('');
}

async function loadSources() {
  appState.sourcesLoaded = true;
  sourcesMeta.textContent = 'Atualizando...';
  try {
    renderSources(await getJson('/api/sources'));
  } catch (error) {
    sourcesMeta.textContent = 'Erro';
    sourcesGrid.innerHTML = `<div class="placeholder-box">${escapeHtml(error.message)}</div>`;
  }
}

async function loadCoverage(lat, lon) {
  coveragePanel.innerHTML = `
    <div class="coverage-card coverage-card--loading">
      <span class="eyebrow">Monitor</span>
      <h3>Consultando cobertura oficial</h3>
      <p>Buscando leitura por ponto para o centro atual do mapa.</p>
    </div>
  `;
  try {
    renderCoverage(await getJson(`/api/vivo-coverage?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}`));
  } catch (error) {
    coveragePanel.innerHTML = `<div class="placeholder-box">${escapeHtml(error.message)}</div>`;
  }
}

function renderSearch(result, label) {
  refreshSearchButton.disabled = !appState.currentRequest;
  appState.searchMask = buildSearchMask(result);
  renderMap(result, label);
  scheduleNationalLayerRefresh(true, 260);
  renderSummary(result);
  renderStations(result, label);
  persistCurrentSearch();
  searchMeta.textContent = `${label} | ${formatMaybeDate(result.checkedAt)}`;
  const warningText = Array.isArray(result.warnings) && result.warnings.length
    ? ` ${result.warnings.join(' ')}`
    : '';
  const summaryLabel = result.truncated ? 'Busca rapida concluida' : 'Busca concluida';
  setFeedback(
    `${summaryLabel}: ${numberFormat.format(result.stationsCount)} estacoes agregadas e ${numberFormat.format(result.recordsCount)} registros detalhados.${warningText}`,
    'success'
  );

  if (result.center?.lat && result.center?.lon) {
    void loadCoverage(result.center.lat, result.center.lon);
  } else {
    coveragePanel.innerHTML = '<div class="placeholder-box">A cobertura por ponto aparece quando o centro da busca e conhecido.</div>';
  }
}

async function runInitialSearch() {
  const initialRequest = readStoredSearch() || DEFAULT_BOOTSTRAP_SEARCH;
  syncInputsFromRequest(initialRequest);

  try {
    if (initialRequest.kind === 'city') {
      setFeedback('Recuperando a ultima area consultada...', 'loading');
      await searchByCity(
        initialRequest.uf,
        initialRequest.municipioCode,
        initialRequest.centerLat,
        initialRequest.centerLon,
        initialRequest.label
      );
      return;
    }

    setFeedback('Carregando torres iniciais no mapa...', 'loading');
    await searchByRadius(
      initialRequest.lat,
      initialRequest.lon,
      initialRequest.radiusKm,
      initialRequest.label
    );
  } catch (error) {
    setFeedback(`Nao foi possivel restaurar a busca inicial. ${error.message}`, 'error');
  }
}

async function searchByRadius(lat, lon, radiusKm, label) {
  appState.currentRequest = { kind: 'radius', lat, lon, radiusKm, label };
  syncInputsFromRequest(appState.currentRequest);
  setFeedback('Buscando ERBs principais na Anatel...', 'loading');
  const payload = await getJson(
    `/api/stations?mode=radius&lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}&radiusKm=${encodeURIComponent(radiusKm)}&maxRows=300`
  );
  renderSearch(payload, label);
}

async function searchByCity(uf, municipioCode, centerLat, centerLon, label) {
  appState.currentRequest = { kind: 'city', uf, municipioCode, centerLat, centerLon, label };
  syncInputsFromRequest(appState.currentRequest);
  setFeedback('Carregando ERBs do municipio...', 'loading');
  const payload = await getJson(
    `/api/stations?mode=city&uf=${encodeURIComponent(uf)}&municipioCode=${encodeURIComponent(municipioCode)}&centerLat=${encodeURIComponent(centerLat)}&centerLon=${encodeURIComponent(centerLon)}`
  );
  renderSearch(payload, label);
}

function renderGeocodeResults(payload, radiusKm) {
  if (!payload.results?.length) {
    geocodeResults.innerHTML = '<div class="placeholder-box">Nenhum ponto encontrado para essa busca.</div>';
    return;
  }

  geocodeResults.innerHTML = payload.results.map((item, index) => `
    <div class="geocode-choice">
      <div>
        <strong>${escapeHtml(item.label || `Resultado ${index + 1}`)}</strong>
        <div>${escapeHtml(item.displayName || '')}</div>
        <div class="chip-row">
          ${item.lat !== null ? `<span class="chip">Lat ${escapeHtml(String(item.lat))}</span>` : ''}
          ${item.lon !== null ? `<span class="chip">Lon ${escapeHtml(String(item.lon))}</span>` : ''}
          ${item.isConfident === false ? '<span class="chip">Revisar local</span>' : ''}
        </div>
      </div>
      <button
        class="link-button use-geocode"
        type="button"
        data-lat="${escapeHtml(String(item.lat))}"
        data-lon="${escapeHtml(String(item.lon))}"
        data-label="${escapeHtml(item.displayName || item.label || 'Ponto geocodificado')}"
        data-radius="${escapeHtml(String(radiusKm))}"
        ${item.lat === null || item.lon === null ? 'disabled' : ''}
      >
        Usar no mapa
      </button>
    </div>
  `).join('');

  geocodeResults.querySelectorAll('.use-geocode').forEach((button) => {
    button.addEventListener('click', async () => {
      previewGeocodedLocation(
        Number(button.dataset.lat),
        Number(button.dataset.lon),
        Number(button.dataset.radius),
        button.dataset.label
      );
      await searchByRadius(
        Number(button.dataset.lat),
        Number(button.dataset.lon),
        Number(button.dataset.radius),
        button.dataset.label
      );
    });
  });
}

function classifySignal(rsrp, rsrq, sinr) {
  let score = 0;
  if (rsrp >= -90) score += 2;
  else if (rsrp >= -105) score += 1;
  if (rsrq >= -10) score += 2;
  else if (rsrq >= -15) score += 1;
  if (sinr >= 20) score += 2;
  else if (sinr >= 13) score += 1;

  if (score >= 5) {
    return {
      label: 'Sinal forte',
      variant: 'signal-ok',
      description: 'Sem indicio forte de degradacao de radio. O ponto tende a operar bem.'
    };
  }

  if (score >= 3) {
    return {
      label: 'Sinal intermediario',
      variant: 'signal-warn',
      description: 'Ha oscilacao moderada. Vale cruzar com horario, indoor, cobertura e carga da celula.'
    };
  }

  return {
    label: 'Sinal degradado',
    variant: 'signal-bad',
    description: 'Existe chance relevante de problema de radio, indoor ruim, interferencia ou sobrecarga.'
  };
}

stateSelect.addEventListener('change', async () => {
  try {
    await loadMunicipios(stateSelect.value);
  } catch (error) {
    setFeedback(error.message, 'error');
  }
});

timCoverageEnabledInput.addEventListener('change', () => {
  coverageState.timEnabled = timCoverageEnabledInput.checked;
  renderCoverageControls();
  refreshCoverageLayers();
});

vivoCoverageEnabledInput.addEventListener('change', () => {
  coverageState.vivoEnabled = vivoCoverageEnabledInput.checked;
  renderCoverageControls();
  refreshCoverageLayers();
});

basemapControls?.querySelectorAll('[data-basemap]').forEach((button) => {
  button.addEventListener('click', () => {
    setBasemap(button.dataset.basemap);
  });
});

nationalLayerEnabledInput?.addEventListener('change', () => {
  appState.nationalLayerEnabled = nationalLayerEnabledInput.checked;
  scheduleNationalLayerRefresh(true, 10);
});

refreshSourcesButton.addEventListener('click', loadSources);
sourcesDetails.addEventListener('toggle', () => {
  if (sourcesDetails.open && !appState.sourcesLoaded) {
    void loadSources();
  }
});

refreshSearchButton.addEventListener('click', async () => {
  if (!appState.currentRequest) return;

  try {
    if (appState.currentRequest.kind === 'city') {
      await searchByCity(
        appState.currentRequest.uf,
        appState.currentRequest.municipioCode,
        appState.currentRequest.centerLat,
        appState.currentRequest.centerLon,
        appState.currentRequest.label
      );
      return;
    }

    await searchByRadius(
      appState.currentRequest.lat,
      appState.currentRequest.lon,
      appState.currentRequest.radiusKm,
      appState.currentRequest.label
    );
  } catch (error) {
    setFeedback(error.message, 'error');
  }
});

document.querySelector('#city-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const uf = stateSelect.value;
  const selected = citySelect.selectedOptions[0];
  const radiusKm = Number(document.querySelector('#city-radius').value || 12);

  if (!uf || !selected?.value) {
    setFeedback('Escolha a UF e o municipio antes de buscar.', 'error');
    return;
  }

  try {
    await searchByRadius(
      Number(selected.dataset.lat || -23.5504),
      Number(selected.dataset.lon || -46.6339),
      radiusKm,
      `${selected.textContent}/${uf}`
    );
  } catch (error) {
    setFeedback(error.message, 'error');
  }
});

document.querySelector('#coords-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const lat = Number(document.querySelector('#coords-lat').value);
  const lon = Number(document.querySelector('#coords-lon').value);
  const radiusKm = Number(document.querySelector('#coords-radius').value);

  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    setFeedback('Informe latitude e longitude validas.', 'error');
    return;
  }

  try {
    await searchByRadius(lat, lon, radiusKm, `Coordenadas ${lat}, ${lon}`);
  } catch (error) {
    setFeedback(error.message, 'error');
  }
});

document.querySelector('#geocode-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const query = document.querySelector('#geocode-query').value.trim();
  const radiusKm = Number(document.querySelector('#geocode-radius').value);

  if (!query) {
    setFeedback('Digite um CEP, bairro, endereco ou localidade.', 'error');
    return;
  }

  setFeedback('Resolvendo a localizacao informada...', 'loading');
  geocodeResults.innerHTML = '';

  try {
    const payload = await getJson(`/api/geocode?q=${encodeURIComponent(query)}`);
    renderGeocodeResults(payload, radiusKm);
    const first = payload.results?.[0];

    if (first?.lat !== null && first?.lon !== null && payload.autoUse !== false) {
      previewGeocodedLocation(first.lat, first.lon, radiusKm, first.displayName || first.label || query);
      await searchByRadius(first.lat, first.lon, radiusKm, first.displayName || first.label || query);
    } else if (first?.lat !== null && first?.lon !== null) {
      setFeedback(
        payload.warning || 'A localizacao ficou ambigua. Confira o resultado e use o botao do ponto correto.',
        'info'
      );
    } else {
      setFeedback(payload.warning || 'Nao foi possivel transformar essa busca em coordenadas.', 'error');
    }
  } catch (error) {
    setFeedback(error.message, 'error');
  }
});

document.querySelector('#signal-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const rsrp = Number(document.querySelector('#metric-rsrp').value);
  const rsrq = Number(document.querySelector('#metric-rsrq').value);
  const sinr = Number(document.querySelector('#metric-sinr').value);
  const result = classifySignal(rsrp, rsrq, sinr);
  const box = document.querySelector('#signal-result');
  box.className = `signal-result ${result.variant}`;
  box.innerHTML = `
    <strong>${escapeHtml(result.label)}</strong><br>
    ${escapeHtml(result.description)}<br>
    <span>RSRP ${escapeHtml(String(rsrp))} dBm | RSRQ ${escapeHtml(String(rsrq))} dB | SINR ${escapeHtml(String(sinr))} dB</span>
  `;
});

window.addEventListener('load', () => refreshMapLayout(120));
window.addEventListener('resize', () => refreshMapLayout(120));
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) {
    refreshMapLayout(120);
    scheduleNationalLayerRefresh(true, 160);
  }
});
antennaView.map.on('moveend zoomend', () => {
  scheduleNationalLayerRefresh();
});

populateStates();
setBasemap('satellite');
setNationalLayerStatus('Preparando camada Brasil...', 'loading');
initializeCoverageControls()
  .catch((error) => {
    renderCoverageMapStatus(error.message);
  })
  .finally(() => {
    void runInitialSearch();
  });
setFeedback('App inicializando o mapa e as torres...', 'loading');
