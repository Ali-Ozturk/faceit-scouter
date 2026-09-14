import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeFeed } from './merge-firefox-feed.mjs';
const feed = version => ({ addons: { scout: { updates: [{ version, update_link: 'https://example.com/' + version }] } } });
test('does not downgrade the update feed on an older workflow rerun', () => assert.deepEqual(mergeFeed(feed('0.10.0'), feed('0.9.9')), feed('0.10.0')));
test('publishes a newer version', () => assert.deepEqual(mergeFeed(feed('0.9.9'), feed('0.10.0')), feed('0.10.0')));
test('creates a first update feed', () => assert.deepEqual(mergeFeed(undefined, feed('0.1.0')), feed('0.1.0')));
