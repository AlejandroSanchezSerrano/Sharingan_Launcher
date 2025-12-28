const { app, BrowserWindow, ipcMain, dialog, shell } = require("electron");
const si = require('systeminformation');
const path = require("path");
const { execFile } = require("child_process");
const fs = require("fs");
const fetch = require("node-fetch"); // npm install node-fetch@2
const ps = require("ps-node"); // npm install ps-node

let win;
let games = [];
let completedGames = [];

// === IGDB config ===
const IGDB_CLIENT_ID = "ozbqvuav0w5qpt2xr5eku29uydqbyx";
const IGDB_ACCESS_TOKEN = "iuvsc76lhwfgfyr33ujm2xzxetdbtj";
const IGDB_URL = "https://api.igdb.com/v4";

// === Ruta para guardar datos persistentes ===
const dataFilePath = path.join(app.getPath("userData"), "library.json");

// -------------------- Persistencia --------------------
function loadData() {
  try {
    if (fs.existsSync(dataFilePath)) {
      const raw = fs.readFileSync(dataFilePath, "utf8");
      const parsed = JSON.parse(raw);
      games = (parsed.games || []).map((g) => ({
        ...g,
        sortKey: g.sortKey || g.name || "",
      }));
      completedGames = (parsed.completedGames || []).map((g) => ({
        ...g,
        sortKey: g.sortKey || g.name || "",
      }));
      console.log("Library loaded from", dataFilePath);
    }
  } catch (err) {
    console.error("Error loading library.json", err);
  }
}

function saveData() {
  try {
    const payload = JSON.stringify({ games, completedGames }, null, 2);
    fs.writeFileSync(dataFilePath, payload, "utf8");
  } catch (err) {
    console.error("Error saving library.json", err);
  }
}

