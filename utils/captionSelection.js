const uniqueLanguages = languages => [...new Set(languages.filter(Boolean).map(language => String(language)))];
const isUsableCaptionLanguage = language => {
    const value = String(language || '').toLowerCase();
    return value && value !== 'live_chat' && !value.includes('storyboard');
};
const selectVttFormat = formats => Array.isArray(formats)
    ? formats.find(format => format && format.ext === 'vtt' && format.url) || null
    : null;
const getOriginalAudioLanguages = metadata => {
    const audioTrackLanguages = Array.isArray(metadata.audio_tracks)
        ? metadata.audio_tracks
            .filter(track => track && (track.is_original === true || track.audio_is_original === true))
            .map(track => track.language || track.language_code || track.id)
        : [];
    // `default_audio_language`/`is_default` có thể là bản lồng tiếng được chọn theo
    // tài khoản. `metadata.language` mới là ngôn ngữ nội dung mà yt-dlp nhận diện.
    const detectedLanguages = uniqueLanguages([metadata.original_language, metadata.language, ...audioTrackLanguages]);
    return detectedLanguages.length ? detectedLanguages : uniqueLanguages([metadata.default_audio_language]);
};
const findMatchingCaptionLanguage = (languages, originalLanguage) => {
    const normalizedOriginal = String(originalLanguage || '').toLowerCase();
    if (!normalizedOriginal) return null;
    const baseOriginal = normalizedOriginal.split('-')[0];
    return languages.find(language => {
        const value = language.toLowerCase();
        return value === `${normalizedOriginal}-orig` || value === `${baseOriginal}-orig` || value === `${normalizedOriginal}-org` || value === `${baseOriginal}-org`;
    }) || languages.find(language => language.toLowerCase() === normalizedOriginal) || languages.find(language => {
        const value = language.toLowerCase();
        return value.split('-')[0] === baseOriginal && !value.endsWith('-orig') && !value.endsWith('-org');
    }) || null;
};
const pickOriginalCaptionLanguage = (captions, metadata) => {
    const languages = Object.keys(captions || {}).filter(isUsableCaptionLanguage);
    for (const originalLanguage of getOriginalAudioLanguages(metadata)) {
        const matchingLanguage = findMatchingCaptionLanguage(languages, originalLanguage);
        if (matchingLanguage) return matchingLanguage;
    }
    // Chỉ dùng nhãn "orig" sau khi đã đối chiếu ngôn ngữ video. Một video có
    // thể đồng thời trả về en-US-orig (lồng tiếng) và ja-orig (nội dung gốc).
    const explicitlyOriginal = languages.find(language => /-(orig|org)$/i.test(language));
    if (explicitlyOriginal) return explicitlyOriginal;
    // Các video trong module News chủ yếu là tiếng Nhật. metadata của yt-dlp
    // đôi khi không có original_language dù vẫn có track ja hợp lệ.
    const japanese = findMatchingCaptionLanguage(languages, 'ja');
    if (japanese) return japanese;
    // Do not fall back to the first returned track: it can be an auto-translated caption.
    return null;
};
const getUntranslatedCaptions = captions => Object.fromEntries(
    Object.entries(captions || {}).map(([language, formats]) => [language,
        (Array.isArray(formats) ? formats : []).filter(format => {
            try {
                const query = new URL(format.url).searchParams;
                if (query.has('tlang')) return false;
                const source = query.get('lang');
                return !source || source.toLowerCase() === language.replace(/-(orig|org)$/i, '').toLowerCase();
            } catch (error) { return false; }
        })
    ]).filter(([, formats]) => formats.length)
);
const getCaptionCandidates = metadata => {
    const candidates = [];
    const seen = new Set();
    const automatic = getUntranslatedCaptions(metadata.automatic_captions);
    const sourceLanguages = Object.keys(automatic).filter(isUsableCaptionLanguage);
    // Audio metadata can describe a localized dub. A caption URL without tlang
    // identifies the speech track, whereas tlang explicitly requests a translation.
    const sourceLanguage = sourceLanguages.length
        ? pickOriginalCaptionLanguage(automatic, metadata) || (sourceLanguages.length === 1 ? sourceLanguages[0] : null)
        : null;
    const selectionMetadata = sourceLanguage
        ? { original_language: sourceLanguage.replace(/-(orig|org)$/i, '') }
        : metadata;
    // Uploaded subtitles may contain only an outro; prefer speech captions
    // in the original language before falling back to uploaded subtitles.
    for (const captions of [automatic, getUntranslatedCaptions(metadata.subtitles)]) {
        const language = sourceLanguage
            ? findMatchingCaptionLanguage(Object.keys(captions), selectionMetadata.original_language)
            : pickOriginalCaptionLanguage(captions, selectionMetadata);
        const format = selectVttFormat(captions && captions[language]);
        if (!language || !format) continue;
        const key = `${language.toLowerCase()}\u0000${format.url}`;
        if (!seen.has(key)) {
            seen.add(key);
            candidates.push({ language, format });
        }
        // yt-dlp can sometimes resolve the base selector when the -orig URL is empty.
        const baseLanguage = language.replace(/-(orig|org)$/i, '');
        const baseFormat = selectVttFormat(captions[baseLanguage]);
        if (baseLanguage !== language && baseFormat && !candidates.some(item => item.language.toLowerCase() === baseLanguage.toLowerCase())) {
            candidates.push({ language: baseLanguage, format: baseFormat });
        }
    }
    return candidates;
};

module.exports = { getCaptionCandidates };
