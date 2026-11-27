/** Paper sizes for the Print Designer. Sampath keeps the paper inside each design's template. */

/** Common paper sizes (width × height in mm; height 0 = continuous roll). */
export const PAPER_PRESETS: { id: string; label: string; width_mm: number; height_mm: number }[] = [
  { id: 'a4_portrait', label: 'A4 portrait (210 × 297)', width_mm: 210, height_mm: 297 },
  { id: 'a4_landscape', label: 'A4 landscape (297 × 210)', width_mm: 297, height_mm: 210 },
  { id: 'a5_portrait', label: 'A5 portrait (148 × 210)', width_mm: 148, height_mm: 210 },
  { id: 'a5_landscape', label: 'A5 landscape (210 × 148)', width_mm: 210, height_mm: 148 },
  { id: 'half_a4', label: 'Half A4 (210 × 148.5)', width_mm: 210, height_mm: 148.5 },
  { id: 'letter', label: 'Letter (216 × 279)', width_mm: 215.9, height_mm: 279.4 },
  { id: 'continuous_245x140', label: 'Continuous form 24.5 × 14 cm (245 × 140)', width_mm: 245, height_mm: 140 },
  { id: 'continuous_241x140', label: 'Continuous form 9.5 × 5.5 in (241 × 140)', width_mm: 241.3, height_mm: 139.7 },
  { id: 'roll_80', label: 'Receipt roll 80 mm (continuous)', width_mm: 80, height_mm: 0 },
]

export function presetFor(size: { width_mm: number; height_mm: number }): string {
  return (
    PAPER_PRESETS.find((p) => Math.abs(p.width_mm - size.width_mm) < 0.05 && Math.abs(p.height_mm - size.height_mm) < 0.05)?.id ??
    'custom'
  )
}

/** Starting paper for a new design (matches today's standard layouts). */
export interface PrintSize {
  width_mm: number
  height_mm: number
  margin_x_mm: number
  margin_y_mm: number
}

export const A5: PrintSize = { width_mm: 148, height_mm: 210, margin_x_mm: 10, margin_y_mm: 10 }
export const A4: PrintSize = { width_mm: 210, height_mm: 297, margin_x_mm: 12, margin_y_mm: 12 }
