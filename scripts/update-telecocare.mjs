import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import AdmZip from 'adm-zip';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const cacheDir = path.join(rootDir, 'data', 'telecocare-cache');
const workbookPath = path.join(cacheDir, 'ERBs.xlsx');
const metadataPath = path.join(cacheDir, 'metadata.json');
const telecoCareUrl = 'https://www.telecocare.com.br/mapaerbs/';
const userAgent = 'Mapa Sinal BR/0.1';

function parseZipUrl(html = '') {
  const match = html.match(/href="([^"]*ERBs_[^"]+\.zip)"/i);
  return match ? new URL(match[1], telecoCareUrl).toString() : null;
}

async function request(url) {
  const response = await fetch(url, {
    headers: {
      'User-Agent': userAgent
    }
  });

  if (!response.ok) {
    throw new Error(`Falha ${response.status} ao consultar ${url}`);
  }

  return response;
}

async function main() {
  await mkdir(cacheDir, { recursive: true });
  const homePage = await (await request(telecoCareUrl)).text();
  const zipUrl = parseZipUrl(homePage);

  if (!zipUrl) {
    throw new Error('Nao foi possivel localizar o ZIP publico do TelecoCare.');
  }

  const zipBuffer = Buffer.from(await (await request(zipUrl)).arrayBuffer());
  const zip = new AdmZip(zipBuffer);
  const workbookEntry = zip
    .getEntries()
    .find((entry) => !entry.isDirectory && /ERBs.*\.xlsx$/i.test(path.basename(entry.entryName)));

  if (!workbookEntry) {
    throw new Error('O ZIP nao trouxe a planilha esperada.');
  }

  const workbookBuffer = workbookEntry.getData();
  await writeFile(workbookPath, workbookBuffer);

  const metadata = {
    source: telecoCareUrl,
    zipUrl,
    downloadedAt: new Date().toISOString(),
    zipBytes: zipBuffer.length,
    workbookFile: path.basename(workbookEntry.entryName)
  };
  await writeFile(metadataPath, JSON.stringify(metadata, null, 2));

  console.log(JSON.stringify({
    ok: true,
    workbookPath,
    metadataPath,
    zipUrl,
    downloadedAt: metadata.downloadedAt
  }, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