// -------------------- Helpers procesos --------------------
function isProcessRunning(processName) {
  return new Promise((resolve) => {
    ps.lookup({ command: processName }, (err, resultList) => {
      if (err) {
        console.error("ps.lookup error", err);
        resolve(false);
        return;
      }
      const found = resultList.some(
        (p) =>
          p &&
          p.command &&
          p.command.toLowerCase().includes(processName.toLowerCase())
      );
      resolve(found);
    });
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// -------------------- Launchers --------------------
function launchPlatform(platform) {
  switch (platform) {
    case "steam":
      execFile("C:\\Program Files (x86)\\Steam\\Steam.exe");
      break;
    case "epic":
      execFile(
        "C:\\Program Files (x86)\\Epic Games\\Launcher\\Portal\\Binaries\\Win32\\EpicGamesLauncher.exe"
      );
      break;
    case "gog":
      execFile("C:\\Program Files (x86)\\GOG Galaxy\\GalaxyClient.exe");
      break;
    default:
      break;
  }
}

function launchGameByPlatform(game) {
  switch (game.platform) {
    case "steam":
      if (game.steamAppId) {
        shell.openExternal(`steam://run/${game.steamAppId}`);
        return;
      }
      break;
    case "epic":
      if (game.epicAppName) {
        shell.openExternal(
          `com.epicgames.launcher://apps/${game.epicAppName}?action=launch&silent=true`
        );
        return;
      }
      break;
    case "gog":
      if (game.gogGameId) {
        shell.openExternal(`goggalaxy://openGameView/${game.gogGameId}`);
        return;
      }
      break;
  }

  if (game.executable) {
    execFile(game.executable, (err) => {
      if (err) console.error(err);
    });
  }
}

// -------------------- FS helpers --------------------
function exists(p) {
  try {
    return fs.existsSync(p);
  } catch {
    return false;
  }
}

function safeReadText(p) {
  try {
    return fs.readFileSync(p, "utf8");
  } catch {
    return null;
  }
}

function listFiles(dir) {
  try {
    return fs.readdirSync(dir).map((n) => path.join(dir, n));
  } catch {
    return [];
  }
}

// -------------------- Exe detect --------------------
function findExeCandidates(rootDir, maxDepth = 3) {
  const results = [];

  function walk(dir, depth) {
    if (depth > maxDepth) return;
    const entries = listFiles(dir);

    for (const full of entries) {
      let st;
      try {
        st = fs.statSync(full);
      } catch {
        continue;
      }

      if (st.isDirectory()) {
        walk(full, depth + 1);
      } else if (st.isFile() && full.toLowerCase().endsWith(".exe")) {
        const base = path.basename(full).toLowerCase();
        const bad =
          base.includes("unins") ||
          base.includes("setup") ||
          base.includes("redist") ||
          base.includes("vcredist") ||
          base.includes("dxsetup") ||
          base.includes("crashhandler") ||
          base.includes("prereq");
        if (!bad) results.push({ path: full, size: st.size });
      }
    }
  }

  walk(rootDir, 0);
  results.sort((a, b) => b.size - a.size);
  return results;
}

function pickBestExe(rootDir) {
  const cands = findExeCandidates(rootDir, 3);
  return cands.length ? cands[0].path : null;
}

// -------------------- Steam parse --------------------
function parseAcfRootFields(acfText) {
  const out = {};
  if (!acfText) return out;

  const grab = (key) => {
    const re = new RegExp(`"${key}"\\s*"([^"]*)"`, "i");
    const m = acfText.match(re);
    return m ? m[1] : null;
  };

  out.appid = grab("appid");
  out.name = grab("name");
  out.installdir = grab("installdir");
  return out;
}

function parseSteamLibraryFoldersVdf(vdfText) {
  const libs = new Set();
  if (!vdfText) return [];

  const pathMatches = [...vdfText.matchAll(/"path"\s*"([^"]+)"/gi)];
  for (const m of pathMatches) libs.add(m[1].replace(/\\\\/g, "\\"));

  const oldMatches = [...vdfText.matchAll(/^\s*"\d+"\s*"([^"]+)"\s*$/gim)];
  for (const m of oldMatches) libs.add(m[1].replace(/\\\\/g, "\\"));

  return [...libs];
}

function findSteamDefaultRoot() {
  const p1 = "C:\\\\Program Files (x86)\\\\Steam";
  const p2 = "C:\\\\Program Files\\\\Steam";
  if (exists(p1)) return p1;
  if (exists(p2)) return p2;
  return null;
}

// -------------------- IDs/Upsert --------------------
function stableNegativeId(input) {
  const s = String(input || "");
  let hash = 0;
  for (let i = 0; i < s.length; i++)
    hash = (hash << 5) - hash + s.charCodeAt(i);
  return -Math.abs(hash || 1);
}

function upsertGameImported(gameObj) {
  const gameId = Number(gameObj.id);
  let g =
    games.find((x) => x.id === gameId) ||
    completedGames.find((x) => x.id === gameId);

  if (!g) {
    g = { id: gameId };
    games.push(g);
  }

  Object.assign(g, {
    name: gameObj.name ?? g.name ?? "",
    cover: gameObj.cover ?? g.cover ?? null,
    coverUrl: gameObj.coverUrl ?? g.coverUrl ?? null,
    executable: gameObj.executable ?? g.executable ?? null,
    platform: gameObj.platform ?? g.platform ?? "none",
    steamAppId: gameObj.steamAppId ?? g.steamAppId ?? null,
    epicAppName: gameObj.epicAppName ?? g.epicAppName ?? null,
    gogGameId: gameObj.gogGameId ?? g.gogGameId ?? null,
    installDir: gameObj.installDir ?? g.installDir ?? null,
    sortKey: (
      gameObj.sortKey ??
      g.sortKey ??
      gameObj.name ??
      g.name ??
      ""
    ).toString(),
  });
}

// -------------------- Window --------------------
function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 720,
    autoHideMenuBar: true,
    icon: path.join(__dirname, "assets/icon.png"),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      autoplayPolicy: "no-user-gesture-required",
    },
  });

  win.maximize();
  win.loadFile("index.html");
}

