// Small self-contained WebGL stage for front-end flourishes (garage turntable, podium).

import * as THREE from 'three';

/**
 * A tiny extra WebGL view rendered into its own canvas.
 *
 * IMPORTANT: browsers cap live WebGL contexts (~16) and silently blank the oldest
 * once you exceed it — which would kill the MAIN game canvas. So only ever keep one
 * MiniStage alive: `Screens.clear()` disposes the current stage before any screen
 * builds a new one, and `dispose()` calls `forceContextLoss()` to actually release
 * the GPU context rather than waiting for GC.
 */
export class MiniStage {
  readonly canvas: HTMLCanvasElement;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;
  private raf = 0;
  private elapsed = 0;
  private last = 0;
  private onFrame: ((dt: number, elapsed: number) => void) | null = null;
  private disposed = false;

  constructor(w: number, h: number, envMap: THREE.Texture | null) {
    this.canvas = document.createElement('canvas');
    this.canvas.style.cssText = `width:100%;max-width:${w}px;height:auto;display:block`;
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.renderer.setSize(w, h, false);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    // showroom stages sit on dark panels, so lift exposure — ACES otherwise crushes
    // these small scenes into near-silhouette
    this.renderer.toneMappingExposure = 1.25;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.camera = new THREE.PerspectiveCamera(30, w / h, 0.1, 200);
    this.camera.position.set(0, 2.6, 7.2);
    this.camera.lookAt(0, 0.5, 0);

    if (envMap) this.scene.environment = envMap;
    this.scene.add(new THREE.AmbientLight(0xcfe0ff, 0.95));
    const key = new THREE.DirectionalLight(0xfff2dc, 3.0);
    key.position.set(4, 6, 5);
    this.scene.add(key);
    const fill = new THREE.DirectionalLight(0xbcd4ff, 0.9); // soften the shadow side
    fill.position.set(-3, 2, 4);
    this.scene.add(fill);
    const rim = new THREE.DirectionalLight(0x2de2e6, 2.0); // cyan house accent
    rim.position.set(-5, 3, -4);
    this.scene.add(rim);
  }

  /** Begin the render loop. `onFrame` drives the animation (spin, camera moves). */
  start(onFrame: (dt: number, elapsed: number) => void): void {
    this.onFrame = onFrame;
    this.last = performance.now();
    const loop = () => {
      if (this.disposed) return;
      this.raf = requestAnimationFrame(loop);
      const now = performance.now();
      this.step(Math.min((now - this.last) / 1000, 0.05));
      this.last = now;
    };
    this.raf = requestAnimationFrame(loop);
    this.step(0); // paint one frame immediately (rAF may be throttled/hidden)
  }

  /** One frame. Exposed separately so headless tests can drive it without rAF. */
  step(dt: number): void {
    if (this.disposed) return;
    this.elapsed += dt;
    this.onFrame?.(dt, this.elapsed);
    this.renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
      const mat = m.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
      else if (mat) mat.dispose();
    });
    this.renderer.dispose();
    this.renderer.forceContextLoss(); // actually free the context, don't wait for GC
  }
}
