import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JTrackerFeed, SITE_EVENTS, FORWARDED_EVENTS } from '../src/jtracker-feed.ts';
import { postKey } from '../src/jtracker-model.ts';

const tweet = (id, fields = {}) => ({ id, text: `Tweet ${id}`, author: { handle: 'alice', name: 'Alice' }, ...fields });

test('historical tweets are separate from live arrivals and reconnects do not replay new-tweet actions', () => {
  const feed = new JTrackerFeed(), arrivals = [], snapshots = [], changes = [];
  feed.on('tweet', item => arrivals.push(item.id));
  feed.on('initialTweets', items => snapshots.push(items));
  feed.on('feed', event => changes.push(event));
  feed.handle('initialTweets', [tweet('2'), tweet('1')]);
  assert.deepEqual(arrivals, []); assert.deepEqual(changes, []);
  feed.handle('tweet', tweet('3', { metrics: { likes: 10 } }));
  feed.handle('tweet', tweet('3'));
  feed.handle('initialTweets', [tweet('3', { metrics: { likes: 1 } }), tweet('2'), tweet('0')]);
  assert.deepEqual(arrivals, ['3']); assert.equal(snapshots.length, 2);
  assert.equal(feed.getTweet('3').metrics.likes, 10);
  assert.deepEqual(feed.tweets.map(item => item.id), ['3', '2', '1', '0']);
  feed.handle('tweet', tweet('0')); assert.deepEqual(arrivals, ['3']);
});

test('partial and subtweet updates preserve rich text/media and unknown fields without mutating packets', () => {
  const feed = new JTrackerFeed(), updates = [], nested = [];
  const packet = tweet('20', {
    text: '@bob Detailed tweet https://t.co/abc', providerData: { extra: 5 },
    media: { images: ['a', 'b'], videos: [{ url: 'video', thumbnail: 'preview' }] },
    quotedTweet: { id: '10', text: 'Long original quoted content', media: { images: ['quote'] } },
  });
  const original = structuredClone(packet);
  feed.handle('tweet', packet);
  feed.on('tweet_update', (item, context) => updates.push(context.sourceEvent));
  feed.on('tweet.subtweet.update', item => nested.push(item));
  feed.handle('tweet_update', { id: '20', text: 'Detailed tweet', author: { avatar: 'avatar' }, media: { images: [], videos: [{ url: 'hd-video' }] } });
  feed.handle('tweet.subtweet.update', { id: '20', quotedTweet: { id: '10', text: 'Short', media: { videos: [{ url: 'quote-video' }] } } });
  const item = feed.getTweet('20');
  assert.equal(item.text, packet.text); assert.equal(item.displayText, '@bob Detailed tweet');
  assert.equal(item.author.handle, 'alice'); assert.equal(item.author.avatar, 'avatar');
  assert.deepEqual(item.media.images, ['a', 'b']);
  assert.equal(item.media.videos[0].thumbnail, 'preview'); assert.equal(item.media.videos[0].url, 'hd-video');
  assert.equal(item.quotedTweet.text, 'Long original quoted content');
  assert.deepEqual(item.quotedTweet.media.images, ['quote']); assert.equal(item.providerData.extra, 5);
  assert.deepEqual(updates, ['tweet_update', 'tweet.subtweet.update']); assert.equal(nested.length, 1);
  assert.deepEqual(packet, original);
});

test('AI, results, token metadata and subtweet packets can precede the new tweet', () => {
  const feed = new JTrackerFeed({ maxAiResults: 2 }), arrivals = [];
  feed.on('tweet', item => arrivals.push(item));
  feed.handle('ai_suggestion', { tweet_id: '4', prediction: 'example', ticker: 'TEST', confidence: 0.5 });
  feed.handle('ai_suggestion_update', { tweet_id: '4', results: [{ id: 'a' }, { id: 'b' }] });
  feed.handle('token_meta', { id: '4', tokenMeta: { mint: 'mint-a', symbol: 'TEST' } });
  assert.equal(feed.getTweet('4'), undefined);
  feed.handle('tweet.subtweet.update', { id: '4', quotedTweet: { id: '1', text: 'Quote' } });
  feed.handle('tweet', tweet('4'));
  assert.equal(arrivals.length, 1); assert.equal(arrivals[0].aiSuggestion.ticker, 'TEST');
  assert.equal(arrivals[0].tokenMeta['mint-a'].symbol, 'TEST');
  assert.equal(arrivals[0].quotedTweet.text, 'Quote');
  feed.handle('ai_suggestion_update', { tweet_id: '4', results: [{ id: 'b' }, { id: 'c' }] });
  assert.deepEqual(feed.getTweet('4').aiSuggestionResults, [{ id: 'b' }, { id: 'c' }]);
  feed.handle('token_meta', { id: '4', tokenMeta: { mint: 'mint-b', name: 'Second token' } });
  assert.deepEqual(Object.keys(feed.getTweet('4').tokenMeta), ['mint-a', 'mint-b']);
});

