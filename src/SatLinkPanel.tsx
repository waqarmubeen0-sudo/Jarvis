import React, { useEffect, useRef, useState } from 'react';

// Country boundary polygons — powers the "which country is this" overlay.
const COUNTRIES_GEOJSON_URL =
  'https://raw.githubusercontent.com/vasturiano/globe.gl/master/example/datasets/ne_110m_admin_0_countries.geojson';
// Populated places — city labels that switch on once you zoom in close.
const CITIES_GEOJSON_URL =
  'https://raw.githubusercontent.com/vasturiano/globe.gl/master/example/datasets/ne_110m_populated_places_simple.geojson';

// Camera altitude (in globe-radius units) below which city labels appear.
const CITY_ZOOM_ALTITUDE = 0.5;
// Degrees to rotate per animation frame — tune this to taste.
const ROTATE_DEG_PER_FRAME = 0.06;

type LabelDatum = { lat: number; lng: number; name: string; size: number; color: string };

// ponytail: centroid = mean of the largest outer ring's vertices; fine for label placement, not for area math.
const countryCentroid = (geometry: any): { lat: number; lng: number } | null => {
  const rings: number[][][] =
    geometry?.type === 'Polygon' ? [geometry.coordinates[0]] :
    geometry?.type === 'MultiPolygon' ? geometry.coordinates.map((p: any) => p[0]) : [];
  const ring = rings.sort((a, b) => b.length - a.length)[0];
  if (!ring?.length) return null;
  const sum = ring.reduce((acc, [lng, lat]) => [acc[0] + lng, acc[1] + lat], [0, 0]);
  return { lng: sum[0] / ring.length, lat: sum[1] / ring.length };
};

const weatherText = (code: number) =>
  code === 0 ? 'CLEAR' :
  code <= 3 ? 'CLOUDY' :
  code <= 48 ? 'FOG' :
  code <= 67 ? 'RAIN' :
  code <= 77 ? 'SNOW' :
  code <= 82 ? 'SHOWERS' :
  code <= 86 ? 'SNOW' :
  code >= 95 ? 'STORM' : 'UNKNOWN';

