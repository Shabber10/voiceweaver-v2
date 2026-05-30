const express = require('express');
const cors = require('cors');
const { MsEdgeTTS, OUTPUT_FORMAT } = require('msedge-tts');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());

// Serve frontend static files
app.use(express.static(path.join(__dirname, '../frontend')));

// --- Language Detection Helpers ---
const SCRIPTS = {
    telugu: /[\u0C00-\u0C7F]/,
    hindi:  /[\u0900-\u097F]/,
};

const VOICE_MAP = {
    telugu:  'te-IN-ShrutiNeural',
    hindi:   'hi-IN-SwaraNeural',
    english: 'en-US-AriaNeural',
};

const PITCH_MAP = {
    // Female pitch variants
    'en-US-AriaNeural': '+0%',
    'en-US-JennyNeural': '+10%',
    'en-US-MichelleNeural': '-10%',
    'en-GB-SoniaNeural': '+20%',
    'en-AU-NatashaNeural': '-20%',
    // Male pitch variants
    'en-US-GuyNeural': '+0%',
    'en-US-ChristopherNeural': '+10%',
    'en-US-EricNeural': '-10%',
    'en-GB-RyanNeural': '+20%',
    'en-AU-WilliamNeural': '-20%'
};

function detectCharLang(ch) {
    if (SCRIPTS.telugu.test(ch)) return 'telugu';
    if (SCRIPTS.hindi.test(ch)) return 'hindi';
    return 'english';
}

function splitByLanguage(text) {
    const segments = [];
    let current = null;
    for (const ch of text) {
        const lang = /[\s.,!?;:()\-"']/.test(ch)
            ? (current ? current.lang : 'english')
            : detectCharLang(ch);
        if (current && current.lang === lang) {
            current.text += ch;
        } else {
            if (current) segments.push(current);
            current = { lang, text: ch };
        }
    }
    if (current) segments.push(current);
    const merged = [];
    for (const seg of segments) {
        if (merged.length > 0 && merged[merged.length - 1].lang === seg.lang) {
            merged[merged.length - 1].text += seg.text;
        } else {
            merged.push({ ...seg });
        }
    }
    return merged.filter(s => s.text.trim().length > 0);
}

// Generate audio + word boundaries for a single segment
function generateSegmentAudioWithTimings(text, voice, options = {}) {
    return new Promise(async (resolve, reject) => {
        try {
            const tts = new MsEdgeTTS();
            await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3, {
                wordBoundaryEnabled: true
            });
            const { audioStream, metadataStream } = tts.toStream(text, options);
            const audioChunks = [];
            const wordBoundaries = [];

            audioStream.on('data', chunk => audioChunks.push(chunk));
            
            if (metadataStream) {
                metadataStream.on('data', chunk => {
                    try {
                        const json = JSON.parse(chunk.toString());
                        if (json && json.Metadata) {
                            json.Metadata.forEach(meta => {
                                if (meta.Type === 'WordBoundary') {
                                    wordBoundaries.push({
                                        text: meta.Data.text.Text,
                                        offset: meta.Data.Offset / 10000, // Convert to ms
                                        duration: meta.Data.Duration / 10000 // Convert to ms
                                    });
                                }
                            });
                        }
                    } catch (e) {
                        // Ignore parsing errors
                    }
                });
            }

            audioStream.on('end', () => {
                resolve({ 
                    buffer: Buffer.concat(audioChunks), 
                    boundaries: wordBoundaries 
                });
            });
            audioStream.on('error', reject);
        } catch (err) {
            reject(err);
        }
    });
}

// Helper to estimate MP3 duration from buffer size for concatenation offset
function estimateMp3Duration(buffer) {
    // 24kHz Mono 96kbit/s = 12000 bytes/sec
    return (buffer.length / 12000) * 1000;
}

