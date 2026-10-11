// Self-check for the headline parser. Run: npx tsx news.check.ts   (add "live" to also hit the feeds)
import assert from 'node:assert/strict';
import { parseFeed, pickTop, getHeadlines } from './news';

const rss = `<rss><channel><title>Feed</title>
<item><title><![CDATA[Leaders meet &amp; agree on "ceasefire"]]></title><link>https://x.test/a</link><pubDate>Mon, 28 Sep 2026 18:10:02 -0400</pubDate></item>
<item><title>No date here</title><link>https://x.test/b</link></item>
<item><title>Leaders meet &amp; agree on &quot;ceasefire&quot;</title><link>https://x.test/dup</link><pubDate>Mon, 28 Sep 2026 09:00:00 GMT</pubDate></item>
</channel></rss>`;
const rdf = `<rdf:RDF><item rdf:about="https://dw.test/1"><title>Older story</title><link>https://dw.test/1</link><dc:date>2026-09-27T10:00:00Z</dc:date></item></rdf:RDF>`;

const a = parseFeed(rss, 'BBC', 'BBC News');
assert.equal(a.length, 2, 'undated items are skipped');
assert.equal(a[0].title, 'Leaders meet & agree on "ceasefire"', 'CDATA + entities decoded');
assert.equal(a[0].publishedAt, '2026-09-28T22:10:02.000Z', 'pubDate with offset -> UTC');
const b = parseFeed(rdf, 'DW', 'Deutsche Welle');
assert.equal(b[0].publishedAt, '2026-09-27T10:00:00.000Z', 'RDF dc:date supported');

const top = pickTop([...b, ...a]);
assert.equal(top.length, 2, 'duplicate titles removed');
assert.equal(top[0].url, 'https://x.test/a', 'newest first');
const mixed = pickTop([
  { title: 'A1', source: 'A', sourceName: 'A', url: '', publishedAt: '2026-09-28T10:00:00Z' },
  { title: 'A2', source: 'A', sourceName: 'A', url: '', publishedAt: '2026-09-28T09:00:00Z' },
  { title: 'B1', source: 'B', sourceName: 'B', url: '', publishedAt: '2026-09-28T08:00:00Z' },
]);
assert.deepEqual(mixed.map((h) => h.title), ['A1', 'B1', 'A2'], 'outlets interleaved');

if (process.argv[2] === 'live') {
  const r = await getHeadlines(true);
  console.log(r.mode, r.items.length, r.items.slice(0, 3).map((h) => `${h.source}: ${h.title}`));
  assert.ok(r.items.length >= 5, 'live feed returns headlines');
}
console.log('news: all checks passed');
