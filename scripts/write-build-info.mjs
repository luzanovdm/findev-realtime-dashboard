import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

function commitSha() {
  const provided = process.env.CF_PAGES_COMMIT_SHA ?? process.env.GITHUB_SHA;
  if (provided) return provided;
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: new URL('../', import.meta.url),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return 'unknown';
  }
}

writeFileSync(
  new URL('../public/build-info.json', import.meta.url),
  `${JSON.stringify({ commit: commitSha() }, null, 2)}\n`,
);
