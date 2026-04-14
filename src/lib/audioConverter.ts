import lamejs from 'lamejs';

/**
 * Converts a WebM/Opus audio Blob to MP3 format using lamejs.
 * This is necessary because WhatsApp does not support WebM audio.
 */
export async function convertWebmToMp3(webmBlob: Blob): Promise<Blob> {
  const arrayBuffer = await webmBlob.arrayBuffer();
  const audioContext = new AudioContext();
  const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
  
  const samples = audioBuffer.getChannelData(0); // mono
  const sampleRate = audioBuffer.sampleRate;
  
  // Convert float32 samples to int16
  const int16Samples = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    int16Samples[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
  }
  
  // Encode to MP3
  const mp3Encoder = new lamejs.Mp3Encoder(1, sampleRate, 128);
  const mp3Data: Int8Array[] = [];
  
  const blockSize = 1152;
  for (let i = 0; i < int16Samples.length; i += blockSize) {
    const chunk = int16Samples.subarray(i, i + blockSize);
    const mp3buf = mp3Encoder.encodeBuffer(chunk);
    if (mp3buf.length > 0) {
      mp3Data.push(new Int8Array(mp3buf));
    }
  }
  
  const end = mp3Encoder.flush();
  if (end.length > 0) {
    mp3Data.push(new Int8Array(end));
  }
  
  await audioContext.close();
  return new Blob(mp3Data, { type: 'audio/mpeg' });
}
