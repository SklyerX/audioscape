require("dotenv/config");

const { Essentia, EssentiaWASM } = require("essentia.js");
const ort = require("onnxruntime-node");
const { exec } = require("child_process");
const { promisify } = require("util");
const { Worker } = require("bullmq");
const path = require("path");
const fs = require("fs");

const execAsync = promisify(exec);

let essentia;
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
  essentia = new Essentia(EssentiaWASM);

  for (const [key, value] of Object.entries(MODEL_FILES)) {
    models[key] = await ort.InferenceSession.create(
      path.join(MODELS_DIR, value),
    );
  }

  console.log("Essentia loaded with models");
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

const sigmoid = (x) => 1 / (1 + Math.exp(-x));
const clamp01 = (x) => Math.max(0, Math.min(1, x));

// Average a single output column across all effnet batch rows
const meanOf = (tensorMap, classIdx = null) => {
  const arr = tensorMap[Object.keys(tensorMap)[0]].cpuData;
  const nEffnet = 64;
  const stride = classIdx !== null ? arr.length / nEffnet : 1;
  const col = classIdx ?? 0;
  let sum = 0;
  for (let i = 0; i < nEffnet; i++) sum += arr[i * stride + col];
  return sum / nEffnet;
};

// Average a column from a flat Float32Array with given stride
const meanCol = (data, nRows, col, stride) => {
  let sum = 0;
  for (let i = 0; i < nRows; i++) sum += data[i * stride + col];
  return sum / nRows;
};

// MUSE outputs valence/arousal in the DEAM range [1, 9] — normalize to [0, 1]
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

    // Tempo
    // Full 44.1k signal, no cap means more context means better rhythm analysis
    const signal44k = essentia.arrayToVector(audioSamples44k);

    const rhythm = essentia.RhythmExtractor2013(
      signal44k,
      208,
      "multifeature",
      40,
    );
    let tempo = rhythm.bpm;

    try {
      const candidates = essentia.vectorToArray(rhythm.bpmCandidates);
      if (candidates && candidates.length > 0) {
        const half = candidates.find((c) => Math.abs(c - tempo / 2) < 5);
        if (half) tempo = half;
      }
    } catch {
      // bpmCandidates unavailable, stick with raw bpm
    }

    // Key / mode
    const keyData = essentia.KeyExtractor(signal44k);
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

    // Liveness
    const dynComplexity = essentia.DynamicComplexity(signal44k);
    const liveness = clamp01(dynComplexity.dynamicComplexity / 9);

    // effnet embeddings
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

    // ── MusicNN → MUSE (valence + arousal) ──────────────────────────────────
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

    // MUSE columns: [valence, arousal], stride 2, DEAM range [1, 9]
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
