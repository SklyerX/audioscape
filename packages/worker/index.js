require("dotenv/config");

const ort = require("onnxruntime-node");
const { exec } = require("child_process");
const { promisify } = require("util");
const { Worker } = require("bullmq");
const path = require("path");
const fs = require("fs");

const execAsync = promisify(exec);

const models = {};

const MODELS_DIR = path.join(__dirname, "models");

const MODEL_FILES = {
  effnet: "discogs-effnet-bs64-1.onnx",
  danceability: "danceability-discogs-effnet-1.onnx",
  mood_happy: "mood_happy-discogs-effnet-1.onnx",
  mood_sad: "mood_sad-discogs-effnet-1.onnx",
  mood_relaxed: "mood_relaxed-discogs-effnet-1.onnx",
  mood_aggressive: "mood_aggressive-discogs-effnet-1.onnx",
  approachability: "approachability_regression-discogs-effnet-1.onnx",
  engagement: "engagement_regression-discogs-effnet-1.onnx",
  voice_instrumental: "voice_instrumental-discogs-effnet-1.onnx",
  musicnn: "msd-musicnn-1.onnx",
  muse: "muse-msd-musicnn-2.onnx",
};

const init = async () => {
  for (const [key, value] of Object.entries(MODEL_FILES)) {
    models[key] = await ort.InferenceSession.create(
      path.join(MODELS_DIR, value),
    );
  }
  console.log("Models loaded");
};

const loadAudio = async (audioPath, sampleRate = 16000, maxSeconds = null) => {
  const rawPath = audioPath.replace(/\.mp3$/, `.${sampleRate}.raw`);
  const limit = maxSeconds ? `-t ${maxSeconds}` : "";
  await execAsync(
    `ffmpeg -y -i "${audioPath}" ${limit} -f f32le -ac 1 -ar ${sampleRate} "${rawPath}"`,
  );
  const buf = fs.readFileSync(rawPath);
  fs.unlinkSync(rawPath);
  return new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
};

function hannWindow(n) {
  const w = new Float32Array(n);
  for (let i = 0; i < n; i++)
    w[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (n - 1)));
  return w;
}

function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wRe = Math.cos(ang),
      wIm = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let curRe = 1,
        curIm = 0;
      for (let j = 0; j < len / 2; j++) {
        const uRe = re[i + j],
          uIm = im[i + j];
        const vRe = re[i + j + len / 2] * curRe - im[i + j + len / 2] * curIm;
        const vIm = re[i + j + len / 2] * curIm + im[i + j + len / 2] * curRe;
        re[i + j] = uRe + vRe;
        im[i + j] = uIm + vIm;
        re[i + j + len / 2] = uRe - vRe;
        im[i + j + len / 2] = uIm - vIm;
        [curRe, curIm] = [curRe * wRe - curIm * wIm, curRe * wIm + curIm * wRe];
      }
    }
  }
}

function hzToMel(hz) {
  return 2595 * Math.log10(1 + hz / 700);
}
function melToHz(mel) {
  return 700 * (Math.pow(10, mel / 2595) - 1);
}

function buildMelFilterbank(nMels, nFft, sampleRate, fMin, fMax) {
  const melMin = hzToMel(fMin),
    melMax = hzToMel(fMax);
  const melPoints = Array.from(
    { length: nMels + 2 },
    (_, i) => melMin + (i / (nMels + 1)) * (melMax - melMin),
  );
  const hzPoints = melPoints.map(melToHz);
  const bins = hzPoints.map((hz) => Math.floor(((nFft + 1) * hz) / sampleRate));
  const filters = Array.from(
    { length: nMels },
    () => new Float32Array(nFft / 2 + 1),
  );
  for (let m = 1; m <= nMels; m++) {
    for (let k = bins[m - 1]; k < bins[m]; k++)
      filters[m - 1][k] = (k - bins[m - 1]) / (bins[m] - bins[m - 1]);
    for (let k = bins[m]; k < bins[m + 1]; k++)
      filters[m - 1][k] = (bins[m + 1] - k) / (bins[m + 1] - bins[m]);
  }
  return filters;
}

