// Colour maths for the theme engine. Surfaces are derived in OKLab so lighter
// and darker steps keep their hue, and contrast is measured with the WCAG
// relative-luminance formula so derived text always stays readable.

export interface Rgb { r: number; g: number; b: number }
interface Oklab { L: number; a: number; b: number }

export function hexToRgb(hex: string): Rgb {
  const value = Number.parseInt(hex.slice(1), 16);
  return { r: (value >> 16) & 255, g: (value >> 8) & 255, b: value & 255 };
}

export function rgbToHex({ r, g, b }: Rgb) {
  return `#${[r, g, b].map(channel => Math.round(channel).toString(16).padStart(2, "0")).join("")}`;
}

function toLinear(channel: number) {
  const value = channel / 255;
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

function fromLinear(value: number) {
  const clamped = Math.min(1, Math.max(0, value));
  return 255 * (clamped <= 0.0031308 ? clamped * 12.92 : 1.055 * clamped ** (1 / 2.4) - 0.055);
}

function rgbToOklab({ r, g, b }: Rgb): Oklab {
  const lr = toLinear(r);
  const lg = toLinear(g);
  const lb = toLinear(b);
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);

  return {
    L: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    a: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    b: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  };
}

function oklabToRgb({ L, a, b }: Oklab): Rgb {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;

  return {
    r: fromLinear(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    g: fromLinear(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    b: fromLinear(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  };
}

export function lightness(hex: string) {
  return rgbToOklab(hexToRgb(hex)).L;
}

/** Shift perceptual lightness by `delta`, keeping hue and chroma. */
export function shiftLightness(hex: string, delta: number) {
  const lab = rgbToOklab(hexToRgb(hex));
  return rgbToHex(oklabToRgb({ ...lab, L: Math.min(1, Math.max(0, lab.L + delta)) }));
}

/** Mix `from` towards `to` by `amount` (0 to 1) in OKLab. */
export function mix(from: string, to: string, amount: number) {
  const a = rgbToOklab(hexToRgb(from));
  const b = rgbToOklab(hexToRgb(to));

  return rgbToHex(oklabToRgb({
    L: a.L + (b.L - a.L) * amount,
    a: a.a + (b.a - a.a) * amount,
    b: a.b + (b.b - a.b) * amount,
  }));
}

function relativeLuminance(hex: string) {
  const { r, g, b } = hexToRgb(hex);
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

export function contrastRatio(a: string, b: string) {
  const [light, dark] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (light! + 0.05) / (dark! + 0.05);
}

/**
 * Move `foreground` away from the backgrounds until it reaches `minimum`
 * contrast against every one of them, or runs out of room.
 */
export function ensureContrast(foreground: string, backgrounds: string[], minimum: number) {
  const direction = lightness(backgrounds[0]!) < 0.5 ? 1 : -1;
  const lab = rgbToOklab(hexToRgb(foreground));
  let color = foreground;

  // Step from the original lightness each time: re-reading the rounded hex can
  // snap a near-black or near-white colour back to where it started.
  for (let step = 1; step <= 50; step++) {
    if (backgrounds.every(background => contrastRatio(color, background) >= minimum))
      return color;

    color = rgbToHex(oklabToRgb({ ...lab, L: Math.min(1, Math.max(0, lab.L + direction * 0.02 * step)) }));
  }

  return color;
}

/** "H S% L%" for the app's `hsl(var(--token))` custom properties. */
export function toHslTriplet(hex: string) {
  const { r, g, b } = hexToRgb(hex);
  const [rn, gn, bn] = [r / 255, g / 255, b / 255];
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  const d = max - min;
  let h = 0;
  let s = 0;

  if (d) {
    s = d / (1 - Math.abs(2 * l - 1));

    if (max === rn)
      h = 60 * (((gn - bn) / d) % 6);
    else if (max === gn)
      h = 60 * ((bn - rn) / d + 2);
    else
      h = 60 * ((rn - gn) / d + 4);
  }

  const round = (value: number) => Math.round(value * 10) / 10;
  return `${round((h + 360) % 360)} ${round(s * 100)}% ${round(l * 100)}%`;
}
