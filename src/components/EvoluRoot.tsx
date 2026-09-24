import { Suspense, use, type ReactNode } from 'react';
import { EvoluContext, type AppEvolu } from '../lib/db';
import { useCurrentEvolu } from '../lib/evolu';

function ProvideEvolu({ evolu, children }: { evolu: Promise<AppEvolu>; children: ReactNode }) {
  return <EvoluContext value={use(evolu)}>{children}</EvoluContext>;
}

/** Provides the current owner's Evolu; the children remount when the owner changes (restore, reset). */
export function EvoluRoot({ children }: { children: ReactNode }) {
  const { owner, evolu } = useCurrentEvolu();
  return (
    <Suspense fallback={<p className="page muted">Opening local data…</p>}>
      <ProvideEvolu key={owner.id} evolu={evolu}>
        {children}
      </ProvideEvolu>
    </Suspense>
  );
}