function computeMelPatches(samples) {
  const FRAME_SIZE = 512;
  const HOP_SIZE = 256;
  const N_MELS = 96;
  const PATCH_FRAMES = 128;
  const BATCH_SIZE = 64;
  const SAMPLE_RATE = 16000;

  const window = hannWindow(FRAME_SIZE);
  const filters = buildMelFilterbank(N_MELS, FRAME_SIZE, SAMPLE_RATE, 0, 8000);
  const specSize = FRAME_SIZE / 2 + 1;

  const frames = [];
  for (let start = 0; start + FRAME_SIZE <= samples.length; start += HOP_SIZE) {
    const re = new Float32Array(FRAME_SIZE);
    const im = new Float32Array(FRAME_SIZE);
    for (let i = 0; i < FRAME_SIZE; i++) re[i] = samples[start + i] * window[i];
    fft(re, im);
    const melFrame = new Float32Array(N_MELS);
    for (let m = 0; m < N_MELS; m++) {
      let energy = 0;
      for (let k = 0; k < specSize; k++)
        energy += (re[k] * re[k] + im[k] * im[k]) * filters[m][k];
      melFrame[m] = Math.log1p(Math.max(1e-7, energy));
    }
    frames.push(melFrame);
  }

  const patches = [];
  for (let i = 0; i + PATCH_FRAMES <= frames.length; i += PATCH_FRAMES)
    patches.push(frames.slice(i, i + PATCH_FRAMES));

  while (patches.length < BATCH_SIZE) patches.push(patches[patches.length - 1]);
  const batch = patches.slice(0, BATCH_SIZE);

  const data = new Float32Array(BATCH_SIZE * PATCH_FRAMES * N_MELS);
  for (let p = 0; p < BATCH_SIZE; p++)
    for (let f = 0; f < PATCH_FRAMES; f++)
      data.set(batch[p][f], p * PATCH_FRAMES * N_MELS + f * N_MELS);

  return { data, dims: [BATCH_SIZE, PATCH_FRAMES, N_MELS] };
}

function computeMusicnnPatches(samples) {
  const FRAME_SIZE = 512;
  const HOP_SIZE = 256;
  const N_MELS = 96;
  const PATCH_FRAMES = 187;
  const SAMPLE_RATE = 16000;

  const window = hannWindow(FRAME_SIZE);
  const filters = buildMelFilterbank(N_MELS, FRAME_SIZE, SAMPLE_RATE, 0, 8000);
  const specSize = FRAME_SIZE / 2 + 1;

  const frames = [];
  for (let start = 0; start + FRAME_SIZE <= samples.length; start += HOP_SIZE) {
    const re = new Float32Array(FRAME_SIZE);
    const im = new Float32Array(FRAME_SIZE);
    for (let i = 0; i < FRAME_SIZE; i++) re[i] = samples[start + i] * window[i];
    fft(re, im);
    const melFrame = new Float32Array(N_MELS);
    for (let m = 0; m < N_MELS; m++) {
      let energy = 0;
      for (let k = 0; k < specSize; k++)
        energy += (re[k] * re[k] + im[k] * im[k]) * filters[m][k];
      melFrame[m] = Math.log1p(Math.max(1e-7, energy));
    }
    frames.push(melFrame);
  }

  const patches = [];
  for (let i = 0; i + PATCH_FRAMES <= frames.length; i += PATCH_FRAMES)
    patches.push(frames.slice(i, i + PATCH_FRAMES));
  if (patches.length === 0)
    patches.push(frames.slice(0, Math.min(PATCH_FRAMES, frames.length)));

  const batchSize = patches.length;
  const data = new Float32Array(batchSize * PATCH_FRAMES * N_MELS);
  for (let p = 0; p < batchSize; p++)
    for (let f = 0; f < Math.min(patches[p].length, PATCH_FRAMES); f++)
      data.set(patches[p][f], p * PATCH_FRAMES * N_MELS + f * N_MELS);

  return { data, dims: [batchSize, PATCH_FRAMES, N_MELS] };
}

