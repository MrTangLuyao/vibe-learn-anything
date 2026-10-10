// End-to-end walk through the example course: every page, then the interactive flows.
// Run with:  npm run e2e   (screenshots → test-output/)
import tour from './e2e-pages.mjs';
import interact from './e2e-interact.mjs';

export default async ctx => {
  await tour(ctx);
  await interact(ctx);
};
