const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

let mainWindow;
let splash;

// Cargar configuración de juegos desde games.json
const gamesPath = path.join(__dirname, 'games.json');
let juegos = {};

try {
  juegos = JSON.parse(fs.readFileSync(gamesPath, 'utf8'));
} catch (err) {
  console.error("Error al cargar games.json:", err);
}

function createWindow() {
  // Crear splash screen
  splash = new BrowserWindow({
    width: 400,
    height: 300,
    frame: false,
    alwaysOnTop: true,
    transparent: false,
    resizable: false,
    icon: path.join(__dirname, 'assets/icon.png'),
  });
  splash.loadFile('splash.html');

  // Crear ventana principal
  mainWindow = new BrowserWindow({
    width: 1000,
    height: 700,
    show: false,
    icon: path.join(__dirname, 'assets/icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  mainWindow.setMenuBarVisibility(false);
  mainWindow.loadFile('distt/index.html');
  mainWindow.webContents.openDevTools(); // Quitar para producción

  mainWindow.once('ready-to-show', () => {
    setTimeout(() => {
      splash.close();
      mainWindow.maximize();
      mainWindow.show();
    }, 2500);
  });
}

// Lanzar juegos directamente desde configuración
ipcMain.handle('launch-game', async (event, gameKey) => {
  const juego = juegos[gameKey];
  if (!juego) {
    console.error(`Juego no encontrado: ${gameKey}`);
    return;
  }

  const { emulador, rom } = juego;

  console.log(`Lanzando: ${emulador} ${rom}`);

  try {
    spawn(emulador, [rom], {
      shell: true,
      detached: true,
      stdio: 'ignore',
    }).unref();
  } catch (error) {
    console.error(`Error al lanzar ${gameKey}:`, error);
  }
});

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
