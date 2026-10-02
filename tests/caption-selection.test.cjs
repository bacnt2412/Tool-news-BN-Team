const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { getCaptionCandidates: select } = require('../utils/captionSelection');
const caption = (source, translation) => [{ ext: 'vtt', url: `https://www.youtube.com/api/timedtext?lang=${source}${translation ? `&tlang=${translation}` : ''}` }];
const languages = metadata => Array.from(select(metadata), item => item.language);

// HIWz3bN5Qgk: audio metadata says Thai, all translations originate from Japanese.
assert.deepEqual(languages({ language: 'th', automatic_captions: {
    en: caption('ja', 'en'), 'ja-orig': caption('ja'), ja: caption('ja'), th: caption('ja', 'th')
} }), ['ja-orig', 'ja']);
assert.deepEqual(languages({ language: 'en', automatic_captions: {
    en: caption('ja', 'en'), 'ja-orig': caption('ja'), ja: caption('ja')
}, subtitles: { en: caption('en') } }), ['ja-orig', 'ja']);
assert.deepEqual(languages({ language: 'en', automatic_captions: {
    'en-orig': caption('en'), en: caption('en'), ja: caption('en', 'ja')
} }), ['en-orig', 'en']);
assert.deepEqual(languages({ language: 'th', automatic_captions: { th: caption('ja', 'th') } }), []);
assert.deepEqual(languages({ language: 'ja', automatic_captions: {
    'ja-orig': caption('ja'), ja: caption('en', 'ja')
} }), ['ja-orig']);
assert.deepEqual(languages({ language: 'fr', subtitles: { fr: caption('fr') } }), ['fr']);
assert.deepEqual(languages({ language: 'en', automatic_captions: { de: caption('de') } }), ['de']);
console.log('Passed 7 caption selection regressions');