app.whenReady().then(() => {
  loadData();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

// -------------------- IGDB helper (simple) --------------------
async function igdbGamesQuery(body) {
  const res = await fetch(`${IGDB_URL}/games`, {
    method: "POST",
    headers: {
      "Client-ID": IGDB_CLIENT_ID,
      Authorization: `Bearer ${IGDB_ACCESS_TOKEN}`,
      Accept: "application/json",
      "Content-Type": "text/plain",
    },
    body,
  });

  if (!res.ok) {
    const text = await res.text();
    console.error("IGDB error", res.status, text);
    return [];
  }

  return res.json();
}

// -------------------- IGDB IPC --------------------
ipcMain.handle("igdb:popular", async () => {
  return igdbGamesQuery(`
    fields id,name,cover.image_id,rating,rating_count,platforms,first_release_date;
    where rating != null & rating_count > 10;
    sort rating desc;
    limit 102;
  `);
});

ipcMain.handle("igdb:search", async (_e, query) => {
  if (!query || !query.trim()) return [];
  const safeQ = query.replace(/"/g, '\\"');
  return igdbGamesQuery(
    `search "${safeQ}"; fields id,name,cover.image_id; limit 30;`
  );
});

// -------------------- Biblioteca IPC --------------------
ipcMain.handle("games:get", () => ({ games, completedGames }));

ipcMain.handle("games:add", (_e, game) => {
  const gameId = Number(game.id);
  if (!games.find((g) => g.id === gameId)) {
    const baseName = game.name || "";
    games.push({
      ...game,
      id: gameId,
      executable: null,
      sortKey: baseName,
    });
    saveData();
  }
  return { games, completedGames };
});

ipcMain.handle("games:setExe", (_e, { id, path: exePath, platform }) => {
  const gameId = Number(id);
  const g =
    games.find((x) => x.id === gameId) ||
    completedGames.find((x) => x.id === gameId);
  if (!g) return;

  g.executable = exePath;
  g.platform = platform; // steam | epic | gog | none
  saveData();
});

ipcMain.handle("games:launch", async (_e, id) => {
  const gameId = Number(id);
  const g =
    games.find((x) => x.id === gameId) ||
    completedGames.find((x) => x.id === gameId);
  if (!g) return;

  if (g.platform && g.platform !== "none") {
    let processName = null;
    switch (g.platform) {
      case "steam":
        processName = "Steam.exe";
        break;
      case "epic":
        processName = "EpicGamesLauncher.exe";
        break;
      case "gog":
        processName = "GalaxyClient.exe";
        break;
    }

    if (processName) {
      const running = await isProcessRunning(processName);
      if (!running) {
        launchPlatform(g.platform);
        await sleep(10000);
      }
    }
  }

  launchGameByPlatform(g);
});

ipcMain.handle("games:completed", (_e, id) => {
  const gameId = Number(id);
  const idx = games.findIndex((x) => x.id === gameId);
  if (idx >= 0) {
    const g = games.splice(idx, 1)[0];
    completedGames.push(g);
    saveData();
  }
  return { games, completedGames };
});

ipcMain.handle("games:return", (_e, id) => {
  const gameId = Number(id);
  const idx = completedGames.findIndex((x) => x.id === gameId);
  if (idx >= 0) {
    const g = completedGames.splice(idx, 1)[0];
    games.push(g);
    saveData();
  }
  return { games, completedGames };
});

ipcMain.handle("games:remove", (_e, id) => {
  const gameId = Number(id);
  games = games.filter((g) => g.id !== gameId);
  completedGames = completedGames.filter((g) => g.id !== gameId);
  saveData();
  return { games, completedGames };
});

ipcMain.handle("games:unlink", (_e, id) => {
  const gameId = Number(id);
  const g =
    games.find((x) => x.id === gameId) ||
    completedGames.find((x) => x.id === gameId);
  if (g) {
    g.executable = null;
    saveData();
  }
});

ipcMain.handle("games:updateSortKey", (_e, { id, sortKey }) => {
  const gameId = Number(id);
  const g =
    games.find((x) => x.id === gameId) ||
    completedGames.find((x) => x.id === gameId);
  if (!g) return { ok: false };

  g.sortKey = sortKey || "";
  saveData();
  return { ok: true };
});

// -------------------- Dialogs IPC --------------------
ipcMain.handle("dialog:openFile", async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    properties: ["openFile"],
    filters: [{ name: "Ejecutables", extensions: ["exe"] }],
  });
  return { canceled, filePath: filePaths?.[0] };
});

