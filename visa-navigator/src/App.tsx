import { AnimatePresence, motion } from 'motion/react';
import { lazy, Suspense, useEffect, useState } from 'react';
import { Shell } from '@/components/app/Shell';
import { useVault } from '@/state/VaultContext';
import { Home } from '@/views/Home';
import { Unlock } from '@/views/Unlock';
import { useReminderAlerts } from '@/views/workspace/Notifications';

// Opened less often than Home, so their code is loaded on first use rather than with the first screen.
const NewTrip = lazy(() => import('@/views/NewTrip').then((m) => ({ default: m.NewTrip })));
const Workspace = lazy(() => import('@/views/workspace/Workspace').then((m) => ({ default: m.Workspace })));

type View = { name: 'home' } | { name: 'new'; destination?: string } | { name: 'trip'; id: string };

export function App() {
  const vault = useVault();
  const [view, setView] = useState<View>({ name: 'home' });
  useReminderAlerts(vault.data, vault.status === 'open');

  // Locking closes whatever was open, so unlocking always starts at home.
  useEffect(() => {
    if (vault.status !== 'open') setView({ name: 'home' });
  }, [vault.status]);

  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [view]);

  return (
    <>
      <div className="aurora" aria-hidden="true" />
      {vault.status === 'loading' ? null : vault.status !== 'open' ? (
        <Unlock />
      ) : (
        <Shell onHome={() => setView({ name: 'home' })}>
          <AnimatePresence mode="wait">
            <motion.div
              key={view.name === 'trip' ? `trip-${view.id}` : view.name}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.18 }}
            >
              <Suspense fallback={null}>
                {view.name === 'home' && <Home onNew={(destination) => setView({ name: 'new', destination })} onOpen={(id) => setView({ name: 'trip', id })} />}
                {view.name === 'new' && (
                  <NewTrip initialDestination={view.destination} onCancel={() => setView({ name: 'home' })} onCreated={(id) => setView({ name: 'trip', id })} />
                )}
                {view.name === 'trip' && <Workspace tripId={view.id} onBack={() => setView({ name: 'home' })} />}
              </Suspense>
            </motion.div>
          </AnimatePresence>
        </Shell>
      )}
    </>
  );
}
