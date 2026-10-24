import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';

// Light/dark/system theme. index.html applies the stored choice before React loads, so there is no flash.
export type ThemeChoice = 'light' | 'dark' | 'system';
const KEY = 'vn-theme';

interface ThemeApi {
  theme: ThemeChoice;
  resolved: 'light' | 'dark';
  setTheme: (t: ThemeChoice) => void;
}

const Ctx = createContext<ThemeApi>({ theme: 'system', resolved: 'light', setTheme: () => undefined });

function read(): ThemeChoice {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
}

const systemDark = () => window.matchMedia('(prefers-color-scheme: dark)').matches;

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setChoice] = useState<ThemeChoice>(read);
  const [sysDark, setSysDark] = useState(systemDark);
  const resolved = theme === 'system' ? (sysDark ? 'dark' : 'light') : theme;

  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const on = () => setSysDark(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', resolved === 'dark');
    document.documentElement.style.colorScheme = resolved;
  }, [resolved]);

  const setTheme = useCallback((t: ThemeChoice) => {
    setChoice(t);
    try {
      if (t === 'system') localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, t);
    } catch {
      // Storage blocked: the choice lasts for this session only.
    }
  }, []);

  return <Ctx.Provider value={{ theme, resolved, setTheme }}>{children}</Ctx.Provider>;
}

export const useTheme = () => useContext(Ctx);
