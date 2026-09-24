import { useEffect, useState } from 'react';
import { sha256Hex } from '../lib/bytes';
import type { Company } from '../lib/keryx-api';

/** The logo as a displayable URL: a data URL as is, an https URL only when its bytes match the pinned hash. */
function useVerifiedLogo(logo?: string, sha256?: string): string | undefined {
  const [verified, setVerified] = useState<string>();

  useEffect(() => {
    if (!logo?.startsWith('https://') || !sha256) return;
    let objectUrl: string | undefined;
    let cancelled = false;
    (async () => {
      const res = await fetch(logo);
      const blob = await res.blob();
      if (cancelled || (await sha256Hex(await blob.arrayBuffer())) !== sha256.toLowerCase()) return;
      objectUrl = URL.createObjectURL(blob);
      setVerified(objectUrl);
    })().catch(() => undefined);
    return () => {
      cancelled = true;
      setVerified(undefined);
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [logo, sha256]);

  return logo?.startsWith('data:image/') ? logo : verified;
}

interface Props {
  company: Company;
  companyId: string;
  repo: string;
  branch: string;
}

export function CompanyHeader({ company, companyId, repo, branch }: Props) {
  const logo = useVerifiedLogo(company.logo, company.logoSHA256);

  return (
    <div className="company">
      {logo ? (
        <img className="logo" src={logo} alt="" />
      ) : (
        <div className="logo logo-placeholder" aria-hidden="true">
          {company.name.slice(0, 1).toUpperCase()}
        </div>
      )}
      <div className="company-text">
        <h1>{company.name}</h1>
        <p className="muted">
          {companyId} ·{' '}
          <a href={`https://github.com/${repo}/tree/${branch}`} target="_blank" rel="noreferrer">
            {repo}@{branch}
          </a>
        </p>
      </div>
    </div>
  );
}
