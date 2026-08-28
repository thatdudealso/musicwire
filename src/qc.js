import { spawn } from 'node:child_process';

export const failureCodes = {
  validation: 'validation_failed',
  renderer: 'renderer_failed',
  timeout: 'renderer_timeout',
  memory: 'renderer_memory_limit',
  cpu: 'renderer_cpu_limit',
  artifacts: 'artifact_missing',
  artifactStorage: 'artifact_storage_unavailable',
  artifactExpired: 'artifact_expired',
  unexpected: 'job_failed_unexpectedly',
  audioProbe: 'audio_probe_unavailable',
  audioInvalid: 'audio_invalid',
  audioSilent: 'audio_silent',
  duration: 'audio_duration_mismatch',
  scoreDuration: 'score_duration_unavailable',
  durationModel: 'score_duration_model_unsupported',
  constraints: 'constraints_mismatch',
  interrupted: 'render_interrupted',
};

const sustainedInstrumentPattern =
  /\b(?:violin|viola|violoncello|cello|contrabass|double\s+bass|acoustic\s+bass|flute|oboe|clarinet|bassoon|saxophone|trumpet|trombone|tuba|horn|organ|voice|vocal|choir|synth\s+pad)\b/i;

export function audioTailAllowanceForInstruments(
  instruments,
  baseAllowanceSeconds = 0,
  sustainedAllowanceSeconds = baseAllowanceSeconds,
) {
  const base = nonNegativeFinite(baseAllowanceSeconds);
  const sustained = nonNegativeFinite(sustainedAllowanceSeconds);
  const names = Array.isArray(instruments) ? instruments : [];
  return names.some(
    (instrument) => typeof instrument === 'string' && sustainedInstrumentPattern.test(instrument),
  )
    ? Math.max(base, sustained)
    : base;
}

export function checkAudioDuration(expectedSeconds, actualSeconds, tailAllowanceSeconds = 0) {
  if (!(expectedSeconds > 0)) return { ok: true };
  const tolerance = expectedSeconds * 0.1;
  const shortfall = expectedSeconds - actualSeconds;
  const tailAllowance = nonNegativeFinite(tailAllowanceSeconds);
  const overrun = actualSeconds - expectedSeconds - tailAllowance;
  if (shortfall <= tolerance && overrun <= tolerance) return { ok: true };
  return {
    ok: false,
    code: failureCodes.duration,
    message: `Audio duration ${actualSeconds.toFixed(2)}s differs from score duration ${expectedSeconds.toFixed(2)}s by more than 10% beyond the ${tailAllowance}s release-tail allowance.`,
    details: {
      expected_seconds: expectedSeconds,
      actual_seconds: actualSeconds,
      tail_allowance_seconds: tailAllowance,
    },
  };
}

export async function probeAudio(ffprobeBin, filename) {
  const args = [
    '-v',
    'error',
    '-show_format',
    '-show_entries',
    'stream=codec_type,codec_name,channels,sample_rate',
    '-of',
    'json',
    filename,
  ];
  try {
    const { stdout, code } = await command(ffprobeBin, args, 15_000);
    if (code !== 0)
      return {
        ok: false,
        code: failureCodes.audioInvalid,
        message: 'ffprobe could not read the audio container.',
      };
    const output = JSON.parse(stdout);
    const duration = Number(output.format?.duration);
    const audioStream = output.streams?.find((stream) => stream.codec_type === 'audio');
    const channels = Number(audioStream?.channels);
    const sampleRate = Number(audioStream?.sample_rate);
    if (
      !audioStream ||
      !Number.isFinite(duration) ||
      duration <= 0 ||
      !Number.isSafeInteger(channels) ||
      channels < 1 ||
      !Number.isSafeInteger(sampleRate) ||
      sampleRate < 1
    )
      return {
        ok: false,
        code: failureCodes.audioInvalid,
        message: 'Audio has no playable stream or duration.',
      };
    return {
      ok: true,
      duration,
      codec: audioStream.codec_name,
      container: output.format?.format_name,
      channels,
      sampleRate,
      tags: output.format?.tags ?? {},
    };
  } catch (error) {
    return {
      ok: false,
      code: failureCodes.audioProbe,
      message: `ffprobe is unavailable: ${error.message}`,
    };
  }
}

export async function verifyNonSilent(ffmpegBin, filename) {
  try {
    const { stderr, code } = await command(
      ffmpegBin,
      ['-v', 'info', '-i', filename, '-af', 'astats=metadata=1:reset=0', '-f', 'null', '-'],
      20_000,
    );
    if (code !== 0)
      return {
        ok: false,
        code: failureCodes.audioInvalid,
        message: 'ffmpeg could not decode the audio stream.',
      };
    const rms = Number(stderr.match(/RMS level dB:\s*(-?[\d.]+|-inf)/i)?.[1]);
    if (!Number.isFinite(rms) || rms < -90)
      return {
        ok: false,
        code: failureCodes.audioSilent,
        message: 'Audio RMS is silent or below the -90 dB acceptance threshold.',
      };
    return { ok: true, rmsDb: rms };
  } catch (error) {
    return {
      ok: false,
      code: failureCodes.audioProbe,
      message: `ffmpeg is unavailable: ${error.message}`,
    };
  }
}

export function compareConstraints(facts, constraints = {}) {
  const mismatches = [];
  if (constraints.tempo && Math.abs(Number(constraints.tempo) - facts.tempo) > 1)
    mismatches.push('tempo');
  if (
    constraints.duration_seconds &&
    Math.abs(Number(constraints.duration_seconds) - facts.scoreDurationSeconds) >
      Math.max(1, Number(constraints.duration_seconds) * 0.1)
  )
    mismatches.push('duration_seconds');
  if (constraints.key_fifths !== undefined && Number(constraints.key_fifths) !== facts.key.fifths)
    mismatches.push('key_fifths');
  if (constraints.mode && constraints.mode !== facts.key.mode) mismatches.push('mode');
  return mismatches;
}

function command(binary, args, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      resolve({ code: 124, stdout, stderr });
    }, timeoutMs);
    child.stdout.on('data', (data) => {
      stdout += data;
    });
    child.stderr.on('data', (data) => {
      stderr += data;
    });
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

function nonNegativeFinite(value) {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}