ipcMain.handle("dialog:openDirectory", async (_e, opts = {}) => {
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    title: opts.title || "Selecciona una carpeta",
    defaultPath: opts.defaultPath || undefined,
    properties: ["openDirectory"],
  });
  return { canceled, dirPath: filePaths?.[0] };
});

// -------------------- Import installed (Steam/Epic/GOG/NONE) --------------------
ipcMain.handle("games:importInstalled", async (_e, config) => {
  console.log("games:importInstalled called", config);

  const report = {
    steam: { found: 0, imported: 0, errors: [] },
    epic: { found: 0, imported: 0, errors: [] },
    gog: { found: 0, imported: 0, errors: [] },
    none: { found: 0, imported: 0, errors: [] },
  };

  // ===== STEAM =====
  try {
    const steamRoot = config?.steamRoot || findSteamDefaultRoot();
    if (steamRoot && exists(steamRoot)) {
      const libraryVdf1 = path.join(
        steamRoot,
        "steamapps",
        "libraryfolders.vdf"
      );
      const libraryVdf2 = path.join(steamRoot, "config", "libraryfolders.vdf");
      const vdfText = safeReadText(libraryVdf1) || safeReadText(libraryVdf2);

      const libraries = parseSteamLibraryFoldersVdf(vdfText);
      libraries.push(steamRoot);

      const uniqLibs = [...new Set(libraries)].filter((p) => !!p && exists(p));

      for (const lib of uniqLibs) {
        const steamapps = path.join(lib, "steamapps");
        if (!exists(steamapps)) continue;

        const manifests = listFiles(steamapps).filter(
          (f) =>
            path.basename(f).toLowerCase().startsWith("appmanifest_") &&
            f.toLowerCase().endsWith(".acf")
        );

        for (const mf of manifests) {
          const acf = safeReadText(mf);
          const fields = parseAcfRootFields(acf);
          if (!fields.appid) continue;

          const appid = Number(fields.appid); 

          const blacklistAppIds = new Set([
            431960, // Wallpaper Engine
            1812620, // DSX (ejemplo, cambia por su AppID real)
            // añade aquí más AppIDs de programas que no quieras importar
          ]);

          if (blacklistAppIds.has(appid)) {
            // saltar apps no-juego conocidas
            continue;
          }

          const lowerName = (fields.name || '').toLowerCase();
          const looksLikeTool =
            lowerName.includes('wallpaper engine') ||
            lowerName.includes('driver booster') ||
            lowerName.includes('controller') ||
            lowerName.includes('soundtrack') ||
            lowerName.includes('editor') ||
            lowerName.includes('sdk');

          if (looksLikeTool) {
            continue;
          }
          report.steam.found++;

          // Ignorar Steamworks Common Redistributables
          if (appid === 228980) {
            continue;
          }
          const name = fields.name || `Steam App ${appid}`;
          const installdir = fields.installdir;

          const installDirAbs = installdir
            ? path.join(steamapps, "common", installdir)
            : null;
          let exe = null;
          if (installDirAbs && exists(installDirAbs))
            exe = pickBestExe(installDirAbs);

          upsertGameImported({
            id: appid,
            name,
            platform: "steam",
            steamAppId: appid,
            executable: exe,
            installDir: installDirAbs,
            sortKey: name,
          });

          report.steam.imported++;
        }
      }

      saveData();
    } else {
      report.steam.errors.push("No se encontró SteamRoot.");
    }
  } catch (err) {
    report.steam.errors.push(String(err?.message || err));
  }

  // ===== EPIC =====
  try {
    const epicManifestsDir =
      config?.epicManifestsDir ||
      "C:\\\\ProgramData\\\\Epic\\\\EpicGamesLauncher\\\\Data\\\\Manifests";

    const launcherInstalledDat =
      config?.epicLauncherInstalledDat ||
      "C:\\\\ProgramData\\\\Epic\\\\UnrealEngineLauncher\\\\LauncherInstalled.dat";

    let launcherInstalled = null;
    if (exists(launcherInstalledDat)) {
      try {
        launcherInstalled = JSON.parse(safeReadText(launcherInstalledDat));
      } catch {}
    }

    if (exists(epicManifestsDir)) {
      const items = listFiles(epicManifestsDir).filter((f) =>
        f.toLowerCase().endsWith(".item")
      );

      for (const file of items) {
        let obj;
        try {
          obj = JSON.parse(safeReadText(file));
        } catch {
          continue;
        }
        if (!obj) continue;

        report.epic.found++;

        const name = obj.DisplayName || obj.AppName || "Epic Game";
        const appName = obj.AppName || null;

        let installLocation = obj.InstallLocation || null;

        if (
          !installLocation &&
          launcherInstalled?.InstallationList &&
          appName
        ) {
          const hit = launcherInstalled.InstallationList.find(
            (x) => x?.AppName === appName
          );
          if (hit?.InstallLocation) installLocation = hit.InstallLocation;
        }

        let exe = null;
        if (installLocation && exists(installLocation)) {
          if (obj.LaunchExecutable) {
            const candidate = path.join(installLocation, obj.LaunchExecutable);
            if (exists(candidate)) exe = candidate;
          }
          if (!exe) exe = pickBestExe(installLocation);
        }

        const epicId = stableNegativeId(`epic:${appName || name}`);

        upsertGameImported({
          id: epicId,
          name,
          platform: "epic",
          epicAppName: appName,
          executable: exe,
          installDir: installLocation,
          sortKey: name,
        });

        report.epic.imported++;
      }

      saveData();
    } else if (config?.epicManifestsDir) {
      report.epic.errors.push("No se encontró carpeta de manifests de Epic.");
    }
  } catch (err) {
    report.epic.errors.push(String(err?.message || err));
  }

  // ===== GOG (simple: subcarpetas) =====
  try {
    const gogRoot = config?.gogRoot;
    if (gogRoot && exists(gogRoot)) {
      const subdirs = listFiles(gogRoot).filter((p) => {
        try {
          return fs.statSync(p).isDirectory();
        } catch {
          return false;
        }
      });

      for (const dir of subdirs) {
        report.gog.found++;

        const name = path.basename(dir);
        const exe = pickBestExe(dir);
        const gogId = stableNegativeId(`gog:${dir}`);

        upsertGameImported({
          id: gogId,
          name,
          platform: "gog",
          executable: exe,
          installDir: dir,
          sortKey: name,
        });

        report.gog.imported++;
      }

      saveData();
    } else if (config?.gogRoot) {
      report.gog.errors.push("La carpeta de GOG no existe o no es accesible.");
    }
  } catch (err) {
    report.gog.errors.push(String(err?.message || err));
  }

  // ===== NONE (pirata/sin plataforma: subcarpetas) =====
  try {
    const noneRoot = config?.noneRoot;
    if (noneRoot && exists(noneRoot)) {
      const subdirs = listFiles(noneRoot).filter((p) => {
        try {
          return fs.statSync(p).isDirectory();
        } catch {
          return false;
        }
      });

      for (const dir of subdirs) {
        const name = path.basename(dir);

        // Busca ejecutable dentro (ya ignora unins, setup, redist, etc.)
        const exe = pickBestExe(dir);

        // Si no hay .exe válido, no es juego => lo saltamos
        if (!exe) continue;

        report.none.found++;

        const noneId = stableNegativeId(`none:${dir}`);

        upsertGameImported({
          id: noneId,
          name,
          platform: "none",
          executable: exe,
          installDir: dir,
          sortKey: name,
        });

        report.none.imported++;
      }

      saveData();
    } else if (config?.noneRoot) {
      report.none.errors.push(
        "La carpeta de “sin plataforma” no existe o no es accesible."
      );
    }
  } catch (err) {
    report.none.errors.push(String(err?.message || err));
  }

  return {
    ok: true,
    report,
    gamesCount: games.length,
    completedCount: completedGames.length,
  };
});

