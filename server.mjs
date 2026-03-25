import http from 'node:http';
import path from 'node:path';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import AdmZip from 'adm-zip';
import XLSX from 'xlsx';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.join(__dirname, 'public');
const defaultPort = Number(process.env.PORT || 4042);

const USER_AGENT = 'Mapa Sinal BR/0.1';
const ANATEL_PUBLIC_URL = 'https://sistemas.anatel.gov.br/se/public/view/b/licenciamento.php';
const ANATEL_LICENSE_URL = 'https://sistemas.anatel.gov.br/se/public/view/b/lic_table.php';
const ANATEL_MUNICIPIOS_URL = 'https://sistemas.anatel.gov.br/se/eApp/forms/b/jf_getMunicipios.php';
const VIVO_MAP_URL = 'https://mapadecobertura.vivo.com.br/';
const VIVO_WMS_URL = 'https://mapadecobertura.vivo.com.br/api/wms';
const TIM_COVERAGE_URL = 'https://www.tim.com.br/para-voce/cobertura-e-roaming/mapa-de-cobertura';
const TIM_INSTABILITY_URL = 'https://www.tim.com.br/relatorio-de-instabilidade-de-sinal';
const TIM_MAP_CONFIG_URL = 'https://tim.img.com.br/mapa-cobertura/config.json';
const TELECOCARE_URL = 'https://www.telecocare.com.br/mapaerbs/';
const ABRTELECOM_URL = 'https://consultanumero.abrtelecom.com.br/consultanumero/consulta/consultaSituacaoAtualCtg';
const VIACEP_URL = 'https://viacep.com.br/ws';
const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';
const GITHUB_API_URL = 'https://api.github.com/repos';
const DEFAULT_REQUEST_TIMEOUT_MS = 15000;
const ANATEL_PAGE_TIMEOUT_MS = 9000;
const ANATEL_RADIUS_TIME_BUDGET_MS = 12000;
const ANATEL_CITY_TIME_BUDGET_MS = 20000;
const TELECOCARE_MIN_ZOOM = 4;

const MIME_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml'
};

const BR_STATES = {
  AC: '12',
  AL: '27',
  AM: '13',
  AP: '16',
  BA: '29',
  CE: '23',
  DF: '53',
  ES: '32',
  GO: '52',
  MA: '21',
  MG: '31',
  MS: '50',
  MT: '51',
  PA: '15',
  PB: '25',
  PE: '26',
  PI: '22',
  PR: '41',
  RJ: '33',
  RN: '24',
  RO: '11',
  RR: '14',
  RS: '43',
  SC: '42',
  SE: '28',
  SP: '35',
  TO: '17'
};

const VIVO_LAYER_CANDIDATES = {
  '2G': ['COBERTURA_2G'],
  '3G': ['COBERTURA_3G'],
  '4G': ['COBERTURA_4G'],
  '5G': ['COBERTURA_5G_NR', 'COBERTURA_5G', 'COBERTURA_NR']
};

const TIM_COVERAGE_LAYER_KEYS = {
  '2G': 'layer_2g',
  '3G': 'layer_3g',
  '4G': 'layer_4g',
  '45G': 'layer_45g',
  '5GDSS': 'layer_5gdss',
  '5G': 'layer_5G'
};

const cache = new Map();
let telecoCareDatasetPromise = null;

function getCache(key) {
  const entry = cache.get(key);
  if (!entry) {
    return null;
  }

  if (entry.expiresAt <= Date.now()) {
    cache.delete(key);
    return null;
  }

  return entry.value;
}

function setCache(key, value, ttlMs) {
  cache.set(key, { value, expiresAt: Date.now() + ttlMs });
  return value;
}

async function memo(key, ttlMs, factory) {
  const cached = getCache(key);
  if (cached !== null) {
    return cached;
  }

  const value = await factory();
  return setCache(key, value, ttlMs);
}

async function fileExists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  response.end(JSON.stringify(payload, null, 2));
}

function sendBinary(response, statusCode, content, contentType = 'application/octet-stream', cacheControl = 'public, max-age=300') {
  response.writeHead(statusCode, {
    'Content-Type': contentType,
    'Cache-Control': cacheControl
  });
  response.end(content);
}

function sendError(response, statusCode, message, details = null) {
  sendJson(response, statusCode, {
    error: message,
    details,
    timestamp: new Date().toISOString()
  });
}

