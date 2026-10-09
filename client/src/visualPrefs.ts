import { create } from 'zustand';
const key = 'cubefarm:quality';
function initialQuality(): 'low' | 'high' {
  try { return new URLSearchParams(location.search).get('quality') === 'low' || localStorage.getItem(key) === 'low' ? 'low' : 'high'; }
  catch { return 'high'; }
}
export const useVisualPrefs = create<{ quality: 'low' | 'high'; setQuality(value: 'low' | 'high'): void }>((set) => ({
  quality: initialQuality(),
  setQuality(quality) { try { localStorage.setItem(key, quality); } catch { /* Private browsing. */ } set({ quality }); },
}));
export const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