// -------------------- Enrich covers from IGDB --------------------
ipcMain.handle('games:enrichCovers', async (_e, opts = {}) => {
  const limit = Number(opts.limit || 60);

  const targets = games
    .filter(g => !g.cover?.image_id && !g.coverUrl && g.name)
    .slice(0, limit);

  console.log('[enrichCovers] targets=', targets.length);

  let updated = 0;

  // Normalización para comparar y buscar (ignora :, -, _, .)
  const normSearch = s =>
    String(s || '')
      .toLowerCase()
      .replace(/[:\-_,.]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

  for (const g of targets) {
    const originalName = String(g.name || '').trim();
    if (!originalName) continue;

    // Nombre base sin signos de puntuación
    const baseName = normSearch(originalName);

    // Siempre buscamos el nombre completo
    const searchName = baseName;

    const safeQ = searchName.replace(/"/g, '\\"');

    const res = await fetch(`${IGDB_URL}/games`, {
      method: 'POST',
      headers: {
        'Client-ID': IGDB_CLIENT_ID,
        'Authorization': `Bearer ${IGDB_ACCESS_TOKEN}`,
        'Accept': 'application/json',
        'Content-Type': 'text/plain'
      },
      body: `search "${safeQ}"; fields id,name,cover.image_id; limit 20;`
    });

    if (!res.ok) {
      const text = await res.text();
      console.error('[enrichCovers] IGDB error', res.status, text);
      continue;
    }

    const data = await res.json();
    if (!Array.isArray(data) || !data.length) {
      console.log('[enrichCovers] sin resultados para', originalName, 'con búsqueda', searchName);
      await sleep(250);
      continue;
    }

    const targetNorm = normSearch(originalName);

    // 1) nombre exactamente igual normalizado
    let hit = data.find(
      x => normSearch(x.name) === targetNorm && x?.cover?.image_id
    );

    // 2) empieza igual o uno contiene al otro
    if (!hit) {
      hit = data.find(
        x =>
          x?.cover?.image_id &&
          (normSearch(x.name).startsWith(targetNorm) ||
           targetNorm.startsWith(normSearch(x.name)))
      );
    }

    // 3) último recurso: primer resultado con cover
    if (!hit) {
      hit = data.find(x => x?.cover?.image_id);
    }

    if (hit?.cover?.image_id) {
      g.cover = { image_id: hit.cover.image_id };
      g.coverUrl = `https://images.igdb.com/igdb/image/upload/t_cover_big/${hit.cover.image_id}.jpg`; // [web:1][web:31]
      updated++;
      console.log('[enrichCovers] match para', originalName, '=>', hit.name, 'con búsqueda', searchName);
    } else {
      console.log(
        '[enrichCovers] no strong match for:',
        g.name,
        'results:',
        data.map(d => d.name)
      );
    }

    await sleep(250);
  }

  if (updated > 0) saveData();

  console.log('[enrichCovers] updated=', updated);
  return { ok: true, scanned: targets.length, updated };
});

// -------------------- Platinado --------------------

ipcMain.handle("games:togglePlatinum", (_e, id) => {
  const gameId = Number(id);
  // Buscamos solo en completedGames (se asume que el platino es para juegos pasados)
  const g = completedGames.find((x) => x.id === gameId);
  
  if (g) {
    // Invertimos el valor (true -> false, false -> true)
    g.isPlatinum = !g.isPlatinum;
    saveData();
  }
  return { games, completedGames };
});

// -------------------- System Specs IPC --------------------
ipcMain.handle('system:getSpecs', async () => {
  try {
    const cpu = await si.cpu();
    const mem = await si.mem();
    const graphics = await si.graphics();
    const osInfo = await si.osInfo();

    // Intentamos coger la GPU principal (la que tenga más VRAM o sea discreta)
    const gpu = graphics.controllers.find(c => c.vram > 1024) || graphics.controllers[0];

    return {
      cpu: `${cpu.manufacturer} ${cpu.brand}`,
      ram: Math.floor(mem.total / 1024 / 1024 / 1024), // GB
      gpu: gpu ? `${gpu.model} (${Math.floor(gpu.vram / 1024)} GB)` : 'Integrada',
      os: osInfo.distro
    };
  } catch (e) {
    console.error(e);
    return null;
  }
});

// -------------------- IGDB Details (Info Modal) --------------------
ipcMain.handle('igdb:getDetails', async (_e, id) => {
  // Nota: IGDB no da requisitos de PC fáciles. 
  // Pedimos summary, storyline, genres, y screenshots.
  return igdbGamesQuery(`
    fields name, summary, storyline, genres.name, involved_companies.company.name, first_release_date, cover.image_id, screenshots.image_id;
    where id = ${id};
  `);
});