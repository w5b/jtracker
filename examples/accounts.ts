import JTracker, { JTrackerApiError, SOCIAL_TRACKERS, type SocialTracker } from '../JTracker.ts';

// Account management from the terminal, with the same session and native transport as the feed.
//   bun examples/accounts.ts session
//   bun examples/accounts.ts list            | add <handle>        | remove <handle>
//   bun examples/accounts.ts hidden          | hide <handle>       | unhide <handle>
//   bun examples/accounts.ts sources <kind>  | track <kind> <x>    | untrack <kind> <id>
// <kind> is fomo, pump, telegram or subdomain. Node: node --experimental-strip-types examples/accounts.ts ...
const token = process.env.JTRACKER_TOKEN;
if (!token) throw new Error('Set JTRACKER_TOKEN to your site session ID before running this example.');
const [command = 'list', first, second] = process.argv.slice(2);
const tracker = new JTracker('NY', { token, socketOptions: { autoConnect: false } });
const kind = (value: string | undefined): SocialTracker => {
  if ((SOCIAL_TRACKERS as readonly string[]).includes(value ?? '')) return value as SocialTracker;
  throw new Error(`Expected one of: ${SOCIAL_TRACKERS.join(', ')}`);
};
const need = (value: string | undefined, what: string) => { if (!value) throw new Error(`Missing ${what}`); return value; };

try {
  switch (command) {
    case 'session': {
      const session = await tracker.api.checkSession();
      console.log(`Signed in as @${session.username}${session.userId ? ` (id ${session.userId})` : ''}`);
      // The previous token may stop working after a rotation, so print the replacement once.
      if (session.rotated) console.log(`The server issued a new session token:\n  export JTRACKER_TOKEN='${session.token}'`);
      break;
    }
    case 'list': {
      const accounts = await tracker.api.getCustomAccounts();
      console.log(`${accounts.accounts.length}/${accounts.maxAccounts || '?'} custom accounts`);
      for (const handle of accounts.accounts) console.log(`  @${handle}`);
      if (accounts.availableAccounts.length) console.log(`Available: ${accounts.availableAccounts.map(handle => `@${handle}`).join(', ')}`);
      break;
    }
    case 'add': console.log((await tracker.api.addCustomAccount(need(first, 'handle'))).message ?? 'Added'); break;
    case 'remove': console.log(`Result: ${(await tracker.api.removeAccount(need(first, 'handle'))).action ?? 'done'}`); break;
    case 'hidden': for (const handle of await tracker.api.getHiddenAccounts()) console.log(`@${handle}`); break;
    case 'hide': case 'unhide': {
      const { diverted } = await tracker.api.setAccountHidden(need(first, 'handle'), command === 'hide');
      console.log(diverted ? 'The server handled this differently and did not hide it' : 'Saved');
      break;
    }
    case 'sources': console.dir(await tracker.api.listTracked(kind(first)), { depth: 4 }); break;
    case 'track': console.dir(await tracker.api.track(kind(first), need(second, 'target')), { depth: 4 }); break;
    case 'untrack': console.dir(await tracker.api.untrack(kind(first), need(second, 'id')), { depth: 4 }); break;
    default: throw new Error(`Unknown command: ${command}`);
  }
} catch (error) {
  console.error(error instanceof JTrackerApiError ? `${error.code}${error.status ? ` (HTTP ${error.status})` : ''}: ${error.message}`
    : error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  await tracker.close();
}
