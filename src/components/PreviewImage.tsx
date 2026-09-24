import { useRef, useState } from 'react';
import { dataUrlToBlob, firstDataImage, imageToDataUrl } from '../lib/images';

const MAX_PREVIEW_SIZE = 800;

interface Props {
  image?: string;
  html: string;
  onChange: (image: string | undefined) => void;
}

export function PreviewImage({ image, html, onChange }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string>();
  const firstImage = firstDataImage(html);

  async function use(source: Blob) {
    setError(undefined);
    try {
      onChange(await imageToDataUrl(source, MAX_PREVIEW_SIZE));
    } catch (e) {
      setError(`Could not use this image: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return (
    <div className="field">
      <span className="label">Preview image</span>
      <div className="preview-image">
        {image ? (
          <img src={image} alt="Preview" />
        ) : (
          <div className="preview-empty" aria-hidden="true">
            None
          </div>
        )}
        <div className="preview-image-actions">
          <button type="button" onClick={() => input.current?.click()}>
            Upload…
          </button>
          <button type="button" disabled={!firstImage} onClick={() => firstImage && dataUrlToBlob(firstImage).then(use)}>
            Use first image in post
          </button>
          {image && (
            <button type="button" className="link-button" onClick={() => onChange(undefined)}>
              Remove
            </button>
          )}
        </div>
      </div>
      <input
        ref={input}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void use(file);
          e.target.value = '';
        }}
      />
      {error && <span className="field-error">{error}</span>}
    </div>
  );
}
