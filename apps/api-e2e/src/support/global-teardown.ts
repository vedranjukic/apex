import { killPort } from '@nx/node/utils';
/* eslint-disable */

module.exports = async function() {
  // Put clean up logic here (e.g. stopping services, docker-compose, etc.).
  // Hint: `globalThis` is shared between setup and teardown.
  const port = process.env.PORT ? Number(process.env.PORT) : 6000;
  const timeout = new Promise<void>((resolve) => setTimeout(resolve, 5000));
  await Promise.race([killPort(port).catch(() => {}), timeout]);
  console.log(globalThis.__TEARDOWN_MESSAGE__);
};