// --- TTS Endpoint ---
app.post('/api/tts', async (req, res) => {
    try {
        const { text, voice } = req.body;
        if (!text) return res.status(400).json({ error: 'Text is required' });
        if (text.length > 25000) return res.status(400).json({ error: 'Text exceeds the 25,000 character limit' });
        
        // Map languages based on selected voice/gender because English voices return empty audio for Hindi/Telugu script
        const FEMALE_VOICES = ['en-US-AriaNeural', 'en-US-JennyNeural', 'en-US-MichelleNeural', 'en-GB-SoniaNeural', 'en-AU-NatashaNeural'];
        const isFemale = voice ? FEMALE_VOICES.includes(voice) : true;
        
        const currentVoiceMap = {
            english: voice || VOICE_MAP.english,
            hindi: isFemale ? 'hi-IN-SwaraNeural' : 'hi-IN-MadhurNeural',
            telugu: isFemale ? 'te-IN-ShrutiNeural' : 'te-IN-MohanNeural',
        };

        const segments = splitByLanguage(text);
        
        // Add a silent gap at the beginning to prevent audio clipping on start
        if (segments.length > 0) {
            segments.unshift({ text: ", , , , . ", lang: segments[0].lang });
        }

        const results = await Promise.all(segments.map(seg => {
            const tts = new MsEdgeTTS();
            return new Promise(async (resolve, reject) => {
                await tts.setMetadata(currentVoiceMap[seg.lang], OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3);
                
                // Only apply pitch shifting to Hindi/Telugu to simulate multiple voices
                const pitch = (seg.lang !== 'english' && voice) ? (PITCH_MAP[voice] || '+0%') : '+0%';
                
                const { audioStream } = tts.toStream(seg.text, { pitch });
                const chunks = [];
                audioStream.on('data', chunk => chunks.push(chunk));
                audioStream.on('end', () => resolve(Buffer.concat(chunks)));
                audioStream.on('error', reject);
            });
        }));
        const finalAudio = Buffer.concat(results);
        res.set({
            'Content-Type': 'audio/mpeg',
            'Content-Disposition': 'attachment; filename="speech.mp3"',
            'Content-Length': finalAudio.length,
        });
        res.end(finalAudio);
    } catch (error) {
        console.error('TTS Error:', error);
        res.status(500).json({ error: error.message });
    }
});

// --- TTS with Timings Endpoint ---
app.post('/api/tts-with-timings', async (req, res) => {
    try {
        const { text, voice } = req.body;
        if (!text) return res.status(400).json({ error: 'Text is required' });
        
        // Map languages based on selected voice/gender because English voices return empty audio for Hindi/Telugu script
        const FEMALE_VOICES = ['en-US-AriaNeural', 'en-US-JennyNeural', 'en-US-MichelleNeural', 'en-GB-SoniaNeural', 'en-AU-NatashaNeural'];
        const isFemale = voice ? FEMALE_VOICES.includes(voice) : true;
        
        const currentVoiceMap = {
            english: voice || VOICE_MAP.english,
            hindi: isFemale ? 'hi-IN-SwaraNeural' : 'hi-IN-MadhurNeural',
            telugu: isFemale ? 'te-IN-ShrutiNeural' : 'te-IN-MohanNeural',
        };

        const segments = splitByLanguage(text);
        
        // Add a silent gap at the beginning to prevent audio clipping on start
        if (segments.length > 0) {
            segments.unshift({ text: ", , , , . ", lang: segments[0].lang });
        }
        
        // Note: For concatenated segments, we must generate them sequentially to get accurate offsets,
        // or generate in parallel and then fix the offsets.
        const segmentResults = await Promise.all(
            segments.map(seg => {
                const pitch = (seg.lang !== 'english' && voice) ? (PITCH_MAP[voice] || '+0%') : '+0%';
                return generateSegmentAudioWithTimings(seg.text, currentVoiceMap[seg.lang], { pitch });
            })
        );

        let finalAudioBuffer = Buffer.from([]);
        let finalBoundaries = [];
        let currentOffset = 0;

        for (const res of segmentResults) {
            // Adjust segment's boundaries based on current running offset
            const adjustedBoundaries = res.boundaries.map(b => ({
                ...b,
                offset: b.offset + currentOffset
            }));
            finalBoundaries = finalBoundaries.concat(adjustedBoundaries);
            finalAudioBuffer = Buffer.concat([finalAudioBuffer, res.buffer]);
            
            // Advance the running offset by the length of this audio segment
            currentOffset += estimateMp3Duration(res.buffer);
        }

        res.json({
            audioBase64: finalAudioBuffer.toString('base64'),
            timings: finalBoundaries
        });

    } catch (error) {
        console.error('TTS with Timings Error:', error);
        res.status(500).json({ error: error.message });
    }
});

const PORT = 3001;
app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
