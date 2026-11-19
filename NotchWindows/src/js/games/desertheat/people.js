// Desert Heat: people on foot (section 2). A jointed figure built from rounded parts, animated by code: walk, run, crouch,
// idle breathing, sitting. Not motion capture yet (the prompt asks for a licensed library later); the cycle is tuned so feet
// plant and do not slide: the stride length matches the speed.
(function () {
  'use strict';
  const THREE = window.THREE;

  const mat = (color, rough = 0.8, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: rough, ...extra });
  const cap = (r, len) => new THREE.CapsuleGeometry(r, len, 4, 10);

  /**
   * spec: { skin, hair, shirt, trousers, height, abaya, shoes, torch }
   * returns { group, update(dt, speed, crouch), setPose('stand'|'sit') }
   */
  function makePerson(spec) {
    const s = (spec.height || 1.75) / 1.75;
    const g = new THREE.Group();
    const body = new THREE.Group(); g.add(body); body.scale.setScalar(s);
    const skin = mat(spec.skin, 0.6), hair = mat(spec.hair, 0.9), shirt = mat(spec.shirt, 0.85), trousers = mat(spec.trousers, 0.9), shoe = mat(spec.shoes || '#1a1a1a', 0.5);
    const part = (geo, m, x, y, z, parent) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.castShadow = true; (parent || body).add(o); return o; };
    const joint = (x, y, z, parent) => { const j = new THREE.Group(); j.position.set(x, y, z); (parent || body).add(j); return j; };

    const hips = joint(0, 0.95, 0);
    part(new THREE.BoxGeometry(0.34, 0.16, 0.2), trousers, 0, 0, 0, hips);
    const chest = joint(0, 0.08, 0, hips);
    const torso = part(cap(0.17, 0.32), shirt, 0, 0.28, 0, chest); torso.scale.set(1.05, 1, 0.68);
    part(new THREE.CylinderGeometry(0.05, 0.06, 0.1, 8), skin, 0, 0.6, 0, chest);
    const head = joint(0, 0.7, 0, chest);
    const skull = part(new THREE.SphereGeometry(0.105, 18, 14), skin, 0, 0.06, 0, head); skull.scale.set(0.92, 1.1, 1);
    part(new THREE.BoxGeometry(0.03, 0.04, 0.03), skin, 0, 0.04, -0.105, head);   // nose
    if (spec.abaya) {
      // shayla: a dark scarf around the head
      const sh = part(new THREE.SphereGeometry(0.125, 18, 14, 0, Math.PI * 2, 0, Math.PI * 0.62), hair, 0, 0.07, 0.01, head); sh.scale.set(0.98, 1.15, 1.06);
      part(new THREE.CylinderGeometry(0.1, 0.16, 0.16, 14, 1, true), hair, 0, -0.06, 0.01, head).material.side = THREE.DoubleSide;
    } else {
      const top = part(new THREE.SphereGeometry(0.11, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.5), hair, 0, 0.08, 0.005, head); top.scale.set(0.95, 0.8, 1.02);
      if (spec.beard) { const b = part(new THREE.SphereGeometry(0.085, 14, 10, 0, Math.PI * 2, Math.PI * 0.5, Math.PI * 0.5), hair, 0, 0.03, -0.02, head); b.scale.set(1, 1.1, 1.05); }
    }
    const limbs = {};
    for (const side of [-1, 1]) {
      const sh = joint(side * 0.2, 0.52, 0, chest);
      part(cap(0.05, 0.22), shirt, 0, -0.14, 0, sh);
      const el = joint(0, -0.3, 0, sh);
      part(cap(0.042, 0.2), spec.abaya ? shirt : skin, 0, -0.12, 0, el);
      part(new THREE.SphereGeometry(0.045, 10, 8), skin, 0, -0.27, 0, el);
      const hip = joint(side * 0.1, -0.04, 0, hips);
      part(cap(0.075, 0.32), trousers, 0, -0.22, 0, hip);
      const kn = joint(0, -0.45, 0, hip);
      part(cap(0.06, 0.32), trousers, 0, -0.21, 0, kn);
      const ft = part(new THREE.BoxGeometry(0.1, 0.07, 0.25), shoe, 0, -0.45, -0.04, kn);
      limbs[side] = { sh, el, hip, kn, ft };
    }
    if (spec.abaya) {
      // The abaya: a long open robe that falls from the shoulders and moves with the legs.
      const pts = []; for (let i = 0; i <= 10; i++) { const t = i / 10; pts.push(new THREE.Vector2(0.19 + t * 0.13 + Math.sin(t * 3) * 0.01, -t * 1.0)); }
      const robe = new THREE.Mesh(new THREE.LatheGeometry(pts, 22), mat('#141417', 0.95, { side: THREE.DoubleSide }));
      robe.position.set(0, 0.5, 0); robe.scale.set(1, 1, 0.78); robe.castShadow = true; chest.add(robe);
      limbs.robe = robe;
    }
    let torch = null;
    if (spec.torch) {
      torch = new THREE.SpotLight('#fff2cf', 30, 22, 0.42, 0.5, 1.5);
      torch.position.set(0, 0.0, -0.1); limbs[1].el.add(torch); torch.target.position.set(0, -0.3, -4); limbs[1].el.add(torch.target);
      part(new THREE.CylinderGeometry(0.025, 0.03, 0.2, 8), mat('#222', 0.4), 0, -0.3, -0.06, limbs[1].el).rotation.x = Math.PI / 2;
    }

    let phase = 0, breath = 0, pose = 'stand';
    function update(dt, speed, crouch) {
      breath += dt;
      if (pose === 'sit') {
        for (const side of [-1, 1]) { const L = limbs[side]; L.hip.rotation.x = 1.5; L.kn.rotation.x = -1.5; L.sh.rotation.x = 0.4; L.el.rotation.x = 0.9; }
        hips.position.y = 0.52; chest.rotation.x = 0.05; return;
      }
      const run = Math.min(1, Math.max(0, (speed - 2.2) / 2.8));
      const stride = 1.25 + run * 0.9;                    // metres per full cycle
      phase += (speed / stride) * dt * Math.PI * 2;
      const amt = Math.min(1, speed / 1.4);
      const sw = Math.sin(phase), lift = Math.max(0, -Math.cos(phase));
      for (const side of [-1, 1]) {
        const L = limbs[side], k = side > 0 ? sw : -sw, kl = side > 0 ? lift : Math.max(0, Math.cos(phase));
        L.hip.rotation.x = (k * (0.42 + run * 0.35)) * amt + (crouch ? 0.9 : 0);
        // knees bend backwards (positive x tips the shin back) when the foot lifts, and deeply when crouching
        L.kn.rotation.x = crouch ? -1.4 + k * 0.2 * amt : -(kl * (0.7 + run * 0.6) + 0.05) * amt;
        L.sh.rotation.x = (-k * (0.38 + run * 0.5)) * amt + (torch && side > 0 ? 1.2 : 0);
        L.sh.rotation.z = side * (0.08 + run * 0.08);
        L.el.rotation.x = (0.15 + run * 1.1) * amt + 0.08;
      }
      hips.position.y = 0.95 - (crouch ? 0.38 : 0) + Math.abs(Math.cos(phase)) * 0.035 * amt - run * 0.04;
      chest.rotation.x = -(run * 0.2 + (crouch ? 0.3 : 0));   // lean forward (the figure faces -z)
      chest.rotation.y = sw * 0.08 * amt;
      chest.scale.y = 1 + Math.sin(breath * 1.6) * 0.008 * (1 - amt);
      head.rotation.x = run * 0.12;
      if (limbs.robe) { limbs.robe.rotation.x = -0.04 * amt + (crouch ? 0.5 : 0); limbs.robe.scale.x = 1 + Math.abs(sw) * 0.08 * amt; }
    }
    return { group: g, update, torch, setPose(p) { pose = p; if (p === 'stand') hips.position.y = 0.95; } };
  }

  window.DesertHeatPeople = { makePerson };
}());
