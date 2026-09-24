import { useEffect, useState } from 'react';
import type { Company } from '../lib/keryx-api';
import { formatDate } from '../lib/content';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const TICK_MS = 30_000;

const WARN_BEFORE: Partial<Record<keyof Company['expires'], number>> = {
  timestamp: DAY,
  snapshot: 7 * DAY,
};

function timeLeft(ms: number): string {
  if (ms <= 0) return 'expired';
  if (ms < HOUR) return `${Math.ceil(ms / 60_000)} min left`;
  if (ms < 2 * DAY) return `${Math.floor(ms / HOUR)} h left`;
  return `${Math.floor(ms / DAY)} days left`;
}

interface Props {
  expires: Company['expires'];
  onRefresh: () => void;
  busy: boolean;
}

export function Expiries({ expires, onRefresh, busy }: Props) {
  const roles = ['timestamp', 'snapshot', 'targets', 'root'] as const;
  const [now, setNow] = useState(Date.now);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(timer);
  }, []);

  return (
    <section className="card" aria-labelledby="expiries-title">
      <div className="card-header">
        <h2 id="expiries-title">Metadata expiry</h2>
        <button type="button" onClick={onRefresh} disabled={busy}>
          Refresh timestamp
        </button>
      </div>
      <dl className="expiries">
        {roles.map((role) => {
          const left = new Date(expires[role]).getTime() - now;
          const warn = left < (WARN_BEFORE[role] ?? 0);
          return (
            <div key={role} className={warn ? 'expiry warn' : 'expiry'}>
              <dt>{role}</dt>
              <dd>
                <span>{formatDate(expires[role])}</span>
                <span className={warn ? 'badge badge-warn' : 'badge'}>{timeLeft(left)}</span>
              </dd>
            </div>
          );
        })}
      </dl>
    </section>
  );
}