function decodeHtml(value = '') {
  const entities = {
    '&amp;': '&',
    '&quot;': '"',
    '&lt;': '<',
    '&gt;': '>',
    '&nbsp;': ' ',
    '&#039;': "'",
    '&apos;': "'"
  };

  return String(value)
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([a-f0-9]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)))
    .replace(/&[A-Za-z#0-9]+;/g, (entity) => entities[entity] ?? entity);
}

function stripTags(value = '') {
  return decodeHtml(String(value).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim());
}

function normalizeHeaderName(value = '') {
  return String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase();
}

function getDataDir() {
  return process.env.MAPA_SINAL_DATA_DIR
    ? path.resolve(process.env.MAPA_SINAL_DATA_DIR)
    : path.join(__dirname, 'data');
}

function getTelecoCarePaths() {
  const dataDir = getDataDir();
  const cacheDir = path.join(dataDir, 'telecocare-cache');
  const workbookFile = path.join(cacheDir, 'ERBs.xlsx');
  const metadataFile = path.join(cacheDir, 'metadata.json');

  return {
    dataDir,
    cacheDir,
    workbookFile,
    metadataFile,
    fallbackFiles: [
      path.join(__dirname, 'data', 'telecocare-unpacked', 'ERBs Jan26.xlsx'),
      path.join(__dirname, 'data', 'ERBs Jan26.xlsx'),
      workbookFile
    ]
  };
}

function toNumber(value) {
  const normalized = String(value ?? '').trim().replace(',', '.');
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeOperator(entityName = '') {
  const text = String(entityName).toUpperCase();

  if (text.includes('TIM')) {
    return 'TIM';
  }

  if (text.includes('TELEFONICA') || text.includes('VIVO')) {
    return 'VIVO';
  }

  return null;
}

function splitLooseTokens(value = '') {
  return String(value)
    .trim()
    .split(/[\s,;|/]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeTechnologyToken(value = '') {
  const token = String(value).toUpperCase();

  if (token.includes('5G') || token === 'NR') return '5G';
  if (token.includes('4G') || token.includes('LTE')) return '4G';
  if (token.includes('3G') || token.includes('UMTS') || token.includes('WCDMA') || token.includes('HSPA')) return '3G';
  if (token.includes('2G') || token.includes('GSM')) return '2G';

  return token || 'N/D';
}

function normalizeTelecoCareValueList(value = '', mapper = (item) => item) {
  return [...new Set(splitLooseTokens(value).map((item) => mapper(item)).filter(Boolean))];
}

function buildMapUrl(latitude, longitude) {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return null;
  }

  return `https://www.openstreetmap.org/?mlat=${latitude}&mlon=${longitude}#map=18/${latitude}/${longitude}`;
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

async function requestText(url, options = {}) {
  const { timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS, ...fetchOptions } = options;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let response;

  try {
    response = await fetch(url, {
      ...fetchOptions,
      signal: controller.signal,
      headers: {
        'User-Agent': USER_AGENT,
        ...(fetchOptions.headers || {})
      }
    });
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error(`Tempo limite excedido ao consultar ${url}`);
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    throw new Error(`Falha ${response.status} ao consultar ${url}`);
  }

  return response.text();
}

async function requestJson(url, options = {}) {
  const { timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS, ...fetchOptions } = options;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let response;

  try {
    response = await fetch(url, {
      ...fetchOptions,
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        'User-Agent': USER_AGENT,
        ...(fetchOptions.headers || {})
      }
    });
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error(`Tempo limite excedido ao consultar ${url}`);
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    throw new Error(`Falha ${response.status} ao consultar ${url}`);
  }

  return response.json();
}

async function requestHead(url, options = {}) {
  const { timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS, ...fetchOptions } = options;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let response;

  try {
    response = await fetch(url, {
      method: 'HEAD',
      ...fetchOptions,
      signal: controller.signal,
      headers: {
        'User-Agent': USER_AGENT,
        ...(fetchOptions.headers || {})
      }
    });
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error(`Tempo limite excedido ao consultar cabecalho de ${url}`);
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    throw new Error(`Falha ${response.status} ao consultar cabecalho de ${url}`);
  }

  return response;
}

async function requestBuffer(url, options = {}) {
  const { timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS, ...fetchOptions } = options;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let response;

  try {
    response = await fetch(url, {
      ...fetchOptions,
      signal: controller.signal,
      headers: {
        'User-Agent': USER_AGENT,
        ...(fetchOptions.headers || {})
      }
    });
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error(`Tempo limite excedido ao consultar ${url}`);
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    throw new Error(`Falha ${response.status} ao consultar ${url}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  let content = Buffer.from(arrayBuffer);
  let contentType = response.headers.get('content-type') || 'application/octet-stream';

  const repairedPngPrefix = Buffer.from([239, 191, 189, 80, 78, 71, 13, 10, 26, 10]);
  if (content.length >= repairedPngPrefix.length && content.subarray(0, repairedPngPrefix.length).equals(repairedPngPrefix)) {
    content = Buffer.concat([Buffer.from([137]), content.subarray(3)]);
  }

  if (content.length >= 8 && content.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    contentType = 'image/png';
  }

  return {
    content,
    contentType
  };
}

function isAnatelTemporaryError(html = '') {
  return /erro de banco de dados/i.test(html);
}

function buildAnatelPartialWarning(mode, reason) {
  const scope = mode === 'city' ? 'municipio' : 'raio pesquisado';
  return `Consulta parcial no ${scope}: ${reason}`;
}

async function requestAnatelPage(body) {
  let lastError = null;

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const html = await requestText(ANATEL_LICENSE_URL, {
        method: 'POST',
        timeoutMs: ANATEL_PAGE_TIMEOUT_MS,
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8'
        },
        body
      });

      if (isAnatelTemporaryError(html)) {
        throw new Error('A Anatel retornou um erro temporario de banco de dados.');
      }

      return html;
    } catch (error) {
      lastError = error;
      if (attempt < 2) {
        await sleep(350 * attempt);
      }
    }
  }

  throw lastError;
}

function tileXToLon(x, z) {
  return (x / 2 ** z) * 360 - 180;
}

function tileYToLat(y, z) {
  const n = Math.PI - (2 * Math.PI * y) / 2 ** z;
  return (180 / Math.PI) * Math.atan(Math.sinh(n));
}

function getTileBbox4326(x, y, z) {
  const west = tileXToLon(x, z);
  const east = tileXToLon(x + 1, z);
  const north = tileYToLat(y, z);
  const south = tileYToLat(y + 1, z);
  return { west, south, east, north };
}

function extractAnatelHeaders(html) {
  return [...html.matchAll(/<th[^>]*>([\s\S]*?)<input/gi)].map((match) => normalizeHeaderName(stripTags(match[1])));
}

function extractAnatelRows(html) {
  const bodyMatch = html.match(/<tbody>([\s\S]*?)<\/tbody>/i);
  if (!bodyMatch) {
    return [];
  }

  return [...bodyMatch[1].matchAll(/<tr>([\s\S]*?)<\/tr>/gi)].map((rowMatch) =>
    [...rowMatch[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((cellMatch) => stripTags(cellMatch[1]))
  );
}

function mapAnatelRecord(headers, cells, center) {
  const raw = Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? '']));
  const operator = normalizeOperator(raw.entidade);

  if (!operator) {
    return null;
  }

  const latitude = toNumber(raw.latitude);
  const longitude = toNumber(raw.longitude);
  const distanceKm =
    center && latitude !== null && longitude !== null
      ? haversineKm(center.lat, center.lon, latitude, longitude)
      : null;

  return {
    operator,
    entityName: raw.entidade,
    status: raw.status,
    stationNumber: raw.num_estacao,
    address: raw.endereco,
    complement: raw.complemento,
    uf: raw.uf,
    municipality: raw.municipio,
    emission: raw.emissao,
    technology: raw.tecnologia,
    technologyType: raw.tipotecnologia,
    freqTxMHz: toNumber(raw.freq_tx_mhz),
    freqRxMHz: toNumber(raw.freq_rx_mhz),
    azimuth: toNumber(raw.azimute),
    stationType: raw.tipo_estacao,
    infraClass: raw.classinfrafisica,
    antennaHeightM: toNumber(raw.altura_antena_m),
    transmitterPowerW: toNumber(raw.potencia_transm_w),
    latitude,
    longitude,
    licensedAt: raw.datalicenciamento,
    firstLicensedAt: raw.dataprimeirolicenciamento,
    validUntil: raw.datavalidade,
    uid: raw.uid,
    distanceKm: distanceKm !== null ? Number(distanceKm.toFixed(2)) : null
  };
}

function aggregateStations(records) {
  const grouped = new Map();

  for (const record of records) {
    const key = [
      record.operator,
      record.stationNumber,
      record.latitude,
      record.longitude,
      record.address,
      record.municipality
    ].join('|');

    if (!grouped.has(key)) {
      grouped.set(key, {
        operator: record.operator,
        entityName: record.entityName,
        stationId: record.stationNumber || record.uid,
        address: record.address,
        complement: record.complement,
        municipality: record.municipality,
        uf: record.uf,
        latitude: record.latitude,
        longitude: record.longitude,
        distanceKm: record.distanceKm,
        stationType: record.stationType,
        infraClass: record.infraClass,
        technologies: new Set(),
        bands: new Set(),
        statuses: new Set(),
        sectors: 0,
        maxPowerW: record.transmitterPowerW ?? null,
        latestLicensedAt: record.licensedAt || null,
        latestValidity: record.validUntil || null
      });
    }

    const station = grouped.get(key);
    station.technologies.add(record.technology || 'N/D');
    station.statuses.add(record.status || 'N/D');
    station.sectors += 1;

    if (record.freqTxMHz || record.freqRxMHz) {
      station.bands.add(`${record.technology || 'N/D'} ${record.freqTxMHz ?? '?'} / ${record.freqRxMHz ?? '?'} MHz`);
    }

    if (record.transmitterPowerW !== null) {
      station.maxPowerW = Math.max(station.maxPowerW ?? 0, record.transmitterPowerW);
    }

    if (record.licensedAt && (!station.latestLicensedAt || record.licensedAt > station.latestLicensedAt)) {
      station.latestLicensedAt = record.licensedAt;
    }

    if (record.validUntil && (!station.latestValidity || record.validUntil > station.latestValidity)) {
      station.latestValidity = record.validUntil;
    }
  }

  return [...grouped.values()]
    .map((station) => ({
      operator: station.operator,
      entityName: station.entityName,
      stationId: station.stationId,
      address: station.address,
      complement: station.complement,
      municipality: station.municipality,
      uf: station.uf,
      latitude: station.latitude,
      longitude: station.longitude,
      distanceKm: station.distanceKm,
      stationType: station.stationType,
      infraClass: station.infraClass,
      technologies: [...station.technologies].sort(),
      bands: [...station.bands].sort(),
      statuses: [...station.statuses].sort(),
      sectors: station.sectors,
      maxPowerW: station.maxPowerW,
      latestLicensedAt: station.latestLicensedAt,
      latestValidity: station.latestValidity,
      mapUrl: buildMapUrl(station.latitude, station.longitude)
    }))
    .sort((left, right) => {
      if (left.operator !== right.operator) {
        return left.operator.localeCompare(right.operator);
      }

      return (left.distanceKm ?? Number.POSITIVE_INFINITY) - (right.distanceKm ?? Number.POSITIVE_INFINITY);
    });
}

function parseTelecoCareZipUrl(html = '') {
  const zipMatch = html.match(/href="([^"]*ERBs_[^"]+\.zip)"/i);
  return zipMatch ? new URL(zipMatch[1], TELECOCARE_URL).toString() : null;
}

async function ensureTelecoCareWorkbook() {
  const telecoCarePaths = getTelecoCarePaths();

  for (const candidate of telecoCarePaths.fallbackFiles) {
    if (await fileExists(candidate)) {
      const fileStats = await stat(candidate);
      return {
        workbookPath: candidate,
        zipUrl: null,
        fileUpdatedAt: fileStats.mtime.toISOString(),
        downloadedAt: null
      };
    }
  }

  await mkdir(telecoCarePaths.cacheDir, { recursive: true });
  const html = await requestText(TELECOCARE_URL);
  const zipUrl = parseTelecoCareZipUrl(html);

  if (!zipUrl) {
    throw new Error('Nao foi possivel localizar o ZIP publico do TelecoCare.');
  }

  const zipResponse = await requestBuffer(zipUrl, { timeoutMs: 25000 });
  const zip = new AdmZip(zipResponse.content);
  const workbookEntry = zip
    .getEntries()
    .find((entry) => !entry.isDirectory && /ERBs.*\.xlsx$/i.test(path.basename(entry.entryName)));

  if (!workbookEntry) {
    throw new Error('O ZIP do TelecoCare nao trouxe a planilha esperada.');
  }

  const workbookBuffer = workbookEntry.getData();
  await writeFile(telecoCarePaths.workbookFile, workbookBuffer);

  const metadata = {
    source: TELECOCARE_URL,
    zipUrl,
    downloadedAt: new Date().toISOString(),
    zipBytes: zipResponse.content.length,
    workbookFile: path.basename(workbookEntry.entryName)
  };
  await writeFile(telecoCarePaths.metadataFile, JSON.stringify(metadata, null, 2));

  return {
    workbookPath: telecoCarePaths.workbookFile,
    zipUrl,
    fileUpdatedAt: metadata.downloadedAt,
    downloadedAt: metadata.downloadedAt
  };
}

function normalizeTelecoCareRecord(rawRow = {}) {
  const row = Object.fromEntries(
    Object.entries(rawRow).map(([key, value]) => [normalizeHeaderName(key), value])
  );
  const latitude = toNumber(row.latitude);
  const longitude = toNumber(row.longitude);
  const operator = normalizeOperator(row.operadora || row.prestadora || '');

  if (!operator || latitude === null || longitude === null) {
    return null;
  }

  return {
    source: 'telecocare',
    operator,
    entityName: operator === 'VIVO' ? 'TELEFONICA BRASIL S.A.' : operator,
    stationId: String(row.numero_estacao || row.num_estacao || row.uid || '').trim(),
    uf: String(row.siglauf || row.uf || '').trim().toUpperCase(),
    municipality: String(row.mun || row.municipio || '').trim(),
    neighborhood: String(row.bairro || '').trim(),
    address: String(row.logradouro || row.endereco || '').trim(),
    latitude,
    longitude,
    ibge: String(row.ibge || '').trim(),
    infraClass: String(row.classinfrafisica || row.tipoinfraestrutura || '').trim(),
    technologies: normalizeTelecoCareValueList(row.tecs || row.tecnologias, normalizeTechnologyToken),
    bands: normalizeTelecoCareValueList(row.faixa || row.faixas, (item) => item.replace(/[^\d.]/g, '')),
    sectors: null,
    maxPowerW: null,
    latestLicensedAt: null,
    latestValidity: null,
    distanceKm: null,
    mapUrl: buildMapUrl(latitude, longitude)
  };
}

function aggregateTelecoCareStations(records) {
  const grouped = new Map();

  for (const record of records) {
    const key = [
      record.operator,
      record.stationId,
      record.latitude.toFixed(6),
      record.longitude.toFixed(6)
    ].join('|');

    if (!grouped.has(key)) {
      grouped.set(key, {
        ...record,
        technologies: new Set(record.technologies),
        bands: new Set(record.bands)
      });
      continue;
    }

    const entry = grouped.get(key);
    record.technologies.forEach((item) => entry.technologies.add(item));
    record.bands.forEach((item) => entry.bands.add(item));

    if (!entry.address && record.address) {
      entry.address = record.address;
    }

    if (!entry.neighborhood && record.neighborhood) {
      entry.neighborhood = record.neighborhood;
    }
  }

  return [...grouped.values()].map((station) => ({
    ...station,
    technologies: [...station.technologies].sort(),
    bands: [...station.bands].sort((left, right) => Number(left) - Number(right))
  }));
}

async function loadTelecoCareDataset() {
  const sourceFile = await ensureTelecoCareWorkbook();
  const workbook = XLSX.readFile(sourceFile.workbookPath, { cellDates: false });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
  const records = rows.map(normalizeTelecoCareRecord).filter(Boolean);
  const stations = aggregateTelecoCareStations(records);
  const operatorSummary = stations.reduce(
    (summary, station) => {
      summary[station.operator] = (summary[station.operator] || 0) + 1;
      return summary;
    },
    { TIM: 0, VIVO: 0 }
  );

  return {
    source: 'telecocare',
    checkedAt: new Date().toISOString(),
    sourceFile,
    stationCount: stations.length,
    operatorSummary,
    stations
  };
}

async function getTelecoCareDataset() {
  if (!telecoCareDatasetPromise) {
    telecoCareDatasetPromise = loadTelecoCareDataset().catch((error) => {
      telecoCareDatasetPromise = null;
      throw error;
    });
  }

  return telecoCareDatasetPromise;
}

function normalizeBounds(params) {
  const west = Number(params.get('west'));
  const south = Number(params.get('south'));
  const east = Number(params.get('east'));
  const north = Number(params.get('north'));

  if (![west, south, east, north].every(Number.isFinite)) {
    throw new Error('Informe os limites west, south, east e north do mapa.');
  }

  return { west, south, east, north };
}

function isInsideBounds(station, bounds) {
  if (station.latitude < bounds.south || station.latitude > bounds.north) {
    return false;
  }

  if (bounds.west <= bounds.east) {
    return station.longitude >= bounds.west && station.longitude <= bounds.east;
  }

  return station.longitude >= bounds.west || station.longitude <= bounds.east;
}

function summarizeStationsByOperator(stations) {
  return stations.reduce(
    (summary, station) => {
      summary[station.operator] = (summary[station.operator] || 0) + 1;
      return summary;
    },
    { TIM: 0, VIVO: 0 }
  );
}

function getTelecoCareClusterStep(zoom) {
  if (zoom <= 4) return 2.4;
  if (zoom <= 5) return 1.2;
  if (zoom <= 6) return 0.65;
  if (zoom <= 7) return 0.36;
  if (zoom <= 8) return 0.18;
  if (zoom <= 9) return 0.12;
  if (zoom <= 10) return 0.08;
  if (zoom <= 11) return 0.05;
  if (zoom <= 12) return 0.03;
  return 0.018;
}

function clusterTelecoCareStations(stations, zoom) {
  const step = getTelecoCareClusterStep(zoom);
  const grouped = new Map();

  for (const station of stations) {
    const latBucket = Math.floor(station.latitude / step);
    const lonBucket = Math.floor(station.longitude / step);
    const key = `${latBucket}|${lonBucket}`;

    if (!grouped.has(key)) {
      grouped.set(key, {
        kind: 'cluster',
        latitudeSum: 0,
        longitudeSum: 0,
        count: 0,
        operatorSummary: { TIM: 0, VIVO: 0 },
        topOperator: station.operator,
        technologies: new Set(),
        bands: new Set(),
        sampleStation: station
      });
    }

    const cluster = grouped.get(key);
    cluster.latitudeSum += station.latitude;
    cluster.longitudeSum += station.longitude;
    cluster.count += 1;
    cluster.operatorSummary[station.operator] = (cluster.operatorSummary[station.operator] || 0) + 1;
    station.technologies.forEach((item) => cluster.technologies.add(item));
    station.bands.forEach((item) => cluster.bands.add(item));
    if (cluster.operatorSummary.TIM > cluster.operatorSummary.VIVO) {
      cluster.topOperator = 'TIM';
    } else if (cluster.operatorSummary.VIVO > cluster.operatorSummary.TIM) {
      cluster.topOperator = 'VIVO';
    } else {
      cluster.topOperator = 'MIX';
    }
  }

  return [...grouped.values()]
    .map((cluster) => ({
      kind: 'cluster',
      latitude: Number((cluster.latitudeSum / cluster.count).toFixed(6)),
      longitude: Number((cluster.longitudeSum / cluster.count).toFixed(6)),
      count: cluster.count,
      operatorSummary: cluster.operatorSummary,
      topOperator: cluster.topOperator,
      technologies: [...cluster.technologies].sort(),
      bands: [...cluster.bands].sort((left, right) => Number(left) - Number(right)),
      municipality: cluster.sampleStation.municipality,
      uf: cluster.sampleStation.uf
    }))
    .sort((left, right) => right.count - left.count);
}

async function fetchTelecoCareViewport(bounds, zoom, limit = 2500) {
  const dataset = await getTelecoCareDataset();
  const stations = dataset.stations.filter((station) => isInsideBounds(station, bounds));
  const operatorSummary = summarizeStationsByOperator(stations);
  const stationCap = zoom >= 15 ? 1800 : zoom >= 14 ? 1200 : 700;
  const useClusters = zoom < 13 || stations.length > stationCap;
  const items = useClusters ? clusterTelecoCareStations(stations, zoom) : stations.map((station) => ({
    kind: 'station',
    ...station
  }));

  return {
    source: 'telecocare',
    checkedAt: new Date().toISOString(),
    datasetCheckedAt: dataset.checkedAt,
    datasetFileUpdatedAt: dataset.sourceFile.fileUpdatedAt,
    datasetDownloadedAt: dataset.sourceFile.downloadedAt,
    zipUrl: dataset.sourceFile.zipUrl,
    stationCount: dataset.stationCount,
    operatorSummary,
    zoom,
    mode: useClusters ? 'clusters' : 'stations',
    items: items.slice(0, limit)
  };
}

async function fetchMunicipios(uf) {
  const upperUf = String(uf || '').toUpperCase();
  const ibgeUfCode = BR_STATES[upperUf];

  if (!ibgeUfCode) {
    throw new Error('UF invalida para consulta de municipios.');
  }

  return memo(`municipios:${upperUf}`, 1000 * 60 * 60 * 12, async () => {
    const url = new URL(ANATEL_MUNICIPIOS_URL);
    url.searchParams.set('CodUF', ibgeUfCode);
    const text = await requestText(url);
    const rows = JSON.parse(text);

    return rows
      .filter((entry) => String(entry[1]) !== '0000000')
      .map((entry) => ({
        name: entry[0],
        code: String(entry[1]),
        lat: entry[2] !== undefined ? Number(entry[2]) : null,
        lon: entry[3] !== undefined ? Number(entry[3]) : null
      }));
  });
}

async function fetchStations(params) {
  return memo(`stations:${JSON.stringify(params)}`, 1000 * 60 * 5, async () => {
    const mode = params.mode === 'city' ? 'city' : 'radius';
    const center =
      params.centerLat !== undefined && params.centerLon !== undefined
        ? { lat: Number(params.centerLat), lon: Number(params.centerLon) }
        : params.lat !== undefined && params.lon !== undefined
          ? { lat: Number(params.lat), lon: Number(params.lon) }
          : null;

    const defaultMaxRows = mode === 'city' ? 1200 : 300;
    const maxRows = Math.min(Math.max(Number(params.maxRows || defaultMaxRows), 100), 4000);
    const pageSize = 200;
    const startedAt = Date.now();
    const timeBudgetMs = Math.min(
      Math.max(
        Number(
          params.timeBudgetMs ||
            (mode === 'city' ? ANATEL_CITY_TIME_BUDGET_MS : ANATEL_RADIUS_TIME_BUDGET_MS)
        ),
        3000
      ),
      60000
    );
    let skip = 0;
    let headers = [];
    let truncated = false;
    const records = [];
    const warnings = [];

    while (skip < maxRows) {
      if (Date.now() - startedAt >= timeBudgetMs) {
        truncated = true;
        warnings.push(
          buildAnatelPartialWarning(mode, 'o tempo limite da busca rapida foi atingido antes de carregar toda a area.')
        );
        break;
      }

      const body = new URLSearchParams({
        wfid: 'licencas',
        view: '0',
        skip: String(skip),
        filter: '-1',
        rpp: String(pageSize)
      });

      if (mode === 'city') {
        body.set('fa_gsearch', '3');
        body.set('fa_uf', String(params.uf || '').toUpperCase());
        body.set('fa_municipio', String(params.municipioCode || ''));
      } else {
        body.set('fa_gsearch', '1');
        body.set('fa_lat', String(params.lat));
        body.set('fa_lon', String(params.lon));
        body.set('fa_dist', String(params.radiusKm || 3));
      }

      let html;
      try {
        html = await requestAnatelPage(body);
      } catch (error) {
        if (!records.length) {
          throw error;
        }

        truncated = true;
        warnings.push(buildAnatelPartialWarning(mode, error.message));
        break;
      }

      if (!headers.length) {
        headers = extractAnatelHeaders(html);
      }

      const rows = extractAnatelRows(html);
      if (!rows.length) {
        break;
      }

      for (const row of rows) {
        const record = mapAnatelRecord(headers, row, center);
        if (record) {
          records.push(record);
        }
      }

      if (rows.length < pageSize) {
        break;
      }

      skip += rows.length;
      if (skip >= maxRows) {
        truncated = true;
      }
    }

    const stations = aggregateStations(records);
    const operatorSummary = stations.reduce(
      (summary, station) => {
        summary[station.operator] = (summary[station.operator] || 0) + 1;
        return summary;
      },
      { TIM: 0, VIVO: 0 }
    );

    return {
      source: 'anatel',
      checkedAt: new Date().toISOString(),
      mode,
      center,
      radiusKm: mode === 'radius' ? Number(params.radiusKm || 3) : null,
      truncated,
      warnings,
      recordsCount: records.length,
      stationsCount: stations.length,
      operatorSummary,
      stations
    };
  });
}

async function fetchTimCoverageConfig() {
  return memo('tim:coverage:config', 1000 * 60 * 30, async () => requestJson(TIM_MAP_CONFIG_URL));
}

async function fetchTimCoverageTile(technologyKey, x, y, z) {
  const config = await fetchTimCoverageConfig();
  const layerConfigKey = TIM_COVERAGE_LAYER_KEYS[technologyKey];
  const serviceUrl = layerConfigKey ? config[layerConfigKey] : null;

  if (!serviceUrl) {
    throw new Error('Tecnologia TIM invalida para mapa de cobertura.');
  }

  const { west, south, east, north } = getTileBbox4326(x, y, z);
  const url = new URL(`${serviceUrl}/export`);
  url.search = new URLSearchParams({
    bbox: `${west},${south},${east},${north}`,
    bboxSR: '4326',
    imageSR: '4326',
    size: '256,256',
    format: 'png32',
    transparent: 'true',
    f: 'image'
  }).toString();

  return requestBuffer(url, { timeoutMs: 12000 });
}

async function fetchVivoBundleContext() {
  return memo('vivo:bundle', 1000 * 60 * 30, async () => {
    const homePage = await requestText(VIVO_MAP_URL);
    const bundleMatch = homePage.match(/(?:\.?\/)?assets\/js\/main-[^"' ]+\.js|assets\/js\/main-2\.js/);

    if (!bundleMatch) {
      throw new Error('Nao foi possivel localizar o bundle publico da Vivo.');
    }

    const bundleUrl = new URL(bundleMatch[0], VIVO_MAP_URL).toString();
    const bundleText = await requestText(bundleUrl);
    const tokenMatch = bundleText.match(/Bearer\s+([A-Za-z0-9@#/+._-]+)/);

    if (!tokenMatch) {
      throw new Error('Nao foi possivel localizar o token publico da Vivo.');
    }

    return {
      bundleUrl,
      token: tokenMatch[1]
    };
  });
}

async function fetchVivoLayer(lat, lon, layer, token) {
  const delta = 0.0001;
  const url = new URL(VIVO_WMS_URL);
  url.search = new URLSearchParams({
    version: '1.1.1',
    service: 'WMS',
    request: 'GetFeatureInfo',
    query_layers: layer,
    layers: layer,
    feature_count: '14',
    format: 'image/png',
    TRANSPARENT: 'TRUE',
    srs: 'EPSG:4326',
    bbox: `${lon - delta},${lat - delta},${lon + delta},${lat + delta}`,
    width: '256',
    height: '256',
    x: '128',
    y: '128',
    info_format: 'application/json'
  }).toString();

  return requestJson(url, {
    timeoutMs: 8000,
    headers: {
      Authorization: `Bearer ${token}`
    }
  });
}

async function fetchVivoCoverage(lat, lon) {
  return memo(`vivo:${lat}:${lon}`, 1000 * 60 * 10, async () => {
    const { bundleUrl, token } = await fetchVivoBundleContext();
    const results = [];

    for (const [technology, layers] of Object.entries(VIVO_LAYER_CANDIDATES)) {
      let selectedLayer = null;
      let features = [];
      let errorMessage = null;

      for (const layer of layers) {
        try {
          const payload = await fetchVivoLayer(Number(lat), Number(lon), layer, token);
          selectedLayer = layer;
          features = Array.isArray(payload.features) ? payload.features : [];
          errorMessage = null;
          break;
        } catch (error) {
          errorMessage = error.message;
        }
      }

      results.push({
        technology,
        layer: selectedLayer,
        available: features.length > 0,
        indoor: features.some((feature) => String(feature.id || '').toLowerCase().includes('indoor')),
        features: features.map((feature) => ({
          id: feature.id,
          properties: feature.properties || {}
        })),
        error: selectedLayer ? null : errorMessage
      });
    }

    return {
      source: 'vivo',
      checkedAt: new Date().toISOString(),
      lat: Number(lat),
      lon: Number(lon),
      bundleUrl,
      note: 'Cobertura oficial estimada por ponto. Nao substitui medicao de campo.',
      results
    };
  });
}

async function resolveVivoRasterLayer(technologyKey) {
  return memo(`vivo:raster-layer:${technologyKey}`, 1000 * 60 * 30, async () => {
    const layers = VIVO_LAYER_CANDIDATES[technologyKey];
    if (!layers?.length) {
      throw new Error('Tecnologia Vivo invalida para mapa de cobertura.');
    }

    const { token } = await fetchVivoBundleContext();
    const probeBbox = '-46.634,-23.551,-46.632,-23.549';

    for (const layer of layers) {
      try {
        const url = new URL(VIVO_WMS_URL);
        url.search = new URLSearchParams({
          service: 'WMS',
          request: 'GetMap',
          version: '1.1.1',
          layers: layer,
          styles: '',
          format: 'image/png',
          transparent: 'TRUE',
          srs: 'EPSG:4326',
          bbox: probeBbox,
          width: '32',
          height: '32'
        }).toString();

        const response = await requestBuffer(url, {
          timeoutMs: 8000,
          headers: {
            Authorization: `Bearer ${token}`
          }
        });

        if (response.contentType.startsWith('image/')) {
          return layer;
        }
      } catch (error) {
        continue;
      }
    }

    throw new Error('Nao foi possivel localizar a camada oficial da Vivo para essa tecnologia.');
  });
}

async function fetchVivoCoverageTile(technologyKey, x, y, z) {
  const layer = await resolveVivoRasterLayer(technologyKey);
  const { token } = await fetchVivoBundleContext();
  const { west, south, east, north } = getTileBbox4326(x, y, z);
  const url = new URL(VIVO_WMS_URL);
  url.search = new URLSearchParams({
    service: 'WMS',
    request: 'GetMap',
    version: '1.1.1',
    layers: layer,
    styles: '',
    format: 'image/png',
    transparent: 'TRUE',
    srs: 'EPSG:4326',
    bbox: `${west},${south},${east},${north}`,
    width: '256',
    height: '256'
  }).toString();

  return requestBuffer(url, {
    timeoutMs: 12000,
    headers: {
      Authorization: `Bearer ${token}`
    }
  });
}

async function fetchTelecoCareStatus() {
  const html = await requestText(TELECOCARE_URL);
  const zipUrl = parseTelecoCareZipUrl(html);
  const head = zipUrl ? await requestHead(zipUrl) : null;

  const pickCount = (id) => {
    const match = html.match(new RegExp(`id="${id}">([^<]+)<`, 'i'));
    return match ? stripTags(match[1]) : null;
  };

  return {
    id: 'telecocare',
    kind: 'auxiliary',
    name: 'TelecoCare Mapa de ERBs',
    status: 'Disponivel',
    counts: {
      tim: pickCount('TTIM'),
      vivo: pickCount('TVIVO'),
      total: pickCount('TTotal')
    },
    zipUrl,
    zipLastModified: head?.headers.get('last-modified') || null,
    zipBytes: Number(head?.headers.get('content-length') || 0),
    note: 'Base auxiliar util para comparacao e download rapido, mas nao oficial.',
    links: [
      { label: 'Mapa TelecoCare', url: TELECOCARE_URL },
      ...(zipUrl ? [{ label: 'ZIP atual', url: zipUrl }] : [])
    ]
  };
}

async function fetchTimStatus() {
  await requestText(TIM_COVERAGE_URL);
  return {
    id: 'tim',
    kind: 'official',
    name: 'TIM Cobertura e Instabilidade',
    status: 'Disponivel',
    note: 'Pagina oficial da TIM para mapa de cobertura e relatorio de instabilidade.',
    links: [
      { label: 'Mapa TIM', url: TIM_COVERAGE_URL },
      { label: 'Instabilidade TIM', url: TIM_INSTABILITY_URL }
    ]
  };
}

async function fetchAbrTelecomStatus() {
  const html = await requestText(ABRTELECOM_URL);
  return {
    id: 'abrtelecom',
    kind: 'official',
    name: 'ABR Telecom Consulta Numero',
    status: 'Manual',
    requiresCaptcha: /recaptcha/i.test(html),
    note: 'Consulta oficial de numeracao atual, mas exige CAPTCHA para uso manual.',
    links: [{ label: 'Consulta ABR Telecom', url: ABRTELECOM_URL }]
  };
}

async function fetchGitHubStatus(owner, repo, note) {
  const data = await requestJson(`${GITHUB_API_URL}/${owner}/${repo}`, {
    headers: {
      Accept: 'application/vnd.github+json'
    }
  });

  return {
    id: `${owner}-${repo}`,
    kind: 'community',
    name: `${owner}/${repo}`,
    status: 'Catalogado',
    pushedAt: data.pushed_at,
    updatedAt: data.updated_at,
    stars: data.stargazers_count,
    description: data.description || null,
    note,
    links: [{ label: 'Repositorio', url: data.html_url }]
  };
}

async function fetchSourceStatus() {
  return memo('sources', 1000 * 60 * 15, async () => {
    const checks = await Promise.allSettled([
      Promise.resolve({
        id: 'anatel',
        kind: 'official',
        name: 'Anatel Licenciamento',
        status: 'Ao vivo',
        note: 'Fonte principal de ERBs, tecnologias, coordenadas e validade regulatoria.',
        links: [{ label: 'Consulta Anatel', url: ANATEL_PUBLIC_URL }]
      }),
      Promise.resolve({
        id: 'vivo',
        kind: 'official',
        name: 'Vivo Cobertura',
        status: 'Ao vivo',
        note: 'Cobertura oficial por ponto para 2G, 3G, 4G e 5G.',
        links: [{ label: 'Mapa Vivo', url: VIVO_MAP_URL }]
      }),
      fetchTelecoCareStatus(),
      fetchTimStatus(),
      fetchAbrTelecomStatus(),
      fetchGitHubStatus(
        'LuSrodri',
        'ERBs_per_city_per_operators_brazil',
        'Planilha comunitaria util como referencia de apoio.'
      ),
      fetchGitHubStatus(
        'thiagomfernandes',
        'consultaoperadora',
        'Projeto comunitario para operadora/portabilidade por numero.'
      )
    ]);

    return {
      checkedAt: new Date().toISOString(),
      sources: checks.map((result) =>
        result.status === 'fulfilled'
          ? result.value
          : {
              id: `erro-${Math.random().toString(36).slice(2, 8)}`,
              kind: 'error',
              name: 'Fonte com falha',
              status: 'Erro',
              note: result.reason?.message || 'Falha ao consultar a fonte externa.'
            }
      )
    };
  });
}

async function geocodeFreeText(query, limit = 5) {
  const url = new URL(NOMINATIM_URL);
  url.search = new URLSearchParams({
    format: 'jsonv2',
    countrycodes: 'br',
    limit: String(limit),
    q: query
  }).toString();

  const data = await requestJson(url, {
    headers: {
      Accept: 'application/json'
    }
  });

  return data.map((item) => ({
    label: item.name || item.display_name,
    displayName: item.display_name,
    lat: Number(item.lat),
    lon: Number(item.lon),
    category: item.category,
    type: item.type
  }));
}

async function geocodeCep(cep) {
  const cleanCep = String(cep || '').replace(/\D/g, '');
  if (cleanCep.length !== 8) {
    throw new Error('CEP invalido. Informe 8 digitos.');
  }

  const viaCep = await requestJson(`${VIACEP_URL}/${cleanCep}/json/`);
  if (viaCep.erro) {
    throw new Error('CEP nao encontrado.');
  }

  const queries = [
    [viaCep.logradouro, viaCep.bairro, viaCep.localidade, viaCep.uf, 'Brasil', viaCep.cep],
    [viaCep.logradouro, viaCep.bairro, viaCep.localidade, viaCep.uf, 'Brasil'],
    [viaCep.logradouro, viaCep.localidade, viaCep.uf, 'Brasil'],
    [viaCep.bairro, viaCep.localidade, viaCep.uf, 'Brasil'],
    [viaCep.localidade, viaCep.uf, 'Brasil', viaCep.cep],
    [viaCep.localidade, viaCep.uf, 'Brasil']
  ]
    .map((parts) => parts.filter(Boolean).join(', '))
    .filter(Boolean);

  let first = null;
  let displayName = queries[0] || `${viaCep.localidade}/${viaCep.uf}`;

  for (const query of queries) {
    const matches = await geocodeFreeText(query, 1);
    const candidate = matches[0] || null;

    if (candidate && Number.isFinite(candidate.lat) && Number.isFinite(candidate.lon)) {
      first = candidate;
      displayName = candidate.displayName || query;
      break;
    }

    if (!first && candidate) {
      first = candidate;
      displayName = candidate.displayName || query;
    }
  }

  return {
    query: cleanCep,
    results: [
      {
        label: `${viaCep.logradouro || 'CEP'} - ${viaCep.localidade}/${viaCep.uf}`,
        displayName,
        lat: first?.lat ?? null,
        lon: first?.lon ?? null,
        source: 'viacep+nominatim',
        address: viaCep
      }
    ]
  };
}

async function geocodeQuery(query) {
  const normalized = String(query || '').trim();
  if (!normalized) {
    throw new Error('Informe um CEP, bairro, endereco ou regiao.');
  }

  if (/^\d{8}$/.test(normalized.replace(/\D/g, ''))) {
    return geocodeCep(normalized);
  }

  return memo(`geocode:${normalized.toLowerCase()}`, 1000 * 60 * 60 * 12, async () => ({
    query: normalized,
    results: await geocodeFreeText(normalized, 5)
  }));
}

async function serveStatic(requestPath, response) {
  const safePath = requestPath === '/' ? '/index.html' : requestPath;
  const filePath = path.join(publicDir, safePath);

  if (!filePath.startsWith(publicDir)) {
    sendError(response, 403, 'Acesso negado.');
    return;
  }

  try {
    const content = await readFile(filePath);
    const extension = path.extname(filePath).toLowerCase();

    response.writeHead(200, {
      'Content-Type': MIME_TYPES[extension] || 'application/octet-stream',
      'Cache-Control': extension === '.html' ? 'no-store' : 'public, max-age=300'
    });
    response.end(content);
  } catch (error) {
    if (error.code === 'ENOENT') {
      sendError(response, 404, 'Arquivo nao encontrado.');
      return;
    }

    sendError(response, 500, 'Falha ao servir arquivo estatico.', error.message);
  }
}

export function createMapaSinalServer() {
  return http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);

      if (request.method !== 'GET') {
        sendError(response, 405, 'Metodo nao suportado.');
        return;
      }

      if (url.pathname === '/api/sources') {
        sendJson(response, 200, await fetchSourceStatus());
        return;
      }

      if (url.pathname === '/api/municipios') {
        const uf = url.searchParams.get('uf');
        if (!uf) {
          sendError(response, 400, 'Informe a UF.');
          return;
        }

        sendJson(response, 200, {
          uf: String(uf).toUpperCase(),
          checkedAt: new Date().toISOString(),
          municipios: await fetchMunicipios(uf)
        });
        return;
      }

      if (url.pathname === '/api/geocode') {
        const query = url.searchParams.get('q');
        sendJson(response, 200, await geocodeQuery(query));
        return;
      }

      if (url.pathname === '/api/telecocare/viewport') {
        const zoom = Number(url.searchParams.get('zoom') || 6);

        if (zoom < TELECOCARE_MIN_ZOOM) {
          sendJson(response, 200, {
            source: 'telecocare',
            checkedAt: new Date().toISOString(),
            zoom,
            mode: 'idle',
            stationCount: 0,
            operatorSummary: { TIM: 0, VIVO: 0 },
            items: []
          });
          return;
        }

        sendJson(
          response,
          200,
          await fetchTelecoCareViewport(
            normalizeBounds(url.searchParams),
            zoom,
            Number(url.searchParams.get('limit') || 2500)
          )
        );
        return;
      }

      if (url.pathname === '/api/stations') {
        const mode = url.searchParams.get('mode') || 'radius';

        if (mode === 'city') {
          const uf = url.searchParams.get('uf');
          const municipioCode = url.searchParams.get('municipioCode');

          if (!uf || !municipioCode) {
            sendError(response, 400, 'Informe UF e municipioCode.');
            return;
          }

          sendJson(
            response,
            200,
            await fetchStations({
              mode: 'city',
              uf,
              municipioCode,
              centerLat: url.searchParams.get('centerLat'),
              centerLon: url.searchParams.get('centerLon'),
              maxRows: url.searchParams.get('maxRows')
            })
          );
          return;
        }

        const lat = Number(url.searchParams.get('lat'));
        const lon = Number(url.searchParams.get('lon'));
        const radiusKm = Number(url.searchParams.get('radiusKm') || 3);

        if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
          sendError(response, 400, 'Informe latitude e longitude validas.');
          return;
        }

        sendJson(
          response,
          200,
          await fetchStations({
            mode: 'radius',
            lat,
            lon,
            radiusKm,
            maxRows: url.searchParams.get('maxRows')
          })
        );
        return;
      }

      if (url.pathname === '/api/coverage-config') {
        sendJson(response, 200, {
          checkedAt: new Date().toISOString(),
          tim: {
            officialUrl: TIM_COVERAGE_URL,
            options: [
              { key: '2G', label: '2G' },
              { key: '3G', label: '3G' },
              { key: '4G', label: '4G' },
              { key: '45G', label: '4.5G' },
              { key: '5GDSS', label: '5G DSS' },
              { key: '5G', label: '5G' }
            ],
            defaultKey: '4G'
          },
          vivo: {
            officialUrl: VIVO_MAP_URL,
            options: [
              { key: '2G', label: '2G' },
              { key: '3G', label: '3G' },
              { key: '4G', label: '4G' },
              { key: '5G', label: '5G' }
            ],
            defaultKey: '4G'
          }
        });
        return;
      }

      const timCoverageMatch = url.pathname.match(/^\/api\/coverage\/tim\/([A-Za-z0-9]+)\/(\d+)\/(\d+)\/(\d+)\.png$/);
      if (timCoverageMatch) {
        const [, technologyKey, z, x, y] = timCoverageMatch;
        const tile = await fetchTimCoverageTile(technologyKey, Number(x), Number(y), Number(z));
        sendBinary(response, 200, tile.content, tile.contentType);
        return;
      }

      const vivoCoverageMatch = url.pathname.match(/^\/api\/coverage\/vivo\/([A-Za-z0-9]+)\/(\d+)\/(\d+)\/(\d+)\.png$/);
      if (vivoCoverageMatch) {
        const [, technologyKey, z, x, y] = vivoCoverageMatch;
        const tile = await fetchVivoCoverageTile(technologyKey, Number(x), Number(y), Number(z));
        sendBinary(response, 200, tile.content, tile.contentType);
        return;
      }

      if (url.pathname === '/api/vivo-coverage') {
        const lat = Number(url.searchParams.get('lat'));
        const lon = Number(url.searchParams.get('lon'));

        if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
          sendError(response, 400, 'Informe latitude e longitude validas.');
          return;
        }

        sendJson(response, 200, await fetchVivoCoverage(lat, lon));
        return;
      }

      await serveStatic(url.pathname, response);
    } catch (error) {
      sendError(response, 500, 'Falha inesperada no app.', error.message);
    }
  });
}

export async function startMapaSinalServer(port = defaultPort) {
  const server = createMapaSinalServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, resolve);
  });
  return server;
}

const entryHref = process.argv[1] ? pathToFileURL(process.argv[1]).href : '';
if (import.meta.url === entryHref) {
  const server = createMapaSinalServer();
  server.listen(defaultPort, () => {
    console.log(`Mapa Sinal BR ativo em http://localhost:${defaultPort}`);
  });
}