// Onset-strength autocorrelation tempo detector (replaces Essentia RhythmExtractor2013)
function detectTempo(samples, sampleRate = 44100) {
  const frameSize = 2048;
  const hopSize = 512;
  const window = hannWindow(frameSize);

  let prevMag = null;
  const onset = [];

  for (let start = 0; start + frameSize <= samples.length; start += hopSize) {
    const re = new Float32Array(frameSize);
    const im = new Float32Array(frameSize);
    for (let i = 0; i < frameSize; i++) re[i] = samples[start + i] * window[i];
    fft(re, im);

    const mag = new Float32Array(frameSize / 2);
    for (let i = 0; i < frameSize / 2; i++)
      mag[i] = Math.sqrt(re[i] * re[i] + im[i] * im[i]);

    if (prevMag) {
      let flux = 0;
      for (let i = 0; i < frameSize / 2; i++) {
        const d = mag[i] - prevMag[i];
        if (d > 0) flux += d;
      }
      onset.push(flux);
    }
    prevMag = mag;
  }

  const fps = sampleRate / hopSize;
  const minPeriod = Math.max(1, Math.round((fps * 60) / 208));
  const maxPeriod = Math.round((fps * 60) / 40);

  let bestPeriod = minPeriod;
  let bestCorr = -Infinity;

  for (
    let period = minPeriod;
    period <= maxPeriod && period < onset.length;
    period++
  ) {
    let corr = 0;
    const n = onset.length - period;
    for (let i = 0; i < n; i++) corr += onset[i] * onset[i + period];
    corr /= n;
    if (corr > bestCorr) {
      bestCorr = corr;
      bestPeriod = period;
    }
  }

  let bpm = (fps * 60) / bestPeriod;

  // Prefer half-tempo if above 140 BPM — avoids double-time detection
  if (bpm > 140) {
    const half = bpm / 2;
    if (half >= 40) bpm = half;
  }

  return bpm;
}

// Krumhansl-Schmuckler chromagram key detector (replaces Essentia KeyExtractor)
function detectKey(samples, sampleRate = 44100) {
  const frameSize = 4096;
  const hopSize = 2048;
  const window = hannWindow(frameSize);
  const chroma = new Float32Array(12);

  for (let start = 0; start + frameSize <= samples.length; start += hopSize) {
    const re = new Float32Array(frameSize);
    const im = new Float32Array(frameSize);
    for (let i = 0; i < frameSize; i++) re[i] = samples[start + i] * window[i];
    fft(re, im);

    for (let k = 1; k < frameSize / 2; k++) {
      const freq = (k * sampleRate) / frameSize;
      if (freq < 27.5 || freq > 4186) continue;
      const midi = 12 * Math.log2(freq / 440) + 69;
      const pc = ((Math.round(midi) % 12) + 12) % 12;
      chroma[pc] += Math.sqrt(re[k] * re[k] + im[k] * im[k]);
    }
  }

  const chromaMax = Math.max(...chroma);
  if (chromaMax > 0) for (let i = 0; i < 12; i++) chroma[i] /= chromaMax;

  const majorProfile = [
    6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88,
  ];
  const minorProfile = [
    6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17,
  ];
  const KEY_NAMES = [
    "C",
    "C#",
    "D",
    "D#",
    "E",
    "F",
    "F#",
    "G",
    "G#",
    "A",
    "A#",
    "B",
  ];

  const pearson = (a, b) => {
    const n = a.length;
    const ma = a.reduce((s, x) => s + x, 0) / n;
    const mb = b.reduce((s, x) => s + x, 0) / n;
    let num = 0,
      da = 0,
      db = 0;
    for (let i = 0; i < n; i++) {
      num += (a[i] - ma) * (b[i] - mb);
      da += (a[i] - ma) ** 2;
      db += (b[i] - mb) ** 2;
    }
    return num / Math.sqrt(da * db);
  };

  let bestKey = 0,
    bestScale = "major",
    bestCorr = -Infinity;

  for (let root = 0; root < 12; root++) {
    const rotated = Array.from(
      { length: 12 },
      (_, i) => chroma[(root + i) % 12],
    );
    const mc = pearson(rotated, majorProfile);
    const nc = pearson(rotated, minorProfile);
    if (mc > bestCorr) {
      bestCorr = mc;
      bestKey = root;
      bestScale = "major";
    }
    if (nc > bestCorr) {
      bestCorr = nc;
      bestKey = root;
      bestScale = "minor";
    }
  }

  return { key: KEY_NAMES[bestKey], scale: bestScale };
}