test('external URLs correlate enrichment while case-sensitive IDs stay distinct', () => {
  const feed = new JTrackerFeed();
  feed.handle('ai_suggestion', { tweet_url: 'https://youtu.be/AbCdEf12345?t=10', prediction: 'example', ticker: 'VIDEO' });
  feed.handle('external_message', tweet('youtube-post', { isYouTube: true, youtubeUrl: 'https://www.youtube.com/watch?v=AbCdEf12345&feature=share' }));
  assert.equal(feed.getTweet('youtube-post').aiSuggestion.ticker, 'VIDEO');
  assert.notEqual(postKey('https://youtu.be/AbCdEf12345'), postKey('https://youtu.be/abcdef12345'));
  assert.equal(postKey('https://twitter.com/alice/status/123?x=1'), postKey('https://x.com/alice/status/123'));
  feed.handle('external_message', { type: 'YOUTUBE_IMAGE_UPDATE', id: 'youtube-post', imageUrl: 'new-image' });
  feed.handle('external_message', { type: 'CARD_UPDATE', id: 'youtube-post', card: { title: 'A card' } });
  feed.handle('external_message', { type: 'YOUTUBE_DELETION', id: 'youtube-post' });
  assert.deepEqual(feed.getTweet('youtube-post').media.images, ['new-image']);
  assert.equal(feed.getTweet('youtube-post').card.title, 'A card'); assert.equal(feed.getTweet('youtube-post').youtubeDeleted, true);
});

test('ambiguous external updates stay observable without changing another post', () => {
  const feed = new JTrackerFeed(), problems = [], external = [];
  feed.on('protocol_error', problem => problems.push(problem)); feed.on('external_message', packet => external.push(packet));
  feed.handle('external_message', tweet('ig', { isInstagram: true }));
  feed.handle('external_message', { type: 'INSTAGRAM_VIDEO_UPDATE', videoUrl: 'ambiguous' });
  assert.deepEqual(feed.getTweet('ig').media.videos, []); assert.equal(problems.length, 1); assert.equal(external.length, 2);
  feed.handle('external_message', { type: 'TIKTOK_VIDEO_UPDATE', id: 'tt', videoUrl: 'ready-first' });
  feed.handle('external_message', tweet('tt', { isTikTok: true }));
  assert.equal(feed.getTweet('tt').media.videos[0].url, 'ready-first');
});

test('deletions retain original content, accept cached/raw snapshots, and survive later updates', () => {
  const feed = new JTrackerFeed(), deleted = [], arrivals = [];
  feed.on('tweet_deleted', payload => deleted.push(payload)); feed.on('tweet', item => arrivals.push(item.id));
  feed.handle('tweet', tweet('5', { text: 'Original content' }));
  feed.handle('tweet_deleted', { id: '5' }); feed.handle('tweet_deleted', { id: '5' });
  assert.equal(deleted.length, 1); assert.equal(deleted[0].tweet.text, 'Original content');
  feed.handle('tweet_update', { id: '5', isDeleted: false, media: { images: ['late-image'] } });
  assert.equal(feed.getTweet('5').isDeleted, true);
  feed.handle('tweet_deleted', { id: '6', deletedTweet: { type: 'QUOTE', author: { handle: 'bob', profile: { name: 'Bob' } }, body: { text: 'Deleted snapshot' } } });
  assert.equal(feed.getTweet('6').text, 'Deleted snapshot'); assert.equal(feed.getTweet('6').author.name, 'Bob');
  assert.equal(feed.getTweet('6').isQuote, true);
  feed.handle('tweet', tweet('6')); assert.deepEqual(arrivals, ['5']);
});

