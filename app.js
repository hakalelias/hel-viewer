let viewer, youEntity;
let heightOffsetValue = 0;
let lastGps = null;
let watchId = null; // continuous follow

function appendLog(msg) {
  const el = document.getElementById("log");
  if (!el) return;
  el.textContent += "\n" + msg;
  el.scrollTop = el.scrollHeight;
}

async function loadConfig() {
  const res = await fetch("config.json");
  if (!res.ok) throw new Error("config.json ei latautunut");
  return res.json();
}

function cart(lon, lat, h=0) {
  return Cesium.Cartesian3.fromDegrees(lon, lat, h);
}

async function init() {
  appendLog("init() alkaa");

  const cfg = await loadConfig();
  appendLog("config.json ladattu");

  viewer = new Cesium.Viewer("app", {
    terrain: cfg.useWorldTerrain ? Cesium.Terrain.fromWorldTerrain() : undefined,
    infoBox: false, selectionIndicator: false, geocoder: false,
    animation: false, timeline: false, homeButton: false, fullscreenButton: false
  });

  viewer.scene.camera.setView({
    destination: cart(
      cfg.startView.longitude,
      cfg.startView.latitude,
      cfg.startView.height
    ),
    orientation: {
      heading: Cesium.Math.toRadians(cfg.startView.heading),
      pitch: Cesium.Math.toRadians(cfg.startView.pitch),
      roll: Cesium.Math.toRadians(cfg.startView.roll)
    }
  });

  try {
    const tileset = await Cesium.Cesium3DTileset.fromIonAssetId(cfg.ionAssetId);
    viewer.scene.primitives.add(tileset);
    await tileset.readyPromise;

    viewer.camera.flyToBoundingSphere(tileset.boundingSphere, {
      duration: 2,
      offset: new Cesium.HeadingPitchRange(
        0,
        Cesium.Math.toRadians(-35),
        tileset.boundingSphere.radius * 2
      )
    });

    appendLog("3D-malli ladattu (Asset ID: " + cfg.ionAssetId + ")");
  } catch (e) {
    appendLog("3D-mallin lataus epäonnistui: " + e.message);
  }

  youEntity = viewer.entities.add({
    point: { pixelSize: 12, color: Cesium.Color.BLUE },
    label: {
      text: "Minä",
      pixelOffset: new Cesium.Cartesian2(0, -30),
      fillColor: Cesium.Color.BLACK,
      showBackground: true
    }
  });
  youEntity.show = false;

  setupUI();
  appendLog("UI kytketty");

  // Kysy sijaintilupa heti alussa
  requestInitialPermission();
}

function updateEntityFromLastGps() {
  if (!lastGps || !youEntity) return;
  const { lon, lat, ground } = lastGps;
  const height = ground + heightOffsetValue;
  const p = Cesium.Cartesian3.fromDegrees(lon, lat, height);
  youEntity.position = p;
  youEntity.show = true;
}

async function updatePosition(pos) {
  appendLog("GPS päivitys saatu");

  const lon = pos.coords.longitude;
  const lat = pos.coords.latitude;

  const carto = Cesium.Cartographic.fromDegrees(lon, lat);

  let terrain = await Cesium.sampleTerrainMostDetailed(
    viewer.terrainProvider,
    [carto]
  ).catch(() => [carto]);

  const ground = terrain[0].height || 0;
  lastGps = { lon, lat, ground };

  updateEntityFromLastGps();

  const follow = document.getElementById("followMe");
  if (follow && follow.checked) {
    const p = youEntity.position.getValue(new Cesium.JulianDate());
    viewer.camera.flyTo({ destination: p, duration: 0.5 });
  }
}

function requestInitialPermission() {
  if (!navigator.geolocation) {
    appendLog("Geolocation ei ole saatavilla (initial).");
    return;
  }
  appendLog("Kysytään sijaintilupaa...");
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      appendLog("Sijaintilupa myönnetty.");
      // Emme vielä piirrä mitään, tämä on vain lupaa varten
    },
    (err) => {
      appendLog("Sijaintilupa hylätty tai virhe: " + err.message);
    },
    { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 }
  );
}

function setupUI() {
  const locateBtn = document.getElementById("locateBtn");
  const followChk = document.getElementById("followMe");
  const slider = document.getElementById("heightOffset");
  const label = document.getElementById("heightValue");

  if (locateBtn) {
    locateBtn.onclick = () => {
      appendLog("Missä olen? -nappia painettu");
      if (!navigator.geolocation) {
        appendLog("Geolocation ei ole saatavilla (Missä olen?).");
        return;
      }
      // Jos meillä on jo GPS-sijainti, käytä sitä suoraan
      if (lastGps) {
        appendLog("Käytetään viimeisintä tunnettua sijaintia.");
        updateEntityFromLastGps();
        const p = youEntity.position.getValue(new Cesium.JulianDate());
        viewer.camera.flyTo({ destination: p, duration: 0.5 });
      } else {
        appendLog("Ei vielä GPS-sijaintia, pyydetään yksi kerta (getCurrentPosition)...");
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            appendLog("Single GPS fix saatu (Missä olen?)");
            updatePosition(pos);
          },
          (err) => {
            appendLog("GPS virhe (Missä olen?): " + err.message);
          },
          { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 }
        );
      }
    };
  }

  if (followChk) {
    followChk.onchange = (e) => {
      if (!navigator.geolocation) {
        appendLog("Geolocation ei ole saatavilla (follow).");
        followChk.checked = false;
        return;
      }
      if (e.target.checked) {
        appendLog("Seuranta päälle");
        if (watchId !== null) {
          navigator.geolocation.clearWatch(watchId);
        }
        watchId = navigator.geolocation.watchPosition(
          updatePosition,
          (err) => appendLog("GPS virhe (follow): " + err.message),
          { enableHighAccuracy: true, maximumAge: 1000, timeout: 10000 }
        );
      } else {
        appendLog("Seuranta pois");
        if (watchId !== null) {
          navigator.geolocation.clearWatch(watchId);
          watchId = null;
        }
      }
    };
  }

  if (slider && label) {
    slider.oninput = () => {
      heightOffsetValue = Number(slider.value);
      label.textContent = heightOffsetValue;
      appendLog("Korkeus offset: " + heightOffsetValue + " m");
      updateEntityFromLastGps();
    };
  }
}

init().catch(e => appendLog("Virhe init(): " + e.message));
