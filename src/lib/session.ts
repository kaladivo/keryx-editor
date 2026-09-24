import type { Company, Keryx } from './keryx-api';
import { loadKeryx } from './keryx';
import { loadRepo, type Head, type RepoRef } from './github';
import type { Secrets, Settings } from './settings';

export interface Session {
  keryx: Keryx;
  company: Company;
  head: Head;
  repo: RepoRef;
  settings: Settings;
}

export async function connect(settings: Settings, secrets: Secrets): Promise<Session> {
  const repo = { repo: settings.repo.trim(), branch: settings.branch.trim(), token: secrets.token.trim() };
  const [keryx, { head, files }] = await Promise.all([
    loadKeryx(),
    loadRepo(repo, [settings.repoDir, settings.anchorDir]),
  ]);
  const company = keryx.load({
    files,
    repoDir: settings.repoDir,
    anchorDir: settings.anchorDir,
    keys: secrets.keys,
  });
  return { keryx, company, head, repo, settings };
}