// Loudness variation (replaces Essentia DynamicComplexity)
function computeDynamicComplexity(samples, sampleRate = 44100) {
  const frameSize = Math.round(sampleRate * 0.2);
  const hopSize = Math.round(frameSize / 2);
  const rms = [];

  for (let start = 0; start + frameSize <= samples.length; start += hopSize) {
    let sum = 0;
    for (let i = 0; i < frameSize; i++) sum += samples[start + i] ** 2;
    rms.push(Math.sqrt(sum / frameSize));
  }

  if (rms.length === 0) return 0;
  const mean = rms.reduce((s, x) => s + x, 0) / rms.length;
  const variance = rms.reduce((s, x) => s + (x - mean) ** 2, 0) / rms.length;
  // Scale std to roughly [0, 9] range to match original DynamicComplexity output
  return Math.sqrt(variance) * 30;
}

const sigmoid = (x) => 1 / (1 + Math.exp(-x));
const clamp01 = (x) => Math.max(0, Math.min(1, x));

const meanOf = (tensorMap, classIdx = null) => {
  const arr = tensorMap[Object.keys(tensorMap)[0]].cpuData;
  const nEffnet = 64;
  const stride = classIdx !== null ? arr.length / nEffnet : 1;
  const col = classIdx ?? 0;
  let sum = 0;
  for (let i = 0; i < nEffnet; i++) sum += arr[i * stride + col];
  return sum / nEffnet;
};

const meanCol = (data, nRows, col, stride) => {
  let sum = 0;
  for (let i = 0; i < nRows; i++) sum += data[i * stride + col];
  return sum / nRows;
};

const deamNorm = (x) => clamp01((x - 1) / 8);

