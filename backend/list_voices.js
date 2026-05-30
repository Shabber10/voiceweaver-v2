const { MsEdgeTTS } = require('msedge-tts');

(async () => {
    const tts = new MsEdgeTTS();
    const voices = await tts.getVoices();
    const hindi = voices.filter(v => v.Locale.startsWith('hi-IN'));
    const telugu = voices.filter(v => v.Locale.startsWith('te-IN'));
    
    console.log("HINDI VOICES:");
    hindi.forEach(v => console.log(v.ShortName, v.Gender));
    
    console.log("\nTELUGU VOICES:");
    telugu.forEach(v => console.log(v.ShortName, v.Gender));
})();
