import { lazy, StrictMode, Suspense } from 'react';
import { ThemeProvider } from '@/components/app/theme';
import { createRoot } from 'react-dom/client';
import { MotionConfig } from 'motion/react';
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { VaultProvider } from '@/state/VaultContext';
import { App } from './App';

// One site, three entrances: /apply for customers, /console for the operator, anything else is the personal app.
const ApplyApp = lazy(() => import('@/apply/ApplyApp').then((m) => ({ default: m.ApplyApp })));
const ConsoleApp = lazy(() => import('@/console/ConsoleApp').then((m) => ({ default: m.ConsoleApp })));
const path = location.pathname;
const root = path.startsWith('/apply') ? (
  <Suspense fallback={null}>
    <ApplyApp />
  </Suspense>
) : path.startsWith('/console') ? (
  <Suspense fallback={null}>
    <ConsoleApp />
  </Suspense>
) : (
  <VaultProvider>
    <App />
  </VaultProvider>
);
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MotionConfig reducedMotion="user">
      <ThemeProvider>
        <TooltipProvider>
          {root}
          <Toaster position="bottom-right" richColors />
        </TooltipProvider>
      </ThemeProvider>
    </MotionConfig>
  </StrictMode>,
);
