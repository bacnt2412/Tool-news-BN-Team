const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { getCaptionCandidates: select, describeDubOnlyCaptions: describeDubOnly } = require('../utils/captionSelection');
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

// 95nq5nY1W_I: original audio zh-Hant (no ASR), plus an AI English dub. YouTube's
// only untranslated ASR (en-orig/en) transcribes the dub -> must not be returned.
const audio = (language, original) => ({ format_id: `140-${language}`, acodec: 'mp4a.40.2', vcodec: 'none', language,
    format_note: `${language}${original ? ' original (default)' : ''}, medium` });
const dubOnly = { language: 'zh-Hant', formats: [audio('en-US', false), audio('zh-Hant', true)],
    automatic_captions: { 'en-orig': caption('en'), en: caption('en'), ja: caption('en', 'ja'), 'zh-Hant': caption('en', 'zh-Hant') } };
assert.deepEqual(languages(dubOnly), []);
assert.deepEqual(describeDubOnly(dubOnly), { originalLanguages: ['zh-Hant'], dubCaptionLanguages: ['en-orig', 'en'] });
// Uploaded subtitles in the dub language are not the original speech either.
assert.deepEqual(languages({ ...dubOnly, subtitles: { 'en-US': caption('en-US') } }), []);
// Original ja audio + English dub: ja ASR is kept, dub ASR ignored.
assert.deepEqual(languages({ language: 'ja', formats: [audio('en-US', false), audio('ja', true)],
    automatic_captions: { 'ja-orig': caption('ja'), ja: caption('ja'), 'en-orig': caption('en') } }), ['ja-orig', 'ja']);
// Real 95nq5nY1W_I order: dub ASR en-orig is listed BEFORE the genuine ja-orig
// (channel mislabels audio as zh-Hant). The first "-orig" must not win.
assert.deepEqual(languages({ ...dubOnly, automatic_captions: { 'en-orig': caption('en'), en: caption('en'),
    ja: caption('en', 'ja'), 'ja-orig': caption('ja') } }), ['ja-orig']);
// Single-audio videos (no "original" marker) behave exactly as before.
assert.deepEqual(languages({ formats: [audio('en', false)], automatic_captions: { 'en-orig': caption('en'), en: caption('en') } }), ['en-orig', 'en']);
assert.equal(describeDubOnly({ formats: [audio('en', false)], automatic_captions: { 'en-orig': caption('en') } }), null);
console.log('Passed 14 caption selection regressions');