const analyzeTrack = async (job) => {
  const { trackKey, artist, track } = job.data;
  const tmpPath = `/tmp/${trackKey}.mp3`;

  if (!fs.existsSync(tmpPath)) {
    try {
      await execAsync(
        `yt-dlp "ytsearch1:${artist} ${track} official audio" -x --audio-format mp3 -o "${tmpPath}"`,
      );
    } catch (err) {
      if (!fs.existsSync(tmpPath)) throw err;
    }
  }

  let result;

  try {
    const [audioSamples, audioSamples44k] = await Promise.all([
      loadAudio(tmpPath, 16000),
      loadAudio(tmpPath, 44100),
    ]);

    const { stdout: probeOut } = await execAsync(
      `ffprobe -v error -show_entries format=duration -of csv=p=0 "${tmpPath}"`,
    );
    const duration_ms = Math.round(parseFloat(probeOut.trim()) * 1000);

    const tempo = detectTempo(audioSamples44k, 44100);

    const keyData = detectKey(audioSamples44k, 44100);
    const KEY_NAMES = [
      "C",
      "C#",
      "D",
      "D#",
      "E",
      "F",
      "F#",
      "G",
      "G#",
      "A",
      "A#",
      "B",
    ];
    const key = KEY_NAMES.indexOf(keyData.key);
    const keyString = `${keyData.key} ${keyData.scale}`;
    const mode = keyData.scale === "major" ? 1 : 0;

    const dynComplexity = computeDynamicComplexity(audioSamples44k, 44100);
    const liveness = clamp01(dynComplexity / 9);

    const mel = computeMelPatches(audioSamples);
    const effnetInput = new ort.Tensor("float32", mel.data, mel.dims);
    const effnetOutput = await models.effnet.run({
      "serving_default_melspectrogram:0": effnetInput,
    });
    const effnetEmbeddings = effnetOutput["PartitionedCall:1"];

    const effnetFeedPb = { "model/Placeholder:0": effnetEmbeddings };
    const effnetFeedEmb = { embeddings: effnetEmbeddings };

    const [
      danceability,
      mood_happy,
      mood_sad,
      mood_relaxed,
      mood_aggressive,
      approachability,
      engagement,
      voice_instrumental,
    ] = await Promise.all([
      models.danceability.run(effnetFeedPb),
      models.mood_happy.run(effnetFeedPb),
      models.mood_sad.run(effnetFeedPb),
      models.mood_relaxed.run(effnetFeedPb),
      models.mood_aggressive.run(effnetFeedPb),
      models.approachability.run(effnetFeedPb),
      models.engagement.run(effnetFeedPb),
      models.voice_instrumental.run(effnetFeedEmb),
    ]);

    const energy = clamp01(
      meanOf(mood_aggressive, 1) * 0.6 + meanOf(mood_happy, 1) * 0.4,
    );

    const musicnnMel = computeMusicnnPatches(audioSamples);
    const musicnnInput = new ort.Tensor(
      "float32",
      musicnnMel.data,
      musicnnMel.dims,
    );

    const musicnnOutput = await models.musicnn.run({
      melspectrogram: musicnnInput,
    });

    const museOutput = await models.muse.run({
      "model/Placeholder:0": musicnnOutput["embeddings"],
    });

    const museData = museOutput["model/Identity:0"].cpuData;
    const nMuse = musicnnMel.dims[0];

    const valence = deamNorm(meanCol(museData, nMuse, 0, 2));
    const arousal = deamNorm(meanCol(museData, nMuse, 1, 2));

    result = {
      duration_ms,
      tempo,
      key,
      keyString,
      mode,
      timeSignature: 4,
      energy,
      liveness,
      danceability: meanOf(danceability, 1),
      instrumentalness: meanOf(voice_instrumental, 1),
      speechiness: meanOf(voice_instrumental, 0),
      valence,
      arousal,
      approachability: sigmoid(meanOf(approachability)),
      engagement: sigmoid(meanOf(engagement)),
      mood: {
        happy: meanOf(mood_happy, 1),
        sad: meanOf(mood_sad, 1),
        relaxed: meanOf(mood_relaxed, 1),
        aggressive: meanOf(mood_aggressive, 1),
      },
      meta: { artist, track },
    };
  } finally {
    if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
  }

  const res = await fetch(
    `${process.env.API_BASE_URL}/api/audio/ingest/${trackKey}`,
    {
      method: "POST",
      body: JSON.stringify(result),
      headers: {
        "Content-Type": "application/json",
        "X-Server-Key": process.env.SERVER_KEY,
      },
    },
  );

  if (!res.ok)
    throw new Error(`Failed to update API: ${res.status} ${await res.text()}`);

  console.log(`Ingested: ${artist} - ${track}`);
};

init().then(() => {
  const worker = new Worker("audio-analysis", analyzeTrack, {
    connection: { url: process.env.REDIS_CONNECTION_STRING },
    concurrency: 5,
  });
  worker.on("completed", (job) => console.log(`done: ${job.id}`));
  worker.on("failed", (job, err) => console.error(`failed: ${job.id}`, err));
});
