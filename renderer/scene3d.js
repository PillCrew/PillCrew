// 3D background: slowly drifting pills. Built to stay cheap: low render resolution, 30 fps cap, simple
// materials, paused when the window is hidden, and it switches itself off on slow machines.
(() => {
  const THREE = window.THREE;
  if (!THREE) return;                                 // CSS gradient fallback stays visible
  const canvas = document.getElementById('bg3d');
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let renderer;
  try { renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: true, powerPreference: 'low-power' }); } catch (e) { return; }
  renderer.setPixelRatio(1);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 100);
  camera.position.z = 14;
  scene.add(new THREE.AmbientLight(0xcfeede, 1.1));
  const key = new THREE.DirectionalLight(0x35f08c, 2.2); key.position.set(-6, 6, 8); scene.add(key);
  const rim = new THREE.DirectionalLight(0x18c8b4, 1.6); rim.position.set(8, -4, 5); scene.add(rim);

  const geo = new THREE.CapsuleGeometry(0.5, 1.1, 4, 12);
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const top = new THREE.Color(0x35f08c), bottom = new THREE.Color(0xeef7f2);
  for (let i = 0; i < pos.count; i++) { const c = pos.getY(i) >= 0 ? top : bottom; colors.set([c.r, c.g, c.b], i * 3); }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true, transparent: true, opacity: 0.9 });

  const pills = [];
  for (let i = 0; i < 16; i++) {
    const m = new THREE.Mesh(geo, mat);
    m.scale.setScalar(0.55 + Math.random() * 1.0);
    m.position.set((Math.random() - 0.5) * 30, (Math.random() - 0.5) * 18, -4 - Math.random() * 12);
    m.rotation.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
    m.userData = { spin: [(Math.random() - 0.5) * 0.5, (Math.random() - 0.5) * 0.5, (Math.random() - 0.5) * 0.5], drift: 0.15 + Math.random() * 0.3, phase: Math.random() * 6.28, baseY: m.position.y };
    scene.add(m); pills.push(m);
  }

  let scale = 0.6, mx = 0, my = 0;
  const resize = () => { renderer.setSize(Math.round(innerWidth * scale), Math.round(innerHeight * scale), false); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); };
  addEventListener('resize', resize); resize();
  addEventListener('pointermove', (e) => { mx = e.clientX / innerWidth - 0.5; my = e.clientY / innerHeight - 0.5; }, { passive: true });

  const fb = document.querySelector('.bg-fallback'); if (fb) fb.style.opacity = '.6';
  if (reduce) { renderer.render(scene, camera); return; }

  const STEP = 1 / 30;                                // 30 fps is plenty for a background
  let last = performance.now(), acc = 0, t = 0, raf = 0, slow = 0, frames = 0, spent = 0, stopped = false;
  const frame = (now) => {
    raf = requestAnimationFrame(frame);
    acc += Math.min(0.1, (now - last) / 1000); last = now;
    if (acc < STEP) return;
    const dt = acc; acc = 0; t += dt;
    const t0 = performance.now();
    for (const p of pills) {
      const d = p.userData;
      p.rotation.x += d.spin[0] * dt; p.rotation.y += d.spin[1] * dt; p.rotation.z += d.spin[2] * dt;
      p.position.y = d.baseY + Math.sin(t * d.drift + d.phase) * 1.2;
    }
    camera.position.x += (mx * 2.5 - camera.position.x) * 0.04;
    camera.position.y += (-my * 1.6 - camera.position.y) * 0.04;
    camera.lookAt(0, 0, 0);
    renderer.render(scene, camera);
    // adaptive quality: if frames are expensive, lower the resolution, then switch the animation off
    spent += performance.now() - t0; frames++;
    if (frames === 45) {
      const avg = spent / frames; frames = 0; spent = 0;
      if (avg > 9) { slow++; if (slow === 1) { scale = 0.4; resize(); } else if (slow >= 2 && !stopped) { stopped = true; cancelAnimationFrame(raf); renderer.render(scene, camera); } }
    }
  };
  const run = () => { if (!stopped) { last = performance.now(); raf = requestAnimationFrame(frame); } };
  document.addEventListener('visibilitychange', () => { if (document.hidden) cancelAnimationFrame(raf); else run(); });
  addEventListener('blur', () => cancelAnimationFrame(raf));
  addEventListener('focus', run);
  run();
})();
