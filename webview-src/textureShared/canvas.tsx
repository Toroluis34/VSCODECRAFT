// Helpers shared by the texture webviews (editor, material variant, atlas overview).
import { useEffect, useRef } from 'preact/hooks';
import type { JSX } from 'preact';
import type { RgbaImage } from '../../src/features/textures/pixels';

/** Put RGBA pixels on a new (unscaled) canvas. */
export function imageToCanvas(img: RgbaImage): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.max(1, img.width);
  c.height = Math.max(1, img.height);
  if (img.width && img.height) {
    const data = new ImageData(new Uint8ClampedArray(img.data.buffer as ArrayBuffer, img.data.byteOffset, img.width * img.height * 4), img.width, img.height);
    c.getContext('2d')!.putImageData(data, 0, 0);
  }
  return c;
}

export function imageToDataUrl(img: RgbaImage): string {
  return imageToCanvas(img).toDataURL('image/png');
}

/** Inject a stylesheet once (bundles ship their CSS as strings). */
export function useStyle(id: string, css: string): void {
  if (typeof document !== 'undefined' && !document.getElementById(id)) {
    const s = document.createElement('style');
    s.id = id;
    s.textContent = css;
    document.head.appendChild(s);
  }
}

/** Pixel-perfect image thumbnail drawn on a canvas (nearest-neighbour scaling, checkerboard behind). */
export function PixelImage(p: { img: RgbaImage | undefined; size: number; class?: string; title?: string; onClick?: (e: MouseEvent) => void }): JSX.Element {
  const ref = useRef<HTMLCanvasElement>(null);
  const img = p.img;
  const scale = img ? Math.max(1, Math.floor(p.size / Math.max(img.width, img.height))) || 1 : 1;
  const w = img ? Math.min(p.size, img.width * scale) || p.size : p.size;
  const h = img ? Math.min(p.size, img.height * scale) || p.size : p.size;
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const g = c.getContext('2d')!;
    g.clearRect(0, 0, c.width, c.height);
    if (!img) return;
    g.imageSmoothingEnabled = false;
    g.drawImage(imageToCanvas(img), 0, 0, c.width, c.height);
  }, [img, w, h]);
  return <canvas ref={ref} class={`tex-checker tex-pixelated ${p.class ?? ''}`} width={w} height={h} style={{ width: `${w}px`, height: `${h}px` }} title={p.title} onClick={p.onClick} />;
}

/** Styles shared by the texture webviews. */
export const SHARED_CSS = `
.tex-pixelated { image-rendering: pixelated; }
.tex-checker {
  --tex-a: #3a3a3a; --tex-b: #2c2c2c;
  background: repeating-conic-gradient(var(--tex-a) 0 25%, var(--tex-b) 0 50%) 0 0 / 12px 12px;
}
body.vscode-light .tex-checker { --tex-a: #ffffff; --tex-b: #d8d8d8; }
body.vscode-high-contrast-light .tex-checker { --tex-a: #ffffff; --tex-b: #d8d8d8; }
.tex-chip {
  display: inline-flex; align-items: center; gap: 4px; padding: 2px 8px; border-radius: 10px; cursor: pointer;
  border: 1px solid var(--vscode-widget-border, rgba(128,128,128,.4)); background: transparent; color: inherit; font: inherit; font-size: 12px;
}
.tex-chip:hover { background: var(--vscode-list-hoverBackground); }
.tex-chip.active { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border-color: transparent; }
.tex-section-title { font-size: 11px; text-transform: uppercase; letter-spacing: .04em; color: var(--vscode-descriptionForeground); margin: 0 0 6px; font-weight: 600; }
.tex-slider { display: grid; grid-template-columns: 92px 1fr 46px; align-items: center; gap: 8px; font-size: 12px; }
.tex-slider input[type=range] { width: 100%; accent-color: var(--vscode-focusBorder); }
.tex-slider output { text-align: right; font-variant-numeric: tabular-nums; color: var(--vscode-descriptionForeground); }
.tex-banner { display: flex; gap: 8px; align-items: center; padding: 6px 10px; border-radius: 3px; font-size: 12px;
  background: var(--vscode-inputValidation-warningBackground, rgba(204,167,0,.15)); border: 1px solid var(--vscode-inputValidation-warningBorder, rgba(204,167,0,.6)); }
`;