test('follow/profile activities retain payloads and correlate scans in either order', () => {
  const feed = new JTrackerFeed(), activities = [];
  feed.on('activity', activity => activities.push(activity));
  feed.handle('follow_scan', { id: 'follow-1', scan: { tokens: ['a'] } });
  const follow = { id: 'follow-1', user: { handle: 'alice' }, following: { handle: 'bob', profile: { name: 'Bob' } } };
  feed.handle('following_update', follow); feed.handle('following_update', follow);
  assert.equal(activities.length, 1); assert.equal(activities[0].target.name, 'Bob');
  assert.deepEqual(activities[0].followScan, { tokens: ['a'] });
  feed.handle('follow_scan', { id: 'follow-1', scan: { tokens: ['a', 'b'] } });
  assert.equal(feed.getActivity('follow-1').followScan.tokens.length, 2);
  feed.handle('profile_update', { user: { handle: 'alice', profile: { name: 'New', description: { text: 'new bio' } } }, before: { profile: { name: 'Old', description: { text: 'old bio' } } }, privated: true });
  assert.deepEqual(activities[1].changes, ['name', 'bio']); assert.equal(activities[1].raw.privated, true);
  feed.handle('profile_pinned_update', { user: { handle: 'alice' }, pinned: [tweet('pin')] });
  assert.equal(activities[2].raw.pinned[0].id, 'pin');
});

test('alerts, account state, PnL and all other known features are exposed', () => {
  const feed = new JTrackerFeed(), observed = new Set();
  for (const name of FORWARDED_EVENTS) feed.on(name, () => observed.add(name));
  for (const name of FORWARDED_EVENTS) feed.handle(name, { feature: name });
  assert.equal(observed.size, FORWARDED_EVENTS.length);
  feed.handle('admin_alert', { id: 'a', message: 'Maintenance' });
  feed.handle('admin_alert_clear', { id: 'other' }); assert.equal(feed.adminAlert.id, 'a');
  feed.handle('admin_alert_clear', { id: 'a' }); assert.equal(feed.adminAlert, null);
  feed.handle('connected_users', ['one']); feed.handle('hidden_accounts_updated', { hidden: ['alice'] });
  feed.handle('custom_accounts_list', { accounts: ['bob'] }); feed.handle('pnl_update', { example: 7 });
  assert.deepEqual(feed.connectedUsers, ['one']); assert.deepEqual(feed.hiddenAccounts, ['alice']);
  assert.deepEqual(feed.customAccounts.accounts, ['bob']); assert.deepEqual(feed.latestPnl, { example: 7 });
});

test('malformed packets and unknown events remain observable without breaking subsequent tweets', () => {
  const feed = new JTrackerFeed(), problems = [], raw = [];
  feed.on('protocol_error', value => problems.push(value)); feed.on('raw', (...args) => raw.push(args));
  feed.handle('tweet', null); feed.handle('tweet', { id: Number.MAX_SAFE_INTEGER + 1 });
  feed.handle('initialTweets', [null, tweet('valid')]); feed.handle('connected_users', {});
  feed.handle('future_feature', { data: 1 }, 'extra-argument'); feed.handle('tweet', tweet('next'));
  assert.equal(problems.length, 4); assert.equal(feed.getTweet('next').id, 'next');
  assert.deepEqual(raw[4], ['future_feature', { data: 1 }, 'extra-argument']);
});

test('cache sizes, pending packets, dedup and retention are bounded', async () => {
  assert.throws(() => new JTrackerFeed({ maxTweets: 0 }), /positive/);
  const feed = new JTrackerFeed({ maxTweets: 2, maxActivities: 1, maxPending: 1, maxSeen: 3, retentionMs: 15 });
  for (const id of ['1', '2', '3']) feed.handle('tweet', tweet(id));
  assert.deepEqual(feed.tweets.map(item => item.id), ['3', '2']);
  for (const id of ['first', 'second']) feed.handle('token_meta', { id, tokenMeta: { mint: id, name: id } });
  feed.handle('tweet', tweet('first')); assert.equal(feed.getTweet('first').tokenMeta, undefined);
  await new Promise(resolve => setTimeout(resolve, 25));
  feed.handle('tweet', tweet('second')); assert.equal(feed.getTweet('second').tokenMeta, undefined);
  feed.handle('profile_update', { id: 'p1', user: { handle: 'a' } });
  feed.handle('profile_update', { id: 'p2', user: { handle: 'a' } });
  assert.equal(feed.activities.length, 1); feed.clearFeed(); assert.equal(feed.tweets.length, 0);
});

test('event inventory covers every application handler in the supplied bundle', async () => {
  // Read as text only. The 13 MB site bundle is never evaluated or imported.
  const source = await readFile(new URL('../source.js', import.meta.url), 'utf8');
  const names = new Set([...source.matchAll(/Sz\.on\("([^"]+)"/g)].map(match => match[1]));
  for (const lifecycle of ['connect', 'disconnect', 'connect_error']) names.delete(lifecycle);
  assert.deepEqual([...SITE_EVENTS].sort(), [...names].sort());
});
