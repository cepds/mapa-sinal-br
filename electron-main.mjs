import { app, BrowserWindow, shell } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let mainWindow = null;
let localServer = null;
let startMapaSinalServer = null;

function revealMainWindow() {
  if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) {
    mainWindow.show();
  }
}

async function createMainWindow() {
  process.env.MAPA_SINAL_DATA_DIR = path.join(app.getPath('userData'), 'data');
  if (!startMapaSinalServer) {
    ({ startMapaSinalServer } = await import('./server.mjs'));
  }
  localServer = await startMapaSinalServer(0);
  const address = localServer.address();
  const port = typeof address === 'object' && address ? address.port : 4042;
  const appUrl = `http://127.0.0.1:${port}`;

  mainWindow = new BrowserWindow({
    width: 1480,
    height: 920,
    minWidth: 1180,
    minHeight: 760,
    backgroundColor: '#071219',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  mainWindow.once('ready-to-show', revealMainWindow);
  mainWindow.webContents.once('did-finish-load', revealMainWindow);

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (!url.startsWith(appUrl)) {
      shell.openExternal(url);
      return { action: 'deny' };
    }

    return { action: 'allow' };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(appUrl)) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  setTimeout(revealMainWindow, 2500);
  await mainWindow.loadURL(appUrl);

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(createMainWindow);

app.on('window-all-closed', async () => {
  if (localServer) {
    await new Promise((resolve) => localServer.close(resolve));
    localServer = null;
  }

  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', async () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    await createMainWindow();
  }
});
