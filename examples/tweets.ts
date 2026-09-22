import JTracker, { type Region } from '../JTracker.ts';

const token = process.env.JTRACKER_TOKEN;
if (!token) throw new Error('Set JTRACKER_TOKEN to your site account token before running this example.');
const tracker = new JTracker((process.argv[2] ?? 'FRA').toUpperCase() as Region, {
  token, socketOptions: { autoConnect: false }, feed: { maxTweets: 500 },
});

tracker.on('initialTweets', tweets => console.log(`Loaded ${tweets.length} historical tweets`));
tracker.on('tweet', tweet => {
  console.log('NEW TWEET', tweet.id, tweet.author.handle, tweet.text);
  // Put your new-tweet processing here. History and duplicate arrivals do not fire this event.
});
tracker.on('tweet_update', (tweet, { sourceEvent }) => {
  console.log('UPDATED', tweet.id, sourceEvent, tweet.media, tweet.aiSuggestion);
});
tracker.on('tweet_deleted', ({ id, tweet }) => console.log('DELETED', id, tweet.text));
tracker.on('following_update', activity => console.log('FOLLOW', activity.author.handle, activity.target?.handle));
tracker.on('profile_update', activity => console.log('PROFILE', activity.author.handle, activity.changes));
tracker.on('pnl_update', payload => console.log('PNL', payload));
tracker.on('external_message', payload => console.log('EXTERNAL', payload));
tracker.on('auth_error', payload => console.error('AUTH', payload.error));
tracker.on('protocol_error', ({ event, message }) => console.error('PROTOCOL', event, message));
// tracker.on('raw', (event, ...args) => { ... }); // Exact packets, including unknown events.
// tracker.getTweet(id) and tracker.tweets expose the current merged cache.

const stop = () => { void tracker.close().catch(error => { console.error(error); process.exitCode = 1; }); };
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
tracker.socket.connect();
