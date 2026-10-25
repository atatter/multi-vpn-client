import type { Docker } from '../docker.ts';
import { CONTAINER_LABEL } from './start.ts';

/** Removes containers left behind by a previous run (e.g. after a crash), then their networks. */
export async function removeStaleContainers(docker: Docker): Promise<void> {
  const ids = (
    await docker.run(['ps', '--all', '--quiet', '--filter', `label=${CONTAINER_LABEL}`])
  ).stdout
    .split(/\s+/)
    .filter(Boolean);
  if (ids.length > 0) await docker.run(['rm', '--force', ...ids]);
  await docker.run(['network', 'prune', '--force', '--filter', `label=${CONTAINER_LABEL}`]);
}
