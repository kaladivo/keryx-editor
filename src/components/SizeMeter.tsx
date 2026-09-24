import { formatBytes } from '../lib/bytes';
import { MAX_ITEM_BYTES } from '../lib/itemSize';

const WARN_ITEM_BYTES = 900_000;

export function SizeMeter({ bytes }: { bytes: number }) {
  const level = bytes > MAX_ITEM_BYTES ? 'over' : bytes > WARN_ITEM_BYTES ? 'warn' : 'ok';
  return (
    <div className={`size-meter size-${level}`}>
      <div className="size-label">
        <span>Signed item size</span>
        <span>
          {formatBytes(bytes)} of {formatBytes(MAX_ITEM_BYTES)}
        </span>
      </div>
      <div
        className="size-bar"
        role="meter"
        aria-label="Item size"
        aria-valuemin={0}
        aria-valuemax={MAX_ITEM_BYTES}
        aria-valuenow={bytes}
        aria-valuetext={formatBytes(bytes)}
      >
        <div style={{ width: `${Math.min(100, (bytes / MAX_ITEM_BYTES) * 100)}%` }} />
      </div>
    </div>
  );
}
