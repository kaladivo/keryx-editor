import { useEffect, useState } from 'react';
import { deleteDraft, saveDraft } from './lib/db';

const AUTOSAVE_MS = 1000;

/** A pristine form has nothing worth restoring, so its draft is deleted instead. */
const store = (key: string, json: string, pristine: boolean) => (pristine ? deleteDraft(key) : saveDraft(key, json));

/** Debounced autosave of `json` under `key`; warns before unload while a change is not stored yet. */
export function useDraftAutosave(key: string, json: string, pristine: boolean) {
  const [savedJson, setSavedJson] = useState(json);
  const [failed, setFailed] = useState(false);
  const unsaved = json !== savedJson;

  const flush = () => store(key, json, pristine).then(() => setSavedJson(json), () => setFailed(true));

  useEffect(() => {
    if (!unsaved) return;
    const timer = setTimeout(
      () => store(key, json, pristine).then(() => setSavedJson(json), () => setFailed(true)),
      AUTOSAVE_MS,
    );
    return () => clearTimeout(timer);
  }, [key, json, pristine, unsaved]);

  useEffect(() => {
    if (!unsaved) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    addEventListener('beforeunload', warn);
    return () => removeEventListener('beforeunload', warn);
  }, [unsaved]);

  return { unsaved, failed, flush };
}
