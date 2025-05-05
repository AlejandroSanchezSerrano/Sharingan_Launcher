const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const { spawn } = require('child_process');

let mainWindow;
let splash;

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

  // Crear ventana principal, pero aún no mostrarla
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
  // mainWindow.webContents.openDevTools();

  // Mostrar la ventana principal cuando esté lista
  mainWindow.once('ready-to-show', () => {
    setTimeout(() => {
      splash.close();
      mainWindow.maximize();
      mainWindow.show();
    }, 2500); // simula un "loading" de 1.5s
  });
}

// Lanzar juegos desde preload
ipcMain.on('launch-game', (event, relativePath) => {
  const fullPath = path.join(__dirname, relativePath);

  try {
    spawn(fullPath, {
      shell: true,
      detached: true,
      stdio: 'ignore',
    }).unref();
  } catch (error) {
    console.error('Error al lanzar juego:', error);
  }
});

app.whenReady().then(createWindow);
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