export const SatLinkPanel: React.FC = () => {
  const containerRef = useRef<HTMLDivElement>(null);

  const [telemetry, setTelemetry] = useState({
    location: 'ACQUIRING GPS...',
    country: '---',
    region: '---',
    lat: '--°',
    lng: '--°',
    temp: '--°C',
    weather: 'SCANNING...',
    zoomLevel: 'MACRO (GLOBAL)'
  });

  useEffect(() => {
    // Everything this mount creates lives in these locals and is torn down in
    // the cleanup, so React StrictMode / HMR remounts get a fresh, working globe
    // (the old ref-based guard left a dead globe with no rotation or borders).
    let isMounted = true;
    let world: any = null;
    let rotationFrame = 0;
    let userInteracting = false;
    let transitionUntil = 0;
    let requestSeq = 0;
    let hovered: any = null;
    let countryLabels: LabelDatum[] = [];
    let cityLabels: LabelDatum[] = [];
    let citiesVisible = false;
    let lastZoomLabel = 'MACRO (GLOBAL)';
    const container = containerRef.current;

    const fetchLocationAndWeather = async (lat: number, lng: number, label?: string) => {
      const seq = ++requestSeq;
      const latStr = `${Math.abs(lat).toFixed(2)}° ${lat >= 0 ? 'N' : 'S'}`;
      const lngStr = `${Math.abs(lng).toFixed(2)}° ${lng >= 0 ? 'E' : 'W'}`;
      setTelemetry(prev => ({ ...prev, lat: latStr, lng: lngStr, temp: '...', weather: 'SCANNING...' }));
      try {
        const [weatherRes, geoRes] = await Promise.all([
          fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current=temperature_2m,weather_code`).catch(() => null),
          fetch(`https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lng}&localityLanguage=en`).catch(() => null)
        ]);
        const w = weatherRes?.ok ? (await weatherRes.json()).current : null;
        const g = geoRes?.ok ? await geoRes.json() : null;
        if (!isMounted || seq !== requestSeq) return; // a newer lookup won

        const region = g?.principalSubdivision || g?.continent || 'Open Ocean';
        setTelemetry(prev => ({
          ...prev,
          location: label || g?.city || g?.locality || region,
          country: g?.countryName || 'International Waters',
          region,
          temp: w ? `${w.temperature_2m}°C` : 'N/A',
          weather: w ? weatherText(w.weather_code) : 'UNAVAILABLE'
        }));
      } catch (err) {
        console.error('Data fetch error:', err);
      }
    };

    // Drop a marker, fly there, and show that exact spot's weather.
    const focusOn = (lat: number, lng: number, label?: string, altitude = 1.3) => {
      if (!world) return;
      world.pointsData([{ lat, lng }]);
      world.ringsData([{ lat, lng }]);
      transitionUntil = Date.now() + 1500;
      world.pointOfView({ lat, lng, altitude }, 1500);
      fetchLocationAndWeather(lat, lng, label);
    };

    // JARVIS voice weather lookups broadcast their coordinates here (see App.tsx).
    const onJarvisFocus = (e: Event) => {
      const d = (e as CustomEvent).detail;
      focusOn(d.lat, d.lng, d.location);
    };
    window.addEventListener('jarvis:focus-location', onJarvisFocus);

    const applyPolygonHighlight = () => {
      world
        .polygonCapColor((f: any) => (f === hovered ? 'rgba(0, 255, 136, 0.45)' : 'rgba(0, 240, 255, 0.06)'))
        .polygonStrokeColor((f: any) => (f === hovered ? '#00ff88' : 'rgba(0, 240, 255, 0.35)'))
        .polygonAltitude((f: any) => (f === hovered ? 0.02 : 0.006));
    };

    const onPointerDown = () => { userInteracting = true; };
    const onPointerUp = () => { userInteracting = false; };

    const initGlobe = () => {
      if (!container || !isMounted || !(window as any).Globe) return;

      world = (window as any).Globe()(container)
        .width(container.clientWidth || 300)
        .height(container.clientHeight || 220)
        .globeImageUrl('//unpkg.com/three-globe/example/img/earth-blue-marble.jpg')
        .bumpImageUrl('//unpkg.com/three-globe/example/img/earth-topology.png')
        .backgroundColor('rgba(0,0,0,0)')
        .showAtmosphere(true)
        .atmosphereColor('#00f0ff')
        .atmosphereAltitude(0.2)
        .pointColor(() => '#00ff88')
        .pointAltitude(0.06)
        .pointRadius(0.9)
        .ringColor(() => (t: number) => `rgba(0, 255, 136, ${1 - t})`)
        .ringMaxRadius(10)
        .ringPropagationSpeed(2)
        .ringRepeatPeriod(1200)
        .polygonSideColor(() => 'rgba(0, 240, 255, 0.05)')
        // Tooltip that follows the cursor with the country name.
        .polygonLabel(({ properties: d }: any) => `
          <div style="font-family: monospace; font-size: 11px; background: rgba(7,11,18,0.92);
                      border: 1px solid rgba(0,240,255,0.4); color:#00ff88; padding:4px 8px; border-radius:4px;">
            ${d.ADMIN || d.NAME}
          </div>
        `)
        .onPolygonHover((hoverD: any) => {
          hovered = hoverD;
          applyPolygonHighlight();
          if (hoverD) {
            const props = hoverD.properties || {};
            setTelemetry(prev => ({
              ...prev,
              country: props.ADMIN || props.NAME || prev.country,
              region: props.SUBREGION || props.REGION_UN || prev.region
            }));
          }
        })
        // Click anywhere (land or sea) for that exact spot's weather.
        .onPolygonClick((_p: any, _e: any, c: { lat: number; lng: number }) => c && fetchLocationAndWeather(c.lat, c.lng))
        .onGlobeClick((c: { lat: number; lng: number }) => fetchLocationAndWeather(c.lat, c.lng))
        .labelText((d: LabelDatum) => d.name)
        .labelLat((d: LabelDatum) => d.lat)
        .labelLng((d: LabelDatum) => d.lng)
        .labelColor((d: LabelDatum) => d.color)
        .labelSize((d: LabelDatum) => d.size)
        .labelDotRadius((d: LabelDatum) => (d.size < 0.5 ? 0.15 : 0))
        .labelResolution(2)
        .labelAltitude(0.012);

      const controls = world.controls();
      controls.autoRotate = false; // rotation is driven by rotateLoop below
      controls.enableZoom = true;
      controls.minDistance = 101;
      controls.maxDistance = 400;

      container.addEventListener('pointerdown', onPointerDown);
      window.addEventListener('pointerup', onPointerUp);
      window.addEventListener('pointercancel', onPointerUp);

      // Spin by nudging longitude each frame; paused while dragging or during a fly-to.
      const rotateLoop = () => {
        if (!isMounted) return;
        if (!userInteracting && Date.now() > transitionUntil) {
          const pov = world.pointOfView();
          world.pointOfView({ lng: pov.lng + ROTATE_DEG_PER_FRAME }, 0);
        }
        rotationFrame = requestAnimationFrame(rotateLoop);
      };
      rotationFrame = requestAnimationFrame(rotateLoop);

      const refreshLabels = () => world.labelsData(citiesVisible ? [...countryLabels, ...cityLabels] : countryLabels);

      world.onZoom(({ altitude }: { altitude: number }) => {
        const showCities = altitude < CITY_ZOOM_ALTITUDE;
        if (showCities !== citiesVisible) {
          citiesVisible = showCities;
          refreshLabels();
        }
        const newLabel = altitude > 1.4 ? 'MACRO (GLOBAL)' : showCities ? 'CITY VIEW' : 'CITY & COUNTRY MAP';
        if (newLabel !== lastZoomLabel) {
          lastZoomLabel = newLabel;
          setTelemetry(prev => ({ ...prev, zoomLevel: newLabel }));
        }
      });

      world.pointOfView({ altitude: 2.2 });

      // Country borders + a name label on every country, always visible.
      fetch(COUNTRIES_GEOJSON_URL)
        .then(res => res.json())
        .then(countries => {
          if (!isMounted) return;
          const features = (countries.features || []).filter((f: any) => f.properties.ISO_A2 !== 'AQ');
          world.polygonsData(features);
          applyPolygonHighlight();
          countryLabels = features.flatMap((f: any) => {
            const c = countryCentroid(f.geometry);
            const rank = f.properties.LABELRANK || 5; // 1 = big country, higher = smaller
            return c
              ? [{ ...c, name: f.properties.NAME || f.properties.ADMIN, size: Math.max(0.5, 1.4 - rank * 0.15), color: 'rgba(255, 255, 255, 0.85)' }]
              : [];
          });
          refreshLabels();
        })
        .catch((err: any) => console.error('Country boundary load error:', err));

      // City labels — only switched on once zoomed in close.
      fetch(CITIES_GEOJSON_URL)
        .then(res => res.json())
        .then(cities => {
          if (!isMounted) return;
          cityLabels = (cities.features || []).flatMap((f: any) => {
            const [lng, lat] = f.geometry?.coordinates || [];
            const p = f.properties || {};
            return Number.isFinite(lat) && Number.isFinite(lng)
              ? [{ lat, lng, name: p.NAME || p.NAMEASCII || 'Unknown', size: 0.35, color: 'rgba(0, 255, 136, 0.9)' }]
              : [];
          });
          refreshLabels();
        })
        .catch((err: any) => console.error('City data load error:', err));

      // Start on the user's live GPS position (fallback: default location).
      const fallback = () => focusOn(-29.72, 31.08, 'DEFAULT LOCATION');
      if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
          pos => focusOn(pos.coords.latitude, pos.coords.longitude),
          fallback,
          { timeout: 6000 }
        );
      } else {
        fallback();
      }
    };

    if ((window as any).Globe) {
      initGlobe();
    } else {
      let script = document.querySelector<HTMLScriptElement>('script[data-globe-gl]');
      if (!script) {
        script = document.createElement('script');
        script.src = '//unpkg.com/globe.gl';
        script.dataset.globeGl = '1';
        document.head.appendChild(script);
      }
      script.addEventListener('load', initGlobe, { once: true });
    }

    return () => {
      isMounted = false;
      cancelAnimationFrame(rotationFrame);
      window.removeEventListener('jarvis:focus-location', onJarvisFocus);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);
      container?.removeEventListener('pointerdown', onPointerDown);
      world?._destructor?.();
      if (container) container.innerHTML = '';
    };
  }, []);

  return (
    <div className="relative flex-1 min-h-[250px] bg-[#070b12] border border-[#1e2638] rounded-lg p-2.5 flex flex-col justify-between overflow-hidden select-none">

      {/* Clean HUD Header */}
      <div className="flex items-center justify-between border-b border-[#1e2638] pb-1.5 z-10">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse"></span>
          <h3 className="font-mono text-xs font-bold text-cyan-400 tracking-wider uppercase">
            WORLD 3D MAP
          </h3>
        </div>
      </div>

      {/* 3D Globe Viewport */}
      <div className="relative w-full h-full flex-1 flex items-center justify-center overflow-hidden">
        <div ref={containerRef} className="w-full h-full flex items-center justify-center cursor-grab active:cursor-grabbing" />
      </div>

      {/* Live Country, City, Weather & Coordinates Footer */}
      <div className="border-t border-[#1e2638] pt-1.5 z-10 flex flex-col gap-1 font-mono text-[10px]">
        <div className="flex items-center justify-between text-[#00ff88] font-bold">
          <span className="truncate max-w-[180px]">COUNTRY: {telemetry.country}</span>
          <span className="bg-[#00ff88]/10 px-1 py-0.5 border border-[#00ff88]/40 rounded text-[9px]">
            TEMP: {telemetry.temp}
          </span>
        </div>

        <div className="flex items-center justify-between text-slate-300">
          <span className="truncate max-w-[180px]">CITY/REGION: <strong className="text-cyan-400">{telemetry.location}</strong></span>
          <span className="text-slate-400">COND: <strong className="text-slate-100">{telemetry.weather}</strong></span>
        </div>

        <div className="flex items-center justify-between text-slate-400 text-[9px] border-t border-[#1e2638]/50 pt-0.5">
          <span>LAT: {telemetry.lat} | LNG: {telemetry.lng}</span>
          <span className="text-cyan-400">{telemetry.zoomLevel}</span>
        </div>
      </div>

    </div>
  );
};
